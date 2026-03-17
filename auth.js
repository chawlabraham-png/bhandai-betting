// ==========================================
// auth.js - Shared Authentication Logic
// Uses Supabase Auth combined with a custom 'betting_users' table
// ==========================================

// NOTE: Using the known Supabase credentials from config.js
const SUPABASE_URL = 'https://vtxuzrkwnyhxciohwjjx.supabase.co';
const SUPABASE_KEY = 'sb_publishable_c2TzMQIXnpvxbf5UIOmrYw_tABpS3yR';

window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

window.AuthSystem = {
  // Utility: Convert Login ID to Email mapping (must be lowercase for Supabase)
  toEmail: (loginId) => `${loginId.toLowerCase()}@bhandai.com`,
  
  // Login with custom ID
  login: async (loginId, password) => {
    const email = window.AuthSystem.toEmail(loginId);
    const { data: authData, error: authErr } = await window.supabaseClient.auth.signInWithPassword({
      email: email,
      password: password
    });
    
    if (authErr) throw new Error('Invalid Login ID or Password. Please try again.');
    
    // Auth succeeded, now fetch role bounds from our custom table
    const { data: userProfile, error: profileErr } = await window.supabaseClient
      .from('betting_users')
      .select('role')
      .eq('id', authData.user.id)
      .single();
      
    if (profileErr) {
      window.AuthSystem.logout();
      throw new Error('Invalid Login ID or Password. Please try again.');
    }
    
    // Redirect based on role
    window.AuthSystem.redirectByRole(userProfile.role);
    return userProfile;
  },

  logout: async () => {
    await window.supabaseClient.auth.signOut();
    window.location.href = 'index.html';
  },

  redirectByRole: (role) => {
    switch(role) {
      case 'ADMIN': window.location.href = 'admin.html'; break;
      case 'AGENT': window.location.href = 'agent.html'; break;
      case 'CLIENT': window.location.href = 'client.html'; break;
      default: 
        console.error('Unknown role', role);
        window.location.href = 'index.html';
    }
  },

  // Called on page load in index.html to skip login if already authed
  verifySessionAndRedirect: async () => {
    const { data: { session } } = await window.supabaseClient.auth.getSession();
    if (session) {
      const { data } = await window.supabaseClient.from('betting_users').select('role').eq('id', session.user.id).single();
      if (data) {
        window.AuthSystem.redirectByRole(data.role);
      } else {
        await window.AuthSystem.logout();
      }
    }
  },

  // Called on dashboard pages (admin.html, agent.html) to protect them
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

    if (!profile || profile.role !== requiredRole) {
      // Unauthorized for this view
      window.location.href = 'index.html';
      return null;
    }

    // Bind logout buttons globally if they exist
    const logoutBtns = document.querySelectorAll('.logout-btn');
    logoutBtns.forEach(btn => btn.addEventListener('click', window.AuthSystem.logout));

    return { session, profile };
  },

  // Helper: Create a new user (Admin or Agent logic under the hood)
  // This interacts directly with Supabase API. Normally this would be a secure Edge Function/RPC, 
  // but for local demo purposes, we will rely on authenticated client calls.
  generateUniqueId: async (userType) => {
    const prefix = userType === 'AGENT' ? 'A' : 'C';
    let isUnique = false;
    let newId = '';
    
    while (!isUnique) {
      // Generate 5 random digits string
      const digits = String(Math.floor(10000 + Math.random() * 90000));
      newId = `${prefix}${digits}`;
      
      // Check collision
      const { data } = await window.supabaseClient
        .from('betting_users')
        .select('login_id')
        .eq('login_id', newId);
        
      if (!data || data.length === 0) {
        isUnique = true;
      }
    }
    return newId;
  },

  generatePassword: () => {
     return String(Math.floor(100000 + Math.random() * 900000));
  }
};
