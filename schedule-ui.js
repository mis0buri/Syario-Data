const MAKE_RSV_WEBHOOK_URL = atob('aHR0cHM6Ly9ob29rLmV1MS5tYWtlLmNvbS94YXdjaGcyeTQ0bnk4dHdkZHVoaGh6amo5N3U0YThuaQ==');

// ── 営業予定カレンダー ──
let calYear  = new Date().getFullYear();
let calMonth = new Date().getMonth(); // 0-indexed
let _jpHolidays = null; // { "YYYY-MM-DD": "祝日名", ... }

async function _getJpHolidays() {
  if (_jpHolidays) return _jpHolidays;
  try {
    const res = await fetch('https://holidays-jp.github.io/api/v1/date.json');
    _jpHolidays = await res.json();
  } catch { _jpHolidays = {}; }
  return _jpHolidays;
}

function moveCalMonth(diff) {
  calMonth += diff;
  if (calMonth > 11) { calMonth = 0;  calYear++; }
  if (calMonth < 0)  { calMonth = 11; calYear--; }
  renderCalendar();
}

async function renderCalendar() {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

  document.getElementById('cal-month-label').textContent =
    `${calYear}年 ${calMonth+1}月`;

  const holidays = await _getJpHolidays();

  const firstDay = new Date(calYear, calMonth, 1).getDay(); // 0=日
  const daysInMonth = new Date(calYear, calMonth+1, 0).getDate();
  const MARKS = { '◎':'mark-open', '〇':'mark-half', '△':'mark-short', '×':'mark-closed' };
  const DAYNAMES = ['日','月','火','水','木','金','土'];

  // 今月の予約件数を取得
  const rsvCount = {};
  if (_db) {
    try {
      const startStr = `${calYear}-${String(calMonth+1).padStart(2,'0')}-01`;
      const endStr   = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(daysInMonth).padStart(2,'0')}`;
      const snap = await _db.collection('reservations')
        .where('date', '>=', startStr)
        .where('date', '<=', endStr)
        .get();
      snap.forEach(doc => {
        const d = doc.data().date;
        if (d) rsvCount[d] = (rsvCount[d] || 0) + 1;
      });
    } catch(e) { /* 取得失敗時は無視 */ }
  }

  let html = DAYNAMES.map((d,i)=>
    `<div class="cal-dayname${i===0?' sun':i===6?' sat':''}">${d}</div>`
  ).join('');

  // 月初の空白
  for (let i=0; i<firstDay; i++) html += `<div class="cal-cell empty-cell"></div>`;

  for (let d=1; d<=daysInMonth; d++) {
    const dateStr = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const entry   = SCHEDULE_DATA[dateStr];
    const mark    = entry ? entry.mark  : '';
    const note    = entry ? entry.note  : '';
    const cls     = MARKS[mark] || '';
    const dow     = new Date(calYear, calMonth, d).getDay();
    const isHoliday = !!holidays[dateStr];
    const dowCls  = (dow===0 || isHoliday) ? ' sun' : dow===6 ? ' sat' : '';
    const isToday = dateStr===todayStr ? ' today' : '';
    const cnt     = rsvCount[dateStr] || 0;
    const holidayName = isHoliday ? `<span class="cal-holiday-name">${holidays[dateStr]}</span>` : '';
    html += `<div class="cal-cell ${cls}${isToday} clickable" onclick="openDayDetail('${dateStr}')">
      <span class="cal-daynum${dowCls}">${d}</span>
      ${holidayName}
      ${mark ? `<span class="cal-mark ${cls}">${mark}</span>` : ''}
      ${note ? `<span class="cal-note">${note}</span>` : ''}
      ${cnt > 0 ? `<span class="cal-rsv-badge">予約${cnt}</span>` : ''}
    </div>`;
  }

  document.getElementById('cal-grid').innerHTML = html;
}


let rsvCurrentDate = null;
let _currentDayRsvData = [];
let rsvPendingData = null;
let rsvFromDetail = false;


function showRsvScreen(id) {
  document.querySelectorAll('.rsv-screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.getElementById('rsv-overlay').classList.add('open');
}

function closeRsvModal() {
  document.getElementById('rsv-overlay').classList.remove('open');
  if (location.hash.startsWith('#schedule/')) history.pushState(null, '', location.pathname + location.search);
  rsvCurrentDate = null;
  rsvPendingData = null;
  _editMode = false;
  _editDocId = null;
  _rsvListSelectMode = false;
  _rsvListSelected.clear();
}

function rsvOverlayClick(e) {
  if (e.target === document.getElementById('rsv-overlay')) closeRsvModal();
}

async function openDayDetail(dateStr) {
  rsvCurrentDate = dateStr;
  history.pushState(null, '', '#schedule/' + dateStr);
  const parts = dateStr.split('-');
  const y = parseInt(parts[0]), m = parseInt(parts[1]), d = parseInt(parts[2]);
  const entry = SCHEDULE_DATA[dateStr];
  const MARK_CSS = { '◎':'mark-open', '〇':'mark-half', '△':'mark-short', '×':'mark-closed' };
  const MARK_LABELS = { '◎':'終日営業', '〇':'半日以上', '△':'短時間のみ', '×':'お休み' };
  const mark = entry ? entry.mark : '';
  const note = entry ? entry.note : '';

  document.getElementById('rsv-detail-title').textContent = `${y}年${m}月${d}日`;
  document.getElementById('rsv-detail-info').innerHTML =
    `${mark ? `<span class="cal-mark ${MARK_CSS[mark]||''}" style="font-size:26px">${mark}</span>` : ''}
     <div>
       <div class="rsv-date-label">${MARK_LABELS[mark] || '未定'}</div>
       ${note ? `<div class="rsv-date-note">${_escHtml(note)}</div>` : ''}
     </div>`;

  const rsvBtn = document.querySelector('#rsv-detail .rsv-btn.primary');
  if (rsvBtn) rsvBtn.style.display = (mark === '×' && !_isAdmin) ? 'none' : '';

  showRsvScreen('rsv-detail');

  const listEl = document.getElementById('rsv-detail-list');
  listEl.innerHTML = '<div class="rsv-empty">読み込み中...</div>';
  document.getElementById('rsv-join-list').innerHTML = '';
  document.getElementById('rsv-interest-list').innerHTML = '';
  document.getElementById('rsv-interest-hint').textContent = '';
  const joinBtn = document.getElementById('rsv-join-btn');
  const interestBtn = document.getElementById('rsv-interest-btn');
  if (joinBtn) { joinBtn.disabled = false; joinBtn.style.display = 'none'; }
  if (interestBtn) { interestBtn.disabled = false; interestBtn.style.display = 'none'; }
  const hintEl = document.getElementById('rsv-interest-hint');
  if (hintEl) hintEl.style.display = 'none';

  if (!_db) {
    listEl.innerHTML = '<div class="rsv-empty" style="color:var(--red);font-size:12px;">Firebase未設定（FIREBASE_CONFIGを入力してください）</div>';
    return;
  }
  try {
    const snap = await _db.collection('reservations')
      .where('date', '==', dateStr)
      .orderBy('createdAt', 'asc')
      .get();
    _currentDayRsvData = snap.docs.map(doc => {
      const dta = doc.data();
      const cats = (dta.categories || []).map(c => c === 'その他' && dta.otherText ? `その他(${dta.otherText})` : c);
      return { name: dta.name || '匿名', cats, note: dta.note || '' };
    });
    if (snap.empty) {
      listEl.innerHTML = '<div class="rsv-empty">まだ予約はありません</div>';
    } else {
      if (joinBtn) joinBtn.style.display = '';
      if (interestBtn) interestBtn.style.display = '';
      if (hintEl) hintEl.style.display = '';
      listEl.innerHTML = snap.docs.map(doc => {
        const dta = doc.data();
        const name = dta.name || '匿名';
        const cats = dta.categories || [];
        const otherText = dta.otherText || '';
        const rNote = dta.note || '';
        const displayCats = cats.map(c => c === 'その他' && otherText ? `その他(${_escHtml(otherText)})` : _escHtml(c));
        const safeId = doc.id.replace(/'/g, "\\'");
        const safeName = name.replace(/'/g, "\\'");
        const safeDateStr = dateStr.replace(/'/g, "\\'");
        const docUid = dta.uid || null;
        const isOwner = _currentUser && docUid && docUid === _currentUser.uid;
        const canManage = isOwner || _isAdmin;
        let actionsHtml = '';
        if (canManage) {
          actionsHtml = `<button class="rsv-edit-btn" onclick="openEditPinModal('${safeId}','${safeDateStr}')">編集</button>
            <button class="rsv-cancel-btn" onclick="openCancelModal('${safeId}','${safeName}','${safeDateStr}')">キャンセル</button>`;
        }
        return `<div class="rsv-card">
          <div class="rsv-card-name">${_escHtml(name)}</div>
          ${displayCats.length ? `<div class="rsv-card-cats">${displayCats.map(c=>`<span class="rsv-tag">${c}</span>`).join('')}</div>` : ''}
          ${rNote ? `<div class="rsv-card-note">${_escHtml(rNote)}</div>` : ''}
          ${actionsHtml ? `<div class="rsv-card-actions">${actionsHtml}</div>` : ''}
        </div>`;
      }).join('');
    }
  } catch(e) {
    listEl.innerHTML = '<div class="rsv-empty" style="color:var(--red);font-size:12px;">読み込みエラー</div>';
    console.error(e);
  }

  // 参加者・興味あり読み込み
  try {
    const pSnap = await _db.collection('rsv_participants')
      .where('date', '==', dateStr)
      .get();
    const participants = pSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const ta = a.createdAt ? a.createdAt.toMillis ? a.createdAt.toMillis() : 0 : 0;
        const tb = b.createdAt ? b.createdAt.toMillis ? b.createdAt.toMillis() : 0 : 0;
        return ta - tb;
      });
    const joins = participants.filter(p => p.type === 'join');
    const interests = participants.filter(p => p.type === 'interest');
    const renderPList = (list) => {
      if (!list.length) return '<div class="rsv-empty" style="font-size:12px;padding:4px 0">まだいません</div>';
      return list.map(p => {
        const safeId = p.id.replace(/'/g, "\\'");
        const safeDateStr = dateStr.replace(/'/g, "\\'");
        const isOwner = _currentUser && p.uid && p.uid === _currentUser.uid;
        const canDelete = isOwner || _isAdmin;
        const switchLabel = p.type === 'join' ? '→興味あり' : '→参加する';
        const switchType = p.type === 'join' ? 'interest' : 'join';
        return `<div class="rsv-card" style="padding:8px 12px;margin-bottom:6px;">
          <span class="rsv-card-name" style="font-size:14px;">${_escHtml(p.name || '匿名')}</span>
          ${p.note ? `<span style="font-size:12px;color:var(--dim);margin-left:8px;">${_escHtml(p.note)}</span>` : ''}
          ${canDelete ? `<div style="float:right;display:flex;gap:6px;margin-top:-2px;">
            <button class="rsv-edit-btn" style="font-size:11px;padding:3px 8px;" onclick="switchRsvParticipantType('${safeDateStr}','${safeId}','${switchType}')">${switchLabel}</button>
            <button class="rsv-cancel-btn" onclick="deleteRsvParticipant('${safeDateStr}','${safeId}')">削除</button>
          </div>` : ''}
        </div>`;
      }).join('');
    };
    document.getElementById('rsv-join-list').innerHTML = renderPList(joins);
    document.getElementById('rsv-interest-list').innerHTML = renderPList(interests);
    const alreadyIn = _currentUser && participants.some(p => p.uid && p.uid === _currentUser.uid);
    if (joinBtn) joinBtn.disabled = alreadyIn;
    if (interestBtn) interestBtn.disabled = alreadyIn;
    const hint = document.getElementById('rsv-interest-hint');
    if (hint) hint.textContent = alreadyIn ? '既に登録済みです' : '';
  } catch(e) { console.error('rsv_participants error:', e); }
}

async function postToX() {
  const dateStr = rsvCurrentDate;
  if (!dateStr) return;
  const parts = dateStr.split('-');
  const y = parseInt(parts[0]), mo = parseInt(parts[1]), d = parseInt(parts[2]);
  const entry = SCHEDULE_DATA[dateStr];
  const MARK_LABELS = { '◎':'終日営業', '〇':'半日以上', '△':'短時間のみ', '×':'お休み' };
  const MARK_COLORS = { '◎':'#98c379', '〇':'#61afef', '△':'#e5c07b', '×':'#e06c75' };
  const mark = entry ? entry.mark : '';
  const note = entry ? entry.note : '';
  const rsvs = _currentDayRsvData;

  // 参加者フェッチ
  let joins = [], interests = [];
  if (_db) {
    try {
      const pSnap = await _db.collection('rsv_participants').where('date', '==', dateStr).get();
      const all = pSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      joins = all.filter(p => p.type === 'join');
      interests = all.filter(p => p.type === 'interest');
    } catch(e) {}
  }

  const dpr = window.devicePixelRatio || 1;
  const W = 720, pad = 36, rowH = 34, noteH = 20;
  const rsvNoteExtra = rsvs.reduce((s, r) => s + (r.note ? noteH : 0), 0);
  const rsvSectionH = rsvs.length > 0 ? 48 + rsvs.length * rowH + rsvNoteExtra : 48;
  const hasParticipants = joins.length > 0 || interests.length > 0;
  const participantSectionH = hasParticipants
    ? 30 + 24 + joins.length * rowH + (interests.length > 0 ? 16 + 24 + interests.length * rowH : 0) + 20
    : 20;
  const H = 154 + rsvSectionH + participantSectionH;

  const canvas = document.createElement('canvas');
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  // 背景
  ctx.fillStyle = '#21252b';
  ctx.fillRect(0, 0, W, H);

  // 左アクセントバー
  const barColor = MARK_COLORS[mark] || '#528bff';
  ctx.fillStyle = barColor;
  ctx.fillRect(0, 0, 6, H);

  // 日付
  await document.fonts.ready;
  ctx.fillStyle = '#dde2ec';
  ctx.font = "bold 26px 'Noto Sans JP', sans-serif";
  ctx.fillText(`${y}年${mo}月${d}日`, pad, 50);

  // ステータス
  if (mark) {
    ctx.fillStyle = barColor;
    ctx.font = "bold 18px 'Noto Sans JP', sans-serif";
    ctx.fillText(`${mark}  ${MARK_LABELS[mark] || ''}`, pad, 86);
  }
  if (note) {
    ctx.fillStyle = '#7f848e';
    ctx.font = "14px 'Noto Sans JP', sans-serif";
    ctx.fillText(note, pad, 112);
  }

  // 区切り線
  ctx.strokeStyle = '#3a3f4b';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(pad, 130); ctx.lineTo(W - pad, 130); ctx.stroke();

  // 予約リスト
  let curY = 154;
  if (rsvs.length === 0) {
    ctx.fillStyle = '#5c6370';
    ctx.font = "16px 'Noto Sans JP', sans-serif";
    ctx.fillText('予約はありません', pad, curY + 12);
    curY += 48;
  } else {
    ctx.fillStyle = '#5c6370';
    ctx.font = "13px 'Noto Sans JP', sans-serif";
    ctx.fillText(`${rsvs.length}件の予約`, pad, curY);
    curY += 24;
    rsvs.forEach(rsv => {
      ctx.fillStyle = '#dde2ec';
      ctx.font = "bold 15px 'Noto Sans JP', sans-serif";
      ctx.fillText(rsv.name, pad, curY);
      if (rsv.cats && rsv.cats.length) {
        const nameW = ctx.measureText(rsv.name).width;
        ctx.fillStyle = '#61afef';
        ctx.font = "13px 'Noto Sans JP', sans-serif";
        ctx.fillText('  ' + rsv.cats.join(' / '), pad + nameW, curY);
      }
      curY += rowH;
      if (rsv.note) {
        ctx.fillStyle = '#7f848e';
        ctx.font = "13px 'Noto Sans JP', sans-serif";
        ctx.fillText('📝 ' + rsv.note, pad + 12, curY);
        curY += noteH;
      }
    });
  }

  // 参加・興味あり セクション
  curY += 14;
  ctx.strokeStyle = '#3a3f4b';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(pad, curY); ctx.lineTo(W - pad, curY); ctx.stroke();
  curY += 22;

  const drawPList = (label, list, color) => {
    ctx.fillStyle = '#5c6370';
    ctx.font = "13px 'Noto Sans JP', sans-serif";
    ctx.fillText(`${label}  ${list.length}人`, pad, curY);
    curY += 24;
    list.forEach(p => {
      ctx.fillStyle = '#dde2ec';
      ctx.font = "bold 15px 'Noto Sans JP', sans-serif";
      ctx.fillText(p.name || '匿名', pad + 12, curY);
      if (p.note) {
        const nameW = ctx.measureText(p.name || '匿名').width;
        ctx.fillStyle = '#7f848e';
        ctx.font = "13px 'Noto Sans JP', sans-serif";
        ctx.fillText('  ' + p.note, pad + 12 + nameW, curY);
      }
      curY += rowH;
    });
  };

  drawPList('参加', joins, '#98c379');
  if (interests.length > 0) {
    curY += 8;
    drawPList('興味あり', interests, '#e5c07b');
  }

  canvas.toBlob(async blob => {
    const file = new File([blob], `rsv-${dateStr}.png`, { type: 'image/png' });
    const shareUrl = location.origin + location.pathname + '#schedule/' + dateStr;
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], text: shareUrl }); return; } catch(e) { if (e.name === 'AbortError') return; }
    }
    // フォールバック：ダウンロード ＋ X投稿画面
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `rsv-${dateStr}.png`; a.click();
    URL.revokeObjectURL(url);
    setTimeout(() => window.open('https://x.com/intent/tweet?url=' + encodeURIComponent(shareUrl), '_blank'), 400);
  }, 'image/png');
}

function openReservationForm() {
  // デイ詳細経由：モーダルは既に開いている。rsvCurrentDateがセット済み
  rsvFromDetail = true;
  _initReservationForm(rsvCurrentDate);
}

function populateDateSelect() {
  const sel = document.getElementById('rsv-date-select');
  sel.innerHTML = '<option value="">日付を選択してください</option>';
  const DAYNAMES = ['日','月','火','水','木','金','土'];
  const today = new Date();
  for (let i = 0; i < 90; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    const dateStr = `${y}-${m}-${day}`;
    const entry = SCHEDULE_DATA[dateStr];
    if (!_isAdmin && (!entry || entry.mark === '×')) continue;
    const dayName = DAYNAMES[d.getDay()];
    const mark = entry ? ` ${entry.mark}` : '';
    const opt = document.createElement('option');
    opt.value = dateStr;
    opt.textContent = `${y}年${parseInt(m)}月${parseInt(day)}日（${dayName}）${mark}`;
    sel.appendChild(opt);
  }
}

function openReservationFormDirect() {
  rsvCurrentDate = null;
  rsvFromDetail = false;
  _initReservationForm(null);
}

function _initReservationForm(preselect) {
  populateDateSelect();
  if (preselect) document.getElementById('rsv-date-select').value = preselect;
  document.getElementById('rsv-date-group').style.display = 'block';
  document.getElementById('rsv-name').value = _registeredName || '';
  document.querySelectorAll('.rsv-checkbox-grid input[type=checkbox]').forEach(c => c.checked = false);
  document.getElementById('rsv-other-text').value = '';
  document.getElementById('rsv-other-wrap').style.display = 'none';
  document.getElementById('rsv-note').value = '';
  const rsvXWrap = document.getElementById('rsv-x-post-wrap');
  if (rsvXWrap) rsvXWrap.style.display = _isAdmin ? '' : 'none';
  showRsvScreen('rsv-form');
}

function toggleOtherInput() {
  const checked = document.getElementById('rsv-other-check').checked;
  document.getElementById('rsv-other-wrap').style.display = checked ? 'block' : 'none';
}

function backToDetail() {
  if (rsvFromDetail) {
    showRsvScreen('rsv-detail');
  } else {
    closeRsvModal();
  }
}
function backToForm() {
  rsvCurrentDate = null;
  showRsvScreen('rsv-form');
}

function showReservationConfirm(e) {
  e.preventDefault();
  // 常にセレクトから日付を取得
  const sel = document.getElementById('rsv-date-select');
  if (!sel.value) { alert('日付を選択してください'); return; }
  rsvCurrentDate = sel.value;
  const name = document.getElementById('rsv-name').value.trim() || '匿名';
  const cats = [...document.querySelectorAll('.rsv-checkbox-grid input[type=checkbox]:checked')].map(c => c.value);
  const otherText = document.getElementById('rsv-other-text').value.trim();
  const note = document.getElementById('rsv-note').value.trim();
  rsvPendingData = { name, categories: cats, otherText, note };

  const parts = rsvCurrentDate.split('-');
  const dateLabel = `${parseInt(parts[0])}年${parseInt(parts[1])}月${parseInt(parts[2])}日`;
  const displayCats = cats.map(c => c === 'その他' && otherText ? `その他(${otherText})` : c);

  document.getElementById('rsv-confirm-content').innerHTML = `
    <div class="rsv-confirm-row"><span class="rsv-confirm-key">日付</span><span class="rsv-confirm-val">${dateLabel}</span></div>
    <div class="rsv-confirm-row"><span class="rsv-confirm-key">お名前</span><span class="rsv-confirm-val">${_escHtml(name)}</span></div>
    <div class="rsv-confirm-row"><span class="rsv-confirm-key">種別</span><span class="rsv-confirm-val">${displayCats.length ? _escHtml(displayCats.join('、')) : 'なし'}</span></div>
    ${note ? `<div class="rsv-confirm-row"><span class="rsv-confirm-key">備考</span><span class="rsv-confirm-val">${_escHtml(note)}</span></div>` : ''}
  `;
  document.querySelector('#rsv-confirm .rsv-title').textContent = _editMode ? '編集確認' : '予約確認';
  document.getElementById('rsv-submit-btn').textContent = _editMode ? '変更を保存' : '確定する';
  showRsvScreen('rsv-confirm');
}

async function submitReservation() {
  if (!_db) { alert('Firebase未設定のため保存できません'); return; }
  if (!rsvPendingData || !rsvCurrentDate) return;
  const btn = document.getElementById('rsv-submit-btn');
  btn.disabled = true;
  btn.textContent = '送信中...';
  try {
    const payload = {
      date: rsvCurrentDate,
      name: rsvPendingData.name,
      categories: rsvPendingData.categories,
      otherText: rsvPendingData.otherText,
      note: rsvPendingData.note,
    };
    if (_currentUser) payload.uid = _currentUser.uid;
    if (_editMode && _editDocId) {
      await _db.collection('reservations').doc(_editDocId).update(payload);
    } else {
      payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      await _db.collection('reservations').add(payload);
    }
    // Discord通知
    try {
      const parts = rsvCurrentDate.split('-');
      const dateLabel = `${parseInt(parts[0])}年${parseInt(parts[1])}月${parseInt(parts[2])}日`;
      const displayCats = (rsvPendingData.categories || []).map(c => c === 'その他' && rsvPendingData.otherText ? `その他(${rsvPendingData.otherText})` : c);
      const lines = [
        `📅 **日付**: ${dateLabel}`,
        `👤 **お名前**: ${rsvPendingData.name}`,
        `🏷️ **種別**: ${displayCats.length ? displayCats.join('、') : 'なし'}`,
      ];
      if (rsvPendingData.note) lines.push(`📝 **備考**: ${rsvPendingData.note}`);
      const header = _editMode ? '__**予約が変更されました**__' : '__**新しい予約が入りました**__';
      await fetch('https://discord.com/api/webhooks/1486166648548495480/wy6ECJdXbBFWCEIobxfiV6V8T7ydzRSA52obbjvMqbo0o2rx-LBFqX9TZ6v5wk-ewxy-', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: `${header}\n${lines.join('\n')}` })
      });
    } catch(e) { console.warn('Discord通知失敗:', e); }
    // Make → X 通知（新規予約のみ）
    const rsvXCheck = document.getElementById('rsv-x-post-check');
    if (!_editMode && MAKE_RSV_WEBHOOK_URL && (!_isAdmin || rsvXCheck.checked)) {
      try {
        const parts2 = rsvCurrentDate.split('-');
        const dateLabel2 = `${parseInt(parts2[0])}年${parseInt(parts2[1])}月${parseInt(parts2[2])}日`;
        const displayCats2 = (rsvPendingData.categories || []).map(c => c === 'その他' && rsvPendingData.otherText ? `その他(${rsvPendingData.otherText})` : c);
        await fetch(MAKE_RSV_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'reservation',
            date: dateLabel2,
            name: rsvPendingData.name,
            categories: displayCats2.join('、') || 'なし',
            note: rsvPendingData.note || '',
            url: location.origin + location.pathname + '#schedule/' + rsvCurrentDate,
          })
        });
      } catch(e) { console.warn('Make通知失敗:', e); }
    }
    const ds = _editMode ? rsvCurrentDate : null;
    const wasEdit = _editMode;
    closeRsvModal();
    alert(wasEdit ? '予約を変更しました！' : '予約が完了しました！');
    if (wasEdit && ds) openDayDetail(ds);
  } catch(err) {
    alert('保存に失敗しました: ' + err.message);
    btn.disabled = false;
    btn.textContent = _editMode ? '変更を保存' : '確定する';
  }
}

async function openReservationList() {
  _rsvListSelectMode = false;
  _rsvListSelected.clear();
  _rsvListCache = [];
  showRsvScreen('rsv-list-screen');
  const content = document.getElementById('rsv-list-content');
  const btnWrap = document.getElementById('rsv-list-modal-btn-wrap');
  const confirmBar = document.getElementById('rsv-list-confirm-bar');
  if (btnWrap) btnWrap.style.display = 'none';
  if (confirmBar) confirmBar.style.display = 'none';
  content.innerHTML = '<div class="rsv-empty">読み込み中...</div>';
  if (!_db) {
    content.innerHTML = '<div class="rsv-empty" style="color:var(--red);font-size:12px;">Firebase未設定</div>';
    return;
  }
  try {
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' });
    const snap = await _db.collection('reservations')
      .where('date', '>=', todayStr)
      .orderBy('date', 'asc')
      .orderBy('createdAt', 'asc')
      .get();
    if (snap.empty) {
      content.innerHTML = '<div class="rsv-empty">今後の予約はありません</div>';
      if (btnWrap) {
        btnWrap.innerHTML = '<button class="rsv-btn x-post" onclick="shareRsvListEmpty()">共有</button>';
        btnWrap.style.display = '';
      }
      return;
    }
    const byDate = {};
    snap.docs.forEach(doc => {
      const dta = doc.data();
      const cats = (dta.categories || []).map(c =>
        c === 'その他' && dta.otherText ? `その他(${dta.otherText})` : c);
      if (!byDate[dta.date]) byDate[dta.date] = [];
      byDate[dta.date].push({ name: dta.name || '匿名', cats, note: dta.note || '' });
    });
    const dates = Object.keys(byDate).sort();
    _rsvListCache = await Promise.all(dates.map(async date => {
      let joins = [], interests = [];
      try {
        const pSnap = await _db.collection('rsv_participants').where('date', '==', date).get();
        const all = pSnap.docs.map(p => p.data());
        joins     = all.filter(p => p.type === 'join');
        interests = all.filter(p => p.type === 'interest');
      } catch(e) {}
      return { date, rsvs: byDate[date], joins, interests };
    }));
    _renderRsvListContent();
    if (btnWrap) {
      btnWrap.innerHTML = '<button class="rsv-btn x-post" onclick="enterRsvListSelectMode()">まとめて共有</button>';
      btnWrap.style.display = '';
    }
  } catch(e) {
    content.innerHTML = '<div class="rsv-empty" style="color:var(--red);font-size:12px;">読み込みエラー</div>';
    console.error(e);
  }
}

function _renderRsvListContent() {
  const DOW = ['日','月','火','水','木','金','土'];
  const sm = _rsvListSelectMode;
  document.getElementById('rsv-list-content').innerHTML = _rsvListCache.map(({ date, rsvs }) => {
    const [y, mo, d] = date.split('-').map(Number);
    const dow = DOW[new Date(Date.UTC(y, mo-1, d)).getUTCDay()];
    const isSelected = _rsvListSelected.has(date);
    const selCls = sm && isSelected ? ' boshu-selected' : '';
    const onclick = sm
      ? `toggleRsvListItem('${date}')`
      : `closeRsvModal();setTimeout(()=>openDayDetail('${date}'),80)`;
    const chk = sm ? `<span class="boshu-check-icon">${isSelected ? '☑' : '☐'}</span>` : '';
    return `<div class="rsv-list-item${selCls}" onclick="${onclick}" style="${sm ? 'display:flex;align-items:center;gap:10px;' : ''}">
      ${chk}<div style="${sm ? 'flex:1;min-width:0' : ''}">
        <div class="rsv-list-date">${mo}月${d}日（${dow}）</div>
        <div class="rsv-list-count">${rsvs.length}件の予約</div>
      </div>
    </div>`;
  }).join('');
}

function enterRsvListSelectMode() {
  _rsvListSelectMode = true;
  _rsvListSelected.clear();
  document.getElementById('rsv-list-confirm-bar').style.display = '';
  document.getElementById('rsv-list-modal-btn-wrap').style.display = 'none';
  _renderRsvListContent();
  _rsvListUpdateCount();
}

function exitRsvListSelectMode() {
  _rsvListSelectMode = false;
  _rsvListSelected.clear();
  document.getElementById('rsv-list-confirm-bar').style.display = 'none';
  document.getElementById('rsv-list-modal-btn-wrap').style.display = '';
  _renderRsvListContent();
}

function toggleRsvListItem(date) {
  if (!_rsvListSelected.has(date)) _rsvListSelected.add(date);
  else _rsvListSelected.delete(date);
  _renderRsvListContent();
  _rsvListUpdateCount();
}

function _rsvListUpdateCount() {
  const el = document.getElementById('rsv-list-select-count');
  const btn = document.getElementById('rsv-list-share-exec-btn');
  const allBtn = document.getElementById('rsv-list-select-all-btn');
  if (el) el.textContent = `${_rsvListSelected.size}件選択中`;
  if (btn) btn.disabled = _rsvListSelected.size === 0;
  if (allBtn) {
    const allSelected = _rsvListCache.length > 0 && _rsvListCache.every(g => _rsvListSelected.has(g.date));
    allBtn.textContent = allSelected ? '全解除' : '全選択';
  }
}

function toggleRsvListSelectAll() {
  const allSelected = _rsvListCache.length > 0 && _rsvListCache.every(g => _rsvListSelected.has(g.date));
  if (allSelected) _rsvListSelected.clear();
  else _rsvListCache.forEach(g => _rsvListSelected.add(g.date));
  _renderRsvListContent();
  _rsvListUpdateCount();
}

function shareRsvListSelected() {
  const items = _rsvListCache.filter(g => _rsvListSelected.has(g.date));
  _generateRsvListCanvas(items);
}

function shareRsvListEmpty() {
  _generateRsvListCanvas([]);
}

async function _generateRsvListCanvas(items) {
  const W = 720, pad = 36, rowH = 34, noteH = 20, SEP = 12;
  const MARK_LABELS = { '◎':'終日営業', '〇':'半日以上', '△':'短時間のみ', '×':'お休み' };
  const MARK_COLORS = { '◎':'#98c379', '〇':'#61afef', '△':'#e5c07b', '×':'#e06c75' };
  await document.fonts.ready;
  const dpr = window.devicePixelRatio || 1;
  let totalH, canvas, ctx;

  if (!items.length) {
    // 予約なし画像
    totalH = 230;
    canvas = document.createElement('canvas');
    canvas.width = W * dpr; canvas.height = totalH * dpr;
    ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#21252b';
    ctx.fillRect(0, 0, W, totalH);
    ctx.fillStyle = '#528bff';
    ctx.fillRect(0, 0, 6, totalH);
    ctx.fillStyle = '#dde2ec';
    ctx.font = "bold 22px 'Noto Sans JP', sans-serif";
    ctx.fillText('予約一覧', pad, 54);
    ctx.strokeStyle = '#3a3f4b'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad, 72); ctx.lineTo(W - pad, 72); ctx.stroke();
    ctx.fillStyle = '#5c6370';
    ctx.font = "bold 28px 'Noto Sans JP', sans-serif";
    ctx.fillText('予約なし', pad, 138);
    ctx.fillStyle = '#3e4451';
    ctx.font = "14px 'Noto Sans JP', sans-serif";
    ctx.fillText('現在、今後の予約はありません', pad, 176);
  } else {
    // 選択された日付のカード
    const calcH = (rsvs, joins, interests) => {
      const rsvNoteEx = rsvs.reduce((s, r) => s + (r.note ? noteH : 0), 0);
      const rsvSecH = rsvs.length > 0 ? 48 + rsvs.length * rowH + rsvNoteEx : 48;
      const pSecH = (joins.length || interests.length)
        ? 30 + 24 + joins.length * rowH + (interests.length ? 16 + 24 + interests.length * rowH : 0) + 20
        : 20;
      return 154 + rsvSecH + pSecH;
    };
    const heights = items.map(it => calcH(it.rsvs, it.joins, it.interests));
    totalH = heights.reduce((s, h) => s + h, 0) + Math.max(0, items.length - 1) * SEP;
    canvas = document.createElement('canvas');
    canvas.width = W * dpr; canvas.height = totalH * dpr;
    ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#21252b';
    ctx.fillRect(0, 0, W, totalH);

    let curY = 0;
    for (let i = 0; i < items.length; i++) {
      const { date, rsvs, joins, interests } = items[i];
      const cardH = heights[i];
      const [yr, mo, dy] = date.split('-').map(Number);
      const entry = SCHEDULE_DATA[date];
      const mark = entry ? entry.mark : '';
      const barColor = MARK_COLORS[mark] || '#528bff';

      ctx.fillStyle = barColor;
      ctx.fillRect(0, curY, 6, cardH);
      ctx.fillStyle = '#dde2ec';
      ctx.font = "bold 26px 'Noto Sans JP', sans-serif";
      ctx.fillText(`${yr}年${mo}月${dy}日`, pad, curY + 50);
      if (mark) {
        ctx.fillStyle = barColor;
        ctx.font = "bold 18px 'Noto Sans JP', sans-serif";
        ctx.fillText(`${mark}  ${MARK_LABELS[mark] || ''}`, pad, curY + 86);
      }
      if (entry && entry.note) {
        ctx.fillStyle = '#7f848e';
        ctx.font = "14px 'Noto Sans JP', sans-serif";
        ctx.fillText(entry.note, pad, curY + 112);
      }
      ctx.strokeStyle = '#3a3f4b'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(pad, curY + 130); ctx.lineTo(W - pad, curY + 130); ctx.stroke();

      let rY = curY + 154;
      if (!rsvs.length) {
        ctx.fillStyle = '#5c6370';
        ctx.font = "16px 'Noto Sans JP', sans-serif";
        ctx.fillText('予約はありません', pad, rY + 12);
        rY += 48;
      } else {
        ctx.fillStyle = '#5c6370';
        ctx.font = "13px 'Noto Sans JP', sans-serif";
        ctx.fillText(`${rsvs.length}件の予約`, pad, rY);
        rY += 24;
        rsvs.forEach(rsv => {
          ctx.fillStyle = '#dde2ec';
          ctx.font = "bold 15px 'Noto Sans JP', sans-serif";
          ctx.fillText(rsv.name, pad, rY);
          if (rsv.cats && rsv.cats.length) {
            const nw = ctx.measureText(rsv.name).width;
            ctx.fillStyle = '#61afef';
            ctx.font = "13px 'Noto Sans JP', sans-serif";
            ctx.fillText('  ' + rsv.cats.join(' / '), pad + nw, rY);
          }
          rY += rowH;
          if (rsv.note) {
            ctx.fillStyle = '#7f848e';
            ctx.font = "13px 'Noto Sans JP', sans-serif";
            ctx.fillText('📝 ' + rsv.note, pad + 12, rY);
            rY += noteH;
          }
        });
      }
      rY += 14;
      ctx.strokeStyle = '#3a3f4b'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(pad, rY); ctx.lineTo(W - pad, rY); ctx.stroke();
      rY += 22;

      const drawPL = (label, list) => {
        ctx.fillStyle = '#5c6370';
        ctx.font = "13px 'Noto Sans JP', sans-serif";
        ctx.fillText(`${label}  ${list.length}人`, pad, rY);
        rY += 24;
        list.forEach(p => {
          ctx.fillStyle = '#dde2ec';
          ctx.font = "bold 15px 'Noto Sans JP', sans-serif";
          ctx.fillText(p.name || '匿名', pad + 12, rY);
          if (p.note) {
            const nw = ctx.measureText(p.name || '匿名').width;
            ctx.fillStyle = '#7f848e';
            ctx.font = "13px 'Noto Sans JP', sans-serif";
            ctx.fillText('  ' + p.note, pad + 12 + nw, rY);
          }
          rY += rowH;
        });
      };
      drawPL('参加', joins);
      if (interests.length) { rY += 8; drawPL('興味あり', interests); }

      curY += cardH;
      if (i < items.length - 1) {
        ctx.fillStyle = '#2a2f3b';
        ctx.fillRect(0, curY, W, SEP);
        curY += SEP;
      }
    }
  }

  const shareUrl  = location.origin + location.pathname + '#schedule';
  const shareText = `予約一覧\n${shareUrl}`;
  const filename  = items.length ? 'rsv-list.png' : 'rsv-nashi.png';
  const includeSchedule = document.getElementById('rsv-include-schedule')?.checked;

  const toBlob = c => new Promise(resolve => c.toBlob(resolve, 'image/png'));
  const mainBlob = await toBlob(canvas);
  const schedBlob = includeSchedule ? await toBlob(await generateScheduleCanvas()) : null;

  const files = [new File([mainBlob], filename, { type: 'image/png' })];
  if (schedBlob) files.push(new File([schedBlob], 'schedule.png', { type: 'image/png' }));

  if (navigator.canShare && navigator.canShare({ files })) {
    try { await navigator.share({ files, text: shareText }); return; }
    catch(e) { if (e.name === 'AbortError') return; }
  }
  files.forEach((f, i) => {
    const url = URL.createObjectURL(f);
    const a = document.createElement('a');
    a.href = url; a.download = f.name;
    if (i > 0) setTimeout(() => { a.click(); URL.revokeObjectURL(url); }, i * 300);
    else { a.click(); URL.revokeObjectURL(url); }
  });
  try { await navigator.clipboard.writeText(shareText); } catch {}
  _boshuToast(items.length ? '画像をダウンロード・URLをコピーしました' : '画像をダウンロードしました');
}

// ── 予約一覧 選択モード ──
let _rsvListSelectMode = false;
let _rsvListSelected = new Set();
let _rsvListCache = []; // [{date, rsvs:[{name,cats}], joins:[], interests:[]}]

// ── 編集機能 ──
let _editMode = false, _editDocId = null, _editDateStr = null;

async function openEditPinModal(docId, dateStr) {
  _editDocId = docId;
  _editDateStr = dateStr;
  if (!_currentUser) { openLoginModal(); return; }
  try {
    const docSnap = await _db.collection('reservations').doc(docId).get();
    if (!docSnap.exists) { alert('予約が見つかりません'); return; }
    const data = docSnap.data();
    if (data.uid === _currentUser.uid || _isAdmin) {
      _loadEditForm(data, dateStr);
    } else {
      alert('この予約は本人のみ編集できます');
    }
  } catch(e) { alert('エラー: ' + e.message); }
}

function _loadEditForm(data, dateStr) {
  _editMode = true;
  rsvCurrentDate = dateStr;
  rsvFromDetail = true;
  populateDateSelect();
  document.getElementById('rsv-date-select').value = dateStr;
  document.getElementById('rsv-date-group').style.display = 'block';
  document.getElementById('rsv-name').value = data.name || '';
  document.querySelectorAll('.rsv-checkbox-grid input[type=checkbox]').forEach(c => {
    c.checked = (data.categories || []).includes(c.value);
  });
  const hasOther = (data.categories || []).includes('その他');
  document.getElementById('rsv-other-wrap').style.display = hasOther ? 'block' : 'none';
  document.getElementById('rsv-other-text').value = data.otherText || '';
  document.getElementById('rsv-note').value = data.note || '';
  const rsvXWrapEdit = document.getElementById('rsv-x-post-wrap');
  if (rsvXWrapEdit) rsvXWrapEdit.style.display = 'none';
  showRsvScreen('rsv-form');
}


// ── キャンセル機能 ──
async function openCancelModal(docId, name, dateStr) {
  if (!_currentUser) { openLoginModal(); return; }
  try {
    const docSnap = await _db.collection('reservations').doc(docId).get();
    if (!docSnap.exists) { alert('予約が見つかりません'); return; }
    const data = docSnap.data();
    if (data.uid === _currentUser.uid || _isAdmin) {
      if (!confirm(`「${name}」の予約をキャンセルしますか？`)) return;
      await _db.collection('reservations').doc(docId).delete();
      alert('予約をキャンセルしました');
      openDayDetail(dateStr);
    } else {
      alert('この予約は本人のみキャンセルできます');
    }
  } catch(e) { alert('エラー: ' + e.message); }
}

// ── 予約参加・興味あり ──
let _rsvInterestType = null;

function openRsvInterestModal(type) {
  _rsvInterestType = type;
  document.getElementById('rsv-interest-modal-title').textContent = type === 'join' ? '参加する' : '興味あり';
  document.getElementById('rsv-interest-name').value = _registeredName || '';
  document.getElementById('rsv-interest-note').value = '';
  document.getElementById('rsv-interest-status').textContent = '';
  const btn = document.getElementById('rsv-interest-submit-btn');
  btn.disabled = false; btn.textContent = '確定する';
  showRsvScreen('rsv-interest-screen');
}

async function submitRsvParticipation() {
  if (!_db || !rsvCurrentDate || !_rsvInterestType) return;
  const btn = document.getElementById('rsv-interest-submit-btn');
  const name = document.getElementById('rsv-interest-name').value.trim();
  const note = document.getElementById('rsv-interest-note').value.trim();
  if (!name) { document.getElementById('rsv-interest-status').textContent = '名前を入力してください'; return; }
  btn.disabled = true; btn.textContent = '送信中...';
  document.getElementById('rsv-interest-status').textContent = '';
  try {
    if (_currentUser) {
      const dupSnap = await _db.collection('rsv_participants')
        .where('date', '==', rsvCurrentDate)
        .where('uid', '==', _currentUser.uid).get();
      if (!dupSnap.empty) {
        document.getElementById('rsv-interest-status').textContent = '既に登録済みです';
        btn.disabled = false; btn.textContent = '確定する'; return;
      }
    }
    const pData = { date: rsvCurrentDate, name, note, type: _rsvInterestType, createdAt: firebase.firestore.FieldValue.serverTimestamp() };
    if (_currentUser) pData.uid = _currentUser.uid;
    await _db.collection('rsv_participants').add(pData);
    await openDayDetail(rsvCurrentDate);
  } catch(err) {
    document.getElementById('rsv-interest-status').textContent = 'エラー: ' + err.message;
    btn.disabled = false; btn.textContent = '確定する';
  }
}

async function switchRsvParticipantType(dateStr, participantId, newType) {
  if (!_db) return;
  try {
    await _db.collection('rsv_participants').doc(participantId).update({ type: newType });
    await openDayDetail(dateStr);
  } catch(e) { alert('切替に失敗しました: ' + e.message); }
}

async function deleteRsvParticipant(dateStr, participantId) {
  if (!_db) return;
  if (!confirm('登録を削除しますか？')) return;
  try {
    await _db.collection('rsv_participants').doc(participantId).delete();
    await openDayDetail(dateStr);
  } catch(e) { alert('削除に失敗しました: ' + e.message); }
}
