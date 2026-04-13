// ── 掲示板 ──
let _boardAnonName = null;
let _boardInited = false;
let _boardUnsubscribe = null;

async function _getAnonName() {
  if (_boardAnonName) return _boardAnonName;
  try {
    const res = await fetch('https://api.ipify.org?format=json');
    const { ip } = await res.json();
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('board:' + ip));
    const hex = Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
    _boardAnonName = 'ゲスト#' + hex.slice(0, 4).toUpperCase();
  } catch {
    _boardAnonName = 'ゲスト#' + Math.random().toString(16).slice(2,6).toUpperCase();
  }
  return _boardAnonName;
}

async function initBoard() {
  const nameEl = document.getElementById('board-anon-name');
  const name = await _getAnonName();
  nameEl.textContent = name;

  if (_boardInited) return;
  _boardInited = true;

  if (!_db) { document.getElementById('board-comments-list').innerHTML = '<div class="board-empty">Firebase未設定</div>'; return; }
  if (_boardUnsubscribe) _boardUnsubscribe();
  _boardUnsubscribe = _db.collection('board_comments')
    .orderBy('ts', 'desc')
    .limit(100)
    .onSnapshot(snap => {
      const list = document.getElementById('board-comments-list');
      if (snap.empty) { list.innerHTML = '<div class="board-empty">まだコメントがありません</div>'; return; }
      list.innerHTML = snap.docs.map(d => {
        const data = d.data();
        const ts = data.ts?.toDate ? data.ts.toDate() : new Date();
        const timeStr = `${ts.getFullYear()}/${String(ts.getMonth()+1).padStart(2,'0')}/${String(ts.getDate()).padStart(2,'0')} ${String(ts.getHours()).padStart(2,'0')}:${String(ts.getMinutes()).padStart(2,'0')}`;
        const body = (data.body||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        const canDel = (data.uid && _currentUser && data.uid === _currentUser.uid) || _isAdmin;
        return `<div class="board-comment">
          <div class="board-comment-header">
            <span class="board-comment-name">${(data.name||'ゲスト').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</span>
            <span class="board-comment-time">${timeStr}</span>
            ${canDel ? `<button class="board-delete-btn" onclick="deleteBoardComment('${d.id}')">削除</button>` : ''}
          </div>
          <div class="board-comment-body">${body}</div>
        </div>`;
      }).join('');
    }, () => {
      document.getElementById('board-comments-list').innerHTML = '<div class="board-empty">読み込みに失敗しました</div>';
    });
}

async function submitBoardComment() {
  const input = document.getElementById('board-input');
  const btn = document.getElementById('board-submit-btn');
  const status = document.getElementById('board-status');
  const body = input.value.trim();
  if (!body) return;
  if (!_db) { status.textContent = 'Firebase未設定'; return; }
  btn.disabled = true; btn.textContent = '投稿中...';
  status.textContent = '';
  try {
    const name = await _getAnonName();
    const commentData = { name, body, ts: firebase.firestore.FieldValue.serverTimestamp() };
    if (_currentUser) commentData.uid = _currentUser.uid;
    await _db.collection('board_comments').add(commentData);
    fetch('https://discord.com/api/webhooks/1486189645833441443/KBOhyzxqwrKZBOeO3rendcplyj4cSsCPaitB_VTghmHIMXQWvK5iC8-ZcA33Ex5vgD4Q', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: name, content: body })
    });
    input.value = '';
    _boardInited = false; // force re-listen on next init
    initBoard();
  } catch(e) {
    status.textContent = '投稿に失敗しました';
  } finally {
    btn.disabled = false; btn.textContent = '投稿';
  }
}

async function deleteBoardComment(docId) {
  if (!_db || !_currentUser) return;
  if (!confirm('このコメントを削除しますか？')) return;
  try {
    await _db.collection('board_comments').doc(docId).delete();
  } catch(e) {
    alert('削除に失敗しました: ' + e.message);
  }
}

function _resetBoard() {
  if (_boardUnsubscribe) { _boardUnsubscribe(); _boardUnsubscribe = null; }
  _boardInited = false;
}

function _refreshBoardIfActive() {
  if (currentSection === 'board') {
    _resetBoard();
    initBoard();
  }
}
