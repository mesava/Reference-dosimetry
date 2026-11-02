// Таблицы для kV-рентгена: камеры вкладки, поправка на геометрию для PTW 23342 и 23344 (TRS-398 Rev.1, табл. 28 и 29),
// p_ch для цилиндрических камер на глубине 2 см (табл. 32) и интерполяция по ln(СПО).
//
// Табл. 28 и 29 (данные PTB [190]): k_g для серии качеств PTB TW при РИП 30 см и диаметре поля f; каждый столбец —
// своё качество, нормированное на f = 3 см внутри столбца (TRS-398 Rev.1, ур. 84). Столбцам присвоены СПО качеств TW
// по DIN 6809-4:2020, табл. 2 (при 30 см). Пучок между столбцами ставится линейно по ln(СПО), как k_Q
// (рабочие записи 8.7 и 9.7); значение по кВ даётся рядом, их расхождение относится к неопределённости k_g
// (в Rev.1 этот выбор не описан). По полю — линейно между строками, без экстраполяции.

import { L } from './i18n.js';

/** Качества PTB TW — столбцы табл. 28 и 29: кВ и первый СПО, мм Al (DIN 6809-4:2020, табл. 2). */
export const TW_COLUMNS = [
  { name: 'TW10', kv: 10, hvl: 0.03 },
  { name: 'TW20', kv: 20, hvl: 0.113 },
  { name: 'TW30', kv: 30, hvl: 0.359 },
  { name: 'TW40', kv: 40, hvl: 0.741 },
  { name: 'TW50', kv: 50, hvl: 0.94 },
  { name: 'TW70', kv: 70, hvl: 2.94 },
  { name: 'TW100', kv: 100, hvl: 4.41 },
];

/** Диаметры поля f, см — строки табл. 28 и 29. */
export const KG_TABLE_F = [2, 3, 5, 6, 8, 10, 15, 20];

/** TRS-398 Rev.1, табл. 28: PTW 23342, РИП 30 см; строки — f, столбцы — TW10…TW100. */
export const TRS_TABLE28 = [
  [1.0, 1.0, 1.01, 1.01, 1.01, 1.02, 1.02],
  [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
  [1.0, 1.0, 1.0, 0.98, 0.98, 0.97, 0.98],
  [1.0, 1.0, 1.0, 0.99, 0.99, 0.97, 0.96],
  [1.0, 1.0, 1.0, 0.98, 0.98, 0.95, 0.94],
  [1.0, 1.0, 1.0, 0.97, 0.97, 0.93, 0.93],
  [1.0, 1.0, 1.0, 0.98, 0.95, 0.93, 0.92],
  [1.0, 1.0, 1.0, 0.98, 0.96, 0.92, 0.91],
];

/** TRS-398 Rev.1, табл. 29: PTW 23344, РИП 30 см; строки — f, столбцы — TW10…TW100. */
export const TRS_TABLE29 = [
  [1.0, 1.0, 1.01, 1.02, 1.02, 1.03, 1.04],
  [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
  [1.0, 1.0, 0.99, 0.98, 0.98, 0.96, 0.96],
  [1.0, 1.0, 0.99, 0.98, 0.97, 0.95, 0.95],
  [1.0, 1.0, 0.99, 0.98, 0.96, 0.94, 0.93],
  [1.0, 1.0, 0.99, 0.97, 0.95, 0.93, 0.92],
  [1.0, 1.0, 0.99, 0.97, 0.95, 0.92, 0.9],
  [1.0, 1.0, 0.99, 0.96, 0.95, 0.9, 0.9],
];

/** Таблица k_g по типу камеры. */
export const KG_TABLES = { T28: { table: 28, rows: TRS_TABLE28 }, T29: { table: 29, rows: TRS_TABLE29 } };

/** TRS-398 Rev.1, табл. 32: p_ch,Q на глубине 2 см (f = 10 см, РИП 100 см); качества 70–300 кВ, СПО в мм Cu. */
export const TRS_TABLE32 = {
  kv: [70, 100, 120, 140, 150, 200, 250, 280, 300],
  hvl: [0.108, 0.192, 0.303, 0.477, 0.838, 1.581, 2.498, 3.384, 3.592],
  pch: {
    'FC65-P': [0.991, 0.997, 1.0, 0.999, 0.997, 0.994, 0.994, 0.995, 0.995],
    '30013': [1.001, 1.008, 1.014, 1.016, 1.016, 1.011, 1.008, 1.006, 1.006],
    '2571': [0.994, 1.004, 1.011, 1.015, 1.017, 1.012, 1.009, 1.007, 1.007],
    A12: [0.99, 1.0, 1.005, 1.006, 1.008, 1.005, 1.004, 1.003, 1.003],
    'FC65-G': [0.995, 1.004, 1.011, 1.014, 1.018, 1.015, 1.011, 1.009, 1.009],
  },
};

/**
 * Камеры вкладки. Плоскопараллельные для низких энергий — TRS-398 Rev.1, табл. 7 (PTW 23342, 23344) и PTW 34013
 * (в табл. 7 нет); цилиндрические — камеры табл. 32 (они же в табл. 4). Другие камеры вводятся как свои.
 * kgTable — табл. 28 или 29 для k_g; pch — столбец табл. 32.
 */
export const KV_CHAMBERS = [
  { id: 'PTW23342', maker: 'PTW', model: '23342', type: 'pp', volume: 0.02, table7: true, kgTable: 'T28' },
  { id: 'PTW23344', maker: 'PTW', model: '23344', type: 'pp', volume: 0.2, table7: true, kgTable: 'T29' },
  { id: 'PTW34013', maker: 'PTW', model: '34013', type: 'pp', volume: 0.0055, table7: false },
  { id: 'IBA-FC65-P', maker: 'IBA', model: 'FC65-P', type: 'cyl', volume: 0.65, pch: 'FC65-P' },
  { id: 'IBA-FC65-G', maker: 'IBA', model: 'FC65-G', type: 'cyl', volume: 0.65, pch: 'FC65-G' },
  { id: 'PTW30013', maker: 'PTW', model: '30013', type: 'cyl', volume: 0.6, pch: '30013' },
  { id: 'NE2571', maker: 'NE', model: '2571', type: 'cyl', volume: 0.69, pch: '2571' },
  { id: 'EXR-A12', maker: 'Exradin', model: 'A12', type: 'cyl', volume: 0.65, pch: 'A12' },
];

export const kvChamberLabel = (c) => `${c.maker} ${c.model}`;

/**
 * Камера по полям формы. Своя камера ('CUSTOM' или сохранённая 'MY:…') описывается полями kv_cc_*.
 * @returns {null | {id, custom, type, label, table7?, kgTable?, pch?}}
 */
export function resolveKvChamber(f) {
  const id = String(f.kv_ch_model ?? '');
  if (!id) return null;
  if (id === 'CUSTOM' || id.startsWith('MY:')) {
    const label = [f.kv_cc_maker, f.kv_cc_model].map((s) => String(s ?? '').trim()).filter(Boolean).join(' ');
    return { id, custom: true, type: f.kv_cc_type === 'pp' ? 'pp' : 'cyl', label: label || L('своя камера', 'custom chamber') };
  }
  const c = KV_CHAMBERS.find((x) => x.id === id);
  return c ? { ...c, custom: false, label: kvChamberLabel(c) } : null;
}

/**
 * Линейная интерполяция y по ln(x) по точкам, упорядоченным по x. За пределами — линейная экстраполяция
 * по крайнему отрезку (extrapolated: 'below' | 'above'); одна точка — её значение.
 */
export function interpLog(xs, ys, x) {
  const n = xs.length;
  if (n === 0 || !(x > 0)) return { value: NaN, extrapolated: null };
  if (n === 1) return { value: ys[0], extrapolated: Math.abs(x - xs[0]) > 1e-12 ? (x < xs[0] ? 'below' : 'above') : null };
  let i = 0;
  while (i < n - 2 && x > xs[i + 1]) i++;
  const t = (Math.log(x) - Math.log(xs[i])) / (Math.log(xs[i + 1]) - Math.log(xs[i]));
  const extrapolated = x < xs[0] - 1e-12 ? 'below' : x > xs[n - 1] + 1e-12 ? 'above' : null;
  return { value: ys[i] + t * (ys[i + 1] - ys[i]), extrapolated, i, t };
}

/** Линейная интерполяция без экстраполяции: NaN вне [xs[0], xs[n−1]]. */
function interpLin(xs, ys, x) {
  const n = xs.length;
  if (!(x >= xs[0] - 1e-9 && x <= xs[n - 1] + 1e-9)) return NaN;
  let i = 0;
  while (i < n - 2 && x > xs[i + 1]) i++;
  const t = (x - xs[i]) / (xs[i + 1] - xs[i]);
  return ys[i] + t * (ys[i + 1] - ys[i]);
}

/** Столбец табл. 28/29 при диаметре поля f (линейно между строками; вне 2–20 см — NaN). */
function columnAtF(rows, col, f) {
  return interpLin(KG_TABLE_F, rows.map((r) => r[col]), f);
}

/**
 * Значение табл. 28/29 для качества и поля: по ln(СПО) между столбцами TW (основное) и по кВ (для сравнения).
 * Возвращает { byHvl, byKv } — значения T(f), NaN вне таблицы.
 */
function tableValue(rows, { kv, hvl }, f) {
  const cols = TW_COLUMNS.map((_, j) => columnAtF(rows, j, f));
  const lnH = TW_COLUMNS.map((c) => Math.log(c.hvl));
  const inHvl = hvl >= TW_COLUMNS[0].hvl - 1e-12 && hvl <= TW_COLUMNS[TW_COLUMNS.length - 1].hvl + 1e-12;
  const inKv = kv >= TW_COLUMNS[0].kv - 1e-9 && kv <= TW_COLUMNS[TW_COLUMNS.length - 1].kv + 1e-9;
  return {
    byHvl: inHvl ? interpLin(lnH, cols, Math.log(hvl)) : NaN,
    byKv: inKv ? interpLin(TW_COLUMNS.map((c) => c.kv), cols, kv) : NaN,
  };
}

/**
 * k_g по табл. 28 или 29: T(f_clin) / T(f_lab) — таблица нормирована на f = 3 см, для другого поля лаборатории
 * перенормируется (TRS-398 Rev.1, текст перед табл. 28). hvl — мм Al, f — диаметры, см.
 * @returns {{ value, byKv, spreadPct, table, inRange: {hvl, kv, f} }}
 */
export function kgFromTable(key, { kv, hvl }, fClin, fLab) {
  const t = KG_TABLES[key];
  if (!t) return null;
  const c = tableValue(t.rows, { kv, hvl }, fClin);
  const l = tableValue(t.rows, { kv, hvl }, fLab);
  const value = c.byHvl / l.byHvl;
  const byKv = c.byKv / l.byKv;
  const inF = (f) => f >= KG_TABLE_F[0] - 1e-9 && f <= KG_TABLE_F[KG_TABLE_F.length - 1] + 1e-9;
  return {
    value,
    byKv,
    spreadPct: Number.isFinite(value) && Number.isFinite(byKv) ? Math.abs(byKv / value - 1) * 100 : NaN,
    table: t.table,
    inRange: {
      hvl: hvl >= TW_COLUMNS[0].hvl - 1e-12 && hvl <= TW_COLUMNS[TW_COLUMNS.length - 1].hvl + 1e-12,
      kv: kv >= TW_COLUMNS[0].kv - 1e-9 && kv <= TW_COLUMNS[TW_COLUMNS.length - 1].kv + 1e-9,
      f: inF(fClin) && inF(fLab),
    },
  };
}

/**
 * p_ch по табл. 32 для камеры (ключ столбца) и СПО, мм Cu: линейно по ln(СПО); за пределами таблицы — крайнее
 * значение (extrapolated: 'below' | 'above').
 */
export function pchFromTable32(key, hvl) {
  const ys = TRS_TABLE32.pch[key];
  if (!ys || !(hvl > 0)) return null;
  const hs = TRS_TABLE32.hvl;
  if (hvl < hs[0]) return { value: ys[0], extrapolated: 'below' };
  if (hvl > hs[hs.length - 1]) return { value: ys[ys.length - 1], extrapolated: 'above' };
  return { value: interpLog(hs, ys, hvl).value, extrapolated: null };
}

// ------------------------------------------------------------------------------------------ материалы фантома
// TRS-398 Rev.1: разд. 4.2.3 — вода стандартная среда для средних энергий; твердые фантомы (полистирол, ПММА, «твердая»,
// «пластиковая», «виртуальная» вода) для референсной дозиметрии не допускаются, кроме ПММА для низких энергий;
// разд. 8.2.2, табл. 27 — низкие энергии: водоэквивалентный пластик или ПММА, камера калибруется вместе с фантомом;
// табл. 31 — средние энергии: вода. TG-61, разд. IV.A — средние энергии, метод в фантоме: вода, пластик — только для
// рутинного контроля. SSRMP No 9: разд. 2.3 — низкие энергии: водоэквивалентные пластики и даже ПММА допустимы (камера
// и фантом калибруются как одно целое); разд. 5.7.1.2 — относительная дозиметрия в kV: рекомендованы A-150,
// Plastic Water DT, Solid Water RMI 457, Virtual Water; не рекомендованы Plastic Water, RW3, ПММА и полистирол.

/**
 * Материалы фантома. kind: 'water' — вода; 'pmma' — ПММА; 'wep' — водоэквивалентный пластик; 'ps' — полистирол.
 * pdd — оценка SSRMP No 9 (разд. 5.7.1.2) для относительной дозиметрии в kV: 'rec' — рекомендован, 'notrec' — нет.
 */
export const KV_PHANTOMS = [
  { id: 'water', kind: 'water', name: () => L('вода', 'water') },
  { id: 'pmma', kind: 'pmma', pdd: 'notrec', name: () => L('ПММА (оргстекло)', 'PMMA (acrylic)') },
  { id: 'pwdt', kind: 'wep', pdd: 'rec', name: () => 'Plastic Water DT (CIRS)' },
  { id: 'sw457', kind: 'wep', pdd: 'rec', name: () => 'Solid Water RMI 457 (Gammex)' },
  { id: 'vw', kind: 'wep', pdd: 'rec', name: () => 'Virtual Water (Med-Cal)' },
  { id: 'a150', kind: 'wep', pdd: 'rec', name: () => L('A-150 (тканеэквивалентный пластик)', 'A-150 (tissue-equivalent plastic)') },
  { id: 'rw3', kind: 'wep', pdd: 'notrec', name: () => 'RW3 (PTW)' },
  { id: 'pw', kind: 'wep', pdd: 'notrec', name: () => 'Plastic Water (CIRS)' },
  { id: 'ps', kind: 'ps', pdd: 'notrec', name: () => L('полистирол', 'polystyrene') },
];

/** Материал фантома по id: 'custom' — свой (название из формы); пусто или неизвестный id — null. */
export function resolveKvPhantom(id, customName = '') {
  if (id === 'custom') {
    const n = String(customName ?? '').trim();
    return { id, kind: 'custom', name: n ? L(`свой материал «${n}»`, `custom material "${n}"`) : L('свой материал', 'custom material') };
  }
  const p = KV_PHANTOMS.find((x) => x.id === id);
  return p ? { id: p.id, kind: p.kind, pdd: p.pdd, name: p.name() } : null;
}

/**
 * Годится ли материал и откуда это известно. use: 'low' — референсная доза на поверхности (низкие энергии, N_D,w);
 * 'medium' — референсная доза на 2 см (средние энергии); 'pdd' — PDD(2 см) для пересчёта на поверхность.
 * state: 'ok' | 'warn' | 'no' | 'unknown'.
 */
export function kvPhantomStatus(p, use) {
  if (!p) return null;
  if (use === 'medium') {
    return p.kind === 'water'
      ? { state: 'ok', text: L('вода — стандартная среда (TRS-398 Rev.1, разд. 4.2.3, табл. 31; TG-61, разд. IV.A)', 'water is the reference medium (TRS-398 Rev.1, Sec. 4.2.3, Table 31; TG-61, Sec. IV.A)') }
      : {
          state: 'no',
          text: L(
            'для средних энергий референсная доза определяется только в воде: твердые фантомы, в том числе водоэквивалентные пластики, не допускаются (TRS-398 Rev.1, разд. 4.2.3, табл. 31; TG-61, разд. IV.A); пластик — только для рутинного контроля после сравнения с водой',
            'for medium energies the reference dose is determined in water only: solid phantoms, including water-equivalent plastics, are not allowed (TRS-398 Rev.1, Sec. 4.2.3, Table 31; TG-61, Sec. IV.A); plastic is for routine checks only, after a comparison with water',
          ),
        };
  }
  if (use === 'pdd') {
    if (p.kind === 'water') return { state: 'ok', text: L('вода — опорная среда', 'water is the reference medium') };
    if (p.pdd === 'rec') return { state: 'ok', text: L('SSRMP No 9 рекомендует его для относительной дозиметрии в kV (разд. 5.7.1.2)', 'SSRMP No 9 recommends it for relative dosimetry in kV beams (Sec. 5.7.1.2)') };
    if (p.pdd === 'notrec') return { state: 'warn', text: L('SSRMP No 9 не рекомендует его для относительной дозиметрии в kV (разд. 5.7.1.2): сравните PDD(2 см) с измерением в воде', 'SSRMP No 9 does not recommend it for relative dosimetry in kV beams (Sec. 5.7.1.2): compare PDD(2 cm) with a measurement in water') };
    return {
      state: 'unknown',
      text: L(
        'для относительной дозиметрии в kV SSRMP No 9 рекомендует A-150, Plastic Water DT, Solid Water RMI 457 и Virtual Water (разд. 5.7.1.2); для другого материала сравните PDD(2 см) с измерением в воде',
        'for relative dosimetry in kV beams SSRMP No 9 recommends A-150, Plastic Water DT, Solid Water RMI 457 and Virtual Water (Sec. 5.7.1.2); for another material, compare PDD(2 cm) with a measurement in water',
      ),
    };
  }
  // низкие энергии: доза на поверхности фантома
  switch (p.kind) {
    case 'water':
      return { state: 'ok', text: L('вода: окно камеры обычно нельзя поставить вровень с поверхностью воды, поэтому применяют пластик (TRS-398 Rev.1, разд. 8.2.2)', 'water: the chamber window usually cannot be set flush with the water surface, so plastic is used instead (TRS-398 Rev.1, Sec. 8.2.2)') };
    case 'pmma':
      return { state: 'ok', text: L('допускается: камеры табл. 7 рассчитаны на фантом из ПММА, поставляемый вместе с камерой (TRS-398 Rev.1, табл. 27, разд. 8.2.2; SSRMP No 9, разд. 2.3)', 'allowed: the chambers of Table 7 are designed for a PMMA phantom supplied with the chamber (TRS-398 Rev.1, Table 27, Sec. 8.2.2; SSRMP No 9, Sec. 2.3)') };
    case 'wep':
      return { state: 'ok', text: L('водоэквивалентный пластик допускается (TRS-398 Rev.1, табл. 27; SSRMP No 9, разд. 2.3); лучше всего — материал, предназначенный для kV-рентгена (TRS-398 Rev.1, разд. 8.2.2)', 'a water-equivalent plastic is allowed (TRS-398 Rev.1, Table 27; SSRMP No 9, Sec. 2.3); a material designed for kV x-rays is best (TRS-398 Rev.1, Sec. 8.2.2)') };
    case 'ps':
      return { state: 'no', text: L('полистирол — не ПММА и не водоэквивалентный пластик, в стандартных условиях его нет (TRS-398 Rev.1, табл. 27, разд. 4.2.3)', 'polystyrene is neither PMMA nor a water-equivalent plastic and is not among the reference conditions (TRS-398 Rev.1, Table 27, Sec. 4.2.3)') };
    default:
      return { state: 'unknown', text: L('свой материал: допускается водоэквивалентный пластик или ПММА (TRS-398 Rev.1, табл. 27) — проверьте по данным производителя', 'custom material: a water-equivalent plastic or PMMA is allowed (TRS-398 Rev.1, Table 27); check against the manufacturer data') };
  }
}
