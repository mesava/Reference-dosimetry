// Общее для сквозных проверок в браузере (Playwright, Chromium): статический сервер корня репозитория, запуск браузера,
// страница с подменой File System Access API и IndexedDB (fakefs.js) и сбор ошибок страницы.
// Запуск: npm run test:e2e (нужен Chromium для Playwright: npx playwright install chromium).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };

/** Сервер файлов репозитория на свободном порту. */
export async function startServer() {
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
    if (path.startsWith('..')) return res.writeHead(403).end();
    try {
      const body = await readFile(join(ROOT, path || 'index.html'));
      res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

export const launch = () => chromium.launch();

/** Новая страница (свой контекст): подмена файловой системы, ошибки страницы — в errors. */
export async function openPage(browser, { locale = 'ru-RU', fakefs = true, viewport = { width: 1400, height: 1000 }, mobile = false } = {}) {
  // mobile — телефон: сенсорный экран, мобильная область просмотра (как iPhone)
  const ctx = await browser.newContext({ locale, viewport, ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 3 } : {}) });
  if (fakefs) await ctx.addInitScript({ content: await readFile(new URL('./fakefs.js', import.meta.url), 'utf8') });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    // шрифты Google в изолированной среде могут не загрузиться — это не ошибка страницы
    if (m.type() === 'error' && !/Failed to load resource|fonts\.g/.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  return { ctx, page, errors };
}

/** Состояние подменённой файловой системы. */
export const fsState = (page) => page.evaluate(() => window.__fs.load());

/** Положить файл в подменённую файловую систему и выбрать его в окне «Открыть». */
export const putOpenFile = (page, name, text) =>
  page.evaluate(([n, t]) => {
    const s = window.__fs.load();
    s.files[n] = { text: t, lastModified: Date.now() };
    s.openName = n;
    window.__fs.save(s);
  }, [name, text]);

/** Изменить файл «в другом месте» (на другом компьютере): новое содержимое и более позднее время. */
export const changeElsewhere = (page, name, patch, ahead = 60000) =>
  page.evaluate(([n, p, a]) => {
    const s = window.__fs.load();
    const j = JSON.parse(s.files[n].text);
    Object.assign(j, p);
    s.files[n] = { text: JSON.stringify(j), lastModified: Date.now() + a };
    window.__fs.save(s);
  }, [name, patch, ahead]);

export const CYR = /[А-Яа-яЁё]/;
