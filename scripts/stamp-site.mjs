// Номер версии в адресах модулей сайта (с 0.58.1). Запускается только при выкладке на GitHub Pages (tests.yml, шаг
// deploy) — в копии репозитория на сервере сборки; файлы в репозитории не меняются. Каждый относительный импорт
// `from './x.js'` в src/ получает `?v=<версия>`: после выкладки браузер (и CDN) запрашивает новые адреса и не может
// взять из кэша старый модуль вместе с новой страницей (в 0.57.1 номер версии получили только styles.css и app.js в
// index.html — остальные модули после выкладки 0.58.0 у пользователя пришли из кэша старыми). Все импорты одного
// файла получают один и тот же адрес, поэтому модуль по-прежнему загружается один раз.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const IMPORT_RE = /(\bfrom\s+)(['"])(\.\.?\/[^'"\s]+?\.js)\2/g;

/** Код модуля с ?v=версия у каждого относительного импорта; уже помеченные не трогаются. */
export function stampImports(code, version) {
  return code.replace(IMPORT_RE, (m, from, q, path) => `${from}${q}${path}?v=${version}${q}`);
}

/** Относительные импорты модуля (пути без ?v=). */
export const relativeImports = (code) => [...code.matchAll(/\bfrom\s+(['"])(\.\.?\/[^'"\s]+?\.js)(\?v=[\w.-]+)?\1/g)].map((m) => m[2]);

async function jsFiles(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = new URL(e.name + (e.isDirectory() ? '/' : ''), dir);
    if (e.isDirectory()) out.push(...(await jsFiles(p)));
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = new URL('../', import.meta.url);
  const { APP_VERSION } = await import(new URL('src/core/version.js', root));
  const html = await readFile(new URL('index.html', root), 'utf8');
  if (!html.includes(`app.js?v=${APP_VERSION}`) || !html.includes(`styles.css?v=${APP_VERSION}`)) throw new Error(`index.html: ссылки без ?v=${APP_VERSION}`);
  let n = 0;
  for (const f of await jsFiles(new URL('src/', root))) {
    const code = await readFile(f, 'utf8');
    const out = stampImports(code, APP_VERSION);
    if (out !== code) {
      n += relativeImports(code).length;
      await writeFile(f, out);
    }
  }
  console.log(`stamp-site: ${n} импортов → ?v=${APP_VERSION}`);
}
