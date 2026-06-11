// ── 管理者機能 ──
let _adminMembers = null;
let _adminGathersCache = [];
let _adminCurrentGatherId = null;
let _editingGatherId = null;

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
        <div style="display:flex;gap:6px;flex-shrink:0;">
          <button class="admin-btn sm" onclick="editAdminGather('${g.id}')">編集</button>
          <button class="admin-btn sm danger" onclick="deleteAdminGather('${g.id}')">削除</button>
        </div>
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
  statusEl.textContent = _editingGatherId ? '更新中...' : '登録中...';
  statusEl.className = 'admin-status';
  try {
    if (_editingGatherId) {
      await _db.collection('admin_gathers').doc(_editingGatherId).update({ date, start, end, rate, members });
      const idx = _adminGathersCache.findIndex(g => g.id === _editingGatherId);
      if (idx >= 0) _adminGathersCache[idx] = { ..._adminGathersCache[idx], date, start, end, rate, members };
      statusEl.textContent = '更新しました ✓';
      statusEl.className = 'admin-status ok';
      _cancelEditGather();
    } else {
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
    }
    await _reloadAdminGatherList();
  } catch(e) {
    statusEl.textContent = 'エラー: ' + e.message;
    statusEl.className = 'admin-status error';
  }
}

function editAdminGather(id) {
  const g = _adminGathersCache.find(g => g.id === id);
  if (!g) return;
  _editingGatherId = id;
  document.getElementById('admin-gather-date').value  = g.date  || '';
  document.getElementById('admin-gather-start').value = g.start || '';
  document.getElementById('admin-gather-end').value   = g.end   || '';
  document.getElementById('admin-gather-rate').value  = g.rate  || '';
  document.querySelectorAll('.admin-gather-member-cb').forEach(cb => {
    cb.checked = (g.members || []).includes(cb.value);
  });
  document.getElementById('admin-gather-submit').textContent = '更新する';
  document.getElementById('admin-gather-cancel').style.display = '';
  const statusEl = document.getElementById('admin-status-gather');
  statusEl.textContent = '編集中: ' + g.date;
  statusEl.className = 'admin-status';
  document.getElementById('admin-gather-date').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function _cancelEditGather() {
  _editingGatherId = null;
  document.getElementById('admin-gather-date').value  = '';
  document.getElementById('admin-gather-start').value = '';
  document.getElementById('admin-gather-end').value   = '';
  document.getElementById('admin-gather-rate').value  = '';
  document.querySelectorAll('.admin-gather-member-cb').forEach(cb => cb.checked = false);
  document.getElementById('admin-gather-submit').textContent = '登録する';
  document.getElementById('admin-gather-cancel').style.display = 'none';
  document.getElementById('admin-status-gather').textContent = '';
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

let _adminSchSortAsc = true;

function toggleAdminSchSort() {
  _adminSchSortAsc = !_adminSchSortAsc;
  _renderAdminScheduleList();
}

function _renderAdminScheduleList() {
  const listEl = document.getElementById('admin-schedule-list');
  if (!listEl) return;
  const today = new Date().toISOString().slice(0, 10);
  const entries = Object.entries(SCHEDULE_DATA).filter(([d]) => d >= today)
    .sort(([a],[b]) => _adminSchSortAsc ? a.localeCompare(b) : b.localeCompare(a));
  const sortBtn = document.getElementById('admin-sch-sort-btn');
  if (sortBtn) sortBtn.textContent = _adminSchSortAsc ? '↑ 昇順' : '↓ 降順';
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

function openAdminScheduleEdit(date) {
  closeRsvModal();
  showSection('admin-schedule');
  editAdminScheduleEntry(date);
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

async function copyPublicScheduleUrl() {
  const fullUrl = location.origin + location.pathname + '?public=1';
  const btn = document.getElementById('admin-copy-public-url-btn');
  const orig = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '生成中...'; }
  let copyUrl = fullUrl;
  try {
    const res = await fetch('https://is.gd/create.php?format=simple&url=' + encodeURIComponent(fullUrl));
    if (res.ok) copyUrl = (await res.text()).trim();
  } catch { /* 失敗時はフルURLをそのままコピー */ }
  try {
    await navigator.clipboard.writeText(copyUrl);
    if (btn) { btn.disabled = false; btn.textContent = 'コピーしました！'; setTimeout(() => { btn.textContent = orig; }, 2000); }
  } catch {
    if (btn) { btn.disabled = false; btn.textContent = orig; }
    prompt('以下のURLをコピーしてください', copyUrl);
  }
}

// ── AI議論 ──
let _aiDiscList = [];
let _aiDiscCurrentId = null;
let _aiDiscCurrentDoc = null;
let _aiDiscAutoOutput = null; // 自動生成された議論（保存待ち。output=Markdown, detail=構造化データ）
let _aiDiscAutoProgress = null; // 途中失敗時の再開用 { key, round1All, round2All }

let _aiDiscApiKeys = { gemini: '', groq: '' };

// Groqの無料モデルは改廃があるため、ペルソナごとのモデルは設定で差し替え可能（空欄ならデフォルト）
const _AI_DISC_DEFAULT_MODELS = { logic: 'openai/gpt-oss-120b', nova: 'openai/gpt-oss-20b', guard: 'llama-3.3-70b-versatile' };

const _AI_DISC_PERSONAS = {
  logic: { name: 'ロジック', emoji: '🔵', role: '分析派AI', desc: 'データと論理を重視し、客観的・体系的に分析する分析派AIです。', groqModel: _AI_DISC_DEFAULT_MODELS.logic },
  nova:  { name: 'ノヴァ',   emoji: '🟠', role: '革新派AI', desc: '楽観的で創造的。新しい可能性やアイデアを提示する革新派AIです。', groqModel: _AI_DISC_DEFAULT_MODELS.nova },
  guard: { name: 'ガード',   emoji: '🟢', role: '慎重派AI', desc: 'リスクや問題点を指摘する批判的思考の持ち主。現実的な制約を重視する慎重派AIです。', groqModel: _AI_DISC_DEFAULT_MODELS.guard },
};

// MAGIモード用ペルソナ。キー(logic/nova/guard)ごとのモデル設定はデフォルトモードと共通で適用される
const _AI_DISC_MAGI_PERSONAS = {
  logic: { name: 'MAGI-1 メルキオール', emoji: '🔴', role: '理論家AI', desc: '原理原則と長期的視点を重視する理論家AIです。目先の損得よりも、筋が通っているか・将来どうなるかを基準に判断します。', groqModel: _AI_DISC_DEFAULT_MODELS.logic },
  guard: { name: 'MAGI-2 バルタザール', emoji: '🔵', role: '保護者AI', desc: '関係者への影響と安全を最優先する保護者AIです。「それで困る人はいないか」「みんなが納得できるか」という共感とケアの視点から語ります。', groqModel: _AI_DISC_DEFAULT_MODELS.guard },
  nova:  { name: 'MAGI-3 カスパー', emoji: '🟡', role: '現実主義AI', desc: '感情・直感・本音を代弁する現実主義AIです。建前や理屈を一旦置いて、「実際それをやりたいか」「人の気持ちはどう動くか」という人間心理の観点で切り込みます。', groqModel: _AI_DISC_DEFAULT_MODELS.nova },
};

// 麻雀格言モード用ペルソナ。キー(logic/nova/guard)ごとのモデル設定は他モードと共通で適用される
const _AI_DISC_MAHJONG_PERSONAS = {
  logic: { name: 'デジタル派', emoji: '📊', role: '効率重視AI', desc: '牌効率と期待値計算を重視するデジタル派の雀士AIです。感覚や経験則よりも、数字とセオリーに基づいて合理的に判断します。', groqModel: _AI_DISC_DEFAULT_MODELS.logic },
  nova:  { name: '攻め師',     emoji: '⚔️', role: '攻撃重視AI', desc: '「押してナンボ」の精神を持つ攻撃重視の雀士AIです。鳴き・仕掛けを駆使し、リスクを取ってでも和了に向かう姿勢を重視します。', groqModel: _AI_DISC_DEFAULT_MODELS.nova },
  guard: { name: '降り師',     emoji: '🛡️', role: '守備重視AI', desc: '「降りるが勝ち」を信条とする守備重視の雀士AIです。放銃を避け、局全体・半荘全体の収支を見据えたベタオリ判断を重視します。', groqModel: _AI_DISC_DEFAULT_MODELS.guard },
};

// 戦国軍議モード用ペルソナ
const _AI_DISC_SENGOKU_PERSONAS = {
  logic: { name: '軍師 玄洲', emoji: '🪶', role: '知将AI', desc: '戦国の軍議に侍る軍師AIです。地勢・兵站・敵味方の力関係を読み、策をもって勝ちを拾うことを信条とします。時代劇の軍師らしい口調（「〜でござる」「〜と心得まする」など）で話してください。', groqModel: _AI_DISC_DEFAULT_MODELS.logic },
  nova:  { name: '猛将 紅丸', emoji: '🔥', role: '猛将AI', desc: '先陣を切ることしか頭にない猛将AIです。細かい理屈より勢いと士気を重んじ、「やってみねば分からぬ」が信条。豪快な武人口調で話してください。', groqModel: _AI_DISC_DEFAULT_MODELS.nova },
  guard: { name: '家老 静庵', emoji: '🏯', role: '家老AI', desc: '御家の存続を第一に考える年配の家老AIです。家中の和、民への負担、敗れた時の傷の深さを案じます。落ち着いた老臣の口調で話してください。', groqModel: _AI_DISC_DEFAULT_MODELS.guard },
};

// 時間軸モード用ペルソナ（性格ではなく時間軸で視点を分ける）
const _AI_DISC_JIKAN_PERSONAS = {
  logic: { name: 'クロニカ', emoji: '📜', role: '歴史家AI', desc: '過去の類似事例・前例から学ぶ歴史家AIです。「同じような話は過去にもあった」という視点で、歴史や世間の成功例・失敗例を引きながら語ります。', groqModel: _AI_DISC_DEFAULT_MODELS.logic },
  nova:  { name: 'フォーサイト', emoji: '🔭', role: '未来学者AI', desc: '5年後・10年後の変化を描く未来学者AIです。技術や社会の流れを踏まえ、「この選択が将来どう効いてくるか」を大胆に予測します。', groqModel: _AI_DISC_DEFAULT_MODELS.nova },
  guard: { name: 'プラグマ', emoji: '⚙️', role: '実務家AI', desc: '今ここにある現実的制約（資金・時間・人手）を直視する実務家AIです。「明日から実際に回るのか」という観点で具体的に詰めます。', groqModel: _AI_DISC_DEFAULT_MODELS.guard },
};

// 悪魔の代弁者モード用ペルソナ（1人を徹底反対役に固定して議論を白熱させる）
const _AI_DISC_DEVIL_PERSONAS = {
  logic: { name: 'テーゼ', emoji: '⚖️', role: '推進派AI', desc: '議題を実現する前提で、最も筋の良い進め方を組み立てる推進派AIです。賛成論を論理的に構築し、反対論には正面から答えます。', groqModel: _AI_DISC_DEFAULT_MODELS.logic },
  nova:  { name: 'ジンテーゼ', emoji: '🌉', role: '調停者AI', desc: '賛成論と反対論の両方から良いところを拾い、対立を乗り越える第三の道を探す調停者AIです。', groqModel: _AI_DISC_DEFAULT_MODELS.nova },
  guard: { name: '悪魔の代弁者', emoji: '😈', role: '反対論者AI', desc: 'どんな議題に対しても、あえて最強の反対論を構築する「悪魔の代弁者」AIです。本心がどうであれ、考えうる最も鋭い反論・リスク・落とし穴を容赦なく突きつけるのが役目です。', groqModel: _AI_DISC_DEFAULT_MODELS.guard },
};

// 大喜利モード用ペルソナ（議論ではなく笑いを競う）
const _AI_DISC_OGIRI_PERSONAS = {
  nova:  { name: 'ボケ太', emoji: '🤪', role: 'ボケ担当AI', desc: '勢いと発想の飛距離で笑いを取るボケ担当AIです。お題に対して予想の斜め上の回答を全力で繰り出します。', groqModel: _AI_DISC_DEFAULT_MODELS.nova },
  guard: { name: 'シュール男爵', emoji: '🎩', role: 'シュール担当AI', desc: 'シュールで知的な笑いを担当するAIです。静かで上品な口調のまま、じわじわ来る回答を差し出します。', groqModel: _AI_DISC_DEFAULT_MODELS.guard },
  logic: { name: '座布団', emoji: '🎤', role: 'ツッコミ兼司会AI', desc: '大喜利の司会とツッコミを兼ねるAIです。お題を整理しつつ他の回答に鋭くツッコミを入れ、自分でも一つ気の利いた回答を出します。', groqModel: _AI_DISC_DEFAULT_MODELS.logic },
};

const _AI_DISC_MODE_PERSONAS = {
  default: _AI_DISC_PERSONAS,
  magi: _AI_DISC_MAGI_PERSONAS,
  mahjong: _AI_DISC_MAHJONG_PERSONAS,
  sengoku: _AI_DISC_SENGOKU_PERSONAS,
  jikan: _AI_DISC_JIKAN_PERSONAS,
  devil: _AI_DISC_DEVIL_PERSONAS,
  ogiri: _AI_DISC_OGIRI_PERSONAS,
};

let _aiDiscDiscussMode = 'default'; // _AI_DISC_MODE_PERSONAS のいずれかのキー
function _P() { return _AI_DISC_MODE_PERSONAS[_aiDiscDiscussMode] || _AI_DISC_PERSONAS; }
// 表示順（MAGIはMAGI-1→2→3の順、大喜利はボケ2人→司会の順で締める）
function _P_ORDER() {
  if (_aiDiscDiscussMode === 'magi') return ['logic', 'guard', 'nova'];
  if (_aiDiscDiscussMode === 'ogiri') return ['nova', 'guard', 'logic'];
  return ['logic', 'nova', 'guard'];
}

function _applyAiDiscModels() {
  const models = _aiDiscApiKeys.models || {};
  Object.values(_AI_DISC_MODE_PERSONAS).forEach(personas => {
    Object.keys(personas).forEach(k => {
      personas[k].groqModel = (models[k] || '').trim() || _AI_DISC_DEFAULT_MODELS[k];
    });
  });
}

async function initAdminAiDiscuss() {
  if (!_isAdmin || !_db) return;
  await _loadAiDiscApiKeys();
  await _refreshAiDiscList();
}

function toggleAiDiscKeysPanel() {
  const body = document.getElementById('ai-disc-keys-body');
  const arrow = document.getElementById('ai-disc-keys-arrow');
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : '';
  arrow.textContent = open ? '▼' : '▲';
}

async function _loadAiDiscApiKeys() {
  if (!_db) return;
  try {
    const doc = await _db.collection('admin_secrets').doc('api_keys').get();
    _aiDiscApiKeys = doc.exists ? { gemini: '', groq: '', ...doc.data() } : { gemini: '', groq: '' };
  } catch(e) {
    _aiDiscApiKeys = { gemini: '', groq: '' };
  }
  _applyAiDiscModels();
  const geminiInput = document.getElementById('ai-disc-gemini-key');
  const groqInput = document.getElementById('ai-disc-groq-key');
  if (geminiInput) geminiInput.value = _aiDiscApiKeys.gemini || '';
  if (groqInput) groqInput.value = _aiDiscApiKeys.groq || '';
  const modelLogicInput = document.getElementById('ai-disc-model-logic');
  const modelNovaInput = document.getElementById('ai-disc-model-nova');
  const modelGuardInput = document.getElementById('ai-disc-model-guard');
  if (modelLogicInput) modelLogicInput.value = _aiDiscApiKeys.models?.logic || '';
  if (modelNovaInput) modelNovaInput.value = _aiDiscApiKeys.models?.nova || '';
  if (modelGuardInput) modelGuardInput.value = _aiDiscApiKeys.models?.guard || '';
}

async function saveAiDiscApiKeys() {
  if (!_isAdmin || !_db) return;
  const statusEl = document.getElementById('ai-disc-keys-status');
  const gemini = document.getElementById('ai-disc-gemini-key').value.trim();
  const groq = document.getElementById('ai-disc-groq-key').value.trim();
  const logic = document.getElementById('ai-disc-model-logic').value.trim();
  const nova = document.getElementById('ai-disc-model-nova').value.trim();
  const guard = document.getElementById('ai-disc-model-guard').value.trim();
  const models = { logic, nova, guard };
  statusEl.textContent = '保存中...'; statusEl.className = 'admin-status';
  try {
    await _db.collection('admin_secrets').doc('api_keys').set({
      gemini, groq, models, openai: firebase.firestore.FieldValue.delete(), claude: firebase.firestore.FieldValue.delete(),
    }, { merge: true });
    _aiDiscApiKeys = { gemini, groq, models };
    _applyAiDiscModels();
    statusEl.textContent = '保存しました ✓'; statusEl.className = 'admin-status ok';
  } catch(e) {
    statusEl.textContent = 'エラー: ' + e.message; statusEl.className = 'admin-status error';
  }
}

async function _refreshAiDiscList() {
  const listEl = document.getElementById('ai-disc-list');
  if (listEl) listEl.innerHTML = '<div class="admin-empty">読み込み中...</div>';
  try {
    const snap = await _db.collection('ai_discussions').orderBy('updatedAt', 'desc').get();
    _aiDiscList = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _renderAiDiscussionList();
  } catch(e) {
    if (listEl) listEl.innerHTML = `<div class="admin-empty">読み込みに失敗しました: ${_esc(e.message)}</div>`;
  }
}

function _renderAiDiscussionList() {
  const listEl = document.getElementById('ai-disc-list');
  if (!listEl) return;
  if (!_aiDiscList.length) {
    listEl.innerHTML = '<div class="admin-empty">まだ議論がありません</div>';
    return;
  }
  listEl.innerHTML = _aiDiscList.map(d => {
    const date = d.updatedAt?.toDate ? d.updatedAt.toDate() : (d.createdAt?.toDate ? d.createdAt.toDate() : null);
    const dateStr = date ? `${date.getFullYear()}/${date.getMonth()+1}/${date.getDate()}` : '';
    const roundCount = (d.rounds || []).length;
    return `<div class="admin-gather-card" onclick="openAiDiscussionDetail('${d.id}')">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
        <div style="min-width:0">
          <div class="admin-gather-date">${_esc(d.title || d.topic || '(無題)')}</div>
          <div class="admin-gather-meta">${dateStr}　全${roundCount}ラウンド</div>
        </div>
        <button class="admin-btn sm danger" style="flex-shrink:0;" onclick="event.stopPropagation(); deleteAiDiscussion('${d.id}')">削除</button>
      </div>
    </div>`;
  }).join('');
}

async function deleteAiDiscussion(id) {
  if (!_isAdmin || !_db) return;
  const doc = _aiDiscList.find(d => d.id === id) || (_aiDiscCurrentId === id ? _aiDiscCurrentDoc : null);
  const title = doc?.title || doc?.topic || 'この議論';
  if (!confirm(`「${title}」を削除しますか？\nこの操作は取り消せません。`)) return;
  try {
    await _db.collection('ai_discussions').doc(id).delete();
    _aiDiscList = _aiDiscList.filter(d => d.id !== id);
    if (_aiDiscCurrentId === id) {
      _aiDiscCurrentId = null;
      _aiDiscCurrentDoc = null;
      _aiDiscShowScreen('ai-disc-list-screen');
    }
    _renderAiDiscussionList();
  } catch(e) {
    alert('削除に失敗しました: ' + e.message);
  }
}

function _aiDiscShowScreen(id) {
  document.querySelectorAll('#sec-admin-ai-discuss .admin-sub-screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function openNewAiDiscussion() {
  _aiDiscCurrentId = null;
  _aiDiscCurrentDoc = null;
  _aiDiscAutoOutput = null;
  _aiDiscAutoProgress = null;
  _aiDiscDiscussMode = 'default';
  document.getElementById('ai-disc-topic-input').value = '';
  document.getElementById('ai-disc-rounds').innerHTML = '';
  document.getElementById('ai-disc-delete-btn').style.display = 'none';
  document.getElementById('ai-disc-new-form').style.display = '';
  document.getElementById('ai-disc-continue-form').style.display = 'none';
  document.getElementById('ai-disc-auto-area').style.display = 'none';
  const sel = document.getElementById('ai-disc-mode-select');
  if (sel) sel.value = 'default';
  document.getElementById('ai-disc-rounds').classList.remove('magi-mode');
  document.getElementById('ai-disc-auto-area').classList.remove('magi-mode');
  const statusEl = document.getElementById('ai-disc-status');
  statusEl.textContent = ''; statusEl.className = 'admin-status';
  _aiDiscShowScreen('ai-disc-detail-screen');
}

function closeAiDiscussionDetail() {
  _aiDiscShowScreen('ai-disc-list-screen');
}

// ── Gemini / Groq 呼び出し ──
// レスポンスがエラーの場合、本文から詳細メッセージを抽出して例外を投げる
async function _throwApiError(res, label) {
  let detail = '';
  try {
    const data = await res.json();
    detail = data?.error?.message || JSON.stringify(data);
  } catch(e) {
    try { detail = await res.text(); } catch(e2) {}
  }
  throw new Error(`${label} API エラー (${res.status})${detail ? ': ' + detail : ''}`);
}

async function _callGeminiApi(prompt) {
  const key = _aiDiscApiKeys.gemini;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
  });
  if (!res.ok) await _throwApiError(res, 'Gemini');
  const data = await res.json();
  const text = (data?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
  if (!text) throw new Error('Geminiからの応答が空です');
  return text;
}

async function _callGroqApi(prompt, model, maxTokens, onDelta, _retryCount = 0) {
  const key = _aiDiscApiKeys.groq;
  const body = {
    model: model || 'llama-3.3-70b-versatile',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: maxTokens || 700,
  };
  // gpt-ossは推論モデルのため、reasoningにmax_tokensを使い切って本文が空になるのを防ぐ
  if (body.model.startsWith('openai/gpt-oss')) body.reasoning_effort = 'low';
  // ストリーミング用：onDeltaが指定されている場合、stream=trueを追加
  if (onDelta) body.stream = true;
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    // レート制限(429)の場合は、エラー文中の待機秒数だけ待って最大2回まで再試行する
    if (res.status === 429 && _retryCount < 2) {
      const detail = await res.text();
      const m = detail.match(/try again in ([\d.]+)s/i);
      const waitMs = Math.min(m ? parseFloat(m[1]) : 5, 30) * 1000 + 500;
      await new Promise(r => setTimeout(r, waitMs));
      return _callGroqApi(prompt, model, maxTokens, onDelta, _retryCount + 1);
    }
    await _throwApiError(res, 'Groq');
  }

  // ストリーミング時の処理
  if (onDelta) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let full = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop(); // 末尾の不完全な行は次のチャンクへ持ち越す
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const payload = t.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const delta = JSON.parse(payload)?.choices?.[0]?.delta?.content || '';
          if (delta) { full += delta; onDelta(full); }
        } catch(e) {}
      }
    }
    if (!full) throw new Error('Groqからの応答が空です');
    return full;
  }

  // 非ストリーミング時の処理
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || '';
  if (!text) throw new Error('Groqからの応答が空です');
  return text;
}

// ── APIキー疎通確認 ──
async function _testGeminiKey(key) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`);
  if (res.ok) return;
  if (res.status === 400 || res.status === 403) throw new Error('キーが正しくありません');
  throw new Error(`エラー (${res.status})`);
}

async function _testGroqKey(key) {
  const res = await fetch('https://api.groq.com/openai/v1/models', {
    headers: { 'Authorization': `Bearer ${key}` }
  });
  if (res.ok) return;
  if (res.status === 401) throw new Error('キーが正しくありません');
  throw new Error(`エラー (${res.status})`);
}

async function testAiDiscApiKey(provider) {
  const inputId = `ai-disc-${provider}-key`;
  const statusEl = document.getElementById(`ai-disc-${provider}-test-status`);
  const key = document.getElementById(inputId).value.trim();
  if (!key) { statusEl.textContent = 'キーを入力してください'; statusEl.className = 'admin-status error'; return; }
  statusEl.textContent = '確認中...'; statusEl.className = 'admin-status';
  try {
    if (provider === 'gemini') await _testGeminiKey(key);
    else await _testGroqKey(key);
    statusEl.textContent = '接続できました ✓'; statusEl.className = 'admin-status ok';
  } catch(e) {
    statusEl.textContent = '接続できませんでした: ' + e.message; statusEl.className = 'admin-status error';
  }
}

// ── プロンプト組み立て ──
// 過去ラウンドは結論部分だけをプロンプトに渡す（継続のたびにトークン消費が増えるのを防ぐ）
function _aiDiscRoundSummary(r) {
  if (r.detail && r.detail.conclusion) return r.detail.conclusion;
  const parts = (r.output || '').split(/##\s*📋\s*(?:結論|決議)/);
  if (parts.length > 1) return parts[parts.length - 1].trim();
  return (r.output || '').slice(0, 800);
}

function _aiDiscContextBlock(topic, previousRounds) {
  if (previousRounds && previousRounds.length) {
    let block = '【これまでの議論】\n\n';
    previousRounds.forEach((r, i) => {
      block += `▼ ${i === 0 ? '初回の議題' : `追加条件${i}`}: ${r.input}\n（結論の抜粋）\n${_aiDiscRoundSummary(r)}\n\n`;
    });
    block += `【追加の条件・質問】\n${topic}\n`;
    return block;
  }
  return `【テーマ】\n${topic}\n`;
}

async function startAiDiscussion() {
  const topic = document.getElementById('ai-disc-topic-input').value.trim();
  if (!topic) { alert('議題を入力してください'); return; }
  _aiDiscDiscussMode = document.getElementById('ai-disc-mode-select')?.value || 'default';
  await runAiDiscussionAuto(topic, null);
}

async function continueAiDiscussion() {
  const addCond = document.getElementById('ai-disc-continue-input').value.trim();
  if (!addCond) { alert('追加の条件・質問を入力してください'); return; }
  _aiDiscDiscussMode = _aiDiscCurrentDoc?.mode || 'default';
  await runAiDiscussionAuto(addCond, _aiDiscCurrentDoc?.rounds || []);
}

// ── 自動実行（Groqキー設定時）: 第1ラウンド→第2ラウンド→結論の3段階で全AIが順に意見を交わす ──
function _buildRound1Prompt(persona, topic, previousRounds) {
  let prompt = `あなたは「${persona.name}」という名前のAIです。${persona.desc}\n\n`;
  prompt += _aiDiscContextBlock(topic, previousRounds) + '\n';
  if (_aiDiscDiscussMode === 'ogiri') {
    prompt += '上記を大喜利のお題として扱い、あなたのキャラクターで回答してください（回答は1〜3個、合計200字程度）。前置きや見出しは付けず、本文のみをMarkdown平文で出力してください。';
  } else {
    prompt += '上記について、あなたの第1ラウンドの意見を200〜300字程度で述べてください。最初の一文であなたの結論を端的に述べ、そのあとに理由を続けてください。前置きや見出しは付けず、本文のみをMarkdown平文で出力してください。';
  }
  return prompt;
}

// 第1ラウンドの3意見から、第2ラウンドで掘り下げるべき争点を司会者役に抽出させる
function _buildContentionPrompt(topic, previousRounds, round1All) {
  const P = _P();
  const order = _P_ORDER();
  const isOgiri = _aiDiscDiscussMode === 'ogiri';
  let prompt = isOgiri ? 'あなたは大喜利の司会者です。\n\n' : 'あなたは3人のAIによる議論の司会者です。\n\n';
  prompt += _aiDiscContextBlock(topic, previousRounds) + '\n';
  prompt += `【第1ラウンドでの各AIの${isOgiri ? '回答' : '意見'}】\n\n`;
  order.forEach(k => {
    prompt += `▼ ${P[k].name}（${P[k].role}）\n${round1All[k]}\n\n`;
  });
  if (isOgiri) {
    prompt += '3人の回答を見て、第2ラウンドでさらに膨らませると面白くなりそうな切り口を2〜3個、「- …」の形式の箇条書きのみで出力してください。前置きや解説は付けないでください。';
  } else {
    prompt += '3人の意見を比較し、実際に見解が対立・相違している争点を2〜3個抽出してください。「- 争点1: …」の形式の箇条書きのみを出力し、前置きや解説は付けないでください。明確な対立がない場合は、結論を出すために掘り下げるべき論点を挙げてください。';
  }
  return prompt;
}

function _buildRound2Prompt(persona, topic, previousRounds, round1All, contention) {
  const P = _P();
  const order = _P_ORDER();
  let prompt = `あなたは「${persona.name}」という名前のAIです。${persona.desc}\n\n`;
  prompt += _aiDiscContextBlock(topic, previousRounds) + '\n';
  prompt += '【第1ラウンドでの各AIの意見】\n\n';
  order.forEach(k => {
    prompt += `▼ ${P[k].name}（${P[k].role}）\n${round1All[k]}\n\n`;
  });
  if (_aiDiscDiscussMode === 'ogiri') {
    if (contention) prompt += `【司会者が挙げた切り口】\n${contention}\n\n`;
    prompt += '他の2人の回答に乗っかったりツッコミを入れたりしながら、第2ラウンドの回答を150〜250字程度で出してください。';
    if (contention) prompt += '司会者が挙げた切り口も活かしてください。';
    prompt += '前置きや見出しは付けず、本文のみをMarkdown平文で出力してください。';
    return prompt;
  }
  if (contention) {
    prompt += `【司会者が整理した争点】\n${contention}\n\n`;
  }
  prompt += '上記の他の2人の意見を踏まえ、反論や補足を含めたあなたの第2ラウンドの意見を200〜300字程度で述べてください。';
  if (contention) prompt += '司会者が整理した各争点に対して、あなたの立場を明確にしてください。';
  prompt += '最初の一文で現時点のあなたの結論を端的に述べ、最後に「どのような事実や条件が示されれば自分の立場を変えるか」を一つ挙げてください。前置きや見出しは付けず、本文のみをMarkdown平文で出力してください。';
  prompt += '\n\nまた、他の2人の発言の中に固有名詞・用語・事実関係などで明らかな誤認識や間違いがあれば、必ず指摘し正しい情報を示してください（誤りがなければ無理に指摘する必要はありません）。';
  if (previousRounds && previousRounds.length) {
    prompt += '\n\n前回（追加条件適用前）の自分の見解からどう変わったか／変わらないかにも触れてください。';
  }
  return prompt;
}

function _buildConclusionPrompt(topic, previousRounds, round1All, round2All, contention) {
  const P = _P();
  const order = _P_ORDER();
  const isMagi = _aiDiscDiscussMode === 'magi';

  let openingLine, outputFormat;

  if (isMagi) {
    openingLine = `あなたは「MAGIシステム」の決議担当です。以下は3基のMAGI（${order.map(k => `${P[k].name}=${P[k].role}`).join(', ')}）による2ラウンドの審議の記録です。`;
    outputFormat = `これらを踏まえて、以下の形式で決議をMarkdownで出力してください。前置きや見出しは付けないでください。

**各MAGIの判定：**（箇条書きで3行。「MAGI-1 メルキオール: 賛成／否決／条件付 — 一言理由」の形式）
**決議：**（「可決（全会一致）」「可決（2対1）」「否決（2対1）」「否決（全会一致）」のいずれか）
**総合回答：**（まとめ）
**前提条件：**（この決議が成り立つための条件・仮定を箇条書き）
**次のアクション：**（議題の提起者が次に取るべき行動を1〜3個の箇条書き）

議題が賛否を問える形式でない場合は、各MAGIの判定と決議を省略し、**総合回答：**以降のみを出力してください。`;
  } else if (_aiDiscDiscussMode === 'sengoku') {
    openingLine = `あなたは戦国の軍議をまとめる主君です。以下は3人の家臣（${order.map(k => `${P[k].name}=${P[k].role}`).join(', ')}）による2ラウンドの軍議の記録です。`;
    outputFormat = `これらを踏まえて、以下の形式で裁定をMarkdownで出力してください。前置きや見出しは付けないでください。

**各将の進言：**（箇条書きで3行。「軍師 玄洲: 一言でまとめた献策」の形式）
**軍議の沙汰：**（主君としての決定。時代劇の沙汰らしい言い回しで）
**勝機：**（うまくいくための条件を箇条書き）
**懸念：**（負け筋・注意すべき点を箇条書き）
**次の一手：**（明日からなすべきことを1〜3個の箇条書き）`;
  } else if (_aiDiscDiscussMode === 'jikan') {
    openingLine = `あなたは「時間軸会議」の結論担当です。以下は3人のAI（${order.map(k => `${P[k].name}=${P[k].role}`).join(', ')}）による2ラウンドの議論の記録です。`;
    outputFormat = `これらを踏まえて、以下の形式で結論をMarkdownで出力してください。前置きや見出しは付けないでください。

**過去からの教訓：**（歴史・前例から言えることを箇条書き）
**現在の制約：**（今の現実的な制約を箇条書き）
**未来への影響：**（この選択が将来どう効いてくるかを箇条書き）
**総合回答：**（まとめ）
**次のアクション：**（議題の提起者が次に取るべき行動を1〜3個の箇条書き）`;
  } else if (_aiDiscDiscussMode === 'devil') {
    openingLine = `あなたは「悪魔の代弁者方式」の議論の結論担当です。以下は3人のAI（${order.map(k => `${P[k].name}=${P[k].role}`).join(', ')}）による2ラウンドの議論の記録です。悪魔の代弁者は役目としてあえて反対論を述べている点に留意してください。`;
    outputFormat = `これらを踏まえて、以下の形式で結論をMarkdownで出力してください。前置きや見出しは付けないでください。

**合意点：**（箇条書き）
**悪魔の代弁者の最強の反論：**（最も鋭かった反論を箇条書きで2〜3個）
**反対論への回答：**（それらの反論に最終的にどう答えるか）
**総合回答：**（まとめ）
**前提条件：**（この結論が成り立つための条件・仮定を箇条書き）
**次のアクション：**（議題の提起者が次に取るべき行動を1〜3個の箇条書き）`;
  } else if (_aiDiscDiscussMode === 'ogiri') {
    openingLine = `あなたは大喜利の審査員です。以下は3人の回答者（${order.map(k => `${P[k].name}=${P[k].role}`).join(', ')}）による2ラウンドの大喜利の記録です。`;
    outputFormat = `これらを踏まえて、以下の形式で結果発表をMarkdownで出力してください。前置きや見出しは付けないでください。

**今日のハイライト：**（特に面白かった回答を箇条書きで2〜3個引用し、それぞれ一言講評）
**今日の優勝：**（3人のうち1人を選び、理由を一言）
**審査員より締めの一言：**（お題に絡めた気の利いた締め）`;
  } else if (_aiDiscDiscussMode === 'mahjong') {
    openingLine = `あなたは「麻雀格言会議」の進行役です。以下は3人の雀士AI（${order.map(k => `${P[k].name}=${P[k].role}`).join(', ')}）による2ラウンドの議論の記録です。`;
    outputFormat = `これらを踏まえて、以下の形式で結論をMarkdownで出力してください。前置きや見出しは付けないでください。

**各雀士の結論：**（箇条書きで3行。「デジタル派: 一言でまとめた立場」の形式）
**総合回答：**（まとめ。可能であれば麻雀の格言を一つ引用して締めくくってください）
**前提条件：**（この結論が成り立つための条件・仮定を箇条書き）
**次のアクション：**（議題の提起者が次に取るべき行動を1〜3個の箇条書き）`;
  } else {
    openingLine = `あなたは「マルチAI議論シミュレーター」の結論担当です。以下は3人のAI（${order.map(k => `${P[k].name}=${P[k].role}`).join(', ')}）による2ラウンドの議論の記録です。`;
    outputFormat = `これらを踏まえて、以下の形式で結論をMarkdownで出力してください。前置きや見出しは付けないでください。

**合意点：**（箇条書き）
**相違点：**（箇条書き。司会者が整理した争点ごとに、最終的に誰がどの立場だったかが分かるように）
**総合回答：**（まとめ）
**前提条件：**（この結論が成り立つための条件・仮定を箇条書き）
**次のアクション：**（議題の提起者が次に取るべき行動を1〜3個の箇条書き）`;
  }

  let prompt = openingLine + '\n\n';
  prompt += _aiDiscContextBlock(topic, previousRounds) + '\n';
  prompt += `【第1ラウンド】\n`;
  order.forEach(k => {
    prompt += `▼ ${P[k].name}\n${round1All[k]}\n\n`;
  });
  if (contention) prompt += `【司会者による争点整理】\n${contention}\n\n`;
  prompt += `【第2ラウンド】\n`;
  order.forEach(k => {
    prompt += `▼ ${P[k].name}\n${round2All[k]}\n\n`;
  });
  prompt += outputFormat;
  if (_aiDiscDiscussMode !== 'ogiri') {
    prompt += '\n\n第2ラウンドで固有名詞・用語・事実関係の誤りが指摘・訂正されている場合は、訂正後の正しい情報を前提として総合回答をまとめてください。';
  }
  if (previousRounds && previousRounds.length) {
    prompt += `\n\n冒頭に、今回追加された条件「${topic}」を一文で明記してください。`;
  }
  return prompt;
}

async function _callPersonaApi(personaKey, prompt, maxTokens, onDelta) {
  const persona = _P()[personaKey];
  if (personaKey === 'nova' && _aiDiscApiKeys.gemini) {
    try { return await _callGeminiApi(prompt); }
    catch(e) { return await _callGroqApi(prompt, persona.groqModel, maxTokens, onDelta); } // Gemini失敗時はGroqが代行
  }
  return await _callGroqApi(prompt, persona.groqModel, maxTokens, onDelta);
}

// 自動実行中の争点整理テキスト（プレビュー組成と保存Markdownの両方で参照する）
let _aiDiscAutoContention = null;

function _composeAiDiscMd(round1All, round2All, conclusion) {
  // 議論全体のMarkdownを組み立てる（未完了の部分は省略されるため、生成途中のプレビューにも使える）
  const P = _P();
  const order = _P_ORDER();
  let out = '';
  order.forEach(k => {
    if (round1All && round1All[k]) out += `## ${P[k].emoji} ${P[k].name}\n${round1All[k].trim()}\n\n`;
  });
  if (round2All && (round2All.logic || round2All.nova || round2All.guard)) {
    const isOgiri = _aiDiscDiscussMode === 'ogiri';
    out += isOgiri ? '---\n\n## 第2ラウンド：乗っかり・ツッコミ\n\n' : '---\n\n## 第2ラウンド：相互の意見への反論・補足\n\n';
    if (_aiDiscAutoContention) out += `### 🎙️ ${isOgiri ? '司会者が挙げた切り口' : '司会者による争点整理'}\n${_aiDiscAutoContention.trim()}\n\n`;
    order.forEach(k => {
      if (round2All[k]) out += `### ${P[k].emoji} ${P[k].name}\n${round2All[k].trim()}\n\n`;
    });
  }
  const conclusionHeading = { magi: '決議', sengoku: '軍議の沙汰', ogiri: '結果発表' }[_aiDiscDiscussMode] || '結論';
  if (conclusion) out += `---\n\n## 📋 ${conclusionHeading}\n${conclusion.trim()}\n`;
  return out;
}

// 各呼び出しの開始時刻を少しずつずらして発火する（同時バーストによる429を緩和）
function _staggeredAll(thunks, delayMs) {
  return Promise.all(thunks.map((thunk, i) =>
    new Promise(resolve => setTimeout(resolve, i * delayMs)).then(thunk)
  ));
}

// ストリーミング中の再描画は120msに1回まで（最終結果は_renderAiDiscAutoPartialを直接呼ぶ）
let _aiDiscLastPartialRender = 0;
function _renderAiDiscAutoPartialThrottled(round1All, round2All, conclusion) {
  const now = Date.now();
  if (now - _aiDiscLastPartialRender < 120) return;
  _aiDiscLastPartialRender = now;
  _renderAiDiscAutoPartial(round1All, round2All, conclusion);
}

function _renderAiDiscAutoPartial(round1All, round2All, conclusion) {
  // マークダウンを組成して、プレビューに表示する
  const md = _composeAiDiscMd(round1All, round2All, conclusion);
  document.getElementById('ai-disc-auto-preview').innerHTML = _renderAiDiscMarkdown(md);
}

async function runAiDiscussionAuto(topic, previousRounds) {
  const statusEl = document.getElementById('ai-disc-status');

  // Groqキー設定の確認（最初にチェックして、失敗時はここで終了）
  if (!_aiDiscApiKeys.groq) {
    statusEl.textContent = 'Groq APIキーを設定してください';
    statusEl.className = 'admin-status error';
    return;
  }

  const autoArea = document.getElementById('ai-disc-auto-area');
  const saveBtn = document.getElementById('ai-disc-auto-save-btn');
  const runBtns = ['ai-disc-run-btn', 'ai-disc-run-continue-btn'].map(id => document.getElementById(id)).filter(Boolean);

  autoArea.style.display = '';
  saveBtn.style.display = 'none';
  _aiDiscAutoOutput = null;
  runBtns.forEach(b => b.disabled = true);
  statusEl.className = 'admin-status';

  const isMagi = _aiDiscDiscussMode === 'magi';
  autoArea.classList.toggle('magi-mode', isMagi);
  const magiHeader = document.getElementById('ai-disc-magi-header');
  if (magiHeader) {
    magiHeader.style.display = isMagi ? '' : 'none';
    magiHeader.innerHTML = 'MAGI SYSTEM <span class="magi-blink">─ 審議中</span>';
  }

  try {
    const progressKey = topic + '|' + (previousRounds ? previousRounds.length : 0);

    // ペルソナ1人分の呼び出しサンク（ストリーミング中と完了時にプレビューを更新）
    const personaThunk = (key, prompt, maxTok, obj, r1ForRender) => () =>
      _callPersonaApi(key, prompt, maxTok,
          t => { obj[key] = t; _renderAiDiscAutoPartialThrottled(r1ForRender || obj, r1ForRender ? obj : null, null); })
        .then(t => { obj[key] = t; _renderAiDiscAutoPartial(r1ForRender || obj, r1ForRender ? obj : null, null); return t; });

    // 再開時に前のステージの結果を再利用
    let round1All = null;
    let round2All = null;
    let contention = null;
    if (_aiDiscAutoProgress && _aiDiscAutoProgress.key === progressKey) {
      round1All = _aiDiscAutoProgress.round1All;
      round2All = _aiDiscAutoProgress.round2All;
      contention = _aiDiscAutoProgress.contention || null;
      _aiDiscAutoContention = contention;
      if (round1All) _renderAiDiscAutoPartial(round1All, round2All, null);
    } else {
      _aiDiscAutoContention = null;
      document.getElementById('ai-disc-auto-preview').innerHTML = '';
    }

    if (!round1All) {
      statusEl.textContent = '第1ラウンドの意見を取得中...(1/4)';
      const round1All_obj = { logic: null, nova: null, guard: null };
      const P = _P();
      const order = _P_ORDER();
      await _staggeredAll(order.map(k =>
        personaThunk(k, _buildRound1Prompt(P[k], topic, previousRounds), 500, round1All_obj, null)
      ), 1500);
      round1All = round1All_obj;
      _aiDiscAutoProgress = { key: progressKey, round1All, round2All: null, contention: null };
    }

    if (!contention) {
      statusEl.textContent = _aiDiscDiscussMode === 'ogiri' ? '司会者が切り口を整理中...(2/4)' : '司会者が争点を整理中...(2/4)';
      contention = await _callGroqApi(_buildContentionPrompt(topic, previousRounds, round1All), _P().logic.groqModel, 300);
      _aiDiscAutoContention = contention;
      _aiDiscAutoProgress.contention = contention;
    }

    if (!round2All) {
      statusEl.textContent = '第2ラウンドの意見を取得中...(3/4)';
      const round2All_obj = { logic: null, nova: null, guard: null };
      const P = _P();
      const order = _P_ORDER();
      await _staggeredAll(order.map(k =>
        personaThunk(k, _buildRound2Prompt(P[k], topic, previousRounds, round1All, contention), 500, round2All_obj, round1All)
      ), 1500);
      round2All = round2All_obj;
      _aiDiscAutoProgress.round2All = round2All;
    }

    statusEl.textContent = '結論をまとめています...(4/4)';
    const P = _P();
    const conclusion = await _callGroqApi(_buildConclusionPrompt(topic, previousRounds, round1All, round2All, contention), P.logic.groqModel, 1400,
        t => _renderAiDiscAutoPartialThrottled(round1All, round2All, t));

    _renderAiDiscAutoPartial(round1All, round2All, conclusion);
    _aiDiscAutoOutput = {
      output: _composeAiDiscMd(round1All, round2All, conclusion),
      detail: { round1: round1All, round2: round2All, contention, conclusion },
    };
    saveBtn.style.display = '';
    _aiDiscAutoProgress = null;
    if (magiHeader && isMagi) magiHeader.textContent = 'MAGI SYSTEM ─ 審議完了';
    const successMsg = isMagi ? '審議が完了しました ✓' : '議論が完成しました ✓';
    statusEl.textContent = successMsg; statusEl.className = 'admin-status ok';
    autoArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch(e) {
    let errMsg = 'エラー: ' + e.message;
    if (_aiDiscAutoProgress) {
      errMsg += '（途中まで完了しています。同じ内容でもう一度実行すると続きから再開します）';
    }
    statusEl.textContent = errMsg; statusEl.className = 'admin-status error';
  }
  runBtns.forEach(b => b.disabled = false);
}


async function openAiDiscussionDetail(id) {
  if (!_db) return;
  _aiDiscCurrentId = id;
  _aiDiscAutoOutput = null;
  _aiDiscAutoProgress = null;
  document.getElementById('ai-disc-new-form').style.display = 'none';
  document.getElementById('ai-disc-rounds').innerHTML = '<div class="admin-empty">読み込み中...</div>';
  document.getElementById('ai-disc-continue-form').style.display = 'none';
  document.getElementById('ai-disc-auto-area').style.display = 'none';
  document.getElementById('ai-disc-delete-btn').style.display = 'none';
  _aiDiscShowScreen('ai-disc-detail-screen');
  try {
    const doc = await _db.collection('ai_discussions').doc(id).get();
    if (!doc.exists) {
      document.getElementById('ai-disc-rounds').innerHTML = '<div class="admin-empty">見つかりませんでした</div>';
      return;
    }
    _aiDiscCurrentDoc = { id: doc.id, ...doc.data() };
    _aiDiscDiscussMode = _aiDiscCurrentDoc.mode || 'default';
    document.getElementById('ai-disc-rounds').classList.toggle('magi-mode', _aiDiscDiscussMode === 'magi');
    _renderAiDiscussionRounds();
    document.getElementById('ai-disc-continue-input').value = '';
    document.getElementById('ai-disc-continue-form').style.display = '';
    document.getElementById('ai-disc-delete-btn').style.display = '';
  } catch(e) {
    document.getElementById('ai-disc-rounds').innerHTML = `<div class="admin-empty">読み込みに失敗しました: ${_esc(e.message)}</div>`;
  }
}

function _renderAiDiscussionRounds() {
  const rounds = _aiDiscCurrentDoc?.rounds || [];
  const html = rounds.map((r, i) => {
    return `<div class="ai-disc-round">
      <div class="ai-disc-round-label">${i === 0 ? '議題' : `追加条件 ${i + 1}`}</div>
      <div class="ai-disc-round-input">${_esc(r.input)}</div>
      <div class="ai-disc-round-output">${_renderAiDiscMarkdown(r.output)}</div>
    </div>`;
  }).join('<hr class="ai-disc-hr">');
  document.getElementById('ai-disc-rounds').innerHTML = html;
}

function _inlineMd(s) {
  return _esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

function _renderAiDiscMarkdown(text) {
  const lines = (text || '').split('\n');
  let html = '';
  let inList = false;
  const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { closeList(); continue; }
    let m;
    if (/^---+$/.test(line)) { closeList(); html += '<hr class="ai-disc-hr">'; continue; }
    if ((m = line.match(/^####\s*(.+)$/)) || (m = line.match(/^###\s*(.+)$/))) { closeList(); html += `<h4>${_inlineMd(m[1])}</h4>`; continue; }
    if ((m = line.match(/^##\s*(.+)$/))) { closeList(); html += `<h3>${_inlineMd(m[1])}</h3>`; continue; }
    if ((m = line.match(/^[-*]\s+(.+)$/))) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${_inlineMd(m[1])}</li>`;
      continue;
    }
    closeList();
    html += `<p>${_inlineMd(line)}</p>`;
  }
  closeList();
  return html;
}

// 議論ラウンド1件をFirestoreに保存（新規作成 or 既存ドキュメントへの追記）
async function _saveAiDiscRound(output, statusEl, detail) {
  if (_aiDiscCurrentId) {
    const addCond = document.getElementById('ai-disc-continue-input').value.trim();
    const round = { input: addCond, output, createdAt: new Date().toISOString() };
    if (detail) round.detail = detail;
    const rounds = [...(_aiDiscCurrentDoc.rounds || []), round];
    await _db.collection('ai_discussions').doc(_aiDiscCurrentId).update({
      rounds, updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    _aiDiscCurrentDoc.rounds = rounds;
    document.getElementById('ai-disc-auto-area').style.display = 'none';
    document.getElementById('ai-disc-continue-input').value = '';
    _renderAiDiscussionRounds();
    _refreshAiDiscList();
  } else {
    const topic = document.getElementById('ai-disc-topic-input').value.trim();
    if (!topic) { statusEl.textContent = '議題を入力してください'; statusEl.className = 'admin-status error'; return false; }
    const title = topic.length > 30 ? topic.slice(0, 30) + '…' : topic;
    const round = { input: topic, output, createdAt: new Date().toISOString() };
    if (detail) round.detail = detail;
    const ref = await _db.collection('ai_discussions').add({
      topic, title, rounds: [round], mode: _aiDiscDiscussMode,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    await openAiDiscussionDetail(ref.id);
    _refreshAiDiscList();
  }
  return true;
}

async function saveAiDiscussionAuto() {
  if (!_db || !_aiDiscAutoOutput) return;
  const statusEl = document.getElementById('ai-disc-status');
  const btn = document.getElementById('ai-disc-auto-save-btn');
  btn.disabled = true;
  statusEl.textContent = '保存中...'; statusEl.className = 'admin-status';
  try {
    const ok = await _saveAiDiscRound(_aiDiscAutoOutput.output, statusEl, _aiDiscAutoOutput.detail);
    if (ok) {
      _aiDiscAutoOutput = null;
      document.getElementById('ai-disc-auto-area').style.display = 'none';
      statusEl.textContent = '保存しました ✓'; statusEl.className = 'admin-status ok';
    }
  } catch(e) {
    statusEl.textContent = 'エラー: ' + e.message; statusEl.className = 'admin-status error';
  }
  btn.disabled = false;
}
