// Сертификаты камеры (0.53.0): свидетельство для МВ и ⁶⁰Co и kV-сертификат — раздельно, у каждого история; вкладки и
// сеансы прошлых дат берут сертификат, действовавший на дату измерения; записи журнала хранят снимок и не меняются.
// Данные условные.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { certOn, certMeta, certHistory, archiveCert, restoreCert, removeCert, certFilled, certStamp, normalizeCertEntry, certIgnored } from '../src/core/chamber-certs.js';
import {
  normalizeJournal, JOURNAL_TAG, migrateChamberCerts, chamberOnDate, chamberCertStamp, equipmentDue, equipmentNoDue, applyTabEquipment, tabEquipment,
  calibrationChecks, certText, newChamberRecord, journalFormat, recordTabBeam, chamberDueDates,
} from '../src/core/journal.js';
import { SAMPLE_FORM } from '../src/core/sample.js';
import { kvVisitFromMachine, kvRefreshFromMachine, kvMachineFromVisit, kvModeElectrometer, kvChamberFromRecord, kvRefreshRisk, sameKvCert } from '../src/core/kv-journal.js';
import { recordKvVisit } from '../src/core/kv-records.js';
import { normalizeKvVisit } from '../src/core/kv-session.js';
import { SAMPLE_KV } from '../src/core/sample-kv.js';
import { FORM_DEFAULTS } from '../src/core/photons.js';
import { kvHistoryJournal, FIXTURE_TODAY } from './kv-fixture.js';

const KV_OLD = { kv_cal: 'nk', kv_cert_form: 'n', kv_n: '', kv_cq_kv: ['30', '50', '70'], kv_cq_hvl: ['0,36', '1,0', '2,9'], kv_cq_val: ['1,000', '1,012', '1,025'], kv_lab_shape: 'circle', kv_lab_f: '3', kv_lab_ssd: '30', kv_T0: '20', kv_P0: '101,325' };
const KV_NEW = { ...KV_OLD, kv_cq_val: ['1,004', '1,018', '1,031'], kv_T0: '22' };

/** Камера с действующим kV-сертификатом 2026 г. и прежним 2025 г. в истории; свидетельство ⁶⁰Co — своё. */
const chamber = () => ({
  id: 'ch1',
  form: { ch_model: 'PTW30013', ch_serial: '013488', ch_ndw: '0,05389', ch_ndw_unit: 'Gy/nC', ch_klab: '1,000', ch_T0: '20', ch_P0: '101,325' },
  calLab: 'ВНИИМ', calCert: 'Co-77', calDate: '2026-02-10', dueDate: '2027-02-09', calEl: 'el1', calV: '400', calPol: '+',
  use: { photon: true, electron: true, kv: true },
  kv: KV_NEW,
  kvCal: { calLab: 'ВНИИФТРИ', calCert: '0174-26', calDate: '2026-10-07', dueDate: '2027-10-06', calEl: 'el2', calV: '300', calPol: '+' },
  certHistory: [
    { id: 'h1', kind: 'kv', archived: '2026-10-08', meta: { calLab: 'ВНИИФТРИ', calCert: '0155-25', calDate: '2025-10-01', dueDate: '2026-09-30', calEl: 'el1', calV: '300', calPol: '+' }, data: KV_OLD },
    { id: 'h2', kind: 'mv', archived: '2026-02-11', meta: { calLab: 'ВНИИМ', calCert: 'Co-55', calDate: '2025-02-01', dueDate: '2026-01-31' }, data: { ch_ndw: '0,05370', ch_ndw_unit: 'Gy/nC', ch_klab: '1,000', ch_T0: '20', ch_P0: '101,325' } },
  ],
});

test('certOn: сертификат на дату измерения — действующий, из истории или самый ранний', () => {
  const c = chamber();
  assert.equal(certOn(c, 'kv', '2026-11-01').src, 'current');
  assert.equal(certOn(c, 'kv', '2026-10-07').src, 'current', 'в день калибровки — уже новый');
  assert.equal(certOn(c, 'kv', '').src, 'current', 'без даты — действующий');
  const old = certOn(c, 'kv', '2026-03-15');
  assert.equal(old.src, 'history');
  assert.equal(old.meta.calCert, '0155-25');
  assert.deepEqual(old.data.kv_cq_val, KV_OLD.kv_cq_val);
  const early = certOn(c, 'kv', '2024-05-01');
  assert.equal(early.src, 'early');
  assert.equal(early.meta.calCert, '0155-25');
  // виды не смешиваются: МВ и ⁶⁰Co — своя история
  assert.equal(certOn(c, 'mv', '2025-06-01').meta.calCert, 'Co-55');
  assert.equal(certOn(c, 'mv', '2026-03-01').meta.calCert, 'Co-77');
  // без даты калибровки у действующего история не применяется
  const nodate = { ...chamber(), kvCal: { ...chamber().kvCal, calDate: '' } };
  assert.equal(certOn(nodate, 'kv', '2025-12-01').src, 'current');
});

test('«Новый сертификат»: действующий — в историю, поля нового без коэффициентов, № и дат', () => {
  const c = chamber();
  const out = archiveCert(c, 'kv', { id: 'h3', today: '2026-11-12', elText: 'PTW UNIDOS № 2' });
  assert.notEqual(out, c);
  assert.equal(c.certHistory.length, 2, 'исходная запись не меняется');
  const h = certHistory(out, 'kv');
  assert.equal(h.length, 2);
  assert.equal(h.at(-1).id, 'h3');
  assert.equal(h.at(-1).meta.calCert, '0174-26');
  assert.equal(h.at(-1).elText, 'PTW UNIDOS № 2');
  assert.deepEqual(h.at(-1).data.kv_cq_val, KV_NEW.kv_cq_val);
  // новое: коэффициенты, №, даты — пусто; лаборатория, электрометр, условия, таблица качеств — как образец
  assert.deepEqual(out.kv.kv_cq_val, ['', '', '']);
  assert.deepEqual(out.kv.kv_cq_hvl, KV_NEW.kv_cq_hvl);
  assert.equal(out.kv.kv_T0, '22');
  assert.equal(out.kvCal.calCert, '');
  assert.equal(out.kvCal.calDate, '');
  assert.equal(out.kvCal.dueDate, '');
  assert.equal(out.kvCal.calLab, 'ВНИИФТРИ');
  assert.equal(out.kvCal.calEl, 'el2');
  // свидетельство для МВ и ⁶⁰Co не тронуто
  assert.equal(out.calCert, 'Co-77');
  assert.equal(out.form.ch_ndw, '0,05389');
  // МВ: N_D,w, k_лаб и поправки лаборатории — пустые, T₀ и P₀ остаются
  const mv = archiveCert({ ...c, form: { ...c.form, ch_klab: '1,002', lab_kpol: '1,001' } }, 'mv', { id: 'h4', today: '2026-11-12' });
  assert.equal(mv.form.ch_ndw, '');
  assert.equal(mv.form.ch_klab, '1,000');
  assert.equal(mv.form.lab_kpol, '');
  assert.equal(mv.form.ch_T0, '20');
  assert.equal(mv.calCert, '');
  assert.equal(mv.kvCal.calCert, '0174-26', 'kV-сертификат не тронут');
  assert.equal(certHistory(mv, 'mv').at(-1).data.ch_klab, '1,002');
  assert.equal(certFilled(out, 'kv'), false, 'новое пустое — переносить нечего');
});

test('«Сделать действующим» и «Удалить» в истории', () => {
  const c = chamber();
  const r = restoreCert(c, 'h1', { newId: 'h5', today: '2026-11-12' });
  assert.equal(r.kvCal.calCert, '0155-25');
  assert.deepEqual(r.kv.kv_cq_val, KV_OLD.kv_cq_val);
  const h = certHistory(r, 'kv');
  assert.deepEqual(h.map((x) => x.id), ['h5'], 'прежний действующий — в истории');
  assert.equal(h[0].meta.calCert, '0174-26');
  assert.equal(restoreCert(c, 'nope', { newId: 'x' }), null);
  const d = removeCert(c, 'h1');
  assert.deepEqual(certHistory(d, 'kv'), []);
  assert.equal(certHistory(d, 'mv').length, 1);
});

test('перенос журналов до 0.53.0: у камеры только для kV сведения о свидетельстве уходят в kV-сертификат', () => {
  const j = normalizeJournal({
    ...JOURNAL_TAG,
    chambers: [
      // только kV: сведения переносятся, у МВ пустеют
      { id: 'a', form: { ch_model: 'PTW23342', ch_serial: '1' }, kv: KV_OLD, calLab: 'ВНИИФТРИ', calCert: '12', calDate: '2025-05-01', dueDate: '2026-04-30', calEl: 'e' },
      // и МВ, и kV: сведения копируются в kV, у МВ остаются
      { id: 'b', form: { ch_model: 'PTW30013', ch_serial: '2', ch_ndw: '0,0539' }, kv: KV_OLD, calCert: '34', calDate: '2025-06-01' },
      // без kV-сертификата — как было
      { id: 'c', form: { ch_model: 'PTW30013', ch_serial: '3', ch_ndw: '0,0539' }, calCert: '56' },
    ],
  });
  const [a, b, c] = j.chambers;
  assert.equal(a.kvCal.calCert, '12');
  assert.equal(a.kvCal.dueDate, '2026-04-30');
  assert.equal(a.kvCal.calEl, 'e');
  assert.equal(a.calCert, '');
  assert.equal(a.dueDate, '');
  assert.equal(b.kvCal.calCert, '34');
  assert.equal(b.calCert, '34');
  assert.equal(c.kvCal.calCert, '', 'kV-сертификата нет — его сведения пустые');
  assert.equal(c.calCert, '56');
  assert.deepEqual(a.certHistory, []);
  // повторная нормализация ничего не меняет
  const again = migrateChamberCerts(structuredClone(a));
  assert.deepEqual(again.kvCal, a.kvCal);
});

test('сроки свидетельств: у камеры для МВ и kV — два, с подписью', () => {
  const j = normalizeJournal({ ...JOURNAL_TAG, chambers: [{ ...chamber(), dueDate: '2026-11-20', kvCal: { ...chamber().kvCal, dueDate: '2026-11-30' } }] });
  const due = equipmentDue(j, '2026-11-12');
  assert.equal(due.length, 2);
  assert.deepEqual(due.map((x) => x.cert), ['mv', 'kv']);
  assert.match(due[1].text, /kV-сертификат/);
  // камера только для kV: срок — kV-сертификата
  const k = normalizeJournal({ ...JOURNAL_TAG, chambers: [{ id: 'k', form: { ch_model: 'PTW23342' }, kv: KV_OLD, kvCal: { dueDate: '' } }] });
  assert.deepEqual(equipmentNoDue(k).map((x) => x.cert), ['kv']);
});

/** Журнал: аппарат kV с режимом на камере chamber(); электрометры el1, el2. */
const kvJournal = () =>
  normalizeJournal({
    ...JOURNAL_TAG,
    chambers: [chamber()],
    electrometers: [
      { id: 'el1', form: { el_model: 'PTW UNIDOS', el_serial: '1', el_kelec: '1,000' } },
      { id: 'el2', form: { el_model: 'PTW UNIDOS Tango', el_serial: '2', el_kelec: '1,000' } },
    ],
    machines: [{
      id: 'mk', kind: 'kv', name: 'РТА',
      applicators: [{ id: 'a3', a: '3', ssd: '30' }],
      modes: [{ id: 'k50', range: 'low', kv: '50', ma: '10', filter: '1 мм Al', hvl: '1,0', chamberId: 'ch1', applicators: ['a3'], refApplicator: 'a3' }],
    }],
  });
const tab = (date) => {
  const v = normalizeKvVisit({ form: SAMPLE_KV, rows: [SAMPLE_KV], active: 0 });
  v.common.kv_date = date;
  return v;
};

test('вкладка kV: подстановка из «Оборудования» берёт kV-сертификат на дату измерения', () => {
  const j = kvJournal();
  const m = j.machines[0];
  const now = kvVisitFromMachine(j, m, ['k50'], tab('2026-11-10')).visit;
  assert.deepEqual(now.chambers[0].kv_cq_val, KV_NEW.kv_cq_val);
  assert.equal(now.chambers[0].kv_cert_no, '0174-26');
  assert.equal(now.chambers[0].kv_cert_src, '');
  assert.equal(now.chambers[0].kv_T0, '22', 'T₀ — kV-сертификата, не свидетельства ⁶⁰Co');
  const past = kvVisitFromMachine(j, m, ['k50'], tab('2026-03-15')).visit;
  assert.deepEqual(past.chambers[0].kv_cq_val, KV_OLD.kv_cq_val);
  assert.equal(past.chambers[0].kv_cert_no, '0155-25');
  assert.equal(past.chambers[0].kv_cert_date, '2025-10-01');
  assert.equal(past.chambers[0].kv_cert_src, 'history');
  // электрометр при калибровке — того сертификата
  assert.equal(kvModeElectrometer(j, m.modes[0], '2026-11-10').el.id, 'el2');
  assert.equal(kvModeElectrometer(j, m.modes[0], '2026-03-15').el.id, 'el1');
  assert.equal(past.chambers[0].kv_el_serial, '1');
  // «Обновить из Оборудования» у старой вкладки — по её дате: ничего не меняется
  const linked = structuredClone(past);
  assert.equal(kvRefreshFromMachine(j, m, linked).changed, false);
  // та же вкладка с новой датой — изменение (сертификат другой)
  linked.common.kv_date = '2026-11-10';
  const r = kvRefreshFromMachine(j, m, linked);
  assert.equal(r.changed, true);
  assert.deepEqual(r.visit.chambers[0].kv_cq_val, KV_NEW.kv_cq_val);
  // предупреждения нет: прежний сертификат в истории есть
  assert.deepEqual(kvRefreshRisk(j, m, past), []);
});

test('вкладка kV: дата раньше действующего сертификата, а истории нет — предупреждение перед обновлением', () => {
  const j = kvJournal();
  j.chambers[0].certHistory = [];
  const m = j.machines[0];
  const past = kvVisitFromMachine(j, m, ['k50'], tab('2026-03-15')).visit;
  assert.equal(past.chambers[0].kv_cert_no, '0174-26', 'истории нет — действующий');
  const risk = kvRefreshRisk(j, m, past);
  assert.equal(risk.length, 1);
  assert.equal(risk[0].no, '0174-26');
});

test('«Сохранить в Оборудование» из вкладки без связи: сертификат старше действующего не записывается поверх', () => {
  const j = kvJournal();
  const v = kvVisitFromMachine(j, j.machines[0], ['k50'], tab('2026-03-15')).visit;
  // вкладка без связи с аппаратом (как файл до 0.50.0), с прежним сертификатом
  v.common.kv_jmachine = '';
  v.modes[0].shared.kv_jmode = '';
  const res = kvMachineFromVisit(j, v);
  const ch = res.journal.chambers.find((c) => c.id === 'ch1');
  assert.deepEqual(ch.kv.kv_cq_val, KV_NEW.kv_cq_val, 'действующий kV-сертификат остался');
  assert.equal(ch.kvCal.calCert, '0174-26');
  assert.equal(res.report.certOlder.length, 1);
  assert.equal(res.report.certSaved.length, 0);
});

test('журнал kV: запись хранит № и дату kV-сертификата; после «Нового сертификата» прошлые записи не меняются', () => {
  const { j: j0, machine, visitOf } = kvHistoryJournal({ upTo: 2 });
  const j = structuredClone(j0);
  const chId = machine.modes[0].chamberId;
  const c = j.chambers.find((x) => x.id === chId);
  c.kvCal = { calLab: 'ВНИИФТРИ', calCert: '0155-25', calDate: '2025-10-01', dueDate: '2026-09-30', calEl: '', calV: '', calPol: '' };
  const before = structuredClone(j.kvRecords);
  // новая запись: вкладка обновлена из «Оборудования» — с № сертификата
  const v = kvRefreshFromMachine(j, machine, visitOf(2)).visit;
  assert.equal(v.chambers[0].kv_cert_no, '0155-25', 'обновление подставляет № сертификата');
  const rec = recordKvVisit(j, { visit: v, today: FIXTURE_TODAY });
  assert.ok(!rec.error, rec.error);
  assert.equal(rec.record.summary.modes[0].cert.no, '0155-25');
  assert.equal(rec.record.summary.modes[0].cert.date, '2025-10-01');
  // новый сертификат с другими коэффициентами: записи журнала — те же
  const j2 = structuredClone(rec.journal);
  const i = j2.chambers.findIndex((x) => x.id === chId);
  j2.chambers[i] = archiveCert(j2.chambers[i], 'kv', { id: 'h', today: FIXTURE_TODAY });
  j2.chambers[i].kv.kv_n = '0,0999';
  j2.chambers[i].kvCal.calDate = '2026-10-07';
  assert.deepEqual(j2.kvRecords.slice(0, 2), before);
  assert.equal(j2.kvRecords.at(-1).summary.modes[0].cert.no, '0155-25');
  // вкладка с датой той записи берёт прежний сертификат
  const back = kvChamberFromRecord(j2.chambers[i], null, null, '2026-01-14');
  assert.equal(back.kv_cert_no, '0155-25');
  assert.notEqual(back.kv_n, '0,0999');
});

test('МВ: сеанс и вкладка прошлой даты — свидетельство на дату, «записать в журнал» не перезаписывает действующее', () => {
  const j = kvJournal();
  const ch = j.chambers[0];
  const old = chamberOnDate(ch, '2025-06-01');
  assert.equal(old.form.ch_ndw, '0,05370');
  assert.equal(old.calCert, 'Co-55');
  assert.equal(old.certSrc, 'history');
  assert.equal(chamberOnDate(ch, '2026-06-01'), ch, 'после даты действующего — сама запись');
  assert.deepEqual(chamberCertStamp(ch, '2025-06-01'), { no: 'Co-55', date: '2025-02-01', lab: 'ВНИИМ', src: 'history' });
  // коэффициент вкладки не тот, что в свидетельстве на дату, — свидетельство неизвестно
  assert.equal(chamberCertStamp(ch, '2025-06-01', { ch_ndw: '0,05389' }), null);
  assert.equal(chamberCertStamp(ch, '2025-06-01', { ch_ndw: '0.0537' }).no, 'Co-55');
  // вкладка фотонов прошлой даты с прежним N_D,w: сверка — со свидетельством на дату, отличий нет
  const form = { ...FORM_DEFAULTS, ch_model: 'PTW30013', ch_serial: '013488', ch_ndw: '0,05370', ch_klab: '1,000', ch_T0: '20', ch_P0: '101,325', meta_date: '2025-06-01' };
  const t = tabEquipment(j, form, 'photon');
  assert.equal(t.chamber.id, 'ch1');
  assert.equal(t.chamberCertSrc, 'history');
  assert.equal(t.chamberDiffs.filter((d) => d.key === 'ch_ndw').length, 0);
  // «записать в журнал» с такой вкладки действующее свидетельство не трогает
  const res = applyTabEquipment(j, form, 'photon', { electrometer: false });
  assert.equal(res.chamber, 'older');
  assert.equal(res.journal.chambers[0].form.ch_ndw, '0,05389');
  // проверки по калибровке — по сведениям свидетельства на дату (напряжение 400 В у действующего, у прежнего не задано)
  const notes = calibrationChecks(j, 'ch1', '', { ...form, rd_V1: '300' }, 'photon', '2025-06-01');
  assert.equal(notes.length, 0);
  assert.ok(calibrationChecks(j, 'ch1', '', { ...form, rd_V1: '300' }, 'photon', '2026-06-01').length > 0);
});

test('certText: запись камеры, сведения о свидетельстве и снимок записи', () => {
  assert.equal(certText({ calCert: '1', calDate: '2026-10-07', calLab: 'ВНИИФТРИ' }), 'свидетельство № 1 от 07.10.2026, ВНИИФТРИ');
  assert.equal(certText(certStamp(certOn(chamber(), 'kv', '2025-12-01'))), 'свидетельство № 0155-25 от 01.10.2025, ВНИИФТРИ');
  assert.equal(certText(certMeta(chamber(), 'kv')), 'свидетельство № 0174-26 от 07.10.2026, ВНИИФТРИ');
  assert.equal(certText({ no: '', date: '', lab: '' }), '');
});

test('перенос журналов выполняется один раз: после сохранения и загрузки сведения о свидетельстве для МВ не стираются', () => {
  // камера только для kV, перенесённая при загрузке; потом пользователь отметил фотоны и ввёл свидетельство ⁶⁰Co
  const j = normalizeJournal({ ...JOURNAL_TAG, chambers: [{ id: 'a', form: { ch_model: 'PTW30013' }, kv: KV_OLD, calCert: '12', calDate: '2025-05-01' }] });
  const c = j.chambers[0];
  Object.assign(c, { calCert: 'Co-1', calDate: '2026-01-10' });
  c.use = { ...(c.use || {}), photon: true };
  c.form.ch_ndw = '0,0539';
  const back = normalizeJournal(JSON.parse(JSON.stringify(j)));
  assert.equal(back.chambers[0].calCert, 'Co-1');
  assert.equal(back.chambers[0].kvCal.calCert, '12');
  // новая камера (с 0.53.0) для фотонов и kV: её свидетельство для МВ миграция не трогает
  const n = newChamberRecord({ id: 'n', form: { ch_model: 'PTW30013' }, use: { photon: true, electron: false, kv: true }, kv: KV_OLD, calCert: 'Co-2' });
  const jn = normalizeJournal({ ...JOURNAL_TAG, chambers: [n] });
  assert.equal(jn.chambers[0].calCert, 'Co-2');
  assert.equal(jn.chambers[0].kvCal.calCert, '');
  // файл 0.53.0 (формат ≤ 3), сохранённый прежней версией: у камеры только для kV сведения на самой записи — в kV-сертификат
  const old = newChamberRecord({ id: 'o', form: { ch_model: 'PTW23342', ch_serial: '7' }, kv: KV_OLD, calCert: '0174-26', calDate: '2026-10-07', dueDate: '2027-10-06' });
  const jo = normalizeJournal({ ...JOURNAL_TAG, chambers: [old] });
  assert.equal(jo.chambers[0].kvCal.calCert, '0174-26');
  assert.equal(jo.chambers[0].kvCal.dueDate, '2027-10-06');
  assert.equal(jo.chambers[0].calCert, '');
});

test('история сертификатов: сохранение в файл и загрузка, формат журнала 4, повторяющиеся id', () => {
  const j = normalizeJournal({ ...JOURNAL_TAG, chambers: [chamber()] });
  assert.equal(journalFormat(j), 4);
  assert.equal(journalFormat(normalizeJournal({ ...JOURNAL_TAG, chambers: [{ id: 'x', form: { ch_model: 'PTW30013' } }] })) < 4, true);
  const back = normalizeJournal(JSON.parse(JSON.stringify(j)));
  assert.deepEqual(certHistory(back.chambers[0], 'kv'), certHistory(j.chambers[0], 'kv'));
  assert.equal(certOn(back.chambers[0], 'kv', '2026-03-15').meta.calCert, '0155-25');
  const dup = normalizeJournal({ ...JOURNAL_TAG, chambers: [{ ...chamber(), certHistory: [...chamber().certHistory, { ...chamber().certHistory[0] }, { ...chamber().certHistory[1], id: '' }] }] });
  const ids = dup.chambers[0].certHistory.map((h) => h.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every(Boolean));
});

test('certOn: действующий без даты и запись истории новее действующего', () => {
  // сразу после «Новый сертификат»: действующий без даты и без коэффициентов — для всех дат прежний из истории
  const fresh = archiveCert(chamber(), 'kv', { id: 'h3', today: '2026-11-12' });
  assert.equal(certOn(fresh, 'kv', '2026-11-12').meta.calCert, '0174-26');
  assert.equal(certOn(fresh, 'kv', '2026-03-15').meta.calCert, '0155-25');
  // коэффициенты нового введены, даты ещё нет: после последнего из истории — новый
  fresh.kv.kv_cq_val = ['1,1', '1,1', '1,1'];
  assert.equal(certOn(fresh, 'kv', '2026-11-12').src, 'current');
  assert.equal(certOn(fresh, 'kv', '2026-03-15').meta.calCert, '0155-25');
  // «Сделать действующим» прежний (новый введён по ошибке): действующий — для всех дат с его даты, более новый из
  // истории на шкалу не попадает (в карточке — «не применяется»)
  const r = restoreCert(chamber(), 'h1', { newId: 'h5', today: '2026-11-12' });
  assert.equal(certOn(r, 'kv', '2026-11-01').src, 'current');
  assert.equal(certOn(r, 'kv', '2026-11-01').meta.calCert, '0155-25');
  assert.equal(certOn(r, 'kv', '2026-03-15').src, 'current');
  assert.deepEqual(certIgnored(r, 'kv').map((h) => h.id), ['h5']);
  // запись истории без даты калибровки на шкалу не попадает и отмечается
  const nd = { ...chamber(), certHistory: [...chamber().certHistory, { id: 'nd', kind: 'mv', meta: { calCert: 'X' }, data: {} }] };
  assert.deepEqual(certIgnored(nd, 'mv').map((h) => h.id), ['nd']);
  assert.deepEqual(certIgnored(chamber(), 'kv'), []);
  // запись истории без коэффициентов kV: действующий тоже без них
  const nokv = restoreCert({ ...chamber(), certHistory: [{ id: 'z', kind: 'kv', meta: { calCert: '1', calDate: '2024-01-01' }, data: null }] }, 'z', { newId: 'y' });
  assert.equal(nokv.kv, undefined);
});

test('снимок свидетельства для МВ полный: поля действующего не попадают в прошлую дату', () => {
  const c = chamber();
  c.form = { ...c.form, ch_cal_route: 'cross', ch_cross_ndw: '0,0541', lab_pol_applied: true, lab_kpol: '1,002' };
  const old = chamberOnDate(c, '2025-06-01');
  assert.equal(old.form.ch_cal_route, FORM_DEFAULTS.ch_cal_route);
  assert.equal(old.form.ch_cross_ndw, FORM_DEFAULTS.ch_cross_ndw ?? '');
  assert.equal(old.form.lab_kpol, FORM_DEFAULTS.lab_kpol ?? '');
  assert.equal(normalizeCertEntry({ id: 'q', kind: 'mv', data: { ch_ndw: '1' } }).data.ch_cal_route, FORM_DEFAULTS.ch_cal_route);
  assert.equal(normalizeCertEntry({ kind: 'xx' }), null);
});

test('«Сохранить в Оборудование»: вкладка с новым сертификатом переносит действующий в историю', () => {
  const j = kvJournal();
  j.chambers[0].certHistory = [];
  const v = kvVisitFromMachine(j, j.machines[0], ['k50'], tab('2027-11-01')).visit;
  v.common.kv_jmachine = '';
  v.modes[0].shared.kv_jmode = '';
  Object.assign(v.chambers[0], { kv_cert_no: '0200-27', kv_cert_date: '2027-10-05', kv_cert_lab: 'ВНИИФТРИ', kv_cq_val: ['1,010', '1,020', '1,030'] });
  const res = kvMachineFromVisit(j, v);
  const ch = res.journal.chambers.find((c) => c.id === 'ch1');
  assert.equal(res.report.certArchived.length, 1);
  assert.equal(ch.kvCal.calCert, '0200-27');
  assert.deepEqual(ch.kv.kv_cq_val, ['1,010', '1,020', '1,030']);
  const h = certHistory(ch, 'kv');
  assert.equal(h.length, 1);
  assert.equal(h[0].meta.calCert, '0174-26');
  assert.equal(certOn(ch, 'kv', '2026-11-01').meta.calCert, '0174-26');
});

test('вкладка kV: дата раньше действующего сертификата без истории — отметка «newer»', () => {
  const j = kvJournal();
  j.chambers[0].certHistory = [];
  const past = kvVisitFromMachine(j, j.machines[0], ['k50'], tab('2026-03-15')).visit;
  assert.equal(past.chambers[0].kv_cert_src, 'newer');
  const now = kvVisitFromMachine(j, j.machines[0], ['k50'], tab('2026-11-10')).visit;
  assert.equal(now.chambers[0].kv_cert_src, '');
});

/** Журнал с ускорителем m1 (пучок фотонов b1) и камерой SAMPLE_FORM, свидетельство которой «OLD» от 2024-05-01. */
const mvJournal = () =>
  normalizeJournal({
    ...JOURNAL_TAG,
    chambers: [{ id: 'c1', form: { ch_model: 'PTW30013', ch_serial: '000000', ch_ndw: '0,05335', ch_ndw_unit: 'Gy/nC', ch_klab: '1,000', ch_T0: '20', ch_P0: '101,325' }, use: { photon: true, electron: false, kv: false }, calCert: 'OLD', calDate: '2024-05-01' }],
    machines: [{ id: 'm1', name: 'Ускоритель', kind: 'linac', beams: [{ id: 'b1', kind: 'photon', name: '6 МВ', active: true, form: {} }] }],
  });

test('сразу после «Новый сертификат»: вкладка сегодняшней даты записывает новый коэффициент в действующее', () => {
  const j = mvJournal();
  j.chambers[0] = archiveCert(j.chambers[0], 'mv', { id: 'h', today: '2026-11-12' });
  const form = { ...SAMPLE_FORM, ch_ndw: '0,05341', meta_date: '2026-11-12' };
  const t = tabEquipment(j, form, 'photon');
  assert.equal(t.chamberCertSrc, 'current', 'сверка — с действующим (новым, пока пустым)');
  const res = applyTabEquipment(j, form, 'photon', { electrometer: false });
  assert.equal(res.chamber, 'updated');
  assert.equal(res.journal.chambers[0].form.ch_ndw, '0,05341');
  // для прошлых дат прежнее из истории — когда у нового указана дата калибровки (до того в карточке предупреждение)
  const c = res.journal.chambers[0];
  assert.equal(chamberOnDate(c, '2025-01-01').form.ch_ndw, '0,05341');
  c.calDate = '2026-11-01';
  assert.equal(chamberOnDate(c, '2025-01-01').form.ch_ndw, '0,05335');
});

test('запись из вкладки с коэффициентом не из свидетельства на дату: свидетельство «неизвестно», а не чужое', () => {
  const j = mvJournal();
  const ok = recordTabBeam(j, { machineId: 'm1', beamId: 'b1', form: { ...SAMPLE_FORM, meta_date: '2026-11-01' }, kind: 'photon', today: '2026-11-12' });
  assert.ok(!ok.error, ok.error);
  const b = ok.journal.sessions.at(-1).beams.at(-1);
  assert.equal(b.cert.no, 'OLD');
  const own = recordTabBeam(j, { machineId: 'm1', beamId: 'b1', form: { ...SAMPLE_FORM, ch_ndw: '0,05400', meta_date: '2026-11-01' }, kind: 'photon', today: '2026-11-12' });
  assert.ok(!own.error, own.error);
  assert.equal(own.journal.sessions.at(-1).beams.at(-1).cert.src, 'unknown');
});

test('kV: тот же сертификат с условиями измерения вкладки — не отличие; пустой № вкладки не стирает № действующего', () => {
  assert.equal(sameKvCert(KV_NEW, { ...KV_NEW, kv_V1: '300', kv_polarity: '+', kv_cq_val: ['1.004', '1.018', '1.031'] }), true);
  assert.equal(sameKvCert(KV_NEW, KV_OLD), false);
  assert.equal(sameKvCert(undefined, KV_NEW), false);
  const j = kvJournal();
  const v = kvVisitFromMachine(j, j.machines[0], ['k50'], tab('2026-11-10')).visit;
  v.common.kv_jmachine = '';
  v.modes[0].shared.kv_jmode = '';
  Object.assign(v.chambers[0], { kv_cert_no: '', kv_cert_date: '', kv_cert_lab: '' });
  const res = kvMachineFromVisit(j, v);
  const ch = res.journal.chambers.find((c) => c.id === 'ch1');
  assert.deepEqual(res.report.certOlder, [], 'тот же сертификат — не «старше действующего»');
  assert.deepEqual(res.report.certArchived, []);
  assert.equal(ch.kvCal.calCert, '0174-26');
  assert.equal(ch.kvCal.dueDate, '2027-10-06');
  assert.equal(certHistory(ch, 'kv').length, 1);
});

test('kV: № сертификата, введённый в «Оборудовании» позже, — изменение для «Обновить из Оборудования»', () => {
  const j = kvJournal();
  const cal = { ...j.chambers[0].kvCal };
  j.chambers[0].kvCal = { ...cal, calCert: '', calLab: '' };
  const m = j.machines[0];
  const v = kvVisitFromMachine(j, m, ['k50'], tab('2026-11-10')).visit;
  assert.equal(v.chambers[0].kv_cert_no, '');
  j.chambers[0].kvCal = cal;
  const r = kvRefreshFromMachine(j, m, v);
  assert.equal(r.changed, true);
  assert.equal(r.visit.chambers[0].kv_cert_no, '0174-26');
});

test('сроки: камера, которой мерили пучок ⁶⁰Co, но отмеченная только для kV, — срок свидетельства для МВ тоже', () => {
  const j = normalizeJournal({
    ...JOURNAL_TAG,
    chambers: [{ ...chamber(), use: { photon: false, electron: false, kv: true } }],
    machines: [{ id: 'co', name: 'Кобальт', kind: 'cobalt', beams: [{ id: 'cb', kind: 'cobalt', name: '⁶⁰Co', active: true, form: {} }] }],
    sessions: [{ id: 's', machineId: 'co', date: '2026-05-01', mode: 'cal', beams: [{ beamId: 'cb', kind: 'cobalt', chamberId: 'ch1', form: {}, summary: {} }] }],
  });
  assert.deepEqual(chamberDueDates(j.chambers[0], j).map((x) => x.cert), ['mv', 'kv']);
});
