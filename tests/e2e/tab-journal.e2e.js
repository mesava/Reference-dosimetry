// Измерение во вкладке дозиметрии → журнал: выбор пучка журнала в разделе 1, «Записать в журнал» под результатом,
// проверка выхода с k_pol и k_s из записанной калибровки.
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

test('вкладка «МВ фотоны»: пучок журнала, запись калибровки и проверки выхода в журнал', async () => {
  const { page, errors } = await openPage(browser);
  const pause = (ms = 300) => page.waitForTimeout(ms);
  // оборудование: аппарат с двумя пучками, электрометр, камера
  await page.goto(`${server.url}/index.html#equipment`);
  await page.waitForSelector('#eq_department');
  await page.fill('#eq_institution', 'ООО Пример');
  await page.click('#eq-add-machine');
  await pause();
  await page.locator('[data-card^="machine:"] input[data-bind$="|name"]').fill('Versa HD');
  await page.locator('[data-add-beam]').click();
  await pause();
  await page.locator('[data-card^="beam:"] input[data-bind$="|name"]').nth(0).fill('6 МВ');
  await page.locator('[data-add-beam]').click();
  await pause();
  await page.locator('[data-card^="beam:"] input[data-bind$="|name"]').nth(1).fill('10 МВ');
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

  // вкладка «МВ фотоны»: пример, затем пучок журнала
  await page.goto(`${server.url}/index.html#photons`);
  await page.waitForSelector('#messages li');
  await page.click('#btn-sample');
  await pause();
  const bind = page.locator('#ph-jbind');
  assert.ok(await bind.isVisible(), 'блок журнала в разделе 1');
  await bind.locator('[data-jb=machine]').selectOption({ label: 'Versa HD' });
  await pause();
  await bind.locator('[data-jb=beam]').selectOption({ label: '6 МВ' });
  await pause(500);
  assert.equal(await page.inputValue('#ch_serial'), '47364', 'камера журнала подставлена');
  assert.equal(await page.inputValue('#meta_beam'), '6 МВ');
  assert.match(await page.inputValue('#meta_institution'), /ООО Пример/);
  // качество пучка при калибровке измеряют: вводим и дату
  await page.fill('#meta_date', '2026-10-19');
  await page.fill('#qtrs_v20', '39,16');
  await page.fill('#qtrs_v10', '67,22');
  // у нового пучка журнала ещё нет d_max и PDD(10) для пересчёта — вводятся во вкладке
  await page.fill('#dd_zmax', '1,5');
  await page.fill('#dd_pdd', '67,5');
  await pause(500);
  const rec = page.locator('#ph-jrec');
  assert.ok(await rec.isVisible(), 'блок «Журнал» под результатом');
  assert.match(await rec.innerText(), /Versa HD — 6 МВ · калибровка · 19\.10\.2026/);
  await rec.locator('[data-jr=record]').click();
  await pause(500);
  assert.match(await page.locator('#status').innerText(), /Записано в журнал: Versa HD — 6 МВ, 19\.10\.2026, калибровка/);
  assert.match(await rec.locator('[data-jr=record]').innerText(), /Заменить запись в журнале/);
  // настройки пучка (d_max, PDD) — в журнал: при следующем выборе пучка подставятся
  await rec.locator('[data-jr=settings]').click();
  await pause(400);
  assert.match(await page.locator('#status').innerText(), /Настройки пучка «Versa HD — 6 МВ» сохранены в журнал/);

  // проверка выхода на следующий день: k_pol и k_s подставляются из записанной калибровки
  await page.fill('#meta_date', '2026-10-20');
  await page.locator('#rd_fixed').check();
  await pause(600);
  assert.match(await page.inputValue('#rd_fixed_kpol'), /^[01][,.]\d+/);
  assert.match(await page.inputValue('#rd_fixed_from'), /19\.10\.2026/);
  assert.match(await rec.innerText(), /проверка выхода · 20\.10\.2026/);
  await rec.locator('[data-jr=record]').click();
  await pause(500);

  // новая калибровка: k_pol и k_s сравниваются с прошлой калибровкой пучка; k_pol изменился больше 0,2 % — предупреждение
  await page.locator('#rd_fixed').uncheck();
  await page.fill('#meta_date', '2026-10-21');
  await pause(500);
  assert.match(await rec.innerText(), /прошлая калибровка пучка в журнале \(19\.10\.2026\)/);
  assert.doesNotMatch(await rec.innerText(), /изменился на/);
  const opp = page.locator('.cells[data-series="rd_Mopp"] input');
  for (let i = 0; i < (await opp.count()); i++) {
    const v = Number((await opp.nth(i).inputValue()).replace(',', '.'));
    if (Number.isFinite(v) && v) await opp.nth(i).fill(String((v * 1.01).toFixed(4)).replace('.', ','));
  }
  await pause(500);
  assert.match(await rec.innerText(), /kpol изменился на \+0,\d\d %.*Report 374/s);

  // в «Журнале и трендах» — две записи аппарата
  await page.goto(`${server.url}/index.html#history`);
  await pause(600);
  const list = await page.locator('#hs-sessions').innerText();
  assert.match(list, /19\.10\.2026/);
  assert.match(list, /20\.10\.2026/);
  // протокол записи за день и пучок записи во вкладке
  await page.locator('#hs-sessions [data-report]').last().click();
  await pause(400);
  const rep = await page.locator('#hs-report').innerText();
  assert.match(rep, /ПРОТОКОЛ: АППАРАТ ЗА ДЕНЬ/);
  assert.match(rep, /19\.10\.2026; режим: калибровка/);
  assert.match(rep, /6 МВ: PTW 30013 № 47364/);
  await page.locator('#hs-sessions [data-open-beam]').last().click();
  await pause(500);
  assert.equal(await page.evaluate(() => location.hash), '#photons');
  assert.match(await page.locator('#ph-journal-bar').innerText(), /Пучок из журнала: Versa HD — 6 МВ, 19\.10\.2026/);
  await page.locator('#ph-journal-bar button').last().click();
  await pause(300);
  // камеру и электрометр с записями в журнале удалить нельзя
  await page.goto(`${server.url}/index.html#equipment`);
  await pause(400);
  assert.ok(await page.locator('[data-del^="chamber:"]').isDisabled());
  assert.ok(await page.locator('[data-del^="electrometer:"]').isDisabled());
  // вкладки в шапке — по порядку работы; «Оборудование» и «Журнал и тренды» — отдельные вкладки
  assert.deepEqual((await page.locator('.modules a').allInnerTexts()).map((t) => t.trim()), ['Начало', 'Оборудование', 'Дозиметрия', 'Камера и пучок', 'Неопределённость', 'Журнал и тренды']);
  assert.equal(await page.locator('#tab-equipment').getAttribute('aria-current'), 'page');
  assert.ok(await page.locator('.protocol-switch').isHidden(), 'в «Оборудовании» переключателя протокола нет');
  // прежний адрес «Сеанса» ведёт в «Журнал и тренды»
  await page.goto(`${server.url}/index.html#session`);
  await pause(500);
  assert.ok(await page.locator('#module-history').isVisible());
  assert.equal(await page.locator('#tab-history').getAttribute('aria-current'), 'page');

  // по-английски — без кириллицы в блоках журнала (кроме названий)
  await page.goto(`${server.url}/index.html#photons`);
  await page.locator('#lang_en').check();
  await pause(500);
  for (const sel of ['#ph-jbind', '#ph-jrec']) {
    const lines = (await page.locator(sel).innerText()).split('\n').filter((l) => CYR.test(l) && !/Versa HD|МВ|ООО/.test(l));
    assert.deepEqual(lines, [], sel);
  }
  assert.deepEqual(errors, []);
});
