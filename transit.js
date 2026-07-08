// ── 乗換案内機能（api.transit.ls8h.com） ──
// 時刻はサービス日0時からの秒数（86400超＝翌日、負値＝前日サービス）で返るため表示時に変換する。
// 最寄り駅はログイン時は /users/{uid}.transitStations、非ログイン時はlocalStorageに保存。

const TRANSIT_API = 'https://api.transit.ls8h.com';
const TRANSIT_LS_STATIONS = 'transit_my_stations';
const TRANSIT_LS_ENABLED = 'transit_my_enabled';
const TRANSIT_LS_HISTORY = 'transit_history';
const TRANSIT_LS_INCLUDE_BUS = 'transit_include_bus'; // バスを含めるか（既定=含めない）
const TRANSIT_LS_HUBS = 'transit_hub_cache';          // 主要ハブ駅ID解決結果の恒久キャッシュ
// フリー検索で自動的にvia指定して探索する主要ハブ駅（APIが上位に出さない
// 隠れた最速ルート＝別事業者乗換などを拾うため）。id解決結果はセッション内でキャッシュ。
const TRANSIT_HUBS = ['新宿', '池袋', '東京', '渋谷', '大宮', '上野', '西船橋', '北千住', '御茶ノ水', '横浜'];
const TRANSIT_HUB_FANOUT = true; // 主要ハブ自動via検索の有効フラグ（結果は段階表示で差し込む）
let _trHubCache = null;
// 本線＋ハブ経由検索をマージすると候補が増えるため表示件数に上限を設ける
// （ソート後の上位のみ表示。遠回りハブの無駄ルートは下位で切り捨てられる）
const TRANSIT_MAX_RESULTS = 12;

// 駅名・行先の比較用正規化。APIは「西船橋」と「西船橋 Nishi-Funabashi」のように
// 日本語名の後ろにローマ字/英字を付ける場合があり、文字列一致が壊れるため、
// 末尾の「空白＋ローマ字/英字以降」を落として日本語名だけで比較する。表示は元の名前を使う。
function _trNorm(s) {
  if (!s) return '';
  return String(s).replace(/[\s　]+[A-Za-zÀ-ÖØ-öø-ÿĀ-ſ(].*$/, '').trim();
}

let _trInited = false;
let _trReady = null;
let _trView = 'menu';          // menu | search | dep | home | settings
let _trMode = 'free';          // free | dep | home
let _trType = 'departure';     // departure | arrival | first | last
let _trMyStations = [];        // [{id, name}]
let _trEnabled = {};           // 駅id → 有効フラグ（falseのみ記録）
let _trSel = {};               // 入力キー → 確定済み駅 {id, name}
let _trJourneys = [];
let _trSort = 'time';
let _trExclude = [];           // 迂回検索で除外する路線名（routeName完全一致）
let _trIsDetour = false;
let _trIncludeBus = localStorage.getItem(TRANSIT_LS_INCLUDE_BUS) === '1'; // 既定=false（バス排除）
let _trSearchToken = 0; // 検索ごとに採番。段階表示の非同期更新が古い検索由来なら破棄するため
const _trTimer = {};
const _trAbort = {};

// ── 初期化 ──
function initTransit() {
  _trReady = _trLoadMyStations().then(() => {
    _trUpdateMenu();
    if (_trView === 'settings') _trRenderSettings();
    if (_trMode !== 'free' && _trView !== 'menu') _trRenderMyToggles();
  });
  // 日付・時刻はこの画面を開くたびに現在時刻へ更新する
  // （SPAで日付をまたいで開きっぱなしにすると古いサービス日で検索してしまい、
  //  今は走っていない便＝実ダイヤにない便が出るのを防ぐ）
  const now = new Date();
  document.getElementById('transit-date').value = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' });
  document.getElementById('transit-time').value = now.toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false });
  const busCb = document.getElementById('transit-include-bus');
  if (busCb) busCb.checked = _trIncludeBus;
  if (_trInited) return;
  _trInited = true;
  ['from', 'to', 'via1', 'via2', 'via3'].forEach(k => _trBindSuggest(k));
  _trBindSuggest('st-add', st => {
    addTransitMyStation(st);
    document.getElementById('transit-st-add').value = '';
  });
  _trRenderHistory();
}

// ── ビュー切り替え ──
async function showTransitView(v) {
  if (!['menu', 'search', 'dep', 'home', 'settings'].includes(v)) v = 'menu';
  if (_trReady) await _trReady;
  if ((v === 'dep' || v === 'home') && !_trMyStations.length) v = 'menu';
  _trView = v;
  document.getElementById('transit-view-menu').style.display = v === 'menu' ? '' : 'none';
  document.getElementById('transit-view-search').style.display = (v === 'search' || v === 'dep' || v === 'home') ? '' : 'none';
  document.getElementById('transit-view-settings').style.display = v === 'settings' ? '' : 'none';
  if (v === 'menu') _trUpdateMenu();
  if (v === 'settings') _trRenderSettings();
  if (v === 'search' || v === 'dep' || v === 'home') {
    _trMode = v === 'search' ? 'free' : v;
    _trApplyMode();
  }
  if (currentSection === 'transit') {
    _skipHashChange = true;
    history.replaceState(null, '', v === 'menu' ? '#transit' : '#transit/' + v);
    _skipHashChange = false;
  }
}

function _trUpdateMenu() {
  const has = _trMyStations.length > 0;
  document.getElementById('transit-menu-dep').disabled = !has;
  document.getElementById('transit-menu-home').disabled = !has;
  document.getElementById('transit-menu-note').style.display = has ? 'none' : '';
}

function _trApplyMode() {
  const fw = document.getElementById('transit-from-wrap');
  const tw = document.getElementById('transit-to-wrap');
  const my = document.getElementById('transit-my-block');
  const titles = { free: '乗換案内', dep: '出発（最寄り駅〜）', home: '帰宅（〜最寄り駅）' };
  document.getElementById('transit-search-title').textContent = titles[_trMode];
  fw.style.display = _trMode === 'dep' ? 'none' : '';
  tw.style.display = _trMode === 'home' ? 'none' : '';
  my.style.display = _trMode === 'free' ? 'none' : '';
  fw.style.order = '1';
  my.style.order = _trMode === 'dep' ? '1' : '3';
  tw.style.order = '3';
  document.getElementById('transit-my-label').textContent = _trMode === 'dep' ? '出発：最寄り駅' : '到着：最寄り駅';
  if (_trMode !== 'free') _trRenderMyToggles();
  _trRenderHistory();
}

// ── 最寄り駅の保存・読み込み ──
async function _trLoadMyStations() {
  let local = [];
  try { local = JSON.parse(localStorage.getItem(TRANSIT_LS_STATIONS)) || []; } catch (e) {}
  if (_currentUser && _db) {
    try {
      const doc = await _db.collection('users').doc(_currentUser.uid).get();
      const fs = (doc.exists && doc.data().transitStations) || [];
      if (fs.length) {
        _trMyStations = fs;
      } else if (local.length) {
        _trMyStations = local;
        _trSaveMyStations(); // 非ログイン時の設定をアカウントへ移行
      } else {
        _trMyStations = [];
      }
    } catch (e) { _trMyStations = local; }
  } else {
    _trMyStations = local;
  }
  try { _trEnabled = JSON.parse(localStorage.getItem(TRANSIT_LS_ENABLED)) || {}; } catch (e) { _trEnabled = {}; }
}

function _trSaveMyStations() {
  localStorage.setItem(TRANSIT_LS_STATIONS, JSON.stringify(_trMyStations));
  if (_currentUser && _db) {
    _db.collection('users').doc(_currentUser.uid).set({ transitStations: _trMyStations }, { merge: true }).catch(() => {});
  }
}

function addTransitMyStation(st) {
  const el = document.getElementById('transit-st-status');
  if (_trMyStations.length >= 5) { el.textContent = '最寄り駅は5件まで登録できます'; el.className = 'admin-status error'; return; }
  if (_trMyStations.some(s => s.id === st.id)) { el.textContent = '既に登録されています'; el.className = 'admin-status error'; return; }
  _trMyStations.push({ id: st.id, name: st.name });
  _trSaveMyStations();
  el.textContent = '';
  _trRenderSettings();
  _trUpdateMenu();
}

function removeTransitMyStation(id) {
  _trMyStations = _trMyStations.filter(s => s.id !== id);
  delete _trEnabled[id];
  localStorage.setItem(TRANSIT_LS_ENABLED, JSON.stringify(_trEnabled));
  _trSaveMyStations();
  _trRenderSettings();
  _trUpdateMenu();
}

function _trRenderSettings() {
  const list = document.getElementById('transit-st-list');
  list.innerHTML = _trMyStations.length
    ? _trMyStations.map(st =>
        `<div class="transit-st-item"><span>${_esc(st.name)}</span><button type="button" class="admin-btn sm danger" onclick="removeTransitMyStation('${_escHtml(st.id)}')">削除</button></div>`
      ).join('')
    : '<div class="admin-empty">最寄り駅が未設定です</div>';
  document.getElementById('transit-st-note').textContent = _currentUser
    ? '設定はアカウントに保存されます。'
    : '※ログインしていない場合、設定はこの端末のブラウザに保存され、消えることがあります。ログインするとアカウントに引き継がれます。';
}

function _trRenderMyToggles() {
  document.getElementById('transit-my-toggles').innerHTML = _trMyStations.map(st =>
    `<label class="transit-my-toggle"><input type="checkbox" ${_trEnabled[st.id] !== false ? 'checked' : ''} onchange="toggleTransitMyStation('${_escHtml(st.id)}', this.checked)"><span>${_esc(st.name)}</span></label>`
  ).join('');
}

function toggleTransitMyStation(id, on) {
  _trEnabled[id] = on;
  localStorage.setItem(TRANSIT_LS_ENABLED, JSON.stringify(_trEnabled));
}

// ── 駅サジェスト ──
async function _trSuggest(q, signal) {
  // places/suggestを使うと所在地（description）が取れる。駅のみに絞る
  const res = await fetch(`${TRANSIT_API}/api/v1/places/suggest?q=${encodeURIComponent(q)}&limit=12`, { signal });
  if (!res.ok) return [];
  const j = await res.json();
  // フィード横断で同じ駅が別IDで重複するため、同名かつ近距離（約500m）の候補は
  // スコア最上位の1件（レスポンス順）に統合する
  const out = [];
  (j.places || []).forEach(p => {
    if (p.kind !== 'station') return; // 駅のみに絞る（stopはバス停等が混ざるため除外）
    const dup = out.some(o =>
      o.name === p.name &&
      Math.abs(o.lat - p.lat) < 0.005 && Math.abs(o.lon - p.lon) < 0.006
    );
    if (!dup) out.push({ id: p.endpoint, name: p.name, nameKana: p.nameKana, lat: p.lat, lon: p.lon });
  });
  return out.slice(0, 8);
}

// ── 所在地（都道府県・市区町村）の逆ジオコーディング（国土地理院） ──
const _trAddrCache = {};
let _trMuniTable = null;

async function _trMuniLoad() {
  if (_trMuniTable) return _trMuniTable;
  const res = await fetch('https://maps.gsi.go.jp/js/muni.js');
  const text = await res.text();
  const table = {};
  // 形式: GSI.MUNI_ARRAY["1100"] = '1,北海道,1100,札幌市';
  text.replace(/MUNI_ARRAY\["(\d+)"\]\s*=\s*'([^']+)'/g, (m, cd, v) => {
    const parts = v.split(',');
    table[cd] = parts[1] + ' ' + (parts[3] || '');
    return m;
  });
  _trMuniTable = table;
  return table;
}

async function _trAddr(lat, lon) {
  if (lat === undefined || lon === undefined) return null;
  const key = lat.toFixed(3) + ',' + lon.toFixed(3);
  if (key in _trAddrCache) return _trAddrCache[key];
  const [table, res] = await Promise.all([
    _trMuniLoad(),
    fetch(`https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat=${lat}&lon=${lon}`)
  ]);
  const j = await res.json();
  const cd = j.results && j.results.muniCd ? String(parseInt(j.results.muniCd, 10)) : null;
  const label = (cd && table[cd]) || null;
  _trAddrCache[key] = label;
  return label;
}

function _trBindSuggest(key, onPick) {
  const input = document.getElementById('transit-' + key);
  const box = document.getElementById('transit-' + key + '-suggest');
  input.addEventListener('input', () => {
    _trSel[key] = null;
    clearTimeout(_trTimer[key]);
    const q = input.value.trim();
    if (!q) { box.classList.remove('open'); return; }
    _trTimer[key] = setTimeout(async () => {
      if (_trAbort[key]) _trAbort[key].abort();
      _trAbort[key] = new AbortController();
      try {
        const sts = await _trSuggest(q, _trAbort[key].signal);
        box._sts = sts;
        const ver = (box._ver || 0) + 1;
        box._ver = ver;
        // 候補は駅名＋所在地（都道府県 市区町村）を表示。かなは出さない
        box.innerHTML = sts.length
          ? sts.map((st, i) => `<div class="transit-suggest-item" data-i="${i}">${_esc(st.name)}<span class="transit-suggest-loc" id="${box.id}-loc-${i}"></span></div>`).join('')
          : '<div class="transit-suggest-item" style="cursor:default;color:var(--dim)">該当する駅がありません</div>';
        box.classList.add('open');
        // 所在地を非同期で埋める。再描画済みなら書き込まない
        sts.forEach((st, i) => {
          _trAddr(st.lat, st.lon).then(label => {
            if (!label || box._ver !== ver) return;
            const span = document.getElementById(`${box.id}-loc-${i}`);
            if (span) span.textContent = label;
          }).catch(() => {});
        });
      } catch (e) { /* 中断・通信エラーは無視 */ }
    }, 300);
  });
  // mousedownはblurより先に発火するため、候補クリックを確実に拾える
  box.addEventListener('mousedown', ev => {
    const item = ev.target.closest('.transit-suggest-item');
    if (!item || item.dataset.i === undefined) return;
    ev.preventDefault();
    const st = box._sts && box._sts[+item.dataset.i];
    if (!st) return;
    box.classList.remove('open');
    if (onPick) { onPick(st); }
    else { _trSel[key] = { id: st.id, name: st.name, lat: st.lat, lon: st.lon }; input.value = st.name; }
  });
  input.addEventListener('blur', () => setTimeout(() => box.classList.remove('open'), 200));
}

// ── フォーム操作 ──
function swapTransit() {
  if (_trMode === 'free') {
    const tmp = _trSel.from; _trSel.from = _trSel.to; _trSel.to = tmp;
    const fi = document.getElementById('transit-from'), ti = document.getElementById('transit-to');
    const v = fi.value; fi.value = ti.value; ti.value = v;
  } else {
    // 出発⇄帰宅：入力側の駅を保持したまま向きを反転
    const otherKey = _trMode === 'dep' ? 'to' : 'from';
    const newKey = _trMode === 'dep' ? 'from' : 'to';
    _trSel[newKey] = _trSel[otherKey];
    document.getElementById('transit-' + newKey).value = document.getElementById('transit-' + otherKey).value;
    _trSel[otherKey] = null;
    document.getElementById('transit-' + otherKey).value = '';
    showTransitView(_trMode === 'dep' ? 'home' : 'dep');
  }
}

function setTransitType(t, btn) {
  _trType = t;
  document.querySelectorAll('#transit-type-row button').forEach(b => b.classList.toggle('active', b === btn));
  const isFL = t === 'first' || t === 'last';
  document.getElementById('transit-time').disabled = isFL;
  document.getElementById('transit-via-note').style.display = isFL ? '' : 'none';
  ['via1', 'via2', 'via3'].forEach(k => { document.getElementById('transit-' + k).disabled = isFL; });
}

function setTransitIncludeBus(on) {
  _trIncludeBus = !!on;
  localStorage.setItem(TRANSIT_LS_INCLUDE_BUS, _trIncludeBus ? '1' : '0');
  // すでに検索結果が出ていれば、新しい条件で自動的に再検索する
  if (document.getElementById('transit-results-card').style.display !== 'none') searchTransit();
}

function toggleTransitVia() {
  const body = document.getElementById('transit-via-body');
  const arrow = document.getElementById('transit-via-arrow');
  const open = body.classList.toggle('open');
  arrow.classList.toggle('open', open);
}

function _trStatus(msg, isErr) {
  const el = document.getElementById('transit-status');
  el.textContent = msg || '';
  el.className = 'admin-status' + (isErr ? ' error' : '');
}

// 主要ハブ駅を駅ID付きに解決（localStorageに恒久キャッシュ）。出発/到着駅と同一の
// ハブはvia指定できない（無効クエリになる）ため除外。さらに出発/到着の座標が
// 分かる場合は「経由しても大回りにならない」ハブだけに絞る（コリドー判定）。
async function _trResolveHubs(pr) {
  if (!_trHubCache) {
    try { _trHubCache = JSON.parse(localStorage.getItem(TRANSIT_LS_HUBS) || 'null'); } catch (e) { _trHubCache = null; }
  }
  // ハブ一覧の変更や旧形式（座標なし）のキャッシュは作り直す
  if (!_trHubCache || _trHubCache.length !== TRANSIT_HUBS.length || _trHubCache.some(h => h.lat === undefined)) {
    const arr = await Promise.all(TRANSIT_HUBS.map(name =>
      _trSuggest(name).then(sts => sts[0] || null).catch(() => null)
    ));
    _trHubCache = arr.filter(Boolean).map(st => ({ id: st.id, name: st.name, lat: st.lat, lon: st.lon }));
    if (_trHubCache.length) { try { localStorage.setItem(TRANSIT_LS_HUBS, JSON.stringify(_trHubCache)); } catch (e) {} }
  }
  let hubs = _trHubCache.filter(h =>
    h.id !== pr.from.id && h.id !== pr.to.id &&
    h.name !== pr.from.name && h.name !== pr.to.name
  );
  // コリドー判定: 出発→ハブ→到着の距離が直行距離の1.6倍+3km以内のハブのみ経由候補にする
  // （明後日方向のハブへの無駄なvia検索を省く。座標が無い場合は絞らず全ハブを使う）
  if (pr.from.lat !== undefined && pr.to.lat !== undefined) {
    const direct = _trDistKm(pr.from, pr.to);
    hubs = hubs.filter(h => h.lat !== undefined &&
      _trDistKm(pr.from, h) + _trDistKm(h, pr.to) <= direct * 1.6 + 3);
  }
  return hubs;
}

// 2点間の概算距離（km）。近距離用の等距円筒近似で十分
function _trDistKm(a, b) {
  const kx = 111.32 * Math.cos((a.lat + b.lat) / 2 * Math.PI / 180);
  const dx = (a.lon - b.lon) * kx, dy = (a.lat - b.lat) * 111.32;
  return Math.sqrt(dx * dx + dy * dy);
}

// 複数検索（本線＋ハブ経由）の結果から同一経路を除去する。
// 発着秒数と運行区間（路線名＋発着駅）の並びが一致する経路を重複とみなす。
function _trDedupJourneys(list) {
  const seen = new Set();
  const out = [];
  list.forEach(j => {
    const tl = j.legs.filter(l => l.kind === 'transit');
    // 運行区間のない徒歩のみ経路は発着秒数が未設定でキーが潰れるため、判定せず残す
    if (!tl.length) { out.push(j); return; }
    const key = j.departureSecs + '_' + j.arrivalSecs + '_' +
      tl.map(l => l.routeName + ':' + l.from.name + '>' + l.to.name).join('|');
    if (seen.has(key)) return;
    seen.add(key);
    out.push(j);
  });
  return out;
}

// ── 検索 ──
async function searchTransit(detour) {
  const btn = document.getElementById('transit-search-btn');
  const isFL = _trType === 'first' || _trType === 'last';
  if (!detour) _trExclude = [];
  _trIsDetour = !!(detour && _trExclude.length);
  const vias = isFL ? [] : ['via1', 'via2', 'via3'].map(k => _trSel[k]).filter(Boolean);

  let pairs = []; // [{from, to, myst}]
  if (_trMode === 'free') {
    if (!_trSel.from || !_trSel.to) { _trStatus('出発駅・到着駅を候補から選んでください', true); return; }
    if (_trSel.from.id === _trSel.to.id) { _trStatus('出発駅と到着駅が同じです', true); return; }
    pairs = [{ from: _trSel.from, to: _trSel.to }];
  } else {
    const enabled = _trMyStations.filter(st => _trEnabled[st.id] !== false);
    if (!enabled.length) { _trStatus('有効な最寄り駅がありません', true); return; }
    if (_trMode === 'dep') {
      if (!_trSel.to) { _trStatus('到着駅を候補から選んでください', true); return; }
      pairs = enabled.map(st => ({ from: st, to: _trSel.to, myst: st.name + '発' }));
    } else {
      if (!_trSel.from) { _trStatus('出発駅を候補から選んでください', true); return; }
      pairs = enabled.map(st => ({ from: _trSel.from, to: st, myst: st.name + '着' }));
    }
    pairs = pairs.filter(p => p.from.id !== p.to.id);
    if (!pairs.length) { _trStatus('出発駅と到着駅が同じです', true); return; }
  }

  const token = ++_trSearchToken;
  btn.disabled = true;
  _trStatus('検索中...');
  // フリー検索は候補数を多めにする。numItinerariesはAPI上限6（8は「plan query is invalid」）。
  const n = detour ? 6 : (_trMode === 'free' ? 6 : 3);
  // バスの扱い: 既定はバス排除（avoidModes=bus を全検索に付与）。チェックONで含める。
  const avoid = _trIncludeBus ? undefined : 'bus';
  const hubFanout = TRANSIT_HUB_FANOUT && _trMode === 'free' && !detour && !isFL && !vias.length;
  const railBias = _trIncludeBus && _trMode === 'free' && !detour; // バス排除時は本線が既に電車のみなので不要

  // ── フェーズ1: 本線(+rail-bias)検索。結果が出たら即表示し、ハブ経由は裏で続ける ──
  const baseTasks = [];
  if (_trMode === 'free') {
    const pr = pairs[0];
    baseTasks.push({ pr, vias, n, base: true, avoidModes: avoid });
    if (railBias) baseTasks.push({ pr, vias, n, base: false, avoidModes: 'bus', timeout: 8000 });
  } else {
    pairs.forEach(pr => baseTasks.push({ pr, vias, n, base: true, avoidModes: avoid }));
  }
  const baseResults = await Promise.all(baseTasks.map(t => _trRunTask(t, detour)));
  if (token !== _trSearchToken) return; // 新しい検索に置き換わっていたら破棄
  btn.disabled = false;

  let all = _trCollect(baseResults, []);
  if (_trMode === 'free' && baseTasks.length > 1) all = _trDedupJourneys(all);
  const baseFailed = baseResults.filter(r => r.err && r.t.base);

  if (all.length) {
    if (_trMode === 'free' && !detour) _trSaveHistory(_trSel.from, _trSel.to);
    _trStatus(hubFanout ? 'さらに速い経路を探索中…' : (baseFailed.length ? '一部の検索に失敗しました' : ''));
    _trApplyResults(all);
  } else if (!hubFanout) {
    _trShowNoResult(baseFailed);
    return;
  } else {
    // 本線が空でもハブ経由で見つかる可能性があるので待つ。前回結果は隠す
    document.getElementById('transit-results-card').style.display = 'none';
    _trStatus('経路を探索中…');
  }

  // ── フェーズ2: 主要ハブ経由検索を裏で実行し、より良い経路を差し込む ──
  if (!hubFanout) { _trVerifyThrough(all, token, avoid, detour); return; }
  const hubs = await _trResolveHubs(pairs[0]);
  if (token !== _trSearchToken) return;
  const hubTasks = hubs.map(h => ({ pr: pairs[0], vias: [h], n: 3, base: false, avoidModes: avoid, timeout: 6000 }));
  if (hubTasks.length) {
    const hubResults = await Promise.all(hubTasks.map(t => _trRunTask(t, detour)));
    if (token !== _trSearchToken) return;
    const before = all.length;
    all = _trDedupJourneys(_trCollect(hubResults, all.slice()));
    if (all.length && before === 0 && _trMode === 'free' && !detour) _trSaveHistory(_trSel.from, _trSel.to);
    if (all.length) {
      const added = all.length - before;
      _trStatus(added > 0 ? `別経路を${added}件追加しました` : (baseFailed.length ? '一部の検索に失敗しました' : ''));
      _trApplyResults(all);
      _trVerifyThrough(all, token, avoid, detour);
      return;
    }
  }
  // 本線・ハブとも経路が見つからなかった場合
  if (!all.length) { _trShowNoResult(baseFailed); return; }
  _trStatus(baseFailed.length ? '一部の検索に失敗しました' : '');
  _trVerifyThrough(all, token, avoid, detour);
}

// 1タスクを実行（本線=タイムアウトなし / 追加検索=タイムアウト付き）
function _trRunTask(t, detour) {
  return t.base
    ? _trFetchPlan(t.pr, t.vias, t.n, detour, undefined, t.avoidModes, t.avoidWalk).then(js => ({ t, js })).catch(e => ({ t, err: e }))
    : _trPlanWithTimeout(t, detour, t.timeout || 6000);
}

// 検索結果配列から経路を取り出してtrim・ラベル付与し all に追加
function _trCollect(results, all) {
  results.forEach(r => {
    if (r.js) r.js.forEach(j => {
      _trMergeThroughLegs(j);
      _trTrimJourney(j);
      j._myst = r.t.pr.myst || '';
      j._dest = r.t.pr.to; // 検索した目的地（到着駅がこれと別なら徒歩連絡を補って表示）
      all.push(j);
    });
  });
  return all;
}

// 直通運転（乗り入れで同じ列車のまま走る区間）がAPIデータ上で別legに分割されて
// 「乗換」に見えるのを1本にまとめる（例: 東西線→東葉高速線を西船橋で分割）。
// 判定: 同一tripId／同駅で乗換時間0以下／同駅・同ホームで待ち3分以内／
//        同駅で行き先表示(headsign)が同一かつ待ち5分以内、のいずれか。
// 直通列車は全区間で行き先が同じ（例:「東葉勝田台」）で、同じ行き先の別列車へ
// 乗り換える経路は経路探索上ほぼ生じないため、headsign一致は安全な判定になる。
// 相互直通運転する路線ペア（routeNameの部分一致で判定）。ある駅で前後のlegが
// このペアに該当し待ち時間が短ければ、同じ列車が乗り入れて直通していると判定する。
const TRANSIT_THROUGH_PAIRS = [
  ['東西線', '東葉高速'], ['東西線', 'TR'], ['東西線', '総武'], ['東西線', '中央'],
  ['千代田線', '常磐'], ['千代田線', '小田急'],
  ['半蔵門線', '田園都市'], ['半蔵門線', '東武'],
  ['日比谷線', '東武'],
  ['副都心線', '東急東横'], ['副都心線', 'みなとみらい'], ['副都心線', '東武東上'], ['副都心線', '西武'],
  ['有楽町線', '東武東上'], ['有楽町線', '西武'],
  ['三田線', '目黒線'], ['三田線', '東急目黒'],
  ['南北線', '目黒線'], ['南北線', '埼玉高速'],
  ['浅草線', '京急'], ['浅草線', '京成'],
  ['新宿線', '京王'],
  ['東急東横', 'みなとみらい'],
];
function _trIsThroughPair(a, b) {
  if (!a || !b) return false;
  return TRANSIT_THROUGH_PAIRS.some(([x, y]) =>
    (a.includes(x) && b.includes(y)) || (a.includes(y) && b.includes(x)));
}
function _trMergeThroughLegs(j) {
  if (!j.legs || j.legs.length < 2) return;
  const isIntraWalk = l => l.kind === 'walk' && _trNorm(l.from.name) === _trNorm(l.to.name);
  const isThrough = (a, b) => {
    if (_trNorm(a.to.name) !== _trNorm(b.from.name)) return false;
    const gap = b.departureSecs - a.arrivalSecs;
    const samePf = a.to.platformCode && b.from.platformCode && a.to.platformCode === b.from.platformCode;
    const sameHs = a.headsign && b.headsign && _trNorm(a.headsign) === _trNorm(b.headsign);
    const throughPair = _trIsThroughPair(a.routeName, b.routeName) && gap <= 180;
    return (a.tripId && a.tripId === b.tripId) || gap <= 0 || (samePf && gap <= 180) || (sameHs && gap <= 300) || throughPair;
  };
  const merge = (prev, leg) => {
    prev._thru = prev._thru || [prev.routeName];
    if (prev._thru[prev._thru.length - 1] !== leg.routeName) prev._thru.push(leg.routeName);
    prev.routeName = prev._thru.join('→') + (prev._thru.length > 1 ? '（直通）' : '');
    prev.to = leg.to;
    prev.arrivalSecs = leg.arrivalSecs;
  };
  const out = [];
  for (let i = 0; i < j.legs.length; i++) {
    const leg = j.legs[i];
    const prev = out[out.length - 1];
    if (prev && prev.kind === 'transit' && leg.kind === 'transit' && isThrough(prev, leg)) {
      merge(prev, leg);
      continue;
    }
    // APIが直通の境界駅に乗降移動の構内徒歩を挟んで返す場合があるため、
    // 構内徒歩1つを跨いだ前後が直通条件を満たすなら徒歩ごと結合する
    if (prev && prev.kind === 'transit' && isIntraWalk(leg) && i + 1 < j.legs.length) {
      const next = j.legs[i + 1];
      if (next.kind === 'transit' && isThrough(prev, next)) {
        merge(prev, next);
        i++; // 徒歩と次のlegを消費
        continue;
      }
    }
    out.push(Object.assign({}, leg));
  }
  if (out.length !== j.legs.length) {
    j.legs = out;
    j.transferCount = Math.max(0, out.filter(l => l.kind === 'transit').length - 1);
  }
}

// 表示済み経路の「乗換」を再検証する。乗換駅から到着時刻ちょうど発で目的地へ
// 再検索し、待ち3分以内で同じ行先/直通ペアの便が続く（＝実際は乗換不要で直通）
// 場合、その区間を差し替えて直通結合し直す。採用は乗換が実際に減った時のみ＝
// 常にAPI由来の上位互換経路になり、同一直通コリドーなので運賃も元のまま整合する。
async function _trTryThroughFix(j, avoid) {
  if (!j.legs) return null;
  for (let i = 0; i < j.legs.length; i++) {
    const L1 = j.legs[i];
    if (L1.kind !== 'transit') continue;
    // 次のtransit legを求める（間の同一駅構内徒歩は跨ぐ）
    let q = i + 1;
    while (q < j.legs.length && j.legs[q].kind === 'walk' && _trNorm(j.legs[q].from.name) === _trNorm(j.legs[q].to.name)) q++;
    if (q >= j.legs.length || j.legs[q].kind !== 'transit') continue;
    const L2 = j.legs[q];
    const gap = L2.departureSecs - L1.arrivalSecs;
    if (gap <= 180 || gap > 1800) continue; // 既に近接／30分超の待ちは対象外
    const destId = (j._dest && j._dest.id) || j.legs[j.legs.length - 1].to.id;
    const destName = (j._dest && j._dest.name) || j.legs[j.legs.length - 1].to.name;
    const pr = { from: { id: L1.to.id, name: L1.to.name }, to: { id: destId, name: destName } };
    let res;
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 6000);
      res = await _trFetchPlan(pr, [], 3, false, ac.signal, avoid).finally(() => clearTimeout(timer));
    } catch (e) { return null; }
    if (!res || !res.length) return null;
    for (const cand of res) {
      if (!cand.legs || !cand.legs.length) continue;
      _trMergeThroughLegs(cand);
      _trTrimJourney(cand);
      const firstT = cand.legs.find(l => l.kind === 'transit');
      if (!firstT) continue;
      const wait = firstT.departureSecs - L1.arrivalSecs;
      if (wait < -60 || wait > 180) continue;
      const cont = _trIsThroughPair(L1.routeName, firstT.routeName) ||
        (L1.headsign && firstT.headsign && _trNorm(L1.headsign) === _trNorm(firstT.headsign)) ||
        firstT.routeName === L2.routeName;
      if (!cont) continue;
      const candLast = cand.legs[cand.legs.length - 1];
      if (candLast.to.id !== destId && _trNorm(candLast.to.name) !== _trNorm(destName)) continue;
      // L1まで + 再検索結果を連結して直通結合を試す
      const spliced = Object.assign({}, j);
      let tail = cand.legs.slice();
      while (tail.length && tail[0].kind === 'walk' && _trNorm(tail[0].from.name) === _trNorm(tail[0].to.name)) tail.shift();
      spliced.legs = j.legs.slice(0, i + 1).concat(tail);
      const beforeTransfers = typeof j.transferCount === 'number'
        ? j.transferCount : Math.max(0, j.legs.filter(l => l.kind === 'transit').length - 1);
      _trMergeThroughLegs(spliced);
      const newTransfers = Math.max(0, spliced.legs.filter(l => l.kind === 'transit').length - 1);
      if (newTransfers >= beforeTransfers) continue; // 直通結合で乗換が減った時のみ採用
      spliced.departureSecs = spliced.legs[0].departureSecs;
      spliced.arrivalSecs = spliced.legs[spliced.legs.length - 1].arrivalSecs;
      spliced.durationSecs = spliced.arrivalSecs - spliced.departureSecs;
      spliced.transferCount = newTransfers;
      // 完全に1本の直通になった時だけ元の運賃を引き継ぐ（同一コリドーで運賃不変）。
      // 乗換が残る場合は尾側が別経路に分岐して運賃が変わり得るため運賃を消す
      // （誤った運賃を表示・運賃ソートに使わない。区間ごと運賃ボタンで再算出可能）
      if (newTransfers > 0) { spliced.fare = null; spliced._pf = undefined; }
      return spliced; // _dest等は元のjから引き継ぐ
    }
    return null; // 最初の乗換境界のみ検証
  }
  return null;
}

async function _trVerifyThrough(all, token, avoid, detour) {
  if (detour) return;
  let changed = false;
  const limit = Math.min(all.length, 8);
  for (let ji = 0; ji < limit; ji++) {
    if (token !== _trSearchToken) return;
    const fixed = await _trTryThroughFix(all[ji], avoid);
    if (token !== _trSearchToken) return;
    if (fixed) { all[ji] = fixed; changed = true; }
  }
  if (changed && token === _trSearchToken) _trApplyResults(_trDedupJourneys(all));
}

// 到着駅が検索した目的地と別（APIが近接駅を目的地扱いして連絡徒歩を省くケース。
// 例: 朝霞台行きで北朝霞着）なら、目的地名を返す（＝徒歩連絡を補って表示する）
function _trDestWalkName(j) {
  if (!j._dest || !j.legs || !j.legs.length) return '';
  const last = j.legs[j.legs.length - 1].to;
  return (last.id !== j._dest.id && _trNorm(last.name) !== _trNorm(j._dest.name)) ? j._dest.name : '';
}

// 経路リストを画面に反映（路線パネル・除外フィルタ・迂回注記・ソート）
// 経路末尾の徒歩がこの秒数を超える経路（目的地から1km前後以上離れた駅で降ろされる
// 経路）は、より徒歩の短い経路が1件でもあれば除外する。全滅する場合はそのまま残す。
const TRANSIT_MAX_END_WALK_SECS = 600;
function _trFilterLongEndWalk(list) {
  const endWalk = j => {
    const last = j.legs[j.legs.length - 1];
    return last && last.kind === 'walk' ? last.arrivalSecs - last.departureSecs : 0;
  };
  const ok = list.filter(j => endWalk(j) <= TRANSIT_MAX_END_WALK_SECS);
  return ok.length ? ok : list;
}

function _trApplyResults(all) {
  all = _trFilterLongEndWalk(all);
  _trRenderLinePanel(all);
  _trJourneys = _trExclude.length
    ? all.filter(j => !j.legs.some(l => l.kind === 'transit' && _trExclude.includes(l.routeName)))
    : all;
  const note = document.getElementById('transit-detour-note');
  if (_trIsDetour) {
    note.style.display = '';
    note.textContent = _trJourneys.length
      ? `${_trExclude.join('・')} を除外した迂回路です`
      : '除外条件では経路が見つかりませんでした。チェックを減らして再検索してください';
  } else {
    note.style.display = 'none';
  }
  document.getElementById('transit-results-card').style.display = '';
  sortTransitResults(_trSort);
}

// 経路なし・失敗時の表示
function _trShowNoResult(failed) {
  const e = failed.length ? failed[0].err : null;
  // 中断（タイムアウト等）は分かりにくい生メッセージを出さず、時間をおいて再試行を促す
  const isAbort = e && (e.name === 'AbortError' || /abort/i.test(e.message || ''));
  const msg = e
    ? (isAbort ? '検索がタイムアウトしました。通信環境を確認して再度お試しください' : '検索に失敗しました: ' + e.message)
    : '経路が見つかりませんでした' + (_trType === 'last' ? '（この日の運行が終了している可能性があります）' : '');
  _trStatus(msg, true);
  document.getElementById('transit-results-card').style.display = 'none';
}

// ── 運行情報の確認・路線除外（迂回） ──
function _trRenderLinePanel(journeys) {
  const lines = [];
  journeys.forEach(j => j.legs.forEach(l => {
    if (l.kind === 'transit' && !lines.includes(l.routeName)) lines.push(l.routeName);
  }));
  document.getElementById('transit-lines-list').innerHTML = lines.map(name =>
    `<div class="transit-line-row">
      <label><input type="checkbox" class="transit-line-cb" data-line="${_escHtml(name)}"${_trExclude.includes(name) ? ' checked' : ''}><span>${_esc(name)}</span></label>
      <a href="https://search.yahoo.co.jp/realtime/search?p=${encodeURIComponent(name)}" target="_blank" rel="noopener">運行情報 ↗</a>
    </div>`
  ).join('');
}

function searchTransitDetour() {
  _trExclude = Array.from(document.querySelectorAll('.transit-line-cb:checked')).map(cb => cb.dataset.line);
  if (!_trExclude.length) { _trStatus('除外する路線にチェックを入れてください', true); return; }
  searchTransit(true);
}

function toggleTransitLines() {
  const body = document.getElementById('transit-lines-body');
  const arrow = document.getElementById('transit-lines-arrow');
  const open = body.classList.toggle('open');
  arrow.classList.toggle('open', open);
}

async function _trFetchPlan(pr, vias, n, detour, signal, avoidModes, avoidWalk) {
  const p = new URLSearchParams({
    from: pr.from.id, to: pr.to.id,
    fromLabel: pr.from.name, toLabel: pr.to.name,
    type: _trType, numItineraries: String(n)
  });
  const d = document.getElementById('transit-date').value;
  if (d) p.set('date', d.replace(/-/g, ''));
  const t = document.getElementById('transit-time').value;
  if (t && _trType !== 'first' && _trType !== 'last') p.set('time', t);
  vias.forEach(v => { p.append('via', v.id); p.append('viaLabel', v.name); });
  // APIの乗換上限は既定3回で、目的駅まで電車で行くのに乗換が多く必要な経路が
  // 候補から漏れるため常に5へ緩める（乗換の多い経路はソートで自然と下位に沈む）
  p.set('maxTransfers', '5');
  if (avoidModes) p.set('avoidModes', avoidModes); // 例: bus（電車系のみの候補を得る）
  if (avoidWalk) p.set('avoidWalk', 'true'); // 徒歩区間を含む経路を除外（到着駅まで電車で行く経路を確実に拾う）
  const res = await fetch(TRANSIT_API + '/api/v1/plan?' + p.toString(), signal ? { signal } : undefined);
  const j = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = j && j.error ? (typeof j.error === 'string' ? j.error : j.error.message) : res.statusText;
    throw new Error(msg || '検索エラー');
  }
  return (j && j.journeys) || [];
}

// planをタイムアウト付きで実行（ハブ経由の追加検索が遅延・ハングしても
// 本線結果の表示や検索ボタンの復帰を巻き込まないようにする）
function _trPlanWithTimeout(t, detour, ms) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  return _trFetchPlan(t.pr, t.vias, t.n, detour, ac.signal, t.avoidModes, t.avoidWalk)
    .then(js => ({ t, js }))
    .catch(e => ({ t, err: e }))
    .finally(() => clearTimeout(timer));
}

// 先頭の同一駅構内の徒歩区間（乗降のためのホーム↔駅移動）を取り除き、出発時刻を
// 電車の発着基準にする。末尾の徒歩は目的地までの移動（改札→目的地や別駅への乗換
// 徒歩など）を表すため省略せず残し、到着時刻も徒歩終点基準にする。
function _trTrimJourney(j) {
  const intra = l => l.kind === 'walk' && _trNorm(l.from.name) === _trNorm(l.to.name);
  const legs = j.legs.slice();
  while (legs.length > 1 && intra(legs[0])) legs.shift();
  if (!legs.length || !legs.some(l => l.kind === 'transit')) return;
  j.legs = legs;
  j.departureSecs = legs[0].departureSecs;
  j.arrivalSecs = legs[legs.length - 1].arrivalSecs;
  j.durationSecs = j.arrivalSecs - j.departureSecs;
}

// ── 結果表示 ──
// バス区間を含む経路か（電車系より下位に並べるため）
function _trHasBus(j) {
  return j.legs.some(l => l.kind === 'transit' && l.mode === 'bus');
}

// 検索した到着駅にそのまま着く経路か（別駅からの徒歩連絡や近接駅扱いで終わる経路はfalse）
function _trArrivesAtDest(j) {
  if (!j._dest || !j.legs || !j.legs.length) return true; // 判定材料がない場合は通常扱い
  const last = j.legs[j.legs.length - 1];
  if (last.kind === 'walk' && _trNorm(last.from.name) !== _trNorm(last.to.name)) return false; // 別駅へ徒歩移動して終わる
  return last.to.id === j._dest.id || _trNorm(last.to.name) === _trNorm(j._dest.name);
}

function sortTransitResults(mode) {
  _trSort = mode;
  document.getElementById('transit-sort-time').classList.toggle('active', mode === 'time');
  document.getElementById('transit-sort-fare').classList.toggle('active', mode === 'fare');
  _trJourneys.sort((a, b) => {
    // 電車系（バスを含まない）経路を常に上位に。バス偏重の表示を防ぐ
    const ba = _trHasBus(a) ? 1 : 0, bb = _trHasBus(b) ? 1 : 0;
    if (ba !== bb) return ba - bb;
    if (mode === 'fare') {
      const fa = a.fare ? a.fare.ticket : Infinity, fb = b.fare ? b.fare.ticket : Infinity;
      if (fa !== fb) return fa - fb;
      return a.arrivalSecs - b.arrivalSecs;
    }
    if (a.arrivalSecs !== b.arrivalSecs) return a.arrivalSecs - b.arrivalSecs;
    return a.durationSecs - b.durationSecs;
  });
  renderTransitResults();
}

// サービス日0時からの秒数 → 表示用時刻（86400超は「翌」、負値は「前日」を付ける）
function _trFmtTime(secs) {
  const total = Math.round(secs);
  const dayOffset = Math.floor(total / 86400);
  const s = ((total % 86400) + 86400) % 86400;
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const prefix = dayOffset === 1 ? '翌' : dayOffset === -1 ? '前日' : dayOffset > 1 ? dayOffset + '日後' : '';
  return prefix + hh + ':' + mm;
}

function _trFmtDur(secs) {
  const mins = Math.max(1, Math.round(secs / 60));
  return mins >= 60 ? `${Math.floor(mins / 60)}時間${mins % 60}分` : `${mins}分`;
}

function _trRenderLeg(leg, isFirst, isLast) {
  if (leg.kind === 'walk') {
    const dur = _trFmtDur(leg.arrivalSecs - leg.departureSecs);
    // 別駅名をまたぐ徒歩（例: 北朝霞→朝霞台）は電車区間と同じ●出発/到着の表示にする
    if (_trNorm(leg.from.name) !== _trNorm(leg.to.name)) {
      return `<div class="transit-leg">
    <div class="transit-leg-st">● ${_trFmtTime(leg.departureSecs)} ${_esc(leg.from.name)}</div>
    <div class="transit-leg-line">🚶 徒歩（${dur}）</div>
    <div class="transit-leg-st">● ${_trFmtTime(leg.arrivalSecs)} ${_esc(leg.to.name)}</div>
  </div>`;
    }
    // 経路の先頭/末尾が徒歩の場合、出発地/到着地を●付きで明示する（到着駅・時刻が
    // 隣の電車区間に現れず分かりづらくなるのを防ぐ）
    const head = isFirst ? `<div class="transit-leg-st">● ${_trFmtTime(leg.departureSecs)} ${_esc(leg.from.name)}</div>` : '';
    const tail = isLast ? `<div class="transit-leg-st">● ${_trFmtTime(leg.arrivalSecs)} ${_esc(leg.to.name)} 着</div>` : '';
    return `${head}<div class="transit-leg-walk">┊ 徒歩 ${dur}</div>${tail}`;
  }
  const color = leg.color ? (leg.color.charAt(0) === '#' ? leg.color : '#' + leg.color) : '';
  const pf = st => st.platformCode ? `〔${_esc(st.platformCode)}番線〕` : '';
  return `<div class="transit-leg"${color ? ` style="border-left-color:${_escHtml(color)}"` : ''}>
    <div class="transit-leg-st">● ${_trFmtTime(leg.departureSecs)} ${_esc(leg.from.name)}${pf(leg.from)}</div>
    <div class="transit-leg-line">${leg.headwayBased ? '約 ' : ''}${_esc(leg.routeName)}${leg.headsign ? '・' + _esc(leg.headsign) + '方面' : ''}</div>
    <div class="transit-leg-st">● ${_trFmtTime(leg.arrivalSecs)} ${_esc(leg.to.name)}${pf(leg.to)}</div>
  </div>`;
}

function renderTransitResults() {
  // _trJourneys[i] を参照するハンドラと整合させるため、先頭からの連番indexで表示
  document.getElementById('transit-results').innerHTML = _trJourneys.slice(0, TRANSIT_MAX_RESULTS).map((j, i) => {
    const fare = j.fare
      ? '¥' + j.fare.ticket.toLocaleString() + (j.fare.ic !== undefined ? `（IC ¥${j.fare.ic.toLocaleString()}）` : '')
      : '運賃不明';
    const myst = j._myst ? '・' + _esc(j._myst) : '';
    return `<div class="transit-route-card">
      <button type="button" class="transit-route-head" onclick="toggleTransitRoute(${i})">
        <span class="transit-route-time">${_trFmtTime(j.departureSecs)} → ${_trFmtTime(j.arrivalSecs)}（${_trFmtDur(j.durationSecs)}）</span>
        <span class="transit-route-meta">${_trIsDetour ? '<span class="transit-detour-badge">迂回路</span>' : ''}${fare}・乗換${j.transferCount}回${myst}</span>
      </button>
      <div class="transit-route-body${i === 0 ? ' open' : ''}" id="transit-route-body-${i}">
        ${j.legs.map((leg, k) => _trRenderLeg(leg, k === 0, k === j.legs.length - 1)).join('')}
        ${_trDestWalkName(j) ? `<div class="transit-leg">
    <div class="transit-leg-st">● ${_trFmtTime(j.legs[j.legs.length - 1].arrivalSecs)} ${_esc(j.legs[j.legs.length - 1].to.name)}</div>
    <div class="transit-leg-line">🚶 徒歩連絡（所要時間は経路データに含まれません）</div>
    <div class="transit-leg-st">● ${_esc(_trDestWalkName(j))}（目的地）</div>
  </div>` : ''}
        ${!j.fare ? `<div class="transit-note" id="transit-pf-${i}" style="margin:6px 0 0">${j._pf || `<button type="button" class="admin-btn sm" onclick="calcPartialFare(${i})">区間ごとの運賃を算出</button>`}</div>` : ''}
        <button type="button" class="admin-btn sm" style="margin-top:8px" onclick="copyTransitRoute(${i})">テキストをコピー</button>
        <button type="button" class="admin-btn sm" style="margin-top:8px" onclick="shareTransitRoute(${i})">画像で共有</button>
      </div>
    </div>`;
  }).join('');
}

function _trSecsToHHMM(secs) {
  const s = ((Math.round(secs) % 86400) + 86400) % 86400;
  return String(Math.floor(s / 3600)).padStart(2, '0') + ':' + String(Math.floor((s % 3600) / 60)).padStart(2, '0');
}

// 運賃不明ルートの区間ごと運賃を、乗車区間単位の再検索で参考値として算出
const _trStIdCache = {};

// 駅名から駅単位のID（親駅）を引く。legのIDはホーム単位で/planに使えないことがあるための救済
async function _trResolveStationId(name) {
  if (name in _trStIdCache) return _trStIdCache[name];
  try {
    const res = await fetch(`${TRANSIT_API}/api/v1/locations/suggest?q=${encodeURIComponent(name)}&limit=3`);
    const j = await res.json();
    const sts = j.stations || [];
    const st = sts.find(s => s.name === name) || sts[0];
    _trStIdCache[name] = st ? st.id : null;
  } catch (e) { _trStIdCache[name] = null; }
  return _trStIdCache[name];
}

// routeNameを指定すると、複数候補の中から元のルートと同じ路線を使う候補を優先して採用する
// （再検索の第1候補が元ルートと別の路線になり、共通区間なのに不明/不一致になるのを防ぐ）
async function _trLegFare(from, to, date, time, routeName) {
  try {
    const p = new URLSearchParams({ from, to, type: 'departure', numItineraries: '3' });
    if (date) p.set('date', date);
    p.set('time', time);
    const res = await fetch(TRANSIT_API + '/api/v1/plan?' + p.toString());
    const json = await res.json();
    const journeys = (res.ok && json.journeys) || [];
    if (!journeys.length) return null;
    const sameRoute = routeName && journeys.find(jr => jr.legs.some(l => l.kind === 'transit' && l.routeName === routeName));
    const pick = sameRoute || journeys.find(jr => jr.fare) || journeys[0];
    return pick.fare ? pick.fare.ticket : null;
  } catch (e) { return null; }
}

async function calcPartialFare(i) {
  const j = _trJourneys[i];
  const el = document.getElementById('transit-pf-' + i);
  if (!j || !el) return;
  el.textContent = '算出中...';
  const legs = j.legs.filter(l => l.kind === 'transit');
  const d = document.getElementById('transit-date').value.replace(/-/g, '');
  const rows = await Promise.all(legs.map(async leg => {
    const time = _trSecsToHHMM(leg.departureSecs);
    let fare = await _trLegFare(leg.from.id, leg.to.id, d, time, leg.routeName);
    if (fare == null) {
      // ホーム単位IDで検索できない場合は駅名から駅IDを引き直して再試行
      const [fid, tid] = await Promise.all([_trResolveStationId(leg.from.name), _trResolveStationId(leg.to.name)]);
      if (fid && tid && fid !== tid) fare = await _trLegFare(fid, tid, d, time, leg.routeName);
    }
    return { leg, fare };
  }));
  const known = rows.filter(r => r.fare != null);
  const total = known.reduce((s, r) => s + r.fare, 0);
  j._pf = rows.map(r =>
    `${_esc(r.leg.from.name)}→${_esc(r.leg.to.name)} ${r.fare != null ? '¥' + r.fare.toLocaleString() : '不明'}`
  ).join('<br>') + (known.length
    ? `<br>判明分合計: ¥${total.toLocaleString()}（参考値・実際の通し運賃と異なる場合があります）`
    : '<br>運賃情報は取得できませんでした');
  el.innerHTML = j._pf;
}

function toggleTransitRoute(i) {
  document.getElementById('transit-route-body-' + i).classList.toggle('open');
}

function copyTransitRoute(i) {
  const j = _trJourneys[i];
  if (!j || !j.legs.length) return;
  const from = j.legs[0].from.name;
  const to = j.legs[j.legs.length - 1].to.name;
  const dw = _trDestWalkName(j);
  const fare = j.fare ? '・¥' + j.fare.ticket.toLocaleString() : '';
  const text = `${from} ${_trFmtTime(j.departureSecs)} → ${to} ${_trFmtTime(j.arrivalSecs)}${dw ? `（徒歩連絡→${dw}）` : ''}（${_trFmtDur(j.durationSecs)}${fare}・乗換${j.transferCount}回）`;
  navigator.clipboard.writeText(text).catch(() => {});
}

// ── 経路を画像で共有 ──
// iOS Safari対策：canvas.toBlob()（非同期）を挟むとタップのユーザー操作起点（transient user
// activation）が失われ navigator.share() が拒否されるため、画像生成からshare()呼び出しまで
// すべて同期処理で行う（awaitを一切挟まない）。
function shareTransitRoute(i) {
  const j = _trJourneys[i];
  if (!j || !j.legs.length) return;

  const btn = document.querySelector(`#transit-route-body-${i} button[onclick="shareTransitRoute(${i})"]`);
  const origText = btn ? btn.textContent : '';

  try {
    const dateStr = document.getElementById('transit-date').value || '';
    const fromName = j.legs[0].from.name;
    const toName = j.legs[j.legs.length - 1].to.name;

    // 同期APIでCanvas→PNG画像データを生成
    const canvas = _trBuildRouteCanvas(j, dateStr);
    const dataUrl = canvas.toDataURL('image/png');

    // dataURLをその場で同期的にバイナリ(Blob)へ変換
    const bin = atob(dataUrl.split(',')[1]);
    const bytes = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
    const blob = new Blob([bytes], { type: 'image/png' });

    // ファイル名に使えない文字（パス区切り・記号等）を除去
    const safe = s => (s || '').replace(/[\\/:*?"<>|]/g, '');
    const fileName = `transit_${safe(fromName)}_${safe(toName)}.png`;
    const file = new File([blob], fileName, { type: 'image/png' });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      // ここまでawaitを挟まず、クリックのユーザー操作起点を保ったままshare()を呼ぶ
      if (btn) btn.disabled = true;
      navigator.share({ files: [file] })
        .catch(e => {
          if (e.name !== 'AbortError') alert('共有に失敗しました: ' + e.message);
        })
        .finally(() => { if (btn) { btn.disabled = false; btn.textContent = origText; } });
    } else {
      // ファイル共有不可の場合はダウンロードにフォールバック
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = fileName;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  } catch (e) {
    if (e.name !== 'AbortError') alert('共有に失敗しました: ' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = origText; }
  }
}

// 経路journeyをCanvasに描画して返す（高DPI対応のため内部解像度は2倍で描画）
function _trBuildRouteCanvas(j, dateStr) {
  const W = 1080, dpr = 2, PAD = 40;
  const TRANSIT_LEG_H = 116, WALK_LEG_H = 28, LEG_GAP = 10, EXTRA_BULLET_H = 26;
  // 別駅名をまたぐ徒歩（例: 北朝霞→朝霞台）は電車区間と同じ高さで表示する
  const isCrossWalk = leg => leg.kind === 'walk' && _trNorm(leg.from.name) !== _trNorm(leg.to.name);
  // 先頭/末尾が徒歩の区間（同一駅名のみ）は出発地/到着地の●行を足すぶん高さを加算する
  const walkExtra = (leg, k) => (leg.kind === 'walk' && !isCrossWalk(leg))
    ? ((k === 0 ? 1 : 0) + (k === j.legs.length - 1 ? 1 : 0)) * EXTRA_BULLET_H : 0;
  const destWalk = _trDestWalkName(j); // 到着駅が目的地と別なら連絡徒歩行を1行足す
  const legsH = j.legs.reduce((s, leg, k) =>
    s + (leg.kind === 'walk' ? (isCrossWalk(leg) ? TRANSIT_LEG_H : WALK_LEG_H) : TRANSIT_LEG_H) + walkExtra(leg, k) + LEG_GAP, 0)
    + (destWalk ? TRANSIT_LEG_H + LEG_GAP : 0);

  const headerH = 76;      // アプリ名＋日付
  const bigRouteH = 76;    // 出発駅 → 到着駅
  const metaH = 92;        // 時刻・所要時間／運賃・乗換
  const timelineTopGap = 24;
  const footerH = 56;
  const H = PAD + headerH + bigRouteH + metaH + timelineTopGap + legsH + footerH + PAD;

  const canvas = document.createElement('canvas');
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  // 背景（散歩ログ共有画像と同系統のダークテーマ）
  ctx.fillStyle = '#1a1b1e';
  ctx.fillRect(0, 0, W, H);

  let y = PAD;

  // ── ヘッダ：アプリ名（アクセントカラー）＋検索日付 ──
  ctx.textBaseline = 'alphabetic';
  ctx.font = "bold 22px 'Noto Sans JP', sans-serif";
  ctx.fillStyle = '#00E5FF';
  ctx.fillText('シャリオ 乗換案内', PAD, y + 24);
  if (dateStr) {
    ctx.font = "16px 'Noto Sans JP', sans-serif";
    ctx.fillStyle = '#a0a0a0';
    const w = ctx.measureText(dateStr).width;
    ctx.fillText(dateStr, W - PAD - w, y + 22);
  }
  y += headerH;

  // ── 出発駅 → 到着駅（大きく） ──
  const fromName = j.legs[0].from.name;
  const toName = j.legs[j.legs.length - 1].to.name;
  const routeText = `${fromName} → ${toName}`;
  let bigSize = 40;
  ctx.font = `bold ${bigSize}px 'Noto Sans JP', sans-serif`;
  while (ctx.measureText(routeText).width > W - PAD * 2 && bigSize > 20) {
    bigSize -= 2;
    ctx.font = `bold ${bigSize}px 'Noto Sans JP', sans-serif`;
  }
  ctx.fillStyle = '#e8e6e3';
  ctx.fillText(routeText, PAD, y + bigSize);
  y += bigRouteH;

  // ── 出発〜到着時刻・所要時間／運賃・乗換回数 ──
  ctx.font = "bold 24px 'Noto Sans JP', sans-serif";
  ctx.fillStyle = '#e8e6e3';
  ctx.fillText(
    `${_trFmtTime(j.departureSecs)} → ${_trFmtTime(j.arrivalSecs)}（${_trFmtDur(j.durationSecs)}）`,
    PAD, y + 24
  );
  const fareText = j.fare
    ? '¥' + j.fare.ticket.toLocaleString() + (j.fare.ic !== undefined ? `（IC ¥${j.fare.ic.toLocaleString()}）` : '')
    : '運賃不明';
  ctx.font = "16px 'Noto Sans JP', sans-serif";
  ctx.fillStyle = '#a0a0a0';
  ctx.fillText(`${fareText}・乗換${j.transferCount}回`, PAD, y + 54);
  y += metaH;

  // 区切り線
  ctx.strokeStyle = '#333333'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(W - PAD, y); ctx.stroke();
  y += timelineTopGap;

  // ── 本体：縦タイムライン ──
  const barX = PAD;
  const textX = PAD + 20;
  j.legs.forEach((leg, k) => {
    if (leg.kind === 'walk') {
      const dur = _trFmtDur(leg.arrivalSecs - leg.departureSecs);
      const isFirst = k === 0, isLast = k === j.legs.length - 1;

      if (_trNorm(leg.from.name) !== _trNorm(leg.to.name)) {
        // 別駅へ移動する徒歩は電車区間と同じ表示（発着●＋所要時間）にする
        ctx.strokeStyle = '#666666'; ctx.lineWidth = 6;
        ctx.setLineDash([4, 6]);
        ctx.beginPath(); ctx.moveTo(barX + 3, y + 4); ctx.lineTo(barX + 3, y + TRANSIT_LEG_H - 12); ctx.stroke();
        ctx.setLineDash([]); ctx.lineWidth = 1;
        ctx.font = "bold 18px 'Noto Sans JP', sans-serif";
        ctx.fillStyle = '#e8e6e3';
        ctx.fillText(`● ${_trFmtTime(leg.departureSecs)} ${leg.from.name}`, textX, y + 22);
        ctx.font = "14px 'Noto Sans JP', sans-serif";
        ctx.fillStyle = '#a0a0a0';
        ctx.fillText(`🚶 徒歩（${dur}）`, textX, y + 48);
        ctx.font = "bold 18px 'Noto Sans JP', sans-serif";
        ctx.fillStyle = '#e8e6e3';
        ctx.fillText(`● ${_trFmtTime(leg.arrivalSecs)} ${leg.to.name}`, textX, y + 76);
        y += TRANSIT_LEG_H + LEG_GAP;
        return;
      }

      // 経路の先頭/末尾が徒歩の場合、出発地/到着地を●付きで明示する
      if (isFirst) {
        ctx.font = "bold 18px 'Noto Sans JP', sans-serif"; ctx.fillStyle = '#e8e6e3';
        ctx.fillText(`● ${_trFmtTime(leg.departureSecs)} ${leg.from.name}`, textX, y + 20);
        y += EXTRA_BULLET_H;
      }
      // 徒歩は1行の小さい注記なのでWALK_LEG_H(=28)の縦中央に破線バーとテキストを収める
      ctx.strokeStyle = '#666666'; ctx.lineWidth = 2;
      ctx.setLineDash([2, 4]);
      ctx.beginPath(); ctx.moveTo(barX + 3, y + 4); ctx.lineTo(barX + 3, y + WALK_LEG_H - 4); ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = "14px 'Noto Sans JP', sans-serif";
      ctx.fillStyle = '#a0a0a0';
      ctx.fillText(`┊ 徒歩 ${dur}`, textX, y + WALK_LEG_H / 2 + 5);
      y += WALK_LEG_H;
      if (isLast) {
        ctx.font = "bold 18px 'Noto Sans JP', sans-serif"; ctx.fillStyle = '#e8e6e3';
        ctx.fillText(`● ${_trFmtTime(leg.arrivalSecs)} ${leg.to.name} 着`, textX, y + 20);
        y += EXTRA_BULLET_H;
      }
      y += LEG_GAP;
      return;
    }

    // colorが無い場合は暗背景でも視認できるグレーをデフォルトに
    const color = leg.color ? (leg.color.charAt(0) === '#' ? leg.color : '#' + leg.color) : '#888888';
    ctx.fillStyle = color;
    ctx.fillRect(barX, y + 4, 6, TRANSIT_LEG_H - 16);

    const pf = st => st.platformCode ? `〔${st.platformCode}番線〕` : '';

    ctx.font = "bold 18px 'Noto Sans JP', sans-serif";
    ctx.fillStyle = '#e8e6e3';
    ctx.fillText(
      `● ${_trFmtTime(leg.departureSecs)} ${leg.from.name}${pf(leg.from)}`,
      textX, y + 22
    );

    ctx.font = "14px 'Noto Sans JP', sans-serif";
    ctx.fillStyle = '#a0a0a0';
    ctx.fillText(
      `${leg.headwayBased ? '約 ' : ''}${leg.routeName}${leg.headsign ? '・' + leg.headsign + '方面' : ''}`,
      textX, y + 48
    );

    ctx.font = "bold 18px 'Noto Sans JP', sans-serif";
    ctx.fillStyle = '#e8e6e3';
    ctx.fillText(
      `● ${_trFmtTime(leg.arrivalSecs)} ${leg.to.name}${pf(leg.to)}`,
      textX, y + 76
    );

    y += TRANSIT_LEG_H + LEG_GAP;
  });

  // 到着駅が目的地と別なら、目的地への徒歩連絡を電車区間と同じ表示で補って示す
  if (destWalk) {
    const lastTo = j.legs[j.legs.length - 1];
    ctx.strokeStyle = '#666666'; ctx.lineWidth = 6;
    ctx.setLineDash([4, 6]);
    ctx.beginPath(); ctx.moveTo(barX + 3, y + 4); ctx.lineTo(barX + 3, y + TRANSIT_LEG_H - 12); ctx.stroke();
    ctx.setLineDash([]); ctx.lineWidth = 1;
    ctx.font = "bold 18px 'Noto Sans JP', sans-serif";
    ctx.fillStyle = '#e8e6e3';
    ctx.fillText(`● ${_trFmtTime(lastTo.arrivalSecs)} ${lastTo.to.name}`, textX, y + 22);
    ctx.font = "14px 'Noto Sans JP', sans-serif";
    ctx.fillStyle = '#a0a0a0';
    ctx.fillText(`🚶 徒歩連絡`, textX, y + 48);
    ctx.font = "bold 18px 'Noto Sans JP', sans-serif";
    ctx.fillStyle = '#e8e6e3';
    ctx.fillText(`● ${destWalk}（目的地）`, textX, y + 76);
    y += TRANSIT_LEG_H + LEG_GAP;
  }

  y += footerH - 24;

  // ── 出典表記 ──
  ctx.font = "12px 'Noto Sans JP', sans-serif";
  ctx.fillStyle = '#666666';
  ctx.fillText('経路・時刻データ: api.transit.ls8h.com', PAD, y);

  return canvas;
}

// ── 検索履歴（乗換案内のみ） ──
function _trSaveHistory(from, to) {
  let h = [];
  try { h = JSON.parse(localStorage.getItem(TRANSIT_LS_HISTORY)) || []; } catch (e) {}
  h = h.filter(x => !(x.from.id === from.id && x.to.id === to.id));
  h.unshift({ from, to });
  localStorage.setItem(TRANSIT_LS_HISTORY, JSON.stringify(h.slice(0, 5)));
  _trRenderHistory();
}

function _trRenderHistory() {
  const el = document.getElementById('transit-history');
  if (_trMode !== 'free') { el.innerHTML = ''; return; }
  let h = [];
  try { h = JSON.parse(localStorage.getItem(TRANSIT_LS_HISTORY)) || []; } catch (e) {}
  el._h = h;
  el.innerHTML = h.map((x, i) =>
    `<button type="button" class="transit-chip" onclick="applyTransitHistory(${i})">${_esc(x.from.name)} → ${_esc(x.to.name)}</button>`
  ).join('');
}

function applyTransitHistory(i) {
  const h = document.getElementById('transit-history')._h;
  const x = h && h[i];
  if (!x) return;
  _trSel.from = x.from;
  _trSel.to = x.to;
  document.getElementById('transit-from').value = x.from.name;
  document.getElementById('transit-to').value = x.to.name;
}
