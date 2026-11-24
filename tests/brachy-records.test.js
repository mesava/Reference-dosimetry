// Записи брахитерапии в журнале (0.76.0): запись листа за день, замена при повторной записи, проверки перед записью,
// снимок полей листа и итог для списка и трендов. Числа — обезличенные.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeJournal, JOURNAL_TAG, journalFormat } from '../src/core/journal.js';
import { normalizeBrachy, computeBrachyWell, computeBrachyStability, computeBrachyCross } from '../src/core/brachy-sheets.js';
import { recordBrachy, brachyRecordsOf, removeBrachyRecord, formFromRecord, brachyFormSnapshot, brachySummary, BRACHY_RECORD_SHEETS } from '../src/core/brachy-records.js';

const journal = () => normalizeJournal({
  ...JOURNAL_TAG,
  machines: [{ id: 'm1', kind: 'brachy', name: 'Flexitron', sources: [{ id: 's1', model: 'mhdr-v2', serial: 'A-1', certValue: '40', certUnit: 'mGy/h', certDate: '2026-10-01', installed: '2026-10-01' }] }],
  chambers: [{ id: 'w1', form: { ch_model: 'PTW33004', ch_serial: 'W1' }, brachy: { rows: [{ id: 'r1', N: '5e5' }] } }],
});
// ОМВК 40 мГр/ч в день сертификата: I·N = 0,040 Гр/ч → I = 80 нА при N = 5·10⁵ Гр·м²/(ч·А)
const wellForm = (extra = {}) => normalizeBrachy({
  nuclide: 'Ir-192', cert_value: '40', cert_unit: 'mGy/h', cert_date: '2026-10-01', w_N: '5e5', w_T: '20', w_P: '1013,25', w_I: ['80', '80', '80'],
  w_date: '2026-10-01', j_machine: 'm1', j_well: 'w1', ...extra,
});

test('запись листа «Колодезная камера»: итог, снимок полей, источник по дате, замена той же даты', () => {
  const j = journal();
  const f = wellForm();
  const r = computeBrachyWell(f);
  assert.ok(r.ok);
  const res = recordBrachy(j, { sheet: 'well', form: f, r, staff: [' Иванов И. И. ', ''], notes: 'плановая', sourceId: 's1', today: '2026-11-24' });
  assert.equal(res.error, undefined);
  const rec = res.record;
  assert.deepEqual([rec.sheet, rec.machineId, rec.sourceId, rec.chamberId, rec.date, rec.notes], ['well', 'm1', 's1', 'w1', '2026-10-01', 'плановая']);
  assert.deepEqual(rec.staff, ['Иванов И. И.']);
  assert.ok(Math.abs(rec.summary.mGyh - 40) < 1e-9);
  assert.ok(Math.abs(rec.summary.dev) < 1e-9);
  assert.equal(rec.summary.nuclide, 'Ir-192');
  // снимок: поля источника и своего листа, без чужих листов
  assert.equal(rec.form.w_N, '5e5');
  assert.equal(rec.form.cert_value, '40');
  assert.equal('p_N' in rec.form, false);
  assert.equal('st_base' in rec.form, false);
  // файл с записью — формат 5
  assert.equal(journalFormat(res.journal), 5);
  // повторная запись того же дня — замена (тот же id)
  const res2 = recordBrachy(res.journal, { sheet: 'well', form: wellForm({ w_I: ['81', '81', '81'] }), r: computeBrachyWell(wellForm({ w_I: ['81', '81', '81'] })), today: '2026-11-24' });
  assert.equal(res2.replaced, true);
  assert.equal(res2.journal.brachyRecords.length, 1);
  assert.equal(res2.record.id, rec.id);
  // другой день — новая запись, по порядку дат
  const f3 = wellForm({ w_date: '2026-09-30' });
  const res3 = recordBrachy(res2.journal, { sheet: 'well', form: f3, r: computeBrachyWell(f3), today: '2026-11-24' });
  assert.deepEqual(res3.journal.brachyRecords.map((x) => x.date), ['2026-09-30', '2026-10-01']);
  assert.equal(brachyRecordsOf(res3.journal, { chamberId: 'w1' }).length, 2);
  assert.equal(brachyRecordsOf(res3.journal, { sheet: 'stab' }).length, 0);
  // удалить и открыть
  assert.equal(removeBrachyRecord(res3.journal, rec.id).brachyRecords.length, 1);
  const opened = formFromRecord(normalizeBrachy({ w_N: '1', p_N: '7' }), rec);
  assert.deepEqual([opened.w_N, opened.p_N], ['5e5', '7']);
});

test('перед записью: дата, будущая дата, расчёт, аппарат или камера из «Оборудования»', () => {
  const j = journal();
  const f = wellForm();
  const r = computeBrachyWell(f);
  assert.match(recordBrachy(j, { sheet: 'well', form: { ...f, w_date: '' }, r }).error, /дату измерения/);
  assert.match(recordBrachy(j, { sheet: 'well', form: f, r, today: '2026-09-01' }).error, /будущ|позже|сегодня/i);
  assert.match(recordBrachy(j, { sheet: 'well', form: f, r: { ok: false }, today: '2026-11-24' }).error, /Расчёт не выполнен/);
  assert.match(recordBrachy(j, { sheet: 'well', form: { ...f, j_machine: '' }, r, today: '2026-11-24' }).error, /афтерлоадер/);
  assert.match(recordBrachy(j, { sheet: 'decay', form: f, r, today: '2026-11-24' }).error, /не записывается/);
  assert.deepEqual(BRACHY_RECORD_SHEETS, ['well', 'phantom', 'stab', 'cross', 'sweet']);
});

test('стабильность и сличение: запись по камере, итог для трендов', () => {
  const j = journal();
  const st = normalizeBrachy({ st_method: 'beam', st_unit: 'pA', st_I: ['100,2', '100,2'], st_base: '100', st_T: '20', st_P: '101,325', st_P_unit: 'kPa', st_date: '2026-10-05', j_well: 'w1' });
  const rs = computeBrachyStability(st);
  const res = recordBrachy(j, { sheet: 'stab', form: st, r: rs, today: '2026-11-24' });
  assert.equal(res.error, undefined);
  const s = res.record.summary;
  assert.deepEqual([s.method, s.pass, s.tol], ['beam', true, 0.5]);
  assert.ok(Math.abs(s.dev - 0.2) < 1e-9);
  assert.equal(res.record.machineId, '');
  // без исходного значения отклонения нет — не записывается
  const st0 = { ...st, st_base: '' };
  assert.match(recordBrachy(j, { sheet: 'stab', form: st0, r: computeBrachyStability(st0), today: '2026-11-24' }).error, /исходного/);
  // сличение: рабочая и эталонная камеры
  const x = normalizeBrachy({ x_ref_N: '5e5', x_ref_I: ['100', '100'], x_fld_I: ['50', '50'], x_ref_T: '20', x_ref_P: '1013,25', x_fld_T: '20', x_fld_P: '1013,25', x_ref_date: '2026-10-06', j_fld: 'w1', j_ref: 'w2', x_fld_prev: '1e6' });
  const rx = computeBrachyCross(x);
  const rc = recordBrachy(j, { sheet: 'cross', form: x, r: rx, today: '2026-11-24' });
  assert.equal(rc.error, undefined);
  assert.deepEqual([rc.record.chamberId, rc.record.refChamberId], ['w1', 'w2']);
  assert.ok(Math.abs(rc.record.summary.N - 1e6) < 1e-3);
  assert.ok(Math.abs(rc.record.summary.dev) < 1e-9);
  assert.equal(brachyRecordsOf(rc.journal, { chamberId: 'w2' }).length, 1, 'эталонная тоже в отборе');
  // итог максимума отклика
  assert.deepEqual(brachySummary('sweet', { nuclide: 'Ir-192' }, { xPeak: 56.3, plateau: { 99: { from: 51, to: 61 } }, atCert: { shift: 1.3 } }), { nuclide: 'Ir-192', xPeak: 56.3, plateau: { from: 51, to: 61 }, shift: 1.3 });
  assert.deepEqual(Object.keys(brachyFormSnapshot('sweet', normalizeBrachy({}))).filter((k) => k.startsWith('w_')), ['w_pos']);
});
