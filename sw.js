// Service worker: permite instalar la app y abrirla sin conexión.
const VERSION = 'prime-v19';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './config.js', './css/app.css',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-512-maskable.png',
  './js/main.js', './js/lib.js', './js/util.js', './js/store.js', './js/nutrition.js', './js/foods-db.js',
  './js/food-api.js', './js/ai.js', './js/planner.js', './js/components.js', './js/gym-data.js', './js/lock.js',
  './js/views/today.js', './js/views/add-food.js', './js/views/scanner.js', './js/views/ai-log.js',
  './js/views/recipes.js', './js/views/plan.js', './js/views/gym.js', './js/views/comida.js', './js/views/coach.js', './js/views/progress.js', './js/views/profile.js', './js/views/auth.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Librerías versionadas del CDN: caché primero (no cambian nunca).
  if (url.hostname === 'esm.sh') {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }

  // Archivos de la app: red primero (para recibir actualizaciones) y caché si no hay conexión.
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('./index.html') : undefined)))
    );
  }
  // APIs (Supabase, Open Food Facts, USDA, Gemini): siempre red.
});
