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

function initWalk() {
  const addBtn = document.getElementById('walk-add-btn');
  if (addBtn) addBtn.style.display = _isAdmin ? '' : 'none';
  if (_walkInited) return;
  _walkInited = true;
  _loadWalkList();
}

async function _loadWalkList() {
  const listEl = document.getElementById('walk-list');
  if (!_db) { listEl.innerHTML = '<div class="empty">Firebase未設定</div>'; return; }
  try {
    const snap = await _db.collection('walk_logs').orderBy('date', 'desc').get();
    if (snap.empty) { listEl.innerHTML = '<div class="empty">まだログがありません</div>'; return; }
    listEl.innerHTML = snap.docs.map(doc => {
      const d = doc.data();
      const label = d.title || d.date;
      const meta = [
        d.date,
        d.distance ? `${d.distance} km` : null,
        d.duration || null,
      ].filter(Boolean).join('　');
      return `<div class="walk-list-item" onclick="openWalkDetail('${doc.id}')">
        <div class="walk-list-title">${_esc(label)}</div>
        <div class="walk-list-meta">${_esc(meta)}</div>
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

  // 地図初期化（既存インスタンスを破棄）
  const mapEl = document.getElementById('walk-map');
  if (_walkMap) { _walkMap.remove(); _walkMap = null; }
  _walkMap = L.map(mapEl);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19
  }).addTo(_walkMap);

  const points = (d.points || []).map(p => [p.lat, p.lon]);
  if (points.length) {
    _walkPolyline = L.polyline(points, { color: '#00E5FF', weight: 4 }).addTo(_walkMap);
    // 始点・終点マーカー
    L.circleMarker(points[0], { radius: 8, color: '#4caf50', fillColor: '#4caf50', fillOpacity: 1 }).addTo(_walkMap);
    L.circleMarker(points[points.length - 1], { radius: 8, color: '#e53935', fillColor: '#e53935', fillOpacity: 1 }).addTo(_walkMap);
    _walkMap.fitBounds(_walkPolyline.getBounds(), { padding: [24, 24] });
  }
}

function closeWalkDetail() {
  document.getElementById('walk-detail').style.display = 'none';
  document.getElementById('walk-list').parentElement.style.display = '';
  if (_walkMap) { _walkMap.remove(); _walkMap = null; }
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

    await _db.collection('walk_logs').add({
      title: title || null,
      date: parsed.date,
      startTime: parsed.startTime,
      endTime: parsed.endTime,
      distance: parsed.distance,
      duration: parsed.duration,
      pace: parsed.pace,
      points: parsed.points,
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

  return { points, date, startTime, endTime, distance: distRounded, duration, pace };
}

function _haversine(a, b) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const s = Math.sin(dLat/2) ** 2 + Math.cos(a.lat * Math.PI/180) * Math.cos(b.lat * Math.PI/180) * Math.sin(dLon/2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1-s));
}

