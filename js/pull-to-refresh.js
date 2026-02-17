// Pull-to-Refresh Module for mobile PWA
const PullToRefresh = {
  _startY: 0,
  _currentY: 0,
  _pulling: false,
  _refreshing: false,
  _indicator: null,
  _label: null,
  _spinner: null,
  _contentArea: null,
  THRESHOLD: 60,

  // Cache keys to clear per page
  _cacheKeys: {
    'dashboard': ['dashboard'],
    'challenges': ['challenges_list'],
    'challenge-detail': (id) => ['challenge_detail_' + id, 'comparison_' + id],
    'protocols': ['protocols_list'],
    'protocol-detail': (id) => ['protocol_detail_' + id],
    'account': ['account'],
    'friends': ['friends'],
  },

  init() {
    this._indicator = document.getElementById('ptr-indicator');
    this._label = document.getElementById('ptr-label');
    this._spinner = document.getElementById('ptr-spinner');
    this._contentArea = document.querySelector('.app-main');

    if (!this._indicator || !this._contentArea) return;

    document.addEventListener('touchstart', this._onTouchStart.bind(this), { passive: true });
    document.addEventListener('touchmove', this._onTouchMove.bind(this), { passive: false });
    document.addEventListener('touchend', this._onTouchEnd.bind(this), { passive: true });
  },

  _isScrolledToTop() {
    return window.scrollY <= 0;
  },

  _isNestedScroll(target) {
    // Walk up from the touch target to see if any ancestor (before .app-main) scrolls
    let el = target;
    while (el && el !== this._contentArea && el !== document.body) {
      if (el.scrollHeight > el.clientHeight && el.scrollTop > 0) {
        return true;
      }
      el = el.parentElement;
    }
    return false;
  },

  _onTouchStart(e) {
    if (this._refreshing) return;
    if (!this._isScrolledToTop()) return;

    this._startY = e.touches[0].clientY;
    this._pulling = false;
  },

  _onTouchMove(e) {
    if (this._refreshing) return;
    if (this._startY === 0) return;

    this._currentY = e.touches[0].clientY;
    const pullDistance = this._currentY - this._startY;

    // Only activate when pulling down and scrolled to top
    if (pullDistance <= 0 || !this._isScrolledToTop()) {
      this._reset();
      return;
    }

    // Don't trigger for nested scrollable elements
    if (this._isNestedScroll(e.target)) {
      return;
    }

    // Prevent native scroll while pulling
    e.preventDefault();

    this._pulling = true;

    // Apply rubber-band dampening: distance grows slower as you pull further
    const dampened = Math.min(pullDistance * 0.5, 120);

    this._indicator.style.transform = `translateY(${dampened}px)`;
    this._indicator.style.opacity = Math.min(dampened / this.THRESHOLD, 1).toString();
    this._contentArea.style.transform = `translateY(${dampened}px)`;
    this._contentArea.style.transition = 'none';
    this._indicator.style.transition = 'none';

    if (dampened >= this.THRESHOLD) {
      this._label.textContent = 'Release to refresh';
      this._indicator.classList.add('ptr-ready');
    } else {
      this._label.textContent = 'Pull to refresh';
      this._indicator.classList.remove('ptr-ready');
    }
  },

  _onTouchEnd() {
    if (!this._pulling) {
      this._startY = 0;
      return;
    }

    const pullDistance = (this._currentY - this._startY) * 0.5;

    if (pullDistance >= this.THRESHOLD && !this._refreshing) {
      this._triggerRefresh();
    } else {
      this._reset();
    }

    this._startY = 0;
    this._pulling = false;
  },

  _triggerRefresh() {
    this._refreshing = true;

    // Snap indicator to threshold position with spinner
    this._indicator.style.transition = 'transform 0.2s ease';
    this._indicator.style.transform = `translateY(${this.THRESHOLD}px)`;
    this._indicator.style.opacity = '1';
    this._contentArea.style.transition = 'transform 0.2s ease';
    this._contentArea.style.transform = `translateY(${this.THRESHOLD}px)`;

    this._label.textContent = 'Refreshing...';
    this._spinner.classList.add('ptr-spinning');
    this._indicator.classList.add('ptr-active');
    this._indicator.classList.remove('ptr-ready');

    this.refresh();
  },

  async refresh() {
    try {
      // Clear cache for the current page
      const page = App.currentPage;
      const mapping = this._cacheKeys[page];

      if (mapping) {
        const keys = typeof mapping === 'function'
          ? mapping(App.currentDetailId)
          : mapping;

        keys.forEach(key => Cache.clear(key));
      }

      // Clear last sync date so Oura sync will re-run
      localStorage.removeItem(Cache.PREFIX + 'last_sync_date');

      // Re-render the current page
      await App.loadPageContent(App.currentPage, App.currentDetailId);

      // Brief delay so user sees the spinner
      await new Promise(resolve => setTimeout(resolve, 400));
    } catch (err) {
      console.error('Pull-to-refresh error:', err);
    } finally {
      this._finishRefresh();
    }
  },

  _finishRefresh() {
    this._indicator.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
    this._indicator.style.transform = 'translateY(0)';
    this._indicator.style.opacity = '0';
    this._contentArea.style.transition = 'transform 0.3s ease';
    this._contentArea.style.transform = 'translateY(0)';

    this._spinner.classList.remove('ptr-spinning');
    this._indicator.classList.remove('ptr-active');
    this._label.textContent = 'Pull to refresh';

    this._refreshing = false;
  },

  _reset() {
    this._indicator.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
    this._indicator.style.transform = 'translateY(0)';
    this._indicator.style.opacity = '0';
    this._contentArea.style.transition = 'transform 0.3s ease';
    this._contentArea.style.transform = 'translateY(0)';

    this._indicator.classList.remove('ptr-ready');
    this._label.textContent = 'Pull to refresh';
    this._pulling = false;
  },
};

window.PullToRefresh = PullToRefresh;
