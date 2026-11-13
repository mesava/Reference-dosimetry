// Журнал kV (0.47.0): последняя калибровка режима даёт базу «Сравнить с» каждой строки (тот же аппликатор, дата
// калибровки) и, при проверке выхода, k_pol, k_s, τ и СПО режима без своих серий; запись по режимам — повторная запись
// того же дня заменяет только свои режимы.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeJournal, newJournal } from '../src/core/journal.js';
import { normalizeKvVisit, computeKvVisit, newKvMode } from '../src/core/kv-session.js';
import { kvMachineFromVisit } from '../src/core/kv-journal.js';
import { recordKvVisit, kvJournalInputs, kvLastCal, kvRecordsOn } from '../src/core/kv-records.js';
import { kvOutputRows } from '../src/core/kv-summary.js';
import { SAMPLE_KV, SAMPLE_KV_ROWS, SAMPLE_KV_MODE2 } from '../src/core/sample-kv.js';
import { KV_DEFAULTS } from '../src/core/kv.js';
import { KV_HVL_OWN_KEYS } from '../src/core/kv-hvl.js';

const TODAY = '2026-11-03';
const CAL = SAMPLE_KV.kv_date; // 2026-09-15

/** Пример (два режима, одна камера) с k_s: серия при V₂ у режима 1, режим 2 берёт k_s оттуда. */
function sampleVisit() {
  const v = normalizeKvVisit({ form: SAMPLE_KV, rows: [SAMPLE_KV, ...SAMPLE_KV_ROWS], active: 0 });
  const m2 = newKvMode(v.modes[0]);
  Object.assign(m2.shared, SAMPLE_KV_MODE2.shared);
  m2.rows = SAMPLE_KV_MODE2.rows.map((r) => ({ ...r }));
  v.modes.push(m2);
  Object.assign(v.chambers[0], { kv_ks_on: true, kv_V2: '200' });
  // серии для k_pol и k_s — у режима 1 (с 0.59.0)
  v.modes[0].shared.kv_pk_M2 = ['21,90', '21,91', '21,90'];
  return normalizeKvVisit(v);
}

/** Журнал с аппаратом вкладки и записанной калибровкой (15.09.2026). */
function calibrated() {
  const v = sampleVisit();
  v.common.kv_machine = 'РТА';
  const res = kvMachineFromVisit(newJournal(), v);
  v.common.kv_jmachine = res.machineId;
  v.modes.forEach((md, i) => (md.shared.kv_jmode = res.modeIds[i]));
  const j0 = normalizeJournal(res.journal);
  const rec = recordKvVisit(j0, { visit: v, today: TODAY });
  assert.equal(rec.error, undefined, rec.error);
  return { j: rec.journal, cal: rec.record, v, machineId: res.machineId, modeIds: res.modeIds };
}

/** Проверка выхода через месяц: те же показания M₁, без серий при обратной полярности и V₂, без τ и СПО, без баз. */
function checkVisit(v) {
  const w = structuredClone(v);
  Object.assign(w.common, { kv_date: '2026-10-20', kv_rec_mode: 'check' });
  for (const md of w.modes) {
    Object.assign(md.shared, { kv_tp_R1: ['', '', ''], kv_tp_R2: ['', '', ''] });
    for (const k of KV_HVL_OWN_KEYS) md.shared[k] = structuredClone(KV_DEFAULTS[k]);
    // серии для k_pol и k_s — у режима (с 0.59.0; в примере — перенесены из строки 1)
    Object.assign(md.shared, { kv_pk_M: ['', '', ''], kv_pk_Mopp: ['', '', ''], kv_pk_M2: ['', '', ''] });
    for (const r of md.rows) Object.assign(r, { kv_Mopp: ['', '', ''], kv_M2: ['', '', ''], kv_ref: '' });
  }
  return normalizeKvVisit(w);
}

test('проверка выхода с теми же показаниями: база, k_pol, k_s, τ и СПО — из калибровки, отклонение 0', () => {
  const { j, cal, v } = calibrated();
  const w = checkVisit(v);
  const jx = kvJournalInputs(j, w, TODAY);
  assert.equal(jx.kind, 'check');
  assert.deepEqual(jx.modes.map((x) => x.cal), [{ id: cal.id, date: CAL }, { id: cal.id, date: CAL }]);
  const [a, b] = cal.summary.modes;
  assert.deepEqual(jx.modes[0].bases.map((x) => x.ref), a.rows.map((y) => y.perUnit));
  assert.equal(jx.modes[0].pol.v, a.kpol.v);
  assert.equal(jx.modes[1].pol.v, b.kpol.v, 'k_pol режима 2 при калибровке (взятый из режима 1)');
  assert.equal(jx.modes[0].ks.v, a.ks.v);
  assert.ok(a.ks.v > 1 && a.ks.v < 1.01);
  assert.equal(jx.modes[0].tau.v, a.tau.v);
  assert.equal(jx.modes[0].hvl.used, a.hvl.used);
  assert.equal(a.hvl.source, 'measured');
  assert.equal(a.hvl.date, CAL);

  const vr = computeKvVisit(w, jx);
  const out = kvOutputRows(w, vr);
  assert.equal(out.length, 5);
  for (const r of out) {
    assert.equal(r.verdict, 'ok');
    assert.equal(r.baseDate, CAL);
    assert.ok(Math.abs(r.dev) < 1e-9, `${r.label}: ${r.dev}`);
  }
  const mr = vr.modes[0];
  assert.deepEqual([mr.polMode, mr.ksMode, mr.tauMode], [-1, -1, -1]);
  assert.equal(mr.jx.pol.date, CAL);
  const r0 = mr.results[0];
  assert.equal(r0.inputs.hvlSource, 'journal');
  assert.equal(r0.cmp.src, 'journal');
  assert.equal(r0.timer.journal, true);
  const text = r0.messages.map((m) => m.text).join('\n');
  assert.match(text, /k_pol = [\d,]+ взят из калибровки 15\.09\.2026: проверка выхода без серии при обратной полярности/);
  assert.match(text, /k_s = [\d,]+ взят из калибровки 15\.09\.2026/);
  assert.match(text, /τ = [\d,−-]+ мин — из калибровки 15\.09\.2026/);
  assert.match(text, /СПО пучка — измеренный при калибровке 15\.09\.2026/);

  // запись проверки: откуда поправки и базы
  const rec = recordKvVisit(j, { visit: w, vr, today: TODAY });
  assert.equal(rec.error, undefined, rec.error);
  const s0 = rec.record.summary.modes[0];
  assert.deepEqual([s0.kpol.src, s0.kpol.date, s0.ks.src, s0.tau.src, s0.hvl.source, s0.hvl.date], ['journal', CAL, 'journal', 'journal', 'journal', CAL]);
  assert.ok(s0.rows.every((y) => y.baseDate === CAL));
  // без вкладки vr — считается со значениями журнала сам
  const rec2 = recordKvVisit(j, { visit: w, today: TODAY });
  assert.deepEqual(rec2.record.summary.modes[0].rows.map((y) => y.dev), s0.rows.map((y) => y.dev));
});

test('свои серии и введённая база важнее журнала; при калибровке из журнала — только база', () => {
  const { j, v } = calibrated();
  const w = checkVisit(v);
  w.modes[0].rows[1].kv_ref = '0,9000';
  Object.assign(w.modes[0].shared, { kv_pk_M: ['21,92', '21,93', '21,92'], kv_pk_Mopp: ['-21,80', '-21,81', '-21,80'] });
  const vr = computeKvVisit(w, kvJournalInputs(j, w, TODAY));
  const mr = vr.modes[0];
  assert.equal(mr.results[1].cmp.src, 'manual');
  assert.equal(mr.results[1].cmp.ref, 0.9);
  assert.equal(mr.jx.pol, null, 'своя серия при обратной полярности');
  assert.ok(mr.polSrc === 0);
  // режим 2 той же камерой: k_pol — из своей калибровки, а не из режима 1 вкладки
  assert.equal(vr.modes[1].polMode, -1);
  assert.ok(vr.modes[1].jx.pol);

  w.common.kv_rec_mode = 'cal';
  const jx = kvJournalInputs(j, w, TODAY);
  assert.equal(jx.kind, 'cal');
  assert.ok(jx.modes.every((x) => x.pol === null && x.ks === null && x.tau === null && x.hvl === null));
  assert.ok(jx.modes[0].bases[0].ref > 0);
  const vc = computeKvVisit(w, jx);
  assert.equal(vc.modes[1].polMode, 0, 'калибровка: k_pol режима 2 — из режима 1 вкладки');
  assert.equal(vc.modes[0].results[0].cmp.src, 'journal');
});

test('когда журнал не подставляет: та же дата, другая камера, другие единицы, нет аппликатора, нет связи', () => {
  const { j, v, machineId, modeIds } = calibrated();
  const w = checkVisit(v);
  // калибровка того же дня — не база (её заменит эта запись)
  w.common.kv_date = CAL;
  assert.deepEqual(kvJournalInputs(j, w, TODAY).modes.map((x) => x.cal), [null, null]);
  assert.equal(kvLastCal(j, machineId, modeIds[0], CAL), null);
  assert.equal(kvLastCal(j, machineId, modeIds[0], '2026-09-16').rec.date, CAL);
  w.common.kv_date = '2026-10-20';
  // другая камера: k_pol и k_s не подставляются, τ и СПО — да
  const o = structuredClone(w);
  o.chambers[0].kv_ch_serial = '9999';
  const jo = kvJournalInputs(j, o, TODAY).modes[0];
  assert.deepEqual([jo.pol, jo.ks, jo.chamberOther], [null, null, true]);
  assert.ok(jo.tau && jo.hvl && jo.bases[0]);
  // другие единицы задания — базы нет
  const u = structuredClone(w);
  u.modes[0].shared.kv_set_unit = 's';
  assert.ok(kvJournalInputs(j, u, TODAY).modes[0].bases.every((x) => x === null));
  // аппликатора не было при калибровке
  const a = structuredClone(w);
  a.modes[0].rows[1].kv_cone = '7';
  assert.equal(kvJournalInputs(j, a, TODAY).modes[0].bases[1], null);
  // вкладка не связана с аппаратом
  const n = structuredClone(w);
  n.common.kv_jmachine = '';
  assert.equal(kvJournalInputs(j, n, TODAY), null);
  // проверки выхода — не база
  const chk = recordKvVisit(j, { visit: w, today: TODAY });
  const later = structuredClone(w);
  later.common.kv_date = '2026-10-30';
  assert.equal(kvJournalInputs(chk.journal, later, TODAY).modes[0].cal.date, CAL);
});

test('запись по режимам: повторная запись того же дня заменяет только свои режимы', () => {
  const { j, cal, v, modeIds } = calibrated();
  // в тот же день — только режим 2 (вкладка с одним режимом)
  const only2 = structuredClone(v);
  only2.modes = [only2.modes[1]];
  only2.mode = 0;
  // без режима 1 своих данных таймера и серии при V₂ нет: τ «не учитывать», k_s не измеряется
  only2.modes[0].shared.kv_timer_mode = 'none';
  only2.chambers[0].kv_ks_on = false;
  only2.common.kv_rec_mode = 'check';
  const r1 = recordKvVisit(j, { visit: normalizeKvVisit(only2), today: TODAY });
  assert.equal(r1.error, undefined, r1.error);
  assert.equal(r1.replaced, true);
  assert.deepEqual(r1.replacedModes, [0]);
  assert.notEqual(r1.record.id, cal.id);
  const day = kvRecordsOn(r1.journal, cal.machineId, CAL);
  assert.equal(day.length, 2);
  const first = day.find((r) => r.id === cal.id);
  assert.deepEqual(first.summary.modes.map((x) => x.modeId), [modeIds[0]]);
  assert.deepEqual(first.summary.replaced.map((x) => [x.m, x.modeId]), [[1, modeIds[1]]]);
  assert.deepEqual(first.summary.output, { n: 3, ok: 3, over: 0, nobase: 0, na: 0, error: 0 });
  assert.equal(first.mode, 'cal');
  assert.equal(r1.record.mode, 'check');
  // последняя калибровка режима 2 — теперь не в этот день (в этот день режим 2 — проверка)
  const later = structuredClone(v);
  later.common.kv_date = '2026-10-20';
  const jx = kvJournalInputs(r1.journal, normalizeKvVisit(later), TODAY);
  assert.equal(jx.modes[0].cal.date, CAL);
  assert.equal(jx.modes[1].cal, null);
  // ещё раз вся вкладка: обе прежние записи дня заменены, остаётся одна
  const r2 = recordKvVisit(r1.journal, { visit: v, today: TODAY });
  assert.deepEqual(r2.replacedModes, [0, 1]);
  assert.equal(kvRecordsOn(r2.journal, cal.machineId, CAL).length, 1);
  assert.ok([cal.id, r1.record.id].includes(r2.record.id));
  // журнал через JSON: порядок записей дня — по времени записи
  const back = normalizeJournal(JSON.parse(JSON.stringify(r1.journal)));
  assert.deepEqual(kvRecordsOn(back, cal.machineId, CAL).map((r) => r.id), [cal.id, r1.record.id]);
});
