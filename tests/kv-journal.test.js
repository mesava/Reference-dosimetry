// Вкладка «kV-рентген» ↔ рентгенотерапевтический аппарат «Оборудования» (0.42.0): подстановка режимов аппарата во
// вкладку и «Сохранить аппарат в Оборудование» — режимы, аппликаторы, камера с kV-сертификатом, электрометр, СПО.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeJournal, JOURNAL_TAG, chamberMissing, cobaltCapable, chamberText } from '../src/core/journal.js';
import { normalizeKvVisit, computeKvVisit, newKvMode } from '../src/core/kv-session.js';
import { kvVisitFromMachine, kvMachineFromVisit, kvChamberFromRecord, kvCertText, kvSaveText, KV_CERT_KEYS } from '../src/core/kv-journal.js';
import { kvModelOfJournal, journalModelOfKv, KV_ONLY_CHAMBERS } from '../src/core/kv-machine.js';
import { SAMPLE_KV } from '../src/core/sample-kv.js';

const CERT = { kv_cal: 'nk', kv_cert_form: 'n', kv_n: '', kv_cq_kv: ['30', '50', '70'], kv_cq_hvl: ['0,36', '1,0', '2,9'], kv_cq_val: ['1,000', '1,012', '1,025'], kv_lab_shape: 'circle', kv_lab_f: '3', kv_lab_ssd: '30', kv_T0: '20', kv_P0: '101,325', kv_foil: true };
const journal = () =>
  normalizeJournal({
    ...JOURNAL_TAG,
    institution: 'Клиника',
    department: 'Отделение',
    chambers: [
      { id: 'ch1', form: { ch_model: 'PTW23342', ch_serial: '501' }, kv: CERT },
      { id: 'ch2', form: { ch_model: 'FC65G', ch_serial: '702', ch_ndw: '0,0481' } },
    ],
    electrometers: [{ id: 'el1', form: { el_model: 'PTW UNIDOS', el_serial: '9', el_kelec: '1,001' } }],
    machines: [{
      id: 'mk', kind: 'kv', name: 'РТА', serial: '17',
      applicators: [{ id: 'a3', name: 'F3', a: '3', ssd: '30' }, { id: 'a5', name: 'F5', a: '5', ssd: '30' }, { id: 'a10', name: 'F10', a: '10', ssd: '50' }],
      modes: [
        { id: 'k50', range: 'low', kv: '50', ma: '10', filter: '1 мм Al', hvl: '1,0', chamberId: 'ch1', electrometerId: 'el1', applicators: ['a3', 'a5'], refApplicator: 'a3' },
        { id: 'k200', range: 'medium', kv: '200', ma: '15', filter: '0,5 мм Cu', hvl: '1,0', chamberId: 'ch2', electrometerId: 'el1', applicators: ['a5', 'a10'], refApplicator: 'a10' },
        { id: 'k70', range: 'low', kv: '70', hvl: '2,9', chamberId: 'ch1', electrometerId: 'el1', applicators: ['a3'] },
      ],
    }],
  });

test('модели камер: вкладка kV ↔ запись журнала; камеры только для kV', () => {
  assert.deepEqual(KV_ONLY_CHAMBERS.map((c) => c.id), ['PTW23342', 'PTW23344', 'PTW34013']);
  assert.equal(kvModelOfJournal('FC65G'), 'IBA-FC65-G');
  assert.equal(kvModelOfJournal('A12'), 'EXR-A12');
  assert.equal(kvModelOfJournal('PTW30013'), 'PTW30013');
  assert.equal(kvModelOfJournal('PTW31013'), '', 'камеры нет в списке вкладки kV');
  assert.equal(journalModelOfKv('IBA-FC65-P'), 'FC65P');
  assert.equal(journalModelOfKv('PTW23344'), 'PTW23344');
  // камера только для kV: название, в ⁶⁰Co не предлагается, N_D,w в ⁶⁰Co ей не нужен
  const j = journal();
  assert.equal(chamberText(j.chambers[0]), 'PTW 23342 № 501');
  assert.equal(cobaltCapable(j.chambers[0].form), false);
  assert.equal(cobaltCapable(j.chambers[1].form), true);
  assert.deepEqual(chamberMissing(j.chambers[0]), []);
  // фотонная камера с kV-сертификатом без пучков МВ — тоже без N_D,w
  assert.deepEqual(chamberMissing({ form: { ch_model: 'PTW30013' }, kv: CERT }), []);
  assert.deepEqual(chamberMissing({ form: { ch_model: 'PTW30013' } }), ['N_D,w']);
});

test('режимы аппарата во вкладку: пучок, камера с kV-сертификатом, электрометр, аппликаторы', () => {
  const j = journal();
  const v0 = normalizeKvVisit({ ...SAMPLE_KV });
  const res = kvVisitFromMachine(j, j.machines[0], ['k50', 'k200', 'k70'], v0);
  const v = res.visit;
  // общее: аппарат и учреждение из журнала, дата и примечания вкладки
  assert.equal(v.common.kv_machine, 'РТА, № 17');
  assert.equal(v.common.kv_institution, 'Клиника, Отделение');
  assert.equal(v.common.kv_jmachine, 'mk');
  assert.equal(v.common.kv_date, SAMPLE_KV.kv_date);
  // камеры: 23342 (режимы 50 и 70 кВ) и FC65-G — две, у FC65-G kV-сертификата нет
  assert.equal(v.chambers.length, 2);
  assert.deepEqual(v.modes.map((m) => m.chamber), [0, 1, 0]);
  assert.equal(v.chambers[0].kv_ch_model, 'PTW23342');
  assert.equal(v.chambers[0].kv_ch_serial, '501');
  assert.equal(v.chambers[0].kv_cal, 'nk');
  assert.deepEqual(v.chambers[0].kv_cq_val, CERT.kv_cq_val);
  assert.equal(v.chambers[0].kv_foil, true);
  assert.equal(v.chambers[1].kv_ch_model, 'IBA-FC65-G');
  assert.deepEqual([v.chambers[1].kv_el_model, v.chambers[1].kv_el_serial, v.chambers[1].kv_kelec], ['PTW UNIDOS', '9', '1,001']);
  assert.deepEqual(res.noCert, ['IBA FC65-G № 702']);
  // режимы: пучок и связь; строки — отмеченные аппликаторы без показаний, выбрана строка референсного
  assert.deepEqual(v.modes.map((m) => [m.shared.kv_jmode, m.shared.kv_range, m.shared.kv_kv, m.shared.kv_ma, m.shared.kv_filter, m.shared.kv_hvl]), [
    ['k50', 'low', '50', '10', '1 мм Al', '1,0'], ['k200', 'medium', '200', '15', '0,5 мм Cu', '1,0'], ['k70', 'low', '70', '', '', '2,9'],
  ]);
  assert.deepEqual(v.modes.map((m) => m.rows.map((r) => `${r.kv_cone}/${r.kv_ssd}`)), [['3/30', '5/30'], ['5/30', '10/50'], ['3/30']]);
  assert.deepEqual(v.modes.map((m) => m.active), [0, 1, 0]);
  assert.ok(v.modes.every((m) => m.rows.every((r) => r.kv_M1.every((x) => x === ''))));
  // фантом и единица задания — от текущего режима вкладки, задание — от его строки
  assert.equal(v.modes[1].shared.kv_phantom, SAMPLE_KV.kv_phantom);
  assert.equal(v.modes[1].rows[0].kv_set, SAMPLE_KV.kv_set);
  // самый большой тубус аппарата, когда 10 × 10 см нет (табл. 31): отметка у строки
  const j2 = journal();
  j2.machines[0].modes[1].applicators = ['a3', 'a5'];
  j2.machines[0].applicators = j2.machines[0].applicators.slice(0, 2);
  const v2 = kvVisitFromMachine(j2, j2.machines[0], ['k200'], v0).visit;
  assert.deepEqual(v2.modes[0].rows.map((r) => r.kv_cone_largest), [false, true]);
  // ничего не отмечено — null
  assert.equal(kvVisitFromMachine(j, j.machines[0], [], v0), null);
});

test('«Сохранить аппарат в Оборудование»: новый аппарат из ручного ввода, затем обновление по связи', () => {
  const j = normalizeJournal({ ...JOURNAL_TAG });
  const v = normalizeKvVisit({ ...SAMPLE_KV, kv_machine: 'Xstrahl 300' });
  // второй режим: 120 кВ с той же камерой
  const m2 = newKvMode(v.modes[0]);
  Object.assign(m2.shared, { kv_kv: '120', kv_hvl: '0,30', kv_filter: '0,2 мм Cu' });
  v.modes.push(m2);
  const res = kvMachineFromVisit(j, v);
  const m = res.journal.machines[0];
  assert.equal(m.kind, 'kv');
  assert.equal(m.name, 'Xstrahl 300');
  assert.deepEqual([res.report.machineAdded, res.report.modesAdded, res.report.appsAdded], [true, 2, 1]);
  assert.deepEqual(res.report.chambersAdded, ['PTW 30013 № 0000']);
  assert.deepEqual(res.report.electrometersAdded, ['Электрометр (демо)']);
  // камера: запись с kV-сертификатом (без модели и №), N_D,w в ⁶⁰Co не трогается
  const ch = res.journal.chambers[0];
  assert.deepEqual([ch.form.ch_model, ch.form.ch_serial, ch.form.ch_ndw], ['PTW30013', '0000', '']);
  assert.equal(ch.kv.kv_n, SAMPLE_KV.kv_n);
  assert.deepEqual(ch.kv.kv_cq_hvl, SAMPLE_KV.kv_cq_hvl);
  assert.ok(!('kv_ch_model' in ch.kv) && !('kv_el_model' in ch.kv));
  assert.ok(Object.keys(ch.kv).every((k) => KV_CERT_KEYS.includes(k)));
  // режимы: пучок, камера, электрометр, аппликатор, референсный — стандартный тубус вкладки (Ø 10 см, табл. 31)
  assert.deepEqual(m.modes.map((x) => [x.range, x.kv, x.ma, x.filter, x.hvl, x.chamberId === ch.id, x.electrometerId === res.journal.electrometers[0].id]), [
    ['medium', '200', '10', '0,5 мм Cu + 1 мм Al', '1,00', true, true], ['medium', '120', '', '0,2 мм Cu', '0,30', true, true],
  ]);
  assert.deepEqual(m.applicators.map((a) => [a.shape, a.a, a.ssd]), [['circle', '10', '50']]);
  assert.ok(m.modes.every((x) => x.applicators.length === 1 && x.refApplicator === m.applicators[0].id));
  assert.deepEqual(res.modeIds, m.modes.map((x) => x.id));
  assert.match(kvSaveText(m, res.report), /^Аппарат «Xstrahl 300» сохранён в «Оборудование»: добавлен аппарат «Xstrahl 300»; режимов добавлено: 2; аппликаторов добавлено: 1; камеры добавлены: PTW 30013 № 0000; электрометры добавлены: Электрометр \(демо\)\. Сохраните журнал в файл\.$/);

  // повторно — по связи: режимы обновляются, новый тубус добавляется к аппарату и к режиму, прежние отметки остаются
  const j1 = res.journal;
  v.common.kv_jmachine = m.id;
  v.modes.forEach((md, i) => (md.shared.kv_jmode = res.modeIds[i]));
  v.modes[0].shared.kv_ma = '12';
  v.modes[0].rows.push({ ...v.modes[0].rows[0], kv_cone: '6', kv_cone_shape: 'square', kv_M1: ['', '', ''] });
  v.modes[1].shared.kv_hvl = '0,32';
  const r2 = kvMachineFromVisit(j1, v);
  const m1 = r2.journal.machines[0];
  assert.equal(r2.journal.machines.length, 1);
  assert.deepEqual([r2.report.machineAdded, r2.report.modesAdded, r2.report.modesUpdated, r2.report.appsAdded], [false, 0, 2, 1]);
  assert.deepEqual(r2.report.chambersAdded, []);
  assert.deepEqual(r2.report.certSaved, [], 'сертификат тот же — не перезаписывается');
  assert.equal(m1.modes[0].ma, '12');
  assert.equal(m1.modes[0].applicators.length, 2);
  assert.equal(m1.modes[1].applicators.length, 1);
  // СПО другой: без согласия не меняется, расхождение — в отчёте
  assert.deepEqual(r2.report.hvl, [{ mode: 1, was: '0,30', now: '0,32', source: 'nominal', range: 'medium' }]);
  assert.equal(m1.modes[1].hvl, '0,30');
  assert.equal(kvMachineFromVisit(j1, v, { replaceHvl: true }).journal.machines[0].modes[1].hvl, '0,32');
  // новый сертификат камеры записывается в её запись
  v.chambers[0].kv_n = '0,04600';
  const r3 = kvMachineFromVisit(j1, v);
  assert.deepEqual(r3.report.certSaved, ['PTW 30013 № 0000']);
  assert.equal(r3.journal.chambers[0].kv.kv_n, '0,04600');
  // исходный журнал не меняется
  assert.equal(j1.chambers[0].kv.kv_n, SAMPLE_KV.kv_n);
  // без связи — по названию аппарата и пучку режима
  const v4 = normalizeKvVisit({ ...SAMPLE_KV, kv_machine: 'Xstrahl 300' });
  const r4 = kvMachineFromVisit(j1, v4);
  assert.deepEqual([r4.report.machineAdded, r4.report.modesAdded, r4.report.modesUpdated], [false, 0, 1]);
  assert.equal(r4.modeIds[0], m.modes[0].id);
});

test('туда и обратно: вкладка из «Оборудования» сохраняется без изменений; своя камера', () => {
  const j = journal();
  const v = kvVisitFromMachine(j, j.machines[0], ['k50', 'k200', 'k70'], normalizeKvVisit(null)).visit;
  const res = kvMachineFromVisit(j, v);
  assert.deepEqual([res.report.machineAdded, res.report.modesAdded, res.report.appsAdded, res.report.chambersAdded.length, res.report.electrometersAdded.length, res.report.hvl.length], [false, 0, 0, 0, 0, 0]);
  const m0 = j.machines[0];
  const m1 = res.journal.machines[0];
  assert.deepEqual(m1.modes.map((x) => [x.id, x.chamberId, x.electrometerId, x.applicators]), m0.modes.map((x) => [x.id, x.chamberId, x.electrometerId, x.applicators]));
  // своя камера вкладки — «другая» в журнале с названием и типом; обратно — своя с теми же полями
  const vc = { ...v.chambers[0], kv_ch_model: 'CUSTOM', kv_cc_maker: 'Самодел', kv_cc_model: 'К-1', kv_cc_type: 'pp', kv_ch_serial: '3' };
  v.chambers[0] = vc;
  const r2 = kvMachineFromVisit(j, v);
  const rec = r2.journal.chambers.at(-1);
  assert.deepEqual([rec.form.ch_model, rec.form.e_other_name, rec.form.e_other_type, rec.form.ch_serial], ['OTHER', 'Самодел К-1', 'pp', '3']);
  const back = kvChamberFromRecord(rec, null);
  assert.deepEqual([back.kv_ch_model, back.kv_cc_maker, back.kv_cc_model, back.kv_cc_type, back.kv_ch_serial], ['CUSTOM', 'Самодел', 'К-1', 'pp', '3']);
  // камера журнала не из списка вкладки — своя с названием записи
  const ph = kvChamberFromRecord({ form: { ch_model: 'PTW31013', ch_serial: '8' } }, null);
  assert.deepEqual([ph.kv_ch_model, ph.kv_cc_model, ph.kv_cc_type, ph.kv_ch_serial], ['CUSTOM', 'PTW 31013', 'cyl', '8']);
  // расчёт вкладки после подстановки идёт (строки считаются)
  assert.equal(computeKvVisit(v).modes.length, 3);
});

test('kV-сертификат записи камеры коротко', () => {
  assert.equal(kvCertText(CERT), 'N_K (воздушная керма); N по качествам — 3 точки; СПО 0,36–2,9 мм; поле лаборатории Ø 3 см, РИП 30 см');
  assert.equal(kvCertText({ kv_cal: 'ndw', kv_cert_form: 'kq', kv_n: '0,0453' }), 'N_D,w; N_Qo и k_Q по качествам');
  assert.equal(kvCertText(null), '');
  assert.equal(kvCertText({ kv_cal: 'nk' }), '', 'без коэффициента и таблицы — сертификата нет');
});
