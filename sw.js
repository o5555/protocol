// Minimal service worker — network-first strategy
// Enough to enable "Add to Home Screen" prompt

self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
