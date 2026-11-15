// Service worker: deixa o app funcionando offline e abrindo instantaneamente.
// Estratégia: responde do cache e atualiza em segundo plano (stale-while-revalidate).
const VERSION = 'agentonator-v6';
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/conflicts.js',
  'js/db.js',
  'js/forms.js',
  'js/icons.js',
  'js/photo.js',
  'js/push.js',
  'js/rows.js',
  'js/schedule.js',
  'js/sheets.js',
  'js/store.js',
  'js/time.js',
  'js/ui.js',
  'js/util.js',
  'js/widgets.js',
  'js/views/agenda.js',
  'js/views/lists.js',
  'js/views/listview.js',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  // cache: 'reload' ignora o cache HTTP do navegador -> a nova versão é baixada inteira e consistente
  event.waitUntil(
    caches.open(VERSION)
      .then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // revalida com o servidor (ignora o cache HTTP); navegação precisa de um Request novo
  const netReq = req.mode === 'navigate' ? new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' }) : new Request(req, { cache: 'no-cache' });
  const network = fetch(netReq)
    .then(async (res) => {
      if (res && res.ok) {
        const cache = await caches.open(VERSION);
        await cache.put(req, res.clone());
      }
      return res;
    })
    .catch(() => null);
  event.waitUntil(network.then(() => undefined));

  event.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true });
    if (cached) return cached;
    const res = await network;
    if (res) return res;
    if (req.mode === 'navigate') {
      const shell = await caches.match('index.html');
      if (shell) return shell;
    }
    return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  })());
});

// ---------- notificações ----------
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(data.title || 'Agentonator', {
    body: data.body || '',
    tag: data.tag || undefined,
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    data: { url: data.url || './' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) if ('focus' in c) return c.focus();
    return self.clients.openWindow(event.notification.data?.url || './');
  })());
});
