// ==========================================
// auth.js - Shared Authentication Logic
// Uses Supabase Auth combined with a custom 'betting_users' table
// ==========================================

const SUPABASE_URL = 'https://vtxuzrkwnyhxciohwjjx.supabase.co';
const SUPABASE_KEY = 'sb_publishable_c2TzMQIXnpvxbf5UIOmrYw_tABpS3yR';

// Use sessionStorage so each browser tab has its own independent session.
// Without this, all tabs on the same origin share one localStorage key — logging
// in as CLIENT in one tab overwrites the ADMIN session and causes cross-tab redirects.
window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    storage: window.sessionStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  }
});

// Exposed so admin panel can create a temp no-session client for user signup
// (prevents admin session being overwritten when creating new users)
window._sbConfig = { url: SUPABASE_URL, key: SUPABASE_KEY };

window.AuthSystem = {

  toEmail: (loginId) => `${loginId.toLowerCase()}@bhandai.com`,

  // ── LOGIN ──────────────────────────────────────────────────────────
  login: async (loginId, password) => {
    // UI-side rate limiting: 3 fails → 30s lockout
    const now = Date.now();
    const fails    = parseInt(sessionStorage.getItem('_bx_fails')    || '0');
    const lockUntil = parseInt(sessionStorage.getItem('_bx_lock')    || '0');

    if (lockUntil > now) {
      const secs = Math.ceil((lockUntil - now) / 1000);
      throw new Error(`Too many failed attempts. Please wait ${secs}s before trying again.`);
    }

    const email = window.AuthSystem.toEmail(loginId);
    const { data: authData, error: authErr } = await window.supabaseClient.auth.signInWithPassword({ email, password });

    if (authErr) {
      const newFails = fails + 1;
      sessionStorage.setItem('_bx_fails', newFails);
      if (newFails >= 3) {
        sessionStorage.setItem('_bx_lock', Date.now() + 30000);
      }
      throw new Error('Invalid Login ID or Password. Please try again.');
    }

    // Success — clear rate limit
    sessionStorage.removeItem('_bx_fails');
    sessionStorage.removeItem('_bx_lock');

    const { data: userProfile, error: profileErr } = await window.supabaseClient
      .from('betting_users')
      .select('role, status')
      .eq('id', authData.user.id)
      .single();

    if (profileErr || !userProfile) {
      await window.supabaseClient.auth.signOut();
      throw new Error('Account not found. Please contact your admin.');
    }

    // Suspended users are denied login completely
    if (userProfile.status === 'SUSPENDED') {
      await window.supabaseClient.auth.signOut();
      throw new Error('🔒 Your account has been suspended. Please contact your agent or admin.');
    }

    window.AuthSystem.redirectByRole(userProfile.role);
    return userProfile;
  },

  // ── LOGOUT ────────────────────────────────────────────────────────
  logout: async () => {
    clearInterval(window._statusPollInterval);
    clearInterval(window._dataRefreshInterval);
    clearTimeout(window._idleLogoutTimer);
    clearTimeout(window._idleWarnTimer);
    await window.supabaseClient.auth.signOut();
    window.location.href = 'index.html';
  },

  // ── REDIRECT BY ROLE ──────────────────────────────────────────────
  redirectByRole: (role) => {
    switch(role) {
      case 'ADMIN':  window.location.href = 'admin.html';  break;
      case 'AGENT':  window.location.href = 'agent.html';  break;
      case 'CLIENT': window.location.href = 'client.html'; break;
      default:
        console.error('Unknown role', role);
        window.location.href = 'index.html';
    }
  },

  // ── VERIFY SESSION — called on index.html on load ─────────────────
  verifySessionAndRedirect: async () => {
    const { data: { session } } = await window.supabaseClient.auth.getSession();
    if (!session) return;

    const { data } = await window.supabaseClient
      .from('betting_users')
      .select('role, status')
      .eq('id', session.user.id)
      .single();

    if (!data) { await window.supabaseClient.auth.signOut(); return; }

    // Suspended: kill the session, stay on login page
    if (data.status === 'SUSPENDED') {
      await window.supabaseClient.auth.signOut();
      return;
    }

    window.AuthSystem.redirectByRole(data.role);
  },

  // ── REQUIRE ROLE — page guard for all dashboard pages ─────────────
  requireRole: async (requiredRole) => {
    const { data: { session }, error } = await window.supabaseClient.auth.getSession();

    if (error || !session) {
      window.location.href = 'index.html';
      return null;
    }

    const { data: profile } = await window.supabaseClient
      .from('betting_users')
      .select('*')
      .eq('id', session.user.id)
      .single();

    // No profile or suspended → immediate sign-out + redirect with error flag
    if (!profile || profile.status === 'SUSPENDED') {
      await window.supabaseClient.auth.signOut();
      window.location.href = 'index.html?error=suspended';
      return null;
    }

    // Wrong role → redirect to their correct page (not index, avoids loop)
    if (profile.role !== requiredRole) {
      const rolePages = { ADMIN: 'admin.html', AGENT: 'agent.html', CLIENT: 'client.html' };
      window.location.href = rolePages[profile.role] || 'index.html';
      return null;
    }

    // Update last_seen_at non-blocking — don't await
    window.supabaseClient
      .from('betting_users')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', session.user.id)
      .then(() => {}).catch(() => {});

    // Bind logout buttons
    document.querySelectorAll('.logout-btn').forEach(btn =>
      btn.addEventListener('click', window.AuthSystem.logout)
    );

    return { session, profile };
  },

  // ── STATUS POLLING — detects suspension while user is logged in ───
  // Polls DB every `intervalSec` seconds. If status flips to SUSPENDED,
  // signs the user out immediately and shows the suspended error on login page.
  startStatusPolling: (userId, intervalSec = 60) => {
    clearInterval(window._statusPollInterval);
    window._statusPollInterval = setInterval(async () => {
      try {
        const { data } = await window.supabaseClient
          .from('betting_users')
          .select('status')
          .eq('id', userId)
          .single();

        if (data && data.status === 'SUSPENDED') {
          clearInterval(window._statusPollInterval);
          clearTimeout(window._idleLogoutTimer);
          clearTimeout(window._idleWarnTimer);
          await window.supabaseClient.auth.signOut();
          window.location.href = 'index.html?error=suspended';
        }
      } catch(e) { /* non-blocking — don't crash on transient network error */ }
    }, intervalSec * 1000);
  },

  // ── SESSION TIMEOUT — auto-logout after inactivity ────────────────
  // Shows a warning banner 2 min before logout.
  // Requires a <div id="session-warning-banner"> in the page HTML.
  startSessionTimeout: (minutes = 30) => {
    const totalMs = minutes * 60 * 1000;
    const warnMs  = totalMs - (2 * 60 * 1000); // warn 2 min before

    const showBanner = () => {
      const el = document.getElementById('session-warning-banner');
      if (el) el.style.display = 'flex';
    };
    const hideBanner = () => {
      const el = document.getElementById('session-warning-banner');
      if (el) el.style.display = 'none';
    };

    const reset = () => {
      clearTimeout(window._idleWarnTimer);
      clearTimeout(window._idleLogoutTimer);
      hideBanner();
      window._idleWarnTimer   = setTimeout(showBanner, Math.max(warnMs, 0));
      window._idleLogoutTimer = setTimeout(async () => {
        alert('Your session has expired due to inactivity. You will be logged out.');
        await window.AuthSystem.logout();
      }, totalMs);
    };

    ['click', 'keydown', 'scroll', 'mousemove', 'touchstart'].forEach(evt =>
      document.addEventListener(evt, reset, { passive: true })
    );
    reset();
  },

  // ── ID / PASSWORD GENERATION ──────────────────────────────────────
  generateUniqueId: async (userType) => {
    const prefix = userType === 'AGENT' ? 'A' : 'C';
    let isUnique = false;
    let newId = '';

    while (!isUnique) {
      const digits = String(Math.floor(10000 + Math.random() * 90000));
      newId = `${prefix}${digits}`;
      const { data } = await window.supabaseClient
        .from('betting_users')
        .select('login_id')
        .eq('login_id', newId);
      if (!data || data.length === 0) isUnique = true;
    }
    return newId;
  },

  generatePassword: () => String(Math.floor(100000 + Math.random() * 900000))
};
