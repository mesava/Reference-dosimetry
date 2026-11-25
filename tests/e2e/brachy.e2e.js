// «Дозиметрия» → «Брахитерапия»: листы «Колодезная камера» и «Фантом PTW 9193», общий сертификат источника,
// таблица вариантов фантома и свой k_tot по колодезной камере. Числа — обезличенные данные рабочей таблицы отделения.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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

test('брахитерапия: колодезная камера и фантом PTW 9193, сравнение с сертификатом, свой k_tot', async () => {
  const { page, errors } = await openPage(browser);
  const pause = (ms = 250) => page.waitForTimeout(ms);
  await page.goto(`${server.url}/index.html#brachy/well`);
  await page.waitForSelector('#brachy-root section.step');
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
  const well = await resText(page);
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
  const res = await resText(page);
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
  await page.waitForSelector('#brachy-root section.step');
  assert.equal(await page.inputValue('#br_p_N'), '48,36');
  assert.equal(await page.inputValue('#br_p_src'), 'co0a86');
  assert.deepEqual(errors, []);
});

test('брахитерапия: максимум отклика колодезной камеры и таблица распада источника', async () => {
  const { page, errors } = await openPage(browser);
  const pause = (ms = 250) => page.waitForTimeout(ms);
  await page.goto(`${server.url}/index.html#brachy/sweet`);
  await page.waitForSelector('#brachy-root section.step');
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
  const res = await resText(page);
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
  await page.fill('#br_d_at_date', '2021-10-27');
  await page.fill('#br_d_at_time', '12:00');
  await page.selectOption('#br_d_at_zone', '+3');
  await page.selectOption('#br_d_unit', 'm');
  await page.fill('#br_d_to', '2026-10-28');
  await page.fill('#br_d_target', '20');
  await page.selectOption('#br_d_target_unit', 'GBq');
  await pause();
  const decay = await resText(page);
  assert.match(decay, /27\.08\.2025/);
  // результат на дату — как в книге отделения: активность, керма в Гр/с, мГр/ч, мкГр/ч, U, проверка через Γ, диапазон
  const at = await page.locator('#br-result table.br-decay-at').innerText();
  assert.match(at, /Активность A\(t\)\s+33,110\s+ГБк/);
  assert.match(at, /0,8949\s+Ки/);
  assert.match(at, /Керма K\(t\)\s+10,13\d\d\s+мГр\/ч/);
  assert.match(at, /Гр\/с/);
  assert.match(at, /Нижняя граница/);
  assert.match(await page.locator("#br-disp").innerText(), /10,132/);
  assert.equal(await page.locator('#br-result table.br-decay tbody tr').count(), 61);
  assert.match(await page.locator('#br-result table.br-decay tbody tr').first().innerText(), /27\.10\.2021[\s\S]*10,13/);
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-br="d-csv"]')]);
  const csv = await readFile(await download.path(), 'utf8');
  assert.equal(csv.trim().split('\r\n').length, 62);
  assert.match(csv.split('\r\n')[1], /^27\.10\.2021/);
  assert.deepEqual(errors, []);
});

test('брахитерапия: сличение рабочей камеры по эталонной и проверка стабильности', async () => {
  const { page, errors } = await openPage(browser);
  const pause = (ms = 250) => page.waitForTimeout(ms);
  const cells = async (key, vals) => {
    const inp = page.locator(`.cells[data-series="${key}"] input`);
    for (let i = 0; i < vals.length; i++) await inp.nth(i).fill(vals[i]);
  };
  await page.goto(`${server.url}/index.html#brachy/cross`);
  await page.waitForSelector('#br_x_ref_N');
  assert.match(await page.locator('#brachy-root nav a[aria-current="page"]').innerText(), /Сличение камер/);
  await page.selectOption('#br_nuclide', 'Ir-192');
  await pause();
  await page.fill('#br_x_ref_N', '4,6e5');
  await cells('x_ref_I', ['10,00', '10,01', '10,00']);
  await cells('x_fld_I', ['9,50', '9,51', '9,50']);
  for (const [k, v] of [['x_ref_T', '21'], ['x_ref_P', '1000'], ['x_fld_T', '21'], ['x_fld_P', '1000'], ['x_fld_prev', '4,83e5'], ['x_fld_model', 'PTW TM33004'], ['x_ref_date', '2026-11-24'], ['x_ref_time', '10:00'], ['x_fld_date', '2026-11-24'], ['x_fld_time', '11:00']]) await page.fill(`#br_${k}`, v);
  await page.selectOption('#br_x_ref_zone', '+3');
  await page.selectOption('#br_x_fld_zone', '+3');
  await pause();
  const res = await resText(page);
  assert.match(res, /484013/);
  assert.match(res, /\+0,21 % от прежнего/);
  assert.match(res, /1,00039/);
  await page.click('[data-br="x-use"]');
  await pause();
  await page.goto(`${server.url}/index.html#brachy/well`);
  await page.waitForSelector('#br_w_N');
  assert.equal(await page.inputValue('#br_w_N'), '484013');
  assert.equal(await page.inputValue('#br_w_model'), 'PTW TM33004');

  // стабильность: контрольный ¹³⁷Cs, год от исходного — распад 2,33 %
  await page.goto(`${server.url}/index.html#brachy/stab`);
  await page.waitForSelector('#br_st_method');
  await cells('st_I', ['100,0', '100,1', '99,9']);
  for (const [k, v] of [['st_T', '20'], ['st_base', '101'], ['st_base_date', '2025-11-24'], ['st_base_time', '10:00'], ['st_date', '2026-11-24'], ['st_time', '10:00']]) await page.fill(`#br_${k}`, v);
  await page.selectOption('#br_st_P_unit', 'kPa');
  await page.fill('#br_st_P', '101,325');
  await pause();
  let st = await resText(page);
  assert.match(st, /\+1,32 %[\s\S]*вне ±0,5 %/);
  assert.match(st, /1,02332/);
  // записать как исходное (на дату проверки, без пересчёта по распаду) — отклонение 0
  await page.click('[data-br="st-base"]');
  await pause();
  assert.equal(await page.inputValue('#br_st_base'), '100');
  assert.equal(await page.inputValue('#br_st_base_date'), '2026-11-24');
  st = await resText(page);
  assert.match(st, /[+−-]?0,00 %[\s\S]*в пределах ±0,5 %/);
  // вторая камера — отношение показаний, ±0,1 %
  await page.selectOption('#br_st_method', 'redundant');
  await pause();
  await cells('st_I2', ['80,00', '80,08', '80,04']);
  await page.fill('#br_st_base', '1,2490');
  await pause();
  st = await resText(page);
  assert.match(st, /Отношение M1\/M2\s+1,24938/i);
  assert.match(st, /в пределах ±0,1 %/);
  assert.deepEqual(errors, []);
});

test('брахитерапия: бюджет неопределённости на листах колодезной камеры и фантома', async () => {
  const { page, errors } = await openPage(browser);
  const pause = (ms = 250) => page.waitForTimeout(ms);
  await page.goto(`${server.url}/index.html#brachy/well`);
  await page.waitForSelector('#br_w_N');
  await page.fill('#br_w_N', '4,836e5');
  await page.selectOption('#br_w_ksm_mode', 'same');
  await pause();
  const inp = page.locator('.cells[data-series="w_I"] input');
  for (const [i, v] of ['10,00', '10,02', '10,01'].entries()) await inp.nth(i).fill(v);
  await pause();
  // сценарий 1 TRS-492, табл. 10: u_c = 0,80 %, U = 1,6 %
  assert.match(await page.locator('#br-unc-sum').innerText(), /±1,6 %[\s\S]*= 0,80 %/);
  // U(N) из сертификата камеры и своё значение строки — поле не теряет фокус
  await page.fill('#br_w_NU', '1,5');
  await page.locator('input[data-uk="setup"]').fill('0,5');
  await pause();
  assert.equal(await page.evaluate(() => document.activeElement?.dataset?.uk), 'setup');
  assert.match(await page.locator('tr[data-ur="cal"] .u-val').innerText(), /0,75/);
  assert.match(await page.locator('#br-unc-sum').innerText(), /±1,9 %[\s\S]*= 0,96 %/);
  await page.selectOption('#br_u_scen', '2');
  await pause();
  assert.match(await page.locator('tr[data-ur="tp"] .u-val').innerText(), /0,50/);
  await page.reload();
  await page.waitForSelector('#br-unc-sum');
  assert.equal(await page.inputValue('input[data-uk="setup"]'), '0,5');
  // фантом: строки по Ubrich 2014
  await page.goto(`${server.url}/index.html#brachy/phantom`);
  await page.waitForSelector('#br-unc-sum');
  assert.equal(await page.locator('tr[data-ur]').count() >= 4, true);
  assert.deepEqual(errors, []);
});

test('брахитерапия: доза в воде по TG-43 в точках на поперечной оси', async () => {
  const { page, errors } = await openPage(browser);
  const pause = (ms = 250) => page.waitForTimeout(ms);
  await page.goto(`${server.url}/index.html#brachy/tg43`);
  await page.waitForSelector('#br_t_src');
  assert.match(await page.locator('#brachy-root nav a[aria-current="page"]').innerText(), /Доза TG-43/);
  await page.selectOption('#br_nuclide', 'Co-60');
  await pause();
  await page.selectOption('#br_cert_unit', 'GBq');
  await pause();
  await page.fill('#br_cert_value', '33,11');
  await page.fill('#br_cert_gamma', '306');
  await page.selectOption('#br_cert_gamma_unit', 'uGy·m2/(h·GBq)');
  await page.fill('#br_cert_date', '2026-11-02');
  await page.fill('#br_cert_time', '10:00');
  await page.selectOption('#br_cert_zone', '+3');
  await page.selectOption('#br_t_src', 'co0a86');
  await pause();
  await page.fill('#br_t_date', '2026-11-02');
  await page.fill('#br_t_time', '10:00');
  await page.selectOption('#br_t_zone', '+3');
  await pause();
  const res = await resText(page);
  assert.match(res, /110,63\d+ Гр\/ч/);
  assert.match(res, /8,00[\s\S]*0,884[\s\S]*25,72\d/);
  // точка добавляется кнопкой «+»
  await page.click('[data-br="t-add"]');
  await pause();
  await page.fill('#br_t_r_5', '0,5');
  await pause();
  assert.match(await resText(page), /0,50[\s\S]*1,028/);
  // вне поперечной оси (0.79.0) — F(r,θ) по таблице HEBD (Co0.A86 — табл. LVI): θ = 0°, r = 1 см — 0,923
  await page.fill('#br_t_th', '0');
  await page.dispatchEvent('#br_t_th', 'change');
  await pause();
  assert.match(await page.locator('#br-result').innerText(), /1,00\s+[\d,]+\s+1,000\s+0,923/);
  assert.match(await page.locator('#br-messages').innerText(), /F\(r,θ\) — по таблице HEBD \(табл\. LVI/);
  assert.deepEqual(errors, []);
});

test('брахитерапия: колодезная камера с калибровкой в Ḋw (TRS-492, разд. 7.4)', async () => {
  const { page, errors } = await openPage(browser);
  const pause = (ms = 250) => page.waitForTimeout(ms);
  await page.goto(`${server.url}/index.html#brachy/well`);
  await page.waitForSelector('[data-br="sample"]');
  await page.click('[data-br="sample"]');
  await page.click('[data-br="sample"]');
  await pause();
  await page.selectOption('#br_w_N_unit', 'Gy/(h·A)');
  await pause();
  // модель источника — для S_K = Ḋw/Λ; без неё Ḋw есть, сравнения нет
  await page.waitForSelector('#br_w_src');
  await page.selectOption('#br_w_src', 'mhdr-v2');
  await pause();
  // N_Dw = N_K · Λ: 4,850·10⁵ Гр·м²·ч⁻¹·А⁻¹ · 1,109 сГр·ч⁻¹·Ед⁻¹ · 10⁴ — тот же результат, что в примере (+0,35 %)
  await page.fill('#br_w_N', '5,37865e9');
  await page.dispatchEvent('#br_w_N', 'input');
  await pause();
  const res = await page.locator('#br-result').innerText();
  assert.match(res, /Ḋw \(1 см, 90°\) на время измерения\s+391,6\d* Гр\/ч\s+\+0,35 % от сертификата/);
  assert.match(res, /SK = Ḋw,1\/Λ = 35312 U/);
  assert.match(res, /k_?Dw,sm,sm0\s+не применяется/i);
  assert.match(await page.locator('#br-disp').innerText(), /Гр\/ч/);
  assert.deepEqual(errors, []);
});
