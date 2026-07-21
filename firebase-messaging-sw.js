importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyDG2F8MDiSpNZWfcISJVCI5kAWaJYF0B7k",
  authDomain: "syariodate.firebaseapp.com",
  projectId: "syariodate",
  storageBucket: "syariodate.firebasestorage.app",
  messagingSenderId: "494285110412",
  appId: "1:494285110412:web:ee00a71bd8866a68890fa9"
});

const messaging = firebase.messaging();

// notificationペイロードはブラウザが自動表示する。data-onlyメッセージ用のフォールバックのみ実装
messaging.onBackgroundMessage(function (payload) {
  if (payload && payload.notification) return; // 自動表示に任せる
  const d = (payload && payload.data) || {};
  self.registration.showNotification(d.title || 'シャリオ', { body: d.body || '' });
});
