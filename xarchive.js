// ── Xアーカイブ閲覧（管理者専用） ──
// 複数アカウントのXアーカイブをFirebase Storageのchunk JSONとして保存し、
// 混合時系列タイムラインとして閲覧する。UIは_isAdminでゲート、保存はstorage.rulesの
// 管理者UID許可リストで制御（Storageルールは/adminsを参照できないため直書き）。
// Storage構成: archives/manifest.json, archives/{username}/{YYYY-MM}.json

// ── 閲覧 ──
let _xaManifest = null;
let _xaOrder = 'asc';
let _xaAccounts = {};   // username -> enabled bool
let _xaPosts = [];      // 現在の絞り込み後・マージ済み投稿リスト
let _xaRendered = 0;
let _xaIO = null;

// ── IndexedDBチャンクキャッシュ ──
const _XA_DB_NAME = 'xarchive';
const _XA_STORE = 'chunks';
let _xaDbPromise = null;

function _xaOpenDb() {
  if (_xaDbPromise) return _xaDbPromise;
  _xaDbPromise = new Promise(function (resolve) {
    if (!window.indexedDB) { resolve(null); return; }
    let req;
    try {
      req = indexedDB.open(_XA_DB_NAME, 1);
    } catch (e) { resolve(null); return; }
    req.onupgradeneeded = function () {
      const db = req.result;
      if (!db.objectStoreNames.contains(_XA_STORE)) {
        db.createObjectStore(_XA_STORE, { keyPath: 'path' });
      }
    };
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { resolve(null); };
  });
  return _xaDbPromise;
}

function _xaCacheGet(path) {
  return _xaOpenDb().then(function (db) {
    if (!db) return null;
    return new Promise(function (resolve) {
      try {
        const tx = db.transaction(_XA_STORE, 'readonly');
        const store = tx.objectStore(_XA_STORE);
        const req = store.get(path);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
  }).catch(function () { return null; });
}

function _xaCachePut(path, generated_at, data) {
  return _xaOpenDb().then(function (db) {
    if (!db) return null;
    return new Promise(function (resolve) {
      try {
        const tx = db.transaction(_XA_STORE, 'readwrite');
        const store = tx.objectStore(_XA_STORE);
        store.put({ path: path, generated_at: generated_at, data: data });
        tx.oncomplete = function () { resolve(null); };
        tx.onerror = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
  }).catch(function () { return null; });
}

function _xaCacheClear() {
  return _xaOpenDb().then(function (db) {
    if (!db) return null;
    return new Promise(function (resolve) {
      try {
        const tx = db.transaction(_XA_STORE, 'readwrite');
        tx.objectStore(_XA_STORE).clear();
        tx.oncomplete = function () { resolve(null); };
        tx.onerror = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
  }).catch(function () { return null; });
}

function _xaSetStatus(msg, cls) {
  const el = document.getElementById('xa-status');
  if (!el) return;
  el.textContent = msg || '';
  el.className = 'admin-status' + (cls ? ' ' + cls : '');
}

function _xaSetGuard(msg, cls) {
  const el = document.getElementById('xa-view-guard');
  if (!el) return;
  el.textContent = msg || '';
  el.className = 'admin-status' + (cls ? ' ' + cls : '');
}

async function _xaLoadManifest() {
  if (!_storage) return;
  try {
    const url = await _storage.ref('archives/manifest.json').getDownloadURL();
    const manifest = await (await fetch(url)).json();
    _xaManifest = (manifest && typeof manifest === 'object') ? manifest : { generated_at: '', accounts: [] };
    if (!Array.isArray(_xaManifest.accounts)) _xaManifest.accounts = [];
    _xaSetGuard('', '');
  } catch (err) {
    if (err && err.code === 'storage/object-not-found') {
      _xaManifest = { generated_at: '', accounts: [] };
      _xaSetStatus('アーカイブがまだありません。', '');
    } else if (err && err.code === 'storage/unauthorized') {
      _xaManifest = { generated_at: '', accounts: [] };
      const uid = _currentUser && _currentUser.uid;
      _xaSetGuard('閲覧権限がありません。あなたのUID（' + (uid || '不明') + '）をstorage.rulesの許可リストに追加してデプロイしてください。', 'error');
    } else {
      _xaManifest = { generated_at: '', accounts: [] };
      _xaSetStatus('マニフェストの読み込みに失敗しました: ' + (err && err.message ? err.message : err), 'error');
    }
  }
}

async function _xaLoadChunk(path) {
  const cached = await _xaCacheGet(path);
  if (cached && _xaManifest && cached.generated_at === _xaManifest.generated_at) {
    return cached.data;
  }
  const url = await _storage.ref('archives/' + path).getDownloadURL();
  const data = await (await fetch(url)).json();
  await _xaCachePut(path, _xaManifest ? _xaManifest.generated_at : '', data);
  return data;
}

function _xaRenderAccountChips() {
  const wrap = document.getElementById('xa-accounts');
  if (!wrap) return;
  wrap.innerHTML = '';
  const accounts = (_xaManifest && _xaManifest.accounts) || [];
  accounts.forEach(function (acc) {
    if (!acc || !acc.username) return;
    if (!(acc.username in _xaAccounts)) _xaAccounts[acc.username] = true;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'xa-account-chip' + (_xaAccounts[acc.username] ? ' active' : '');
    chip.innerHTML = _esc(acc.display_name || acc.username) + ' <span class="xa-account-handle">@' + _esc(acc.username) + '</span>';
    chip.addEventListener('click', function () {
      _xaAccounts[acc.username] = !_xaAccounts[acc.username];
      chip.classList.toggle('active', _xaAccounts[acc.username]);
    });
    wrap.appendChild(chip);
  });
}

function _xaSetDateHints() {
  const accounts = (_xaManifest && _xaManifest.accounts) || [];
  if (!accounts.length) return;
  let minD = null, maxD = null;
  accounts.forEach(function (acc) {
    if (!acc || !acc.period) return;
    const from = acc.period.from, to = acc.period.to;
    if (from && (!minD || from < minD)) minD = from;
    if (to && (!maxD || to > maxD)) maxD = to;
  });
  const fromEl = document.getElementById('xa-date-from');
  const toEl = document.getElementById('xa-date-to');
  if (fromEl && minD) fromEl.min = minD.slice(0, 10);
  if (toEl && maxD) toEl.max = maxD.slice(0, 10);
  if (fromEl && maxD) fromEl.max = maxD.slice(0, 10);
  if (toEl && minD) toEl.min = minD.slice(0, 10);
}

async function initAdminXArchive() {
  if (!_isAdmin) return;
  _xaSetGuard('', '');
  _xaSetStatus('読み込み中…', '');
  await _xaLoadManifest();
  _xaRenderAccountChips();
  _xaSetDateHints();
  await xaApplyFilters();
}

// ── 追加（アップロード） ──
function initAdminXArchiveAdd() {
  if (!_isAdmin) return;
  const statusEl = document.getElementById('xa-add-status');
  const progEl = document.getElementById('xa-add-progress');
  if (statusEl) statusEl.textContent = '';
  if (progEl) progEl.textContent = '';
}

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
    statusEl.className = 'admin-status ' + (ok ? 'ok' : 'error');
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
  } catch (err) {
    if (err && err.code === 'storage/unauthorized') {
      _setStatus('アップロード権限がありません。あなたのUIDをstorage.rulesの許可リストに追加してデプロイしてください。', false);
    } else {
      _setStatus('失敗しました: ' + (err && err.message ? err.message : err), false);
    }
    _setProgress('');
  } finally {
    if (btnEl) btnEl.disabled = false;
  }
}

// ── フィルタ・マージ ──
function _xaEnabledUsernames() {
  const accounts = (_xaManifest && _xaManifest.accounts) || [];
  return accounts
    .filter(function (a) { return a && a.username && _xaAccounts[a.username] !== false; })
    .map(function (a) { return a; });
}

function _xaMonthInRange(month, fromMonth, toMonth) {
  if (fromMonth && month < fromMonth) return false;
  if (toMonth && month > toMonth) return false;
  return true;
}

async function xaApplyFilters() {
  if (!_isAdmin) return;
  if (!_xaManifest) await _xaLoadManifest();

  const fromEl = document.getElementById('xa-date-from');
  const toEl = document.getElementById('xa-date-to');
  const searchEl = document.getElementById('xa-search');
  const fromDate = (fromEl && fromEl.value) || '';
  const toDate = (toEl && toEl.value) || '';
  const fromMonth = fromDate ? fromDate.slice(0, 7) : '';
  const toMonth = toDate ? toDate.slice(0, 7) : '';

  const accounts = _xaEnabledUsernames();

  // 読み込むチャンクを決定
  const jobs = [];
  accounts.forEach(function (acc) {
    (acc.chunks || []).forEach(function (chunk) {
      if (chunk && chunk.path && _xaMonthInRange(chunk.month, fromMonth, toMonth)) {
        jobs.push({ acc: acc, chunk: chunk });
      }
    });
  });

  if (!jobs.length) {
    _xaPosts = [];
    _xaRenderReset();
    const allAccounts = (_xaManifest && _xaManifest.accounts) || [];
    let msg = 'アーカイブがまだありません。';
    if (allAccounts.length && !accounts.length) msg = 'アカウントが選択されていません。';
    else if (accounts.length) msg = '対象期間にデータがありません。';
    _xaSetStatus(msg, '');
    return;
  }

  let merged = [];
  let done = 0;
  _xaSetStatus('読み込み中 0/' + jobs.length, '');

  // 小さな同時実行数で順次読み込み
  const CONCURRENCY = 4;
  let idx = 0;
  async function worker() {
    while (idx < jobs.length) {
      const job = jobs[idx++];
      try {
        const data = await _xaLoadChunk(job.chunk.path);
        if (Array.isArray(data)) {
          data.forEach(function (post) {
            if (!post) return;
            merged.push(Object.assign({}, post, {
              _u: job.acc.username,
              _dn: job.acc.display_name || job.acc.username
            }));
          });
        }
      } catch (e) {
        // 個別チャンクの失敗はスキップ（全体は継続）
      }
      done++;
      _xaSetStatus('読み込み中 ' + done + '/' + jobs.length, '');
    }
  }
  const workers = [];
  for (let i = 0; i < Math.min(CONCURRENCY, jobs.length); i++) workers.push(worker());
  await Promise.all(workers);

  // 日付フィルタ（文字列比較で精密に）
  if (fromDate) merged = merged.filter(function (p) { return p.created_at && p.created_at.slice(0, 10) >= fromDate; });
  if (toDate) merged = merged.filter(function (p) { return p.created_at && p.created_at.slice(0, 10) <= toDate; });

  // 検索（スペース区切りAND・大文字小文字無視）
  const rawQuery = (searchEl && searchEl.value || '').trim();
  if (rawQuery) {
    const terms = rawQuery.toLowerCase().split(/\s+/).filter(Boolean);
    merged = merged.filter(function (p) {
      const hay = ((p.text || '') + ' ' + (p._u || '')).toLowerCase();
      return terms.every(function (t) { return hay.indexOf(t) !== -1; });
    });
  }

  // 並べ替え
  merged.sort(function (a, b) {
    const ca = a.created_at || '', cb = b.created_at || '';
    if (ca < cb) return _xaOrder === 'asc' ? -1 : 1;
    if (ca > cb) return _xaOrder === 'asc' ? 1 : -1;
    return 0;
  });

  _xaPosts = merged;
  _xaRenderReset();
  _xaSetStatus(_xaPosts.length + '件（読み込み済みチャンク内を検索対象）', '');
}

// ── レンダリング（増分追加。全件を一度にDOM化しない簡易仮想化） ──
function _xaRenderReset() {
  _xaRendered = 0;
  const timeline = document.getElementById('xa-timeline');
  if (timeline) {
    timeline.innerHTML = '';
    timeline.removeAttribute('data-last-date');
  }
  if (_xaIO) { _xaIO.disconnect(); _xaIO = null; }
  _xaRenderBatch();
}

function _xaLinkify(rawText) {
  const escaped = _esc(rawText || '');
  return escaped.replace(/(https?:\/\/[^\s<]+)/g, function (m) {
    // mは_esc済み。href属性用に " を%22へ（属性を抜けるXSSを防ぐ）。表示テキストはm(エスケープ済)
    const href = m.replace(/"/g, '%22');
    return '<a href="' + href + '" target="_blank" rel="noopener">' + m + '</a>';
  });
}

function _xaPostCardHtml(post) {
  const username = post._u || '';
  const dn = post._dn || username;
  const id = post.id || '';
  let badge = '';
  if (post.type === 'retweet') {
    badge = '<span class="xa-badge xa-badge-rt">RT</span>';
  } else if (post.type === 'reply') {
    badge = '<span class="xa-badge xa-badge-reply">リプ</span>';
  }
  let subline = '';
  if (post.type === 'retweet' && post.rt_username) {
    subline = '<div class="xa-post-sub">RT @' + _esc(post.rt_username) + '</div>';
  } else if (post.type === 'reply' && post.reply_to_username) {
    subline = '<div class="xa-post-sub">@' + _esc(post.reply_to_username) + ' への返信</div>';
  }

  const media = (post.media || []).slice(0, 4);
  let mediaHtml = '';
  if (media.length) {
    const items = media.map(function (m) {
      if (!m || !m.url) return '';
      const safeUrl = _escHtml(m.url);
      if (m.type === 'photo') {
        return '<a class="xa-media-item" href="' + safeUrl + '" target="_blank" rel="noopener">' +
          '<img loading="lazy" src="' + safeUrl + '" onerror="this.classList.add(\'xa-media-err\')" alt=""></a>';
      }
      return '<div class="xa-media-item"><video controls preload="none" src="' + safeUrl + '"></video></div>';
    }).join('');
    mediaHtml = '<div class="xa-post-media xa-post-media-' + media.length + '">' + items + '</div>';
  }

  const dt = post.created_at ? new Date(post.created_at) : null;
  const dtLabel = dt && !isNaN(dt.getTime()) ? dt.toLocaleString('ja-JP') : '';

  const safeUsernameAttr = _escHtml(username).replace(/'/g, '&#39;');
  const safeIdAttr = _escHtml(String(id)).replace(/'/g, '&#39;');

  return (
    '<div class="xa-post">' +
      '<div class="xa-post-head">' +
        '<span class="xa-post-name">' + _esc(dn) + '</span>' +
        '<span class="xa-post-handle">@' + _esc(username) + '</span>' +
        badge +
      '</div>' +
      subline +
      '<div class="xa-post-body">' + _xaLinkify(post.text) + '</div>' +
      mediaHtml +
      '<div class="xa-post-foot">' +
        '<span class="xa-post-time">' + _esc(dtLabel) + '</span>' +
        '<button type="button" class="admin-btn sm" onclick="xaCopyPostUrl(\'' + safeUsernameAttr + '\',\'' + safeIdAttr + '\')">コピー</button>' +
      '</div>' +
    '</div>'
  );
}

const _XA_BATCH_SIZE = 50;

function _xaRenderBatch() {
  const timeline = document.getElementById('xa-timeline');
  if (!timeline) return;

  // 既存のsentinelを除去してから追記する
  const oldSentinel = timeline.querySelector('.xa-sentinel');
  if (oldSentinel) oldSentinel.remove();

  const start = _xaRendered;
  const end = Math.min(_xaPosts.length, start + _XA_BATCH_SIZE);
  const frag = document.createDocumentFragment();
  let lastDateKey = timeline.getAttribute('data-last-date') || null;

  for (let i = start; i < end; i++) {
    const post = _xaPosts[i];
    const dt = post.created_at ? new Date(post.created_at) : null;
    const dateKey = dt && !isNaN(dt.getTime()) ? dt.toLocaleDateString('ja-JP') : null;
    if (dateKey && dateKey !== lastDateKey) {
      const sep = document.createElement('div');
      sep.className = 'xa-date-sep';
      sep.textContent = dt.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });
      frag.appendChild(sep);
      lastDateKey = dateKey;
    }
    const wrap = document.createElement('div');
    wrap.innerHTML = _xaPostCardHtml(post);
    frag.appendChild(wrap.firstChild);
  }
  timeline.setAttribute('data-last-date', lastDateKey || '');
  timeline.appendChild(frag);
  _xaRendered = end;

  if (_xaRendered < _xaPosts.length) {
    const sentinel = document.createElement('div');
    sentinel.className = 'xa-sentinel';
    timeline.appendChild(sentinel);
    if (_xaIO) _xaIO.disconnect();
    _xaIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          _xaRenderBatch();
        }
      });
    }, { root: null, rootMargin: '400px' });
    _xaIO.observe(sentinel);
  } else if (_xaIO) {
    _xaIO.disconnect();
    _xaIO = null;
  }
}

// ── ハンドラ ──
function xaClearDates() {
  const fromEl = document.getElementById('xa-date-from');
  const toEl = document.getElementById('xa-date-to');
  if (fromEl) fromEl.value = '';
  if (toEl) toEl.value = '';
}

function xaToggleOrder() {
  _xaOrder = (_xaOrder === 'asc') ? 'desc' : 'asc';
  const label = document.getElementById('xa-order-label');
  if (label) label.textContent = (_xaOrder === 'asc') ? '古い順' : '新しい順';
  xaApplyFilters();
}

async function xaReload() {
  _xaSetStatus('再読込中…', '');
  await _xaLoadManifest();
  _xaRenderAccountChips();
  _xaSetDateHints();
  await xaApplyFilters();
}

async function xaClearCache() {
  await _xaCacheClear();
  _xaSetStatus('キャッシュを削除しました。', 'ok');
}

function xaCopyPostUrl(username, id) {
  const url = 'https://x.com/' + username + '/status/' + id;
  const done = function () { _xaSetStatus('URLをコピーしました。', 'ok'); };
  const fail = function () { _xaSetStatus('コピーに失敗しました: ' + url, 'error'); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(done, fail);
  } else {
    fail();
  }
}
