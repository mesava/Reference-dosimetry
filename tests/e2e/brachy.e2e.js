// «Дозиметрия» → «Брахитерапия»: листы «Колодезная камера» и «Фантом PTW 9193», общий сертификат источника,
// таблица вариантов фантома и свой k_tot по колодезной камере. Числа — обезличенные данные рабочей таблицы отделения.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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

test('брахитерапия: колодезная камера и фантом PTW 9193, сравнение с сертификатом, свой k_tot', async () => {
  const { page, errors } = await openPage(browser);
  const pause = (ms = 250) => page.waitForTimeout(ms);
  await page.goto(`${server.url}/index.html#brachy/well`);
  await page.waitForSelector('#brachy-root .plates-card');
  assert.match(await page.locator('#brachy-root nav a[aria-current="page"]').innerText(), /Колодезная камера/);

  // сертификат ⁶⁰Co: активность и Γ_δ, на дату измерения
  await page.selectOption('#br_nuclide', 'Co-60');
  await pause();
  await page.selectOption('#br_cert_unit', 'GBq');
  await pause();
  await page.fill('#br_cert_value', '33,11');
  await page.fill('#br_cert_gamma', '306');
  await page.fill('#br_cert_date', '2026-11-02');
  await page.fill('#br_cert_time', '10:00');
  await page.selectOption('#br_cert_zone', '+3');
  await pause();
  assert.match(await page.locator('#br-cert-live').innerText(), /10132 U/);

  // колодезная камера: N по строке ⁶⁰Co, ток так, чтобы ОМВК = 10,132 мГр/ч при нормальных условиях
  await page.fill('#br_w_N', '1,201e6');
  await page.fill('#br_w_T', '20');
  await page.fill('#br_w_P', '1013,25');
  await page.fill('#br_w_date', '2026-11-02');
  await page.fill('#br_w_time', '10:00');
  await page.selectOption('#br_w_zone', '+3');
  for (let i = 0; i < 3; i++) await page.fill(`#w_I_${i}`, '8,4363');
  await pause();
  const well = await page.locator('#br-result').innerText();
  assert.match(well, /10,132 мГр\/ч на 1 м/);
  assert.match(well, /\+0,00 % от сертификата|−0,00 % от сертификата|±0,00 % от сертификата/);

  // подсказки к величинам: что обозначает и откуда берётся
  await page.hover('label[for="br_cert_gamma"]');
  assert.match(await page.locator('#hover-pop').innerText(), /Постоянная мощности воздушной кермы[\s\S]*TRS-492[\s\S]*ур\. \(36\)/);
  await page.hover('#br-result th[data-pop]:has-text("kTP")');
  assert.match(await page.locator('#hover-pop').innerText(), /плотность воздуха[\s\S]*ур\. \(28\)/);
  await page.mouse.move(0, 0);

  // фантом: сертификат тот же (общий для листов)
  await page.click('a[data-goto="brachy/phantom"]');
  await pause();
  assert.equal(await page.evaluate(() => location.hash), '#brachy/phantom');
  assert.equal(await page.inputValue('#br_cert_value'), '33,11');
  await page.fill('#br_p_model', 'IBA FC65-G');
  await page.fill('#br_p_N', '48,36');
  await page.fill('#br_p_date', '2026-11-02');
  await page.fill('#br_p_time', '10:00');
  await page.selectOption('#br_p_zone', '+3');
  const holes = [['19,2', '97,59', ['0,467', '0,467', '0,467']], ['19,4', '97,6', ['0,474', '0,472', '0,473']], ['19,3', '97,59', ['0,465', '0,466', '0,466']], ['', '', ['0,461', '0,462', '0,46']]];
  for (let i = 0; i < 4; i++) {
    if (holes[i][0]) {
      await page.fill(`#br_h${i}_T`, holes[i][0]);
      await page.fill(`#br_h${i}_P`, holes[i][1]);
    }
    for (let j = 0; j < 3; j++) await page.fill(`#p_hole${i}_${j}`, holes[i][2][j]);
  }
  for (const [k, v] of [['p_pol_plus', ['0,467', '0,466', '0,467']], ['p_pol_minus', ['0,467', '0,468', '0,467']], ['p_ks_v2', ['0,465', '0,465', '0,465']]]) {
    for (let j = 0; j < 3; j++) await page.fill(`#${k}_${j}`, v[j]);
  }
  await pause();
  const res = await page.locator('#br-result').innerText();
  // варианты как в таблице отделения: 10,357 (k_zp 1,276), 10,633 (с k_A), 9,822 (Ubrich MC 31010)
  assert.match(res, /10,357[\s\S]*\+2,2\d %/);
  assert.match(res, /10,633[\s\S]*\+4,9\d %/);
  assert.match(res, /9,822[\s\S]*−3,0\d %/);
  assert.match(res, /основной вариант/i);

  // выбор основного варианта
  await page.locator('input[name="br_main"]').nth(1).click();
  await pause();
  assert.match(await page.locator('#br-result .plates-dose').innerText(), /10,63\d мГр\/ч на 1 м[\s\S]*от сертификата/);

  await page.hover('#br-result th:has-text("Множитель")');
  assert.match(await page.locator('#hover-pop').innerText(), /k_?tot[\s\S]*Ubrich/);
  await page.mouse.move(0, 0);

  // поглощённая доза в воде: в точке измерения, Ḋ_w,1 по Ubrich (табл. 7) и на 8 см в воде по TG-43, как в таблице отделения
  assert.match(await page.locator('#br-dose').innerText(), /23,42\d мГр\/мин/);
  await page.selectOption('#br_p_src', 'co0a86');
  await pause();
  const dose = await page.locator('#br-dose').innerText();
  assert.match(dose, /1791,4[\s\S]*24,99\d/);
  assert.match(dose, /По сертификату[\s\S]*1844,0/);

  // свой k_tot: ОМВК с листа колодезной камеры → k_tot → основной вариант совпадает с сертификатом
  await page.click('[data-br="wellk"]');
  await pause();
  assert.equal(await page.inputValue('#br_p_wellK'), '10,132');
  await page.click('[data-br="usektot"]');
  await pause();
  assert.match(await page.locator('#br-result .plates-dose').innerText(), /свой k[\s\S]*10,132 мГр\/ч/);

  // черновик сохраняется после перезагрузки
  await page.reload();
  await page.waitForSelector('#brachy-root .plates-card');
  assert.equal(await page.inputValue('#br_p_N'), '48,36');
  assert.equal(await page.inputValue('#br_p_src'), 'co0a86');
  assert.deepEqual(errors, []);
});

test('брахитерапия: максимум отклика колодезной камеры и таблица распада источника', async () => {
  const { page, errors } = await openPage(browser);
  const pause = (ms = 250) => page.waitForTimeout(ms);
  await page.goto(`${server.url}/index.html#brachy/sweet`);
  await page.waitForSelector('#brachy-root .plates-card');
  assert.match(await page.locator('#brachy-root nav a[aria-current="page"]').innerText(), /Максимум отклика/);

  // кривая отклика: 40…80 мм шагом 2,5 мм, вершина 56,3 мм; строки добавляются кнопкой «+» (последнее + шаг)
  await page.fill('#br_s_x_0', '40');
  await page.fill('#br_s_x_1', '42,5');
  await page.fill('#br_s_x_2', '45');
  for (let i = 3; i < 17; i++) await page.click('[data-br="s-add"]');
  await pause();
  assert.equal(await page.inputValue('#br_s_x_16'), '80');
  for (let i = 0; i < 17; i++) {
    const x = 40 + 2.5 * i;
    await page.fill(`#br_s_M_${i}`, (50 * (1 - 0.0004 * (x - 56.3) ** 2)).toFixed(4).replace('.', ','));
  }
  await page.fill('#br_s_cert_pos', '55');
  await pause();
  assert.match(await page.locator('#br-result .plates-dose').innerText(), /56,3 мм/);
  const res = await page.locator('#br-result').innerText();
  assert.match(res, /сдвиг \+1,3 мм/);
  assert.ok(await page.locator('#br-sweet-chart svg').count());
  // «Мерить в максимуме» — положение измерения на листе колодезной камеры
  await page.click('[data-br="s-use"]');
  await pause();
  await page.goto(`${server.url}/index.html#brachy/well`);
  await page.waitForSelector('#br_w_pos');
  assert.equal(await page.inputValue('#br_w_pos'), '56,3');

  // распад ⁶⁰Co от сертификата: по месяцам на 5 лет, дата порога 20 ГБк
  await page.goto(`${server.url}/index.html#brachy/decay`);
  await page.waitForSelector('#br_d_target');
  await page.selectOption('#br_nuclide', 'Co-60');
  await pause();
  await page.selectOption('#br_cert_unit', 'GBq');
  await pause();
  await page.fill('#br_cert_value', '33,11');
  await page.fill('#br_cert_gamma', '306');
  await page.selectOption('#br_cert_gamma_unit', 'uGy·m2/(h·GBq)');
  await page.fill('#br_cert_date', '2021-10-27');
  await page.fill('#br_cert_time', '12:00');
  await page.selectOption('#br_cert_zone', '+3');
  await page.selectOption('#br_d_zone', '+3');
  await page.fill('#br_d_target', '20');
  await page.selectOption('#br_d_target_unit', 'GBq');
  await pause();
  const decay = await page.locator('#br-result').innerText();
  assert.match(decay, /27\.08\.2025/);
  assert.equal(await page.locator('#br-result table.br-decay tbody tr').count(), 61);
  assert.match(await page.locator('#br-result table.br-decay tbody tr').first().innerText(), /27\.10\.2021[\s\S]*10,13/);
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-br="d-csv"]')]);
  const csv = await readFile(await download.path(), 'utf8');
  assert.equal(csv.trim().split('\r\n').length, 62);
  assert.match(csv.split('\r\n')[1], /^27\.10\.2021/);
  assert.deepEqual(errors, []);
});
