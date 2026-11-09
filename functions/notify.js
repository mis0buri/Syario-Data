// ── Discord / Make 通知の中継 ──
// Webhook URLはクライアントに置くと抜かれて悪用されるため、Secret Managerに置いて
// このFunction経由でだけ送る。クライアントは「何が起きたか（ドキュメントID等）」だけを送り、
// 通知文はサーバー側でFirestore/Storageの実データから組み立てる。
//
// 悪用対策:
//  - 予約・連番・投票・掲示板・スタンプ: 実在し、かつ作成/更新から NOTIFY_FRESH_MS 以内の
//    ドキュメントに対してのみ通知（古いIDを総当たりしても通知できない）
//  - 同じ出来事は notify_log/{key} への create() で1回だけ（再送・連打を無視）
//  - ログイン・スタンプはFirebase IDトークン必須
//  - ご意見だけは自由文なので、文字数制限＋IP単位の簡易レート制限
//  - Discordには allowed_mentions: { parse: [] } を付け、@everyone 等を無効化
//
// 必要なシークレット（firebase functions:secrets:set <名前> で登録）:
//   DISCORD_FEEDBACK_WEBHOOK  ご意見・Xアーカイブ追加通知
//   DISCORD_LOGIN_WEBHOOK     初回ログイン
//   DISCORD_RSV_WEBHOOK       予約
//   DISCORD_RENBAN_WEBHOOK    連番募集
//   DISCORD_STAMP_WEBHOOK     スタンプ
//   DISCORD_BOARD_WEBHOOK     掲示板
//   MAKE_XPOST_WEBHOOK        Make（X自動ポスト: 予約・連番・投票）

const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { logger } = require('firebase-functions');
const admin = require('firebase-admin');

const S = {
  feedback: defineSecret('DISCORD_FEEDBACK_WEBHOOK'),
  login: defineSecret('DISCORD_LOGIN_WEBHOOK'),
  rsv: defineSecret('DISCORD_RSV_WEBHOOK'),
  renban: defineSecret('DISCORD_RENBAN_WEBHOOK'),
  stamp: defineSecret('DISCORD_STAMP_WEBHOOK'),
  board: defineSecret('DISCORD_BOARD_WEBHOOK'),
  make: defineSecret('MAKE_XPOST_WEBHOOK'),
};

const SITE_URL = 'https://mis0buri.github.io/Syario-Data/';
const BUCKET = 'syariodate.firebasestorage.app';
const NOTIFY_FRESH_MS = 10 * 60 * 1000;   // ドキュメント作成/更新からこの時間内だけ通知
const LOGIN_FRESH_MS = 60 * 60 * 1000;    // Authユーザー作成からこの時間内だけ「初回ログイン」
const MAX_FILES = 10;
const MAX_FILE_BYTES = 7 * 1024 * 1024; // base64化(約1.33倍)してもリクエスト上限に収まるように

class HttpError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}

// ── 簡易レート制限（インスタンス内メモリ。厳密ではないが連打の抑止には十分） ──
const _hits = new Map();
function _rateLimit(key, max, windowMs) {
  const now = Date.now();
  const arr = (_hits.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) throw new HttpError(429, 'too many requests');
  arr.push(now);
  _hits.set(key, arr);
  if (_hits.size > 5000) _hits.clear();
}

function _str(v, max) {
  return String(v == null ? '' : v).replace(/\r/g, '').slice(0, max);
}

function _dateLabel(ymd) {
  const p = String(ymd || '').split('-').map((x) => parseInt(x, 10));
  if (p.length !== 3 || p.some((n) => Number.isNaN(n))) return String(ymd || '日付未定');
  return `${p[0]}年${p[1]}月${p[2]}日`;
}

async function _verifyUser(req, required) {
  const m = /^Bearer (.+)$/.exec(req.get('Authorization') || '');
  if (!m) {
    if (required) throw new HttpError(401, 'login required');
    return null;
  }
  try {
    return await admin.auth().verifyIdToken(m[1]);
  } catch (e) {
    if (required) throw new HttpError(401, 'invalid token');
    return null;
  }
}

// 同じ出来事の通知は1回だけ。既に送っていれば false
async function _claim(key) {
  try {
    await admin.firestore().collection('notify_log').doc(key)
      .create({ at: admin.firestore.FieldValue.serverTimestamp() });
    return true;
  } catch (e) {
    if (e && (e.code === 6 || /already exists/i.test(String(e.message)))) return false;
    throw e;
  }
}

async function _freshDoc(collection, id, { edited = false } = {}) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new HttpError(400, 'bad id');
  const snap = await admin.firestore().collection(collection).doc(id).get();
  if (!snap.exists) throw new HttpError(404, 'not found');
  const t = (edited ? snap.updateTime : snap.createTime).toMillis();
  if (Date.now() - t > NOTIFY_FRESH_MS) throw new HttpError(410, 'too old');
  return snap;
}

async function _discord(url, body, files) {
  const payload = Object.assign({}, body, { allowed_mentions: { parse: [] } });
  if (payload.content) payload.content = _str(payload.content, 2000);
  let init;
  if (files && files.length) {
    const fd = new FormData();
    fd.append('payload_json', JSON.stringify(payload));
    files.forEach((f, i) => fd.append(`files[${i}]`, new Blob([f.buf], { type: f.type }), f.name));
    init = { method: 'POST', body: fd };
  } else {
    init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };
  }
  let r = await fetch(url, init);
  // usernameの上書きがDiscordに拒否された場合（禁止語など）はusernameなしで再送
  if (r.status === 400 && payload.username && !(files && files.length)) {
    delete payload.username;
    r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  }
  if (!r.ok) throw new Error('discord ' + r.status);
}

async function _make(body) {
  const r = await fetch(S.make.value(), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error('make ' + r.status);
}

// Makeは失敗してもDiscord側の結果に影響させない
async function _makeSafe(body) {
  try { await _make(body); } catch (e) { logger.warn('relayNotify: make failed', String(e && e.message || e)); }
}

// ── 各通知 ──
const HANDLERS = {
  async feedback(req, b) {
    _rateLimit('fb:' + req.ip, 6, 10 * 60 * 1000);
    const part = Math.max(1, parseInt(b.part, 10) || 1);
    const total = Math.max(part, parseInt(b.totalParts, 10) || 1);
    if (total > 10) throw new HttpError(400, 'too many parts');
    const message = _str(b.message, 1800).trim();
    if (part === 1 && !message) throw new HttpError(400, 'empty message');
    const files = [];
    const rawFiles = Array.isArray(b.files) ? b.files.slice(0, MAX_FILES) : [];
    let size = 0;
    for (const f of rawFiles) {
      const type = _str(f && f.type, 100);
      if (!/^image\//.test(type)) throw new HttpError(400, 'images only');
      const buf = Buffer.from(String(f.data || ''), 'base64');
      size += buf.length;
      if (!buf.length || size > MAX_FILE_BYTES) throw new HttpError(413, 'file too large');
      files.push({ buf, type, name: _str(f.name, 100).replace(/[^\w.\-ぁ-んァ-ヶ一-龠ー]/g, '_') || 'image' });
    }
    if (part > 1 && !files.length) throw new HttpError(400, 'empty part');
    const content = part === 1
      ? `**名前：** ${_str(b.name, 50) || '匿名'}\n**種別：** ${_str(b.category, 30)}\n**内容：** ${message}`
      : `（添付の続き ${part}/${total}）`;
    await _discord(S.feedback.value(), { content }, files);
  },

  async xarchive(req, b) {
    _rateLimit('xa:' + req.ip, 10, 10 * 60 * 1000);
    const username = _str(b.username, 50);
    const [buf] = await admin.storage().bucket(BUCKET).file('archives/manifest.json').download();
    const manifest = JSON.parse(buf.toString('utf8'));
    const gen = Date.parse(manifest.generated_at || '');
    if (!gen || Date.now() - gen > NOTIFY_FRESH_MS) throw new HttpError(410, 'too old');
    const acc = (manifest.accounts || []).find((a) => a && a.username === username);
    if (!acc) throw new HttpError(404, 'not found');
    if (!(await _claim(`xa_${username}_${gen}`))) return 'dup';
    const from = String(acc.period && acc.period.from || '').slice(0, 10);
    const to = String(acc.period && acc.period.to || '').slice(0, 10);
    const via = b.source === 'standalone' ? '（単独アップロードページから）' : '';
    await _discord(S.feedback.value(), { content:
      `📦 Xアーカイブがアップロードされました${via}\n` +
      `アカウント: @${acc.username}（${acc.display_name || acc.username}）\n` +
      `内容: ${acc.total_count || 0}件・${(acc.chunks || []).length}チャンク（${from}〜${to}）` });
  },

  async login(req, b) {
    const user = await _verifyUser(req, true);
    const rec = await admin.auth().getUser(user.uid);
    const created = Date.parse(rec.metadata.creationTime || '');
    if (!created || Date.now() - created > LOGIN_FRESH_MS) return 'not-first';
    if (!(await _claim('login_' + user.uid))) return 'dup';
    const providerId = (user.firebase && user.firebase.sign_in_provider) || '';
    const provider = providerId === 'google.com' ? 'Google' : providerId === 'twitter.com' ? 'X' : providerId;
    const now = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
    await _discord(S.login.value(), { content:
      `🔑 初回ログイン\n👤 ${rec.displayName || '(名前なし)'}\n📧 ${rec.email || '(メールなし)'}\n🔗 ${provider}\n🕐 ${now}` });
  },

  async reservation(req, b) {
    const snap = await _freshDoc('reservations', b.id, { edited: true });
    const edited = snap.updateTime.toMillis() !== snap.createTime.toMillis();
    if (!(await _claim(`rsv_${snap.id}_${snap.updateTime.toMillis()}`))) return 'dup';
    const d = snap.data();
    const cats = (Array.isArray(d.categories) ? d.categories : [])
      .map((c) => (c === 'その他' && d.otherText ? `その他(${d.otherText})` : c));
    const lines = [
      `📅 **日付**: ${_dateLabel(d.date)}`,
      `👤 **お名前**: ${d.name || '匿名'}`,
      `🏷️ **種別**: ${cats.length ? cats.join('、') : 'なし'}`,
    ];
    if (d.note) lines.push(`📝 **備考**: ${d.note}`);
    const header = edited ? '__**予約が変更されました**__' : '__**新しい予約が入りました**__';
    await _discord(S.rsv.value(), { content: `${header}\n${lines.join('\n')}` });
    if (!edited && b.xpost) {
      await _makeSafe({
        type: 'reservation', date: _dateLabel(d.date), name: d.name || '匿名',
        categories: cats.join('、') || 'なし', note: d.note || '',
        url: SITE_URL + '#schedule/' + d.date,
      });
    }
  },

  async renban(req, b) {
    const snap = await _freshDoc('renban_events', b.id);
    if (!(await _claim('renban_' + snap.id))) return 'dup';
    const d = snap.data();
    const dates = Array.isArray(d.dates) ? d.dates : [d.date].filter(Boolean);
    const maxPeople = d.maxPeople ? d.maxPeople + '人まで' : '上限なし';
    const lines = [
      `📢 **連番募集が登録されました**`,
      `👤 **登録者**: ${d.owner || ''}`,
      `🎫 **イベント名**: ${d.title || ''}`,
      `📅 **日付**: ${dates.join(', ')}`,
      `👥 **人数**: ${maxPeople}`,
      `⏰ **期限**: ${d.deadline || '期限なし'}`,
      d.note ? `📝 **備考**: ${d.note}` : null,
    ].filter(Boolean).join('\n');
    await _discord(S.renban.value(), { content: lines });
    if (b.xpost) {
      await _makeSafe({
        type: 'renban', owner: d.owner || '', title: d.title || '', dates: dates.join('、'),
        maxPeople, deadline: d.deadline || '期限なし', note: d.note || '',
        url: SITE_URL + '#renban/' + snap.id,
      });
    }
  },

  async vote(req, b) {
    const snap = await _freshDoc('vote_boxes', b.id);
    if (!b.xpost) return 'no-xpost';
    if (!(await _claim('vote_' + snap.id))) return 'dup';
    const d = snap.data();
    await _make({
      type: 'vote', authorName: d.authorName || '匿名', title: d.title || '',
      options: (Array.isArray(d.options) ? d.options : []).join('、'),
      deadline: d.deadline || '期限なし', url: SITE_URL + '#vote/' + snap.id,
    });
  },

  async board(req, b) {
    const snap = await _freshDoc('board_comments', b.id);
    if (!(await _claim('board_' + snap.id))) return 'dup';
    const d = snap.data();
    await _discord(S.board.value(), { username: _str(d.name, 80) || '匿名', content: _str(d.body, 2000) });
  },

  async stamp(req, b) {
    const user = await _verifyUser(req, true);
    const snap = await _freshDoc('stamp_cards', user.uid, { edited: true });
    const stamps = snap.data().stamps || 0;
    if (!(await _claim(`stamp_${user.uid}_${stamps}`))) return 'dup';
    const name = user.name || user.email || user.uid;
    await _discord(S.stamp.value(), { content: `🎫 **${name}** さんがスタンプを押しました！（通算 ${stamps} 個目）` });
  },
};

exports.relayNotify = onRequest({
  region: 'asia-northeast1',
  cors: ['https://mis0buri.github.io', 'http://localhost:8000', 'http://127.0.0.1:8000'],
  secrets: Object.values(S),
  maxInstances: 5,
}, async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  try {
    _rateLimit('all:' + req.ip, 60, 60 * 1000);
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const handler = Object.prototype.hasOwnProperty.call(HANDLERS, b.type) ? HANDLERS[b.type] : null;
    if (!handler) throw new HttpError(400, 'unknown type');
    const result = await handler(req, b);
    res.status(200).json({ ok: true, result: result || 'sent' });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) logger.error('relayNotify failed', e);
    res.status(status).json({ error: status === 500 ? 'relay failed' : e.message });
  }
});
