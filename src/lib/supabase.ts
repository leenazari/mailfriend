import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  // Don't throw at import time in dev — just log.
  // The first request that needs it will fail visibly.
  console.warn('[supabase] missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

// Server-only client. Uses the service role key so we can bypass RLS.
// Never import this from a client component.
export const supabaseAdmin = createClient(url ?? '', serviceKey ?? '', {
  auth: { persistSession: false, autoRefreshToken: false },
});
