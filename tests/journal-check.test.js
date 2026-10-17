// Проверка дозиметра второй камерой (по желанию, в сеансе журнала): расчёт второй камеры по настройкам пучка сеанса
// и своим k_Q, k_vol; k_pol и k_s — измеренные, из прошлой проверки или 1; сравнение отношения с прежними проверками,
// новый отсчёт при смене N_D,w, три системы (TRS-398 Rev.1, разд. 4.4.2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newJournal, normalizeJournal, finalizeSession, upsertSession, computeSessionBeam, recordedBase, mainValue, CO_BEAM_KEYS } from '../src/core/journal.js';
import {
  newCheck, computeDosimeterCheck, checkRecord, finalizeChecks, checkHistory, checkMessages, checkVerdicts, checkPairs, checkChart, lastCheckFactors, SIGMA_FLOOR,
} from '../src/core/journal-check.js';
import { computePhotons, FORM_DEFAULTS } from '../src/core/photons.js';
import { computeElectrons, E_DEFAULTS } from '../src/core/electrons.js';
import { computeCobalt } from '../src/core/cobalt.js';
import { checksCsv } from '../src/core/journal-csv.js';
import { SAMPLE_COBALT } from '../src/core/sample-cobalt.js';

const c = (x) => String(x).replace('.', ',');
const cells = (a) => a.map(c);
const near = (a, b, rel, msg) => assert.ok(Math.abs(a / b - 1) <= rel, `${msg}: ${a} ≠ ${b} (±${rel})`);
const scale = (a, f) => a.map((x) => +(x * f).toFixed(6));
/** k_pol и k_s рабочей камеры — для второй камеры той же модели: тогда отношение 1 при тех же показаниях. */
const same = (w) => ({ kpol: c(w.summary.kpolRaw.toFixed(9)), ks: c(w.summary.ksRaw.toFixed(9)), kQ: c(0.9875) });

const B6 = { M1: [18.36, 18.36, 18.36], Mopp: [-18.37, -18.37, -18.38], M2: [18.31, 18.31, 18.32] };
const B10F = { M1: [16.67, 16.67, 16.68], Mopp: [-16.68, -16.66, -16.67], M2: [16.52, 16.52, 16.52] };
const ENV = { T: '21,8', P: c(1014.42), P_unit: 'hPa', H: '' };

function journal() {
  const j = newJournal();
  j.chambers = [
    { id: 'w', form: { ch_model: 'PTW30013', ch_serial: '1', ch_ndw: c(0.05389), ch_T0: '20', ch_P0: '101,325' } },
    { id: 'w2', form: { ch_model: 'PTW30013', ch_serial: '2', ch_ndw: c(0.05389), ch_T0: '20', ch_P0: '101,325' } },
    { id: 'ne', form: { ch_model: 'NE2571', ch_serial: '3', ch_ndw: c(0.04523), ch_T0: '20', ch_P0: '101,325' } },
    { id: 'pin', form: { ch_model: 'PTW31010', ch_serial: '4', ch_ndw: c(0.297), ch_T0: '20', ch_P0: '101,325' } },
  ];
  j.electrometers = [
    { id: 'e1', form: { el_model: 'UNIDOS', el_serial: '5', el_kelec: '1' } },
    { id: 'e2', form: { el_model: 'Dose1', el_serial: '6', el_kelec: '1,002' } },
  ];
  j.machines = [{
    id: 'm1', name: 'Аппарат', kind: 'linac',
    beams: [
      { id: 'b6', kind: 'photon', name: '6 МВ', chamberId: 'w', electrometerId: 'e1', form: { meta_fff: false, setup_geometry: 'SAD', rd_mu: '100', rd_V1: '400', rd_V2: '200', dd_on: false, dd_nominal: '1,000', dd_nominal_at: 'zref', qtrs_method: 'ratio', qtrs_v20: c(68.05), qtrs_v10: '100', kqtrs_mode: 'manual', kqtrs_manual: c(0.9875), prof_mode: 'manual' } },
      { id: 'b10f', kind: 'photon', name: '10 FFF', chamberId: 'pin', electrometerId: 'e1', form: { meta_fff: true, setup_geometry: 'SAD', rd_mu: '500', rd_V1: '400', rd_V2: '200', dd_on: false, dd_nominal: '1,000', dd_nominal_at: 'zref', qtrs_method: 'ratio', qtrs_v20: c(72.27), qtrs_v10: '100', kqtrs_mode: 'manual', kqtrs_manual: c(0.9789), prof_mode: 'formula22', prof_length: '6,5', prof_sdd: '100' } },
    ],
  }];
  return normalizeJournal(j);
}

const session = (date, mode = 'cal', extra = {}) => ({ id: `s${date}`, machineId: 'm1', date, mode, protocol: 'trs', env: ENV, beams: [{ beamId: 'b6', rd_M1: cells(B6.M1), ...(mode === 'cal' ? { rd_Mopp: cells(B6.Mopp), rd_M2: cells(B6.M2) } : {}) }], ...extra });
const work = (j, s, beamId = 'b6') => computeSessionBeam(j, s, s.beams.find((b) => b.beamId === beamId));

test('та же модель, тот же N_D,w, те же показания и k_Q — отношение ровно 1', () => {
  const j = journal();
  const s = session('2026-09-01');
  const chk = { ...newCheck('b6', 'w2'), M: cells(B6.M1), Mopp: cells(B6.Mopp), M2: cells(B6.M2), kQ: c(0.9875) };
  const r = computeDosimeterCheck(j, s, chk, work(j, s));
  assert.equal(r.ok, true, JSON.stringify(r.second.result.messages.filter((m) => m.level === 'error')));
  assert.equal(r.measured, true);
  near(r.ratio, 1, 1e-12, 'отношение');
  assert.equal(r.src.kpol, 'measured');
  assert.equal(r.sig.electrometerId, 'e1', 'электрометр — тот же, что у рабочей камеры');
  // рабочая камера сравнивается по основной серии (z_ref), как mainValue
  near(r.workValue, mainValue(work(j, s).result), 1e-15, 'основная серия');
});

test('вторая камера другой модели: k_Q — по её модели, а не ручной k_Q рабочей; совпадает с расчётом вкладки', () => {
  const j = journal();
  const s = session('2026-09-01');
  const M = scale(B6.M1, 0.05389 / 0.04523);
  const chk = { ...newCheck('b6', 'ne'), M: cells(M), Mopp: cells(scale(B6.Mopp, 0.05389 / 0.04523)), M2: cells(scale(B6.M2, 0.05389 / 0.04523)), electrometerId: 'e2' };
  const w = work(j, s);
  const r = computeDosimeterCheck(j, s, chk, w);
  assert.equal(r.ok, true);
  // независимо: форма вкладки «МВ фотоны» с той же геометрией и качеством пучка, камерой NE2571 и k_Q по формуле
  const tab = computePhotons({
    ...FORM_DEFAULTS, protocol: 'trs', setup_geometry: 'SAD', rd_mu: '100', rd_V1: '400', rd_V2: '200', dd_on: false, qtrs_method: 'ratio', qtrs_v20: c(68.05), qtrs_v10: '100',
    kqtrs_mode: 'formula', ch_model: 'NE2571', ch_ndw: c(0.04523), el_kelec: '1,002', env_T: ENV.T, env_P: ENV.P, env_P_unit: 'hPa',
    rd_M1: cells(M), rd_Mopp: cells(scale(B6.Mopp, 0.05389 / 0.04523)), rd_M2: cells(scale(B6.M2, 0.05389 / 0.04523)),
  });
  near(r.value, tab.trs.DperMU, 1e-12, 'доза второй камеры');
  near(r.ratio, w.result.trs.DperMU / tab.trs.DperMU, 1e-12, 'отношение');
  assert.notEqual(r.second.result.trs.kQ, 0.9875, 'не ручной k_Q рабочей камеры');
  assert.equal(r.sig.electrometerId, 'e2');
  assert.equal(r.second.summary.kelec, 1.002);
});

test('БВФ: k_vol второй камеры — по длине её полости, а не по длине, введённой для рабочей', () => {
  const j = journal();
  const s = { ...session('2026-09-01'), beams: [{ beamId: 'b10f', rd_M1: cells(B10F.M1), rd_Mopp: cells(B10F.Mopp), rd_M2: cells(B10F.M2) }] };
  const w = work(j, s, 'b10f');
  assert.equal(w.summary.ok, true);
  const r = computeDosimeterCheck(j, s, { ...newCheck('b10f', 'w'), M: cells(scale(B10F.M1, 0.297 / 0.05389)), kpol: '1', ks: '1,005' }, w);
  assert.equal(r.ok, true, JSON.stringify(r.second.result.messages.filter((m) => m.level === 'error')));
  const kvolWork = w.result.profile.value;
  const kvolSecond = r.second.result.profile.value;
  assert.ok(kvolSecond > kvolWork, `Фармер 23 мм: k_vol ${kvolSecond} > ${kvolWork} (6,5 мм)`);
  // свой k_vol для второй камеры
  const own = computeDosimeterCheck(j, s, { ...newCheck('b10f', 'w'), M: cells(scale(B10F.M1, 0.297 / 0.05389)), kvol: '1,004' }, w);
  assert.equal(own.second.result.profile.value, 1.004);
  assert.equal(own.src.kpol, 'assumed');
});

test('k_pol и k_s второй камеры: введённые, из прошлой проверки этой камеры в этом пучке или 1', () => {
  let j = journal();
  const s1 = session('2026-09-01');
  const w1 = work(j, s1);
  const first = computeDosimeterCheck(j, s1, { ...newCheck('b6', 'w2'), M: cells(B6.M1) }, w1);
  assert.deepEqual(first.src, { kpol: 'assumed', ks: 'assumed' });
  assert.ok(checkMessages(first, null).some((m) => /приняты равными 1/.test(m.text)));
  // измерены — записываются
  const measured = { ...newCheck('b6', 'w2'), M: cells(B6.M1), Mopp: cells(B6.Mopp), M2: cells(B6.M2), kQ: c(0.9875) };
  const fin = finalizeSession(j, s1);
  const { checks } = finalizeChecks(j, fin, [measured], new Map([['b6', w1]]));
  assert.equal(checks.length, 1);
  assert.equal(checks[0].summary.measured, true);
  j = upsertSession(j, { ...fin, checks });
  const f = lastCheckFactors(j, { beamId: 'b6', chamberId: 'w2' });
  near(f.kpol, w1.summary.kpolRaw, 1e-12, 'k_pol');
  near(f.ks, w1.summary.ksRaw, 1e-12, 'k_s');
  // следующая проверка без показаний при V₂ и обратной полярности — k_pol и k_s из прошлой проверки: то же отношение 1
  const s2 = session('2026-10-01', 'check');
  const w2 = work(j, s2);
  const next = computeDosimeterCheck(j, s2, { ...newCheck('b6', 'w2'), M: cells(B6.M1), kQ: c(0.9875) }, w2);
  assert.deepEqual(next.src, { kpol: 'previous', ks: 'previous' });
  near(next.ratio, 1, 1e-6, 'отношение');
  assert.ok(checkMessages(next, null).some((m) => /из проверки от 01\.09\.2026/.test(m.text)));
  // введённое — важнее
  const manual = computeDosimeterCheck(j, s2, { ...newCheck('b6', 'w2'), M: cells(B6.M1), kpol: '1,001' }, w2);
  assert.deepEqual(manual.src, { kpol: 'manual', ks: 'previous' });
  // для другой камеры прошлой проверки нет
  assert.equal(lastCheckFactors(j, { beamId: 'b6', chamberId: 'ne' }), null);
});

/** Журнал с n проверками пары «w / w2» в пучке 6 МВ: отношение 1 + d_i/100 (показания второй камеры масштабируются). */
function withChecks(diffs, { ndwFrom = Infinity, ndw2 = 0.05389 } = {}) {
  let j = journal();
  // калибровка рабочей камеры — для проверок выхода (k_pol и k_s рабочей камеры — из неё)
  j = upsertSession(j, finalizeSession(j, session('2025-12-01')));
  diffs.forEach((d, i) => {
    const date = `2026-${String(1 + Math.floor(i / 2)).padStart(2, '0')}-${i % 2 ? '15' : '01'}`;
    if (i === ndwFrom) j = { ...j, chambers: j.chambers.map((ch) => (ch.id === 'w2' ? { ...ch, form: { ...ch.form, ch_ndw: c(ndw2) } } : ch)) };
    const s = session(date, 'check', { id: `s${i}` });
    const fin = finalizeSession(j, s);
    const w = computeSessionBeam(j, fin, { ...fin.beams[0], base: recordedBase(fin.beams[0].form) });
    const M = cells(scale(B6.M1, 1 / (1 + d / 100) * (0.05389 / (i >= ndwFrom ? ndw2 : 0.05389))));
    const { checks } = finalizeChecks(j, fin, [{ ...newCheck('b6', 'w2'), M, ...same(w) }], new Map([['b6', w]]));
    j = upsertSession(j, { ...fin, checks });
  });
  return j;
}

test('сравнение с прежними проверками: среднее, σ (не меньше 0,1 %), z; сдвиг больше 3σ — предупреждение', () => {
  const j = withChecks([0.30, 0.32, 0.28, 0.31, 0.29, 0.30]);
  const s = session('2026-12-01', 'check');
  const w = work(j, s);
  // M второй камеры на 1 % меньше — отношение на 1 % больше, чем при d = 0
  const r = computeDosimeterCheck(j, s, { ...newCheck('b6', 'w2'), M: cells(scale(B6.M1, 1 / 1.013)), ...same(w) }, w);
  const h = checkHistory(j, s, r);
  assert.equal(h.n, 6);
  assert.ok(Math.abs(h.mean - 0.30) < 0.01, `среднее ${h.mean}`);
  assert.equal(h.sigma, SIGMA_FLOOR, 'σ = 0,014 % меньше разрешения электрометра — взято 0,1 %');
  assert.ok(h.z > 9, `z = ${h.z}`);
  const msgs = checkMessages(r, h);
  assert.ok(msgs.some((m) => m.level === 'warn' && /Отношение сместилось/.test(m.text) && /4\.4\.2/.test(m.ref)));
  // обычная проверка — в пределах разброса
  const ok = computeDosimeterCheck(j, s, { ...newCheck('b6', 'w2'), M: cells(scale(B6.M1, 1 / 1.003)), ...same(w) }, w);
  const hok = checkHistory(j, s, ok);
  assert.ok(Math.abs(hok.z) < 2, `z = ${hok.z}`);
  assert.ok(checkMessages(ok, hok).some((m) => /В пределах обычного разброса/.test(m.text)));
  // одна и та же камера через тот же электрометр — замечание, что электрометр так не проверяется
  assert.ok(checkMessages(ok, hok).some((m) => /с одним электрометром/.test(m.text)));
  // открытый для правки записанный сеанс не сравнивается сам с собой и с более поздними
  const old = j.sessions.find((x) => x.id === 's2');
  const ho = checkHistory(j, old, computeDosimeterCheck(j, old, { ...newCheck('b6', 'w2'), M: cells(scale(B6.M1, 1 / 1.0028)), ...same(work(j, session(old.date, 'check', { id: old.id }))) }, work(j, session(old.date, 'check', { id: old.id }))));
  assert.equal(ho.n, 2);
});

test('смена N_D,w второй камеры — новый отсчёт; карта пары и оценка стабильности по текущему отсчёту', () => {
  const j = withChecks([0.30, 0.32, 0.28, 0.31, 0.29, 0.10, 0.12, 0.08, 0.11, 0.09, 0.10], { ndwFrom: 5, ndw2: 0.05400 });
  const pairs = checkPairs(j, 'm1');
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].n, 11);
  assert.equal(pairs[0].beamName, '6 МВ');
  const cc = checkChart(j, pairs[0]);
  assert.equal(cc.chart.segments.length, 2);
  assert.equal(cc.chart.segments[1].reason, 'equipment');
  assert.equal(cc.stats.n, 6);
  assert.ok(Math.abs(cc.stats.mean - 0.10) < 0.01, `среднее ${cc.stats.mean}`);
  assert.ok(cc.u > 0.01 && cc.u < 0.03, `u = ${cc.u}`);
  // сразу после смены: прежних проверок в отсчёте нет
  const s = session('2026-12-01', 'check');
  const jj = withChecks([0.30, 0.32, 0.28, 0.31, 0.29], {});
  const j2 = { ...jj, chambers: jj.chambers.map((ch) => (ch.id === 'w2' ? { ...ch, form: { ...ch.form, ch_ndw: c(0.054) } } : ch)) };
  const r = computeDosimeterCheck(j2, s, { ...newCheck('b6', 'w2'), M: cells(B6.M1), ...same(work(j2, s)) }, work(j2, s));
  const h = checkHistory(j2, s, r);
  assert.equal(h.restart, true);
  assert.equal(h.n, 0);
  assert.ok(checkMessages(r, h).some((m) => /начинается заново/.test(m.text)));
});

test('три системы: сдвиг относительно обеих вторых камер одного знака — рабочая; только одной — эта камера', () => {
  const mk = (z1, z2) => [
    { res: { ok: true, check: { beamId: 'b6', chamberId: 'w2' } }, hist: { z: z1 } },
    { res: { ok: true, check: { beamId: 'b6', chamberId: 'ne' } }, hist: { z: z2 } },
  ];
  assert.equal(checkVerdicts(mk(3.5, 2.6))[0].verdict, 'work');
  assert.equal(checkVerdicts(mk(3.5, 0.4))[0].verdict, 'second');
  assert.equal(checkVerdicts(mk(3.5, 0.4))[0].shifted[0].check.chamberId, 'w2');
  assert.equal(checkVerdicts(mk(3.5, -3))[0].verdict, 'unclear');
  assert.equal(checkVerdicts(mk(0.5, -1))[0].verdict, 'none');
  assert.deepEqual(checkVerdicts([mk(3, 3)[0]]), [], 'одна проверка — вывода нет');
});

test('проверки с ошибкой не записываются; запись — форма второй камеры и итог', () => {
  const j = journal();
  const s = finalizeSession(j, session('2026-09-01'));
  const w = computeSessionBeam(j, s, { ...s.beams[0], base: recordedBase(s.beams[0].form) });
  const noNdw = { ...journal(), chambers: journal().chambers.map((ch) => (ch.id === 'ne' ? { ...ch, form: { ...ch.form, ch_ndw: '' } } : ch)) };
  const bad = computeDosimeterCheck(noNdw, s, { ...newCheck('b6', 'ne'), M: cells(B6.M1) }, w);
  assert.equal(bad.ok, false);
  assert.ok(checkMessages(bad, null).some((m) => m.level === 'error' && /^Вторая камера/.test(m.text)));
  const { checks, skipped } = finalizeChecks(noNdw, s, [{ ...newCheck('b6', 'ne'), M: cells(B6.M1) }, { ...newCheck('b6', 'w2'), M: [] }], new Map([['b6', w]]));
  assert.deepEqual([checks.length, skipped], [0, 1], 'без показаний — не проверка');
  const rec = checkRecord(computeDosimeterCheck(j, s, { ...newCheck('b6', 'ne'), M: cells(B6.M1) }, w));
  assert.equal(rec.form.ch_model, 'NE2571');
  assert.equal(rec.summary.workChamberId, 'w');
  assert.equal(rec.summary.at, 'zref');
  assert.ok(Number.isFinite(rec.summary.diff));
  // записанная проверка считается по своей форме: после поверки второй камеры (новый N_D,w) — прежний результат
  const j2 = upsertSession(j, { ...s, checks: [rec] });
  const j3 = { ...j2, chambers: j2.chambers.map((ch) => (ch.id === 'ne' ? { ...ch, form: { ...ch.form, ch_ndw: c(0.046) } } : ch)) };
  const again = computeDosimeterCheck(j3, s, rec, w);
  near(again.ratio, rec.summary.ratio, 1e-12, 'отношение по записанной форме');
});

test('электроны и ⁶⁰Co: k_Q второй камеры по её модели; ошибка таймера ⁶⁰Co — та же, что у рабочей камеры', () => {
  // электроны: рабочая — Roos с ручным k_Q, вторая — NACP-02 (табличный k_Q)
  const j = journal();
  j.chambers.push({ id: 'roos', form: { ch_model: 'ROOS', ch_serial: '7', ch_ndw: c(0.08287) } }, { id: 'nacp', form: { ch_model: 'NACP02', ch_serial: '8', ch_ndw: c(0.1586) } });
  j.machines[0].beams.push({ id: 'e10', kind: 'electron', name: '10 МэВ', chamberId: 'roos', electrometerId: 'e1', form: { e_energy: '10', e_ssd: '100', e_field: '10', e_r50_method: 'r50', e_r50: c(3.95), e_pdd: c(99.93), e_mu: '100', e_V1: '200', e_V2: '100', e_dd_on: false, e_nominal: '1,000', e_kqtrs_mode: 'manual', e_kqtrs_manual: c(0.9229) } });
  const je = normalizeJournal(j);
  const s = { id: 'se', machineId: 'm1', date: '2026-09-01', mode: 'cal', protocol: 'trs', env: { T: c(22.95), P: c(1030.315), P_unit: 'hPa' }, beams: [{ beamId: 'e10', e_M1: ['13,11', '13,11', '13,12'], e_Mopp: ['-13,11', '-13,11', '-13,11'], e_M2: ['13,03', '13,03', '13,03'] }] };
  const w = computeSessionBeam(je, s, s.beams[0]);
  assert.equal(w.summary.ok, true);
  const r = computeDosimeterCheck(je, s, { ...newCheck('e10', 'nacp'), M: ['6,85', '6,85', '6,86'], kpol: '1', ks: '1,002' }, w);
  assert.equal(r.ok, true, JSON.stringify(r.second?.result.messages.filter((m) => m.level === 'error')));
  const tab = computeElectrons({ ...E_DEFAULTS, protocol: 'trs', ...pickBeam(je, 'e10'), e_kqtrs_mode: 'table', e_ch_model: 'NACP02', e_ndw: c(0.1586), e_kelec: '1', e_env_T: c(22.95), e_env_P: c(1030.315), e_env_P_unit: 'hPa', e_M1: ['6,85', '6,85', '6,86'], e_fixed: true, e_fixed_kpol: '1', e_fixed_ks: '1,002' });
  near(r.value, tab.trs.DperMU, 1e-12, 'доза NACP-02');
  assert.notEqual(r.second.result.trs.kQ, 0.9229);

  // ⁶⁰Co: τ измерена рабочей камерой в сеансе калибровки — у второй камеры та же τ
  const jc = newJournal();
  jc.chambers = [{ id: 'cNE', form: { ch_model: 'NE2571', ch_serial: '0', ch_ndw: '0,04523' } }, { id: 'c13', form: { ch_model: 'PTW30013', ch_serial: '9', ch_ndw: '0,05389' } }];
  jc.electrometers = [{ id: 'e1', form: { el_model: 'E', el_kelec: '1,000' } }];
  jc.machines = [{ id: 'mc', name: '⁶⁰Co', kind: 'cobalt', beams: [{ id: 'bco', kind: 'cobalt', name: '⁶⁰Co', chamberId: 'cNE', electrometerId: 'e1', form: Object.fromEntries(CO_BEAM_KEYS.filter((k) => k in SAMPLE_COBALT).map((k) => [k, SAMPLE_COBALT[k]])) }] }];
  const jco = normalizeJournal(jc);
  const sc = { id: 'sc', machineId: 'mc', date: '2026-09-01', mode: 'cal', protocol: 'trs', env: { T: '21,0', P: '100,5', P_unit: 'kPa' }, beams: [{ beamId: 'bco', co_M1: SAMPLE_COBALT.co_M1, co_Mopp: SAMPLE_COBALT.co_Mopp, co_M2: SAMPLE_COBALT.co_M2, co_tt: SAMPLE_COBALT.co_tt, co_tm: SAMPLE_COBALT.co_tm }] };
  const wc = computeSessionBeam(jco, sc, sc.beams[0]);
  assert.equal(wc.summary.ok, true);
  const M = SAMPLE_COBALT.co_M1.map((x) => c((parseFloat(String(x).replace(',', '.')) * 0.04523 / 0.05389).toFixed(3)));
  const rc = computeDosimeterCheck(jco, sc, { ...newCheck('bco', 'c13'), M }, wc);
  assert.equal(rc.ok, true, JSON.stringify(rc.second?.result.messages.filter((m) => m.level === 'error')));
  near(rc.second.result.timer.tau, wc.result.timer.tau, 1e-6, 'τ');
  assert.ok(Math.abs(rc.diff) < 1, `${rc.diff}`);
  // мерили и k_pol, k_s — режим калибровки второй камеры с той же τ
  const rc2 = computeDosimeterCheck(jco, sc, { ...newCheck('bco', 'c13'), M, Mopp: M.map((x) => `-${x}`), M2: M }, wc);
  assert.equal(rc2.ok, true, JSON.stringify(rc2.second?.result.messages.filter((m) => m.level === 'error')));
  near(rc2.second.result.timer.tau, wc.result.timer.tau, 1e-6, 'τ при измеренных k');
  assert.equal(computeCobalt(rc2.second.form).trs.rate, rc2.value);
});

function pickBeam(j, id) {
  for (const m of j.machines) for (const b of m.beams) if (b.id === id) return b.form;
  return {};
}

test('выгрузка проверок в CSV: строка на проверку, отношение и сигналы карты', () => {
  const j = withChecks([0.30, 0.32, 0.28, 0.31, 0.29, 1.5]);
  const csv = checksCsv(j);
  assert.ok(csv.startsWith('\uFEFF'));
  const lines = csv.trim().split('\r\n');
  assert.equal(lines.length, 1 + 6);
  assert.match(lines[0], /Отношение − 1, %/);
  const last = lines.at(-1).split(';');
  assert.equal(last[4], '6 МВ');
  assert.match(last[8], /PTW 30013 № 2/);
  assert.ok(Math.abs(parseFloat(last[15].replace(',', '.')) - 1.5) < 0.01, last[15]);
  assert.match(lines.at(-1), /за 3σ/);
});

test('k_pol и k_s «приняты 1» → измерены: новый отсчёт, без ложного сдвига (пучок БВФ)', () => {
  let j = journal();
  // калибровка пучка БВФ рабочей камерой
  const cal = (date) => ({ id: `c${date}`, machineId: 'm1', date, mode: 'cal', protocol: 'trs', env: ENV, beams: [{ beamId: 'b10f', rd_M1: cells(B10F.M1), rd_Mopp: cells(B10F.Mopp), rd_M2: cells(B10F.M2) }] });
  const chkS = (date, id) => ({ id, machineId: 'm1', date, mode: 'check', protocol: 'trs', env: ENV, beams: [{ beamId: 'b10f', rd_M1: cells(B10F.M1) }] });
  j = upsertSession(j, finalizeSession(j, cal('2026-01-05')));
  const f = 0.297 / 0.05389; // та же доза второй камерой (PTW 30013) — показания в f раз больше
  const second = (Mx) => ({ ...newCheck('b10f', 'w'), M: cells(scale(B10F.M1, f * Mx)) });
  // четыре проверки без k_pol и k_s второй камеры: k_s принят 1 — отношение смещено, но стабильно
  ['2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01'].forEach((date, i) => {
    const fin = finalizeSession(j, chkS(date, `p${i}`));
    const w = computeSessionBeam(j, fin, { ...fin.beams[0], base: recordedBase(fin.beams[0].form) });
    const { checks } = finalizeChecks(j, fin, [second(1 + [0, 0.0003, -0.0002, 0.0001][i])], new Map([['b10f', w]]));
    assert.equal(checks[0].summary.basis, 'assumed');
    j = upsertSession(j, { ...fin, checks });
  });
  // пятая — с измеренными k_pol и k_s (k_s второй камеры ≈ 1,01 в пучке БВФ)
  const s5 = chkS('2026-06-01', 'p4');
  const w5 = work(j, s5, 'b10f');
  const M = scale(B10F.M1, f);
  const measured = { ...newCheck('b10f', 'w'), M: cells(M), Mopp: cells(M.map((x) => -x)), M2: cells(scale(M, 0.985)) };
  const r = computeDosimeterCheck(j, s5, measured, w5);
  assert.equal(r.ok, true);
  assert.equal(r.sig.basis, 'known');
  const h = checkHistory(j, s5, r);
  assert.equal(h.restart, true);
  assert.equal(h.reason, 'factors');
  assert.equal(h.n, 0, 'с проверками «принято 1» не сравнивается');
  assert.ok(checkMessages(r, h).some((m) => /теперь известны/.test(m.text)));
  // в предварительной проверке пучка БВФ — предупреждение, а не справка
  const prov = computeDosimeterCheck(j, s5, second(1), w5);
  assert.ok(checkMessages(prov, checkHistory(j, s5, prov)).some((m) => m.level === 'warn' && /Проверка предварительная/.test(m.text)));
  // карта пары: два отсчёта, на точке после измерения сигнала нет
  const { finalizeChecks: fc } = { finalizeChecks };
  const fin5 = finalizeSession(j, s5);
  const w5r = computeSessionBeam(j, fin5, { ...fin5.beams[0], base: recordedBase(fin5.beams[0].form) });
  j = upsertSession(j, { ...fin5, checks: fc(j, fin5, [measured], new Map([['b10f', w5r]])).checks });
  const cc = checkChart(j, checkPairs(j, 'm1')[0]);
  assert.equal(cc.chart.segments.length, 2);
  assert.equal(cc.chart.segments[1].reason, 'factors');
  assert.deepEqual(cc.chart.points.at(-1).signals, []);
  assert.ok(cc.chart.points.slice(0, 4).every((p) => p.provisional));
});
