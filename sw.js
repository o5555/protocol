const CACHE_NAME = 'pc-v27';

const APP_SHELL = [
  '/',
  '/index.html',
  '/css/mobile.css',
  '/js/supabase.js',
  '/js/auth.js',
  '/js/dateutils.js',
  '/js/onboarding.js',
  '/js/dashboard.js',
  '/js/cache.js',
  '/js/pull-to-refresh.js',
  '/js/protocols.js',
  '/js/comparison.js',
  '/js/account.js',
  '/js/notifications.js',
  '/js/friends.js',
  '/js/challenges.js',
  '/manifest.json',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg',
  '/icons/icon-180.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/favicon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME && key !== 'pc-deeplink').map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Network-only for API calls and Supabase requests
  if (url.pathname.includes('/api/') || url.hostname.includes('supabase')) {
    return;
  }

  // Network-first for external CDN requests (don't cache)
  if (url.origin !== self.location.origin) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  // Network-first for JS and HTML (always get latest code)
  if (url.pathname.endsWith('.js') || url.pathname.endsWith('.html') || url.pathname === '/') {
    event.respondWith(
      fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => caches.match(event.request).then((cached) => {
        if (cached) return cached;
        if (event.request.mode === 'navigate') return caches.match('/index.html');
      }))
    );
    return;
  }

  // Cache-first for static assets (icons, CSS, manifest)
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        return cached;
      }
      return fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    }).catch(() => {
      if (event.request.mode === 'navigate') {
        return caches.match('/index.html');
      }
    })
  );
});

// Web Push notification handler
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch (e) {
    data = { title: 'Protocol Circle', body: event.data.text() };
  }

  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { page: data.page || null, challengeId: data.challengeId || null },
    vibrate: [100, 50, 100]
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'Protocol Circle', options)
  );
});

// Store deep-link target in Cache API (accessible by both SW and main thread)
async function storeDeepLink(navData) {
  if (!navData || !navData.page) return;
  const cache = await caches.open('pc-deeplink');
  await cache.put('/deeplink-target', new Response(JSON.stringify({
    page: navData.page,
    id: navData.challengeId || null,
    timestamp: Date.now()
  })));
}

// Open app and navigate to the right page when notification is clicked
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const navData = event.notification.data || {};

  event.waitUntil(
    (async () => {
      // Store deep-link in Cache API first (works reliably on iOS PWA)
      await storeDeepLink(navData);

      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

      // Focus existing window and tell it where to navigate
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.postMessage({ type: 'navigate', page: navData.page, detailId: navData.challengeId });
          return client.focus();
        }
      }

      // Open new window (URL params as fallback for non-iOS platforms)
      let url = '/';
      if (navData.page) {
        url = '/?nav=' + navData.page;
        if (navData.challengeId) url += '&id=' + navData.challengeId;
      }
      return self.clients.openWindow(url);
    })()
  );
});
