// ── Xアーカイブ追加 単独ページ ──
// index.html配下の既存実装（xarchive.js / app.js）には一切手を加えず、完全に独立したページとして動作する。
// 保存先は本体サイトの「アーカイブ閲覧/追加」と同じFirebase Storage
// （archives/manifest.json + archives/{username}/{YYYY-MM}.json）なので、
// ここでアップロードしたアーカイブは本体サイトの「アーカイブ閲覧」にそのまま反映される。
// UIは/admins/{uid}の存在でゲートし、実際の書き込み権限はstorage.rulesのUID許可リストで制御される。

const XAA_FIREBASE_CONFIG = {
  apiKey: "AIzaSyDG2F8MDiSpNZWfcISJVCI5kAWaJYF0B7k",
  authDomain: "syariodate.firebaseapp.com",
  projectId: "syariodate",
  messagingSenderId: "494285110412",
  storageBucket: "syariodate.firebasestorage.app",
  appId: "1:494285110412:web:ee00a71bd8866a68890fa9"
};

let _auth = null;
let _db = null;
let _storage = null;
let _currentUser = null;
let _isAdmin = false;

function _esc(s) {
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function init() {
  firebase.initializeApp(XAA_FIREBASE_CONFIG);
  _auth = firebase.auth();
  _db = firebase.firestore();
  _storage = firebase.storage();
  _auth.onAuthStateChanged(async user => {
    _currentUser = user;
    _isAdmin = false;
    if (user) {
      try {
        const doc = await _db.collection('admins').doc(user.uid).get();
        _isAdmin = doc.exists;
      } catch (e) {
        console.warn('管理者チェック失敗:', e);
      }
    }
    renderAuth();
  });
}

function renderAuth() {
  const loadingEl = document.getElementById('auth-loading');
  const loginEl = document.getElementById('auth-login');
  const infoEl = document.getElementById('auth-info');
  const badgeEl = document.getElementById('auth-badge');
  const guardEl = document.getElementById('auth-guard');
  const uidEl = document.getElementById('auth-uid');
  const uploadEl = document.getElementById('upload-section');
  const manifestEl = document.getElementById('manifest-section');

  loadingEl.style.display = 'none';
  if (!_currentUser) {
    loginEl.style.display = '';
    infoEl.style.display = 'none';
    uploadEl.style.display = 'none';
    manifestEl.style.display = 'none';
    return;
  }
  loginEl.style.display = 'none';
  infoEl.style.display = '';
  uidEl.textContent = _currentUser.uid;
  if (_isAdmin) {
    badgeEl.textContent = (_currentUser.displayName || _currentUser.email || '') + ' — 管理者 ✓';
    badgeEl.className = 'xaa-badge';
    guardEl.textContent = '';
    guardEl.className = 'xaa-status';
    uploadEl.style.display = '';
    manifestEl.style.display = '';
    loadManifestList();
  } else {
    badgeEl.textContent = (_currentUser.displayName || _currentUser.email || '') + ' — 管理者ではありません';
    badgeEl.className = 'xaa-badge error';
    guardEl.textContent = 'このアカウントには管理者権限がありません。管理者に連絡してください。';
    guardEl.className = 'xaa-status error';
    uploadEl.style.display = 'none';
    manifestEl.style.display = 'none';
  }
}

// ── ログイン（app.jsの_doLoginと同じ理由で全環境ポップアップ方式） ──
async function _xaaLogin(provider) {
  if (!_auth) return;
  try {
    await _auth.signInWithPopup(provider);
  } catch (e) {
    if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') return;
    if (e.code === 'auth/popup-blocked') {
      alert('ポップアップがブロックされました。ブラウザのポップアップを許可するか、Safari/Chromeなど通常のブラウザで開いてから再度お試しください。');
      return;
    }
    alert('ログインに失敗しました: ' + e.message);
  }
}

function xaaLoginGoogle() { _xaaLogin(new firebase.auth.GoogleAuthProvider()); }
function xaaLoginTwitter() { _xaaLogin(new firebase.auth.TwitterAuthProvider()); }

function xaaLogout() {
  if (!_auth) return;
  _auth.signOut();
}

function xaaCopyUid() {
  if (!_currentUser) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(_currentUser.uid).catch(() => {});
  }
}

// ── 登録済みアカウント一覧 ──
async function loadManifestList() {
  const listEl = document.getElementById('manifest-list');
  listEl.innerHTML = '<div class="xaa-empty">読み込み中...</div>';
  try {
    const url = await _storage.ref('archives/manifest.json').getDownloadURL();
    const manifest = await (await fetch(url)).json();
    const accounts = (manifest && Array.isArray(manifest.accounts)) ? manifest.accounts : [];
    if (!accounts.length) {
      listEl.innerHTML = '<div class="xaa-empty">アーカイブがまだありません</div>';
      return;
    }
    listEl.innerHTML = accounts.map(acc => {
      if (!acc || !acc.username) return '';
      const period = acc.period ? (String(acc.period.from || '').slice(0, 10) + ' 〜 ' + String(acc.period.to || '').slice(0, 10)) : '';
      return `<div class="xaa-manifest-card">
        <div class="xaa-manifest-name">${_esc(acc.display_name || acc.username)}<span class="xaa-manifest-handle">@${_esc(acc.username)}</span></div>
        <div class="xaa-manifest-meta">${acc.total_count || 0}件 / ${(acc.chunks || []).length}チャンク${period ? ' / ' + _esc(period) : ''}</div>
      </div>`;
    }).join('');
  } catch (err) {
    if (err && err.code === 'storage/object-not-found') {
      listEl.innerHTML = '<div class="xaa-empty">アーカイブがまだありません</div>';
    } else if (err && err.code === 'storage/unauthorized') {
      listEl.innerHTML = '<div class="xaa-empty">閲覧権限がありません。UIDをstorage.rulesの許可リストに追加してデプロイしてください。</div>';
    } else {
      listEl.innerHTML = '<div class="xaa-empty">マニフェストの読み込みに失敗しました</div>';
    }
  }
}

// ── ツイート正規化（xarchive.jsの_xaNormalizeTweetと同一ロジック） ──
// 1ツイート要素を正規化。idまたはcreated_atが不正なら null を返す
function _xaNormalizeTweet(el) {
  const t = el && el.tweet ? el.tweet : el;
  if (!t || !t.id_str) return null;
  const createdDate = new Date(t.created_at);
  if (isNaN(createdDate.getTime())) return null;
  const created_at = createdDate.toISOString();

  const rawText = t.full_text || t.text || '';
  let text = rawText;
  const urls = (t.entities && t.entities.urls) || [];
  urls.forEach(function (u) {
    if (u && u.url && u.expanded_url) {
      text = text.split(u.url).join(u.expanded_url);
    }
  });
  const entMedia = (t.entities && t.entities.media) || [];
  entMedia.forEach(function (m) {
    if (m && m.url) {
      text = text.split(m.url).join('');
    }
  });
  text = text.trim();

  let type = 'post';
  let reply_to_username = null;
  let rt_username = null;
  const rtMatch = /^RT @(\w+):/.exec(rawText);
  if (rtMatch) {
    type = 'retweet';
    rt_username = rtMatch[1];
  } else if (t.in_reply_to_screen_name) {
    type = 'reply';
    reply_to_username = t.in_reply_to_screen_name;
  }

  const mediaSrc = (t.extended_entities && t.extended_entities.media) || (t.entities && t.entities.media) || [];
  const media = [];
  mediaSrc.forEach(function (m) {
    if (!m) return;
    if (m.type === 'photo') {
      if (m.media_url_https) media.push({ type: 'photo', url: m.media_url_https });
      return;
    }
    if (m.type === 'video' || m.type === 'animated_gif') {
      const variants = (m.video_info && m.video_info.variants) || [];
      let best = null;
      variants.forEach(function (v) {
        if (v && v.content_type === 'video/mp4') {
          if (!best || (v.bitrate || 0) > (best.bitrate || 0)) best = v;
        }
      });
      const url = best ? best.url : m.media_url_https;
      if (url) media.push({ type: m.type, url: url });
    }
  });

  return {
    id: t.id_str,
    text: text,
    created_at: created_at,
    type: type,
    reply_to_username: reply_to_username,
    rt_username: rt_username,
    media: media,
    like_count: parseInt(t.favorite_count, 10) || 0,
    retweet_count: parseInt(t.retweet_count, 10) || 0
  };
}

// ── アップロード（xarchive.jsのxaUploadと同一ロジック） ──
async function xaUpload() {
  if (!_isAdmin || !_storage) return;

  const statusEl = document.getElementById('xa-add-status');
  const progEl = document.getElementById('xa-add-progress');
  const btnEl = document.getElementById('xa-add-upload-btn');
  const usernameEl = document.getElementById('xa-add-username');
  const displayNameEl = document.getElementById('xa-add-displayname');
  const filesEl = document.getElementById('xa-add-files');

  const _setStatus = function (msg, ok) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.className = 'xaa-status ' + (ok ? 'ok' : 'error');
  };
  const _setProgress = function (msg) {
    if (progEl) progEl.textContent = msg || '';
  };

  let username = (usernameEl && usernameEl.value || '').trim();
  if (username.charAt(0) === '@') username = username.slice(1);
  const displayName = (displayNameEl && displayNameEl.value || '').trim();
  const files = (filesEl && filesEl.files) ? Array.from(filesEl.files) : [];

  if (!username || files.length < 1) {
    _setStatus('ユーザー名とファイルを指定してください。', false);
    return;
  }

  if (btnEl) btnEl.disabled = true;
  _setStatus('', true);
  _setProgress('解析中…');

  try {
    const byId = new Map();
    const skipped = [];

    for (const file of files) {
      try {
        const text = await file.text();
        const start = text.indexOf('[');
        const end = text.lastIndexOf(']');
        if (start === -1 || end === -1 || end < start) throw new Error('array bounds not found');
        const s = text.slice(start, end + 1);
        const arr = JSON.parse(s);
        arr.forEach(function (el) {
          const norm = _xaNormalizeTweet(el);
          if (norm && !byId.has(norm.id)) byId.set(norm.id, norm);
        });
      } catch (e) {
        skipped.push(file.name);
      }
    }

    const allTweets = Array.from(byId.values());
    if (allTweets.length === 0) {
      _setStatus('有効なツイートが見つかりませんでした。' + (skipped.length ? '（解析できず除外: ' + skipped.join(', ') + '）' : ''), false);
      _setProgress('');
      return;
    }

    // 月ごとにグループ化
    const byMonth = new Map();
    allTweets.forEach(function (tw) {
      const month = tw.created_at.slice(0, 7);
      if (!byMonth.has(month)) byMonth.set(month, []);
      byMonth.get(month).push(tw);
    });
    const months = Array.from(byMonth.keys()).sort();
    months.forEach(function (m) {
      byMonth.get(m).sort(function (a, b) { return a.created_at < b.created_at ? -1 : (a.created_at > b.created_at ? 1 : 0); });
    });

    // 月ごとにアップロード
    const chunkCounts = {};
    for (let i = 0; i < months.length; i++) {
      const month = months[i];
      const chunk = byMonth.get(month);
      chunkCounts[month] = chunk.length;
      _setProgress('アップロード中 (' + (i + 1) + '/' + months.length + ')…');
      const path = 'archives/' + username + '/' + month + '.json';
      await _storage.ref(path).putString(JSON.stringify(chunk), 'raw', { contentType: 'application/json' });
    }

    // マニフェストのマージ
    _setProgress('マニフェストを更新中…');
    let manifest;
    try {
      const url = await _storage.ref('archives/manifest.json').getDownloadURL();
      manifest = await (await fetch(url)).json();
    } catch (e) {
      manifest = { generated_at: '', accounts: [] };
    }
    if (!manifest || typeof manifest !== 'object') manifest = { generated_at: '', accounts: [] };
    if (!Array.isArray(manifest.accounts)) manifest.accounts = [];

    const sortedAll = allTweets.slice().sort(function (a, b) { return a.created_at < b.created_at ? -1 : (a.created_at > b.created_at ? 1 : 0); });
    const from = sortedAll[0].created_at;
    const to = sortedAll[sortedAll.length - 1].created_at;

    const accountEntry = {
      username: username,
      display_name: displayName || username,
      chunks: months.map(function (m) {
        return { path: username + '/' + m + '.json', month: m, count: chunkCounts[m] };
      }),
      period: { from: from, to: to },
      total_count: allTweets.length
    };

    const existingIdx = manifest.accounts.findIndex(function (a) { return a && a.username === username; });
    if (existingIdx !== -1) {
      manifest.accounts[existingIdx] = accountEntry;
    } else {
      manifest.accounts.push(accountEntry);
    }
    manifest.generated_at = new Date().toISOString();

    await _storage.ref('archives/manifest.json').putString(JSON.stringify(manifest), 'raw', { contentType: 'application/json' });

    let msg = '@' + username + '（' + (displayName || username) + '）: ' + allTweets.length + '件・' + months.length + 'チャンク・' + from + '〜' + to + ' をアップロードしました。DM等の個人情報は抽出・保存していません。';
    if (skipped.length) msg += '（解析できず除外: ' + skipped.join(', ') + '）';
    _setStatus(msg, true);
    _setProgress('');
    loadManifestList();
  } catch (err) {
    if (err && err.code === 'storage/unauthorized') {
      _setStatus('アップロード権限がありません。あなたのUID（' + (_currentUser ? _currentUser.uid : '不明') + '）をstorage.rulesの許可リストに追加してデプロイしてください。', false);
    } else {
      _setStatus('失敗しました: ' + (err && err.message ? err.message : err), false);
    }
    _setProgress('');
  } finally {
    if (btnEl) btnEl.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', init);
