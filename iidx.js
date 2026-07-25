// ── 弐寺☆12ランプ表（管理者・マネージャー限定）──
// IIDX SP☆12 の地力表をもとに、各曲のクリアランプを記録するチェックリスト。
// 曲表: Firestore iidx_config/table があればそれを使用、無ければ iidx-data.js の
// IIDX_SEED_TABLE を表示。「表を更新」で wiki のコピペから表を取り込める。
// ランプ: Firestore iidx_lamps/{uid} に自分のランプを保存（曲名がキー）。
// 表示ガードは UI のみで、書き込み権限は firestore.rules 側でも admin/manager に制限。

const IIDX_LAMP_LEVELS = [
  { code: 'noplay', label: 'NO PLAY' },
  { code: 'failed', label: 'FAILED' },
  { code: 'assist', label: 'ASSIST CLEAR' },
  { code: 'easy',   label: 'EASY CLEAR' },
  { code: 'clear',  label: 'CLEAR' },
  { code: 'hard',   label: 'HARD CLEAR' },
  { code: 'exhard', label: 'EX HARD CLEAR' },
  { code: 'fc',     label: 'FULL COMBO' },
];
const IIDX_LAMP_ORDER = IIDX_LAMP_LEVELS.map(l => l.code);

let _iidxTable = null;       // [{tier, songs:[]}] 表示中の表
let _iidxTableMeta = null;   // Firestore 表の更新情報（null=シード表示中）
let _iidxLamps = {};         // { 曲名: lampCode }
let _iidxLoaded = false;     // 自分のランプ読み込み済みか
let _iidxSearch = '';
let _iidxLampFilter = 'all';
let _iidxSaveTimer = null;

function _iidxSetGuard(msg, cls) {
  const el = document.getElementById('iidx-guard');
  if (!el) return;
  el.textContent = msg || '';
  el.className = 'admin-status' + (cls ? ' ' + cls : '');
}

async function initIidx() {
  const body = document.getElementById('iidx-body');
  if (!_currentUser || !(_isAdmin || _isManager)) {
    if (body) body.style.display = 'none';
    // ログイン確定前は空表示、確定後に案内を出す（xarchive と同じ方式）
    if (typeof _authResolved !== 'undefined' && _authResolved) {
      _iidxSetGuard(_currentUser ? 'このページは管理者・マネージャー専用です。' : 'このページの利用にはログインが必要です。', '');
    } else {
      _iidxSetGuard('', '');
    }
    return;
  }
  if (body) body.style.display = '';
  _iidxSetGuard('', '');
  if (!_iidxLoaded) {
    _iidxSetGuard('読み込み中…', '');
    await Promise.all([_iidxLoadTable(), _iidxLoadLamps()]);
    _iidxLoaded = true;
    _iidxSetGuard('', '');
  }
  _iidxRender();
}

async function _iidxLoadTable() {
  _iidxTable = IIDX_SEED_TABLE;
  _iidxTableMeta = null;
  if (!_db) return;
  try {
    const doc = await _db.collection('iidx_config').doc('table').get();
    if (doc.exists && Array.isArray(doc.data().tiers) && doc.data().tiers.length) {
      _iidxTable = doc.data().tiers;
      _iidxTableMeta = { updatedAt: doc.data().updatedAt || null, updatedBy: doc.data().updatedBy || '' };
    }
  } catch (e) {
    console.warn('iidx table load failed', e);
  }
}

async function _iidxLoadLamps() {
  _iidxLamps = {};
  if (!_db || !_currentUser) return;
  try {
    const doc = await _db.collection('iidx_lamps').doc(_currentUser.uid).get();
    if (doc.exists && doc.data().lamps) _iidxLamps = doc.data().lamps;
  } catch (e) {
    console.warn('iidx lamps load failed', e);
  }
}

// ランプ保存はドキュメント丸ごと上書き。曲名に . を含むタイトルがあるため
// フィールドパス指定の部分更新（update('lamps.曲名')）は使えない。
function _iidxScheduleSave() {
  if (_iidxSaveTimer) clearTimeout(_iidxSaveTimer);
  _iidxSaveTimer = setTimeout(async () => {
    _iidxSaveTimer = null;
    if (!_db || !_currentUser) return;
    try {
      await _db.collection('iidx_lamps').doc(_currentUser.uid).set({
        lamps: _iidxLamps,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      _iidxSetGuard('', '');
    } catch (e) {
      _iidxSetGuard('保存に失敗しました: ' + (e.message || e), 'error');
    }
  }, 500);
}

function iidxSetLamp(title, code) {
  if (code === 'noplay') delete _iidxLamps[title];
  else _iidxLamps[title] = code;
  _iidxScheduleSave();
  // 行の色だけ差し替え（全再描画はフォーカスが飛ぶため避ける）
  const sel = document.querySelector(`.iidx-lamp-select[data-title="${CSS.escape(title)}"]`);
  if (sel) sel.className = 'iidx-lamp-select lamp-' + code;
  _iidxRenderSummary();
  _iidxUpdateTierCounts();
}

function iidxOnSearch(v) { _iidxSearch = (v || '').trim().toLowerCase(); _iidxRenderList(); }
function iidxOnFilter(v) { _iidxLampFilter = v; _iidxRenderList(); }

function _iidxLampIdx(title) {
  const code = _iidxLamps[title] || 'noplay';
  const i = IIDX_LAMP_ORDER.indexOf(code);
  return i < 0 ? 0 : i;
}

function _iidxRender() {
  _iidxRenderSummary();
  _iidxRenderMeta();
  _iidxRenderList();
}

function _iidxRenderSummary() {
  const el = document.getElementById('iidx-summary');
  if (!el || !_iidxTable) return;
  const counts = {};
  IIDX_LAMP_ORDER.forEach(c => counts[c] = 0);
  let total = 0;
  _iidxTable.forEach(t => (t.songs || []).forEach(s => { total++; counts[_iidxLamps[s] || 'noplay']++; }));
  el.innerHTML = IIDX_LAMP_LEVELS.map(l =>
    `<span class="iidx-sum-chip lamp-${l.code}">${l.label} <b>${counts[l.code]}</b></span>`
  ).join('') + `<span class="iidx-sum-chip iidx-sum-total">全 <b>${total}</b> 曲</span>`;
}

function _iidxRenderMeta() {
  const el = document.getElementById('iidx-table-meta');
  if (!el) return;
  if (_iidxTableMeta) {
    let when = '';
    try {
      if (_iidxTableMeta.updatedAt && _iidxTableMeta.updatedAt.toDate) {
        when = _iidxTableMeta.updatedAt.toDate().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
      }
    } catch (e) {}
    el.textContent = `曲表: 取込済み${when ? '（' + when + (_iidxTableMeta.updatedBy ? ' / ' + _iidxTableMeta.updatedBy : '') + '）' : ''}`;
  } else {
    el.textContent = '曲表: 初期データ（wiki最新版は「表を更新」から取込できます）';
  }
}

// フィルター後の該当曲だけ表示。ランプフィルターは「そのランプ未満のみ」
// (=更新対象を探す用途) と「そのランプのみ」を兼ねるため、below- 接頭辞で分岐。
function _iidxSongVisible(title) {
  if (_iidxSearch && title.toLowerCase().indexOf(_iidxSearch) < 0) return false;
  if (_iidxLampFilter === 'all') return true;
  if (_iidxLampFilter.indexOf('below-') === 0) {
    return _iidxLampIdx(title) < IIDX_LAMP_ORDER.indexOf(_iidxLampFilter.slice(6));
  }
  return (_iidxLamps[title] || 'noplay') === _iidxLampFilter;
}

function _iidxRenderList() {
  const wrap = document.getElementById('iidx-list');
  if (!wrap || !_iidxTable) return;
  const opts = IIDX_LAMP_LEVELS.map(l => `<option value="${l.code}">${l.label}</option>`).join('');
  let html = '';
  _iidxTable.forEach((t, ti) => {
    const songs = (t.songs || []).filter(_iidxSongVisible);
    if (!songs.length) return;
    html += `<div class="iidx-tier" data-tier-idx="${ti}">
      <div class="iidx-tier-head">${_esc(t.tier)} <span class="iidx-tier-count" data-tier-count="${ti}"></span></div>
      <div class="iidx-tier-songs">`;
    songs.forEach(title => {
      const code = _iidxLamps[title] || 'noplay';
      html += `<div class="iidx-song">
        <div class="iidx-song-title">${_esc(title)}</div>
        <select class="iidx-lamp-select lamp-${code}" data-title="${_escHtml(title)}"
          onchange="iidxSetLamp(this.dataset.title, this.value)">${opts}</select>
      </div>`;
    });
    html += '</div></div>';
  });
  wrap.innerHTML = html || '<div class="empty">該当する曲がありません</div>';
  // select の選択状態は innerHTML では設定できないため後から反映
  wrap.querySelectorAll('.iidx-lamp-select').forEach(sel => {
    sel.value = _iidxLamps[sel.dataset.title] || 'noplay';
  });
  _iidxUpdateTierCounts();
}

// ティア見出しの進捗（EASY以上でクリア扱い）
function _iidxUpdateTierCounts() {
  if (!_iidxTable) return;
  const easyIdx = IIDX_LAMP_ORDER.indexOf('easy');
  _iidxTable.forEach((t, ti) => {
    const el = document.querySelector(`[data-tier-count="${ti}"]`);
    if (!el) return;
    const songs = t.songs || [];
    const cleared = songs.filter(s => _iidxLampIdx(s) >= easyIdx).length;
    const hard = songs.filter(s => _iidxLampIdx(s) >= IIDX_LAMP_ORDER.indexOf('hard')).length;
    el.textContent = `クリア ${cleared}/${songs.length}・ハード ${hard}`;
  });
}

// ── リザルト画像読み取り（Gemini Vision） ──
// リザルトのスクショ/写真から {曲名, レベル, ランプ} を抽出し、地力表の曲と
// あいまい照合して確認リストを表示。本人が確認して「反映」した分だけ保存する。
// APIキーは admin_secrets/api_keys（AI議論と共用。managerにも読み取り許可あり）。
let _iidxOcrItems = []; // [{file, title, level, lamp, match, matchScore}]

function iidxToggleOcr() {
  const wrap = document.getElementById('iidx-ocr-wrap');
  if (wrap) wrap.style.display = wrap.style.display === 'none' ? '' : 'none';
}

function _iidxOcrStatus(msg, cls) {
  const el = document.getElementById('iidx-ocr-status');
  if (!el) return;
  el.textContent = msg || '';
  el.className = 'admin-status' + (cls ? ' ' + cls : '');
}

// AI議論(admin.js)のキー管理を再利用。未ロードなら admin_secrets から読み込む
async function _iidxEnsureGeminiKey() {
  if (typeof _hasGeminiKey !== 'function') return false;
  if (_hasGeminiKey()) return true;
  if (!_db) return false;
  try {
    const doc = await _db.collection('admin_secrets').doc('api_keys').get();
    if (doc.exists) _aiDiscApiKeys = { gemini: '', groq: '', geminiKeys: [], ...doc.data() };
  } catch (e) {
    console.warn('iidx api key load failed', e);
  }
  return _hasGeminiKey();
}

// 画像を縮小JPEGのbase64に変換（通信量・トークン節約。筐体写真の縦横比は維持）
function _iidxFileToJpegBase64(file, maxDim) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, (maxDim || 1600) / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.85).split(',')[1]);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('画像を読み込めません: ' + file.name)); };
    img.src = url;
  });
}

async function _iidxCallGeminiVision(b64) {
  const key = _nextGeminiKey();
  const prompt = 'これは beatmania IIDX のリザルト画面（スクリーンショットまたは筐体の写真）です。'
    + '画像から読み取れる各曲について、以下のJSON配列だけを返してください。説明文は不要です。\n'
    + '[{"title":"曲名(画面表記のまま)","level":難易度レベルの数字(不明ならnull),'
    + '"lamp":"noplay|failed|assist|easy|clear|hard|exhard|fc のいずれか(不明ならnull)"}]\n'
    + 'lampの判定: FAILED=failed, ASSIST CLEAR=assist, EASY CLEAR=easy, CLEAR=clear, '
    + 'HARD CLEAR=hard, EX HARD CLEAR=exhard, FULL COMBO=fc。'
    + 'リザルト画面でない・読み取れない場合は [] を返してください。';
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [
        { text: prompt },
        { inline_data: { mime_type: 'image/jpeg', data: b64 } },
      ] }],
      generationConfig: { responseMimeType: 'application/json' },
    })
  });
  if (!res.ok) await _throwApiError(res, 'Gemini');
  const data = await res.json();
  const text = (data?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : [];
}

// 曲名照合用の正規化（全角半角・大文字小文字・記号ゆれを吸収）
function _iidxNorm(s) {
  return String(s || '').normalize('NFKC').toLowerCase()
    .replace(/[†™☆★・\s"'"'``´〜~～\-−–—!！?？.。、,，:：;；]/g, '');
}

function _iidxAllSongs() {
  const out = [];
  (_iidxTable || []).forEach(t => (t.songs || []).forEach(s => out.push(s)));
  return out;
}

// bigram Dice係数によるあいまい一致（0〜1）
function _iidxSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const grams = s => { const m = {}; for (let i = 0; i < s.length - 1; i++) { const g = s.substr(i, 2); m[g] = (m[g] || 0) + 1; } return m; };
  const ga = grams(a), gb = grams(b);
  let hit = 0;
  for (const g in ga) if (gb[g]) hit += Math.min(ga[g], gb[g]);
  return 2 * hit / (a.length - 1 + b.length - 1);
}

function _iidxMatchSong(ocrTitle) {
  const n = _iidxNorm(ocrTitle);
  let best = null, bestScore = 0;
  _iidxAllSongs().forEach(song => {
    // 完全一致を最優先（†の有無だけが違う ANOTHER/LEGGENDARIA の別譜面を正規化で潰さない）
    if (song === ocrTitle) { best = song; bestScore = 1; return; }
    if (bestScore >= 1) return;
    const ns = _iidxNorm(song);
    let score = _iidxSimilarity(n, ns);
    // リザルト画面は長い曲名が省略されることがあるため部分一致も加点
    if (score < 0.9 && n.length >= 4 && (ns.indexOf(n) === 0 || n.indexOf(ns) === 0)) score = Math.max(score, 0.85);
    if (score > bestScore) { bestScore = score; best = song; }
  });
  return { song: best, score: bestScore };
}

async function iidxRunOcr() {
  const input = document.getElementById('iidx-ocr-files');
  const btn = document.getElementById('iidx-ocr-run-btn');
  if (!input || !input.files.length) { _iidxOcrStatus('画像を選択してください', 'error'); return; }
  if (!_db || !_currentUser || !(_isAdmin || _isManager)) return;
  if (btn) btn.disabled = true;
  _iidxOcrItems = [];
  try {
    if (!await _iidxEnsureGeminiKey()) {
      _iidxOcrStatus('Gemini APIキーが未設定です（管理者ページ「AI議論」で設定）', 'error');
      return;
    }
    const files = Array.from(input.files);
    for (let i = 0; i < files.length; i++) {
      _iidxOcrStatus(`読み取り中… (${i + 1}/${files.length})`, '');
      try {
        const b64 = await _iidxFileToJpegBase64(files[i]);
        const results = await _iidxCallGeminiVision(b64);
        results.forEach(r => {
          if (!r || !r.title) return;
          const m = _iidxMatchSong(r.title);
          _iidxOcrItems.push({
            fileName: files[i].name,
            title: String(r.title),
            level: (typeof r.level === 'number') ? r.level : null,
            lamp: IIDX_LAMP_ORDER.indexOf(r.lamp) >= 0 ? r.lamp : null,
            match: m.score >= 0.5 ? m.song : null,
            matchScore: m.score,
          });
        });
        if (!results.length) {
          _iidxOcrItems.push({ fileName: files[i].name, title: '', level: null, lamp: null, match: null, matchScore: 0, empty: true });
        }
      } catch (e) {
        _iidxOcrItems.push({ fileName: files[i].name, title: '', level: null, lamp: null, match: null, matchScore: 0, error: (e && e.message) || String(e) });
      }
    }
    _iidxRenderOcrResults();
    const ok = _iidxOcrItems.filter(it => it.match && it.lamp).length;
    _iidxOcrStatus(`読み取り完了: ${ok}件照合できました。内容を確認して「反映」を押してください。`, ok ? 'ok' : 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function _iidxRenderOcrResults() {
  const wrap = document.getElementById('iidx-ocr-results');
  if (!wrap) return;
  const songs = _iidxAllSongs();
  const songOpts = ['<option value="">（対象外・反映しない）</option>']
    .concat(songs.map(s => `<option value="${_escHtml(s)}">${_esc(s)}</option>`)).join('');
  const lampOpts = IIDX_LAMP_LEVELS.map(l => `<option value="${l.code}">${l.label}</option>`).join('');
  wrap.innerHTML = _iidxOcrItems.map((it, i) => {
    if (it.error) return `<div class="iidx-ocr-item"><div class="iidx-ocr-item-head">${_esc(it.fileName)}</div><div class="admin-status error">読み取り失敗: ${_esc(it.error)}</div></div>`;
    if (it.empty) return `<div class="iidx-ocr-item"><div class="iidx-ocr-item-head">${_esc(it.fileName)}</div><div class="admin-status">リザルトを検出できませんでした</div></div>`;
    const cur = it.match ? (_iidxLamps[it.match] || 'noplay') : 'noplay';
    const notes = [];
    if (it.level !== null && it.level !== 12) notes.push(`☆${it.level}のリザルトです`);
    if (it.match && it.lamp && IIDX_LAMP_ORDER.indexOf(it.lamp) < IIDX_LAMP_ORDER.indexOf(cur)) notes.push('現在のランプより低い読取結果です');
    if (it.match && it.matchScore < 0.75) notes.push('曲名の一致度が低いため要確認');
    // デフォルトON条件: 照合成功・ランプ検出・☆12(または不明)・ランプ向上
    const checked = it.match && it.lamp && (it.level === null || it.level === 12)
      && IIDX_LAMP_ORDER.indexOf(it.lamp) > IIDX_LAMP_ORDER.indexOf(cur);
    return `<div class="iidx-ocr-item">
      <div class="iidx-ocr-item-head">
        <label><input type="checkbox" data-ocr-apply="${i}" ${checked ? 'checked' : ''}> 反映</label>
        <span class="iidx-ocr-src">${_esc(it.fileName)} / 読取: ${_esc(it.title)}${it.level !== null ? ' ☆' + it.level : ''}</span>
      </div>
      <div class="iidx-ocr-item-body">
        <select class="iidx-ocr-song admin-select" data-ocr-song="${i}">${songOpts}</select>
        <select class="iidx-lamp-select lamp-${it.lamp || 'noplay'}" data-ocr-lamp="${i}"
          onchange="this.className='iidx-lamp-select lamp-'+this.value">${lampOpts}</select>
        <span class="iidx-ocr-cur">現在: ${_esc((IIDX_LAMP_LEVELS.find(l => l.code === cur) || {}).label || '')}</span>
      </div>
      ${notes.length ? `<div class="iidx-ocr-note">⚠ ${_esc(notes.join(' / '))}</div>` : ''}
    </div>`;
  }).join('');
  // select の初期値は innerHTML では設定できないため後から反映
  _iidxOcrItems.forEach((it, i) => {
    const songSel = wrap.querySelector(`[data-ocr-song="${i}"]`);
    if (songSel) songSel.value = it.match || '';
    const lampSel = wrap.querySelector(`[data-ocr-lamp="${i}"]`);
    if (lampSel) lampSel.value = it.lamp || 'noplay';
  });
  const applyBtn = document.getElementById('iidx-ocr-apply-btn');
  if (applyBtn) applyBtn.style.display = _iidxOcrItems.some(it => !it.error && !it.empty) ? '' : 'none';
}

function iidxApplyOcr() {
  const wrap = document.getElementById('iidx-ocr-results');
  if (!wrap) return;
  let applied = 0;
  _iidxOcrItems.forEach((it, i) => {
    const cb = wrap.querySelector(`[data-ocr-apply="${i}"]`);
    if (!cb || !cb.checked) return;
    const song = (wrap.querySelector(`[data-ocr-song="${i}"]`) || {}).value;
    const lamp = (wrap.querySelector(`[data-ocr-lamp="${i}"]`) || {}).value;
    if (!song || !lamp) return;
    iidxSetLamp(song, lamp);
    applied++;
  });
  if (applied) {
    _iidxOcrItems = [];
    wrap.innerHTML = '';
    const applyBtn = document.getElementById('iidx-ocr-apply-btn');
    if (applyBtn) applyBtn.style.display = 'none';
    const input = document.getElementById('iidx-ocr-files');
    if (input) input.value = '';
    _iidxOcrStatus(`${applied}件のランプを更新しました`, 'ok');
    _iidxRenderList();
  } else {
    _iidxOcrStatus('反映対象がありません（チェックと曲の選択を確認してください）', 'error');
  }
}

// ── 表の取り込み（wiki コピペ） ──
function iidxToggleImport() {
  const wrap = document.getElementById('iidx-import-wrap');
  if (wrap) wrap.style.display = wrap.style.display === 'none' ? '' : 'none';
}

// パース仕様: 「地力S+」「個人差A」のような行、または「〜：」で終わる行をティア見出しとして
// 扱い、以降の行を曲名として追加。1行に複数曲ある場合は タブ・全角スラッシュ（／）区切りに対応。
// 半角 / は曲名に含まれ得るため区切りとして扱わない。
function _iidxParseImport(text) {
  const tiers = [];
  let cur = null;
  (text || '').split(/\r?\n/).forEach(line => {
    let s = line.trim();
    if (!s) return;
    const tierMatch = s.match(/^(地力|個人差)[SABCDEF][+＋]?$/) || s.match(/^(.{1,20})[：:]$/);
    if (tierMatch) {
      const name = s.replace(/[：:]$/, '').replace(/＋/g, '+');
      cur = { tier: name, songs: [] };
      tiers.push(cur);
      return;
    }
    if (!cur) {
      cur = { tier: '未分類', songs: [] };
      tiers.push(cur);
    }
    s.split(/[\t／]/).forEach(song => {
      const t = song.trim();
      if (t) cur.songs.push(t);
    });
  });
  return tiers.filter(t => t.songs.length);
}

async function iidxRunImport() {
  const ta = document.getElementById('iidx-import-text');
  const status = document.getElementById('iidx-import-status');
  if (!ta || !_db || !_currentUser || !(_isAdmin || _isManager)) return;
  const tiers = _iidxParseImport(ta.value);
  if (!tiers.length) {
    if (status) { status.textContent = '取り込める曲がありません。ティア見出し行＋曲名行の形式で貼り付けてください。'; status.className = 'admin-status error'; }
    return;
  }
  const total = tiers.reduce((n, t) => n + t.songs.length, 0);
  if (!confirm(`${tiers.length}ティア・${total}曲で曲表を置き換えます。よろしいですか？\n（登録済みランプは曲名が一致すればそのまま引き継がれます）`)) return;
  try {
    await _db.collection('iidx_config').doc('table').set({
      tiers: tiers,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: _registeredName || (_currentUser.displayName || ''),
    });
    _iidxTable = tiers;
    _iidxTableMeta = { updatedAt: null, updatedBy: _registeredName || '' };
    if (status) { status.textContent = `取り込みました（${tiers.length}ティア・${total}曲）`; status.className = 'admin-status ok'; }
    ta.value = '';
    iidxToggleImport();
    _iidxRender();
  } catch (e) {
    if (status) { status.textContent = '保存に失敗しました: ' + (e.message || e); status.className = 'admin-status error'; }
  }
}
