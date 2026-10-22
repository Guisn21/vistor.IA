// Cache do "casco" do app para funcionar sem internet.
// Ao publicar uma nova versão, altere CACHE para forçar a atualização.
const CACHE = 'vistorias-v0.8.1';
const SHELL = ['./', 'index.html', 'app.js', 'manifest.webmanifest', 'vendor/piexif.js',
  'vendor/docx.mjs', 'vendor/jszip.min.js', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))) /* ignora o cache HTTP do navegador */).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return; // APIs externas vão direto à rede
  // Navegação usa a rede e, sem internet, o index em cache.
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('index.html')));
    return;
  }
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
