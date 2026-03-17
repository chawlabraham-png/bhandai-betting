import { createClient } from '@supabase/supabase-js';
const supabase = createClient('https://vtxuzrkwnyhxciohwjjx.supabase.co', 'sb_publishable_c2TzMQIXnpvxbf5UIOmrYw_tABpS3yR');

async function fix() {
    console.log("1. Re-registering A12345 with proper Supabase GoTrue hashes...");
    const { data: authData, error: signupErr } = await supabase.auth.signUp({
        email: 'a12345@bhandai.com',
        password: '112233'
    });
    
    if (signupErr) {
        console.error("Signup error (might already exist):", signupErr.message);
    } else {
        console.log("Signup success!");
    }

    console.log("2. Logging in to verify...");
    const { data: signIn, error: signInErr } = await supabase.auth.signInWithPassword({
        email: 'a12345@bhandai.com',
        password: '112233'
    });

    if (signInErr) {
        console.error("Login failed:", signInErr.message);
        return;
    }
    
    console.log("Login success! User ID:", signIn.user.id);

    console.log("3. Restoring Admin privileges in betting_users table...");
    const { error: dbErr } = await supabase.from('betting_users').upsert({
        id: signIn.user.id,
        login_id: 'A12345',
        role: 'ADMIN',
        name: 'Master Admin',
        balance: 999999.00
    });

    if (dbErr) {
        console.error("Database upsert failed:", dbErr.message);
    } else {
        console.log("SUCCESS: A12345 is fully repaired and ready to use.");
    }
}

fix();
