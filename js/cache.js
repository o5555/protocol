// Cache Module - localStorage cache for instant loading
const Cache = {
  PREFIX: 'protocol_cache_',
  TTL: 5 * 60 * 1000, // 5 minutes cache validity

  // Get cached data
  get(key) {
    try {
      const item = localStorage.getItem(this.PREFIX + key);
      if (!item) return null;

      const { data, timestamp } = JSON.parse(item);
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
  }
};

window.Cache = Cache;
