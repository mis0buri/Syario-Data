const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { logger } = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

const REMOVE_ERROR_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-argument'
]);

exports.notifyReservation = onDocumentCreated(
  { document: 'reservations/{id}', region: 'asia-northeast1' },
  async (event) => {
    try {
      const data = event.data && event.data.data();
      if (!data) return;

      const { date, name } = data;
      let dateLabel = '日付未定';
      if (date) {
        const parts = String(date).split('-');
        if (parts.length === 3) {
          const y = parseInt(parts[0], 10);
          const m = parseInt(parts[1], 10);
          const d = parseInt(parts[2], 10);
          if (!Number.isNaN(y) && !Number.isNaN(m) && !Number.isNaN(d)) {
            dateLabel = `${y}年${m}月${d}日`;
          }
        }
      }

      const title = '📅 新しい予約';
      const body = `${dateLabel}に${name || '匿名'}さんが予約しました`;

      const tokensSnap = await admin.firestore().collection('fcm_tokens').get();
      if (tokensSnap.empty) {
        logger.info('notifyReservation: no fcm_tokens registered, skipping');
        return;
      }

      const tokenDocs = tokensSnap.docs;
      const tokens = tokenDocs.map((doc) => doc.id);

      let sentCount = 0;
      let failedCount = 0;
      const tokensToDelete = [];

      const BATCH_SIZE = 500;
      for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
        const batch = tokens.slice(i, i + BATCH_SIZE);
        try {
          const response = await admin.messaging().sendEachForMulticast({
            tokens: batch,
            notification: { title, body },
            webpush: { fcmOptions: { link: 'https://mis0buri.github.io/Syario-Data/#schedule' } }
          });

          response.responses.forEach((resp, idx) => {
            if (resp.success) {
              sentCount++;
            } else {
              failedCount++;
              const code = resp.error && resp.error.code;
              if (REMOVE_ERROR_CODES.has(code)) {
                tokensToDelete.push(batch[idx]);
              }
            }
          });
        } catch (batchErr) {
          logger.error('notifyReservation: batch send failed', batchErr);
          failedCount += batch.length;
        }
      }

      if (tokensToDelete.length) {
        const db = admin.firestore();
        const deleteBatches = [];
        for (let i = 0; i < tokensToDelete.length; i += 500) {
          const chunk = tokensToDelete.slice(i, i + 500);
          const writeBatch = db.batch();
          chunk.forEach((token) => writeBatch.delete(db.collection('fcm_tokens').doc(token)));
          deleteBatches.push(writeBatch.commit());
        }
        await Promise.all(deleteBatches).catch((delErr) => {
          logger.error('notifyReservation: failed to delete stale tokens', delErr);
        });
      }

      logger.info(`notifyReservation: sent=${sentCount} failed=${failedCount} removed=${tokensToDelete.length}`);
    } catch (err) {
      logger.error('notifyReservation: unhandled error', err);
    }
  }
);

// ── 弐寺地力表wikiの取得まわり ──
// atwikiはCORS非対応かつGoogle系IPを間欠的にブロックするため、
// ライブ取得＋最終成功キャッシュ（Cloud Storage）＋定期ウォームで構成する。
const IIDX_WIKI_URL = 'https://w.atwiki.jp/bemani2sp11/pages/19.html';
const _iidxCacheFile = () => admin.storage().bucket('syariodate.firebasestorage.app').file('cache/iidx-wiki.html');

// ライブ取得して成功したらキャッシュを更新する（成功時はHTMLを返し、失敗時はthrow）
async function _iidxFetchLiveAndCache() {
  const r = await fetch(IIDX_WIKI_URL, {
    headers: {
      // データセンターIP向けの単純なUAブロックを避けるため、実ブラウザ相当のヘッダを送る
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ja,en-US;q=0.8,en;q=0.6',
    },
  });
  if (!r.ok) throw new Error('wiki fetch failed: ' + r.status);
  const html = await r.text();
  await _iidxCacheFile().save(html, { contentType: 'text/html' })
    .then(() => console.log('iidx wiki cache saved'))
    .catch((e) => console.warn('iidx wiki cache save failed', e));
  return html;
}

// 定期ウォーム: atwikiのブロックは間欠的なので、4時間おきに自動でライブ取得を試み、
// 成功した時点のHTMLをキャッシュしておく。ユーザーの取り込みは常にキャッシュで成立する
exports.refreshIidxWikiCache = onSchedule({
  schedule: 'every 4 hours',
  region: 'asia-northeast1',
  timeZone: 'Asia/Tokyo',
}, async () => {
  try {
    const html = await _iidxFetchLiveAndCache();
    console.log('iidx wiki cache refreshed:', html.length, 'bytes');
  } catch (e) {
    console.warn('iidx wiki cache refresh failed:', String((e && e.message) || e));
  }
});

// 弐寺地力表wikiの中継。ライブ取得を試み、失敗時は最終成功キャッシュを返す
exports.fetchIidxWiki = onRequest({
  region: 'asia-northeast1',
  cors: ['https://mis0buri.github.io', 'http://localhost:8000', 'http://127.0.0.1:8000'],
}, async (req, res) => {
  const cacheFile = _iidxCacheFile();
  let html = null;
  let source = 'live';
  try {
    html = await _iidxFetchLiveAndCache();
  } catch (liveErr) {
    // wikiが読めない時（atwikiのIPブロック等）は最後に成功したHTMLを返す
    try {
      const [buf] = await cacheFile.download();
      html = buf.toString('utf8');
      source = 'cache';
      console.warn('iidx wiki live fetch failed, serving cache:', String(liveErr && liveErr.message || liveErr));
    } catch (cacheErr) {
      res.status(502).json({ error: 'wiki取得に失敗し、キャッシュもありません: ' + String(liveErr && liveErr.message || liveErr) });
      return;
    }
  }
  res.set('Access-Control-Expose-Headers', 'X-Iidx-Source');
  res.set('X-Iidx-Source', source);
  res.set('Cache-Control', 'no-store');
  res.status(200).type('text/html').send(html);
});
