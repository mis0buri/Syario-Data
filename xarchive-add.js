// ── Xアーカイブ追加 単独ページ ──
// index.html配下の既存実装（xarchive.js / app.js）には一切手を加えず、完全に独立したページとして動作する。
// 保存先は本体サイトの「アーカイブ閲覧/追加」と同じFirebase Storage
// （archives/manifest.json + archives/{username}/{YYYY-MM}.json）なので、
// ここでアップロードしたアーカイブは本体サイトの「アーカイブ閲覧」にそのまま反映される。
// ログイン機能は持たない（storage.rulesが未ログインアップロードを許可している前提）。
// アクセス制御が必要になった場合はstorage.rules側で行う。

// ご意見フォームと同じDiscord webhook（app.jsのWEBHOOK_URLと同一。このページはapp.jsを
// 読み込まないためここにも定義する。変更時は両方を更新すること）
const XAA_WEBHOOK_URL = 'https://discord.com/api/webhooks/1485897903431221330/HkGtTtH24xS2EmdxlGK_CkSoCp1rl8JnALHU_XhLpXHr3tggH0FioGsumKFYvBuOc3Mc';

const XAA_FIREBASE_CONFIG = {
  apiKey: "AIzaSyDG2F8MDiSpNZWfcISJVCI5kAWaJYF0B7k",
  authDomain: "syariodate.firebaseapp.com",
  projectId: "syariodate",
  messagingSenderId: "494285110412",
  storageBucket: "syariodate.firebasestorage.app",
  appId: "1:494285110412:web:ee00a71bd8866a68890fa9"
};

let _storage = null;

function init() {
  firebase.initializeApp(XAA_FIREBASE_CONFIG);
  _storage = firebase.storage();
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
  if (!_storage) return;

  const statusEl = document.getElementById('xa-add-status');
  const progEl = document.getElementById('xa-add-progress');
  const btnEl = document.getElementById('xa-add-upload-btn');
  const filesEl = document.getElementById('xa-add-files');

  const _setStatus = function (msg, ok) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.className = 'xaa-status ' + (ok ? 'ok' : 'error');
  };
  const _setProgress = function (msg) {
    if (progEl) progEl.textContent = msg || '';
  };

  const files = (filesEl && filesEl.files) ? Array.from(filesEl.files) : [];

  if (files.length < 1) {
    _setStatus('ファイルを指定してください。', false);
    return;
  }

  if (btnEl) btnEl.disabled = true;
  _setStatus('', true);
  _setProgress('解析中…');

  try {
    const byId = new Map();
    const skipped = [];
    let username = '';
    let displayName = '';

    for (const file of files) {
      try {
        const text = await file.text();
        const start = text.indexOf('[');
        const end = text.lastIndexOf(']');
        if (start === -1 || end === -1 || end < start) throw new Error('array bounds not found');
        const s = text.slice(start, end + 1);
        const arr = JSON.parse(s);
        arr.forEach(function (el) {
          // account.js のエントリ（{account: {username, accountDisplayName, ...}}）から
          // ハンドル名・表示名を自動取得する
          if (el && el.account && el.account.username) {
            if (!username) username = String(el.account.username).trim().replace(/^@/, '');
            if (!displayName) displayName = String(el.account.accountDisplayName || '').trim();
            return;
          }
          const norm = _xaNormalizeTweet(el);
          if (norm && !byId.has(norm.id)) byId.set(norm.id, norm);
        });
      } catch (e) {
        skipped.push(file.name);
      }
    }

    if (!username) {
      _setStatus('account.js が見つかりませんでした。data/account.js も一緒に選択してください。' + (skipped.length ? '（解析できず除外: ' + skipped.join(', ') + '）' : ''), false);
      _setProgress('');
      return;
    }

    const allTweets = Array.from(byId.values());
    if (allTweets.length === 0) {
      _setStatus('有効なツイートが見つかりませんでした。' + (skipped.length ? '（解析できず除外: ' + skipped.join(', ') + '）' : ''), false);
      _setProgress('');
      return;
    }

    // 既存マニフェストをチャンクのアップロード前に読み込む。
    // 「無い」以外の読み込み失敗時は中断する（空マニフェスト扱いで続行すると
    // 既存アカウントを消したマニフェストで上書きしてしまうため）。
    _setProgress('既存マニフェストを確認中…');
    let manifest = null;
    try {
      const url = await _storage.ref('archives/manifest.json').getDownloadURL();
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error('manifest fetch failed: ' + res.status);
      manifest = await res.json();
    } catch (e) {
      if (e && e.code === 'storage/object-not-found') {
        manifest = { generated_at: '', accounts: [] };
      } else {
        _setStatus('既存マニフェストの読み込みに失敗したため中断しました（登録済みアカウントを消さないための安全策です）。時間をおいて再試行してください: ' + (e && e.message ? e.message : e), false);
        _setProgress('');
        return;
      }
    }
    if (!manifest || typeof manifest !== 'object') manifest = { generated_at: '', accounts: [] };
    if (!Array.isArray(manifest.accounts)) manifest.accounts = [];

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

    // ご意見と同じDiscord webhookでアップロードを通知（通知失敗はアップロード成功に影響させない）
    try {
      await fetch(XAA_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content:
          '📦 Xアーカイブがアップロードされました（単独アップロードページから）\n' +
          'アカウント: @' + username + '（' + (displayName || username) + '）\n' +
          '内容: ' + allTweets.length + '件・' + months.length + 'チャンク（' + from.slice(0, 10) + '〜' + to.slice(0, 10) + '）' })
      });
    } catch (e) { console.warn('Discord通知失敗:', e); }
  } catch (err) {
    if (err && err.code === 'storage/unauthorized') {
      _setStatus('アップロード権限がありません。storage.rulesの設定を確認してください。', false);
    } else {
      _setStatus('失敗しました: ' + (err && err.message ? err.message : err), false);
    }
    _setProgress('');
  } finally {
    if (btnEl) btnEl.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', init);
