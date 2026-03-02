const CACHE_NAME = 'golden-price-v3';
const STATIC_ASSETS = [
  '/',
  '/styles.css',
  '/app.js',
  '/manifest.json',
  '/icons/icon.svg',
  'https://code.highcharts.com/highcharts.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
      .catch((err) => {
        console.error('[SW] Install failed:', err);
        throw err;
      })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // Network-first for API calls; cache-first for static assets
  if (request.url.includes('/api/')) {
    event.respondWith(
      fetch(request).catch(
        () =>
          new Response('{"error":"offline"}', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'application/json' },
          })
      )
    );
  } else {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).catch(
        () => {
          const isNavigate = request.mode === 'navigate';
          return new Response(isNavigate ? '<h1>Offline</h1>' : 'Offline', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': isNavigate ? 'text/html' : 'text/plain' },
          });
        }
      ))
    );
  }
});
