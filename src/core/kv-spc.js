// Контрольные карты выхода рентгенотерапевтического аппарата (с 0.49.0): карта режима по стандартному тубусу и общая
// часть режимов в один день — так же, как у ускорителей (core/spc.js, core/journal-spc.js), по записям журнала kV
// (core/kv-records.js).
//
// Что на карте. У ускорителя отклонение считается от номинального выхода — он постоянен. У kV-аппарата база
// («Сравнить с») — мощность дозы при последней калибровке, и она меняется с каждой калибровкой, хотя выход трубки при
// калибровке не меняется (обновляется только значение, по которому считают время облучения). Поэтому на карте —
// мощность дозы стандартного тубуса режима относительно первой записи отсчёта, %: ряд идёт сквозь калибровки и
// показывает сам выход трубки. Отсчёт начинается заново после смены камеры, электрометра или вида их сертификата,
// стандартного тубуса, места сравнения дозы (поверхность ↔ 2 г/см²) или единицы задания и по отметке «Новый отсчёт
// карты» (например, после ремонта или замены трубки): до и после — разные ряды. Допуск — относительно базы последней
// записи (обычно последней калибровки): на карте он показан полосой, по нему же — прогноз по значимому тренду.
import { controlChart } from './spc.js';
import { commonOf } from './journal-spc.js';
import { dayNumber } from './journal.js';
import { kvRecordsOf, kvRecordOrder } from './kv-records.js';
import { kvTrendModes, kvStdRow, kvAppLabel, kvRateUnit } from './kv-trends.js';

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const str = (v) => (v === undefined || v === null ? '' : String(v)).trim();
const differs = (a, b) => !!a && !!b && a !== b;
const YEARS3 = 3 * 365.25;

/**
 * Точки карты режима modeId по записям аппарата: [{ day, date, recId, mode ('cal' | 'check'), value (% от первой записи
 * отсчёта), D, ref, base, baseDate, tol, label, unit, restart, reason ('equipment' | 'applicator' | 'manual') }].
 * В точку идёт стандартный тубус режима с вычисленной мощностью дозы.
 */
export function kvControlPoints(j, machine, modeId) {
  const recs = kvRecordsOf(j, machine.id).slice().sort(kvRecordOrder);
  // отметка «новый отсчёт» — у записи; в один день записей может быть несколько (по режимам): действует на дату
  const marks = new Set(recs.filter((r) => r.spcRestart).map((r) => r.date));
  const out = [];
  let prev = null;
  let ref = NaN;
  for (const r of recs) {
    const x = (r.summary?.modes ?? []).find((y) => y.modeId === modeId);
    if (!x) continue;
    const y = kvStdRow(machine, modeId, x);
    const day = dayNumber(r.date);
    if (!y || !fin(y.D) || !(y.D > 0) || y.verdict === 'error' || !fin(day)) continue;
    const sig = {
      chamberId: str(x.chamberId),
      electrometerId: str(x.electrometerId),
      cert: str(x.cert?.form),
      app: y.applicatorId || `${str(y.shape)}|${str(y.a)}|${str(y.b)}|${str(y.ssd)}`,
      where: str(y.where),
      unit: str(x.setUnit),
    };
    const equipment = prev && (differs(sig.chamberId, prev.chamberId) || differs(sig.electrometerId, prev.electrometerId) || differs(sig.cert, prev.cert));
    const applicator = prev && (sig.app !== prev.app || differs(sig.where, prev.where) || differs(sig.unit, prev.unit));
    const restart = !prev ? '' : equipment ? 'equipment' : applicator ? 'applicator' : marks.has(r.date) ? 'manual' : '';
    if (!prev || restart) ref = y.D;
    out.push({
      day,
      date: r.date,
      recId: r.id,
      mode: r.mode === 'check' ? 'check' : 'cal',
      value: (y.D / ref - 1) * 100,
      D: y.D,
      ref,
      base: fin(y.base) && y.base > 0 ? y.base : NaN,
      baseDate: str(y.baseDate),
      tol: fin(y.tol) ? y.tol : NaN,
      label: kvAppLabel(machine, y),
      unit: kvRateUnit(x.setUnit),
      restart: !!restart,
      reason: restart || undefined,
    });
    prev = sig;
  }
  return out;
}

/**
 * Карта режима: controlChart по kvControlPoints и допуск относительно базы последней записи. Возвращает карту
 * (points, segments, current, trend, trendWait) и { tol, band, forecast }: band — { level, hi, lo (в % от первой
 * записи отсчёта), base, baseDate, fromDay } или null, если у последней записи базы нет; forecast — когда линия тренда
 * текущего отсчёта выйдет из полосы допуска ({ side, day } | { side, already } | { side, beyond }), только при значимом
 * тренде.
 */
export function kvModeChart(j, machine, modeId) {
  const pts = kvControlPoints(j, machine, modeId);
  const tol = [...pts].reverse().find((p) => fin(p.tol))?.tol ?? 2;
  const chart = controlChart(pts);
  const last = chart.points.at(-1);
  let band = null;
  if (last && fin(last.base)) {
    const lvl = (k) => ((last.base * k) / last.ref - 1) * 100;
    const segStart = chart.current ? chart.points[chart.current.from].day : last.day;
    const bd = dayNumber(last.baseDate);
    band = { level: lvl(1), hi: lvl(1 + tol / 100), lo: lvl(1 - tol / 100), base: last.base, baseDate: last.baseDate, fromDay: fin(bd) ? Math.max(bd, segStart) : segStart };
  }
  let forecast = null;
  const t = chart.trend;
  if (t?.significant && band && t.b !== 0) {
    const side = t.b > 0 ? 1 : -1;
    const target = side > 0 ? band.hi : band.lo;
    const fitted = t.a + t.b * last.day;
    const day = (target - t.a) / t.b;
    if (side * (fitted - target) >= 0) forecast = { side, already: true };
    else if (day - last.day > YEARS3) forecast = { side, beyond: true };
    else forecast = { side, day };
  }
  return { ...chart, tol, band, forecast };
}

/** Карты всех режимов аппарата с записями: [{ modeId, n, title, range, chart }]. */
export function kvModeCharts(j, machine) {
  return kvTrendModes(j, machine).map((md) => ({ ...md, chart: kvModeChart(j, machine, md.modeId) }));
}

/**
 * Общая часть режимов по датам: в один день режимы меряют одной камерой и электрометром при одних T и P, поэтому
 * отклонение каждого режима от его центральной линии делится на общую часть (медиана по режимам) и собственную часть
 * режима. Сдвинулись все режимы вместе — причина скорее в дозиметрии (или общая для трубки); ушёл один режим — в нём.
 * Возвращает { chart, rows, charts } (commonOf по датам; beams[].beamId — id режима).
 */
export function kvCommon(j, machine, charts = kvModeCharts(j, machine)) {
  const map = new Map(charts.map((c) => [c.modeId, c.chart]));
  const dates = [...new Set(kvRecordsOf(j, machine.id).map((r) => r.date))].sort();
  return commonOf(map, dates.map((d) => ({ key: d, date: d })), 'date');
}

/** Сигналы и наблюдения карт по записям: Map «recId|modeId» → { signals, watch } (ключи правил core/spc.js). */
export function kvChartSignals(j, machine, charts = kvModeCharts(j, machine)) {
  const out = new Map();
  for (const c of charts) for (const p of c.chart.points) if (p.signals.length || p.watch.length) out.set(`${p.recId}|${c.modeId}`, { signals: p.signals, watch: p.watch });
  return out;
}
