// -- ADMIN CONTROL CENTER - Bhandai Exchange --
// Extracted from admin.html inline script
(function() {
  'use strict';
  const Admin = window.Admin = {};
  const sb = window.supabaseClient;

let currentUser = null;
let allUsers = [], allTransactions = [], allEvents = [], allOutcomes = [], allOrders = [], allAnnouncements = [], allAuditLogs = [];
let allSettlementResults = [];
let activeTab = 'dashboard';
let roleFilter = 'AGENT';
let catFilter = 'ALL';

window.addEventListener('DOMContentLoaded', async () => {
  const authData = await AuthSystem.requireRole('ADMIN');
  if (!authData) return; // requireRole already redirects to index.html
  currentUser = authData.profile;
  document.getElementById('authGate').remove();

  document.getElementById('adminIdDisplay').textContent = currentUser.login_id;
  document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', () => switchTab(el.dataset.tab));
  });
  document.querySelectorAll('[data-role-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-role-filter]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      roleFilter = btn.dataset.roleFilter;
      renderUsers();
    });
  });
  document.querySelectorAll('[data-cat-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-cat-filter]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      catFilter = btn.dataset.catFilter;
      renderMarkets();
    });
  });

  // Start security timers
  AuthSystem.startSessionTimeout(30);           // 30 min idle → auto-logout
  AuthSystem.startStatusPolling(currentUser.id, 60); // check suspension every 60s

  // Emergency halt keyboard shortcut: Ctrl+Shift+H
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'H') { e.preventDefault(); haltAllMarkets(); }
  });

  await refreshData();
  setInterval(refreshData, 30000);
});

// ── DATA LOADING ──────────────────────────────────────────────────

async function refreshData() {
  document.getElementById('lastRefreshed').textContent = 'Updated ' + new Date().toLocaleTimeString();
  const [u, tx, ev, oc, ord, ann, al, sr] = await Promise.all([
    sb.from('betting_users').select('*').order('created_at', { ascending: false }),
    sb.from('credit_transactions').select('*').order('created_at', { ascending: false }).limit(1000),
    sb.from('events').select('*').order('created_at', { ascending: false }),
    sb.from('outcomes').select('*'),
    sb.from('orders').select('*').order('created_at', { ascending: false }).limit(2000),
    sb.from('platform_announcements').select('*').order('created_at', { ascending: false }),
    sb.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(500),
    sb.from('settlement_results').select('*')
  ]);
  allUsers = u.data || [];
  allTransactions = tx.data || [];
  allEvents = ev.data || [];
  allOutcomes = oc.data || [];
  allOrders = ord.data || [];
  allAnnouncements = ann.data || [];
  allAuditLogs = al.data || [];
  allSettlementResults = sr.data || [];

  // Sidebar: total coins in circulation (agents + clients)
  const totalInMarket = allUsers.filter(u => u.role !== 'ADMIN').reduce((s, u) => s + parseFloat(u.balance || 0), 0);
  document.getElementById('sidebarBalance').textContent = totalInMarket.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2});

  renderActiveTab();
}

function renderActiveTab() {
  if (activeTab === 'dashboard') renderDashboard();
  else if (activeTab === 'users') renderUsers();
  else if (activeTab === 'ledger') renderLedger();
  else if (activeTab === 'settlement') renderSettlement();
  else if (activeTab === 'markets') renderMarkets();
  else if (activeTab === 'risk') renderRisk();
  else if (activeTab === 'betlog') renderBetLog();
  else if (activeTab === 'broadcast') renderBroadcast();
  else if (activeTab === 'audit') renderAuditLog();
  else if (activeTab === 'settings') renderSettings();
}

// ── TAB SWITCH ────────────────────────────────────────────────────
function switchTab(tabId) {
  if (!tabId) return;
  activeTab = tabId;
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.tab === tabId);
  });
  document.querySelectorAll('.tab-content').forEach(el => {
    el.classList.toggle('active', el.id === 'tab-' + tabId);
  });
  const titles = { dashboard:'Dashboard', users:'User Management', ledger:'Master Ledger', settlement:'Agent Settlement', markets:'Match Control', risk:'Risk Matrix', betlog:'Bet Log', broadcast:'Broadcast', audit:'Audit Log', settings:'Settings' };
  document.getElementById('topbarTitle').textContent = titles[tabId] || tabId;
  renderActiveTab();
}

// ── RENDER DASHBOARD ──────────────────────────────────────────────
function renderDashboard() {
  const downline = allUsers.filter(u => u.id !== currentUser.id);
  const agents = downline.filter(u => u.role === 'AGENT');
  const clients = downline.filter(u => u.role === 'CLIENT');
  const totalCoins = downline.reduce((s, u) => s + parseFloat(u.balance || 0), 0);

  document.getElementById('dashCoins').textContent = totalCoins.toLocaleString(undefined, {maximumFractionDigits:0});
  document.getElementById('dashUsersCount').textContent = downline.length;
  document.getElementById('dashAgentCount').textContent = agents.length;
  document.getElementById('dashClientCount').textContent = clients.length;

  // Exposure from open orders
  const openVol = allOrders.reduce((s, o) => s + parseFloat(o.total_cost || 0), 0);
  document.getElementById('dashExposure').textContent = openVol.toLocaleString(undefined, {maximumFractionDigits:0});

  // P&L from settled events (placeholder — will be real when Track 2 settles)
  const settledTx = allTransactions.filter(t => t.transaction_type === 'SETTLEMENT');
  const pnl = settledTx.reduce((s, t) => s + parseFloat(t.amount || 0), 0);
  document.getElementById('dashPnl').textContent = pnl.toLocaleString(undefined, {maximumFractionDigits:2});

  // Top agents table
  const tbody = document.getElementById('topAgentsTable');
  if (agents.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5"><div class="empty"><div class="empty-icon">👥</div><div class="empty-text">No agents created yet</div></div></td></tr>';
  } else {
    tbody.innerHTML = agents.map(agent => {
      const agentClients = downline.filter(u => u.parent_id === agent.id);
      const clientBals = agentClients.reduce((s, c) => s + parseFloat(c.balance || 0), 0);
      const badge = agent.status === 'SUSPENDED' ? `<span class="badge badge-suspended"><span class="status-dot"></span> Suspended</span>` : `<span class="badge badge-active"><span class="status-dot"></span> Active</span>`;
      return `<tr>
        <td class="mono text-white">${agent.login_id}</td>
        <td>${agent.name || '—'}</td>
        <td>${agentClients.length}</td>
        <td class="mono">🪙 ${clientBals.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
        <td>${badge}</td>
      </tr>`;
    }).join('');
  }

  // Activity feed from transactions
  const feed = document.getElementById('activityFeed');
  const recent = allTransactions.slice(0, 10);
  if (recent.length === 0) {
    feed.innerHTML = '<div class="empty" style="padding:24px;"><div class="empty-icon">📡</div><div class="empty-text">No activity yet</div></div>';
  } else {
    feed.innerHTML = recent.map(tx => {
      const sender = allUsers.find(u => u.id === tx.sender_id);
      const receiver = allUsers.find(u => u.id === tx.receiver_id);
      const isDeposit = tx.transaction_type === 'DEPOSIT';
      const isComm = tx.transaction_type === 'COMMISSION';
      const color = isDeposit ? 'green' : tx.transaction_type === 'SETTLEMENT' ? 'blue' : isComm ? '#a78bfa' : 'red';
      const icon = isDeposit ? '⬆' : tx.transaction_type === 'SETTLEMENT' ? '🏆' : isComm ? '💰' : '⬇';
      const timeStr = new Date(tx.created_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
      return `<div class="feed-item">
        <div class="feed-dot ${color}"></div>
        <div class="feed-content">
          <div class="feed-text">${icon} <strong>${sender?.login_id || 'System'}</strong> → <strong>${receiver?.login_id || 'System'}</strong> · ${tx.transaction_type}</div>
          ${tx.notes ? `<div class="feed-time">${tx.notes}</div>` : ''}
          <div class="feed-time">${timeStr} · ${new Date(tx.created_at).toLocaleDateString()}</div>
        </div>
        <div class="feed-amount" style="color:${isDeposit?'#10b981':'#ef4444'};">${isDeposit?'+':'-'}🪙${parseFloat(tx.amount).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}</div>
      </div>`;
    }).join('');
  }

  // Active markets summary
  const activeEvents = allEvents.filter(e => e.status !== 'SETTLED').slice(0, 5);
  const mTbody = document.getElementById('dashMarketsTable');
  if (activeEvents.length === 0) {
    mTbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#475569;padding:20px;">No markets yet</td></tr>';
  } else {
    mTbody.innerHTML = activeEvents.map(ev => {
      const ocs = allOutcomes.filter(o => o.event_id === ev.id);
      const vol = ocs.reduce((s, o) => s + parseFloat(o.total_volume || 0), 0);
      const statusBadge = eventStatusBadge(ev.status);
      return `<tr>
        <td class="text-white">${ev.title}</td>
        <td>${ev.category}</td>
        <td>${statusBadge}</td>
        <td>${ocs.map(o => `<span style="background:#334155;padding:2px 6px;border-radius:4px;font-size:0.72rem;margin-right:4px;">${o.title}</span>`).join('')}</td>
        <td class="mono">🪙 ${vol.toLocaleString()}</td>
      </tr>`;
    }).join('');
  }
}

// ── RENDER USERS ──────────────────────────────────────────────────
function renderUsers() {
  const q = (document.getElementById('userSearch')?.value || '').toLowerCase();
  const allDownline = allUsers.filter(u => u.id !== currentUser.id);
  const agents  = allDownline.filter(u => u.role === 'AGENT');
  const clients = allDownline.filter(u => u.role === 'CLIENT');

  const tbody = document.getElementById('usersTableBody');

  // ── Flat search mode (search query active OR filter = CLIENT) ──
  if (q || roleFilter === 'CLIENT') {
    let users = allDownline;
    if (roleFilter !== 'ALL') users = users.filter(u => u.role === roleFilter);
    if (q) users = users.filter(u =>
      (u.login_id + ' ' + (u.name || '') + ' ' + (u.phone || '')).toLowerCase().includes(q)
    );
    if (users.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9"><div class="empty"><div class="empty-icon">🔍</div><div class="empty-text">No users found</div></div></td></tr>';
      return;
    }
    tbody.innerHTML = users.map(u => userRow(u, allDownline)).join('');
    return;
  }

  // ── Default: hierarchy view — Agents only (optionally with clients nested) ──
  if (roleFilter === 'ALL' || roleFilter === 'AGENT') {
    if (agents.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9"><div class="empty"><div class="empty-icon">👥</div><div class="empty-text">No agents yet. Create your first agent.</div></div></td></tr>';
      return;
    }
    let rows = '';
    agents.forEach(agent => {
      rows += agentRow(agent, allDownline);
      // Only show nested clients in ALL view, not in AGENT-only view
      if (roleFilter === 'ALL') {
        const agentClients = clients.filter(c => c.parent_id === agent.id);
        agentClients.forEach(c => { rows += clientRow(c, agent); });
      }
    });
    // Orphan clients only in ALL view
    if (roleFilter === 'ALL') {
      const orphans = clients.filter(c => c.parent_id === currentUser.id);
      orphans.forEach(c => { rows += clientRow(c, null); });
    }
    tbody.innerHTML = rows;
  }
}

function agentRow(agent, allDownline) {
  const agentClients = allDownline.filter(u => u.role === 'CLIENT' && u.parent_id === agent.id);
  const clientBals   = agentClients.reduce((s, c) => s + parseFloat(c.balance || 0), 0);
  const bal  = parseFloat(agent.balance || 0);
  const cl   = parseFloat(agent.credit_limit || 0);
  const mC   = agent.match_commission ?? 0;
  const fC   = agent.fancy_commission ?? 0;
  const statusBadge = agent.status === 'SUSPENDED'
    ? `<span class="badge badge-suspended"><span class="status-dot"></span> Suspended</span>`
    : `<span class="badge badge-active"><span class="status-dot"></span> Active</span>`;
  return `<tr style="background:rgba(99,102,241,0.04);border-left:3px solid rgba(139,92,246,0.4);">
    <td>
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:0.7rem;background:rgba(139,92,246,0.2);color:#a78bfa;padding:2px 6px;border-radius:4px;font-weight:700;">AGENT</span>
        <div>
          <div class="mono text-white" style="font-size:0.95rem;">${sanitize(agent.login_id)}${agent.notes ? ` <span title="${sanitize(agent.notes)}" style="cursor:help;font-size:0.75rem;">📝</span>` : ''}</div>
          <div class="text-muted" style="font-size:0.72rem;">${sanitize(agent.name || '—')} · ${sanitize(agent.phone || '—')}</div>
        </div>
      </div>
    </td>
    <td>
      <div class="mono" style="color:#10b981;font-size:0.9rem;">🪙 ${bal.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
      <div class="text-muted" style="font-size:0.72rem;">Limit: 🪙${cl.toLocaleString()}</div>
    </td>
    <td>
      <div style="font-size:0.82rem;">${statusBadge}</div>
      <div class="text-muted" style="font-size:0.72rem;margin-top:3px;">${agentClients.length} clients · 🪙${clientBals.toLocaleString(undefined,{maximumFractionDigits:0})} deployed</div>
      <div style="margin-top:3px;">${timeAgo(agent.last_seen_at)}</div>
    </td>
    <td>
      <div style="font-size:0.82rem;color:#e2e8f0;">Match: <strong>${mC}%</strong></div>
      <div style="font-size:0.82rem;color:#e2e8f0;">Fancy: <strong>${fC}%</strong></div>
      <div style="font-size:0.82rem;color:#a78bfa;margin-top:2px;">Share: <strong>${agent.partnership_share ?? 0}%</strong></div>
    </td>
    <td>
      ${agent.initial_password
        ? `<div class="mono" style="font-size:0.72rem;color:#94a3b8;">ID: ${agent.login_id}</div>
           <div style="font-size:0.72rem;display:flex;align-items:center;gap:4px;">
             <span class="mono" style="color:#f59e0b;" id="pw_${agent.id}" data-visible="0">●●●●●●</span>
             <button onclick="togglePwVis('${agent.id}','${agent.initial_password}')" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:0.75rem;padding:0 2px;" title="Show/hide password">👁</button>
           </div>`
        : '<span style="color:#475569;font-size:0.72rem;">—</span>'}
    </td>
    <td style="text-align:right;">
      <div class="btn-group" style="justify-content:flex-end;gap:4px;">
        <button class="btn btn-ghost btn-sm" onclick="openUserHistory('${agent.id}')" title="Transaction History">👁</button>
        <button class="btn btn-ghost btn-sm" onclick="openEditModal('${agent.id}')">Edit</button>
        <button class="btn btn-ghost btn-sm" onclick="resetUserPassword('${agent.id}','${agent.login_id}')" title="Reset Password">🔑</button>
        <button class="btn btn-success btn-sm" onclick="openFundsModal('${agent.id}','DEPOSIT')" title="Add Coins">+🪙</button>
        <button class="btn btn-danger btn-sm" onclick="openFundsModal('${agent.id}','WITHDRAWAL')" title="Remove Coins">-🪙</button>
        <button class="btn btn-primary btn-sm" onclick="openCreateUserModal('CLIENT','${agent.id}')">+Client</button>
      </div>
    </td>
  </tr>`;
}

function clientRow(client, parentAgent) {
  const bal = parseFloat(client.balance || 0);
  const statusBadge = client.status === 'SUSPENDED'
    ? `<span class="badge badge-suspended"><span class="status-dot"></span> Suspended</span>`
    : `<span class="badge badge-active"><span class="status-dot"></span> Active</span>`;
  return `<tr style="background:rgba(16,185,129,0.02);">
    <td style="padding-left:36px;">
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="color:#334155;font-size:1rem;">└</span>
        <div>
          <div class="mono" style="color:#e2e8f0;font-size:0.88rem;">${sanitize(client.login_id)}${client.notes ? ` <span title="${sanitize(client.notes)}" style="cursor:help;font-size:0.75rem;">📝</span>` : ''}</div>
          <div class="text-muted" style="font-size:0.72rem;">${sanitize(client.name || '—')} · ${sanitize(client.phone || '—')}</div>
        </div>
      </div>
    </td>
    <td>
      <div class="mono" style="color:${bal>0?'#10b981':'#94a3b8'};font-size:0.88rem;">🪙 ${bal.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
      ${parentAgent ? `<div class="text-muted" style="font-size:0.7rem;">Under: ${parentAgent.login_id}</div>` : ''}
    </td>
    <td>
      ${statusBadge}
      <div style="margin-top:3px;">${timeAgo(client.last_seen_at)}</div>
    </td>
    <td>
      <div style="font-size:0.82rem;color:#e2e8f0;">Match: <strong>${client.match_commission ?? 0}%</strong></div>
      <div style="font-size:0.82rem;color:#e2e8f0;">Fancy: <strong>${client.fancy_commission ?? 0}%</strong></div>
    </td>
    <td>
      ${client.initial_password
        ? `<div class="mono" style="font-size:0.72rem;color:#94a3b8;">ID: ${client.login_id}</div>
           <div style="font-size:0.72rem;display:flex;align-items:center;gap:4px;">
             <span class="mono" style="color:#f59e0b;" id="pw_${client.id}" data-visible="0">●●●●●●</span>
             <button onclick="togglePwVis('${client.id}','${client.initial_password}')" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:0.75rem;padding:0 2px;" title="Show/hide password">👁</button>
           </div>`
        : '<span style="color:#475569;font-size:0.72rem;">—</span>'}
    </td>
    <td style="text-align:right;">
      <div class="btn-group" style="justify-content:flex-end;gap:4px;">
        <button class="btn btn-ghost btn-sm" onclick="openUserHistory('${client.id}')" title="Transaction History">👁</button>
        <button class="btn btn-ghost btn-sm" onclick="openEditModal('${client.id}')">Edit</button>
        <button class="btn btn-ghost btn-sm" onclick="resetUserPassword('${client.id}','${client.login_id}')" title="Reset Password">🔑</button>
        <button class="btn btn-success btn-sm" onclick="openFundsModal('${client.id}','DEPOSIT')" title="Add Coins">+🪙</button>
        <button class="btn btn-danger btn-sm" onclick="openFundsModal('${client.id}','WITHDRAWAL')" title="Remove Coins">-🪙</button>
      </div>
    </td>
  </tr>`;
}

// Flat row used in search mode
function userRow(u, allDownline) {
  const isAgent = u.role === 'AGENT';
  const parentAgent = isAgent ? null : allDownline.find(a => a.id === u.parent_id);
  const bal  = parseFloat(u.balance || 0);
  const cl   = parseFloat(u.credit_limit || 0);
  const mC   = u.match_commission ?? 0;
  const fC   = u.fancy_commission ?? 0;
  const roleBadge = isAgent
    ? `<span class="badge badge-agent">AGENT</span>`
    : `<span class="badge badge-client">CLIENT</span>`;
  const statusBadge = u.status === 'SUSPENDED'
    ? `<span class="badge badge-suspended"><span class="status-dot"></span> Suspended</span>`
    : `<span class="badge badge-active"><span class="status-dot"></span> Active</span>`;
  return `<tr>
    <td>
      <div style="display:flex;align-items:center;gap:8px;">
        ${roleBadge}
        <div>
          <div class="mono text-white" style="font-size:0.9rem;">${sanitize(u.login_id)}${u.notes ? ` <span title="${sanitize(u.notes)}" style="cursor:help;font-size:0.75rem;">📝</span>` : ''}</div>
          <div class="text-muted" style="font-size:0.72rem;">${sanitize(u.name || '—')} · ${sanitize(u.phone || '—')}</div>
          ${parentAgent ? `<div style="font-size:0.7rem;color:#6366f1;margin-top:2px;">Under: ${sanitize(parentAgent.login_id)}</div>` : ''}
        </div>
      </div>
    </td>
    <td>
      <div class="mono" style="color:${bal>0?'#10b981':'#94a3b8'};font-size:0.9rem;">🪙 ${bal.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
      ${isAgent ? `<div class="text-muted" style="font-size:0.72rem;">Limit: 🪙${cl.toLocaleString()}</div>` : ''}
    </td>
    <td>
      ${statusBadge}
      <div style="margin-top:3px;">${timeAgo(u.last_seen_at)}</div>
    </td>
    <td>
      ${isAgent
        ? `<div style="font-size:0.82rem;color:#e2e8f0;">Match: <strong>${mC}%</strong></div>
           <div style="font-size:0.82rem;color:#e2e8f0;">Fancy: <strong>${fC}%</strong></div>
           <div style="font-size:0.82rem;color:#a78bfa;margin-top:2px;">Share: <strong>${u.partnership_share ?? 0}%</strong></div>`
        : `<div style="font-size:0.82rem;color:#e2e8f0;">Match: <strong>${mC}%</strong></div>
           <div style="font-size:0.82rem;color:#e2e8f0;">Fancy: <strong>${fC}%</strong></div>`}
    </td>
    <td>
      ${u.initial_password
        ? `<div class="mono" style="font-size:0.72rem;color:#94a3b8;">ID: ${u.login_id}</div>
           <div style="font-size:0.72rem;display:flex;align-items:center;gap:4px;">
             <span class="mono" style="color:#f59e0b;" id="pw_${u.id}" data-visible="0">●●●●●●</span>
             <button onclick="togglePwVis('${u.id}','${u.initial_password}')" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:0.75rem;padding:0 2px;" title="Show/hide password">👁</button>
           </div>`
        : '<span style="color:#475569;font-size:0.72rem;">—</span>'}
    </td>
    <td style="text-align:right;">
      <div class="btn-group" style="justify-content:flex-end;gap:4px;">
        <button class="btn btn-ghost btn-sm" onclick="openUserHistory('${u.id}')" title="Transaction History">👁</button>
        <button class="btn btn-ghost btn-sm" onclick="openEditModal('${u.id}')">Edit</button>
        <button class="btn btn-ghost btn-sm" onclick="resetUserPassword('${u.id}','${u.login_id}')" title="Reset Password">🔑</button>
        <button class="btn btn-success btn-sm" onclick="openFundsModal('${u.id}','DEPOSIT')" title="Add Coins">+🪙</button>
        <button class="btn btn-danger btn-sm" onclick="openFundsModal('${u.id}','WITHDRAWAL')" title="Remove Coins">-🪙</button>
        ${isAgent ? `<button class="btn btn-primary btn-sm" onclick="openCreateUserModal('CLIENT','${u.id}')">+Client</button>` : ''}
      </div>
    </td>
  </tr>`;
}

// ── RENDER LEDGER ─────────────────────────────────────────────────
function renderLedger() {
  const q = (document.getElementById('ledgerSearch')?.value || '').toLowerCase();
  const downline = allUsers.filter(u => u.id !== currentUser.id);

  const totalBals = downline.reduce((s, u) => s + parseFloat(u.balance || 0), 0);
  // Only count admin-originated coin movements (agent→client transfers are redistribution, not new coins)
  const totalDeposits = allTransactions.filter(t => t.transaction_type === 'DEPOSIT' && t.sender_id === currentUser.id).reduce((s, t) => s + parseFloat(t.amount || 0), 0);
  // Agent returns = only withdrawals where an AGENT sent chips back to admin (chip transfer)
  const agentIds = new Set(allUsers.filter(u => u.role === 'AGENT').map(u => u.id));
  const allClientIds = new Set(allUsers.filter(u => u.role === 'CLIENT').map(u => u.id));
  const totalWithdrawals = allTransactions.filter(t => t.transaction_type === 'WITHDRAWAL' && t.receiver_id === currentUser.id && agentIds.has(t.sender_id)).reduce((s, t) => s + parseFloat(t.amount || 0), 0);
  // Cash settlements = all client chip burns (chips redeemed for cash — by admin or agent)
  const totalCashSettled = allTransactions.filter(t => t.transaction_type === 'WITHDRAWAL' && allClientIds.has(t.sender_id)).reduce((s, t) => s + parseFloat(t.amount || 0), 0);
  // Market settlements & void refunds mint coins into wallets — count as issued
  const totalSettlements = allTransactions.filter(t => t.transaction_type === 'SETTLEMENT' || t.transaction_type === 'VOID_REFUND' || t.transaction_type === 'COMMISSION').reduce((s, t) => s + parseFloat(t.amount || 0), 0);

  document.getElementById('ledgerTotal').textContent = totalBals.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2});
  document.getElementById('ledgerDeposits').textContent = totalDeposits.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2});
  document.getElementById('ledgerWithdrawals').textContent = totalWithdrawals.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2});
  document.getElementById('ledgerCashSettled').textContent = totalCashSettled.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2});

  // Reconciliation: net in circulation = deposited − agent_returns − cash_settled + market_settlements
  const netIssued = totalDeposits + totalSettlements - totalWithdrawals - totalCashSettled;
  const drift = netIssued - totalBals;
  const reconEl = document.getElementById('reconBanner');
  reconEl.style.display = 'block';
  if (Math.abs(drift) < 0.01) {
    reconEl.className = 'recon-ok';
    reconEl.textContent = `✅ Chip Integrity OK — 🪙${netIssued.toLocaleString(undefined,{minimumFractionDigits:2})} in net circulation. All balances accounted for.`;
  } else {
    reconEl.className = 'recon-warn';
    reconEl.innerHTML = `⚠️ Chip Drift Detected — Net in circulation: 🪙${netIssued.toLocaleString(undefined,{minimumFractionDigits:2})}, In wallets: 🪙${totalBals.toLocaleString(undefined,{minimumFractionDigits:2})}, Drift: 🪙${Math.abs(drift).toFixed(2)} ${drift > 0 ? '(missing from wallets)' : '(extra in wallets)'}`;
  }

  // Balance Register
  let users = downline;
  if (q) users = users.filter(u => (u.login_id + ' ' + (u.name||'')).toLowerCase().includes(q));

  const tbody = document.getElementById('ledgerTableBody');
  if (users.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6"><div class="empty" style="padding:24px;"><div class="empty-icon">💰</div><div class="empty-text">No users yet</div></div></td></tr>';
  } else {
    tbody.innerHTML = users.map(u => {
      const roleBadge = u.role === 'AGENT' ? `<span class="badge badge-agent">AGENT</span>` : `<span class="badge badge-client">CLIENT</span>`;
      const bal = parseFloat(u.balance || 0);
      const cl = Math.max(parseFloat(u.credit_limit || 1), 1);
      const utilPct = Math.min(100, (bal / cl) * 100);
      const utilClass = utilPct > 90 ? 'util-crit' : utilPct > 70 ? 'util-warn' : 'util-ok';
      return `<tr>
        <td>
          <div class="mono text-white">${u.login_id}</div>
          <div class="text-muted" style="font-size:0.75rem;margin-top:2px;">${u.name || ''}</div>
        </td>
        <td>${roleBadge}</td>
        <td class="mono" style="color:${bal>0?'white':'#94a3b8'};">🪙 ${bal.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
        <td class="mono text-muted">🪙 ${cl.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
        <td>
          <div style="font-size:0.78rem;color:#94a3b8;">${utilPct.toFixed(1)}%</div>
          <div class="util-bar"><div class="util-fill ${utilClass}" style="width:${utilPct}%;"></div></div>
        </td>
        <td style="text-align:right;">
          <div class="btn-group" style="justify-content:flex-end;">
            <button class="btn btn-success btn-sm" onclick="openFundsModal('${u.id}', 'DEPOSIT')">Deposit</button>
            <button class="btn btn-danger btn-sm" onclick="openFundsModal('${u.id}', 'WITHDRAWAL')">Withdraw</button>
          </div>
        </td>
      </tr>`;
    }).join('');
  }

  // Full Transaction Log with filters
  const txFrom = document.getElementById('txFrom')?.value;
  const txTo = document.getElementById('txTo')?.value;
  const txType = document.getElementById('txTypeFilter')?.value;
  const txUser = (document.getElementById('txUserSearch')?.value || '').toLowerCase();
  let txList = [...allTransactions];
  if (txFrom) txList = txList.filter(t => new Date(t.created_at) >= new Date(txFrom));
  if (txTo) txList = txList.filter(t => new Date(t.created_at) <= new Date(txTo + 'T23:59:59'));
  if (txType) txList = txList.filter(t => t.transaction_type === txType);
  if (txUser) txList = txList.filter(t => {
    const s = allUsers.find(u => u.id === t.sender_id);
    const r = allUsers.find(u => u.id === t.receiver_id);
    return (s?.login_id || '').toLowerCase().includes(txUser) || (r?.login_id || '').toLowerCase().includes(txUser);
  });

  const txBody = document.getElementById('txLogBody');
  if (txList.length === 0) {
    txBody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#475569;padding:24px;">No transactions match the selected filters</td></tr>';
  } else {
    txBody.innerHTML = txList.slice(0, 200).map(tx => {
      const sender = allUsers.find(u => u.id === tx.sender_id);
      const receiver = allUsers.find(u => u.id === tx.receiver_id);
      const isCredit = ['DEPOSIT', 'SETTLEMENT', 'VOID_REFUND', 'COMMISSION'].includes(tx.transaction_type);
      const typeColor = isCredit ? '#10b981' : '#ef4444';
      return `<tr>
        <td class="text-muted" style="font-size:0.8rem;white-space:nowrap;">${new Date(tx.created_at).toLocaleString()}</td>
        <td><span style="background:${typeColor}20;color:${typeColor};padding:3px 8px;border-radius:4px;font-size:0.72rem;font-weight:700;">${tx.transaction_type}</span></td>
        <td class="mono" style="font-size:0.82rem;">${sender?.login_id || 'System'}</td>
        <td class="mono" style="font-size:0.82rem;">${receiver?.login_id || 'System'}</td>
        <td class="text-muted" style="font-size:0.8rem;">${tx.notes || '—'}</td>
        <td class="mono" style="text-align:right;color:${typeColor};font-weight:700;">🪙 ${parseFloat(tx.amount||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
      </tr>`;
    }).join('');
  }
}

// ── RENDER MARKETS ────────────────────────────────────────────────
function renderMarkets() {
  let events = allEvents;
  if (catFilter !== 'ALL') events = events.filter(e => e.category === catFilter);

  const tbody = document.getElementById('marketsTableBody');
  if (events.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#475569;padding:32px;">No markets match the current filter</td></tr>';
    return;
  }
  tbody.innerHTML = events.map(ev => {
    const ocs = allOutcomes.filter(o => o.event_id === ev.id);
    const vol = ocs.reduce((s, o) => s + parseFloat(o.total_volume || 0), 0);
    const res = ev.resolution_date ? new Date(ev.resolution_date).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
    const badge = eventStatusBadge(ev.status || 'ACTIVE');
    const isSettled = ev.status === 'SETTLED' || ev.status === 'VOID' || ev.is_resolved;
    const isFancy = ev.market_type === 'FANCY';
    const isSimActive = simIntervals[ev.id] != null;
    const typeBadge = isFancy
      ? `<span style="background:rgba(139,92,246,0.15);border:1px solid rgba(139,92,246,0.4);color:#a78bfa;padding:1px 6px;border-radius:3px;font-size:0.68rem;margin-left:6px;">FANCY</span>`
      : `<span style="background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.3);color:#60a5fa;padding:1px 6px;border-radius:3px;font-size:0.68rem;margin-left:6px;">MATCH</span>`;

    // Outcome pills: match shows khai/lagai, fancy shows line
    const outcomePills = isFancy
      ? (() => { const lv = parseFloat(ev.line_value ?? ev.base_line ?? 0); const g = parseInt(ev.fancy_gap || 1); const ln = g===1?Math.floor(lv):Math.round(lv)-1; const ly = g===1?Math.ceil(lv):Math.round(lv)+1; return `<span style="background:#0f172a;border:1px solid #334155;padding:2px 8px;border-radius:4px;font-size:0.72rem;"><strong style="color:#ef4444;">${ln}</strong> / <strong style="color:#10b981;">${ly}</strong></span>`; })()
         <span style="background:#0f172a;border:1px solid #334155;padding:2px 8px;border-radius:4px;font-size:0.72rem;margin-left:4px;">${fancyTypeLabel(ev.fancy_type)}</span>`
      : (() => {
          const l = parseFloat(ev.lagai_rate ?? 0.50).toFixed(2);
          const k = parseFloat((parseFloat(l) + 0.05)).toFixed(2);
          const rTeam = ev.rate_team || (ocs[0]?.title ?? '—');
          return `<span style="background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.25);padding:3px 9px;border-radius:4px;font-size:0.72rem;margin-right:4px;">
            L <strong style="color:#10b981;">${l}</strong>
          </span>
          <span style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);padding:3px 9px;border-radius:4px;font-size:0.72rem;margin-right:4px;">
            K <strong style="color:#f87171;">${k}</strong>
          </span>
          <span style="color:#64748b;font-size:0.68rem;">vs ${sanitize(rTeam)}</span>`;
        })();

    return `<tr>
      <td>
        <div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;">
          <span class="text-white">${sanitize(ev.title)}</span>${typeBadge}
        </div>
        ${ev.sub_category ? `<div class="text-muted" style="font-size:0.75rem;margin-top:2px;">${sanitize(ev.sub_category)}</div>` : ''}
      </td>
      <td>${sanitize(ev.category)}</td>
      <td>${outcomePills}</td>
      <td>${badge}</td>
      <td class="text-muted" style="font-size:0.8rem;">${res}</td>
      <td class="mono text-muted">🪙 ${vol.toLocaleString()}</td>
      <td style="text-align:right;">
        <div class="btn-group" style="justify-content:flex-end;flex-wrap:wrap;gap:4px;">
          ${!isSettled ? `
            <button class="btn btn-sm ${isSimActive ? 'btn-warning' : 'btn-ghost'}" onclick="toggleSim('${ev.id}')" title="${isSimActive ? 'Stop simulation' : 'Start price/line simulation'}">${isSimActive ? '⏹ Sim' : '▶ Sim'}</button>
            <button class="btn btn-warning btn-sm" onclick="toggleEventStatus('${ev.id}', '${ev.status || 'ACTIVE'}')">${ev.status === 'SUSPENDED' ? '▶ Live' : '⏸ Pause'}</button>
            ${isFancy
              ? `<button class="btn btn-success btn-sm" onclick="openSettleModal('${ev.id}')">✅ Settle</button>`
              : `<button class="btn btn-success btn-sm" onclick="openResultModal('${ev.id}')">🏆 Result</button>`
            }
            <button class="btn btn-danger btn-sm" onclick="voidMarket('${ev.id}')">🚫 Void</button>
          ` : `<span style="color:#64748b;font-size:0.8rem;">${ev.status === 'VOID' ? 'Voided' : 'Settled'} ✓</span>`}
          <button class="btn btn-ghost btn-sm btn-icon" onclick="duplicateEvent('${ev.id}')" title="Duplicate market">📋</button>
          <button class="btn btn-danger btn-sm btn-icon" onclick="deleteEvent('${ev.id}')">🗑</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function fancyTypeLabel(type) {
  const map = { '6_OVER_RUNS':'6 Overs', '10_OVER_RUNS':'10 Overs', '15_OVER_RUNS':'15 Overs', 'PLAYER_RUNS':'Player', 'CUSTOM':'Custom' };
  return map[type] || (type || 'Fancy');
}

function eventStatusBadge(status) {
  if (!status || status === 'ACTIVE') return `<span class="badge badge-live"><span class="status-dot"></span> Live</span>`;
  if (status === 'SUSPENDED') return `<span class="badge badge-suspended-event">⏸ Suspended</span>`;
  if (status === 'SETTLED') return `<span class="badge badge-settled">✅ Settled</span>`;
  if (status === 'VOID') return `<span class="badge badge-void">🚫 Void</span>`;
  return `<span class="badge badge-scheduled">${status}</span>`;
}

// ── RENDER RISK ───────────────────────────────────────────────────
function renderRisk() {
  const openPositions = allOrders.length;
  const totalVol = allOrders.reduce((s, o) => s + parseFloat(o.total_cost || 0), 0);
  document.getElementById('riskOpenPositions').textContent = openPositions;
  document.getElementById('riskWorstCase').textContent = totalVol.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2});
  document.getElementById('riskCommission').textContent = '0.00';

  const tbody = document.getElementById('riskTableBody');
  const activeEvents = allEvents.filter(e => e.status !== 'SETTLED');

  if (activeEvents.length === 0 || allOrders.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#475569;padding:32px;">Risk data will populate when bets are placed</td></tr>';
    return;
  }

  tbody.innerHTML = activeEvents.map(ev => {
    const ocs = allOutcomes.filter(o => o.event_id === ev.id);
    const eventOrders = allOrders.filter(o => ocs.some(oc => oc.id === o.outcome_id));
    const vol = eventOrders.reduce((s, o) => s + parseFloat(o.total_cost || 0), 0);

    // For each outcome: worst case = sum of positions in that outcome
    const liabilities = ocs.map(oc => {
      const ocOrders = eventOrders.filter(o => o.outcome_id === oc.id && o.order_type === 'BUY');
      const shares = ocOrders.reduce((s, o) => s + parseFloat(o.shares || 0), 0);
      return { title: oc.title, liability: shares };
    });
    const worst = liabilities.reduce((a, b) => a.liability > b.liability ? a : b, { title: '—', liability: 0 });
    const best = liabilities.reduce((a, b) => a.liability < b.liability ? a : b, { title: '—', liability: 0 });
    const pct = worst.liability > 0 ? Math.min(100, (worst.liability / (vol || 1)) * 100) : 0;

    return `<tr>
      <td class="text-white">${ev.title}</td>
      <td>${eventStatusBadge(ev.status)}</td>
      <td class="mono">🪙 ${vol.toLocaleString()}</td>
      <td>
        <div style="display:flex;justify-content:space-between;font-size:0.8rem;font-family:'JetBrains Mono',monospace;">
          <span style="color:#ef4444;">-🪙${worst.liability.toLocaleString()}</span>
          <span class="text-muted">(${worst.title})</span>
        </div>
        <div class="risk-bar"><div class="risk-fill" style="background:#ef4444;width:${pct}%;"></div></div>
      </td>
      <td>
        <div style="font-size:0.8rem;font-family:'JetBrains Mono',monospace;color:#10b981;">+🪙${best.liability.toLocaleString()} (${best.title})</div>
      </td>
      <td style="text-align:right;">
        <button class="btn btn-danger btn-sm" onclick="toggleEventStatus('${ev.id}', '${ev.status||'ACTIVE'}')">🚨 Suspend</button>
      </td>
    </tr>`;
  }).join('');
}

// ── RENDER BET LOG ────────────────────────────────────────────────
function renderBetLog() {
  const today = new Date(); today.setHours(0,0,0,0);
  const todayOrders = allOrders.filter(o => new Date(o.created_at) >= today);
  const totalVol = allOrders.reduce((s, o) => s + parseFloat(o.total_cost || 0), 0);
  const avgBet = allOrders.length ? totalVol / allOrders.length : 0;

  document.getElementById('betlogToday').textContent = todayOrders.length;
  document.getElementById('betlogVolume').textContent = totalVol.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2});
  document.getElementById('betlogAvg').textContent = avgBet.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2});

  // Populate event filter dropdown (once)
  const eventSel = document.getElementById('betlogEventFilter');
  if (eventSel && eventSel.options.length <= 1 && allEvents.length > 0) {
    allEvents.forEach(ev => {
      const opt = document.createElement('option');
      opt.value = ev.id;
      opt.textContent = ev.title.substring(0, 45) + (ev.title.length > 45 ? '…' : '');
      eventSel.appendChild(opt);
    });
  }

  // Apply filters
  const dateFrom = document.getElementById('betlogFrom')?.value;
  const dateTo = document.getElementById('betlogTo')?.value;
  const evFilter = document.getElementById('betlogEventFilter')?.value;
  const userQ = (document.getElementById('betlogUserSearch')?.value || '').toLowerCase();

  let orders = [...allOrders];
  if (dateFrom) orders = orders.filter(o => new Date(o.created_at) >= new Date(dateFrom));
  if (dateTo) orders = orders.filter(o => new Date(o.created_at) <= new Date(dateTo + 'T23:59:59'));
  if (evFilter) {
    const outcomeIds = allOutcomes.filter(oc => oc.event_id === evFilter).map(oc => oc.id);
    orders = orders.filter(o => outcomeIds.includes(o.outcome_id));
  }
  if (userQ) {
    orders = orders.filter(o => {
      const user = allUsers.find(u => u.id === o.user_id);
      return (user?.login_id || '').toLowerCase().includes(userQ);
    });
  }

  const tbody = document.getElementById('betlogTableBody');
  if (orders.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#475569;padding:32px;">No bets match the current filters</td></tr>';
    return;
  }
  tbody.innerHTML = orders.slice(0, 200).map(o => {
    const user = allUsers.find(u => u.id === o.user_id);
    const outcome = allOutcomes.find(oc => oc.id === o.outcome_id);
    const event = outcome ? allEvents.find(ev => ev.id === outcome.event_id) : null;
    const typeColor = o.order_type === 'BUY' ? '#3b82f6' : '#ec4899';
    return `<tr>
      <td class="text-muted" style="font-size:0.8rem;white-space:nowrap;">${new Date(o.created_at).toLocaleString()}</td>
      <td class="mono">${user?.login_id || '—'}</td>
      <td>
        <div style="font-size:0.8rem;color:white;">${event?.title || '—'}</div>
        <div style="font-size:0.72rem;color:#64748b;">${outcome?.title || '—'}</div>
      </td>
      <td><span style="background:${typeColor}20;color:${typeColor};padding:3px 8px;border-radius:4px;font-size:0.72rem;font-weight:700;">${o.order_type}</span></td>
      <td class="mono">${parseFloat(o.shares||0).toLocaleString()}</td>
      <td class="mono">${parseFloat(o.price_per_share||0)}¢</td>
      <td class="mono">🪙 ${parseFloat(o.total_cost||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
    </tr>`;
  }).join('');
}

// ── RENDER BROADCAST ──────────────────────────────────────────────
function renderBroadcast() {
  const list = document.getElementById('announcementsList');
  if (allAnnouncements.length === 0) {
    list.innerHTML = '<div class="empty"><div class="empty-icon">📭</div><div class="empty-text">No announcements sent</div></div>';
    return;
  }
  list.innerHTML = allAnnouncements.map(a => {
    const timeStr = new Date(a.created_at).toLocaleString();
    const activeBadge = a.is_active ? `<span class="badge badge-active">Live</span>` : `<span class="badge" style="background:#334155;color:#64748b;">Expired</span>`;
    return `<div class="announcement-card">
      <div class="announcement-msg">${a.message}</div>
      <div class="announcement-meta">
        ${activeBadge}
        <span class="announcement-time">${timeStr}</span>
        <button class="btn btn-danger btn-sm" style="margin-left:auto;" onclick="deleteAnnouncement('${a.id}')">Delete</button>
      </div>
    </div>`;
  }).join('');
}

// ── RENDER SETTINGS ───────────────────────────────────────────────
function renderSettings() {
  const totalInMarket = allUsers.filter(u => u.role !== 'ADMIN').reduce((s, u) => s + parseFloat(u.balance || 0), 0);
  document.getElementById('settingsAdminBal').textContent = totalInMarket.toLocaleString(undefined, {minimumFractionDigits:2});
  document.getElementById('statTotalUsers').textContent = allUsers.length;
  document.getElementById('statTotalTx').textContent = allTransactions.length;
  document.getElementById('statTotalEvents').textContent = allEvents.length;
  document.getElementById('statTotalOrders').textContent = allOrders.length;
  loadPlatformConfig();
  renderBalanceSheet();
}

function computeBalanceSheet() {
  const adminUser   = allUsers.find(u => u.id === currentUser.id);
  const agents      = allUsers.filter(u => u.role === 'AGENT');
  const clients     = allUsers.filter(u => u.role === 'CLIENT');
  const agentIds    = new Set(agents.map(a => a.id));

  // --- ASSETS ---
  const coinsWithAgents  = agents.reduce((s, a) => s + parseFloat(a.balance || 0), 0);
  const coinsWithClients = clients.reduce((s, c) => s + parseFloat(c.balance || 0), 0);
  const totalCoins       = coinsWithAgents + coinsWithClients; // admin holds nothing; coins are minted on deposit

  // Agent receivable: coins given to agents on credit − returned − cash settled
  const givenToAgents    = allTransactions.filter(t => t.transaction_type === 'DEPOSIT'    && t.sender_id   === currentUser.id && agentIds.has(t.receiver_id)).reduce((s,t)=>s+parseFloat(t.amount||0),0);
  const returnedByAgents = allTransactions.filter(t => t.transaction_type === 'WITHDRAWAL' && t.receiver_id === currentUser.id && agentIds.has(t.sender_id)).reduce((s,t)=>s+parseFloat(t.amount||0),0);
  const cashSettled      = allTransactions.filter(t => t.transaction_type === 'AGENT_SETTLEMENT').reduce((s,t)=>s+parseFloat(t.amount||0),0);
  const agentReceivable  = givenToAgents - returnedByAgents - cashSettled;

  // Reserve cash = real cash actually received from settlements
  const reserveCash = cashSettled;

  // --- EQUITY ---
  const ownerEquity = allTransactions.filter(t => t.transaction_type === 'ADMIN_MINT').reduce((s,t)=>s+parseFloat(t.amount||0),0);

  // --- P&L from betting ---
  const settledOrders   = allOrders.filter(o => o.status === 'SETTLED');
  const totalStakesLost = settledOrders.reduce((s, o) => s + parseFloat(o.total_cost || 0), 0);
  const totalPayoutsWon = allTransactions.filter(t => t.transaction_type === 'SETTLEMENT').reduce((s,t)=>s+parseFloat(t.amount||0),0);
  const platformPnl     = totalStakesLost - totalPayoutsWon; // positive = platform profit

  return { coinsWithAgents, coinsWithClients, totalCoins, agentReceivable, reserveCash, ownerEquity, platformPnl, totalStakesLost, totalPayoutsWon };
}

function renderBalanceSheet() {
  const bs = computeBalanceSheet();
  const fmt = n => n.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2});
  document.getElementById('bsWithAgents').textContent       = fmt(bs.coinsWithAgents);
  document.getElementById('bsWithClients').textContent      = fmt(bs.coinsWithClients);
  document.getElementById('bsTotalCoins').textContent       = fmt(bs.totalCoins);
  document.getElementById('bsAgentReceivable').textContent  = fmt(bs.agentReceivable);
  document.getElementById('bsReserveCash').textContent      = fmt(bs.reserveCash);
  document.getElementById('bsOwnerEquity').textContent      = fmt(bs.ownerEquity);
  const pnlEl = document.getElementById('bsPlatformPnl');
  pnlEl.textContent = (bs.platformPnl >= 0 ? '+' : '') + fmt(bs.platformPnl);
  pnlEl.parentElement.style.color = bs.platformPnl >= 0 ? '#10b981' : '#ef4444';

  // Integrity check
  const noteEl = document.getElementById('bsIntegrityNote');
  if (bs.ownerEquity === 0) {
    noteEl.textContent = 'ℹ️ No coins deployed yet. Deposit coins to agents or clients to start — each deposit auto-tracks Owner Equity.';
  } else {
    const expected = bs.ownerEquity - bs.platformPnl;
    const diff = Math.abs(bs.totalCoins - expected);
    if (diff < 0.01) {
      noteEl.innerHTML = '✅ <strong>Coins balanced:</strong> Total Coins = Owner Equity − P&L profit (or + P&L loss). Ledger is consistent.';
      noteEl.style.color = '#10b981';
    } else {
      noteEl.innerHTML = `⚠️ <strong>Imbalance detected:</strong> Expected 🪙${fmt(expected)} in circulation, found 🪙${fmt(bs.totalCoins)} (diff: ${fmt(diff)}). Check for manual adjustments.`;
      noteEl.style.color = '#f59e0b';
    }
  }
}

// ── CREATE USER ───────────────────────────────────────────────────
function openCreateUserModal(role, forceParentId) {
  document.getElementById('createUserForm').style.display = 'block';
  document.getElementById('createUserSuccess').style.display = 'none';
  document.getElementById('createUserTitle').textContent = `New ${role} Account`;
  document.getElementById('newUserRole').value = role;
  document.getElementById('newUserName').value = '';
  document.getElementById('newUserPhone').value = '';
  document.getElementById('newUserBalance').value = role === 'AGENT' ? '50000' : '5000';
  document.getElementById('newUserMatchComm').value = platformConfig['default_match_comm'] || '0.5';
  document.getElementById('newUserFancyComm').value = platformConfig['default_fancy_comm'] || '1.0';
  document.getElementById('newUserMatchComm').max = 100;
  document.getElementById('newUserFancyComm').max = 100;
  document.getElementById('commissionRow').style.display = (role === 'AGENT' || role === 'CLIENT') ? 'grid' : 'none';
  document.getElementById('shareRow').style.display = role === 'AGENT' ? 'block' : 'none';

  // Update commission field labels based on role
  const commLabel = document.querySelector('#commissionRow label:first-of-type');
  if (commLabel) commLabel.textContent = role === 'CLIENT' ? 'Match Comm. (%) *' : 'Match Comm. (%)';
  document.getElementById('commHint').textContent = '';

  document.getElementById('createUserError').textContent = '';

  // Parent agent selector (for client creation)
  const parentRow = document.getElementById('parentAgentRow');
  const parentSel = document.getElementById('newUserParentAgent');
  if (role === 'CLIENT') {
    const agents = allUsers.filter(u => u.role === 'AGENT' && u.status !== 'SUSPENDED');
    parentSel.innerHTML = `<option value="">— Admin (no agent) —</option>` +
      agents.map(a => `<option value="${a.id}" data-bal="${parseFloat(a.balance||0).toFixed(2)}" data-mc="${a.match_commission??0}" data-fc="${a.fancy_commission??0}" ${a.id === forceParentId ? 'selected' : ''}>${a.login_id} · ${a.name || ''} · 🪙${parseFloat(a.balance||0).toLocaleString()}</option>`).join('');
    parentRow.style.display = 'block';

    // Dynamically update the balance hint and commission caps when agent selection changes
    parentSel.onchange = () => {
      const sel = parentSel.options[parentSel.selectedIndex];
      if (sel.value) {
        const bal = parseFloat(sel.dataset.bal || 0);
        const label = `${sel.text.split('·')[0].trim()}'s balance`;
        document.getElementById('adminBalHint').innerHTML =
          `${label}: 🪙 <span id="modalAdminBal">${bal.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</span>`;
      } else {
        document.getElementById('adminBalHint').innerHTML = `🪙 Coins minted on demand — no admin balance limit`;
      }
      // Cap commission fields at agent's own rates
      if (sel.value) {
        const maxMc = parseFloat(sel.dataset.mc || 0);
        const maxFc = parseFloat(sel.dataset.fc || 0);
        document.getElementById('newUserMatchComm').max = maxMc;
        document.getElementById('newUserMatchComm').value = Math.min(parseFloat(document.getElementById('newUserMatchComm').value)||0, maxMc);
        document.getElementById('newUserFancyComm').max = maxFc;
        document.getElementById('newUserFancyComm').value = Math.min(parseFloat(document.getElementById('newUserFancyComm').value)||0, maxFc);
        document.getElementById('commHint').textContent = `Max: Match ${maxMc}% · Fancy ${maxFc}% (agent's rates)`;
      } else {
        document.getElementById('newUserMatchComm').max = 100;
        document.getElementById('newUserFancyComm').max = 100;
        document.getElementById('commHint').textContent = '';
      }
    };
  } else {
    parentRow.style.display = 'none';
    parentSel.onchange = null;
  }

  document.getElementById('adminBalHint').innerHTML =
    `🪙 Coins minted on demand — no admin balance limit`;
  // If opened with a forced agent pre-selected, trigger the onchange immediately
  if (forceParentId && role === 'CLIENT') parentSel.dispatchEvent(new Event('change'));
  openModal('modalCreateUser');
}

async function submitCreateUser() {
  const btn = document.getElementById('createUserBtn');
  const errEl = document.getElementById('createUserError');
  errEl.textContent = '';
  btn.disabled = true; btn.textContent = 'Processing…';

  try {
    const role = document.getElementById('newUserRole').value;
    const name = document.getElementById('newUserName').value.trim();
    const phone = document.getElementById('newUserPhone').value.trim();
    const startBal = parseFloat(document.getElementById('newUserBalance').value) || 0;
    const mComm = parseFloat(document.getElementById('newUserMatchComm').value) || 0;
    const fComm = parseFloat(document.getElementById('newUserFancyComm').value) || 0;
    const share = parseFloat(document.getElementById('newUserShare').value) || 0;

    // Platform-wide registration gate (applies to admin too)
    if (role === 'CLIENT' && platformConfig['new_registrations'] === 'false') {
      throw new Error('New client registrations are currently disabled platform-wide. Enable them in Settings first.');
    }

    if (!name || !phone) throw new Error('Please fill in all required fields.');
    if (!/^\d{10}$/.test(phone)) throw new Error('Phone must be exactly 10 digits.');

    // For CLIENT: validate commission caps against parent agent's rates
    if (role === 'CLIENT') {
      const selectedParentForVal = document.getElementById('newUserParentAgent')?.value || '';
      if (selectedParentForVal) {
        const parentAgent = allUsers.find(u => u.id === selectedParentForVal);
        if (parentAgent) {
          if (mComm > (parentAgent.match_commission ?? 0))
            throw new Error(`Match commission ${mComm}% exceeds agent's rate of ${parentAgent.match_commission ?? 0}%.`);
          if (fComm > (parentAgent.fancy_commission ?? 0))
            throw new Error(`Fancy commission ${fComm}% exceeds agent's rate of ${parentAgent.fancy_commission ?? 0}%.`);
        }
      }
    }

    const loginId = await AuthSystem.generateUniqueId(role);
    const password = AuthSystem.generatePassword();
    const email = AuthSystem.toEmail(loginId);

    // Use a temp no-persist client so admin's session is NOT overwritten
    // (Supabase signUp auto-signs-in the new user when email confirmation is disabled)
    const _tmp = window.supabase.createClient(window._sbConfig.url, window._sbConfig.key, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data: authData, error: signupErr } = await _tmp.auth.signUp({ email, password });
    if (signupErr) throw new Error(signupErr.message);

    // For clients, parent can be a specific agent or admin
    const selectedParent = document.getElementById('newUserParentAgent')?.value || '';
    const parentId = (role === 'CLIENT' && selectedParent) ? selectedParent : currentUser.id;

    // Determine who funds this user: agent funds their own client, admin funds everything else
    const funderId = (role === 'CLIENT' && selectedParent) ? selectedParent : currentUser.id;

    // Re-fetch funder's live balance — only agents have a balance constraint; admin mints freely
    let funderRow = null;
    if (funderId !== currentUser.id) {
      const { data: agentData } = await sb.from('betting_users').select('balance,login_id').eq('id', funderId).single();
      funderRow = agentData;
      if (parseFloat(funderRow.balance) < startBal) {
        throw new Error(`Insufficient balance. ${funderRow.login_id} only has 🪙${parseFloat(funderRow.balance).toLocaleString()}, trying to issue 🪙${startBal.toLocaleString()}.`);
      }
    }

    const newUserRecord = {
      id: authData.user.id,
      login_id: loginId, role, name, phone,
      parent_id: parentId,
      balance: startBal,
      credit_limit: startBal,
      match_commission: mComm,
      fancy_commission: fComm,
      status: 'ACTIVE',
      initial_password: password
    };
    // partnership_share only applies to agents
    if (role === 'AGENT') newUserRecord.partnership_share = share;
    const { error: insertErr } = await sb.from('betting_users').insert(newUserRecord);
    if (insertErr) throw new Error(insertErr.message);

    if (startBal > 0) {
      if (funderId === currentUser.id) {
        // Admin is minting — auto-track as owner equity, no balance deducted
        await sb.from('credit_transactions').insert({ sender_id: currentUser.id, receiver_id: currentUser.id, amount: startBal, transaction_type: 'ADMIN_MINT', notes: `Capital deployment to new ${role.toLowerCase()} ${loginId}` });
      } else {
        // Agent funds own client — deduct agent's balance
        const newFunderBal = parseFloat(funderRow.balance) - startBal;
        await sb.from('betting_users').update({ balance: newFunderBal }).eq('id', funderId);
      }
      await sb.from('credit_transactions').insert({
        sender_id: funderId, receiver_id: authData.user.id,
        amount: startBal, transaction_type: 'DEPOSIT',
        notes: `Initial balance for new ${role.toLowerCase()} ${loginId}`
      });
    }

    await auditLog('CREATE_' + role, {
      targetId: authData.user.id,
      targetLoginId: loginId,
      amount: startBal > 0 ? startBal : null,
      extra: { role, name, phone }
    });

    document.getElementById('genLoginId').textContent = loginId;
    document.getElementById('genPassword').textContent = password;
    document.getElementById('createUserForm').style.display = 'none';
    document.getElementById('createUserSuccess').style.display = 'block';
    showToast(`${role} ${loginId} created successfully!`, 'success');
    await refreshData();
  } catch(err) {
    errEl.textContent = err.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Generate Credentials';
  }
}

// ── FUNDS (DEPOSIT/WITHDRAW) ──────────────────────────────────────
function openFundsModal(userId, type) {
  const user = allUsers.find(u => u.id === userId);
  if (!user) return;
  document.getElementById('fundsUserId').value = userId;
  document.getElementById('fundsType').value = type;
  document.getElementById('fundsModalTitle').textContent = `${type === 'DEPOSIT' ? '+ Deposit' : '- Withdraw'} — ${user.login_id}`;
  document.getElementById('fundsTargetId').textContent = `${user.login_id} · ${user.name || ''}`;
  document.getElementById('fundsTargetBal').textContent = `Current Balance: 🪙 ${parseFloat(user.balance||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  document.getElementById('fundsAmountLabel').textContent = `Amount to ${type === 'DEPOSIT' ? 'Deposit (🪙)' : 'Withdraw (🪙)'}`;
  document.getElementById('fundsAmount').value = '';
  document.getElementById('fundsNote').value = '';
  document.getElementById('fundsError').textContent = '';
  const btn = document.getElementById('fundsSubmitBtn');
  btn.className = type === 'DEPOSIT' ? 'btn btn-success' : 'btn btn-danger';
  btn.textContent = type === 'DEPOSIT' ? 'Confirm Deposit' : 'Confirm Withdrawal';
  openModal('modalFunds');
}

async function submitFunds() {
  const userId = document.getElementById('fundsUserId').value;
  const type = document.getElementById('fundsType').value;
  const amount = parseFloat(document.getElementById('fundsAmount').value);
  const note = document.getElementById('fundsNote').value.trim();
  const errEl = document.getElementById('fundsError');
  errEl.textContent = '';

  if (!amount || isNaN(amount) || amount <= 0) { errEl.textContent = 'Enter a valid amount.'; return; }

  const user = allUsers.find(u => u.id === userId);
  if (!user) return;

  try {
    if (type === 'DEPOSIT') {
      const newUserBal = parseFloat(user.balance || 0) + amount;

      // Credit limit check — warn if deposit would exceed limit
      const creditLimit = parseFloat(user.credit_limit || 0);
      if (creditLimit > 0 && newUserBal > creditLimit) {
        const over = (newUserBal - creditLimit).toLocaleString(undefined, { minimumFractionDigits: 2 });
        if (!confirm(`⚠️ Credit Limit Warning\n\n${user.login_id}'s balance will reach 🪙${newUserBal.toLocaleString()} — 🪙${over} over their credit limit of 🪙${creditLimit.toLocaleString()}.\n\nProceed anyway?`)) return;
      }
      // Auto-mint: record capital deployment as owner equity
      await sb.from('credit_transactions').insert({ sender_id: currentUser.id, receiver_id: currentUser.id, amount, transaction_type: 'ADMIN_MINT', notes: `Capital deployment to ${user.login_id}` });
      // Insert DEPOSIT transaction — admin is virtual sender (no balance deducted)
      const { error: txErr } = await sb.from('credit_transactions').insert({ sender_id: currentUser.id, receiver_id: userId, amount, transaction_type: 'DEPOSIT', notes: note || null });
      if (txErr) throw new Error(txErr.message);
      const { error: e2 } = await sb.from('betting_users').update({ balance: newUserBal }).eq('id', userId);
      if (e2) throw new Error(e2.message);
      await auditLog('DEPOSIT', { targetId: userId, targetLoginId: user.login_id, amount, extra: { note: note || null } });
      showToast(`Deposited 🪙${amount.toLocaleString()} to ${user.login_id}`, 'success');
    } else {
      if (parseFloat(user.balance || 0) < amount) throw new Error(`Insufficient user balance. ${user.login_id} only has 🪙${user.balance}.`);
      const newUserBal = parseFloat(user.balance || 0) - amount;
      // Insert transaction record FIRST — if this fails, no balances are touched
      const { error: txErr } = await sb.from('credit_transactions').insert({ sender_id: userId, receiver_id: currentUser.id, amount, transaction_type: 'WITHDRAWAL', notes: note || null });
      if (txErr) throw new Error(txErr.message);
      const { error: e1 } = await sb.from('betting_users').update({ balance: newUserBal }).eq('id', userId);
      if (e1) throw new Error(e1.message);
      // Chips are retired (burned) regardless of role — admin holds no balance
      // For AGENT returns: coins leave circulation; agent receivable is tracked via transactions
      // For CLIENT: cash settlement — client chips burned
      await auditLog('WITHDRAWAL', { targetId: userId, targetLoginId: user.login_id, amount, extra: { note: note || null } });
      const toastMsg = user.role === 'CLIENT'
        ? `Cash settled 🪙${amount.toLocaleString()} with ${user.login_id} (chips burned)`
        : `Withdrawn 🪙${amount.toLocaleString()} from ${user.login_id}`;
      showToast(toastMsg, 'success');
    }
    closeModal('modalFunds');
    await refreshData();
  } catch(err) { errEl.textContent = err.message; }
}

// ── EDIT USER ─────────────────────────────────────────────────────
function openEditModal(userId) {
  const user = allUsers.find(u => u.id === userId);
  if (!user) return;
  document.getElementById('editUserId').value    = userId;
  document.getElementById('editUserRole').value  = user.role;
  document.getElementById('editUserLoginId').textContent = user.login_id;
  document.getElementById('editUserName').value  = user.name || '';
  document.getElementById('editUserPhone').value = user.phone || '';
  document.getElementById('editMatchComm').value = user.match_commission ?? 0;
  document.getElementById('editFancyComm').value = user.fancy_commission ?? 0;
  document.getElementById('editShare').value     = user.partnership_share ?? 0;
  document.getElementById('editCreditLimit').value = user.credit_limit ?? 0;
  // If this is a client whose parent agent is suspended, lock status to SUSPENDED
  const parentAgent = user.role === 'CLIENT' && user.parent_id
    ? allUsers.find(u => u.id === user.parent_id)
    : null;
  const agentIsSuspended = parentAgent?.status === 'SUSPENDED';
  const statusEl = document.getElementById('editStatus');
  statusEl.value = agentIsSuspended ? 'SUSPENDED' : (user.status || 'ACTIVE');
  // Disable ACTIVE option when agent is suspended
  Array.from(statusEl.options).forEach(opt => {
    opt.disabled = (agentIsSuspended && opt.value === 'ACTIVE');
  });
  const statusNote = document.getElementById('editStatusNote');
  if (statusNote) {
    statusNote.textContent = agentIsSuspended ? `⚠️ Cannot activate — parent agent (${parentAgent.login_id}) is suspended.` : '';
    statusNote.style.display = agentIsSuspended ? 'block' : 'none';
  }
  document.getElementById('editUserNotes').value   = user.notes || '';
  document.getElementById('editUserError').textContent = '';
  // Show commission row for both AGENT and CLIENT; share row only for AGENT
  document.getElementById('editCommRow').style.display   = 'grid';
  document.getElementById('editShareRow').style.display  = user.role === 'AGENT' ? 'block' : 'none';
  // For CLIENT: cap commission fields at parent agent's rates and add hint
  const editCommHint = document.getElementById('editCommHint');
  if (user.role === 'CLIENT' && user.parent_id) {
    const pa = allUsers.find(u => u.id === user.parent_id);
    if (pa) {
      document.getElementById('editMatchComm').max = pa.match_commission ?? 100;
      document.getElementById('editFancyComm').max  = pa.fancy_commission ?? 100;
      if (editCommHint) { editCommHint.textContent = `Max: Match ${pa.match_commission??0}% · Fancy ${pa.fancy_commission??0}% (agent ${pa.login_id}'s rates)`; editCommHint.style.display='block'; }
    }
  } else {
    document.getElementById('editMatchComm').max = 100;
    document.getElementById('editFancyComm').max  = 100;
    if (editCommHint) editCommHint.style.display = 'none';
  }
  openModal('modalEditUser');
}

async function submitEditUser() {
  const userId = document.getElementById('editUserId').value;
  const role   = document.getElementById('editUserRole').value;
  const errEl  = document.getElementById('editUserError');
  errEl.textContent = '';
  try {
    const oldUser = allUsers.find(u => u.id === userId);
    const newStatus = document.getElementById('editStatus').value;
    const isSuspending = oldUser?.status === 'ACTIVE' && newStatus === 'SUSPENDED';
    const isActivating = oldUser?.status === 'SUSPENDED' && newStatus === 'ACTIVE';

    // Block activation of a client whose parent agent is suspended
    if (isActivating && role === 'CLIENT' && oldUser?.parent_id) {
      const parentAgent = allUsers.find(u => u.id === oldUser.parent_id);
      if (parentAgent?.status === 'SUSPENDED')
        throw new Error(`Cannot activate client — parent agent ${parentAgent.login_id} is suspended. Activate the agent first.`);
    }

    const phone = document.getElementById('editUserPhone').value.trim() || null;
    if (phone) {
      const dup = allUsers.find(u => u.phone === phone && u.id !== userId);
      if (dup) throw new Error(`Phone already registered to ${dup.login_id}. Use a different number.`);
    }

    const updates = {
      name:         document.getElementById('editUserName').value.trim() || null,
      phone,
      credit_limit: parseFloat(document.getElementById('editCreditLimit').value) || 0,
      notes:        document.getElementById('editUserNotes').value.trim() || null,
      status:       newStatus
    };
    const newMc = parseFloat(document.getElementById('editMatchComm').value) || 0;
    const newFc = parseFloat(document.getElementById('editFancyComm').value) || 0;
    updates.match_commission = newMc;
    updates.fancy_commission = newFc;
    // For CLIENT: validate commission caps against parent agent
    if (role === 'CLIENT' && oldUser?.parent_id) {
      const pa = allUsers.find(u => u.id === oldUser.parent_id);
      if (pa) {
        if (newMc > (pa.match_commission ?? 0)) throw new Error(`Match commission ${newMc}% exceeds agent ${pa.login_id}'s rate of ${pa.match_commission??0}%.`);
        if (newFc > (pa.fancy_commission ?? 0)) throw new Error(`Fancy commission ${newFc}% exceeds agent ${pa.login_id}'s rate of ${pa.fancy_commission??0}%.`);
      }
    }
    if (role === 'AGENT') {
      updates.partnership_share = parseFloat(document.getElementById('editShare').value) || 0;
    }
    const { error } = await sb.from('betting_users').update(updates).eq('id', userId);
    if (error) throw new Error(error.message);

    // Cascade suspension: if suspending an agent, suspend all their clients too
    if (isSuspending && role === 'AGENT') {
      const children = allUsers.filter(u => u.parent_id === userId);
      if (children.length > 0) {
        await sb.from('betting_users').update({ status: 'SUSPENDED' }).in('id', children.map(c => c.id));
        showToast(`Agent suspended — ${children.length} client(s) also suspended`, 'info');
      }
    }

    // Cascade activation: if re-activating an agent, re-activate all their clients too
    if (isActivating && role === 'AGENT') {
      const children = allUsers.filter(u => u.parent_id === userId);
      if (children.length > 0) {
        await sb.from('betting_users').update({ status: 'ACTIVE' }).in('id', children.map(c => c.id));
        showToast(`Agent activated — ${children.length} client(s) also re-activated`, 'info');
      }
    }

    const action = isSuspending ? 'SUSPEND_USER' : isActivating ? 'ACTIVATE_USER' : 'UPDATE_USER';
    await auditLog(action, {
      targetId: userId,
      targetLoginId: oldUser?.login_id,
      extra: { role, status: newStatus }
    });

    showToast('User updated successfully', 'success');
    closeModal('modalEditUser');
    await refreshData();
  } catch(err) { errEl.textContent = err.message; }
}

// ── CREATE MATCH ──────────────────────────────────────────────────
function setMarketType(type) {
  document.getElementById('selectedMarketType').value = type;
  document.getElementById('mtype-match').className = type === 'MATCH' ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm';
  document.getElementById('mtype-fancy').className = type === 'FANCY' ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm';
  document.getElementById('matchOutcomesSection').style.display = type === 'MATCH' ? '' : 'none';
  document.getElementById('fancySection').style.display = type === 'FANCY' ? '' : 'none';
}

function openCreateMatchModal() {
  document.getElementById('matchTitle').value      = '';
  document.getElementById('matchSubCat').value     = '';
  document.getElementById('matchResolution').value = '';
  document.getElementById('createMatchError').textContent = '';
  document.getElementById('fancyBaseLine').value   = '';
  document.getElementById('fancyOdds').value       = '1.90';
  // Reset Khai/Lagai fields
  document.getElementById('matchTeam1').value      = '';
  document.getElementById('matchTeam2').value      = '';
  document.getElementById('matchLagaiRate').value  = '0.50';
  document.getElementById('matchStartSim').checked = false;
  updateKhaiPreview();
  setMarketType('MATCH');
  openModal('modalCreateMatch');
}

function addOutcomeRow(defaultOdds = 2.0, defaultName = '') {
  const container = document.getElementById('outcomesContainer');
  const rows = container.querySelectorAll('.outcome-row');
  if (rows.length >= 4) { showToast('Maximum 4 outcomes allowed', 'info'); return; }
  const idx = rows.length;
  const div = document.createElement('div');
  div.className = 'outcome-row';
  div.style.cssText = 'display:grid;grid-template-columns:2fr 1fr auto;gap:6px;margin-bottom:6px;align-items:center;';
  div.innerHTML = `
    <input type="text" class="form-input outcome-name" placeholder="Team / Outcome ${idx+1}" value="${sanitize(defaultName)}" style="margin:0;">
    <input type="number" class="form-input outcome-price mono" placeholder="e.g. 1.40" value="${defaultOdds}" min="1.01" max="999" step="0.05" style="margin:0;">
    ${idx >= 2 ? `<button class="btn btn-danger btn-sm btn-icon" onclick="this.closest('.outcome-row').remove()">✕</button>` : '<div style="width:30px;"></div>'}
  `;
  container.appendChild(div);
}

function updateKhaiPreview() {
  const l = parseFloat(document.getElementById('matchLagaiRate')?.value) || 0.50;
  const k = Math.min(0.95, parseFloat((l + 0.05).toFixed(2)));
  const khaiEl = document.getElementById('matchKhaiPreview');
  const exEl   = document.getElementById('lkExample');
  if (khaiEl) khaiEl.value = k.toFixed(2);
  if (exEl) {
    const t1 = document.getElementById('matchTeam1')?.value || 'Team 1';
    exEl.innerHTML =
      `<strong style="color:white;">Lagai ${t1} @ ${l.toFixed(2)}</strong> — Stake 🪙1000 → Win 🪙${(1000*l).toFixed(0)} → Return 🪙${(1000*(1+l)).toFixed(0)}<br>` +
      `<strong style="color:white;">Khai ${t1} @ ${k.toFixed(2)}</strong> — Stake 🪙1000 → Win 🪙${(1000/k).toFixed(0)} → Return 🪙${(1000*(1+1/k)).toFixed(0)}`;
  }
}

async function submitCreateMatch() {
  const errEl = document.getElementById('createMatchError');
  errEl.textContent = '';
  const title = document.getElementById('matchTitle').value.trim();
  const category = document.getElementById('matchCategory').value;
  const subCat = document.getElementById('matchSubCat').value.trim();
  const resolution = document.getElementById('matchResolution').value;
  const marketType = document.getElementById('selectedMarketType').value;

  if (!title) { errEl.textContent = 'Event title is required.'; return; }

  let ev = null; // hoisted so auto-start sim can reference it after both branches
  try {
    if (marketType === 'MATCH') {
      const team1 = document.getElementById('matchTeam1').value.trim();
      const team2 = document.getElementById('matchTeam2').value.trim();
      const lagaiRate = parseFloat(document.getElementById('matchLagaiRate').value);

      if (!team1 || !team2) { errEl.textContent = 'Both team names are required.'; return; }
      if (isNaN(lagaiRate) || lagaiRate < 0.05 || lagaiRate > 0.90) {
        errEl.textContent = 'Lagai rate must be between 0.05 and 0.90.'; return;
      }

      const khaiRate = parseFloat((lagaiRate + 0.05).toFixed(2));

      const { data: evData1, error: evErr } = await sb.from('events').insert({
        title, category, sub_category: subCat || null,
        resolution_date: resolution || null,
        status: 'ACTIVE', is_resolved: false,
        market_type: 'MATCH',
        lagai_rate: lagaiRate,
        rate_team: team1
      }).select().single();
      if (evErr) { console.error('EVENT INSERT ERROR FULL:', JSON.stringify(evErr)); throw new Error(evErr.message); }
      ev = evData1;

      // Two outcomes — rate is quoted against outcome[0] (team1 = favourite)
      // LAGAI bets link to outcome[0], KHAI bets link to outcome[1]
      const outcomes = [
        { event_id: ev.id, title: team1, current_price: 50, total_volume: 0 },
        { event_id: ev.id, title: team2, current_price: 50, total_volume: 0 }
      ];
      const { error: ocErr } = await sb.from('outcomes').insert(outcomes);
      if (ocErr) throw new Error(ocErr.message);

      await auditLog('CREATE_MARKET', { targetId: ev.id, extra: { title, type: 'MATCH', team1, team2, lagaiRate, khaiRate } });
      showToast(`Market "${title}" created! Lagai ${lagaiRate} / Khai ${khaiRate}`, 'success');

    } else {
      // FANCY market
      const baseLine = parseFloat(document.getElementById('fancyBaseLine').value);
      const fancyOdds = parseFloat(document.getElementById('fancyOdds').value);
      const fancyType = document.getElementById('fancyType').value;

      if (isNaN(baseLine) || baseLine < 0) { errEl.textContent = 'Opening line is required.'; return; }
      if (isNaN(fancyOdds) || fancyOdds < 1.1) { errEl.textContent = 'Odds must be ≥ 1.10.'; return; }

      const { data: evData2, error: evErr2 } = await sb.from('events').insert({
        title, category, sub_category: subCat || null,
        resolution_date: resolution || null,
        status: 'ACTIVE', is_resolved: false,
        market_type: 'FANCY',
        fancy_type: fancyType,
        line_value: baseLine,
        base_line: baseLine
      }).select().single();
      if (evErr2) throw new Error(evErr2.message);
      ev = evData2;

      // Auto-create Yes and No outcomes
      const outcomes = [
        { event_id: ev.id, title: 'Yes', back_price: fancyOdds, current_price: Math.round(100 / fancyOdds), total_volume: 0, is_yes_outcome: true },
        { event_id: ev.id, title: 'No',  back_price: fancyOdds, current_price: Math.round(100 / fancyOdds), total_volume: 0, is_yes_outcome: false }
      ];
      const { error: ocErr } = await sb.from('outcomes').insert(outcomes);
      if (ocErr) throw new Error(ocErr.message);

      await auditLog('CREATE_MARKET', { targetId: ev.id, extra: { title, type: 'FANCY', fancyType, baseLine } });
      showToast(`Fancy market "${title}" created! Line: ${baseLine}`, 'success');
    }

    closeModal('modalCreateMatch');
    switchTab('markets');
    await refreshData();

    // Auto-start simulation if checkbox was ticked
    if (document.getElementById('matchStartSim').checked) {
      // ev is in scope from both MATCH and FANCY branches above
      await sb.from('events').update({ sim_active: true }).eq('id', ev.id);
      startSim(ev.id);
      showToast('▶ Simulation started!', 'success');
    }
  } catch(err) { errEl.textContent = err.message; }
}

// ── SETTLE MATCH ──────────────────────────────────────────────────
function openSettleModal(eventId) {
  const ev = allEvents.find(e => e.id === eventId);
  if (!ev) return;
  stopSim(eventId); // stop simulation if running
  const ocs = allOutcomes.filter(o => o.event_id === eventId);
  const isFancy = ev.market_type === 'FANCY';

  document.getElementById('settleEventId').value = eventId;
  document.getElementById('settleMarketType').value = ev.market_type || 'MATCH';
  document.getElementById('settleEventTitle').textContent = ev.title;
  document.getElementById('settleError').textContent = '';
  document.getElementById('settleConfirmText').value = '';

  // Show correct section
  document.getElementById('settleMatchSection').style.display = isFancy ? 'none' : '';
  document.getElementById('settleFancySection').style.display = isFancy ? '' : 'none';

  if (!isFancy) {
    const sel = document.getElementById('settleOutcomeSelect');
    sel.innerHTML = ocs.map(o => {
      const bp = o.back_price ? `${o.back_price}x` : `${o.current_price}¢`;
      return `<option value="${o.id}">${sanitize(o.title)} (${bp})</option>`;
    }).join('');
    updatePayoutPreview();
  } else {
    document.getElementById('fancyResultValue').value = '';
    document.getElementById('fancyResultNotes').value = '';
    document.getElementById('fancyPayoutPreview').textContent = 'Enter result to preview payouts';
  }

  openModal('modalSettle');
}

async function updateFancyPreview() {
  const eventId = document.getElementById('settleEventId').value;
  const resultVal = parseFloat(document.getElementById('fancyResultValue').value);
  const preview = document.getElementById('fancyPayoutPreview');
  if (isNaN(resultVal)) { preview.textContent = 'Enter result to preview payouts'; return; }

  // Fetch orders for this event
  const ev = allEvents.find(e => e.id === eventId);
  const ocs = allOutcomes.filter(o => o.event_id === eventId);
  const { data: orders } = await sb.from('orders')
    .select('*, betting_users(login_id)')
    .in('outcome_id', ocs.map(o => o.id))
    .eq('status', 'OPEN');

  if (!orders || orders.length === 0) { preview.innerHTML = '<span style="color:#64748b;">No open bets to settle</span>'; return; }

  let winners = 0, losers = 0, totalPayout = 0;
  orders.forEach(ord => {
    const lineNo = parseFloat(ord.line_no_at_bet || ord.line_at_bet || 0);
    const lineYes = parseFloat(ord.line_yes_at_bet || ord.line_at_bet || 0);
    const stake = parseFloat(ord.total_cost || 0);
    const bp = parseFloat(ord.price_per_share || 1.9);
    let isWin;
    if (ord.line_no_at_bet != null && ord.line_yes_at_bet != null) {
      isWin = (ord.bet_side === 'YES' && resultVal >= lineYes) || (ord.bet_side === 'NO' && resultVal <= lineNo);
    } else {
      isWin = (ord.bet_side === 'YES' && resultVal >= lineNo) || (ord.bet_side === 'NO' && resultVal < lineNo);
    }
    if (isWin) { winners++; totalPayout += stake * bp; }
    else losers++;
  });

  preview.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;text-align:center;">
      <div><div style="color:#10b981;font-size:1rem;font-weight:700;">${winners}</div><div style="color:#64748b;font-size:0.72rem;">Winners</div></div>
      <div><div style="color:#ef4444;font-size:1rem;font-weight:700;">${losers}</div><div style="color:#64748b;font-size:0.72rem;">Losers</div></div>
      <div><div style="color:#3b82f6;font-size:1rem;font-weight:700;">🪙 ${totalPayout.toLocaleString(undefined,{maximumFractionDigits:2})}</div><div style="color:#64748b;font-size:0.72rem;">Total Payout</div></div>
    </div>`;
}

async function submitSettle() {
  const eventId = document.getElementById('settleEventId').value;
  const marketType = document.getElementById('settleMarketType').value;
  const errEl = document.getElementById('settleError');
  errEl.textContent = '';

  const ev = allEvents.find(e => e.id === eventId);
  if (!ev) { errEl.textContent = 'Event not found.'; return; }

  const confirmText = document.getElementById('settleConfirmText').value.trim();
  if (confirmText !== ev.title) {
    errEl.textContent = `Type the exact market name to confirm: "${ev.title}"`;
    return;
  }

  try {
    if (marketType === 'FANCY') {
      await settleFancyMarket(ev, errEl);
    } else {
      await settleMatchMarket(ev, errEl);
    }
  } catch(err) { errEl.textContent = err.message; }
}

async function settleMatchMarket(ev, errEl) {
  const winningOutcomeId = document.getElementById('settleOutcomeSelect').value;
  const winningOutcome = allOutcomes.find(o => o.id === winningOutcomeId);
  if (!winningOutcome) { errEl.textContent = 'Select a winning outcome.'; return; }

  // Single atomic RPC replaces the entire client-side settlement loop (per D-13)
  const { data: result, error: settleErr } = await sb.rpc('settle_match_market', {
    p_event_id: ev.id,
    p_winning_outcome_id: winningOutcomeId,
    p_settled_by: currentUser.id
  });
  if (settleErr) throw new Error(settleErr.message);

  await auditLog('SETTLE_MARKET', {
    targetId: ev.id,
    extra: {
      event: ev.title,
      winner: result.winning_title,
      users: result.users_settled,
      commission: result.total_commission
    },
    amount: result.total_payout
  });
  const fmtAmt = n => '🪙' + parseFloat(n||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
  showToast(
    `✅ Market settled! Winner: ${result.winning_title}. ` +
    `${fmtAmt(result.total_payout)} paid out` +
    (result.total_commission > 0 ? `, ${fmtAmt(result.total_commission)} commission credited.` : '.'),
    'success'
  );
  closeModal('modalSettle');
  await refreshData();
}

async function settleFancyMarket(ev, errEl) {
  const resultVal = parseFloat(document.getElementById('fancyResultValue').value);
  const resultNotes = document.getElementById('fancyResultNotes').value.trim();
  if (isNaN(resultVal) || resultVal < 0) { errEl.textContent = 'Enter a valid result value.'; return; }

  // Single atomic RPC replaces the entire client-side settlement loop (per D-10)
  const { data: result, error: settleErr } = await sb.rpc('settle_fancy_market', {
    p_event_id: ev.id,
    p_result_value: resultVal,
    p_settled_by: currentUser.id
  });
  if (settleErr) throw new Error(settleErr.message);

  await auditLog('SETTLE_MARKET', {
    targetId: ev.id,
    extra: {
      event: ev.title,
      type: 'FANCY',
      result: resultVal,
      users: result.users_settled,
      winners: result.winners_count,
      commission: result.total_commission
    },
    amount: result.total_payout
  });
  const fmtAmt = n => '🪙' + parseFloat(n||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
  showToast(
    `✅ Fancy settled! Result: ${resultVal}. ${result.winners_count} winners, ${fmtAmt(result.total_payout)} paid out` +
    (result.total_commission > 0 ? `, ${fmtAmt(result.total_commission)} commission credited.` : '.'),
    'success'
  );
  closeModal('modalSettle');
  await refreshData();
}

// ── MATCH RESULT DECLARATION ──────────────────────────────────────
let resultState = { eventId: null, winningOutcomeId: null };

async function openResultModal(eventId) {
  const ev = allEvents.find(e => e.id === eventId);
  if (!ev) return;
  stopSim(eventId);

  // Immediately suspend to block new bets
  await sb.from('events').update({ status: 'SUSPENDED' }).eq('id', eventId);
  const idx = allEvents.findIndex(e => e.id === eventId);
  if (idx >= 0) allEvents[idx].status = 'SUSPENDED';
  renderMarkets();

  const ocs = allOutcomes.filter(o => o.event_id === eventId);
  const oc0 = ocs[0];
  const oc1 = ocs[1];
  const favTeam   = ev.rate_team || oc0?.title || 'Team 1';
  const otherTeam = oc1?.title || 'Team 2';
  const lagai = parseFloat(ev.lagai_rate ?? 0.50).toFixed(2);
  const khai  = parseFloat((parseFloat(lagai) + 0.05)).toFixed(2);

  resultState = { eventId, winningOutcomeId: null };
  document.getElementById('resultEventId').value = eventId;
  document.getElementById('resultEventTitle').textContent = ev.title;
  document.getElementById('resultError').textContent = '';
  document.getElementById('resultPayoutPreview').style.display = 'none';
  document.getElementById('resultConfirmBtn').disabled = true;

  const teams = [
    { id: oc0?.id, name: favTeam,   rate: `L ${lagai}`, winMsg: 'Lagai bets WIN', loseMsg: 'Khai bets LOSE',  winColor: '#10b981' },
    { id: oc1?.id, name: otherTeam, rate: `K ${khai}`,  winMsg: 'Khai bets WIN',  loseMsg: 'Lagai bets LOSE', winColor: '#f87171' }
  ];
  document.getElementById('resultTeamBtns').innerHTML = teams.map(t => `
    <div id="resultBtn_${t.id}" onclick="selectResultTeam('${t.id}','${sanitize(t.name)}')"
      style="border:2px solid #334155;border-radius:10px;padding:14px;text-align:center;cursor:pointer;transition:all 0.15s;">
      <div style="font-weight:700;font-size:1rem;color:white;">${sanitize(t.name)}</div>
      <div style="font-size:0.68rem;color:#64748b;margin-top:2px;">${t.rate}</div>
      <div style="margin-top:8px;font-size:0.72rem;color:${t.winColor};font-weight:600;">✓ ${t.winMsg}</div>
      <div style="font-size:0.72rem;color:#ef4444;margin-top:2px;">✗ ${t.loseMsg}</div>
    </div>`).join('');

  openModal('modalMatchResult');
}

async function selectResultTeam(winningOutcomeId, winningTeamName) {
  resultState.winningOutcomeId = winningOutcomeId;

  // Highlight selection
  document.querySelectorAll('[id^="resultBtn_"]').forEach(btn => {
    btn.style.borderColor = '#334155'; btn.style.background = 'transparent';
  });
  const sel = document.getElementById(`resultBtn_${winningOutcomeId}`);
  if (sel) { sel.style.borderColor = '#10b981'; sel.style.background = 'rgba(16,185,129,0.08)'; }
  document.getElementById('resultConfirmBtn').disabled = false;

  // Load payout preview
  const { eventId } = resultState;
  const ev  = allEvents.find(e => e.id === eventId);
  const ocs = allOutcomes.filter(o => o.event_id === eventId);
  const { data: orders } = await sb.from('orders')
    .select('*, betting_users(login_id)').in('outcome_id', ocs.map(o => o.id)).eq('status', 'OPEN');

  const prev = document.getElementById('resultPayoutPreview');
  prev.style.display = 'block';
  if (!orders || orders.length === 0) {
    prev.innerHTML = '<div style="color:#64748b;font-size:0.82rem;text-align:center;padding:8px;">No open bets — market can be settled with no payouts.</div>';
    return;
  }

  const winners = orders.filter(o => o.outcome_id === winningOutcomeId);
  const losers  = orders.filter(o => o.outcome_id !== winningOutcomeId);
  const totalPayout = winners.reduce((s, o) => s + parseFloat(o.shares || 0), 0);
  const totalStakes = orders.reduce((s, o) => s + parseFloat(o.total_cost || 0), 0);

  const winRows = winners.slice(0, 6).map(o =>
    `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #1e293b;">
      <span style="color:#94a3b8;font-size:0.78rem;">${sanitize(o.betting_users?.login_id || '—')} <span style="color:#64748b;">(${o.bet_side})</span></span>
      <span style="color:#10b981;font-family:monospace;font-size:0.78rem;font-weight:700;">+🪙${parseFloat(o.shares||0).toFixed(2)}</span>
    </div>`).join('');

  prev.innerHTML = `
    <div style="font-weight:700;color:white;margin-bottom:10px;">Settlement Preview — <span style="color:#10b981;">${sanitize(winningTeamName)}</span> wins</div>
    ${winRows}
    ${winners.length > 6 ? `<div style="color:#64748b;font-size:0.72rem;margin-top:4px;">+${winners.length-6} more winners…</div>` : ''}
    <div style="margin-top:12px;padding-top:10px;border-top:1px solid #334155;display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;text-align:center;">
      <div><div style="font-size:0.58rem;color:#64748b;text-transform:uppercase;font-weight:700;letter-spacing:.06em;">Winners</div><div style="font-family:monospace;color:#10b981;font-size:1rem;font-weight:700;">${winners.length}</div></div>
      <div><div style="font-size:0.58rem;color:#64748b;text-transform:uppercase;font-weight:700;letter-spacing:.06em;">Losers</div><div style="font-family:monospace;color:#ef4444;font-size:1rem;font-weight:700;">${losers.length}</div></div>
      <div><div style="font-size:0.58rem;color:#64748b;text-transform:uppercase;font-weight:700;letter-spacing:.06em;">Total Payout</div><div style="font-family:monospace;color:#f59e0b;font-size:1rem;font-weight:700;">🪙${totalPayout.toFixed(0)}</div></div>
    </div>
    <div style="margin-top:8px;font-size:0.72rem;color:#475569;text-align:center;">Stakes collected: 🪙${totalStakes.toFixed(0)} · Platform gain: 🪙${(totalStakes - totalPayout + winners.reduce((s,o)=>s+parseFloat(o.total_cost||0),0)).toFixed(0)}</div>`;
}

async function confirmMatchResult() {
  const btn = document.getElementById('resultConfirmBtn');
  const errEl = document.getElementById('resultError');
  const { eventId, winningOutcomeId } = resultState;
  if (!eventId || !winningOutcomeId) { errEl.textContent = 'Select a winning team first.'; return; }

  const ev = allEvents.find(e => e.id === eventId);
  const winningOutcome = allOutcomes.find(o => o.id === winningOutcomeId);
  if (!ev || !winningOutcome) { errEl.textContent = 'Event or outcome not found.'; return; }

  btn.disabled = true; btn.textContent = 'Settling…';
  errEl.textContent = '';

  try {
    const ocs = allOutcomes.filter(o => o.event_id === eventId);
    const { data: orders, error: ordErr } = await sb.from('orders')
      .select('*').in('outcome_id', ocs.map(o => o.id)).eq('status', 'OPEN');
    if (ordErr) throw new Error(ordErr.message);

    let totalPayout = 0, winnersCount = 0;
    if (orders && orders.length > 0) {
      for (const ord of orders) {
        await sb.from('orders').update({ status: 'SETTLED' }).eq('id', ord.id);
        if (ord.outcome_id === winningOutcomeId) {
          const payout = parseFloat(ord.shares || 0);
          const { data: newBal, error: balErr } = await sb.rpc('adjust_balance', { p_user_id: ord.user_id, p_delta: payout });
          if (balErr) throw new Error(`Balance update failed for ${ord.user_id}: ${balErr.message}`);
          await sb.from('credit_transactions').insert({
            sender_id: currentUser.id, receiver_id: ord.user_id,
            amount: payout, transaction_type: 'SETTLEMENT',
            notes: `${ord.bet_side} win: ${winningOutcome.title} won in "${ev.title}"`
          });
          totalPayout += payout; winnersCount++;
        }
      }
    }

    const { error: evErr } = await sb.from('events').update({
      status: 'SETTLED', is_resolved: true, winning_outcome: winningOutcome.title
    }).eq('id', eventId);
    if (evErr) throw new Error(evErr.message);
    await sb.from('outcomes').update({ is_winner: true }).eq('id', winningOutcomeId);

    await auditLog('SETTLE_MARKET', {
      targetId: eventId,
      extra: { event: ev.title, type: 'MATCH_LK', winner: winningOutcome.title, totalOrders: orders?.length || 0, winners: winnersCount },
      amount: totalPayout
    });
    showToast(`✅ "${ev.title}" settled! ${winningOutcome.title} won. ${winnersCount} bets paid 🪙${totalPayout.toLocaleString(undefined,{maximumFractionDigits:0})}.`, 'success');
    closeModal('modalMatchResult');
    resultState = { eventId: null, winningOutcomeId: null };
    await refreshData();
  } catch(err) {
    errEl.textContent = err.message;
    btn.disabled = false; btn.textContent = '✅ Settle All Bets';
  }
}

function closeResultModal() {
  closeModal('modalMatchResult');
  resultState = { eventId: null, winningOutcomeId: null };
}

// ── EVENT CONTROLS ────────────────────────────────────────────────
async function toggleEventStatus(eventId, currentStatus) {
  const ev = allEvents.find(e => e.id === eventId);
  const newStatus = currentStatus === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED';
  const { error } = await sb.from('events').update({ status: newStatus }).eq('id', eventId);
  if (error) { showToast('Failed to update event status', 'error'); return; }
  // When manually pausing, stop the simulation so it can't auto-resume
  if (newStatus === 'SUSPENDED') {
    stopSim(eventId);
  }
  await auditLog(newStatus === 'SUSPENDED' ? 'SUSPEND_MARKET' : 'RESUME_MARKET', {
    targetId: eventId, extra: { title: ev?.title }
  });
  showToast(`Market ${newStatus === 'SUSPENDED' ? 'suspended' : 'resumed'}`, 'success');
  await refreshData();
}

async function deleteEvent(eventId) {
  const ev = allEvents.find(e => e.id === eventId);
  if (!ev) return;
  const confirmWord = prompt(`Type the market name to permanently DELETE it:\n"${ev.title}"`);
  if (confirmWord !== ev.title) { showToast('Delete cancelled — name did not match.', 'info'); return; }
  await sb.from('outcomes').delete().eq('event_id', eventId);
  await sb.from('events').delete().eq('id', eventId);
  await auditLog('DELETE_MARKET', { targetId: eventId, extra: { title: ev?.title } });
  showToast('Market deleted', 'success');
  await refreshData();
}

// ── BROADCAST ─────────────────────────────────────────────────────
async function sendBroadcast() {
  const msg = document.getElementById('broadcastMsg').value.trim();
  if (!msg) { showToast('Enter a message to broadcast', 'error'); return; }
  const { error } = await sb.from('platform_announcements').insert({
    message: msg, created_by: currentUser.id, is_active: true
  });
  if (error) { showToast('Failed to send broadcast', 'error'); return; }
  await auditLog('BROADCAST', { extra: { message: msg.substring(0, 100) } });
  document.getElementById('broadcastMsg').value = '';
  showToast('Announcement sent to all users!', 'success');
  await refreshData();
}

async function deleteAnnouncement(id) {
  await sb.from('platform_announcements').delete().eq('id', id);
  showToast('Announcement removed', 'success');
  await refreshData();
}

// ── SETTINGS ──────────────────────────────────────────────────────

async function saveDefaults() {
  const m = document.getElementById('defMatchComm').value;
  const f = document.getElementById('defFancyComm').value;
  const { error } = await sb.from('platform_config').upsert([
    { key: 'default_match_comm', value: m, updated_by: currentUser.id, updated_at: new Date().toISOString() },
    { key: 'default_fancy_comm', value: f, updated_by: currentUser.id, updated_at: new Date().toISOString() }
  ], { onConflict: 'key' });
  if (error) { showToast('Failed to save defaults: ' + error.message, 'error'); return; }
  platformConfig['default_match_comm'] = m;
  platformConfig['default_fancy_comm'] = f;
  await auditLog('SAVE_BET_LIMITS', { extra: { default_match_comm: m, default_fancy_comm: f } });
  showToast('Default commissions saved to database', 'success');
}

// ── CLEAR LEDGER ──────────────────────────────────────────────────
async function confirmClearLedger() {
  if (!confirm('Delete ALL credit transactions? User balances and markets are untouched. This cannot be undone.')) return;
  try {
    const { error } = await sb.from('credit_transactions').delete().not('id', 'is', null);
    if (error) throw new Error(error.message);
    await auditLog('PLATFORM_RESET', { extra: { action: 'CLEAR_LEDGER', confirmed_by: currentUser.login_id } });
    showToast('All ledger entries cleared.', 'success');
    await refreshData();
  } catch(err) { showToast('Failed: ' + err.message, 'error'); }
}

// ── PLATFORM RESET ────────────────────────────────────────────────
async function confirmPlatformReset() {
  const input = document.getElementById('resetConfirmInput').value.trim();
  if (input !== 'RESET ALL') { showToast('Type exactly "RESET ALL" to confirm', 'error'); return; }
  if (!confirm('This will permanently delete ALL markets, bets, transactions and reset all balances to zero. User accounts are kept. This CANNOT be undone. Are you 100% sure?')) return;
  try {
    const steps = [
      sb.from('orders').delete().not('id', 'is', null),
      sb.from('portfolio_positions').delete().not('id', 'is', null),
    ];
    for (const step of steps) {
      const { error } = await step;
      if (error) throw new Error(error.message);
    }
    const { error: ocErr } = await sb.from('outcomes').delete().not('id', 'is', null);
    if (ocErr) throw new Error(ocErr.message);
    const { error: evErr } = await sb.from('events').delete().not('id', 'is', null);
    if (evErr) throw new Error(evErr.message);
    const { error: txErr } = await sb.from('credit_transactions').delete().not('id', 'is', null);
    if (txErr) throw new Error(txErr.message);
    const { error: anErr } = await sb.from('platform_announcements').delete().not('id', 'is', null);
    if (anErr) throw new Error(anErr.message);
    const { error: balErr } = await sb.from('betting_users').update({ balance: 0 }).not('id', 'is', null);
    if (balErr) throw new Error(balErr.message);
    await auditLog('PLATFORM_RESET', { extra: { confirmed_by: currentUser.login_id } });
    document.getElementById('resetConfirmInput').value = '';
    showToast('Platform reset complete. All data cleared.', 'success');
    await refreshData();
  } catch(err) { showToast('Reset failed: ' + err.message, 'error'); }
}

// ── EXPORT CSV ────────────────────────────────────────────────────
function downloadLedgerCSV() {
  const headers = ['Login ID', 'Role', 'Name', 'Balance', 'Credit Limit', 'Status'];
  const rows = allUsers.filter(u => u.id !== currentUser.id).map(u => [
    u.login_id, u.role, u.name || '', u.balance || 0, u.credit_limit || 0, u.status || 'ACTIVE'
  ]);
  const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = `bhandai_ledger_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
}

// ── RENDER SETTLEMENT ─────────────────────────────────────────────
function renderSettlement() {
  const agents = allUsers.filter(u => u.role === 'AGENT');
  let totalOwed = 0, totalAdminOwes = 0, totalSettled = 0, openCount = 0;

  const cards = agents.map(agent => {
    const deposited = allTransactions
      .filter(t => t.receiver_id === agent.id && t.transaction_type === 'DEPOSIT')
      .reduce((s, t) => s + parseFloat(t.amount || 0), 0);
    const recovered = allTransactions
      .filter(t => t.sender_id === agent.id && t.transaction_type === 'WITHDRAWAL')
      .reduce((s, t) => s + parseFloat(t.amount || 0), 0);
    const settled = allTransactions
      .filter(t => t.sender_id === agent.id && t.transaction_type === 'AGENT_SETTLEMENT')
      .reduce((s, t) => s + parseFloat(t.amount || 0), 0);
    const currentBal = parseFloat(agent.balance || 0);
    const agentClients = allUsers.filter(u => u.role === 'CLIENT' && u.parent_id === agent.id);
    const clientBals = agentClients.reduce((s, c) => s + parseFloat(c.balance || 0), 0);
    const agentClientIds = new Set(agentClients.map(c => c.id));

    // Direct admin ↔ client transactions (bypassing agent wallet) — still part of agent's book
    const directToClients = allTransactions
      .filter(t => t.transaction_type === 'DEPOSIT' && t.sender_id === currentUser.id && agentClientIds.has(t.receiver_id))
      .reduce((s, t) => s + parseFloat(t.amount || 0), 0);
    const directFromClients = allTransactions
      .filter(t => t.transaction_type === 'WITHDRAWAL' && t.receiver_id === currentUser.id && agentClientIds.has(t.sender_id))
      .reduce((s, t) => s + parseFloat(t.amount || 0), 0);

    // Outstanding = net given to agent + direct to clients − direct recovered from clients − cash settled
    const outstanding = (deposited - recovered) + directToClients - directFromClients - settled;

    if (Math.abs(outstanding) > 0.01) openCount++;
    totalSettled += settled;
    if (outstanding > 0.01)       totalOwed      += outstanding;
    else if (outstanding < -0.01) totalAdminOwes += Math.abs(outstanding);

    const netColor = outstanding > 0.01 ? '#ef4444' : outstanding < -0.01 ? '#10b981' : '#64748b';
    const netLabel = outstanding > 0.01 ? 'Agent Owes Admin' : outstanding < -0.01 ? 'Admin Owes Agent' : '✅ Settled';

    // Gross exposure = everything admin put into this agent's network
    const grossExposure = (deposited - recovered) + directToClients - directFromClients;

    // Share-adjusted P&L from settlement_results (per D-11, D-12)
    const agentSR = allSettlementResults.filter(r => r.agent_id === agent.id);
    const srPnlShare = agentSR.reduce((s, r) => s + parseFloat(r.agent_pnl_share || 0), 0);
    const srCommShare = agentSR.reduce((s, r) => s + parseFloat(r.agent_commission_share || 0), 0);
    const srNetPnl = agentSR.reduce((s, r) => s + parseFloat(r.agent_net_pnl || 0), 0);
    const srAvgShare = agentSR.length > 0
      ? (agentSR.reduce((s, r) => s + parseFloat(r.partnership_share_at_settlement || 0), 0) / agentSR.length)
      : parseFloat(agent.partnership_share || 0);

    return `<div class="settlement-card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
        <div>
          <div class="sc-agent">${agent.login_id}</div>
          <div class="sc-name">${agent.name || '—'} · ${agentClients.length} clients · ${agentSR.length} settled · 🪙${(currentBal + clientBals).toLocaleString(undefined,{maximumFractionDigits:0})} in book</div>
        </div>
        <button class="btn btn-primary btn-sm" onclick="openAgentSettleModal('${agent.id}')">Settle ↓</button>
      </div>
      <div class="sc-row"><span class="lbl">Issued to agent</span><span class="val" style="color:#e2e8f0;">+🪙 ${deposited.toLocaleString(undefined,{minimumFractionDigits:2})}</span></div>
      ${recovered > 0 ? `<div class="sc-row"><span class="lbl">Returned (chips)</span><span class="val" style="color:#94a3b8;">−🪙 ${recovered.toLocaleString(undefined,{minimumFractionDigits:2})}</span></div>` : ''}
      ${directToClients > 0 ? `<div class="sc-row"><span class="lbl" style="color:#94a3b8;">Admin → clients direct</span><span class="val" style="color:#f59e0b;">+🪙 ${directToClients.toLocaleString(undefined,{minimumFractionDigits:2})}</span></div>` : ''}
      ${directFromClients > 0 ? `<div class="sc-row"><span class="lbl" style="color:#94a3b8;">Admin ← clients direct</span><span class="val" style="color:#94a3b8;">−🪙 ${directFromClients.toLocaleString(undefined,{minimumFractionDigits:2})}</span></div>` : ''}
      <div class="sc-row" style="border-top:1px solid #334155;margin-top:6px;padding-top:6px;">
        <span class="lbl" style="font-weight:600;">Gross Exposure</span>
        <span class="val" style="color:#e2e8f0;font-weight:700;">🪙 ${grossExposure.toLocaleString(undefined,{minimumFractionDigits:2})}</span>
      </div>
      ${agentSR.length > 0 ? `
      <div class="sc-row" style="border-top:1px solid #334155;margin-top:6px;padding-top:6px;">
        <span class="lbl" style="color:#a78bfa;font-weight:600;">P&L Share (${srAvgShare.toFixed(0)}%)</span>
        <span class="val" style="color:${srPnlShare >= 0 ? '#10b981' : '#ef4444'};">🪙 ${srPnlShare.toLocaleString(undefined,{minimumFractionDigits:2})}</span>
      </div>
      <div class="sc-row">
        <span class="lbl" style="color:#a78bfa;">Commission Cost</span>
        <span class="val" style="color:#a78bfa;">🪙 ${srCommShare.toLocaleString(undefined,{minimumFractionDigits:2})}</span>
      </div>
      <div class="sc-row">
        <span class="lbl" style="color:#a78bfa;font-weight:600;">Agent Net P&L</span>
        <span class="val" style="color:${srNetPnl >= 0 ? '#10b981' : '#ef4444'};font-weight:700;">🪙 ${srNetPnl.toLocaleString(undefined,{minimumFractionDigits:2})}</span>
      </div>
      ` : ''}
      ${settled > 0 ? `<div class="sc-row"><span class="lbl">Cash settled (admin received)</span><span class="val" style="color:#3b82f6;">−🪙 ${settled.toLocaleString(undefined,{minimumFractionDigits:2})}</span></div>` : ''}
      <div class="sc-net">
        <span style="font-size:0.78rem;font-weight:700;color:${netColor};">${netLabel}</span>
        <span style="font-family:'JetBrains Mono',monospace;font-weight:700;font-size:1.1rem;color:${netColor};">🪙 ${Math.abs(outstanding).toLocaleString(undefined,{minimumFractionDigits:2})}</span>
      </div>
    </div>`;
  });

  document.getElementById('settleTotalOwed').textContent = totalOwed.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
  document.getElementById('settleTotalSettled').textContent = totalSettled.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
  document.getElementById('settleOpenAgents').textContent = openCount;
  document.getElementById('settleTotalAdminOwes').textContent = totalAdminOwes.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});

  const container = document.getElementById('agentSettlementCards');
  if (agents.length === 0) {
    container.innerHTML = '<div class="empty" style="padding:48px;"><div class="empty-icon">🤝</div><div class="empty-text">No agents yet. Create agents to track settlements.</div></div>';
  } else {
    container.innerHTML = `<div class="settlement-grid">${cards.join('')}</div>`;
  }
}

function openAgentSettleModal(agentId) {
  const agent = allUsers.find(u => u.id === agentId);
  if (!agent) return;
  const deposited = allTransactions.filter(t => t.receiver_id === agentId && t.transaction_type === 'DEPOSIT').reduce((s, t) => s + parseFloat(t.amount||0), 0);
  const recovered = allTransactions.filter(t => t.sender_id === agentId && t.transaction_type === 'WITHDRAWAL').reduce((s, t) => s + parseFloat(t.amount||0), 0);
  const settled = allTransactions.filter(t => t.sender_id === agentId && t.transaction_type === 'AGENT_SETTLEMENT').reduce((s, t) => s + parseFloat(t.amount||0), 0);
  const agentClientIds = new Set(allUsers.filter(u => u.role === 'CLIENT' && u.parent_id === agentId).map(c => c.id));
  const directToClients = allTransactions.filter(t => t.transaction_type === 'DEPOSIT' && t.sender_id === currentUser.id && agentClientIds.has(t.receiver_id)).reduce((s, t) => s + parseFloat(t.amount||0), 0);
  const directFromClients = allTransactions.filter(t => t.transaction_type === 'WITHDRAWAL' && t.receiver_id === currentUser.id && agentClientIds.has(t.sender_id)).reduce((s, t) => s + parseFloat(t.amount||0), 0);
  const outstanding = (deposited - recovered) + directToClients - directFromClients - settled;

  const grossExposure = (deposited - recovered) + directToClients - directFromClients;
  const outstandingColor = outstanding > 0.01 ? '#ef4444' : outstanding < -0.01 ? '#10b981' : '#64748b';
  const outstandingLabel = outstanding > 0.01 ? 'Agent owes admin' : outstanding < -0.01 ? 'Admin owes agent' : '✅ Fully settled';

  document.getElementById('agentSettleId').value = agentId;
  document.getElementById('agentSettleLabel').textContent = `${agent.login_id} · ${agent.name || ''}`;
  document.getElementById('agentSettleNet').innerHTML = `
    <div style="font-size:0.75rem;color:#64748b;margin-bottom:6px;line-height:1.6;">
      <span style="color:#94a3b8;">Issued to agent</span> +🪙${deposited.toLocaleString(undefined,{minimumFractionDigits:2})}
      ${recovered > 0 ? ` &nbsp;·&nbsp; <span style="color:#94a3b8;">Returned (chips)</span> −🪙${recovered.toLocaleString(undefined,{minimumFractionDigits:2})}` : ''}
      ${directToClients > 0 ? ` &nbsp;·&nbsp; <span style="color:#f59e0b;">Direct→clients</span> +🪙${directToClients.toLocaleString(undefined,{minimumFractionDigits:2})}` : ''}
      ${directFromClients > 0 ? ` &nbsp;·&nbsp; <span style="color:#94a3b8;">Direct←clients</span> −🪙${directFromClients.toLocaleString(undefined,{minimumFractionDigits:2})}` : ''}
      ${settled > 0 ? ` &nbsp;·&nbsp; <span style="color:#3b82f6;">Cash settled</span> −🪙${settled.toLocaleString(undefined,{minimumFractionDigits:2})}` : ''}
    </div>
    <div style="font-size:0.78rem;font-weight:700;color:${outstandingColor};">${outstandingLabel}: <span style="font-family:'JetBrains Mono',monospace;font-size:1rem;">🪙${Math.abs(outstanding).toLocaleString(undefined,{minimumFractionDigits:2})}</span></div>`;
  document.getElementById('agentSettleAmount').value = outstanding > 0 ? outstanding.toFixed(2) : '';
  document.getElementById('agentSettleNote').value = '';
  document.getElementById('agentSettleError').textContent = '';
  openModal('modalAgentSettle');
}

async function submitAgentSettlement() {
  const agentId = document.getElementById('agentSettleId').value;
  const amount = parseFloat(document.getElementById('agentSettleAmount').value);
  const note = document.getElementById('agentSettleNote').value.trim();
  const errEl = document.getElementById('agentSettleError');
  errEl.textContent = '';

  if (!amount || isNaN(amount) || amount <= 0) { errEl.textContent = 'Enter a valid settlement amount.'; return; }

  const agent = allUsers.find(u => u.id === agentId);
  if (!agent) return;

  // Validate amount doesn't exceed what the agent owes (same formula as settlement card)
  const dep  = allTransactions.filter(t => t.receiver_id === agentId && t.transaction_type === 'DEPOSIT').reduce((s,t)=>s+parseFloat(t.amount||0),0);
  const rec  = allTransactions.filter(t => t.sender_id === agentId && t.transaction_type === 'WITHDRAWAL').reduce((s,t)=>s+parseFloat(t.amount||0),0);
  const setl = allTransactions.filter(t => t.sender_id === agentId && t.transaction_type === 'AGENT_SETTLEMENT').reduce((s,t)=>s+parseFloat(t.amount||0),0);
  const valClientIds = new Set(allUsers.filter(u => u.role === 'CLIENT' && u.parent_id === agentId).map(c => c.id));
  const dirTo   = allTransactions.filter(t => t.transaction_type === 'DEPOSIT'    && t.sender_id   === currentUser.id && valClientIds.has(t.receiver_id)).reduce((s,t)=>s+parseFloat(t.amount||0),0);
  const dirFrom = allTransactions.filter(t => t.transaction_type === 'WITHDRAWAL' && t.receiver_id === currentUser.id && valClientIds.has(t.sender_id)).reduce((s,t)=>s+parseFloat(t.amount||0),0);
  const outstanding = (dep - rec) + dirTo - dirFrom - setl;
  if (amount > outstanding + 0.01)
    { errEl.textContent = `Amount 🪙${amount.toLocaleString()} exceeds outstanding balance of 🪙${outstanding.toLocaleString(undefined,{minimumFractionDigits:2})}.`; return; }

  try {
    const { error } = await sb.from('credit_transactions').insert({
      sender_id: agentId, receiver_id: currentUser.id,
      amount, transaction_type: 'AGENT_SETTLEMENT',
      notes: note || `Cash settlement from ${agent.login_id}`
    });
    if (error) throw new Error(error.message);
    await auditLog('AGENT_SETTLEMENT', { targetId: agentId, targetLoginId: agent.login_id, amount, extra: { note: note || null } });
    showToast(`Settlement of 🪙${amount.toLocaleString()} recorded for ${agent.login_id}`, 'success');
    closeModal('modalAgentSettle');
    await refreshData();
  } catch(err) { errEl.textContent = err.message; }
}

// ── PLATFORM CONFIG (DB-BACKED) ───────────────────────────────────
let platformConfig = {};

async function loadPlatformConfig() {
  const { data } = await sb.from('platform_config').select('*');
  if (!data) return;
  data.forEach(row => { platformConfig[row.key] = row.value; });

  const bettingToggle = document.getElementById('toggleBetting');
  const regToggle = document.getElementById('toggleReg');
  const maintToggle = document.getElementById('toggleMaint');
  if (bettingToggle) bettingToggle.classList.toggle('on', platformConfig['betting_enabled'] === 'true');
  if (regToggle) regToggle.classList.toggle('on', platformConfig['new_registrations'] === 'true');
  if (maintToggle) maintToggle.classList.toggle('on', platformConfig['maintenance_mode'] === 'true');

  const minBetInput = document.getElementById('cfgMinBet');
  const maxBetInput = document.getElementById('cfgMaxBet');
  if (minBetInput && platformConfig['min_bet']) minBetInput.value = platformConfig['min_bet'];
  if (maxBetInput && platformConfig['max_bet']) maxBetInput.value = platformConfig['max_bet'];

  // Default commissions (saved via saveDefaults → DB)
  const defMatch = document.getElementById('defMatchComm');
  const defFancy = document.getElementById('defFancyComm');
  if (defMatch && platformConfig['default_match_comm']) defMatch.value = platformConfig['default_match_comm'];
  if (defFancy && platformConfig['default_fancy_comm']) defFancy.value = platformConfig['default_fancy_comm'];
}

async function toggleConfig(key, el) {
  const currentVal = platformConfig[key] === 'true';
  const newVal = String(!currentVal);
  const { error } = await sb.from('platform_config').upsert({
    key, value: newVal, updated_by: currentUser.id, updated_at: new Date().toISOString()
  }, { onConflict: 'key' });
  if (error) { showToast('Failed to update: ' + error.message, 'error'); return; }
  platformConfig[key] = newVal;
  el.classList.toggle('on', newVal === 'true');
  const labels = { betting_enabled: 'Betting', new_registrations: 'Registrations', maintenance_mode: 'Maintenance' };
  await auditLog('TOGGLE_CONFIG', { extra: { key, value: newVal } });
  showToast(`${labels[key] || key} ${newVal === 'true' ? 'enabled' : 'disabled'}`, 'success');
}

async function savePlatformConfig() {
  const minBet = document.getElementById('cfgMinBet').value;
  const maxBet = document.getElementById('cfgMaxBet').value;
  if (!minBet || !maxBet || parseFloat(minBet) <= 0 || parseFloat(maxBet) <= 0) { showToast('Enter valid min/max bet amounts', 'error'); return; }
  if (parseFloat(minBet) >= parseFloat(maxBet)) { showToast('Min bet must be less than max bet', 'error'); return; }
  const { error } = await sb.from('platform_config').upsert([
    { key: 'min_bet', value: minBet, updated_by: currentUser.id, updated_at: new Date().toISOString() },
    { key: 'max_bet', value: maxBet, updated_by: currentUser.id, updated_at: new Date().toISOString() }
  ], { onConflict: 'key' });
  if (error) { showToast('Failed to save: ' + error.message, 'error'); return; }
  platformConfig['min_bet'] = minBet;
  platformConfig['max_bet'] = maxBet;
  await auditLog('SAVE_BET_LIMITS', { extra: { min_bet: minBet, max_bet: maxBet } });
  showToast(`Bet limits saved — min 🪙${parseFloat(minBet).toLocaleString()}, max 🪙${parseFloat(maxBet).toLocaleString()}`, 'success');
}

// ── SIMULATION ENGINE ─────────────────────────────────────────────
// Per-market sim: random walk on odds/line every 5s, 30s active / 10s suspended cycle
const simIntervals = {};     // eventId → { priceTimer, cycleTimer, phase }
const SIM_TICK_MS  = 5000;   // price/line update every 5 seconds
const SIM_ACTIVE_MS = 30000; // live phase duration
const SIM_SUSP_MS   = 10000; // suspended phase duration

async function toggleSim(eventId) {
  if (simIntervals[eventId]) {
    stopSim(eventId);
    await sb.from('events').update({ sim_active: false }).eq('id', eventId);
    showToast('Simulation stopped', 'info');
  } else {
    await sb.from('events').update({ sim_active: true }).eq('id', eventId);
    startSim(eventId);
    const evForMsg = allEvents.find(e => e.id === eventId);
    const msg = evForMsg?.market_type === 'FANCY'
      ? '▶ Sim started — line updating every 5s'
      : '▶ Sim started — Lagai/Khai updating every 30s';
    showToast(msg, 'success');
  }
  renderMarkets();
}

function startSim(eventId) {
  stopSim(eventId); // clear any stale
  const ev = allEvents.find(e => e.id === eventId);
  if (!ev) return;

  const state = { phase: 'ACTIVE', lastStep: 0 };
  simIntervals[eventId] = state;

  // Price tick: 5s for both match and fancy
  state.priceTimer = setInterval(() => runSimTick(eventId), SIM_TICK_MS);

  // Active/Suspended cycle
  function scheduleCycle() {
    if (state.phase === 'ACTIVE') {
      state.cycleTimer = setTimeout(async () => {
        state.phase = 'SUSPENDED';
        await sb.from('events').update({ status: 'SUSPENDED' }).eq('id', eventId);
        // Update local cache
        const evIdx = allEvents.findIndex(e => e.id === eventId);
        if (evIdx >= 0) allEvents[evIdx].status = 'SUSPENDED';
        renderMarkets();
        scheduleCycle();
      }, SIM_ACTIVE_MS);
    } else {
      state.cycleTimer = setTimeout(async () => {
        state.phase = 'ACTIVE';
        await sb.from('events').update({ status: 'ACTIVE' }).eq('id', eventId);
        const evIdx = allEvents.findIndex(e => e.id === eventId);
        if (evIdx >= 0) allEvents[evIdx].status = 'ACTIVE';
        renderMarkets();
        scheduleCycle();
      }, SIM_SUSP_MS);
    }
  }
  scheduleCycle();
  // Run first tick immediately
  runSimTick(eventId);
}

async function runSimTick(eventId) {
  const ev = allEvents.find(e => e.id === eventId);
  if (!ev || ev.status === 'SETTLED' || ev.is_resolved) { stopSim(eventId); return; }
  const ocs = allOutcomes.filter(o => o.event_id === eventId);
  if (!ocs.length) return;

  if (ev.market_type === 'FANCY') {
    // Move line ±1-3 runs (random walk), random gap (1 or 2)
    const delta = (Math.random() > 0.5 ? 1 : -1) * (1 + Math.floor(Math.random() * 3));
    const currentLine = parseFloat(ev.line_value || ev.base_line || 50);
    const gap = Math.random() > 0.5 ? 1 : 2; // randomly pick 1 or 2 run gap
    // line_value is midpoint: gap=1 → 44.5 (shows 44/45), gap=2 → 45 (shows 44/46)
    const baseLine = Math.max(1, Math.round(currentLine) + delta);
    const newLine = gap === 1 ? baseLine + 0.5 : baseLine;
    await sb.from('events').update({ line_value: newLine, fancy_gap: gap }).eq('id', eventId);
    const evIdx = allEvents.findIndex(e => e.id === eventId);
    if (evIdx >= 0) { allEvents[evIdx].line_value = newLine; allEvents[evIdx].fancy_gap = gap; }
    renderMarkets();
  } else {
    // MATCH market: momentum random walk on lagai_rate (0.01–0.89)
    const state   = simIntervals[eventId];
    const curLagai = parseFloat(ev.lagai_rate ?? 0.50);
    // Base step ±0.15, plus 40% carry-over from previous step (momentum)
    const baseStep = (Math.random() - 0.5) * 0.30;
    const step     = parseFloat((baseStep + (state?.lastStep || 0) * 0.4).toFixed(2));
    if (state) state.lastStep = step;
    const newLagai = parseFloat(Math.min(0.89, Math.max(0.01, curLagai + step)).toFixed(2));

    await sb.from('events').update({ lagai_rate: newLagai }).eq('id', eventId);
    const evIdx = allEvents.findIndex(e => e.id === eventId);
    if (evIdx >= 0) allEvents[evIdx].lagai_rate = newLagai;
    renderMarkets();
  }
}

function stopSim(eventId) {
  const state = simIntervals[eventId];
  if (!state) return;
  clearInterval(state.priceTimer);
  clearTimeout(state.cycleTimer);
  delete simIntervals[eventId];
}

function stopAllSims() {
  Object.keys(simIntervals).forEach(stopSim);
}

// Stop all sims on page unload
window.addEventListener('beforeunload', stopAllSims);

// ── EMERGENCY HALT ALL MARKETS ────────────────────────────────────
async function haltAllMarkets() {
  const activeCount = allEvents.filter(e => e.status === 'ACTIVE').length;
  if (activeCount === 0) { showToast('No active markets to halt', 'info'); return; }
  if (!confirm(`🚨 EMERGENCY HALT\n\nThis will suspend all ${activeCount} active market(s) immediately.\nNo new bets can be placed until markets are manually resumed.\n\nProceed?`)) return;
  try {
    const { error } = await sb.from('events').update({ status: 'SUSPENDED' }).eq('status', 'ACTIVE').eq('is_resolved', false);
    if (error) throw new Error(error.message);
    stopAllSims(); // kill all simulation cycles so they don't auto-resume
    await auditLog('EMERGENCY_HALT', { extra: { markets_halted: activeCount } });
    showToast(`🚨 Emergency halt: ${activeCount} market(s) suspended`, 'success');
    await refreshData();
  } catch(err) { showToast('Halt failed: ' + err.message, 'error'); }
}

// ── VOID MARKET ────────────────────────────────────────────────────
async function voidMarket(eventId) {
  const ev = allEvents.find(e => e.id === eventId);
  if (!ev) return;
  const confirmWord = prompt(`Type the market name to confirm void:\n"${ev.title}"`);
  if (confirmWord !== ev.title) { showToast('Void cancelled — name did not match.', 'info'); return; }

  try {
    const ocs = allOutcomes.filter(o => o.event_id === eventId);
    const outcomeIds = ocs.map(o => o.id);

    if (outcomeIds.length > 0) {
      const { data: positions } = await sb.from('portfolio_positions').select('*').in('outcome_id', outcomeIds);
      if (positions && positions.length > 0) {
        for (const pos of positions) {
          const shares = parseFloat(pos.shares_owned || 0);
          if (shares <= 0) continue;
          // Fixed: use avg_buy_price (correct column name), not avg_price
          const refund = parseFloat(pos.total_invested || (shares * parseFloat(pos.avg_buy_price || 0)));
          if (refund <= 0) { showToast(`Warning: zero refund for position ${pos.user_id} — skipped`, 'info'); continue; }
          const { data: newBal, error: balErr } = await sb.rpc('adjust_balance', { p_user_id: pos.user_id, p_delta: refund });
          if (balErr) throw new Error(`Balance update failed for ${pos.user_id}: ${balErr.message}`);
          await sb.from('credit_transactions').insert({
            sender_id: currentUser.id, receiver_id: pos.user_id,
            amount: refund, transaction_type: 'VOID_REFUND',
            notes: `Void refund: ${ev.title}`
          });
        }
      }
    }

    await sb.from('events').update({ status: 'VOID', is_resolved: true }).eq('id', eventId);
    await auditLog('VOID_MARKET', { targetId: eventId, extra: { title: ev.title } });
    showToast(`Market voided. All positions refunded.`, 'success');
    await refreshData();
  } catch(err) { showToast('Void failed: ' + err.message, 'error'); }
}

// ── DUPLICATE EVENT ────────────────────────────────────────────────
async function duplicateEvent(eventId) {
  const ev = allEvents.find(e => e.id === eventId);
  if (!ev) return;
  const ocs = allOutcomes.filter(o => o.event_id === eventId);
  try {
    const { data: newEv, error: evErr } = await sb.from('events').insert({
      title: ev.title + ' (Copy)',
      category: ev.category, sub_category: ev.sub_category,
      status: 'ACTIVE', is_resolved: false,
      market_type: ev.market_type || 'MATCH',
      lagai_rate: ev.lagai_rate || null,
      rate_team: ev.rate_team || null,
      fancy_type: ev.fancy_type || null,
      line_value: ev.base_line || ev.line_value || null,
      base_line: ev.base_line || null
    }).select().single();
    if (evErr) throw new Error(evErr.message);
    if (ocs.length > 0) {
      await sb.from('outcomes').insert(ocs.map(o => ({
        event_id: newEv.id, title: o.title,
        back_price: o.back_price || null,
        current_price: o.current_price,
        is_yes_outcome: o.is_yes_outcome || false,
        total_volume: 0
      })));
    }
    showToast(`Duplicated as "${newEv.title}"`, 'success');
    await refreshData();
  } catch(err) { showToast('Duplicate failed: ' + err.message, 'error'); }
}

// ── PAYOUT PREVIEW ─────────────────────────────────────────────────
async function updatePayoutPreview() {
  const outcomeId = document.getElementById('settleOutcomeSelect').value;
  const preview = document.getElementById('payoutPreview');
  if (!outcomeId) {
    preview.innerHTML = '<div style="color:#475569;font-size:0.82rem;text-align:center;padding:8px;">Select an outcome to preview</div>';
    return;
  }
  preview.innerHTML = '<div style="color:#64748b;font-size:0.82rem;text-align:center;padding:10px;">Loading preview…</div>';

  const { data: positions } = await sb
    .from('portfolio_positions').select('*, betting_users(login_id)').eq('outcome_id', outcomeId);

  if (!positions || positions.length === 0) {
    preview.innerHTML = '<div style="color:#475569;font-size:0.82rem;text-align:center;padding:10px;">No positions in this outcome</div>';
    return;
  }

  const totalShares = positions.reduce((s, p) => s + parseFloat(p.shares_owned || 0), 0);
  const rows = positions.slice(0, 8).map(p => {
    const shares = parseFloat(p.shares_owned || 0);
    return `<div class="payout-row">
      <div>
        <div class="payout-outcome">${p.betting_users?.login_id || '—'}</div>
        <div class="payout-detail">${shares.toLocaleString()} shares</div>
      </div>
      <div class="payout-amount selected">+🪙 ${shares.toLocaleString(undefined,{minimumFractionDigits:2})}</div>
    </div>`;
  }).join('');

  preview.innerHTML = rows +
    `<div class="payout-row" style="padding-top:10px;margin-top:4px;border-top:2px solid #334155;">
      <div class="payout-outcome" style="color:#f59e0b;font-weight:700;">Total Payout</div>
      <div class="payout-amount selected" style="font-size:1rem;">🪙 ${totalShares.toLocaleString(undefined,{minimumFractionDigits:2})}</div>
    </div>
    ${positions.length > 8 ? `<div style="color:#64748b;font-size:0.75rem;text-align:center;margin-top:8px;">+${positions.length - 8} more positions</div>` : ''}`;
}

// ── USER HISTORY MODAL ─────────────────────────────────────────────
async function openUserHistory(userId) {
  const user = allUsers.find(u => u.id === userId);
  if (!user) return;
  document.getElementById('historyUserLabel').textContent = `${user.login_id} · ${user.name || ''}`;
  document.getElementById('historyStats').innerHTML = '<div style="color:#64748b;padding:12px;">Loading…</div>';
  document.getElementById('historyTxBody').innerHTML = '<tr><td colspan="5" style="text-align:center;padding:16px;color:#64748b;">Loading…</td></tr>';
  document.getElementById('historyBetBody').innerHTML = '<tr><td colspan="4" style="text-align:center;padding:16px;color:#64748b;">Loading…</td></tr>';
  openModal('modalUserHistory');

  const [txRes, ordRes] = await Promise.all([
    sb.from('credit_transactions').select('*').or(`sender_id.eq.${userId},receiver_id.eq.${userId}`).order('created_at', { ascending: false }).limit(50),
    sb.from('orders').select('*, outcomes(title, event_id)').eq('user_id', userId).order('created_at', { ascending: false }).limit(50)
  ]);
  const txs = txRes.data || [];
  const ords = ordRes.data || [];

  const totalDeposited = txs.filter(t => t.receiver_id === userId && t.transaction_type === 'DEPOSIT').reduce((s, t) => s + parseFloat(t.amount||0), 0);
  const totalWithdrawn = txs.filter(t => t.sender_id === userId && t.transaction_type === 'WITHDRAWAL').reduce((s, t) => s + parseFloat(t.amount||0), 0);
  const totalBetVol = ords.reduce((s, o) => s + parseFloat(o.total_cost||0), 0);
  const currentBal = parseFloat(user.balance || 0);

  document.getElementById('historyStats').innerHTML = `
    <div style="background:#0f172a;border:1px solid #334155;border-radius:8px;padding:12px;text-align:center;">
      <div style="font-size:0.62rem;color:#64748b;text-transform:uppercase;font-weight:700;margin-bottom:4px;">Balance</div>
      <div style="font-family:'JetBrains Mono',monospace;font-weight:700;color:#10b981;font-size:1rem;">🪙 ${currentBal.toLocaleString(undefined,{minimumFractionDigits:2})}</div>
    </div>
    <div style="background:#0f172a;border:1px solid #334155;border-radius:8px;padding:12px;text-align:center;">
      <div style="font-size:0.62rem;color:#64748b;text-transform:uppercase;font-weight:700;margin-bottom:4px;">Deposited</div>
      <div style="font-family:'JetBrains Mono',monospace;font-weight:700;color:#e2e8f0;font-size:1rem;">🪙 ${totalDeposited.toLocaleString(undefined,{minimumFractionDigits:2})}</div>
    </div>
    <div style="background:#0f172a;border:1px solid #334155;border-radius:8px;padding:12px;text-align:center;">
      <div style="font-size:0.62rem;color:#64748b;text-transform:uppercase;font-weight:700;margin-bottom:4px;">Withdrawn</div>
      <div style="font-family:'JetBrains Mono',monospace;font-weight:700;color:#ef4444;font-size:1rem;">🪙 ${totalWithdrawn.toLocaleString(undefined,{minimumFractionDigits:2})}</div>
    </div>
    <div style="background:#0f172a;border:1px solid #334155;border-radius:8px;padding:12px;text-align:center;">
      <div style="font-size:0.62rem;color:#64748b;text-transform:uppercase;font-weight:700;margin-bottom:4px;">Bet Volume</div>
      <div style="font-family:'JetBrains Mono',monospace;font-weight:700;color:#3b82f6;font-size:1rem;">🪙 ${totalBetVol.toLocaleString(undefined,{minimumFractionDigits:2})}</div>
    </div>`;

  const cellStyle = 'padding:8px 14px;border-bottom:1px solid #0f172a;font-size:0.78rem;';
  document.getElementById('historyTxBody').innerHTML = txs.length === 0
    ? '<tr><td colspan="5" style="text-align:center;padding:16px;color:#64748b;">No transactions</td></tr>'
    : txs.map(tx => {
        const other = tx.sender_id === userId ? allUsers.find(u => u.id === tx.receiver_id) : allUsers.find(u => u.id === tx.sender_id);
        const dir = tx.receiver_id === userId ? '+' : '-';
        const col = dir === '+' ? '#10b981' : '#ef4444';
        return `<tr>
          <td style="${cellStyle}color:#64748b;white-space:nowrap;">${new Date(tx.created_at).toLocaleDateString()}</td>
          <td style="${cellStyle}"><span style="background:${col}20;color:${col};padding:2px 6px;border-radius:4px;font-weight:700;">${tx.transaction_type}</span></td>
          <td style="${cellStyle}color:#94a3b8;font-family:'JetBrains Mono',monospace;">${other?.login_id || 'System'}</td>
          <td style="${cellStyle}color:#64748b;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${sanitize(tx.notes || '—')}</td>
          <td style="${cellStyle}text-align:right;font-family:'JetBrains Mono',monospace;font-weight:700;color:${col};">${dir}🪙${parseFloat(tx.amount).toLocaleString(undefined,{minimumFractionDigits:2})}</td>
        </tr>`;
      }).join('');

  document.getElementById('historyBetBody').innerHTML = ords.length === 0
    ? '<tr><td colspan="4" style="text-align:center;padding:16px;color:#64748b;">No bets placed</td></tr>'
    : ords.map(o => {
        const outcome = o.outcomes;
        const event = outcome ? allEvents.find(ev => ev.id === outcome.event_id) : null;
        const tc = o.order_type === 'BUY' ? '#3b82f6' : '#ec4899';
        return `<tr>
          <td style="${cellStyle}color:#64748b;white-space:nowrap;">${new Date(o.created_at).toLocaleDateString()}</td>
          <td style="${cellStyle}">
            <div style="color:#e2e8f0;">${(event?.title || '—').substring(0,28)}</div>
            <div style="color:#64748b;font-size:0.72rem;">${outcome?.title || '—'}</div>
          </td>
          <td style="${cellStyle}"><span style="background:${tc}20;color:${tc};padding:2px 6px;border-radius:4px;font-size:0.72rem;font-weight:700;">${o.order_type}</span></td>
          <td style="${cellStyle}text-align:right;font-family:'JetBrains Mono',monospace;color:#e2e8f0;">🪙 ${parseFloat(o.total_cost||0).toLocaleString(undefined,{minimumFractionDigits:2})}</td>
        </tr>`;
      }).join('');
}

// ── FILTER HELPERS ─────────────────────────────────────────────────
function clearBetlogFilters() {
  document.getElementById('betlogFrom').value = '';
  document.getElementById('betlogTo').value = '';
  document.getElementById('betlogEventFilter').value = '';
  document.getElementById('betlogUserSearch').value = '';
  renderBetLog();
}

function clearLedgerFilters() {
  document.getElementById('txFrom').value = '';
  document.getElementById('txTo').value = '';
  document.getElementById('txTypeFilter').value = '';
  document.getElementById('txUserSearch').value = '';
  renderLedger();
}

function exportBetlogCSV() {
  const headers = ['Time', 'User', 'Event', 'Outcome', 'Type', 'Shares', 'Price (c)', 'Total'];
  const rows = allOrders.map(o => {
    const user = allUsers.find(u => u.id === o.user_id);
    const outcome = allOutcomes.find(oc => oc.id === o.outcome_id);
    const event = outcome ? allEvents.find(ev => ev.id === outcome.event_id) : null;
    return [
      new Date(o.created_at).toLocaleString(),
      user?.login_id || '',
      (event?.title || '').replace(/,/g, ';'),
      (outcome?.title || '').replace(/,/g, ';'),
      o.order_type,
      o.shares || 0,
      o.price_per_share || 0,
      o.total_cost || 0
    ];
  });
  const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = `bhandai_betlog_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  showToast('Bet log exported', 'success');
}

// ── AUDIT LOG ─────────────────────────────────────────────────────
async function auditLog(action, details = {}) {
  try {
    await sb.from('audit_logs').insert({
      actor_id: currentUser.id,
      actor_login_id: currentUser.login_id,
      action,
      target_id: details.targetId || null,
      target_login_id: details.targetLoginId || null,
      details: details.extra || null,
      amount: details.amount || null,
      user_agent: navigator.userAgent.substring(0, 200)
    });
  } catch(e) {
    console.warn('Audit log failed (non-blocking):', e.message);
  }
}

function renderAuditLog() {
  const from = document.getElementById('auditFrom').value;
  const to   = document.getElementById('auditTo').value;
  const actionFilter = document.getElementById('auditActionFilter').value;
  const actorSearch  = document.getElementById('auditActorSearch').value.toLowerCase();

  let logs = [...allAuditLogs];
  if (from) logs = logs.filter(l => l.created_at >= from);
  if (to)   logs = logs.filter(l => l.created_at <= to + 'T23:59:59');
  if (actionFilter) logs = logs.filter(l => l.action === actionFilter);
  if (actorSearch)  logs = logs.filter(l => (l.actor_login_id || '').toLowerCase().includes(actorSearch));

  const tbody = document.getElementById('auditLogBody');
  if (!logs.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:#64748b;">No audit entries match filters</td></tr>';
    return;
  }

  const actionColors = {
    CREATE_AGENT: '#a78bfa', CREATE_CLIENT: '#34d399',
    DEPOSIT: '#10b981', WITHDRAWAL: '#ef4444',
    SETTLE_MARKET: '#3b82f6', VOID_MARKET: '#f59e0b',
    SUSPEND_USER: '#ef4444', ACTIVATE_USER: '#10b981',
    DELETE_MARKET: '#ef4444', SUSPEND_MARKET: '#f59e0b', RESUME_MARKET: '#10b981',
    AGENT_SETTLEMENT: '#ec4899', BROADCAST: '#94a3b8',
    ADMIN_TOPUP: '#f59e0b', TOGGLE_CONFIG: '#64748b',
    UPDATE_USER: '#94a3b8', CREATE_MARKET: '#a78bfa', SAVE_BET_LIMITS: '#64748b',
    RESET_PASSWORD: '#f59e0b', EMERGENCY_HALT: '#ef4444'
  };
  const cellS = 'padding:10px 16px;border-bottom:1px solid #0f172a;font-size:0.8rem;vertical-align:middle;';
  tbody.innerHTML = logs.map(l => {
    const col = actionColors[l.action] || '#64748b';
    const detailStr = l.details ? JSON.stringify(l.details).substring(0, 70) : '—';
    const amt = l.amount != null ? `🪙 ${parseFloat(l.amount).toLocaleString(undefined,{minimumFractionDigits:2})}` : '—';
    return `<tr>
      <td style="${cellS}color:#64748b;white-space:nowrap;">${new Date(l.created_at).toLocaleString()}</td>
      <td style="${cellS}font-family:'JetBrains Mono',monospace;color:#e2e8f0;">${l.actor_login_id || '—'}</td>
      <td style="${cellS}"><span style="background:${col}20;color:${col};padding:3px 8px;border-radius:5px;font-weight:700;font-size:0.72rem;">${l.action}</span></td>
      <td style="${cellS}font-family:'JetBrains Mono',monospace;color:#94a3b8;">${l.target_login_id || '—'}</td>
      <td style="${cellS}font-family:'JetBrains Mono',monospace;">${amt}</td>
      <td style="${cellS}color:#64748b;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${detailStr}</td>
    </tr>`;
  }).join('');
}

function clearAuditFilters() {
  document.getElementById('auditFrom').value = '';
  document.getElementById('auditTo').value = '';
  document.getElementById('auditActionFilter').value = '';
  document.getElementById('auditActorSearch').value = '';
  renderAuditLog();
}

function exportAuditCSV() {
  const headers = ['Time', 'Actor', 'Action', 'Target', 'Amount', 'Details'];
  const rows = allAuditLogs.map(l => [
    new Date(l.created_at).toLocaleString(),
    l.actor_login_id || '',
    l.action,
    l.target_login_id || '',
    l.amount || '',
    l.details ? JSON.stringify(l.details).replace(/,/g, ';') : ''
  ]);
  const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = `bhandai_audit_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  showToast('Audit log exported', 'success');
}

// ── RESET USER PASSWORD ────────────────────────────────────────────
async function resetUserPassword(userId, loginId) {
  if (!confirm(`Reset password for ${loginId}?\n\nA new 6-digit password will be generated and saved. The old password will stop working immediately.`)) return;

  const newPassword = AuthSystem.generatePassword();
  const email = AuthSystem.toEmail(loginId);

  try {
    // Step 1: sign in as the user using their current initial_password via temp client
    const user = allUsers.find(u => u.id === userId);
    if (!user?.initial_password) {
      showToast(`Cannot reset — initial password not on record for ${loginId}. Use Supabase dashboard.`, 'error');
      return;
    }

    const _tmp = window.supabase.createClient(window._sbConfig.url, window._sbConfig.key, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    const { data: signInData, error: signInErr } = await _tmp.auth.signInWithPassword({
      email, password: user.initial_password
    });
    if (signInErr) {
      showToast(`Sign-in as ${loginId} failed: ${signInErr.message}. Use Supabase dashboard to reset manually.`, 'error');
      return;
    }

    // Step 2: update their password using their own session
    const { error: updateErr } = await _tmp.auth.updateUser({ password: newPassword });
    if (updateErr) throw new Error(updateErr.message);

    // Step 3: update initial_password in betting_users so admin can see it
    await sb.from('betting_users').update({ initial_password: newPassword }).eq('id', userId);

    await auditLog('RESET_PASSWORD', { targetId: userId, targetLoginId: loginId });

    showToast(`✅ Password reset for ${loginId}`, 'success');

    // Show the new credentials clearly
    alert(`New credentials for ${loginId}:\n\nLogin ID: ${loginId}\nNew Password: ${newPassword}\n\nShare this securely. Old password is now invalid.`);

    await refreshData();
  } catch(err) { showToast('Reset failed: ' + err.message, 'error'); }
}

// ── CREDENTIAL MASK TOGGLE ─────────────────────────────────────────
function togglePwVis(userId, pw) {
  const el = document.getElementById('pw_' + userId);
  if (!el) return;
  if (el.dataset.visible === '1') {
    el.textContent = '●●●●●●';
    el.dataset.visible = '0';
  } else {
    el.textContent = pw;
    el.dataset.visible = '1';
  }
}

// No outside-click-to-close — modals only close via x or Cancel buttons

  // -- GLOBAL ALIASES for HTML onclick/oninput/onchange handlers --
  // Navigation
  window.switchTab = switchTab;
  window.refreshData = refreshData;

  // User Management
  window.openCreateUserModal = openCreateUserModal;
  window.submitCreateUser = submitCreateUser;
  window.openFundsModal = openFundsModal;
  window.submitFunds = submitFunds;
  window.openEditModal = openEditModal;
  window.submitEditUser = submitEditUser;
  window.openUserHistory = openUserHistory;
  window.resetUserPassword = resetUserPassword;
  window.togglePwVis = togglePwVis;

  // Market Management
  window.setMarketType = setMarketType;
  window.openCreateMatchModal = openCreateMatchModal;
  window.addOutcomeRow = addOutcomeRow;
  window.updateKhaiPreview = updateKhaiPreview;
  window.submitCreateMatch = submitCreateMatch;
  window.openSettleModal = openSettleModal;
  window.updateFancyPreview = updateFancyPreview;
  window.updatePayoutPreview = updatePayoutPreview;
  window.submitSettle = submitSettle;
  window.openResultModal = openResultModal;
  window.selectResultTeam = selectResultTeam;
  window.confirmMatchResult = confirmMatchResult;
  window.closeResultModal = closeResultModal;
  window.toggleEventStatus = toggleEventStatus;
  window.deleteEvent = deleteEvent;
  window.voidMarket = voidMarket;
  window.duplicateEvent = duplicateEvent;

  // Settlement
  window.renderSettlement = renderSettlement;
  window.openAgentSettleModal = openAgentSettleModal;
  window.submitAgentSettlement = submitAgentSettlement;

  // Simulation
  window.toggleSim = toggleSim;
  window.stopAllSims = stopAllSims;
  window.haltAllMarkets = haltAllMarkets;

  // Platform Config
  window.toggleConfig = toggleConfig;
  window.savePlatformConfig = savePlatformConfig;
  window.loadPlatformConfig = loadPlatformConfig;

  // Broadcast
  window.sendBroadcast = sendBroadcast;
  window.deleteAnnouncement = deleteAnnouncement;

  // Settings
  window.saveDefaults = saveDefaults;
  window.confirmClearLedger = confirmClearLedger;
  window.confirmPlatformReset = confirmPlatformReset;

  // Export / Filters
  window.downloadLedgerCSV = downloadLedgerCSV;
  window.exportBetlogCSV = exportBetlogCSV;
  window.exportAuditCSV = exportAuditCSV;
  window.clearBetlogFilters = clearBetlogFilters;
  window.clearLedgerFilters = clearLedgerFilters;
  window.clearAuditFilters = clearAuditFilters;

  // Render functions called from oninput/onclick
  window.renderUsers = renderUsers;
  window.renderLedger = renderLedger;
  window.renderBetLog = renderBetLog;
  window.renderMarkets = renderMarkets;
  window.renderAuditLog = renderAuditLog;
  window.renderBalanceSheet = renderBalanceSheet;

  // Audit
  window.auditLog = auditLog;

  // Expose namespace functions
  Admin.refreshData = refreshData;
  Admin.switchTab = switchTab;
  Admin.renderActiveTab = renderActiveTab;
  Admin.auditLog = auditLog;

})();
