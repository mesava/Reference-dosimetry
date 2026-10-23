// Сквозной прогон на вымышленных данных: учреждение, аппарат с пучками фотонов и электронов и геометрией калибровки,
// электрометр и две камеры → калибровка 6 МВ и 12 МэВ по TRS-398 Rev.1 (числа сверены вручную) → проверки выхода →
// пластины → «Журнал и тренды» → сеанс. Заодно: пустые вкладки без примера, подтверждение записи при отклонении больше
// 20 %, камера для электронов, дата в будущем, тренд карты по нескольким дням, сроки калибровки, разделы 7 и 8.
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

/** Дата через k дней от сегодняшней, ГГГГ-ММ-ДД (по часам компьютера, как в странице). */
const day = (k) => {
  const d = new Date();
  d.setDate(d.getDate() + k);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const dmy = (iso) => iso.split('-').reverse().join('.');

test('сквозной прогон: оборудование → фотоны и электроны → пластины → журнал и тренды → сеанс', async () => {
  const { page, errors } = await openPage(browser);
  const pause = (ms = 300) => page.waitForTimeout(ms);
  const cells = async (series, vals) => {
    const c = page.locator(`.cells[data-series="${series}"] input`);
    for (let i = 0; i < vals.length; i++) await c.nth(i).fill(vals[i]);
  };
  const pick = async (sel, re) => {
    const v = await page.locator(`${sel} option`).evaluateAll((os, src) => os.filter((o) => new RegExp(src).test(o.textContent)).map((o) => o.value), re);
    await page.locator(sel).selectOption(v[0]);
    await pause(400);
  };

  // новая вкладка — пустая: пример только по кнопке
  await page.goto(`${server.url}/index.html#photons`);
  await page.waitForSelector('#messages li');
  assert.equal(await page.locator('#sheet .cells[data-series="rd_M1"] input').first().inputValue(), '');
  assert.equal(await page.inputValue('#meta_notes'), '');
  assert.ok(await page.locator('#demo-flag').isHidden());
  assert.match(await page.locator('#status').innerText(), /Загрузить пример/);

  // оборудование
  await page.goto(`${server.url}/index.html#equipment`);
  await page.waitForSelector('#eq_department');
  await page.fill('#eq_institution', 'Условный онкодиспансер');
  await page.fill('#eq_department', 'Отделение радиотерапии');
  await page.click('#eq-add-machine');
  await pause();
  const machine = page.locator('[data-card^="machine:"]');
  await machine.locator('input[data-bind$="|name"]').fill('Линак-Т1');
  await machine.locator('select[data-bind$="|calGeo.photon.setup_geometry"]').selectOption('SAD');
  await pause();
  await page.locator('[data-add-beam]').click();
  await pause();
  await page.locator('[data-add-ebeam]').click();
  await pause();
  await page.locator('[data-card^="beam:"] input[data-bind$="|name"]').nth(0).fill('6 МВ');
  await page.locator('[data-card^="beam:"] input[data-bind$="|name"]').nth(1).fill('12 МэВ');
  await page.click('#eq-add-electrometer');
  await pause();
  await page.locator('[data-card^="electrometer:"] select[data-bind$="|maker"]').selectOption('PTW');
  await pause();
  // Farmer первым в списке камер, Roos — вторым
  for (const [model, serial, ndw] of [['PTW30013', '000111', '0,05380'], ['ROOS', '000222', '0,08150']]) {
    await page.click('#eq-add-chamber');
    await pause();
    const ch = page.locator('[data-card^="chamber:"]').last();
    await ch.locator('select[data-bind$="|maker"]').selectOption('PTW');
    await pause();
    await ch.locator('select[data-bind$="|form.ch_model"]').selectOption(model);
    await pause();
    await ch.locator('input[data-bind$="|form.ch_serial"]').fill(serial);
    await ch.locator('input[data-bind$="|form.ch_ndw"]').fill(ndw);
    await pause();
  }
  // сроки калибровки не заданы — об этом замечание, а не «всё в порядке»
  assert.match(await page.locator('#eq-messages').innerText(), /Срок калибровки не задан[\s\S]*PTW 30013 № 000111; PTW 34001 Roos № 000222/i);

  // 6 МВ: калибровка (РИО 100 см, номинал на d_max через TMR); сначала пример — при выборе пучка он очищается
  await page.goto(`${server.url}/index.html#photons`);
  await page.waitForSelector('#messages li');
  await page.click('#btn-sample');
  await pause();
  await pick('#ph-jbind [data-jb=machine]', '^Линак-Т1');
  await pick('#ph-jbind [data-jb=beam]', '^6 МВ');
  assert.match(await page.locator('#status').innerText(), /Данные демонстрационного примера очищены/);
  assert.equal(await page.inputValue('#ch_serial'), '000111');
  assert.equal(await page.inputValue('#setup_geometry'), 'SAD');
  await page.fill('#meta_date', day(-5));
  await fillPhotonReadings(page, { M1: ['13,512', '13,515', '13,510'], Mopp: ['-13,505', '-13,508', '-13,503'], M2: ['13,470', '13,472', '13,469'], T: '21,0', P: '100,2' });
  await page.selectOption('#qtrs_method', 'ratio');
  await page.fill('#qtrs_v20', '9,045');
  await page.fill('#qtrs_v10', '13,500');
  await page.fill('#dd_zmax', '1,5');
  await page.fill('#dd_tmr', '0,734');
  await page.fill('#dd_nominal', '1,000');
  await pause(600);
  // M = 13,5123 нКл; k_TP 1,0147, k_pol 0,9997, k_s 1,0015 → M_Q 13,7277; × 0,0538 × k_Q 0,9892 = 0,7305 Гр; / TMR 0,734 = 0,9953
  const ph = await page.locator('#readout').innerText();
  assert.match(ph, /kQ\s+0,9892/);
  assert.match(ph, /Dw\(10 см\) = 73,05 сГр/);
  assert.match(ph, /D\(dmax\) = 99,53 сГр/);
  const rec = page.locator('#ph-jrec');
  await rec.locator('[data-jr=record]').click();
  await pause(500);
  assert.match(await page.locator('#status').innerText(), /Записано в журнал: Линак-Т1 — 6 МВ/);

  // проверки выхода: k_pol и k_s из калибровки; дата в будущем не записывается
  await page.locator('#rd_fixed').check();
  await pause(500);
  for (const [k, m] of [[-4, '13,530'], [-3, '13,498'], [-2, '13,541'], [-1, '13,505']]) {
    await page.fill('#meta_date', day(k));
    await cells('rd_M1', [m, m, m]);
    await pause(400);
    await rec.locator('[data-jr=record]').click();
    await pause(400);
  }
  await page.fill('#meta_date', day(1));
  await pause(500);
  assert.match(await rec.innerText(), new RegExp(`${dmy(day(1)).replace(/\./g, '\\.')} — в будущем`));
  assert.ok(await rec.locator('[data-jr=record]').isDisabled());
  await page.locator('#rd_fixed').uncheck();

  // 12 МэВ: без записей пучка — плоскопараллельная Roos, хотя Farmer первым в «Оборудовании»; в списке вкладки — первой
  await page.goto(`${server.url}/index.html#electrons`);
  await page.waitForSelector('#e-messages li');
  await pick('#e-jbind [data-jb=machine]', '^Линак-Т1');
  await pick('#e-jbind [data-jb=beam]', '^12 МэВ');
  assert.equal(await page.inputValue('#e_ch_model'), 'ROOS');
  assert.match(await page.locator('#e_ch_model optgroup[data-jl-group] option').first().textContent(), /Roos № 000222/);
  await page.fill('#e_date', day(-5));
  await page.fill('#e_env_T', '21,0');
  await page.fill('#e_env_P', '100,2');
  await page.selectOption('#e_r50_method', 'i50');
  await page.fill('#e_i50', '4,80');
  await page.fill('#e_V1', '200');
  await cells('e_M1', ['13,310', '13,312', '13,308']);
  await cells('e_Mopp', ['-13,330', '-13,333', '-13,328']);
  await cells('e_M2', ['13,290', '13,291', '13,288']);
  await page.fill('#e_zmax', '2,7');
  await page.fill('#e_pdd', '99,6');
  // ошибка ввода номинала: отклонение больше 20 % — запись только после подтверждения
  await page.fill('#e_nominal', '1,500');
  await pause(600);
  const erec = page.locator('#e-jrec');
  assert.match(await erec.innerText(), /больше 20 %: почти наверняка ошибка ввода/);
  await erec.locator('[data-jr=record]').click();
  await pause(400);
  assert.match(await page.locator('#e-status').innerText(), /Не записано: отклонение от номинала −32,5 %/);
  assert.match(await erec.locator('[data-jr=record]').innerText(), /Подтвердить запись: −32,5 %/);
  // номинал исправлен — обычная запись; R50 = 1,029·4,80 − 0,06 = 4,879 г/см², z_ref 2,83 см, k_Q 0,9138
  await page.fill('#e_nominal', '1,000');
  await pause(600);
  const el = await page.locator('#e-readout').innerText();
  assert.match(el, /Dw\(2,83 см\) = 100,80 сГр/);
  assert.match(el, /D\(zmax\) = 101,21 сГр/);
  assert.match(await erec.locator('[data-jr=record]').innerText(), /^Записать в журнал$/);
  await erec.locator('[data-jr=record]').click();
  await pause(500);
  assert.match(await page.locator('#e-status').innerText(), /Записано в журнал: Линак-Т1 — 12 МэВ/);

  // пластины: привязка 6 МВ к калибровке в воде и проверка
  await page.goto(`${server.url}/index.html#plates`);
  await page.waitForSelector('#plates-root .plates-card');
  const root = page.locator('#plates-root');
  await pick('#pl_beam', '^6 МВ');
  await page.fill('#plb_date', day(-5));
  await page.fill('#plb_rho', '1,045');
  await page.fill('#plb_depth', '10');
  await page.fill('#plb_amount', '100');
  await page.fill('#plb_T', '21,0');
  await page.fill('#plb_P', '100,2');
  for (let i = 0; i < 3; i++) await page.fill(`#plb-M_${i}`, '13,402');
  await root.locator('[data-pl=bind]').click();
  await pause();
  await page.fill('#plc_date', day(-4));
  await page.fill('#plc_T', '21,5');
  await page.fill('#plc_P', '100,4');
  for (let i = 0; i < 3; i++) await page.fill(`#plc-M_${i}`, '13,420');
  await pause();
  // M_pl/M_pl,0 = 1,0010 → 0,9953 · 1,0010 = 0,9963 сГр/МЕ
  assert.match(await root.locator('#plc-result').innerText(), /0,9963 сГр\/МЕ[\s\S]*= 1,0010/);
  await root.locator('[data-pl=record]').click();
  await pause();
  // дата в будущем — не записывается
  await page.fill('#plc_date', day(2));
  for (let i = 0; i < 3; i++) await page.fill(`#plc-M_${i}`, '13,420');
  await pause();
  assert.match(await root.locator('#plc-result').innerText(), /в будущем/);
  // другой пучок — температуру и давление измеряют заново
  await page.fill('#plc_T', '22,0');
  await page.fill('#plc_P', '100,1');
  await pick('#pl_beam', '^12 МэВ');
  assert.equal(await page.inputValue('#plb_T'), '');
  assert.equal(await page.inputValue('#plb_P'), '');

  // «Журнал и тренды»
  await page.goto(`${server.url}/index.html#history`);
  await pause(600);
  const spc = await page.locator('#hs-spc-summary').innerText();
  assert.match(spc, /Тренд появится, когда в отсчёте будет не меньше 10 записей за 30 дней/);
  assert.doesNotMatch(spc, /%\/мес/);
  // разделы 7 и 8 видны и без данных — номера разделов подряд
  assert.ok(await page.locator('#hs-check-sec').isVisible());
  assert.match(await page.locator('#hs-check-sec').innerText(), /Проверок второй камерой у этого аппарата пока нет/);
  assert.ok(await page.locator('#hs_check').isHidden());
  assert.match(await page.locator('#hs-plates').innerText(), /6 МВ\s+1,0010/);
  assert.match(await page.locator('#hs-messages').innerText(), /Срок калибровки не задан/i);
  const sessions = await page.locator('#hs-sessions').innerText();
  for (const k of [-5, -4, -3, -2, -1]) assert.match(sessions, new RegExp(dmy(day(k)).replace(/\./g, '\\.')));

  // сеанс: дата в будущем — начать нельзя
  await page.goto(`${server.url}/index.html#session`);
  await pause();
  await page.fill('#ss_date', day(3));
  await page.locator('#ss_date').dispatchEvent('change');
  await pause();
  assert.match(await page.locator('#session-root').innerText(), /в будущем/);
  assert.ok(await page.locator('#session-root [data-ss=start]').isDisabled());

  assert.deepEqual(errors, []);
});

test('«Журнал и тренды» без проверок: разделы 7 и 8 видны с пояснением', async () => {
  const { page, errors } = await openPage(browser);
  await page.goto(`${server.url}/index.html#history`);
  await page.evaluate(() => localStorage.setItem('reference-dosimetry.journal.v1', JSON.stringify({ journal: { app: 'reference-dosimetry', module: 'journal', version: 1, machines: [{ id: 'm1', name: 'Аппарат', kind: 'linac', beams: [{ id: 'b1', kind: 'photon', name: '6 МВ' }] }], chambers: [], electrometers: [], sessions: [] } })));
  await page.reload();
  await page.waitForTimeout(600);
  assert.match(await page.locator('#hs-plates').innerText(), /Проверок этого аппарата в пластинах пока нет/);
  const nums = await page.locator('#module-history .step:not([hidden]) .step-no').allInnerTexts();
  assert.deepEqual(nums, ['1', '2', '3', '4', '5', '6', '7', '8']);
  // по-английски — пояснения переведены
  await page.locator('#lang_en').check();
  await page.waitForTimeout(400);
  assert.match(await page.locator('#hs-check-sec').innerText(), /no second-chamber checks/);
  assert.deepEqual(errors, []);
});
