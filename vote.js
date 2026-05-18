// ── 投票箱 ──
let _voteCurrentBoxId = null;
let _voteDetailMode = 'option'; // 'option' | 'voter'
let _voteDeadlinePicker = null;

// ── ビュー切替 ──
function _voteShowView(viewId) {
  document.querySelectorAll('#sec-vote .vote-view').forEach(v => v.classList.remove('active'));
  const el = document.getElementById(viewId);
  if (el) el.classList.add('active');
}

// ── 一覧 ──
async function initVote() {
  _voteShowView('vote-list-view');
  history.replaceState(null, '', '#vote');
  await _loadVoteList();
}

async function _loadVoteList() {
  const listEl = document.getElementById('vote-list');
  if (!listEl) return;
  listEl.innerHTML = '<div class="vote-empty">読み込み中...</div>';
  if (!_db) { listEl.innerHTML = '<div class="vote-empty">データベース未接続</div>'; return; }
  try {
    const snap = await _db.collection('vote_boxes').orderBy('createdAt', 'desc').get();
    if (snap.empty) { listEl.innerHTML = '<div class="vote-empty">まだ投票箱がありません</div>'; return; }

    // 各投票箱の回答数を取得
    const boxes = await Promise.all(snap.docs.map(async d => {
      const data = { id: d.id, ...d.data() };
      const ansSnap = await _db.collection('vote_answers').where('boxId', '==', d.id).get();
      data._answers = ansSnap.docs.map(a => ({ id: a.id, ...a.data() }));
      return data;
    }));

    listEl.innerHTML = boxes.map(box => {
      const today = _voteTodayStr();
      const expired = box.deadline && box.deadline < today;
      const deadlineStr = box.deadline || '期限なし';

      // 選択肢ごとの票数カウント
      const optionCounts = {};
      (box.options || []).forEach(opt => { optionCounts[opt] = 0; });
      if (box.allowOther) optionCounts['__other__'] = 0;
      box._answers.forEach(ans => {
        (ans.selections || []).forEach(sel => {
          if (sel === '__other__') {
            optionCounts['__other__'] = (optionCounts['__other__'] || 0) + 1;
          } else {
            optionCounts[sel] = (optionCounts[sel] || 0) + 1;
          }
        });
      });

      // 票数多い順 上位2〜3選択肢
      const sortedOpts = Object.entries(optionCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);

      const topOptsHtml = sortedOpts.map(([opt, cnt]) => {
        const label = opt === '__other__' ? 'その他' : _esc(opt);
        return `<div class="vote-card-opt-row">
          <span class="vote-card-opt-label">${label}</span>
          <span class="vote-card-opt-count">${cnt}票</span>
        </div>`;
      }).join('');

      return `<div class="vote-card" onclick="openVoteDetail('${_escHtml(box.id)}')">
        <div class="vote-card-header">
          <span class="vote-card-title">${_esc(box.title)}</span>
          ${expired ? '<span class="vote-expired-badge">期限切れ</span>' : ''}
        </div>
        <div class="vote-card-meta">
          <span>👤 ${_esc(box.authorName || '匿名')}</span>
          <span>⏰ ${_esc(deadlineStr)}</span>
          <span>📊 ${box._answers.length}件の回答</span>
        </div>
        <div class="vote-card-opts">${topOptsHtml}</div>
      </div>`;
    }).join('');
  } catch(e) {
    listEl.innerHTML = '<div class="vote-empty">読み込みに失敗しました: ' + _esc(e.message) + '</div>';
  }
}

// ── 詳細 ──
async function openVoteDetail(boxId) {
  if (!_db) return;
  _voteCurrentBoxId = boxId;
  _voteDetailMode = 'option';
  history.replaceState(null, '', '#vote/' + boxId);
  _voteShowView('vote-detail-view');

  const detailEl = document.getElementById('vote-detail-content');
  if (detailEl) detailEl.innerHTML = '<div class="vote-empty">読み込み中...</div>';

  try {
    const boxDoc = await _db.collection('vote_boxes').doc(boxId).get();
    if (!boxDoc.exists) {
      if (detailEl) detailEl.innerHTML = '<div class="vote-empty">投票箱が見つかりません</div>';
      return;
    }
    const box = { id: boxDoc.id, ...boxDoc.data() };
    const ansSnap = await _db.collection('vote_answers').where('boxId', '==', boxId).orderBy('createdAt', 'asc').get();
    const answers = ansSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    _renderVoteDetail(box, answers);
  } catch(e) {
    if (detailEl) detailEl.innerHTML = '<div class="vote-empty">読み込みに失敗しました: ' + _esc(e.message) + '</div>';
  }
}

function _renderVoteDetail(box, answers) {
  const today = _voteTodayStr();
  const expired = box.deadline && box.deadline < today;

  // タイトル・メタ
  const titleEl = document.getElementById('vote-detail-title');
  if (titleEl) titleEl.textContent = box.title || '（タイトルなし）';

  const metaEl = document.getElementById('vote-detail-meta');
  if (metaEl) {
    metaEl.innerHTML = `
      <span>👤 ${_esc(box.authorName || '匿名')}</span>
      <span>⏰ ${box.deadline ? _esc(box.deadline) : '期限なし'}${expired ? ' <span class="vote-expired-badge">期限切れ</span>' : ''}</span>
      <span>📊 ${answers.length}件の回答</span>
      ${box.multipleChoice ? '<span class="vote-badge">複数回答可</span>' : ''}
    `;
  }

  // 削除ボタン
  const canDelete = (_currentUser && box.uid && box.uid === _currentUser.uid) || _isAdmin;
  const deleteRow = document.getElementById('vote-detail-delete-row');
  if (deleteRow) {
    deleteRow.style.display = canDelete ? '' : 'none';
    const deleteBtn = document.getElementById('vote-detail-delete-btn');
    if (deleteBtn) deleteBtn.onclick = () => deleteVoteBox(box.id);
  }

  // 解答ボタン
  const answerBtn = document.getElementById('vote-answer-btn');
  if (answerBtn) {
    if (expired) {
      answerBtn.disabled = true;
      answerBtn.title = '期限切れのため回答できません';
    } else {
      answerBtn.disabled = false;
      answerBtn.title = '';
      answerBtn.onclick = () => openVoteAnswerForm(box);
    }
  }

  // 期限切れ注意
  const expiredNotice = document.getElementById('vote-expired-notice');
  if (expiredNotice) expiredNotice.style.display = expired ? '' : 'none';

  // 表示モード切替ボタン
  _updateVoteDetailToggle();

  // コンテンツ描画
  _renderVoteDetailContent(box, answers);
}

function _updateVoteDetailToggle() {
  const btnOpt = document.getElementById('vote-toggle-option');
  const btnVoter = document.getElementById('vote-toggle-voter');
  if (btnOpt) btnOpt.classList.toggle('active', _voteDetailMode === 'option');
  if (btnVoter) btnVoter.classList.toggle('active', _voteDetailMode === 'voter');
}

function toggleVoteDetailMode(mode) {
  _voteDetailMode = mode;
  _updateVoteDetailToggle();
  // 再描画：現在のboxIdからデータを再取得せずに保持したデータで再描画
  if (_voteCurrentBoxId) openVoteDetail(_voteCurrentBoxId);
}

function _renderVoteDetailContent(box, answers) {
  const contentEl = document.getElementById('vote-detail-content');
  if (!contentEl) return;

  // 選択肢ごとの集計
  const optionData = {};
  (box.options || []).forEach(opt => { optionData[opt] = { count: 0, voters: [] }; });
  if (box.allowOther) optionData['__other__'] = { count: 0, voters: [], otherTexts: [] };

  answers.forEach(ans => {
    const voterName = ans.voterName || '匿名';
    (ans.selections || []).forEach(sel => {
      if (!optionData[sel]) optionData[sel] = { count: 0, voters: [] };
      optionData[sel].count++;
      optionData[sel].voters.push({ name: voterName, note: ans.note || '', uid: ans.uid || null, id: ans.id });
      if (sel === '__other__' && ans.otherText) {
        if (!optionData[sel].otherTexts) optionData[sel].otherTexts = [];
        optionData[sel].otherTexts.push({ name: voterName, text: ans.otherText });
      }
    });
  });

  const maxCount = Math.max(1, ...Object.values(optionData).map(d => d.count));

  if (_voteDetailMode === 'option') {
    // 選択肢別表示
    const optEntries = Object.entries(optionData).sort((a, b) => b[1].count - a[1].count);
    contentEl.innerHTML = optEntries.map(([opt, data]) => {
      const label = opt === '__other__' ? 'その他' : _esc(opt);
      const pct = Math.round((data.count / maxCount) * 100);
      const votersHtml = data.voters.length
        ? data.voters.map(v => {
            const canDel = (_currentUser && v.uid && v.uid === _currentUser.uid) || _isAdmin;
            const noteHtml = v.note ? `<span class="vote-voter-note">${_esc(v.note)}</span>` : '';
            const delBtn = canDel
              ? `<button class="vote-del-answer-btn" onclick="deleteVoteAnswer('${_escHtml(v.id)}','${_escHtml(_voteCurrentBoxId)}')">削除</button>`
              : '';
            return `<div class="vote-voter-item">${_esc(v.name)}${noteHtml}${delBtn}</div>`;
          }).join('')
        : '<div class="vote-voter-none">回答なし</div>';

      const otherTextsHtml = (data.otherTexts || []).length
        ? '<div class="vote-other-texts">' + data.otherTexts.map(t =>
            `<div class="vote-other-text-item"><span class="vote-other-text-name">${_esc(t.name)}：</span>${_esc(t.text)}</div>`
          ).join('') + '</div>'
        : '';

      return `<div class="vote-option-block">
        <div class="vote-option-header">
          <span class="vote-option-label">${label}</span>
          <span class="vote-option-count">${data.count}票</span>
        </div>
        <div class="vote-bar-wrap">
          <div class="vote-bar" style="width:${pct}%"></div>
        </div>
        ${otherTextsHtml}
        <div class="vote-voters">${votersHtml}</div>
      </div>`;
    }).join('');

    // 全員の備考
    const notesWithContent = answers.filter(a => a.note);
    if (notesWithContent.length) {
      contentEl.innerHTML += `<div class="vote-notes-section">
        <div class="vote-notes-heading">備考一覧</div>
        ${notesWithContent.map(a => `<div class="vote-note-item">
          <span class="vote-note-name">${_esc(a.voterName || '匿名')}</span>
          <span class="vote-note-text">${_esc(a.note)}</span>
        </div>`).join('')}
      </div>`;
    }
  } else {
    // 解答者別表示
    if (!answers.length) {
      contentEl.innerHTML = '<div class="vote-empty">まだ回答がありません</div>';
      return;
    }
    contentEl.innerHTML = answers.map(ans => {
      const canDel = (_currentUser && ans.uid && ans.uid === _currentUser.uid) || _isAdmin;
      const selectionsHtml = (ans.selections || []).map(sel => {
        const label = sel === '__other__' ? `その他：${_esc(ans.otherText || '')}` : _esc(sel);
        return `<span class="vote-ans-tag">${label}</span>`;
      }).join('');
      const noteHtml = ans.note ? `<div class="vote-ans-note">${_esc(ans.note)}</div>` : '';
      const delBtn = canDel
        ? `<button class="vote-del-answer-btn" onclick="deleteVoteAnswer('${_escHtml(ans.id)}','${_escHtml(_voteCurrentBoxId)}')">削除</button>`
        : '';
      return `<div class="vote-ans-card">
        <div class="vote-ans-header">
          <span class="vote-ans-name">${_esc(ans.voterName || '匿名')}</span>
          ${delBtn}
        </div>
        <div class="vote-ans-selections">${selectionsHtml}</div>
        ${noteHtml}
      </div>`;
    }).join('');
  }
}

// ── 追加フォーム ──
function openVoteAddForm() {
  _voteShowView('vote-add-view');
  history.replaceState(null, '', '#vote');

  // 名前の初期値
  const nameEl = document.getElementById('vote-add-name');
  if (nameEl) nameEl.value = _registeredName || '匿名';

  // ログイン注意書き
  const warnEl = document.getElementById('vote-add-login-warn');
  if (warnEl) warnEl.style.display = _currentUser ? 'none' : '';

  // 選択肢リセット
  _voteResetOptions();

  // チェックボックスリセット
  const allowOtherEl = document.getElementById('vote-add-allow-other');
  if (allowOtherEl) allowOtherEl.checked = false;
  const multiEl = document.getElementById('vote-add-multiple');
  if (multiEl) multiEl.checked = false;

  // 期限：今日〜1ヶ月
  const today = _voteTodayStr();
  const maxDate = _voteAddMonth(today, 1);
  const deadlineEl = document.getElementById('vote-add-deadline');
  if (deadlineEl) {
    deadlineEl.value = '';
    deadlineEl.min = today;
    deadlineEl.max = maxDate;
  }

  // タイトルリセット
  const titleEl = document.getElementById('vote-add-title');
  if (titleEl) titleEl.value = '';

  const statusEl = document.getElementById('vote-add-status');
  if (statusEl) statusEl.textContent = '';

  const submitBtn = document.getElementById('vote-add-submit-btn');
  if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '投票箱を作成'; }
}

function _voteResetOptions() {
  const container = document.getElementById('vote-options-container');
  if (!container) return;
  container.innerHTML = `
    <div class="vote-opt-row">
      <input type="text" class="vote-opt-input admin-input" placeholder="選択肢 1" required>
      <button type="button" class="vote-opt-remove-btn admin-btn" onclick="_voteRemoveOption(this)">－</button>
    </div>
    <div class="vote-opt-row">
      <input type="text" class="vote-opt-input admin-input" placeholder="選択肢 2" required>
      <button type="button" class="vote-opt-remove-btn admin-btn" onclick="_voteRemoveOption(this)">－</button>
    </div>`;
  _voteUpdateRemoveBtns();
}

function _voteAddOptionRow() {
  const container = document.getElementById('vote-options-container');
  if (!container) return;
  const rows = container.querySelectorAll('.vote-opt-row');
  const num = rows.length + 1;
  const row = document.createElement('div');
  row.className = 'vote-opt-row';
  row.innerHTML = `
    <input type="text" class="vote-opt-input admin-input" placeholder="選択肢 ${num}">
    <button type="button" class="vote-opt-remove-btn admin-btn" onclick="_voteRemoveOption(this)">－</button>`;
  container.appendChild(row);
  _voteUpdateRemoveBtns();
}

function _voteRemoveOption(btn) {
  const container = document.getElementById('vote-options-container');
  const rows = container.querySelectorAll('.vote-opt-row');
  if (rows.length <= 2) return; // 最低2つ
  btn.closest('.vote-opt-row').remove();
  _voteUpdateRemoveBtns();
}

function _voteUpdateRemoveBtns() {
  const container = document.getElementById('vote-options-container');
  if (!container) return;
  const rows = container.querySelectorAll('.vote-opt-row');
  rows.forEach(row => {
    const btn = row.querySelector('.vote-opt-remove-btn');
    if (btn) btn.disabled = rows.length <= 2;
  });
}

async function submitVoteBox(e) {
  e.preventDefault();
  if (!_db) return;
  const submitBtn = document.getElementById('vote-add-submit-btn');
  const statusEl = document.getElementById('vote-add-status');
  submitBtn.disabled = true; submitBtn.textContent = '作成中...';
  statusEl.textContent = '';

  const title = (document.getElementById('vote-add-title').value || '').trim();
  const authorName = (document.getElementById('vote-add-name').value || '').trim() || '匿名';
  const deadline = document.getElementById('vote-add-deadline').value || null;
  const allowOther = document.getElementById('vote-add-allow-other').checked;
  const multipleChoice = document.getElementById('vote-add-multiple').checked;

  // 選択肢収集
  const optInputs = document.querySelectorAll('#vote-options-container .vote-opt-input');
  const options = Array.from(optInputs)
    .map(inp => inp.value.trim())
    .filter(v => v.length > 0);

  if (!title) { statusEl.textContent = '質問を入力してください'; submitBtn.disabled = false; submitBtn.textContent = '投票箱を作成'; return; }
  if (options.length < 2) { statusEl.textContent = '選択肢を2つ以上入力してください'; submitBtn.disabled = false; submitBtn.textContent = '投票箱を作成'; return; }

  // 重複チェック
  if (new Set(options).size !== options.length) {
    statusEl.textContent = '選択肢に重複があります'; submitBtn.disabled = false; submitBtn.textContent = '投票箱を作成'; return;
  }

  try {
    const payload = {
      title, authorName, options, allowOther, multipleChoice,
      deadline,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (_currentUser) payload.uid = _currentUser.uid;

    await _db.collection('vote_boxes').add(payload);
    // 一覧に戻る
    initVote();
  } catch(err) {
    statusEl.textContent = 'エラー: ' + err.message;
    submitBtn.disabled = false; submitBtn.textContent = '投票箱を作成';
  }
}

// ── 解答フォーム ──
let _voteCurrentBox = null;

function openVoteAnswerForm(box) {
  _voteCurrentBox = box;
  _voteShowView('vote-answer-view');

  const titleEl = document.getElementById('vote-answer-box-title');
  if (titleEl) titleEl.textContent = box.title || '';

  // 名前の初期値（解答数+1）
  const nameEl = document.getElementById('vote-answer-name');
  if (nameEl) {
    if (_registeredName) {
      nameEl.value = _registeredName;
    } else {
      // 後でanswerCountを取得して設定するが、まず仮設定
      nameEl.value = '匿名';
      if (_db) {
        _db.collection('vote_answers').where('boxId', '==', box.id).get().then(snap => {
          nameEl.value = '匿名' + (snap.size + 1);
        }).catch(() => {});
      }
    }
  }

  // 選択肢の描画
  const choicesEl = document.getElementById('vote-answer-choices');
  if (choicesEl) {
    const inputType = box.multipleChoice ? 'checkbox' : 'radio';
    let html = (box.options || []).map((opt, i) => `
      <label class="vote-choice-item">
        <input type="${inputType}" name="vote-choice" value="${_escHtml(opt)}">
        <span>${_esc(opt)}</span>
      </label>`).join('');

    if (box.allowOther) {
      html += `<label class="vote-choice-item">
        <input type="${inputType}" name="vote-choice" value="__other__" id="vote-other-check" onchange="_voteToggleOtherText()">
        <span>その他</span>
      </label>
      <div id="vote-other-text-wrap" style="display:none;margin-top:6px;padding-left:24px;">
        <input type="text" id="vote-other-text" class="admin-input" placeholder="その他の内容を入力" style="font-size:14px;">
      </div>`;
    }
    choicesEl.innerHTML = html;
  }

  const noteEl = document.getElementById('vote-answer-note');
  if (noteEl) noteEl.value = '';

  const statusEl = document.getElementById('vote-answer-status');
  if (statusEl) statusEl.textContent = '';

  const submitBtn = document.getElementById('vote-answer-submit-btn');
  if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '回答する'; }
}

function _voteToggleOtherText() {
  const check = document.getElementById('vote-other-check');
  const wrap = document.getElementById('vote-other-text-wrap');
  if (check && wrap) wrap.style.display = check.checked ? '' : 'none';
}

async function submitVoteAnswer(e) {
  e.preventDefault();
  const box = _voteCurrentBox;
  if (!box || !_db) return;

  const submitBtn = document.getElementById('vote-answer-submit-btn');
  const statusEl = document.getElementById('vote-answer-status');
  submitBtn.disabled = true; submitBtn.textContent = '送信中...';
  statusEl.textContent = '';

  const voterName = (document.getElementById('vote-answer-name').value || '').trim() || '匿名';
  const note = (document.getElementById('vote-answer-note').value || '').trim();

  // 選択肢収集
  const checked = Array.from(document.querySelectorAll('#vote-answer-choices input[name="vote-choice"]:checked'));
  const selections = checked.map(c => c.value);

  if (!selections.length) {
    statusEl.textContent = '選択肢を1つ以上選んでください';
    submitBtn.disabled = false; submitBtn.textContent = '回答する'; return;
  }

  // その他テキスト
  let otherText = '';
  if (selections.includes('__other__')) {
    otherText = (document.getElementById('vote-other-text')?.value || '').trim();
  }

  try {
    const payload = {
      boxId: box.id, voterName, selections, note,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (otherText) payload.otherText = otherText;
    if (_currentUser) payload.uid = _currentUser.uid;

    await _db.collection('vote_answers').add(payload);
    // 詳細に戻る
    await openVoteDetail(box.id);
  } catch(err) {
    statusEl.textContent = 'エラー: ' + err.message;
    submitBtn.disabled = false; submitBtn.textContent = '回答する';
  }
}

// ── 削除 ──
async function deleteVoteBox(boxId) {
  if (!_db || !_currentUser) return;
  if (!confirm('この投票箱を削除しますか？すべての回答も削除されます。')) return;
  try {
    const ansSnap = await _db.collection('vote_answers').where('boxId', '==', boxId).get();
    const batch = _db.batch();
    ansSnap.docs.forEach(d => batch.delete(d.ref));
    batch.delete(_db.collection('vote_boxes').doc(boxId));
    await batch.commit();
    initVote();
  } catch(e) {
    alert('削除に失敗しました: ' + e.message);
  }
}

async function deleteVoteAnswer(answerId, boxId) {
  if (!_db || !_currentUser) return;
  if (!confirm('この回答を削除しますか？')) return;
  try {
    await _db.collection('vote_answers').doc(answerId).delete();
    await openVoteDetail(boxId);
  } catch(e) {
    alert('削除に失敗しました: ' + e.message);
  }
}

// ── ユーティリティ ──
function _voteTodayStr() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' });
}

function _voteAddMonth(dateStr, months) {
  const d = new Date(dateStr + 'T00:00:00+09:00');
  d.setMonth(d.getMonth() + months);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
