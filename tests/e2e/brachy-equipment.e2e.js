// «Оборудование» для брахитерапии (0.75.0): афтерлоадер с историей источников, колодезная камера с сертификатом
// (строки «аппарат + адаптер + нуклид»), камера фантома с «Применением» «брахитерапия»; на листах вкладки
// «Брахитерапия» — выбор из «Оборудования» и подстановка в поля. Числа — обезличенные.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, openPage } from './helpers.js';

// результат листа и замечания справа (с 0.79.0 замечания — в панели «Замечания»)
const resText = async (page) => `${await page.locator('#br-result').innerText()}\n${await page.locator('#br-messages').innerText()}`;
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
  // паспорт целиком (с 0.80.4): Γδ и k для U — новый источник перенимает их от прежнего
  await s1.locator('input[data-bind$="|certGamma"]').fill('108');
  await s1.locator('select[data-bind$="|certK"]').selectOption('3');
  await pause();
  await card.locator('[data-add-brachysrc]').click();
  await pause();
  assert.equal(await src().count(), 2);
  // новый — сверху, с моделью прежнего; у прежнего — дата замены
  const s2 = src().first();
  assert.equal(await s2.locator('select[data-bind$="|model"]').inputValue(), 'mhdr-v2');
  assert.notEqual(await src().nth(1).locator('input[data-bind$="|removed"]').inputValue(), '');
  assert.equal(await s2.locator('input[data-bind$="|certGamma"]').inputValue(), '108');
  assert.equal(await s2.locator('select[data-bind$="|certK"]').inputValue(), '3');
  await s2.locator('input[data-bind$="|certA0"]').fill('370');
  await s2.locator('input[data-bind$="|certA0Date"]').fill('2026-08-28');
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
  assert.equal(await page.inputValue('#br_cert_gamma'), '108');
  assert.equal(await page.inputValue('#br_cert_k'), '3');
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
  await page.click('#brachy-root a[data-goto="brachy/phantom"]');
  await page.waitForSelector('#br_j_phantom');
  const pid = await page.locator('#br_j_phantom option').nth(1).getAttribute('value');
  await page.selectOption('#br_j_phantom', pid);
  await pause();
  assert.equal(await page.inputValue('#br_p_model'), 'PTW 30013');
  assert.equal(await page.inputValue('#br_p_N'), '53,4');
  assert.equal(await page.inputValue('#br_p_N_unit'), 'mGy/nC');

  // лист «Сличение камер»: эталонная — из «Оборудования»
  await page.click('#brachy-root a[data-goto="brachy/cross"]');
  await page.waitForSelector('#br_j_ref');
  await page.selectOption('#br_j_ref', wid);
  await pause();
  assert.equal(await page.inputValue('#br_x_ref_N'), '4,85e5');
  assert.equal(await page.inputValue('#br_x_ref_serial'), 'W1');

  // запись в журнал (0.76.0): лист «Колодезная камера» — измерение за день по аппарату и источнику
  await page.click('#brachy-root a[data-goto="brachy/well"]');
  await page.waitForSelector('#br_w_T');
  await page.fill('#br_w_T', '20');
  await page.fill('#br_w_P', '1013,25');
  for (let i = 0; i < 3; i++) await page.fill(`#w_I_${i}`, '80');
  await page.fill('#br_rec_staff', 'Иванов И. И.');
  await pause();
  assert.match(await resText(page), /38,8\d* мГр\/ч на 1 м/);
  await page.click('[data-br="record"]');
  await pause();
  assert.match(await page.locator('#brachy-status').innerText(), /Записано в журнал: сила источника, колодезная камера, 10\.10\.2026/);
  // повторная запись того же дня заменяет прежнюю
  await page.click('[data-br="record"]');
  await pause();
  assert.match(await page.locator('#brachy-status').innerText(), /Запись в журнале заменена/);

  // протокол измерения (0.77.0): шапка, результат, неопределённость, заключение, подписи; печать — только протокол
  await page.fill('#br_rec_staff', 'Иванов И. И.');
  await pause();
  await page.click('.br-prot-det > summary');
  await pause();
  const prot = await page.locator('#br-prot').innerText();
  assert.match(prot, /Протокол измерения\s+сила источника, колодезная камера/);
  assert.match(prot, /Дата\s+10\.10\.2026/);
  assert.match(prot, /Аппарат\s+Flexitron/);
  assert.match(prot, /PTW TW33004 SourceCheck 4π № W1; N = 4,85e5/);
  assert.match(prot, /TRS-492 \(2023\), гл\. 8/);
  assert.match(prot, /1\. Результат[\s\S]*38,8\d* мГр\/ч на 1 м[\s\S]*2\. Неопределённость[\s\S]*Расширенная U, k = 2[\s\S]*Заключение[\s\S]*Отклонение от сертификата/);
  assert.deepEqual((await page.locator('#br-prot table.kv-prot-sign td.sig-name').allInnerTexts()).map((s) => s.trim()), ['Иванов И. И.', '']);
  assert.equal(await page.locator('#br-prot button, #br-prot input').count(), 0, 'в протоколе нет кнопок и полей');
  await page.emulateMedia({ media: 'print' });
  assert.ok(await page.locator('.br-prot-sec').isHidden(), 'лист печатается без протокола');
  await page.evaluate(() => document.body.classList.add('print-br-protocol'));
  assert.ok(await page.locator('#br-prot').isVisible());
  assert.ok(await page.locator('#brachy-root nav').isHidden());
  assert.ok(await page.locator('#br-result').isHidden());
  await page.evaluate(() => document.body.classList.remove('print-br-protocol'));
  await page.emulateMedia({ media: 'screen' });
  // стабильность без камеры из «Оборудования» — не записывается
  await page.click('#brachy-root a[data-goto="brachy/stab"]');
  await page.waitForSelector('#br_st_method');
  await page.fill('#br_st_date', '2026-10-10');
  await page.click('[data-br="record"]');
  await pause();
  assert.match(await page.locator('#brachy-status').innerText(), /Выберите колодезную камеру|Расчёт не выполнен/);

  // «Журнал и тренды» (с 0.79.0, раньше — лист «Журнал» вкладки): одна запись, источник B-2, тренд отклонения от сертификата
  await page.click('a[data-goto="brachy/log"]');
  await page.waitForSelector('#hs-br-records table.br-log-t');
  assert.match(page.url(), /#history$/);
  assert.equal(await page.locator('#brachy-root nav a[data-goto="brachy/log"]').count(), 0, 'листа «Журнал» во вкладке нет');
  assert.equal(await page.inputValue('#hs_machine'), 'br:');
  const rows = page.locator('#hs-br-records table.br-log-t tbody tr');
  assert.equal(await rows.count(), 1);
  const logRow = await rows.first().innerText();
  assert.match(logRow, /10\.10\.2026[\s\S]*колодезная камера[\s\S]*Flexitron[\s\S]*№ B-2[\s\S]*38,8\d* мГр\/ч[\s\S]*от сертификата[\s\S]*Иванов И\. И\./);
  assert.equal(await page.locator('#br-spc-0 svg').count(), 1);
  assert.match(await page.locator('#hs-result').innerText(), /1\s*запись/);
  // выбор камеры
  await page.selectOption('#hs_machine', `br:c:${wid}`);
  await pause();
  assert.equal(await page.locator('#hs-br-records table.br-log-t tbody tr').count(), 1);
  // открыть запись на листе: поля листа — из записи
  await page.click('[data-br-open]');
  await pause();
  assert.match(page.url(), /#brachy\/well$/);
  assert.match(await page.locator('#brachy-root nav a[aria-current="page"]').innerText(), /Колодезная камера/);
  assert.equal(await page.inputValue('#w_I_0'), '80');
  assert.match(await page.locator('#brachy-status').innerText(), /Открыта запись журнала/);
  // удалить запись — двумя нажатиями
  await page.click('a[data-goto="brachy/log"]');
  await page.waitForSelector('[data-br-del]');
  await page.click('[data-br-del]');
  await page.click('[data-br-del]');
  await pause();
  assert.match(await page.locator('#hs-br-records').innerText(), /По этому выбору записей нет|Записей брахитерапии пока нет/);
  assert.deepEqual(errors, []);
});
