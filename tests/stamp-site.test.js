// Номер версии в адресах модулей сайта при выкладке (scripts/stamp-site.mjs, 0.58.1): помечаются все относительные
// импорты всех модулей src/ — и только они; число импортов сверяется с разбором esbuild.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { stampImports, relativeImports } from '../scripts/stamp-site.mjs';

const root = new URL('../', import.meta.url);

test('stamp-site: все относительные импорты получают ?v=, строки в коде не трогаются', async () => {
  assert.equal(stampImports(`import { a } from './a.js';\nimport {\n  b,\n} from "../core/b.js";\nconst s = 'from "x"';`, '1.2.3'),
    `import { a } from './a.js?v=1.2.3';\nimport {\n  b,\n} from "../core/b.js?v=1.2.3";\nconst s = 'from "x"';`);
  // разбор esbuild: импорты каждого модуля сайта совпадают с найденными (ни один не пропущен)
  const r = await build({ entryPoints: [fileURLToPath(new URL('src/ui/app.js', root))], bundle: true, write: false, metafile: true, format: 'esm', logLevel: 'silent' });
  const inputs = Object.entries(r.metafile.inputs);
  assert.ok(inputs.length > 50);
  for (const [path, info] of inputs) {
    const code = readFileSync(new URL(path, root), 'utf8');
    const found = relativeImports(code);
    assert.equal(found.length, info.imports.length, path);
    const stamped = stampImports(code, '9.9.9');
    assert.deepEqual(relativeImports(stamped), found, path);
    assert.equal((stamped.match(/\?v=9\.9\.9/g) || []).length, found.length, path);
  }
});
