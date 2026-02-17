const CACHE_NAME = 'pc-v7';

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
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
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

  // Cache-first for same-origin static assets
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        return cached;
      }
      return fetch(event.request).then((response) => {
        // Cache successful same-origin responses for future use
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    }).catch(() => {
      // SPA fallback: serve cached index.html for failed navigation requests
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
    data: { url: data.url || '/' },
    vibrate: [100, 50, 100]
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'Protocol Circle', options)
  );
});

// Open app when notification is clicked
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        // Focus existing window if found
        for (const client of clients) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            return client.focus();
          }
        }
        // Otherwise open new window
        return self.clients.openWindow(targetUrl);
      })
  );
});
