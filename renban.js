// ── 連番募集 ──
const MAKE_RENBAN_WEBHOOK_URL = atob('aHR0cHM6Ly9ob29rLmV1MS5tYWtlLmNvbS9hOGhyZzVrc2E1bnkwa3g5b2p0d3R3Y2RtM3JscGxiZQ==');
let _rbCurrentEventId = null;
let _rbCurrentEvent = null; // { ev, joinCount, interestCount }
let _rbJoinType = null; // 'join' | 'interest'
let _rbDatePicker = null;
let _rbDeadlinePicker = null;

function openRbModal() {
  document.getElementById('rb-overlay').classList.add('open');
}
function closeRbModal() {
  document.getElementById('rb-overlay').classList.remove('open');
  if (location.hash.startsWith('#renban/')) history.pushState(null, '', location.pathname + location.search);
}
async function shareRenbanEvent() {
  const eventId = _rbCurrentEventId;
  if (!eventId || !_rbCurrentEvent) return;
  const { ev, joinCount, interestCount, joins = [], interests = [], dates: evDates = [] } = _rbCurrentEvent;
  const url = location.origin + location.pathname + '#renban/' + eventId;

  // ── canvas画像生成 ──
  const dpr = window.devicePixelRatio || 1;
  const W = 720, pad = 36, rowH = 32, pRowH = 28;
  const dateDisplay = (evDates.length ? evDates : (ev.date ? [ev.date] : [])).join(', ');
  const rows = [
    ...(ev.owner ? [['募集者', ev.owner]] : []),
    ['日付', dateDisplay || ''],
    ['募集人数', ev.maxPeople ? ev.maxPeople + '人まで' : '上限なし'],
    ['募集期限', ev.deadline || '期限なし'],
    ...(ev.note ? [['備考', ev.note]] : []),
    ['参加 / 興味', `✅ ${joinCount}人　👀 ${interestCount}人`],
  ];

  // 参加者リスト（参加→興味あり順、最大5人）
  const noteRowH = 20;
  const allP = [
    ...joins.map(p => ({ name: p.name || '匿名', note: p.note || '', t: 'join' })),
    ...interests.map(p => ({ name: p.name || '匿名', note: p.note || '', t: 'interest' })),
  ].slice(0, 5);
  const totalP = joinCount + interestCount;
  const hasMore = totalP > 5;
  const pTotalH = allP.reduce((sum, p) => sum + pRowH + (p.note ? noteRowH : 0), 0);
  const pSectionH = allP.length > 0
    ? (16 + 22 + pTotalH + (hasMore ? pRowH : 0) + 12)
    : 0;

  const H = 60 + 50 + 16 + rows.length * rowH + pSectionH + 28;
  const canvas = document.createElement('canvas');
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  // 背景
  ctx.fillStyle = '#21252b';
  ctx.fillRect(0, 0, W, H);
  // アクセントバー
  ctx.fillStyle = '#c8a96e';
  ctx.fillRect(0, 0, 6, H);

  await document.fonts.ready;

  // タイトル
  ctx.fillStyle = '#dde2ec';
  ctx.font = "bold 22px 'Noto Sans JP', sans-serif";
  const maxTitleW = W - pad * 2;
  let titleLine = ev.title || '';
  if (ctx.measureText(titleLine).width > maxTitleW) {
    while (ctx.measureText(titleLine + '…').width > maxTitleW && titleLine.length > 0) titleLine = titleLine.slice(0, -1);
    titleLine += '…';
  }
  ctx.fillText(titleLine, pad, 46);

  // 区切り線
  ctx.strokeStyle = '#3a3f4b'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(pad, 62); ctx.lineTo(W - pad, 62); ctx.stroke();

  // 詳細行
  let y = 62 + 28;
  rows.forEach(([key, val]) => {
    ctx.fillStyle = '#7f848e';
    ctx.font = "13px 'Noto Sans JP', sans-serif";
    ctx.fillText(key, pad, y);
    ctx.fillStyle = '#dde2ec';
    ctx.font = "14px 'Noto Sans JP', sans-serif";
    let valStr = String(val);
    const valX = pad + 100;
    while (ctx.measureText(valStr + '…').width > W - valX - pad && valStr.length > 0) valStr = valStr.slice(0, -1);
    if (valStr !== String(val)) valStr += '…';
    ctx.fillText(valStr, valX, y);
    y += rowH;
  });

  // 参加者セクション
  if (allP.length > 0) {
    y += 8;
    ctx.strokeStyle = '#3a3f4b'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y); ctx.stroke();
    y += 20;
    ctx.fillStyle = '#7f848e';
    ctx.font = "12px 'Noto Sans JP', sans-serif";
    ctx.fillText('参加者', pad, y);
    y += pRowH - 2;
    allP.forEach(p => {
      const icon = p.t === 'join' ? '✅' : '👀';
      ctx.fillStyle = '#dde2ec';
      ctx.font = "14px 'Noto Sans JP', sans-serif";
      let nameStr = p.name;
      while (ctx.measureText(icon + ' ' + nameStr + '…').width > W - pad * 2 - 20 && nameStr.length > 0) nameStr = nameStr.slice(0, -1);
      if (nameStr !== p.name) nameStr += '…';
      ctx.fillText(`${icon} ${nameStr}`, pad + 16, y);
      y += pRowH;
      if (p.note) {
        ctx.fillStyle = '#7f848e';
        ctx.font = "12px 'Noto Sans JP', sans-serif";
        let noteStr = p.note;
        const maxNoteW = W - pad * 2 - 36;
        while (ctx.measureText(noteStr + '…').width > maxNoteW && noteStr.length > 0) noteStr = noteStr.slice(0, -1);
        if (noteStr !== p.note) noteStr += '…';
        ctx.fillText(noteStr, pad + 32, y);
        y += noteRowH;
      }
    });
    if (hasMore) {
      ctx.fillStyle = '#7f848e';
      ctx.font = "12px 'Noto Sans JP', sans-serif";
      ctx.fillText(`… 他 ${totalP - 5} 人`, pad + 16, y);
    }
  }

  canvas.toBlob(async blob => {
    const file = new File([blob], `renban-${eventId}.png`, { type: 'image/png' });
    const shareText = `募集しています\n${url}`;
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], text: shareText }); return; }
      catch(e) { if (e.name === 'AbortError') return; }
    }
    // フォールバック：画像ダウンロード + クリップボード
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = objUrl; a.download = `renban-${eventId}.png`; a.click();
    URL.revokeObjectURL(objUrl);
    try { await navigator.clipboard.writeText(shareText); } catch {}
    const toast = document.createElement('div');
    toast.textContent = 'URLをコピー・画像をダウンロードしました';
    Object.assign(toast.style, {
      position:'fixed', bottom:'24px', left:'50%', transform:'translateX(-50%)',
      background:'var(--surface)', border:'1px solid var(--border)', color:'var(--text)',
      padding:'8px 20px', borderRadius:'8px', fontSize:'13px', zIndex:'9999',
      boxShadow:'0 4px 16px rgba(0,0,0,.4)', pointerEvents:'none'
    });
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
  }, 'image/png');
}
function rbOverlayClick(e) {
  if (e.target === document.getElementById('rb-overlay')) closeRbModal();
}
function rbShowScreen(id) {
  document.querySelectorAll('#rb-overlay .rb-screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// 同一ユーザ（uid優先、なければname）を1人として数えるユニーク参加者数
function _countUniqueParticipants(list) {
  const seen = new Set();
  list.forEach(p => seen.add(p.uid ? p.uid : ('name:' + p.name)));
  return seen.size;
}

async function initRenban() {
  if (!_db) {
    document.getElementById('renban-list').innerHTML = '<div class="renban-empty">データベース未接続</div>';
    return;
  }
  try {
    const snap = await _db.collection('renban_events').orderBy('date', 'asc').get();
    const events = await Promise.all(snap.docs.map(async d => {
      const ev = { id: d.id, ...d.data() };
      const pSnap = await _db.collection('renban_events').doc(d.id).collection('participants').get();
      const pData = pSnap.docs.map(p => p.data());
      ev._joinCount = _countUniqueParticipants(pData.filter(p => p.type === 'join'));
      ev._interestCount = _countUniqueParticipants(pData.filter(p => p.type === 'interest'));
      return ev;
    }));
    renderRenbanList(events);
  } catch(e) {
    document.getElementById('renban-list').innerHTML = '<div class="renban-empty">読み込みエラー: ' + e.message + '</div>';
  }
}

let _rbExpiredEvents = [];

function _isRenbanExpired(ev, today) {
  if (ev.deadline && new Date(ev.deadline) < today) return true;
  const dates = (ev.dates && ev.dates.length) ? ev.dates : (ev.date ? [ev.date] : []);
  if (dates.length && dates.every(d => new Date(d) < today)) return true;
  return false;
}

function _renbanItemHtml(ev) {
  const deadlineStr = ev.deadline ? ev.deadline : '期限なし';
  const maxStr = ev.maxPeople ? ev.maxPeople + '人まで' : '上限なし';
  return `<div class="renban-item" onclick="openRenbanDetail('${ev.id}')">
    <div class="renban-item-title">${escHtml(ev.title)}</div>
    <div class="renban-item-meta">
      ${ev.owner ? '<span>👤 ' + escHtml(ev.owner) + '</span>' : ''}
      <span>📅 ${escHtml((ev.dates && ev.dates.length ? ev.dates : [ev.date]).join(', '))}</span>
      <span>👥 ${maxStr}</span>
      <span>⏰ ${deadlineStr}</span>
      <span style="color:#4caf82">✅ 参加 ${ev._joinCount}人</span>
      <span style="color:#61afef">👀 興味あり ${ev._interestCount}人</span>
    </div>
    ${ev.note ? '<div style="font-size:12px;color:var(--dim);margin-top:6px;">' + escHtml(ev.note) + '</div>' : ''}
  </div>`;
}

function openRenbanExpiredList() {
  const listEl = document.getElementById('rb-expired-screen-list');
  if (listEl) {
    listEl.innerHTML = _rbExpiredEvents.length
      ? _rbExpiredEvents.map(_renbanItemHtml).join('')
      : '<div class="renban-empty">期限切れのイベントはありません</div>';
  }
  rbShowScreen('rb-expired-screen');
  openRbModal();
}

function renderRenbanList(events) {
  const el = document.getElementById('renban-list');
  const today = new Date(); today.setHours(0,0,0,0);

  const active = events.filter(ev => !_isRenbanExpired(ev, today));
  _rbExpiredEvents = events.filter(ev => _isRenbanExpired(ev, today))
    .sort((a, b) => {
      const da = (a.dates && a.dates.length) ? a.dates[0] : (a.date || '');
      const db = (b.dates && b.dates.length) ? b.dates[0] : (b.date || '');
      return db.localeCompare(da);
    });

  let html = '';
  if (!active.length) {
    html += '<div class="renban-empty">現在募集中のイベントはありません</div>';
  } else {
    html += active.map(_renbanItemHtml).join('');
  }

  if (_rbExpiredEvents.length) {
    html += `<div class="renban-expired-section">
      <button class="renban-expired-toggle" onclick="openRenbanExpiredList()">期限切れ一覧 (${_rbExpiredEvents.length}件)</button>
    </div>`;
  }

  el.innerHTML = html;
}

function openRenbanForm() {
  document.getElementById('rb-event-owner').value = _registeredName || '';
  document.getElementById('rb-event-title').value = '';
  document.getElementById('rb-event-max').value = '';
  document.getElementById('rb-event-note').value = '';
  document.getElementById('rb-form-status').textContent = '';

  const fpOpts = { locale: 'ja', dateFormat: 'Y-m-d', disableMobile: true };
  if (_rbDatePicker) _rbDatePicker.destroy();
  if (_rbDeadlinePicker) _rbDeadlinePicker.destroy();
  _rbDatePicker = flatpickr('#rb-event-date', { ...fpOpts, mode: 'multiple', conjunction: ', ', defaultDate: null });
  _rbDeadlinePicker = flatpickr('#rb-event-deadline', { ...fpOpts, defaultDate: null });

  const btn = document.getElementById('rb-form-submit-btn');
  btn.disabled = false; btn.textContent = '登録する';
  const xWrap = document.getElementById('rb-x-post-wrap');
  if (xWrap) xWrap.style.display = _isAdmin ? '' : 'none';
  rbShowScreen('rb-form-screen');
  openRbModal();
}

async function submitRenbanEvent(e) {
  e.preventDefault();
  if (!_db) return;
  const btn = document.getElementById('rb-form-submit-btn');
  btn.disabled = true; btn.textContent = '登録中...';
  document.getElementById('rb-form-status').textContent = '';
  const owner = document.getElementById('rb-event-owner').value.trim();
  const title = document.getElementById('rb-event-title').value.trim();
  const datesArr = _rbDatePicker ? _rbDatePicker.selectedDates.map(d => {
    const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), dy = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${dy}`;
  }).sort() : [];
  if (!datesArr.length) {
    document.getElementById('rb-form-status').textContent = '日付を選択してください';
    btn.disabled = false; btn.textContent = '登録する'; return;
  }
  const date = datesArr[0]; // 最早日付をソート用に保存
  const maxRaw = document.getElementById('rb-event-max').value.trim();
  const deadline = document.getElementById('rb-event-deadline').value || null;
  const note = document.getElementById('rb-event-note').value.trim();
  const maxPeople = maxRaw ? parseInt(maxRaw) : null;
  try {
    const rbPayload = {
      owner, title, date, dates: datesArr, maxPeople, deadline, note,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (_currentUser) rbPayload.uid = _currentUser.uid;
    const rbRef = await _db.collection('renban_events').add(rbPayload);
    try {
      const dateDisplay = datesArr.join(', ');
      const lines = [
        `📢 **連番募集が登録されました**`,
        `👤 **登録者**: ${owner}`,
        `🎫 **イベント名**: ${title}`,
        `📅 **日付**: ${dateDisplay}`,
        `👥 **人数**: ${maxPeople ? maxPeople + '人まで' : '上限なし'}`,
        `⏰ **期限**: ${deadline || '期限なし'}`,
        note ? `📝 **備考**: ${note}` : null,
      ].filter(Boolean).join('\n');
      await fetch('https://discord.com/api/webhooks/1486240216544051210/afDq63OkXXpy-E-JAh2XbGdanIfymsKHHbMX4IBi6baaV86YiXdHX9LaMo5fdtonNRn4', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: lines })
      });
    } catch(e) { console.warn('Discord通知失敗:', e); }
    const xPostCheck = document.getElementById('rb-x-post-check');
    if (MAKE_RENBAN_WEBHOOK_URL && (!_isAdmin || xPostCheck.checked)) {
      try {
        await fetch(MAKE_RENBAN_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            owner,
            title,
            dates: datesArr.join('、'),
            maxPeople: maxPeople ? maxPeople + '人まで' : '上限なし',
            deadline: deadline || '期限なし',
            note: note || '',
            url: location.origin + location.pathname + '#renban/' + rbRef.id,
          })
        });
      } catch(e) { console.warn('Make通知失敗:', e); }
    }
    closeRbModal();
    initRenban();
  } catch(err) {
    document.getElementById('rb-form-status').textContent = 'エラー: ' + err.message;
    btn.disabled = false; btn.textContent = '登録する';
  }
}

async function openRenbanDetail(eventId) {
  if (!_db) return;
  _rbCurrentEventId = eventId;
  try {
    const docSnap = await _db.collection('renban_events').doc(eventId).get();
    if (!docSnap.exists) return;
    const ev = { id: docSnap.id, ...docSnap.data() };
    const today = new Date(); today.setHours(0,0,0,0);
    const expired = ev.deadline ? new Date(ev.deadline) < today : false;

    // 複数日付対応：dates配列があればそちらを優先、なければdateを配列化
    const dates = (ev.dates && ev.dates.length) ? ev.dates : (ev.date ? [ev.date] : []);
    const isMultiDate = dates.length > 1;
    const dateDisplay = dates.join(', ');

    document.getElementById('rb-detail-title').textContent = ev.title;
    document.getElementById('rb-detail-info').innerHTML = `
      ${ev.owner ? '<div class="rb-detail-row"><span class="rb-detail-key">登録者</span><span class="rb-detail-val">' + escHtml(ev.owner) + '</span></div>' : ''}
      <div class="rb-detail-row"><span class="rb-detail-key">日付</span><span class="rb-detail-val">${escHtml(dateDisplay)}</span></div>
      <div class="rb-detail-row"><span class="rb-detail-key">募集人数</span><span class="rb-detail-val">${ev.maxPeople ? ev.maxPeople + '人まで' : '上限なし'}</span></div>
      <div class="rb-detail-row"><span class="rb-detail-key">募集期限</span><span class="rb-detail-val">${ev.deadline ? ev.deadline + (expired ? ' <span class="rb-expired">期限切れ</span>' : '') : '期限なし'}</span></div>
      ${ev.note ? '<div class="rb-detail-row"><span class="rb-detail-key">備考</span><span class="rb-detail-val">' + escHtml(ev.note) + '</span></div>' : ''}
    `;

    // 参加者読み込み
    const pSnap = await _db.collection('renban_events').doc(eventId).collection('participants').orderBy('createdAt', 'asc').get();
    const participants = pSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const joins = participants.filter(p => p.type === 'join');
    const interests = participants.filter(p => p.type === 'interest');

    // 参加者をuid（またはname）でグルーピングして表示
    const renderGrouped = (list) => {
      if (!list.length) return '<div class="rb-no-participants">まだいません</div>';
      const groups = {};
      list.forEach(p => {
        const key = p.uid ? ('uid:' + p.uid) : ('name:' + p.name);
        if (!groups[key]) groups[key] = { name: p.name, uid: p.uid || null, entries: [] };
        groups[key].entries.push(p);
      });
      return Object.values(groups).map(g => {
        const canDelete = (_currentUser && g.uid && g.uid === _currentUser.uid) || _isAdmin;
        const entriesHtml = g.entries.map(e => {
          const typeLabel = e.type === 'join'
            ? '<span class="rb-type-join">参加</span>'
            : '<span class="rb-type-interest">興味あり</span>';
          const switchLabel = e.type === 'join' ? '→興味あり' : '→参加する';
          const switchType  = e.type === 'join' ? 'interest' : 'join';
          const dateStr = isMultiDate && e.date ? `<span class="rb-entry-date">${escHtml(e.date)}</span>` : '';
          return `<div class="rb-participant-entry">
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
              ${dateStr}${typeLabel}
              ${e.note ? '<span class="rb-participant-note">' + escHtml(e.note) + '</span>' : ''}
            </div>
            ${canDelete ? `<div style="display:flex;gap:4px;flex-shrink:0;">
              <button class="rb-btn secondary" style="padding:2px 7px;font-size:10px;" onclick="switchRbParticipantType('${eventId}','${e.id}','${switchType}')">${switchLabel}</button>
              <button class="rb-btn secondary" style="padding:2px 8px;font-size:10px;" onclick="deleteRbParticipant('${eventId}','${e.id}')">削除</button>
            </div>` : ''}
          </div>`;
        }).join('');
        return `<div class="rb-participant-card">
          <div class="rb-participant-name">${escHtml(g.name)}</div>
          ${entriesHtml}
        </div>`;
      }).join('');
    };

    document.getElementById('rb-all-participants').innerHTML = renderGrouped(participants);
    const uniqueJoins    = _countUniqueParticipants(joins);
    const uniqueInterests = _countUniqueParticipants(interests);
    const countSummary = document.getElementById('rb-count-summary');
    if (countSummary) {
      countSummary.innerHTML = `<span style="color:#4caf82">✅ 参加 ${uniqueJoins}人</span>　<span style="color:#61afef">👀 興味あり ${uniqueInterests}人</span>`;
    }
    _rbCurrentEvent = { ev, dates, isMultiDate, joinCount: uniqueJoins, interestCount: uniqueInterests, joins, interests, participants };

    // イベント削除ボタン（本人/管理者のみ）
    const canDeleteEvent = (ev.uid && _currentUser && ev.uid === _currentUser.uid) || _isAdmin;
    const deleteRow = document.getElementById('rb-detail-delete-row');
    if (deleteRow) deleteRow.style.display = canDeleteEvent ? '' : 'none';
    const deleteBtn = document.getElementById('rb-detail-delete-btn');
    if (deleteBtn) deleteBtn.onclick = () => deleteRenbanEvent(eventId);

    // 参加ボタンの制御
    const isCreator = _currentUser && ev.uid && ev.uid === _currentUser.uid;
    let alreadyIn = false;
    if (_currentUser) {
      const userP = participants.filter(p => p.uid && p.uid === _currentUser.uid);
      if (isMultiDate) {
        const coveredDates = new Set(userP.map(p => p.date || dates[0]));
        alreadyIn = dates.every(d => coveredDates.has(d));
      } else {
        alreadyIn = userP.length > 0;
      }
    }
    const joinBtn = document.querySelector('#rb-detail-screen .rb-btn.join');
    const interestBtn = document.querySelector('#rb-detail-screen .rb-btn.interest');
    joinBtn.disabled = expired || isCreator || alreadyIn;
    interestBtn.disabled = expired || isCreator || alreadyIn;
    const btnHint = document.getElementById('rb-detail-btn-hint');
    if (btnHint) {
      if (isCreator) btnHint.textContent = '自分が作成したイベントには参加できません';
      else if (alreadyIn) btnHint.textContent = '既に参加登録済みです';
      else btnHint.textContent = '';
    }

    rbShowScreen('rb-detail-screen');
    openRbModal();
  } catch(err) {
    alert('エラー: ' + err.message);
  }
}

function openRbJoinModal(type) {
  _rbJoinType = type;
  document.getElementById('rb-join-name').value = _registeredName || '';
  document.getElementById('rb-join-note').value = '';
  document.getElementById('rb-join-status').textContent = '';
  const btn = document.getElementById('rb-join-submit-btn');
  btn.disabled = false; btn.textContent = '確定する';

  const dateGroup = document.getElementById('rb-join-date-group');
  const checksEl  = document.getElementById('rb-join-date-checks');
  const { dates = [], isMultiDate = false, participants = [] } = _rbCurrentEvent || {};

  if (isMultiDate && dates.length > 1) {
    document.getElementById('rb-join-modal-title').textContent = '参加 / 興味あり を登録';
    // ログイン済みの場合はすでに参加済みの日付を除外
    const coveredDates = _currentUser
      ? new Set(participants.filter(p => p.uid && p.uid === _currentUser.uid).map(p => p.date || dates[0]))
      : new Set();
    const remaining = dates.filter(d => !coveredDates.has(d));
    checksEl.innerHTML = remaining.map(d => {
      const rname = 'rbdt_' + d.replace(/-/g, '');
      const chkJoin     = type === 'join'     ? 'checked' : '';
      const chkInterest = type === 'interest' ? 'checked' : '';
      const chkNone     = !type               ? 'checked' : '';
      return `<div class="rb-date-row" data-date="${escHtml(d)}">
        <span class="rb-date-row-label">${escHtml(d)}</span>
        <div class="rb-date-type-group">
          <label class="rb-type-opt"><input type="radio" name="${rname}" value="join" ${chkJoin}><span class="type-join">参加</span></label>
          <label class="rb-type-opt"><input type="radio" name="${rname}" value="interest" ${chkInterest}><span class="type-interest">興味あり</span></label>
          <label class="rb-type-opt"><input type="radio" name="${rname}" value="" ${chkNone}><span class="type-none">なし</span></label>
        </div>
      </div>`;
    }).join('');
    dateGroup.style.display = remaining.length ? '' : 'none';
  } else {
    document.getElementById('rb-join-modal-title').textContent = type === 'join' ? '参加する' : '興味あり';
    dateGroup.style.display = 'none';
    checksEl.innerHTML = '';
  }

  rbShowScreen('rb-join-screen');
}

function rbSetAllDates(type) {
  document.querySelectorAll('#rb-join-date-checks .rb-date-row').forEach(row => {
    const radio = row.querySelector(`input[type=radio][value="${type}"]`);
    if (radio) radio.checked = true;
  });
}

async function submitRbParticipation() {
  if (!_db || !_rbCurrentEventId || !_rbJoinType) return;
  const btn = document.getElementById('rb-join-submit-btn');
  const name = document.getElementById('rb-join-name').value.trim();
  const note = document.getElementById('rb-join-note').value.trim();
  if (!name) { document.getElementById('rb-join-status').textContent = '名前を入力してください'; return; }

  const { isMultiDate = false, ev: currentEv, participants: currentParts = [] } = _rbCurrentEvent || {};
  const dateGroup = document.getElementById('rb-join-date-group');

  // 複数日付：各行のラジオから日付＋タイプを収集（「なし」はスキップ）
  let selections = [];
  if (isMultiDate && dateGroup && dateGroup.style.display !== 'none') {
    selections = [...document.querySelectorAll('#rb-join-date-checks .rb-date-row')].map(row => {
      const checked = row.querySelector('input[type=radio]:checked');
      return { date: row.dataset.date, type: checked ? checked.value : '' };
    }).filter(s => s.type);
    if (!selections.length) {
      document.getElementById('rb-join-status').textContent = '少なくとも1つ選択してください';
      return;
    }
  }

  btn.disabled = true; btn.textContent = '送信中...';
  document.getElementById('rb-join-status').textContent = '';
  try {
    if (_currentUser) {
      if (currentEv && currentEv.uid === _currentUser.uid) {
        document.getElementById('rb-join-status').textContent = '自分が作成したイベントには参加できません';
        btn.disabled = false; btn.textContent = '確定する'; return;
      }
      if (!isMultiDate) {
        const alreadyIn = currentParts.some(p => p.uid && p.uid === _currentUser.uid);
        if (alreadyIn) {
          document.getElementById('rb-join-status').textContent = '既に参加登録済みです';
          btn.disabled = false; btn.textContent = '確定する'; return;
        }
      }
    }
    if (isMultiDate && selections.length) {
      // 日付ごとにドキュメントを一括登録
      const batch = _db.batch();
      for (const { date, type } of selections) {
        const ref = _db.collection('renban_events').doc(_rbCurrentEventId).collection('participants').doc();
        const pData = { name, note, type, date, createdAt: firebase.firestore.FieldValue.serverTimestamp() };
        if (_currentUser) pData.uid = _currentUser.uid;
        batch.set(ref, pData);
      }
      await batch.commit();
    } else {
      if (!_rbJoinType) return;
      const pData = { name, note, type: _rbJoinType, createdAt: firebase.firestore.FieldValue.serverTimestamp() };
      if (_currentUser) pData.uid = _currentUser.uid;
      await _db.collection('renban_events').doc(_rbCurrentEventId).collection('participants').add(pData);
    }
    await openRenbanDetail(_rbCurrentEventId);
  } catch(err) {
    document.getElementById('rb-join-status').textContent = 'エラー: ' + err.message;
    btn.disabled = false; btn.textContent = '確定する';
  }
}

async function deleteRenbanEvent(eventId) {
  if (!_db || !_currentUser) return;
  if (!confirm('このイベントを削除しますか？参加者のデータも全て削除されます。')) return;
  try {
    const pSnap = await _db.collection('renban_events').doc(eventId).collection('participants').get();
    const batch = _db.batch();
    pSnap.docs.forEach(d => batch.delete(d.ref));
    batch.delete(_db.collection('renban_events').doc(eventId));
    await batch.commit();
    closeRbModal();
    initRenban();
  } catch(e) {
    alert('削除に失敗しました: ' + e.message);
  }
}

async function switchRbParticipantType(eventId, participantId, newType) {
  if (!_db || !_currentUser) return;
  try {
    await _db.collection('renban_events').doc(eventId).collection('participants').doc(participantId).update({ type: newType });
    await openRenbanDetail(eventId);
  } catch(e) { alert('切替に失敗しました: ' + e.message); }
}

async function deleteRbParticipant(eventId, participantId) {
  if (!_db || !_currentUser) return;
  if (!confirm('参加登録を削除しますか？')) return;
  try {
    await _db.collection('renban_events').doc(eventId).collection('participants').doc(participantId).delete();
    await openRenbanDetail(eventId);
  } catch(e) {
    alert('削除に失敗しました: ' + e.message);
  }
}

