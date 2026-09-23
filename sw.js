self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => caches.delete(k)))
    ).then(() => {
      return self.registration.unregister();
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Always fetch directly from network
  event.respondWith(fetch(event.request));
});
