const worker = self as unknown as ServiceWorkerGlobalScope;
const cacheName = 'streamguard-typescript-v3';
const core = ['/', '/icon.svg', '/manifest.webmanifest', '/locales/es.json', '/locales/noscript.es.html'];
worker.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(core)).then(() => worker.skipWaiting()));
});
worker.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('streamguard-') && key !== cacheName).map(key => caches.delete(key)))).then(() => worker.clients.claim()));
});
worker.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // Keep API calls, credentials, recordings and configuration out of the cache.
  if (event.request.method !== 'GET' || url.origin !== worker.location.origin || url.pathname.startsWith('/api/') || url.pathname === '/config.js') return;
  // Hashed build files never change: serve them from the cache instantly.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(caches.match(event.request).then(cached => cached ?? fetch(event.request).then(response => {
      if (response.ok) {const copy = response.clone(); event.waitUntil(caches.open(cacheName).then(cache => cache.put(event.request, copy)));}
      return response;
    })));
    return;
  }
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) {const copy = response.clone(); event.waitUntil(caches.open(cacheName).then(cache => cache.put(event.request, copy)));}
    return response;
  }).catch(async () => (await caches.match(event.request)) ?? Response.error()));
});
