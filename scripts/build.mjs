// Сборка автономной версии: один HTML-файл со встроенными стилями и скриптом.
// dist/index.html    — полный документ, открывается двойным щелчком без интернета
//                      (шрифты встроены из fonts/; политика CSP — с хешем встроенного скрипта);
// dist/artifact.html — то же содержимое без обёртки <html>/<head>/<body>.
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
const read = (p) => readFile(new URL(p, root), 'utf8');

const html = await read('index.html');
const css = await read('src/ui/styles.css');
const bundle = await build({
  entryPoints: [new URL('src/ui/app.js', root).pathname],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  minify: true,
  write: false,
  legalComments: 'none',
  banner: { js: '/* Reference-dosimetry. Copyright (c) 2026 Мелентьев Александр Валериевич (Aleksandr Valerievich Melentev). AGPL-3.0-or-later: https://www.gnu.org/licenses/agpl-3.0.html */' },
  charset: 'utf8',
});
const js = bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

const cssTag = '<link rel="stylesheet" href="src/ui/styles.css">';
const jsTag = '<script type="module" src="src/ui/app.js"></script>';
if (!html.includes(cssTag) || !html.includes(jsTag)) throw new Error('index.html: не найдены теги стилей или скрипта');

// установка как приложение (манифест, сервис-воркер) — только у страницы на сервере: у файла рядом нет ни манифеста,
// ни значков; значок вкладки встраивается в файл
const pwaTags = ['<link rel="manifest" href="manifest.webmanifest">\n', '<link rel="apple-touch-icon" href="icons/icon-192.png">\n'];
const iconTag = '<link rel="icon" href="icons/icon.svg" type="image/svg+xml">';
for (const t of [...pwaTags, iconTag]) if (!html.includes(t)) throw new Error(`index.html: не найден тег ${t.trim()}`);
const icon = (await read('icons/icon.svg')).replace(/<!--[\s\S]*?-->/g, '').replace(/\s+/g, ' ').trim();
const iconData = `data:image/svg+xml,${encodeURIComponent(icon)}`;

// шрифты (fonts/fonts.css и woff2 рядом) — встраиваются в файл как data: URL
const fontsTag = '<link rel="stylesheet" href="fonts/fonts.css">';
if (!html.includes(fontsTag)) throw new Error('index.html: не найден тег шрифтов');
let fontsCss = await read('fonts/fonts.css');
for (const name of new Set([...fontsCss.matchAll(/url\(([\w.-]+\.woff2)\)/g)].map((m) => m[1]))) {
  const b64 = (await readFile(new URL(`fonts/${name}`, root))).toString('base64');
  fontsCss = fontsCss.replaceAll(`url(${name})`, `url(data:font/woff2;base64,${b64})`);
}

// политика CSP: у страницы на сервере скрипт — файлом ('self'), у автономного файла — встроен; разрешается только он
// (по хешу SHA-256), шрифты — встроенные (data:)
const cspRe = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/;
const csp = html.match(cspRe)?.[1];
if (!csp || !/script-src 'self'/.test(csp) || !/font-src 'self'/.test(csp)) throw new Error('index.html: не найдена политика CSP');
const jsHash = createHash('sha256').update(js, 'utf8').digest('base64');
const distCsp = csp.replace("script-src 'self'", `script-src 'sha256-${jsHash}'`).replace("font-src 'self'", 'font-src data:');

const full = pwaTags
  .reduce((h, t) => h.replace(t, ''), html)
  .replace(cspRe, () => `<meta http-equiv="Content-Security-Policy" content="${distCsp}">`)
  .replace(iconTag, () => `<link rel="icon" href="${iconData}" type="image/svg+xml">`)
  .replace(fontsTag, () => `<style>\n${fontsCss}</style>`)
  .replace(cssTag, () => `<style>\n${css}</style>`)
  .replace(jsTag, () => `<script>${js}</script>`);

await mkdir(new URL('dist/', root), { recursive: true });
await writeFile(new URL('dist/index.html', root), full);

const head = full.match(/<head>([\s\S]*?)<\/head>/)[1];
const body = full.match(/<body>([\s\S]*?)<\/body>/)[1];
const headKeep = head
  .split('\n')
  // политика CSP — только у полного документа: фрагмент встраивается в чужую страницу со своей политикой
  .filter((l) => !/<meta charset|<meta name="viewport"|<meta http-equiv="Content-Security-Policy"/.test(l))
  .join('\n');
await writeFile(new URL('dist/artifact.html', root), `${headKeep.trim()}\n${body.trim()}\n`);

console.log(`dist/index.html: ${(full.length / 1024).toFixed(0)} КБ`);
