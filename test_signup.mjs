import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://vtxuzrkwnyhxciohwjjx.supabase.co';
const SUPABASE_KEY = 'sb_publishable_c2TzMQIXnpvxbf5UIOmrYw_tABpS3yR';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function testSignup() {
    console.log(`Testing new signup A88888...`);
    const { data, error } = await supabase.auth.signUp({
        email: `a99999@bhandai.com`,
        password: '112233'
    });
    if (error) {
        console.error(`Signup failed:`, error.message);
    } else {
        console.log(`Signup SUCCESS. User ID:`, data.user?.id);
        const { error: loginErr } = await supabase.auth.signInWithPassword({
            email: `a99999@bhandai.com`,
            password: '112233'
        });
        if (loginErr) {
            console.error(`Login immediately after signup failed:`, loginErr.message);
        } else {
            console.log(`Login SUCCESS! Email confirmation is truly disabled.`);
        }
    }
}
testSignup();
