// «Журнал» → «Оборудование»: учреждение и подразделение, порядок разделов, выбор электрометра и камеры по
// производителю и модели, сведения о калибровке камеры и замечания у пучка; камеры отделения в списке камер вкладки.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, openPage } from './helpers.js';

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

const CYR = /[А-Яа-яЁё]/;

test('оборудование: подразделение, производитель → модель, калибровка камеры, камеры отделения во вкладке', async () => {
  const { page, errors } = await openPage(browser);
  await page.goto(`${server.url}/index.html#equipment`);
  await page.waitForSelector('#eq_department');
  const pause = () => page.waitForTimeout(250);

  // порядок разделов: учреждение, аппараты и пучки, электрометры, камеры
  const heads = await page.locator('#eq-sheet .step h2').allInnerTexts();
  assert.deepEqual(heads, ['Учреждение', 'Аппараты и пучки', 'Электрометры', 'Камеры']);

  await page.fill('#eq_institution', 'ООО Пример');
  await page.fill('#eq_department', 'Отделение лучевой терапии');
  // аппарат и пучок раньше камер и электрометров: выбранные позже, они достаются пучку сами
  await page.click('#eq-add-machine');
  await pause();
  await page.locator('[data-card^="machine:"] input[data-bind$="|name"]').fill('Versa HD');
  await page.locator('[data-add-beam]').click();
  await pause();
  await page.locator('[data-card^="beam:"] input[data-bind$="|name"]').fill('6 МВ');

  // электрометры: производитель → модель; «Другой» — своё название
  await page.click('#eq-add-electrometer');
  await pause();
  const el1 = page.locator('[data-card^="electrometer:"]').nth(0);
  await el1.locator('select[data-bind$="|maker"]').selectOption('PTW');
  await pause();
  await el1.locator('select[data-bind$="|form.el_model"]').selectOption('PTW UNIDOS Tango');
  await pause();
  await page.click('#eq-add-electrometer');
  await pause();
  const el2 = page.locator('[data-card^="electrometer:"]').nth(1);
  await el2.locator('select[data-bind$="|maker"]').selectOption('other');
  await pause();
  await el2.locator('input[data-bind$="|form.el_model"]').fill('Самодельный ЭМ-1');
  await pause();

  // камера: производитель → модель, размеры из базы
  await page.click('#eq-add-chamber');
  await pause();
  const ch = page.locator('[data-card^="chamber:"]');
  await ch.locator('select[data-bind$="|maker"]').selectOption('PTW');
  await pause();
  await ch.locator('select[data-bind$="|form.ch_model"]').selectOption('PTW30013');
  await pause();
  assert.match(await ch.innerText(), /из базы: радиус полости 3,05 мм/);
  await ch.locator('input[data-bind$="|form.ch_serial"]').fill('739475');
  await ch.locator('input[data-bind$="|form.ch_ndw"]').fill('0,05235');
  await ch.locator('input[data-bind$="|calCert"]').fill('123');
  // камеру калибровали со вторым электрометром при −400 В
  const el2id = (await el2.getAttribute('data-card')).split(':')[1];
  await ch.locator('select[data-bind$="|calEl"]').selectOption(el2id);
  await pause();
  await ch.locator('input[data-bind$="|calV"]').fill('400');
  await ch.locator('input[data-bind$="|calV"]').press('Tab');
  await pause();
  await ch.locator('select[data-bind$="|calPol"]').selectOption('-');
  await pause();

  // пучку достались камера и первый электрометр; замечания о калибровке видны и у свёрнутого пучка
  const beam = page.locator('details[data-card^="beam:"]');
  assert.match(await beam.locator('summary').innerText(), /PTW 30013 № 739475/);
  assert.match(await beam.locator('summary').innerText(), /калибровка камеры: см\. замечание/);
  const notes = await beam.locator('.jbeam-cal').textContent();
  assert.match(notes, /калибровалась с электрометром Самодельный ЭМ-1, а выбран PTW UNIDOS Tango/);
  assert.match(notes, /V₁ = 300 В отличается от напряжения калибровки камеры 400 В/);
  assert.match(notes, /Полярность измерения \(\+\) не та/);
  // сводка оборудования аппарата
  assert.match(await page.locator('.jmachine-eq').innerText(), /PTW 30013 № 739475: 6 МВ/);

  // вкладка «МВ фотоны»: камеры отделения в начале списка камер; выбор подставляет запись журнала
  await page.goto(`${server.url}/index.html#photons`);
  await page.waitForSelector('#messages li');
  await page.waitForSelector('#ch_model optgroup[data-jl-group] option', { state: 'attached' });
  const opt = page.locator('#ch_model optgroup[data-jl-group] option').first();
  assert.match(await opt.textContent(), /PTW 30013 № 739475/);
  await page.selectOption('#ch_model', await opt.getAttribute('value'));
  await page.waitForTimeout(500);
  assert.equal(await page.inputValue('#ch_model'), 'PTW30013');
  assert.equal(await page.inputValue('#ch_serial'), '739475');
  assert.equal(await page.inputValue('#ch_ndw'), '0,05235');
  assert.match(await page.locator('#ph-jlink').innerText(), /как в журнале/);

  // по-английски — без кириллицы в карточках оборудования (кроме введённых названий)
  await page.goto(`${server.url}/index.html#equipment`);
  await page.locator('#lang_en').check();
  await page.waitForTimeout(500);
  const card = (await page.locator('[data-card^="chamber:"]').innerText()).split('\n').filter((l) => CYR.test(l) && !/739475|ЭМ-1/.test(l));
  assert.deepEqual(card, []);
  assert.deepEqual(errors, []);
});

test('оборудование на телефоне: страница не шире экрана (длинные отметки «не заполнено» переносятся)', async () => {
  const { page, errors } = await openPage(browser, { viewport: { width: 360, height: 800 } });
  await page.goto(`${server.url}/index.html#equipment`);
  await page.waitForSelector('#eq_department');
  await page.click('#eq-add-machine');
  await page.waitForTimeout(250);
  await page.locator('[data-add-beam]').click();
  await page.locator('[data-add-ebeam]').click();
  await page.click('#eq-add-electrometer');
  await page.click('#eq-add-chamber');
  await page.waitForTimeout(400);
  for (const d of await page.locator('details[data-card^="beam:"]').all()) if (!(await d.getAttribute('open'))) await d.locator('summary').click();
  await page.waitForTimeout(250);
  for (const h of ['equipment', 'session', 'history', 'photons', 'electrons', 'co60']) {
    if (h !== 'equipment') await page.goto(`${server.url}/index.html#${h}`);
    await page.waitForTimeout(500);
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(sw <= 360, `${h}: ширина страницы ${sw} px при экране 360 px`);
  }
  assert.deepEqual(errors, []);
});
