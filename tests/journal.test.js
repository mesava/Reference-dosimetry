// Журнал калибровок: сборка формы вкладки «МВ фотоны» из профилей оборудования и показаний сеанса,
// калибровка и проверка выхода (k_pol и k_s из последней калибровки того же пучка), сроки калибровки, тренды.
// Данные — рабочая книга реальной калибровки (Elekta Versa HD, 25.08.2026), как в workbook.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newJournal, normalizeJournal, finalizeSession, upsertSession, computeSessionBeam, lastCalibration, trendSeries,
  dueStatus, equipmentDue, beamFromPhotonsForm, photonBeamForm, applyPhotonsFormToBeam, recordedBase, chamberMissing, electrometerMissing, chamberUses, photonCapable, electronCapable,
  electronChamberForm, chamberFormFromElectrons, beamFromTabForm, applyTabFormToBeam,
  E_BEAM_KEYS, E_CHAMBER_KEYS, E_ELECTROMETER_KEYS, E_SESSION_KEYS, E_QUALITY_KEYS, PH_BEAM_KEYS, PH_CHAMBER_KEYS, PH_SESSION_KEYS, PH_ELECTROMETER_KEYS,
  CO_BEAM_KEYS, CO_CHAMBER_KEYS, CO_ELECTROMETER_KEYS, CO_SESSION_KEYS, cobaltChamberForm, chamberFormFromCobalt, cobaltCapable, journalFormat,
} from '../src/core/journal.js';
import { computeCobalt, CO_DEFAULTS, decayFactor } from '../src/core/cobalt.js';
import { SAMPLE_COBALT } from '../src/core/sample-cobalt.js';
import { computePhotons, FORM_DEFAULTS } from '../src/core/photons.js';
import { computeElectrons, E_DEFAULTS } from '../src/core/electrons.js';
import { parseNumber } from '../src/core/units.js';

const c = (x) => String(x).replace('.', ',');
const cells = (a) => a.map(c);
const near = (a, b, rel, msg) => assert.ok(Math.abs(a / b - 1) <= rel, `${msg}: ${a} ≠ ${b} (±${rel * 100} %)`);

const BEAMS = [
  { id: 'b6', name: '6 МВ', fff: false, ch: 'c30013', mu: 100, M1: [18.36, 18.36, 18.36], Mopp: [-18.37, -18.37, -18.38], M2: [18.31, 18.31, 18.32], C: [18.65, 18.64, 18.65], kq: 0.9875, tpr: 0.6805, H: 100.0070960618935 },
  { id: 'b10', name: '10 МВ', fff: false, ch: 'c30013', mu: 100, M1: [18.73, 18.72, 18.71], Mopp: [-18.74, -18.75, -18.74], M2: [18.66, 18.65, 18.66], C: [18.75, 18.74, 18.75], kq: 0.9758, tpr: 0.7377, H: 99.45987611173346 },
  { id: 'b10f', name: '10 FFF', fff: true, ch: 'c31010', mu: 500, M1: [16.67, 16.67, 16.68], Mopp: [-16.68, -16.66, -16.67], M2: [16.52, 16.52, 16.52], C: [16.95, 16.95, 16.96], kq: 0.9789, tpr: 0.7227, H: 500.0008479241143 },
];

function journal() {
  const j = newJournal();
  j.institution = 'Пример';
  j.chambers = [
    { id: 'c30013', kind: 'photon', form: { ch_model: 'PTW30013', ch_serial: '1', ch_ndw: c(0.05389), ch_T0: '20', ch_P0: '101,325' }, calDate: '2025-06-01', dueDate: '2026-11-01' },
    { id: 'c31010', kind: 'photon', form: { ch_model: 'PTW31010', ch_serial: '2', ch_ndw: c(0.297), ch_T0: '20', ch_P0: '101,325' }, calDate: '2024-06-01', dueDate: '2026-09-01' },
  ];
  j.electrometers = [{ id: 'e1', form: { el_model: 'UNIDOS', el_serial: '3', el_kelec: '1' }, dueDate: '2027-06-01' }];
  j.machines = [{
    id: 'm1', name: 'Versa HD', serial: '1', kind: 'linac',
    beams: BEAMS.map((b) => ({
      id: b.id, kind: 'photon', name: b.name, chamberId: b.ch, electrometerId: 'e1',
      form: {
        meta_fff: b.fff, setup_geometry: 'SAD', rd_mu: String(b.mu), rd_V1: '400', rd_V2: '200', rd_polarity: '+',
        dd_on: false, dd_nominal: '1,000', dd_nominal_at: 'zref', qtrs_method: 'ratio', qtrs_v20: c(b.tpr * 100), qtrs_v10: '100',
        kqtrs_mode: 'manual', kqtrs_manual: c(b.kq), prof_mode: b.fff ? 'formula22' : 'manual', prof_length: b.fff ? '6,5' : '', prof_sdd: b.fff ? '100' : '',
      },
    })),
  }];
  return normalizeJournal(j);
}

const ENV = { T: '21,8', P: c(1014.42), P_unit: 'hPa', H: '' };

test('ключи формы «МВ фотоны» разделены между пучком, камерой, электрометром и сеансом без пересечений и пропусков', () => {
  const all = [...PH_BEAM_KEYS, ...PH_CHAMBER_KEYS, ...PH_ELECTROMETER_KEYS, ...PH_SESSION_KEYS];
  assert.equal(new Set(all).size, all.length);
  for (const k of Object.keys(FORM_DEFAULTS)) assert.ok(all.includes(k), k);
});

test('калибровка: доза каждого пучка совпадает с рабочей книгой и с расчётом вкладки', () => {
  const j = journal();
  const s = finalizeSession(j, {
    machineId: 'm1', date: '2026-08-25', mode: 'cal', protocol: 'trs', env: ENV,
    beams: BEAMS.map((b) => ({ beamId: b.id, rd_M1: cells(b.M1), rd_Mopp: cells(b.Mopp), rd_M2: cells(b.M2), ctrl_M: cells(b.C) })),
  });
  for (const b of BEAMS) {
    const sb = s.beams.find((x) => x.beamId === b.id);
    assert.equal(sb.summary.ok, true, b.name);
    assert.equal(sb.summary.errors, 0, b.name);
    assert.equal(sb.summary.source, 'ctrl');
    assert.equal(sb.summary.at, 'zref');
    near(sb.summary.value * b.mu, b.H, 3e-6, `${b.name}: доза за ${b.mu} МЕ`);
    // форма, записанная в сеанс, даёт тот же результат на вкладке
    near(computePhotons(sb.form).trs.ctrl.DcGy, b.H, 3e-6, b.name);
    assert.equal(sb.summary.status, Math.abs(sb.summary.deviation) > 2 ? 'out' : 'ok');
  }
});

test('проверка выхода: k_pol и k_s — из последней калибровки этого пучка; те же показания дают ту же дозу', () => {
  let j = journal();
  const cal = finalizeSession(j, {
    machineId: 'm1', date: '2026-08-25', mode: 'cal', protocol: 'trs', env: ENV,
    beams: BEAMS.map((b) => ({ beamId: b.id, rd_M1: cells(b.M1), rd_Mopp: cells(b.Mopp), rd_M2: cells(b.M2), ctrl_M: cells(b.C) })),
  });
  j = upsertSession(j, cal);
  const chk = finalizeSession(j, {
    machineId: 'm1', date: '2026-09-25', mode: 'check', protocol: 'trs', env: ENV,
    beams: BEAMS.map((b) => ({ beamId: b.id, rd_M1: cells(b.C) })),
  });
  for (const b of BEAMS) {
    const cb = cal.beams.find((x) => x.beamId === b.id).summary;
    const kb = chk.beams.find((x) => x.beamId === b.id);
    assert.equal(kb.summary.ksFixed, true);
    near(kb.summary.ksRaw, cb.ksRaw, 1e-6, `${b.name}: k_s своего пучка`);
    near(kb.summary.kpolRaw, cb.kpolRaw, 1e-6, `${b.name}: k_pol своего пучка`);
    near(kb.summary.value, cb.value, 2e-6, `${b.name}: доза`);
    assert.equal(kb.form.rd_fixed_from, '25.08.2026');
  }
  // у разных энергий — разные k_s
  const ks = BEAMS.map((b) => lastCalibration(j, b.id).ks);
  assert.equal(new Set(ks).size, 3);
  // до первой калибровки проверка невозможна: ошибка «k_s из калибровки не заполнено»
  const early = computeSessionBeam(j, { machineId: 'm1', date: '2026-08-01', mode: 'check', protocol: 'trs', env: ENV }, { beamId: 'b6', rd_M1: cells(BEAMS[0].C) });
  assert.equal(early.last, null);
  assert.equal(early.summary.ok, false);
  assert.equal(early.result.flags.rd_fixed_ks, 'error');
  // тренд: две точки у каждого пучка, k_s — только у калибровки
  const tr = trendSeries(upsertSession(j, chk), 'm1');
  assert.equal(tr.length, 3);
  for (const t of tr) {
    assert.deepEqual(t.points.map((p) => p.mode), ['cal', 'check']);
    assert.ok(Number.isFinite(t.points[0].ks) && Number.isNaN(t.points[1].ks));
  }
});

test('проверка выхода берёт качество пучка из последней калибровки, а не из профиля', () => {
  let j = journal();
  const b = BEAMS[0];
  j = upsertSession(j, finalizeSession(j, {
    machineId: 'm1', date: '2026-08-25', mode: 'cal', protocol: 'trs', env: ENV,
    beams: [{ beamId: b.id, rd_M1: cells(b.M1), rd_Mopp: cells(b.Mopp), rd_M2: cells(b.M2), qtrs_v20: '67,9', qtrs_v10: '100' }],
  }));
  const { form } = photonBeamForm(j, { machineId: 'm1', date: '2026-09-01', mode: 'check', protocol: 'trs', env: ENV }, j.machines[0], j.machines[0].beams[0], { rd_M1: cells(b.M1) });
  assert.equal(form.qtrs_v20, '67,9');
});

test('сроки калибровки: прошёл, подходит (≤ 30 дней), в порядке, не задан', () => {
  assert.equal(dueStatus('2026-10-01', '2026-10-08').status, 'overdue');
  assert.equal(dueStatus('2026-11-01', '2026-10-08').status, 'soon');
  assert.equal(dueStatus('2027-01-01', '2026-10-08').status, 'ok');
  assert.equal(dueStatus('', '2026-10-08').status, 'none');
  const due = equipmentDue(journal(), '2026-10-08');
  assert.deepEqual(due.map((d) => [d.id, d.status]), [['c31010', 'overdue'], ['c30013', 'soon']]);
});

test('пучок из вкладки «МВ фотоны»: камера и электрометр находятся по модели и номеру или добавляются', () => {
  const j = journal();
  const form = { ...FORM_DEFAULTS, meta_beam: '6 МВ БВФ', ch_model: 'PTW30013', ch_serial: '1', ch_ndw: '0,05389', el_model: 'UNIDOS', el_serial: '3', el_kelec: '1', rd_V1: '300', qtrs_v20: '66,0', qtrs_v10: '100' };
  const r = beamFromPhotonsForm(j, 'm1', form);
  assert.equal(r.addedChamber, false);
  assert.equal(r.addedElectrometer, false);
  assert.equal(r.beam.chamberId, 'c30013');
  assert.equal(r.beam.form.meta_fff, true, 'БВФ — по названию пучка');
  assert.equal(r.beam.form.rd_V1, '300');
  assert.equal(r.beam.form.qtrs_v20, '66,0');
  assert.equal(r.journal.machines[0].beams.length, 4);
  assert.equal(j.machines[0].beams.length, 3, 'исходный журнал не меняется');
  const r2 = beamFromPhotonsForm(j, 'm1', { ...form, ch_serial: '99' });
  assert.equal(r2.addedChamber, true);
  assert.equal(r2.journal.chambers.length, 3);
});

test('открытый из журнала сеанс считается по записанным в нём настройкам, а не по сегодняшнему оборудованию', () => {
  let j = journal();
  const b = BEAMS[0];
  const cal = finalizeSession(j, {
    machineId: 'm1', date: '2026-08-25', mode: 'cal', protocol: 'trs', env: ENV,
    beams: [{ beamId: b.id, rd_M1: cells(b.M1), rd_Mopp: cells(b.Mopp), rd_M2: cells(b.M2) }],
  });
  j = upsertSession(j, cal);
  const rec = cal.beams[0];
  // после записи камеру перекалибровали: N_D,w другой
  j.chambers[0].form.ch_ndw = '0,055';
  const sess = { id: cal.id, machineId: 'm1', date: '2026-08-25', mode: 'cal', protocol: 'trs', env: ENV };
  const input = { beamId: b.id, rd_M1: rec.rd_M1, rd_Mopp: rec.rd_Mopp, rd_M2: rec.rd_M2 };
  const withBase = computeSessionBeam(j, sess, { ...input, base: recordedBase(rec.form) });
  near(withBase.summary.value, rec.summary.value, 1e-9, 'по записанной форме — прежняя доза');
  assert.equal(withBase.recorded, true);
  const current = computeSessionBeam(j, sess, input);
  near(current.summary.value / rec.summary.value, 0.055 / 0.05389, 1e-9, 'по текущему оборудованию — с новым N_D,w');
  // при записи base в журнал не попадает
  const again = finalizeSession(j, { ...sess, beams: [{ ...input, base: recordedBase(rec.form) }] });
  assert.equal('base' in again.beams[0], false);
  near(again.beams[0].summary.value, rec.summary.value, 1e-9, 'повторная запись — та же доза');
});

test('проверка выхода: k_pol и k_s — каждый из своего источника; дата — из калибровки, если хоть одно значение из журнала', () => {
  let j = journal();
  const b = BEAMS[1];
  j = upsertSession(j, finalizeSession(j, {
    machineId: 'm1', date: '2026-08-25', mode: 'cal', protocol: 'trs', env: ENV,
    beams: [{ beamId: b.id, rd_M1: cells(b.M1), rd_Mopp: cells(b.Mopp), rd_M2: cells(b.M2) }],
  }));
  const sess = { machineId: 'm1', date: '2026-09-25', mode: 'check', protocol: 'trs', env: ENV };
  const c = computeSessionBeam(j, sess, { beamId: b.id, rd_M1: cells(b.C), rd_fixed_kpol: '1,0010' });
  assert.deepEqual(c.fixedSrc, { kpol: 'manual', ks: 'journal' });
  assert.equal(c.form.rd_fixed_kpol, '1,0010');
  near(parseNumber(c.form.rd_fixed_ks), lastCalibration(j, b.id).ks, 1e-6, 'k_s из журнала');
  assert.equal(c.form.rd_fixed_from, '25.08.2026');
  assert.equal(c.summary.ok, true);
  // без калибровки и без ручных значений — ошибка, без сообщения «NaN взяты из калибровки»
  const none = computeSessionBeam(journal(), sess, { beamId: b.id, rd_M1: cells(b.C) });
  assert.deepEqual(none.fixedSrc, { kpol: 'none', ks: 'none' });
  assert.equal(none.summary.ok, false);
  assert.ok(!none.result.messages.some((m) => /NaN/.test(m.text)));
});

test('пучок с ошибкой в настройках (нет d_max для пересчёта): доза видна, но пучок не «в допуске» и не записывается', () => {
  const j = journal();
  const b = BEAMS[0];
  j.machines[0].beams[0].form = { ...j.machines[0].beams[0].form, dd_on: true, dd_nominal_at: 'dmax', dd_zmax: '', dd_pdd: '' };
  const s = { machineId: 'm1', date: '2026-08-25', mode: 'cal', protocol: 'trs', env: ENV };
  const c = computeSessionBeam(j, s, { beamId: b.id, rd_M1: cells(b.M1), rd_Mopp: cells(b.Mopp), rd_M2: cells(b.M2) });
  assert.ok(c.summary.errors > 0);
  assert.equal(c.summary.hasValue, true);
  assert.equal(c.summary.ok, false);
  assert.equal(c.summary.status, 'error');
});

test('«Все настройки» на вкладке: другая камера не переписывает общую запись; та же камера обновляется для всех пучков', () => {
  const j = journal();
  const base = { ...FORM_DEFAULTS, ...j.machines[0].beams[0].form, ...j.chambers[0].form, ...j.electrometers[0].form, meta_beam: '6 МВ' };
  // другой номер камеры у 6 МВ
  const r = applyPhotonsFormToBeam(j, 'm1', 'b6', { ...base, ch_serial: '999', rd_V1: '300' });
  assert.equal(r.chamber, 'added');
  assert.equal(r.journal.chambers.length, 3);
  assert.equal(r.journal.chambers[0].form.ch_serial, '1', 'прежняя запись камеры не изменилась');
  const b6 = r.journal.machines[0].beams.find((x) => x.id === 'b6');
  const b10 = r.journal.machines[0].beams.find((x) => x.id === 'b10');
  assert.notEqual(b6.chamberId, 'c30013');
  assert.equal(b10.chamberId, 'c30013', '10 МВ осталась своя камера');
  assert.equal(b6.form.rd_V1, '300');
  assert.equal(j.machines[0].beams[0].form.rd_V1, '400', 'исходный журнал не меняется');
  // та же камера, новый N_D,w: обновляется запись, сообщается о других пучках
  const r2 = applyPhotonsFormToBeam(j, 'm1', 'b6', { ...base, ch_ndw: '0,0540' });
  assert.equal(r2.chamber, 'same');
  assert.equal(r2.journal.chambers[0].form.ch_ndw, '0,0540');
  assert.deepEqual(r2.sharedChamber, ['Versa HD — 10 МВ']);
  assert.equal(r2.electrometer, 'same');
  assert.deepEqual(r2.sharedElectrometer, [], 'электрометр не менялся — сообщать не о чем');
});

test('незаполненная камера и электрометр: модель, N_D,w (или перекрёстный коэффициент и TPR), k_elec', () => {
  assert.deepEqual(chamberMissing({ form: { ch_model: 'PTW30013', ch_ndw: '0,05389' } }), []);
  assert.deepEqual(chamberMissing({ form: {} }).length, 1, 'без модели — сначала модель');
  assert.deepEqual(chamberMissing({ form: { ch_model: 'PTW30013' } }), ['N_D,w']);
  assert.deepEqual(chamberMissing({ form: { ch_model: 'PTW30013', ch_cal_route: 'cross', ch_cross_ndw: '0,054' } }).length, 1);
  assert.deepEqual(electrometerMissing({ form: { el_kelec: '' } }), ['k_elec']);
  // перекрёстная калибровка — поле камеры, а не пучка
  assert.ok(PH_CHAMBER_KEYS.includes('ch_cross_ndw') && !PH_BEAM_KEYS.includes('ch_cal_route'));
});

test('файл журнала: чужой файл отклоняется, недостающие поля дополняются, сеансы сортируются по дате', () => {
  assert.throws(() => normalizeJournal({ app: 'reference-dosimetry', module: 'photons' }));
  assert.throws(() => normalizeJournal({ app: 'reference-dosimetry', module: 'journal', version: 99 }));
  const j = normalizeJournal({ app: 'reference-dosimetry', module: 'journal', machines: [{ name: 'A', beams: [{ name: '6 МВ' }] }], sessions: [{ date: '2026-02-01' }, { date: '2026-01-01' }] });
  assert.ok(j.machines[0].id && j.machines[0].beams[0].id);
  assert.deepEqual(j.sessions.map((s) => s.date), ['2026-01-01', '2026-02-01']);
  assert.deepEqual(j.chambers, []);
});

// ---------------------------------------------------------------- электроны
// Рабочая книга реальной калибровки, электроны 6–15 МэВ (Roos), как в workbook.test.js
const EB = [
  { id: 'e6', E: 6, r50: 2.4, M1: [12.77, 12.77, 12.78], Mopp: [-12.77, -12.78, -12.77], M2: [12.7, 12.7, 12.7], C: [12.76, 12.78, 12.77], pdd: 99.84, kq: 0.9445, M: 0.9984433571148288, N: 1.0000434265973848 },
  { id: 'e8', E: 8, r50: 3.186, M1: [12.93, 12.93, 12.94], Mopp: [-12.92, -12.94, -12.95], M2: [12.85, 12.86, 12.86], C: [12.94, 12.94, 12.94], pdd: 99.5536, kq: 0.9319, M: 0.9985522570696367, N: 1.0030297820165588 },
  { id: 'e10', E: 10, r50: 3.95, M1: [13.11, 13.11, 13.12], Mopp: [-13.11, -13.11, -13.11], M2: [13.03, 13.03, 13.03], C: [13.11, 13.11, 13.11], pdd: 99.93, kq: 0.9229, M: 1.0020703692507142, N: 1.0027723098676218 },
  { id: 'e12', E: 12, r50: 4.723, M1: [13.14, 13.15, 13.15], Mopp: [-13.13, -13.15, -13.15], M2: [13.06, 13.07, 13.06], C: [13.15, 13.15, 13.16], pdd: 99.68826666666666, kq: 0.9151, M: 0.9968697594814482, N: 0.9999870524529616 },
  { id: 'e15', E: 15, r50: 5.979, M1: [13.14, 13.14, 13.16], Mopp: [-13.14, -13.16, -13.14], M2: [13.06, 13.07, 13.07], C: [13.15, 13.15, 13.15], pdd: 98.62519999999999, kq: 0.9058, M: 0.9863643713733283, N: 1.000113937790066 },
];
const EENV = { T: c(22.95), P: c(1030.315), P_unit: 'hPa', H: '' };
function ejournal() {
  const j = journal();
  // та же запись камеры служит и фотонам, и электронам: общие поля — под именами вкладки «МВ фотоны»
  j.chambers.push({ ...j.chambers[0], id: 'croos', form: { ch_model: 'ROOS', ch_serial: '7', ch_ndw: c(0.08287), ch_T0: '20', ch_P0: '101,325' } });
  j.machines[0].beams.push(...EB.map((b) => ({
    id: b.id, kind: 'electron', name: `${b.E} МэВ`, chamberId: 'croos', electrometerId: 'e1', active: true,
    form: { e_energy: String(b.E), e_ssd: '100', e_field: '10', e_r50_method: 'r50', e_r50: c(b.r50), e_pdd: c(b.pdd), e_mu: '100', e_polarity: '+', e_V1: '200', e_V2: '100', e_beam_mode: 'pulsed', e_dd_on: true, e_nominal: '1,000', e_nominal_at: 'zmax', e_kqtrs_mode: 'manual', e_kqtrs_manual: c(b.kq) },
  })));
  return normalizeJournal(j);
}

test('электроны: ключи формы вкладки разделены между пучком, камерой, электрометром и сеансом без пересечений и пропусков', () => {
  const all = [...E_BEAM_KEYS, ...E_CHAMBER_KEYS, ...E_ELECTROMETER_KEYS, ...E_SESSION_KEYS];
  assert.equal(new Set(all).size, all.length);
  for (const k of Object.keys(E_DEFAULTS)) assert.ok(all.includes(k), k);
  for (const k of E_QUALITY_KEYS) assert.ok(E_BEAM_KEYS.includes(k), k);
});

test('электроны, калибровка: доза каждого пучка на z_max совпадает с рабочей книгой (камера Roos из общей записи)', () => {
  const j = ejournal();
  const s = finalizeSession(j, {
    machineId: 'm1', date: '2026-08-25', mode: 'cal', protocol: 'trs', env: EENV,
    beams: EB.map((b) => ({ beamId: b.id, e_M1: cells(b.M1), e_Mopp: cells(b.Mopp), e_M2: cells(b.M2), e_ctrl_M: cells(b.C) })),
  });
  for (const b of EB) {
    const sb = s.beams.find((x) => x.beamId === b.id);
    assert.equal(sb.kind, 'electron');
    assert.equal(sb.summary.ok, true, `${b.E} МэВ: ${sb.summary.errors} ошибок`);
    assert.equal(sb.summary.at, 'zmax');
    assert.equal(sb.summary.source, 'ctrl');
    near(sb.summary.value, b.N, 3e-6, `${b.E} МэВ: D(z_max)`);
    near(sb.summary.DperMU, b.M, 3e-6, `${b.E} МэВ: D(z_ref)`);
    near(sb.summary.quality, b.r50, 1e-12, `${b.E} МэВ: R50`);
    assert.equal(sb.form.e_ch_model, 'ROOS');
    assert.equal(sb.form.e_ndw, c(0.08287));
    // форма, записанная в сеанс, даёт тот же результат на вкладке «Электроны»
    near(computeElectrons(sb.form).trs.ctrl.DmaxPerMU, b.N, 3e-6, b.E);
  }
  // фотонные пучки в сеансе не участвовали
  assert.equal(s.beams.length, EB.length);
});

test('электроны, проверка выхода: k_pol, k_s, R50 и PDD(z_ref) — из последней калибровки этого пучка', () => {
  let j = ejournal();
  const cal = finalizeSession(j, {
    machineId: 'm1', date: '2026-08-25', mode: 'cal', protocol: 'trs', env: EENV,
    beams: EB.map((b) => ({ beamId: b.id, e_M1: cells(b.M1), e_Mopp: cells(b.Mopp), e_M2: cells(b.M2), e_r50: c(b.r50 + 0.01), e_pdd: c(b.pdd - 0.1) })),
  });
  j = upsertSession(j, cal);
  for (const b of EB) {
    const cb = cal.beams.find((x) => x.beamId === b.id);
    const kb = computeSessionBeam(j, { machineId: 'm1', date: '2026-09-25', mode: 'check', protocol: 'trs', env: EENV }, { beamId: b.id, e_M1: cells(b.M1) });
    assert.equal(kb.summary.ok, true, b.E);
    assert.equal(kb.summary.ksFixed, true);
    near(kb.summary.ksRaw, cb.summary.ksRaw, 1e-6, `${b.E} МэВ: k_s своего пучка`);
    near(kb.summary.kpolRaw, cb.summary.kpolRaw, 1e-6, `${b.E} МэВ: k_pol своего пучка`);
    near(kb.summary.value, cb.summary.value, 2e-6, `${b.E} МэВ: доза`);
    assert.equal(kb.form.e_r50, c(b.r50 + 0.01), 'R50 — из калибровки');
    assert.equal(kb.form.e_pdd, c(b.pdd - 0.1), 'PDD(z_ref) — из калибровки');
    assert.deepEqual(kb.fixedSrc, { kpol: 'journal', ks: 'journal' });
  }
  // TG-51: те же P_pol, P_ion по тем же показаниям
  const tg = finalizeSession(j, { machineId: 'm1', date: '2026-08-26', mode: 'cal', protocol: 'tg51', env: EENV, beams: [{ beamId: 'e12', e_M1: cells(EB[3].M1), e_Mopp: cells(EB[3].Mopp), e_M2: cells(EB[3].M2) }] });
  assert.equal(tg.beams[0].summary.ok, true);
  assert.ok(Number.isFinite(tg.beams[0].summary.kpolRaw) && Number.isFinite(tg.beams[0].summary.ksRaw));
});

test('общая запись камеры: N_D,w, k_лаб, T₀, P₀ и поправки лаборатории — одни для фотонов и электронов', () => {
  const cf = { ch_model: 'PTW30013', ch_serial: '1', ch_ndw: '0,05389', ch_ndw_unit: 'Gy/nC', ch_klab: '1,010', ch_T0: '20', ch_P0: '101,325', lab_pol_applied: false, lab_kpol: '1,001', e_cal_route: 'co60' };
  const ef = electronChamberForm(cf);
  assert.deepEqual([ef.e_ch_model, ef.e_ch_serial, ef.e_ndw, ef.e_klab, ef.e_lab_pol_applied, ef.e_lab_kpol], ['PTW30013', '1', '0,05389', '1,010', false, '1,001']);
  assert.deepEqual(chamberFormFromElectrons(ef).ch_ndw, '0,05389');
  // своя цилиндрическая камера вкладки «МВ фотоны» для электронов — «другая» с тем же названием
  const own = electronChamberForm({ ch_model: 'CUSTOM', cc_maker: 'Завод', cc_model: 'К-1', cc_radius: '3,1' });
  assert.deepEqual([own.e_ch_model, own.e_other_name, own.e_other_type, own.e_other_r], ['OTHER', 'Завод К-1', 'cyl', '3,1']);
  // плоскопараллельная камера — только для электронов
  assert.equal(photonCapable({ ch_model: 'ROOS' }), false);
  assert.equal(electronCapable({ ch_model: 'ROOS' }), true);
  assert.equal(electronCapable({ ch_model: 'PTW31010' }), false);
  // что нужно камере — по тому, где она выбрана
  assert.deepEqual(chamberMissing({ form: { ch_model: 'ROOS', e_cal_route: 'cross', e_cross_kn: '0,08' } }, { electron: true }), []);
  assert.deepEqual(chamberMissing({ form: { ch_model: 'PTW30013', ch_cal_route: 'cross', ch_cross_ndw: '0,054', ch_cross_tpr: '0,68' } }, { photon: true, electron: true }), ['N_D,w']);
  const j = ejournal();
  assert.deepEqual(chamberUses(j, 'croos'), { photon: false, electron: true, cobalt: false });
  assert.deepEqual(chamberUses(j, 'c30013'), { photon: true, electron: false, cobalt: false });
});

test('пучок из вкладки «Электроны» и «Все настройки»: камера находится по модели и номеру, своя «фотонная» камера не переписывается', () => {
  const j = ejournal();
  const form = { ...E_DEFAULTS, e_beam: '9 МэВ', e_ch_model: 'ROOS', e_ch_serial: '7', e_ndw: '0,08287', e_el_model: 'UNIDOS', e_el_serial: '3', e_kelec: '1', e_V1: '200', e_r50: '3,6', e_r50_method: 'r50' };
  const r = beamFromTabForm(j, 'm1', form, 'electron');
  assert.equal(r.addedChamber, false);
  assert.equal(r.addedElectrometer, false);
  assert.equal(r.beam.kind, 'electron');
  assert.equal(r.beam.chamberId, 'croos');
  assert.equal(r.beam.form.e_energy, '9');
  assert.equal(r.beam.form.e_r50, '3,6');
  // «Все настройки»: тот же Roos, новый N_D,w — запись обновлена, модель записи не тронута
  const r2 = applyTabFormToBeam(j, 'm1', 'e6', { ...form, e_ndw: '0,0830', e_klab: '1,002' }, 'electron');
  assert.equal(r2.chamber, 'same');
  const croos = r2.journal.chambers.find((x) => x.id === 'croos');
  assert.deepEqual([croos.form.ch_model, croos.form.ch_ndw, croos.form.ch_klab], ['ROOS', '0,0830', '1,002']);
  assert.ok(r2.sharedChamber.length === 4, 'Roos выбран и у других пучков электронов');
  // своя камера вкладки «МВ фотоны» на вкладке «Электроны» видна как «другая»: при сохранении это та же камера
  const j3 = normalizeJournal({ ...j, chambers: [...j.chambers, { id: 'cown', form: { ch_model: 'CUSTOM', cc_maker: 'Завод', cc_model: 'К-1', ch_serial: '5', ch_ndw: '0,05' } }] });
  j3.machines[0].beams.find((x) => x.id === 'e15').chamberId = 'cown';
  const r3 = applyTabFormToBeam(j3, 'm1', 'e15', { ...form, e_ch_model: 'OTHER', e_other_name: 'Завод К-1', e_other_type: 'cyl', e_ch_serial: '5', e_ndw: '0,051' }, 'electron');
  assert.equal(r3.chamber, 'same');
  const own = r3.journal.chambers.find((x) => x.id === 'cown');
  assert.deepEqual([own.form.ch_model, own.form.ch_ndw], ['CUSTOM', '0,051']);
});

test('тренды: пучки фотонов и электронов одного аппарата помечены видом', () => {
  const tr = trendSeries(ejournal(), 'm1');
  assert.deepEqual(tr.map((t) => t.kind), ['photon', 'photon', 'photon', 'electron', 'electron', 'electron', 'electron', 'electron']);
});

// ---------------------------------------------------------------- ⁶⁰Co
const pickKeys = (o, keys) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));
function cojournal(extra = {}) {
  const j = newJournal();
  j.institution = 'Пример';
  j.chambers = [{ id: 'cNE', form: { ch_model: 'NE2571', ch_serial: '0000', ch_ndw: '0,04523', ch_ndw_unit: 'Gy/nC', ch_klab: '1,000', ch_T0: '20', ch_P0: '101,325' } }];
  j.electrometers = [{ id: 'e1', form: { el_model: 'Электрометр (демо)', el_serial: '', el_kelec: '1,000' } }];
  j.machines = [{ id: 'mc', name: 'Аппарат ⁶⁰Co', kind: 'cobalt', beams: [{ id: 'bco', kind: 'cobalt', name: '⁶⁰Co', chamberId: 'cNE', electrometerId: 'e1', form: { ...pickKeys(SAMPLE_COBALT, CO_BEAM_KEYS), ...extra } }] }];
  return normalizeJournal(j);
}
const CO_READ = { co_M1: SAMPLE_COBALT.co_M1, co_Mopp: SAMPLE_COBALT.co_Mopp, co_M2: SAMPLE_COBALT.co_M2, co_Mc: SAMPLE_COBALT.co_Mc, co_tt: SAMPLE_COBALT.co_tt, co_tm: SAMPLE_COBALT.co_tm };
const CO_ENV = { T: '21,0', P: '100,5', P_unit: 'kPa', H: '' };

test('⁶⁰Co: ключи формы разделены между пучком, камерой, электрометром и сеансом без пересечений и пропусков', () => {
  const all = [...CO_BEAM_KEYS, ...CO_CHAMBER_KEYS, ...CO_ELECTROMETER_KEYS, ...CO_SESSION_KEYS];
  assert.equal(new Set(all).size, all.length);
  for (const k of Object.keys(CO_DEFAULTS)) assert.ok(all.includes(k), k);
  for (const k of ['co_time', 'co_timer_mode', 'co_tau', 'co_act_date', 'co_ref_rate', 'co_tol']) assert.ok(CO_BEAM_KEYS.includes(k), k);
});

test('⁶⁰Co: калибровка в журнале совпадает с вкладкой; проверка выхода — k_pol, k_s и τ из калибровки, сравнение с ней по распаду', () => {
  let j = cojournal();
  const tab = computeCobalt(SAMPLE_COBALT);
  const cal = finalizeSession(j, { machineId: 'mc', date: '2026-09-15', mode: 'cal', protocol: 'trs', env: CO_ENV, beams: [{ beamId: 'bco', ...CO_READ }] });
  const sb = cal.beams[0];
  assert.equal(sb.kind, 'cobalt');
  assert.equal(sb.summary.ok, true);
  assert.equal(sb.summary.source, 'ctrl');
  assert.equal(sb.summary.at, 'zmax');
  near(sb.summary.value, tab.trs.ctrl.rateMax, 1e-12, 'сГр/мин на z_max');
  near(sb.summary.rate, tab.trs.ctrl.rate, 1e-12, 'на z_ref');
  // первая калибровка: сравнение со значением из настроек пучка (148,6 сГр/мин на 15.08.2026 с поправкой на распад)
  near(sb.summary.deviation, tab.trs.ctrl.deviation, 1e-9, 'отклонение');
  near(sb.summary.tauMin, tab.timer.tau, 1e-12, 'τ, мин');
  assert.equal(computeSessionBeam(j, { ...cal, id: '' }, { beamId: 'bco', ...CO_READ }).ref.src, 'profile');
  j = upsertSession(j, cal);
  const last = lastCalibration(j, 'bco');
  near(last.rateMax, sb.summary.rateMax, 1e-12);
  // проверка через месяц теми же показаниями: та же мощность дозы, ожидаемая — калибровка × распад
  const sess = { machineId: 'mc', date: '2026-10-15', mode: 'check', protocol: 'trs', env: CO_ENV, beams: [] };
  const c = computeSessionBeam(j, sess, { beamId: 'bco', co_M1: SAMPLE_COBALT.co_M1, co_Mc: SAMPLE_COBALT.co_Mc });
  assert.deepEqual(c.result.messages.filter((m) => m.level === 'error'), []);
  assert.deepEqual(c.fixedSrc, { kpol: 'journal', ks: 'journal', tau: 'journal' });
  assert.equal(c.form.co_timer_mode, 'manual');
  assert.equal(c.ref.src, 'journal');
  near(c.summary.value, sb.summary.value, 1e-6, 'та же мощность дозы (τ и k — с шестью знаками)');
  const d = decayFactor('2026-09-15', '2026-10-15').factor;
  near(c.summary.deviation, (1 / d - 1) * 100, 1e-4, 'отклонение = распад за месяц');
  assert.equal(c.summary.ksFixed, true);
  assert.ok(c.summary.deviation > 1 && c.summary.status === 'ok');
  // время в секундах: τ из калибровки пересчитывается
  let js = cojournal({ co_time: '60', co_time_unit: 's' });
  const calS = finalizeSession(js, { machineId: 'mc', date: '2026-09-15', mode: 'cal', protocol: 'trs', env: CO_ENV, beams: [{ beamId: 'bco', ...CO_READ, co_tt: ['30', '60', '120'] }] });
  near(calS.beams[0].summary.tauMin, tab.timer.tau, 1e-9, 'τ из секунд в минуты');
  near(calS.beams[0].summary.value, sb.summary.value, 1e-9, 'та же мощность дозы');
  js = upsertSession(js, calS);
  const cs = computeSessionBeam(js, sess, { beamId: 'bco', co_M1: SAMPLE_COBALT.co_M1, co_Mc: SAMPLE_COBALT.co_Mc });
  near(parseNumber(cs.form.co_tau), tab.timer.tau * 60, 1e-5, 'τ в секундах');
  near(cs.summary.value, sb.summary.value, 1e-6);
  // своё τ при проверке важнее журнала
  assert.equal(computeSessionBeam(j, sess, { beamId: 'bco', co_M1: SAMPLE_COBALT.co_M1, co_tau: '0,02' }).fixedSrc.tau, 'manual');
  // без калибровки в журнале: k_pol, k_s и τ неоткуда — ошибки
  const none = computeSessionBeam(cojournal(), sess, { beamId: 'bco', co_M1: SAMPLE_COBALT.co_M1 });
  assert.deepEqual(none.fixedSrc, { kpol: 'none', ks: 'none', tau: 'none' });
  assert.ok(none.result.messages.some((m) => m.level === 'error' && /τ/.test(m.text)));
  // известное τ из настроек пучка — когда калибровки нет
  const known = computeSessionBeam(cojournal({ co_timer_mode: 'manual', co_tau: '0,012' }), sess, { beamId: 'bco', co_M1: SAMPLE_COBALT.co_M1 });
  assert.equal(known.fixedSrc.tau, 'profile');
  // заряд на интервале при выдвинутом источнике: τ не нужна
  const win = computeSessionBeam(cojournal({ co_timer_mode: 'window' }), sess, { beamId: 'bco', co_M1: SAMPLE_COBALT.co_M1 });
  assert.equal(win.fixedSrc.tau, '');
  assert.equal(win.form.co_timer_mode, 'window');
});

test('⁶⁰Co: замена источника и выбор значения для сравнения; записанный сеанс считается по своей форме', () => {
  let j = cojournal();
  const cal = finalizeSession(j, { machineId: 'mc', date: '2026-09-15', mode: 'cal', protocol: 'trs', env: CO_ENV, beams: [{ beamId: 'bco', ...CO_READ }] });
  j = upsertSession(j, cal);
  const sess = { machineId: 'mc', date: '2026-10-15', mode: 'cal', protocol: 'trs', env: CO_ENV, beams: [] };
  // калибровка после замены источника: прежняя калибровка для сравнения не годится
  const jNew = { ...j, machines: j.machines.map((m) => ({ ...m, beams: m.beams.map((b) => ({ ...b, form: { ...b.form, co_act_date: '2026-10-01', co_ref_rate: '', co_ref_date: '' } })) })) };
  const r1 = computeSessionBeam(jNew, sess, { beamId: 'bco', ...CO_READ });
  assert.equal(r1.ref.src, 'none');
  assert.equal(r1.ref.newSource, true);
  assert.equal(r1.summary.status, 'nonominal');
  // сравнение со значением из настроек пучка, даже если есть калибровка
  const jProf = { ...j, machines: j.machines.map((m) => ({ ...m, beams: m.beams.map((b) => ({ ...b, refSrc: 'profile' })) })) };
  const r2 = computeSessionBeam(jProf, sess, { beamId: 'bco', ...CO_READ });
  assert.equal(r2.ref.src, 'profile');
  assert.equal(r2.form.co_ref_rate, SAMPLE_COBALT.co_ref_rate);
  // записанный сеанс: после смены N_D,w камеры результат тот же
  const chk = finalizeSession(j, { machineId: 'mc', date: '2026-10-15', mode: 'check', protocol: 'trs', env: CO_ENV, beams: [{ beamId: 'bco', co_M1: SAMPLE_COBALT.co_M1, co_Mc: SAMPLE_COBALT.co_Mc }] });
  j = upsertSession(j, chk);
  const changed = { ...j, chambers: j.chambers.map((x) => ({ ...x, form: { ...x.form, ch_ndw: '0,04600' } })) };
  const b = chk.beams[0];
  const again = computeSessionBeam(changed, chk, { ...b, base: recordedBase(b.form, 'cobalt') });
  assert.equal(again.recorded, true);
  assert.equal(again.ref.src, 'recorded');
  assert.deepEqual(again.fixedSrc, { kpol: 'recorded', ks: 'recorded', tau: 'recorded' });
  near(again.summary.value, b.summary.value, 1e-12, 'та же мощность дозы');
  near(again.summary.deviation, b.summary.deviation, 1e-9);
  // тренд: отклонение и τ по сеансам
  const t = trendSeries(j, 'mc')[0];
  assert.equal(t.kind, 'cobalt');
  assert.equal(t.points.length, 2);
  assert.ok(Number.isFinite(t.points[0].tau) && Number.isNaN(t.points[1].tau));
});

test('⁶⁰Co: камера — общая запись; перенос пучка из вкладки и «Все настройки»', () => {
  // базы фотонов и электронов → список вкладки «⁶⁰Co» и обратно
  assert.equal(cobaltChamberForm({ ch_model: 'PTW30013' }).co_ch_model, 'PTW30013');
  assert.equal(cobaltChamberForm({ ch_model: 'ROOS' }).co_ch_model, 'PP:ROOS');
  assert.deepEqual(chamberFormFromCobalt({ co_ch_model: 'PP:ROOS', co_ndw: '0,08' }), { ch_model: 'ROOS', ch_ndw: '0,08' });
  const other = cobaltChamberForm({ ch_model: 'OTHER', e_other_name: 'Камера X', e_other_type: 'pp' });
  assert.deepEqual([other.co_ch_model, other.co_cc_model, other.co_cc_type], ['CUSTOM', 'Камера X', 'pp']);
  assert.deepEqual(chamberFormFromCobalt({ co_ch_model: 'CUSTOM', co_cc_maker: 'A', co_cc_model: 'Камера X', co_cc_type: 'pp' }), { ch_model: 'OTHER', e_other_name: 'A Камера X', e_other_type: 'pp' });
  assert.deepEqual(chamberFormFromCobalt({ co_ch_model: 'MY:1', co_cc_maker: 'A', co_cc_model: 'Y', co_cc_type: 'cyl' }), { ch_model: 'CUSTOM', cc_maker: 'A', cc_model: 'Y' });
  assert.equal(cobaltCapable({ ch_model: 'ROOS' }), true);
  // камера пучка ⁶⁰Co: нужен N_D,w в ⁶⁰Co, даже если для фотонов она калибруется перекрёстно
  assert.deepEqual(chamberMissing({ form: { ch_model: 'PTW30013', ch_cal_route: 'cross', ch_cross_ndw: '0,054', ch_cross_tpr: '0,68' } }, { photon: true, cobalt: true }), ['N_D,w']);
  const j0 = cojournal();
  assert.deepEqual(chamberUses(j0, 'cNE'), { photon: false, electron: false, cobalt: true });
  // пучок из вкладки: камера и электрометр находятся по модели и номеру
  const { journal: j1, beam, addedChamber, addedElectrometer } = beamFromTabForm(j0, 'mc', { ...SAMPLE_COBALT, co_ref_rate: '150' }, 'cobalt');
  assert.equal(beam.kind, 'cobalt');
  assert.equal(beam.name, '⁶⁰Co, РИП 80 см');
  assert.equal(addedChamber, false);
  assert.equal(addedElectrometer, false);
  assert.equal(beam.chamberId, 'cNE');
  assert.equal(beam.form.co_ref_rate, '150');
  assert.ok(!('co_M1' in beam.form) && !('co_ndw' in beam.form));
  // «Все настройки»: та же камера обновляется (N_D,w, k_лаб), модель записи не меняется
  const r = applyTabFormToBeam(j1, 'mc', beam.id, { ...SAMPLE_COBALT, co_ndw: '0,04530', co_klab: '1,002', co_zref: '10' }, 'cobalt');
  assert.equal(r.chamber, 'same');
  const ch = r.journal.chambers.find((x) => x.id === 'cNE');
  assert.deepEqual([ch.form.ch_model, ch.form.ch_ndw, ch.form.ch_klab], ['NE2571', '0,04530', '1,002']);
  assert.equal(r.journal.machines[0].beams.find((x) => x.id === beam.id).form.co_zref, '10');
  // своя плоскопараллельная камера из вкладки — «другая» камера журнала, и та же при повторном переносе
  const tabPP = { ...SAMPLE_COBALT, co_ch_model: 'MY:abc', co_cc_maker: 'A', co_cc_model: 'PP-1', co_cc_type: 'pp', co_ch_serial: '7' };
  const a = beamFromTabForm(j0, 'mc', tabPP, 'cobalt');
  assert.equal(a.addedChamber, true);
  assert.equal(a.journal.chambers.at(-1).form.ch_model, 'OTHER');
  assert.equal(beamFromTabForm(a.journal, 'mc', tabPP, 'cobalt').addedChamber, false);
});

test('⁶⁰Co: замена источника без даты в прежней калибровке, устаревшее значение из настроек, сравнение на z_ref; формат файла', () => {
  // калибровка пучка без даты установки источника
  let j = cojournal({ co_act_date: '', co_ref_rate: '', co_ref_date: '' });
  j = upsertSession(j, finalizeSession(j, { machineId: 'mc', date: '2026-01-15', mode: 'cal', protocol: 'trs', env: CO_ENV, beams: [{ beamId: 'bco', ...CO_READ }] }));
  const withBeam = (jj, patch) => ({ ...jj, machines: jj.machines.map((m) => ({ ...m, beams: m.beams.map((b) => ({ ...b, form: { ...b.form, ...patch } })) })) });
  const sess = { machineId: 'mc', date: '2026-07-01', mode: 'check', protocol: 'trs', env: CO_ENV, beams: [] };
  // потом указали дату установки нового источника и его мощность дозы: калибровка раньше установки — не опора
  const r1 = computeSessionBeam(withBeam(j, { co_act_date: '2026-06-01', co_ref_rate: '200', co_ref_date: '2026-06-01' }), sess, { beamId: 'bco', co_M1: SAMPLE_COBALT.co_M1 });
  assert.equal(r1.ref.newSource, true);
  assert.equal(r1.ref.src, 'profile');
  near(r1.result.depth.expected, 200 * decayFactor('2026-06-01', '2026-07-01').factor, 1e-12, 'ожидаемая — значение нового источника');
  // значение из настроек датировано раньше установки источника — относится к прежнему, сравнивать не с чем
  const r2 = computeSessionBeam(withBeam(j, { co_act_date: '2026-06-01', co_ref_rate: '148,6', co_ref_date: '2026-01-15' }), sess, { beamId: 'bco', co_M1: SAMPLE_COBALT.co_M1 });
  assert.deepEqual([r2.ref.src, r2.ref.staleProfile, r2.summary.status], ['none', true, 'nonominal']);
  assert.ok(computeCobalt({ ...SAMPLE_COBALT, co_ref_date: '2024-01-01' }).messages.some((m) => m.level === 'warn' && /раньше установки источника/.test(m.text)));
  // калибровка без пересчёта на z_max, сейчас он включён: сравнение на z_ref
  let jz = cojournal({ co_dd_on: false });
  jz = upsertSession(jz, finalizeSession(jz, { machineId: 'mc', date: '2026-09-15', mode: 'cal', protocol: 'trs', env: CO_ENV, beams: [{ beamId: 'bco', ...CO_READ }] }));
  const r3 = computeSessionBeam(withBeam(jz, { co_dd_on: true }), { ...sess, date: '2026-10-15' }, { beamId: 'bco', co_M1: SAMPLE_COBALT.co_Mc });
  assert.deepEqual([r3.ref.src, r3.ref.atFallback, r3.summary.at], ['journal', true, 'zref']);
  near(r3.summary.deviation, (1 / decayFactor('2026-09-15', '2026-10-15').factor - 1) * 100, 1e-4);
  // формат файла: 2 — с ⁶⁰Co, 1 — без
  assert.equal(journalFormat(j), 2);
  assert.equal(journalFormat(journal()), 1);
});

test('⁶⁰Co: скрытые поля своей камеры на вкладке не считаются изменением общей камеры', () => {
  const j0 = cojournal();
  const j = normalizeJournal({ ...j0, machines: [...j0.machines, { id: 'ml', name: 'Linac', kind: 'linac', beams: [{ id: 'b6', kind: 'photon', name: '6 MV', chamberId: 'cNE', electrometerId: 'e1', form: {} }] }] });
  const r = applyTabFormToBeam(j, 'mc', 'bco', { ...SAMPLE_COBALT, co_cc_maker: 'X', co_cc_model: 'Y' }, 'cobalt');
  assert.equal(r.chamber, 'same');
  assert.deepEqual(r.sharedChamber, []);
  assert.ok(!('cc_model' in r.journal.chambers[0].form));
  // настоящее изменение N_D,w — сообщается, что камера общая
  assert.deepEqual(applyTabFormToBeam(j, 'mc', 'bco', { ...SAMPLE_COBALT, co_ndw: '0,04600' }, 'cobalt').sharedChamber, ['Linac — 6 MV']);
});

test('единая база камер: камера вкладки в журнале, отличия полей, запись в журнал, «Мои камеры»', async () => {
  const { tabEquipment, applyTabEquipment, chamberTabFields, myChambersToJournal } = await import('../src/core/journal.js');
  const j = journal();
  // вкладка «МВ фотоны» с той же камерой и электрометром, N_D,w как в журнале — отличий нет
  const tab = { ...FORM_DEFAULTS, ch_model: 'PTW30013', ch_serial: '1', ch_ndw: '0,05389', ch_klab: '1', ch_T0: '20', ch_P0: '101,325', el_model: 'UNIDOS', el_serial: '3', el_kelec: '1,000' };
  let t = tabEquipment(j, tab, 'photon');
  assert.equal(t.chamber.id, 'c30013');
  assert.equal(t.electrometer.id, 'e1');
  assert.deepEqual(t.chamberDiffs, []);
  assert.deepEqual(t.electrometerDiffs, []);
  // после новой поверки N_D,w и k_лаб на вкладке другие
  t = tabEquipment(j, { ...tab, ch_ndw: '0,05400', ch_klab: '1,002', el_kelec: '0,999' }, 'photon');
  assert.deepEqual(t.chamberDiffs.map((d) => d.key).sort(), ['ch_klab', 'ch_ndw']);
  assert.deepEqual(t.electrometerDiffs.map((d) => d.key), ['el_kelec']);
  // поправка лаборатории сравнивается, только если лаборатория её не внесла
  assert.deepEqual(tabEquipment(j, { ...tab, lab_kpol: '1,003' }, 'photon').chamberDiffs, []);
  assert.deepEqual(tabEquipment(j, { ...tab, lab_pol_applied: false, lab_kpol: '1,003' }, 'photon').chamberDiffs.map((d) => d.key), ['lab_pol_applied', 'lab_kpol']);
  // записать в журнал: та же запись обновляется, исходный журнал не меняется
  const r = applyTabEquipment(j, { ...tab, ch_ndw: '0,05400' }, 'photon');
  assert.deepEqual([r.chamber, r.chamberId, r.electrometer], ['updated', 'c30013', 'updated']);
  assert.equal(r.journal.chambers.find((c) => c.id === 'c30013').form.ch_ndw, '0,05400');
  assert.equal(j.chambers.find((c) => c.id === 'c30013').form.ch_ndw, c(0.05389));
  // камеры нет в журнале — добавляется
  const r2 = applyTabEquipment(j, { ...tab, ch_serial: '999' }, 'photon', { electrometer: false });
  assert.equal(r2.chamber, 'added');
  assert.equal(r2.journal.chambers.length, j.chambers.length + 1);
  assert.equal(tabEquipment(j, { ...tab, ch_serial: '999' }, 'photon').chamber, null);
  // взять из журнала: поля вкладки электронов из общей записи (ROOS — та же модель, N_D,w из журнала)
  const je = normalizeJournal({ ...j, chambers: [...j.chambers, { id: 'croos', form: { ch_model: 'ROOS', ch_serial: '7', ch_ndw: '0,08287', ch_klab: '1,001' } }] });
  const ef = chamberTabFields(je.chambers.at(-1), 'electron');
  assert.deepEqual([ef.e_ch_model, ef.e_ch_serial, ef.e_ndw, ef.e_klab], ['ROOS', '7', '0,08287', '1,001']);
  const te = tabEquipment(je, { ...E_DEFAULTS, ...ef }, 'electron');
  assert.equal(te.chamber.id, 'croos');
  assert.deepEqual(te.chamberDiffs, []);
  // ⁶⁰Co: та же камера, своё k_лаб на вкладке
  const tc = tabEquipment(je, { ...chamberTabFields(je.chambers[0], 'cobalt'), co_klab: '1,005' }, 'cobalt');
  assert.equal(tc.chamber.id, 'c30013');
  assert.deepEqual(tc.chamberDiffs.map((d) => d.key), ['co_klab']);
  // «Мои камеры» → журнал: цилиндрическая — своя, плоскопараллельная — «другая»; повторно не добавляются
  const mine = [{ id: 'MY:1', cc_maker: 'A', cc_model: 'X-1', cc_volume: '0,6', cc_type: 'cyl' }, { id: 'MY:2', cc_maker: '', cc_model: 'PP-2', cc_type: 'pp' }, { id: 'MY:3', cc_model: '' }];
  const m1 = myChambersToJournal(j, mine);
  assert.deepEqual(m1.added, ['A X-1', 'PP-2']);
  assert.deepEqual([m1.journal.chambers.at(-2).form.ch_model, m1.journal.chambers.at(-2).form.cc_volume, m1.journal.chambers.at(-1).form.ch_model], ['CUSTOM', '0,6', 'OTHER']);
  assert.deepEqual(myChambersToJournal(m1.journal, mine).added, []);
});

test('единая база камер: «взять из журнала» и «записать в журнал» сходятся для всех видов камер', async () => {
  const { tabEquipment, applyTabEquipment, chamberTabFields, electrometerTabFields, myChambersToJournal } = await import('../src/core/journal.js');
  const base = normalizeJournal({ ...journal(), chambers: [{ id: 'c1', form: { ch_model: 'PTW30013', ch_serial: '1', ch_ndw: '0,05389' } }], electrometers: [{ id: 'e1', form: { el_model: 'UNIDOS', el_serial: '3' } }] });
  // запись без части полей: «взять» ставит недостающие по умолчанию — отличий нет, в том числе единицы N_D,w
  const kinds = { photon: FORM_DEFAULTS, electron: E_DEFAULTS, cobalt: CO_DEFAULTS };
  const odd = { photon: { ch_ndw_unit: 'cGy/nC', lab_pol_applied: false, lab_kpol: '1,01', ch_klab: '1,02' }, electron: { e_ndw_unit: 'cGy/nC', e_klab: '1,02' }, cobalt: { co_ndw_unit: 'cGy/nC', co_klab: '1,02', co_kelec: '1,003' } };
  for (const [kind, D] of Object.entries(kinds)) {
    if (kind === 'electron') continue; // PTW30013 на электронах — «другая» камера, проверено ниже
    const tab = { ...D, ...odd[kind] };
    const f = { ...tab, ...chamberTabFields(base.chambers[0], kind), ...electrometerTabFields(base.electrometers[0], kind) };
    const t = tabEquipment(base, f, kind);
    assert.equal(t.chamber?.id, 'c1', kind);
    assert.deepEqual(t.chamberDiffs, [], kind);
    assert.deepEqual(t.electrometerDiffs, [], kind);
  }
  // ⁶⁰Co: своя плоскопараллельная камера с производителем — после «Добавить в журнал» как в журнале
  const co = { ...CO_DEFAULTS, co_ch_model: 'CUSTOM', co_cc_maker: 'Sun Nuclear', co_cc_model: 'PPC05', co_cc_type: 'pp', co_ch_serial: '42', co_ndw: '0,0830' };
  const a = applyTabEquipment(base, co, 'cobalt', { electrometer: false });
  assert.equal(a.chamber, 'added');
  assert.deepEqual(tabEquipment(a.journal, co, 'cobalt').chamberDiffs, []);
  const a2 = applyTabEquipment(a.journal, { ...co, co_ndw: '0,0831' }, 'cobalt', { electrometer: false });
  assert.equal(a2.chamber, 'updated');
  assert.equal(a2.journal.chambers.at(-1).form.e_other_name, 'Sun Nuclear PPC05');
  // своя цилиндрическая камера: радиус, записанный с «Электронов», — параметр своей камеры, его видят «МВ фотоны»
  const jc = normalizeJournal({ ...base, chambers: [{ id: 'cc', form: { ch_model: 'CUSTOM', cc_maker: 'A', cc_model: 'X', cc_radius: '3', ch_serial: '5', ch_ndw: '0,05' } }] });
  const ef = { ...E_DEFAULTS, ...chamberTabFields(jc.chambers[0], 'electron') };
  assert.deepEqual([ef.e_ch_model, ef.e_other_r], ['OTHER', '3']);
  const w = applyTabEquipment(jc, { ...ef, e_other_r: '3,5' }, 'electron', { electrometer: false });
  assert.deepEqual([w.chamber, w.journal.chambers[0].form.cc_radius, w.journal.chambers[0].form.ch_model, 'e_other_r' in w.journal.chambers[0].form], ['updated', '3,5', 'CUSTOM', false]);
  assert.deepEqual(tabEquipment(w.journal, { ...ef, e_other_r: '3,5' }, 'electron').chamberDiffs, []);
  const ph = { ...FORM_DEFAULTS, ...chamberTabFields(w.journal.chambers[0], 'photon') };
  const w2 = applyTabEquipment(w.journal, { ...ph, cc_radius: '4' }, 'photon', { electrometer: false });
  assert.equal(chamberTabFields(w2.journal.chambers[0], 'electron').e_other_r, '4');
  // камера из базы фотонов на «Электронах»: радиус — из базы; скрытые поля своей камеры вкладки в журнал не попадают
  const st = applyTabEquipment(base, { ...FORM_DEFAULTS, ch_model: 'PR06C', ch_serial: '9', ch_ndw: '0,05', cc_radius: '7', cc_maker: 'old' }, 'photon', { electrometer: false });
  const pr = st.journal.chambers.at(-1);
  assert.equal(pr.form.cc_radius, FORM_DEFAULTS.cc_radius);
  const pe = chamberTabFields(pr, 'electron');
  assert.deepEqual([pe.e_ch_model, pe.e_other_type, pe.e_other_r], ['OTHER', 'cyl', '3,2']);
  assert.deepEqual(tabEquipment(st.journal, { ...E_DEFAULTS, ...pe }, 'electron').chamberDiffs, []);
  // «Мои камеры»: та же камера, уже записанная «другой» с вкладки «Электроны», повторно не добавляется
  const jo = normalizeJournal({ ...base, chambers: [{ id: 'o', form: { ch_model: 'OTHER', e_other_name: 'Bar Cyl', e_other_type: 'cyl' } }] });
  assert.deepEqual(myChambersToJournal(jo, [{ id: 'MY:1', cc_maker: 'Bar', cc_model: 'Cyl', cc_type: 'cyl' }]).added, []);
});
