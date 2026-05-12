// ═══════════════════════════════════════════════════════
//  LIFT — Service Worker  v1.0
//  Strategy:
//   • App Shell (HTML + Firebase SDKs + Fonts) → Cache First
//   • Firestore API calls → handled by Firebase SDK's own
//     IndexedDB offline persistence (we don't intercept those)
//   • Everything else → Network First, fall back to cache
// ═══════════════════════════════════════════════════════

const CACHE_NAME = 'lift-v1';

// Resources to pre-cache on install (app shell)
const PRECACHE = [
  './',
  './index.html',
  'https://www.gstatic.com/firebasejs/10.7.2/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.7.2/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.7.2/firebase-firestore-compat.js',
  'https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&display=swap',
];

// Hosts we cache-first (stable CDN assets)
const CACHE_FIRST_HOSTS = [
  'www.gstatic.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];

// ── Install: pre-cache app shell ─────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Cache each resource individually so one failure doesn't block all
      return Promise.allSettled(
        PRECACHE.map(url =>
          cache.add(url).catch(err => console.warn('[SW] Failed to cache:', url, err))
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// ── Activate: clean up old caches ────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: routing strategy ───────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Skip non-GET and cross-origin Firestore/Auth API calls
  // (Firebase SDK handles those with its own offline queue)
  if (event.request.method !== 'GET') return;
  if (url.hostname.includes('firestore.googleapis.com')) return;
  if (url.hostname.includes('identitytoolkit.googleapis.com')) return;
  if (url.hostname.includes('securetoken.googleapis.com')) return;

  // Cache-First for stable CDN assets (Firebase SDK, Google Fonts)
  if (CACHE_FIRST_HOSTS.some(h => url.hostname === h)) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // Cache-First for the app shell (same-origin HTML)
  if (url.pathname.endsWith('/') || url.pathname.endsWith('.html')) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // Network-First for everything else
  event.respondWith(networkFirst(event.request));
});

// ── Strategies ────────────────────────────────────────
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline — resource not cached', { status: 503 });
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response('Offline — resource not available', { status: 503 });
  }
}
