function calcStats(memberName, gathers) {
  let allTotal=0,total4=0,total3=0,totalChip=0,totalChip4=0,totalChip3=0;
  let matchCountAll=0,matchCount4=0,matchCount3=0;
  let tobi4=0,tobi3=0,comeCount=0,totalM=0;
  let count12_4=0,count1_3=0;
  let c1_4=0,c2_4=0,c3_4=0,c4_4=0,c1_3=0,c2_3=0,c3_3=0;

  gathers.forEach(g => {
    const idx = g.members.indexOf(memberName);
    if (idx===-1) return;
    comeCount++;
    g.matches.forEach(m => {
      const sc = m.scores[idx]; const rk = m.ranks[idx];
      if (sc===null||sc===undefined) return;
      const cnt = m.scores.filter(s=>s!==null&&s!==undefined).length;
      allTotal+=sc; totalM+=sc*(g.rate||10); matchCountAll++;
      if (cnt===3) {
        total3+=sc;
        if (!m.isChip) { matchCount3++; if(rk===1)c1_3++;else if(rk===2)c2_3++;else if(rk===3)c3_3++; if(sc<=-70)tobi3++; if(rk===1)count1_3++; }
        if (m.isChip) totalChip3+=Math.floor(sc/2);
      } else {
        total4+=sc;
        if (!m.isChip) { matchCount4++; if(rk===1)c1_4++;else if(rk===2)c2_4++;else if(rk===3)c3_4++;else if(rk===4)c4_4++; if(sc<=-60)tobi4++; if(rk<=2)count12_4++; }
        if (m.isChip) totalChip4+=Math.floor(sc/2);
      }
      if (m.isChip) totalChip+=Math.floor(sc/2);
    });
  });

  const t4=c1_4+c2_4+c3_4+c4_4, t3=c1_3+c2_3+c3_3;
  const p=(n,t)=>t>0?Math.round(n/(t/100)*100)/100:0;
  return {
    name:memberName, allTotal,total4,total3,totalChip,totalChip4,totalChip3,
    matchCountAll,matchCount4,matchCount3,tobi4,tobi3,comeCount,totalM,
    rentairitsu:  matchCount4>0?count12_4/matchCount4:0,
    rentairitsu3: matchCount3>0?count1_3/matchCount3:0,
    res4:{count1:c1_4,count2:c2_4,count3:c3_4,count4:c4_4,percent1:p(c1_4,t4),percent2:p(c2_4,t4),percent3:p(c3_4,t4),percent4:p(c4_4,t4)},
    res3:{count1:c1_3,count2:c2_3,count3:c3_3,percent1:p(c1_3,t3),percent2:p(c2_3,t3),percent3:p(c3_3,t3)},
  };
}

function calcDataPoints(memberName, gathers) {
  const r={}; COL_KEYS.forEach(k=>r[k]=[]);
  let allTotal=0,total4=0,total3=0,totalChip=0,totalChip4=0,totalChip3=0;
  let matchCountAll=0,matchCount4=0,matchCount3=0,tobi4=0,tobi3=0,comeCount=0,totalM=0,count12_4=0,count1_3=0;
  [...gathers].sort((a,b)=>a.date.localeCompare(b.date)).forEach(g=>{
    const idx=g.members.indexOf(memberName); if(idx===-1)return; comeCount++;
    g.matches.forEach(m=>{
      const sc=m.scores[idx],rk=m.ranks[idx]; if(sc===null||sc===undefined)return;
      const cnt=m.scores.filter(s=>s!==null&&s!==undefined).length;
      allTotal+=sc; totalM+=sc*(g.rate||10); matchCountAll++;
      if(cnt===3){total3+=sc;if(!m.isChip){matchCount3++;if(sc<=-70)tobi3++;if(rk===1)count1_3++;}if(m.isChip)totalChip3+=Math.floor(sc/2);}
      else{total4+=sc;if(!m.isChip){matchCount4++;if(sc<=-60)tobi4++;if(rk<=2)count12_4++;}if(m.isChip)totalChip4+=Math.floor(sc/2);}
      if(m.isChip)totalChip+=Math.floor(sc/2);
    });
    const d=g.date;
    r['総成績'].push({date:d,value:allTotal}); r['4麻成績'].push({date:d,value:total4}); r['3麻成績'].push({date:d,value:total3});
    r['総半荘数'].push({date:d,value:matchCountAll}); r['4麻半荘数'].push({date:d,value:matchCount4}); r['3麻半荘数'].push({date:d,value:matchCount3});
    r['総チップ'].push({date:d,value:totalChip}); r['4麻チップ'].push({date:d,value:totalChip4}); r['3麻チップ'].push({date:d,value:totalChip3});
    r['4麻飛び'].push({date:d,value:tobi4}); r['3麻飛び'].push({date:d,value:tobi3});
    r['連対率'].push({date:d,value:matchCount4>0?count12_4/matchCount4:0});
    r['1着率'].push({date:d,value:matchCount3>0?count1_3/matchCount3:0});
    r['プレイ時間'].push({date:d,value:0}); r['来店回数'].push({date:d,value:comeCount}); r['総収支'].push({date:d,value:totalM});
  });
  return r;
}

// ── リフレッシュ ──
function refresh() {
  const gathers = filteredGathers();
  const stats = DATA.members.map(m=>calcStats(m.name, gathers));
  buildRanking(stats);
  buildMemberButtons(stats, gathers);
  buildHistory(gathers);
  if (currentSection==='graph') renderChart(gathers);
}

function buildRanking(stats) {
  document.getElementById('tbody-ranking').innerHTML =
    [...stats].sort((a,b)=>b.allTotal-a.allTotal).map((m,i)=>{
      const r=i+1;
      return `<tr>
        <td>${rankBadge(r)}</td><td class="name-cell">${m.name}</td>
        <td class="${sc(m.allTotal)}">${fmt(m.allTotal)}</td>
        <td class="${sc(m.total4)}">${fmt(m.total4)}</td>
        <td class="${sc(m.total3)}">${fmt(m.total3)}</td>
        <td>${m.matchCount4}</td><td>${m.matchCount3}</td><td>${m.matchCount4+m.matchCount3}</td><td>${fmtPct(m.rentairitsu)}</td>
        <td class="${sc(m.totalChip)}">${fmt(m.totalChip)}</td>
        <td>${m.tobi4}</td><td>${m.tobi3}</td><td>${m.comeCount}</td>
      </tr>`;
    }).join('');
}

// ── 個人成績 ──
function memberSortFn(a, b) {
  if (memberSortKey === 'name') return a.name.localeCompare(b.name, 'ja');
  if (memberSortKey === 'matchCount') return (b.matchCount4+b.matchCount3) - (a.matchCount4+a.matchCount3);
  return b[memberSortKey] - a[memberSortKey];
}

function onMemberSortChange(val) {
  memberSortKey = val;
  const g = filteredGathers();
  const stats = DATA.members.map(m => calcStats(m.name, g));
  buildMemberButtons(stats, g);
}

function memberSortDisplay(m) {
  if (memberSortKey === 'total4')    return { val: fmt(m.total4),  cls: sc(m.total4) };
  if (memberSortKey === 'total3')    return { val: fmt(m.total3),  cls: sc(m.total3) };
  if (memberSortKey === 'matchCount') return { val: fmt(m.allTotal), cls: sc(m.allTotal) };
  return { val: fmt(m.allTotal), cls: sc(m.allTotal) };
}

function buildMemberButtons(stats, gathers) {
  const sorted = [...stats].sort(memberSortFn);
  document.getElementById('member-btns').innerHTML = sorted.map(m=>{
    const disp = memberSortDisplay(m);
    return `
    <button class="member-btn${m.name===activeMemberName?' active':''}" onclick="selectMember('${m.name}')">
      <div class="m-name">${m.name}</div>
      <div class="m-score ${disp.cls}">${disp.val}</div>
      <div class="m-count">${m.matchCount4+m.matchCount3}半荘</div>
    </button>`;
  }).join('');
  const target = stats.find(m=>m.name===activeMemberName) || sorted[0];
  if (target) renderMemberDetail(target);
}

function selectMember(name) {
  activeMemberName = name;
  const g = filteredGathers();
  const m = calcStats(name, g);
  document.querySelectorAll('.member-btn').forEach(b=>b.classList.toggle('active',b.querySelector('.m-name').textContent===name));
  renderMemberDetail(m);
  // 成績詳細へスクロール
  setTimeout(() => {
    const el = document.getElementById('member-detail');
    if (el) el.scrollIntoView({ behavior:'smooth', block:'start' });
  }, 50);
}

function renderMemberDetail(m) {
  activeMemberName = m.name;
  const bar = (items) => {
    const scale = p => Math.min(100, Math.max(0, (p-10)/30*100));
    return items.map(it=>`
    <div class="rank-bar-row">
      <span class="rank-bar-label">${it.l}</span>
      <div class="rank-bar-track"><div class="rank-bar-fill" style="width:${scale(it.p).toFixed(1)}%;background:${it.c}"></div></div>
      <span class="rank-bar-pct">${it.p.toFixed(1)}%<span class="rank-bar-cnt">${it.n}回</span></span>
    </div>`).join('');
  };
  document.getElementById('member-detail').innerHTML = `
    <div class="card">
      <div class="card-title">${m.name}</div>
      <div class="detail-grid">
        <div class="stat-block">
          <div class="stat-block-title">4人麻雀</div>
          <div class="stat-row"><span class="stat-label">成績</span><span class="stat-value ${sc(m.total4)}">${fmt(m.total4)}</span></div>
          <div class="stat-row"><span class="stat-label">半荘数</span><span class="stat-value">${m.matchCount4}</span></div>
          <div class="stat-row"><span class="stat-label">連対率</span><span class="stat-value">${fmtPct(m.rentairitsu)}</span></div>
          <div class="stat-row"><span class="stat-label">チップ</span><span class="stat-value ${sc(m.totalChip4)}">${fmt(m.totalChip4)}</span></div>
          <div class="stat-row"><span class="stat-label">飛び</span><span class="stat-value">${m.tobi4}回</span></div>
          <div class="rank-bar-wrap">${bar([{l:'1着',p:m.res4.percent1,n:m.res4.count1,c:'#4caf82'},{l:'2着',p:m.res4.percent2,n:m.res4.count2,c:'#c8a96e'},{l:'3着',p:m.res4.percent3,n:m.res4.count3,c:'#e69a30'},{l:'4着',p:m.res4.percent4,n:m.res4.count4,c:'#e63946'}])}</div>
        </div>
        <div class="stat-block">
          <div class="stat-block-title">3人麻雀</div>
          <div class="stat-row"><span class="stat-label">成績</span><span class="stat-value ${sc(m.total3)}">${fmt(m.total3)}</span></div>
          <div class="stat-row"><span class="stat-label">半荘数</span><span class="stat-value">${m.matchCount3}</span></div>
          <div class="stat-row"><span class="stat-label">1着率</span><span class="stat-value">${fmtPct(m.rentairitsu3)}</span></div>
          <div class="stat-row"><span class="stat-label">チップ</span><span class="stat-value ${sc(m.totalChip3)}">${fmt(m.totalChip3)}</span></div>
          <div class="stat-row"><span class="stat-label">飛び</span><span class="stat-value">${m.tobi3}回</span></div>
          <div class="rank-bar-wrap">${bar([{l:'1着',p:m.res3.percent1,n:m.res3.count1,c:'#4caf82'},{l:'2着',p:m.res3.percent2,n:m.res3.count2,c:'#c8a96e'},{l:'3着',p:m.res3.percent3,n:m.res3.count3,c:'#e63946'}])}</div>
        </div>
        <div class="stat-block">
          <div class="stat-block-title">総合</div>
          <div class="stat-row"><span class="stat-label">総成績</span><span class="stat-value ${sc(m.allTotal)}">${fmt(m.allTotal)}</span></div>
          <div class="stat-row"><span class="stat-label">半荘数</span><span class="stat-value">${m.matchCount4+m.matchCount3}</span></div>
          <div class="stat-row"><span class="stat-label">総チップ</span><span class="stat-value ${sc(m.totalChip)}">${fmt(m.totalChip)}</span></div>
          <div class="stat-row"><span class="stat-label">来店回数</span><span class="stat-value">${m.comeCount}回</span></div>
        </div>
      </div>
      <div class="member-charts-section">
        <div class="member-chart-block">
          <div class="stat-block-title">総成績推移</div>
          <div class="chart-wrap-sm"><canvas id="mc-total"></canvas></div>
        </div>
        <div class="member-chart-block">
          <div class="stat-block-title">4人麻雀成績推移</div>
          <div class="chart-wrap-sm"><canvas id="mc-4p"></canvas></div>
        </div>
        <div class="member-chart-block">
          <div class="stat-block-title">3人麻雀成績推移</div>
          <div class="chart-wrap-sm"><canvas id="mc-3p"></canvas></div>
        </div>
      </div>
    </div>`;
  if (currentSection === 'member') renderMemberCharts(m.name);
}

function fmtTick(ts, daySpan) {
  const d = new Date(ts);
  if (daySpan <= 90) return (d.getMonth()+1) + '/' + d.getDate();
  return d.getFullYear() + '/' + (d.getMonth()+1);
}
function fmtTooltipDate(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '/' + String(d.getMonth()+1).padStart(2,'0') + '/' + String(d.getDate()).padStart(2,'0');
}

// 月初め・四半期など、カレンダー境界に揃えたtick値を生成する
function _calendarTicks(startMs, endMs, daySpan) {
  const step = daySpan <= 90 ? 1 : daySpan <= 365 ? 2 : daySpan <= 730 ? 3 : 6; // 月単位の間隔
  const ticks = [];
  const s = new Date(startMs);
  let d = new Date(s.getFullYear(), s.getMonth(), 1); // 月初めにスナップ
  const end = new Date(endMs);
  while (d <= end) {
    ticks.push({ value: d.getTime() });
    d = new Date(d.getFullYear(), d.getMonth() + step, 1);
  }
  return ticks;
}

function renderMemberCharts(memberName) {
  memberChartInstances.forEach(c => c.destroy());
  memberChartInstances = [];
  const gathers = filteredGathers();
  const dp = calcDataPoints(memberName, gathers);
  const memberIdx = DATA.members.findIndex(m => m.name === memberName);
  const color = COLORS[memberIdx % COLORS.length];
  const allDates = gathers.map(g=>new Date(g.date)).filter(d=>!isNaN(d)).sort((a,b)=>a-b);
  const daySpan = allDates.length>=2 ? (allDates[allDates.length-1]-allDates[0])/(1000*60*60*24) : 365;
  [['mc-total','総成績'],['mc-4p','4麻成績'],['mc-3p','3麻成績']].forEach(([id,key])=>{
    const canvas = document.getElementById(id);
    if (!canvas) return;
    const pts = (dp[key]||[]).map(p=>({x:new Date(p.date).getTime(),y:p.value}));
    const c = new Chart(canvas.getContext('2d'),{
      type:'line', data:{datasets:[{label:key,data:pts,borderColor:color,backgroundColor:'transparent',pointBackgroundColor:color,borderWidth:2,pointRadius:2,tension:0.3}]},
      options:{
        responsive:true, maintainAspectRatio:false, parsing:false,
        plugins:{
          legend:{display:false},
          tooltip:{callbacks:{title:i=>fmtTooltipDate(i[0].parsed.x),label:c=>`${c.parsed.y}`}}
        },
        scales:{
          x:{type:'linear',afterBuildTicks(ax){if(allDates.length>=2)ax.ticks=_calendarTicks(allDates[0].getTime(),allDates[allDates.length-1].getTime(),daySpan);},ticks:{color:'#7a7060',maxRotation:0,callback:v=>fmtTick(v,daySpan)},grid:{color:'#2a2a2a'}},
          y:{ticks:{color:'#7a7060'},grid:{color:c=>c.tick.value===0?'#888':'#2a2a2a',lineWidth:c=>c.tick.value===0?2:1}}
        }
      }
    });
    memberChartInstances.push(c);
  });
}

// ── グラフ ──
function initGraphControls() {
  const mb = document.getElementById('graph-member-btns');

  // 全選択・全解除 トグルボタン（1つ）
  let allSelected = true;
  const toggleAllBtn = document.createElement('button');
  toggleAllBtn.className = 'ctrl-btn active';
  toggleAllBtn.textContent = '全解除';
  toggleAllBtn.onclick = () => {
    allSelected = !allSelected;
    if (allSelected) {
      DATA.members.forEach(m=>graphMembers.add(m.name));
      mb.querySelectorAll('.mem-toggle').forEach(b=>b.classList.add('active'));
      toggleAllBtn.textContent = '全解除';
      toggleAllBtn.classList.add('active');
    } else {
      graphMembers.clear();
      mb.querySelectorAll('.mem-toggle').forEach(b=>b.classList.remove('active'));
      toggleAllBtn.textContent = '全選択';
      toggleAllBtn.classList.remove('active');
    }
    renderChart(filteredGathers());
  };
  mb.appendChild(toggleAllBtn);

  const sep = document.createElement('div'); sep.className='ctrl-sep'; mb.appendChild(sep);

  DATA.members.forEach((m,i) => {
    graphMembers.add(m.name);
    const btn = document.createElement('button');
    btn.className = 'ctrl-btn mem-toggle active';
    btn.textContent = m.name;
    btn.style.cssText = `border-color:${COLORS[i%COLORS.length]};color:${COLORS[i%COLORS.length]}`;
    btn.onclick = () => {
      graphMembers.has(m.name) ? graphMembers.delete(m.name) : graphMembers.add(m.name);
      btn.classList.toggle('active');
      // 全員ONなら全解除ボタン、1人でもOFFなら全選択ボタンに
      allSelected = graphMembers.size === DATA.members.length;
      toggleAllBtn.textContent = allSelected ? '全解除' : '全選択';
      toggleAllBtn.classList.toggle('active', allSelected);
      renderChart(filteredGathers());
    };
    mb.appendChild(btn);
  });

  // 列ボタン
  const cb = document.getElementById('graph-col-btns');
  const GRAPH_COL_KEYS = ['総成績','4麻成績','3麻成績','総チップ','4麻チップ','3麻チップ'];
  GRAPH_COL_KEYS.forEach(key => {
    const btn = document.createElement('button');
    btn.className = 'ctrl-btn' + (key===graphCol?' active':'');
    btn.textContent = COL_LABELS[key];
    btn.onclick = () => {
      graphCol = key;
      cb.querySelectorAll('.ctrl-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      renderChart(filteredGathers());
    };
    cb.appendChild(btn);
  });
}

function renderChart(gathers) {
  if (!DATA) return;
  if (!gathers) gathers = filteredGathers();
  const ctx = document.getElementById('mainChart').getContext('2d');
  if (chartInstance) chartInstance.destroy();

  const datasets = DATA.members
    .filter(m=>graphMembers.has(m.name))
    .map((m,i) => {
      const ci = DATA.members.indexOf(m);
      const dp = calcDataPoints(m.name, gathers);
      const pts = (dp[graphCol]||[]).map(p=>({x: new Date(p.date).getTime(), y:p.value}));
      return { label:m.name, data:pts, borderColor:COLORS[ci%COLORS.length], backgroundColor:'transparent', pointBackgroundColor:COLORS[ci%COLORS.length], borderWidth:2, pointRadius:2, tension:0.3 };
    });

  const allDates = gathers.map(g=>new Date(g.date)).filter(d=>!isNaN(d)).sort((a,b)=>a-b);
  const daySpan = allDates.length >= 2
    ? (allDates[allDates.length-1] - allDates[0]) / (1000*60*60*24)
    : 365;
  chartInstance = new Chart(ctx, {
    type:'line', data:{datasets},
    options:{
      responsive:true, maintainAspectRatio:false, parsing:false,
      layout:{ padding:{ bottom:4 } },
      plugins:{
        legend:{
          position:'bottom', align:'start',
          labels:{
            color:'#e8e0d0', font:{family:'Noto Sans JP', size:11},
            boxWidth:20, boxHeight:2, padding:14,
          }
        },
        tooltip:{callbacks:{title:i=>fmtTooltipDate(i[0].parsed.x),label:c=>`${c.dataset.label}: ${c.parsed.y}`}}
      },
      scales:{
        x:{
          type:'linear',
          afterBuildTicks(ax){ if(allDates.length>=2) ax.ticks=_calendarTicks(allDates[0].getTime(),allDates[allDates.length-1].getTime(),daySpan); },
          ticks:{ color:'#7a7060', maxRotation:0, callback:v=>fmtTick(v,daySpan) },
          grid:{ color:'#2a2a2a' },
        },
        y:{ ticks:{color:'#7a7060'}, grid:{color:c=>c.tick.value===0?'#888':'#2a2a2a', lineWidth:c=>c.tick.value===0?2:1} }
      }
    }
  });
}

// ── 履歴（対局ごとにまとめて表示） ──
function buildHistory(gathers) {
  const rows = [];
  [...gathers].reverse().forEach(g => {
    const allMatches = g.matches.filter(m => m.scores.some(s=>s!==null&&s!==undefined));
    if (!allMatches.length) return;

    rows.push('<tr><td colspan="13" style="background:var(--surface2);color:var(--accent);font-size:12px;font-weight:700;padding:8px 14px;letter-spacing:.08em;border-bottom:1px solid var(--border);">'
      + g.date + '　' + g.members.filter(n=>n).join(' / ')
      + '</td></tr>');

    let hansoCount = 0;
    allMatches.forEach((m) => {
      const activeMems = g.members
        .map((name, idx) => ({name, score:m.scores[idx], rank:m.ranks[idx]}))
        .filter(x => x.score !== null && x.score !== undefined)
        .sort((a,b) => (b.score||0) - (a.score||0));

      const label = m.isChip
        ? 'チップ'
        : '第' + (++hansoCount) + '半荘';

      const rowStyle = m.isChip
        ? 'color:var(--dim);font-size:11px;padding-left:20px;font-style:italic'
        : 'color:var(--dim);font-size:11px;padding-left:20px';

      let row = '<tr><td class="hist-date" style="' + rowStyle + '">' + label + '</td>';
      activeMems.forEach(x => {
        row += '<td class="name-cell" style="font-size:12px;font-weight:700">' + x.name + '</td>';
        row += '<td class="' + sc(x.score) + '" style="font-weight:700">' + fmt(x.score) + '</td>';
        row += '<td style="color:var(--dim);font-size:11px">' + (m.isChip ? '—' : (x.rank??'-') + '着') + '</td>';
      });
      for (let i = activeMems.length; i < 4; i++) row += '<td></td><td></td><td></td>';
      rows.push(row + '</tr>');
    });
  });

  document.getElementById('hist-head').innerHTML =
    '<tr>'
    + '<th style="text-align:left;min-width:80px">半荘</th>'
    + '<th>名前</th><th>スコア</th><th>着順</th>'
    + '<th>名前</th><th>スコア</th><th>着順</th>'
    + '<th>名前</th><th>スコア</th><th>着順</th>'
    + '<th>名前</th><th>スコア</th><th>着順</th>'
    + '</tr>';

  document.getElementById('hist-body').innerHTML =
    rows.length ? rows.join('') : '<tr><td colspan="13" class="empty">この期間のデータなし</td></tr>';
}

