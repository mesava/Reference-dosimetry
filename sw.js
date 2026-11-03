// Сервис-воркер страницы на сервере (GitHub Pages): калькулятор открывается и без интернета, в том числе установленный
// как приложение. Файлы страницы (и шрифты из fonts/, с 0.49.1 — свои, без запросов к Google) — сначала из сети
// (всегда свежая версия), без сети — сохранённая копия. Данные (формы, журнал) сервис-воркер не трогает: они в хранилище браузера
// и в файлах пользователя. У автономного файла dist/index.html сервис-воркера нет.
const CACHE = 'reference-dosimetry-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './fonts/fonts.css'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch (err) {
        const hit = (await cache.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? await cache.match('./index.html') : null);
        if (hit) return hit;
        throw err;
      }
    })(),
  );
});
