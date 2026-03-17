import { createClient } from '@supabase/supabase-js';

// The anon public key
const SUPABASE_URL = 'https://vtxuzrkwnyhxciohwjjx.supabase.co';
const SUPABASE_KEY = 'sb_publishable_c2TzMQIXnpvxbf5UIOmrYw_tABpS3yR';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function seed() {
  const loginId = 'A55555'; // Using a new admin ID in case A12345 is corrupted in auth.users by the SQL
  const password = '112233';
  const email = `${loginId.toUpperCase()}@bhandai.com`;

  console.log(`Seeding Admin account: ${loginId} / ${password}`);

  // 1. Sign up the user via GoTrue (this uses the proper bcrypt cost internally)
  const { data: authData, error: signupErr } = await supabase.auth.signUp({
    email,
    password
  });

  if (signupErr) {
    console.error("SignUp Error:", signupErr.message);
    if (!signupErr.message.includes('already registered')) {
        return;
    }
  }

  // If newly created, authData.user will have the id
  let userId = authData?.user?.id;
  
  if (!userId) {
     // If they already existed but we need the ID, attempt to sign in to get it
     const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({
         email, password
     });
     if (signInErr) {
         console.error("Could not sign in to existing account to get ID. It might be corrupted by the SQL insert:", signInErr.message);
         console.log("Creating another new Admin account instead...");
         return;
     }
     userId = signInData.user.id;
  }

  // 2. Insert into betting_users (requires the user to be active, or we must use an active session)
  // We signed in, so we have a session token. 
  // RLS allows authenticated users to read/write for now
  if (userId) {
      const { error: insertErr } = await supabase
        .from('betting_users')
        .upsert({
            id: userId,
            login_id: loginId,
            role: 'ADMIN',
            name: 'Master Admin'
        }, { onConflict: 'login_id' });
        
      if (insertErr) {
          console.error("Failed to insert into betting_users:", insertErr.message);
          return;
      }

      console.log(`Success! Properly seeded Admin -> Login ID: ${loginId} | Password: ${password}`);
  }
}

seed();
