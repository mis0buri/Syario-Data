// ── スタンプカード ──
const _sd = (() => {
  const p = atob('MzUuNzA2NDY5Mjc1Mjk5MzMsMTM5LjY1MDU5MjIyNTY0NjE2').split(',').map(Number);
  return [p[0], p[1], 50];
})();
const STAMPS_PER_CARD = 10;
const STAMP_FIRST_ROTATION = -12; // 最初のスタンプの固定傾き（機能追加時の値）

function _stampTodayStr() {
  // JST 5:00 起点（UTC+4 相当で日付境界を定義）
  return new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);
}

function _haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toR = d => d * Math.PI / 180;
  const dLat = toR(lat2 - lat1), dLon = toR(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 +
            Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function initStampCard() {
  const el = document.getElementById('stamp-content');
  if (!el) return;

  if (!_currentUser) {
    el.innerHTML =
      '<div style="padding:48px 0;text-align:center;font-size:14px;">' +
      '<div style="color:var(--dim)">スタンプカードを利用するには<br>ログインが必要です</div>' +
      '<button class="rsv-btn primary" style="margin-top:16px;padding:10px 28px;" onclick="openLoginModal()">ログイン</button>' +
      '</div>';
    return;
  }

  el.innerHTML = '<div class="empty">読み込み中...</div>';

  let stamps = 0, lastStampDate = '', rotations = [], usedCards = [];
  if (_db) {
    try {
      const doc = await _db.collection('stamp_cards').doc(_currentUser.uid).get();
      if (doc.exists) {
        stamps       = doc.data().stamps        || 0;
        lastStampDate = doc.data().lastStampDate || '';
        rotations    = doc.data().rotations     || [];
        usedCards    = doc.data().usedCards      || [];
      }
    } catch(e) {}
  }

  _renderStampCard(el, stamps, lastStampDate, rotations, usedCards);
}

function _renderStampCard(el, stamps, lastStampDate, rotations = [], usedCards = []) {
  const todayStr      = _stampTodayStr();
  const stamped       = lastStampDate === todayStr;
  const currentCardIdx = Math.floor(stamps / STAMPS_PER_CARD);
  const posInCard     = stamps % STAMPS_PER_CARD;

  const emptySvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 60">
    <circle cx="30" cy="30" r="25" fill="none" stroke="#444" stroke-width="2" stroke-dasharray="4 3"/>
  </svg>`;

  function makeStampSvg(stampIndex) {
    const rot = rotations[stampIndex] !== undefined ? rotations[stampIndex] : 0;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 60" style="transform:rotate(${rot}deg)">
      <circle cx="30" cy="30" r="25" fill="none" stroke="#cc1a00" stroke-width="3.5"/>
      <text x="30" y="39" text-anchor="middle" fill="#cc1a00"
        font-family="'Hiragino Mincho ProN','Yu Mincho','MS Mincho',serif"
        font-size="23" font-weight="700" letter-spacing="1">シャ</text>
    </svg>`;
  }

  function makeCardBlock(cardIdx, count, isCurrent) {
    const startIdx = cardIdx * STAMPS_PER_CARD;
    const isUsed   = usedCards.includes(cardIdx);
    const isComplete = count === STAMPS_PER_CARD;
    const cells = Array.from({length: STAMPS_PER_CARD}, (_, i) =>
      i < count
        ? `<div class="stamp-cell on">${makeStampSvg(startIdx + i)}</div>`
        : `<div class="stamp-cell off">${emptySvg}</div>`
    ).join('');
    const label = isCurrent
      ? `— カード ${cardIdx + 1} 枚目（${count} / ${STAMPS_PER_CARD}） —`
      : `— カード ${cardIdx + 1} 枚目（完了）—`;
    const usedBtn = isComplete && !isUsed
      ? `<div style="text-align:center;margin-top:8px;">
           <button class="rsv-btn" style="font-size:12px;padding:6px 20px;"
             onclick="markCardUsed(${cardIdx})">使用済みにする</button>
         </div>`
      : '';
    const usedLabel = isUsed
      ? `<div class="stamp-card-used-label">— 使用済み —</div>`
      : '';
    return `
      <div class="stamp-card-block${isUsed ? ' is-used' : ''}">
        <div class="stamp-card-label">${label}</div>
        <div class="stamp-grid">${cells}</div>
        ${usedBtn}${usedLabel}
      </div>`;
  }

  // 最新カードを先頭に、完了カードを新しい順で並べる
  let cardsHtml = makeCardBlock(currentCardIdx, posInCard, true);
  for (let i = currentCardIdx - 1; i >= 0; i--) {
    cardsHtml += makeCardBlock(i, STAMPS_PER_CARD, false);
  }

  el.innerHTML = `
    <div class="stamp-wrap">
      <div class="stamp-total">
        <div class="stamp-total-num">${stamps}</div>
        <div class="stamp-total-lbl">スタンプ合計</div>
      </div>
      ${cardsHtml}
      <div id="stamp-status-msg" class="stamp-status-msg">${
        stamped
          ? (_isAdmin ? '本日スタンプ済み（管理者は再度押すことができます）' : '本日はスタンプ済みです ✓')
          : '来店時に押すことができます'
      }</div>
      <div class="stamp-btn-area">
        <button id="stamp-press-btn" class="rsv-btn primary stamp-btn"
          onclick="pressStamp()" ${stamped && !_isAdmin ? 'disabled' : ''}>
          ${stamped && !_isAdmin ? 'スタンプ済み' : 'スタンプを押す 🎫'}
        </button>
      </div>
      ${lastStampDate ? `<div class="stamp-last">最終スタンプ：${lastStampDate.replace(/-/g,'/')}</div>` : ''}
    </div>`;
}

async function _doStamp(btn, msg) {
  const todayStr = _stampTodayStr();
  try {
    const ref = _db.collection('stamp_cards').doc(_currentUser.uid);
    const doc = await ref.get();
    const cur       = doc.exists ? (doc.data().stamps        || 0)  : 0;
    const last      = doc.exists ? (doc.data().lastStampDate || '')  : '';
    const rotations = doc.exists ? (doc.data().rotations     || [])  : [];
    const usedCards = doc.exists ? (doc.data().usedCards      || [])  : [];
    if (last === todayStr && !_isAdmin) {
      if (msg) msg.textContent = '本日はすでにスタンプ済みです';
      if (btn) btn.disabled = false;
      return;
    }
    // 1個目は固定傾き、以降は -45°〜+45° のランダム
    const rot = cur === 0
      ? STAMP_FIRST_ROTATION
      : Math.round(Math.random() * 90 - 45);
    const newRotations = [...rotations, rot];
    await ref.set({
      stamps: cur + 1,
      lastStampDate: todayStr,
      rotations: newRotations,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    _renderStampCard(document.getElementById('stamp-content'), cur + 1, todayStr, newRotations, usedCards);
    // Discord通知
    const displayName = _currentUser.displayName || _currentUser.email || _currentUser.uid;
    fetch('https://discord.com/api/webhooks/1487706507079454844/QcYv1K8LuTzqUjXlXZrGSCFC_89OHozAxbjOwnntbtyV9KO8kq4XzBZsz30NRxoq4PXG', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: `🎫 **${displayName}** さんがスタンプを押しました！（通算 ${cur + 1} 個目）` })
    }).catch(() => {});
  } catch(e) {
    if (msg) msg.textContent = '保存に失敗しました: ' + e.message;
    if (btn) btn.disabled = false;
  }
}

async function markCardUsed(cardIdx) {
  if (!_currentUser || !_db) return;
  if (!confirm(`カード ${cardIdx + 1} 枚目を使用済みにしますか？\nこの操作は取り消せません。`)) return;
  try {
    await _db.collection('stamp_cards').doc(_currentUser.uid).update({
      usedCards: firebase.firestore.FieldValue.arrayUnion(cardIdx)
    });
    await initStampCard();
  } catch(e) {
    alert('更新に失敗しました: ' + e.message);
  }
}

async function pressStamp() {
  if (!_currentUser || !_db) return;
  const btn = document.getElementById('stamp-press-btn');
  const msg = document.getElementById('stamp-status-msg');
  if (btn) btn.disabled = true;

  if (msg) msg.textContent = '位置情報を取得中...';

  if (!navigator.geolocation) {
    if (msg) msg.textContent = 'お使いのブラウザはGPSに対応していません';
    if (btn) btn.disabled = false;
    return;
  }

  navigator.geolocation.getCurrentPosition(
    async pos => {
      const dist = _haversineM(
        pos.coords.latitude, pos.coords.longitude, _sd[0], _sd[1]);
      if (dist > _sd[2]) {
        if (msg) msg.textContent = '位置情報が不正もしくは来店されていません';
        if (btn) btn.disabled = false;
        return;
      }
      await _doStamp(btn, msg);
    },
    err => {
      const errMsg = err.code === 1 ? 'GPS使用が許可されていません' :
                     err.code === 2 ? '位置情報を取得できませんでした' :
                     '位置情報取得がタイムアウトしました';
      if (msg) msg.textContent = errMsg;
      if (btn) btn.disabled = false;
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

