// Контрольная карта выхода для журнала: карта индивидуальных значений с подвижным размахом (I-MR), правила
// Western Electric, табличная CUSUM и линейный тренд с проверкой значимости.
//
// Источники: Western Electric Co., Statistical Quality Control Handbook (1956) — правила сигналов; Montgomery D C,
// Introduction to Statistical Quality Control — карта I-MR (σ = MR̄/d₂, d₂ = 1,128) и табличная CUSUM (k = 0,5σ,
// h = 5σ; после сигнала сумма обнуляется); Pawlicki T, Whitaker M, Boyer A L, Med Phys 32 (2005) 2777 — контрольные карты в обеспечении качества
// лучевой терапии.
//
// Отсчёт карты начинается заново после подстройки ускорителя, смены камеры, электрометра или их калибровочных
// коэффициентов и по отметке пользователя: до и после такого события — разные процессы, и общие границы сливали бы их.
// Центральная линия и σ считаются по первым BASELINE_POINTS точкам отсчёта и дальше не меняются: так новые точки
// сравниваются с исходным уровнем, а не подтягивают границы за собой. Точки за 3σ в границы не входят (выбросы фазы I).

/** d₂ для подвижного размаха по двум точкам. */
export const D2 = 1.128;
/** Меньше точек в отсчёте — границ нет. */
export const MIN_POINTS = 5;
/** Границы — по первым точкам отсчёта; пока их меньше PROVISIONAL_BELOW, границы предварительные. */
export const BASELINE_POINTS = 20;
export const PROVISIONAL_BELOW = 10;
/** Табличная CUSUM: k и h в долях σ. */
export const CUSUM_K = 0.5;
export const CUSUM_H = 5;
const DAYS_PER_MONTH = 30.4375;

/** Квантиль t-распределения 0,975 (двусторонний 95 %) по числу степеней свободы. */
export function t975(df) {
  const T = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042];
  if (!(df >= 1)) return NaN;
  if (df <= 30) return T[Math.floor(df) - 1];
  return df <= 60 ? 2.0 : df <= 120 ? 1.98 : 1.96;
}

/** CL — среднее оставленных точек, MR̄ — по парам соседних точек, если обе оставлены. */
function estimate(values, keep) {
  const kept = values.filter((_, i) => keep[i]);
  const cl = kept.reduce((a, v) => a + v, 0) / kept.length;
  let mr = 0;
  let m = 0;
  for (let i = 1; i < values.length; i++) {
    if (!keep[i] || !keep[i - 1]) continue;
    mr += Math.abs(values[i] - values[i - 1]);
    m++;
  }
  const mrBar = m ? mr / m : NaN;
  return { cl, mrBar, sigma: mrBar / D2 };
}

/**
 * Центральная линия, подвижный размах и σ по значениям. Точки за 3σ в расчёт границ не входят (Montgomery: пересчёт
 * границ после исключения выпадающих точек фазы I), иначе один выброс завышает σ и сдвигает CL — и обычные точки по
 * другую сторону выглядят сдвигом. Исключение повторяется, пока появляются новые точки за 3σ; меньше MIN_POINTS
 * оставленных точек — не исключается ничего. excluded — индексы исключённых точек.
 */
export function baseline(values) {
  const n = values.length;
  if (n < 2) return { n, cl: n ? values[0] : NaN, mrBar: NaN, sigma: NaN, excluded: [] };
  let keep = values.map(() => true);
  let est = estimate(values, keep);
  for (let iter = 0; iter < n && est.sigma > 0; iter++) {
    const next = keep.map((k, i) => k && Math.abs(values[i] - est.cl) <= 3 * est.sigma);
    if (next.every((k, i) => k === keep[i]) || next.filter(Boolean).length < MIN_POINTS) break;
    const e2 = estimate(values, next);
    if (!(e2.sigma > 0)) break;
    keep = next;
    est = e2;
  }
  return { n, ...est, excluded: keep.flatMap((k, i) => (k ? [] : [i])) };
}

/**
 * Линейный тренд y(x) по точкам: наклон, его стандартная ошибка и значимость (|b|/SE > t₀,₉₇₅ при n − 2 степенях свободы).
 * x — сутки, y — отклонение, %; наклон пересчитывается в %/мес.
 */
export function linearTrend(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((a, v) => a + v, 0) / n;
  const my = ys.reduce((a, v) => a + v, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  if (!(sxx > 0)) return null;
  const b = sxy / sxx;
  const a = my - b * mx;
  let sse = 0;
  for (let i = 0; i < n; i++) sse += (ys[i] - a - b * xs[i]) ** 2;
  const s = Math.sqrt(sse / (n - 2));
  const se = s / Math.sqrt(sxx);
  const t = se > 0 ? Math.abs(b) / se : b !== 0 ? Infinity : 0;
  return { n, a, b, se, perMonth: b * DAYS_PER_MONTH, sePerMonth: se * DAYS_PER_MONTH, t, significant: n >= MIN_POINTS && t > t975(n - 2) };
}

/**
 * Карта по точкам [{ day, value, restart?, reason?, ... }] (value — отклонение, %); restart — с этой точки начинается
 * новый отсчёт (reason: 'adjust' | 'equipment' | 'manual'). tol — допуск, % (для прогноза по тренду).
 * Возвращает { points, segments, current, trend, forecast }:
 *   points[i] — исходная точка + segment, z = (x − CL)/σ, cusumUp, cusumDown, signals: ['3s', '2of3', 'run8', 'trend6',
 *     'cusumUp', 'cusumDown'];
 *   segments — отсчёты: { from, to (индексы), startDay, reason, n, baselineN, excluded (точек за 3σ не в границах), cl,
 *     sigma, mrBar, limits, provisional };
 *   trend — тренд последнего отсчёта (linearTrend), forecast — { side: +1|−1, day } | { side, already: true } |
 *     { side, beyond: true } (дальше трёх лет) или null.
 */
export function controlChart(input, { tol = NaN } = {}) {
  const points = input.filter((p) => Number.isFinite(p.day) && Number.isFinite(p.value)).map((p) => ({ ...p, signals: [] }));
  const segments = [];
  points.forEach((p, i) => {
    if (i === 0 || p.restart) segments.push({ from: i, to: i, startDay: p.day, reason: i === 0 ? 'start' : p.reason || 'manual' });
    else segments.at(-1).to = i;
    p.segment = segments.length - 1;
  });
  for (const seg of segments) {
    const pts = points.slice(seg.from, seg.to + 1);
    seg.n = pts.length;
    const base = baseline(pts.slice(0, BASELINE_POINTS).map((p) => p.value));
    seg.baselineN = base.n;
    seg.excluded = base.excluded.length;
    seg.cl = base.cl;
    seg.mrBar = base.mrBar;
    seg.sigma = base.sigma;
    seg.limits = seg.n >= MIN_POINTS && base.sigma > 0;
    seg.provisional = seg.limits && base.n < PROVISIONAL_BELOW;
    if (!seg.limits) continue;
    const { cl, sigma } = seg;
    let up = 0;
    let down = 0;
    pts.forEach((p, k) => {
      const z = (p.value - cl) / sigma;
      p.z = z;
      if (Math.abs(z) > 3) p.signals.push('3s');
      const last3 = pts.slice(Math.max(0, k - 2), k + 1).map((q) => (q.value - cl) / sigma);
      if (last3.length === 3 && Math.abs(z) > 2 && last3.filter((v) => Math.sign(v) === Math.sign(z) && Math.abs(v) > 2).length >= 2) p.signals.push('2of3');
      const last8 = pts.slice(Math.max(0, k - 7), k + 1).map((q) => q.value - cl);
      if (last8.length === 8 && (last8.every((v) => v > 0) || last8.every((v) => v < 0))) p.signals.push('run8');
      const last6 = pts.slice(Math.max(0, k - 5), k + 1).map((q) => q.value);
      if (last6.length === 6 && (last6.every((v, m) => m === 0 || v > last6[m - 1]) || last6.every((v, m) => m === 0 || v < last6[m - 1]))) p.signals.push('trend6');
      up = Math.max(0, up + z - CUSUM_K);
      down = Math.max(0, down - z - CUSUM_K);
      p.cusumUp = up;
      p.cusumDown = down;
      if (up > CUSUM_H) p.signals.push('cusumUp');
      if (down > CUSUM_H) p.signals.push('cusumDown');
      // после сигнала сумма начинается заново: если сдвиг продолжается, сигнал повторится, а старый сдвиг не тянется
      // сигналом за всеми последующими точками
      if (up > CUSUM_H || down > CUSUM_H) up = down = 0;
    });
  }
  const current = segments.at(-1) ?? null;
  let trend = null;
  let forecast = null;
  if (current) {
    const pts = points.slice(current.from, current.to + 1);
    trend = linearTrend(
      pts.map((p) => p.day),
      pts.map((p) => p.value),
    );
    if (trend?.significant && Number.isFinite(tol) && tol > 0 && trend.b !== 0) {
      const side = trend.b > 0 ? 1 : -1;
      const lastDay = pts.at(-1).day;
      const fitted = trend.a + trend.b * lastDay;
      const day = (side * tol - trend.a) / trend.b;
      if (side * fitted >= tol) forecast = { side, already: true };
      else if (day - lastDay > 3 * 365.25) forecast = { side, beyond: true };
      else forecast = { side, day };
    }
  }
  return { points, segments, current, trend, forecast };
}

/** Названия правил для подписей. */
export const SIGNAL_KEYS = ['3s', '2of3', 'run8', 'trend6', 'cusumUp', 'cusumDown'];
