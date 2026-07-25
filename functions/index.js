const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onRequest } = require('firebase-functions/v2/https');
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

// 弐寺地力表wikiの中継。atwikiはCORSを返さずブラウザから直接読めないため、
// サーバー側でfetchしてHTMLを返す（対象URLは固定・認証情報は扱わない）
exports.fetchIidxWiki = onRequest({
  region: 'asia-northeast1',
  cors: ['https://mis0buri.github.io', 'http://localhost:8000', 'http://127.0.0.1:8000'],
}, async (req, res) => {
  try {
    const r = await fetch('https://w.atwiki.jp/bemani2sp11/pages/19.html', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SyarioIIDX/1.0)' },
    });
    if (!r.ok) { res.status(502).json({ error: 'wiki fetch failed: ' + r.status }); return; }
    const html = await r.text();
    res.set('Cache-Control', 'public, max-age=300');
    res.status(200).type('text/html').send(html);
  } catch (e) {
    res.status(502).json({ error: String((e && e.message) || e) });
  }
});
