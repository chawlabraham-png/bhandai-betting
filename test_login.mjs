import { createClient } from '@supabase/supabase-js';
const SUPABASE_URL = 'https://vtxuzrkwnyhxciohwjjx.supabase.co';
const SUPABASE_KEY = 'sb_publishable_c2TzMQIXnpvxbf5UIOmrYw_tABpS3yR';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function testLogin(id, pass) {
    console.log(`Testing ${id}...`);
    const { data, error } = await supabase.auth.signInWithPassword({
        email: `${id.toLowerCase()}@bhandai.com`,
        password: pass
    });
    if (error) {
        console.error(`Login failed for ${id}:`, error.message);
    } else {
        console.log(`Login SUCCESS for ${id}!`);
    }
}

await testLogin('A12345', '112233');
await testLogin('A55555', '112233');
