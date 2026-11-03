// Журнал kV (0.46.0): запись измерения вкладки «kV-рентген» в журнал отделения — аппарат «Оборудования» за день, вся
// вкладка и итоги по режимам (k_pol, k_s, τ, СПО, k_Q) и аппликаторам (мощность дозы, база, отклонение); повторная
// запись того же дня заменяет прежнюю; когда записать нельзя; что из «Оборудования» тогда не удалить.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeJournal, newJournal } from '../src/core/journal.js';
import { normalizeKvVisit, computeKvVisit, newKvMode } from '../src/core/kv-session.js';
import { kvMachineFromVisit } from '../src/core/kv-journal.js';
import { recordKvVisit, kvRecordsOf, kvRecordOn, kvModeUsed, kvAppUsed, kvEquipUsed, kvRecordCounts, kvRecMode } from '../src/core/kv-records.js';
import { kvOutputRows } from '../src/core/kv-summary.js';
import { SAMPLE_KV, SAMPLE_KV_ROWS, SAMPLE_KV_MODE2 } from '../src/core/sample-kv.js';
import { APP_VERSION } from '../src/core/version.js';

const TODAY = '2026-11-03';
const sampleVisit = () => {
  const v = normalizeKvVisit({ form: SAMPLE_KV, rows: [SAMPLE_KV, ...SAMPLE_KV_ROWS], active: 0 });
  const m2 = newKvMode(v.modes[0]);
  Object.assign(m2.shared, SAMPLE_KV_MODE2.shared);
  m2.rows = SAMPLE_KV_MODE2.rows.map((r) => ({ ...r }));
  v.modes.push(m2);
  return normalizeKvVisit(v);
};
/** Журнал с аппаратом вкладки (как после «Сохранить аппарат в Оборудование») и вкладка, связанная с ним. */
function linked() {
  const v = sampleVisit();
  v.common.kv_machine = 'РТА';
  const res = kvMachineFromVisit(newJournal(), v);
  v.common.kv_jmachine = res.machineId;
  v.modes.forEach((md, i) => (md.shared.kv_jmode = res.modeIds[i]));
  return { j: normalizeJournal(res.journal), v, machineId: res.machineId, modeIds: res.modeIds };
}

test('запись: аппарат за день — вкладка как файл и итоги по режимам и аппликаторам', () => {
  const { j, v, machineId, modeIds } = linked();
  const vr = computeKvVisit(v);
  const file = { app: 'reference-dosimetry', module: 'kv', version: 3, form: {}, ...v };
  const res = recordKvVisit(j, { visit: v, vr, file, today: TODAY });
  assert.equal(res.error, undefined, res.error);
  assert.equal(res.replaced, false);
  const rec = res.record;
  assert.equal(rec.machineId, machineId);
  assert.equal(rec.date, SAMPLE_KV.kv_date);
  assert.equal(rec.mode, 'cal');
  assert.equal(rec.version, APP_VERSION);
  assert.equal(rec.file, file);
  assert.deepEqual(rec.staff, SAMPLE_KV.kv_staff.filter(Boolean));
  const m = res.journal.machines.find((x) => x.id === machineId);
  const [a, b] = rec.summary.modes;
  assert.deepEqual(rec.summary.modes.map((x) => [x.m, x.modeId, x.title, x.range, x.rows.length]), [
    [0, modeIds[0], '200 кВ, СПО 1,00 мм Cu', 'medium', 3],
    [1, modeIds[1], '150 кВ, СПО 0,50 мм Cu', 'medium', 2],
  ]);
  // камера и электрометр — записи журнала
  assert.equal(a.chamberId, j.chambers[0].id);
  assert.equal(a.electrometerId, j.electrometers[0].id);
  assert.match(a.chamber, /^PTW 30013 № /);
  // k_pol и τ режима 2 — из режима 1 (в примере в режиме 2 своих серий нет)
  assert.equal(a.kpol.own, true);
  assert.equal(b.kpol.own, false);
  assert.equal(b.kpol.v, a.kpol.v);
  assert.equal(a.tau.own, true);
  assert.equal(b.tau.own, false);
  assert.ok(Number.isFinite(a.tau.v));
  assert.equal(a.hvl.nominal, '1,00');
  assert.equal(a.hvl.used, 1);
  assert.equal(a.hvl.mat, 'Cu');
  assert.ok(a.cert.value > 0.9 && a.cert.value < 1.1);
  // строки: аппликаторы аппарата, мощность дозы и отклонение — как на листе «Сводка и протокол»
  const out = kvOutputRows(v, vr);
  assert.deepEqual(a.rows.map((r) => [r.label, r.ssd, r.std, r.verdict]), [['Ø 10 см', '50', true, 'ok'], ['6 × 8 см', '50', false, 'ok'], ['Ø 15 см', '50', false, 'ok']]);
  a.rows.forEach((r, k) => {
    assert.equal(r.D, out[k].D);
    assert.equal(r.dev, out[k].dev);
    assert.equal(r.base, out[k].base);
    assert.equal(r.applicatorId, m.applicators.find((x) => x.shape === r.shape && x.a === r.a && x.ssd === r.ssd)?.id);
    assert.ok(r.applicatorId);
  });
  assert.equal(b.rows[0].applicatorId, a.rows[0].applicatorId, 'тот же тубус в двух режимах — один аппликатор аппарата');
  assert.deepEqual(rec.summary.output, { n: 5, ok: 5, over: 0, nobase: 0, na: 0, error: 0 });
  assert.deepEqual(kvRecordCounts(rec), { modes: 2, rows: 5, over: [], nobase: 0 });
  // JSON и обратно — через журнал: NaN не бывает, записи сохраняются
  const back = normalizeJournal(JSON.parse(JSON.stringify(res.journal)));
  assert.equal(back.kvRecords.length, 1);
  assert.deepEqual(back.kvRecords[0].summary.modes[0].rows, a.rows);
  assert.equal(back.kvRecords[0].id, rec.id);
});

test('повторная запись того же дня заменяет прежнюю; другие дни — по дате; вид измерения', () => {
  const { j, v, machineId } = linked();
  const r1 = recordKvVisit(j, { visit: v, today: TODAY });
  v.common.kv_rec_mode = 'check';
  const r2 = recordKvVisit(r1.journal, { visit: v, today: TODAY });
  assert.equal(r2.replaced, true);
  assert.equal(r2.record.id, r1.record.id);
  assert.equal(r2.journal.kvRecords.length, 1);
  assert.equal(r2.record.mode, 'check');
  assert.equal(kvRecMode(v), 'check');
  v.common.kv_date = '2026-03-01';
  const r3 = recordKvVisit(r2.journal, { visit: v, today: TODAY });
  assert.equal(r3.replaced, false);
  assert.deepEqual(kvRecordsOf(r3.journal, machineId).map((r) => r.date), ['2026-03-01', SAMPLE_KV.kv_date]);
  assert.equal(kvRecordOn(r3.journal, machineId, '2026-03-01').id, r3.record.id);
  assert.equal(kvRecordOn(r3.journal, machineId, '2026-03-02'), null);
});

test('записать нельзя: нет связи с аппаратом, нет даты, дата в будущем, доза не вычислена, ошибки листов, режима нет у аппарата', () => {
  const { j, v } = linked();
  const err = (visit, jj = j) => recordKvVisit(jj, { visit, today: TODAY }).error ?? '';
  const copy = () => structuredClone(v);
  let w = copy();
  w.common.kv_jmachine = '';
  assert.match(err(w), /не связана с аппаратом/);
  w.common.kv_jmachine = 'нет-такого';
  assert.match(err(w), /не найден в «Оборудовании»/);
  w = copy();
  w.common.kv_date = '';
  assert.match(err(w), /Укажите дату измерения/);
  w.common.kv_date = '2026-12-01';
  assert.ok(err(w));
  // пустая вкладка, связанная с аппаратом
  w = normalizeKvVisit({});
  Object.assign(w.common, { kv_jmachine: v.common.kv_jmachine, kv_date: '2026-10-01' });
  assert.match(err(w), /Записывать нечего/);
  // доза строки не вычислена
  w = copy();
  w.modes[1].rows[0].kv_M1 = ['abc'];
  assert.match(err(w), /Доза не вычислена \(режим 2, Ø 10 см\)/);
  // ошибка на листе «Воспроизводимость»
  w = copy();
  w.modes[0].shared.kv_rp_M = ['1', 'x'];
  assert.match(err(w), /Ошибки на листах: «Воспроизводимость» — режим 1/);
  // режим с показаниями, которого нет у аппарата
  w = copy();
  const m3 = newKvMode(w.modes[0]);
  Object.assign(m3.shared, { kv_kv: '250', kv_hvl: '2,0', kv_jmode: '' });
  m3.rows = [{ ...w.modes[0].rows[0] }];
  w.modes.push(m3);
  assert.match(err(w), /Режим 3 не найден у аппарата «РТА» в «Оборудовании»: сохраните аппарат/);
  // тот же режим без показаний не мешает (в запись не идёт)
  m3.rows = [{ ...m3.rows[0], kv_M1: ['', '', ''], kv_Mopp: ['', '', ''], kv_M2: ['', '', ''] }];
  const ok = recordKvVisit(j, { visit: w, today: TODAY });
  assert.equal(ok.error, undefined, ok.error);
  assert.equal(ok.record.summary.modes.length, 2);
  // режим вкладки без kv_jmode находит режим аппарата по пучку
  w = copy();
  w.modes.forEach((md) => (md.shared.kv_jmode = ''));
  assert.equal(err(w), '');
});

test('режим, аппликатор, камера и электрометр с записями kV', () => {
  const { j, v, machineId, modeIds } = linked();
  const res = recordKvVisit(j, { visit: v, today: TODAY });
  const jj = res.journal;
  const m = jj.machines.find((x) => x.id === machineId);
  assert.ok(kvModeUsed(jj, machineId, modeIds[0]));
  assert.ok(!kvModeUsed(jj, machineId, 'нет'));
  assert.ok(m.applicators.every((a) => kvAppUsed(jj, machineId, a.id)));
  assert.ok(kvEquipUsed(jj, 'chamberId', jj.chambers[0].id));
  assert.ok(kvEquipUsed(jj, 'electrometerId', jj.electrometers[0].id));
  assert.ok(!kvModeUsed(j, machineId, modeIds[0]), 'в журнале без записей');
});
