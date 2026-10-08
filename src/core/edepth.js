// Инструмент «Кривая дозы электронов» (вкладка «Инструменты»): пересчёт кривой ионизации, измеренной камерой
// в пучке электронов, в кривую глубинной дозы и параметры пучка.
//
// 1. Глубина в данных сканера переводится в глубину точки измерения (эффективной точки):
//    TRS-398 Rev.1 — цилиндрическая камера: центр на 0,5·r_cyl глубже точки измерения (табл. 4, 18),
//    плоскопараллельная: точка измерения — внутренняя поверхность входного окна с учётом его водоэквивалентной
//    толщины (табл. 5); Report 385 — сдвиги для каждой камеры (табл. 2 и 3).
// 2. R50,ion (I50) — глубина 50 % ионизации на спаде; R50 = 1,029·I50 − 0,06 (I50 ≤ 10 г/см²) или
//    1,059·I50 − 0,37 (TRS-398, ур. 37; TG-51, ур. 16–17; Report 385, ур. 3).
// 3. Доза ∝ ионизация × s_w,air(z): TRS-398 Rev.1, разд. 7.7.1, табл. 22 (R50 = 1–10 г/см², z/R50 = 0,02–1,2).
//    Таблица получена по многопараметрическому выражению Burns, Ding, Rogers (Med. Phys. 23, 489, 1996) — ссылка [173]
//    TRS-398; оно и используется здесь (коэффициенты — Rogers, Med. Phys. 31, 3460, 2004, ур. 1) и воспроизводит все
//    значения табл. 22 в пределах округления (тест). Изменение поправки на возмущение с глубиной не учитывается: у камер
//    эталонного класса оно сдвигает R50 меньше чем на 0,05 г/см² (TRS-398, разд. 7.7.1).
// 4. По кривой дозы: R100, R90, R80, R50, практический пробег Rp (касательная в точке наибольшего спада до
//    пересечения с тормозным фоном), фон Dx, z_ref = 0,6·R50 − 0,1 (TRS-398, ур. 39) и PDD(z_ref) — для пересчёта
//    дозы на глубину максимума на вкладке «Электроны».

import { parseNumber, isBlank, ru } from './units.js';
import { L } from './i18n.js';
import { E_CHAMBERS, findEChamber } from './electron-chambers.js';
import { r50FromI50, zrefFromR50 } from './electrons.js';

export const ED_DEFAULTS = {
  protocol: 'trs',

  ed_institution: '',
  ed_machine: '',
  ed_beam: '',
  ed_date: '',
  ed_staff: [''],
  ed_notes: '',
  ed_ssd: '100',
  ed_field: '',

  ed_detector: 'chamber', // 'chamber' — ионизационная камера | 'dose' — детектор, отвечающий дозе (диод, алмаз)
  ed_ch_model: 'ROOS', // id из E_CHAMBERS | 'OTHER'
  ed_other_type: 'pp', // для 'OTHER'
  ed_other_r: '', // радиус полости, мм (цилиндрическая)
  ed_other_wet: '', // водоэквивалентная толщина входного окна, мм (плоскопараллельная)
  ed_shift_mode: 'auto', // 'auto' — по протоколу для камеры | 'none' — сдвиг уже учтён | 'manual'
  ed_shift_manual: '', // мм, со знаком: + — точка измерения глубже, чем глубина в данных

  ed_unit: 'mm', // единицы глубины в данных: 'mm' | 'cm'
  ed_data: '', // вставленные данные: глубина и показание в строке
};

const REF = { trs: 'TRS-398 Rev.1', r385: 'Report 385', burns: 'Burns et al. (1996)', rogers: 'Rogers (2004)' };
const T22 = `${REF.trs}, табл. 22`;

// ---------------------------------------------------------------- s_w,air
// Burns D T, Ding G X, Rogers D W O 1996 Med. Phys. 23 489–501; коэффициенты — Rogers 2004, ур. (1).
const BURNS = { a: 1.0752, b: -0.50867, c: 0.08867, d: -0.08402, e: -0.42806, f: 0.064627, g: 0.003085, h: -0.1246 };
export const SW_Y_RANGE = [0.02, 1.2]; // z/R50 табл. 22 TRS-398 Rev.1 (Rogers 2004: выражение пригодно до 1,1–1,2)
export const SW_R50_RANGE = [1, 10]; // R50 табл. 22, г/см²

/** s_w,air по Burns et al. (1996): R50 и z — в г/см² (см воды). */
export function swAirBurns(r50, z) {
  const x = Math.log(r50);
  const y = z / r50;
  const { a, b, c, d, e, f, g, h } = BURNS;
  return (a + b * x + c * x * x + d * y) / (1 + e * x + f * x * x + g * x ** 3 + h * y);
}

// ---------------------------------------------------------------- разбор данных
const NUM = /^[+\-−]?(\d+([.,]\d*)?|[.,]\d+)([eE][+\-−]?\d+)?$/;

/**
 * Кривая из текста: в каждой строке — глубина и показание (первые два числа). Разделители — табуляция, пробелы,
 * точка с запятой или запятая (если десятичный разделитель — точка). Строки без двух чисел пропускаются.
 * В файлах PTW (.mcc) берётся первая кривая (блок BEGIN_DATA … END_DATA).
 * Возвращает { points: [{ z, v, line }], skipped, curves }.
 */
export function parseCurveText(text) {
  let lines = String(text ?? '').replace(/\r/g, '').split('\n');
  let curves = 1;
  const begins = lines.reduce((n, l) => n + (/^\s*BEGIN_DATA\b/.test(l) ? 1 : 0), 0);
  if (begins) {
    curves = begins;
    const i0 = lines.findIndex((l) => /^\s*BEGIN_DATA\b/.test(l));
    const i1 = lines.findIndex((l, i) => i > i0 && /^\s*END_DATA\b/.test(l));
    lines = lines.slice(i0 + 1, i1 > i0 ? i1 : undefined);
  }
  const points = [];
  let skipped = 0;
  // «12.5,98.3» и «12.5, 98.3» — запятая как разделитель (решается для всего файла: тогда и «2,87» — два числа);
  // «12,5;98,3» и «12,5 98,3» — десятичная запятая
  const commaSep = !lines.some((l) => /;/.test(l)) && lines.some((l) => /\d\.\d*\s*,\s*[+\-−]?\.?\d/.test(l) || /^[^,;\t ]+,\s+\S/.test(l.trim()));
  lines.forEach((raw, k) => {
    const s = raw.trim();
    if (!s) return;
    const tokens = s.split(commaSep ? /[\t; ,]+/ : /[\t; ]+/).filter((t) => t !== '');
    const nums = [];
    for (const t of tokens) {
      if (!NUM.test(t)) {
        if (nums.length) break; // число, затем текст — дальше не смотрим
        continue;
      }
      nums.push(parseNumber(t.replace(/−/g, '-')));
      if (nums.length === 2) break;
    }
    if (nums.length === 2 && nums.every(Number.isFinite)) points.push({ z: nums[0], v: nums[1], line: k + 1 });
    else skipped++;
  });
  return { points, skipped, curves };
}

// ---------------------------------------------------------------- вспомогательное
/** Глубина, на которой значение впервые падает до level за индексом from (линейная интерполяция). */
function crossing(zs, ys, level, from) {
  for (let i = Math.max(1, from + 1); i < zs.length; i++) {
    if (ys[i] <= level && ys[i - 1] > level) return zs[i - 1] + ((ys[i - 1] - level) / (ys[i - 1] - ys[i])) * (zs[i] - zs[i - 1]);
    if (ys[i] === level) return zs[i];
  }
  return NaN;
}
/** Значение кривой на глубине z (линейная интерполяция); NaN вне диапазона. */
export function valueAt(zs, ys, z) {
  if (!(z >= zs[0] && z <= zs[zs.length - 1])) return NaN;
  for (let i = 1; i < zs.length; i++) {
    if (z <= zs[i]) return ys[i - 1] + ((z - zs[i - 1]) / (zs[i] - zs[i - 1])) * (ys[i] - ys[i - 1]);
  }
  return ys[ys.length - 1];
}
function lsq(xs, ys) {
  const n = xs.length;
  if (n < 2) return null;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  if (!(sxx > 0)) return null;
  const b = sxy / sxx;
  return { a: my - b * mx, b };
}

/** Сдвиг глубины, см (z_точки измерения = z_данных + shift), и его описание. */
export function depthShift(f, chamber) {
  const proto = f.protocol === 'tg51' ? 'tg51' : 'trs';
  if (f.ed_shift_mode === 'none') return { value: 0, text: L('сдвиг уже учтён в данных', 'the shift is already applied in the data') };
  if (f.ed_shift_mode === 'manual') {
    const mm = parseNumber(f.ed_shift_manual);
    return { value: Number.isFinite(mm) ? mm / 10 : NaN, manual: true, text: L('введён вручную', 'entered manually') };
  }
  if (f.ed_detector === 'dose') return { value: 0, text: L('без сдвига (детектор дозы; при необходимости введите сдвиг вручную)', 'no shift (dose detector; enter a shift manually if needed)') };
  if (!chamber) return { value: NaN, text: '' };
  if (chamber.type === 'cyl') {
    if (proto === 'tg51' && Number.isFinite(chamber.r385?.shiftMm)) {
      return { value: -chamber.r385.shiftMm / 10, ref: `${REF.r385}, табл. 2`, text: L(`точка измерения на ${ru(chamber.r385.shiftMm, 1)} мм выше центра камеры`, `point of measurement ${ru(chamber.r385.shiftMm, 1)} mm upstream of the chamber centre`) };
    }
    const r = chamber.trsRcylMm ?? chamber.rCavMm;
    if (!Number.isFinite(r)) return { value: NaN, text: L('нужен радиус полости камеры', 'the cavity radius is needed') };
    return {
      value: -0.05 * r,
      ref: `${REF.trs}, табл. 4, 18`,
      fallback: proto === 'tg51',
      text: L(`точка измерения на 0,5·r_cyl = ${ru(0.5 * r, 2)} мм выше центра камеры`, `point of measurement 0.5·r_cyl = ${ru(0.5 * r, 2)} mm upstream of the chamber centre`),
    };
  }
  if (proto === 'tg51' && Number.isFinite(chamber.r385?.shiftMm)) {
    return { value: chamber.r385.shiftMm / 10, ref: `${REF.r385}, табл. 3`, text: L(`точка измерения на ${ru(chamber.r385.shiftMm, 1)} мм за наружной поверхностью окна`, `point of measurement ${ru(chamber.r385.shiftMm, 1)} mm behind the outer window surface`) };
  }
  const wetMm = Number.isFinite(chamber.windowMgCm2) ? chamber.windowMgCm2 / 100 : chamber.wetMm;
  if (!Number.isFinite(wetMm)) return { value: NaN, text: L('нужна водоэквивалентная толщина входного окна', 'the water-equivalent window thickness is needed') };
  return {
    value: wetMm / 10,
    ref: `${REF.trs}, табл. 5, 18`,
    fallback: proto === 'tg51',
    text: L(`точка измерения — внутренняя поверхность окна: ${ru(wetMm, 2)} мм водного эквивалента за наружной`, `point of measurement — inner window surface: ${ru(wetMm, 2)} mm water-equivalent behind the outer one`),
  };
}

export function normalizeEdepth(input) {
  const f = { ...ED_DEFAULTS, ...input };
  if (f.protocol !== 'tg51') f.protocol = 'trs';
  if (f.ed_detector !== 'dose') f.ed_detector = 'chamber';
  if (!['auto', 'none', 'manual'].includes(f.ed_shift_mode)) f.ed_shift_mode = 'auto';
  if (f.ed_unit !== 'cm') f.ed_unit = 'mm';
  if (f.ed_other_type !== 'cyl') f.ed_other_type = 'pp';
  if (f.ed_ch_model !== 'OTHER' && !findEChamber(f.ed_ch_model)) f.ed_ch_model = 'ROOS';
  if (!Array.isArray(f.ed_staff) || !f.ed_staff.length) f.ed_staff = [''];
  return f;
}

export function resolveChamber(f) {
  if (f.ed_ch_model === 'OTHER') {
    const r = parseNumber(f.ed_other_r);
    const w = parseNumber(f.ed_other_wet);
    return { id: 'OTHER', other: true, maker: '', model: L('другая камера', 'other chamber'), type: f.ed_other_type, trsRcylMm: Number.isFinite(r) ? r : NaN, wetMm: Number.isFinite(w) ? w : NaN };
  }
  return findEChamber(f.ed_ch_model);
}

export const ED_CHAMBERS = E_CHAMBERS;

// ---------------------------------------------------------------- расчёт
export function computeEdepth(form) {
  const f = normalizeEdepth(form);
  const messages = [];
  const flags = {};
  const rank = { info: 0, warn: 1, error: 2 };
  const add = (level, text, ref = null, field = null) => {
    messages.push({ level, scope: 'common', text, ref });
    for (const k of [].concat(field ?? [])) if (!flags[k] || rank[level] > rank[flags[k]]) flags[k] = level;
  };
  const chamberMode = f.ed_detector === 'chamber';
  const chamber = chamberMode ? resolveChamber(f) : null;
  const out = { form: f, protocol: f.protocol, chamberMode, chamber, messages, flags, points: [] };

  // сдвиг
  const shift = depthShift(f, chamber);
  out.shift = shift;
  if (!Number.isFinite(shift.value)) {
    if (shift.manual) add('error', L('Не удалось прочитать сдвиг глубины.', 'Could not read the depth shift.'), null, 'ed_shift_manual');
    else if (chamber?.other) add('error', chamber.type === 'cyl' ? L('Для другой камеры введите радиус полости.', 'Enter the cavity radius for the other chamber.') : L('Для другой камеры введите водоэквивалентную толщину окна.', 'Enter the water-equivalent window thickness for the other chamber.'), null, chamber.type === 'cyl' ? 'ed_other_r' : 'ed_other_wet');
    else add('error', L(`Для этой камеры нет данных о сдвиге точки измерения (${shift.text}): введите сдвиг вручную.`, `There are no point-of-measurement data for this chamber (${shift.text}): enter the shift manually.`), null, 'ed_shift_mode');
  } else if (shift.fallback) {
    add('info', L('Этой камеры нет в табл. 2 и 3 Report 385: сдвиг принят по TRS-398. Report 385 не рекомендует такие камеры для референсной дозиметрии электронов.', 'This chamber is not in Report 385 Tables 2 and 3: the TRS-398 shift is used. Report 385 does not recommend such chambers for electron-beam reference dosimetry.'), `${REF.r385}, разд. 4`, 'ed_shift_mode');
  }

  // данные
  const parsed = parseCurveText(f.ed_data);
  out.parsed = { skipped: parsed.skipped, curves: parsed.curves, n: parsed.points.length };
  if (parsed.curves > 1) add('info', L(`В файле ${parsed.curves} кривых: взята первая.`, `The file contains ${parsed.curves} curves: the first one is used.`), null, 'ed_data');
  const k = f.ed_unit === 'cm' ? 1 : 0.1;
  const byZ = new Map();
  for (const p of parsed.points) {
    const z = Math.round(p.z * k * 1e6) / 1e6;
    const e = byZ.get(z);
    if (e) e.push(p.v);
    else byZ.set(z, [p.v]);
  }
  let pts = [...byZ.entries()].map(([z, vs]) => ({ z, v: vs.reduce((s, x) => s + x, 0) / vs.length })).sort((a, b) => a.z - b.z);
  if (pts.length < parsed.points.length) add('info', L('Повторяющиеся глубины усреднены.', 'Repeated depths have been averaged.'), null);
  if (isBlank(f.ed_data)) {
    add('error', L('Вставьте кривую: в каждой строке — глубина и показание.', 'Paste the curve: depth and reading on each line.'), null, 'ed_data');
    return finish(out);
  }
  if (pts.length < 5) {
    add('error', L('Нужно не меньше пяти точек кривой: в каждой строке — глубина и показание.', 'At least five curve points are needed: depth and reading on each line.'), null, 'ed_data');
    return finish(out);
  }
  if (pts.some((p) => p.v < 0)) add('warn', L('Есть отрицательные показания: проверьте вычитание фона и полярность.', 'There are negative readings: check the background subtraction and polarity.'), null, 'ed_data');
  if (!Number.isFinite(shift.value)) return finish(out);

  // глубина точки измерения
  const dz = shift.value;
  const all = pts.map((p) => ({ ...p, zEff: p.z + dz }));
  pts = all.filter((p) => p.zEff >= -1e-9);
  if (pts.length < all.length) add('info', L(`${all.length - pts.length} точек после сдвига оказались над поверхностью воды и отброшены.`, `${all.length - pts.length} points ended up above the water surface after the shift and were dropped.`), null, 'ed_shift_mode');
  const zs = pts.map((p) => p.zEff);
  const vMax = Math.max(...pts.map((p) => p.v));
  if (!(vMax > 0)) {
    add('error', L('Наибольшее показание не больше нуля.', 'The largest reading is not positive.'), null, 'ed_data');
    return finish(out);
  }
  const iMax = pts.findIndex((p) => p.v === vMax);
  const I = pts.map((p) => (p.v / vMax) * 100);
  if (iMax >= pts.length - 2) {
    add('error', L('Максимум — в конце кривой: проверьте направление глубины и единицы.', 'The maximum is at the end of the curve: check the depth direction and units.'), null, 'ed_unit');
    return finish(out);
  }

  // R50
  let r50;
  if (chamberMode) {
    out.i50 = crossing(zs, I, 50, iMax);
    if (!Number.isFinite(out.i50)) {
      add('error', L('Ионизация не опускается до 50 %: кривая должна идти дальше R50.', 'The ionization does not fall to 50%: the curve must extend beyond R50.'), null, 'ed_data');
      return finish(out);
    }
    const r = r50FromI50(out.i50);
    r50 = r.value;
    out.r50eq = r.equation;
  } else {
    r50 = crossing(zs, I, 50, iMax);
    if (!Number.isFinite(r50)) {
      add('error', L('Кривая не опускается до 50 %: она должна идти дальше R50.', 'The curve does not fall to 50%: it must extend beyond R50.'), null, 'ed_data');
      return finish(out);
    }
  }
  out.r50 = r50;
  if (!(r50 > 0)) {
    add('error', L('R50 получился не больше нуля: проверьте единицы глубины.', 'R50 came out non-positive: check the depth units.'), null, 'ed_unit');
    return finish(out);
  }

  // s_w,air и доза
  let clampedNear = 0;
  let clampedFar = 0;
  const D0 = pts.map((p) => {
    if (!chamberMode) return p.v;
    let y = p.zEff / r50;
    if (y < SW_Y_RANGE[0]) {
      y = SW_Y_RANGE[0];
      clampedNear++;
    } else if (y > SW_Y_RANGE[1]) {
      y = SW_Y_RANGE[1];
      clampedFar++;
    }
    p.s = swAirBurns(r50, y * r50);
    return p.v * p.s;
  });
  const dMaxRaw = Math.max(...D0);
  const D = D0.map((d) => (d / dMaxRaw) * 100);
  pts.forEach((p, i) => {
    p.I = I[i];
    p.D = D[i];
  });
  out.points = pts;
  if (chamberMode) {
    const sRef = swAirBurns(r50, Math.min(Math.max(zrefFromR50(r50), SW_Y_RANGE[0] * r50), SW_Y_RANGE[1] * r50));
    pts.forEach((p) => (p.sRel = p.s / sRef));
    if (clampedNear) add('info', L(`У самой поверхности (z/R50 < 0,02, ${clampedNear} точ.) s_w,air взят при z/R50 = 0,02 — первой строке табл. 22.`, `Near the surface (z/R50 < 0.02, ${clampedNear} pts) s_w,air is taken at z/R50 = 0.02, the first row of Table 22.`), T22);
    if (clampedFar) add('info', L(`За z/R50 = 1,2 (${clampedFar} точ., тормозной хвост) s_w,air взят при z/R50 = 1,2 — последней строке табл. 22; на R50 и PDD(z_ref) это не влияет.`, `Beyond z/R50 = 1.2 (${clampedFar} pts, bremsstrahlung tail) s_w,air is taken at z/R50 = 1.2, the last row of Table 22; R50 and PDD(z_ref) are not affected.`), T22);
    if (r50 < SW_R50_RANGE[0] || r50 > SW_R50_RANGE[1]) add('warn', L(`R50 = ${ru(r50, 2)} г/см² вне диапазона табл. 22 (1–10 г/см²): s_w,air рассчитан по выражению Burns et al. за пределами таблицы.`, `R50 = ${ru(r50, 2)} g/cm² is outside the range of Table 22 (1–10 g/cm²): s_w,air is calculated with the Burns et al. expression beyond the table.`), T22);
  }

  // параметры кривой дозы
  const jMax = D.indexOf(100);
  // R100 — вершина параболы по точкам не ниже 98 % вокруг максимума (иначе — точка максимума)
  let r100 = zs[jMax];
  {
    let lo = jMax;
    let hi = jMax;
    while (lo > 0 && D[lo - 1] >= 98) lo--;
    while (hi < D.length - 1 && D[hi + 1] >= 98) hi++;
    if (hi - lo >= 2) {
      const xs = zs.slice(lo, hi + 1);
      const ys = D.slice(lo, hi + 1);
      // y = c0 + c1·x + c2·x² методом наименьших квадратов
      const n = xs.length;
      const S = (p) => xs.reduce((s, x) => s + x ** p, 0);
      const T = (p) => xs.reduce((s, x, i) => s + x ** p * ys[i], 0);
      const A = [[n, S(1), S(2)], [S(1), S(2), S(3)], [S(2), S(3), S(4)]];
      const B = [T(0), T(1), T(2)];
      const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
      const d0 = det(A);
      if (Math.abs(d0) > 1e-12) {
        const col = (c) => A.map((row, i) => row.map((v, j) => (j === c ? B[i] : v)));
        const c1 = det(col(1)) / d0;
        const c2 = det(col(2)) / d0;
        const v = -c1 / (2 * c2);
        if (c2 < 0 && v >= xs[0] && v <= xs[n - 1]) r100 = v;
      }
    }
  }
  out.r100 = r100;
  out.r90 = crossing(zs, D, 90, jMax);
  out.r80 = crossing(zs, D, 80, jMax);
  out.r50dose = crossing(zs, D, 50, jMax);
  out.r20 = crossing(zs, D, 20, jMax);
  out.zref = zrefFromR50(r50);
  out.pddZref = valueAt(zs, D, out.zref);
  out.e0 = 2.33 * r50;

  // практический пробег: касательная по точкам спада 30–70 % (почти прямой участок у точки наибольшего спада)
  const fall = [];
  for (let i = jMax + 1; i < D.length; i++) if (D[i] <= 70 && D[i] >= 30) fall.push(i);
  const tan = fall.length >= 2 ? lsq(fall.map((i) => zs[i]), fall.map((i) => D[i])) : null;
  if (tan && tan.b < 0) {
    out.tangent = tan;
    const z0 = -tan.a / tan.b; // касательная пересекает ноль
    // тормозной фон — глубже, чем касательная доходит до нуля, с запасом на закругление конца спада
    const tailFrom = (start) => {
      const t = [];
      for (let i = jMax + 1; i < D.length; i++) if (zs[i] >= start) t.push(i);
      return t;
    };
    let tail = tailFrom(z0 + Math.max(0.2, Number.isFinite(out.r80) ? z0 - out.r80 : 0));
    if (tail.length < 2) tail = tailFrom(z0 + 0.2);
    let bg = { a: 0, b: 0 };
    if (tail.length >= 2) bg = lsq(tail.map((i) => zs[i]), tail.map((i) => D[i])) || { a: D[tail[0]], b: 0 };
    else if (tail.length === 1) bg = { a: D[tail[0]], b: 0 };
    out.background = { ...bg, measured: tail.length > 0, n: tail.length };
    out.rp = (bg.a - tan.a) / (tan.b - bg.b);
    out.dx = bg.a + bg.b * out.rp;
    if (!tail.length) add('info', L('Кривая заканчивается раньше тормозного фона: R_p найден по пересечению касательной с нулём, D_x не определён.', 'The curve ends before the bremsstrahlung background: R_p is where the tangent crosses zero, D_x is not determined.'), null, 'ed_data');
  }

  // проверки
  if (chamberMode && chamber?.type === 'cyl' && r50 < 3) {
    add('warn', L(`R50 = ${ru(r50, 2)} г/см² меньше 3 г/см²: для таких пучков нужна плоскопараллельная камера.`, `R50 = ${ru(r50, 2)} g/cm² is below 3 g/cm²: a plane-parallel chamber is needed for such beams.`), `${REF.trs}, разд. 7.3.2, табл. 18`, 'ed_ch_model');
  }
  if (chamberMode && f.protocol === 'tg51' && (out.i50 < 1.7 || out.i50 > 10)) {
    add('warn', L(`I50 = ${ru(out.i50, 2)} см вне диапазона 1,7–10 см, для которого Report 385 даёт формулу R50 по I50.`, `I50 = ${ru(out.i50, 2)} cm is outside the 1.7–10 cm range for which Report 385 gives the R50-from-I50 formula.`), `${REF.r385}, ур. 3`, 'ed_data');
  }
  if (!chamberMode) {
    add('info', L('Детектор должен отвечать дозе и не зависеть от мощности дозы (для электронов — неэкранированный диод); это подтверждают сравнением с кривой, измеренной камерой.', 'The detector must respond to dose independently of dose rate (for electrons, an unshielded diode); this is confirmed by comparison with a curve measured with a chamber.'), `${REF.r385}, разд. 4`, 'ed_detector');
  }
  if (chamberMode && Number.isFinite(out.r50dose) && Math.abs(out.r50dose - r50) > 0.1) {
    add('info', L(`Глубина 50 % на кривой дозы (${ru(out.r50dose, 2)} см) отличается от R50 по ур. 37 (${ru(r50, 2)} г/см²) больше чем на 1 мм. Для k_Q и z_ref используется R50 по ур. 37.`, `The 50% depth of the dose curve (${ru(out.r50dose, 2)} cm) differs from R50 per Eq. 37 (${ru(r50, 2)} g/cm²) by more than 1 mm. R50 per Eq. 37 is used for k_Q and z_ref.`), `${REF.trs}, ур. 37`);
  }
  // шаг на спаде
  const steps = [];
  for (let i = jMax + 1; i < D.length; i++) if (D[i - 1] >= 20 && D[i] <= 80) steps.push(zs[i] - zs[i - 1]);
  const maxStep = steps.length ? Math.max(...steps) : NaN;
  out.maxStep = maxStep;
  if (Number.isFinite(maxStep) && maxStep > 0.2) add('info', L(`Шаг на спаде до ${ru(maxStep * 10, 1)} мм: для точных R50 и R80 лучше 1 мм и меньше.`, `The step on the falloff is up to ${ru(maxStep * 10, 1)} mm: 1 mm or less is better for accurate R50 and R80.`), null, 'ed_data');
  if (!Number.isFinite(out.pddZref)) add('warn', L('Опорная глубина вне измеренного диапазона: PDD(z_ref) не определён.', 'The reference depth is outside the measured range: PDD(z_ref) is not determined.'), null, 'ed_data');
  if (zs[0] > 0.3) add('info', L(`Кривая начинается с ${ru(zs[0] * 10, 1)} мм: поверхность и нарастание дозы не измерены.`, `The curve starts at ${ru(zs[0] * 10, 1)} mm: the surface and build-up are not measured.`), null, 'ed_data');
  if (parsed.skipped > 2 && parsed.points.length) add('info', L(`Пропущено строк без двух чисел: ${parsed.skipped} (заголовки, комментарии).`, `Lines without two numbers skipped: ${parsed.skipped} (headers, comments).`), null);
  return finish(out);
}

function finish(out) {
  const order = { error: 0, warn: 1, info: 2 };
  out.messages.sort((a, b) => order[a.level] - order[b.level]);
  out.hasErrors = out.messages.some((m) => m.level === 'error');
  out.blocked = out.hasErrors || !Number.isFinite(out.r50);
  return out;
}

/** Кривая дозы для системы планирования: глубина точки измерения, см, и PDD, % (CSV, разделитель — точка с запятой). */
export function curveCsv(r, { dec = ',' } = {}) {
  const n = (v, d) => (Number.isFinite(v) ? v.toFixed(d).replace('.', dec) : '');
  const head = r.chamberMode ? ['z, cm', 'I, %', 's_w,air', 'PDD, %'] : ['z, cm', 'PDD, %'];
  const rows = r.points.map((p) => (r.chamberMode ? [n(p.zEff, 3), n(p.I, 2), n(p.s, 4), n(p.D, 2)] : [n(p.zEff, 3), n(p.D, 2)]));
  return [head, ...rows].map((row) => row.join(';')).join('\n');
}
