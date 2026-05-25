// ── じゃれ本 ──
const _JARE_CIRCLED = ['①','②','③','④','⑤','⑥','⑦','⑧','⑨','⑩'];
let _jareInited = false;
let _jareUnsubscribe = null;
let _jareDocs = [];

function _resetJare() {
  if (_jareUnsubscribe) { _jareUnsubscribe(); _jareUnsubscribe = null; }
  _jareInited = false;
}

function _refreshJareIfActive() {
  if (currentSection === 'jare' || currentSection === 'jare-detail') {
    _resetJare();
    initJare();
  }
}

function initJare() {
  const addBtn = document.getElementById('jare-add-btn');
  if (addBtn) addBtn.style.display = _isAdmin ? '' : 'none';

  if (_jareInited) return;
  _jareInited = true;

  const listEl = document.getElementById('jare-list');
  if (!_db) { listEl.innerHTML = '<div class="jare-empty">Firebase未設定</div>'; return; }
  if (_jareUnsubscribe) _jareUnsubscribe();
  _jareUnsubscribe = _db.collection('jare_stories')
    .onSnapshot(snap => {
      const docs = snap.docs.slice().sort((a, b) => {
        const da = a.data(), db2 = b.data();
        if (da.date !== db2.date) return da.date > db2.date ? -1 : 1;
        const ca = da.createdAt?.toMillis?.() || 0;
        const cb2 = db2.createdAt?.toMillis?.() || 0;
        return ca - cb2;
      });
      renderJareList(docs);
    }, () => {
      document.getElementById('jare-list').innerHTML = '<div class="jare-empty">読み込みに失敗しました</div>';
    });
}

function renderJareList(docs) {
  _jareDocs = docs;
  const listEl = document.getElementById('jare-list');
  if (!docs.length) { listEl.innerHTML = '<div class="jare-empty">まだ作品がありません</div>'; return; }

  // Group by date+theme (preserve insertion order for same-date sorting)
  const comboMap = {};
  const comboOrder = [];
  docs.forEach(d => {
    const { date = '', theme = '' } = d.data();
    const key = `${date}\t${theme}`;
    if (!comboMap[key]) { comboMap[key] = []; comboOrder.push(key); }
    comboMap[key].push(d);
  });
  comboOrder.sort((a, b) => {
    const da = a.split('\t')[0], db = b.split('\t')[0];
    return da > db ? -1 : da < db ? 1 : 0;
  });

  // グループ内を order フィールドでソート（未設定は createdAt で補完）
  Object.keys(comboMap).forEach(key => {
    comboMap[key].sort((a, b) => {
      const ao = typeof a.data().order === 'number' ? a.data().order : Infinity;
      const bo = typeof b.data().order === 'number' ? b.data().order : Infinity;
      if (ao !== bo) return ao - bo;
      return (a.data().createdAt?.toMillis?.() || 0) - (b.data().createdAt?.toMillis?.() || 0);
    });
  });

  let html = '';
  comboOrder.forEach((key, gi) => {
    const group = comboMap[key];
    const [date, theme] = key.split('\t');
    const parts = date.split('-');
    const dateLabel = parts.length === 3 ? `${parseInt(parts[0])}年${parseInt(parts[1])}月${parseInt(parts[2])}日` : date;
    const themeLabel = theme ? ` テーマ: ${_esc(theme)}` : '';

    const titleRows = group.map((doc, ti) => {
      const data = doc.data();
      const crown = data.winner ? '<span class="jare-crown">👑</span>' : '';
      const adminBtns = _isAdmin
        ? `<div class="jare-admin-btns">
            <button class="jare-order-btn" ${ti===0?'disabled':''} onclick="event.stopPropagation();moveJareInGroup('${doc.id}',-1)" title="上へ">↑</button>
            <button class="jare-order-btn" ${ti===group.length-1?'disabled':''} onclick="event.stopPropagation();moveJareInGroup('${doc.id}',1)" title="下へ">↓</button>
            <button class="jare-edit-btn" onclick="event.stopPropagation();openJareModal('${doc.id}')">編集</button>
            <button class="jare-del-btn" onclick="event.stopPropagation();deleteJareStory('${doc.id}')">削除</button>
           </div>`
        : '';
      return `<div class="jare-title-row">
        <span class="jare-title-text" onclick="showJareDetail('${doc.id}')">${crown}${_esc(data.title||'（無題）')}</span>
        <button class="jare-share-btn" onclick="shareJare('${doc.id}')">共有</button>
        ${adminBtns}
      </div>`;
    }).join('');

    const groupAdminBtn = _isAdmin
      ? `<button class="jare-edit-btn" style="margin-left:6px;font-size:11px;padding:2px 10px" onclick="event.stopPropagation();openJareGroupEdit('${_esc(date)}','${_esc(theme)}')">日付・テーマ編集</button>`
      : '';

    html += `<div class="jare-group">
      <div class="jare-group-header" onclick="toggleJareGroup(${gi})">
        <span class="jare-item-arrow" id="jare-grp-arrow-${gi}">▶</span>
        <span>${dateLabel}${themeLabel}</span>
        <span class="jare-group-count">${group.length}作品</span>
        ${groupAdminBtn}
      </div>
      <div class="jare-group-titles" id="jare-grp-${gi}">${titleRows}</div>
    </div>`;
  });
  listEl.innerHTML = html;

  // 詳細ページ表示中かつ読み込み待ちなら内容を再評価
  if (currentSection === 'jare-detail' && _jareDetailDocId && _authResolved && _currentUser) {
    const doc = docs.find(d => d.id === _jareDetailDocId);
    if (doc) _renderJareDetail(_jareDetailDocId, doc.data());
  }
}



function openJareGroupEdit(date, theme) {
  document.getElementById('jare-grpedit-orig-date').value = date;
  document.getElementById('jare-grpedit-orig-theme').value = theme;
  document.getElementById('jare-grpedit-date').value = date;
  document.getElementById('jare-grpedit-theme').value = theme;
  document.getElementById('jare-grpedit-status').textContent = '';
  const btn = document.getElementById('jare-grpedit-submit-btn');
  btn.disabled = false; btn.textContent = '一括変更する';
  const modal = document.getElementById('jare-group-edit-modal');
  modal.style.display = 'flex';
}

function closeJareGroupEdit() {
  document.getElementById('jare-group-edit-modal').style.display = 'none';
}

async function saveJareGroupEdit() {
  if (!_isAdmin || !_db) return;
  const origDate = document.getElementById('jare-grpedit-orig-date').value;
  const origTheme = document.getElementById('jare-grpedit-orig-theme').value;
  const newDate = document.getElementById('jare-grpedit-date').value.trim();
  const newTheme = document.getElementById('jare-grpedit-theme').value.trim();
  if (!newDate) { document.getElementById('jare-grpedit-status').textContent = '日付を入力してください'; return; }

  const btn = document.getElementById('jare-grpedit-submit-btn');
  btn.disabled = true; btn.textContent = '変更中...';
  document.getElementById('jare-grpedit-status').textContent = '';

  const key = `${origDate}\t${origTheme}`;
  const targets = _jareDocs.filter(d => {
    const { date = '', theme = '' } = d.data();
    return `${date}\t${theme}` === key;
  });

  try {
    const batch = _db.batch();
    targets.forEach(d => batch.update(_db.collection('jare_stories').doc(d.id), { date: newDate, theme: newTheme }));
    await batch.commit();
    closeJareGroupEdit();
  } catch(e) {
    document.getElementById('jare-grpedit-status').textContent = 'エラー: ' + e.message;
    btn.disabled = false; btn.textContent = '一括変更する';
  }
}

async function moveJareInGroup(docId, dir) {
  if (!_isAdmin || !_db) return;
  const doc = _jareDocs.find(d => d.id === docId);
  if (!doc) return;
  const { date = '', theme = '' } = doc.data();
  const key = `${date}\t${theme}`;

  // グループ内を現在の表示順で取得
  const group = _jareDocs
    .filter(d => { const { date: dt = '', theme: th = '' } = d.data(); return `${dt}\t${th}` === key; })
    .sort((a, b) => {
      const ao = typeof a.data().order === 'number' ? a.data().order : Infinity;
      const bo = typeof b.data().order === 'number' ? b.data().order : Infinity;
      if (ao !== bo) return ao - bo;
      return (a.data().createdAt?.toMillis?.() || 0) - (b.data().createdAt?.toMillis?.() || 0);
    });

  const idx = group.findIndex(d => d.id === docId);
  const targetIdx = idx + dir;
  if (idx < 0 || targetIdx < 0 || targetIdx >= group.length) return;

  // 全件を 0,1,2... に正規化しつつ対象2件をスワップ
  const batch = _db.batch();
  group.forEach((d, i) => {
    const newOrder = i === idx ? targetIdx : i === targetIdx ? idx : i;
    batch.update(_db.collection('jare_stories').doc(d.id), { order: newOrder });
  });
  try { await batch.commit(); } catch(e) { alert('順番の変更に失敗しました: ' + e.message); }
}

function toggleJareGroup(gi) {
  const titles = document.getElementById('jare-grp-' + gi);
  const arrow = document.getElementById('jare-grp-arrow-' + gi);
  if (!titles) return;
  const open = titles.classList.toggle('open');
  if (arrow) { arrow.textContent = open ? '▼' : '▶'; arrow.classList.toggle('open', open); }
}

let _jareDetailDocId = null;

function showJareDetail(docId) {
  _jareDetailDocId = docId;
  history.pushState(null, '', '#jare/' + docId);
  showSection('jare-detail');

  // 認証未確定（直リンク時）→ updateAuthUI が確定後に再呼び出す
  if (!_authResolved) {
    document.getElementById('jare-detail-meta').textContent = '';
    document.getElementById('jare-detail-title').textContent = '';
    document.getElementById('jare-detail-body').innerHTML = '<div style="color:var(--dim);padding:40px 0;text-align:center">読み込み中...</div>';
    return;
  }

  // 未ログイン → 本文を表示しない
  if (!_currentUser) {
    document.getElementById('jare-detail-meta').textContent = '';
    document.getElementById('jare-detail-title').textContent = '';
    document.getElementById('jare-detail-body').innerHTML =
      '<div style="padding:48px 0;text-align:center;font-size:14px;line-height:2">' +
      '<div style="color:var(--dim)">本文を閲覧するには<br>ログインが必要です</div>' +
      '<div style="color:var(--dim);font-size:12px;margin-top:6px;">TwitterまたはGoogleアカウントでログインできます</div>' +
      '<button class="rsv-btn primary" style="margin-top:16px;padding:10px 28px;" onclick="openLoginModal()">ログイン</button>' +
      '</div>';
    return;
  }

  const existing = _jareDocs.find(d => d.id === docId);
  if (existing) {
    _renderJareDetail(docId, existing.data());
  } else {
    document.getElementById('jare-detail-body').innerHTML = '<div style="color:var(--dim);padding:20px 0;text-align:center">読み込み中...</div>';
    if (_db) {
      _db.collection('jare_stories').doc(docId).get()
        .then(snap => {
          if (snap.exists) _renderJareDetail(docId, snap.data());
          else document.getElementById('jare-detail-body').innerHTML =
            '<div style="color:var(--dim);padding:20px 0;text-align:center">作品が見つかりませんでした</div>';
        })
        .catch(() => {
          document.getElementById('jare-detail-body').innerHTML =
            '<div style="color:var(--red);padding:20px 0;text-align:center">読み込みに失敗しました</div>';
        });
    } else {
      document.getElementById('jare-detail-body').innerHTML =
        '<div style="color:var(--red);padding:20px 0;text-align:center">読み込みに失敗しました</div>';
    }
  }
}

function _renderJareDetail(docId, data) {
  const parts = (data.date || '').split('-');
  const dateLabel = parts.length === 3
    ? `${parseInt(parts[0])}年${parseInt(parts[1])}月${parseInt(parts[2])}日`
    : data.date || '';
  const themeLabel = data.theme ? ` テーマ: ${data.theme}` : '';
  document.getElementById('jare-detail-meta').textContent = dateLabel + themeLabel;

  const crown = data.winner ? '👑 ' : '';
  document.getElementById('jare-detail-title').textContent = crown + (data.title || '（無題）');
  const editBtn = document.getElementById('jare-detail-edit-btn');
  if (editBtn) editBtn.style.display = _isAdmin ? '' : 'none';

  const paras = Array.isArray(data.paragraphs) ? data.paragraphs : [];
  document.getElementById('jare-detail-body').innerHTML = paras.length
    ? paras.map((p, i) =>
        `${i > 0 ? '<hr class="jare-para-sep">' : ''}<div class="jare-para"><span class="jare-para-num">${_JARE_CIRCLED[i]}</span><span class="jare-para-text">${_esc(p)}</span></div>`
      ).join('')
    : '<div style="color:var(--dim);padding:20px 0;text-align:center">（段落なし）</div>';
}

async function shareJare(docId) {
  const doc = _jareDocs.find(d => d.id === docId);
  const title = doc ? (doc.data().title || '（無題）') : '';
  const url = location.origin + location.pathname + '#jare/' + docId;
  await _doShareJare(title, url);
}

async function shareJareDetail() {
  const url = location.origin + location.pathname + '#jare/' + (_jareDetailDocId || '');
  const titleEl = document.getElementById('jare-detail-title');
  const title = titleEl ? titleEl.textContent.replace(/^👑\s*/, '') : '';
  await _doShareJare(title, url);
}

async function _doShareJare(title, url) {
  const text = `${title}\n${url}`;
  if (navigator.share) {
    try { await navigator.share({ title, text: title, url }); return; } catch(e) { if (e.name === 'AbortError') return; }
  }
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy');
    document.body.removeChild(ta);
  }
  // 一時的に「コピー済み」と表示するトースト
  const toast = document.createElement('div');
  toast.textContent = 'URLをコピーしました';
  Object.assign(toast.style, {
    position:'fixed', bottom:'24px', left:'50%', transform:'translateX(-50%)',
    background:'var(--surface)', border:'1px solid var(--border)', color:'var(--text)',
    padding:'8px 20px', borderRadius:'8px', fontSize:'13px', zIndex:'9999',
    boxShadow:'0 4px 16px rgba(0,0,0,.4)', pointerEvents:'none'
  });
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2000);
}

function backToJareList() {
  history.pushState(null, '', location.pathname + location.search);
  showSection('jare');
}

function openJareModal(docId) {
  document.getElementById('jare-edit-id').value = docId || '';
  document.getElementById('jare-modal-heading').textContent = docId ? 'じゃれ本を編集' : 'じゃれ本を追加';
  document.getElementById('jare-modal-status').textContent = '';
  document.getElementById('jare-submit-btn').disabled = false;

  // 既存の日付+テーマ一覧をドロップダウンに反映
  const comboSel = document.getElementById('jare-existing-combo');
  const seen = new Set();
  const combos = [];
  _jareDocs.forEach(d => {
    const { date = '', theme = '' } = d.data();
    const k = `${date}\t${theme}`;
    if (!seen.has(k)) { seen.add(k); combos.push({ date, theme }); }
  });
  combos.sort((a, b) => a.date > b.date ? -1 : a.date < b.date ? 1 : 0);
  comboSel.innerHTML = '<option value="">── 新しく入力する ──</option>' +
    combos.map(c => {
      const parts = c.date.split('-');
      const dl = parts.length === 3 ? `${parseInt(parts[0])}年${parseInt(parts[1])}月${parseInt(parts[2])}日` : c.date;
      const tl = c.theme ? ` テーマ:${c.theme}` : '';
      return `<option value="${_esc(c.date)}\t${_esc(c.theme)}">${dl}${tl}</option>`;
    }).join('');
  comboSel.value = '';

  if (docId) {
    _db.collection('jare_stories').doc(docId).get().then(doc => {
      if (!doc.exists) return;
      const d = doc.data();
      document.getElementById('jare-date').value = d.date || '';
      document.getElementById('jare-theme').value = d.theme || '';
      document.getElementById('jare-title-input').value = d.title || '';
      document.getElementById('jare-winner-check').checked = !!d.winner;
      const paras = d.paragraphs || [];
      for (let i = 1; i <= 8; i++) {
        document.getElementById('jare-p' + i).value = paras[i-1] || '';
      }
      // ドロップダウンを編集中のcomboに合わせる
      const k = `${d.date || ''}\t${d.theme || ''}`;
      if ([...comboSel.options].some(o => o.value === k)) comboSel.value = k;
      // データ取得後にテキストエリアをリサイズ
      _jareResizeAll();
    });
  } else {
    document.getElementById('jare-date').value = '';
    document.getElementById('jare-theme').value = '';
    document.getElementById('jare-title-input').value = '';
    document.getElementById('jare-winner-check').checked = false;
    for (let i = 1; i <= 8; i++) document.getElementById('jare-p' + i).value = '';
  }
  // OCRパネルをリセット
  document.getElementById('jare-ocr-body').classList.remove('open');
  document.getElementById('jare-ocr-arrow').classList.remove('open');
  document.getElementById('jare-ocr-status').textContent = '';
  document.getElementById('jare-ocr-status').className = 'jare-ocr-status';
  const jsonPaste = document.getElementById('jare-json-paste');
  if (jsonPaste) jsonPaste.value = '';

  document.getElementById('jare-modal').classList.add('open');
  // テキストエリアをコンテンツに合わせてリサイズ（レイアウト確定後）
  requestAnimationFrame(_jareResizeAll);
}

function onJareComboChange() {
  const val = document.getElementById('jare-existing-combo').value;
  if (!val) return;
  const [date, theme] = val.split('\t');
  document.getElementById('jare-date').value = date || '';
  document.getElementById('jare-theme').value = theme || '';
}

function closeJareModal() {
  document.getElementById('jare-modal').classList.remove('open');
}
function _jareResizeTA(el) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}
function _jareResizeAll() {
  for (let i = 1; i <= 8; i++) {
    const el = document.getElementById('jare-p' + i);
    if (el) _jareResizeTA(el);
  }
}

async function submitJareStory() {
  const statusEl = document.getElementById('jare-modal-status');
  const btn = document.getElementById('jare-submit-btn');
  const docId = document.getElementById('jare-edit-id').value;
  const date = document.getElementById('jare-date').value.trim();
  const theme = document.getElementById('jare-theme').value.trim();
  const title = document.getElementById('jare-title-input').value.trim();
  const winner = document.getElementById('jare-winner-check').checked;
  const paragraphs = [];
  for (let i = 1; i <= 8; i++) paragraphs.push(document.getElementById('jare-p' + i).value.trim());

  if (!date) { statusEl.textContent = '日付を入力してください'; return; }
  if (!theme) { statusEl.textContent = 'テーマを入力してください'; return; }
  if (!title) { statusEl.textContent = 'タイトルを入力してください'; return; }
  if (paragraphs.every(p => !p)) { statusEl.textContent = '段落を1つ以上入力してください'; return; }

  btn.disabled = true; btn.textContent = '保存中...';
  statusEl.textContent = '';
  try {
    const payload = { date, theme, title, winner, paragraphs };
    if (docId) {
      await _db.collection('jare_stories').doc(docId).update(payload);
    } else {
      payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      await _db.collection('jare_stories').add(payload);
    }
    closeJareModal();
  } catch(e) {
    statusEl.textContent = '保存に失敗しました: ' + e.message;
  } finally {
    btn.disabled = false; btn.textContent = '保存';
  }
}

async function deleteJareStory(docId) {
  if (!confirm('この作品を削除しますか？')) return;
  try {
    await _db.collection('jare_stories').doc(docId).delete();
  } catch(e) {
    alert('削除に失敗しました: ' + e.message);
  }
}

// ── じゃれ本 Claude連携 ──
function toggleJareOcrPanel() {
  const body = document.getElementById('jare-ocr-body');
  const arrow = document.getElementById('jare-ocr-arrow');
  const open = body.classList.toggle('open');
  arrow.classList.toggle('open', open);
}

function _setOcrStatus(msg, cls) {
  const el = document.getElementById('jare-ocr-status');
  el.textContent = msg;
  el.className = 'jare-ocr-status' + (cls ? ' ' + cls : '');
}

function copyJarePrompt() {
  const text = document.getElementById('jare-prompt-text').textContent;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.querySelector('.jare-prompt-copy-btn');
    btn.textContent = 'コピー済み';
    setTimeout(() => { btn.textContent = 'コピー'; }, 2000);
  }).catch(() => {
    // fallback
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy');
    document.body.removeChild(ta);
    const btn = document.querySelector('.jare-prompt-copy-btn');
    btn.textContent = 'コピー済み';
    setTimeout(() => { btn.textContent = 'コピー'; }, 2000);
  });
}

function _fixJsonNewlines(str) {
  // JSON文字列リテラル内に実際の改行・タブ文字が含まれる場合にエスケープする
  let out = '', inStr = false, esc = false;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (esc) { out += c; esc = false; continue; }
    if (c === '\\' && inStr) { out += c; esc = true; continue; }
    if (c === '"') { out += c; inStr = !inStr; continue; }
    if (inStr) {
      if (c === '\n') { out += '\\n'; continue; }
      if (c === '\r') { out += '\\r'; continue; }
      if (c === '\t') { out += '\\t'; continue; }
    }
    out += c;
  }
  return out;
}

function applyJareJson() {
  const raw = document.getElementById('jare-json-paste').value.trim();
  if (!raw) { _setOcrStatus('JSONを貼り付けてください', 'err'); return; }
  // ① スマートクォート（iOS等がペースト時に変換）を通常クォートに戻す
  //    ただし ASCII " が既にある場合は本文中の引用符なので変換しない（例: "かっさらった"）
  // ② 文字列値内の実際の改行・タブをエスケープ（コピペ時に \n が実改行になるケース対策）
  // ③ 不正なバックスラッシュエスケープを修正
  const hasAsciiQuote = raw.includes('"');
  const sanitized = _fixJsonNewlines(
    (hasAsciiQuote ? raw : raw.replace(/[\u201c\u201d]/g, '"')).replace(/[\u2018\u2019]/g, "'")
  ).replace(/\\([^"\\/bfnrtu])/g, '\\\\$1');
  let parsed;
  try { parsed = JSON.parse(sanitized); }
  catch {
    const m = sanitized.match(/\{[\s\S]*\}/);
    if (!m) { _setOcrStatus('JSONの形式が正しくありません', 'err'); return; }
    try { parsed = JSON.parse(m[0]); } catch { _setOcrStatus('JSONの解析に失敗しました', 'err'); return; }
  }
  const paras = parsed?.paragraphs || [];
  if (!paras.length) { _setOcrStatus('段落データが見つかりません', 'err'); return; }
  let filled = 0;
  paras.forEach(({ num, text }) => {
    const n = parseInt(num);
    if (n >= 1 && n <= 8) { const el = document.getElementById('jare-p' + n); if (el) { el.value = text || ''; filled++; } }
  });
  _setOcrStatus(`${filled}段落を反映しました。内容を確認・修正してから保存してください。`, 'ok');
}

// ── 散歩ログ ──
let _walkInited = false;
let _walkMap = null;
let _walkPolyline = null;
let _walkSortKey = 'date';
let _walkSortAsc = false;

function initWalk() {
  const addBtn = document.getElementById('walk-add-btn');
  if (addBtn) addBtn.style.display = _isAdmin ? '' : 'none';
  const batchBtn = document.getElementById('walk-batch-geocode-btn');
  if (batchBtn) batchBtn.style.display = _isAdmin ? '' : 'none';
  _renderWalkSortBar();
  if (_walkInited) return;
  _walkInited = true;
  _loadWalkList();
}

function _renderWalkSortBar() {
  const existing = document.getElementById('walk-sort-bar');
  if (existing) existing.remove();
  const bar = document.createElement('div');
  bar.id = 'walk-sort-bar';
  bar.className = 'walk-sort-bar';
  const keys = [['date', '日付'], ['distance', '距離'], ['movingMins', '時間']];
  const dirLabel = _walkSortAsc ? '↑' : '↓';
  bar.innerHTML = keys.map(([k, label]) =>
    `<button class="walk-sort-btn${_walkSortKey === k ? ' active' : ''}" onclick="setWalkSort('${k}')">${label}</button>`
  ).join('') +
    `<button class="walk-sort-btn walk-sort-dir" onclick="toggleWalkSortDir()">${dirLabel}</button>`;
  document.getElementById('walk-list').before(bar);
}

function setWalkSort(key) {
  if (_walkSortKey === key) { _walkSortAsc = !_walkSortAsc; }
  else { _walkSortKey = key; _walkSortAsc = key !== 'date'; }
  _renderWalkSortBar();
  _loadWalkList();
}

function toggleWalkSortDir() {
  _walkSortAsc = !_walkSortAsc;
  _renderWalkSortBar();
  _loadWalkList();
}

async function _loadWalkList() {
  const listEl = document.getElementById('walk-list');
  if (!_db) { listEl.innerHTML = '<div class="empty">Firebase未設定</div>'; return; }
  try {
    const snap = await _db.collection('walk_logs').get();
    if (snap.empty) { listEl.innerHTML = '<div class="empty">まだログがありません</div>'; return; }
    const docs = snap.docs.slice().sort((a, b) => {
      const da = a.data(), db2 = b.data();
      const va = da[_walkSortKey] ?? (typeof da[_walkSortKey] === 'number' ? 0 : '');
      const vb = db2[_walkSortKey] ?? (typeof db2[_walkSortKey] === 'number' ? 0 : '');
      return _walkSortAsc ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
    });
    listEl.innerHTML = docs.map(doc => {
      const d = doc.data();
      const label = d.title || d.date;
      const meta = [d.date, d.distance ? `${d.distance} km` : null, d.duration || null].filter(Boolean).join('　');
      const allMarks = d.kmMarks || [];
      const marks = allMarks.length <= 3 ? allMarks : [
        allMarks[0],
        allMarks[Math.floor((allMarks.length - 1) / 2)],
        allMarks[allMarks.length - 1],
      ];
      const marksHtml = marks.length
        ? `<div class="walk-list-marks">${marks.map(m =>
            `<span class="walk-list-mark"><span class="walk-km-badge">${m.km}km</span>${m.address ? `<span class="walk-list-mark-addr">${_esc(m.address)}</span>` : ''}</span>`
          ).join('')}</div>`
        : '';
      return `<div class="walk-list-item" onclick="openWalkDetail('${doc.id}')">
        <div class="walk-list-title">${_esc(label)}</div>
        <div class="walk-list-meta">${_esc(meta)}</div>
        ${marksHtml}
      </div>`;
    }).join('');
  } catch(e) {
    listEl.innerHTML = '<div class="empty">読み込みに失敗しました</div>';
  }
}

async function openWalkDetail(docId) {
  const doc = await _db.collection('walk_logs').doc(docId).get();
  if (!doc.exists) return;
  const d = doc.data();

  document.getElementById('walk-list').parentElement.style.display = 'none';
  const detailEl = document.getElementById('walk-detail');
  detailEl.style.display = '';
  history.replaceState(null, '', '#walk/' + docId);

  document.getElementById('walk-detail-title').textContent = d.title || d.date;
  const timeRange = (d.startTime && d.endTime) ? `${d.startTime} 〜 ${d.endTime}` : null;
  const meta = [
    d.date,
    timeRange,
    d.distance ? `距離: ${d.distance} km` : null,
    d.duration ? `移動時間: ${d.duration}` : null,
    d.pace ? `ペース: ${d.pace}` : null,
  ].filter(Boolean).join('　／　');
  document.getElementById('walk-detail-meta').textContent = meta;

  // 共有・削除ボタン
  const shareBtn = document.getElementById('walk-share-btn');
  if (shareBtn) {
    shareBtn.style.display = _isAdmin ? '' : 'none';
    shareBtn.onclick = () => shareWalkDetail(docId, d);
  }
  const deleteBtn = document.getElementById('walk-delete-btn');
  if (deleteBtn) {
    deleteBtn.style.display = _isAdmin ? '' : 'none';
    deleteBtn.onclick = () => deleteWalkLog(docId, d.title || d.date);
  }

  // 地図初期化（既存インスタンスを破棄）
  const mapEl = document.getElementById('walk-map');
  if (_walkMap) { _walkMap.remove(); _walkMap = null; }
  _walkMap = L.map(mapEl);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
    crossOrigin: 'anonymous',
  }).addTo(_walkMap);

  const points = (d.points || []).map(p => [p.lat, p.lon]);
  if (points.length) {
    _walkPolyline = L.polyline(points, { color: '#00E5FF', weight: 4 }).addTo(_walkMap);
    L.circleMarker(points[0], { radius: 8, color: '#4caf50', fillColor: '#4caf50', fillOpacity: 1 }).addTo(_walkMap);
    L.circleMarker(points[points.length - 1], { radius: 8, color: '#e53935', fillColor: '#e53935', fillOpacity: 1 }).addTo(_walkMap);
    _walkMap.fitBounds(_walkPolyline.getBounds(), { padding: [24, 24] });
  }

  // km地点リスト
  const existingKmList = document.getElementById('walk-km-list');
  if (existingKmList) existingKmList.remove();
  const kmMarks = d.kmMarks || [];
  if (kmMarks.length) {
    const kmListEl = document.createElement('div');
    kmListEl.id = 'walk-km-list';
    kmListEl.className = 'walk-km-list';
    const refetchBtn = _isAdmin
      ? `<button class="walk-refetch-btn" onclick="refetchWalkAddresses('${docId}')" style="font-size:12px;padding:3px 10px;margin-left:8px;cursor:pointer;background:var(--surface2);border:1px solid var(--border);border-radius:6px;">住所を再取得</button>`
      : '';
    kmListEl.innerHTML = `<div class="walk-km-list-title">通過地点${refetchBtn}<span id="walk-refetch-status" style="font-size:12px;color:var(--dim);margin-left:8px;"></span></div>` +
      kmMarks.map(m => `
        <div class="walk-km-item" onclick="walkJumpTo(${m.lat},${m.lon})">
          <span class="walk-km-badge">${m.km}km</span>
          <span class="walk-km-time">${_esc(m.time || '')}</span>
          <span class="walk-km-addr">${_esc(m.address || '')}</span>
        </div>`).join('');
    mapEl.after(kmListEl);
  }

  // 管理者向け GPX 追加ボタン
  const existingBtn = document.getElementById('walk-add-gpx-btn');
  if (existingBtn) existingBtn.remove();
  if (_isAdmin) {
    const btn = document.createElement('div');
    btn.id = 'walk-add-gpx-btn';
    btn.style.cssText = 'margin-top:12px;';
    btn.innerHTML = `
      <label style="display:inline-flex;align-items:center;gap:8px;cursor:pointer;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:8px 14px;font-size:13px;">
        <span>＋ GPXを追加</span>
        <input type="file" accept=".gpx" style="display:none;" onchange="mergeGpxToWalk('${docId}', this)">
      </label>
      <label style="display:inline-flex;align-items:center;gap:8px;cursor:pointer;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:8px 14px;font-size:13px;margin-left:8px;">
        <span>↺ 再アップロード</span>
        <input type="file" accept=".gpx" style="display:none;" onchange="reuploadWalkLog('${docId}', this)">
      </label>
      <span id="walk-merge-status" style="font-size:12px;color:var(--dim);margin-left:8px;"></span>`;
    mapEl.after(btn);
  }
}

async function deleteWalkLog(docId, label) {
  if (!confirm(`「${label}」を削除しますか？`)) return;
  try {
    await _db.collection('walk_logs').doc(docId).delete();
    closeWalkDetail();
    _walkInited = false;
    initWalk();
  } catch(e) {
    alert('削除に失敗しました: ' + e.message);
  }
}

async function shareWalkDetail(docId, d) {
  const shareBtn = document.getElementById('walk-share-btn');
  const origText = shareBtn.textContent;
  shareBtn.disabled = true;
  shareBtn.textContent = '生成中...';

  try {
    const W = 1080, dpr = 2, PAD = 28, headerH = 200, mapH = W;
    const H = headerH + mapH;
    const shareUrl = location.origin + location.pathname + '#walk/' + docId;

    const canvas = document.createElement('canvas');
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#1a1b1e';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#00E5FF';
    ctx.fillRect(0, 0, 6, headerH);

    ctx.font = "bold 32px 'Noto Sans JP', sans-serif";
    ctx.fillStyle = '#e8e6e3';
    ctx.fillText(d.title || d.date || '', PAD + 12, 52);

    const timeRange = (d.startTime && d.endTime) ? d.startTime + ' 〜 ' + d.endTime : '';
    ctx.font = "16px 'Noto Sans JP', sans-serif";
    ctx.fillStyle = '#a0a0a0';
    ctx.fillText([d.date, timeRange].filter(Boolean).join('　'), PAD + 12, 84);

    ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PAD + 12, 100); ctx.lineTo(W - PAD, 100); ctx.stroke();

    const stats = [['距離', d.distance ? d.distance + ' km' : '—'], ['移動時間', d.duration || '—'], ['ペース', d.pace || '—']];
    const colW = (W - PAD * 2 - 12) / stats.length;
    stats.forEach(([label, val], i) => {
      const x = PAD + 12 + i * colW;
      ctx.font = "12px 'Noto Sans JP', sans-serif"; ctx.fillStyle = '#a0a0a0'; ctx.fillText(label, x, 128);
      ctx.font = "bold 22px 'Noto Sans JP', sans-serif"; ctx.fillStyle = '#e8e6e3'; ctx.fillText(val, x, 158);
    });

    await _renderTileMap(ctx, d.points || [], 0, headerH, W, mapH);

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('画像の生成に失敗しました');

    const file = new File([blob], 'walk-' + (d.date || 'log') + '.png', { type: 'image/png' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], text: shareUrl });
      } else {
        throw new Error('files not supported');
      }
    } catch(e) {
      if (e.name === 'AbortError') return;
      // ファイル共有不可の場合はURLテキストのみ or ダウンロード
      if (navigator.share) {
        try { await navigator.share({ url: shareUrl }); return; } catch(_) {}
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = file.name;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  } catch(e) {
    if (e.name !== 'AbortError') alert('共有に失敗しました: ' + e.message);
  } finally {
    shareBtn.disabled = false;
    shareBtn.textContent = origText;
  }
}

async function _renderTileMap(ctx, points, x0, y0, W, H) {
  if (!points.length) { _drawRouteFallback(ctx, points, x0, y0, W, H); return; }

  const lats = points.map(p => p.lat), lons = points.map(p => p.lon);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);

  const lon2tx = (lon, z) => (lon + 180) / 360 * (1 << z);
  const lat2ty = (lat, z) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1/Math.cos(r)) / Math.PI) / 2 * (1 << z); };

  const zoom = _bestTileZoom(minLat, maxLat, minLon, maxLon, W, H);

  // ルートのbboxをタイル座標(小数)で取得
  const txR0 = lon2tx(minLon, zoom), txR1 = lon2tx(maxLon, zoom);
  const tyR0 = lat2ty(maxLat, zoom),  tyR1 = lat2ty(minLat, zoom); // y軸は上が小さい

  // 10%のパディングを追加した描画範囲
  const padX = (txR1 - txR0) * 0.1 || 0.3;
  const padY = (tyR1 - tyR0) * 0.1 || 0.3;
  const vx0 = txR0 - padX, vx1 = txR1 + padX;
  const vy0 = tyR0 - padY, vy1 = tyR1 + padY;

  // キャンバス1pxあたりのタイル単位(縦横で小さい方に合わせてルートを最大化)
  const scale = Math.min(W / (vx1 - vx0), H / (vy1 - vy0));

  // 描画領域をキャンバス中央に配置
  const rW = (vx1 - vx0) * scale, rH = (vy1 - vy0) * scale;
  const ox = x0 + (W - rW) / 2, oy = y0 + (H - rH) / 2;

  const txToX = tx => ox + (tx - vx0) * scale;
  const tyToY = ty => oy + (ty - vy0) * scale;

  // 必要なタイルを取得
  const iTxMin = Math.floor(vx0), iTxMax = Math.ceil(vx1);
  const iTyMin = Math.floor(vy0), iTyMax = Math.ceil(vy1);
  const fetches = [];
  for (let tx = iTxMin; tx <= iTxMax; tx++) {
    for (let ty = iTyMin; ty <= iTyMax; ty++) {
      fetches.push(new Promise(resolve => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve({ img, tx, ty });
        img.onerror = () => resolve(null);
        img.src = 'https://tile.openstreetmap.org/' + zoom + '/' + tx + '/' + ty + '.png';
      }));
    }
  }

  const tiles = await Promise.race([
    Promise.all(fetches),
    new Promise(resolve => setTimeout(() => resolve(null), 3000)),
  ]);

  if (!tiles) { _drawRouteFallback(ctx, points, x0, y0, W, H); return; }

  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, W, H);
  ctx.clip();

  tiles.forEach(t => {
    if (!t) return;
    ctx.drawImage(t.img, txToX(t.tx), tyToY(t.ty), scale, scale);
  });

  const lonToX = lon => ox + (lon2tx(lon, zoom) - vx0) * scale;
  const latToY = lat => oy + (lat2ty(lat, zoom) - vy0) * scale;

  ctx.strokeStyle = '#00E5FF'; ctx.lineWidth = 5; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.beginPath();
  points.forEach((p, i) => { i === 0 ? ctx.moveTo(lonToX(p.lon), latToY(p.lat)) : ctx.lineTo(lonToX(p.lon), latToY(p.lat)); });
  ctx.stroke();

  const drawDot = (p, color) => {
    const cx = lonToX(p.lon), cy = latToY(p.lat), r = 10;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
  };
  drawDot(points[0], '#4caf50');
  drawDot(points[points.length - 1], '#e53935');

  ctx.restore();
}

function _bestTileZoom(minLat, maxLat, minLon, maxLon, W, H) {
  const lon2t = (lon, z) => (lon + 180) / 360 * (1 << z);
  const lat2t = (lat, z) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1/Math.cos(r)) / Math.PI) / 2 * (1 << z); };
  for (let z = 16; z >= 1; z--) {
    const tw = lon2t(maxLon, z) - lon2t(minLon, z);
    const th = lat2t(minLat, z) - lat2t(maxLat, z);
    if (Math.max(tw / (W/256), th / (H/256)) <= 0.82) return z;
  }
  return 10;
}
function _drawRouteFallback(ctx, points, x0, y0, W, H) {
  ctx.fillStyle = '#242528';
  ctx.fillRect(x0, y0, W, H);
  if (!points.length) return;
  const lats = points.map(p => p.lat), lons = points.map(p => p.lon);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const merc = lat => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
  const mMin = merc(minLat), mMax = merc(maxLat);
  const pad = 40;
  const toXY = (lat, lon) => [
    x0 + pad + (lon - minLon) / (maxLon - minLon || 1) * (W - pad * 2),
    y0 + pad + (mMax - merc(lat)) / (mMax - mMin || 1) * (H - pad * 2),
  ];
  ctx.strokeStyle = '#00E5FF'; ctx.lineWidth = 4; ctx.lineJoin = 'round';
  ctx.beginPath();
  points.forEach((p, i) => { const [px, py] = toXY(p.lat, p.lon); i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py); });
  ctx.stroke();
}

async function reuploadWalkLog(docId, input) {
  const statusEl = document.getElementById('walk-merge-status');
  if (!input.files.length) return;
  if (!confirm('既存のルートデータを新しいGPXで上書きします。よろしいですか？')) {
    input.value = '';
    return;
  }
  if (statusEl) statusEl.textContent = '解析中...';
  try {
    const text = await input.files[0].text();
    const parsed = _parseGpx(text);
    if (!parsed.points.length) { if (statusEl) statusEl.textContent = 'ルートデータが見つかりません'; return; }

    const existing = (await _db.collection('walk_logs').doc(docId).get()).data() || {};
    const kmMarks = await _geocodeKmMarks(parsed.kmMarks, statusEl);
    if (statusEl) statusEl.textContent = '保存中...';
    await _db.collection('walk_logs').doc(docId).update({
      date: parsed.date,
      startTime: parsed.startTime,
      endTime: parsed.endTime,
      distance: parsed.distance,
      movingMins: parsed.movingMins,
      duration: parsed.duration,
      pace: parsed.pace,
      points: parsed.points,
      kmMarks,
    });
    if (statusEl) statusEl.textContent = '完了';
    input.value = '';
    await openWalkDetail(docId);
  } catch(e) {
    if (statusEl) statusEl.textContent = 'エラー: ' + e.message;
  }
}

async function mergeGpxToWalk(docId, input) {
  const statusEl = document.getElementById('walk-merge-status');
  if (!input.files.length) return;
  statusEl.textContent = '解析中...';
  try {
    const text = await input.files[0].text();
    const parsed = _parseGpx(text);
    if (!parsed.points.length) { statusEl.textContent = 'ルートデータが見つかりません'; return; }

    const doc = await _db.collection('walk_logs').doc(docId).get();
    const d = doc.data();

    const mergedPoints   = [...(d.points || []), ...parsed.points];
    const mergedDist     = Math.round(((d.distance || 0) + parsed.distance) * 10) / 10;
    const mergedMins     = (d.movingMins || 0) + parsed.movingMins;
    const mergedDuration = mergedMins >= 60
      ? `${Math.floor(mergedMins/60)}時間${mergedMins%60}分` : `${mergedMins}分`;
    const mergedPace = mergedDist > 0 && mergedMins > 0
      ? (() => { const p = mergedMins / mergedDist; const m = Math.floor(p); const s = Math.round((p-m)*60); return `${m}分${String(s).padStart(2,'0')}秒/km`; })()
      : d.pace || '';
    const mergedStart = (!d.startTime || (parsed.startTime && parsed.startTime < d.startTime)) ? parsed.startTime : d.startTime;
    const mergedEnd   = (!d.endTime   || (parsed.endTime   && parsed.endTime   > d.endTime))   ? parsed.endTime   : d.endTime;

    // km地点をオフセット付きでジオコーディング
    const kmOffset = Math.floor(d.distance || 0);
    const offsetMarks = parsed.kmMarks.map(m => ({ ...m, km: m.km + kmOffset }));
    const geocodedNew = await _geocodeKmMarks(offsetMarks, statusEl);
    const mergedKmMarks = [...(d.kmMarks || []), ...geocodedNew];

    await _db.collection('walk_logs').doc(docId).update({
      points: mergedPoints,
      distance: mergedDist,
      movingMins: mergedMins,
      duration: mergedDuration,
      pace: mergedPace,
      startTime: mergedStart,
      endTime: mergedEnd,
      kmMarks: mergedKmMarks,
    });

    statusEl.textContent = '追加しました';
    openWalkDetail(docId);
  } catch(e) {
    statusEl.textContent = 'エラー: ' + e.message;
  }
}

function walkJumpTo(lat, lon) {
  if (_walkMap) {
    _walkMap.setView([lat, lon], 16);
    document.getElementById('walk-map').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

let _walkAllMap = null;
let _walkAllLocationMarker = null;

// 半期ごとの色パレット（順番に循環）
const _HALF_YEAR_COLORS = ['#00E5FF','#FF6B6B','#69DB7C','#FFD43B','#CC5DE8','#FF922B','#4DABF7','#F783AC'];

function _halfYearKey(dateStr) {
  if (!dateStr) return '';
  const m = dateStr.match(/^(\d{4})-(\d{2})/);
  if (!m) return dateStr;
  const q = Math.ceil(+m[2] / 3);
  const qLabel = ['1-3月','4-6月','7-9月','10-12月'][q - 1];
  return `${m[1]}年Q${q}(${qLabel})`;
}

async function showAllWalkRoutes() {
  if (!_db) return;
  document.getElementById('walk-list').parentElement.style.display = 'none';
  const allEl = document.getElementById('walk-all-routes');
  allEl.style.display = '';

  const mapEl = document.getElementById('walk-all-map');
  if (_walkAllMap) { _walkAllMap.remove(); _walkAllMap = null; }
  _walkAllMap = L.map(mapEl);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19
  }).addTo(_walkAllMap);

  const snap = await _db.collection('walk_logs').get();

  // 半期キーを収集して色を割り当て
  const keys = [...new Set(snap.docs.map(doc => _halfYearKey(doc.data().date)).filter(Boolean))].sort();
  const colorMap = Object.fromEntries(keys.map((k, i) => [k, _HALF_YEAR_COLORS[i % _HALF_YEAR_COLORS.length]]));

  const allBounds = [];
  snap.docs.forEach(doc => {
    const d = doc.data();
    const pts = (d.points || []).map(p => [p.lat, p.lon]);
    if (!pts.length) return;
    const color = colorMap[_halfYearKey(d.date)] || '#00E5FF';
    L.polyline(pts, { color, weight: 4 }).addTo(_walkAllMap);
    allBounds.push(...pts);
  });

  if (allBounds.length) _walkAllMap.fitBounds(L.latLngBounds(allBounds), { padding: [24, 24] });

  // 凡例
  const existingLegend = document.getElementById('walk-all-legend');
  if (existingLegend) existingLegend.remove();
  if (keys.length > 1) {
    const legend = document.createElement('div');
    legend.id = 'walk-all-legend';
    legend.style.cssText = 'display:flex;flex-wrap:wrap;gap:10px;margin-top:10px;font-size:13px;';
    legend.innerHTML = keys.map(k =>
      `<span style="display:flex;align-items:center;gap:5px;">
        <span style="display:inline-block;width:24px;height:4px;border-radius:2px;background:${colorMap[k]};"></span>${k}
      </span>`
    ).join('');
    mapEl.after(legend);
  }
}

function showAllWalkCurrentLocation() {
  if (!_walkAllMap) return;
  if (!navigator.geolocation) { alert('この端末では位置情報を取得できません'); return; }
  const btn = document.getElementById('walk-all-location-btn');
  if (btn) btn.textContent = '取得中…';
  navigator.geolocation.getCurrentPosition(
    pos => {
      const { latitude: lat, longitude: lng } = pos.coords;
      if (_walkAllLocationMarker) _walkAllLocationMarker.remove();
      _walkAllLocationMarker = L.circleMarker([lat, lng], {
        radius: 8, color: '#fff', weight: 2,
        fillColor: '#2979FF', fillOpacity: 1
      }).addTo(_walkAllMap);
      _walkAllMap.setView([lat, lng], 15);
      if (btn) btn.textContent = '現在地';
    },
    () => {
      if (btn) btn.textContent = '現在地';
      alert('位置情報の取得に失敗しました');
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

function closeAllWalkRoutes() {
  document.getElementById('walk-all-routes').style.display = 'none';
  document.getElementById('walk-list').parentElement.style.display = '';
  if (_walkAllLocationMarker) { _walkAllLocationMarker.remove(); _walkAllLocationMarker = null; }
  if (_walkAllMap) { _walkAllMap.remove(); _walkAllMap = null; }
}

function closeWalkDetail() {
  document.getElementById('walk-detail').style.display = 'none';
  document.getElementById('walk-list').parentElement.style.display = '';
  if (_walkMap) { _walkMap.remove(); _walkMap = null; }
  history.replaceState(null, '', '#walk');
}

function openWalkUpload() {
  document.getElementById('walk-upload-title').value = '';
  document.getElementById('walk-upload-file').value = '';
  document.getElementById('walk-upload-status').textContent = '';
  document.getElementById('walk-upload-submit-btn').disabled = false;
  const modal = document.getElementById('walk-upload-modal');
  modal.style.display = 'flex';
}

function closeWalkUpload() {
  document.getElementById('walk-upload-modal').style.display = 'none';
}

async function submitWalkUpload() {
  const statusEl = document.getElementById('walk-upload-status');
  const btn = document.getElementById('walk-upload-submit-btn');
  const fileInput = document.getElementById('walk-upload-file');
  const title = document.getElementById('walk-upload-title').value.trim();

  if (!fileInput.files.length) { statusEl.textContent = 'GPXファイルを選択してください'; return; }
  btn.disabled = true;
  statusEl.textContent = '解析中...';

  try {
    const text = await fileInput.files[0].text();
    const parsed = _parseGpx(text);
    if (!parsed.points.length) { statusEl.textContent = 'ルートデータが見つかりません'; btn.disabled = false; return; }

    const skipGeocode = document.getElementById('walk-skip-geocode')?.checked;
    const kmMarks = skipGeocode ? parsed.kmMarks : await _geocodeKmMarks(parsed.kmMarks, statusEl);
    statusEl.textContent = '保存中...';

    await _db.collection('walk_logs').add({
      title: title || null,
      date: parsed.date,
      startTime: parsed.startTime,
      endTime: parsed.endTime,
      distance: parsed.distance,
      movingMins: parsed.movingMins,
      duration: parsed.duration,
      pace: parsed.pace,
      points: parsed.points,
      kmMarks,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });

    closeWalkUpload();
    _walkInited = false;
    initWalk();
  } catch(e) {
    statusEl.textContent = 'エラー: ' + e.message;
    btn.disabled = false;
  }
}

function _parseGpx(text) {
  const xml = new DOMParser().parseFromString(text, 'application/xml');
  const trkpts = [...xml.querySelectorAll('trkpt')];

  // 座標を間引き（最大500点）
  const step = Math.max(1, Math.floor(trkpts.length / 500));
  const sampled = trkpts.filter((_, i) => i % step === 0 || i === trkpts.length - 1);
  const points = sampled.map(pt => ({
    lat: parseFloat(pt.getAttribute('lat')),
    lon: parseFloat(pt.getAttribute('lon')),
  }));

  // 日付・開始終了時刻（JST変換）
  const firstTimeStr = trkpts[0]?.querySelector('time')?.textContent || '';
  const lastTimeStr  = trkpts[trkpts.length - 1]?.querySelector('time')?.textContent || '';
  const date = firstTimeStr ? firstTimeStr.slice(0, 10) : '';
  const _toJst = s => s ? new Date(s).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' }) : '';
  const startTime = _toJst(firstTimeStr);
  const endTime   = _toJst(lastTimeStr);

  // 距離計算（ハバーサイン）
  let dist = 0;
  for (let i = 1; i < trkpts.length; i++) {
    const a = { lat: parseFloat(trkpts[i-1].getAttribute('lat')), lon: parseFloat(trkpts[i-1].getAttribute('lon')) };
    const b = { lat: parseFloat(trkpts[i].getAttribute('lat')), lon: parseFloat(trkpts[i].getAttribute('lon')) };
    dist += _haversine(a, b);
  }

  // 移動時間（連続点間の間隔が60秒超は休憩とみなし除外）
  const GAP_THRESHOLD = 5 * 60 * 1000;
  let movingSecs = 0;
  for (let i = 1; i < trkpts.length; i++) {
    const t0 = trkpts[i-1].querySelector('time')?.textContent;
    const t1 = trkpts[i].querySelector('time')?.textContent;
    if (!t0 || !t1) continue;
    const diff = new Date(t1) - new Date(t0);
    if (diff > 0 && diff <= GAP_THRESHOLD) movingSecs += diff / 1000;
  }
  const movingMins = Math.round(movingSecs / 60);
  const duration = movingMins >= 60
    ? `${Math.floor(movingMins/60)}時間${movingMins%60}分`
    : `${movingMins}分`;

  // ペース（移動時間ベース）
  const distRounded = Math.round(dist * 10) / 10;
  let pace = '';
  if (distRounded > 0 && movingMins > 0) {
    const paceTotal = movingMins / distRounded;
    const paceMin = Math.floor(paceTotal);
    const paceSec = Math.round((paceTotal - paceMin) * 60);
    pace = `${paceMin}分${String(paceSec).padStart(2,'0')}秒/km`;
  }

  // km地点の計算（座標・通過時刻）
  const kmMarks = [];
  let cumKm = 0;
  let nextKm = 1;
  for (let i = 1; i < trkpts.length; i++) {
    const a = { lat: parseFloat(trkpts[i-1].getAttribute('lat')), lon: parseFloat(trkpts[i-1].getAttribute('lon')) };
    const b = { lat: parseFloat(trkpts[i].getAttribute('lat')), lon: parseFloat(trkpts[i].getAttribute('lon')) };
    const seg = _haversine(a, b);
    const prev = cumKm;
    cumKm += seg;
    while (cumKm >= nextKm) {
      const frac = seg > 0 ? (nextKm - prev) / seg : 0;
      const mkLat = a.lat + frac * (b.lat - a.lat);
      const mkLon = a.lon + frac * (b.lon - a.lon);
      const t0 = trkpts[i-1].querySelector('time')?.textContent;
      const t1 = trkpts[i].querySelector('time')?.textContent;
      let markTime = '';
      if (t0 && t1) {
        const ms = new Date(t0).getTime() + frac * (new Date(t1).getTime() - new Date(t0).getTime());
        markTime = new Date(ms).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Tokyo' });
      }
      kmMarks.push({ km: nextKm, lat: mkLat, lon: mkLon, time: markTime, address: '' });
      nextKm++;
    }
  }

  return { points, date, startTime, endTime, distance: distRounded, movingMins, duration, pace, kmMarks };
}

async function batchGeocodeWalkLogs() {
  if (!_isAdmin || !_db) return;
  const btn = document.getElementById('walk-batch-geocode-btn');
  if (btn) { btn.disabled = true; btn.textContent = '取得中...'; }

  try {
    const snap = await _db.collection('walk_logs').get();
    const targets = snap.docs.filter(doc => {
      const marks = doc.data().kmMarks || [];
      return marks.some(m => !m.address);
    });

    if (!targets.length) {
      alert('住所未取得のログはありません');
      return;
    }

    let stopped = false;
    for (let di = 0; di < targets.length; di++) {
      const doc = targets[di];
      const marks = doc.data().kmMarks || [];
      if (btn) btn.textContent = `取得中... (${di + 1}/${targets.length}件)`;

      const result = [];
      for (let i = 0; i < marks.length; i++) {
        const m = marks[i];
        if (m.address) { result.push(m); continue; }
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${m.lat}&lon=${m.lon}&format=json&zoom=18&accept-language=ja`,
            { headers: { 'User-Agent': 'SyarioWalkLog/1.0' } }
          );
          if (res.status === 429) {
            result.push(...marks.slice(i));
            stopped = true;
            break;
          }
          const data = await res.json();
          result.push({ ...m, address: _extractJaAddress(data.address) });
        } catch(e) {
          result.push(m);
        }
        if (i < marks.length - 1) await new Promise(r => setTimeout(r, 1100));
      }

      await _db.collection('walk_logs').doc(doc.id).update({ kmMarks: result });
      if (stopped) break;
    }

    await _loadWalkList();
    if (btn) btn.textContent = stopped ? 'レート制限で停止' : '住所を一括取得';
    alert(stopped ? 'レート制限に達したため途中で停止しました。時間をおいて再実行してください。' : '一括取得が完了しました');
  } finally {
    if (btn) btn.disabled = false;
    if (btn && btn.textContent === '取得中...') btn.textContent = '住所を一括取得';
  }
}

async function refetchWalkAddresses(docId) {
  const btn = document.querySelector('.walk-refetch-btn');
  const statusEl = document.getElementById('walk-refetch-status');
  if (btn) btn.disabled = true;

  const doc = await _db.collection('walk_logs').doc(docId).get();
  if (!doc.exists) { if (btn) btn.disabled = false; return; }
  const marks = doc.data().kmMarks || [];
  if (!marks.length) { if (statusEl) statusEl.textContent = '地点なし'; if (btn) btn.disabled = false; return; }

  const geocoded = await _geocodeKmMarks(marks, statusEl);
  await _db.collection('walk_logs').doc(docId).update({ kmMarks: geocoded });

  if (statusEl) statusEl.textContent = '完了';
  if (btn) btn.disabled = false;

  // リスト再描画
  const kmListEl = document.getElementById('walk-km-list');
  if (kmListEl) {
    const items = kmListEl.querySelector('.walk-km-list-title').outerHTML.replace(/walk-km-item[\s\S]*/,'');
    const newItems = geocoded.map(m => `
      <div class="walk-km-item" onclick="walkJumpTo(${m.lat},${m.lon})">
        <span class="walk-km-badge">${m.km}km</span>
        <span class="walk-km-time">${_esc(m.time || '')}</span>
        <span class="walk-km-addr">${_esc(m.address || '')}</span>
      </div>`).join('');
    const title = kmListEl.querySelector('.walk-km-list-title');
    title.nextSibling && [...kmListEl.querySelectorAll('.walk-km-item')].forEach(el => el.remove());
    title.insertAdjacentHTML('afterend', newItems);
    if (statusEl) statusEl.textContent = '完了';
  }
}

async function _geocodeKmMarks(marks, statusEl) {
  const result = [];
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i];
    if (statusEl) statusEl.textContent = `住所を取得中... (${m.km}km / ${marks.length}km)`;
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${m.lat}&lon=${m.lon}&format=json&zoom=18&accept-language=ja`,
        { headers: { 'User-Agent': 'SyarioWalkLog/1.0' } }
      );
      if (res.status === 429) {
        if (statusEl) statusEl.textContent = `リクエスト制限のため ${m.km}km 以降をスキップ`;
        result.push(...marks.slice(i).map(mk => ({ ...mk })));
        break;
      }
      const data = await res.json();
      result.push({ ...m, address: _extractJaAddress(data.address) });
    } catch(e) {
      result.push({ ...m, address: '' });
    }
    if (i < marks.length - 1) await new Promise(r => setTimeout(r, 1100));
  }
  return result;
}

function _extractJaAddress(addr) {
  if (!addr) return '';

  // 都道府県：state/province、またはcityが「都道府県」で終わる場合
  const pref = addr.state || addr.province ||
    (/[都道府県]$/.test(addr.city || '') ? addr.city : '') || '';

  // 市区町村：prefと重複しない city/town/county + 政令指定都市の区(suburb)
  const cityRaw = (addr.city && addr.city !== pref ? addr.city : '') ||
    addr.town || addr.county || addr.municipality || '';
  const ward = (addr.suburb && /区$/.test(addr.suburb) && addr.suburb !== cityRaw) ? addr.suburb : '';
  const city = cityRaw ? cityRaw + (ward ? ward : '') : ward;

  // 町名・丁目（上で使ったフィールドを除外）
  const used = new Set([pref, cityRaw, ward].filter(Boolean));
  const candidates = [addr.quarter, addr.road, addr.suburb, addr.neighbourhood]
    .filter(f => f && !used.has(f));
  const town = candidates.find(f => /丁目|番/.test(f)) || candidates[0] || '';

  return [pref, city, town].filter(Boolean).join(' ');
}

function _haversine(a, b) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const s = Math.sin(dLat/2) ** 2 + Math.cos(a.lat * Math.PI/180) * Math.cos(b.lat * Math.PI/180) * Math.sin(dLon/2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1-s));
}

