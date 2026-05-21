// ── コラム ──
const COLUMN_GENRES = ['戦術・戦略', '観戦記', '日記・エッセイ', '初心者向け', 'その他'];

let _colSortField = 'createdAt';
let _colSortDir = 'desc';
let _colMyOnly = false;
let _colCurrentId = null;

// ── ビュー切替 ──
function _colShowView(viewId) {
  document.querySelectorAll('#sec-column .column-view').forEach(v => v.classList.remove('active'));
  const el = document.getElementById(viewId);
  if (el) el.classList.add('active');
}

// ── 一覧 ──
async function initColumn() {
  _colShowView('column-list-view');
  history.replaceState(null, '', '#column');
  _colRenderSortBar();
  await _colLoadList();
}

function _colRenderSortBar() {
  const fieldEl = document.getElementById('col-sort-field');
  const dirEl = document.getElementById('col-sort-dir');
  const myOnlyEl = document.getElementById('col-my-only');
  if (fieldEl) fieldEl.value = _colSortField;
  if (dirEl) dirEl.value = _colSortDir;
  if (myOnlyEl) {
    myOnlyEl.parentElement.style.display = _currentUser ? '' : 'none';
    myOnlyEl.checked = _colMyOnly;
  }
}

async function _colLoadList() {
  const listEl = document.getElementById('column-list');
  if (!listEl) return;
  listEl.innerHTML = '<div class="col-empty">読み込み中...</div>';
  if (!_db) { listEl.innerHTML = '<div class="col-empty">データベース未接続</div>'; return; }
  try {
    const snap = await _db.collection('columns').get();
    let docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // 権限フィルタ: 下書きは本人か管理者のみ
    docs = docs.filter(d => {
      if (d.status === 'published') return true;
      if (_isAdmin) return true;
      if (_currentUser && d.authorUid === _currentUser.uid) return true;
      return false;
    });

    // 自分の記事フィルタ
    if (_colMyOnly && _currentUser) {
      docs = docs.filter(d => d.authorUid === _currentUser.uid);
    }

    // ソート
    docs.sort((a, b) => {
      let av, bv;
      if (_colSortField === 'createdAt') {
        av = a.createdAt?.toMillis?.() || 0;
        bv = b.createdAt?.toMillis?.() || 0;
      } else if (_colSortField === 'authorName') {
        av = a.authorName || '';
        bv = b.authorName || '';
      } else if (_colSortField === 'title') {
        av = a.title || '';
        bv = b.title || '';
      }
      if (av < bv) return _colSortDir === 'asc' ? -1 : 1;
      if (av > bv) return _colSortDir === 'asc' ? 1 : -1;
      return 0;
    });

    if (!docs.length) {
      listEl.innerHTML = '<div class="col-empty">まだコラムがありません</div>';
      return;
    }

    listEl.innerHTML = docs.map(doc => {
      const isDraft = doc.status === 'draft';
      const ts = doc.createdAt?.toDate ? doc.createdAt.toDate() : null;
      const dateStr = ts ? ts.toLocaleDateString('ja-JP') : '—';
      return `<div class="col-card" onclick="openColumnDetail('${_escHtml(doc.id)}')">
        <div class="col-card-header">
          <span class="col-card-title">${_esc(doc.title || '（タイトルなし）')}</span>
          ${isDraft ? '<span class="col-draft-badge">下書き</span>' : ''}
          ${doc.genre ? `<span class="col-genre-badge">${_esc(doc.genre)}</span>` : ''}
        </div>
        <div class="col-card-meta">
          <span>${_esc(doc.authorName || '匿名')}</span>
          <span>${dateStr}</span>
        </div>
      </div>`;
    }).join('');
  } catch(e) {
    listEl.innerHTML = '<div class="col-empty">読み込みに失敗しました: ' + _esc(e.message) + '</div>';
  }
}

function colChangeSortField(val) {
  _colSortField = val;
  _colLoadList();
}

function colChangeSortDir(val) {
  _colSortDir = val;
  _colLoadList();
}

function colToggleMyOnly(checked) {
  _colMyOnly = checked;
  _colLoadList();
}

// ── 詳細 ──
async function openColumnDetail(id) {
  _colCurrentId = id;
  history.replaceState(null, '', '#column/' + id);
  _colShowView('column-detail-view');
  const contentEl = document.getElementById('col-detail-content');
  if (contentEl) contentEl.innerHTML = '<div class="col-empty">読み込み中...</div>';
  if (!_db) return;
  try {
    const doc = await _db.collection('columns').doc(id).get();
    if (!doc.exists) {
      if (contentEl) contentEl.innerHTML = '<div class="col-empty">記事が見つかりません</div>';
      return;
    }
    const data = { id: doc.id, ...doc.data() };
    _colRenderDetail(data);
  } catch(e) {
    if (contentEl) contentEl.innerHTML = '<div class="col-empty">読み込みに失敗しました: ' + _esc(e.message) + '</div>';
  }
}

function _colRenderDetail(data) {
  const titleEl = document.getElementById('col-detail-title');
  if (titleEl) titleEl.textContent = data.title || '（タイトルなし）';

  const metaEl = document.getElementById('col-detail-meta');
  if (metaEl) {
    const ts = data.createdAt?.toDate ? data.createdAt.toDate() : null;
    const dateStr = ts ? ts.toLocaleString('ja-JP') : '—';
    metaEl.innerHTML = `
      <span>${_esc(data.authorName || '匿名')}</span>
      <span>${dateStr}</span>
      ${data.genre ? `<span class="col-genre-badge">${_esc(data.genre)}</span>` : ''}
      ${data.status === 'draft' ? '<span class="col-draft-badge">下書き</span>' : ''}
    `;
  }

  const bodyEl = document.getElementById('col-detail-content');
  if (bodyEl) bodyEl.innerHTML = _sanitizeColumnBody(data.body || '');

  const canEdit = (_currentUser && data.authorUid && data.authorUid === _currentUser.uid) || _isAdmin;
  const actionsEl = document.getElementById('col-detail-actions');
  if (actionsEl) {
    actionsEl.style.display = canEdit ? '' : 'none';
    const editBtn = document.getElementById('col-detail-edit-btn');
    if (editBtn) editBtn.onclick = () => openColumnEdit(data);
    const delBtn = document.getElementById('col-detail-delete-btn');
    if (delBtn) delBtn.onclick = () => deleteColumn(data.id);
  }
}

// ── 編集ビュー ──
let _colEditId = null;

function openColumnNew() {
  if (!_currentUser) {
    const hint = document.getElementById('col-login-hint');
    if (hint) {
      hint.style.display = '';
      setTimeout(() => { hint.style.display = 'none'; }, 4000);
    }
    return;
  }
  _colEditId = null;
  _colShowView('column-edit-view');
  history.replaceState(null, '', '#column');
  _colInitEditor(null);
}

function openColumnEdit(data) {
  _colEditId = data.id;
  _colShowView('column-edit-view');
  history.replaceState(null, '', '#column');
  _colInitEditor(data);
}

function _colInitEditor(data) {
  const titleEl = document.getElementById('col-edit-title');
  if (titleEl) titleEl.value = data ? (data.title || '') : '';

  const authorEl = document.getElementById('col-edit-author');
  if (authorEl) authorEl.value = data ? (data.authorName || '') : (_registeredName || '匿名');

  const genreEl = document.getElementById('col-edit-genre');
  if (genreEl) genreEl.value = data ? (data.genre || '') : '';

  const bodyEl = document.getElementById('col-edit-body');
  if (bodyEl) bodyEl.innerHTML = data ? (data.body || '') : '';

  const statusEl = document.getElementById('col-edit-status');
  if (statusEl) statusEl.textContent = '';
}

async function submitColumn(saveStatus) {
  if (!_db || !_currentUser) return;
  const statusEl = document.getElementById('col-edit-status');
  const publishBtn = document.getElementById('col-publish-btn');
  const draftBtn = document.getElementById('col-draft-btn');
  if (statusEl) statusEl.textContent = '';
  if (publishBtn) publishBtn.disabled = true;
  if (draftBtn) draftBtn.disabled = true;

  const title = (document.getElementById('col-edit-title').value || '').trim();
  const authorName = (document.getElementById('col-edit-author').value || '').trim() || '匿名';
  const genre = document.getElementById('col-edit-genre').value || '';
  const body = document.getElementById('col-edit-body').innerHTML || '';

  if (!title) {
    if (statusEl) statusEl.textContent = 'タイトルを入力してください';
    if (publishBtn) publishBtn.disabled = false;
    if (draftBtn) draftBtn.disabled = false;
    return;
  }

  try {
    const now = firebase.firestore.FieldValue.serverTimestamp();
    if (_colEditId) {
      await _db.collection('columns').doc(_colEditId).update({
        title, authorName, genre, body, status: saveStatus, updatedAt: now
      });
      if (saveStatus === 'published') {
        await openColumnDetail(_colEditId);
      } else {
        await initColumn();
      }
    } else {
      const ref = await _db.collection('columns').add({
        title, authorName, genre, body, status: saveStatus,
        authorUid: _currentUser.uid,
        createdAt: now, updatedAt: now
      });
      if (saveStatus === 'published') {
        await openColumnDetail(ref.id);
      } else {
        await initColumn();
      }
    }
  } catch(e) {
    if (statusEl) statusEl.textContent = 'エラー: ' + e.message;
    if (publishBtn) publishBtn.disabled = false;
    if (draftBtn) draftBtn.disabled = false;
  }
}

// ── 削除 ──
async function deleteColumn(id) {
  if (!_db || !_currentUser) return;
  if (!confirm('このコラムを削除しますか？')) return;
  try {
    await _db.collection('columns').doc(id).delete();
    await initColumn();
  } catch(e) {
    alert('削除に失敗しました: ' + e.message);
  }
}

// ── エディタ ツールバー ──
function colFormatFontSize(size) {
  const sizeMap = { small: '0.8em', normal: '1em', large: '1.4em', xlarge: '1.8em' };
  document.execCommand('fontSize', false, '7');
  document.querySelectorAll('#col-edit-body font[size="7"]').forEach(el => {
    el.removeAttribute('size');
    el.style.fontSize = sizeMap[size] || '1em';
  });
}

function colFormatColor(color) {
  document.execCommand('foreColor', false, color);
}

function colFormatAlign(dir) {
  document.execCommand('justify' + dir);
}

function colInsertImage() {
  const url = prompt('画像URLを入力してください');
  if (!url) return;
  const sizeKey = prompt('サイズを選択してください\n1: 小（25%）\n2: 中（50%）\n3: 大（75%）\n4: 全幅（100%）') || '4';
  const width = { '1': '25%', '2': '50%', '3': '75%', '4': '100%' }[sizeKey] || '100%';
  const body = document.getElementById('col-edit-body');
  if (body) body.focus();
  document.execCommand('insertHTML', false, `<img src="${_escHtml(url)}" style="width:${width};max-width:100%;">`);
}

// ── サニタイズ ──
function _sanitizeColumnBody(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,iframe,form,input,button').forEach(el => el.remove());
  doc.querySelectorAll('*').forEach(el => {
    Array.from(el.attributes).forEach(attr => {
      if (!['style', 'src', 'alt', 'class', 'href'].includes(attr.name)) el.removeAttribute(attr.name);
    });
    if (el.style) {
      const safe = {};
      ['color', 'font-size', 'font-weight', 'font-style', 'text-decoration', 'text-align', 'width', 'max-width'].forEach(p => {
        if (el.style[p]) safe[p] = el.style[p];
      });
      el.removeAttribute('style');
      Object.entries(safe).forEach(([k, v]) => el.style.setProperty(k, v));
    }
  });
  return doc.body.innerHTML;
}
