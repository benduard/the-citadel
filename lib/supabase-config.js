/**
 * SUPABASE CONFIG - where this board's vault lives.
 *
 * The anon key is a public client key by design, not a secret: Supabase's row
 * level security (supabase/sync.sql, auth.uid() = user_id) is the real gate,
 * so this is safe to commit, the same way a Firebase client config is.
 */
window.SUPABASE_URL = 'https://zqqqczmqkacigihzdmbs.supabase.co'
window.SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpxcXFjem1xa2FjaWdpaHpkbWJzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5MzQ1NTUsImV4cCI6MjEwMDUxMDU1NX0.xawIhmRPaA2u6TItaVt3dXaDoF9d54fVm7hqF_rc0w0'
