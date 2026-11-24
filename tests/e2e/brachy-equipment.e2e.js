// «Оборудование» для брахитерапии (0.75.0): афтерлоадер с историей источников, колодезная камера с сертификатом
// (строки «аппарат + адаптер + нуклид»), камера фантома с «Применением» «брахитерапия»; на листах вкладки
// «Брахитерапия» — выбор из «Оборудования» и подстановка в поля. Числа — обезличенные.
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

test('брахитерапия в «Оборудовании»: афтерлоадер, источники, колодезная камера; подстановка на листы', async () => {
  const { page, errors } = await openPage(browser);
  const pause = (ms = 250) => page.waitForTimeout(ms);
  await page.goto(`${server.url}/index.html#equipment`);
  await page.waitForSelector('#eq_department');

  // афтерлоадер: два источника; при добавлении второго у первого ставится дата замены
  await page.click('#eq-add-brachy');
  await pause();
  const card = page.locator('.jcard.jbr');
  assert.match(await card.locator('.jcard-head').first().innerText(), /Новый афтерлоадер/);
  await card.locator('input[data-bind^="machine|"][data-bind$="|name"]').fill('Flexitron');
  await card.locator('[data-add-brachysrc]').click();
  await pause();
  const src = () => card.locator('.jbr-src');
  const s1 = src().first();
  await s1.locator('select[data-bind$="|model"]').selectOption('mhdr-v2');
  await pause();
  await s1.locator('input[data-bind$="|serial"]').fill('A-1');
  await s1.locator('input[data-bind$="|certValue"]').fill('40,1');
  await s1.locator('input[data-bind$="|certDate"]').fill('2026-06-01');
  await s1.locator('input[data-bind$="|installed"]').fill('2026-06-02');
  await pause();
  await card.locator('[data-add-brachysrc]').click();
  await pause();
  assert.equal(await src().count(), 2);
  // новый — сверху, с моделью прежнего; у прежнего — дата замены
  const s2 = src().first();
  assert.equal(await s2.locator('select[data-bind$="|model"]').inputValue(), 'mhdr-v2');
  assert.notEqual(await src().nth(1).locator('input[data-bind$="|removed"]').inputValue(), '');
  await s2.locator('input[data-bind$="|serial"]').fill('B-2');
  await s2.locator('input[data-bind$="|certValue"]').fill('41,5');
  await s2.locator('input[data-bind$="|certDate"]').fill('2026-09-01');
  await s2.locator('input[data-bind$="|installed"]').fill('2026-09-03');
  await src().nth(1).locator('input[data-bind$="|removed"]').fill('2026-09-03');
  await pause();
  assert.match(await src().first().innerText(), /в аппарате/);
  assert.match(await page.locator('#eq-mtabs').innerText(), /Flexitron[\s\S]*афтерлоадер/);

  // колодезная камера: модель из списка, строка сертификата
  await page.click('#eq-add-chamber');
  await pause();
  const ch = page.locator('[data-card^="chamber:"]');
  await ch.locator('select[data-bind$="|maker"]').selectOption('PTW');
  await pause();
  await ch.locator('select[data-bind$="|form.ch_model"]').selectOption('PTW33004');
  await pause();
  await ch.locator('input[data-bind$="|form.ch_serial"]').fill('W1');
  assert.equal(await ch.locator('input[data-bind*="|use."]').count(), 0, 'у колодезной камеры «Применения» нет');
  assert.match(await ch.innerText(), /Сертификат колодезной камеры/);
  await ch.locator('[data-add-brachyrow]').click();
  await pause();
  const row = ch.locator('.jbr-row').first();
  await row.locator('input[data-bind$="|label"]').fill('Flexitron, адаптер 1');
  await row.locator('select[data-bind$="|sm0"]').selectOption('mhdr-v2');
  await pause();
  await ch.locator('.jbr-row').first().locator('input[data-bind$="|N"]').fill('4,85e5');
  await ch.locator('input[data-bind$="|brachy.dueDate"]').fill('2030-01-01');
  await pause();
  assert.match(await ch.locator('.jcard-head').first().innerText(), /PTW TW33004 SourceCheck 4π № W1/);

  // камера фантома: «Применение» — брахитерапия, N_D,w в ⁶⁰Co
  await page.click('#eq-add-chamber');
  await pause();
  const ph = page.locator('[data-card^="chamber:"]');
  await ph.locator('select[data-bind$="|maker"]').selectOption('PTW');
  await pause();
  await ph.locator('select[data-bind$="|form.ch_model"]').selectOption('PTW30013');
  await pause();
  await ph.locator('input[data-bind$="|form.ch_serial"]').fill('F1');
  await ph.locator('input[data-bind$="|use.photon"]').uncheck();
  await pause();
  await ph.locator('input[data-bind$="|use.electron"]').uncheck();
  await pause();
  await ph.locator('input[data-bind$="|use.brachy"]').check();
  await pause();
  assert.match(await ph.innerText(), /Фантом PTW 9193/);
  await ph.locator('input[data-bind$="|form.ch_ndw"]').fill('53,4');
  await ph.locator('select[data-bind$="|form.ch_ndw_unit"]').selectOption('mGy/nC');
  await pause();

  // лист «Колодезная камера»: источник по дате измерения
  await page.goto(`${server.url}/index.html#brachy/well`);
  await page.waitForSelector('#br_j_machine');
  await page.fill('#br_w_date', '2026-07-10');
  await page.dispatchEvent('#br_w_date', 'change');
  await pause();
  const mid = await page.locator('#br_j_machine option').nth(1).getAttribute('value');
  await page.selectOption('#br_j_machine', mid);
  await pause();
  assert.equal(await page.inputValue('#br_cert_value'), '40,1');
  assert.match(await page.inputValue('#br_src_name'), /Flexitron, .*mHDR-v2, № A-1/);
  // другая дата — другой источник
  await page.fill('#br_w_date', '2026-10-10');
  await page.dispatchEvent('#br_w_date', 'change');
  await pause();
  assert.equal(await page.inputValue('#br_cert_value'), '41,5');
  assert.equal(await page.inputValue('#br_cert_date'), '2026-09-01');
  // колодезная камера и строка сертификата: N, модель, k_sm,sm0 — тот же источник
  const wid = await page.locator('#br_j_well option').nth(1).getAttribute('value');
  await page.selectOption('#br_j_well', wid);
  await pause();
  assert.equal(await page.inputValue('#br_w_N'), '4,85e5');
  assert.equal(await page.inputValue('#br_w_model'), 'PTW TW33004 SourceCheck 4π');
  assert.equal(await page.inputValue('#br_w_serial'), 'W1');
  assert.equal(await page.inputValue('#br_w_ksm_mode'), 'same');
  // у ⁶⁰Co строк нет
  await page.selectOption('#br_nuclide', 'Co-60');
  await pause();
  assert.match(await page.locator('#br_j_row').innerText(), /нет строк для ⁶⁰Co/);
  await page.selectOption('#br_nuclide', 'Ir-192');
  await pause();

  // лист «Фантом PTW 9193»: камера из «Оборудования» с N_D,w
  await page.click('a[data-goto="brachy/phantom"]');
  await page.waitForSelector('#br_j_phantom');
  const pid = await page.locator('#br_j_phantom option').nth(1).getAttribute('value');
  await page.selectOption('#br_j_phantom', pid);
  await pause();
  assert.equal(await page.inputValue('#br_p_model'), 'PTW 30013');
  assert.equal(await page.inputValue('#br_p_N'), '53,4');
  assert.equal(await page.inputValue('#br_p_N_unit'), 'mGy/nC');

  // лист «Сличение камер»: эталонная — из «Оборудования»
  await page.click('a[data-goto="brachy/cross"]');
  await page.waitForSelector('#br_j_ref');
  await page.selectOption('#br_j_ref', wid);
  await pause();
  assert.equal(await page.inputValue('#br_x_ref_N'), '4,85e5');
  assert.equal(await page.inputValue('#br_x_ref_serial'), 'W1');
  assert.deepEqual(errors, []);
});
