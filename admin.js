// ── 管理者機能 ──
let _adminMembers = null;
let _adminGathersCache = [];
let _adminCurrentGatherId = null;

async function _loadAdminMembers() {
  if (!_db) return (DATA && DATA.members) ? DATA.members.map(m=>m.name) : [];
  try {
    const doc = await _db.collection('admin_config').doc('main').get();
    if (doc.exists && doc.data().members) return [...doc.data().members];
  } catch(e) {}
  return (DATA && DATA.members) ? DATA.members.map(m=>m.name) : [];
}

// ─ メンバー管理 ─
let _editingMember = null; // 編集中のメンバー名

async function initAdminMembers() {
  if (!_isAdmin) return;
  const listEl = document.getElementById('admin-member-list');
  listEl.innerHTML = '<div class="admin-empty">読み込み中...</div>';
  _adminMembers = await _loadAdminMembers();
  _editingMember = null;
  _renderAdminMemberList();
}

function _renderAdminMemberList() {
  const listEl = document.getElementById('admin-member-list');
  if (!_adminMembers || !_adminMembers.length) {
    listEl.innerHTML = '<div class="admin-empty">メンバーがいません</div>';
    return;
  }
  listEl.innerHTML = _adminMembers.map(name => {
    if (name === _editingMember) {
      return `<div class="admin-member-item">
        <input type="text" id="admin-member-edit-input" class="admin-input"
          value="${_esc(name)}" style="flex:1;min-width:0;margin-right:8px;"
          onkeydown="if(event.key==='Enter')saveAdminMemberRename('${_esc(name)}');if(event.key==='Escape')cancelEditAdminMember();">
        <button class="admin-btn sm primary" onclick="saveAdminMemberRename('${_esc(name)}')">保存</button>
        <button class="admin-btn sm" onclick="cancelEditAdminMember()">キャンセル</button>
      </div>`;
    }
    return `<div class="admin-member-item">
      <span class="admin-member-name">${_esc(name)}</span>
      <div style="display:flex;gap:6px;flex-shrink:0;">
        <button class="admin-btn sm" onclick="startEditAdminMember('${_esc(name)}')">編集</button>
        <button class="admin-btn sm danger" onclick="removeAdminMember('${_esc(name)}')">削除</button>
      </div>
    </div>`;
  }).join('');
  if (_editingMember) {
    const inp = document.getElementById('admin-member-edit-input');
    if (inp) { inp.focus(); inp.select(); }
  }
}

function addAdminMember() {
  const input = document.getElementById('admin-new-member-input');
  const name = input.value.trim();
  const statusEl = document.getElementById('admin-status-members');
  if (!name) return;
  if (_adminMembers && _adminMembers.includes(name)) {
    statusEl.textContent = '既に登録されています';
    statusEl.className = 'admin-status error';
    return;
  }
  if (!_adminMembers) _adminMembers = [];
  _adminMembers.push(name);
  input.value = '';
  statusEl.textContent = '';
  _renderAdminMemberList();
}

function startEditAdminMember(name) {
  _editingMember = name;
  _renderAdminMemberList();
}

function cancelEditAdminMember() {
  _editingMember = null;
  _renderAdminMemberList();
}

function saveAdminMemberRename(oldName) {
  const inp = document.getElementById('admin-member-edit-input');
  const newName = inp ? inp.value.trim() : '';
  const statusEl = document.getElementById('admin-status-members');
  if (!newName) {
    statusEl.textContent = '名前を入力してください';
    statusEl.className = 'admin-status error';
    return;
  }
  if (newName !== oldName && _adminMembers.includes(newName)) {
    statusEl.textContent = '同じ名前が既に登録されています';
    statusEl.className = 'admin-status error';
    return;
  }
  const idx = _adminMembers.indexOf(oldName);
  if (idx >= 0) _adminMembers[idx] = newName;
  _editingMember = null;
  statusEl.textContent = '';
  _renderAdminMemberList();
}

function removeAdminMember(name) {
  if (!_adminMembers) return;
  _adminMembers = _adminMembers.filter(m => m !== name);
  _renderAdminMemberList();
}

async function saveAdminMembers() {
  if (!_isAdmin || !_db) return;
  const statusEl = document.getElementById('admin-status-members');
  statusEl.textContent = '保存中...';
  statusEl.className = 'admin-status';
  try {
    await _db.collection('admin_config').doc('main').set({ members: _adminMembers || [] }, { merge: true });
    statusEl.textContent = '保存しました ✓';
    statusEl.className = 'admin-status ok';
  } catch(e) {
    statusEl.textContent = 'エラー: ' + e.message;
    statusEl.className = 'admin-status error';
  }
}

// ─ 対局登録 ─
async function initAdminGather() {
  if (!_isAdmin) return;
  const members = await _loadAdminMembers();
  _adminMembers = members;
  const checksEl = document.getElementById('admin-gather-member-checks');
  checksEl.innerHTML = members.length
    ? members.map(name => `
        <label class="admin-member-check">
          <input type="checkbox" value="${_esc(name)}" class="admin-gather-member-cb">
          ${_esc(name)}
        </label>`).join('')
    : '<div class="admin-empty">メンバーがいません（先にメンバー管理で追加してください）</div>';
  await _reloadAdminGatherList();
}

async function _reloadAdminGatherList() {
  const listEl = document.getElementById('admin-gather-list');
  listEl.innerHTML = '<div class="admin-empty">読み込み中...</div>';
  if (!_db) { listEl.innerHTML = '<div class="admin-empty">DBに接続されていません</div>'; return; }
  try {
    const snap = await _db.collection('admin_gathers').orderBy('date','desc').get();
    _adminGathersCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _renderAdminGatherList();
  } catch(e) {
    listEl.innerHTML = `<div class="admin-empty" style="color:var(--red)">エラー: ${_esc(e.message)}</div>`;
  }
}

function _renderAdminGatherList() {
  const listEl = document.getElementById('admin-gather-list');
  if (!_adminGathersCache.length) {
    listEl.innerHTML = '<div class="admin-empty">登録された対局がありません</div>';
    return;
  }
  listEl.innerHTML = _adminGathersCache.map(g => {
    const timeStr = g.start ? (g.start + (g.end ? '〜'+g.end : '')) : '';
    const memberStr = (g.members || []).join('、');
    const matchCnt = (g.matches || []).length;
    return `<div class="admin-gather-card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
        <div style="min-width:0">
          <div class="admin-gather-date">${_esc(g.date)}</div>
          <div class="admin-gather-meta">${timeStr ? _esc(timeStr)+' &nbsp;' : ''}レート${g.rate||'?'}点</div>
          <div class="admin-gather-meta">${_esc(memberStr)}</div>
          <div class="admin-gather-meta">${matchCnt}半荘</div>
        </div>
        <button class="admin-btn sm danger" style="flex-shrink:0;" onclick="deleteAdminGather('${g.id}')">削除</button>
      </div>
    </div>`;
  }).join('');
}

async function submitAdminGather() {
  if (!_isAdmin || !_db) return;
  const statusEl = document.getElementById('admin-status-gather');
  const date = document.getElementById('admin-gather-date').value;
  if (!date) {
    statusEl.textContent = '日付を入力してください';
    statusEl.className = 'admin-status error';
    return;
  }
  const members = [...document.querySelectorAll('.admin-gather-member-cb:checked')].map(cb => cb.value);
  if (members.length < 2) {
    statusEl.textContent = '参加メンバーを2人以上選択してください';
    statusEl.className = 'admin-status error';
    return;
  }
  const start = document.getElementById('admin-gather-start').value;
  const end   = document.getElementById('admin-gather-end').value;
  const rate  = parseInt(document.getElementById('admin-gather-rate').value) || 0;
  statusEl.textContent = '登録中...';
  statusEl.className = 'admin-status';
  try {
    await _db.collection('admin_gathers').add({
      date, start, end, rate, members, matches: [],
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    statusEl.textContent = '登録しました ✓';
    statusEl.className = 'admin-status ok';
    document.getElementById('admin-gather-date').value = '';
    document.getElementById('admin-gather-start').value = '';
    document.getElementById('admin-gather-end').value = '';
    document.getElementById('admin-gather-rate').value = '';
    document.querySelectorAll('.admin-gather-member-cb').forEach(cb => cb.checked = false);
    await _reloadAdminGatherList();
  } catch(e) {
    statusEl.textContent = 'エラー: ' + e.message;
    statusEl.className = 'admin-status error';
  }
}

async function deleteAdminGather(id) {
  if (!_isAdmin || !_db) return;
  if (!confirm('この対局を削除しますか？')) return;
  try {
    await _db.collection('admin_gathers').doc(id).delete();
    _adminGathersCache = _adminGathersCache.filter(g => g.id !== id);
    _renderAdminGatherList();
    if (currentSection === 'admin-score') initAdminScore();
  } catch(e) {
    alert('削除に失敗しました: ' + e.message);
  }
}

// ─ スコア入力 ─
async function initAdminScore() {
  if (!_isAdmin) return;
  if (!_adminGathersCache.length && _db) {
    try {
      const snap = await _db.collection('admin_gathers').orderBy('date','desc').get();
      _adminGathersCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch(e) {}
  }
  const sel = document.getElementById('admin-score-gather-select');
  sel.innerHTML = '<option value="">-- 対局を選択してください --</option>'
    + _adminGathersCache.map(g => {
        const memberStr = (g.members||[]).join(',');
        return `<option value="${g.id}">${_esc(g.date)} (${_esc(memberStr)})</option>`;
      }).join('');
  document.getElementById('admin-score-content').style.display = 'none';
  document.getElementById('admin-score-empty').style.display = '';
  _adminCurrentGatherId = null;
}

async function loadAdminScoreGather() {
  const sel = document.getElementById('admin-score-gather-select');
  const id = sel.value;
  if (!id) {
    document.getElementById('admin-score-content').style.display = 'none';
    document.getElementById('admin-score-empty').style.display = '';
    _adminCurrentGatherId = null;
    return;
  }
  _adminCurrentGatherId = id;
  let gather = null;
  try {
    const doc = await _db.collection('admin_gathers').doc(id).get();
    if (doc.exists) gather = { id: doc.id, ...doc.data() };
  } catch(e) {}
  if (!gather) gather = _adminGathersCache.find(g => g.id === id);
  if (!gather) return;
  const cIdx = _adminGathersCache.findIndex(g => g.id === id);
  if (cIdx >= 0) _adminGathersCache[cIdx] = gather;

  const timeStr = gather.start ? gather.start + (gather.end ? '〜'+gather.end : '') : '';
  document.getElementById('admin-score-gather-info').innerHTML =
    `<strong>${_esc(gather.date)}</strong> ${timeStr ? _esc(timeStr)+' ' : ''}レート${gather.rate||'?'}点 &nbsp;${_esc((gather.members||[]).join('、'))}`;

  _renderAdminMatchList(gather);
  document.getElementById('admin-score-content').style.display = '';
  document.getElementById('admin-score-empty').style.display = 'none';
  document.getElementById('admin-status-score').textContent = '';
}

function _renderAdminMatchList(gather) {
  const members = gather.members || [];
  const matches = gather.matches || [];
  const listEl = document.getElementById('admin-match-list');
  if (!matches.length) {
    listEl.innerHTML = '<div class="admin-empty" style="margin-bottom:8px;">半荘がありません。「+ 半荘を追加」で追加してください。</div>';
    return;
  }
  listEl.innerHTML = matches.map((m, idx) => _buildMatchRowHtml(m, idx, members)).join('');
}

function _buildMatchRowHtml(m, idx, members) {
  const scores = m.scores || members.map(() => null);
  const ranks  = m.ranks  || members.map(() => null);
  const isChip = !!m.isChip;
  const scoreInputs = members.map((name, mi) => {
    const sc = (scores[mi] !== null && scores[mi] !== undefined) ? scores[mi] : '';
    const rk = ranks[mi];
    const badge = rk ? `<span class="admin-rank-badge admin-rank-${rk}">${rk}</span>` : '';
    return `<div class="admin-score-item">
      <label id="admin-score-label-${idx}-${mi}">${_esc(name)}${badge}</label>
      <input type="number" class="admin-score-input" data-mi="${mi}" data-match-idx="${idx}"
        value="${sc}" placeholder="点数" oninput="adminAutoRank(${idx})">
    </div>`;
  }).join('');
  return `<div class="admin-match-row" id="admin-match-row-${idx}">
    <div class="admin-match-header">
      <span class="admin-match-label">第${idx+1}局${isChip ? '（チップ）' : ''}</span>
      <div style="display:flex;gap:6px;align-items:center;">
        <label style="font-size:12px;display:flex;align-items:center;gap:4px;cursor:pointer;">
          <input type="checkbox" class="admin-match-chip" data-match-idx="${idx}" ${isChip?'checked':''}> チップ
        </label>
        <button class="admin-btn sm danger" onclick="removeAdminMatch(${idx})">削除</button>
      </div>
    </div>
    <div class="admin-score-grid">${scoreInputs}</div>
  </div>`;
}

function adminAutoRank(idx) {
  const gather = _adminGathersCache.find(g => g.id === _adminCurrentGatherId);
  if (!gather) return;
  const members = gather.members || [];
  const row = document.getElementById('admin-match-row-'+idx);
  if (!row) return;
  const inputs = [...row.querySelectorAll('.admin-score-input')];
  const scores = inputs.map(inp => inp.value.trim() !== '' ? parseFloat(inp.value) : null);
  const ranks  = _calcRanks(scores);
  members.forEach((name, mi) => {
    const labelEl = document.getElementById(`admin-score-label-${idx}-${mi}`);
    if (!labelEl) return;
    const existing = labelEl.querySelector('.admin-rank-badge');
    if (existing) existing.remove();
    const rk = ranks[mi];
    if (rk) {
      const badge = document.createElement('span');
      badge.className = `admin-rank-badge admin-rank-${rk}`;
      badge.textContent = rk;
      labelEl.appendChild(badge);
    }
  });
}

function _calcRanks(scores) {
  const indexed = scores.map((s,i) => ({s,i})).filter(({s}) => s !== null && s !== undefined && !isNaN(s));
  indexed.sort((a,b) => b.s - a.s);
  const ranks = scores.map(() => null);
  indexed.forEach(({i}, rank) => { ranks[i] = rank + 1; });
  return ranks;
}

function addAdminMatch() {
  const gather = _adminGathersCache.find(g => g.id === _adminCurrentGatherId);
  if (!gather) return;
  const members = gather.members || [];
  gather.matches = [...(gather.matches||[]), { mNo:0, isChip:false, scores:members.map(()=>null), ranks:members.map(()=>null) }];
  _renderAdminMatchList(gather);
}

function removeAdminMatch(idx) {
  const gather = _adminGathersCache.find(g => g.id === _adminCurrentGatherId);
  if (!gather) return;
  gather.matches = (gather.matches||[]).filter((_,i) => i !== idx);
  _renderAdminMatchList(gather);
}

async function saveAdminScore() {
  if (!_isAdmin || !_db || !_adminCurrentGatherId) return;
  const statusEl = document.getElementById('admin-status-score');
  const gather = _adminGathersCache.find(g => g.id === _adminCurrentGatherId);
  if (!gather) return;
  const members = gather.members || [];

  const matchRows = [...document.querySelectorAll('.admin-match-row')];
  const matches = matchRows.map(row => {
    const inputs = [...row.querySelectorAll('.admin-score-input')];
    const scores = inputs.map(inp => inp.value.trim() !== '' ? parseFloat(inp.value) : null);
    const ranks  = _calcRanks(scores);
    const isChip = !!row.querySelector('.admin-match-chip:checked');
    return { mNo:0, isChip, scores, ranks };
  });

  statusEl.textContent = '保存中...';
  statusEl.className = 'admin-status';
  try {
    await _db.collection('admin_gathers').doc(_adminCurrentGatherId).update({ matches });
    gather.matches = matches;
    statusEl.textContent = '保存しました ✓';
    statusEl.className = 'admin-status ok';
    _renderAdminMatchList(gather);
  } catch(e) {
    statusEl.textContent = 'エラー: ' + e.message;
    statusEl.className = 'admin-status error';
  }
}

// ─ スケジュール管理 ─
async function initAdminSchedule() {
  if (!_isAdmin) return;
  _renderAdminScheduleList();
}

function _renderAdminScheduleList() {
  const listEl = document.getElementById('admin-schedule-list');
  if (!listEl) return;
  // Show all dates from SCHEDULE_DATA (schedule.js base + Firestore overrides merged)
  const today = new Date().toISOString().slice(0, 10);
  const entries = Object.entries(SCHEDULE_DATA).filter(([d]) => d >= today).sort(([a],[b]) => a.localeCompare(b));
  if (!entries.length) {
    listEl.innerHTML = '<div class="admin-empty">スケジュールデータがありません</div>';
    return;
  }
  const MARK_CSS = { '◎':'mark-open','〇':'mark-half','△':'mark-short','×':'mark-closed' };
  listEl.innerHTML = entries.map(([date, data]) => {
    const isOverride = Object.prototype.hasOwnProperty.call(_firestoreSchedule, date);
    const overrideBadge = isOverride
      ? '<span style="font-size:10px;background:var(--accent);color:#000;border-radius:3px;padding:1px 5px;margin-left:6px;vertical-align:middle;">上書き</span>'
      : '';
    const deleteBtn = isOverride
      ? `<button class="admin-btn sm danger" onclick="deleteAdminScheduleEntry('${_esc(date)}')">削除</button>`
      : '';
    return `
    <div class="admin-gather-card" style="cursor:default;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
        <div style="min-width:0;">
          <span class="admin-gather-date">${_esc(date)}</span>
          <span class="cal-mark ${MARK_CSS[data.mark]||''}" style="margin-left:8px;font-size:15px;">${_esc(data.mark)}</span>
          ${overrideBadge}
          ${data.note ? `<span style="font-size:12px;color:var(--dim);margin-left:6px;">${_esc(data.note)}</span>` : ''}
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0;">
          <button class="admin-btn sm" onclick="editAdminScheduleEntry('${_esc(date)}')">編集</button>
          ${deleteBtn}
        </div>
      </div>
    </div>`;
  }).join('');
}

function editAdminScheduleEntry(date) {
  document.getElementById('admin-sch-date').value = date;
  // Use current SCHEDULE_DATA value (Firestore override if exists, else schedule.js base)
  const data = SCHEDULE_DATA[date] || {};
  const radio = document.querySelector(`input[name="admin-sch-mark"][value="${data.mark || '×'}"]`);
  if (radio) radio.checked = true;
  document.getElementById('admin-sch-note').value = data.note || '';
  document.getElementById('admin-sch-date').scrollIntoView({ behavior:'smooth', block:'center' });
}

async function saveAdminScheduleEntry() {
  if (!_isAdmin || !_db) return;
  const statusEl = document.getElementById('admin-status-schedule');
  const date = document.getElementById('admin-sch-date').value;
  const mark = document.querySelector('input[name="admin-sch-mark"]:checked')?.value;
  const note = document.getElementById('admin-sch-note').value.trim();

  if (!date) { statusEl.textContent = '日付を選択してください'; statusEl.className = 'admin-status error'; return; }
  if (!mark) { statusEl.textContent = '記号を選択してください'; statusEl.className = 'admin-status error'; return; }
  if ((mark === '〇' || mark === '△') && !note) {
    statusEl.textContent = '〇/△ の場合は備考が必要です'; statusEl.className = 'admin-status error'; return;
  }

  statusEl.textContent = '保存中...'; statusEl.className = 'admin-status';
  const entry = { mark, ...(note ? { note } : {}) };
  _firestoreSchedule[date] = entry;
  SCHEDULE_DATA[date] = entry; // ライブ反映

  try {
    await _db.collection('admin_config').doc('schedule').set({ dates: _firestoreSchedule });
    statusEl.textContent = '保存しました ✓'; statusEl.className = 'admin-status ok';
    // フォームリセット
    document.getElementById('admin-sch-date').value = '';
    document.getElementById('admin-sch-note').value = '';
    document.querySelector('input[name="admin-sch-mark"][value="×"]').checked = true;
    _renderAdminScheduleList();
    if (currentSection === 'schedule') renderCalendar();
    if (currentSection === 'top') renderTopSchedule();
  } catch(e) {
    statusEl.textContent = 'エラー: ' + e.message; statusEl.className = 'admin-status error';
    // ロールバック
    delete _firestoreSchedule[date];
    if (_SCHEDULE_ORIG[date]) { SCHEDULE_DATA[date] = _SCHEDULE_ORIG[date]; } else { delete SCHEDULE_DATA[date]; }
  }
}

async function deleteAdminScheduleEntry(date) {
  if (!_isAdmin || !_db) return;
  if (!confirm(`${date} の設定を削除しますか？\nschedule.jsの設定に戻ります。`)) return;

  delete _firestoreSchedule[date];
  // 元のschedule.jsに値があれば復元、なければ削除
  if (_SCHEDULE_ORIG[date]) { SCHEDULE_DATA[date] = _SCHEDULE_ORIG[date]; } else { delete SCHEDULE_DATA[date]; }

  try {
    await _db.collection('admin_config').doc('schedule').set({ dates: _firestoreSchedule });
    _renderAdminScheduleList();
    if (currentSection === 'schedule') renderCalendar();
    if (currentSection === 'top') renderTopSchedule();
  } catch(e) {
    alert('削除に失敗しました: ' + e.message);
  }
}
