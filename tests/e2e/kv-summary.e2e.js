// Вкладка «kV-рентген», лист «Сводка и протокол» (0.45.0): таблица мощности дозы «аппликатор × режим» (как форма
// «Сводная»), протокол измерений (как форма «Протокол измерений»): шапка, проверка выхода с решением о калибровке,
// итоги листов, заключение, подписи; печать протокола отдельно от рабочего листа; протокол текстом; по-английски и
// на телефоне.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, openPage, kvPage, CYR } from './helpers.js';

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

const rowsText = (page, sel) => page.locator(sel).evaluateAll((trs) => trs.map((tr) => tr.innerText.replace(/\s+/g, ' ').trim()));
const shownSections = (page) =>
  page.locator('#kv-sheet section.step').evaluateAll((secs) => secs.filter((s) => getComputedStyle(s).display !== 'none').map((s) => s.querySelector('.step-no')?.textContent.trim() ?? s.getAttribute('aria-labelledby')));

test('kV-рентген: лист «Сводка и протокол» — сводная таблица, протокол измерений, калибровка, печать протокола', async () => {
  const { ctx, page, errors } = await openPage(browser);
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const pause = (ms = 300) => page.waitForTimeout(ms);
  await page.goto(`${server.url}/index.html#kv/summary`);
  await page.waitForSelector('#kv-messages li');

  // пустая вкладка: таблицы нет и в печать она не идёт; в протоколе — «проверок пока нет»
  assert.match(await page.locator('#kv-svd').innerText(), /Пока нет строк аппликаторов с показаниями/);
  assert.match(await page.locator('#kv-prot').innerText(), /Проверок пока нет/);
  await page.emulateMedia({ media: 'print' });
  assert.ok(!(await shownSections(page)).includes('kv-sv1'));
  await page.emulateMedia({ media: 'screen' });

  // демонстрационный пример: средние энергии на 2 г/см² и на поверхности, режимы — столбцы
  await page.click('#kv-btn-sample');
  await pause();
  assert.deepEqual(await page.locator('#kv-svd h4').allInnerTexts(), ['Средние энергии — на глубине 2 г/см², Гр/мин', 'Средние энергии — на поверхности (по PDD(2 см)), Гр/мин']);
  assert.deepEqual(await rowsText(page, '#kv-svd .kv-svd-block:first-child tr'), [
    'Аппликатор 1 200 кВ, СПО 1,00 мм Cu 2 150 кВ, СПО 0,50 мм Cu',
    'Ø 10 см РИП 50 см 1,0010 +0,61 % 0,9140 +0,44 %',
    '6 × 8 см РИП 50 см 0,9425 +0,59 % 0,8620 +0,40 %',
    'Ø 15 см РИП 50 см 1,0475 +0,53 % —',
  ]);
  assert.deepEqual(await rowsText(page, '#kv-svd .kv-svd-block:last-child tbody tr'), ['Ø 10 см РИП 50 см 1,1298 1,0881', '6 × 8 см РИП 50 см 1,0846 1,0537', 'Ø 15 см РИП 50 см 1,1626 —']);

  // протокол: шапка, проверка выхода, итоги листов, заключение
  const head = await rowsText(page, '#kv-prot table.kv-prot-head tr');
  assert.deepEqual(head.slice(0, 5), ['Дата 15.09.2026', 'Учреждение Пример', 'Аппарат Рентгенотерапевтический аппарат (демо)', 'Вид измерения калибровка', 'Условия измерений T 21,0–21,8 °C; относительная влажность 44–45 %; P 100,40–100,50 кПа']);
  assert.match(head[5], /^Средства измерений камера PTW 30013 № \S+, электрометр .+ \(режимы 1, 2\) фантом: вода$/);
  assert.equal(head[6], 'Методика измерений TRS-398 Rev.1 (МАГАТЭ, 2024), разд. 9 (средние энергии)');
  assert.deepEqual(await page.locator('#kv-prot h4').allInnerTexts(), ['1. Проверка радиационного выхода (мощность дозы в воде)', '2. Слой половинного ослабления и kQ', '3. Ошибка таймера', '4. Линейность выхода', '5. Воспроизводимость выхода', 'Заключение', 'Примечания']);
  const out = await rowsText(page, '#kv-prot table.kv-prot-out tbody tr');
  assert.equal(out.length, 5);
  assert.equal(out[0], '1. 200 кВ, СПО 1,00 мм Cu Ø 10 см ст. 50 2 г/см² 0,9950 1,0010 ±2 +0,61 не требуется');
  assert.equal(out[4], '6 × 8 см 50 2 г/см² 0,8585 0,8620 ±2 +0,40 не требуется');
  assert.match(await page.locator('#kv-prot').innerText(), /Радиационный выход в допуске у всех аппликаторов с базовым значением: калибровка не требуется\./);

  // база строки 2 режима 1 ниже — отклонение больше допуска: требуется калибровка; номер строки открывает её
  await page.locator('#kv-svd .kv-svd-cell[data-m="0"][data-i="1"]').first().click();
  await pause();
  assert.equal(await page.getAttribute('#kv-pages a[aria-current]', 'data-kv-go'), 'dose');
  await page.fill('#kvr1_kv_ref', '0,9100');
  await pause();
  await kvPage(page, 'summary');
  assert.match(await page.locator('#kv-svd .kv-svd-block:first-child tbody tr:nth-child(2)').innerText(), /\+3,57 %/);
  assert.equal((await rowsText(page, '#kv-prot table.kv-prot-out tbody tr'))[1], '6 × 8 см 50 2 г/см² 0,9100 0,9425 ±2 +3,57 требуется');
  assert.match(await page.locator('#kv-prot').innerText(), /Радиационный выход вне допуска — требуется калибровка: режим 1, 6 × 8 см \(\+3,57 %\)\./);
  // допуск 4 % (раздел 8) — в допуске
  await kvPage(page, 'dose');
  await page.fill('#kv_tol', '4');
  await pause();
  await kvPage(page, 'summary');
  assert.equal((await rowsText(page, '#kv-prot table.kv-prot-out tbody tr'))[1], '6 × 8 см 50 2 г/см² 0,9100 0,9425 ±4 +3,57 не требуется');
  await kvPage(page, 'dose');
  await page.fill('#kv_tol', '2');
  await pause();
  await kvPage(page, 'summary');

  // методика и кто проверил — в протокол; подписи
  await page.fill('#kv_method', 'Методика учреждения');
  await page.fill('#kv_checker', 'Руководитель группы');
  await pause();
  assert.match((await rowsText(page, '#kv-prot table.kv-prot-head tr'))[6], /разд\. 9 \(средние энергии\); Методика учреждения$/);
  assert.deepEqual(await page.locator('#kv-prot table.kv-prot-sign th[scope="row"]').allInnerTexts(), ['Измерения провёл', 'Протокол проверил']);
  assert.equal(await page.locator('#kv-prot table.kv-prot-sign td.sig-name').nth(1).innerText(), 'Руководитель группы');

  // печать: рабочий лист — без протокола; протокол — только он
  await page.emulateMedia({ media: 'print' });
  const all = await shownSections(page);
  assert.ok(all.includes('kv-sv1') && all.includes('7') && !all.includes('kv-pr1'));
  await page.evaluate(() => document.body.classList.add('print-kv-protocol'));
  assert.deepEqual(await shownSections(page), ['kv-pr1']);
  assert.ok(await page.locator('#kv-readout').isHidden());
  assert.ok(await page.locator('#kv-btn-prot-print').isHidden());
  await page.evaluate(() => document.body.classList.remove('print-kv-protocol'));
  await page.emulateMedia({ media: 'screen' });

  // протокол текстом — проверка выхода по всем строкам
  await page.click('#kv-btn-copy-report');
  await pause();
  const report = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(report, /\nПроверка радиационного выхода \(D_изм\/D_баз − 1; допуск — по методике учреждения\):\n {2}Режим 1, Ø 10 см, РИП 50 см: D_баз 0,9950, D_изм 1,0010 Гр\/мин \(2 г\/см²\), отклонение \+0,61 % \(±2 %\); калибровка: не требуется\n {2}Режим 1, 6 × 8 см, РИП 50 см: D_баз 0,9100, D_изм 0,9425 Гр\/мин \(2 г\/см²\), отклонение \+3,57 % \(±2 %\); калибровка: требуется\n/);

  // по-английски — без русского текста (кроме введённого пользователем)
  await page.locator('#lang_en').check();
  await pause(600);
  const texts = (await page.locator('#kv-sheet section[data-kv-page="summary"]').allInnerTexts()).join('\n');
  const ru = texts.split('\n').filter((l) => CYR.test(l) && !/Методика учреждения|Руководитель группы|Пример|демо|Демонстрац/.test(l));
  assert.deepEqual(ru, []);
  assert.match(texts, /Calibration/);
  await page.locator('#lang_ru').check();
  await pause(300);
  assert.deepEqual(errors, []);
});

test('kV-рентген: лист «Сводка и протокол» на телефоне — без прокрутки страницы вбок', async () => {
  const { page, errors } = await openPage(browser, { mobile: true, viewport: { width: 390, height: 844 } });
  await page.goto(`${server.url}/index.html#kv/modes`);
  await page.waitForSelector('#kv-messages li');
  await page.click('#kv-btn-sample');
  await page.waitForTimeout(300);
  await kvPage(page, 'summary');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0);
  assert.ok(await page.locator('#kv-prot table.kv-prot-out').isVisible());
  assert.deepEqual(errors, []);
});
