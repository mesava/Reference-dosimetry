// Сервис-воркер страницы на сервере (GitHub Pages): калькулятор открывается и без интернета, в том числе установленный
// как приложение. Файлы страницы — сначала из сети (всегда свежая версия), без сети — сохранённая копия; шрифты Google
// не меняются — из копии, если она есть. Данные (формы, журнал) сервис-воркер не трогает: они в хранилище браузера
// и в файлах пользователя. У автономного файла dist/index.html сервис-воркера нет.
const CACHE = 'reference-dosimetry-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png'];

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
  const font = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (url.origin !== self.location.origin && !font) return;
  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      if (font) {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
        return res;
      }
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
