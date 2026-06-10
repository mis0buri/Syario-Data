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
let _aiDiscMode = 'new'; // 'new' | 'continue'
let _aiDiscNovaText = null; // Geminiが生成した「ノヴァ」の意見（手動モード用、未取得時はnull）
let _aiDiscGuardText = null; // Groqが生成した「ガード」の意見（手動モード用、未取得時はnull）
let _aiDiscAutoOutput = null; // Groqキー設定時に自動生成された議論（保存待ち）

let _aiDiscApiKeys = { gemini: '', groq: '' };

const _AI_DISC_PERSONAS = {
  logic: { name: 'ロジック', emoji: '🔵', desc: 'データと論理を重視し、客観的・体系的に分析する分析派AIです。', groqModel: 'openai/gpt-oss-120b' },
  nova:  { name: 'ノヴァ',   emoji: '🟠', desc: '楽観的で創造的。新しい可能性やアイデアを提示する革新派AIです。', groqModel: 'openai/gpt-oss-20b' },
  guard: { name: 'ガード',   emoji: '🟢', desc: 'リスクや問題点を指摘する批判的思考の持ち主。現実的な制約を重視する慎重派AIです。', groqModel: 'llama-3.3-70b-versatile' },
};

async function initAdminAiDiscuss() {
  if (!_isAdmin || !_db) return;
  await _loadAiDiscApiKeys();
  _updateAiDiscButtonLabels();
  await _refreshAiDiscList();
}

function _updateAiDiscButtonLabels() {
  const auto = !!_aiDiscApiKeys.groq;
  const genBtn = document.getElementById('ai-disc-gen-btn');
  const genContinueBtn = document.getElementById('ai-disc-gen-continue-btn');
  if (genBtn) genBtn.textContent = auto ? '議論を実行' : 'プロンプトを生成';
  if (genContinueBtn) genContinueBtn.textContent = auto ? '続きを実行' : '続きのプロンプトを生成';
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
  const geminiInput = document.getElementById('ai-disc-gemini-key');
  const groqInput = document.getElementById('ai-disc-groq-key');
  if (geminiInput) geminiInput.value = _aiDiscApiKeys.gemini || '';
  if (groqInput) groqInput.value = _aiDiscApiKeys.groq || '';
}

async function saveAiDiscApiKeys() {
  if (!_isAdmin || !_db) return;
  const statusEl = document.getElementById('ai-disc-keys-status');
  const gemini = document.getElementById('ai-disc-gemini-key').value.trim();
  const groq = document.getElementById('ai-disc-groq-key').value.trim();
  statusEl.textContent = '保存中...'; statusEl.className = 'admin-status';
  try {
    await _db.collection('admin_secrets').doc('api_keys').set({
      gemini, groq, openai: firebase.firestore.FieldValue.delete(), claude: firebase.firestore.FieldValue.delete(),
    }, { merge: true });
    _aiDiscApiKeys = { gemini, groq };
    _updateAiDiscButtonLabels();
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
      <div class="admin-gather-date">${_esc(d.title || d.topic || '(無題)')}</div>
      <div class="admin-gather-meta">${dateStr}　全${roundCount}ラウンド</div>
    </div>`;
  }).join('');
}

function _aiDiscShowScreen(id) {
  document.querySelectorAll('#sec-admin-ai-discuss .admin-sub-screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function openNewAiDiscussion() {
  _aiDiscCurrentId = null;
  _aiDiscCurrentDoc = null;
  _aiDiscMode = 'new';
  _aiDiscNovaText = null;
  _aiDiscGuardText = null;
  _aiDiscAutoOutput = null;
  document.getElementById('ai-disc-topic-input').value = '';
  document.getElementById('ai-disc-rounds').innerHTML = '';
  document.getElementById('ai-disc-new-form').style.display = '';
  document.getElementById('ai-disc-continue-form').style.display = 'none';
  document.getElementById('ai-disc-prompt-area').style.display = 'none';
  document.getElementById('ai-disc-auto-area').style.display = 'none';
  document.getElementById('ai-disc-response-input').value = '';
  const statusEl = document.getElementById('ai-disc-status');
  statusEl.textContent = ''; statusEl.className = 'admin-status';
  _aiDiscShowScreen('ai-disc-detail-screen');
}

function closeAiDiscussionDetail() {
  _aiDiscShowScreen('ai-disc-list-screen');
}

// ── Gemini / Groq / Claude 呼び出し ──
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

async function _callGroqApi(prompt, model, maxTokens, _retried) {
  const key = _aiDiscApiKeys.groq;
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({
      model: model || 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens || 700,
    })
  });
  if (!res.ok) {
    // レート制限(429)の場合は、エラー文中の待機秒数だけ待って一度だけ再試行する
    if (res.status === 429 && !_retried) {
      const detail = await res.text();
      const m = detail.match(/try again in ([\d.]+)s/i);
      const waitMs = Math.min(m ? parseFloat(m[1]) : 5, 30) * 1000 + 500;
      await new Promise(r => setTimeout(r, waitMs));
      return _callGroqApi(prompt, model, maxTokens, true);
    }
    await _throwApiError(res, 'Groq');
  }
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
function _aiDiscContextBlock(topic, previousRounds) {
  if (previousRounds && previousRounds.length) {
    let block = '【これまでの議論】\n\n';
    previousRounds.forEach((r, i) => {
      block += `▼ ${i === 0 ? '初回の議題' : `追加条件${i}`}: ${r.input}\n\n${r.output}\n\n`;
    });
    block += `【追加の条件・質問】\n${topic}\n`;
    return block;
  }
  return `【テーマ】\n${topic}\n`;
}

function _buildPersonaSoloPrompt(name, emoji, desc, topic, previousRounds) {
  let prompt = `あなたは「${name}」という名前のAIです。${desc}\n\n`;
  prompt += _aiDiscContextBlock(topic, previousRounds) + '\n';
  prompt += `以下の構成でMarkdown形式で回答してください。\n\n`;
  prompt += `## ${emoji} ${name}\n（200〜300字程度。テーマに対するあなたの見解）\n\n`;
  prompt += `---\n\n### ${emoji} ${name}（第2ラウンド）\n（150〜250字。「ロジック」（論理的・データ重視のAI）と、もう一人の異なる視点のAIが同じ議論に参加している前提で、彼らから出されそうな指摘も意識しつつ、自分の意見を補足・深掘りしてください）`;
  if (previousRounds && previousRounds.length) {
    prompt += `\n\n前回の自分の見解からどう変わったか／変わらないかにも触れてください。`;
  }
  return prompt;
}

function _buildNovaPrompt(topic, previousRounds) {
  return _buildPersonaSoloPrompt('ノヴァ', '🟠', '楽観的で創造的。新しい可能性やアイデアを提示する革新派AIです。', topic, previousRounds);
}

function _buildGuardPrompt(topic, previousRounds) {
  return _buildPersonaSoloPrompt('ガード', '🟢', 'リスクや問題点を指摘する批判的思考の持ち主。現実的な制約を重視する慎重派AIです。', topic, previousRounds);
}

function _buildClaudeDiscussionPrompt(topic, previousRounds, novaText, guardText) {
  const writeNova = !novaText;
  const writeGuard = !guardText;
  let prompt = 'あなたは「マルチAI議論シミュレーター」のロジック（分析派AI：データと論理を重視し、客観的・体系的に分析する）担当として、議論を作成します。\n\n';

  const provided = [];
  if (novaText) provided.push(`【ノヴァ（革新派AI・楽観的で創造的）の意見】\n${novaText}`);
  if (guardText) provided.push(`【ガード（慎重派AI・リスク重視で批判的）の意見】\n${guardText}`);
  if (provided.length) {
    prompt += '別のAIがすでに以下の意見を述べています。\n\n' + provided.join('\n\n') + '\n\n';
  }

  prompt += _aiDiscContextBlock(topic, previousRounds) + '\n';

  prompt += '以下の構成でMarkdown形式で出力してください。\n\n';
  prompt += '## 🔵 ロジック\n（200〜300字程度の見解）\n\n';
  if (writeNova) prompt += '## 🟠 ノヴァ\n（200〜300字程度の見解。革新派AI＝楽観的で創造的、新しい可能性やアイデアを提示）\n\n';
  if (writeGuard) prompt += '## 🟢 ガード\n（200〜300字程度の見解。慎重派AI＝リスクや問題点を指摘、現実的な制約を重視）\n\n';
  prompt += '---\n\n## 第2ラウンド：相互の意見への反論・補足\n\n';
  prompt += '### 🔵 ロジック\n（150〜250字。他の2人の意見を踏まえて）\n\n';
  if (writeNova) prompt += '### 🟠 ノヴァ\n（150〜250字。他の2人の意見を踏まえて）\n\n';
  if (writeGuard) prompt += '### 🟢 ガード\n（150〜250字。他の2人の意見を踏まえて）\n\n';
  prompt += '---\n\n## 📋 結論\n**合意点：** （箇条書き）\n**相違点：** （箇条書き）\n**総合回答：** （まとめ）\n';

  if (previousRounds && previousRounds.length) {
    prompt += `\n結論部分の冒頭に、今回追加された条件「${topic}」を一文で明記してください。各AIが前回の見解からどう変わったか／変わらないかにも言及してください。`;
  }
  return prompt;
}

function _composeAiDiscOutput(claudeText, novaText, guardText) {
  const parts = [claudeText.trim()];
  if (novaText) parts.push(`## 🟠 ノヴァ\n\n${novaText.trim()}`);
  if (guardText) parts.push(`## 🟢 ガード\n\n${guardText.trim()}`);
  return parts.join('\n\n---\n\n');
}

async function _generateAiDiscPromptCommon(topic, previousRounds) {
  const promptArea = document.getElementById('ai-disc-prompt-area');
  const statusEl = document.getElementById('ai-disc-status');
  const genBtns = ['ai-disc-gen-btn', 'ai-disc-gen-continue-btn'].map(id => document.getElementById(id)).filter(Boolean);

  _aiDiscNovaText = null;
  _aiDiscGuardText = null;

  const hasGemini = !!_aiDiscApiKeys.gemini;
  const warnings = [];

  if (hasGemini) {
    genBtns.forEach(b => b.disabled = true);
    promptArea.style.display = 'none';
    statusEl.textContent = 'Gemini の意見を取得中...';
    statusEl.className = 'admin-status';

    try {
      _aiDiscNovaText = await _callGeminiApi(_buildNovaPrompt(topic, previousRounds));
    } catch(e) {
      warnings.push('Gemini: ' + e.message);
    }

    genBtns.forEach(b => b.disabled = false);
  }

  const prompt = _buildClaudeDiscussionPrompt(topic, previousRounds, _aiDiscNovaText, _aiDiscGuardText);
  document.getElementById('ai-disc-prompt-text').textContent = prompt;
  promptArea.style.display = '';
  document.getElementById('ai-disc-response-input').value = '';

  if (warnings.length) {
    statusEl.textContent = '一部のAI取得に失敗しました（' + warnings.join(' / ') + '）。Claudeにその分も担当してもらいます。';
    statusEl.className = 'admin-status error';
  } else if (_aiDiscNovaText || _aiDiscGuardText) {
    statusEl.textContent = 'Geminiの意見を取得しました。続けてClaudeのプロンプトをコピーしてください。';
    statusEl.className = 'admin-status ok';
  } else {
    statusEl.textContent = '';
    statusEl.className = 'admin-status';
  }
  promptArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function generateAiDiscussionPrompt() {
  const topic = document.getElementById('ai-disc-topic-input').value.trim();
  if (!topic) { alert('議題を入力してください'); return; }
  if (_aiDiscApiKeys.groq) await runAiDiscussionAuto(topic, null);
  else await _generateAiDiscPromptCommon(topic, null);
}

async function generateAiDiscussionContinuePrompt() {
  const addCond = document.getElementById('ai-disc-continue-input').value.trim();
  if (!addCond) { alert('追加の条件・質問を入力してください'); return; }
  if (_aiDiscApiKeys.groq) await runAiDiscussionAuto(addCond, _aiDiscCurrentDoc?.rounds || []);
  else await _generateAiDiscPromptCommon(addCond, _aiDiscCurrentDoc?.rounds || []);
}

// ── 自動実行（Groqキー設定時）: 第1ラウンド→第2ラウンド→結論の3段階で全AIが順に意見を交わす ──
function _buildRound1Prompt(persona, topic, previousRounds) {
  let prompt = `あなたは「${persona.name}」という名前のAIです。${persona.desc}\n\n`;
  prompt += _aiDiscContextBlock(topic, previousRounds) + '\n';
  prompt += '上記について、あなたの第1ラウンドの意見を200〜300字程度で述べてください。前置きや見出しは付けず、本文のみをMarkdown平文で出力してください。';
  return prompt;
}

function _buildRound2Prompt(persona, topic, previousRounds, round1All) {
  const P = _AI_DISC_PERSONAS;
  let prompt = `あなたは「${persona.name}」という名前のAIです。${persona.desc}\n\n`;
  prompt += _aiDiscContextBlock(topic, previousRounds) + '\n';
  prompt += '【第1ラウンドでの各AIの意見】\n\n';
  prompt += `▼ ${P.logic.name}（分析派AI）\n${round1All.logic}\n\n`;
  prompt += `▼ ${P.nova.name}（革新派AI）\n${round1All.nova}\n\n`;
  prompt += `▼ ${P.guard.name}（慎重派AI）\n${round1All.guard}\n\n`;
  prompt += '上記の他の2人の意見を踏まえ、反論や補足を含めたあなたの第2ラウンドの意見を150〜250字程度で述べてください。前置きや見出しは付けず、本文のみをMarkdown平文で出力してください。';
  if (previousRounds && previousRounds.length) {
    prompt += '\n\n前回（追加条件適用前）の自分の見解からどう変わったか／変わらないかにも触れてください。';
  }
  return prompt;
}

function _buildConclusionPrompt(topic, previousRounds, round1All, round2All) {
  const P = _AI_DISC_PERSONAS;
  let prompt = `あなたは「マルチAI議論シミュレーター」の結論担当です。以下は3人のAI（${P.logic.name}=分析派, ${P.nova.name}=革新派, ${P.guard.name}=慎重派）による2ラウンドの議論の記録です。\n\n`;
  prompt += _aiDiscContextBlock(topic, previousRounds) + '\n';
  prompt += `【第1ラウンド】\n▼ ${P.logic.name}\n${round1All.logic}\n\n▼ ${P.nova.name}\n${round1All.nova}\n\n▼ ${P.guard.name}\n${round1All.guard}\n\n`;
  prompt += `【第2ラウンド】\n▼ ${P.logic.name}\n${round2All.logic}\n\n▼ ${P.nova.name}\n${round2All.nova}\n\n▼ ${P.guard.name}\n${round2All.guard}\n\n`;
  prompt += 'これらを踏まえて、以下の形式で結論をMarkdownで出力してください。前置きや見出しは付けないでください。\n\n**合意点：**（箇条書き）\n**相違点：**（箇条書き）\n**総合回答：**（まとめ）';
  if (previousRounds && previousRounds.length) {
    prompt += `\n\n冒頭に、今回追加された条件「${topic}」を一文で明記してください。`;
  }
  return prompt;
}

async function _callPersonaApi(personaKey, prompt, maxTokens) {
  const persona = _AI_DISC_PERSONAS[personaKey];
  if (personaKey === 'nova' && _aiDiscApiKeys.gemini) {
    try { return await _callGeminiApi(prompt); }
    catch(e) { return await _callGroqApi(prompt, persona.groqModel, maxTokens); } // Gemini失敗時はGroqが代行
  }
  return await _callGroqApi(prompt, persona.groqModel, maxTokens);
}

function _composeAiDiscAutoOutput(round1All, round2All, conclusion) {
  const P = _AI_DISC_PERSONAS;
  let out = '';
  out += `## ${P.logic.emoji} ${P.logic.name}\n${round1All.logic.trim()}\n\n`;
  out += `## ${P.nova.emoji} ${P.nova.name}\n${round1All.nova.trim()}\n\n`;
  out += `## ${P.guard.emoji} ${P.guard.name}\n${round1All.guard.trim()}\n\n`;
  out += '---\n\n## 第2ラウンド：相互の意見への反論・補足\n\n';
  out += `### ${P.logic.emoji} ${P.logic.name}\n${round2All.logic.trim()}\n\n`;
  out += `### ${P.nova.emoji} ${P.nova.name}\n${round2All.nova.trim()}\n\n`;
  out += `### ${P.guard.emoji} ${P.guard.name}\n${round2All.guard.trim()}\n\n`;
  out += `---\n\n## 📋 結論\n${conclusion.trim()}\n`;
  return out;
}

async function runAiDiscussionAuto(topic, previousRounds) {
  const statusEl = document.getElementById('ai-disc-status');
  const promptArea = document.getElementById('ai-disc-prompt-area');
  const autoArea = document.getElementById('ai-disc-auto-area');
  const genBtns = ['ai-disc-gen-btn', 'ai-disc-gen-continue-btn'].map(id => document.getElementById(id)).filter(Boolean);

  promptArea.style.display = 'none';
  autoArea.style.display = 'none';
  _aiDiscAutoOutput = null;
  genBtns.forEach(b => b.disabled = true);
  statusEl.className = 'admin-status';

  try {
    statusEl.textContent = '第1ラウンドの意見を取得中...(1/3)';
    const [logic1, nova1, guard1] = await Promise.all([
      _callPersonaApi('logic', _buildRound1Prompt(_AI_DISC_PERSONAS.logic, topic, previousRounds), 500),
      _callPersonaApi('nova', _buildRound1Prompt(_AI_DISC_PERSONAS.nova, topic, previousRounds), 500),
      _callPersonaApi('guard', _buildRound1Prompt(_AI_DISC_PERSONAS.guard, topic, previousRounds), 500),
    ]);
    const round1All = { logic: logic1, nova: nova1, guard: guard1 };

    statusEl.textContent = '第2ラウンドの意見を取得中...(2/3)';
    const [logic2, nova2, guard2] = await Promise.all([
      _callPersonaApi('logic', _buildRound2Prompt(_AI_DISC_PERSONAS.logic, topic, previousRounds, round1All), 400),
      _callPersonaApi('nova', _buildRound2Prompt(_AI_DISC_PERSONAS.nova, topic, previousRounds, round1All), 400),
      _callPersonaApi('guard', _buildRound2Prompt(_AI_DISC_PERSONAS.guard, topic, previousRounds, round1All), 400),
    ]);
    const round2All = { logic: logic2, nova: nova2, guard: guard2 };

    statusEl.textContent = '結論をまとめています...(3/3)';
    const conclusion = await _callGroqApi(_buildConclusionPrompt(topic, previousRounds, round1All, round2All), _AI_DISC_PERSONAS.logic.groqModel, 800);

    _aiDiscAutoOutput = _composeAiDiscAutoOutput(round1All, round2All, conclusion);
    document.getElementById('ai-disc-auto-preview').innerHTML = _renderAiDiscMarkdown(_aiDiscAutoOutput);
    autoArea.style.display = '';
    statusEl.textContent = '議論が完成しました ✓'; statusEl.className = 'admin-status ok';
    autoArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch(e) {
    statusEl.textContent = 'エラー: ' + e.message; statusEl.className = 'admin-status error';
  }
  genBtns.forEach(b => b.disabled = false);
}

function copyAiDiscussionPrompt() {
  const text = document.getElementById('ai-disc-prompt-text').textContent;
  const btn = document.querySelector('#ai-disc-prompt-area .jare-prompt-copy-btn');
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = 'コピー済み';
    setTimeout(() => { btn.textContent = 'コピー'; }, 2000);
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy');
    document.body.removeChild(ta);
    btn.textContent = 'コピー済み';
    setTimeout(() => { btn.textContent = 'コピー'; }, 2000);
  });
}

async function openAiDiscussionDetail(id) {
  if (!_db) return;
  _aiDiscCurrentId = id;
  _aiDiscMode = 'continue';
  _aiDiscNovaText = null;
  _aiDiscGuardText = null;
  _aiDiscAutoOutput = null;
  document.getElementById('ai-disc-new-form').style.display = 'none';
  document.getElementById('ai-disc-rounds').innerHTML = '<div class="admin-empty">読み込み中...</div>';
  document.getElementById('ai-disc-continue-form').style.display = 'none';
  document.getElementById('ai-disc-prompt-area').style.display = 'none';
  document.getElementById('ai-disc-auto-area').style.display = 'none';
  _aiDiscShowScreen('ai-disc-detail-screen');
  try {
    const doc = await _db.collection('ai_discussions').doc(id).get();
    if (!doc.exists) {
      document.getElementById('ai-disc-rounds').innerHTML = '<div class="admin-empty">見つかりませんでした</div>';
      return;
    }
    _aiDiscCurrentDoc = { id: doc.id, ...doc.data() };
    _renderAiDiscussionRounds();
    document.getElementById('ai-disc-continue-input').value = '';
    document.getElementById('ai-disc-continue-form').style.display = '';
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
async function _saveAiDiscRound(output, statusEl) {
  if (_aiDiscMode === 'continue' && _aiDiscCurrentId) {
    const addCond = document.getElementById('ai-disc-continue-input').value.trim();
    const round = { input: addCond, output, createdAt: new Date().toISOString() };
    const rounds = [...(_aiDiscCurrentDoc.rounds || []), round];
    await _db.collection('ai_discussions').doc(_aiDiscCurrentId).update({
      rounds, updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    _aiDiscCurrentDoc.rounds = rounds;
    document.getElementById('ai-disc-prompt-area').style.display = 'none';
    document.getElementById('ai-disc-auto-area').style.display = 'none';
    document.getElementById('ai-disc-continue-input').value = '';
    _renderAiDiscussionRounds();
    _refreshAiDiscList();
  } else {
    const topic = document.getElementById('ai-disc-topic-input').value.trim();
    if (!topic) { statusEl.textContent = '議題を入力してください'; statusEl.className = 'admin-status error'; return false; }
    const title = topic.length > 30 ? topic.slice(0, 30) + '…' : topic;
    const round = { input: topic, output, createdAt: new Date().toISOString() };
    const ref = await _db.collection('ai_discussions').add({
      topic, title, rounds: [round],
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    await openAiDiscussionDetail(ref.id);
    _refreshAiDiscList();
  }
  return true;
}

async function saveAiDiscussion() {
  if (!_db) return;
  const statusEl = document.getElementById('ai-disc-status');
  const response = document.getElementById('ai-disc-response-input').value.trim();
  if (!response) { statusEl.textContent = 'AIの回答を貼り付けてください'; statusEl.className = 'admin-status error'; return; }
  const btn = document.getElementById('ai-disc-save-btn');
  btn.disabled = true;
  statusEl.textContent = '保存中...'; statusEl.className = 'admin-status';
  try {
    const output = _composeAiDiscOutput(response, _aiDiscNovaText, _aiDiscGuardText);
    const ok = await _saveAiDiscRound(output, statusEl);
    if (ok) {
      _aiDiscNovaText = null;
      _aiDiscGuardText = null;
      statusEl.textContent = '保存しました ✓'; statusEl.className = 'admin-status ok';
    }
  } catch(e) {
    statusEl.textContent = 'エラー: ' + e.message; statusEl.className = 'admin-status error';
  }
  btn.disabled = false;
}

async function saveAiDiscussionAuto() {
  if (!_db || !_aiDiscAutoOutput) return;
  const statusEl = document.getElementById('ai-disc-status');
  const btn = document.getElementById('ai-disc-auto-save-btn');
  btn.disabled = true;
  statusEl.textContent = '保存中...'; statusEl.className = 'admin-status';
  try {
    const ok = await _saveAiDiscRound(_aiDiscAutoOutput, statusEl);
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
