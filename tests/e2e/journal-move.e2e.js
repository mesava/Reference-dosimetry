// «Журнал и тренды» → «Записи журнала» → «Перенести на другую дату»: протокол внесли не с той датой.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, openPage, fillPhotonReadings } from './helpers.js';

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

test('перенос записи журнала на другую дату: доза та же, занятая дата — отказ с объяснением', async () => {
  const { page, errors } = await openPage(browser);
  const pause = (ms = 300) => page.waitForTimeout(ms);
  await page.goto(`${server.url}/index.html#equipment`);
  await page.waitForSelector('#eq_department');
  await page.click('#eq-add-machine');
  await pause();
  await page.locator('[data-card^="machine:"] input[data-bind$="|name"]').fill('Линак-1');
  await page.locator('[data-add-beam]').click();
  await pause();
  await page.locator('[data-card^="beam:"] input[data-bind$="|name"]').nth(0).fill('6 МВ');
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
  await ch.locator('input[data-bind$="|form.ch_serial"]').fill('12345');
  await ch.locator('input[data-bind$="|form.ch_ndw"]').fill('0,05235');
  await pause();

  // две калибровки: 14.02.2025 и ошибочная 16.06.2025 (должно быть 16.05.2025)
  await page.goto(`${server.url}/index.html#photons`);
  await page.waitForSelector('#messages li');
  const bind = page.locator('#ph-jbind');
  await bind.locator('[data-jb=machine]').selectOption({ label: 'Линак-1' });
  await pause();
  await bind.locator('[data-jb=beam]').selectOption({ label: '6 МВ' });
  await pause(500);
  const rec = page.locator('#ph-jrec');
  for (const d of ['2025-02-14', '2025-06-16']) {
    await page.fill('#meta_date', d);
    await page.locator('#meta_date').dispatchEvent('change');
    await pause(400);
    await fillPhotonReadings(page);
    await page.fill('#qtrs_v20', '39,16');
    await page.fill('#qtrs_v10', '67,22');
    await page.fill('#dd_zmax', '1,5');
    await page.fill('#dd_pdd', '67,5');
    await pause(500);
    await rec.locator('[data-jr=record]').click();
    await pause(500);
  }

  await page.goto(`${server.url}/index.html#history`);
  await pause(600);
  const list = page.locator('#hs-sessions');
  const dose = async () => (await list.innerText()).match(/6 МВ: [\d,]+ \([^)]*\)/g);
  const before = await dose();
  assert.deepEqual((await list.innerText()).match(/\d\d\.\d\d\.2025/g), ['16.06.2025', '14.02.2025']);
  // форма переноса — под ошибочной записью (она сверху)
  await list.locator('[data-move-session]').first().click();
  await pause(200);
  const form = list.locator('[data-move-form]').first();
  assert.ok(await form.isVisible());
  assert.match(await form.innerText(), /Переносятся все пучки записи вместе/);
  // занятая дата — отказ с объяснением, ничего не меняется
  await form.locator('[data-move-date]').fill('2025-02-14');
  await form.locator('[data-move-ok]').click();
  await pause(300);
  assert.match(await form.locator('.jmove-err').innerText(), /За 14\.02\.2025 у этого аппарата уже есть запись/);
  // верная дата
  await form.locator('[data-move-date]').fill('2025-05-16');
  await form.locator('[data-move-ok]').click();
  await pause(500);
  assert.match(await page.locator('#hs-status').innerText(), /Запись 16\.06\.2025 перенесена на 16\.05\.2025/);
  assert.deepEqual((await list.innerText()).match(/\d\d\.\d\d\.2025/g), ['16.05.2025', '14.02.2025']);
  assert.deepEqual(await dose(), before, 'доза записей та же');
  // перенесённая запись открывается во вкладке с новой датой и теми же показаниями
  await list.locator('[data-open-beam]').first().click();
  await pause(600);
  assert.equal(await page.inputValue('#meta_date'), '2025-05-16');
  assert.equal(await page.locator('.cells[data-series="rd_M1"] input').first().inputValue(), '12,346');

  // по-английски — без кириллицы в форме переноса
  await page.goto(`${server.url}/index.html#history`);
  await page.locator('#lang_en').check();
  await pause(500);
  await list.locator('[data-move-session]').first().click();
  await pause(200);
  const lines = (await list.locator('[data-move-form]').first().innerText()).split('\n').filter((l) => CYR.test(l));
  assert.deepEqual(lines, []);
  assert.deepEqual(errors, []);
});
