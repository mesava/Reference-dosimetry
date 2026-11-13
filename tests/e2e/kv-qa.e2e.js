// Вкладка «kV-рентген», листы «Линейность» и «Воспроизводимость» (0.44.0): задания и показания выбранного режима,
// X = M̄/Q, отклонение от пропорциональности к первому заданию, CL всех пар; следующая строка задания появляется, когда
// заполнена предыдущая; R = |1 − K_min/K_max| и s/M̄; допуски по методике учреждения; таблицы по всем режимам (номер
// открывает режим); протокол; пустые листы не печатаются; по-английски и на телефоне.
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

const ln = (page, k) => page.locator(`#kv-sheet [data-ln="${k}"]`).innerText();
const rp = (page, k) => page.locator(`#kv-sheet output[data-rp="${k}"]`).innerText();
const state = (page, k) => page.getAttribute(`#kv-pages a[data-kv-go="${k}"]`, 'data-state');
const rowsText = (page, id) => page.locator(`${id} tr`).evaluateAll((trs) => trs.map((tr) => tr.innerText.replace(/\s+/g, ' ').trim()));
const fillCells = async (page, series, vals) => {
  const cells = page.locator(`#kv-sheet .cells[data-series="${series}"] input`);
  for (let i = 0; i < vals.length; i++) await cells.nth(i).fill(vals[i]);
};

test('kV-рентген: листы «Линейность» и «Воспроизводимость» — расчёт, допуски, таблицы по режимам, протокол', async () => {
  const { ctx, page, errors } = await openPage(browser);
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const pause = (ms = 300) => page.waitForTimeout(ms);
  await page.goto(`${server.url}/index.html#kv/linearity`);
  await page.waitForSelector('#kv-messages li');

  // пустой лист: две строки заданий, выводов нет; в печать не идёт
  assert.deepEqual(await page.locator('#kv-sheet [data-ln-row]').evaluateAll((rs) => rs.map((r) => !r.hidden)), [true, true, false, false, false]);
  // задания Q — в своей единице, по умолчанию Гр (0.58.0), хотя облучение задаётся в минутах
  assert.equal(await page.inputValue('#kv_set_unit'), 'min');
  assert.equal(await page.locator('#kv-ln-q1-lbl').innerText(), 'Задание Q₁, Гр');
  await page.selectOption('#kv_ln_unit', 'min');
  await pause();
  assert.equal(await page.locator('#kv-ln-q1-lbl').innerText(), 'Задание Q₁, мин');
  await page.selectOption('#kv_ln_unit', 'Gy');
  await pause();
  assert.equal(await ln(page, 'dmax'), '—');
  assert.ok(await page.locator('#kv-ln-cl-box').isHidden());
  await page.emulateMedia({ media: 'print' });
  assert.ok(await page.locator('section[aria-labelledby="kv-ln1"]').isHidden());
  await page.emulateMedia({ media: 'screen' });

  // свои задания в Гр: 0,5 и 2 Гр — отклонение K₂/(4·K₁) − 1, третья строка появляется после второй
  await kvPage(page, 'dose');
  await page.selectOption('#kv_set_unit', 'Gy');
  await kvPage(page, 'linearity');
  assert.equal(await page.locator('#kv-ln-q1-lbl').innerText(), 'Задание Q₁, Гр');
  await page.fill('#kv_ln_q1', '0,5');
  await fillCells(page, 'kv_ln_M1', ['0,4994', '0,4994', '0,4994']);
  await page.fill('#kv_ln_q2', '2');
  await fillCells(page, 'kv_ln_M2', ['2,026', '2,026', '2,026']);
  await pause();
  assert.ok(await page.locator('#kv-sheet [data-ln-row="2"]').isVisible());
  assert.ok(await page.locator('#kv-sheet [data-ln-row="3"]').isHidden());
  assert.equal(await ln(page, 'X0'), '0,99880');
  assert.equal(await ln(page, 'd0'), 'опорное');
  assert.equal(await ln(page, 'X1'), '1,0130');
  assert.equal(await ln(page, 'd1'), '+1,42 %');
  assert.equal(await ln(page, 'dmax'), '1,42 %');
  assert.equal(await ln(page, 'dmax-at'), 'задание 2 к заданию 1');
  assert.equal(await ln(page, 'clmax'), '0,0071');
  assert.ok(await page.locator('#kv-ln-cl-box').isHidden());
  assert.equal(await state(page, 'linearity'), 'done');
  // допуск 1 % — предупреждение, лист с предупреждением
  await page.fill('#kv_ln_tol', '1');
  await pause();
  assert.match(await page.locator('#kv-messages').innerText(), /ЛИНЕЙНОСТЬ · ВНИМАНИЕ\s+Отклонение от пропорциональности 1,42 % \(задание 2 к заданию 1\) больше допуска 1 % по методике учреждения\./i);
  assert.ok(await page.locator('#kv-sheet output[data-ln="dmax"]').evaluate((el) => el.classList.contains('flag-warn')));
  assert.equal(await state(page, 'linearity'), 'warn');
  await page.fill('#kv_ln_tol', '2');
  // третье задание — CL всех пар
  await page.fill('#kv_ln_q3', '1');
  await fillCells(page, 'kv_ln_M3', ['1,008']);
  await pause();
  assert.equal(await ln(page, 'clmax'), '0,0071');
  assert.equal(await ln(page, 'clmax-at'), 'задания 1 и 2');
  await page.click('#kv-ln-cl-box summary');
  assert.deepEqual(await rowsText(page, '#kv-ln-cl'), ['1 – 2 0,0071', '1 – 3 0,0046', '2 – 3 0,0025']);
  // задание без показаний — ошибка
  await page.fill('#kv_ln_q4', '1,5');
  await pause();
  assert.match(await page.locator('#kv-messages').innerText(), /Задание 4: нет показаний\./);
  assert.equal(await state(page, 'linearity'), 'error');
  await page.fill('#kv_ln_q4', '');
  await pause();
  assert.deepEqual(await rowsText(page, '#kv-lnq-body'), ['1 пучок не задан 0,5; 2; 1 Гр 1,42 % 0,0071']);

  // воспроизводимость: R и s/M̄, малая серия — справка, допуск
  await kvPage(page, 'repro');
  await fillCells(page, 'kv_rp_M', ['1,322', '1,315', '1,32', '1,322', '1,322']);
  await pause();
  assert.equal(await rp(page, 'min'), '1,3150');
  assert.equal(await rp(page, 'max'), '1,3220');
  assert.equal(await rp(page, 'R'), '0,53 %');
  assert.equal(await state(page, 'repro'), 'done');
  await page.fill('#kv_rp_tol', '0,5');
  await pause();
  assert.match(await page.locator('#kv-messages').innerText(), /Воспроизводимость \|1 − Kmin\/Kmax\| = 0,53 % больше допуска 0,5 %/);
  assert.equal(await state(page, 'repro'), 'warn');
  await page.fill('#kv_rp_tol', '2');
  await pause();

  // демонстрационный пример: два режима, номер в таблице открывает режим
  await page.click('#kv-btn-sample');
  await pause();
  const rows = await rowsText(page, '#kv-rpq-body');
  assert.deepEqual(rows, ['1 200 кВ, СПО 1,00 мм Cu 5 4,5116 4,5080 – 4,5150 0,16 % 0,06 %', '2 150 кВ, СПО 0,50 мм Cu 5 3,8710 3,8680 – 3,8740 0,15 % 0,06 %']);
  await page.locator('#kv-rpq-body .kv-qa-pick').nth(1).click();
  await pause();
  assert.equal(await page.locator('#kv-modebar-list [data-m="1"]').getAttribute('aria-pressed'), 'true');
  assert.match(await rp(page, 'mean'), /^3,8710 n = 5$/);
  await kvPage(page, 'linearity');
  assert.deepEqual(await rowsText(page, '#kv-lnq-body'), ['1 200 кВ, СПО 1,00 мм Cu 0,5; 1; 2 мин 1,50 % 0,0076', '2 150 кВ, СПО 0,50 мм Cu 0,5; 1; 2 мин 1,52 % 0,0077']);
  assert.equal(await ln(page, 'd2'), '−1,52 % u 0,03 %');
  await page.locator('#kv-lnq-body .kv-qa-pick').first().click();
  await pause();
  assert.equal(await page.locator('#kv-modebar-list [data-m="0"]').getAttribute('aria-pressed'), 'true');

  // протокол
  await page.click('#kv-btn-copy-report');
  await pause();
  const report = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(report, /\nЛинейность по режимам \(не TRS-398 Rev\.1 — по методике учреждения\):\n {2}Режим 1 \(200 кВ, СПО 1,00 мм Cu\) \(аппликатор Ø 10 см\): Q₁ = 0,5 мин: 11,08; 11,09; 11,09; Q₂ = 1 мин: 21,95; 21,96; 21,95; Q₃ = 2 мин: 43,67; 43,68; 43,69; отклонение от пропорциональности до 1,50 % \(задание 3 к заданию 1\), CL до 0,0076 \(задания 1 и 3\)\n/);
  assert.match(report, /\n {2}Допуски \(по методике учреждения\): отклонение ≤ 2 %\.\n/);
  assert.match(report, /\nВоспроизводимость по режимам \(не TRS-398 Rev\.1 — по методике учреждения\):\n {2}Режим 1 \(200 кВ, СПО 1,00 мм Cu\) \(аппликатор Ø 3 см, 20 см от аппликатора\): 4,512; 4,508; 4,515; 4,510; 4,513; R = \|1 − K_min\/K_max\| = 0,16 %, s\/M̄ = 0,06 %\n/);
  assert.match(report, /\n {2}Допуск \(по методике учреждения\): R ≤ 2 %\.\n/);

  // по-английски — листы без русского текста
  await page.locator('#lang_en').check();
  await pause(600);
  for (const k of ['linearity', 'repro']) {
    await kvPage(page, k);
    const texts = await page.locator(`#kv-sheet section[data-kv-page="${k}"], #kv-messages, #kv-pages, #module-kv-secnav`).allInnerTexts();
    assert.deepEqual(texts.join('\n').split('\n').filter((l) => CYR.test(l)), []);
  }
  assert.equal(await page.locator('#kv-ln-q1-lbl').innerText(), 'Setting Q₁, min');
  await page.locator('#lang_ru').check();
  await pause(300);
  assert.deepEqual(errors, []);
});

test('kV-рентген: листы «Линейность» и «Воспроизводимость» на телефоне — без прокрутки страницы вбок', async () => {
  const { page, errors } = await openPage(browser, { mobile: true, viewport: { width: 390, height: 844 } });
  await page.goto(`${server.url}/index.html#kv/modes`);
  await page.waitForSelector('#kv-messages li');
  await page.click('#kv-btn-sample');
  await page.waitForTimeout(300);
  for (const k of ['linearity', 'repro']) {
    await kvPage(page, k);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0);
  }
  // строка таблицы воспроизводимости — в ширину экрана
  const fits = await page.locator('#kv-rpq-body tr').first().evaluate((tr) => [...tr.children].every((td) => td.getBoundingClientRect().right <= tr.getBoundingClientRect().right + 1));
  assert.ok(fits);
  assert.deepEqual(errors, []);
});
