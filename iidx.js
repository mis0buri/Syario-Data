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
