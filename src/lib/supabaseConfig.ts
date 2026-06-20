/**
 * Supabase connection config for the /play profile store.
 *
 * Environment variables take PRIORITY (NEXT_PUBLIC_SUPABASE_URL /
 * NEXT_PUBLIC_SUPABASE_ANON_KEY); otherwise we fall back to the hard-coded
 * defaults below so the app connects to Supabase even when the Vercel env vars
 * can't be set.
 *
 * These are PUBLIC values — the "publishable" key is designed to be exposed to
 * the browser; access is protected by Row Level Security (RLS) policies, not by
 * keeping the key secret.
 */

const DEFAULT_SUPABASE_URL = "https://emxaodhjmpjmzfhgztmq.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY = "sb_publishable_TjpVh0B2lUr-K7peQskwjA_2ITijtLS";

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || DEFAULT_SUPABASE_URL;
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY;
