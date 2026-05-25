// ── 募集一覧 状態管理 ──
let _boshuCache = null;  // { renbanEvents:[], rsvGroups:[] }
let _boshuSelectMode = false;
let _boshuSelected = new Set();  // "renban:{id}" | "rsv:{YYYY-MM-DD}"

async function initBoshu() {
  _boshuSelectMode = false;
  _boshuSelected.clear();
  _boshuCache = null;

  const renbanEl = document.getElementById('boshu-renban-list');
  const rsvEl    = document.getElementById('boshu-rsv-list');

  if (!_db) {
    renbanEl.innerHTML = '<div class="renban-empty">データベース未接続</div>';
    rsvEl.innerHTML    = '<div class="renban-empty">データベース未接続</div>';
    _boshuUpdateAdminBar();
    return;
  }

  renbanEl.innerHTML = '<div class="renban-empty">読み込み中...</div>';
  rsvEl.innerHTML    = '<div class="renban-empty">読み込み中...</div>';

  const renbanEvents = [];
  const rsvGroups    = [];

  // ── 連番募集（参加者ごと取得） ──
  try {
    const snap = await _db.collection('renban_events').orderBy('date', 'asc').get();
    await Promise.all(snap.docs.map(async d => {
      const ev = { id: d.id, ...d.data() };
      const pSnap = await _db.collection('renban_events').doc(d.id)
        .collection('participants').orderBy('createdAt', 'asc').get();
      const parts = pSnap.docs.map(p => ({ id: p.id, ...p.data() }));
      ev._joins     = parts.filter(p => p.type === 'join');
      ev._interests = parts.filter(p => p.type === 'interest');
      ev._joinCount     = _countUniqueParticipants(ev._joins);
      ev._interestCount = _countUniqueParticipants(ev._interests);
      renbanEvents.push(ev);
    }));
  } catch(e) {
    renbanEl.innerHTML = '<div class="renban-empty">読み込みエラー: ' + e.message + '</div>';
  }

  // ── 予約（今日以降、日付ごと + rsv_participants） ──
  try {
    const todayStr = new Date().toLocaleDateString('en-CA', {timeZone:'Asia/Tokyo'});
    const snap = await _db.collection('reservations')
      .where('date', '>=', todayStr).orderBy('date', 'asc').get();
    const byDate = {};
    snap.docs.forEach(d => {
      const r = d.data();
      const cats = (r.categories || []).map(c =>
        c === 'その他' && r.otherText ? `その他(${r.otherText})` : c);
      if (!byDate[r.date]) byDate[r.date] = [];
      byDate[r.date].push({ name: r.name || '匿名', cats, note: r.note || '' });
    });
    await Promise.all(Object.keys(byDate).map(async date => {
      let joins = [], interests = [];
      try {
        const pSnap = await _db.collection('rsv_participants').where('date', '==', date).get();
        const all = pSnap.docs.map(p => p.data());
        joins     = all.filter(p => p.type === 'join');
        interests = all.filter(p => p.type === 'interest');
      } catch(e) {}
      rsvGroups.push({ date, rsvs: byDate[date], joins, interests });
    }));
    rsvGroups.sort((a, b) => a.date < b.date ? -1 : 1);
  } catch(e) {
    rsvEl.innerHTML = '<div class="renban-empty">読み込みエラー: ' + e.message + '</div>';
  }

  _boshuCache = { renbanEvents, rsvGroups };
  _boshuRender();
}

function _boshuUpdateAdminBar() {
  const bar = document.getElementById('boshu-admin-bar');
  if (bar) bar.style.display = _isAdmin ? '' : 'none';
}

function _boshuRender() {
  if (!_boshuCache) return;
  const { renbanEvents, rsvGroups } = _boshuCache;
  const sm  = _boshuSelectMode;
  const sel = _boshuSelected;
  const DOW = ['日','月','火','水','木','金','土'];
  const todayJST = new Date(
    new Date().toLocaleDateString('en-CA', {timeZone:'Asia/Tokyo'}) + 'T00:00:00+09:00');

  _boshuUpdateAdminBar();
  document.getElementById('boshu-confirm-bar').style.display = sm ? '' : 'none';
  if (sm) _boshuUpdateCount();

  // ── 連番募集 ──
  const renbanEl = document.getElementById('boshu-renban-list');
  const activeRenban  = renbanEvents.filter(ev => !_isRenbanExpired(ev, todayJST));
  const expiredRenban = renbanEvents.filter(ev =>  _isRenbanExpired(ev, todayJST));

  if (!activeRenban.length) {
    renbanEl.innerHTML = '<div class="renban-empty">現在募集中のイベントはありません</div>';
  } else {
    renbanEl.innerHTML = activeRenban.map(ev => {
      const maxStr      = ev.maxPeople ? ev.maxPeople + '人まで' : '上限なし';
      const deadlineStr = ev.deadline || '期限なし';
      const key         = `renban:${ev.id}`;
      const isSelected  = sel.has(key);
      const selCls      = sm && isSelected ? ' boshu-selected' : '';
      const onclick     = sm ? `toggleBoshuItem('${key}')` : `openRenbanDetail('${ev.id}')`;
      const chk         = sm ? `<span class="boshu-check-icon">${isSelected ? '☑' : '☐'}</span>` : '';
      return `<div class="renban-item${selCls}" onclick="${onclick}" style="${sm ? 'display:flex;align-items:flex-start;gap:10px;' : ''}">
        ${chk}<div style="${sm ? 'flex:1;min-width:0' : ''}">
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
        </div>
      </div>`;
    }).join('');
  }

  if (expiredRenban.length) {
    renbanEl.innerHTML += `<div class="renban-expired-section">
      <button class="renban-expired-toggle" onclick="openBoshuExpiredList()">期限切れ一覧 (${expiredRenban.length}件)</button>
    </div>`;
  }

  // ── 予約 ──
  const rsvEl = document.getElementById('boshu-rsv-list');
  if (!rsvGroups.length) {
    rsvEl.innerHTML = '<div class="renban-empty">今後の予約はありません</div>';
  } else {
    rsvEl.innerHTML = rsvGroups.map(({ date, rsvs, joins = [], interests = [] }) => {
      const [y, mo, d] = date.split('-').map(Number);
      const dow        = DOW[new Date(Date.UTC(y, mo-1, d)).getUTCDay()];
      const label      = `${mo}月${d}日（${dow}）`;
      const key        = `rsv:${date}`;
      const isSelected = sel.has(key);
      const selCls     = sm && isSelected ? ' boshu-selected' : '';
      const onclick    = sm ? `toggleBoshuItem('${key}')` : `openDayDetail('${date}')`;
      const chk        = sm ? `<span class="boshu-check-icon">${isSelected ? '☑' : '☐'}</span>` : '';
      const jCnt = _countUniqueParticipants(joins);
      const iCnt = _countUniqueParticipants(interests);
      const countHtml = (jCnt || iCnt)
        ? `<span style="color:#4caf82;margin-left:8px;">✅ ${jCnt}</span><span style="color:#61afef;margin-left:6px;">👀 ${iCnt}</span>`
        : '';
      const entries    = rsvs.map(r => {
        const cats = r.cats.filter(c => c !== 'その他').join('・') || '';
        return `<div class="boshu-rsv-entry">
          <span>👤 ${escHtml(r.name)}</span>
          ${cats ? `<span class="boshu-rsv-cats">${escHtml(cats)}</span>` : ''}
        </div>`;
      }).join('');
      return `<div class="boshu-rsv-item${selCls}" onclick="${onclick}" style="${sm ? 'display:flex;align-items:flex-start;gap:10px;' : ''}">
        ${chk}<div style="${sm ? 'flex:1;min-width:0' : ''}">
          <div class="boshu-rsv-date">📅 ${label}${countHtml}</div>
          <div class="boshu-rsv-entries">${entries}</div>
        </div>
      </div>`;
    }).join('');
  }
}

function openBoshuExpiredList() {
  if (!_boshuCache) return;
  const today = new Date(); today.setHours(0,0,0,0);
  _rbExpiredEvents = _boshuCache.renbanEvents
    .filter(ev => _isRenbanExpired(ev, today))
    .sort((a, b) => {
      const da = (a.dates && a.dates.length) ? a.dates[0] : (a.date || '');
      const db = (b.dates && b.dates.length) ? b.dates[0] : (b.date || '');
      return db.localeCompare(da);
    });
  openRenbanExpiredList();
}

// ── 選択モード操作 ──
function enterBoshuSelectMode() {
  _boshuSelectMode = true;
  _boshuSelected.clear();
  _boshuRender();
}

function exitBoshuSelectMode() {
  _boshuSelectMode = false;
  _boshuSelected.clear();
  _boshuRender();
}

function toggleBoshuItem(key) {
  if (!_boshuSelectMode) return;
  if (_boshuSelected.has(key)) _boshuSelected.delete(key);
  else _boshuSelected.add(key);
  _boshuRender();
}

function _boshuUpdateCount() {
  const el     = document.getElementById('boshu-select-count');
  const btn    = document.getElementById('boshu-share-exec-btn');
  const allBtn = document.getElementById('boshu-select-all-btn');
  if (el)  el.textContent = `${_boshuSelected.size}件選択中`;
  if (btn) btn.disabled   = _boshuSelected.size === 0;
  if (allBtn && _boshuCache) {
    const today = new Date(); today.setHours(0,0,0,0);
    const activeRenbanCount = _boshuCache.renbanEvents.filter(ev => !_isRenbanExpired(ev, today)).length;
    const total = activeRenbanCount + _boshuCache.rsvGroups.length;
    allBtn.textContent = (total > 0 && _boshuSelected.size === total) ? '全解除' : '全選択';
  }
}

function toggleBoshuSelectAll() {
  if (!_boshuCache) return;
  const today = new Date(); today.setHours(0,0,0,0);
  const allKeys = [
    ..._boshuCache.renbanEvents.filter(ev => !_isRenbanExpired(ev, today)).map(ev => `renban:${ev.id}`),
    ..._boshuCache.rsvGroups.map(g  => `rsv:${g.date}`),
  ];
  const allSelected = allKeys.length > 0 && allKeys.every(k => _boshuSelected.has(k));
  if (allSelected) {
    _boshuSelected.clear();
  } else {
    allKeys.forEach(k => _boshuSelected.add(k));
  }
  _boshuRender();
}

// ── まとめて共有：canvas 合成 ──
async function shareBoshuSelected() {
  if (!_boshuSelected.size || !_boshuCache) return;

  const { renbanEvents, rsvGroups } = _boshuCache;
  const W = 720, pad = 36, rowH = 34, pRowH = 28, noteRowH = 20, SEP = 12;
  const MARK_LABELS = { '◎':'終日営業', '〇':'半日以上', '△':'短時間のみ', '×':'お休み' };
  const MARK_COLORS = { '◎':'#98c379', '〇':'#61afef', '△':'#e5c07b', '×':'#e06c75' };

  // 選択アイテムをデータに変換（予約→連番の順）
  const items = [];
  for (const key of _boshuSelected) {
    if (key.startsWith('rsv:')) {
      const g = rsvGroups.find(g => g.date === key.slice(4));
      if (g)  items.push({ type:'rsv', date: g.date, rsvs: g.rsvs||[], joins: g.joins||[], interests: g.interests||[] });
    } else if (key.startsWith('renban:')) {
      const ev = renbanEvents.find(e => e.id === key.slice(7));
      if (ev) items.push({ type:'renban', ev, joins: ev._joins||[], interests: ev._interests||[] });
    }
  }
  if (!items.length) return;
  // 予約→連番の順で日付ソート
  items.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'rsv' ? -1 : 1;
    const da = a.type === 'renban' ? a.ev.date : a.date;
    const db2 = b.type === 'renban' ? b.ev.date : b.date;
    return da < db2 ? -1 : da > db2 ? 1 : 0;
  });

  // 0件のカテゴリにプレースホルダーを追加
  const hasRsv    = items.some(it => it.type === 'rsv');
  const hasRenban = items.some(it => it.type === 'renban');
  if (!hasRsv)    items.unshift({ type: 'placeholder', label: '予約なし',    color: '#528bff' });
  if (!hasRenban) items.push(   { type: 'placeholder', label: '連番募集なし', color: '#c8a96e' });

  await document.fonts.ready;

  // 各カード高さ計算
  const calcRenbanH = (ev, joins, interests) => {
    const rowsN = 4 + (ev.owner ? 1 : 0) + (ev.note ? 1 : 0);
    const allP  = [...joins, ...interests].slice(0, 5);
    const hasMore = (joins.length + interests.length) > 5;
    const pTotal  = allP.reduce((s, p) => s + pRowH + (p.note ? noteRowH : 0), 0);
    const pSecH   = allP.length ? 16 + 22 + pTotal + (hasMore ? pRowH : 0) + 12 : 0;
    return 60 + 50 + 16 + rowsN * rowH + pSecH + 28;
  };
  const calcRsvH = (rsvs, joins, interests) => {
    const rsvNoteEx = rsvs.reduce((s, r) => s + (r.note ? noteRowH : 0), 0);
    const rsvSecH = rsvs.length > 0 ? 48 + rsvs.length * rowH + rsvNoteEx : 48;
    const hasPart = joins.length > 0 || interests.length > 0;
    const pSecH   = hasPart
      ? 30 + 24 + joins.length * rowH + (interests.length > 0 ? 16 + 24 + interests.length * rowH : 0) + 20
      : 20;
    return 154 + rsvSecH + pSecH;
  };

  const PLACEHOLDER_H = 130;
  const heights = items.map(it =>
    it.type === 'placeholder' ? PLACEHOLDER_H :
    it.type === 'renban'
      ? calcRenbanH(it.ev, it.joins, it.interests)
      : calcRsvH(it.rsvs, it.joins, it.interests));
  const totalH = heights.reduce((s, h) => s + h, 0) + Math.max(0, items.length - 1) * SEP;

  const dpr = window.devicePixelRatio || 1;
  const canvas = document.createElement('canvas');
  canvas.width  = W * dpr; canvas.height = totalH * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  // 全体背景
  ctx.fillStyle = '#21252b';
  ctx.fillRect(0, 0, W, totalH);

  let curY = 0;

  for (let i = 0; i < items.length; i++) {
    const it = items[i], cardH = heights[i];

    if (it.type === 'placeholder') {
      ctx.fillStyle = it.color;
      ctx.fillRect(0, curY, 6, cardH);
      ctx.fillStyle = '#5c6370';
      ctx.font = "bold 22px 'Noto Sans JP', sans-serif";
      ctx.fillText(it.label, pad, curY + Math.round(cardH / 2) + 8);
    } else if (it.type === 'renban') {
      // ── 連番募集カード ──
      const { ev, joins, interests } = it;
      const evDateDisplay = (ev.dates && ev.dates.length ? ev.dates : (ev.date ? [ev.date] : [])).join(', ');
      const rows = [
        ...(ev.owner ? [['募集者', ev.owner]] : []),
        ['日付',    evDateDisplay || ''],
        ['募集人数', ev.maxPeople ? ev.maxPeople + '人まで' : '上限なし'],
        ['募集期限', ev.deadline || '期限なし'],
        ...(ev.note ? [['備考', ev.note]] : []),
        ['参加 / 興味', `✅ ${joins.length}人　👀 ${interests.length}人`],
      ];
      ctx.fillStyle = '#c8a96e';
      ctx.fillRect(0, curY, 6, cardH);
      ctx.fillStyle = '#dde2ec';
      ctx.font = "bold 22px 'Noto Sans JP', sans-serif";
      const maxTW = W - pad * 2;
      let title = ev.title || '';
      while (ctx.measureText(title).width > maxTW && title.length) title = title.slice(0,-1);
      if (title !== ev.title) title += '…';
      ctx.fillText(title, pad, curY + 46);
      ctx.strokeStyle = '#3a3f4b'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(pad, curY+62); ctx.lineTo(W-pad, curY+62); ctx.stroke();
      let y = curY + 90;
      rows.forEach(([k, v]) => {
        ctx.fillStyle = '#7f848e';
        ctx.font = "13px 'Noto Sans JP', sans-serif";
        ctx.fillText(k, pad, y);
        ctx.fillStyle = '#dde2ec';
        ctx.font = "14px 'Noto Sans JP', sans-serif";
        const vx = pad + 100;
        let vs = String(v);
        while (ctx.measureText(vs).width > W - vx - pad && vs.length) vs = vs.slice(0,-1);
        if (vs !== String(v)) vs += '…';
        ctx.fillText(vs, vx, y);
        y += rowH;
      });
      const allP = [
        ...joins.map(p => ({ name: p.name||'匿名', note: p.note||'', t:'join' })),
        ...interests.map(p => ({ name: p.name||'匿名', note: p.note||'', t:'interest' })),
      ].slice(0, 5);
      const totalP = joins.length + interests.length;
      if (allP.length) {
        y += 8;
        ctx.strokeStyle = '#3a3f4b'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W-pad, y); ctx.stroke();
        y += 20;
        ctx.fillStyle = '#7f848e';
        ctx.font = "12px 'Noto Sans JP', sans-serif";
        ctx.fillText('参加者', pad, y);
        y += pRowH - 2;
        allP.forEach(p => {
          const icon = p.t === 'join' ? '✅' : '👀';
          ctx.fillStyle = '#dde2ec';
          ctx.font = "14px 'Noto Sans JP', sans-serif";
          let nm = p.name;
          while (ctx.measureText(`${icon} ${nm}…`).width > W-pad*2-20 && nm.length) nm = nm.slice(0,-1);
          if (nm !== p.name) nm += '…';
          ctx.fillText(`${icon} ${nm}`, pad+16, y);
          y += pRowH;
          if (p.note) {
            ctx.fillStyle = '#7f848e';
            ctx.font = "12px 'Noto Sans JP', sans-serif";
            let nt = p.note;
            while (ctx.measureText(nt+'…').width > W-pad*2-36 && nt.length) nt = nt.slice(0,-1);
            if (nt !== p.note) nt += '…';
            ctx.fillText(nt, pad+32, y);
            y += noteRowH;
          }
        });
        if (totalP > 5) {
          ctx.fillStyle = '#7f848e';
          ctx.font = "12px 'Noto Sans JP', sans-serif";
          ctx.fillText(`… 他 ${totalP-5} 人`, pad+16, y);
        }
      }

    } else {
      // ── 予約カード ──
      const { date, rsvs, joins, interests } = it;
      const pts = date.split('-');
      const yr = parseInt(pts[0]), mo = parseInt(pts[1]), dy = parseInt(pts[2]);
      const entry    = SCHEDULE_DATA[date];
      const mark     = entry ? entry.mark : '';
      const noteText = entry ? entry.note : '';
      const barColor = MARK_COLORS[mark] || '#528bff';

      ctx.fillStyle = barColor;
      ctx.fillRect(0, curY, 6, cardH);
      ctx.fillStyle = '#dde2ec';
      ctx.font = "bold 26px 'Noto Sans JP', sans-serif";
      ctx.fillText(`${yr}年${mo}月${dy}日`, pad, curY + 50);
      if (mark) {
        ctx.fillStyle = barColor;
        ctx.font = "bold 18px 'Noto Sans JP', sans-serif";
        ctx.fillText(`${mark}  ${MARK_LABELS[mark]||''}`, pad, curY + 86);
      }
      if (noteText) {
        ctx.fillStyle = '#7f848e';
        ctx.font = "14px 'Noto Sans JP', sans-serif";
        ctx.fillText(noteText, pad, curY + 112);
      }
      ctx.strokeStyle = '#3a3f4b'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(pad, curY+130); ctx.lineTo(W-pad, curY+130); ctx.stroke();

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
          if (rsv.note) {
            ctx.fillStyle = '#7f848e';
            ctx.font = "13px 'Noto Sans JP', sans-serif";
            ctx.fillText('📝 ' + rsv.note, pad + 12, rY);
            rY += noteRowH;
          }
          rY += rowH;
        });
      }
      rY += 14;
      ctx.strokeStyle = '#3a3f4b'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(pad, rY); ctx.lineTo(W-pad, rY); ctx.stroke();
      rY += 22;

      const drawPL = (label, list) => {
        ctx.fillStyle = '#5c6370';
        ctx.font = "13px 'Noto Sans JP', sans-serif";
        ctx.fillText(`${label}  ${list.length}人`, pad, rY);
        rY += 24;
        list.forEach(p => {
          ctx.fillStyle = '#dde2ec';
          ctx.font = "bold 15px 'Noto Sans JP', sans-serif";
          ctx.fillText(p.name||'匿名', pad+12, rY);
          if (p.note) {
            const nw = ctx.measureText(p.name||'匿名').width;
            ctx.fillStyle = '#7f848e';
            ctx.font = "13px 'Noto Sans JP', sans-serif";
            ctx.fillText('  '+p.note, pad+12+nw, rY);
          }
          rY += rowH;
        });
      };
      drawPL('参加', joins);
      if (interests.length) { rY += 8; drawPL('興味あり', interests); }
    }

    curY += cardH;
    if (i < items.length - 1) {
      ctx.fillStyle = '#2a2f3b';
      ctx.fillRect(0, curY, W, SEP);
      curY += SEP;
    }
  }

  const shareUrl  = location.origin + location.pathname + '#boshu';
  const shareText = `各種募集一覧\n${shareUrl}`;
  const includeSchedule = document.getElementById('boshu-include-schedule')?.checked;

  const toBlob = c => new Promise(resolve => c.toBlob(resolve, 'image/png'));
  const mainBlob = await toBlob(canvas);
  const schedBlob = includeSchedule ? await toBlob(await generateScheduleCanvas()) : null;

  const files = [new File([mainBlob], 'boshu-matome.png', { type:'image/png' })];
  if (schedBlob) files.push(new File([schedBlob], 'schedule.png', { type:'image/png' }));

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
  _boshuToast('画像をダウンロード・URLをコピーしました');
}

function _boshuToast(msg) {
  const t = document.createElement('div');
  t.textContent = msg;
  Object.assign(t.style, {
    position:'fixed', bottom:'24px', left:'50%', transform:'translateX(-50%)',
    background:'var(--surface)', border:'1px solid var(--border)', color:'var(--text)',
    padding:'8px 20px', borderRadius:'8px', fontSize:'13px', zIndex:'9999',
    boxShadow:'0 4px 16px rgba(0,0,0,.4)', pointerEvents:'none',
  });
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}
