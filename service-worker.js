/**
 * VIFT CRM — Service Worker v10
 *
 * v10: bugfixar — behörigheter, snabb status, mobil iOS-zoom
 *      Rensar v7/v8/v9 cacher.
 *
 * Cache-strategi:
 *   config.js           → Aldrig cachad (network only)
 *   Supabase/Mapbox     → Aldrig cachad (passeras direkt)
 *   index.html          → Network first, cache-fallback (offline)
 *   Versionsatta filer  → Cache first (?v= i URL garanterar busting)
 *   assets/             → Cache first med network-fallback
 *
 * Ny version: bump CACHE_NAME → gamla cacher raderas vid activate.
 */

const CACHE_NAME = 'vift-crm-v13';

/* Filer att förcacha vid install (app shell) */
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/assets/vift-logo.svg',
  '/assets/vift-logo-white.svg',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/assets/icon-180.png'
];

/* Dessa domäner passeras alltid direkt — ingen intercept */
const PASSTHROUGH_HOSTS = [
  'supabase.co',
  'mapbox.com',
  'googleapis.com',
  'fonts.gstatic.com'
];

/* ── Install: förcacha app shell ──────────────────────── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())   /* aktivera direkt utan väntan */
  );
});

/* ── Activate: rensa gamla cacher ─────────────────────── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => {
            console.log('[SW] Raderar gammal cache:', k);
            return caches.delete(k);
          })
      ))
      .then(() => self.clients.claim())
  );
});

/* ── Fetch: cache-strategi per resurstyp ──────────────── */
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  /* 1. Passera externa domäner direkt */
  if (PASSTHROUGH_HOSTS.some(h => url.hostname.includes(h))) return;

  /* 2. Passera icke-same-origin direkt */
  if (url.origin !== self.location.origin) return;

  const path = url.pathname;

  /* 3. config.js — network only, aldrig cachad */
  if (path === '/config.js' || path.endsWith('/config.js')) {
    event.respondWith(
      fetch(req).catch(() =>
        new Response('window.VIFT_CONFIG={mapboxToken:""};', {
          headers: { 'Content-Type': 'application/javascript' }
        })
      )
    );
    return;
  }

  /* 4. Versionsatta JS/CSS (?v=N) och assets/ — cache first */
  if (url.search.includes('v=') || path.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req).then(cached => {
        if (cached) return cached;
        return fetch(req).then(response => {
          if (response.ok) {
            /* clone() måste anropas synkront innan response returneras */
            const toCache = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(req, toCache));
          }
          return response;
        });
      })
    );
    return;
  }

  /* 5. index.html och övriga HTML — network first, cache fallback */
  event.respondWith(
    fetch(req)
      .then(response => {
        if (response.ok) {
          /* clone() måste anropas synkront innan response returneras */
          const toCache = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, toCache));
        }
        return response;
      })
      .catch(() => caches.match(req))
  );
});

/* ── Push notification received ──────────────────────────── */
self.addEventListener('push', event => {
  if (!event.data) return;

  let payload;
  try { payload = event.data.json(); }
  catch { payload = { title: 'VIFT CRM', body: event.data.text() }; }

  const title   = payload.title || 'VIFT CRM';
  const options = {
    body:               payload.body || '',
    icon:               '/assets/icon-192.png',
    badge:              '/assets/icon-192.png',
    data:               { url: payload.url || '/', aoId: payload.aoId || null },
    requireInteraction: false
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

/* ── Notification clicked → öppna rätt sida ─────────────── */
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const data  = event.notification.data || {};
  const url   = data.url || '/';
  const aoId  = data.aoId || null;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(list => {
        const existing = list.find(c => c.url.startsWith(self.location.origin));
        if (existing) {
          existing.focus();
          /* Skicka meddelande till appen för in-app-navigering utan sidladdning */
          if (aoId) {
            existing.postMessage({ type: 'OPEN_AO', aoId });
          }
          return;
        }
        /* Appen inte öppen — öppna ny flik med deep-link-URL */
        return clients.openWindow(url);
      })
  );
});

