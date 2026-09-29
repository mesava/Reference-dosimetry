// Сборка автономной версии: один HTML-файл со встроенными стилями и скриптом.
// dist/index.html    — полный документ, открывается двойным щелчком без интернета
//                      (шрифты тогда заменятся системными);
// dist/artifact.html — то же содержимое без обёртки <html>/<head>/<body>.
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (p) => readFile(new URL(p, root), 'utf8');

const html = await read('index.html');
const css = await read('src/ui/styles.css');
const bundle = await build({
  entryPoints: [new URL('src/ui/main.js', root).pathname],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  minify: true,
  write: false,
  legalComments: 'none',
});
const js = bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

const cssTag = '<link rel="stylesheet" href="src/ui/styles.css">';
const jsTag = '<script type="module" src="src/ui/main.js"></script>';
if (!html.includes(cssTag) || !html.includes(jsTag)) throw new Error('index.html: не найдены теги стилей или скрипта');

const full = html.replace(cssTag, () => `<style>\n${css}</style>`).replace(jsTag, () => `<script>${js}</script>`);

await mkdir(new URL('dist/', root), { recursive: true });
await writeFile(new URL('dist/index.html', root), full);

const head = full.match(/<head>([\s\S]*?)<\/head>/)[1];
const body = full.match(/<body>([\s\S]*?)<\/body>/)[1];
const headKeep = head
  .split('\n')
  .filter((l) => !/<meta charset|<meta name="viewport"/.test(l))
  .join('\n');
await writeFile(new URL('dist/artifact.html', root), `${headKeep.trim()}\n${body.trim()}\n`);

console.log(`dist/index.html: ${(full.length / 1024).toFixed(0)} КБ`);
