const { createClient } = require('@supabase/supabase-js');

let supabase = null;

try {
  supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  console.log('Supabase client initialized');
} catch (e) {
  console.error('Supabase init failed:', e.message);
}

module.exports = supabase;
