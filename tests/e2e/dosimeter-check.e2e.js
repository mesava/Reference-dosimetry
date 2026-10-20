// Проверка дозиметра второй камерой в браузере: раздел «Проверка дозиметра второй камерой» вкладки «МВ фотоны» у пучка
// журнала (по умолчанию пуст), расчёт и сравнение с прежними проверками, три системы, запись в журнал вместе с измерением; «Контроль дозиметра» в «Журнале и трендах» и перенос оценки
// стабильности в бюджет неопределённости (строка с семейством бюджета, статус «консервативно»); английский интерфейс.
// Журнал с историей проверок строится расчётным ядром (обезличенные данные).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, openPage, putOpenFile, CYR } from './helpers.js';
import { newJournal, normalizeJournal, finalizeSession, upsertSession, computeSessionBeam, recordedBase } from '../../src/core/journal.js';
import { newCheck, finalizeChecks } from '../../src/core/journal-check.js';

const c = (x) => String(x).replace('.', ',');
const M1 = [18.36, 18.36, 18.36];
const MOPP = [-18.37, -18.37, -18.38];
const M2 = [18.31, 18.31, 18.32];
const ENV = { T: '21,8', P: '1014,42', P_unit: 'hPa', H: '' };
const sc = (a, f) => a.map((x) => c(+(x * f).toFixed(4)));

/** Журнал: калибровка и 8 проверок выхода, в каждом сеансе — проверки второй камерой PTW 30013 № 2 и NE 2571 № 3. */
function journalWithChecks() {
  let j = newJournal();
  j.institution = 'Демо';
  j.chambers = [
    { id: 'w', form: { ch_model: 'PTW30013', ch_serial: '1', ch_ndw: c(0.05389) } },
    { id: 'w2', form: { ch_model: 'PTW30013', ch_serial: '2', ch_ndw: c(0.05402) } },
    { id: 'ne', form: { ch_model: 'NE2571', ch_serial: '3', ch_ndw: c(0.04523) } },
  ];
  j.electrometers = [{ id: 'e1', form: { el_model: 'UNIDOS', el_serial: '5', el_kelec: '1' } }, { id: 'e2', form: { el_model: 'Dose1', el_serial: '6', el_kelec: '1,002' } }];
  j.machines = [{ id: 'm1', name: 'Аппарат', kind: 'linac', beams: [{ id: 'b6', kind: 'photon', name: '6 МВ', chamberId: 'w', electrometerId: 'e1', form: { meta_fff: false, setup_geometry: 'SAD', rd_mu: '100', rd_V1: '400', rd_V2: '200', dd_on: false, dd_nominal: '1,000', dd_nominal_at: 'zref', qtrs_method: 'ratio', qtrs_v20: c(68.05), qtrs_v10: '100', kqtrs_mode: 'manual', kqtrs_manual: c(0.9875), kqtrs_src: 'Свидетельство (демо)', prof_mode: 'manual' } }] }];
  j = normalizeJournal(j);
  const noise = [0.04, -0.06, 0.02, 0.07, -0.03, -0.05, 0.05, -0.02, 0.0, 0.03];
  for (let i = 0; i < 9; i++) {
    const mode = i === 0 ? 'cal' : 'check';
    const s0 = { id: `s${i}`, machineId: 'm1', date: `2026-${String(1 + i).padStart(2, '0')}-1${i % 3}`, mode, protocol: 'trs', staff: ['Демо'], env: ENV, beams: [{ beamId: 'b6', rd_M1: sc(M1, 1), ...(mode === 'cal' ? { rd_Mopp: MOPP.map(c), rd_M2: M2.map(c) } : {}) }] };
    const fin = finalizeSession(j, s0);
    const w = computeSessionBeam(j, fin, { ...fin.beams[0], base: recordedBase(fin.beams[0].form) });
    const fW2 = ((1 + noise[i] / 100) * 0.05389) / 0.05402;
    const fNe = ((1 + noise[(i + 3) % 10] / 100) * 0.05389) / 0.04523;
    const checks = [
      { ...newCheck('b6', 'w2'), M: sc(M1, fW2), ...(i === 0 ? { Mopp: sc(MOPP, fW2), M2: sc(M2, fW2) } : {}) },
      { ...newCheck('b6', 'ne'), M: sc(M1, fNe), electrometerId: 'e2', ...(i === 0 ? { Mopp: sc(MOPP, fNe), M2: sc(M2, fNe) } : {}) },
    ];
    j = upsertSession(j, { ...fin, checks: finalizeChecks(j, fin, checks, new Map([['b6', w]])).checks });
  }
  return j;
}

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

test('проверка дозиметра: вкладка с пучком журнала, три системы, запись, карта пары, перенос в бюджет, английский', async () => {
  const { page, errors } = await openPage(browser);
  await page.goto(`${server.url}/index.html#history`);
  await page.waitForSelector('#hs-file h2');
  await putOpenFile(page, 'j.json', JSON.stringify(journalWithChecks()));
  await page.locator('#hs-file [data-jf=open]').click();
  await page.waitForTimeout(800);

  // вкладка «МВ фотоны»: проверка выхода пучка журнала 6 МВ
  await page.goto(`${server.url}/index.html#photons`);
  await page.waitForSelector('#messages li');
  await page.locator('#rd_fixed').check();
  await page.waitForTimeout(300);
  await page.locator('#ph-jbind [data-jb=machine]').selectOption({ label: 'Аппарат' });
  await page.waitForTimeout(300);
  await page.locator('#ph-jbind [data-jb=beam]').selectOption({ label: '6 МВ' });
  await page.waitForTimeout(500);
  assert.equal(await page.inputValue('#ch_serial'), '1', 'рабочая камера — последняя, которой мерили аппарат');
  await page.fill('#meta_date', '2026-10-12');
  await page.fill('#env_T', '21,8');
  await page.fill('#env_P', '1014,42');
  await page.selectOption('#env_P_unit', 'hPa');
  const cells = page.locator('.cells[data-series="rd_M1"] input');
  for (let i = 0; i < (await cells.count()); i++) await cells.nth(i).fill('18,36');
  await page.waitForTimeout(400);
  const box = page.locator('#ph-jcheck');
  assert.ok(await box.isVisible(), 'раздел проверки — у пучка журнала');
  assert.equal(await box.locator('.jsc').count(), 0, 'по умолчанию проверок нет');

  // проверка 1: NE 2571 со своим электрометром, показания — как в истории
  await box.locator('[data-ck-add]').click();
  await page.waitForTimeout(300);
  let ck = box.locator('.jsc').first();
  const opts = await ck.locator('[data-ck=chamberId] option').allInnerTexts();
  assert.ok(!opts.some((o) => /№ 1$/.test(o)), `рабочая камера не предлагается: ${opts}`);
  await ck.locator('[data-ck=chamberId]').selectOption({ label: opts.find((o) => /2571/.test(o)) });
  await page.waitForTimeout(300);
  ck = box.locator('.jsc').first();
  await ck.locator('[data-ck=electrometerId]').selectOption({ label: 'Dose1 № 6' });
  await page.waitForTimeout(300);
  ck = box.locator('.jsc').first();
  const v1 = c(((18.36 * 0.05389) / 0.04523).toFixed(3));
  const m = ck.locator('.cells[data-series$="-M"] input');
  for (let i = 0; i < (await m.count()); i++) await m.nth(i).fill(v1);
  await page.waitForTimeout(400);
  const res1 = await ck.locator('[data-check-result]').innerText();
  assert.match(res1, /Отношение доз рабочая \/ вторая/);
  assert.match(res1, /из проверки от 10\.01\.2026/, 'k_pol и k_s — из первой проверки этой камеры');
  assert.match(await ck.locator('[data-chip]').innerText(), /в пределах разброса/);

  // проверка 2: PTW 30013 № 2 со сдвигом 1 % — сдвиг только относительно неё
  await box.locator('[data-ck-add]').click();
  await page.waitForTimeout(300);
  let ck2 = box.locator('.jsc').nth(1);
  const opts2 = await ck2.locator('[data-ck=chamberId] option').allInnerTexts();
  await ck2.locator('[data-ck=chamberId]').selectOption({ label: opts2.find((o) => /№ 2$/.test(o)) });
  await page.waitForTimeout(300);
  ck2 = box.locator('.jsc').nth(1);
  const v2 = c(((18.36 * 0.05389) / 0.05402 / 1.01).toFixed(3));
  const m2 = ck2.locator('.cells[data-series$="-M"] input');
  for (let i = 0; i < (await m2.count()); i++) await m2.nth(i).fill(v2);
  await page.waitForTimeout(400);
  assert.match(await ck2.locator('[data-chip]').innerText(), /сдвиг/);
  assert.match(await box.locator('.jcheck-verdicts').innerText(), /вероятнее, изменилась она/);

  // запись: измерение и обе проверки
  await page.locator('#ph-jrec [data-jr=record]').click();
  await page.waitForTimeout(500);
  assert.match(await page.locator('#status').innerText(), /Проверок второй камерой: 2/);

  // «Журнал и тренды»: раздел 7, одна точка за 3σ, без ложных «8 подряд» у прежних точек
  await page.goto(`${server.url}/index.html#history`);
  await page.waitForTimeout(800);
  assert.ok(await page.locator('#hs-check-sec').isVisible());
  const pairs = await page.locator('#hs_check option').allInnerTexts();
  assert.equal(pairs.length, 2);
  await page.selectOption('#hs_check', { index: pairs.findIndex((t) => /№ 2$/.test(t)) });
  await page.waitForTimeout(300);
  const summary = await page.locator('#hs-check-summary').innerText();
  assert.match(summary, /точка за 3σ/);
  assert.match(summary, /не вошедших в расчёт границ: 1/);
  assert.doesNotMatch(summary, /8 точек подряд/);
  // запись журнала везде называется «запись», не «сеанс» (подраздела «Сеанс» больше нет)
  assert.doesNotMatch(await page.locator('#module-history').innerText(), /сеанс/i);

  // перенос оценки стабильности (пара с NE 2571) в бюджет неопределённости
  await page.selectOption('#hs_check', { index: pairs.findIndex((t) => /2571/.test(t)) });
  await page.waitForTimeout(300);
  await page.locator('#hs-check-unc').click();
  await page.waitForTimeout(600);
  assert.equal(await page.evaluate(() => location.hash), '#uncertainty');
  const over = JSON.parse((await page.inputValue('#unc_over')) || '{}');
  const notes = JSON.parse((await page.inputValue('#unc_row_notes')) || '{}');
  const key = Object.keys(over).find((k) => k.endsWith('.st_stab'));
  assert.ok(key, JSON.stringify(over));
  assert.equal(notes[key].st, 'cons');
  assert.equal(notes[key].src, 'meas');
  assert.equal(await page.locator(`#unc-budget input[data-unc-key="${key}"]`).inputValue(), over[key]);

  // английский: новые разделы без кириллицы (кроме названий из журнала)
  await page.goto(`${server.url}/index.html#history`);
  await page.waitForTimeout(500);
  await page.locator('#lang_en').check();
  await page.waitForTimeout(500);
  const en = (await page.locator('#hs-check-sec').innerText()).split('\n').filter((l) => CYR.test(l) && !/МВ|№/.test(l));
  assert.deepEqual(en, []);
  assert.doesNotMatch(await page.locator('#module-history').innerText(), /session/i);
  assert.deepEqual(errors, []);
});
