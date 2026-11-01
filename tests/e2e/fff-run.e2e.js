// Пучок БВФ на камере SNC600c (вымышленные данные): длина полости из базы (паспорт производителя), k_Q и k_vol
// вручную — справка со значениями TRS-398 Rev.1, подстройка ускорителя при выходе в допуске (раздел 9 по желанию),
// смена даты после записи — показания прошлого измерения очищаются.
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

const day = (k) => {
  const d = new Date();
  d.setDate(d.getDate() + k);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

test('БВФ и SNC600c: подстройка в допуске, справка о ручных k_Q и k_vol, смена даты очищает показания', async () => {
  const { page, errors } = await openPage(browser);
  const pause = (ms = 350) => page.waitForTimeout(ms);
  const cells = async (series, vals) => {
    const c = page.locator(`#sheet .cells[data-series="${series}"] input`);
    for (let i = 0; i < vals.length; i++) await c.nth(i).fill(vals[i]);
  };
  const first = (series) => page.locator(`#sheet .cells[data-series="${series}"] input`).first().inputValue();

  await page.goto(`${server.url}/index.html#equipment`);
  await page.waitForSelector('#eq_department');
  await page.fill('#eq_institution', 'Условный центр');
  await page.click('#eq-add-machine');
  await pause();
  await page.locator('[data-card^="machine:"] input[data-bind$="|name"]').fill('Аппарат БВФ');
  await page.locator('[data-add-beam]').click();
  await pause();
  await page.locator('[data-card^="beam:"] input[data-bind$="|name"]').fill('6 MV FFF');
  await page.click('#eq-add-electrometer');
  await pause();
  await page.locator('[data-card^="electrometer:"] select[data-bind$="|maker"]').selectOption('Sun Nuclear');
  await pause();
  await page.click('#eq-add-chamber');
  await pause();
  const ch = page.locator('[data-card^="chamber:"]');
  await ch.locator('select[data-bind$="|maker"]').selectOption('Sun Nuclear');
  await pause();
  await ch.locator('select[data-bind$="|form.ch_model"]').selectOption('SNC600c');
  await pause();
  await ch.locator('input[data-bind$="|form.ch_serial"]').fill('000600');
  await ch.locator('input[data-bind$="|form.ch_ndw"]').fill('0,05200');
  await pause();
  // длина полости SNC600c есть в базе — из паспорта производителя
  assert.equal(await ch.locator('input[data-bind$="|length"]').getAttribute('placeholder'), '22,7');
  assert.match(await ch.innerText(), /пусто — из базы \(паспорт производителя\)/);

  await page.goto(`${server.url}/index.html#photons`);
  await page.waitForSelector('#messages li');
  await page.locator('#ph-jbind [data-jb=machine]').selectOption({ label: 'Аппарат БВФ' });
  await pause();
  await page.locator('#ph-jbind [data-jb=beam]').selectOption({ label: '6 MV FFF' });
  await pause(500);
  assert.ok(await page.locator('#meta_fff').isChecked(), 'БВФ — по названию пучка');
  await page.fill('#meta_date', day(-2));
  await page.fill('#env_T', '22,0');
  await page.fill('#env_P', '101,3');
  await cells('rd_M1', ['10,000', '10,002', '10,001']);
  await cells('rd_Mopp', ['-10,004', '-10,005', '-10,003']);
  await cells('rd_M2', ['9,930', '9,931', '9,930']);
  await page.selectOption('#qtrs_method', 'known');
  await page.fill('#qtrs_tpr', '0,629');
  await page.fill('#dd_zmax', '1,3');
  await page.fill('#dd_pdd', '63,0');
  await page.fill('#dd_nominal', '0,820');
  await pause(600);
  assert.match(await page.locator('#length-hint').innerText(), /22,7 мм из паспорта производителя/);
  // k_Q и k_vol вручную — справка со значениями по TRS-398 Rev.1
  await page.selectOption('#kqtrs_mode', 'manual');
  await page.fill('#kqtrs_manual', '0,9999');
  await page.fill('#kqtrs_src', 'другой расчёт');
  await page.selectOption('#prof_mode', 'manual');
  await page.fill('#prof_value', '1,000');
  await pause(600);
  const msgs = await page.locator('#messages').innerText();
  assert.match(msgs, /kQ введён вручную: 0,9999; по TRS-398 Rev\.1 \(ур\. 34\) для Sun Nuclear SNC600c при TPR20,10 = 0,629 — 0,9972/);
  assert.match(msgs, /kvol введён вручную: 1,0000; по ур\. \(22\)[^]*1,0013/);

  // выход в допуске ±2 %: раздел 9 доступен «по желанию»
  const sec9 = page.locator('#recal-section');
  assert.ok(await sec9.isVisible(), 'раздел 9 виден и в допуске');
  assert.equal(await page.locator('#s9r').innerText(), 'Подстройка ускорителя (по желанию)');
  assert.match(await page.locator('#recal-hint').innerText(), /в пределах допуска ±2 %, подстройка не требуется/);
  const before = await page.locator('#recal-pre').innerText();
  await page.selectOption('#recal_needed', 'yes');
  await pause();
  await cells('recal_M', ['9,900', '9,901', '9,899']);
  await pause(600);
  const ro = await page.locator('#readout').innerText();
  assert.match(ro, /после подстройки/);
  assert.ok(ro.includes(`До подстройки: ${before}`), ro);
  await page.locator('#ph-jrec [data-jr=record]').click();
  await pause(500);
  assert.match(await page.locator('#status').innerText(), /Записано в журнал/);

  // новая дата: показания, T, P и раздел 9 прошлого измерения очищаются; настройки пучка остаются
  await page.fill('#meta_date', day(-1));
  await page.locator('#meta_date').dispatchEvent('change');
  await pause(600);
  assert.match(await page.locator('#status').innerText(), /Новая дата: показания, температура и давление измерения [\d.]+ \(оно уже в журнале\) очищены/);
  for (const s of ['rd_M1', 'rd_Mopp', 'rd_M2', 'recal_M', 'ctrl_M']) assert.equal(await first(s), '', s);
  assert.equal(await page.inputValue('#env_T'), '');
  assert.equal(await page.inputValue('#recal_needed'), '');
  assert.equal(await page.inputValue('#qtrs_tpr'), '0,629');
  assert.equal(await page.inputValue('#kqtrs_manual'), '0,9999');
  // запись прежней даты на месте
  await page.goto(`${server.url}/index.html#history`);
  await pause(600);
  assert.match(await page.locator('#hs-sessions').innerText(), /6 MV FFF/);
  assert.deepEqual(errors, []);
});
