// Брахитерапия в журнале отделения (0.75.0): афтерлоадер с историей источников, сертификат колодезной камеры,
// формат файла 5 и подстановка в поля листов вкладки «Брахитерапия». Числа — обезличенные.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeJournal, JOURNAL_TAG, journalFormat, newJournal, chamberUse, chamberMissing, chamberDueDates, chamberText, cobaltCapable } from '../src/core/journal.js';
import {
  normalizeBrachyMachine, normalizeBrachyCert, sourceOn, sourceText, sourceToForm, certRowsFor, wellChamberToForm, phantomChamberToForm,
  hasBrachy, brachyMachines, isWellModel, wellChamberLabel, brachyCertMissing, SOURCE_MODELS,
} from '../src/core/brachy-journal.js';

const afterloader = () => normalizeBrachyMachine({
  id: 'm1', name: 'Flexitron', kind: 'brachy',
  sources: [
    { id: 's2', nuclide: 'Ir-192', model: 'mhdr-v2', serial: 'B-2', certValue: 41.5, certDate: '2026-09-01', installed: '2026-09-03' },
    { id: 's1', nuclide: 'Ir-192', model: 'mhdr-v2', serial: 'A-1', certValue: '40,1', certDate: '2026-06-01', installed: '2026-06-02', removed: '2026-09-03' },
  ],
});

test('афтерлоадер: источники по дате установки, поля строками, неизвестный нуклид — ¹⁹²Ir', () => {
  const m = afterloader();
  assert.deepEqual(m.sources.map((s) => s.id), ['s1', 's2']);
  assert.equal(m.sources[1].certValue, '41.5');
  assert.deepEqual(m.beams, []);
  const x = normalizeBrachyMachine({ sources: [{ nuclide: 'Xx-1' }, null] });
  assert.equal(x.sources.length, 1);
  assert.equal(x.sources[0].nuclide, 'Ir-192');
  assert.match(x.sources[0].id, /^bs/);
});

test('источник в аппарате на дату: установлен не позже даты, не заменён до неё', () => {
  const m = afterloader();
  assert.equal(sourceOn(m, '2026-07-10').id, 's1');
  assert.equal(sourceOn(m, '2026-09-03').id, 's2', 'в день замены — новый');
  assert.equal(sourceOn(m, '2026-09-02').id, 's1');
  assert.equal(sourceOn(m, '2026-05-01'), null, 'до установки первого — нет');
  assert.equal(sourceOn(m).id, 's2', 'без даты — текущий');
  assert.equal(sourceText(m.sources[0]), '¹⁹²Ir, Nucletron microSelectron mHDR-v2, № A-1, установлен 02.06.2026, заменён 03.09.2026');
});

test('поля листов из источника: сертификат, название с аппаратом, модель для дозы TG-43', () => {
  const m = afterloader();
  const f = sourceToForm(m.sources[1], m);
  assert.deepEqual([f.nuclide, f.cert_value, f.cert_date, f.p_src, f.t_src], ['Ir-192', '41.5', '2026-09-01', 'mhdr-v2', 'mhdr-v2']);
  assert.equal(f.src_name, 'Flexitron, Nucletron microSelectron mHDR-v2, № B-2');
  // своя модель — без p_src и t_src; у модели без Λ (VariSource Classic) — тоже
  assert.equal('p_src' in sourceToForm({ ...m.sources[1], model: '', modelName: 'Своя' }), false);
  assert.equal('t_src' in sourceToForm({ ...m.sources[1], model: 'varisource-classic' }), false);
  // модель для k_sm,sm0 из табл. 8 TRS-492 (PDR) — тоже в списке моделей
  assert.ok(SOURCE_MODELS.some((x) => x.id === 'gammamed-pdr'));
});

test('колодезная камера: модель, применение, «не заполнено», срок, сертификат в поля листа', () => {
  assert.equal(isWellModel('PTW33004'), true);
  assert.equal(isWellModel('PTW30013'), false);
  const c = { id: 'c1', form: { ch_model: 'PTW33004', ch_serial: 'W1' } };
  assert.equal(cobaltCapable(c.form), false, 'колодезная камера — не для пучка ⁶⁰Co');
  assert.deepEqual(chamberUse(c), { photon: false, electron: false, kv: false, brachy: true });
  assert.equal(chamberText(c), 'PTW TW33004 SourceCheck 4π № W1');
  assert.deepEqual(chamberMissing(c), brachyCertMissing(c));
  assert.equal(chamberMissing(c).length, 1);
  assert.equal(wellChamberLabel({ ch_model: 'WELLOTHER', e_other_name: ' SDS ' }), 'SDS');
  c.brachy = normalizeBrachyCert({ rows: [{ id: 'r1', label: 'Flexitron, адаптер 1', nuclide: 'Ir-192', sm0: 'mhdr-v2', N: '4,85e5', U: '1,2', pos: '1230' }, { id: 'r2', nuclide: 'Co-60', N: '' }], dueDate: '2030-01-01', T0: 22 });
  assert.deepEqual(chamberMissing(c).length, 1, 'N не во всех строках');
  c.brachy.rows[1].N = '4,90e5';
  assert.deepEqual(chamberMissing(c), []);
  assert.deepEqual(chamberDueDates(c).map((d) => [d.cert, d.dueDate]), [['brachy', '2030-01-01']]);
  assert.deepEqual(certRowsFor(c, 'Co-60').map((r) => r.id), ['r2']);
  const f = wellChamberToForm(c, c.brachy.rows[0], { name: wellChamberLabel(c.form), sourceModel: 'mhdr-v2' });
  assert.deepEqual([f.w_model, f.w_serial, f.w_N, f.w_NU, f.w_T0, f.w_P0, f.s_cert_pos, f.w_ksm_mode], ['PTW TW33004 SourceCheck 4π', 'W1', '4,85e5', '1,2', '22', '101,325', '1230', 'same']);
  assert.equal(wellChamberToForm(c, c.brachy.rows[0], { sourceModel: 'flexisource' }).w_ksm_mode, 'none');
  assert.equal('w_ksm_mode' in wellChamberToForm(c, c.brachy.rows[1], { sourceModel: 'flexisource' }), false, 'без модели калибровки — не трогается');
});

test('камера фантома: N_D,w в ⁶⁰Co с k_лаб, T₀, P₀; «брахитерапия» в «Применении»', () => {
  const c = { id: 'c2', form: { ch_model: 'PTW30013', ch_serial: 'F1', ch_ndw: '53,4', ch_ndw_unit: 'mGy/nC', ch_klab: '1,002', ch_T0: '20', ch_P0: '101,3' }, use: { photon: false, electron: false, kv: false, brachy: true } };
  assert.deepEqual(chamberUse(c), { photon: false, electron: false, kv: false, brachy: true });
  const f = phantomChamberToForm(c, { name: 'PTW 30013' });
  assert.deepEqual([f.p_model, f.p_serial, f.p_calib, f.p_N, f.p_N_unit, f.p_T0, f.p_P0], ['PTW 30013', 'F1', 'Nw', '53,5068', 'mGy/nC', '20', '101,3']);
  assert.equal(phantomChamberToForm({ form: { ch_ndw: '53,4', ch_klab: '1,000' } }).p_N, '53,4');
  // N_D,w нужен и камере только для брахитерапии
  assert.deepEqual(chamberMissing(c), []);
  assert.deepEqual(chamberMissing({ ...c, form: { ...c.form, ch_ndw: '' } }), ['N_D,w']);
});

test('журнал с брахитерапией: формат 5, записи по дате, сертификат камеры нормализуется', () => {
  assert.equal(JOURNAL_TAG.version, 5);
  assert.deepEqual(newJournal().brachyRecords, []);
  const j = normalizeJournal({
    ...JOURNAL_TAG,
    machines: [{ id: 'm1', name: 'Versa', beams: [] }, { id: 'm2', kind: 'brachy', name: 'Flexitron', sources: [{ serial: 'A' }] }],
    chambers: [{ id: 'c1', form: { ch_model: 'PTW33004' }, brachy: { rows: [{ N: 1 }] } }, { id: 'c2', form: { ch_model: 'PTW30013' }, brachy: 'x' }],
    brachyRecords: [{ id: 'b2', date: '2026-10-02' }, { date: '2026-10-01' }],
  });
  assert.equal(journalFormat(j), 5);
  assert.equal(hasBrachy(j), true);
  assert.deepEqual(brachyMachines(j).map((m) => m.id), ['m2']);
  assert.equal(j.machines[1].sources[0].nuclide, 'Ir-192');
  assert.equal(j.chambers[0].brachy.rows[0].N, '1');
  assert.equal('brachy' in j.chambers[1], false);
  assert.deepEqual(j.brachyRecords.map((r) => r.date), ['2026-10-01', '2026-10-02']);
  assert.match(j.brachyRecords[0].id, /^br/);
  // без брахитерапии — прежний формат
  assert.equal(journalFormat(normalizeJournal({ ...JOURNAL_TAG, machines: [{ id: 'm1', beams: [] }] })), 1);
});

test('Γδ, k для U и активность из паспорта источника — на листы (с 0.80.4)', () => {
  const m = afterloader();
  const s = { ...m.sources[1], certGamma: '30.18', certGammaUnit: 'aGy·m2/(s·Bq)', certK: '3', certA0: '370', certA0Unit: 'GBq', certA0Date: '2026-08-28', certA0Time: '12:00', certA0Zone: '+3' };
  const f = sourceToForm(s, m);
  assert.deepEqual([f.cert_gamma, f.cert_gamma_unit, f.cert_k], ['30.18', 'aGy·m2/(s·Bq)', '3']);
  assert.deepEqual([f.d_A0, f.d_A0_unit, f.d_A0_date, f.d_A0_time, f.d_A0_zone], ['370', 'GBq', '2026-08-28', '12:00', '+3']);
  // k не задан в «Оборудовании» — на листе остаётся выбранный там
  assert.equal('cert_k' in sourceToForm({ ...s, certK: '' }, m), false);
  // у другого источника без паспортной активности — A₀ очищается, а не остаётся от прежнего
  assert.equal(sourceToForm({ ...s, certA0: '' }, m).d_A0, '');
  // старые записи журнала без новых полей — нормализуются в пустые строки
  const n = normalizeBrachyMachine({ ...m, sources: [{ id: 'x', nuclide: 'Ir-192' }] });
  assert.deepEqual([n.sources[0].certK, n.sources[0].certA0, n.sources[0].certA0Unit], ['', '', 'GBq']);
});
