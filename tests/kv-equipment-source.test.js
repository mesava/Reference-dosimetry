// «Оборудование» — источник постоянного для вкладки kV (0.50.0): «Применение» камеры, электрометр режима из камеры,
// «Обновить из «Оборудования»», камера, добавленная из вкладки, — только для kV.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeJournal, JOURNAL_TAG, chamberUse, chamberUseSet, chamberServes, chamberMissing, sessionEquipDefaults } from '../src/core/journal.js';
import { normalizeKvVisit } from '../src/core/kv-session.js';
import { kvVisitFromMachine, kvMachineFromVisit, kvModeElectrometer, kvRefreshFromMachine } from '../src/core/kv-journal.js';
import { SAMPLE_KV } from '../src/core/sample-kv.js';

const CERT = { kv_cal: 'nk', kv_cert_form: 'n', kv_n: '0,0450', kv_cq_kv: ['30', '50', '70'], kv_cq_hvl: ['0,36', '1,0', '2,9'], kv_cq_val: ['1,000', '1,012', '1,025'], kv_lab_shape: 'circle', kv_lab_f: '3', kv_lab_ssd: '30', kv_T0: '20', kv_P0: '101,325', kv_foil: true };
const journal = () =>
  normalizeJournal({
    ...JOURNAL_TAG,
    chambers: [
      { id: 'ch1', form: { ch_model: 'PTW23342', ch_serial: '501' }, kv: CERT, calEl: 'el2' },
      { id: 'ch2', form: { ch_model: 'FC65G', ch_serial: '702', ch_ndw: '0,0481' }, kv: { ...CERT, kv_foil: false } },
    ],
    electrometers: [
      { id: 'el1', form: { el_model: 'PTW UNIDOS', el_serial: '9', el_kelec: '1,001' } },
      { id: 'el2', form: { el_model: 'PTW UNIDOS webline', el_serial: '12', el_kelec: '1,000' } },
    ],
    machines: [{
      id: 'mk', kind: 'kv', name: 'РТА',
      applicators: [{ id: 'a3', a: '3', ssd: '30' }, { id: 'a10', a: '10', ssd: '50' }],
      modes: [
        { id: 'k50', range: 'low', kv: '50', ma: '10', filter: '1 мм Al', hvl: '1,0', chamberId: 'ch1', electrometerId: 'el1', applicators: ['a3'], refApplicator: 'a3' },
        { id: 'k70', range: 'low', kv: '70', ma: '10', filter: '2 мм Al', hvl: '2,9', chamberId: 'ch1', electrometerId: 'el1', applicators: ['a3'], refApplicator: 'a3' },
        { id: 'k200', range: 'medium', kv: '200', ma: '15', filter: '0,5 мм Cu', hvl: '1,0', chamberId: 'ch2', electrometerId: 'el1', applicators: ['a10'], refApplicator: 'a10' },
      ],
    }],
  });

test('«Применение» камеры: пока не отмечено — по модели и по тому, где камерой мерили; отмеченное — как отмечено', () => {
  const j = journal();
  // камера только для kV-рентгена
  assert.deepEqual(chamberUse(j.chambers[0], j), { photon: false, electron: false, kv: true });
  // FC65-G с N_D,w и kV-сертификатом — и МВ, и kV
  assert.deepEqual(chamberUse(j.chambers[1], j), { photon: true, electron: true, kv: true });
  // фотонная камера с kV-сертификатом без N_D,w и без пучков МВ — только kV
  assert.deepEqual(chamberUse({ form: { ch_model: 'PTW30013' }, kv: CERT }), { photon: false, electron: false, kv: true });
  // камера режима аппарата kV без сертификата — тоже kV
  const j2 = journal();
  j2.chambers.push({ id: 'ch3', form: { ch_model: 'PTW30013', ch_serial: '4' } });
  j2.machines[0].modes[0].chamberId = 'ch3';
  assert.deepEqual(chamberUse(j2.chambers[2], j2), { photon: false, electron: false, kv: true });
  // фотонная камера без kV — пучки МВ, без kV
  assert.deepEqual(chamberUse({ form: { ch_model: 'PTW30013', ch_ndw: '0,053' } }), { photon: true, electron: true, kv: false });
  assert.deepEqual(chamberUse({ form: {} }), { photon: false, electron: false, kv: false });
  assert.equal(chamberUseSet(j.chambers[1]), false);
  // отмечено в карточке — как отмечено
  const set = { form: { ch_model: 'PTW30013', ch_ndw: '0,053' }, use: { photon: false, electron: false, kv: true } };
  assert.equal(chamberUseSet(set), true);
  assert.deepEqual(chamberUse(set), { photon: false, electron: false, kv: true });
});

test('«Применение» камеры: какие камеры предлагаются для пучков и что нужно в карточке', () => {
  const j = journal();
  assert.equal(chamberServes(j.chambers[0], 'photon', j), false, 'камера только для kV — не для фотонов');
  assert.equal(chamberServes(j.chambers[1], 'photon', j), true);
  // отмечено только kV — для МВ не предлагается, N_D,w в ⁶⁰Co не нужен
  j.chambers[1].use = { photon: false, electron: false, kv: true };
  assert.equal(chamberServes(j.chambers[1], 'photon', j), false);
  assert.equal(chamberServes(j.chambers[1], 'electron', j), false);
  assert.deepEqual(chamberMissing({ ...j.chambers[1], form: { ch_model: 'FC65G' } }), []);
  // отмечены фотоны — N_D,w нужен, даже с kV-сертификатом
  const ph = { form: { ch_model: 'PTW30013' }, kv: CERT, use: { photon: true, electron: false, kv: true } };
  assert.deepEqual(chamberMissing(ph), ['N_D,w']);
  // электроны отмечены, фотоны нет — тоже N_D,w (калибровка в ⁶⁰Co)
  assert.deepEqual(chamberMissing({ form: { ch_model: 'PTW30013' }, use: { photon: false, electron: true, kv: false } }), ['N_D,w']);
  // сеанс МВ: камера по умолчанию — из отмеченных для фотонов
  j.machines.push({ id: 'mv', kind: 'linac', name: 'Ускоритель', beams: [] });
  const jn = normalizeJournal(j);
  assert.equal(sessionEquipDefaults(jn, 'mv', 'photon').chamberId, '');
  jn.chambers[1].use = { photon: true, electron: false, kv: true };
  assert.equal(sessionEquipDefaults(jn, 'mv', 'photon').chamberId, 'ch2');
});

test('электрометр режима: «Электрометр при калибровке» камеры, иначе последний во вкладке', () => {
  const j = journal();
  const [k50, , k200] = j.machines[0].modes;
  assert.deepEqual([kvModeElectrometer(j, k50).el.id, kvModeElectrometer(j, k50).src], ['el2', 'cal']);
  assert.deepEqual([kvModeElectrometer(j, k200).el.id, kvModeElectrometer(j, k200).src], ['el1', 'last']);
  assert.deepEqual(kvModeElectrometer(j, { chamberId: 'ch2', electrometerId: '' }), { el: null, src: '' });
  // во вкладку — электрометр калибровки камеры
  const v = kvVisitFromMachine(j, j.machines[0], ['k50', 'k200'], normalizeKvVisit(null)).visit;
  assert.deepEqual([v.chambers[0].kv_el_model, v.chambers[0].kv_el_serial], ['PTW UNIDOS webline', '12']);
  assert.deepEqual([v.chambers[1].kv_el_model, v.chambers[1].kv_el_serial], ['PTW UNIDOS', '9']);
});

test('«Обновить из «Оборудования»»: пучок и камера — из журнала, электрометр и напряжения дня остаются', () => {
  const j = journal();
  const v = kvVisitFromMachine(j, j.machines[0], ['k50', 'k70', 'k200'], normalizeKvVisit(null)).visit;
  assert.deepEqual(v.modes.map((m) => m.chamber), [0, 0, 1]);
  // без изменений — обновлять нечего; запятая или точка — не изменение
  assert.equal(kvRefreshFromMachine(j, j.machines[0], v).changed, false);
  const vp = structuredClone(v);
  vp.chambers[0].kv_n = '0.0450';
  assert.equal(kvRefreshFromMachine(j, j.machines[0], vp).changed, false);
  // во вкладке на день измерений — другие электрометр и напряжение
  v.chambers[0].kv_el_model = 'Другой';
  v.chambers[0].kv_V1 = '300';
  // в «Оборудовании» поправили ток, kV-сертификат и камеру режима 70 кВ
  j.machines[0].modes[0].ma = '12';
  j.chambers[0].kv = { ...CERT, kv_n: '0,0460' };
  j.chambers.push({ id: 'ch4', form: { ch_model: 'PTW34013', ch_serial: '77' }, kv: { ...CERT, kv_n: '0,0700' } });
  j.machines[0].modes[1].chamberId = 'ch4';
  const r = kvRefreshFromMachine(j, j.machines[0], v);
  assert.equal(r.changed, true);
  const w = r.visit;
  assert.equal(w.modes[0].shared.kv_ma, '12');
  assert.equal(w.chambers[0].kv_n, '0,0460');
  assert.deepEqual([w.chambers[0].kv_el_model, w.chambers[0].kv_V1], ['Другой', '300']);
  // режим 70 кВ теперь со своей камерой: камера вкладки разделяется, электрометр дня — тот же
  assert.equal(w.chambers.length, 3);
  assert.deepEqual(w.modes.map((m) => m.chamber), [0, 2, 1]);
  assert.deepEqual([w.chambers[2].kv_ch_model, w.chambers[2].kv_ch_serial, w.chambers[2].kv_n, w.chambers[2].kv_el_model], ['PTW34013', '77', '0,0700', 'Другой']);
  // вкладка не меняется
  assert.equal(v.modes[0].shared.kv_ma, '10');
  // режим не из «Оборудования» не трогается
  const own = structuredClone(v);
  own.modes[0].shared.kv_jmode = '';
  assert.equal(kvRefreshFromMachine(j, j.machines[0], own).visit.modes[0].shared.kv_ma, '10');
});

test('камера, добавленная из вкладки kV, отмечена только для kV; у камеры журнала kV добавляется к отмеченному', () => {
  const j = normalizeJournal({ ...JOURNAL_TAG, chambers: [{ id: 'c1', form: { ch_model: 'PTW30013', ch_serial: '0000', ch_ndw: '0,053' }, use: { photon: true, electron: false, kv: false } }] });
  const v = normalizeKvVisit({ ...SAMPLE_KV, kv_machine: 'Xstrahl 300' });
  const res = kvMachineFromVisit(j, v);
  assert.deepEqual(res.journal.chambers[0].use, { photon: true, electron: false, kv: true });
  assert.deepEqual(res.report.chambersAdded, []);
  // в пустой журнал — новая запись только для kV, N_D,w в ⁶⁰Co ей не нужен
  const r2 = kvMachineFromVisit(normalizeJournal({ ...JOURNAL_TAG }), v);
  const ch = r2.journal.chambers[0];
  assert.deepEqual(ch.use, { photon: false, electron: false, kv: true });
  assert.deepEqual(chamberMissing(ch), []);
});
