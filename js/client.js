// ────────────────────────────────────────────────────────────────
// CLIENT PANEL  ·  Bhandai Exchange
// Extracted from client.html inline <script> into window.Client namespace.
// Depends on: lib/utils.js (window.BX), lib/commission.js, lib/pnl.js, auth.js
// ────────────────────────────────────────────────────────────────
(function () {
  'use strict';

  var Client = window.Client = {};
  var db = window.supabaseClient;

  // ── STATE ──────────────────────────────────────────────────────
  var currentUser = null, currentProfile = null;
  var allEvents = [], allOutcomes = [], myOrders = [], announcements = [];
  var myCommissions = [];
  var marketFilter = 'ALL', portfolioFilter = 'OPEN', historyFilter = 'ALL';
  var marketSearch = '';
  var isSubmitting = false;
  var expandedMatchId = null;
  var matchDetailMode = false;
  var currentMatchId  = null;
  var bsState = { eventId: null, outcomeId: null, side: null, backPrice: null, isFancy: false, line: null, oddsAtOpen: null };
  var _autoRefreshInterval = null;
  var _realtimeChannel = null;
  var _prevOdds = {};  // outcomeId -> back_price, for flash detection
  var activeTab = 'markets';
  var bsCountdownTimer = null;
  var bsCountdownSecs  = 10;

  // ── P&L WRAPPERS (delegate to BX pure functions) ──────────────
  function _getLiveRate(ord) {
    return BX.getLiveRate(ord, allOutcomes, allEvents);
  }

  function _calcOrderPnl(ord) {
    return BX.calcOrderPnl(ord, allOutcomes, allEvents);
  }

  function calcEventBook(eventId) {
    return BX.calcEventBook(eventId, myOrders, allOutcomes, allEvents);
  }

  // ── INIT ──────────────────────────────────────────────────────
  Client.init = async function init() {
    var result = await window.AuthSystem.requireRole('CLIENT');
    if (!result) return;
    var session = result.session;
    var profile = result.profile;
    currentUser = session.user;
    currentProfile = profile;
    document.getElementById('authGate').style.display = 'none';
    window.AuthSystem.startSessionTimeout(30);
    window.AuthSystem.startStatusPolling(currentUser.id, 60);
    renderAccountTab();
    await refreshData();
    loadAnnouncements();
    startAutoRefresh();
    startRealtime();
    setupOfflineDetection();
    setupPullToRefresh();
    setupBetSlipGestures();
    setupEscKey();
  };

  // ── DATA ──────────────────────────────────────────────────────
  async function refreshData() {
    var refreshBtns = document.querySelectorAll('.refresh-icon-btn');
    refreshBtns.forEach(function (b) { b.classList.add('spinning'); });

    var results = await Promise.all([
      db.from('events').select('*').not('status','eq','VOID').order('created_at',{ascending:false}),
      db.from('outcomes').select('*'),
      db.from('orders')
        .select('*, events(title,market_type,status,line_value,result_value,winning_outcome,rate_team), outcomes(title,back_price,is_yes_outcome)')
        .eq('user_id', currentUser.id)
        .order('created_at', {ascending:false})
        .limit(500),
      db.from('credit_transactions').select('*')
        .eq('receiver_id', currentUser.id)
        .eq('transaction_type', 'COMMISSION')
        .order('created_at', {ascending:false})
        .limit(100)
    ]);

    allEvents      = results[0].data  || [];
    allOutcomes    = results[1].data  || [];
    myOrders       = results[2].data || [];
    myCommissions  = results[3].data || [];

    await syncBalance();
    renderMarketsTab();
    renderAccountTab();
    updateOpenBetsBadge();
    if (activeTab === 'portfolio') renderPortfolioTab();
    if (activeTab === 'history')   renderHistoryTab();

    refreshBtns.forEach(function (b) { b.classList.remove('spinning'); });
  }
  Client.refreshData = refreshData;

  function startAutoRefresh() {
    clearInterval(_autoRefreshInterval);
    _autoRefreshInterval = setInterval(function () {
      if (!document.hidden) refreshData();
    }, 10000);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) refreshData();
    });
  }

  // ── REALTIME ─────────────────────────────────────────────────
  function startRealtime() {
    if (_realtimeChannel) db.removeChannel(_realtimeChannel);

    _realtimeChannel = db.channel('client-live')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'outcomes' }, function (payload) {
        var updated = payload.new;
        var idx = allOutcomes.findIndex(function (o) { return o.id === updated.id; });
        if (idx >= 0) allOutcomes[idx] = Object.assign({}, allOutcomes[idx], updated);
        else allOutcomes.push(updated);
        renderMarketsTab();
        _refreshLivePnl(); // update portfolio P&L immediately
        if (bsState.outcomeId === updated.id) {
          // Auto-update live rate in slip for non-LK (back/lay) bets
          if (!bsState.isLK && updated.back_price != null) {
            bsState.backPrice = parseFloat(updated.back_price);
            var oddsEl = document.getElementById('bsOddsVal');
            if (oddsEl) oddsEl.textContent = bsState.backPrice.toFixed(2);
          }
          updateBetSlipPreview();
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'events' }, function (payload) {
        var updated = payload.new;
        var idx = allEvents.findIndex(function (e) { return e.id === updated.id; });
        var oldLagai = idx >= 0 ? parseFloat(allEvents[idx].lagai_rate || 0) : null;
        if (idx >= 0) allEvents[idx] = Object.assign({}, allEvents[idx], updated);
        else allEvents.push(updated);

        // Flash Lagai/Khai buttons when rate changes
        if (oldLagai != null && updated.lagai_rate != null) {
          var newLagai = parseFloat(updated.lagai_rate);
          if (Math.abs(newLagai - oldLagai) >= 0.01) {
            var dir = newLagai > oldLagai ? 'up' : 'down';
            // Flash all lk-rate elements inside this market card
            document.querySelectorAll('#mc_' + updated.id + ' .lk-rate').forEach(function (el) {
              el.classList.remove('flash-up','flash-down');
              void el.offsetWidth;
              el.classList.add(dir === 'up' ? 'flash-up' : 'flash-down');
              el.addEventListener('animationend', function () { el.classList.remove('flash-up','flash-down'); }, { once: true });
            });
          }
        }

        renderMarketsTab();
        _refreshLivePnl(); // rates changed -- update all open bet P&Ls immediately

        // Live bet slip updates when this event changes
        if (bsState.eventId === updated.id) {
          // Suspension / resume handling
          if (updated.status === 'SUSPENDED') {
            _showBetSlipSuspended();
          } else if (updated.status === 'ACTIVE') {
            _hideBetSlipSuspended();
          }
          // Auto-update rate for LK bets
          if (bsState.isLK && updated.lagai_rate != null) {
            var newRate = bsState.side === 'KHAI'
              ? parseFloat((parseFloat(updated.lagai_rate) + 0.05).toFixed(2))
              : parseFloat(updated.lagai_rate);
            bsState.backPrice = newRate;
            var oddsEl2 = document.getElementById('bsOddsVal');
            if (oddsEl2) oddsEl2.textContent = newRate.toFixed(2);
            var staleEl = document.getElementById('bsStaleWarn');
            if (staleEl) {
              if (Math.abs(newRate - bsState.oddsAtOpen) >= 0.03) {
                staleEl.style.display = 'block';
                staleEl.textContent = 'Rate moved ' + bsState.oddsAtOpen.toFixed(2) + ' -> ' + newRate.toFixed(2) + '. Review before confirming.';
              } else {
                staleEl.style.display = 'none';
              }
            }
            updateBetSlipPreview();
          }
        }
      })
      .subscribe(function (status) {
        var dot = document.getElementById('rtDot');
        if (dot) dot.className = status === 'SUBSCRIBED' ? 'rt-dot' : 'rt-dot offline';
      });
  }

  function flashOddsEl(outcomeId, dir) {
    // Flash all DOM elements showing this outcome's odds
    document.querySelectorAll('[data-oc="' + outcomeId + '"] .odds-val, [data-oc="' + outcomeId + '"] .fc-yn-odds').forEach(function (el) {
      el.classList.remove('flash-up', 'flash-down');
      void el.offsetWidth;
      el.classList.add(dir === 'up' ? 'flash-up' : 'flash-down');
      el.addEventListener('animationend', function () { el.classList.remove('flash-up','flash-down'); }, { once: true });
    });
  }

  // ── OFFLINE DETECTION ─────────────────────────────────────────
  function setupOfflineDetection() {
    var banner = document.getElementById('offlineBanner');
    var dot    = document.getElementById('rtDot');
    var update = function () {
      var online = navigator.onLine;
      banner.style.display = online ? 'none' : 'block';
      if (dot) dot.className = online ? 'rt-dot' : 'rt-dot offline';
      if (online) refreshData();
    };
    window.addEventListener('online',  update);
    window.addEventListener('offline', update);
    update();
  }

  // ── PULL TO REFRESH ──────────────────────────────────────────
  function setupPullToRefresh() {
    var startY = 0, pulling = false;
    var indicator = document.getElementById('pullIndicator');
    var THRESHOLD = 72;

    document.addEventListener('touchstart', function (e) {
      if (window.scrollY === 0) { startY = e.touches[0].clientY; pulling = true; }
    }, { passive: true });

    document.addEventListener('touchmove', function (e) {
      if (!pulling) return;
      var dy = e.touches[0].clientY - startY;
      if (dy > 20 && window.scrollY === 0) {
        indicator.style.display = 'block';
        indicator.className = dy > THRESHOLD ? 'ready' : '';
        indicator.textContent = dy > THRESHOLD ? 'Release to refresh' : 'Pull to refresh';
      }
    }, { passive: true });

    document.addEventListener('touchend', function (e) {
      if (!pulling) return;
      pulling = false;
      var dy = e.changedTouches[0].clientY - startY;
      indicator.style.display = 'none';
      if (dy > THRESHOLD && window.scrollY === 0) refreshData();
    });
  }

  async function loadAnnouncements() {
    try {
      var result = await db.from('platform_announcements')
        .select('*').eq('active', true).order('created_at', {ascending:false}).limit(3);
      announcements = result.data || [];
      renderAnnouncements();
    } catch(e) { /* non-blocking */ }
  }

  function renderAnnouncements() {
    var con = document.getElementById('announceContainer');
    if (!announcements.length) { con.innerHTML = ''; return; }
    con.innerHTML = announcements.map(function (a) {
      return '<div class="announce-banner">' +
        '<div class="ab-icon">📢</div>' +
        '<div class="ab-text">' + sanitize(a.message || a.content || '') + '</div>' +
        '</div>';
    }).join('');
  }

  function updateOpenBetsBadge() {
    var open = myOrders.filter(function (o) { return o.status === 'OPEN'; }).length;
    var badge = document.getElementById('openBetsBadge');
    if (open > 0) {
      badge.textContent = open > 9 ? '9+' : open;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }

  async function syncBalance() {
    var result = await db.from('betting_users').select('balance').eq('id', currentUser.id).single();
    if (result.data) {
      currentProfile.balance = result.data.balance;
      var b = fmt(result.data.balance, 2);
      document.getElementById('headerBalance').textContent = b;
      document.getElementById('acctBalance').textContent   = b;
    }
  }

  // ── TABS ──────────────────────────────────────────────────────
  function showTab(tab) {
    document.querySelectorAll('.tab-content').forEach(function (t) { t.classList.remove('active'); });
    document.querySelectorAll('.bnav-item').forEach(function (b) { b.classList.remove('active'); });
    document.getElementById('tab-' + tab).classList.add('active');
    document.getElementById('bnav-' + tab).classList.add('active');
    activeTab = tab;
    if (tab === 'portfolio') renderPortfolioTab();
    if (tab === 'history')   { renderHistoryTab(); }
    if (navigator.vibrate)   navigator.vibrate(8);
  }
  Client.showTab = showTab;

  function setMarketFilter(f, el) {
    marketFilter = f;
    document.querySelectorAll('.filter-row .filter-pill').forEach(function (p) { p.classList.remove('active'); });
    if (el) el.classList.add('active');
    renderMarketsTab();
  }
  Client.setMarketFilter = setMarketFilter;

  function setPortfolioFilter(f, el) {
    portfolioFilter = f;
    document.querySelectorAll('#tab-portfolio .filter-pill').forEach(function (p) { p.classList.remove('active'); });
    if (el) el.classList.add('active');
    renderPortfolioTab();
  }
  Client.setPortfolioFilter = setPortfolioFilter;

  // ── MARKETS ─────────────────────────────────────────────────
  function renderMarketsTab() {
    if (matchDetailMode) { renderMatchDetailView(); return; }
    renderMatchListView();
  }
  Client.renderMarketsTab = renderMarketsTab;

  // ── LIST VIEW ───────────────────────────────────────────────────
  function renderMatchListView() {
    var evs = allEvents.filter(function (e) {
      return e.status !== 'SETTLED' && e.status !== 'VOID' && e.market_type !== 'FANCY';
    });
    if (marketFilter !== 'ALL') evs = evs.filter(function (e) { return e.category === marketFilter; });

    var searchEl = document.getElementById('marketSearch');
    var q = (searchEl ? searchEl.value : '').trim().toLowerCase();
    if (q) evs = evs.filter(function (e) { return (e.title||'').toLowerCase().includes(q) || (e.category||'').toLowerCase().includes(q); });

    evs.sort(function (a,b) { return (a.status==='SUSPENDED'?1:0) - (b.status==='SUSPENDED'?1:0); });

    var con = document.getElementById('marketsListContainer');
    if (!evs.length) {
      con.innerHTML = '<div class="empty-state"><div class="es-icon">🏏</div><div class="es-text">' + (q?'No matching markets':'No live markets') + '</div><div class="es-sub">' + (q?'Try a different search':'Markets will appear here once opened') + '</div></div>';
      return;
    }

    con.innerHTML = evs.map(function (ev) {
      var susp = ev.status === 'SUSPENDED';
      var parts = ev.title.split(/\s+vs\s+/i);
      var teamA = (parts[0] || '').trim() || ev.title;
      var teamB = (parts[1] || '').trim() || '';
      var initA = teamA.slice(0,2).toUpperCase();
      var initB = teamB ? teamB.slice(0,2).toUpperCase() : '??';
      var cA = _avatarColor(teamA), cB = _avatarColor(teamB || 'XX');
      var openBetsHere = myOrders.filter(function (o) { return o.event_id === ev.id && o.status === 'OPEN'; }).length;
      return '<div class="match-list-card" onclick="showMatchDetail(\'' + ev.id + '\')">' +
        '<div class="mlc-avatars">' +
          '<div class="mlc-avatar" style="background:' + cA.bg + ';color:' + cA.fg + ';">' + initA + '</div>' +
          '<div class="mlc-vs">vs</div>' +
          '<div class="mlc-avatar" style="background:' + cB.bg + ';color:' + cB.fg + ';">' + initB + '</div>' +
        '</div>' +
        '<div class="mlc-info">' +
          '<div class="mlc-title">' + sanitize(ev.title) + '</div>' +
          (ev.sub_category ? '<div class="mlc-sub">' + sanitize(ev.sub_category) + '</div>' : '') +
          '<div class="mlc-meta">' +
            (susp
              ? '<span class="mlc-badge susp">⏸ Suspended</span>'
              : '<span class="mlc-badge live"><span class="mlc-live-dot"></span>Live</span>') +
            (openBetsHere ? '<span class="mlc-open-chip">📊 ' + openBetsHere + ' open</span>' : '') +
          '</div>' +
        '</div>' +
        '<div class="mlc-chevron">›</div>' +
      '</div>';
    }).join('');
  }

  // ── DETAIL VIEW ─────────────────────────────────────────────────
  function renderMatchOddsCard(ev) {
    var susp = ev.status === 'SUSPENDED';
    var ocs  = allOutcomes.filter(function (o) { return o.event_id === ev.id; });
    var oc0  = ocs[0];
    var oc1  = ocs[1];
    var favTeam   = ev.rate_team || (oc0 ? oc0.title : null) || ev.title;
    var otherTeam = (oc1 ? oc1.title : null) || 'Team 2';

    var openBetsHere = myOrders.filter(function (o) { return o.event_id === ev.id && o.status === 'OPEN'; }).length;
    var ebookBar = '';
    if (openBetsHere) {
      var book = calcEventBook(ev.id);
      if (book) {
        var fwC = book.favWins  >= 0 ? '#10b981' : '#ef4444';
        var flC = book.favLoses >= 0 ? '#10b981' : '#ef4444';
        ebookBar =
          '<div class="event-book-bar" id="ebook_' + ev.id + '">' +
            '<div class="ebook-item"><span class="ebook-label">If ' + sanitize(favTeam) + ' wins</span><span class="ebook-val" id="ebook_fw_' + ev.id + '" style="color:' + fwC + ';">' + (book.favWins>=0?'+':'') + '🪙' + fmt(Math.abs(book.favWins),0) + '</span></div>' +
            '<div class="ebook-divider"></div>' +
            '<div class="ebook-item"><span class="ebook-label">If ' + sanitize(otherTeam) + ' wins</span><span class="ebook-val" id="ebook_fl_' + ev.id + '" style="color:' + flC + ';">' + (book.favLoses>=0?'+':'') + '🪙' + fmt(Math.abs(book.favLoses),0) + '</span></div>' +
          '</div>';
      }
    }

    var body = '';
    if (susp) {
      body = '<div class="susp-body"><div class="susp-body-text">SUSPENDED</div><div class="susp-body-hint">Betting paused — resuming shortly</div></div>';
    } else {
      var lagai = parseFloat(ev.lagai_rate != null ? ev.lagai_rate : 0.50);
      var khai  = parseFloat((lagai + 0.05).toFixed(2));
      var tableRows = '';
      if (oc0) {
        tableRows =
          '<div class="lk-table-row" id="lkrow_' + ev.id + '">' +
            '<div class="lk-td-team">' + sanitize(favTeam) + '</div>' +
            '<div class="lk-td lagai-cell lk-rate" onclick="openLKBetSlip(\'' + ev.id + '\',\'' + oc0.id + '\',\'LAGAI\',' + lagai + ',\'' + sanitize(favTeam).replace(/'/g, "\\'") + '\',\'' + sanitize(ev.title).replace(/'/g, "\\'") + '\')">' + lagai.toFixed(2) + '</div>' +
            '<div class="lk-td khai-cell lk-rate" onclick="openLKBetSlip(\'' + ev.id + '\',\'' + (oc1 ? oc1.id : oc0.id) + '\',\'KHAI\',' + khai + ',\'' + sanitize(favTeam).replace(/'/g, "\\'") + '\',\'' + sanitize(ev.title).replace(/'/g, "\\'") + '\')">' + khai.toFixed(2) + '</div>' +
          '</div>' +
          '<div class="lk-table-row"><div class="lk-td-team susp-team">' + sanitize(otherTeam) + '</div><div class="lk-td susp-cell">&mdash;</div><div class="lk-td susp-cell">&mdash;</div></div>';
      } else {
        tableRows = '<div style="padding:10px 0 6px;text-align:center;color:#475569;font-size:0.78rem;">Rates loading</div>';
      }
      body =
        '<div class="lk-table">' +
          '<div class="lk-table-header"><div></div><div class="lk-th lagai-h">LAGAI</div><div class="lk-th khai-h">KHAI</div></div>' +
          tableRows +
        '</div>';
    }

    return '<div class="match-odds-card" id="mc_' + ev.id + '">' + ebookBar + body + '</div>';
  }

  function renderMatchDetailView() {
    var ev = allEvents.find(function (e) { return e.id === currentMatchId; });
    if (!ev) return;

    var titleEl = document.getElementById('detailMatchTitle');
    if (titleEl) titleEl.textContent = ev.title;

    var linkedFancies = allEvents.filter(function (fe) {
      return fe.market_type === 'FANCY'
        && fe.parent_event_id === currentMatchId
        && fe.status !== 'SETTLED'
        && fe.status !== 'VOID';
    });

    var html = renderMatchOddsCard(ev);
    if (linkedFancies.length) {
      html += '<div class="section-head" style="margin-top:14px;">Session Bets</div>';
      html += linkedFancies.map(renderFancyCard).join('');
    }
    document.getElementById('matchDetailContainer').innerHTML = html;
  }

  function showMatchList() {
    matchDetailMode = false;
    currentMatchId  = null;
    document.getElementById('matchListView').style.display   = '';
    document.getElementById('matchDetailView').style.display = 'none';
    renderMatchListView();
  }
  Client.showMatchList = showMatchList;

  function showMatchDetail(eventId) {
    matchDetailMode = true;
    currentMatchId  = eventId;
    document.getElementById('matchListView').style.display   = 'none';
    document.getElementById('matchDetailView').style.display = '';
    renderMatchDetailView();
  }
  Client.showMatchDetail = showMatchDetail;

  function _avatarColor(seed) {
    var colors = [
      ['#4f46e5','#c7d2fe'],['#059669','#d1fae5'],['#dc2626','#fee2e2'],
      ['#d97706','#fef3c7'],['#7c3aed','#ede9fe'],['#0891b2','#cffafe']
    ];
    var h = 0;
    for (var i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) & 0xffffffff;
    var pair = colors[Math.abs(h) % colors.length];
    return { bg: pair[0], fg: pair[1] };
  }

  function renderMatchGroup(ev, linkedFancies) {
    linkedFancies = linkedFancies || [];
    var susp = ev.status === 'SUSPENDED';
    var isExpanded = true; // always show match bets, no click needed

    // Extract team names from "Team A vs Team B"
    var parts = ev.title.split(/\s+vs\s+/i);
    var teamA = (parts[0] || '').trim() || ev.title;
    var teamB = (parts[1] || '').trim() || '';
    var initA = teamA.slice(0,2).toUpperCase();
    var initB = teamB ? teamB.slice(0,2).toUpperCase() : 'B2';
    var cA = _avatarColor(teamA), cB = _avatarColor(teamB || 'B2');

    // Compute outcomes + team labels at top level (needed by ebook bar)
    var ocs      = allOutcomes.filter(function (o) { return o.event_id === ev.id; });
    var oc0      = ocs[0];
    var oc1      = ocs[1];
    var favTeam  = ev.rate_team || (oc0 ? oc0.title : null) || teamA;
    var otherTeam = (oc1 ? oc1.title : null) || teamB || 'Team 2';

    var openBetsHere = myOrders.filter(function (o) { return o.event_id === ev.id && o.status === 'OPEN'; }).length;

    var header = '' +
    '<div class="match-group-header">' +
      '<div class="team-avatars">' +
        '<div class="team-avatar" style="background:' + cA.bg + ';color:' + cA.fg + ';">' + initA + '</div>' +
        '<div class="team-vs">vs</div>' +
        '<div class="team-avatar" style="background:' + cB.bg + ';color:' + cB.fg + ';">' + initB + '</div>' +
      '</div>' +
      '<div class="match-group-info">' +
        '<div class="mg-title">' + sanitize(ev.title) + '</div>' +
        (ev.sub_category ? '<div class="mg-sub">' + sanitize(ev.sub_category) + '</div>' : '') +
        '<div class="mg-status">' +
          (susp
            ? '<span class="mg-susp-text">⏸ SUSPENDED</span>'
            : '<span class="mg-live-dot"></span><span class="mg-live-text">LIVE</span>') +
          (openBetsHere ? '<span class="mg-open-chip">📊 ' + openBetsHere + ' open</span>' : '') +
        '</div>' +
      '</div>' +
    '</div>';

    // Event book bar -- always visible when user has open bets on this event.
    // Uses IDs so _refreshLivePnl() can update values without re-render.
    var ebookBar = '';
    if (openBetsHere) {
      var book = calcEventBook(ev.id);
      if (book) {
        var fwC = book.favWins  >= 0 ? '#10b981' : '#ef4444';
        var flC = book.favLoses >= 0 ? '#10b981' : '#ef4444';
        ebookBar = '' +
        '<div class="event-book-bar" id="ebook_' + ev.id + '">' +
          '<div class="ebook-item">' +
            '<span class="ebook-label">If ' + sanitize(favTeam) + ' wins</span>' +
            '<span class="ebook-val" id="ebook_fw_' + ev.id + '" style="color:' + fwC + ';">' + (book.favWins>=0?'+':'') + '🪙' + fmt(Math.abs(book.favWins),0) + '</span>' +
          '</div>' +
          '<div class="ebook-divider"></div>' +
          '<div class="ebook-item">' +
            '<span class="ebook-label">If ' + sanitize(otherTeam) + ' wins</span>' +
            '<span class="ebook-val" id="ebook_fl_' + ev.id + '" style="color:' + flC + ';">' + (book.favLoses>=0?'+':'') + '🪙' + fmt(Math.abs(book.favLoses),0) + '</span>' +
          '</div>' +
        '</div>';
      }
    }

    var body = '';
    if (isExpanded) {
      if (susp) {
        body = '' +
        '<div class="match-group-body">' +
          '<div class="susp-body">' +
            '<div class="susp-body-text">SUSPENDED</div>' +
            '<div class="susp-body-hint">Betting paused -- resuming shortly</div>' +
          '</div>' +
        '</div>';
      } else {
        var lagai = parseFloat(ev.lagai_rate != null ? ev.lagai_rate : 0.50);
        var khai  = parseFloat((lagai + 0.05).toFixed(2));

        var tableRows = '';
        if (oc0) {
          tableRows = '' +
          '<div class="lk-table-row" id="lkrow_' + ev.id + '">' +
            '<div class="lk-td-team">' + sanitize(favTeam) + '</div>' +
            '<div class="lk-td lagai-cell lk-rate"' +
              ' onclick="openLKBetSlip(\'' + ev.id + '\',\'' + oc0.id + '\',\'LAGAI\',' + lagai + ',\'' + sanitize(favTeam).replace(/'/g, "\\'") + '\',\'' + sanitize(ev.title).replace(/'/g, "\\'") + '\')">' +
              lagai.toFixed(2) +
            '</div>' +
            '<div class="lk-td khai-cell lk-rate"' +
              ' onclick="openLKBetSlip(\'' + ev.id + '\',\'' + (oc1 ? oc1.id : oc0.id) + '\',\'KHAI\',' + khai + ',\'' + sanitize(favTeam).replace(/'/g, "\\'") + '\',\'' + sanitize(ev.title).replace(/'/g, "\\'") + '\')">' +
              khai.toFixed(2) +
            '</div>' +
          '</div>' +
          '<div class="lk-table-row">' +
            '<div class="lk-td-team susp-team">' + sanitize(otherTeam) + '</div>' +
            '<div class="lk-td susp-cell">&mdash;</div>' +
            '<div class="lk-td susp-cell">&mdash;</div>' +
          '</div>';
        } else {
          tableRows = '<div style="padding:10px 0 6px;text-align:center;color:#475569;font-size:0.78rem;">Rates loading</div>';
        }

        body = '' +
        '<div class="match-group-body">' +
          '<div class="lk-table">' +
            '<div class="lk-table-header">' +
              '<div></div>' +
              '<div class="lk-th lagai-h">LAGAI</div>' +
              '<div class="lk-th khai-h">KHAI</div>' +
            '</div>' +
            tableRows +
          '</div>' +
        '</div>';
      }
    }

    var fancySection = '';
    if (linkedFancies.length) {
      fancySection = '<div class="match-fancy-section">' +
        '<div class="match-fancy-head">Session Bets</div>' +
        linkedFancies.map(renderFancyCard).join('') +
        '</div>';
    }

    return '<div class="match-group' + (susp?' suspended':'') + (isExpanded?' expanded':'') + '" id="mc_' + ev.id + '">' + header + ebookBar + body + fancySection + '</div>';
  }

  function toggleMatchGroup(eventId) {
    expandedMatchId = expandedMatchId === eventId ? null : eventId;
    renderMarketsTab();
  }
  Client.toggleMatchGroup = toggleMatchGroup;

  function renderFancyCard(ev) {
    var ocs  = allOutcomes.filter(function (o) { return o.event_id === ev.id; });
    var yesOc = ocs.find(function (o) { return o.is_yes_outcome; }) || ocs[0];
    var noOc  = ocs.find(function (o) { return !o.is_yes_outcome; }) || ocs[1];
    var rawLine = parseFloat(ev.line_value != null ? ev.line_value : (ev.base_line != null ? ev.base_line : 0));
    var gap   = parseInt(ev.fancy_gap || 1);
    var lineNo  = gap === 1 ? Math.floor(rawLine) : Math.round(rawLine) - 1;
    var lineYes = gap === 1 ? Math.ceil(rawLine)  : Math.round(rawLine) + 1;
    var line  = rawLine; // keep for bet placement
    var bpRaw = yesOc ? parseFloat(yesOc.back_price || 1.9) : 1.9;
    var bp    = bpRaw.toFixed(1); // show 1 decimal: "1.9" not "1.90"
    var susp  = ev.status === 'SUSPENDED';
    var openBetsHere = myOrders.filter(function (o) { return o.event_id === ev.id && o.status === 'OPEN'; }).length;

    var headerHtml = '' +
    '<div class="fc-header">' +
      '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
        '<span class="fc-type-badge">' + fancyTypeLabel(ev.fancy_type) + '</span>' +
        (susp ? '<span style="font-size:0.6rem;color:#f59e0b;font-weight:700;">⏸ Paused</span>' : '<span style="font-size:0.6rem;color:#10b981;font-weight:700;">● Live</span>') +
        (openBetsHere ? '<span class="mc-open-chip">📊 ' + openBetsHere + ' open</span>' : '') +
      '</div>' +
      '<div class="fc-title">' + sanitize(ev.title) + '</div>' +
      (ev.sub_category ? '<div style="font-size:0.7rem;color:#64748b;margin-top:2px;">' + sanitize(ev.sub_category) + '</div>' : '') +
    '</div>';

    var bodyHtml = '';
    if (susp) {
      bodyHtml = '<div class="suspended-fancy-msg">⏸ SUSPENDED</div>';
    } else {
      var yesBtn = '';
      if (yesOc) {
        yesBtn = '<div class="fc-yes-btn" data-oc="' + yesOc.id + '" onclick="openFancyBetSlip(\'' + ev.id + '\',\'' + yesOc.id + '\',\'YES\',' + bpRaw + ',' + line + ',' + lineNo + ',' + lineYes + ',\'' + sanitize(ev.title).replace(/'/g, "\\'") + '\')">' +
          '<div class="fc-yn-runs">' + lineYes + '</div>' +
          '<div class="fc-yn-label" style="font-size:0.6rem;">YES</div>' +
          '<div class="fc-yn-odds" style="font-size:0.65rem;color:#64748b;">' + bp + '</div>' +
        '</div>';
      } else {
        yesBtn = '<div style="font-size:0.72rem;color:#475569;text-align:center;padding:10px;">No rates</div>';
      }
      var noBtn = '';
      if (noOc) {
        noBtn = '<div class="fc-no-btn" data-oc="' + noOc.id + '" onclick="openFancyBetSlip(\'' + ev.id + '\',\'' + noOc.id + '\',\'NO\',' + bpRaw + ',' + line + ',' + lineNo + ',' + lineYes + ',\'' + sanitize(ev.title).replace(/'/g, "\\'") + '\')">' +
          '<div class="fc-yn-runs">' + lineNo + '</div>' +
          '<div class="fc-yn-label" style="font-size:0.6rem;">NO</div>' +
          '<div class="fc-yn-odds" style="font-size:0.65rem;color:#64748b;">' + bp + '</div>' +
        '</div>';
      }
      bodyHtml = '' +
      '<div class="fc-body">' +
        '<div class="fc-line-wrap">' +
          '<div class="fc-line-label">' + lineNo + ' / ' + lineYes + '</div>' +
          '<div style="font-size:0.58rem;color:#64748b;margin-top:1px;">runs</div>' +
        '</div>' +
        '<div class="fc-yn-btns">' +
          yesBtn + noBtn +
        '</div>' +
      '</div>';
    }

    return '<div class="fancy-card' + (susp?' suspended':'') + '">' + headerHtml + bodyHtml + '</div>';
  }

  function fancyTypeLabel(t) {
    var labels = {
      '6_OVER_RUNS':'6 Overs','10_OVER_RUNS':'10 Overs','15_OVER_RUNS':'15 Overs',
      'PLAYER_RUNS':'Player','CUSTOM':'Custom'
    };
    return labels[t] || 'Session';
  }

  // ── BET SLIP ──────────────────────────────────────────────────
  // ── LAGAI / KHAI BET SLIP ─────────────────────────────────────
  function openLKBetSlip(eventId, outcomeId, side, rate, favTeam, marketTitle) {
    var ev = allEvents.find(function (e) { return e.id === eventId; });
    if (!ev || ev.status === 'SUSPENDED') return;
    var r = parseFloat(rate);
    bsState = { eventId: eventId, outcomeId: outcomeId, side: side, backPrice: r, isFancy: false, isLK: true, line: null, oddsAtOpen: r, favTeam: favTeam };

    document.getElementById('bsMarket').textContent  = marketTitle || ev.title;
    var ocs = allOutcomes.filter(function (o) { return o.event_id === eventId; });
    var otherTeam = (ocs.length > 1 ? ocs.find(function (o) { return o.id !== (ocs[0] ? ocs[0].id : null); }) : null);
    var otherTeamTitle = otherTeam ? otherTeam.title : 'Other';
    document.getElementById('bsOutcome').textContent = side === 'LAGAI'
      ? favTeam + ' to WIN'
      : otherTeamTitle + ' to WIN';

    var badge = document.getElementById('bsSideBadge');
    badge.textContent = side; badge.className = 'bs-sel-badge ' + side.toLowerCase();
    document.getElementById('bsOddsLabel').textContent = side === 'LAGAI' ? 'Lagai Rate' : 'Khai Rate';
    document.getElementById('bsOddsVal').textContent   = r.toFixed(2);
    document.getElementById('bsFancyInfo').style.display = 'none';
    document.getElementById('bsStaleWarn').style.display = 'none';
    _hideBetSlipSuspended();

    // Show exposure banner if user already has bets on this event
    var openEvOrds = myOrders.filter(function (o) { return o.event_id === eventId && o.status === 'OPEN'; });
    var hedgeBanner = document.getElementById('bsHedgeBanner');
    if (openEvOrds.length > 0) {
      var fw = 0, fl = 0;
      openEvOrds.forEach(function (o) {
        var s = parseFloat(o.total_cost||0), rr = parseFloat(o.price_per_share||1);
        if (o.bet_side === 'LAGAI')     { fw += s * rr; fl -= s; }
        else if (o.bet_side === 'KHAI') { fw -= s;     fl += s / rr; }
      });
      var curExp = Math.max(0, -Math.min(fw, fl));
      hedgeBanner.style.display = 'block';
      document.getElementById('bsHedgeText').textContent =
        'You have ' + openEvOrds.length + ' open bet(s) on this match. Current exposure: 🪙' + fmt(curExp,0) + '. Adding this bet may reduce or increase your locked coins.';
    } else {
      hedgeBanner.style.display = 'none';
    }

    resetBetSlip();
    openBetSlipUI();
  }
  Client.openLKBetSlip = openLKBetSlip;

  function openBetSlip(eventId, outcomeId, side, backPrice, outcomeName, marketTitle) {
    var ev = allEvents.find(function (e) { return e.id === eventId; });
    if (!ev || ev.status === 'SUSPENDED') return;
    var bp = parseFloat(backPrice);
    bsState = { eventId: eventId, outcomeId: outcomeId, side: side, backPrice: bp, isFancy: false, isLK: false, line: null, oddsAtOpen: bp };
    document.getElementById('bsMarket').textContent    = marketTitle || ev.title;
    document.getElementById('bsOutcome').textContent   = outcomeName;
    var badge = document.getElementById('bsSideBadge');
    badge.textContent = side; badge.className = 'bs-sel-badge ' + side.toLowerCase();
    document.getElementById('bsOddsLabel').textContent = side === 'BACK' ? 'Back Odds' : 'Lay Odds';
    document.getElementById('bsOddsVal').textContent   = bp.toFixed(2);
    document.getElementById('bsFancyInfo').style.display = 'none';
    document.getElementById('bsStaleWarn').style.display = 'none';
    document.getElementById('bsHedgeBanner').style.display = 'none';
    _hideBetSlipSuspended();
    resetBetSlip();
    openBetSlipUI();
  }
  Client.openBetSlip = openBetSlip;

  function openFancyBetSlip(eventId, outcomeId, side, backPrice, line, lineNo, lineYes, marketTitle) {
    var ev = allEvents.find(function (e) { return e.id === eventId; });
    if (!ev || ev.status === 'SUSPENDED') return;
    var bp = parseFloat(backPrice);
    bsState = { eventId: eventId, outcomeId: outcomeId, side: side, backPrice: bp, isFancy: true, line: parseFloat(line), lineNo: parseInt(lineNo), lineYes: parseInt(lineYes), oddsAtOpen: bp };
    document.getElementById('bsMarket').textContent  = marketTitle || ev.title;
    document.getElementById('bsOutcome').textContent = side === 'YES' ? 'YES -- if >= ' + lineYes + ' runs' : 'NO -- if <= ' + lineNo + ' runs';
    var badge = document.getElementById('bsSideBadge');
    badge.textContent = side; badge.className = 'bs-sel-badge ' + side.toLowerCase();
    document.getElementById('bsOddsLabel').textContent = 'Odds';
    document.getElementById('bsOddsVal').textContent   = bp.toFixed(2);
    document.getElementById('bsFancyInfo').style.display = 'block';
    document.getElementById('bsLine').textContent = lineNo + ' / ' + lineYes;
    document.getElementById('bsStaleWarn').style.display = 'none';
    document.getElementById('bsHedgeBanner').style.display = 'none';
    _hideBetSlipSuspended();
    resetBetSlip();
    openBetSlipUI();
  }
  Client.openFancyBetSlip = openFancyBetSlip;

  // ── BET SLIP COUNTDOWN ────────────────────────────────────────
  function startBsCountdown() {
    clearBsCountdown();
    bsCountdownSecs = 10;
    _updateCountdownUI();
    bsCountdownTimer = setInterval(function () {
      bsCountdownSecs--;
      _updateCountdownUI();
      if (bsCountdownSecs <= 0) { clearBsCountdown(); closeBetSlip(); }
    }, 1000);
  }

  function resetBsCountdown() {
    bsCountdownSecs = 10;
    _updateCountdownUI();
  }
  Client.resetBsCountdown = resetBsCountdown;

  function clearBsCountdown() {
    if (bsCountdownTimer) { clearInterval(bsCountdownTimer); bsCountdownTimer = null; }
    var lbl  = document.getElementById('bsBtnLabel');
    var prog = document.getElementById('bsBtnProgress');
    if (lbl)  lbl.textContent = 'Place Bet';
    if (prog) { prog.style.width = '100%'; prog.style.background = 'rgba(255,255,255,0.15)'; }
  }

  function _showBetSlipSuspended() {
    var el = document.getElementById('bsSuspendedBanner');
    if (el) el.style.display = 'flex';
    var btn = document.getElementById('bsConfirmBtn');
    if (btn) btn.disabled = true;
    clearBsCountdown();
  }

  function _hideBetSlipSuspended() {
    var el = document.getElementById('bsSuspendedBanner');
    if (el) el.style.display = 'none';
    var btn = document.getElementById('bsConfirmBtn');
    if (btn && !isSubmitting) btn.disabled = false;
  }

  function _updateCountdownUI() {
    var lbl  = document.getElementById('bsBtnLabel');
    var prog = document.getElementById('bsBtnProgress');
    if (lbl)  lbl.textContent = 'Place Bet (' + bsCountdownSecs + 's)';
    if (prog) {
      prog.style.width = (bsCountdownSecs / 10 * 100) + '%';
      var col = bsCountdownSecs > 4 ? 'rgba(255,255,255,0.15)' : bsCountdownSecs > 2 ? 'rgba(245,158,11,0.35)' : 'rgba(239,68,68,0.4)';
      prog.style.background = col;
    }
  }

  function resetBetSlip() {
    document.getElementById('bsStakeInput').value = '100';
    document.getElementById('bsError').textContent = '';
    document.getElementById('bsWarn').style.display = 'none';
    document.getElementById('bsForm').style.display = '';
    document.getElementById('bsSuccessState').style.display = 'none';
    updateBetSlipPreview();
  }

  function openBetSlipUI() {
    document.getElementById('betSlipOverlay').classList.add('open');
    document.getElementById('betSlip').classList.add('open');
    setTimeout(function () { document.getElementById('bsStakeInput').focus(); startBsCountdown(); }, 350);
    if (navigator.vibrate) navigator.vibrate(10);
  }

  function closeBetSlip() {
    clearBsCountdown();
    document.getElementById('betSlipOverlay').classList.remove('open');
    document.getElementById('betSlip').classList.remove('open');
    // Reset to form state after animation
    setTimeout(resetBetSlip, 350);
  }
  Client.closeBetSlip = closeBetSlip;

  function shakeBetSlip() {
    var slip = document.getElementById('betSlip');
    slip.classList.remove('shake');
    void slip.offsetWidth; // reflow
    slip.classList.add('shake');
    slip.addEventListener('animationend', function () { slip.classList.remove('shake'); }, { once: true });
  }

  function setQuickStake(amount) {
    document.getElementById('bsStakeInput').value = amount;
    updateBetSlipPreview();
  }
  Client.setQuickStake = setQuickStake;

  function setMaxStake() {
    var bal = parseFloat(currentProfile ? currentProfile.balance : 0) || 0;
    document.getElementById('bsStakeInput').value = Math.floor(bal);
    updateBetSlipPreview();
  }
  Client.setMaxStake = setMaxStake;

  function updateBetSlipPreview() {
    var stake = parseFloat(document.getElementById('bsStakeInput').value) || 0;
    var bp    = bsState.backPrice || 1;
    var bal   = parseFloat(currentProfile ? currentProfile.balance : 0) || 0;

    // Clamp stake to balance silently on input
    if (stake > bal && stake > 0) {
      stake = bal;
      document.getElementById('bsStakeInput').value = Math.floor(bal);
    }

    var commRatePct = bsState.isFancy
      ? parseFloat(currentProfile ? currentProfile.fancy_commission : 0) || 0
      : parseFloat(currentProfile ? currentProfile.match_commission : 0) || 0;
    var commRate = commRatePct / 100;

    // Lagai: profit = stake * rate  |  Khai: profit = stake / rate  |  Fancy/Back: profit = stake * (bp-1)
    var grossProfit;
    if (bsState.isLK && bsState.side === 'LAGAI') grossProfit = stake * bp;
    else if (bsState.isLK && bsState.side === 'KHAI') grossProfit = bp > 0 ? stake / bp : 0;
    else grossProfit = stake * (bp - 1);

    var netProfit = grossProfit * (1 - commRate);
    var netPayout = stake + netProfit;

    document.getElementById('bsPreviewWin').textContent    = stake ? '🪙 ' + fmt(netPayout,2) : '---';
    document.getElementById('bsPreviewProfit').textContent = stake ? '🪙 ' + fmt(netProfit,2)  : '---';

    var commNote = document.getElementById('bsCommNote');
    if (commRate > 0 && stake > 0) {
      commNote.textContent = bsState.isFancy
        ? 'Commission applies on volume'
        : 'Commission applies on losses';
      commNote.style.color = '#a78bfa';
    } else {
      commNote.textContent = '';
      commNote.style.color = '#64748b';
    }

    // Stale odds check
    if (bsState.oddsAtOpen != null && bsState.outcomeId) {
      var liveOc  = allOutcomes.find(function (o) { return o.id === bsState.outcomeId; });
      var liveOdds = liveOc ? parseFloat(liveOc.back_price || bsState.oddsAtOpen) : bsState.oddsAtOpen;
      var staleEl = document.getElementById('bsStaleWarn');
      if (Math.abs(liveOdds - bsState.oddsAtOpen) >= 0.05) {
        staleEl.style.display = 'block';
        staleEl.textContent = 'Odds changed from ' + bsState.oddsAtOpen.toFixed(2) + ' -> ' + liveOdds.toFixed(2) + '. Review before confirming.';
      } else {
        staleEl.style.display = 'none';
      }
    }

    var warn = document.getElementById('bsWarn');
    warn.style.display = 'none';
  }
  Client.updateBetSlipPreview = updateBetSlipPreview;

  async function confirmBet() {
    if (isSubmitting) return;
    var errEl = document.getElementById('bsError');
    errEl.textContent = '';

    // -- FIRST: hard check -- market must be ACTIVE right now --------
    var liveEv = allEvents.find(function (e) { return e.id === bsState.eventId; });
    if (!liveEv || liveEv.status === 'SUSPENDED') {
      errEl.textContent = 'Market suspended -- bet not placed.';
      _showBetSlipSuspended();
      shakeBetSlip();
      return;
    }
    if (liveEv.status === 'SETTLED' || liveEv.status === 'VOID') {
      errEl.textContent = 'Market is closed and no longer accepting bets.';
      shakeBetSlip();
      return;
    }

    var stake = parseFloat(document.getElementById('bsStakeInput').value);

    if (!stake || stake < 1) {
      errEl.textContent = 'Enter a valid stake (min 🪙 1).';
      shakeBetSlip();
      return;
    }

    var profResult = await db.from('betting_users').select('balance').eq('id', currentUser.id).single();
    var bal = parseFloat(profResult.data ? profResult.data.balance : 0) || 0;

    // Exposure-based balance model: only lock the max possible loss across all bets on this event
    var bp = bsState.backPrice;
    var effectiveDeduction;
    if (bsState.isLK) {
      var openEvOrds = myOrders.filter(function (o) { return o.event_id === bsState.eventId && o.status === 'OPEN'; });
      var calcExp = function (orders) {
        var fw = 0, fl = 0;
        orders.forEach(function (o) {
          var s = parseFloat(o.total_cost || 0), r = parseFloat(o.price_per_share || 1);
          if (o.bet_side === 'LAGAI')     { fw += s * r; fl -= s; }
          else if (o.bet_side === 'KHAI') { fw -= s;     fl += s / r; }
        });
        return Math.max(0, -Math.min(fw, fl));
      };
      var curExp = calcExp(openEvOrds);
      var newExp = calcExp(openEvOrds.concat([{ bet_side: bsState.side, total_cost: stake, price_per_share: bp }]));
      effectiveDeduction = newExp - curExp; // negative = refund (exposure shrinks)
    } else {
      effectiveDeduction = stake;
    }

    if (effectiveDeduction > bal) {
      errEl.textContent = 'Insufficient balance. Need 🪙' + fmt(effectiveDeduction,0) + ' more. Available: 🪙' + fmt(bal,0) + '.';
      shakeBetSlip();
      return;
    }

    // Final stale-rate/odds check
    if (bsState.oddsAtOpen != null) {
      var liveRate = null;
      if (bsState.isLK) {
        var liveEv2 = allEvents.find(function (e) { return e.id === bsState.eventId; });
        if (liveEv2 && liveEv2.lagai_rate != null) {
          liveRate = bsState.side === 'KHAI'
            ? parseFloat((parseFloat(liveEv2.lagai_rate) + 0.05).toFixed(2))
            : parseFloat(liveEv2.lagai_rate);
        }
      } else {
        var liveOc = allOutcomes.find(function (o) { return o.id === bsState.outcomeId; });
        if (liveOc) liveRate = parseFloat(liveOc.back_price || bsState.oddsAtOpen);
      }
      if (liveRate != null && Math.abs(liveRate - bsState.oddsAtOpen) >= 0.03) {
        errEl.textContent = 'Rate changed to ' + liveRate.toFixed(2) + '. Slip updated -- please confirm again.';
        bsState.backPrice  = liveRate;
        bsState.oddsAtOpen = liveRate;
        document.getElementById('bsOddsVal').textContent = liveRate.toFixed(2);
        updateBetSlipPreview();
        shakeBetSlip();
        return;
      }
    }

    var commRate = bsState.isFancy
      ? (parseFloat(currentProfile ? currentProfile.fancy_commission : 0) || 0) / 100
      : (parseFloat(currentProfile ? currentProfile.match_commission : 0) || 0) / 100;

    var grossProfit;
    if (bsState.isLK && bsState.side === 'LAGAI') grossProfit = stake * bp;
    else if (bsState.isLK && bsState.side === 'KHAI') grossProfit = bp > 0 ? stake / bp : 0;
    else grossProfit = stake * (bp - 1);

    var netProfit   = grossProfit * (1 - commRate);
    var netPayout   = parseFloat((stake + netProfit).toFixed(4));
    var potPayout   = netPayout; // shares = net payout stored

    var btn = document.getElementById('bsConfirmBtn');
    var lbl = document.getElementById('bsBtnLabel');
    isSubmitting = true;
    btn.disabled = true; if (lbl) lbl.textContent = 'Placing...';

    var balanceDeducted = false;
    try {
      // Deduct only effectiveDeduction from balance (full stake if no hedge, less if hedging)
      var balResult = await db.from('betting_users').update({ balance: bal - effectiveDeduction }).eq('id', currentUser.id);
      if (balResult.error) throw new Error(balResult.error.message);
      balanceDeducted = true;
      currentProfile.balance = String(bal - effectiveDeduction);

      // Insert order (total_cost = full stake for P&L tracking)
      var ord = {
        event_id: bsState.eventId, outcome_id: bsState.outcomeId,
        user_id: currentUser.id, order_type: 'BUY',
        bet_side: bsState.side,
        shares: potPayout,
        price_per_share: bp,
        total_cost: stake,
        status: 'OPEN'
      };
      if (bsState.isFancy && bsState.line != null) {
        ord.line_at_bet = bsState.line;
        ord.line_no_at_bet = bsState.lineNo;
        ord.line_yes_at_bet = bsState.lineYes;
      }

      var ordResult = await db.from('orders').insert(ord);
      if (ordResult.error) throw new Error(ordResult.error.message);

      // Update portfolio_position (match markets only)
      if (!bsState.isFancy) {
        var posResult = await db.from('portfolio_positions')
          .select('id,shares_owned').eq('user_id', currentUser.id).eq('outcome_id', bsState.outcomeId).maybeSingle();
        if (posResult.data) {
          await db.from('portfolio_positions').update({ shares_owned: parseFloat(posResult.data.shares_owned||0) + potPayout }).eq('id', posResult.data.id);
        } else {
          await db.from('portfolio_positions').insert({
            user_id: currentUser.id, outcome_id: bsState.outcomeId,
            event_id: bsState.eventId, shares_owned: potPayout
          });
        }
      }

      // Show inline success state
      clearBsCountdown();
      document.getElementById('bsForm').style.display = 'none';
      document.getElementById('sucStake').textContent   = '🪙 ' + fmt(stake,0);
      document.getElementById('sucWin').textContent     = '🪙 ' + fmt(netPayout,2);
      document.getElementById('sucProfit').textContent  = '🪙 ' + fmt(netProfit,2);
      document.getElementById('sucBalance').textContent = '🪙 ' + fmt(bal - effectiveDeduction,2);
      document.getElementById('bsSucSub').textContent   = bsState.isFancy
        ? bsState.side + ' @ line ' + bsState.line
        : bsState.side + ' @ ' + bp.toFixed(2);
      document.getElementById('bsSuccessState').style.display = 'block';

      // Update header balance immediately
      var newBal = fmt(bal - effectiveDeduction, 2);
      document.getElementById('headerBalance').textContent = newBal;
      document.getElementById('acctBalance').textContent   = newBal;

      refreshData();
    } catch(err) {
      // Rollback balance if order failed after deduction
      if (balanceDeducted) {
        try {
          await db.from('betting_users').update({ balance: bal }).eq('id', currentUser.id);
          currentProfile.balance = String(bal);
        } catch(rb) { /* rollback best-effort */ }
      }
      errEl.textContent = err.message;
      shakeBetSlip();
    } finally {
      isSubmitting = false;
      btn.disabled = false; if (lbl) lbl.textContent = 'Place Bet';
    }
  }
  Client.confirmBet = confirmBet;

  function placeAnotherBet() {
    document.getElementById('bsSuccessState').style.display = 'none';
    document.getElementById('bsForm').style.display = '';
    document.getElementById('bsStakeInput').value = '';
    updateBetSlipPreview();
    document.getElementById('bsStakeInput').focus();
  }
  Client.placeAnotherBet = placeAnotherBet;

  // ── BET SLIP GESTURES ─────────────────────────────────────────
  function setupBetSlipGestures() {
    var slip   = document.getElementById('betSlip');
    var handle = document.getElementById('bsHandle');
    var startY = 0, isDragging = false;

    var onStart = function (e) {
      startY = (e.touches ? e.touches[0].clientY : e.clientY);
      isDragging = true;
    };
    var onMove = function (e) {
      if (!isDragging) return;
      var dy = (e.touches ? e.touches[0].clientY : e.clientY) - startY;
      if (dy > 0) slip.style.transform = 'translateY(' + dy + 'px)';
    };
    var onEnd = function (e) {
      if (!isDragging) return;
      isDragging = false;
      var dy = (e.changedTouches ? e.changedTouches[0].clientY : e.clientY) - startY;
      slip.style.transform = '';
      if (dy > 80) closeBetSlip();
    };

    handle.addEventListener('touchstart', onStart, { passive: true });
    handle.addEventListener('touchmove',  onMove,  { passive: true });
    handle.addEventListener('touchend',   onEnd);
  }

  function setupEscKey() {
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && document.getElementById('betSlip').classList.contains('open')) {
        closeBetSlip();
      }
    });
  }

  // ── PORTFOLIO ─────────────────────────────────────────────────
  function renderPortfolioTab() {
    var orders = myOrders;
    if (portfolioFilter === 'OPEN')    orders = orders.filter(function (o) { return o.status === 'OPEN'; });
    if (portfolioFilter === 'SETTLED') orders = orders.filter(function (o) { return o.status === 'SETTLED'; });

    var openOrds  = myOrders.filter(function (o) { return o.status === 'OPEN'; });
    var totStaked = openOrds.reduce(function (s,o) { return s + parseFloat(o.total_cost||0); }, 0);
    var totPotWin = openOrds.reduce(function (s,o) { return s + parseFloat(o.shares||0); }, 0);

    document.getElementById('portOpenCount').textContent = openOrds.length;
    document.getElementById('portStaked').textContent    = '🪙 ' + fmt(totStaked,0);
    document.getElementById('portPotWin').textContent    = '🪙 ' + fmt(totPotWin,0);

    // Net Position summary (not P&L — P&L is only after settlement)
    var pnlEl = document.getElementById('portNetPnl');
    if (pnlEl) { pnlEl.textContent = '---'; pnlEl.style.color = '#94a3b8'; }
    var sumEl = document.getElementById('portfolioSummary');
    sumEl.style.display = openOrds.length ? 'grid' : 'none';

    var con = document.getElementById('portfolioContainer');
    if (!orders.length) {
      con.innerHTML = '<div class="empty-state"><div class="es-icon">📊</div><div class="es-text">' + (portfolioFilter==='OPEN'?'No open bets':'Nothing to show') + '</div><div class="es-sub">Visit Markets to place a bet</div></div>';
      return;
    }

    // Group by event — show per-event POSITION (not per-order P&L)
    var groups = {};
    orders.forEach(function (o) {
      var key = o.event_id || 'unknown';
      if (!groups[key]) {
        var ev = o.events || {};
        groups[key] = { eventId: key, title: ev.title || 'Unknown Market', orders: [], ev: ev, isSettled: ev.status === 'SETTLED' || ev.status === 'VOID', isFancy: ev.market_type === 'FANCY' };
      }
      groups[key].orders.push(o);
    });

    con.innerHTML = Object.values(groups).map(function (g) {
      return renderEventPositionCard(g);
    }).join('');

    // Initialize exit previews for open non-fancy bets
    setTimeout(function () {
      openOrds.filter(function (o) { return o.events && o.events.market_type !== 'FANCY'; }).forEach(function (o) { updateExitPreview(o.id); });
    }, 50);
  }

  function renderEventPositionCard(g) {
    var html = '<div class="port-group">';
    var statusBadge = g.isSettled
      ? '<span style="font-size:0.6rem;background:rgba(16,185,129,0.15);color:#10b981;padding:2px 6px;border-radius:4px;font-weight:700;">SETTLED</span>'
      : '<span style="font-size:0.6rem;background:rgba(99,102,241,0.15);color:#818cf8;padding:2px 6px;border-radius:4px;font-weight:700;">OPEN</span>';

    html += '<div class="port-group-head"><span>' + sanitize(g.title) + '</span>' + statusBadge + '</div>';

    if (g.isSettled) {
      // REALIZED P&L — only now we use the word "P&L"
      var realizedPnl = 0;
      g.orders.forEach(function (o) {
        var stake = parseFloat(o.total_cost || 0);
        var payout = parseFloat(o.shares || 0);
        if (o.status === 'SETTLED') {
          // Check if this order won
          var ev = o.events || g.ev;
          var won = false;
          if (g.isFancy) {
            var lineNo = parseFloat(o.line_no_at_bet || o.line_at_bet || 0);
            var lineYes = parseFloat(o.line_yes_at_bet || o.line_at_bet || 0);
            var res = parseFloat(ev.result_value || 0);
            won = (o.bet_side === 'YES' && res >= lineYes) || (o.bet_side === 'NO' && res <= lineNo);
          } else {
            won = o.outcomes && o.outcomes.is_winner;
          }
          realizedPnl += won ? (payout - stake) : -stake;
        }
      });
      var pnlColor = realizedPnl > 0.01 ? '#10b981' : realizedPnl < -0.01 ? '#ef4444' : '#94a3b8';
      html += '<div style="padding:8px 12px;display:flex;justify-content:space-between;align-items:center;">';
      html += '<span style="font-size:0.78rem;color:#64748b;">Realized P&L</span>';
      html += '<span style="font-family:\'JetBrains Mono\',monospace;font-weight:700;color:' + pnlColor + ';">' + (realizedPnl>=0?'+':'') + '🪙' + fmt(Math.abs(realizedPnl),2) + '</span>';
      html += '</div>';
    } else if (!g.isFancy) {
      // MATCH POSITION — show per-outcome scenario, never say "P&L"
      var book = BX.calcEventBook(g.eventId, myOrders, allOutcomes, allEvents, 'ALL');
      if (book) {
        var fwColor = book.favWins > 0.01 ? '#10b981' : book.favWins < -0.01 ? '#ef4444' : '#94a3b8';
        var flColor = book.favLoses > 0.01 ? '#10b981' : book.favLoses < -0.01 ? '#ef4444' : '#94a3b8';
        html += '<div style="padding:8px 12px;">';
        html += '<div style="font-size:0.68rem;color:#475569;margin-bottom:6px;font-weight:600;">Position</div>';
        html += '<div style="display:flex;justify-content:space-between;margin-bottom:4px;">';
        html += '<span style="font-size:0.8rem;color:#e2e8f0;">' + sanitize(book.favTeam) + '</span>';
        html += '<span style="font-family:\'JetBrains Mono\',monospace;font-weight:700;font-size:0.85rem;color:' + fwColor + ';">' + (book.favWins>=0?'+':'') + '🪙' + fmt(Math.abs(book.favWins),0) + '</span>';
        html += '</div>';
        html += '<div style="display:flex;justify-content:space-between;">';
        html += '<span style="font-size:0.8rem;color:#e2e8f0;">' + sanitize(book.otherTeam) + '</span>';
        html += '<span style="font-family:\'JetBrains Mono\',monospace;font-weight:700;font-size:0.85rem;color:' + flColor + ';">' + (book.favLoses>=0?'+':'') + '🪙' + fmt(Math.abs(book.favLoses),0) + '</span>';
        html += '</div>';
        html += '</div>';
      }
    } else {
      // FANCY POSITION — show what happens per scenario
      var totalVolume = 0;
      g.orders.filter(function(o) { return o.status === 'OPEN'; }).forEach(function(o) { totalVolume += parseFloat(o.total_cost||0); });
      if (totalVolume > 0) {
        html += '<div style="padding:8px 12px;">';
        html += '<div style="font-size:0.68rem;color:#475569;margin-bottom:4px;font-weight:600;">Position</div>';
        html += '<div style="font-size:0.8rem;color:#94a3b8;">Volume: 🪙' + fmt(totalVolume,0) + '</div>';
        html += '</div>';
      }
    }

    // Individual orders (collapsed, expandable)
    html += '<div style="border-top:1px solid #1e293b;padding:4px 12px 8px;">';
    html += '<div style="font-size:0.65rem;color:#475569;margin-bottom:4px;">' + g.orders.length + ' bet(s)</div>';
    g.orders.forEach(function (o) { html += renderPosCard(o); });
    html += '</div>';

    html += '</div>';
    return html;
  }

  function renderPosCard(ord) {
    var ev      = ord.events;
    var oc      = ord.outcomes;
    var isFancy = ev && ev.market_type === 'FANCY';
    var isOpen  = ord.status === 'OPEN';
    var stake   = parseFloat(ord.total_cost || 0);
    var potPay  = parseFloat(ord.shares || 0);
    var bp      = parseFloat(ord.price_per_share || 1);

    // Current rate for exit preview (no "P&L" label for open orders)
    var curBP   = (isOpen && !isFancy) ? _getLiveRate(ord) : bp;

    var sideCls = (ord.bet_side || 'BACK').toLowerCase();

    // Settle info for fancy
    var settleTag = '';
    if (ord.status === 'SETTLED' && isFancy && ev && ev.result_value != null) {
      var line = parseFloat(ord.line_at_bet || 0);
      var res  = parseFloat(ev.result_value);
      var won  = (ord.bet_side==='YES' && res>=line) || (ord.bet_side==='NO' && res<line);
      settleTag  = '<div class="pos-settle-tag ' + (won?'win':'lose') + '">' + (won?'Won':'Lost') + ' -- Result: ' + res + '</div>';
    }

    var html = '<div class="pos-card" id="posCard_' + ord.id + '">';
    html += '<div class="pos-header" onclick="toggleExpand(\'' + ord.id + '\',' + (isOpen&&!isFancy) + ')">';
    html += '<div class="pos-market">' + (ev?sanitize(ev.title):'Unknown market') + '</div>';
    var lineDisp = '';
    if (isFancy && ord.line_no_at_bet != null && ord.line_yes_at_bet != null) {
      lineDisp = ' @ ' + ord.line_no_at_bet + '/' + ord.line_yes_at_bet;
    } else if (isFancy && ord.line_at_bet != null) {
      lineDisp = ' @ line ' + ord.line_at_bet;
    }
    html += '<div class="pos-outcome">' + (oc?sanitize(oc.title):'---') + lineDisp + '</div>';
    html += '<div class="pos-meta">';
    html += '<span class="pos-badge ' + sideCls + '">' + (ord.bet_side||'BACK') + '</span>';
    if (isFancy) html += '<span class="pos-badge fancy">Fancy</span>';
    html += '<span class="pos-stake">🪙' + fmt(stake,0) + '</span>';
    html += '</div>';
    if (isFancy) {
      if (ord.line_no_at_bet != null && ord.line_yes_at_bet != null) {
        html += '<div class="pos-fancy-line">' + (ord.bet_side==='YES' ? 'Wins if result >= '+ord.line_yes_at_bet : 'Wins if result <= '+ord.line_no_at_bet) + '</div>';
      } else if (ord.line_at_bet != null) {
        html += '<div class="pos-fancy-line">' + (ord.bet_side==='YES' ? 'Wins if result >= '+ord.line_at_bet : 'Wins if result < '+ord.line_at_bet) + '</div>';
      }
    }
    html += settleTag;
    html += '</div>';

    if (isOpen) {
      html += '<div class="pos-odds-row">';
      html += '<div class="pos-odds-item"><div class="pos-odds-lbl">Entry Odds</div><div class="pos-odds-val">' + bp.toFixed(2) + 'x</div></div>';
      if (!isFancy) html += '<div class="pos-odds-item"><div class="pos-odds-lbl">Current</div><div class="pos-odds-val pos-cur-rate">' + curBP.toFixed(2) + 'x</div></div>';
      html += '<div class="pos-odds-item"><div class="pos-odds-lbl">Pot. Payout</div><div class="pos-odds-val" style="color:#10b981;">🪙' + fmt(potPay,2) + '</div></div>';
      html += '</div>';
    }

    if (isOpen && !isFancy) {
      html += '<div class="pos-exit-section" id="exitSec_' + ord.id + '">';
      html += '<div class="exit-slider-wrap">';
      html += '<div class="exit-slider-label"><span>Exit Fraction</span><span id="exitPct_' + ord.id + '">50%</span></div>';
      html += '<input type="range" class="exit-slider" id="exitSlider_' + ord.id + '" min="10" max="100" step="10" value="100" oninput="updateExitPreview(\'' + ord.id + '\')">';
      html += '</div>';
      html += '<div class="exit-preview" id="exitPreview_' + ord.id + '">';
      html += '<div class="exit-prev-item"><div class="ep-lbl">Win Position</div><div class="ep-val" id="epExit_' + ord.id + '">---</div></div>';
      html += '<div class="exit-prev-item"><div class="ep-lbl">Exit Value</div><div class="ep-val green" id="epVal_' + ord.id + '">---</div></div>';
      html += '<div class="exit-prev-item"><div class="ep-lbl">Return</div><div class="ep-val" id="epPnl_' + ord.id + '">---</div></div>';
      html += '</div>';
      html += '<button class="exit-btn" onclick="exitPosition(\'' + ord.id + '\')">Exit Position &rarr;</button>';
      html += '</div>';
    }

    html += '</div>';
    return html;
  }

  // ── LIVE RATE HELPER (wrappers above delegate to BX) ───────────

  // Lightweight P&L refresh -- updates existing DOM without full re-render
  function _refreshLivePnl() {
    // Summary bar
    var openOrds = myOrders.filter(function (o) { return o.status === 'OPEN'; });
    var netPnl = 0;
    openOrds.forEach(function (o) {
      if (o.events && o.events.market_type !== 'FANCY') {
        var result = _calcOrderPnl(o);
        netPnl += result.pnl;
      }
    });
    var pnlEl = document.getElementById('portNetPnl');
    if (pnlEl) {
      if (openOrds.some(function (o) { return o.events && o.events.market_type !== 'FANCY'; })) {
        pnlEl.textContent = (netPnl >= 0 ? '+' : '') + '🪙' + fmt(Math.abs(netPnl), 0);
        pnlEl.style.color = netPnl > 0.5 ? '#10b981' : netPnl < -0.5 ? '#ef4444' : '#94a3b8';
      }
    }
    // Update each open pos-card P&L chip without re-rendering
    openOrds.filter(function (o) { return o.events && o.events.market_type !== 'FANCY'; }).forEach(function (o) {
      var result = _calcOrderPnl(o);
      var pnlSpan = document.querySelector('#posCard_' + o.id + ' .pos-pnl');
      if (pnlSpan) {
        pnlSpan.textContent = (result.pnl >= 0 ? '+' : '') + '🪙' + fmt(Math.abs(result.pnl), 2);
        pnlSpan.className = 'pos-pnl ' + (result.pnl > 0.01 ? 'up' : result.pnl < -0.01 ? 'down' : 'flat');
      }
      var curRateEl = document.querySelector('#posCard_' + o.id + ' .pos-cur-rate');
      if (curRateEl) curRateEl.textContent = _getLiveRate(o).toFixed(2) + 'x';
      updateExitPreview(o.id);
    });
    // Update event book bars in Markets tab (always-visible position bars below match headers)
    var eventIds = [];
    var seen = {};
    openOrds.forEach(function (o) {
      if (!seen[o.event_id]) { seen[o.event_id] = true; eventIds.push(o.event_id); }
    });
    eventIds.forEach(function (eid) {
      var fwEl = document.getElementById('ebook_fw_' + eid);
      var flEl = document.getElementById('ebook_fl_' + eid);
      if (!fwEl && !flEl) return; // bar not rendered
      var book = calcEventBook(eid);
      if (!book) return;
      if (fwEl) {
        fwEl.textContent = (book.favWins>=0?'+':'') + '🪙' + fmt(Math.abs(book.favWins),0);
        fwEl.style.color = book.favWins >= 0 ? '#10b981' : '#ef4444';
      }
      if (flEl) {
        flEl.textContent = (book.favLoses>=0?'+':'') + '🪙' + fmt(Math.abs(book.favLoses),0);
        flEl.style.color = book.favLoses >= 0 ? '#10b981' : '#ef4444';
      }
    });
  }

  function toggleExpand(ordId, canExpand) {
    if (!canExpand) return;
    var card = document.getElementById('posCard_' + ordId);
    var was  = card.classList.contains('expanded');
    document.querySelectorAll('.pos-card.expanded').forEach(function (c) { c.classList.remove('expanded'); });
    if (!was) {
      card.classList.add('expanded');
      updateExitPreview(ordId);
    }
  }
  Client.toggleExpand = toggleExpand;

  // Always looks up current rate dynamically -- no stale args
  function updateExitPreview(ordId) {
    var slider = document.getElementById('exitSlider_' + ordId);
    if (!slider) return;
    var pct = parseInt(slider.value) / 100;
    var ord = myOrders.find(function (o) { return o.id === ordId; });
    if (!ord) return;
    var stake     = parseFloat(ord.total_cost || 0);
    var entryRate = parseFloat(ord.price_per_share || 1);
    var curRate   = _getLiveRate(ord);
    var exitStake = stake * pct;
    // LAGAI: exitVal = exitStake * (entryLagai / curKhai)  -- falls when khai rises
    // KHAI:  exitVal = exitStake / curKhai                 -- falls when khai rises (win-pos shrinks)
    var exitVal   = ord.bet_side === 'KHAI'
      ? exitStake / curRate
      : exitStake * (entryRate / curRate);
    // Win Position: what the bet WOULD have won (LAGAI: stake*rate, KHAI: stake/rate)
    var winPosition = ord.bet_side === 'KHAI'
      ? (stake / entryRate) * pct
      : (stake * entryRate) * pct;
    // P&L: LAGAI vs stake (how much you gained/lost on investment)
    //       KHAI  vs win potential (how much of your expected win you preserved)
    var pnl = ord.bet_side === 'KHAI'
      ? exitVal - winPosition
      : exitVal - exitStake;

    document.getElementById('exitPct_'   + ordId).textContent = Math.round(pct * 100) + '%';
    document.getElementById('epExit_'    + ordId).textContent = '🪙' + fmt(winPosition, 0);
    document.getElementById('epVal_'     + ordId).textContent = '🪙' + fmt(exitVal, 2);
    var pnlEl = document.getElementById('epPnl_' + ordId);
    pnlEl.textContent = (pnl >= 0 ? '+' : '') + '🪙' + fmt(Math.abs(pnl), 2);
    pnlEl.className   = 'ep-val ' + (pnl > 0.01 ? 'green' : pnl < -0.01 ? 'red' : '');
  }
  Client.updateExitPreview = updateExitPreview;

  async function exitPosition(ordId) {
    var ord    = myOrders.find(function (o) { return o.id === ordId; });
    if (!ord) return;
    var slider = document.getElementById('exitSlider_' + ordId);
    var pct    = parseInt(slider ? slider.value : 100) / 100;

    var originalStake = parseFloat(ord.total_cost || 0);
    var originalBP    = parseFloat(ord.price_per_share || 1);
    var curBP         = _getLiveRate(ord);
    var exitStake     = originalStake * pct;
    var exitVal       = ord.bet_side === 'KHAI'
      ? exitStake / curBP
      : exitStake * (originalBP / curBP);
    var winPos        = ord.bet_side === 'KHAI'
      ? (originalStake / originalBP) * pct
      : (originalStake * originalBP) * pct;
    var pnl           = ord.bet_side === 'KHAI'
      ? exitVal - winPos
      : exitVal - exitStake;

    if (!confirm(
      'Exit ' + Math.round(pct*100) + '% of position?\n' +
      'Win Position: 🪙' + fmt(winPos,0) + '\n' +
      'You receive:  🪙' + fmt(exitVal,2) + '\n' +
      'P&L:          ' + (pnl>=0?'+':'') + '🪙' + fmt(Math.abs(pnl),2)
    )) return;

    try {
      var profResult = await db.from('betting_users').select('balance').eq('id', currentUser.id).single();
      var newBal = parseFloat(profResult.data ? profResult.data.balance : 0) + exitVal;
      await db.from('betting_users').update({ balance: newBal }).eq('id', currentUser.id);
      currentProfile.balance = String(newBal);

      if (pct >= 1) {
        // Store actual exit value in shares so History can show booked P&L
        await db.from('orders').update({ status: 'SETTLED', shares: parseFloat(exitVal.toFixed(4)) }).eq('id', ordId);
        await db.from('portfolio_positions').delete().eq('user_id', currentUser.id).eq('outcome_id', ord.outcome_id);
      } else {
        var rem = 1 - pct;
        await db.from('orders').update({
          total_cost: parseFloat((originalStake * rem).toFixed(4)),
          shares:     parseFloat((parseFloat(ord.shares||0) * rem).toFixed(4))
        }).eq('id', ordId);
        var posResult = await db.from('portfolio_positions')
          .select('id,shares_owned').eq('user_id', currentUser.id).eq('outcome_id', ord.outcome_id).maybeSingle();
        if (posResult.data) await db.from('portfolio_positions').update({ shares_owned: parseFloat(posResult.data.shares_owned||0) * rem }).eq('id', posResult.data.id);
      }

      await db.from('credit_transactions').insert({
        sender_id: currentUser.id, receiver_id: currentUser.id,
        amount: exitVal, transaction_type: 'SETTLEMENT',
        notes: 'Exit ' + Math.round(pct*100) + '% -- ' + (ord.outcomes ? ord.outcomes.title : 'position') + ' in ' + (ord.events ? ord.events.title : 'market')
      });

      showToast('Exited ' + Math.round(pct*100) + '%! Received 🪙' + fmt(exitVal,2), 'success');
      await refreshData();
    } catch(err) { showToast('Exit failed: ' + err.message, 'error'); }
  }
  Client.exitPosition = exitPosition;

  // ── HISTORY ───────────────────────────────────────────────────
  function setHistoryFilter(f, el) {
    historyFilter = f;
    document.querySelectorAll('.hist-filter-row .filter-pill').forEach(function (p) { p.classList.remove('active'); });
    if (el) el.classList.add('active');
    renderHistoryTab();
  }
  Client.setHistoryFilter = setHistoryFilter;

  // Determine settlement type for a SETTLED order:
  // 'self_exit'      -- user closed the trade themselves (event still active)
  // 'fancy_settled'  -- admin settled a fancy market (result_value present)
  // 'match_settled'  -- admin settled a match market (event.status === SETTLED)
  // 'void'           -- market was voided
  function _settlementType(ord) {
    var ev = ord.events;
    if (ord.status === 'CANCELLED') return 'void';
    if (ord.status !== 'SETTLED')   return 'open';
    if (ev && ev.market_type === 'FANCY' && ev.result_value != null) return 'fancy_settled';
    if (ev && ev.status === 'SETTLED') return 'match_settled';
    return 'self_exit'; // event still active -- user closed it via Exit Position
  }

  function _renderCommissionCard(tx) {
    var notes = tx.notes || '';
    var marketName = sanitize(notes.replace(/^.*\bin\b\s*/, '') || 'Unknown market');
    var formulaLabel = notes.indexOf('Match commission') === 0 ? 'Earned on losses' : 'Earned on volume';
    var amount = parseFloat(tx.amount || 0);
    var date = tx.created_at
      ? new Date(tx.created_at).toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '---';
    return '<div class="hist-item" style="border-left:3px solid #a78bfa;">' +
      '<div class="hist-left">' +
        '<div class="hist-market" style="color:#a78bfa;">' + marketName + '</div>' +
        '<div class="hist-outcome" style="color:#94a3b8;font-size:0.7rem;">' + sanitize(formulaLabel) + '</div>' +
        '<div style="font-size:0.6rem;color:#64748b;margin-top:2px;">' + sanitize(notes) + '</div>' +
        '<div class="hist-meta">' +
          '<span class="result-pill" style="background:rgba(167,139,250,0.1);color:#a78bfa;border:1px solid rgba(167,139,250,0.2);">COMMISSION</span>' +
          '<span class="hist-date">' + date + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="hist-right">' +
        '<div class="hist-amount" style="color:#10b981;">+🪙' + fmt(amount,2) + '</div>' +
      '</div>' +
    '</div>';
  }

  function _renderOrderCard(ord) {
    var ev      = ord.events;
    var oc      = ord.outcomes;
    var isFancy = ev && ev.market_type === 'FANCY';
    var stake   = parseFloat(ord.total_cost || 0);
    var shares  = parseFloat(ord.shares || 0);
    var stype   = _settlementType(ord);

    var resultClass = 'open', resultLabel = 'OPEN', payout = '';

    if (ord.status === 'OPEN') {
      resultClass = 'open'; resultLabel = 'OPEN';
      payout = '<div class="hist-payout" style="color:#818cf8;">Pot 🪙' + fmt(shares,0) + '</div>';

    } else if (stype === 'self_exit') {
      var bookedPnl = shares - stake;
      resultClass = bookedPnl >= 0 ? 'win' : 'lose';
      resultLabel = 'CLOSED';
      payout = '<div class="hist-payout" style="color:' + (bookedPnl>=0?'#10b981':'#ef4444') + ';">' +
        (bookedPnl>=0?'+':'') + '🪙' + fmt(bookedPnl,2) +
        '<div style="font-size:0.62rem;color:#64748b;margin-top:1px;">Rcvd 🪙' + fmt(shares,2) + '</div>' +
      '</div>';

    } else if (stype === 'fancy_settled') {
      var fLine = parseFloat(ord.line_at_bet||0), fRes = parseFloat(ev.result_value);
      var fWon = (ord.bet_side==='YES' && fRes>=fLine) || (ord.bet_side==='NO' && fRes<fLine);
      resultClass = fWon ? 'win' : 'lose';
      resultLabel = fWon ? 'WON' : 'LOST';
      payout = fWon
        ? '<div class="hist-payout" style="color:#10b981;">+🪙' + fmt(shares,0) + '</div>'
        : '<div class="hist-payout" style="color:#ef4444;">-🪙' + fmt(stake,0) + '</div>';

    } else if (stype === 'match_settled') {
      var wtitle = ev ? ev.winning_outcome : null;
      var mWon;
      if (ord.bet_side === 'LAGAI') mWon = wtitle != null && wtitle === (ev ? ev.rate_team : null);
      else if (ord.bet_side === 'KHAI') mWon = wtitle != null && wtitle !== (ev ? ev.rate_team : null);
      else mWon = oc && oc.title === wtitle;
      var bp_ord = parseFloat(ord.price_per_share || 1);
      var grossProfit = mWon ? (
        ord.bet_side === 'LAGAI' ? stake * bp_ord :
        ord.bet_side === 'KHAI'  ? stake / bp_ord :
        stake * (bp_ord - 1)
      ) : 0;
      resultClass = mWon ? 'win' : 'lose';
      resultLabel = mWon ? 'WON' : 'LOST';
      payout = mWon
        ? '<div class="hist-payout" style="color:#10b981;">+🪙' + fmt(grossProfit,2) + '</div>'
        : '<div class="hist-payout" style="color:#ef4444;">-🪙' + fmt(stake,0) + '</div>';

    } else if (stype === 'void') {
      resultClass = 'void'; resultLabel = 'VOID';
      payout = '<div class="hist-payout" style="color:#64748b;">Refunded 🪙' + fmt(stake,0) + '</div>';
    }

    var date = ord.created_at
      ? new Date(ord.created_at).toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '---';

    return '<div class="hist-item">' +
      '<div class="hist-left">' +
        '<div class="hist-market">' + (ev ? sanitize(ev.title) : 'Unknown') + '</div>' +
        '<div class="hist-outcome">' + (oc ? sanitize(oc.title) : '---') + (isFancy&&ord.line_at_bet!=null?' @ line '+ord.line_at_bet:'') + '</div>' +
        '<div class="hist-meta">' +
          '<span class="result-pill ' + resultClass + '">' + resultLabel + '</span>' +
          '<span style="font-size:0.62rem;background:rgba(255,255,255,0.05);padding:2px 6px;border-radius:4px;color:#64748b;font-weight:600;">' + (ord.bet_side||'BACK') + '</span>' +
          '<span style="font-size:0.6rem;color:#64748b;">@ ' + parseFloat(ord.price_per_share||0).toFixed(2) + '</span>' +
          '<span class="hist-date">' + date + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="hist-right">' +
        '<div class="hist-amount">🪙' + fmt(stake,0) + '</div>' +
        payout +
      '</div>' +
    '</div>';
  }

  function renderHistoryTab() {
    var con = document.getElementById('historyContainer');

    // -- COMMISSION-only filter ----------------------------------------
    if (historyFilter === 'COMMISSION') {
      if (!myCommissions.length) {
        con.innerHTML = '<div class="empty-state"><div class="es-icon">💜</div><div class="es-text">No commissions yet</div><div class="es-sub">Commissions are credited after market settlement</div></div>';
        return;
      }
      con.innerHTML = myCommissions.map(function (tx) { return _renderCommissionCard(tx); }).join('');
      return;
    }

    // -- Order filters -------------------------------------------------
    var orders = myOrders.slice();
    if (historyFilter === 'OPEN')     orders = orders.filter(function (o) { return o.status === 'OPEN'; });
    if (historyFilter === 'SETTLED')  orders = orders.filter(function (o) { return o.status === 'SETTLED'; });
    if (historyFilter === 'CLOSED')   orders = orders.filter(function (o) { return _settlementType(o) === 'self_exit'; });
    if (historyFilter === 'MATCH')    orders = orders.filter(function (o) { return o.events && o.events.market_type !== 'FANCY'; });
    if (historyFilter === 'FANCY')    orders = orders.filter(function (o) { return o.events && o.events.market_type === 'FANCY'; });

    // -- ALL filter: interleave orders + commissions by date -----------
    if (historyFilter === 'ALL') {
      var combined = orders.map(function (o) { return { type: 'order', date: o.created_at, data: o }; })
        .concat(myCommissions.map(function (tx) { return { type: 'commission', date: tx.created_at, data: tx }; }))
        .sort(function (a, b) { return new Date(b.date) - new Date(a.date); });

      if (!combined.length) {
        con.innerHTML = '<div class="empty-state"><div class="es-icon">📋</div><div class="es-text">No bets here</div><div class="es-sub">Try a different filter</div></div>';
        return;
      }

      // Summary bar (orders only)
      var closedOrds = orders.filter(function (o) { return o.status === 'SETTLED'; });
      var summaryHtml = '';
      if (closedOrds.length) {
        summaryHtml = _buildSummaryBar(closedOrds);
      }

      con.innerHTML = summaryHtml + combined.map(function (item) {
        return item.type === 'commission' ? _renderCommissionCard(item.data) : _renderOrderCard(item.data);
      }).join('');
      return;
    }

    // -- Non-ALL, non-COMMISSION filters -------------------------------
    if (!orders.length) {
      con.innerHTML = '<div class="empty-state"><div class="es-icon">📋</div><div class="es-text">No bets here</div><div class="es-sub">Try a different filter</div></div>';
      return;
    }

    var closedOrds2 = orders.filter(function (o) { return o.status === 'SETTLED'; });
    var summaryHtml2 = '';
    if (closedOrds2.length) {
      summaryHtml2 = _buildSummaryBar(closedOrds2);
    }

    con.innerHTML = summaryHtml2 + orders.map(function (ord) { return _renderOrderCard(ord); }).join('');
  }

  function _buildSummaryBar(closedOrds) {
    var totalStaked = 0, totalReturn = 0;
    closedOrds.forEach(function (o) {
      var stype = _settlementType(o);
      var stake  = parseFloat(o.total_cost || 0);
      var shares = parseFloat(o.shares || 0);
      totalStaked += stake;
      if (stype === 'self_exit') {
        totalReturn += shares;
      } else if (stype === 'fancy_settled') {
        var line = parseFloat(o.line_at_bet||0), res = parseFloat(o.events.result_value);
        var won = (o.bet_side==='YES' && res>=line) || (o.bet_side==='NO' && res<line);
        if (won) totalReturn += shares;
      } else if (stype === 'match_settled') {
        var evData = o.events;
        var wtitle = evData ? evData.winning_outcome : null;
        var mWon;
        if (o.bet_side === 'LAGAI') mWon = wtitle != null && wtitle === (evData ? evData.rate_team : null);
        else if (o.bet_side === 'KHAI') mWon = wtitle != null && wtitle !== (evData ? evData.rate_team : null);
        else mWon = o.outcomes && o.outcomes.title === wtitle;
        if (mWon) {
          var r = parseFloat(o.price_per_share || 1);
          totalReturn += stake + (o.bet_side === 'LAGAI' ? stake * r : o.bet_side === 'KHAI' ? stake / r : stake * (r - 1));
        }
      }
    });
    var netPnl = totalReturn - totalStaked;
    return '<div style="background:#1e293b;border:1px solid #334155;border-radius:10px;padding:10px 14px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;">' +
      '<div style="font-size:0.7rem;color:#64748b;font-weight:700;">' + closedOrds.length + ' closed · Staked 🪙' + fmt(totalStaked,0) + '</div>' +
      '<div style="font-family:\'JetBrains Mono\',monospace;font-size:0.85rem;font-weight:800;color:' + (netPnl>=0?'#10b981':'#ef4444') + '">' + (netPnl>=0?'+':'') + '🪙' + fmt(Math.abs(netPnl),2) + '</div>' +
    '</div>';
  }

  // ── ACCOUNT ───────────────────────────────────────────────────
  async function renderAccountTab() {
    if (!currentProfile) return;
    document.getElementById('acctName').textContent      = sanitize(currentProfile.name || 'Client');
    document.getElementById('acctId').textContent        = currentProfile.login_id || '---';
    document.getElementById('acctMatchComm').textContent = (currentProfile.match_commission != null ? currentProfile.match_commission : 0) + '%';
    document.getElementById('acctFancyComm').textContent = (currentProfile.fancy_commission != null ? currentProfile.fancy_commission : 0) + '%';
    document.getElementById('acctSince').textContent     = currentProfile.created_at
      ? new Date(currentProfile.created_at).toLocaleDateString([],{year:'numeric',month:'short',day:'numeric'}) : '---';
    if (currentProfile.parent_id) {
      var agentResult = await db.from('betting_users').select('login_id,name').eq('id', currentProfile.parent_id).single();
      if (agentResult.data) document.getElementById('acctAgent').textContent = (sanitize(agentResult.data.name||'') + ' (' + agentResult.data.login_id + ')').trim();
    }
    var open = myOrders.filter(function (o) { return o.status==='OPEN'; }).length;
    document.getElementById('acctOpenBets').textContent = open;

    // P&L stats (settled orders)
    var settled = myOrders.filter(function (o) { return o.status === 'SETTLED'; });
    var totalStaked = myOrders.reduce(function (s, o) { return s + parseFloat(o.total_cost||0); }, 0);
    var totalWon = 0;
    settled.forEach(function (o) {
      var ev = o.events;
      var isFancy = ev && ev.market_type === 'FANCY';
      if (isFancy && ev && ev.result_value != null) {
        var line = parseFloat(o.line_at_bet||0);
        var res  = parseFloat(ev.result_value);
        var won  = (o.bet_side==='YES' && res>=line) || (o.bet_side==='NO' && res<line);
        if (won) totalWon += parseFloat(o.shares||0);
      }
    });
    var netPnl = totalWon - totalStaked;

    var pnlEl = document.getElementById('acctPnl');
    if (pnlEl) {
      pnlEl.textContent = (netPnl >= 0 ? '+' : '') + '🪙' + fmt(Math.abs(netPnl),2);
      pnlEl.style.color = netPnl >= 0 ? '#10b981' : '#ef4444';
    }
    var stakedEl = document.getElementById('acctTotalStaked');
    if (stakedEl) stakedEl.textContent = '🪙' + fmt(totalStaked,0);
  }

  // ── GLOBAL ALIASES for HTML onclick handlers ──────────────────
  // Every function referenced by onclick="..." in client.html markup must be on window:
  window.showTab = showTab;
  window.refreshData = refreshData;
  window.setMarketFilter = setMarketFilter;
  window.setPortfolioFilter = setPortfolioFilter;
  window.setHistoryFilter = setHistoryFilter;
  window.setQuickStake = setQuickStake;
  window.setMaxStake = setMaxStake;
  window.closeBetSlip = closeBetSlip;
  window.confirmBet = confirmBet;
  window.placeAnotherBet = placeAnotherBet;
  window.updateBetSlipPreview = updateBetSlipPreview;
  window.resetBsCountdown = resetBsCountdown;
  window.toggleMatchGroup  = toggleMatchGroup;
  window.showMatchList     = showMatchList;
  window.showMatchDetail   = showMatchDetail;
  window.openLKBetSlip = openLKBetSlip;
  window.openBetSlip = openBetSlip;
  window.openFancyBetSlip = openFancyBetSlip;
  window.toggleExpand = toggleExpand;
  window.updateExitPreview = updateExitPreview;
  window.exitPosition = exitPosition;
  window.renderMarketsTab = renderMarketsTab;
  window.calcEventBook = calcEventBook;

  // ── BOOT ──────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', Client.init);
})();
