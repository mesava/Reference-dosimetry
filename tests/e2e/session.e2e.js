// «Дозиметрия» → «Сеанс»: пучки аппарата подряд — выбор аппарата, даты и пучков, полоса сеанса во вкладке,
// «Записать и далее», итог сеанса по записям журнала.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, openPage, CYR } from './helpers.js';

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

test('сеанс: два пучка фотонов подряд записываются в одну запись журнала', async () => {
  const { page, errors } = await openPage(browser);
  const pause = (ms = 300) => page.waitForTimeout(ms);
  // «Начало»: «Дозиметрия» — один пучок и сеанс; лишней кнопки «Измерение во вкладке дозиметрии» нет
  await page.goto(`${server.url}/index.html#start`);
  await page.waitForSelector('#start-root .start-card');
  const start = await page.locator('#start-root').innerText();
  assert.doesNotMatch(start, /Измерение во вкладке дозиметрии|Калибровка одного пучка/);
  assert.match(start, /Дозиметрия[\s\S]*Сеанс — пучки аппарата/);
  // без журнала сеанс отправляет в «Оборудование»
  await page.goto(`${server.url}/index.html#session`);
  await pause();
  assert.match(await page.locator('#session-root').innerText(), /нужны аппарат и его пучки в журнале/);
  // подвкладки «Дозиметрии»: «Сеанс» — в конце
  assert.deepEqual((await page.locator('#module-session .subtools a').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim()), ['⁶⁰Co', 'МВ фотоны', 'Электроны', 'kV-рентген в разработке', 'Брахитерапия в разработке', 'Сеанс']);

  // оборудование: аппарат с двумя пучками, электрометр, камера
  await page.goto(`${server.url}/index.html#equipment`);
  await page.waitForSelector('#eq_department');
  await page.click('#eq-add-machine');
  await pause();
  await page.locator('[data-card^="machine:"] input[data-bind$="|name"]').fill('Versa HD');
  for (const name of ['6 МВ', '10 МВ']) {
    await page.locator('[data-add-beam]').click();
    await pause();
    await page.locator('[data-card^="beam:"] input[data-bind$="|name"]').last().fill(name);
  }
  await page.click('#eq-add-electrometer');
  await pause();
  await page.locator('[data-card^="electrometer:"] select[data-bind$="|maker"]').selectOption('PTW');
  await pause();
  await page.click('#eq-add-chamber');
  await pause();
  const ch = page.locator('[data-card^="chamber:"]');
  await ch.locator('select[data-bind$="|maker"]').selectOption('PTW');
  await pause();
  await ch.locator('select[data-bind$="|form.ch_model"]').selectOption('PTW30013');
  await pause();
  await ch.locator('input[data-bind$="|form.ch_serial"]').fill('47364');
  await ch.locator('input[data-bind$="|form.ch_ndw"]').fill('0,05235');
  await pause();
  // показания и условия во вкладке — из примера
  await page.goto(`${server.url}/index.html#photons`);
  await page.waitForSelector('#messages li');
  await page.click('#btn-sample');
  await pause();
  assert.ok(await page.locator('#ph-sbar').isHidden(), 'без сеанса полосы нет');

  // новый сеанс: аппарат, дата, пучки (отмечены все), порядок — 10 МВ первым
  await page.goto(`${server.url}/index.html#session`);
  await pause();
  await page.fill('#ss_date', '2026-10-22');
  await pause();
  const setup = page.locator('#session-root');
  assert.match(await setup.innerText(), /6 МВ · фотоны · калибровок в журнале нет[\s\S]*10 МВ/);
  await setup.locator('[data-down="0"]').click();
  await pause();
  assert.match(await setup.innerText(), /10 МВ[\s\S]*6 МВ/);
  assert.match(await setup.locator('[data-ss=start]').innerText(), /Начать сеанс: 2 пучка/);
  await setup.locator('[data-ss=start]').click();
  await pause(600);

  // первый пучок открыт во вкладке «МВ фотоны» с пучком журнала, датой сеанса и полосой сеанса
  assert.equal(await page.evaluate(() => location.hash), '#photons');
  assert.equal(await page.inputValue('#meta_beam'), '10 МВ');
  assert.equal(await page.inputValue('#meta_date'), '2026-10-22');
  assert.equal(await page.inputValue('#ch_serial'), '47364');
  const bar = page.locator('#ph-sbar');
  assert.ok(await bar.isVisible());
  assert.match(await bar.innerText(), /Сеанс · Versa HD · 22\.10\.2026 · калибровка в воде · пучок 1 из 2/);
  const measure = async () => {
    await page.fill('#qtrs_v20', '39,16');
    await page.fill('#qtrs_v10', '67,22');
    await page.fill('#dd_zmax', '1,5');
    await page.fill('#dd_pdd', '67,5');
    await pause(500);
  };
  await measure();
  await bar.locator('[data-ss=record]').click();
  await pause(600);
  // записан, открыт следующий пучок
  assert.equal(await page.inputValue('#meta_beam'), '6 МВ');
  assert.match(await bar.innerText(), /пучок 2 из 2/);
  assert.match(await bar.innerText(), /✓ 10 МВ · [+−±]\d/);
  assert.match(await bar.locator('[data-ss=record]').innerText(), /Записать и завершить/);
  await measure();
  await bar.locator('[data-ss=record]').click();
  await pause(600);

  // все пучки записаны: страница сеанса с итогом
  assert.equal(await page.evaluate(() => location.hash), '#session');
  const done = await page.locator('#session-root').innerText();
  assert.match(done, /Записано в журнал: 2 из 2/);
  assert.match(done, /Все пучки сеанса записаны в журнал/);
  // одна запись журнала (аппарат за день) с обоими пучками
  const journal = await page.evaluate(() => JSON.parse(localStorage.getItem('reference-dosimetry.journal.v1') || 'null')?.journal);
  if (journal) {
    const s = journal.sessions.filter((x) => x.date === '2026-10-22');
    assert.equal(s.length, 1);
    assert.equal(s[0].beams.length, 2);
  }
  await page.locator('#session-root [data-ss=end]').click();
  await pause();
  assert.match(await page.locator('#session-root').innerText(), /Новый сеанс/);
  await page.goto(`${server.url}/index.html#photons`);
  await pause();
  assert.ok(await page.locator('#ph-sbar').isHidden(), 'после завершения полосы нет');

  // по-английски — без кириллицы на странице сеанса (кроме названий)
  await page.goto(`${server.url}/index.html#session`);
  await page.locator('#lang_en').check();
  await pause(500);
  const lines = (await page.locator('#session-root').innerText()).split('\n').filter((l) => CYR.test(l) && !/Versa HD|МВ/.test(l));
  assert.deepEqual(lines, []);
  assert.deepEqual(errors, []);
});
