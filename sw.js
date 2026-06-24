const VERSION = 'nadir-pos-pwa-v7-fast';
const STATIC_CACHE = `${VERSION}-static`;
const RUNTIME_CACHE = `${VERSION}-runtime`;
const OFFLINE_APP_URL = './index.html';
const OFFLINE_LOGIN_URL = './login.html';
const STATIC_ASSETS = [
  './',
  './index.html',
  './login.html',
  './css/style.css',
  './css/print.css',
  './js/app.js',
  './js/backup.js',
  './js/barcode.js',
  './js/cart.js',
  './js/collections.js',
  './js/dashboard.js',
  './js/expenses.js',
  './js/invoice.js',
  './js/login-app.js',
  './js/new-invoice.js',
  './js/ops-meta.js',
  './js/print.js',
  './js/products.js',
  './js/reports.js',
  './js/reps.js',
  './js/settings.js',
  './js/shops.js',
  './js/smart-search.js',
  './js/stocklog.js',
  './js/users-store.js',
  './js/wa-invoices.js',
  './manifest.json',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/mm-logo.png'
];

function isAppRequest(url) {
  return url.origin === self.location.origin;
}

function isNavigationRequest(request) {
  return request.mode === 'navigate';
}

function isStaticAsset(request) {
  return ['style', 'script', 'worker', 'font', 'image'].includes(request.destination);
}

function isApiRequest(url) {
  return url.href.includes('supabase.co');
}

function isExternalAsset(url) {
  return (
    url.href.includes('fonts.googleapis.com') ||
    url.href.includes('fonts.gstatic.com') ||
    url.href.includes('cdnjs.cloudflare.com')
  );
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response && (response.ok || response.type === 'opaque')) {
    const cache = await caches.open(RUNTIME_CACHE);
    cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then(response => {
      if (response && (response.ok || response.type === 'opaque')) {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    });

  return cached || networkPromise;
}

async function networkFirstPage(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (_) {
    const cached = await caches.match(request);
    if (cached) return cached;
    const isLoginPage = new URL(request.url).pathname.endsWith('/login.html');
    return caches.match(isLoginPage ? OFFLINE_LOGIN_URL : OFFLINE_APP_URL);
  }
}

self.addEventListener('install', event => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      await Promise.allSettled(
        STATIC_ASSETS.map(async asset => {
          try {
            await cache.add(asset);
          } catch (error) {
            console.warn('[SW] Failed to cache asset:', asset, error);
          }
        })
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(key => ![STATIC_CACHE, RUNTIME_CACHE].includes(key))
        .map(key => caches.delete(key))
    );
    if ('navigationPreload' in self.registration) {
      await self.registration.navigationPreload.enable().catch(() => {});
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  if (isApiRequest(url)) return;

  if (isNavigationRequest(event.request)) {
    event.respondWith(networkFirstPage(event.request));
    return;
  }

  if (isAppRequest(url) && isStaticAsset(event.request)) {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }

  if (isExternalAsset(url)) {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }

  if (isAppRequest(url)) {
    event.respondWith(cacheFirst(event.request).catch(() => caches.match(OFFLINE_APP_URL)));
  }
});
