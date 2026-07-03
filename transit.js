// ── 乗換案内機能（api.transit.ls8h.com） ──
// 時刻はサービス日0時からの秒数（86400超＝翌日、負値＝前日サービス）で返るため表示時に変換する。
// 最寄り駅はログイン時は /users/{uid}.transitStations、非ログイン時はlocalStorageに保存。

const TRANSIT_API = 'https://api.transit.ls8h.com';
const TRANSIT_LS_STATIONS = 'transit_my_stations';
const TRANSIT_LS_ENABLED = 'transit_my_enabled';
const TRANSIT_LS_HISTORY = 'transit_history';

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
const _trTimer = {};
const _trAbort = {};

// ── 初期化 ──
function initTransit() {
  _trReady = _trLoadMyStations().then(() => {
    _trUpdateMenu();
    if (_trView === 'settings') _trRenderSettings();
    if (_trMode !== 'free' && _trView !== 'menu') _trRenderMyToggles();
  });
  if (_trInited) return;
  _trInited = true;
  ['from', 'to', 'via1', 'via2', 'via3'].forEach(k => _trBindSuggest(k));
  _trBindSuggest('st-add', st => {
    addTransitMyStation(st);
    document.getElementById('transit-st-add').value = '';
  });
  const now = new Date();
  document.getElementById('transit-date').value = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' });
  document.getElementById('transit-time').value = now.toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false });
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
  // places/suggestを使うと所在地（description）が取れる。駅・停留所のみに絞る
  const res = await fetch(`${TRANSIT_API}/api/v1/places/suggest?q=${encodeURIComponent(q)}&limit=12`, { signal });
  if (!res.ok) return [];
  const j = await res.json();
  // フィード横断で同じ駅が別IDで重複するため、同名かつ近距離（約500m）の候補は
  // スコア最上位の1件（レスポンス順）に統合する
  const out = [];
  (j.places || []).forEach(p => {
    if (p.kind !== 'station' && p.kind !== 'stop') return;
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
        box.innerHTML = sts.length
          ? sts.map((st, i) => `<div class="transit-suggest-item" data-i="${i}">${_esc(st.name)}<span class="transit-suggest-kana" id="${box.id}-loc-${i}">${_esc(st.nameKana || '')}</span></div>`).join('')
          : '<div class="transit-suggest-item" style="cursor:default;color:var(--dim)">該当する駅がありません</div>';
        box.classList.add('open');
        // 所在地（都道府県 市区町村）を非同期で埋める。再描画済みなら書き込まない
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
    else { _trSel[key] = { id: st.id, name: st.name }; input.value = st.name; }
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

  btn.disabled = true;
  _trStatus('検索中...');
  const n = detour ? 6 : (_trMode === 'free' ? 4 : 3);
  const results = await Promise.all(pairs.map(pr =>
    _trFetchPlan(pr, vias, n, detour).then(js => ({ pr, js })).catch(e => ({ pr, err: e }))
  ));
  btn.disabled = false;

  const all = [];
  results.forEach(r => {
    if (r.js) r.js.forEach(j => { _trTrimJourney(j); j._myst = r.pr.myst || ''; all.push(j); });
  });
  const failed = results.filter(r => r.err);

  if (!all.length) {
    const msg = failed.length
      ? '検索に失敗しました: ' + failed[0].err.message
      : '経路が見つかりませんでした' + (_trType === 'last' ? '（この日の運行が終了している可能性があります）' : '');
    _trStatus(msg, true);
    document.getElementById('transit-results-card').style.display = 'none';
    return;
  }
  _trStatus(failed.length ? '一部の検索に失敗しました' : '');
  if (_trMode === 'free' && !detour) _trSaveHistory(_trSel.from, _trSel.to);

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

async function _trFetchPlan(pr, vias, n, detour) {
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
  if (detour) p.set('maxTransfers', '5'); // 迂回時は乗換回数を緩めて候補を広げる
  const res = await fetch(TRANSIT_API + '/api/v1/plan?' + p.toString());
  const j = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = j && j.error ? (typeof j.error === 'string' ? j.error : j.error.message) : res.statusText;
    throw new Error(msg || '検索エラー');
  }
  return (j && j.journeys) || [];
}

// 先頭・末尾の同一駅構内の徒歩区間（乗降のためのホーム↔駅移動）を表示から取り除き、
// 発着時刻を電車の発着基準にする（一般的な乗換案内アプリの表示に合わせる）
function _trTrimJourney(j) {
  const intra = l => l.kind === 'walk' && l.from.name === l.to.name;
  const legs = j.legs.slice();
  while (legs.length > 1 && intra(legs[0])) legs.shift();
  while (legs.length > 1 && intra(legs[legs.length - 1])) legs.pop();
  if (!legs.length || !legs.some(l => l.kind === 'transit')) return;
  j.legs = legs;
  j.departureSecs = legs[0].departureSecs;
  j.arrivalSecs = legs[legs.length - 1].arrivalSecs;
  j.durationSecs = j.arrivalSecs - j.departureSecs;
}

// ── 結果表示 ──
function sortTransitResults(mode) {
  _trSort = mode;
  document.getElementById('transit-sort-time').classList.toggle('active', mode === 'time');
  document.getElementById('transit-sort-fare').classList.toggle('active', mode === 'fare');
  _trJourneys.sort((a, b) => {
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

function _trRenderLeg(leg) {
  if (leg.kind === 'walk') {
    return `<div class="transit-leg-walk">┊ 徒歩 ${_trFmtDur(leg.arrivalSecs - leg.departureSecs)}</div>`;
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
  document.getElementById('transit-results').innerHTML = _trJourneys.map((j, i) => {
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
        ${j.legs.map(_trRenderLeg).join('')}
        ${!j.fare ? `<div class="transit-note" id="transit-pf-${i}" style="margin:6px 0 0">${j._pf || `<button type="button" class="admin-btn sm" onclick="calcPartialFare(${i})">区間ごとの運賃を算出</button>`}</div>` : ''}
        <button type="button" class="admin-btn sm" style="margin-top:8px" onclick="copyTransitRoute(${i})">テキストをコピー</button>
      </div>
    </div>`;
  }).join('');
}

function _trSecsToHHMM(secs) {
  const s = ((Math.round(secs) % 86400) + 86400) % 86400;
  return String(Math.floor(s / 3600)).padStart(2, '0') + ':' + String(Math.floor((s % 3600) / 60)).padStart(2, '0');
}

// 運賃不明ルートの区間ごと運賃を、乗車区間単位の再検索で参考値として算出
async function calcPartialFare(i) {
  const j = _trJourneys[i];
  const el = document.getElementById('transit-pf-' + i);
  if (!j || !el) return;
  el.textContent = '算出中...';
  const legs = j.legs.filter(l => l.kind === 'transit');
  const d = document.getElementById('transit-date').value.replace(/-/g, '');
  const rows = await Promise.all(legs.map(async leg => {
    try {
      const p = new URLSearchParams({ from: leg.from.id, to: leg.to.id, type: 'departure', numItineraries: '1' });
      if (d) p.set('date', d);
      p.set('time', _trSecsToHHMM(leg.departureSecs));
      const res = await fetch(TRANSIT_API + '/api/v1/plan?' + p.toString());
      const json = await res.json();
      const fare = res.ok && json.journeys && json.journeys[0] && json.journeys[0].fare;
      return { leg, fare: fare ? fare.ticket : null };
    } catch (e) { return { leg, fare: null }; }
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
  const fare = j.fare ? '・¥' + j.fare.ticket.toLocaleString() : '';
  const text = `${from} ${_trFmtTime(j.departureSecs)} → ${to} ${_trFmtTime(j.arrivalSecs)}（${_trFmtDur(j.durationSecs)}${fare}・乗換${j.transferCount}回）`;
  navigator.clipboard.writeText(text).catch(() => {});
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
