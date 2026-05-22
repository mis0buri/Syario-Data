// ── コラム ──
const COLUMN_GENRES = ['戦術・戦略', '牌効率', '役・役満', '観戦記', '大会・イベント', '日記・エッセイ', '初心者向け', 'ルール解説', 'マナー・礼儀', 'その他'];

let _colSortField = 'createdAt';
let _colSortDir = 'desc';
let _colMyOnly = false;
let _colGenre = '';
let _colCurrentId = null;
let _colDirty = false;

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
  const genreEl = document.getElementById('col-filter-genre');
  const myOnlyEl = document.getElementById('col-my-only');
  if (fieldEl) fieldEl.value = _colSortField;
  if (dirEl) dirEl.value = _colSortDir;
  if (genreEl) genreEl.value = _colGenre;
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

    // ジャンルフィルタ
    if (_colGenre) docs = docs.filter(d => d.genre === _colGenre);

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

function colChangeGenre(val) {
  _colGenre = val;
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

window.addEventListener('beforeunload', e => {
  if (_colDirty) { e.preventDefault(); e.returnValue = ''; }
});

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

let _colSelectedImg = null;

function _colSetupImgPicker(bodyEl) {
  bodyEl.onclick = e => {
    const picker = document.getElementById('col-img-picker');
    if (e.target.tagName === 'IMG') {
      _colSelectedImg = e.target;
      const rect = e.target.getBoundingClientRect();
      const bodyRect = bodyEl.getBoundingClientRect();
      picker.style.display = 'flex';
      picker.style.top = (rect.bottom - bodyRect.top + bodyEl.scrollTop + 4) + 'px';
      picker.style.left = (rect.left - bodyRect.left) + 'px';
    } else {
      _colSelectedImg = null;
      if (picker) picker.style.display = 'none';
    }
  };
}

function colResizeSelectedImg(width) {
  if (!_colSelectedImg) return;
  _colSelectedImg.style.width = width;
  _colSelectedImg.style.maxWidth = '100%';
  document.getElementById('col-img-picker').style.display = 'none';
  _colSelectedImg = null;
}

function _colInitEditor(data) {
  const titleEl = document.getElementById('col-edit-title');
  if (titleEl) titleEl.value = data ? (data.title || '') : '';

  const authorEl = document.getElementById('col-edit-author');
  if (authorEl) authorEl.value = data ? (data.authorName || '') : (_registeredName || '匿名');

  const genreEl = document.getElementById('col-edit-genre');
  if (genreEl) genreEl.value = data ? (data.genre || '') : '';

  const bodyEl = document.getElementById('col-edit-body');
  if (bodyEl) {
    bodyEl.innerHTML = data ? (data.body || '') : '';
    _colSetupImgPicker(bodyEl);
    bodyEl.oninput = () => { _colDirty = true; };
  }

  const picker = document.getElementById('col-img-picker');
  if (picker) picker.style.display = 'none';
  _colSelectedImg = null;
  _colDirty = false;

  document.getElementById('col-edit-title').oninput = () => { _colDirty = true; };

  const statusEl = document.getElementById('col-edit-status');
  if (statusEl) statusEl.textContent = '';
}

function colConfirmLeave() {
  if (!_colDirty) return true;
  const ok = confirm('編集中の内容が失われますが、よろしいですか？');
  if (ok) _colDirty = false;
  return ok;
}

async function submitColumn(saveStatus) {
  _colDirty = false;
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
  const input = document.getElementById('col-img-file');
  if (input) { input.value = ''; input.click(); }
}

function colHandleImageFile(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const MAX = 1200;
      const scale = img.width > MAX ? MAX / img.width : 1;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      const body = document.getElementById('col-edit-body');
      if (body) body.focus();
      document.execCommand('insertHTML', false, `<img src="${dataUrl}" style="width:100%;max-width:100%;">`);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// ── 共有 ──
async function shareColumn() {
  const id = _colCurrentId;
  if (!id || !_db) return;
  const btn = document.getElementById('col-detail-share-btn');
  const orig = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '生成中...'; }

  try {
    const docSnap = await _db.collection('columns').doc(id).get();
    if (!docSnap.exists) return;
    const data = { id: docSnap.id, ...docSnap.data() };

    await document.fonts.ready;
    const W = 720, pad = 36;

    // 本文テキストを抽出（HTMLタグ除去、最大200文字）
    const tmpDiv = document.createElement('div');
    tmpDiv.innerHTML = _sanitizeColumnBody(data.body || '');
    const bodyText = (tmpDiv.textContent || '').replace(/\s+/g, ' ').trim();
    const snippet = bodyText.length > 160 ? bodyText.slice(0, 160) + '…' : bodyText;

    // スニペットを折り返し（30文字/行）
    const snippetLines = [];
    for (let i = 0; i < snippet.length; i += 30) snippetLines.push(snippet.slice(i, i + 30));

    const ts = data.createdAt?.toDate ? data.createdAt.toDate() : null;
    const dateStr = ts ? ts.toLocaleDateString('ja-JP') : '';
    const metaStr = [data.authorName || '匿名', dateStr, data.genre].filter(Boolean).join('　');

    const H = 80 + 50 + 30 + 16 + snippetLines.length * 22 + 40;
    const dpr = 2;
    const canvas = document.createElement('canvas');
    canvas.width = W * dpr; canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#21252b'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#c8a96e'; ctx.fillRect(0, 0, 6, H);

    ctx.fillStyle = '#dde2ec';
    ctx.font = "bold 22px 'Noto Sans JP', sans-serif";
    ctx.fillText(_truncate(data.title || '（タイトルなし）', 30), pad, 50);

    ctx.fillStyle = '#7f848e';
    ctx.font = "13px 'Noto Sans JP', sans-serif";
    ctx.fillText(metaStr, pad, 78);

    ctx.strokeStyle = '#3a3f4b'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad, 94); ctx.lineTo(W - pad, 94); ctx.stroke();

    ctx.fillStyle = '#abb2bf';
    ctx.font = "14px 'Noto Sans JP', sans-serif";
    snippetLines.forEach((line, i) => { ctx.fillText(line, pad, 118 + i * 22); });

    const shareUrl = location.origin + location.pathname + '#column/' + id;
    const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
    const file = new File([blob], 'column-' + id + '.png', { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], text: shareUrl }); }
      catch(e) { if (e.name === 'AbortError') return; }
    } else {
      try { await navigator.clipboard.writeText(shareUrl); } catch {}
      alert('URLをコピーしました: ' + shareUrl);
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = orig; }
  }
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
