// -- AGENT PANEL - Bhandai Exchange --
// Extracted from agent.html inline script
(function() {
  'use strict';
  const Agent = window.Agent = {};
  const sb = window.supabaseClient;

let currentUser = null;
let myClients   = [];
let allTransactions = [];
let allOrders   = [];
let allEvents   = [];
let allOutcomes = [];
let allAnnouncements = [];
let allSettlementResults = [];
let allMyIds    = [];
let activeTab   = 'dashboard';
let clientStatusFilter = 'ALL';
let marketCatFilter    = 'ALL';

function setStatusFilter(btn, val) {
  document.querySelectorAll('[data-status-filter]').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active'); clientStatusFilter = val; renderClients();
}
function setCatFilter(btn, val) {
  document.querySelectorAll('[data-cat]').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active'); marketCatFilter = val; renderMarkets();
}

async function auditLog(action, {targetId=null,targetLoginId=null,amount=null,extra={}}={}) {
  try {
    await sb.from('audit_logs').insert({
      actor_id: currentUser.id, actor_login_id: currentUser.login_id,
      action, target_id: targetId, target_login_id: targetLoginId,
      details: extra, amount, user_agent: navigator.userAgent.substring(0,200)
    });
  } catch(e){}
}

// ── INIT ───────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const auth = await window.AuthSystem.requireRole('AGENT');
  if (!auth) return;
  currentUser = auth.profile;

  document.getElementById('sidebarId').textContent     = currentUser.login_id;
  document.getElementById('agentIdDisplay').textContent = currentUser.login_id;
  document.getElementById('dashDate').textContent = new Date().toLocaleDateString(undefined,{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  document.getElementById('authGate').style.display = 'none';

  window.AuthSystem.startSessionTimeout(30);
  window.AuthSystem.startStatusPolling(currentUser.id, 60);

  // Refresh data and re-poll every 30s (does NOT reset idle timer)
  await refreshData();
  window._dataRefreshInterval = setInterval(refreshData, 30000);
});

// ── DATA LOADING ───────────────────────────────────────────────────
async function refreshData() {
  document.getElementById('lastRefreshed').textContent = 'Updated ' + new Date().toLocaleTimeString();

  const [profileRes, clientsRes, evRes, ocRes, annRes] = await Promise.all([
    sb.from('betting_users').select('*').eq('id', currentUser.id).single(),
    sb.from('betting_users').select('*').eq('parent_id', currentUser.id).order('created_at',{ascending:false}),
    sb.from('events').select('*').order('created_at',{ascending:false}),
    sb.from('outcomes').select('*'),
    sb.from('platform_announcements').select('*').order('created_at',{ascending:false})
  ]);

  if (profileRes.data) {
    currentUser = {...currentUser, ...profileRes.data};
    document.getElementById('sidebarBalance').textContent = fmt(currentUser.balance);
  }
  myClients    = clientsRes.data || [];
  allEvents    = evRes.data || [];
  allOutcomes  = ocRes.data || [];
  allAnnouncements = annRes.data || [];
  allMyIds     = [currentUser.id, ...myClients.map(c=>c.id)];

  // Load transactions and orders in parallel (need allMyIds first)
  const loads = [
    sb.from('credit_transactions').select('*').in('sender_id', allMyIds).order('created_at',{ascending:false}).limit(500),
    sb.from('credit_transactions').select('*').in('receiver_id', allMyIds).order('created_at',{ascending:false}).limit(500),
  ];
  if (myClients.length > 0) {
    loads.push(sb.from('orders').select('*').in('user_id', myClients.map(c=>c.id)).order('created_at',{ascending:false}).limit(1000));
  }
  const results = await Promise.all(loads);
  const txMap = {};
  [...(results[0].data||[]), ...(results[1].data||[])].forEach(tx=>{ txMap[tx.id]=tx; });
  allTransactions = Object.values(txMap).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  allOrders = (myClients.length > 0 ? results[2].data : null) || [];

  // Load settlement_results for this agent
  const srRes = await sb.from('settlement_results').select('*').eq('agent_id', currentUser.id);
  allSettlementResults = srRes.data || [];

  renderActiveTab();
}

// ── TAB SWITCH ─────────────────────────────────────────────────────
function switchTab(id) {
  activeTab = id;
  document.querySelectorAll('.nav-item').forEach(el=>el.classList.toggle('active', el.dataset.tab===id));
  document.querySelectorAll('.tab-content').forEach(el=>el.classList.toggle('active', el.id==='tab-'+id));
  const titles = {dashboard:'Dashboard',clients:'My Clients',ledger:'Ledger',betlog:'Bet Log',pnl:'P&L Report',markets:'Live Markets',settlement:'Settlement',announcements:'Announcements',account:'My Account'};
  document.getElementById('topbarTitle').textContent = titles[id] || id;

  // Bottom nav: toggle active on bnav-items
  const moreTabs = ['ledger','betlog','settlement','announcements','account'];
  const isMoreTab = moreTabs.includes(id);
  document.querySelectorAll('.bnav-item').forEach(b => {
    if (b.id === 'bnav-more') {
      b.classList.toggle('active', isMoreTab);
    } else {
      b.classList.toggle('active', b.id === 'bnav-' + id);
    }
  });

  // Close more menu if open
  document.getElementById('moreMenu').classList.remove('open');
  document.getElementById('moreMenuOverlay').classList.remove('open');

  renderActiveTab();
}

function toggleMoreMenu() {
  document.getElementById('moreMenu').classList.toggle('open');
  document.getElementById('moreMenuOverlay').classList.toggle('open');
}
function renderActiveTab() {
  if (activeTab==='dashboard')     renderDashboard();
  else if (activeTab==='clients')  renderClients();
  else if (activeTab==='ledger')   renderLedger();
  else if (activeTab==='betlog')   renderBetLog();
  else if (activeTab==='pnl')      renderPnL();
  else if (activeTab==='markets')  renderMarkets();
  else if (activeTab==='settlement') renderSettlement();
  else if (activeTab==='announcements') renderAnnouncements();
  else if (activeTab==='account')  renderAccount();
}

// ── RENDER FUNCTIONS ───────────────────────────────────────────────
function renderDashboard() {
  const active = myClients.filter(c=>c.status!=='SUSPENDED');
  const suspended = myClients.filter(c=>c.status==='SUSPENDED');
  const deployed = myClients.reduce((s,c)=>s+parseFloat(c.balance||0),0);
  const liveBets = allOrders.length;
  const liveVol  = allOrders.reduce((s,o)=>s+parseFloat(o.total_cost||0),0);

  document.getElementById('dashMyBal').textContent      = fmt(currentUser.balance);
  document.getElementById('dashDeployed').textContent   = fmt(deployed,0);
  document.getElementById('dashClients').textContent    = myClients.length;
  document.getElementById('dashActiveClients').textContent = active.length;
  document.getElementById('dashSuspendedClients').textContent = suspended.length;
  document.getElementById('dashLiveBets').textContent   = liveBets;
  document.getElementById('dashLiveVol').textContent    = fmt(liveVol,0);

  // Open exposure = total potential payout (shares) from all open client orders
  const openOrds = allOrders.filter(o => o.status === 'OPEN');
  const openExposure = openOrds.reduce((s,o) => s + parseFloat(o.shares||0), 0);
  document.getElementById('dashOpenExposure').textContent = fmt(openExposure,0);

  // Settled P&L: stakes on settled orders minus what was paid out via SETTLEMENT transactions
  const clientIdSet = new Set(myClients.map(c => c.id));
  const clientPayouts = allTransactions
    .filter(t => t.transaction_type === 'SETTLEMENT' && clientIdSet.has(t.receiver_id))
    .reduce((s,t) => s + parseFloat(t.amount||0), 0);
  const clientStaked = allOrders
    .filter(o => o.status === 'SETTLED')
    .reduce((s,o) => s + parseFloat(o.total_cost||0), 0);
  const settledPnl = clientStaked - clientPayouts; // positive = house up
  const pnlValEl  = document.getElementById('dashSettledPnlVal');
  const pnlSpanEl = document.getElementById('dashSettledPnl');
  const pnlNoteEl = document.getElementById('dashSettledPnlNote');
  if (pnlValEl && pnlSpanEl) {
    pnlValEl.style.color = settledPnl >= 0 ? '#10b981' : '#ef4444';
    pnlSpanEl.textContent = `${settledPnl >= 0 ? '+' : ''}${fmt(settledPnl,0)}`;
  }
  if (pnlNoteEl) pnlNoteEl.textContent = settledPnl >= 0 ? 'House up (clients lost net)' : 'House down (clients won net)';

  const tbody = document.getElementById('dashClientsTable');
  if (myClients.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4"><div class="empty"><div class="empty-icon">👥</div><div class="empty-text">No clients yet. Create your first client.</div></div></td></tr>';
  } else {
    tbody.innerHTML = myClients.slice(0,8).map(c => {
      const bal = parseFloat(c.balance||0);
      const clientOrders = allOrders.filter(o=>o.user_id===c.id);
      const badge = c.status==='SUSPENDED'
        ? `<span class="badge badge-suspended"><span class="status-dot"></span> Suspended</span>`
        : `<span class="badge badge-active"><span class="status-dot"></span> Active</span>`;
      return `<tr>
        <td><div class="mono text-white" style="font-size:0.88rem;">${sanitize(c.login_id)}</div><div class="text-muted" style="font-size:0.72rem;">${sanitize(c.name||'—')}</div></td>
        <td class="mono" style="color:${bal>0?'#10b981':'#94a3b8'};">🪙 ${fmt(bal)}</td>
        <td>${badge}<br>${timeAgo(c.last_seen_at)}</td>
        <td class="mono text-muted">${clientOrders.length}</td>
      </tr>`;
    }).join('');
  }

  const feed = document.getElementById('dashActivity');
  const recent = allTransactions.slice(0,8);
  if (recent.length===0) {
    feed.innerHTML='<div class="empty" style="padding:20px;"><div class="empty-icon">📡</div><div class="empty-text">No activity yet</div></div>';
  } else {
    feed.innerHTML = recent.map(tx=>{
      const sender   = [...myClients, currentUser].find(u=>u.id===tx.sender_id);
      const receiver = [...myClients, currentUser].find(u=>u.id===tx.receiver_id);
      const isDeposit = ['DEPOSIT','SETTLEMENT','VOID_REFUND','COMMISSION'].includes(tx.transaction_type);
      const isCommission = tx.transaction_type === 'COMMISSION';
      const col = isCommission ? '#a78bfa' : (isDeposit ? '#10b981' : '#ef4444');
      const dotCls = isDeposit ? 'green' : 'red';
      return `<div class="feed-item">
        <div class="feed-dot ${dotCls}"></div>
        <div class="feed-content">
          <div class="feed-text"><strong>${tx.transaction_type}</strong> · ${sender?.login_id||'—'} → ${receiver?.login_id||'—'}</div>
          <div class="feed-time">${new Date(tx.created_at).toLocaleString()}</div>
        </div>
        <div class="feed-amount" style="color:${col};">🪙${fmt(tx.amount,0)}</div>
      </div>`;
    }).join('');
  }
}

function clientBadge(c) {
  return c.status==='SUSPENDED'
    ? `<span class="badge badge-suspended"><span class="status-dot"></span> Suspended</span>`
    : `<span class="badge badge-active"><span class="status-dot"></span> Active</span>`;
}

function renderClients() {
  const q = (document.getElementById('clientSearch')?.value||'').toLowerCase();
  let clients = [...myClients];
  if (clientStatusFilter !== 'ALL') clients = clients.filter(c=>c.status===clientStatusFilter);
  if (q) clients = clients.filter(c=>(c.login_id+' '+(c.name||'')+' '+(c.phone||'')).toLowerCase().includes(q));

  const tbody = document.getElementById('clientsTableBody');
  if (clients.length===0) {
    tbody.innerHTML='<tr><td colspan="6"><div class="empty"><div class="empty-icon">🔍</div><div class="empty-text">No clients found</div></div></td></tr>';
    return;
  }
  const isMobile = window.innerWidth <= 768;
  tbody.innerHTML = clients.map(c => {
    const bal = parseFloat(c.balance||0);
    const mC = c.match_commission ?? 0;
    const fC = c.fancy_commission ?? 0;
    const hasPw = !!c.initial_password;
    if (isMobile) {
      return `<tr><td colspan="6" style="padding:4px 0;border:none;"><div class="client-mobile-card">
        <div class="cmc-header">
          <div>
            <div class="cmc-name">${sanitize(c.name||'—')}${c.notes?` <span title="${sanitize(c.notes)}" style="cursor:help;font-size:0.72rem;">📝</span>`:''}</div>
            <div class="cmc-id">${sanitize(c.login_id)}</div>
          </div>
          <div>${clientBadge(c)}</div>
        </div>
        <div class="cmc-row"><span class="cmc-label">Balance</span><span class="cmc-val" style="color:${bal>0?'#10b981':'#94a3b8'};">🪙 ${fmt(bal)}</span></div>
        <div class="cmc-row"><span class="cmc-label">Match Comm</span><span class="cmc-val">${mC}%</span></div>
        <div class="cmc-row"><span class="cmc-label">Fancy Comm</span><span class="cmc-val">${fC}%</span></div>
        <div class="cmc-row"><span class="cmc-label">Last Seen</span><span class="cmc-val" style="font-size:0.75rem;color:#94a3b8;">${timeAgo(c.last_seen_at)}</span></div>
        <div class="cmc-actions">
          <button class="btn btn-ghost btn-sm" onclick="openEditClientModal('${c.id}')">Edit</button>
          <button class="btn btn-success btn-sm" onclick="openFundsModal('${c.id}','DEPOSIT')">+ Coins</button>
          <button class="btn btn-danger btn-sm" onclick="openFundsModal('${c.id}','WITHDRAWAL')">- Coins</button>
          <button class="btn btn-ghost btn-sm" onclick="openClientHistory('${c.id}')">History</button>
        </div>
      </div></td></tr>`;
    }
    return `<tr>
      <td>
        <div class="mono text-white" style="font-size:0.88rem;">${sanitize(c.login_id)}${c.notes?` <span title="${sanitize(c.notes)}" style="cursor:help;font-size:0.72rem;">📝</span>`:''}</div>
        <div class="text-muted" style="font-size:0.72rem;">${sanitize(c.name||'—')} · ${sanitize(c.phone||'—')}</div>
      </td>
      <td class="mono" style="color:${bal>0?'#10b981':'#94a3b8'};">🪙 ${fmt(bal)}</td>
      <td>${clientBadge(c)}<div style="margin-top:3px;">${timeAgo(c.last_seen_at)}</div></td>
      <td style="font-size:0.78rem;"><span style="color:#e2e8f0;">M: ${mC}%</span><br><span style="color:#e2e8f0;">F: ${fC}%</span></td>
      <td>
        ${hasPw?`<div class="mono" style="font-size:0.72rem;color:#94a3b8;">${sanitize(c.login_id)}</div>
          <div class="pw-row" style="font-size:0.72rem;">
            <span class="mono" style="color:#f59e0b;" id="pw_${c.id}" data-visible="0">●●●●●●</span>
            <button onclick="togglePwVis('${c.id}','${c.initial_password}')" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:0.75rem;padding:0 2px;">👁</button>
          </div>`:'<span style="color:#475569;font-size:0.72rem;">—</span>'}
      </td>
      <td style="text-align:right;">
        <div class="btn-group" style="justify-content:flex-end;flex-wrap:wrap;gap:4px;">
          <button class="btn btn-ghost btn-sm" onclick="openClientHistory('${c.id}')">👁</button>
          <button class="btn btn-ghost btn-sm" onclick="openEditClientModal('${c.id}')">Edit</button>
          <button class="btn btn-ghost btn-sm" onclick="resetClientPassword('${c.id}','${c.login_id}')">🔑</button>
          <button class="btn btn-success btn-sm" onclick="openFundsModal('${c.id}','DEPOSIT')">+ Coins</button>
          <button class="btn btn-danger btn-sm" onclick="openFundsModal('${c.id}','WITHDRAWAL')">- Coins</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function togglePwVis(id, pw) {
  const el = document.getElementById('pw_'+id);
  if (!el) return;
  const vis = el.dataset.visible==='1';
  el.dataset.visible = vis?'0':'1';
  el.textContent = vis ? '●●●●●●' : pw;
}

function renderLedger() {
  const q = (document.getElementById('ledgerSearch')?.value||'').toLowerCase();

  // Stats
  const deployed = myClients.reduce((s,c)=>s+parseFloat(c.balance||0),0);
  const clientIds = new Set(myClients.map(c=>c.id));
  const issued = allTransactions
    .filter(t=>t.transaction_type==='DEPOSIT' && clientIds.has(t.receiver_id) && t.sender_id===currentUser.id)
    .reduce((s,t)=>s+parseFloat(t.amount||0),0);
  const collected = allTransactions
    .filter(t=>t.transaction_type==='WITHDRAWAL' && clientIds.has(t.sender_id) && t.receiver_id===currentUser.id)
    .reduce((s,t)=>s+parseFloat(t.amount||0),0);

  document.getElementById('ledgerDeployed').textContent  = fmt(deployed);
  document.getElementById('ledgerIssued').textContent    = fmt(issued);
  document.getElementById('ledgerCollected').textContent = fmt(collected);

  // Balance register
  let clients = [...myClients];
  if (q) clients = clients.filter(c=>(c.login_id+' '+(c.name||'')).toLowerCase().includes(q));
  const regBody = document.getElementById('ledgerTableBody');
  if (clients.length===0) {
    regBody.innerHTML='<tr><td colspan="6"><div class="empty" style="padding:20px;"><div class="empty-icon">💰</div><div class="empty-text">No clients</div></div></td></tr>';
  } else {
    regBody.innerHTML = clients.map(c=>{
      const bal = parseFloat(c.balance||0);
      const cl  = Math.max(parseFloat(c.credit_limit||1),1);
      const util = Math.min(100,(bal/cl)*100);
      const cls = util>90?'util-crit':util>70?'util-warn':'util-ok';
      const cIssued = allTransactions.filter(t=>t.transaction_type==='DEPOSIT'&&t.receiver_id===c.id&&t.sender_id===currentUser.id).reduce((s,t)=>s+parseFloat(t.amount||0),0);
      const cCollect = allTransactions.filter(t=>t.transaction_type==='WITHDRAWAL'&&t.sender_id===c.id&&t.receiver_id===currentUser.id).reduce((s,t)=>s+parseFloat(t.amount||0),0);
      return `<tr>
        <td><div class="mono text-white">${sanitize(c.login_id)}</div><div class="text-muted" style="font-size:0.72rem;">${sanitize(c.name||'')}</div></td>
        <td class="mono" style="color:${bal>0?'white':'#94a3b8'};">🪙 ${fmt(bal)}</td>
        <td class="mono text-muted">🪙 ${fmt(cIssued)}</td>
        <td class="mono text-muted">🪙 ${fmt(cCollect)}</td>
        <td><div style="font-size:0.76rem;color:#94a3b8;">${util.toFixed(1)}%</div><div class="util-bar"><div class="util-fill ${cls}" style="width:${util}%;"></div></div></td>
        <td style="text-align:right;">
          <div class="btn-group" style="justify-content:flex-end;">
            <button class="btn btn-success btn-sm" onclick="openFundsModal('${c.id}','DEPOSIT')">Deposit</button>
            <button class="btn btn-danger btn-sm" onclick="openFundsModal('${c.id}','WITHDRAWAL')">Withdraw</button>
          </div>
        </td>
      </tr>`;
    }).join('');
  }

  // Transaction log
  const txFrom  = document.getElementById('txFrom')?.value;
  const txTo    = document.getElementById('txTo')?.value;
  const txType  = document.getElementById('txTypeFilter')?.value;
  const txUser  = (document.getElementById('txUserSearch')?.value||'').toLowerCase();
  let txList = [...allTransactions];
  if (txFrom) txList = txList.filter(t=>new Date(t.created_at)>=new Date(txFrom));
  if (txTo)   txList = txList.filter(t=>new Date(t.created_at)<=new Date(txTo+'T23:59:59'));
  if (txType) txList = txList.filter(t=>t.transaction_type===txType);
  if (txUser) txList = txList.filter(t=>{
    const s=[...myClients,currentUser].find(u=>u.id===t.sender_id);
    const r=[...myClients,currentUser].find(u=>u.id===t.receiver_id);
    return (s?.login_id||'').toLowerCase().includes(txUser)||(r?.login_id||'').toLowerCase().includes(txUser);
  });
  const txBody = document.getElementById('txLogBody');
  if (txList.length===0) {
    txBody.innerHTML='<tr><td colspan="6" style="text-align:center;color:#475569;padding:20px;">No transactions match filters</td></tr>';
  } else {
    txBody.innerHTML = txList.slice(0,200).map(tx=>{
      const sender  =[...myClients,currentUser].find(u=>u.id===tx.sender_id);
      const receiver=[...myClients,currentUser].find(u=>u.id===tx.receiver_id);
      const isCredit=['DEPOSIT','SETTLEMENT','VOID_REFUND','COMMISSION'].includes(tx.transaction_type);
      const txCol = tx.transaction_type === 'COMMISSION' ? '#a78bfa' : (isCredit ? '#10b981' : '#ef4444');
      const amtCol = isCredit ? '#10b981' : '#ef4444';
      return `<tr>
        <td class="text-muted" style="font-size:0.78rem;white-space:nowrap;">${new Date(tx.created_at).toLocaleString()}</td>
        <td><span style="background:${txCol}20;color:${txCol};padding:2px 7px;border-radius:4px;font-size:0.7rem;font-weight:700;">${tx.transaction_type}</span></td>
        <td class="mono" style="font-size:0.8rem;">${sender?.login_id||'Admin/System'}</td>
        <td class="mono" style="font-size:0.8rem;">${receiver?.login_id||'Admin/System'}</td>
        <td class="text-muted" style="font-size:0.78rem;">${tx.notes||'—'}</td>
        <td class="mono" style="text-align:right;color:${amtCol};font-weight:700;">🪙 ${fmt(tx.amount)}</td>
      </tr>`;
    }).join('');
  }
}

function downloadLedgerCSV() {
  const rows = [['Date','Type','From','To','Note','Amount']];
  allTransactions.forEach(tx=>{
    const s=[...myClients,currentUser].find(u=>u.id===tx.sender_id);
    const r=[...myClients,currentUser].find(u=>u.id===tx.receiver_id);
    rows.push([new Date(tx.created_at).toLocaleString(),tx.transaction_type,s?.login_id||'—',r?.login_id||'—',tx.notes||'',tx.amount]);
  });
  const csv = rows.map(r=>r.join(',')).join('\n');
  const a = document.createElement('a'); a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);
  a.download=`ledger_${currentUser.login_id}_${new Date().toISOString().slice(0,10)}.csv`; a.click();
}

function renderBetLog() {
  const today = new Date(); today.setHours(0,0,0,0);
  const todayOrders = allOrders.filter(o=>new Date(o.created_at)>=today);
  const totalVol = allOrders.reduce((s,o)=>s+parseFloat(o.total_cost||0),0);
  const avgBet = allOrders.length ? totalVol/allOrders.length : 0;
  document.getElementById('betToday').textContent  = todayOrders.length;
  document.getElementById('betVolume').textContent = fmt(totalVol);
  document.getElementById('betAvg').textContent    = fmt(avgBet);

  // Populate dropdowns once
  const clientSel = document.getElementById('betClientFilter');
  if (clientSel && clientSel.options.length <= 1) {
    myClients.forEach(c=>{ const o=document.createElement('option'); o.value=c.id; o.textContent=c.login_id+' · '+(c.name||''); clientSel.appendChild(o); });
  }
  const evSel = document.getElementById('betEventFilter');
  if (evSel && evSel.options.length <= 1) {
    allEvents.forEach(ev=>{ const o=document.createElement('option'); o.value=ev.id; o.textContent=ev.title.substring(0,45); evSel.appendChild(o); });
  }

  const dateFrom  = document.getElementById('betFrom')?.value;
  const dateTo    = document.getElementById('betTo')?.value;
  const evFilter  = document.getElementById('betEventFilter')?.value;
  const cliFilter = document.getElementById('betClientFilter')?.value;
  let orders = [...allOrders];
  if (dateFrom) orders=orders.filter(o=>new Date(o.created_at)>=new Date(dateFrom));
  if (dateTo)   orders=orders.filter(o=>new Date(o.created_at)<=new Date(dateTo+'T23:59:59'));
  if (cliFilter) orders=orders.filter(o=>o.user_id===cliFilter);
  if (evFilter) { const ocIds=allOutcomes.filter(oc=>oc.event_id===evFilter).map(oc=>oc.id); orders=orders.filter(o=>ocIds.includes(o.outcome_id)); }

  const tbody = document.getElementById('betlogTableBody');
  if (orders.length===0) {
    tbody.innerHTML='<tr><td colspan="7" style="text-align:center;color:#475569;padding:24px;">No bets match filters</td></tr>';
    return;
  }
  tbody.innerHTML = orders.slice(0,200).map(o=>{
    const client  = myClients.find(c=>c.id===o.user_id);
    const outcome = allOutcomes.find(oc=>oc.id===o.outcome_id);
    const event   = outcome ? allEvents.find(ev=>ev.id===outcome.event_id) : null;
    const typeCol = o.order_type==='BUY'?'#3b82f6':'#ec4899';
    return `<tr>
      <td class="text-muted" style="font-size:0.78rem;white-space:nowrap;">${new Date(o.created_at).toLocaleString()}</td>
      <td class="mono" style="font-size:0.82rem;">${sanitize(client?.login_id||'—')}</td>
      <td><div style="font-size:0.8rem;color:white;">${event?.title||'—'}</div><div style="font-size:0.7rem;color:#64748b;">${outcome?.title||'—'}</div></td>
      <td><span style="background:${typeCol}20;color:${typeCol};padding:2px 8px;border-radius:4px;font-size:0.7rem;font-weight:700;">${o.order_type}</span></td>
      <td class="mono">${parseFloat(o.shares||0).toLocaleString()}</td>
      <td class="mono">${parseFloat(o.price_per_share||0)}¢</td>
      <td class="mono" style="text-align:right;color:#e2e8f0;">🪙 ${fmt(o.total_cost)}</td>
    </tr>`;
  }).join('');
}

function renderPnL() {
  // ── Live Exposure (D-08, D-09, D-10) ──
  const openEvents = allEvents.filter(e => e.status === 'OPEN' || e.status === 'SUSPENDED');
  const openEventIds = new Set(openEvents.map(e => e.id));
  const openOutcomeIds = new Set(allOutcomes.filter(o => openEventIds.has(o.event_id)).map(o => o.id));
  const openOrds = allOrders.filter(o => o.status === 'OPEN' && openOutcomeIds.has(o.outcome_id));

  // Total client exposure on open markets = sum of shares (potential payout)
  const liveExposure = openOrds.reduce((s, o) => s + parseFloat(o.shares || 0), 0);
  const pShare = parseFloat(currentUser.partnership_share || 0);
  const agentLiveExposure = liveExposure * pShare / 100;

  // Count distinct open markets with client orders
  const openMarketsWithBets = new Set(allOutcomes.filter(o => openOutcomeIds.has(o.id) && openOrds.some(ord => ord.outcome_id === o.id)).map(o => o.event_id)).size;

  document.getElementById('pnlLiveExposure').textContent = fmt(liveExposure, 0);
  document.getElementById('pnlLiveAgentExposure').textContent = fmt(agentLiveExposure, 0);
  document.getElementById('pnlLiveSharePct').textContent = pShare;
  document.getElementById('pnlLiveMarkets').textContent = openMarketsWithBets;

  // Hide live section if no open markets with bets
  document.getElementById('pnlLiveSection').style.display = openMarketsWithBets > 0 ? '' : 'none';

  // Summary stats from actual settlement_results (not estimates)
  const totalClientPnl = allSettlementResults.reduce((s,r) => s + parseFloat(r.total_client_pnl || 0), 0);
  const totalCommGiven = allSettlementResults.reduce((s,r) => s + parseFloat(r.agent_commission_share || 0), 0);
  const agentPnlShare  = allSettlementResults.reduce((s,r) => s + parseFloat(r.agent_pnl_share || 0), 0);
  const netPosition    = allSettlementResults.reduce((s,r) => s + parseFloat(r.agent_net_pnl || 0), 0);

  document.getElementById('pnlVolume').textContent      = fmt(totalClientPnl);
  document.getElementById('pnlComm').textContent        = fmt(totalCommGiven);
  document.getElementById('pnlNetReceived').textContent  = fmt(agentPnlShare);
  document.getElementById('pnlPosition').textContent     = fmt(netPosition);

  // Color-code Net Position: green if positive, red if negative
  const posEl = document.getElementById('pnlPosition');
  posEl.style.color = netPosition >= 0 ? '#10b981' : '#ef4444';

  // Per-client table (APNL-09: aggregated settled P&L per client)
  const tbody = document.getElementById('pnlClientTable');
  if (myClients.length===0) {
    tbody.innerHTML='<tr><td colspan="6"><div class="empty"><div class="empty-icon">👥</div><div class="empty-text">No clients yet</div></div></td></tr>';
  } else {
    const pShare = parseFloat(currentUser.partnership_share||0)/100;
    // Build set of settled event IDs from settlement_results
    const settledEventIds = new Set(allSettlementResults.map(sr=>sr.event_id));
    tbody.innerHTML = myClients.map(c=>{
      const cOrders = allOrders.filter(o=>o.user_id===c.id);
      const cVol  = cOrders.reduce((s,o)=>s+parseFloat(o.total_cost||0),0);
      // Settled P&L: compute from settled orders per event
      let settledPnl = 0;
      settledEventIds.forEach(evId => {
        const ev = allEvents.find(e=>e.id===evId);
        if (!ev) return;
        const ocs = allOutcomes.filter(o=>o.event_id===evId);
        const ocIds = ocs.map(o=>o.id);
        const clientEvOrders = cOrders.filter(o=>ocIds.includes(o.outcome_id));
        clientEvOrders.forEach(o => {
          const won = (ev.winning_outcome && allOutcomes.find(oc=>oc.id===o.outcome_id)?.title === ev.winning_outcome);
          settledPnl += won ? (parseFloat(o.shares||0) - parseFloat(o.total_cost||0)) : -parseFloat(o.total_cost||0);
        });
      });
      // Commission received by this client
      const commRecv = allTransactions
        .filter(t=>t.transaction_type==='COMMISSION'&&t.receiver_id===c.id)
        .reduce((s,t)=>s+parseFloat(t.amount||0),0);
      // Agent net per client: agent earns opposite of client P&L (scaled by partnership) minus commission share
      const agentNetClient = (settledPnl * -1 * pShare) - (commRecv * pShare);
      // Color: settled P&L green if client lost (agent earns), red if client won (agent pays)
      const pnlColor = settledPnl <= 0 ? '#10b981' : '#ef4444';
      const agentNetColor = agentNetClient >= 0 ? '#10b981' : '#ef4444';
      return `<tr>
        <td><div class="mono text-white">${sanitize(c.login_id)}</div><div class="text-muted" style="font-size:0.72rem;">${sanitize(c.name||'')}</div></td>
        <td class="mono text-muted">${cOrders.length}</td>
        <td class="mono text-muted">${fmt(cVol)}</td>
        <td class="mono" style="color:${pnlColor};">${fmt(settledPnl)}</td>
        <td class="mono" style="color:#a78bfa;">${fmt(commRecv)}</td>
        <td class="mono" style="color:${agentNetColor};">${fmt(agentNetClient)}</td>
      </tr>`;
    }).join('');
  }

  // Per-market detail table (APNL-08: from settlement_results)
  const mBody = document.getElementById('pnlMarketsTable');
  if (allSettlementResults.length===0) {
    mBody.innerHTML='<tr><td colspan="7"><div class="empty"><div class="empty-icon">🏏</div><div class="empty-text">No settled markets yet</div></div></td></tr>';
  } else {
    mBody.innerHTML = allSettlementResults.map((sr, idx) => {
      const ev = allEvents.find(e=>e.id===sr.event_id);
      const evTitle = ev ? sanitize(ev.title) : 'Unknown Market';
      const winner = ev?.winning_outcome || (ev?.status==='VOID'?'VOID':'--');
      const resultBadge = (ev?.status==='VOID')
        ? '<span class="badge badge-void">VOID</span>'
        : `<span class="badge badge-settled">${sanitize(winner)}</span>`;
      const clientPnl = parseFloat(sr.total_client_pnl||0);
      const commShare = parseFloat(sr.agent_commission_share||0);
      const agentNet  = parseFloat(sr.agent_net_pnl||0);
      const shareP    = parseFloat(sr.partnership_share_at_settlement||0);
      const clientPnlColor = clientPnl >= 0 ? '#10b981' : '#ef4444';
      const agentNetColor  = agentNet >= 0 ? '#10b981' : '#ef4444';

      // Build per-client breakdown for this market
      const ocs = ev ? allOutcomes.filter(o=>o.event_id===ev.id) : [];
      const ocIds = ocs.map(o=>o.id);
      const evOrders = allOrders.filter(o=>ocIds.includes(o.outcome_id));
      // Group by user
      const byUser = {};
      evOrders.forEach(o => {
        if (!byUser[o.user_id]) byUser[o.user_id] = [];
        byUser[o.user_id].push(o);
      });
      let detailRows = '';
      Object.keys(byUser).forEach(uid => {
        const client = myClients.find(c=>c.id===uid);
        if (!client) return;
        const uOrders = byUser[uid];
        const totalStaked = uOrders.reduce((s,o)=>s+parseFloat(o.total_cost||0),0);
        const totalShares = uOrders.reduce((s,o)=>s+parseFloat(o.shares||0),0);
        let uPnl = 0;
        uOrders.forEach(o => {
          const won = (ev?.winning_outcome && allOutcomes.find(oc=>oc.id===o.outcome_id)?.title === ev.winning_outcome);
          uPnl += won ? (parseFloat(o.shares||0) - parseFloat(o.total_cost||0)) : -parseFloat(o.total_cost||0);
        });
        const uPnlColor = uPnl >= 0 ? '#10b981' : '#ef4444';
        // Commission for this client on this market (filter by notes containing event title)
        const cComm = allTransactions
          .filter(t=>t.transaction_type==='COMMISSION'&&t.receiver_id===uid&&t.notes&&ev&&t.notes.includes(ev.title))
          .reduce((s,t)=>s+parseFloat(t.amount||0),0);
        detailRows += `<tr>
          <td class="mono">${sanitize(client.login_id)}</td>
          <td class="mono">${fmt(totalStaked)}</td>
          <td class="mono">${fmt(totalShares,0)}</td>
          <td class="mono" style="color:${uPnlColor};">${fmt(uPnl)}</td>
          <td class="mono" style="color:#a78bfa;">${cComm > 0 ? fmt(cComm) : '--'}</td>
        </tr>`;
      });
      if (!detailRows) detailRows = '<tr><td colspan="5" class="text-muted" style="text-align:center;padding:8px;">No client orders for this market</td></tr>';

      return `<tr>
        <td style="width:28px;text-align:center;"><span class="pnl-toggle" onclick="toggleMarketDetail(this)">&#9654;</span></td>
        <td class="text-white">${evTitle}</td>
        <td>${resultBadge}</td>
        <td class="mono" style="color:${clientPnlColor};">${fmt(clientPnl)}</td>
        <td class="mono" style="color:#a78bfa;">${fmt(commShare)}</td>
        <td class="mono" style="color:${agentNetColor};">${fmt(agentNet)}</td>
        <td class="mono text-muted">${fmt(shareP,0)}%</td>
      </tr>
      <tr class="pnl-detail-row" style="display:none;">
        <td colspan="7">
          <div class="detail-inner">
            <table>
              <thead><tr><th>Client</th><th>Staked</th><th>Shares</th><th>P&amp;L</th><th>Commission</th></tr></thead>
              <tbody>${detailRows}</tbody>
            </table>
          </div>
        </td>
      </tr>`;
    }).join('');
  }
}

// Toggle expand/collapse for per-market detail rows
function toggleMarketDetail(el) {
  el.classList.toggle('open');
  const detailRow = el.closest('tr').nextElementSibling;
  if (detailRow && detailRow.classList.contains('pnl-detail-row')) {
    detailRow.style.display = detailRow.style.display === 'none' ? 'table-row' : 'none';
  }
}

function renderMarkets() {
  const q = (document.getElementById('marketSearch')?.value||'').toLowerCase();
  let events = [...allEvents];
  if (marketCatFilter!=='ALL') events=events.filter(e=>e.category===marketCatFilter);
  if (q) events=events.filter(e=>e.title.toLowerCase().includes(q));

  const tbody = document.getElementById('marketsTableBody');
  if (events.length===0) {
    tbody.innerHTML='<tr><td colspan="6"><div class="empty"><div class="empty-icon">🏏</div><div class="empty-text">No markets found</div></div></td></tr>';
    return;
  }
  const clientIds = new Set(myClients.map(c=>c.id));
  tbody.innerHTML = events.map(ev=>{
    const ocs = allOutcomes.filter(o=>o.event_id===ev.id);
    const evOcIds = new Set(ocs.map(o=>o.id));
    const myVol = allOrders.filter(o=>evOcIds.has(o.outcome_id)).reduce((s,o)=>s+parseFloat(o.total_cost||0),0);
    const res = ev.resolution_date ? new Date(ev.resolution_date).toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
    const badge = ev.status==='SUSPENDED'?`<span class="badge badge-paused">⏸ Paused</span>`:ev.status==='SETTLED'?`<span class="badge badge-settled">✅ Settled</span>`:ev.status==='VOID'?`<span class="badge badge-void">🚫 Void</span>`:`<span class="badge badge-live"><span class="status-dot"></span> Live</span>`;
    const priceChips = ocs.map(o=>`<span style="background:#0f172a;border:1px solid #334155;padding:2px 7px;border-radius:4px;font-size:0.7rem;margin-right:3px;">${sanitize(o.title)} <span style="color:#3b82f6;">${o.current_price}¢</span></span>`).join('');
    return `<tr>
      <td><div class="text-white">${sanitize(ev.title)}</div>${ev.sub_category?`<div class="text-muted" style="font-size:0.72rem;">${sanitize(ev.sub_category)}</div>`:''}</td>
      <td class="text-muted">${sanitize(ev.category)}</td>
      <td>${priceChips}</td>
      <td>${badge}</td>
      <td class="text-muted" style="font-size:0.78rem;">${res}</td>
      <td class="mono" style="text-align:right;color:${myVol>0?'#a78bfa':'#475569'};">🪙 ${fmt(myVol,0)}</td>
    </tr>`;
  }).join('');
}

function renderSettlement() {
  const clientIds = new Set(myClients.map(c=>c.id));

  // Agent ↔ admin directly
  const received = allTransactions
    .filter(t=>t.receiver_id===currentUser.id && !clientIds.has(t.sender_id) && t.transaction_type==='DEPOSIT')
    .reduce((s,t)=>s+parseFloat(t.amount||0),0);
  const returned = allTransactions
    .filter(t=>t.sender_id===currentUser.id && !clientIds.has(t.receiver_id) && t.transaction_type==='WITHDRAWAL')
    .reduce((s,t)=>s+parseFloat(t.amount||0),0);
  // Formal cash settlements with admin (no chip movement — admin collected cash from agent)
  const agentSettled = allTransactions
    .filter(t=>t.sender_id===currentUser.id && t.transaction_type==='AGENT_SETTLEMENT')
    .reduce((s,t)=>s+parseFloat(t.amount||0),0);

  // Admin → my clients directly (bypassing agent wallet)
  // sender is not me and not one of my clients → must be admin or external
  const directToClients = allTransactions
    .filter(t=>t.transaction_type==='DEPOSIT' && clientIds.has(t.receiver_id) && t.sender_id!==currentUser.id && !clientIds.has(t.sender_id))
    .reduce((s,t)=>s+parseFloat(t.amount||0),0);
  // My clients → admin directly (client settled with admin, bypassing agent)
  const directFromClients = allTransactions
    .filter(t=>t.transaction_type==='WITHDRAWAL' && clientIds.has(t.sender_id) && t.receiver_id!==currentUser.id && !clientIds.has(t.receiver_id))
    .reduce((s,t)=>s+parseFloat(t.amount||0),0);
  // My clients → me (agent cash settlement — chips burned, not a transfer)
  const agentCashSettled = allTransactions
    .filter(t=>t.transaction_type==='WITHDRAWAL' && clientIds.has(t.sender_id) && t.receiver_id===currentUser.id)
    .reduce((s,t)=>s+parseFloat(t.amount||0),0);

  const bookVal = parseFloat(currentUser.balance||0) + myClients.reduce((s,c)=>s+parseFloat(c.balance||0),0);
  // Net in circulation = everything put in − everything collected/burned
  const netCirc = (received + directToClients) - (returned + directFromClients) - agentCashSettled;
  // Drift = actual book vs expected — now pure bet outcome, not polluted by direct transactions
  const drift = bookVal - netCirc;
  // Outstanding = chips admin put in − everything settled (chip returns + cash settlements + direct admin actions)
  const outstanding = (received + directToClients) - (returned + directFromClients) - agentCashSettled - agentSettled;

  document.getElementById('settleReceived').textContent = fmt(received);
  document.getElementById('settleReturned').textContent = fmt(returned);
  document.getElementById('settleStatCashSettled').textContent = fmt(agentSettled);
  document.getElementById('settleBook').textContent     = fmt(bookVal);
  const outStatEl = document.getElementById('settleOutstandingStat');
  const outStatNote = document.getElementById('settleOutstandingStatNote');
  outStatEl.textContent = fmt(Math.abs(outstanding));
  outStatEl.style.color = outstanding > 0.01 ? '#ef4444' : outstanding < -0.01 ? '#10b981' : '#64748b';
  outStatNote.textContent = outstanding > 0.01 ? 'You owe admin' : outstanding < -0.01 ? 'Admin owes you' : 'Fully settled';
  document.getElementById('settleNetReceived').textContent = fmt(received);
  document.getElementById('settleReturnedNet').textContent = fmt(returned);
  const csRow = document.getElementById('settleCashSettledRow');
  csRow.style.display = agentCashSettled > 0.01 ? 'flex' : 'none';
  document.getElementById('settleCashSettled').textContent = `−🪙 ${fmt(agentCashSettled)}`;
  document.getElementById('settleNetCirc').textContent  = fmt(netCirc);
  document.getElementById('settleBookVal').textContent  = fmt(bookVal);
  document.getElementById('settleAgentSettled').textContent = `🪙 ${fmt(agentSettled)}`;
  const outstandingEl = document.getElementById('settleOutstanding');
  outstandingEl.textContent = `🪙 ${fmt(Math.abs(outstanding))}`;
  outstandingEl.style.color = outstanding > 0.01 ? '#ef4444' : outstanding < -0.01 ? '#10b981' : '#64748b';
  outstandingEl.title = outstanding > 0.01 ? 'You owe admin' : outstanding < -0.01 ? 'Admin owes you' : 'Settled';

  // Direct section — only show when non-zero
  const hasDirectActivity = directToClients > 0.01 || directFromClients > 0.01;
  document.getElementById('settleDirectSection').style.display = hasDirectActivity ? 'block' : 'none';
  if (hasDirectActivity) {
    const toRow   = document.getElementById('settleDirectToRow');
    const fromRow = document.getElementById('settleDirectFromRow');
    toRow.style.display   = directToClients > 0.01   ? 'flex' : 'none';
    fromRow.style.display = directFromClients > 0.01 ? 'flex' : 'none';
    document.getElementById('settleDirectTo').textContent   = `+🪙 ${fmt(directToClients)}`;
    document.getElementById('settleDirectFrom').textContent = `−🪙 ${fmt(directFromClients)}`;
  }

  const driftEl = document.getElementById('settleDrift');
  const noteEl  = document.getElementById('settleNote');
  const labelEl = document.getElementById('settleStatusLabel');
  if (Math.abs(drift) < 0.01) {
    driftEl.textContent = '🪙 0.00'; driftEl.style.color = '#10b981';
    labelEl.textContent = '✅ Balanced'; labelEl.style.color = '#10b981';
    noteEl.textContent  = 'Your book is perfectly balanced with chips in circulation.';
  } else if (drift > 0) {
    driftEl.textContent = `+🪙 ${fmt(drift)}`; driftEl.style.color='#10b981';
    labelEl.textContent = 'Book Up'; labelEl.style.color='#10b981';
    noteEl.textContent  = `Your book has 🪙${fmt(drift)} more than chips in circulation — clients may have won on bets.`;
  } else {
    driftEl.textContent = `-🪙 ${fmt(Math.abs(drift))}`; driftEl.style.color='#ef4444';
    labelEl.textContent = 'Book Down'; labelEl.style.color='#ef4444';
    noteEl.textContent  = `Your book is down 🪙${fmt(Math.abs(drift))} — clients may have lost on bets.`;
  }

  // Settlement history — agent↔admin + direct admin↔client + agent cash settlements
  const agentAdminTxs = allTransactions.filter(t=>
    (t.sender_id===currentUser.id && !clientIds.has(t.receiver_id)) ||
    (t.receiver_id===currentUser.id && !clientIds.has(t.sender_id))
  );
  const directTxIds = new Set();
  const directTxs = allTransactions.filter(t=>{
    const isDirectTo   = t.transaction_type==='DEPOSIT'    && clientIds.has(t.receiver_id) && t.sender_id!==currentUser.id && !clientIds.has(t.sender_id);
    const isDirectFrom = t.transaction_type==='WITHDRAWAL' && clientIds.has(t.sender_id)   && t.receiver_id!==currentUser.id && !clientIds.has(t.receiver_id);
    if (isDirectTo||isDirectFrom) directTxIds.add(t.id);
    return isDirectTo||isDirectFrom;
  });
  // Agent cash settlements (agent withdrew from client = burned chips)
  const cashSettleTxIds = new Set();
  const cashSettleTxs = allTransactions.filter(t=>{
    const isCash = t.transaction_type==='WITHDRAWAL' && clientIds.has(t.sender_id) && t.receiver_id===currentUser.id;
    if (isCash) cashSettleTxIds.add(t.id);
    return isCash;
  });
  const history = [...agentAdminTxs, ...directTxs, ...cashSettleTxs]
    .filter((t,i,arr)=>arr.findIndex(x=>x.id===t.id)===i) // deduplicate
    .sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))
    .slice(0,25);

  const hBody = document.getElementById('settleHistoryBody');
  if (history.length===0) {
    hBody.innerHTML='<tr><td colspan="3" style="text-align:center;color:#475569;padding:12px;">No admin transactions yet</td></tr>';
  } else {
    hBody.innerHTML = history.map(tx=>{
      const isDirect   = directTxIds.has(tx.id);
      const isCashSettle = cashSettleTxIds.has(tx.id);
      // Direction: direct-to-client = chips IN, cash settle = chips OUT (burned), else normal
      const isIn = isDirect ? tx.transaction_type==='DEPOSIT' : isCashSettle ? false : tx.receiver_id===currentUser.id;
      const col = isIn?'#10b981':'#ef4444';
      let typeLabel = tx.transaction_type;
      if (isDirect) {
        const client = myClients.find(c=>c.id===tx.receiver_id||c.id===tx.sender_id);
        typeLabel = `ADMIN DIRECT → ${client?.login_id||'client'}`;
      } else if (isCashSettle) {
        const client = myClients.find(c=>c.id===tx.sender_id);
        typeLabel = `CASH SETTLE ← ${client?.login_id||'client'}`;
      } else if (tx.transaction_type==='AGENT_SETTLEMENT') {
        typeLabel = 'CASH SETTLED → ADMIN';
      } else if (tx.transaction_type==='DEPOSIT') {
        typeLabel = 'RECEIVED FROM ADMIN';
      } else if (tx.transaction_type==='WITHDRAWAL') {
        typeLabel = 'RETURNED TO ADMIN';
      }
      return `<tr>
        <td style="padding:6px 10px;font-size:0.76rem;color:#94a3b8;">${new Date(tx.created_at).toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</td>
        <td style="padding:6px 10px;"><span style="font-size:0.7rem;font-weight:700;color:${col};">${typeLabel}</span></td>
        <td style="padding:6px 10px;text-align:right;font-family:'JetBrains Mono',monospace;color:${col};">${isIn?'+':'−'}🪙 ${fmt(tx.amount)}</td>
      </tr>`;
    }).join('');
  }
}

function renderAnnouncements() {
  const list = document.getElementById('announcementsList');
  const active = allAnnouncements.filter(a=>a.is_active);
  if (active.length===0) {
    list.innerHTML='<div class="empty"><div class="empty-icon">📭</div><div class="empty-text">No announcements from admin</div></div>';
    return;
  }
  list.innerHTML = active.map(a=>`
    <div class="announcement-card">
      <div class="announcement-msg">${sanitize(a.message)}</div>
      <div class="announcement-meta">
        <span class="badge badge-active">Live</span>
        <span>${new Date(a.created_at).toLocaleString()}</span>
      </div>
    </div>
  `).join('');
}

function renderAccount() {
  const u = currentUser;
  document.getElementById('accLoginId').textContent     = u.login_id||'—';
  document.getElementById('accName').textContent        = u.name||'—';
  document.getElementById('accPhone').textContent       = u.phone||'—';
  document.getElementById('accBalance').textContent     = '🪙 '+fmt(u.balance);
  document.getElementById('accSince').textContent       = u.created_at ? new Date(u.created_at).toLocaleDateString() : '—';
  document.getElementById('accMatchComm').textContent   = (u.match_commission??0)+'%';
  document.getElementById('accFancyComm').textContent   = (u.fancy_commission??0)+'%';
  document.getElementById('accCreditLimit').textContent = '🪙 '+fmt(u.credit_limit||0);
  const statusEl = document.getElementById('accStatus');
  statusEl.innerHTML = u.status==='SUSPENDED'
    ? '<span class="badge badge-suspended"><span class="status-dot"></span> Suspended</span>'
    : '<span class="badge badge-active"><span class="status-dot"></span> Active</span>';
}

// ── ACTION FUNCTIONS ───────────────────────────────────────────────

// ── CREATE CLIENT ──────────────────────────────────────────────────
function openCreateClientModal() {
  document.getElementById('createClientForm').style.display    = 'block';
  document.getElementById('createClientSuccess').style.display = 'none';
  document.getElementById('createClientError').textContent     = '';
  document.getElementById('newClientName').value         = '';
  document.getElementById('newClientPhone').value        = '';
  document.getElementById('newClientBalance').value      = '5000';
  document.getElementById('newClientMatchComm').value    = '0';
  document.getElementById('newClientFancyComm').value    = '0';
  document.getElementById('newClientMatchComm').max      = currentUser.match_commission ?? 100;
  document.getElementById('newClientFancyComm').max      = currentUser.fancy_commission ?? 100;
  document.getElementById('newClientNotes').value        = '';
  document.getElementById('modalAgentBal').textContent   = fmt(currentUser.balance);
  const maxMc = currentUser.match_commission ?? 0;
  const maxFc = currentUser.fancy_commission ?? 0;
  document.getElementById('createClientCommHint').textContent = `Max: Match ${maxMc}% · Fancy ${maxFc}% (your rates)`;
  openModal('modalCreateClient');
}

async function submitCreateClient() {
  const btn   = document.getElementById('createClientBtn');
  const errEl = document.getElementById('createClientError');
  errEl.textContent = ''; btn.disabled = true; btn.textContent = 'Creating…';
  try {
    // Platform-wide registration gate — check DB directly (not cached)
    const { data: regCfg } = await sb.from('platform_config').select('value').eq('key','new_registrations').single();
    if (regCfg?.value === 'false') {
      throw new Error('New client registrations are currently disabled by the admin. Please contact your administrator.');
    }

    const name     = document.getElementById('newClientName').value.trim();
    const phone    = document.getElementById('newClientPhone').value.trim();
    const startBal = parseFloat(document.getElementById('newClientBalance').value) || 0;
    const mComm    = parseFloat(document.getElementById('newClientMatchComm').value) || 0;
    const fComm    = parseFloat(document.getElementById('newClientFancyComm').value) || 0;
    const notes    = document.getElementById('newClientNotes').value.trim() || null;

    if (!name || !phone) throw new Error('Name and phone are required.');
    if (!/^\d{10}$/.test(phone)) throw new Error('Phone must be exactly 10 digits.');

    // Commission caps: client rates must not exceed agent's own rates
    if (mComm > (currentUser.match_commission ?? 0))
      throw new Error(`Match commission ${mComm}% exceeds your rate of ${currentUser.match_commission ?? 0}%.`);
    if (fComm > (currentUser.fancy_commission ?? 0))
      throw new Error(`Fancy commission ${fComm}% exceeds your rate of ${currentUser.fancy_commission ?? 0}%.`);

    // Duplicate phone check
    const dup = myClients.find(c=>c.phone===phone);
    if (dup) throw new Error(`Phone already registered to ${dup.login_id}.`);

    // Check agent balance
    const { data: agentRow } = await sb.from('betting_users').select('balance').eq('id', currentUser.id).single();
    if (parseFloat(agentRow.balance) < startBal) throw new Error(`Insufficient balance. You have 🪙${fmt(agentRow.balance)}, trying to issue 🪙${fmt(startBal)}.`);

    const loginId  = await window.AuthSystem.generateUniqueId('CLIENT');
    const password = window.AuthSystem.generatePassword();
    const email    = window.AuthSystem.toEmail(loginId);

    // Temp no-persist client — prevent overwriting agent session on signUp
    const _tmp = window.supabase.createClient(window._sbConfig.url, window._sbConfig.key, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data: authData, error: signupErr } = await _tmp.auth.signUp({ email, password });
    if (signupErr) throw new Error(signupErr.message);

    const { error: insertErr } = await sb.from('betting_users').insert({
      id: authData.user.id,
      login_id: loginId, role: 'CLIENT',
      name, phone, notes,
      parent_id: currentUser.id,
      balance: startBal,
      credit_limit: startBal,
      match_commission: mComm,
      fancy_commission: fComm,
      status: 'ACTIVE',
      initial_password: password
    });
    if (insertErr) throw new Error(insertErr.message);

    if (startBal > 0) {
      const newAgentBal = parseFloat(agentRow.balance) - startBal;
      await sb.from('betting_users').update({ balance: newAgentBal }).eq('id', currentUser.id);
      await sb.from('credit_transactions').insert({
        sender_id: currentUser.id, receiver_id: authData.user.id,
        amount: startBal, transaction_type: 'DEPOSIT',
        notes: `Initial balance for new client ${loginId}`
      });
      currentUser.balance = String(newAgentBal);
      document.getElementById('sidebarBalance').textContent = fmt(newAgentBal);
    }

    await auditLog('CREATE_CLIENT', { targetId: authData.user.id, targetLoginId: loginId, amount: startBal > 0 ? startBal : null, extra: { name, phone } });

    document.getElementById('genClientId').textContent = loginId;
    document.getElementById('genClientPw').textContent = password;
    document.getElementById('createClientForm').style.display    = 'none';
    document.getElementById('createClientSuccess').style.display = 'block';
    showToast(`Client ${loginId} created!`, 'success');
    await refreshData();
  } catch(err) {
    errEl.textContent = err.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Generate Credentials';
  }
}

// ── EDIT CLIENT ────────────────────────────────────────────────────
function openEditClientModal(clientId) {
  const c = myClients.find(c=>c.id===clientId);
  if (!c) return;
  document.getElementById('editClientId').value            = clientId;
  document.getElementById('editClientLoginId').textContent  = c.login_id;
  document.getElementById('editClientName').value          = c.name || '';
  document.getElementById('editClientPhone').value         = c.phone || '';
  document.getElementById('editClientMatchComm').value     = c.match_commission ?? 0;
  document.getElementById('editClientMatchComm').max       = currentUser.match_commission ?? 100;
  document.getElementById('editClientFancyComm').value     = c.fancy_commission ?? 0;
  document.getElementById('editClientFancyComm').max       = currentUser.fancy_commission ?? 100;
  document.getElementById('editClientCreditLimit').value   = c.credit_limit ?? 0;
  // If agent is suspended, force client to SUSPENDED and lock ACTIVE option
  const agentSuspended = currentUser.status === 'SUSPENDED';
  const clientStatusSel = document.getElementById('editClientStatus');
  clientStatusSel.value = agentSuspended ? 'SUSPENDED' : (c.status || 'ACTIVE');
  Array.from(clientStatusSel.options).forEach(opt => { opt.disabled = (agentSuspended && opt.value === 'ACTIVE'); });
  document.getElementById('editClientNotes').value         = c.notes || '';
  document.getElementById('editClientError').textContent   = '';
  const maxMc = currentUser.match_commission ?? 0;
  const maxFc = currentUser.fancy_commission ?? 0;
  document.getElementById('editClientCommHint').textContent = `Max: Match ${maxMc}% · Fancy ${maxFc}% (your rates)`;
  openModal('modalEditClient');
}

async function submitEditClient() {
  const clientId = document.getElementById('editClientId').value;
  const errEl    = document.getElementById('editClientError');
  errEl.textContent = '';
  try {
    const oldClient = myClients.find(c=>c.id===clientId);
    const newStatus = document.getElementById('editClientStatus').value;
    const phone     = document.getElementById('editClientPhone').value.trim() || null;

    // Block activation if agent is suspended
    if (currentUser.status === 'SUSPENDED' && newStatus === 'ACTIVE')
      throw new Error('Your account is suspended. Cannot activate clients.');

    if (phone && phone !== oldClient?.phone) {
      const dup = myClients.find(c=>c.phone===phone && c.id!==clientId);
      if (dup) throw new Error(`Phone already registered to ${dup.login_id}.`);
    }

    const editMComm = parseFloat(document.getElementById('editClientMatchComm').value) || 0;
    const editFComm = parseFloat(document.getElementById('editClientFancyComm').value) || 0;
    if (editMComm > (currentUser.match_commission ?? 0))
      throw new Error(`Match commission ${editMComm}% exceeds your rate of ${currentUser.match_commission ?? 0}%.`);
    if (editFComm > (currentUser.fancy_commission ?? 0))
      throw new Error(`Fancy commission ${editFComm}% exceeds your rate of ${currentUser.fancy_commission ?? 0}%.`);

    const updates = {
      name:             document.getElementById('editClientName').value.trim() || null,
      phone,
      match_commission: editMComm,
      fancy_commission: editFComm,
      credit_limit:     parseFloat(document.getElementById('editClientCreditLimit').value) || 0,
      status:           newStatus,
      notes:             document.getElementById('editClientNotes').value.trim() || null
    };

    const { error } = await sb.from('betting_users').update(updates).eq('id', clientId);
    if (error) throw new Error(error.message);

    const isSuspending = oldClient?.status==='ACTIVE' && newStatus==='SUSPENDED';
    const isActivating  = oldClient?.status==='SUSPENDED' && newStatus==='ACTIVE';
    const action = isSuspending ? 'SUSPEND_USER' : isActivating ? 'ACTIVATE_USER' : 'UPDATE_USER';
    await auditLog(action, { targetId: clientId, targetLoginId: oldClient?.login_id, extra: { status: newStatus } });

    showToast('Client updated', 'success');
    closeModal('modalEditClient');
    await refreshData();
  } catch(err) { errEl.textContent = err.message; }
}

// ── FUNDS ──────────────────────────────────────────────────────────
function openFundsModal(clientId, type) {
  const c = myClients.find(c=>c.id===clientId);
  if (!c) return;
  document.getElementById('fundsClientId').value    = clientId;
  document.getElementById('fundsType').value        = type;
  document.getElementById('fundsModalTitle').textContent = `${type==='DEPOSIT'?'+ Deposit':'- Withdraw'} — ${c.login_id}`;
  document.getElementById('fundsClientDisplay').textContent = `${c.login_id} · ${c.name||''}`;
  document.getElementById('fundsClientBal').textContent  = `Client balance: 🪙 ${fmt(c.balance)}`;
  document.getElementById('fundsAgentBal').textContent   = fmt(currentUser.balance);
  document.getElementById('fundsAmountLabel').textContent = type==='DEPOSIT' ? 'Amount to Deposit (🪙)' : 'Amount to Withdraw (🪙)';
  document.getElementById('fundsAmount').value  = '';
  document.getElementById('fundsNote').value    = '';
  document.getElementById('fundsError').textContent = '';
  const btn = document.getElementById('fundsSubmitBtn');
  btn.className = type==='DEPOSIT' ? 'btn btn-success' : 'btn btn-danger';
  btn.textContent = type==='DEPOSIT' ? 'Confirm Deposit' : 'Confirm Withdrawal';
  openModal('modalFunds');
}

async function submitFunds() {
  const clientId = document.getElementById('fundsClientId').value;
  const type     = document.getElementById('fundsType').value;
  const amount   = parseFloat(document.getElementById('fundsAmount').value);
  const note     = document.getElementById('fundsNote').value.trim();
  const errEl    = document.getElementById('fundsError');
  errEl.textContent = '';
  if (!amount || isNaN(amount) || amount <= 0) { errEl.textContent = 'Enter a valid amount.'; return; }

  const client = myClients.find(c=>c.id===clientId);
  if (!client) return;

  try {
    if (type === 'DEPOSIT') {
      const { data: agentRow } = await sb.from('betting_users').select('balance').eq('id', currentUser.id).single();
      if (parseFloat(agentRow.balance) < amount) throw new Error(`Insufficient balance. You have 🪙${fmt(agentRow.balance)}.`);
      const newAgentBal  = parseFloat(agentRow.balance) - amount;
      const newClientBal = parseFloat(client.balance||0) + amount;
      // Insert transaction FIRST — if this fails, no balances are touched
      const { error: txErr1 } = await sb.from('credit_transactions').insert({ sender_id: currentUser.id, receiver_id: clientId, amount, transaction_type: 'DEPOSIT', notes: note||null });
      if (txErr1) throw new Error(txErr1.message);
      await sb.from('betting_users').update({ balance: newAgentBal }).eq('id', currentUser.id);
      await sb.from('betting_users').update({ balance: newClientBal }).eq('id', clientId);
      currentUser.balance = String(newAgentBal);
      await auditLog('DEPOSIT', { targetId: clientId, targetLoginId: client.login_id, amount, extra: { note: note||null } });
      showToast(`Deposited 🪙${fmt(amount,0)} to ${client.login_id}`, 'success');
    } else {
      if (parseFloat(client.balance||0) < amount) throw new Error(`Insufficient client balance. ${client.login_id} has 🪙${fmt(client.balance)}.`);
      const newClientBal = parseFloat(client.balance||0) - amount;
      // Cash settlement — chips burned from client, agent balance unchanged
      // Insert transaction FIRST — if this fails, no balances are touched
      const { error: txErr2 } = await sb.from('credit_transactions').insert({ sender_id: clientId, receiver_id: currentUser.id, amount, transaction_type: 'WITHDRAWAL', notes: note||null });
      if (txErr2) throw new Error(txErr2.message);
      await sb.from('betting_users').update({ balance: newClientBal }).eq('id', clientId);
      // Agent balance NOT updated — cash was physically given to client
      await auditLog('WITHDRAWAL', { targetId: clientId, targetLoginId: client.login_id, amount, extra: { note: note||null } });
      showToast(`Cash settled 🪙${fmt(amount,0)} with ${client.login_id} (chips burned)`, 'success');
    }
    closeModal('modalFunds');
    await refreshData();
  } catch(err) { errEl.textContent = err.message; }
}

// ── CLIENT HISTORY ─────────────────────────────────────────────────
async function openClientHistory(clientId) {
  const c = myClients.find(c=>c.id===clientId);
  if (!c) return;
  document.getElementById('historyClientId').textContent = `${c.login_id} · ${c.name||''}`;
  const tbody = document.getElementById('historyTableBody');
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#64748b;padding:20px;">Loading…</td></tr>';
  openModal('modalHistory');

  const [txS, txR] = await Promise.all([
    sb.from('credit_transactions').select('*').eq('sender_id', clientId).order('created_at',{ascending:false}).limit(200),
    sb.from('credit_transactions').select('*').eq('receiver_id', clientId).order('created_at',{ascending:false}).limit(200)
  ]);
  const txMap = {};
  [...(txS.data||[]), ...(txR.data||[])].forEach(t=>{ txMap[t.id]=t; });
  const txList = Object.values(txMap).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));

  if (txList.length===0) {
    tbody.innerHTML='<tr><td colspan="6" style="text-align:center;color:#475569;padding:20px;">No transactions yet</td></tr>';
    return;
  }
  tbody.innerHTML = txList.map(tx=>{
    const sender  =[...myClients,currentUser].find(u=>u.id===tx.sender_id);
    const receiver=[...myClients,currentUser].find(u=>u.id===tx.receiver_id);
    const isCredit=['DEPOSIT','SETTLEMENT','VOID_REFUND'].includes(tx.transaction_type);
    const col = isCredit?'#10b981':'#ef4444';
    return `<tr>
      <td class="text-muted" style="font-size:0.78rem;white-space:nowrap;">${new Date(tx.created_at).toLocaleString()}</td>
      <td><span style="background:${col}20;color:${col};padding:2px 7px;border-radius:4px;font-size:0.7rem;font-weight:700;">${tx.transaction_type}</span></td>
      <td class="mono" style="font-size:0.8rem;">${sender?.login_id||'—'}</td>
      <td class="mono" style="font-size:0.8rem;">${receiver?.login_id||'—'}</td>
      <td class="text-muted" style="font-size:0.78rem;">${tx.notes||'—'}</td>
      <td class="mono" style="text-align:right;color:${col};font-weight:700;">🪙 ${fmt(tx.amount)}</td>
    </tr>`;
  }).join('');
}

// ── RESET CLIENT PASSWORD ──────────────────────────────────────────
async function resetClientPassword(clientId, loginId) {
  if (!confirm(`Reset password for ${loginId}?\n\nA new 6-digit password will be generated.`)) return;
  const client = myClients.find(c=>c.id===clientId);
  if (!client?.initial_password) { showToast('Cannot reset: no stored password found. Contact admin.', 'error'); return; }

  const newPw = window.AuthSystem.generatePassword();
  const email = window.AuthSystem.toEmail(loginId);
  try {
    const _tmp = window.supabase.createClient(window._sbConfig.url, window._sbConfig.key, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { error: signInErr } = await _tmp.auth.signInWithPassword({ email, password: client.initial_password });
    if (signInErr) throw new Error('Cannot sign in as client to reset password. Ask admin to reset from admin panel.');
    const { error: updateErr } = await _tmp.auth.updateUser({ password: newPw });
    if (updateErr) throw new Error(updateErr.message);
    await sb.from('betting_users').update({ initial_password: newPw }).eq('id', clientId);
    await auditLog('RESET_PASSWORD', { targetId: clientId, targetLoginId: loginId });
    alert(`✅ Password Reset\n\nClient: ${loginId}\nNew Password: ${newPw}\n\nShare securely.`);
    await refreshData();
  } catch(err) { showToast(err.message, 'error'); }
}

// ── CHANGE MY PASSWORD ─────────────────────────────────────────────
async function changePassword() {
  const current = document.getElementById('pwCurrent').value;
  const newPw   = document.getElementById('pwNew').value;
  const confirm2= document.getElementById('pwConfirm').value;
  const errEl   = document.getElementById('pwError');
  errEl.textContent = '';

  if (!current || !newPw || !confirm2) { errEl.textContent = 'All fields required.'; return; }
  if (newPw.length < 6)  { errEl.textContent = 'New password must be at least 6 characters.'; return; }
  if (newPw !== confirm2) { errEl.textContent = 'Passwords do not match.'; return; }

  try {
    const email = window.AuthSystem.toEmail(currentUser.login_id);
    // Verify current password
    const _verify = window.supabase.createClient(window._sbConfig.url, window._sbConfig.key, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { error: verifyErr } = await _verify.auth.signInWithPassword({ email, password: current });
    if (verifyErr) { errEl.textContent = 'Current password is incorrect.'; return; }

    const { error: updateErr } = await window.supabaseClient.auth.updateUser({ password: newPw });
    if (updateErr) throw new Error(updateErr.message);
    await sb.from('betting_users').update({ initial_password: newPw }).eq('id', currentUser.id);
    await auditLog('RESET_PASSWORD', { extra: { self: true } });

    document.getElementById('pwCurrent').value = '';
    document.getElementById('pwNew').value     = '';
    document.getElementById('pwConfirm').value = '';
    showToast('Password updated successfully!', 'success');
  } catch(err) { errEl.textContent = err.message; }
}


  // -- GLOBAL ALIASES for HTML onclick/oninput handlers --
  // Static markup onclick handlers
  window.switchTab = switchTab;
  window.refreshData = refreshData;
  window.toggleMoreMenu = toggleMoreMenu;
  window.setStatusFilter = setStatusFilter;
  window.setCatFilter = setCatFilter;
  window.downloadLedgerCSV = downloadLedgerCSV;
  window.openCreateClientModal = openCreateClientModal;
  window.submitCreateClient = submitCreateClient;
  window.openEditClientModal = openEditClientModal;
  window.submitEditClient = submitEditClient;
  window.openFundsModal = openFundsModal;
  window.submitFunds = submitFunds;
  window.openClientHistory = openClientHistory;
  window.resetClientPassword = resetClientPassword;
  window.changePassword = changePassword;
  window.togglePwVis = togglePwVis;
  window.toggleMarketDetail = toggleMarketDetail;
  window.renderClients = renderClients;
  window.renderLedger = renderLedger;
  window.renderBetLog = renderBetLog;
  window.renderMarkets = renderMarkets;
  window.auditLog = auditLog;

  // Expose namespace functions
  Agent.refreshData = refreshData;
  Agent.switchTab = switchTab;
  Agent.renderActiveTab = renderActiveTab;
  Agent.auditLog = auditLog;

})();
