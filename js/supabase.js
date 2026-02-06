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

// Get current user
async function getCurrentUser() {
  const session = await getSession();
  return session?.user || null;
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
  // Direct access to client for advanced operations
  get client() {
    return initSupabase();
  }
};
