// «Журнал и тренды» kV (0.48.0): ряды по датам из записей журнала — выход по стандартному тубусу, сводная мощности
// дозы «режим × аппликатор» по датам (с проверками или только калибровки), режим по датам (откуда k_pol, k_s, τ, СПО),
// текст сводной для Excel и CSV записей аппарата.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeJournal, newJournal } from '../src/core/journal.js';
import { normalizeKvVisit, newKvMode } from '../src/core/kv-session.js';
import { kvMachineFromVisit } from '../src/core/kv-journal.js';
import { recordKvVisit } from '../src/core/kv-records.js';
import { kvTrendModes, kvOutputSeries, kvDoseByDate, kvDoseByDateTsv, kvModeHistory, kvRecordsCsv, kvSrcText } from '../src/core/kv-trends.js';
import { SAMPLE_KV, SAMPLE_KV_ROWS, SAMPLE_KV_MODE2 } from '../src/core/sample-kv.js';
import { KV_DEFAULTS } from '../src/core/kv.js';
import { KV_HVL_OWN_KEYS } from '../src/core/kv-hvl.js';
import { setLang } from '../src/core/i18n.js';

const TODAY = '2026-11-03';
const CAL = SAMPLE_KV.kv_date; // 2026-09-15

function sampleVisit() {
  const v = normalizeKvVisit({ form: SAMPLE_KV, rows: [SAMPLE_KV, ...SAMPLE_KV_ROWS], active: 0 });
  const m2 = newKvMode(v.modes[0]);
  Object.assign(m2.shared, SAMPLE_KV_MODE2.shared);
  m2.rows = SAMPLE_KV_MODE2.rows.map((r) => ({ ...r }));
  v.modes.push(m2);
  return normalizeKvVisit(v);
}

const scale = (cells, k) => cells.map((s) => (s ? (Number(s.replace(',', '.')) * k).toFixed(3).replace('.', ',') : s));

/** Проверка выхода в date: показания режима 1 (и контрольные) умножены на k, без серий, τ, СПО и баз — всё из калибровки. */
function checkVisit(v, date, k = 1) {
  const w = structuredClone(v);
  Object.assign(w.common, { kv_date: date, kv_rec_mode: 'check' });
  w.modes.forEach((md, m) => {
    Object.assign(md.shared, { kv_tp_R1: ['', '', ''], kv_tp_R2: ['', '', ''] });
    for (const key of KV_HVL_OWN_KEYS) md.shared[key] = structuredClone(KV_DEFAULTS[key]);
    for (const r of md.rows) {
      Object.assign(r, { kv_Mopp: ['', '', ''], kv_M2: ['', '', ''], kv_ref: '' });
      if (m === 0) Object.assign(r, { kv_M1: scale(r.kv_M1, k), kv_Mc: scale(r.kv_Mc ?? [], k) });
    }
  });
  return normalizeKvVisit(w);
}

/** Журнал: калибровка 15.09 (базы введены вручную), проверка 20.10 (+1 % в режиме 1), калибровка 28.10 (базы из журнала). */
function history() {
  const v = sampleVisit();
  v.common.kv_machine = 'РТА';
  const res = kvMachineFromVisit(newJournal(), v);
  v.common.kv_jmachine = res.machineId;
  v.modes.forEach((md, i) => (md.shared.kv_jmode = res.modeIds[i]));
  let j = normalizeJournal(res.journal);
  const put = (visit) => {
    const r = recordKvVisit(j, { visit, today: TODAY });
    assert.equal(r.error, undefined, r.error);
    j = r.journal;
    return r.record;
  };
  const cal = put(v);
  const chk = put(checkVisit(v, '2026-10-20', 1.01));
  const w = structuredClone(v);
  w.common.kv_date = '2026-10-28';
  for (const md of w.modes) for (const r of md.rows) r.kv_ref = '';
  const cal2 = put(normalizeKvVisit(w));
  const machine = j.machines.find((x) => x.id === res.machineId);
  return { j, machine, cal, chk, cal2, modeIds: res.modeIds, v, put, now: () => j };
}

test('режимы аппарата в записях — в порядке «Оборудования», с номером и названием', () => {
  setLang('ru');
  const { j, machine, modeIds } = history();
  const ms = kvTrendModes(j, machine);
  assert.deepEqual(ms.map((x) => [x.modeId, x.n]), [[modeIds[0], 1], [modeIds[1], 2]]);
  assert.match(ms[1].title, /^150 кВ, СПО 0,50 мм Cu$/);
});

test('выход по датам: стандартный тубус режима, проверка +1 % от последней калибровки, калибровка — от прежней калибровки', () => {
  setLang('ru');
  const { j, machine, cal } = history();
  const [s1, s2] = kvOutputSeries(j, machine);
  assert.deepEqual(s1.points.map((p) => [p.date, p.kind]), [[CAL, 'cal'], ['2026-10-20', 'check'], ['2026-10-28', 'cal']]);
  const [p0, p1, p2] = s1.points;
  const std = cal.summary.modes[0].rows.find((y) => y.std);
  assert.ok(std, 'у режима 1 отмечен стандартный тубус');
  assert.equal(p0.label, s1.points[1].label);
  assert.equal(p0.baseDate, '', 'база первой калибровки введена вручную');
  assert.ok(Number.isFinite(p0.dev));
  assert.equal(p1.baseDate, CAL);
  assert.ok(Math.abs(p1.base - p0.D) < 1e-12, 'база проверки — мощность дозы при калибровке');
  assert.ok(Math.abs(p1.dev - 1) < 0.01, `отклонение ${p1.dev}`);
  assert.equal(p1.verdict, 'ok');
  // вторая калибровка сравнивается с последней калибровкой (15.09), а не с проверкой
  assert.equal(p2.baseDate, CAL);
  assert.ok(Math.abs(p2.dev) < 1e-9);
  assert.equal(p1.unit, 'Гр/мин');
  // режим 2 без изменения показаний: отклонение 0
  assert.equal(s2.points.length, 3);
  assert.ok(Math.abs(s2.points[1].dev) < 1e-9);
});

test('сводная по датам: только калибровки или с проверками; строки — режим × аппликатор', () => {
  setLang('ru');
  const { j, machine, cal, chk } = history();
  const a = kvDoseByDate(j, machine);
  assert.deepEqual(a.cols.map((c) => c.date), [CAL, '2026-10-28']);
  const nRows = cal.summary.modes.reduce((s, x) => s + x.rows.length, 0);
  assert.equal(a.rows.length, nRows);
  assert.deepEqual([...new Set(a.rows.map((r) => r.n))], [1, 2]);
  const r0 = a.rows[0];
  assert.equal(r0.cells[CAL].D, cal.summary.modes[0].rows[0].perUnit);
  assert.equal(r0.cells[CAL].kind, 'cal');
  assert.equal(r0.where, 'zref');

  const b = kvDoseByDate(j, machine, { checks: true });
  assert.deepEqual(b.cols.map((c) => [c.date, [...c.kinds]]), [[CAL, ['cal']], ['2026-10-20', ['check']], ['2026-10-28', ['cal']]]);
  assert.equal(b.rows.length, nRows);
  const c = b.rows[0].cells['2026-10-20'];
  assert.equal(c.kind, 'check');
  assert.equal(c.D, chk.summary.modes[0].rows[0].perUnit);
  assert.ok(Math.abs(c.dev - 1) < 0.01);

  const tsv = kvDoseByDateTsv(b).split('\n');
  assert.equal(tsv.length, nRows + 1);
  assert.equal(tsv[0], 'Режим\tАппликатор\tРИП, см\tЕдиница\t15.09.2026\t20.10.2026\t28.10.2026');
  assert.match(tsv[1], /^1\. .+\tГр\/мин\t\d+,\d{4}\t\d+,\d{4}\t\d+,\d{4}$/);
});

test('режим по датам: при проверке k_pol, τ и СПО — из калибровки, при калибровке — свои', () => {
  setLang('ru');
  const { j, machine, modeIds } = history();
  const h = kvModeHistory(j, machine, modeIds[0]);
  assert.deepEqual(h.map((x) => [x.date, x.kind]), [[CAL, 'cal'], ['2026-10-20', 'check'], ['2026-10-28', 'cal']]);
  const [c, k] = h;
  assert.equal(c.kpol.src, 'own');
  assert.equal(c.hvl.source, 'measured');
  assert.equal(k.kpol.src, 'journal');
  assert.equal(k.kpol.date, CAL);
  assert.equal(k.kpol.v, c.kpol.v);
  assert.equal(k.tau.src, 'journal');
  assert.equal(k.hvl.source, 'journal');
  assert.equal(k.hvl.used, c.hvl.used);
  assert.equal(k.hvl.U, null, 'неопределённость — только у измеренного СПО');
  assert.ok(c.cert && Number.isFinite(c.cert.kQ));
  assert.equal(kvSrcText('journal', CAL), 'из калибровки 15.09.2026');
  assert.equal(kvSrcText('own'), '');
});

test('CSV записей аппарата: строка на аппликатор режима в записи, «;» и запятая, по-английски — «,» и точка', () => {
  setLang('ru');
  const { j, machine, cal } = history();
  const nRows = cal.summary.modes.reduce((s, x) => s + x.rows.length, 0);
  const csv = kvRecordsCsv(j, machine);
  assert.ok(csv.startsWith('﻿'));
  const lines = csv.slice(1).trimEnd().split('\r\n');
  assert.equal(lines.length, 1 + 3 * nRows);
  assert.match(lines[0], /^Аппарат;Дата;Вид;Режим;кВ;мА;Фильтр;Аппликатор;РИП, см;Стандартный тубус;Мощность дозы;Единица;Где;База;/);
  const chk = lines.find((l) => l.includes(';2026-10-20;'));
  assert.match(chk, /;проверка выхода;/);
  assert.match(chk, /;из калибровки 15\.09\.2026;/);
  assert.match(chk, /;\d+,\d+;Гр\/мин;2 г\/см²;\d+,\d+;2026-09-15;/);

  setLang('en');
  const en = kvRecordsCsv(j, machine).slice(1).split('\r\n');
  assert.match(en[0], /^Unit,Date,Kind,Mode,kV,mA,Filter,Applicator,"SSD, cm",/);
  assert.match(en.find((l) => l.includes(',2026-10-20,')), /,output check,.*,\d+\.\d+,Gy\/min,2 g\/cm²,/);
  setLang('ru');
});

test('повторная запись того же дня только режима 2: дата в сводной одна, режим 2 — из новой записи', () => {
  setLang('ru');
  const { modeIds, v, put, now, machine: { id } } = history();
  const w = checkVisit(v, '2026-10-20', 1);
  w.modes.splice(0, 1);
  w.mode = 0;
  const rec = put(normalizeKvVisit(w));
  const j = now();
  const machine = j.machines.find((x) => x.id === id);
  const b = kvDoseByDate(j, machine, { checks: true });
  assert.deepEqual(b.cols.map((c) => c.date), [CAL, '2026-10-20', '2026-10-28']);
  const m2 = kvModeHistory(j, machine, modeIds[1]).filter((x) => x.date === '2026-10-20');
  assert.equal(m2.length, 1);
  assert.equal(m2[0].recId, rec.id);
  // режим 1 этого дня остался в прежней записи
  const m1 = kvModeHistory(j, machine, modeIds[0]).filter((x) => x.date === '2026-10-20');
  assert.equal(m1.length, 1);
  assert.notEqual(m1[0].recId, rec.id);
});
