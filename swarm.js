// ── Swarm連携機能 ──
const SWARM_DEFAULT_TEMPLATE = "I'm at {venue} in {area}, {state} {url}";
const SWARM_FOURSQUARE_API_VERSION = '20231010';

// ns（名前空間）ごとに別々のFoursquareアプリ／連携状態を持てるようにする
// main  = メインタブ「Swarm連携」（サイト全体で共有するClient ID。誰でも連携可能）
// admin = 管理者メニュー「Swarm連携」（管理者専用の別アプリ・別Client ID）
// redirectPages = そのClient IDでOAuthを開始する全ページ（サイトのベースパスからの相対・正規形）。
//   未登録のURIからは連携できないため、ここから作ったURIは全てFoursquare側に登録する。
//   main は swarm-app.html / swarm/（swarm-app.js）も同じClient IDを使う。
const SWARM_NS = {
  main:  { idPrefix: 'swarm',  configDoc: 'swarm',       accountCollection: 'swarm_accounts',       redirectPages: ['', 'swarm-app.html', 'swarm/'] },
  admin: { idPrefix: 'aswarm', configDoc: 'swarm_admin',  accountCollection: 'swarm_accounts_admin', redirectPages: [''] }
};

const _swarmState = {
  main:  { config: null, account: null, checkins: [], venueResults: [], selectedVenue: null },
  admin: { config: null, account: null, checkins: [], venueResults: [], selectedVenue: null }
};

// ── セクション開閉 ──
function toggleSwarmPanel(bodyId, arrowId) {
  const body = document.getElementById(bodyId);
  const arrow = document.getElementById(arrowId);
  const open = body.classList.toggle('open');
  arrow.classList.toggle('open', open);
}

// ── 初期化 ──
async function initSwarm(ns) {
  const cfg = SWARM_NS[ns];
  const st = _swarmState[ns];
  const pfx = cfg.idPrefix;

  await _loadSwarmConfig(ns);
  if (ns !== 'main' || _isAdmin) {
    _renderSwarmRedirectUris(ns);
    if (st.config) {
      document.getElementById(pfx+'-client-id').value = st.config.clientId || '';
      document.getElementById(pfx+'-proxy-prefix').value = st.config.proxyPrefix || '';
    }
  }

  await _loadSwarmAccount(ns);
  _renderSwarmAccountStatus(ns);
  if (st.account && st.account.accessToken) {
    // 連携済みの場合はアカウント連携パネルを初期状態で畳んでおく
    const accountBody = document.getElementById(pfx+'-account-body');
    const accountArrow = document.getElementById(pfx+'-account-arrow');
    if (accountBody) accountBody.classList.remove('open');
    if (accountArrow) accountArrow.classList.remove('open');
    fetchSwarmCheckins(ns);
  } else {
    _renderSwarmCheckinList(ns);
  }
}

async function _loadSwarmConfig(ns) {
  const cfg = SWARM_NS[ns];
  const st = _swarmState[ns];
  st.config = null;
  if (!_db) return;
  try {
    const doc = await _db.collection('admin_config').doc(cfg.configDoc).get();
    if (doc.exists) st.config = doc.data();
  } catch(e) {
    console.warn('Swarm設定読み込みエラー:', e);
  }
}

async function _loadSwarmAccount(ns) {
  const cfg = SWARM_NS[ns];
  const st = _swarmState[ns];
  st.account = null;
  if (_currentUser && _db) {
    try {
      const doc = await _db.collection(cfg.accountCollection).doc(_currentUser.uid).get();
      if (doc.exists) st.account = doc.data();
    } catch(e) {
      console.warn('Swarmアカウント読み込みエラー:', e);
    }
    if (st.account) return;
  }
  // 未ログイン、またはFirestoreに連携情報がない場合はローカル保存分を使う（引き継ぎ済みの分は単独ページ専用なので除く）
  const local = _readSwarmLocalAccount(ns);
  if (local && local.accessToken && !local.migratedTo) st.account = local;
}

function _swarmLocalAccountKey(ns) {
  return 'swarm_local_account_' + ns;
}

// main のキーは Swarm連携単独ページ（swarm-app.js）も自分の連携情報として読み書きする。
// そのため、ログイン時にFirestoreへ引き継いでも消さずに migratedTo（引き継ぎ先uid）を付けて残し、
// 以後このSPAでは（ログイン状態に関わらず）読みも消しもしない（単独ページの連携が消えないようにするため）
function _readSwarmLocalAccount(ns) {
  try { return JSON.parse(localStorage.getItem(_swarmLocalAccountKey(ns))); } catch(e) { return null; }
}

function _renderSwarmAccountStatus(ns) {
  const cfg = SWARM_NS[ns];
  const st = _swarmState[ns];
  const pfx = cfg.idPrefix;
  const statusEl = document.getElementById(pfx+'-account-status');
  const adminConfigEl = document.getElementById(pfx+'-admin-config'); // mainのみ存在
  const notConfiguredEl = document.getElementById(pfx+'-not-configured');
  const connectFormEl = document.getElementById(pfx+'-connect-form');
  const linkedEl = document.getElementById(pfx+'-linked-info');
  if (adminConfigEl) adminConfigEl.style.display = _isAdmin ? '' : 'none';
  statusEl.style.display = 'none';
  if (st.account && st.account.accessToken) {
    notConfiguredEl.style.display = 'none';
    connectFormEl.style.display = 'none';
    linkedEl.style.display = '';
    const clientIdSuffix = (ns !== 'main' || _isAdmin) && st.config && st.config.clientId ? '（Client ID: ' + st.config.clientId + '）' : '';
    const loginHint = _currentUser ? '' : '　※ログインすると連携情報が保存され、機種変更後も復元できます';
    document.getElementById(pfx+'-linked-user').textContent = '連携済み' + clientIdSuffix + loginHint;
  } else if (st.config && st.config.clientId) {
    notConfiguredEl.style.display = 'none';
    connectFormEl.style.display = '';
    linkedEl.style.display = 'none';
  } else {
    notConfiguredEl.style.display = '';
    connectFormEl.style.display = 'none';
    linkedEl.style.display = 'none';
  }
}

// ── Foursquareアプリ設定（管理者のみ） ──
async function saveSwarmConfig(ns) {
  const cfg = SWARM_NS[ns];
  const st = _swarmState[ns];
  const pfx = cfg.idPrefix;
  const statusEl = document.getElementById(pfx+'-status-settings');
  if (!_isAdmin) return;
  const clientId = document.getElementById(pfx+'-client-id').value.trim();
  const proxyPrefix = document.getElementById(pfx+'-proxy-prefix').value.trim();
  if (!clientId) {
    statusEl.textContent = 'Client IDを入力してください';
    statusEl.className = 'admin-status error';
    return;
  }
  try {
    await _db.collection('admin_config').doc(cfg.configDoc).set({ clientId, proxyPrefix }, { merge: true });
    st.config = { clientId, proxyPrefix };
    statusEl.textContent = '保存しました ✓';
    statusEl.className = 'admin-status ok';
    _renderSwarmAccountStatus(ns);
  } catch(e) {
    statusEl.textContent = '保存に失敗しました: ' + e.message;
    statusEl.className = 'admin-status error';
  }
}

// ── 連携（OAuth） ──
// GitHub Pagesでは同じページが複数のURLで開ける（/index・/index.html → ディレクトリ、拡張子なし → .html）ため、
// redirect_uriを登録済みの正規形に揃える。swarm-app.jsにも同じ関数があるので変更時は両方を揃えること。
function _swarmCanonicalPath(path) {
  return path.replace(/\/index(\.html)?$/, '/').replace(/\/([^\/.]+)$/, '/$1.html');
}

// Foursquareに登録すべきリダイレクトURIの一覧（このSPAのディレクトリを基準に redirectPages から組み立てる）
function _swarmRedirectUris(ns) {
  const base = location.origin + _swarmCanonicalPath(location.pathname);
  return SWARM_NS[ns].redirectPages.map(p => base + p);
}

// 1URI=1行で全件を見せる（スマホ幅で一部が隠れて登録漏れにならないよう、固定高さの入力欄は使わない）
function _renderSwarmRedirectUris(ns) {
  document.getElementById(SWARM_NS[ns].idPrefix + '-redirect-uri').innerHTML = _swarmRedirectUris(ns).map(uri =>
    `<div class="swarm-redirect-uri-row"><div class="swarm-redirect-uri-text">${_escHtml(uri)}</div>` +
    `<button type="button" class="admin-btn sm" onclick="copySwarmRedirectUri(this)">コピー</button></div>`
  ).join('');
}

function connectSwarmAccount(ns) {
  const cfg = SWARM_NS[ns];
  const st = _swarmState[ns];
  const statusEl = document.getElementById(cfg.idPrefix+'-status-connect');
  if (!st.config || !st.config.clientId) {
    statusEl.textContent = 'サイト管理者がまだ設定していません';
    statusEl.className = 'admin-status error';
    return;
  }
  localStorage.setItem('swarm_pending_ns', ns);
  const redirectUri = encodeURIComponent(location.origin + _swarmCanonicalPath(location.pathname));
  location.href = `https://foursquare.com/oauth2/authenticate?client_id=${encodeURIComponent(st.config.clientId)}&response_type=token&redirect_uri=${redirectUri}`;
}

// ns の連携情報を保存する（ログイン中はFirestore、未ログインならローカルに保存し、後でログインした際に引き継ぐ）。保存できたらtrue
async function _saveSwarmAccount(ns, accessToken, user) {
  const cfg = SWARM_NS[ns];
  const st = _swarmState[ns];
  if (user && _db) {
    try {
      await _db.collection(cfg.accountCollection).doc(user.uid).set({
        accessToken,
        linkedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    } catch(e) {
      console.warn('Swarmアカウント保存エラー:', e);
      return false;
    }
  } else {
    localStorage.setItem(_swarmLocalAccountKey(ns), JSON.stringify({ accessToken }));
  }
  st.account = { accessToken };
  const activeSectionId = ns === 'main' ? 'swarm' : 'admin-swarm';
  if (currentSection === activeSectionId) {
    _renderSwarmAccountStatus(ns);
    fetchSwarmCheckins(ns);
  }
  return true;
}

// app.jsのonAuthStateChangedから呼ばれる（OAuthコールバック後のトークン保存／ログイン時のローカル連携情報の引き継ぎ）
async function _swarmHandleAuthReady(user) {
  let linkedNs = null;
  if (window._swarmPendingToken) {
    const accessToken = window._swarmPendingToken;
    const ns = SWARM_NS[window._swarmPendingNs] ? window._swarmPendingNs : 'main';
    delete window._swarmPendingToken;
    delete window._swarmPendingNs;
    if (await _saveSwarmAccount(ns, accessToken, user)) linkedNs = ns;
  }
  if (user) {
    // ログイン前（未ログイン状態）にローカル保存していた連携情報をFirestoreへ引き継ぐ（保存に失敗したら次回に再試行）
    for (const ns of Object.keys(SWARM_NS)) {
      const key = _swarmLocalAccountKey(ns);
      const data = _readSwarmLocalAccount(ns);
      if (!data || !data.accessToken) { localStorage.removeItem(key); continue; }
      if (data.migratedTo) continue;
      // たった今連携したnsは、古いローカル分でFirestoreを上書きしない
      if (ns !== linkedNs && !(await _saveSwarmAccount(ns, data.accessToken, user))) continue;
      if (ns === 'main') localStorage.setItem(key, JSON.stringify({ accessToken: data.accessToken, migratedTo: user.uid }));
      else localStorage.removeItem(key);
    }
  }
}

async function unlinkSwarmAccount(ns) {
  if (!confirm('Swarmとの連携を解除しますか？')) return;
  await _unlinkSwarmAccountSilent(ns);
}

// 別アカウントへの切り替え: Foursquareは既存のログイン状態を使って再連携してしまうため、
// ログアウト用ページを別タブで開いてから連携解除する
function switchSwarmAccount(ns) {
  if (!confirm('別のSwarmアカウントに切り替えますか？\n新しいタブでFoursquareのログアウトページを開きます。ログアウト後、このタブで再度「Swarmと連携する」を押してください。')) return;
  window.open('https://foursquare.com/logout', '_blank');
  _unlinkSwarmAccountSilent(ns);
}

async function _unlinkSwarmAccountSilent(ns) {
  const cfg = SWARM_NS[ns];
  const st = _swarmState[ns];
  try {
    const local = _readSwarmLocalAccount(ns);
    if (_currentUser && _db) {
      await _db.collection(cfg.accountCollection).doc(_currentUser.uid).delete();
    }
    // 引き継ぎ済みのローカル分（単独ページの連携）は残す
    if (!(local && local.migratedTo)) localStorage.removeItem(_swarmLocalAccountKey(ns));
    st.account = null;
    st.checkins = [];
    _renderSwarmAccountStatus(ns);
    _renderSwarmCheckinList(ns);
  } catch(e) {
    alert('解除に失敗しました: ' + e.message);
  }
}

function copySwarmRedirectUri(btn) {
  const textEl = btn.previousElementSibling;
  window.getSelection().selectAllChildren(textEl);
  navigator.clipboard.writeText(textEl.textContent).catch(() => {});
}

// ── チェックイン作成 ──
function _getSwarmGeolocation() {
  return new Promise(resolve => {
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      pos => resolve(pos.coords),
      () => resolve(null),
      { timeout: 5000 }
    );
  });
}

async function searchSwarmVenues(ns) {
  const cfg = SWARM_NS[ns];
  const st = _swarmState[ns];
  const statusEl = document.getElementById(cfg.idPrefix+'-status-checkin');
  if (!st.account || !st.account.accessToken) {
    statusEl.textContent = '先にSwarmと連携してください';
    statusEl.className = 'admin-status error';
    return;
  }
  const quickShareEl = document.getElementById(cfg.idPrefix+'-quick-share');
  if (quickShareEl) quickShareEl.style.display = 'none';
  const query = document.getElementById(cfg.idPrefix+'-venue-query').value.trim();
  const near = document.getElementById(cfg.idPrefix+'-venue-near').value.trim();
  let locationParam = '';
  if (near) {
    locationParam = `&near=${encodeURIComponent(near)}`;
  } else {
    const coords = await _getSwarmGeolocation();
    if (coords) {
      locationParam = `&ll=${coords.latitude},${coords.longitude}`;
    } else if (!query) {
      statusEl.textContent = '検索キーワードか場所を入力するか、位置情報の利用を許可してください';
      statusEl.className = 'admin-status error';
      return;
    }
  }
  const queryParam = query ? `&query=${encodeURIComponent(query)}` : '';
  const proxyPrefix = (st.config && st.config.proxyPrefix) || '';
  const apiUrl = `https://api.foursquare.com/v2/venues/search?oauth_token=${encodeURIComponent(st.account.accessToken)}&v=${SWARM_FOURSQUARE_API_VERSION}${queryParam}${locationParam}`;
  statusEl.textContent = '検索中...';
  statusEl.className = 'admin-status';
  try {
    const res = await fetch(proxyPrefix + apiUrl);
    const json = await res.json();
    if (!res.ok || (json.meta && json.meta.code !== 200)) {
      statusEl.textContent = 'エラー: ' + (json.meta ? json.meta.errorDetail : res.statusText);
      statusEl.className = 'admin-status error';
      return;
    }
    st.venueResults = (json.response && json.response.venues) || [];
    statusEl.textContent = '';
    statusEl.className = 'admin-status';
    _renderSwarmVenueResults(ns);
  } catch(e) {
    statusEl.textContent = '検索に失敗しました: ' + e.message + '（CORSの場合はプロキシの設定をお試しください）';
    statusEl.className = 'admin-status error';
  }
}

function _renderSwarmVenueResults(ns) {
  const cfg = SWARM_NS[ns];
  const st = _swarmState[ns];
  const listEl = document.getElementById(cfg.idPrefix+'-venue-results');
  if (!st.venueResults.length) {
    listEl.innerHTML = '<div class="admin-empty">該当する場所が見つかりません</div>';
    return;
  }
  listEl.innerHTML = st.venueResults.map((v, idx) => {
    const loc = v.location || {};
    const addr = (loc.formattedAddress || []).join(' ');
    return `<div class="swarm-venue-item" onclick="selectSwarmVenue('${ns}', ${idx})">
      <div class="swarm-venue-name">${_esc(v.name || '')}</div>
      <div class="swarm-venue-addr">${_esc(addr)}</div>
    </div>`;
  }).join('');
}

function selectSwarmVenue(ns, idx) {
  const cfg = SWARM_NS[ns];
  const st = _swarmState[ns];
  const venue = st.venueResults[idx];
  if (!venue) return;
  // 同じ場所をもう一度クリックしたら確認してそのままチェックイン
  if (st.selectedVenue && st.selectedVenue.id === venue.id) {
    if (confirm(`${venue.name || ''}にチェックインしますか？`)) {
      submitSwarmCheckin(ns);
    }
    return;
  }
  st.selectedVenue = venue;
  document.getElementById(cfg.idPrefix+'-selected-venue').textContent = venue.name || '';
  document.getElementById(cfg.idPrefix+'-checkin-form').style.display = '';
  const quickShareEl = document.getElementById(cfg.idPrefix+'-quick-share');
  if (quickShareEl) quickShareEl.style.display = 'none';
}

async function submitSwarmCheckin(ns) {
  const cfg = SWARM_NS[ns];
  const st = _swarmState[ns];
  const statusEl = document.getElementById(cfg.idPrefix+'-status-checkin');
  if (!st.account || !st.account.accessToken) {
    statusEl.textContent = '先にSwarmと連携してください';
    statusEl.className = 'admin-status error';
    return;
  }
  if (!st.selectedVenue) {
    statusEl.textContent = '場所を選択してください';
    statusEl.className = 'admin-status error';
    return;
  }
  const shout = document.getElementById(cfg.idPrefix+'-checkin-shout').value.trim();
  const proxyPrefix = (st.config && st.config.proxyPrefix) || '';
  statusEl.textContent = 'チェックイン中...';
  statusEl.className = 'admin-status';
  try {
    const res = await fetch(proxyPrefix + 'https://api.foursquare.com/v2/checkins/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        oauth_token: st.account.accessToken,
        v: SWARM_FOURSQUARE_API_VERSION,
        venueId: st.selectedVenue.id,
        shout,
        broadcast: 'private'
      })
    });
    const json = await res.json();
    if (!res.ok || (json.meta && json.meta.code !== 200)) {
      statusEl.textContent = 'エラー: ' + (json.meta ? json.meta.errorDetail : res.statusText);
      statusEl.className = 'admin-status error';
      return;
    }
    statusEl.textContent = 'チェックインしました ✓';
    statusEl.className = 'admin-status ok';
    const newCheckin = json.response && json.response.checkin;
    if (newCheckin) {
      st.checkins.unshift(newCheckin);
      _renderSwarmCheckinList(ns);
      const quickShareEl = document.getElementById(cfg.idPrefix+'-quick-share');
      if (quickShareEl) quickShareEl.style.display = '';
    }
    document.getElementById(cfg.idPrefix+'-checkin-shout').value = '';
    document.getElementById(cfg.idPrefix+'-checkin-form').style.display = 'none';
    document.getElementById(cfg.idPrefix+'-venue-results').innerHTML = '';
    document.getElementById(cfg.idPrefix+'-venue-query').value = '';
    st.selectedVenue = null;
  } catch(e) {
    statusEl.textContent = '失敗しました: ' + e.message;
    statusEl.className = 'admin-status error';
  }
}

// ── 投稿テキスト生成（固定フォーマット） ──
function _buildSwarmPostText(checkin) {
  const venue = checkin.venue || {};
  const loc = venue.location || {};
  const url = checkin.id ? `https://www.swarmapp.com/checkin/${checkin.id}` : '';
  const tokenMap = {
    '{venue}': venue.name || '',
    '{area}': loc.city || '',
    '{state}': loc.state || '',
    '{country}': loc.country || '',
    '{lat}': (loc.lat !== undefined && loc.lat !== null) ? loc.lat : '',
    '{lng}': (loc.lng !== undefined && loc.lng !== null) ? loc.lng : '',
    '{shout}': checkin.shout || '',
    '{url}': url
  };
  let text = SWARM_DEFAULT_TEMPLATE;
  Object.keys(tokenMap).forEach(key => { text = text.split(key).join(tokenMap[key]); });
  return text;
}

// ── チェックイン取得 ──
async function fetchSwarmCheckins(ns) {
  const cfg = SWARM_NS[ns];
  const st = _swarmState[ns];
  const statusEl = document.getElementById(cfg.idPrefix+'-status-fetch');
  if (!st.account || !st.account.accessToken) {
    statusEl.textContent = '先にSwarmと連携してください';
    statusEl.className = 'admin-status error';
    return;
  }
  const limit = document.getElementById(cfg.idPrefix+'-fetch-limit').value || '10';
  const proxyPrefix = (st.config && st.config.proxyPrefix) || '';
  const apiUrl = `https://api.foursquare.com/v2/users/self/checkins?oauth_token=${encodeURIComponent(st.account.accessToken)}&v=${SWARM_FOURSQUARE_API_VERSION}&limit=${encodeURIComponent(limit)}`;
  statusEl.textContent = '取得中...';
  statusEl.className = 'admin-status';
  try {
    const res = await fetch(proxyPrefix + apiUrl);
    const json = await res.json();
    if (!res.ok || (json.meta && json.meta.code !== 200)) {
      const code = json.meta ? json.meta.code : res.status;
      if (code === 401) {
        statusEl.textContent = '認証の有効期限が切れました。再度連携してください';
      } else {
        statusEl.textContent = 'エラー: ' + (json.meta ? json.meta.errorDetail : res.statusText);
      }
      statusEl.className = 'admin-status error';
      return;
    }
    st.checkins = (json.response && json.response.checkins && json.response.checkins.items) || [];
    statusEl.textContent = `${st.checkins.length}件取得しました ✓`;
    statusEl.className = 'admin-status ok';
    _renderSwarmCheckinList(ns);
  } catch(e) {
    statusEl.textContent = '取得に失敗しました: ' + e.message + '（CORSの場合はプロキシの設定をお試しください）';
    statusEl.className = 'admin-status error';
  }
}

function _renderSwarmCheckinList(ns) {
  const cfg = SWARM_NS[ns];
  const st = _swarmState[ns];
  const listEl = document.getElementById(cfg.idPrefix+'-checkin-list');
  if (!st.checkins.length) {
    listEl.innerHTML = '<div class="admin-empty">チェックインがありません</div>';
    return;
  }
  listEl.innerHTML = st.checkins.map((c, idx) => {
    const venue = c.venue || {};
    const loc = venue.location || {};
    const dateStr = c.createdAt ? new Date(c.createdAt * 1000).toLocaleString('ja-JP') : '';
    const placeStr = [loc.city, loc.state].filter(Boolean).join(', ');
    const withStr = (c.with || []).map(u => [u.firstName, u.lastName].filter(Boolean).join(' ') || u.id).filter(Boolean).join('、');
    return `<div class="swarm-checkin-card">
      <div class="swarm-checkin-venue">${_esc(venue.name || '(不明な場所)')}</div>
      <div class="swarm-checkin-meta">${_esc(dateStr)}${placeStr ? ' &nbsp;' + _esc(placeStr) : ''}</div>
      ${withStr ? `<div class="swarm-checkin-meta">👥 ${_esc(withStr)}と一緒</div>` : ''}
      ${c.shout ? `<div class="swarm-checkin-shout">${_esc(c.shout)}</div>` : ''}
      <div class="swarm-checkin-actions">
        <button class="admin-btn sm primary" onclick="postSwarmCheckinToX('${ns}', ${idx})">Xに投稿</button>
        <button class="admin-btn sm" onclick="copySwarmCheckinText('${ns}', ${idx})">テキストをコピー</button>
      </div>
    </div>`;
  }).join('');
}

function postSwarmCheckinToX(ns, idx) {
  const st = _swarmState[ns];
  const checkin = st.checkins[idx];
  if (!checkin) return;
  const text = _buildSwarmPostText(checkin);
  window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, '_blank');
}

function copySwarmCheckinText(ns, idx) {
  const st = _swarmState[ns];
  const checkin = st.checkins[idx];
  if (!checkin) return;
  const text = _buildSwarmPostText(checkin);
  navigator.clipboard.writeText(text).catch(() => {});
}
