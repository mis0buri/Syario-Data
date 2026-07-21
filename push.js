// ── 予約プッシュ通知 (FCM Web Push) ──
// マイページの「予約通知を受け取る」ボタンから opt-in。トークンは Firestore
// `fcm_tokens/{token}` に保存し、Cloud Functions が予約作成時にまとめて送信する。

// Firebase Console → プロジェクト設定 → Cloud Messaging → Web Push証明書 で生成した公開鍵を貼る（公開鍵なのでコミット可）
const FCM_VAPID_KEY = 'BKLLpba2YVU2eJeDPA5O0aXjVJCh1g59me3LIYHCSFmI1UCCjawinVAgNQewam_jY5ERxXjTOmwdKjmREBnUHBE';

const PUSH_LS_KEY = 'push_enabled';

async function _pushSupported() {
  try {
    if (!window.firebase || !firebase.messaging) return false;
    if (!('serviceWorker' in navigator) || !('Notification' in window)) return false;
    // compat SDKのisSupported()はbooleanを同期で返す（modularはPromise）。両対応する
    const s = firebase.messaging.isSupported ? firebase.messaging.isSupported() : true;
    const ok = (s && typeof s.then === 'function') ? await s : s;
    return !!ok;
  } catch (e) {
    return false;
  }
}

async function initPushUI() {
  const btn = document.getElementById('push-toggle-btn');
  const status = document.getElementById('push-status');
  if (!btn || !status) return;
  try {
    await _initPushUIInner(btn, status);
  } catch (e) {
    // 想定外のエラーでも無言にせず表示する（原因調査を可能にするため）
    status.textContent = '通知設定の初期化に失敗しました: ' + (e && e.message ? e.message : e);
    btn.style.display = 'none';
  }
}

async function _initPushUIInner(btn, status) {
  if (!FCM_VAPID_KEY) {
    status.textContent = '通知の設定が未完了です（VAPIDキー未設定）';
    btn.style.display = 'none';
    return;
  }

  const supported = await _pushSupported();
  if (!supported) {
    if (_isIOS() && !_isStandalone()) {
      status.textContent = 'iPhoneでは、PWA（ホーム画面に追加）から起動すると予約通知を利用できます';
    } else {
      status.textContent = 'この環境はプッシュ通知に対応していません';
    }
    btn.style.display = 'none';
    return;
  }

  btn.style.display = '';
  status.textContent = '';
  btn.textContent = localStorage.getItem(PUSH_LS_KEY) === '1' ? '予約通知をオフにする' : '予約通知を受け取る';
}

async function togglePushNotifications() {
  const btn = document.getElementById('push-toggle-btn');
  const status = document.getElementById('push-status');
  if (!btn || !status) return;

  const enabled = localStorage.getItem(PUSH_LS_KEY) === '1';

  if (enabled) {
    try {
      const messaging = firebase.messaging();
      await messaging.deleteToken().catch(() => {});
      const token = localStorage.getItem('push_token');
      if (token && _db) {
        await _db.collection('fcm_tokens').doc(token).delete().catch(() => {});
      }
      localStorage.removeItem(PUSH_LS_KEY);
      localStorage.removeItem('push_token');
      status.textContent = '予約通知をオフにしました';
      btn.textContent = '予約通知を受け取る';
    } catch (e) {
      status.textContent = '解除に失敗しました: ' + (e && e.message ? e.message : e);
    }
    return;
  }

  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      status.textContent = '通知が許可されませんでした。端末の設定から許可してください';
      return;
    }
    const reg = await navigator.serviceWorker.register('./firebase-messaging-sw.js');
    const token = await firebase.messaging().getToken({ vapidKey: FCM_VAPID_KEY, serviceWorkerRegistration: reg });
    await _db.collection('fcm_tokens').doc(token).set({
      uid: (_currentUser && _currentUser.uid) || null,
      ua: navigator.userAgent.slice(0, 120),
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    localStorage.setItem(PUSH_LS_KEY, '1');
    localStorage.setItem('push_token', token);
    status.textContent = '予約通知をオンにしました';
    btn.textContent = '予約通知をオフにする';
  } catch (e) {
    status.textContent = '有効化に失敗しました: ' + (e && e.message ? e.message : e);
  }
}
