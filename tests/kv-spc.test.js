// Контрольные карты kV (0.49.0): карта режима по стандартному тубусу — мощность дозы относительно первой записи отсчёта
// сквозь калибровки, новый отсчёт после смены камеры или по отметке, полоса допуска от базы последней записи и прогноз
// по тренду; общая часть режимов по датам; сигналы карты в CSV.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kvHistoryJournal, fixtureFactor, FIXTURE_DATES, FIXTURE_TODAY } from './kv-fixture.js';
import { kvControlPoints, kvModeChart, kvModeCharts, kvCommon, kvChartSignals } from '../src/core/kv-spc.js';
import { kvRecordsCsv } from '../src/core/kv-trends.js';
import { recordKvVisit } from '../src/core/kv-records.js';
import { normalizeJournal } from '../src/core/journal.js';
import { setLang } from '../src/core/i18n.js';

// показания округлены до 4 знаков — отношение доз совпадает с множителем до ~1·10⁻⁴ %
const near = (a, b, eps = 1e-3) => Math.abs(a - b) < eps;

test('точки карты: мощность дозы ст. тубуса относительно первой записи — ровно множитель дня, сквозь калибровки', () => {
  const { j, machine, modeIds } = kvHistoryJournal();
  for (const m of [0, 1]) {
    const pts = kvControlPoints(j, machine, modeIds[m]);
    assert.deepEqual(pts.map((p) => p.date), FIXTURE_DATES);
    assert.deepEqual(pts.map((p) => p.mode), ['cal', 'check', 'check', 'check', 'check', 'check', 'cal', 'check', 'check', 'check', 'check', 'check']);
    pts.forEach((p, i) => assert.ok(near(p.value, (fixtureFactor(i)[m] / fixtureFactor(0)[m] - 1) * 100), `${m} ${p.date}: ${p.value}`));
    assert.equal(pts.filter((p) => p.restart).length, 0, 'калибровка отсчёт не начинает');
    // база проверок — первая калибровка, после второй — вторая
    assert.equal(pts[1].baseDate, '2025-11-05');
    assert.ok(near(pts[1].base, pts[0].D, 1e-12));
    assert.equal(pts[7].baseDate, '2026-05-05');
    assert.ok(Number.isNaN(pts[0].base), 'у первой калибровки базы нет');
  }
});

test('карта режима: границы по 12 записям, общий сдвиг последнего дня — сигнал 3σ, полоса допуска от последней калибровки', () => {
  const { j, machine, modeIds } = kvHistoryJournal();
  const ch = kvModeChart(j, machine, modeIds[0]);
  assert.equal(ch.segments.length, 1);
  assert.ok(ch.current.limits && !ch.current.provisional);
  const last = ch.points.at(-1);
  assert.ok(last.signals.includes('3s'), JSON.stringify(last.signals));
  assert.equal(ch.points.slice(0, -1).filter((p) => p.signals.length).length, 0, 'до сдвига сигналов нет');
  assert.equal(ch.tol, 2);
  const lvl = (fixtureFactor(6)[0] / fixtureFactor(0)[0] - 1) * 100;
  assert.equal(ch.band.baseDate, '2026-05-05');
  assert.ok(near(ch.band.level, lvl));
  assert.ok(near(ch.band.hi, ((1 + lvl / 100) * 1.02 - 1) * 100));
  assert.ok(near(ch.band.lo, ((1 + lvl / 100) * 0.98 - 1) * 100));
  assert.equal(ch.forecast, null, 'тренд незначим — прогноза нет');
});

test('новый отсчёт: смена камеры и отметка «Новый отсчёт карты»; отметка остаётся у записи, записанной заново', () => {
  const h = kvHistoryJournal();
  const { machine, modeIds } = h;
  // камера сменилась с 2026-03-04
  const j1 = normalizeJournal({
    ...h.j,
    kvRecords: h.j.kvRecords.map((r) => (r.date >= '2026-03-04' ? { ...r, summary: { ...r.summary, modes: r.summary.modes.map((x) => ({ ...x, chamberId: 'other' })) } } : r)),
  });
  const p1 = kvControlPoints(j1, machine, modeIds[0]);
  const k = FIXTURE_DATES.indexOf('2026-03-04');
  assert.equal(p1[k].reason, 'equipment');
  assert.equal(p1[k].value, 0, 'новый отсчёт — от этой записи');
  assert.equal(kvModeChart(j1, machine, modeIds[0]).segments.length, 2);
  // отметка у записи 2026-06-03
  const mark = h.j.kvRecords.find((r) => r.date === '2026-06-03');
  const j2 = normalizeJournal({ ...h.j, kvRecords: h.j.kvRecords.map((r) => (r.id === mark.id ? { ...r, spcRestart: true } : r)) });
  const p2 = kvControlPoints(j2, machine, modeIds[1]);
  assert.deepEqual(p2.filter((p) => p.restart).map((p) => [p.date, p.reason]), [['2026-06-03', 'manual']]);
  // запись того же дня заново (вся вкладка) — та же запись, отметка остаётся
  const again = recordKvVisit(j2, { visit: h.visitOf(FIXTURE_DATES.indexOf('2026-06-03')), today: FIXTURE_TODAY });
  assert.equal(again.record.id, mark.id);
  assert.equal(again.record.spcRestart, true);
});

test('прогноз по значимому тренду: когда линия тренда выйдет из полосы допуска от базы', () => {
  const { j, machine, modeIds } = kvHistoryJournal();
  // режим 1: выход убывает на 0,1 % за запись (без разброса)
  const id = modeIds[0];
  let i = 0;
  const j2 = normalizeJournal({
    ...j,
    kvRecords: j.kvRecords.map((r) => ({
      ...r,
      summary: {
        ...r.summary,
        modes: r.summary.modes.map((x) => (x.modeId !== id ? x : { ...x, rows: x.rows.map((y) => (y.std ? { ...y, D: 1 - 0.001 * i++ } : y)) })),
      },
    })),
  });
  const ch = kvModeChart(j2, machine, id);
  assert.ok(ch.trend.significant);
  assert.ok(ch.trend.perMonth < 0);
  assert.equal(ch.forecast.side, -1);
  const last = ch.points.at(-1);
  assert.ok(ch.forecast.day > last.day);
  // линия тренда в день прогноза — на нижней границе полосы
  assert.ok(near(ch.trend.a + ch.trend.b * ch.forecast.day, ch.band.lo, 1e-9));
});

test('общая часть режимов по датам: сдвиг последнего дня — общий, собственные части малы', () => {
  const { j, machine } = kvHistoryJournal();
  const charts = kvModeCharts(j, machine);
  const res = kvCommon(j, machine, charts);
  assert.equal(res.rows.length, 12, 'у карт режимов есть границы (12 записей отсчёта)');
  const last = res.rows.at(-1);
  assert.equal(last.date, FIXTURE_DATES.at(-1));
  assert.ok(last.signals.includes('3s'));
  assert.ok(near(last.value, 1.48, 0.05), `${last.value}`);
  for (const b of last.beams) assert.ok(Math.abs(b.z) < 1, `${b.beamId}: ${b.z}`);
  assert.equal(res.rows.slice(0, -1).filter((r) => r.signals.length).length, 0);
});

test('CSV: сигналы карты — в строке стандартного тубуса', () => {
  setLang('ru');
  const { j, machine } = kvHistoryJournal();
  const lines = kvRecordsCsv(j, machine, kvChartSignals(j, machine)).slice(1).trimEnd().split('\r\n');
  assert.match(lines[0], /;Контрольная карта$/);
  const lastDay = lines.filter((l) => l.includes(`;${FIXTURE_DATES.at(-1)};`));
  assert.equal(lastDay.filter((l) => /точка за 3σ/.test(l)).length, 2, 'по строке на режим — у стандартного тубуса');
  assert.equal(lines.filter((l) => /точка за 3σ/.test(l)).length, 2);
});
