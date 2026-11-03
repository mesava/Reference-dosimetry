// Проверки выхода рентгенотерапевтического аппарата на листах «Линейность» и «Воспроизводимость» вкладки «kV-рентген»
// (с 0.44.0). В TRS-398 Rev.1 этих проверок нет: способ и допуски — по методике учреждения (в программе — поля
// «по методике учреждения», пусто — без проверки). Расчёт — как в рабочих листах пользователя:
//   линейность — несколько заданий облучения Qᵢ (Гр, МЕ или время — в единице задания режима) с сериями показаний;
//     Xᵢ = M̄ᵢ/Qᵢ; отклонение от пропорциональности dᵢ = Xᵢ/X₁ − 1 относительно первого задания (для двух заданий
//     0,5 и 2 Гр это |1 − K₂/(4·K₁)| листа пользователя); коэффициент линейности для каждой пары
//     CLᵢⱼ = |Xᵢ − Xⱼ|/(Xᵢ + Xⱼ) и наибольший из них;
//   воспроизводимость — серия 5–10 показаний подряд при одном задании; R = |1 − K_min/K_max|, справочно — s/M̄.
// Показания — в любых одинаковых единицах (заряд, ток, доза по электрометру) при одних условиях: поправки на T и P,
// полярность и рекомбинацию в отношениях сокращаются.
import { parseNumber, parseCells, isBlank, ru } from './units.js';
import { L } from './i18n.js';
import { KV_SET_UNITS } from './kv.js';

/** Число заданий на листе «Линейность». */
export const KV_LN_N = 5;
/** Задания Qᵢ и серии показаний при них (поля режима). */
export const KV_LN_Q = Array.from({ length: KV_LN_N }, (_, i) => `kv_ln_q${i + 1}`);
export const KV_LN_SERIES = Array.from({ length: KV_LN_N }, (_, i) => `kv_ln_M${i + 1}`);
/** Серия показаний воспроизводимости (поле режима). */
export const KV_RP_SERIES = 'kv_rp_M';
/** Допуски по методике учреждения (общие для всех режимов): отклонение от пропорциональности, %; CL; R, %. */
export const KV_QA_TOL_KEYS = ['kv_ln_tol', 'kv_ln_cl_tol', 'kv_rp_tol'];
/** Поля режима, которые новый режим не копирует: задания и показания (аппликатор и расстояние копируются). */
export const KV_QA_OWN_KEYS = [...KV_LN_Q, ...KV_LN_SERIES, KV_RP_SERIES];

const tol = (f, k) => {
  const v = parseNumber(f?.[k]);
  return Number.isFinite(v) && v > 0 ? v : NaN;
};
const tolText = (x) => ru(x, Number.isInteger(x) ? 0 : Number.isInteger(x * 10) ? 1 : Number.isInteger(x * 100) ? 2 : 4);
const pct = (x, d = 2) => ru(x * 100, d);
const RANK = { info: 0, warn: 1, error: 2 };

function collector() {
  const messages = [];
  const flags = {};
  const add = (level, text, field = null) => {
    messages.push({ level, text, ref: null });
    for (const k of [].concat(field ?? [])) if (!flags[k] || RANK[level] > RANK[flags[k]]) flags[k] = level;
  };
  return { messages, flags, add };
}

/** Есть ли в режиме данные линейности (задание или показание хотя бы в одной строке). */
export function kvLinEntered(f) {
  return KV_LN_Q.some((k, i) => !isBlank(f?.[k]) || parseCells(f?.[KV_LN_SERIES[i]]).n > 0 || !!parseCells(f?.[KV_LN_SERIES[i]]).error);
}

/** Есть ли в режиме показания воспроизводимости. */
export function kvRepEntered(f) {
  const s = parseCells(f?.[KV_RP_SERIES]);
  return s.n > 0 || !!s.error;
}

/** u_A среднего серии, абсолютное и относительное (одно показание — NaN). */
function seriesStats(s) {
  const abs = Math.abs(s.mean);
  const u = s.n > 1 ? s.sd / Math.sqrt(s.n) : NaN;
  return { abs, u, urel: abs > 0 ? u / abs : NaN };
}

/**
 * Линейность режима. f — форма режима (общие поля с допусками и поля режима). Возвращает { state: 'empty'|'error'|
 * 'done', unit ({ label, labelEn }), points [{ i (0…), q, s (parseCells), abs, urel, X, d, ud }] — только задания без
 * ошибок, ref (номер задания, к которому отношения), dMax, dMaxAt, cl [{ i, j, value }], clMax, clAt ([i, j]),
 * messages, flags, ok }. ok — посчитано (два задания и больше, без ошибок).
 */
export function computeKvLinearity(f) {
  const U = KV_SET_UNITS[f?.kv_set_unit] ?? KV_SET_UNITS.min;
  const { messages, flags, add } = collector();
  const res = { state: 'empty', unit: { label: U.label, labelEn: U.labelEn }, points: [], ref: -1, dMax: NaN, dMaxAt: -1, cl: [], clMax: NaN, clAt: null, messages, flags, ok: false };
  if (!kvLinEntered(f)) return res;
  res.state = 'done';
  const unit = L(U.label, U.labelEn);
  const pts = [];
  for (let i = 0; i < KV_LN_N; i++) {
    const qk = KV_LN_Q[i];
    const mk = KV_LN_SERIES[i];
    const s = parseCells(f[mk]);
    const qBlank = isBlank(f[qk]);
    if (qBlank && s.n === 0 && !s.error) continue;
    const no = i + 1;
    const q = parseNumber(f[qk]);
    let bad = false;
    if (qBlank) {
      add('error', L(`Задание ${no}: не задано значение Q, ${unit}.`, `Setting ${no}: no Q value, ${unit}.`), qk);
      bad = true;
    } else if (!Number.isFinite(q) || q <= 0) {
      add('error', L(`Задание ${no}: Q должно быть положительным числом, ${unit}.`, `Setting ${no}: Q must be a positive number, ${unit}.`), qk);
      bad = true;
    }
    if (s.error) {
      add('error', L(`Задание ${no}: ${s.error}.`, `Setting ${no}: ${s.error}.`), mk);
      bad = true;
    } else if (s.n === 0) {
      add('error', L(`Задание ${no}: нет показаний.`, `Setting ${no}: no readings.`), mk);
      bad = true;
    } else if (s.mean === 0) {
      add('error', L(`Задание ${no}: среднее показание равно нулю.`, `Setting ${no}: the mean reading is zero.`), mk);
      bad = true;
    }
    if (bad) continue;
    if (s.n === 1) add('info', L(`Задание ${no}: одно показание — разброс серии не оценить.`, `Setting ${no}: a single reading, the spread of the series cannot be estimated.`), mk);
    pts.push({ i, q, s, ...seriesStats(s) });
  }
  const hasError = messages.some((m) => m.level === 'error');
  const signs = new Set(pts.map((p) => Math.sign(p.s.mean)));
  if (signs.size > 1) {
    add('error', L('Показания разного знака: все серии снимаются при одной полярности.', 'Readings of different sign: all series are taken at the same polarity.'), pts.map((p) => KV_LN_SERIES[p.i]));
    res.state = 'error';
    return res;
  }
  if (hasError) res.state = 'error';
  if (pts.length < 2) {
    if (!hasError) add('info', L('Для линейности нужно не меньше двух заданий с показаниями.', 'Linearity needs at least two settings with readings.'));
    return res;
  }
  // одинаковые задания — отношение между ними говорит о воспроизводимости, а не о линейности
  for (let a = 0; a < pts.length; a++) {
    for (let b = a + 1; b < pts.length; b++) {
      if (Math.abs(pts[a].q - pts[b].q) <= 1e-9 * Math.max(pts[a].q, pts[b].q)) {
        add('warn', L(`Задания ${pts[a].i + 1} и ${pts[b].i + 1} одинаковые: линейность по ним не проверяется.`, `Settings ${pts[a].i + 1} and ${pts[b].i + 1} are equal: they do not test linearity.`), [KV_LN_Q[pts[a].i], KV_LN_Q[pts[b].i]]);
      }
    }
  }
  const r0 = pts[0];
  r0.X = r0.abs / r0.q;
  for (const p of pts) {
    p.X = p.abs / p.q;
    p.d = p.X / r0.X - 1;
    const u2 = (Number.isFinite(p.urel) ? p.urel ** 2 : 0) + (p === r0 ? 0 : Number.isFinite(r0.urel) ? r0.urel ** 2 : 0);
    p.ud = p === r0 ? 0 : Number.isFinite(p.urel) || Number.isFinite(r0.urel) ? (p.X / r0.X) * Math.sqrt(u2) : NaN;
  }
  res.points = pts;
  res.ref = r0.i;
  let dMax = -1;
  for (const p of pts.slice(1)) {
    if (Math.abs(p.d) > dMax) {
      dMax = Math.abs(p.d);
      res.dMaxAt = p.i;
    }
  }
  res.dMax = dMax;
  let clMax = -1;
  for (let a = 0; a < pts.length; a++) {
    for (let b = a + 1; b < pts.length; b++) {
      const value = Math.abs(pts[a].X - pts[b].X) / (pts[a].X + pts[b].X);
      res.cl.push({ i: pts[a].i, j: pts[b].i, value });
      if (value > clMax) {
        clMax = value;
        res.clAt = [pts[a].i, pts[b].i];
      }
    }
  }
  res.clMax = clMax;
  const dTol = tol(f, 'kv_ln_tol');
  if (Number.isFinite(dTol) && dMax * 100 > dTol) {
    add('warn', L(
      `Отклонение от пропорциональности ${pct(dMax)} % (задание ${res.dMaxAt + 1} к заданию ${r0.i + 1}) больше допуска ${tolText(dTol)} % по методике учреждения.`,
      `The deviation from proportionality, ${pct(dMax)} % (setting ${res.dMaxAt + 1} vs setting ${r0.i + 1}), exceeds the local tolerance of ${tolText(dTol)} %.`,
    ), ['kv_ln_tol', KV_LN_SERIES[res.dMaxAt]]);
  }
  const cTol = tol(f, 'kv_ln_cl_tol');
  if (Number.isFinite(cTol) && clMax > cTol) {
    add('warn', L(
      `Коэффициент линейности CL = ${ru(clMax, 4)} (задания ${res.clAt[0] + 1} и ${res.clAt[1] + 1}) больше допуска ${tolText(cTol)} по методике учреждения.`,
      `The coefficient of linearity CL = ${ru(clMax, 4)} (settings ${res.clAt[0] + 1} and ${res.clAt[1] + 1}) exceeds the local tolerance of ${tolText(cTol)}.`,
    ), ['kv_ln_cl_tol', KV_LN_SERIES[res.clAt[1]]]);
  }
  res.ok = !hasError;
  return res;
}

/**
 * Воспроизводимость режима: { state, s (parseCells), n, abs (|M̄|), min, max (по модулю), R = 1 − min/max, cv = s/|M̄|,
 * messages, flags, ok }.
 */
export function computeKvRepro(f) {
  const { messages, flags, add } = collector();
  const res = { state: 'empty', n: 0, abs: NaN, min: NaN, max: NaN, R: NaN, cv: NaN, messages, flags, ok: false };
  if (!kvRepEntered(f)) return res;
  res.state = 'done';
  const k = KV_RP_SERIES;
  const s = parseCells(f[k]);
  res.s = s;
  res.n = s.n;
  if (s.error) {
    add('error', L(`Показания: ${s.error}.`, `Readings: ${s.error}.`), k);
    res.state = 'error';
    return res;
  }
  if (s.values.some((v) => v > 0) && s.values.some((v) => v < 0)) {
    add('error', L('Показания разного знака: серия снимается при одной полярности.', 'Readings of different sign: the series is taken at one polarity.'), k);
    res.state = 'error';
    return res;
  }
  if (s.values.some((v) => v === 0)) {
    add('error', L('Нулевое показание: проверьте серию.', 'A zero reading: check the series.'), k);
    res.state = 'error';
    return res;
  }
  if (s.n < 2) {
    add('info', L('Для воспроизводимости нужно не меньше двух показаний.', 'Reproducibility needs at least two readings.'), k);
    return res;
  }
  const a = s.values.map(Math.abs);
  res.abs = Math.abs(s.mean);
  res.min = Math.min(...a);
  res.max = Math.max(...a);
  res.R = 1 - res.min / res.max;
  res.cv = s.sd / res.abs;
  if (s.n < 5) add('info', L(`Показаний ${s.n}: по малой серии разброс оценивается грубо, обычно снимают 5–10.`, `${s.n} readings: a small series gives a rough estimate of the spread; usually 5–10 are taken.`), k);
  const rTol = tol(f, 'kv_rp_tol');
  if (Number.isFinite(rTol) && res.R * 100 > rTol) {
    add('warn', L(
      `Воспроизводимость |1 − K_min/K_max| = ${pct(res.R)} % больше допуска ${tolText(rTol)} % по методике учреждения.`,
      `Reproducibility |1 − K_min/K_max| = ${pct(res.R)} % exceeds the local tolerance of ${tolText(rTol)} %.`,
    ), ['kv_rp_tol', k]);
  }
  res.ok = true;
  return res;
}
