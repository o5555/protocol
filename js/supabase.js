// HTML escaping utility — prevents XSS when interpolating user content into innerHTML
function escapeHtml(str) {
  if (str == null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
window.escapeHtml = escapeHtml;

// Supabase Client Configuration
// Replace these values with your Supabase project credentials

const SUPABASE_URL = 'https://fhsbkcvepvlqbygpmdpc.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_5Qc9V6necHA04JcY00FfWg_eos85Do4';

// Initialize Supabase client
// Supabase JS library is loaded via CDN in index.html
let _supabaseInstance = null;

function initSupabase() {
  if (typeof window.supabase === 'undefined') {
    console.error('Supabase library not loaded');
    return null;
  }

  if (!_supabaseInstance) {
    _supabaseInstance = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true
      }
    });
  }

  return _supabaseInstance;
}

// Get current session
async function getSession() {
  const client = initSupabase();
  if (!client) return null;

  const { data: { session }, error } = await client.auth.getSession();
  if (error) {
    console.error('Error getting session:', error);
    return null;
  }
  return session;
}

// Get current user (memoized — avoids redundant getSession() calls within the same render cycle)
let _cachedUser = null;
let _cachedUserTimestamp = 0;
const USER_CACHE_TTL = 5000; // 5 seconds

async function getCurrentUser() {
  const now = Date.now();
  if (_cachedUser && (now - _cachedUserTimestamp) < USER_CACHE_TTL) {
    return _cachedUser;
  }
  const session = await getSession();
  _cachedUser = session?.user || null;
  _cachedUserTimestamp = now;
  return _cachedUser;
}

// Clear user cache (called on auth state changes)
function clearUserCache() {
  _cachedUser = null;
  _cachedUserTimestamp = 0;
}

// Check if user is authenticated
async function isAuthenticated() {
  const session = await getSession();
  return !!session;
}

// Subscribe to auth state changes
function onAuthStateChange(callback) {
  const client = initSupabase();
  if (!client) return null;

  return client.auth.onAuthStateChange((event, session) => {
    callback(event, session);
  });
}

// Export functions for use in other modules
window.SupabaseClient = {
  init: initSupabase,
  getSession,
  getCurrentUser,
  isAuthenticated,
  onAuthStateChange,
  clearUserCache,
  // Direct access to client for advanced operations
  get client() {
    return initSupabase();
  }
};
