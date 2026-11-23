// Service worker: λειτουργία χωρίς internet.
// - Κέλυφος εφαρμογής (html/css/js): network-first με πτώση στην cache (έτσι ενημερώνεται εύκολα).
// - vendor/ (μοντέλα, wasm, βιβλιοθήκες): cache-first (αμετάβλητα, μεγάλα).
const VERSION = 'v2';
const SHELL = `secondvision-shell-${VERSION}`;
const VENDOR = `secondvision-vendor-${VERSION}`;

const SHELL_FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/app.js', 'js/audio.js', 'js/camera.js', 'js/commands.js', 'js/faces.js', 'js/lang-el.js', 'js/lookup.js', 'js/memory.js',
  'js/ocr.js', 'js/sensors.js', 'js/settings.js', 'js/spatial.js', 'js/speech.js', 'js/tracker.js', 'js/vision.js'
];
// Βασικά για να δουλεύει η ανίχνευση και η εκμάθηση αντικειμένων χωρίς internet
const CORE_VENDOR = [
  'vendor/mediapipe/vision_bundle.mjs', 'vendor/mediapipe/wasm/vision_wasm_internal.js', 'vendor/mediapipe/wasm/vision_wasm_internal.wasm',
  'vendor/mediapipe/wasm/vision_wasm_module_internal.js', 'vendor/mediapipe/wasm/vision_wasm_module_internal.wasm',
  'vendor/models/efficientdet_lite0.tflite', 'vendor/models/mobilenet_v3_small.tflite'
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const shell = await caches.open(SHELL);
    await Promise.all(SHELL_FILES.map(u => shell.add(u).catch(() => {})));
    const vendor = await caches.open(VENDOR);
    await Promise.all(CORE_VENDOR.map(u => vendor.add(u).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (![SHELL, VENDOR].includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const isVendor = url.pathname.includes('/vendor/');
  e.respondWith((async () => {
    const cacheName = isVendor ? VENDOR : SHELL;
    const cache = await caches.open(cacheName);
    if (isVendor) {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    }
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      const hit = await cache.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await cache.match('index.html') : null);
      if (hit) return hit;
      throw new Error('offline');
    }
  })());
});
