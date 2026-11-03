// Вкладка «kV-рентген», раздел 4 «Аппликаторы»: строка на тубус со своими T, P и показаниями, выбор строки (её поля
// в разделах ниже и итог справа), ввод в таблице и в разделах формы, добавление и удаление строк, k_pol из строки 1,
// файл формата 3 и старый файл как одна строка, черновик, протокол со списком строк; по-английски без кириллицы.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startServer, launch, openPage, kvPage } from './helpers.js';
import { SAMPLE_KV } from '../../src/core/sample-kv.js';

let server;
let browser;
before(async () => {
  server = await startServer();
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await server?.close();
});

// все листы вкладки сразу: скрытые листы innerText не видит
const cyrLines = async (page) => {
  const cur = await page.getAttribute('#kv-pages a[aria-current]', 'data-kv-go');
  await page.evaluate(() => document.querySelectorAll('#kv-sheet .page-off').forEach((e) => e.classList.remove('page-off')));
  const lines = (await page.locator('#kv-sheet, #kv-readout').evaluateAll((els) => els.map((e) => e.innerText).join('\n')))
    .split('\n')
    .filter((l) => /[А-Яа-яЁё]/.test(l) && !/Загружен демонстрационный пример/.test(l));
  await kvPage(page, cur);
  return lines;
};

test('kV-рентген: таблица аппликаторов — строки, выбор строки, файл, черновик, протокол; по-английски', async () => {
  const { ctx, page, errors } = await openPage(browser);
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const pause = (ms = 300) => page.waitForTimeout(ms);
  const rows = page.locator('#kv-rows-body tr');
  const cell = (i, o) => page.locator(`#kv-rows-body tr[data-i="${i}"] [data-o="${o}"]`).innerText();

  await page.goto(`${server.url}/index.html#kv/dose`);
  await page.waitForSelector('#kv-messages li');
  assert.equal(await page.getAttribute('#kv-pages a[aria-current]', 'data-kv-go'), 'dose');
  assert.ok(await page.locator('#kv-s4').isVisible());
  assert.ok(await page.locator('#kv-s1').isHidden());
  // пустая вкладка — одна пустая строка, удалить её нельзя; номера строки у полей нет
  assert.equal(await rows.count(), 1);
  assert.ok(await page.locator('#kv-rows-body .kv-row-del').isDisabled());
  assert.ok(await page.locator('#kv-row-of').isHidden());
  assert.equal(await page.locator('label[for="kv_env_T"]').getAttribute('data-row'), null);

  // пример: три тубуса 200 кВ, у каждого свои T, P и показания; k_pol строк 2 и 3 — из строки 1
  await page.click('#kv-btn-sample');
  await pause();
  assert.equal(await rows.count(), 3);
  assert.deepEqual([await cell(0, 'd'), await cell(1, 'd'), await cell(2, 'd')], ['1,0012', '0,9425', '1,0475']);
  assert.deepEqual([await cell(0, 'dev'), await cell(1, 'dev'), await cell(2, 'dev')], ['+0,62', '+0,59', '+0,53']);
  assert.equal(await cell(1, 'ktp'), '1,0130');
  assert.equal(await page.locator('#kv-rows-h-d').innerText(), 'D, Гр/мин');
  assert.match(await page.locator('#kv-rows-note').innerText(), /kpol строк без серии при обратной полярности — из строки 1 \(Ø 10 см\)/);
  // стандартный тубус (табл. 31) — Ø 10 см, метка «ст.»; остальные — нестандартные условия по разд. 9.5
  assert.ok(await page.locator('#kv-rows-body tr[data-i="0"] .kv-std').isVisible());
  assert.equal(await page.locator('#kv-rows-body tr[data-i="0"] .kv-std').innerText(), 'ст.');
  assert.ok(await page.locator('#kv-rows-body tr[data-i="1"] .kv-std').isHidden());
  assert.match(await page.locator('#kv-rows-note').innerText(), /Стандартный тубус \(табл\. 31\) — строка 1 \(Ø 10 см\), метка «ст\.»: по нему референсная доза\. Тубусы, отличающиеся от него только полем, — измерения в нестандартных условиях \(TRS-398 Rev\.1, разд\. 9\.5\)/);
  assert.match(await page.locator('#kv-compliance').innerText(), /^Референсные условия: отступлений/);
  assert.equal(await page.locator('#kv-rows-body tr[data-i="1"] .st').getAttribute('class'), 'st ok');
  assert.match(await page.locator('#kv-row-of').innerText(), /^Режим 1 из 2 · 200 кВ, СПО 1,00 мм Cu · Строка 1 из 3 · Ø 10 см · РИП 50 см · стандартный тубус$/);
  assert.equal(await page.locator('label[for="kv_env_T"]').getAttribute('data-row'), ' · строка 1');

  // ввод в строку 2 выбирает её: поля разделов — её, итог справа — по ней
  await page.click('#kvr1_kv_env_T');
  await pause();
  assert.match(await page.locator('#kv-row-of').innerText(), /^Режим 1 из 2 · 200 кВ, СПО 1,00 мм Cu · Строка 2 из 3 · 6 × 8 см · РИП 50 см$/);
  const comp = await page.locator('#kv-compliance').innerText();
  assert.match(comp, /^Тубус не стандартный: измерение в нестандартных условиях \(TRS-398 Rev\.1, разд\. 9\.5\); референсная доза — по стандартному тубусу, строка 1 \(Ø 10 см\)/);
  assert.match(comp, /поле 6 × 8 см вместо 10 × 10 см или Ø 10 см/);
  assert.doesNotMatch(comp, /Нестандартные условия/);
  assert.equal(await page.locator('#kv-compliance').getAttribute('class'), 'compliance nonref');
  assert.equal(await page.locator('#kvr1_kv_cone_shape').inputValue(), 'rect');
  assert.equal(await page.inputValue('#kv_cone_shape'), 'rect');
  assert.equal(await page.inputValue('#kv_cone_b'), '8');
  assert.equal(await page.inputValue('#kv_env_T'), '21,4');
  assert.equal(await page.locator('label[for="kv_env_T"]').getAttribute('data-row'), ' · строка 2');
  assert.match(await page.locator('#kv-dose-rows').innerText(), /0,9425\s*Гр\/мин на 2 г\/см²/);
  assert.match(await page.locator('#kv-messages').innerText(), /k_?pol = 0,9995 взят из строки 1 \(Ø 10 см\)/);
  await page.fill('#kvr1_kv_env_T', '23,0');
  await pause();
  assert.equal(await page.inputValue('#kv_env_T'), '23,0');
  assert.equal(await cell(1, 'd'), '0,9476');
  assert.equal(await cell(0, 'd'), '1,0012');
  // поле раздела формы — в таблицу
  await page.fill('#kv_env_P', '100,9');
  await pause();
  assert.equal(await page.inputValue('#kvr1_kv_env_P'), '100,9');
  await page.fill('#kv_env_P', '100,5');
  await page.fill('#kvr1_kv_env_T', '21,4');
  await pause();
  assert.equal(await cell(1, 'd'), '0,9425');
  // номер строки: строка 1 снова подробно
  await page.click('#kv-rows-body tr[data-i="0"] .kv-row-pick');
  await pause();
  assert.equal(await page.inputValue('#kv_env_T'), '21,0');
  assert.equal(await page.locator('#kv-rows-body tr[data-i="0"] .kv-row-pick').getAttribute('aria-pressed'), 'true');

  // новая строка: РИП, задание, T и P — из последней; пустая удаляется сразу
  await page.click('#kv-btn-add-row');
  await pause();
  assert.equal(await rows.count(), 4);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'kvr3_kv_cone');
  assert.equal(await page.inputValue('#kvr3_kv_env_T'), '21,8');
  assert.equal(await page.inputValue('#kv_cone'), '');
  assert.equal(await page.locator('#kv-rows-body tr[data-i="3"] .st').getAttribute('class'), 'st empty');
  await page.click('#kv-rows-body tr[data-i="3"] .kv-row-del');
  await pause();
  assert.equal(await rows.count(), 3);
  // строка с данными — вторым нажатием
  await page.click('#kv-rows-body tr[data-i="2"] .kv-row-del');
  await pause(150);
  assert.equal(await rows.count(), 3);
  assert.match(await page.locator('#kv-status').innerText(), /нажмите × ещё раз/);
  await page.click('#kv-rows-body tr[data-i="2"] .kv-row-del');
  await pause();
  assert.equal(await rows.count(), 2);

  // удалили выбранную строку — подробно соседняя (строка 2)
  assert.match(await page.locator('#kv-row-of').innerText(), / · Строка 2 из 2 · /);
  assert.equal(await page.inputValue('#kv_env_T'), '21,4');

  // протокол: список строк и подробно — выбранная
  await page.click('#kv-btn-copy-report');
  await pause();
  const report = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(report, /Режимы аппарата \(2\); подробно ниже — режим 1, строка 2:\nРежим 1: 200 кВ, 10 мА, СПО 1,00 мм Cu, фильтр 0,5 мм Cu \+ 1 мм Al; камера 1 \(PTW 30013 № 0000\)\n {2}1\. Ø 10 см \(стандартный тубус\), РИП 50 см; T = 21,0 °C, P = 100,5 кПа; M₁ 21,95; 21,96; 21,95 нКл; k_TP = 1,0116; D = 1,0012 Гр\/мин на 2 г\/см², отклонение \+0,62 %\n {2}2\. 6 × 8 см, РИП 50 см; .*D = 0,9425 Гр\/мин на 2 г\/см², отклонение \+0,59 % \(k_pol из строки 1 \(Ø 10 см\)\)/);

  assert.match(report, /Условия: T = 21,4 °C/);
  assert.match(report, /\nТубус не стандартный: измерение в нестандартных условиях \(TRS-398 Rev\.1, разд\. 9\.5\); референсная доза — по стандартному тубусу, строка 1 \(Ø 10 см\): поле 6 × 8 см/);
  assert.doesNotMatch(report, /НЕСТАНДАРТНЫЕ УСЛОВИЯ/);
  assert.match(report, /M\(V1, обратная\): в этой строке не измерялось; k_pol из строки 1 \(Ø 10 см\)/);

  // файл формата 3: режимы со строками, выбранная строка и итоги строк; открывается со сверкой по выбранной строке
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#kv-btn-save')]);
  const saved = JSON.parse(await readFile(await download.path(), 'utf8'));
  assert.equal(saved.version, 3);
  assert.equal(saved.modes.length, 2);
  assert.equal(saved.modes[0].rows.length, 2);
  assert.equal(saved.modes[0].active, 1);
  assert.equal(saved.form.kv_cone_shape, 'rect');
  assert.deepEqual(saved.modeResults.map((m) => m.length), [2, 2]);
  assert.ok(Math.abs(saved.result.value - 0.9425) < 1e-4);
  await page.click('#kv-btn-clear');
  await page.click('#kv-btn-clear');
  await pause();
  assert.equal(await rows.count(), 1);
  await page.setInputFiles('#kv-file-input', await download.path());
  await pause();
  assert.equal(await rows.count(), 2);
  assert.match(await page.locator('#kv-row-of').innerText(), / · Строка 2 из 2 · /);
  assert.match(await page.locator('#kv-file-note').innerText(), /совпадает с сохранённым итогом/);
  await page.click('#kv-rows-body tr[data-i="0"] .kv-row-pick');
  await pause();
  // строка 1 сверяется со своим итогом в файле (с итогом строки 2 она бы не совпала)
  assert.match(await page.locator('#kv-file-note').innerText(), /совпадает с сохранённым итогом/);

  // черновик: после перезагрузки те же строки и выбранная строка; лист тот же
  await page.reload();
  await page.waitForSelector('#kv-messages li');
  assert.ok(await page.locator('#kv-s4').isVisible());
  assert.equal(await rows.count(), 2);
  assert.match(await page.locator('#kv-row-of').innerText(), / · Строка 1 из 2 · /);
  assert.equal(await page.inputValue('#kvr1_kv_cone_b'), '8');

  // файл 0.35 (формат 1, одна форма) — одна строка с тем же итогом
  const old = { app: 'reference-dosimetry', module: 'kv', version: 1, form: SAMPLE_KV };
  await page.setInputFiles('#kv-file-input', { name: 'old.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(old)) });
  await pause();
  assert.equal(await rows.count(), 1);
  assert.equal(await cell(0, 'd'), '1,0012');
  assert.ok(await page.locator('#kv-row-of').isHidden());

  // по-английски — без кириллицы, таблица тоже
  await page.click('#kv-btn-sample');
  await page.locator('#lang_en').check();
  await pause(600);
  assert.deepEqual(await cyrLines(page), []);
  assert.equal(await page.locator('#kv-rows-h-d').innerText(), 'D, Gy/min');
  assert.equal(await page.inputValue('#kvr1_kv_env_T'), '21.4');
  assert.match(await page.locator('#kv-rows-note').innerText(), /taken from row 1 \(Ø 10 cm\)/);
  assert.match(await page.locator('#kv-row-of').innerText(), /^Mode 1 of 2 · 200 kV, HVL 1.00 mm Cu · Row 1 of 3 · Ø 10 cm · SSD 50 cm · reference applicator$/);
  assert.equal(await page.locator('#kv-rows-body tr[data-i="0"] .kv-std').innerText(), 'ref.');
  await page.click('#kv-rows-body tr[data-i="1"] .kv-row-pick');
  await pause();
  assert.match(await page.locator('#kv-compliance').innerText(), /^Non-reference applicator: a measurement under non-reference conditions \(TRS-398 Rev\.1, Sec\. 9\.5\)/);
  assert.deepEqual(await cyrLines(page), []);
  await page.locator('#lang_ru').check();
  await pause(300);
  assert.deepEqual(errors, []);
});

test('kV-рентген: таблица аппликаторов на телефоне — карточки без горизонтальной прокрутки страницы', async () => {
  const { page, errors } = await openPage(browser, { mobile: true, viewport: { width: 390, height: 844 } });
  await page.goto(`${server.url}/index.html#kv/dose`);
  await page.waitForSelector('#kv-messages li');
  await page.click('#kv-btn-sample');
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0);
  assert.equal(await page.locator('#kv-rows thead').isVisible(), false);
  const cap = await page.locator('#kv-rows-body tr[data-i="1"] [data-o="d"]').evaluate((e) => getComputedStyle(e, '::before').content);
  assert.equal(cap, '"D, Гр/мин"');
  assert.deepEqual(errors, []);
});
