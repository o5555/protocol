// Cache Module - localStorage cache for instant loading
const Cache = {
  PREFIX: 'protocol_cache_',
  TTL: 24 * 60 * 60 * 1000, // 24 hours cache validity

  // Get cached data (returns null if expired)
  get(key) {
    try {
      const item = localStorage.getItem(this.PREFIX + key);
      if (!item) return null;

      const { data, timestamp } = JSON.parse(item);
      // Return null if cache has expired
      if (Date.now() - timestamp >= this.TTL) return null;
      return data;
    } catch (e) {
      return null;
    }
  },

  // Check if cache is fresh (within TTL)
  isFresh(key) {
    try {
      const item = localStorage.getItem(this.PREFIX + key);
      if (!item) return false;

      const { timestamp } = JSON.parse(item);
      return Date.now() - timestamp < this.TTL;
    } catch (e) {
      return false;
    }
  },

  // Set cached data
  set(key, data) {
    try {
      localStorage.setItem(this.PREFIX + key, JSON.stringify({
        data,
        timestamp: Date.now()
      }));
    } catch (e) {
      // Storage full or unavailable - ignore
    }
  },

  // Clear specific cache
  clear(key) {
    localStorage.removeItem(this.PREFIX + key);
  },

  // Clear all cache
  clearAll() {
    Object.keys(localStorage)
      .filter(k => k.startsWith(this.PREFIX))
      .forEach(k => localStorage.removeItem(k));
  },

  // Check if Oura sync has happened today
  isSyncedToday() {
    const last = localStorage.getItem(this.PREFIX + 'last_sync_date');
    const today = new Date().toISOString().slice(0, 10);
    return last === today;
  },

  // Mark that sync happened today
  markSyncedToday() {
    localStorage.setItem(this.PREFIX + 'last_sync_date', new Date().toISOString().slice(0, 10));
  }
};

window.Cache = Cache;
