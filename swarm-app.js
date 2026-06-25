// ── Swarm連携 単独ページ ──
// index.html配下の既存実装（swarm.js / app.js）には一切手を加えず、完全に独立したページとして動作する。
// Foursquare Client ID・CORSプロキシ設定は、本体サイトの一般向けSwarm連携（admin_config/swarm）を共有読み取りする。
// 連携アカウントは未ログイン時のローカル保存と同じlocalStorageキー（swarm_local_account_main）を使うため、
// 本体サイトを未ログインのまま連携した場合はこのページでも連携状態が共有される。

const SWARM_APP_FIREBASE_CONFIG = {
  apiKey: "AIzaSyDG2F8MDiSpNZWfcISJVCI5kAWaJYF0B7k",
  authDomain: "syariodate.firebaseapp.com",
  projectId: "syariodate",
  storageBucket: "syariodate.firebasestorage.app",
  messagingSenderId: "494285110412",
  appId: "1:494285110412:web:ee00a71bd8866a68890fa9"
};

const SWARM_APP_DEFAULT_TEMPLATE = "I'm at {venue} in {area}, {state} {url}";
const SWARM_APP_API_VERSION = '20231010';
const SWARM_APP_LOCAL_KEY = 'swarm_local_account_main';
const SWARM_APP_TEMPLATE_KEY = 'swarm_template';

let _db = null;
let _config = null;
let _account = null;
let _checkins = [];
let _venueResults = [];
let _selectedVenue = null;

function _esc(s) {
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

async function init() {
  firebase.initializeApp(SWARM_APP_FIREBASE_CONFIG);
  _db = firebase.firestore();

  document.getElementById('template-input').value = localStorage.getItem(SWARM_APP_TEMPLATE_KEY) || SWARM_APP_DEFAULT_TEMPLATE;
  updateTemplatePreview();

  // OAuthコールバック（#access_token=...）を検出して保存
  const m = location.hash.match(/access_token=([^&]+)/);
  if (m) {
    const accessToken = decodeURIComponent(m[1]);
    history.replaceState(null, '', location.pathname + location.search);
    saveAccount(accessToken);
  }

  await loadConfig();
  loadAccount();
  renderAccountStatus();
  if (_account && _account.accessToken) {
    fetchCheckins();
  } else {
    renderCheckinList();
  }
}

async function loadConfig() {
  _config = null;
  try {
    const doc = await _db.collection('admin_config').doc('swarm').get();
    if (doc.exists) _config = doc.data();
  } catch(e) {
    console.warn('Swarm設定読み込みエラー:', e);
  }
}

function loadAccount() {
  _account = null;
  const local = localStorage.getItem(SWARM_APP_LOCAL_KEY);
  if (local) {
    try { _account = JSON.parse(local); } catch(e) {}
  }
}

function saveAccount(accessToken) {
  localStorage.setItem(SWARM_APP_LOCAL_KEY, JSON.stringify({ accessToken }));
  _account = { accessToken };
  renderAccountStatus();
  fetchCheckins();
}

function renderAccountStatus() {
  const statusEl = document.getElementById('account-status');
  const notConfiguredEl = document.getElementById('not-configured');
  const connectFormEl = document.getElementById('connect-form');
  const linkedEl = document.getElementById('linked-info');
  statusEl.style.display = 'none';
  if (_account && _account.accessToken) {
    notConfiguredEl.style.display = 'none';
    connectFormEl.style.display = 'none';
    linkedEl.style.display = '';
  } else if (_config && _config.clientId) {
    notConfiguredEl.style.display = 'none';
    connectFormEl.style.display = '';
    linkedEl.style.display = 'none';
  } else {
    notConfiguredEl.style.display = '';
    connectFormEl.style.display = 'none';
    linkedEl.style.display = 'none';
  }
}

// ── 連携（OAuth） ──
function connectAccount() {
  const statusEl = document.getElementById('status-connect');
  if (!_config || !_config.clientId) {
    statusEl.textContent = 'サイト管理者がまだ設定していません';
    statusEl.className = 'sw-status error';
    return;
  }
  const redirectUri = encodeURIComponent(location.origin + location.pathname);
  location.href = `https://foursquare.com/oauth2/authenticate?client_id=${encodeURIComponent(_config.clientId)}&response_type=token&redirect_uri=${redirectUri}`;
}

function switchAccount() {
  if (!confirm('別のSwarmアカウントに切り替えますか？\n新しいタブでFoursquareのログアウトページを開きます。ログアウト後、このタブで再度「Swarmと連携する」を押してください。')) return;
  window.open('https://foursquare.com/logout', '_blank');
  unlinkAccountSilent();
}

function unlinkAccount() {
  if (!confirm('Swarmとの連携を解除しますか？')) return;
  unlinkAccountSilent();
}

function unlinkAccountSilent() {
  localStorage.removeItem(SWARM_APP_LOCAL_KEY);
  _account = null;
  _checkins = [];
  renderAccountStatus();
  renderCheckinList();
}

// ── チェックイン作成 ──
function _getGeolocation() {
  return new Promise(resolve => {
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      pos => resolve(pos.coords),
      () => resolve(null),
      { timeout: 5000 }
    );
  });
}

async function searchVenues() {
  const statusEl = document.getElementById('status-checkin');
  if (!_account || !_account.accessToken) {
    statusEl.textContent = '先にSwarmと連携してください';
    statusEl.className = 'sw-status error';
    return;
  }
  document.getElementById('quick-share').style.display = 'none';
  const query = document.getElementById('venue-query').value.trim();
  const near = document.getElementById('venue-near').value.trim();
  let locationParam = '';
  if (near) {
    locationParam = `&near=${encodeURIComponent(near)}`;
  } else {
    const coords = await _getGeolocation();
    if (coords) {
      locationParam = `&ll=${coords.latitude},${coords.longitude}`;
    } else if (!query) {
      statusEl.textContent = '検索キーワードか場所を入力するか、位置情報の利用を許可してください';
      statusEl.className = 'sw-status error';
      return;
    }
  }
  const queryParam = query ? `&query=${encodeURIComponent(query)}` : '';
  const proxyPrefix = (_config && _config.proxyPrefix) || '';
  const apiUrl = `https://api.foursquare.com/v2/venues/search?oauth_token=${encodeURIComponent(_account.accessToken)}&v=${SWARM_APP_API_VERSION}${queryParam}${locationParam}`;
  statusEl.textContent = '検索中...';
  statusEl.className = 'sw-status';
  try {
    const res = await fetch(proxyPrefix + apiUrl);
    const json = await res.json();
    if (!res.ok || (json.meta && json.meta.code !== 200)) {
      statusEl.textContent = 'エラー: ' + (json.meta ? json.meta.errorDetail : res.statusText);
      statusEl.className = 'sw-status error';
      return;
    }
    _venueResults = (json.response && json.response.venues) || [];
    statusEl.textContent = '';
    statusEl.className = 'sw-status';
    renderVenueResults();
  } catch(e) {
    statusEl.textContent = '検索に失敗しました: ' + e.message + '（CORSの場合はプロキシの設定をお試しください）';
    statusEl.className = 'sw-status error';
  }
}

function renderVenueResults() {
  const listEl = document.getElementById('venue-results');
  if (!_venueResults.length) {
    listEl.innerHTML = '<div class="sw-empty">該当する場所が見つかりません</div>';
    return;
  }
  listEl.innerHTML = _venueResults.map((v, idx) => {
    const loc = v.location || {};
    const addr = (loc.formattedAddress || []).join(' ');
    return `<div class="sw-venue-item" onclick="selectVenue(${idx})">
      <div class="sw-venue-name">${_esc(v.name || '')}</div>
      <div class="sw-venue-addr">${_esc(addr)}</div>
    </div>`;
  }).join('');
}

function selectVenue(idx) {
  const venue = _venueResults[idx];
  if (!venue) return;
  // 同じ場所をもう一度クリックしたら確認してそのままチェックイン
  if (_selectedVenue && _selectedVenue.id === venue.id) {
    if (confirm(`${venue.name || ''}にチェックインしますか？`)) {
      submitCheckin();
    }
    return;
  }
  _selectedVenue = venue;
  document.getElementById('selected-venue').textContent = venue.name || '';
  document.getElementById('checkin-form').style.display = '';
  document.getElementById('quick-share').style.display = 'none';
}

async function submitCheckin() {
  const statusEl = document.getElementById('status-checkin');
  if (!_account || !_account.accessToken) {
    statusEl.textContent = '先にSwarmと連携してください';
    statusEl.className = 'sw-status error';
    return;
  }
  if (!_selectedVenue) {
    statusEl.textContent = '場所を選択してください';
    statusEl.className = 'sw-status error';
    return;
  }
  const shout = document.getElementById('checkin-shout').value.trim();
  const proxyPrefix = (_config && _config.proxyPrefix) || '';
  statusEl.textContent = 'チェックイン中...';
  statusEl.className = 'sw-status';
  try {
    const res = await fetch(proxyPrefix + 'https://api.foursquare.com/v2/checkins/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        oauth_token: _account.accessToken,
        v: SWARM_APP_API_VERSION,
        venueId: _selectedVenue.id,
        shout,
        broadcast: 'private'
      })
    });
    const json = await res.json();
    if (!res.ok || (json.meta && json.meta.code !== 200)) {
      statusEl.textContent = 'エラー: ' + (json.meta ? json.meta.errorDetail : res.statusText);
      statusEl.className = 'sw-status error';
      return;
    }
    statusEl.textContent = 'チェックインしました ✓';
    statusEl.className = 'sw-status ok';
    const newCheckin = json.response && json.response.checkin;
    if (newCheckin) {
      _checkins.unshift(newCheckin);
      renderCheckinList();
      document.getElementById('quick-share').style.display = '';
    }
    document.getElementById('checkin-shout').value = '';
    document.getElementById('checkin-form').style.display = 'none';
    document.getElementById('venue-results').innerHTML = '';
    document.getElementById('venue-query').value = '';
    _selectedVenue = null;
  } catch(e) {
    statusEl.textContent = '失敗しました: ' + e.message;
    statusEl.className = 'sw-status error';
  }
}

// ── テンプレート編集 ──
function insertToken(token) {
  const ta = document.getElementById('template-input');
  const start = ta.selectionStart || ta.value.length;
  const end = ta.selectionEnd || ta.value.length;
  ta.value = ta.value.slice(0, start) + token + ta.value.slice(end);
  ta.focus();
  ta.selectionStart = ta.selectionEnd = start + token.length;
  updateTemplatePreview();
}

function updateTemplatePreview() {
  const template = document.getElementById('template-input').value;
  localStorage.setItem(SWARM_APP_TEMPLATE_KEY, template);
  const sample = {
    venue: { name: '雀荘シャリオ', location: { city: '渋谷区', state: '東京都', country: '日本', lat: 35.6595, lng: 139.7005 } },
    shout: '今日も連戦！',
    id: 'sample'
  };
  document.getElementById('template-preview').textContent = buildPostText(sample, template);
}

function buildPostText(checkin, template) {
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
  let text = template;
  Object.keys(tokenMap).forEach(key => { text = text.split(key).join(tokenMap[key]); });
  return text;
}

function toggleTemplate() {
  const body = document.getElementById('template-body');
  const arrow = document.getElementById('template-arrow');
  const open = body.classList.toggle('open');
  arrow.classList.toggle('open', open);
}

// ── チェックイン取得 ──
async function fetchCheckins() {
  const statusEl = document.getElementById('status-fetch');
  if (!_account || !_account.accessToken) {
    statusEl.textContent = '先にSwarmと連携してください';
    statusEl.className = 'sw-status error';
    return;
  }
  const limit = document.getElementById('fetch-limit').value || '10';
  const proxyPrefix = (_config && _config.proxyPrefix) || '';
  const apiUrl = `https://api.foursquare.com/v2/users/self/checkins?oauth_token=${encodeURIComponent(_account.accessToken)}&v=${SWARM_APP_API_VERSION}&limit=${encodeURIComponent(limit)}`;
  statusEl.textContent = '取得中...';
  statusEl.className = 'sw-status';
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
      statusEl.className = 'sw-status error';
      return;
    }
    _checkins = (json.response && json.response.checkins && json.response.checkins.items) || [];
    statusEl.textContent = `${_checkins.length}件取得しました ✓`;
    statusEl.className = 'sw-status ok';
    renderCheckinList();
  } catch(e) {
    statusEl.textContent = '取得に失敗しました: ' + e.message + '（CORSの場合はプロキシの設定をお試しください）';
    statusEl.className = 'sw-status error';
  }
}

function renderCheckinList() {
  const listEl = document.getElementById('checkin-list');
  if (!_checkins.length) {
    listEl.innerHTML = '<div class="sw-empty">チェックインがありません</div>';
    return;
  }
  listEl.innerHTML = _checkins.map((c, idx) => {
    const venue = c.venue || {};
    const loc = venue.location || {};
    const dateStr = c.createdAt ? new Date(c.createdAt * 1000).toLocaleString('ja-JP') : '';
    const placeStr = [loc.city, loc.state].filter(Boolean).join(', ');
    return `<div class="sw-checkin-card">
      <div class="sw-checkin-venue">${_esc(venue.name || '(不明な場所)')}</div>
      <div class="sw-checkin-meta">${_esc(dateStr)}${placeStr ? ' &nbsp;' + _esc(placeStr) : ''}</div>
      ${c.shout ? `<div class="sw-checkin-shout">${_esc(c.shout)}</div>` : ''}
      <div class="sw-checkin-actions">
        <button class="sw-btn sm primary" onclick="postCheckinToX(${idx})">Xに投稿</button>
        <button class="sw-btn sm" onclick="copyCheckinText(${idx})">テキストをコピー</button>
      </div>
    </div>`;
  }).join('');
}

function postCheckinToX(idx) {
  const checkin = _checkins[idx];
  if (!checkin) return;
  const template = document.getElementById('template-input').value || SWARM_APP_DEFAULT_TEMPLATE;
  const text = buildPostText(checkin, template);
  window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, '_blank');
}

function copyCheckinText(idx) {
  const checkin = _checkins[idx];
  if (!checkin) return;
  const template = document.getElementById('template-input').value || SWARM_APP_DEFAULT_TEMPLATE;
  const text = buildPostText(checkin, template);
  navigator.clipboard.writeText(text).catch(() => {});
}

function postQuickShareToX() { postCheckinToX(0); }
function copyQuickShareText() { copyCheckinText(0); }

document.addEventListener('DOMContentLoaded', init);
