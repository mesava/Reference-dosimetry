// Референсная дозиметрия киловольтного рентгеновского излучения по TRS-398 Rev.1, разделы 8 и 9.
// Четыре ветки: два диапазона энергии × два вида калибровки камеры.
//   Низкие энергии (10–100 кВ, СПО в мм Al), доза на поверхности:
//     N_K, камера в свободном воздухе — ур. (50)–(51): D = M · N_K,Q · [μen/ρ]FIA · B_w(f, РИП);
//     N_D,w, камера на поверхности фантома из ПММА — ур. (52): D = M · N_D,w,Q · k_g.
//   Средние энергии (80–300 кВ, СПО в мм Cu), доза на глубине 2 г/см² в воде:
//     N_K — ур. (57): D = M · N_K,Q · [μen/ρ]z=2(f, РИП) · p_ch;
//     N_D,w — ур. (58): D = M · N_D,w,Q · k_g.
// Калибровочный коэффициент при качестве пучка N_Q берётся из таблицы сертификата и интерполируется линейно по ln(СПО)
// (рабочие записи 8.7 и 9.7); общий k_Q по типу камеры для kV не допускается (разд. 8.2.1, 9.2.1). Сертификат —
// в одной из трёх форм: N_Qo и k_Q по качествам; N по качествам; N_Д и поправочный множитель K по качествам
// (российская поверка: N_Q = N_Д · K(Q), K заменяет k_Q из заводского сертификата).
// k_g: низкие энергии — значение лаборатории, табл. 28–29 или ур. (85); средние — ур. (90) по данным Andreo или
// значение лаборатории. B_w и [μen/ρ] — данные Andreo (2019) через kv-data.js.
// Вариант DIN 6809-4 для средних энергий: Qo = ⁶⁰Co (N_D,w на 5 см) с k_Q,M рентгеновских качеств из калибровки той же
// камеры, k_z = 1 — с пометкой «нестандартные условия».
// Ошибка таймера (концевой эффект) не мультипликативна (разд. 9.4.2): доза относится к X + τ, где X — заданная
// величина (Гр, время или МЕ).
// Справочное сравнение с TG-61 (ветки N_K) и DIN 6809-4 / SSRMP No 9 (ветки N_D,w) — kv-compare.js, на итог не влияет.
// Квадратный и прямоугольный тубус заменяются кругом той же площади (данные Andreo и табл. 28–29 — для круглых полей).
// Материал фантома (KV_PHANTOMS в kv-tables.js) в расчёт не входит, но проверяется по условиям: низкие энергии — ПММА
// или водоэквивалентный пластик, тот же, что при калибровке (табл. 27, разд. 8.2.2); средние — только вода (табл. 31).

import { parseNumber, parseCells, isBlank, unitConverters, ru, dec } from './units.js';
import { L } from './i18n.js';
import { temperaturePressure, polarity, environmentChecks, readTolerance } from './common.js';
import { timerError, timerErrorMultiple } from './cobalt.js';
import { KV_CONDITIONS, evaluateConditions, complianceFromConditions } from './conditions.js';
import { resolveKvChamber, interpLog, kgFromTable, pchFromTable32, resolveKvPhantom, kvPhantomStatus, KV_PHANTOMS } from './kv-tables.js';
import { kvCalculator, ANDREO_CITATION } from './kv-data.js';
import { compareKv } from './kv-compare.js';
import * as TRS from './trs398.js';

const REF = {
  trs: 'TRS-398 Rev.1',
  din: 'DIN 6809-4:2020',
  r374: 'WGTG51 Report 374',
  ssrmp: 'SSRMP No 9',
  tg61: 'TG-61',
};

/** Диапазоны энергии: материал СПО и границы из разд. 8.1 и 9.1. */
export const KV_RANGES = {
  low: { material: 'Al', kvMin: 10, kvMax: 100, hvlMin: 0.03, hvlMax: 5 },
  medium: { material: 'Cu', kvMin: 80, kvMax: 300 },
};

/** Единицы задания облучения и итога на единицу задания. */
export const KV_SET_UNITS = {
  Gy: { label: 'Гр', labelEn: 'Gy', rateLabel: 'Гр/Гр', rateLabelEn: 'Gy/Gy', toRate: 1, time: false },
  min: { label: 'мин', labelEn: 'min', rateLabel: 'Гр/мин', rateLabelEn: 'Gy/min', toRate: 1, time: true },
  s: { label: 'с', labelEn: 's', rateLabel: 'Гр/мин', rateLabelEn: 'Gy/min', toRate: 60, time: true },
  MU: { label: 'МЕ', labelEn: 'MU', rateLabel: 'сГр/МЕ', rateLabelEn: 'cGy/MU', toRate: 100, time: false },
};

export const KV_DEFAULTS = {
  protocol: 'trs',

  kv_institution: '',
  kv_machine: '',
  // связь с «Оборудованием» (с 0.42.0): id рентгенотерапевтического аппарата журнала и, у режима, id его режима; пусто — ручной ввод
  kv_jmachine: '',
  kv_jmode: '',
  kv_date: '',
  kv_staff: [''],
  kv_notes: '',

  // пучок
  kv_range: 'low', // 'low' — 10–100 кВ, СПО в мм Al; 'medium' — 80–300 кВ, СПО в мм Cu
  kv_kv: '',
  kv_ma: '', // ток трубки, мА: для обозначения режима и протокола, в расчёт не входит
  kv_filter: '',
  kv_hvl: '',
  kv_cone_shape: 'circle', // 'circle' | 'square' | 'rect'
  kv_cone: '', // диаметр или сторона, см (у прямоугольного — сторона a)
  kv_cone_b: '', // прямоугольный тубус: сторона b, см
  kv_cone_largest: false, // средние энергии: самый большой тубус аппарата (табл. 31, сноска c)
  kv_ssd: '', // РИП на конце тубуса, см
  // фантом (низкие энергии, N_K — камера в свободном воздухе, без фантома): id из KV_PHANTOMS, 'custom' — свой, '' — не указан
  kv_phantom: '',
  kv_ph_name: '', // свой материал: название и производитель
  kv_ph_rho: '', // свой материал: плотность, г/см³ (для протокола)
  kv_ph_note: '', // свой материал: состав, данные о водоэквивалентности и их источник

  // камера и сертификат
  kv_ch_model: '', // id камеры (kv-tables.js), 'MY:…' или 'CUSTOM'
  kv_cc_maker: '',
  kv_cc_model: '',
  kv_cc_type: 'pp', // своя камера: 'pp' | 'cyl'
  kv_ch_serial: '',
  kv_foil: false, // плоскопараллельная камера выше 40 кВ: фольга 0,2 мм, откалиброванная вместе с камерой
  kv_cal: 'ndw', // 'ndw' — N_D,w; 'nk' — N_K (воздушная керма в свободном воздухе)
  kv_qo: 'kv', // средние энергии, N_D,w: 'kv' — kV-качество на 2 см; 'co60' — ⁶⁰Co на 5 см (DIN 6809-4)
  kv_cert_form: 'kq', // 'kq' — N_Qo и k_Q по качествам; 'n' — N по качествам; 'k' — N_Д и множитель K по качествам;
  // 'co' — только N_D,w в ⁶⁰Co, калибровки в рентгене нет: k_Q = 1 (не по Rev.1 и не по DIN 6809-4; только при Qo = ⁶⁰Co)
  kv_n: '', // N_Qo (или N_Д) из сертификата
  kv_n_unit: 'Gy/nC',
  kv_cq_kv: ['', '', '', ''], // таблица качеств сертификата: кВ (для записи),
  kv_cq_hvl: ['', '', '', ''], // СПО (мм Al или мм Cu, как у пучка),
  kv_cq_val: ['', '', '', ''], // k_Q, N или K
  kv_lab_shape: 'circle',
  kv_lab_f: '', // поле лаборатории, см (диаметр или сторона)
  kv_lab_ssd: '', // РИП лаборатории, см
  kv_lab_phantom: '', // низкие энергии, N_D,w: фантом при калибровке (камера калибруется вместе с фантомом, разд. 8.2.2)
  kv_nk_fs: '', // низкие энергии, N_K: поправка N_K на размер поля (рис. 11 или лаборатория); пусто — 1
  kv_T0: '20',
  kv_P0: '101,325',
  kv_el_model: '',
  kv_el_serial: '',
  kv_kelec: '1,000',
  kv_lab_pol_applied: true,
  kv_lab_kpol: '',
  kv_lab_ks_applied: true,
  kv_lab_ks: '',

  // k_g и p_ch
  kv_kg_src: 'auto', // 'auto' | 'lab' | 'table' (табл. 28–29) | 'eq85' | 'one' (k_g = 1, как DIN/SSRMP — не по Rev.1)
  kv_kg_lab: '',
  kv_kg_nk: '', // ур. (85): отношение N_K^PMMA(клин.)/N_K^PMMA(лаб.) из лаборатории
  kv_pch: '', // средние энергии, N_K: p_ch для камеры не из табл. 32

  // справочное сравнение с TG-61 (средние энергии, N_K): чехол (табл. IX) и P_Q,cham для камеры не из табл. VIII
  kv_tg61_sleeve: 'none', // 'none' | 'pmma' | 'polystyrene' | 'nylon'
  kv_tg61_sleeve_t: '1', // толщина чехла, мм
  kv_tg61_pq: '',

  // окружающая среда
  kv_env_T: '',
  kv_env_H: '',
  kv_env_P: '',
  kv_env_P_unit: 'kPa',

  // измерение СПО (лист «СПО и k_Q», kv-hvl.js): расстояние источник — камера и поле у фильтров — для протокола;
  // показания без фильтров, с x₁, с x₂ и контрольное без фильтров в конце; толщины — число в мм или пластины набора через
  // «+» (u(x) и cov — вручную только для чисел)
  kv_hl_dist: '',
  kv_hl_app: '',
  kv_hl_D0: ['', '', ''],
  kv_hl_D1: ['', '', ''],
  kv_hl_D2: ['', '', ''],
  kv_hl_Dc: ['', '', ''],
  kv_hl_x1: '',
  kv_hl_x2: '',
  kv_hl_ux1: '',
  kv_hl_ux2: '',
  kv_hl_cov: '',
  kv_hl_apply: true, // измеренный СПО — в расчёт режима вместо СПО из таблицы режимов
  // допуски измерения СПО по методике учреждения (в Rev.1 чисел нет; общие для режимов; пусто — без проверки):
  // u_A среднего, %; D̄₁ и D̄₂ от D̄₀/2, %; контрольный D₀ от начального, %
  kv_hl_ua_tol: '',
  kv_hl_band_tol: '',
  kv_hl_ctrl_tol: '',
  // набор пластин (общий для режимов): обозначение, материал 'Al' | 'Cu', номинальная и измеренная толщина, u(t), мм
  kv_pl_name: [],
  kv_pl_mat: [],
  kv_pl_nom: [],
  kv_pl_t: [],
  kv_pl_u: [],

  // линейность и воспроизводимость выхода (листы «Линейность» и «Воспроизводимость», с 0.44.0; не TRS-398 Rev.1 —
  // по методике учреждения): аппликатор (для протокола), задания Qᵢ в единице задания режима и серии показаний;
  // серия воспроизводимости, аппликатор и расстояние; допуски (общие) — пусто, без проверки
  kv_ln_app: '',
  kv_ln_q1: '',
  kv_ln_q2: '',
  kv_ln_q3: '',
  kv_ln_q4: '',
  kv_ln_q5: '',
  kv_ln_M1: ['', '', ''],
  kv_ln_M2: ['', '', ''],
  kv_ln_M3: ['', '', ''],
  kv_ln_M4: ['', '', ''],
  kv_ln_M5: ['', '', ''],
  kv_rp_app: '',
  kv_rp_dist: '',
  kv_rp_M: ['', '', '', '', ''],
  kv_ln_tol: '',
  kv_ln_cl_tol: '',
  kv_rp_tol: '',

  // задание облучения и ошибка таймера
  kv_set_unit: 'min', // 'Gy' | 'min' | 's' | 'MU'
  kv_set: '',
  // 'twopoint' — облучения с двумя заданиями T₁ и T₂, по нескольку показаний при каждом; 'measured' — серия облучений
  // с разным заданием; 'nexp' — одно облучение X против n облучений по X/n; 'manual' — известное τ; 'window' — заряд
  // накоплен на интервале при включённой трубке (только для времени); 'none'
  kv_timer_mode: 'twopoint',
  kv_tau: '',
  // две точки: T₁ и T₂ — в секундах при задании по времени (обычно 6 и 60 с), в единицах задания при Гр и МЕ
  kv_tp_t1: '',
  kv_tp_t2: '',
  kv_tp_R1: ['', '', ''],
  kv_tp_R2: ['', '', ''],
  // допуск на |τ|, с — по методике учреждения (в TRS-398 Rev.1 его нет); пусто — без проверки
  kv_tau_tol: '',
  kv_tt: ['', ''],
  kv_tm: ['', ''],
  kv_nx_t: '',
  kv_nx_n: '5',
  kv_nx_M1: ['', '', ''],
  kv_nx_Mn: ['', '', ''],

  // показания
  kv_V1: '300',
  kv_V2: '100',
  kv_polarity: '+',
  kv_M1: ['', '', ''],
  kv_Mopp: ['', '', ''],
  kv_ks_on: false, // метод двух напряжений; без него k_s = 1 (разд. 9.4.2)
  kv_M2: ['', '', ''],
  kv_rec_trs: 'eq13', // 'eq13' | 'eq16'
  kv_kleak: '1,000',

  // контрольные измерения
  kv_Mc: ['', '', ''],
  kv_ctrl_set: '', // пусто — то же задание, что в основных сериях

  // глубина (средние энергии) и сравнение
  kv_pdd2: '', // PDD(2 см), % от дозы на поверхности; пусто — без пересчёта
  kv_pdd_phantom: '', // в каком фантоме снята PDD (SSRMP No 9, разд. 5.7.1.2)
  kv_ref: '', // значение для сравнения в единицах итога
  kv_ref_at: 'zref', // 'zref' | 'surface'
  kv_tol: '2',
};

const CELL_KEYS = ['kv_M1', 'kv_Mopp', 'kv_M2', 'kv_nx_M1', 'kv_nx_Mn', 'kv_tp_R1', 'kv_tp_R2', 'kv_Mc', 'kv_hl_D0', 'kv_hl_D1', 'kv_hl_D2', 'kv_hl_Dc', 'kv_ln_M1', 'kv_ln_M2', 'kv_ln_M3', 'kv_ln_M4', 'kv_ln_M5', 'kv_rp_M'];
const BOOL_KEYS = ['kv_cone_largest', 'kv_foil', 'kv_lab_pol_applied', 'kv_lab_ks_applied', 'kv_ks_on', 'kv_hl_apply'];
const PLATE_KEYS = ['kv_pl_name', 'kv_pl_mat', 'kv_pl_nom', 'kv_pl_t', 'kv_pl_u'];

export function normalizeKv(input) {
  const f = { ...KV_DEFAULTS, ...input, protocol: 'trs' };
  // форма без способа ошибки таймера, но с точками серии (до 0.38.0 серия была способом по умолчанию)
  const legacySeries = (k) => Array.isArray(input?.[k]) && input[k].some((v) => !isBlank(v));
  if (!input?.kv_timer_mode && (legacySeries('kv_tt') || legacySeries('kv_tm'))) f.kv_timer_mode = 'measured';
  for (const k of CELL_KEYS) if (!Array.isArray(f[k])) f[k] = isBlank(f[k]) ? ['', '', ''] : String(f[k]).trim().split(/[\s;]+/);
  for (const k of ['kv_tt', 'kv_tm']) if (!Array.isArray(f[k])) f[k] = ['', ''];
  const n = Math.max(1, ...['kv_cq_kv', 'kv_cq_hvl', 'kv_cq_val'].map((k) => (Array.isArray(f[k]) ? f[k].length : 0)));
  for (const k of ['kv_cq_kv', 'kv_cq_hvl', 'kv_cq_val']) {
    const a = Array.isArray(f[k]) ? [...f[k]] : [];
    while (a.length < n) a.push('');
    f[k] = a;
  }
  for (const k of BOOL_KEYS) f[k] = f[k] === true || f[k] === 'true';
  // набор пластин: столбцы одной длины, строки — текст
  const np = Math.max(0, ...PLATE_KEYS.map((k) => (Array.isArray(f[k]) ? f[k].length : 0)));
  for (const k of PLATE_KEYS) f[k] = Array.from({ length: np }, (_, i) => (Array.isArray(f[k]) && f[k][i] !== undefined && f[k][i] !== null ? String(f[k][i]) : ''));
  f.kv_pl_mat = f.kv_pl_mat.map((m) => (m === 'Cu' ? 'Cu' : 'Al'));
  if (!Array.isArray(f.kv_staff) || f.kv_staff.length === 0) f.kv_staff = [''];
  if (f.kv_range !== 'medium') f.kv_range = 'low';
  if (f.kv_cal !== 'nk') f.kv_cal = 'ndw';
  if (!['kq', 'n', 'k', 'co'].includes(f.kv_cert_form)) f.kv_cert_form = 'kq';
  if (!KV_SET_UNITS[f.kv_set_unit]) f.kv_set_unit = 'min';
  if (!['twopoint', 'measured', 'nexp', 'window', 'manual', 'none'].includes(f.kv_timer_mode)) f.kv_timer_mode = KV_DEFAULTS.kv_timer_mode;
  if (!['circle', 'square', 'rect'].includes(f.kv_cone_shape)) f.kv_cone_shape = 'circle';
  if (f.kv_lab_shape !== 'square') f.kv_lab_shape = 'circle';
  const phantomIds = ['custom', ...KV_PHANTOMS.map((p) => p.id)];
  for (const k of ['kv_phantom', 'kv_lab_phantom', 'kv_pdd_phantom']) if (!phantomIds.includes(f[k])) f[k] = '';
  return f;
}

/** Диаметр круглого поля той же площади: квадрат со стороной a — d = 2a/√π, прямоугольник a × b — d = 2√(ab/π). */
export function equivalentDiameter(shape, size, b) {
  if (shape === 'square') return (2 * size) / Math.sqrt(Math.PI);
  if (shape === 'rect') return 2 * Math.sqrt((size * b) / Math.PI);
  return size;
}

/**
 * Таблица качеств сертификата: строки { kv, hvl, val } с заполненными СПО и значением, упорядоченные по СПО.
 * Ошибки ввода — в errors (номер строки с 1), повторяющиеся СПО — в duplicates.
 */
export function certRows(f) {
  const rows = [];
  const errors = [];
  for (let i = 0; i < f.kv_cq_hvl.length; i++) {
    const cells = [f.kv_cq_kv[i], f.kv_cq_hvl[i], f.kv_cq_val[i]];
    if (cells.every(isBlank)) continue;
    const hvl = parseNumber(f.kv_cq_hvl[i]);
    const val = parseNumber(f.kv_cq_val[i]);
    const kv = parseNumber(f.kv_cq_kv[i]);
    if (!(hvl > 0) || !(val > 0)) errors.push(i + 1);
    else rows.push({ kv, hvl, val, row: i + 1 });
  }
  rows.sort((a, b) => a.hvl - b.hvl);
  const duplicates = rows.filter((r, i) => i > 0 && Math.abs(r.hvl - rows[i - 1].hvl) < 1e-9).map((r) => r.row);
  return { rows, errors, duplicates };
}

/** Значение таблицы сертификата для СПО пучка: линейно по ln(СПО) (рабочие записи 8.7, 9.7). */
export function certValue(rows, hvl) {
  return interpLog(
    rows.map((r) => r.hvl),
    rows.map((r) => r.val),
    hvl,
  );
}

/**
 * Ошибка таймера по двум заданиям: облучения с заданием T₁ и T₂, средние показания R̄₁ и R̄₂. Показание пропорционально
 * фактическому заданию, R = Ṁ·(T + τ), откуда τ = (T₂·R̄₁ − T₁·R̄₂)/(R̄₂ − R̄₁) — та же прямая, что у серии облучений, через
 * две точки. τ — в единицах T.
 */
/** Знаков после запятой у допуска: как введено, до двух (3 → «3», 0,5 → «0,5», 0,25 → «0,25»). */
const tolDigits = (x) => (Number.isInteger(x) ? 0 : Number.isInteger(Math.round(x * 1e6) / 1e5) ? 1 : 2);

export function timerErrorTwoPoint(t1, t2, r1, r2) {
  if (!(t1 > 0) || !(t2 > 0)) return { error: L('задания T₁ и T₂ должны быть больше нуля', 'settings T₁ and T₂ must be greater than zero') };
  if (t1 === t2) return { error: L('задания T₁ и T₂ должны различаться', 'settings T₁ and T₂ must differ') };
  const a = Math.abs(r1);
  const b = Math.abs(r2);
  if (!(a > 0) || !(b > 0)) return { error: L('нужны показания при обоих заданиях', 'readings at both settings are required') };
  const rate = (b - a) / (t2 - t1);
  if (!(rate > 0)) return { error: L('показание должно расти с заданием: при большем задании оно больше', 'the reading must increase with the setting: it is larger at the larger setting') };
  // при растущем показании T + τ > 0 при обоих заданиях: T₁ + τ = R̄₁·(T₂ − T₁)/(R̄₂ − R̄₁)
  return { tau: (t2 * a - t1 * b) / (b - a), rate };
}

export function computeKv(form) {
  const f = normalizeKv(form);
  const kvx = kvCalculator();
  const messages = [];
  const flags = {};
  const rank = { info: 0, warn: 1, error: 2 };
  const flag = (key, level) => {
    if (!flags[key] || rank[level] > rank[flags[key]]) flags[key] = level;
  };
  const add = (level, scope, text, ref = null, field = null) => {
    messages.push({ level, scope, text, ref });
    if (field) [].concat(field).forEach((k) => flag(k, level));
  };
  const conv = unitConverters(add);
  const read = (key, label, scope = 'common') => {
    const v = parseNumber(f[key]);
    if (!Number.isFinite(v)) add('error', scope, isBlank(f[key]) ? L(`Не заполнено поле «${label}».`, `Field "${label}" is empty.`) : L(`Не удалось прочитать число в поле «${label}».`, `Could not read the number in field "${label}".`), null, key);
    return v;
  };
  const readCells = (key, label, scope = 'common') => {
    const s = parseCells(f[key]);
    if (s.error) add('error', scope, L(`«${label}»: ${s.error}.`, `"${label}": ${s.error}.`), null, key);
    else if (s.n === 0) add('error', scope, L(`Не заполнено поле «${label}».`, `Field "${label}" is empty.`), null, key);
    else if (s.mean === 0) add('error', scope, L(`«${label}»: среднее показание равно нулю.`, `"${label}": the mean reading is zero.`), null, key);
    return s;
  };
  const spread = (s, label, key, scope = 'common') => {
    if (!s || s.n < 2 || !s.mean) return;
    const d = Math.max(...s.values.map((v) => Math.abs(v - s.mean) / Math.abs(s.mean)));
    const pct = ru(d * 100, 2);
    if (d > 0.05) add('error', scope, L(`Показания ${label} расходятся на ${pct} % от среднего: вероятно, ошибка ввода.`, `Readings ${label} differ from the mean by up to ${pct} %: probably a data-entry error.`), null, key);
    else if (d > 0.005) add('warn', scope, L(`Разброс показаний ${label} до ${pct} % от среднего: повторите облучения.`, `Spread of readings ${label} up to ${pct} % of the mean: repeat the exposures.`), `${REF.r374}, разд. 4.4.2`, key);
    else if (d > 0.001) add('info', scope, L(`Разброс показаний ${label} до ${pct} % от среднего: Report 374 советует повторять облучения, пока отклонение не станет меньше ±0,1 % без тренда.`, `Spread of readings ${label} up to ${pct} % of the mean: Report 374 recommends repeating exposures until the deviation is below ±0.1 % with no trend.`), `${REF.r374}, разд. 4.4.2`, key);
  };
  const notRev1 = []; // множители и пути не по TRS-398 Rev.1 (для пометки итога)

  const range = f.kv_range;
  const R = KV_RANGES[range];
  const mat = R.material;
  const cal = f.kv_cal;
  const qo = range === 'medium' && cal === 'ndw' && f.kv_qo === 'co60' ? 'co60' : 'kv';
  // камера откалибрована только в ⁶⁰Co, k_Q,M рентгеновских качеств нет: k_Q = 1 (не по Rev.1 и не по DIN)
  const kq1 = qo === 'co60' && f.kv_cert_form === 'co';
  const secRef = range === 'low' ? `${REF.trs}, разд. 8.1` : `${REF.trs}, разд. 9.1`;
  const eqText = { low: { nk: L('ур. (50)–(51)', 'Eqs (50)–(51)'), ndw: L('ур. (52)', 'Eq. (52)') }, medium: { nk: L('ур. (57)', 'Eq. (57)'), ndw: L('ур. (58)', 'Eq. (58)') } }[range][cal];

  // ------------------------------------------------------------ качество пучка
  const kv = read('kv_kv', L('Напряжение на трубке', 'Tube voltage'));
  // СПО, измеренный на листе «СПО и k_Q» (kv_hvl_meas — от computeKvVisit, kv-hvl.js), заменяет СПО из таблицы режимов
  const hvlMeas = typeof f.kv_hvl_meas === 'number' && f.kv_hvl_meas > 0 ? f.kv_hvl_meas : NaN;
  const hvlNominal = parseNumber(f.kv_hvl);
  const hvl = Number.isFinite(hvlMeas) ? hvlMeas : read('kv_hvl', L(`СПО, мм ${mat}`, `HVL, mm ${mat}`));
  if (Number.isFinite(hvlMeas)) {
    const was = Number.isFinite(hvlNominal) ? L(` (в таблице режимов — ${ru(hvlNominal, 3)} мм ${mat})`, ` (${ru(hvlNominal, 3)} mm ${mat} in the modes table)`) : '';
    add('info', 'common', L(`СПО пучка — измеренный на листе «СПО и k_Q»: ${ru(hvl, 3)} мм ${mat}${was}. По нему — k_Q и все величины, зависящие от СПО.`, `The beam HVL is the one measured on the “HVL and k_Q” sheet: ${ru(hvl, 3)} mm ${mat}${was}. k_Q and all HVL-dependent quantities use it.`), `${REF.trs}, разд. ${range === 'low' ? '8.3.2' : '9.3.2'}`);
  }
  let qualityOk = Number.isFinite(kv) && Number.isFinite(hvl);
  if (Number.isFinite(kv) && (kv < 10 || kv > 300)) {
    add('error', 'common', L('Напряжение на трубке задаётся в киловольтах, от 10 до 300 кВ.', 'The tube voltage is entered in kilovolts, from 10 to 300 kV.'), secRef, 'kv_kv');
    qualityOk = false;
  }
  if (Number.isFinite(hvl) && hvl <= 0) {
    add('error', 'common', L('СПО должен быть больше нуля.', 'The HVL must be greater than zero.'), null, 'kv_hvl');
    qualityOk = false;
  }
  if (qualityOk) {
    if (range === 'low') {
      if (kv > R.kvMax) add('warn', 'common', L(`${ru(kv, 0)} кВ — выше диапазона низких энергий (10–100 кВ): для этого пучка подходит раздел 9 (средние энергии).`, `${ru(kv, 0)} kV is above the low-energy range (10–100 kV): Section 9 (medium energies) applies to this beam.`), secRef, ['kv_kv', 'kv_range']);
      if (hvl < R.hvlMin || hvl > R.hvlMax) add('warn', 'common', L(`СПО ${ru(hvl, 3)} мм Al — вне диапазона низких энергий (0,03–5 мм Al).`, `HVL ${ru(hvl, 3)} mm Al is outside the low-energy range (0.03–5 mm Al).`), secRef, 'kv_hvl');
    } else if (kv < R.kvMin) {
      add('warn', 'common', L(`${ru(kv, 0)} кВ — ниже диапазона средних энергий (80–300 кВ): для этого пучка подходит раздел 8 (низкие энергии).`, `${ru(kv, 0)} kV is below the medium-energy range (80–300 kV): Section 8 (low energies) applies to this beam.`), secRef, ['kv_kv', 'kv_range']);
    }
    const hc = kvx.hvlCheck(kv, hvl, mat);
    if (hc.length) {
      const lim = ru(hc[0].params.limit, 2);
      add('error', 'common', L(
        `СПО ${ru(hvl, 3)} мм ${mat} недостижим при ${ru(kv, 0)} кВ: даже у моноэнергетических фотонов ${ru(kv, 0)} кэВ СПО ${lim} мм ${mat}. Проверьте СПО, его единицы (мм Al или мм Cu) и напряжение.`,
        `HVL ${ru(hvl, 3)} mm ${mat} cannot be reached at ${ru(kv, 0)} kV: even monoenergetic ${ru(kv, 0)} keV photons have an HVL of ${lim} mm ${mat}. Check the HVL, its units (mm Al or mm Cu) and the voltage.`,
      ), null, ['kv_hvl', 'kv_kv']);
      qualityOk = false;
    }
  }
  // ток трубки — только для обозначения режима и протокола
  if (!isBlank(f.kv_ma) && !(parseNumber(f.kv_ma) > 0)) {
    add('warn', 'common', L('Ток трубки — число миллиампер больше нуля. В расчёт он не входит.', 'The tube current is a number of milliamperes greater than zero. It does not enter the calculation.'), null, 'kv_ma');
  }

  // ------------------------------------------------------------ геометрия
  const geomRead = (key, label, max) => {
    const v = read(key, label);
    if (Number.isFinite(v) && (v <= 0 || v > max)) add('error', 'common', L(`«${label}» задаётся в сантиметрах (больше 0 и не больше ${max} см).`, `"${label}" is entered in centimeters (above 0 and up to ${max} cm).`), null, key);
    return v > 0 && v <= max ? v : NaN;
  };
  const rect = f.kv_cone_shape === 'rect';
  const coneSize = geomRead('kv_cone', rect ? L('Сторона a тубуса', 'Applicator side a') : L('Размер тубуса', 'Applicator size'), 50);
  const coneB = rect ? geomRead('kv_cone_b', L('Сторона b тубуса', 'Applicator side b'), 50) : NaN;
  const ssd = geomRead('kv_ssd', L('РИП', 'SSD'), 150);
  const fClin = equivalentDiameter(f.kv_cone_shape, coneSize, coneB);
  const dataNote = L('данные B_w и [μen/ρ] и табл. 28–29 даны для круглых полей', 'the B_w and [μen/ρ] data and Tables 28–29 are given for circular fields');
  if (f.kv_cone_shape === 'square' && Number.isFinite(fClin)) {
    add('info', 'common', L(`Квадратное поле ${ru(coneSize, 1)} см заменено кругом равной площади диаметром ${ru(fClin, 2)} см: ${dataNote}.`, `The square field of ${ru(coneSize, 1)} cm is replaced by a circle of equal area, ${ru(fClin, 2)} cm in diameter: ${dataNote}.`), null, 'kv_cone');
  }
  if (rect && Number.isFinite(fClin)) {
    const side = (x) => ru(x, Number.isInteger(x) ? 0 : Number.isInteger(Math.round(x * 1e6) / 1e5) ? 1 : 2);
    const ab = `${side(coneSize)} × ${side(coneB)}`;
    add('info', 'common', L(`Прямоугольное поле ${ab} см заменено кругом равной площади диаметром ${ru(fClin, 2)} см: ${dataNote}.`, `The rectangular field of ${ab} cm is replaced by a circle of equal area, ${ru(fClin, 2)} cm in diameter: ${dataNote}.`), null, ['kv_cone', 'kv_cone_b']);
    if (Math.max(coneSize, coneB) / Math.min(coneSize, coneB) > 2) {
      add('warn', 'common', L(
        `Поле ${ab} см вытянуто больше чем вдвое: круг той же площади для него — грубое приближение. Сверьте эквивалентное поле с таблицами эквивалентных полей для kV-рентгена (например, BJR Suppl. 25) и укажите это в примечаниях.`,
        `The ${ab} cm field is elongated more than twofold: a circle of equal area is only a rough approximation for it. Check the equivalent field against equivalent-field tables for kV x-rays (for example, BJR Suppl. 25) and note this in the remarks.`,
      ), null, ['kv_cone', 'kv_cone_b']);
    }
  }
  // без калибровки в рентгене нет и геометрии, к которой относился бы k_g
  const needLab = cal === 'ndw' && f.kv_cert_form !== 'co';
  const labSize = needLab ? geomRead('kv_lab_f', L('Поле в лаборатории', 'Field at the laboratory'), 50) : NaN;
  const ssdLab = needLab ? geomRead('kv_lab_ssd', L('РИП в лаборатории', 'SSD at the laboratory'), 150) : NaN;
  const fLab = equivalentDiameter(f.kv_lab_shape, labSize);
  const sameGeometry = needLab && Math.abs(fClin - fLab) < 1e-6 && Math.abs(ssd - ssdLab) < 1e-6;

  // ---------------------------------------------------------------- камера
  const chamber = resolveKvChamber(f);
  if (!chamber) add('error', 'common', L('Выберите камеру.', 'Select a chamber.'), null, 'kv_ch_model');
  if (chamber) {
    if (range === 'low' && cal === 'ndw' && chamber.type !== 'pp') {
      add('warn', 'common', L('Для внутрифантомного метода нужна плоскопараллельная камера для низких энергий на поверхности фантома.', 'The in-phantom method requires a plane-parallel low-energy chamber at the phantom surface.'), `${REF.trs}, табл. 27`, 'kv_ch_model');
    }
    if (range === 'low' && cal === 'nk' && chamber.type === 'cyl' && Number.isFinite(kv) && kv < 70) {
      add('warn', 'common', L('Цилиндрическую камеру для воздушного метода допускается использовать только при 70 кВ и выше; ниже — плоскопараллельную.', 'A cylindrical chamber may be used for the in-air method only at 70 kV and above; below that, use a plane-parallel chamber.'), `${REF.trs}, разд. 8.2.1, табл. 26`, 'kv_ch_model');
    }
    if (range === 'medium' && chamber.type !== 'cyl') {
      add('warn', 'common', L('Для средних энергий рекомендуются только цилиндрические камеры объёмом 0,1–1,0 см³.', 'Only cylindrical chambers of 0.1–1.0 cm³ are recommended for medium energies.'), `${REF.trs}, разд. 9.2.1, табл. 31`, 'kv_ch_model');
    }
    if (chamber.type === 'pp' && !chamber.custom && chamber.table7 === false && range === 'low') {
      add('info', 'common', L(`${chamber.label} нет в табл. 7 TRS-398 Rev.1 (камеры для низких энергий): убедитесь, что камера предназначена для этого диапазона и откалибрована в нём.`, `${chamber.label} is not listed in Table 7 of TRS-398 Rev.1 (low-energy chambers): make sure the chamber is designed and calibrated for this range.`), `${REF.trs}, табл. 7`, 'kv_ch_model');
    }
    if (chamber.type === 'pp' && Number.isFinite(kv) && kv > 40 && !f.kv_foil) {
      add('info', 'common', L('Выше 40 кВ к окну плоскопараллельной камеры добавляют фольгу 0,2 мм (ПММА, полиэтилен или майлар) — ту же, с которой камера калибровалась в лаборатории.', 'Above 40 kV a 0.2 mm foil (PMMA, polyethylene or Mylar) is added to the window of a plane-parallel chamber, the same one with which the chamber was calibrated.'), `${REF.trs}, разд. 8.2.1`, 'kv_foil');
    }
  }

  // ---------------------------------------------------------------- фантом
  // низкие энергии, N_K: камера в свободном воздухе, фантома нет; фантом лаборатории — только для низких энергий, N_D,w
  const phantom = range === 'low' && cal === 'nk' ? null : resolveKvPhantom(f.kv_phantom, f.kv_ph_name);
  const labPhantom = range === 'low' && needLab ? resolveKvPhantom(f.kv_lab_phantom, f.kv_ph_name) : null;
  const phantomStatus = kvPhantomStatus(phantom, range);
  if (phantomStatus?.state === 'no') add('warn', 'common', L(`Фантом — ${phantom.name}: ${phantomStatus.text}.`, `Phantom: ${phantom.name}; ${phantomStatus.text}.`), null, 'kv_phantom');
  if (phantom && labPhantom && phantom.id !== labPhantom.id) {
    add('warn', 'common', L(
      `Фантом (${phantom.name}) не тот, на котором камера калибровалась (${labPhantom.name}): камера калибруется вместе с фантомом, и N_D,w относится к тому же материалу — обратное рассеяние у другого материала другое.`,
      `The phantom (${phantom.name}) is not the one on which the chamber was calibrated (${labPhantom.name}): the chamber is calibrated together with its phantom, and N_D,w applies to that material; another material gives different backscatter.`,
    ), `${REF.trs}, разд. 8.2.2; ${REF.ssrmp}, разд. 2.3`, ['kv_phantom', 'kv_lab_phantom']);
  }

  // ------------------------------------------------------------ сертификат
  const certForm = f.kv_cert_form;
  const nName = cal === 'nk' ? 'N_K' : 'N_D,w';
  const cert = { form: certForm, qo };
  const nUnitOk = (v) => v >= 1e-3 && v <= 20;
  if (certForm !== 'n') {
    const raw = read('kv_n', certForm === 'k' ? L('N_Д из сертификата', 'N_D from the certificate') : certForm === 'co' ? L('N_D,w в ⁶⁰Co из сертификата', 'N_D,w in ⁶⁰Co from the certificate') : L(`${nName} при Qo из сертификата`, `${nName} at Qo from the certificate`));
    cert.base = Number.isFinite(raw) ? conv.ndw(raw, f.kv_n_unit) : NaN;
    if (Number.isFinite(cert.base) && !nUnitOk(cert.base)) add('warn', 'common', L(`${nName} = ${dec(cert.base.toPrecision(4))} Гр/нКл выглядит неправдоподобно: проверьте единицы.`, `${nName} = ${dec(cert.base.toPrecision(4))} Gy/nC looks implausible: check the units.`), null, 'kv_n');
  }
  // форма 'co': таблицы качеств нет — k_Q = 1
  const table = certForm === 'co' ? { rows: [], errors: [], duplicates: [] } : certRows(f);
  cert.rows = table.rows;
  const valName = { kq: 'k_Q', n: nName, k: 'K', co: 'k_Q' }[certForm];
  if (certForm === 'co' && qo !== 'co60') {
    add('error', 'common', L(
      'Вариант «только N_D,w в ⁶⁰Co (k_Q = 1)» — для средних энергий с калибровкой N_D,w и Qo = ⁶⁰Co. Выберите такие условия или другую форму сертификата.',
      'The "N_D,w in ⁶⁰Co only (k_Q = 1)" option applies to medium energies with an N_D,w calibration and Qo = ⁶⁰Co. Choose these conditions or another certificate form.',
    ), `${REF.din}, разд. 6.4.2`, ['kv_cert_form', 'kv_qo']);
  }
  if (kq1) {
    cert.value = 1;
    cert.kQ = 1;
    cert.kq1 = true;
    cert.NQ = cert.base;
  }
  if (table.errors.length) add('error', 'common', L(`Таблица качеств сертификата, строки ${table.errors.join(', ')}: нужны СПО и ${valName} — положительные числа.`, `Certificate quality table, rows ${table.errors.join(', ')}: the HVL and ${valName} must be positive numbers.`), null, 'kv_cert');
  if (table.duplicates.length) add('error', 'common', L(`Таблица качеств сертификата: СПО повторяется (строки ${table.duplicates.join(', ')}).`, `Certificate quality table: the HVL is repeated (rows ${table.duplicates.join(', ')}).`), null, 'kv_cert');
  if (qo === 'co60' && certForm === 'n') {
    add('error', 'common', L('Для Qo = ⁶⁰Co нужны k_Q,M рентгеновских качеств относительно N_D,w в ⁶⁰Co: выберите форму «N и k_Q по качествам» или «N_Д и множитель K».', 'For Qo = ⁶⁰Co, the k_Q,M of the x-ray qualities relative to N_D,w in ⁶⁰Co are required: choose the form "N and k_Q per quality" or "N_D and multiplier K".'), `${REF.din}, разд. 6.4.2`, 'kv_cert_form');
  }
  if (certForm !== 'co' && table.rows.length === 0 && !table.errors.length) {
    if (qo === 'co60') {
      add('error', 'common', L('Сертификат только с ⁶⁰Co: для рентгена нужна калибровка этой камеры в рентгеновских качествах (k_Q,M). Типовые k_Q для kV-рентгена не применяются: чувствительность отдельных камер одного типа различается.', 'A ⁶⁰Co-only certificate: x-rays require a calibration of this chamber in x-ray qualities (k_Q,M). Generic k_Q are not used for kV x-rays: the response of individual chambers of the same type differs.'), `${REF.trs}, разд. 9.2.1; ${REF.din}, разд. 6.4.2`, 'kv_cert');
    } else {
      add('error', 'common', L(`Заполните таблицу качеств сертификата (СПО и ${valName}): общий k_Q по типу камеры для kV-рентгена не допускается.`, `Fill in the certificate quality table (HVL and ${valName}): a generic k_Q by chamber type is not allowed for kV x-rays.`), `${REF.trs}, разд. ${range === 'low' ? '8.2.1' : '9.2.1'}`, 'kv_cert');
    }
  }
  if (table.rows.length && !table.errors.length && !table.duplicates.length && qualityOk) {
    const r = certValue(table.rows, hvl);
    cert.interp = r;
    cert.value = r.value;
    const hv = table.rows.map((x) => x.hvl);
    if (table.rows.length === 1) {
      const d = Math.abs(Math.log(hvl / hv[0]));
      if (d > 0.05) {
        add('error', 'common', L(`В таблице сертификата одно качество (СПО ${ru(hv[0], 3)} мм ${mat}), а у пучка СПО ${ru(hvl, 3)} мм ${mat}: интерполировать не по чему. Нужны качества, охватывающие СПО пучка.`, `The certificate table has a single quality (HVL ${ru(hv[0], 3)} mm ${mat}) while the beam HVL is ${ru(hvl, 3)} mm ${mat}: there is nothing to interpolate. Qualities bracketing the beam HVL are required.`), `${REF.trs}, разд. 8.4.1, 9.4.4`, 'kv_cert');
        cert.value = NaN;
      } else add('info', 'common', L('В таблице сертификата одно качество, совпадающее с пучком по СПО: его значение взято без интерполяции.', 'The certificate table has a single quality matching the beam HVL: its value is used without interpolation.'), null, 'kv_cert');
    } else if (r.extrapolated) {
      add('warn', 'common', L(
        `СПО пучка ${ru(hvl, 3)} мм ${mat} вне диапазона таблицы сертификата (${ru(hv[0], 3)}–${ru(hv[hv.length - 1], 3)} мм ${mat}): ${valName} экстраполирован по ln(СПО). Сертификат должен охватывать СПО клинических пучков.`,
        `The beam HVL ${ru(hvl, 3)} mm ${mat} is outside the certificate table (${ru(hv[0], 3)}–${ru(hv[hv.length - 1], 3)} mm ${mat}): ${valName} is extrapolated in ln(HVL). The certificate must cover the HVLs of the clinical beams.`,
      ), `${REF.trs}, разд. 8.4.1, 9.4.4`, 'kv_cert');
    }
    if (certForm === 'n') {
      cert.NQ = conv.ndw(cert.value, f.kv_n_unit);
      table.rows.forEach((x) => {
        const v = conv.ndw(x.val, f.kv_n_unit);
        if (!nUnitOk(v)) add('warn', 'common', L(`${nName} в строке ${x.row} = ${dec(v.toPrecision(4))} Гр/нКл выглядит неправдоподобно: проверьте единицы.`, `${nName} in row ${x.row} = ${dec(v.toPrecision(4))} Gy/nC looks implausible: check the units.`), null, 'kv_cert');
      });
    } else {
      const bad = table.rows.filter((x) => x.val < 0.9 || x.val > 1.1).map((x) => x.row);
      if (bad.length) add('warn', 'common', L(`${valName} в строках ${bad.join(', ')} вне 0,9–1,1: проверьте сертификат и ввод.`, `${valName} in rows ${bad.join(', ')} is outside 0.9–1.1: check the certificate and the input.`), null, 'kv_cert');
      cert.NQ = cert.base * cert.value;
      if (certForm === 'kq') cert.kQ = cert.value;
      else cert.K = cert.value;
    }
  }
  if (kq1) {
    cert.kz = 1;
    notRev1.push(L('k_Q = 1: камера откалибрована только в ⁶⁰Co, калибровки в рентгене нет (не по Rev.1 и не по DIN 6809-4)', 'k_Q = 1: the chamber is calibrated in ⁶⁰Co only, with no x-ray calibration (neither Rev.1 nor DIN 6809-4)'));
    add('warn', 'common', L(
      'k_Q = 1: камера откалибрована только в ⁶⁰Co, k_Q,M рентгеновских качеств неизвестны и приняты равными 1. Так не допускают ни TRS-398 Rev.1 (разд. 9.2.1), ни DIN 6809-4 (разд. 6.4.2): оба требуют калибровки этой камеры в рентгеновских качествах. Насколько k_Q,M отличается от 1, без такой калибровки не узнать, поэтому результат — оценка, а не референсная дозиметрия. k_z = 1 (5 см → 2 см) и k_g = 1 взяты как в DIN 6809-4.',
      'k_Q = 1: the chamber is calibrated in ⁶⁰Co only; the k_Q,M of the x-ray qualities are unknown and taken as 1. Neither TRS-398 Rev.1 (Sec. 9.2.1) nor DIN 6809-4 (Sec. 6.4.2) allows this: both require a calibration of this chamber in x-ray qualities. How far k_Q,M is from 1 cannot be known without such a calibration, so the result is an estimate, not reference dosimetry. k_z = 1 (5 cm → 2 cm) and k_g = 1 are taken as in DIN 6809-4.',
    ), `${REF.trs}, разд. 9.2.1; ${REF.din}, разд. 6.4.2`, 'kv_cert_form');
  } else if (qo === 'co60') {
    cert.kz = 1;
    notRev1.push(L('Qo = ⁶⁰Co (DIN 6809-4)', 'Qo = ⁶⁰Co (DIN 6809-4)'));
    add('warn', 'common', L(
      'Qo = ⁶⁰Co: расчёт по DIN 6809-4 (N_D,w в ⁶⁰Co на 5 см, k_Q,M рентгеновских качеств из калибровки этой камеры), а не по TRS-398 Rev.1. Калибровка на 5 см, измерение на 2 см: k_z = 1 с неопределённостью 0,5 %. Для k_g берутся поле и РИП, при которых измерены k_Q,M рентгеновских качеств.',
      'Qo = ⁶⁰Co: calculation according to DIN 6809-4 (N_D,w in ⁶⁰Co at 5 cm, k_Q,M of the x-ray qualities from a calibration of this chamber), not TRS-398 Rev.1. Calibration at 5 cm, measurement at 2 cm: k_z = 1 with an uncertainty of 0.5 %. For k_g, the field and SSD at which the x-ray k_Q,M were measured are used.',
    ), `${REF.din}, разд. 6.4.2, 6.4.3`, 'kv_qo');
  }

  // ------------------------------------------------------------ окружающая среда, электрометр
  const T0 = read('kv_T0', L('T₀ из сертификата', 'T₀ from the certificate'));
  const P0 = read('kv_P0', L('P₀ из сертификата', 'P₀ from the certificate'));
  if (Number.isFinite(T0) && (T0 < 15 || T0 > 25)) add('error', 'common', L('T₀ задаётся в °C (обычно 20 или 22).', 'T₀ is entered in °C (usually 20 or 22).'), null, 'kv_T0');
  if (Number.isFinite(P0) && (P0 < 95 || P0 > 105)) add('warn', 'common', L('P₀ задаётся в кПа (обычно 101,325 или 101,33).', 'P₀ is entered in kPa (usually 101.325 or 101.33).'), null, 'kv_P0');
  const kelec = read('kv_kelec', 'k_elec');
  if (Number.isFinite(kelec) && Math.abs(kelec - 1) > 0.02) add('warn', 'common', L('k_elec отличается от 1 больше чем на 2 %: проверьте сертификат электрометра.', 'k_elec differs from 1 by more than 2 %: check the electrometer calibration certificate.'), null, 'kv_kelec');
  const T = read('kv_env_T', L('Температура у камеры', 'Temperature at the chamber'));
  const Pin = read('kv_env_P', L('Давление', 'Pressure'));
  const P = Number.isFinite(Pin) ? conv.pressure(Pin, f.kv_env_P_unit) : NaN;
  if (Number.isFinite(P) && (P < 50 || P > 110)) add('error', 'common', L(`Давление ${ru(P, 2)} кПа вне правдоподобного диапазона: проверьте единицы.`, `Pressure ${ru(P, 2)} kPa is outside the plausible range: check the units.`), null, 'kv_env_P');
  const env = environmentChecks({ T, Hraw: f.kv_env_H, keyT: 'kv_env_T', keyH: 'kv_env_H', parseNumber, isBlank, ru });
  env.items.forEach(([level, text, ref, key]) => add(level, 'common', text, ref, key));

  // ------------------------------------------------------------ задание облучения и ошибка таймера
  const U = KV_SET_UNITS[f.kv_set_unit];
  const uLabel = L(U.label, U.labelEn);
  const windowMode = f.kv_timer_mode === 'window';
  if (windowMode && !U.time) add('error', 'common', L('Накопление заряда на интервале при включённой трубке имеет смысл только при задании облучения по времени.', 'Collecting charge over an interval with the tube on makes sense only when the exposure is set by time.'), null, 'kv_timer_mode');
  const X = read('kv_set', L(`Задание облучения, ${U.label}`, `Exposure setting, ${U.labelEn}`));
  if (Number.isFinite(X) && X <= 0) add('error', 'common', L('Задание облучения должно быть больше нуля.', 'The exposure setting must be greater than zero.'), null, 'kv_set');
  let tau = 0;
  // τ вычислена по данным этого режима (не взята из другого и не «не учитывать»)
  let tauOwn = false;
  let timer = { mode: f.kv_timer_mode, unit: f.kv_set_unit };
  const timerWord = U.time ? L('Ошибка таймера', 'Timer error') : L('Концевой эффект', 'End effect');
  // режим аппарата без своих данных ошибки таймера: τ измерена в другом режиме того же аппарата (kv-session.js
  // передаёт, откуда — kv_tau_from, и значение в единицах задания этого режима — kv_tau_fix)
  const noCells = (k) => {
    const c = parseCells(f[k]);
    return c.n === 0 && !c.error;
  };
  const timerBlank =
    f.kv_timer_mode === 'measured' ? [...f.kv_tt, ...f.kv_tm].every(isBlank)
      : f.kv_timer_mode === 'nexp' ? noCells('kv_nx_M1') && noCells('kv_nx_Mn')
        : f.kv_timer_mode === 'twopoint' && noCells('kv_tp_R1') && noCells('kv_tp_R2');
  const tauFrom = timerBlank && !isBlank(f.kv_tau_from) ? String(f.kv_tau_from) : '';
  if (tauFrom) {
    const v = parseNumber(f.kv_tau_fix);
    if (Number.isFinite(v)) {
      tau = v;
      timer = { ...timer, from: tauFrom };
      add('info', 'common', U.time
        ? L(
          `τ = ${ru(tau, 4)} ${U.label} взята из ${tauFrom}: в этом режиме ошибку таймера не измеряли. Она зависит от того, как трубка выходит на режим, поэтому берётся из режима с ближайшим напряжением; при возможности измерьте её и здесь.`,
          `τ = ${ru(tau, 4)} ${U.labelEn} is taken from ${tauFrom}: the timer error was not measured in this mode. It depends on how the tube ramps up, so it is taken from the mode with the nearest voltage; if possible, measure it here too.`,
        )
        : L(
          `τ = ${ru(tau, 4)} ${U.label} взят из ${tauFrom}: в этом режиме концевой эффект не измеряли; при возможности измерьте его и здесь.`,
          `τ = ${ru(tau, 4)} ${U.labelEn} is taken from ${tauFrom}: the end effect was not measured in this mode; if possible, measure it here too.`,
        ), `${REF.trs}, разд. 9.4.2`, 'kv_timer_mode');
    } else {
      add('error', 'common', L(`${timerWord} из ${tauFrom} не вычислен${U.time ? 'а' : ''}: проверьте там раздел 3.`, `${timerWord} from ${tauFrom} could not be calculated: check section 3 there.`), null, 'kv_timer_mode');
    }
  } else if (f.kv_timer_mode === 'manual') {
    tau = read('kv_tau', L(`${U.time ? 'Ошибка таймера' : 'Концевой эффект'} τ`, `${U.time ? 'Timer error' : 'End effect'} τ`));
    tauOwn = Number.isFinite(tau);
  } else if (windowMode) {
    if (U.time) add('info', 'common', L('Заряд накоплен на интервале, когда трубка уже вышла на режим: ошибка таймера в мощность дозы не входит. Все серии, включая контрольные, нужно снимать так же. Для расчёта времени облучения пациентов ошибку таймера всё равно нужно знать.', 'Charge was collected over an interval with the tube already at its operating output, so the timer error does not enter the dose rate. All series, including the check measurements, must be taken the same way. The timer error must still be known for calculating patient treatment times.'), `${REF.trs}, разд. 9.4.2`);
  } else if (f.kv_timer_mode === 'nexp') {
    const tn = read('kv_nx_t', L('Задание одиночного облучения X', 'Single exposure setting X'));
    const n = read('kv_nx_n', L('Число облучений n', 'Number of exposures n'));
    const A = readCells('kv_nx_M1', L('Показание за одно облучение X', 'Reading for one exposure X'));
    const B = readCells('kv_nx_Mn', L('Показание за n облучений по X/n', 'Reading for n exposures of X/n'));
    spread(A, L('за одно облучение', 'for one exposure'), 'kv_nx_M1');
    spread(B, L('за n облучений', 'for n exposures'), 'kv_nx_Mn');
    if (Number.isFinite(tn) && Number.isFinite(n) && A.n > 0 && B.n > 0 && !A.error && !B.error) {
      const r = timerErrorMultiple(tn, n, A.mean, B.mean);
      if (r.error) add('error', 'common', L(`${timerWord}: ${r.error}.`, `${timerWord}: ${r.error}.`), null, ['kv_nx_n', 'kv_nx_M1', 'kv_nx_Mn']);
      else if (Math.abs(r.tau / tn) > 0.2 || Math.abs(B.mean) < 0.5 * Math.abs(A.mean) || Math.abs(B.mean) > 2 * Math.abs(A.mean)) {
        add('error', 'common', L(`τ = ${ru(r.tau, 3)} ${U.label} неправдоподобно: суммарное показание за n облучений по X/n должно быть близко к показанию за одно облучение X. Проверьте, что Mₙ — сумма за все n облучений, а не среднее за одно.`, `τ = ${ru(r.tau, 3)} ${U.labelEn} is implausible: the total reading for n exposures of X/n should be close to the reading for one exposure X. Check that Mₙ is the sum over all n exposures, not the mean per exposure.`), null, ['kv_nx_M1', 'kv_nx_Mn']);
      } else {
        tau = r.tau;
        tauOwn = true;
        timer = { ...timer, t: tn, n, M1: Math.abs(A.mean), Mn: Math.abs(B.mean) };
      }
    }
  } else if (f.kv_timer_mode === 'twopoint') {
    // при задании по времени T₁ и T₂ — в секундах (так меряют ошибку таймера), τ пересчитывается в единицы задания
    const tUnit = U.time ? 's' : f.kv_set_unit;
    const tL = U.time ? L('с', 's') : uLabel;
    const t1 = read('kv_tp_t1', L(`Задание T₁, ${tL}`, `Setting T₁, ${tL}`));
    const t2 = read('kv_tp_t2', L(`Задание T₂, ${tL}`, `Setting T₂, ${tL}`));
    const A = readCells('kv_tp_R1', L('Показания при T₁', 'Readings at T₁'));
    const B = readCells('kv_tp_R2', L('Показания при T₂', 'Readings at T₂'));
    spread(A, L('при T₁', 'at T₁'), 'kv_tp_R1');
    spread(B, L('при T₂', 'at T₂'), 'kv_tp_R2');
    timer = { ...timer, tUnit, t1, t2, R1: A.n > 0 && !A.error ? Math.abs(A.mean) : NaN, R2: B.n > 0 && !B.error ? Math.abs(B.mean) : NaN };
    if (Number.isFinite(t1) && Number.isFinite(t2) && A.n > 0 && B.n > 0 && !A.error && !B.error) {
      const r = timerErrorTwoPoint(t1, t2, A.mean, B.mean);
      if (r.error) add('error', 'common', L(`${timerWord}: ${r.error}.`, `${timerWord}: ${r.error}.`), null, ['kv_tp_t1', 'kv_tp_t2', 'kv_tp_R1', 'kv_tp_R2']);
      else {
        tau = U.time && f.kv_set_unit === 'min' ? r.tau / 60 : r.tau;
        tauOwn = true;
        timer = { ...timer, tauT: r.tau };
      }
    }
  } else if (f.kv_timer_mode === 'measured') {
    const r = timerError(f.kv_tt, f.kv_tm);
    if (r.error) add('error', 'common', L(`${timerWord}: ${r.error}.`, `${timerWord}: ${r.error}.`), null, 'kv_timer');
    else {
      tau = r.tau;
      tauOwn = true;
      timer = { ...timer, ...r, residualPct: r.n > 2 ? r.residual * 100 : NaN };
      if (r.residual > 0.002) add('warn', 'common', L(`Показания при разных заданиях плохо ложатся на прямую (разброс ${ru(r.residual * 100, 2)} %): повторите облучения.`, `Readings at different settings fit a straight line poorly (residual ${ru(r.residual * 100, 2)} %): repeat the exposures.`), null, 'kv_timer');
    }
  } else {
    add(U.time ? 'warn' : 'info', 'common', U.time
      ? L('Ошибка таймера не учтена. В kV-рентгене она может быть значительной и не является множителем: её нужно определить.', 'Timer error not accounted for. In kV x-rays it can be significant and is not a multiplicative correction: it must be determined.')
      : L('Концевой эффект монитора не учтён: при малых заданиях он может быть заметен.', 'The monitor end effect is not accounted for: it may be noticeable at small settings.'), `${REF.trs}, разд. 9.4.2`, 'kv_timer_mode');
  }
  timer.tau = tau;
  // τ в секундах и допуск на |τ| (методика учреждения, не TRS-398 Rev.1): только для своего τ, без τ из другого режима
  if (U.time) timer.tauS = f.kv_set_unit === 'min' ? tau * 60 : tau;
  const tolRaw = f.kv_tau_tol;
  if (!isBlank(tolRaw)) {
    const tol = parseNumber(tolRaw);
    if (!Number.isFinite(tol) || tol <= 0) add('error', 'common', L('Допуск на ошибку таймера — число секунд больше нуля.', 'The timer error tolerance must be a number of seconds greater than zero.'), null, 'kv_tau_tol');
    else if (U.time && tauOwn && Number.isFinite(timer.tauS)) {
      timer.tol = tol;
      timer.inTol = Math.abs(timer.tauS) <= tol;
      if (!timer.inTol) {
        add('warn', 'common', L(
          `|τ| = ${ru(Math.abs(timer.tauS), 2)} с больше допуска ${ru(tol, tolDigits(tol))} с (раздел 3). Ошибку таймера нужно устранить или уменьшить (обслуживающая организация); пока она есть, её учитывают при задании времени облучения пациентов. Допуск — по методике учреждения: в TRS-398 Rev.1 его нет.`,
          `|τ| = ${ru(Math.abs(timer.tauS), 2)} s exceeds the tolerance of ${ru(tol, tolDigits(tol))} s (section 3). The timer error should be eliminated or reduced (service provider); while it persists, it must be accounted for when setting patient treatment times. The tolerance follows the local procedure: TRS-398 Rev.1 has none.`,
        ), null, ['kv_tau_tol', 'kv_timer_mode']);
      }
    }
  }
  const Xeff = X + tau;
  if (Number.isFinite(tau) && Number.isFinite(X) && X > 0) {
    timer.relativePct = (tau / X) * 100;
    if (Xeff <= 0) add('error', 'common', L('Фактическое задание X + τ получилось неположительным: проверьте τ.', 'The actual setting X + τ is not positive: check τ.'), null, 'kv_tau');
    else if (Math.abs(tau / X) > 0.05) add('warn', 'common', L(`τ = ${ru(tau, 3)} ${U.label} — больше 5 % от задания: проверьте измерения.`, `τ = ${ru(tau, 3)} ${U.labelEn} exceeds 5 % of the setting: check the measurements.`), null, ['kv_tau', 'kv_timer']);
  }

  // ------------------------------------------------------------- показания
  const V1 = read('kv_V1', L('Рабочее напряжение V₁', 'Operating voltage V₁'));
  const M1 = readCells('kv_M1', L('M при V₁, обычная полярность', 'M at V₁, normal polarity'));
  spread(M1, L('при V₁', 'at V₁'), 'kv_M1');
  const MoppRaw = parseCells(f.kv_Mopp);
  // строка таблицы аппликаторов без своей серии при обратной полярности: k_pol снят с другим аппликатором того же
  // режима (kv-session.js передаёт, откуда — kv_pol_from, и значение — kv_kpol_fix)
  const polFrom = MoppRaw.n === 0 && !MoppRaw.error && !isBlank(f.kv_pol_from) ? String(f.kv_pol_from) : '';
  const Mopp = MoppRaw.n > 0 || MoppRaw.error ? readCells('kv_Mopp', L('M при V₁, обратная полярность', 'M at V₁, opposite polarity')) : MoppRaw;
  spread(Mopp, L('обратной полярности', 'at opposite polarity'), 'kv_Mopp');
  const kleak = read('kv_kleak', L('Поправка на утечку', 'Leakage correction'));
  if (Number.isFinite(kleak) && Math.abs(kleak - 1) > 0.001) add('warn', 'common', L('Утечка больше 0,1 % показания: причину нужно выяснить.', 'Leakage exceeds 0.1 % of the reading: the cause must be found.'), `${REF.trs}, табл. 3`, 'kv_kleak');
  const readingsOk = M1.n > 0 && !M1.error && M1.mean !== 0;
  const m1 = readingsOk ? Math.abs(M1.mean) : NaN;

  let kpolRaw = NaN;
  if (readingsOk && Mopp.n > 0 && !Mopp.error && Mopp.mean !== 0) {
    kpolRaw = polarity(M1.mean, Mopp.mean);
    if (Math.abs(kpolRaw - 1) > 0.004) add('warn', 'common', L(`k_pol = ${ru(kpolRaw, 4)} выходит за пределы 1 ± 0,004: для камеры эталонного класса эффект полярности должен быть меньше 0,4 %.`, `k_pol = ${ru(kpolRaw, 4)} is outside 1 ± 0.004: for a reference-class chamber the polarity effect should be below 0.4 %.`), `${REF.trs}, табл. 3`, 'kpol');
  } else if (polFrom) {
    kpolRaw = parseNumber(f.kv_kpol_fix);
    if (Number.isFinite(kpolRaw)) {
      add('info', 'common', f.kv_pol_mode
        ? L(
          `k_pol = ${ru(kpolRaw, 4)} взят из ${polFrom}: в этом режиме серии при обратной полярности нет, она снята в другом режиме той же камерой. TRS-398 Rev.1 определяет поправки в пучке пользователя: при возможности снимите серию и в этом режиме.`,
          `k_pol = ${ru(kpolRaw, 4)} is taken from ${polFrom}: this mode has no opposite-polarity series; it was measured in another mode with the same chamber. TRS-398 Rev.1 determines the corrections in the user beam: if possible, take the series in this mode too.`,
        )
        : L(
          `k_pol = ${ru(kpolRaw, 4)} взят из ${polFrom}: серия при обратной полярности снята там, с другим аппликатором того же режима.`,
          `k_pol = ${ru(kpolRaw, 4)} is taken from ${polFrom}: the opposite-polarity series was measured there, with another applicator of the same beam.`,
        ), `${REF.trs}, разд. 4.4.3.3`, 'kv_Mopp');
    } else {
      add('error', 'common', L(`k_pol из ${polFrom} не вычислен: проверьте там показания при обратной полярности.`, `k_pol from ${polFrom} could not be calculated: check the opposite-polarity readings there.`), null, 'kv_Mopp');
    }
  } else if (Mopp.n === 0) {
    add('warn', 'common', L('Показания при обратной полярности не введены: k_pol принят равным 1. Эффект полярности нужно проверить, особенно у плоскопараллельных камер в пучках низких энергий.', 'No readings at opposite polarity: k_pol is taken as 1. The polarity effect must be checked, especially for plane-parallel chambers in low-energy beams.'), `${REF.trs}, разд. 4.4.3.3`, 'kv_Mopp');
  }
  let kpolQ0 = 1;
  if (!f.kv_lab_pol_applied) kpolQ0 = read('kv_lab_kpol', L('Поправка на полярность при калибровке', 'Polarity correction at calibration'));
  const kpol = (Number.isFinite(kpolRaw) ? kpolRaw : 1) / kpolQ0;

  let ksRaw = 1;
  let ksEquation = L('k_s = 1: рекомбинация ионов пренебрежимо мала при мощности дозы меньше нескольких Гр/мин', 'k_s = 1: ion recombination is negligible at dose rates below a few Gy/min');
  let M2 = parseCells([]);
  let V2 = NaN;
  let ksFrom = '';
  if (f.kv_ks_on) {
    // строка таблицы аппликаторов без своей серии при V₂: k_s снят с другим аппликатором того же режима
    const M2Raw = parseCells(f.kv_M2);
    ksFrom = M2Raw.n === 0 && !M2Raw.error && !isBlank(f.kv_ks_from) ? String(f.kv_ks_from) : '';
  }
  if (f.kv_ks_on && ksFrom) {
    ksRaw = parseNumber(f.kv_ks_fix);
    if (Number.isFinite(ksRaw)) {
      ksEquation = L(`взят из ${ksFrom}`, `taken from ${ksFrom}`);
      add('info', 'common', f.kv_ks_mode
        ? L(
          `k_s = ${ru(ksRaw, 4)} взят из ${ksFrom}: в этом режиме серии при пониженном напряжении V₂ нет, она снята в другом режиме той же камерой. k_s зависит от мощности дозы: если в этом режиме она заметно выше, снимите серию при V₂ и здесь.`,
          `k_s = ${ru(ksRaw, 4)} is taken from ${ksFrom}: this mode has no series at the reduced voltage V₂; it was measured in another mode with the same chamber. k_s depends on the dose rate: if it is noticeably higher in this mode, take the V₂ series here too.`,
        )
        : L(
          `k_s = ${ru(ksRaw, 4)} взят из ${ksFrom}: серия при пониженном напряжении V₂ снята там, с другим аппликатором того же режима.`,
          `k_s = ${ru(ksRaw, 4)} is taken from ${ksFrom}: the series at the reduced voltage V₂ was measured there, with another applicator of the same beam.`,
        ), `${REF.trs}, разд. 4.4.3.4`, 'kv_M2');
    } else {
      add('error', 'common', L(`k_s из ${ksFrom} не вычислен: проверьте там показания при V₂.`, `k_s from ${ksFrom} could not be calculated: check the readings at V₂ there.`), null, 'kv_M2');
    }
  } else if (f.kv_ks_on) {
    V2 = read('kv_V2', L('Пониженное напряжение V₂', 'Reduced voltage V₂'));
    M2 = readCells('kv_M2', L('M при V₂', 'M at V₂'));
    spread(M2, L('при V₂', 'at V₂'), 'kv_M2');
    if (Number.isFinite(V1) && Number.isFinite(V2) && Math.abs(V1) <= Math.abs(V2)) add('error', 'common', L('Рабочее напряжение V₁ должно быть больше пониженного V₂.', 'Operating voltage V₁ must be higher than reduced voltage V₂.'), null, ['kv_V1', 'kv_V2']);
    const nV = Math.abs(V1) / Math.abs(V2);
    const recOk = readingsOk && M2.n > 0 && !M2.error && M2.mean !== 0 && Number.isFinite(nV) && nV > 1;
    if (readingsOk && M2.n > 0 && Math.sign(M1.mean) !== Math.sign(M2.mean)) add('error', 'common', L('Показания при V₁ и V₂ должны быть сняты при одной и той же (обычной) полярности.', 'Readings at V₁ and V₂ must be taken at the same (normal) polarity.'), null, 'kv_M2');
    if (recOk) {
      const ratio12 = Math.abs(M1.mean) / Math.abs(M2.mean);
      if (f.kv_rec_trs === 'eq16') {
        ksRaw = (nV * nV - 1) / (nV * nV - ratio12);
        ksEquation = L('ур. (16): k_s = (n² − 1)/(n² − M₁/M₂), общая рекомбинация в непрерывном пучке', 'Eq. (16): k_s = (n² − 1)/(n² − M₁/M₂), general recombination in a continuous beam');
      } else {
        const r = TRS.ks({ m1: M1.mean, m2: M2.mean, v1: Math.abs(V1), v2: Math.abs(V2), beam: 'pulsed' });
        ksRaw = r.value;
        ksEquation = L(`${r.equation}; в непрерывном пучке преобладает начальная рекомбинация (разд. 4.4.3.4 b)`, `${r.equation}; initial recombination dominates in a continuous beam (Sec. 4.4.3.4 b)`);
        if (r.error) add('error', 'common', r.error[0].toUpperCase() + r.error.slice(1) + '.', `${REF.trs}, табл. 10`, 'ks');
        r.notes.forEach((n) => add('warn', 'common', n[0].toUpperCase() + n.slice(1) + '.', `${REF.trs}, разд. 4.4.3.4`, 'ks'));
      }
      if (ratio12 < 1) {
        // M(V₂) > M(V₁): по формуле k_s < 1, чего не бывает — при пониженном напряжении заряда собирается меньше.
        // Расчёт останавливается: k_s нужно перемерить.
        add('error', 'common', L(
          `Показание при V₂ больше, чем при V₁: по формуле k_s = ${ru(ksRaw, 4)} < 1, а k_s не может быть меньше 1 (при пониженном напряжении собирается меньше заряда). k_s нужно перемерить, проверив показания и напряжения.`,
          `The reading at V₂ is higher than at V₁: the formula gives k_s = ${ru(ksRaw, 4)} < 1, but k_s cannot be less than 1 (less charge is collected at the reduced voltage). k_s must be re-measured, checking the readings and voltages.`,
        ), `${REF.trs}, разд. 4.4.3.4`, ['ks', 'kv_M2']);
      } else if (ksRaw > 1.05) add('error', 'common', L(`k_s = ${ru(ksRaw, 4)} > 1,05: метод двух напряжений неприменим.`, `k_s = ${ru(ksRaw, 4)} > 1.05: the two-voltage method is not applicable.`), `${REF.trs}, табл. 3`, 'ks');
    } else ksRaw = NaN;
  } else {
    add('info', 'common', L('k_s = 1: рекомбинация ионов пренебрежимо мала, когда мощность дозы меньше нескольких Гр/мин. При большей мощности дозы включите метод двух напряжений.', 'k_s = 1: ion recombination is negligible when the dose rate is below a few Gy/min. At higher dose rates, enable the two-voltage method.'), `${REF.trs}, разд. 9.4.2`, 'kv_ks_on');
  }
  let ksQ0 = 1;
  if (!f.kv_lab_ks_applied) ksQ0 = read('kv_lab_ks', L('Поправка на рекомбинацию при калибровке', 'Recombination correction at calibration'));
  const ks = ksRaw / ksQ0;

  // ------------------------------------------------------- контрольные измерения
  const ctrlRaw = parseCells(f.kv_Mc);
  const ctrl = { on: ctrlRaw.n > 0 || !!ctrlRaw.error };
  if (ctrl.on) {
    ctrl.M = readCells('kv_Mc', L('Контрольные измерения', 'Check measurements'), 'ctrl');
    spread(ctrl.M, L('контрольных измерений', 'of the check measurements'), 'kv_Mc', 'ctrl');
    if (readingsOk && ctrl.M.n > 0 && !ctrl.M.error && ctrl.M.mean !== 0 && Math.sign(ctrl.M.mean) !== Math.sign(M1.mean)) {
      add('error', 'ctrl', L('Контрольные измерения снимают при той же (обычной) полярности, что и M при V₁.', 'Check measurements must be taken at the same (normal) polarity as M at V₁.'), null, 'kv_Mc');
    }
    ctrl.X = isBlank(f.kv_ctrl_set) ? X : read('kv_ctrl_set', L('Задание контрольного облучения', 'Check exposure setting'), 'ctrl');
    if (Number.isFinite(ctrl.X) && ctrl.X <= 0) add('error', 'ctrl', L('Задание контрольного облучения должно быть больше нуля.', 'The check exposure setting must be greater than zero.'), null, 'kv_ctrl_set');
    ctrl.Xeff = ctrl.X + tau;
    if (ctrl.X > 0 && Number.isFinite(tau) && !(ctrl.Xeff > 0)) add('error', 'ctrl', L('Фактическое задание контрольного облучения X + τ получилось неположительным.', 'The actual check exposure setting X + τ is not positive.'), null, 'kv_ctrl_set');
    ctrl.mean = ctrl.M.n > 0 && !ctrl.M.error ? Math.abs(ctrl.M.mean) : NaN;
    const ctrlErr = messages.some((m) => m.level === 'error' && m.scope === 'ctrl');
    if (!ctrlErr && Number.isFinite(ctrl.mean) && Number.isFinite(m1) && ctrl.Xeff > 0 && Xeff > 0) ctrl.changePct = ((ctrl.mean / ctrl.Xeff) / (m1 / Xeff) - 1) * 100;
  }

  // ------------------------------------------------------------- физические множители ветки
  const andreo = { used: false };
  const dataWarnings = (ws, what) => {
    for (const w of ws) {
      if (w.code === 'hvl_unphysical') continue; // уже ошибка выше
      const p = w.params;
      if (w.code === 'kv_extrap') add('info', 'trs', L(`${what}: ${ru(kv, 0)} кВ — вне сетки данных Andreo (${p.min}–${p.max} кВ), значение экстраполировано.`, `${what}: ${ru(kv, 0)} kV is outside the Andreo data grid (${p.min}–${p.max} kV); the value is extrapolated.`), null, 'kv_kv');
      else if (w.code === 'hvl_extrap') add('info', 'trs', L(`${what}: СПО ${ru(hvl, 3)} мм ${p.material} — вне сетки данных Andreo (${dec(p.min)}–${dec(p.max)} мм ${p.material}), значение экстраполировано.`, `${what}: HVL ${ru(hvl, 3)} mm ${p.material} is outside the Andreo data grid (${p.min}–${p.max} mm ${p.material}); the value is extrapolated.`), null, 'kv_hvl');
      else if (w.code === 'hvl_extrap_c1') add('info', 'trs', L(`${what}: СПО ${ru(hvl, 3)} мм ${p.material} — вне таблицы [μen/ρ]FIA (${dec(p.min)}–${dec(p.max)} мм ${p.material}), значение экстраполировано.`, `${what}: HVL ${ru(hvl, 3)} mm ${p.material} is outside the [μen/ρ]FIA table (${p.min}–${p.max} mm ${p.material}); the value is extrapolated.`), null, 'kv_hvl');
      else if (w.code === 'geom_extrap') add('warn', 'trs', L(`${what}: РИП или поле вне сетки данных Andreo (РИП 10–100 см, диаметр 1–30 см), значение экстраполировано.`, `${what}: the SSD or field is outside the Andreo data grid (SSD 10–100 cm, diameter 1–30 cm); the value is extrapolated.`), null, ['kv_ssd', 'kv_cone', 'kv_lab_f', 'kv_lab_ssd']);
    }
  };
  const phys = { factor: NaN };
  const geomOk = Number.isFinite(fClin) && Number.isFinite(ssd);
  const labOk = Number.isFinite(fLab) && Number.isFinite(ssdLab);
  const kg = { value: NaN };
  const kgCheck = () => {
    if (Number.isFinite(kg.value) && Math.abs(kg.value - 1) > 0.05) add('warn', 'trs', L(`k_g = ${ru(kg.value, 4)} отличается от 1 больше чем на 5 %: проверьте поле и РИП в клинике и в лаборатории.`, `k_g = ${ru(kg.value, 4)} differs from 1 by more than 5 %: check the field and SSD in the clinic and at the laboratory.`), null, 'kv_kg_src');
  };
  const readFactor = (key, label, lo = 0.8, hi = 1.2) => {
    const v = read(key, label, 'trs');
    if (Number.isFinite(v) && (v < lo || v > hi)) {
      add('error', 'trs', L(`«${label}» = ${ru(v, 4)} вне ${dec(lo)}–${dec(hi)}: проверьте ввод.`, `"${label}" = ${ru(v, 4)} is outside ${lo}–${hi}: check the input.`), null, key);
      return NaN;
    }
    return v;
  };

  if (qualityOk && range === 'low' && cal === 'nk') {
    // ур. (50)–(51): [μen/ρ]FIA по СПО (мм Al), B_w по кВ, СПО, полю и РИП клиники
    andreo.used = true;
    const mu = kvx.muenFIA(hvl, 'Al');
    dataWarnings(mu.warnings, '[μen/ρ]FIA');
    phys.muen = mu.raw;
    if (geomOk) {
      const bw = kvx.bw(kv, hvl, ssd, fClin);
      dataWarnings(bw.warnings, 'B_w');
      phys.bw = bw.raw;
    } else phys.bw = NaN;
    phys.nkFs = isBlank(f.kv_nk_fs) ? 1 : readFactor('kv_nk_fs', L('Поправка N_K на размер поля', 'N_K field-size correction'), 0.9, 1.1);
    const stdField = chamber?.type === 'cyl' ? 5 : 10;
    phys.stdField = stdField;
    if (Number.isFinite(fClin) && Math.abs(fClin - stdField) > 1e-6 && isBlank(f.kv_nk_fs)) {
      add('info', 'trs', L(
        `Стандартное поле для воздушного метода — диаметр ${stdField} см (${chamber?.type === 'cyl' ? 'цилиндрическая' : 'плоскопараллельная'} камера). Для поля ${ru(fClin, 1)} см N_K камер PTW 23342 и 23344 зависит от поля (рис. 11): введите поправку N_K на поле из рис. 11 или от лаборатории.`,
        `The standard field for the in-air method is ${stdField} cm in diameter (${chamber?.type === 'cyl' ? 'cylindrical' : 'plane-parallel'} chamber). For a ${ru(fClin, 1)} cm field, N_K of PTW 23342 and 23344 chambers depends on the field (Fig. 11): enter the N_K field correction from Fig. 11 or from the laboratory.`,
      ), `${REF.trs}, табл. 26, рис. 11`, 'kv_nk_fs');
    }
    phys.factor = phys.nkFs * phys.muen * phys.bw;
  } else if (qualityOk && range === 'medium' && cal === 'nk') {
    // ур. (57): [μen/ρ] на 2 см (мм Cu) и p_ch по табл. 32
    andreo.used = true;
    if (geomOk) {
      const mu = kvx.muenZ2(kv, hvl, ssd, fClin);
      dataWarnings(mu.warnings, '[μen/ρ]z=2');
      phys.muen = mu.raw;
    } else phys.muen = NaN;
    const t = chamber?.pch ? pchFromTable32(chamber.pch, hvl) : null;
    if (t) {
      phys.pch = t.value;
      phys.pchSource = 'table32';
      if (t.extrapolated) add('warn', 'trs', L(`СПО ${ru(hvl, 3)} мм Cu вне табл. 32 (0,108–3,592 мм Cu): p_ch взят по крайнему качеству.`, `HVL ${ru(hvl, 3)} mm Cu is outside Table 32 (0.108–3.592 mm Cu): p_ch is taken at the nearest quality.`), `${REF.trs}, табл. 32`, 'kv_hvl');
      if (Number.isFinite(fClin) && Number.isFinite(ssd) && (Math.abs(fClin - 10) > 0.5 || Math.abs(ssd - 100) > 1e-6)) {
        add('info', 'trs', L('p_ch табл. 32 даны для поля 10 см и РИП 100 см; при другом поле без поправки на поле к неопределённости p_ch добавляется 0,5 %.', 'The p_ch of Table 32 are for a 10 cm field and 100 cm SSD; for another field without a field correction, 0.5 % is added to the p_ch uncertainty.'), `${REF.trs}, разд. 9.4.3, табл. 33`);
      }
    } else if (chamber) {
      phys.pch = readFactor('kv_pch', 'p_ch', 0.95, 1.05);
      phys.pchSource = 'manual';
      notRev1.push(L('p_ch введён вручную (камеры нет в табл. 32)', 'p_ch entered manually (chamber not in Table 32)'));
      add('warn', 'trs', L(`Камеры ${chamber.label} нет в табл. 32: p_ch введён вручную. Укажите источник значения.`, `${chamber.label} is not in Table 32: p_ch is entered manually. Give the source of the value.`), `${REF.trs}, табл. 32`, 'kv_pch');
    }
    phys.factor = phys.muen * phys.pch;
  } else if (qualityOk && cal === 'ndw') {
    // k_g: ур. (52) или (58)
    const src = f.kv_kg_src;
    kg.lab = { f: fLab, ssd: ssdLab };
    if (kq1) {
      // калибровки в рентгене нет — нет и лабораторной геометрии для k_g
      kg.value = 1;
      kg.source = 'nocal';
      kg.lab = null;
    } else if (geomOk && labOk && sameGeometry) {
      kg.value = 1;
      kg.source = 'same';
    } else if (!geomOk || !labOk) {
      kg.value = NaN;
    } else if (src === 'lab') {
      kg.value = readFactor('kv_kg_lab', L('k_g лаборатории', 'k_g from the laboratory'));
      kg.source = 'lab';
    } else if (src === 'one') {
      kg.value = 1;
      kg.source = 'one';
      notRev1.push(L('k_g = 1 при поле или РИП не как в лаборатории', 'k_g = 1 with a field or SSD different from the laboratory'));
      add('warn', 'trs', L(
        'k_g принят равным 1, хотя поле или РИП отличаются от лабораторных: это подход DIN 6809-4 и SSRMP No 9 (неопределённость 2,0 % для низких и 1,3 % для средних энергий), а не TRS-398 Rev.1.',
        'k_g is taken as 1 although the field or SSD differ from the laboratory: this is the DIN 6809-4 and SSRMP No 9 approach (uncertainty 2.0 % for low and 1.3 % for medium energies), not TRS-398 Rev.1.',
      ), `${REF.din}, разд. 6.3, 6.4`, 'kv_kg_src');
    } else if (range === 'medium') {
      // ур. (90): отношения N_K и p_ch сокращаются, остаётся [μen/ρ]z=2(клин.)/[μen/ρ]z=2(лаб.)
      andreo.used = true;
      const r = kvx.kgMuenZ2(kv, hvl, { ssd: ssdLab, f: fLab }, { ssd, f: fClin });
      dataWarnings(r.warnings, 'k_g');
      kg.value = kvx.muenZ2(kv, hvl, ssd, fClin).raw / kvx.muenZ2(kv, hvl, ssdLab, fLab).raw;
      kg.source = 'eq90';
      kg.ref = r.ref;
      kg.clin = r.clin;
      if (src === 'eq85' || src === 'table') add('info', 'trs', L('Для средних энергий k_g считается по ур. (90).', 'For medium energies, k_g is calculated by Eq. (90).'), `${REF.trs}, прил. I, ур. (90)`, 'kv_kg_src');
    } else if (src === 'eq85') {
      // ур. (85): отношение N_K^PMMA из лаборатории × отношение B_w; отношение p_ch сокращается
      andreo.used = true;
      kg.nkRatio = readFactor('kv_kg_nk', L('Отношение N_K^PMMA (клин./лаб.)', 'N_K^PMMA ratio (clin./lab.)'));
      const r = kvx.kgBw(kv, hvl, { ssd: ssdLab, f: fLab }, { ssd, f: fClin });
      dataWarnings(r.warnings, 'B_w');
      kg.bwRatio = kvx.bw(kv, hvl, ssd, fClin).raw / kvx.bw(kv, hvl, ssdLab, fLab).raw;
      kg.value = kg.nkRatio * kg.bwRatio;
      kg.source = 'eq85';
    } else {
      // 'auto' или 'table': табл. 28–29 для PTW 23342 и 23344
      const t = chamber?.kgTable ? kgFromTable(chamber.kgTable, { kv, hvl }, fClin, fLab) : null;
      if (t && t.inRange.hvl && t.inRange.f) {
        kg.value = t.value;
        kg.byKv = t.byKv;
        kg.spreadPct = t.spreadPct;
        kg.table = t.table;
        kg.source = 'table';
        const kvTxt = Number.isFinite(t.byKv) ? ru(t.byKv, 4) : L('— (кВ вне 10–100)', '— (kV outside 10–100)');
        add('info', 'trs', L(
          `k_g по табл. ${t.table}: качество поставлено между столбцами TW по ln(СПО) (СПО столбцов — DIN 6809-4, табл. 2), поле — линейно между строками${Math.abs(fLab - 3) > 1e-6 ? `, таблица перенормирована на поле лаборатории ${ru(fLab, 1)} см` : ''}. По кВ k_g = ${kvTxt}${Number.isFinite(t.spreadPct) ? `; расхождение ${ru(t.spreadPct, 2)} % относится к неопределённости k_g` : ''}.`,
          `k_g from Table ${t.table}: the quality is placed between the TW columns by ln(HVL) (column HVLs from DIN 6809-4, Table 2), the field linearly between rows${Math.abs(fLab - 3) > 1e-6 ? `, the table is renormalized to the laboratory field of ${ru(fLab, 1)} cm` : ''}. By kV, k_g = ${kvTxt}${Number.isFinite(t.spreadPct) ? `; the ${ru(t.spreadPct, 2)} % difference is part of the k_g uncertainty` : ''}.`,
        ), `${REF.trs}, табл. ${t.table}`, 'kv_kg_src');
        if (Math.abs(ssd - 30) > 1e-6 || Math.abs(ssdLab - 30) > 1e-6) {
          add('info', 'trs', L(`Табл. ${t.table} получена при РИП 30 см; k_g зависит в основном от поля и мало — от РИП, поэтому таблицу можно применять при обычных клинических РИП.`, `Table ${t.table} was obtained at 30 cm SSD; k_g depends mainly on the field and only slightly on the SSD, so the table may be used at the usual clinical SSDs.`), `${REF.trs}, разд. 8.4.2`);
        }
      } else {
        const why = !chamber?.kgTable
          ? L('для этой камеры нет табл. 28–29 (они только для PTW 23342 и 23344)', 'there is no Table 28–29 for this chamber (they are only for PTW 23342 and 23344)')
          : !t.inRange.f
            ? L('поле вне табл. 28–29 (2–20 см)', 'the field is outside Tables 28–29 (2–20 cm)')
            : L('СПО вне качеств табл. 28–29 (TW10–TW100, 0,030–4,41 мм Al)', 'the HVL is outside the qualities of Tables 28–29 (TW10–TW100, 0.030–4.41 mm Al)');
        add('error', 'trs', L(
          `Поле или РИП отличаются от лабораторных, а k_g взять неоткуда: ${why}. Введите k_g лаборатории или отношение N_K^PMMA от лаборатории (ур. 85).`,
          `The field or SSD differ from the laboratory, and there is no source for k_g: ${why}. Enter k_g from the laboratory or the N_K^PMMA ratio from the laboratory (Eq. 85).`,
        ), `${REF.trs}, разд. 8.4.2, прил. I, ур. (84)–(85)`, 'kv_kg_src');
        kg.value = NaN;
      }
    }
    kgCheck();
    if (range === 'low' && phantom && phantom.kind !== 'pmma' && (kg.source === 'table' || kg.source === 'eq85')) {
      add('info', 'trs', L(
        `k_g в ур. (52) определён для фантома из ПММА, а фантом — ${phantom.name}: применимость ${kg.source === 'table' ? 'табл. 28–29' : 'ур. (85)'} к другому материалу в TRS-398 Rev.1 не рассматривается.`,
        `k_g in Eq. (52) is defined for a PMMA phantom, while the phantom is ${phantom.name}: TRS-398 Rev.1 does not consider whether ${kg.source === 'table' ? 'Tables 28–29 apply' : 'Eq. (85) applies'} to another material.`,
      ), `${REF.trs}, разд. 8.4.2, ур. (52)`, ['kv_kg_src', 'kv_phantom']);
    }
    phys.kg = kg.value;
    phys.kz = qo === 'co60' ? 1 : undefined;
    phys.factor = kg.value;
  }

  // ------------------------------------------------------------- доза
  const kTP = temperaturePressure({ T, P, T0, P0, abs0: TRS.TRS_ABS0 });
  const product = kTP * kelec * kpol * ks * kleak;
  const trs = { enabled: true, equation: eqText, kTP, kelec, kpol, kpolRaw, kpolQ0, kpolFrom: polFrom || null, ks, ksRaw, ksQ0, ksEquation, ksFrom: ksFrom || null, kleak, NQ: cert.NQ, phys, kg };
  const depth = { on: range === 'medium' && !isBlank(f.kv_pdd2), zref: range === 'medium' ? 2 : 0 };
  if (depth.on) {
    depth.pdd = read('kv_pdd2', L('PDD(2 см)', 'PDD(2 cm)'), 'depth');
    if (Number.isFinite(depth.pdd) && (depth.pdd < 20 || depth.pdd > 100)) add('error', 'depth', L('PDD(2 см) вводится в процентах от дозы на поверхности, от 20 до 100.', 'PDD(2 cm) is entered as a percentage of the surface dose, from 20 to 100.'), null, 'kv_pdd2');
    depth.ok = !messages.some((m) => m.level === 'error' && m.scope === 'depth');
    // в каком фантоме снята PDD: SSRMP No 9, разд. 5.7.1.2
    depth.phantom = resolveKvPhantom(f.kv_pdd_phantom, f.kv_ph_name);
    depth.phantomStatus = kvPhantomStatus(depth.phantom, 'pdd');
    const st = depth.phantomStatus;
    if (st && st.state !== 'ok') {
      add(st.state === 'warn' ? 'warn' : 'info', 'depth', L(`PDD(2 см) снята в фантоме: ${depth.phantom.name}; ${st.text}.`, `PDD(2 cm) was measured in: ${depth.phantom.name}; ${st.text}.`), null, 'kv_pdd_phantom');
    }
  }
  // свой материал фантома: название для протокола, плотность — правдоподобная
  const customUsed = phantom?.kind === 'custom' || labPhantom?.kind === 'custom' || (range === 'medium' && f.kv_pdd_phantom === 'custom');
  if (customUsed) {
    if (isBlank(f.kv_ph_name)) add('warn', 'common', L('Свой материал фантома: укажите название и производителя — они попадут в протокол.', 'Custom phantom material: enter its name and manufacturer for the report.'), null, 'kv_ph_name');
    if (!isBlank(f.kv_ph_rho)) {
      const rho = parseNumber(f.kv_ph_rho);
      if (!(rho >= 0.5 && rho <= 3)) add('warn', 'common', L('Плотность материала фантома вводится в г/см³ (обычно 0,9–1,2): проверьте значение.', 'The phantom material density is entered in g/cm³ (usually 0.9–1.2): check the value.'), null, 'kv_ph_rho');
    }
  }
  const finish = (x, M, Xe) => {
    x.M = M;
    x.D = M * cert.NQ * phys.factor; // Гр за облучение на опорной глубине (низкие — на поверхности)
    x.DcGy = x.D * 100;
    x.perUnit = (x.D / Xe) * U.toRate; // Гр/Гр, Гр/мин или сГр/МЕ
    if (depth.on && depth.ok) {
      x.Dsurf = (x.D * 100) / depth.pdd;
      x.perUnitSurf = (x.perUnit * 100) / depth.pdd;
    }
    x.ok = Number.isFinite(x.D) && x.D > 0 && Number.isFinite(x.perUnit) && x.perUnit > 0;
  };
  finish(trs, m1 * product, Xeff);
  trs.rateLabel = L(U.rateLabel, U.rateLabelEn);
  const ctrlBlocked = messages.some((m) => m.level === 'error' && m.scope === 'ctrl');
  if (ctrl.on) {
    finish((trs.ctrl = {}), ctrl.mean * product, ctrl.Xeff);
    trs.ctrl.blocked = ctrlBlocked || !trs.ctrl.ok;
  }

  // ------------------------------------------------------------- сравнение с прежним значением
  const cmp = { at: range === 'medium' && f.kv_ref_at === 'surface' ? 'surface' : 'zref' };
  cmp.tolerance = readTolerance(f.kv_tol, { add, parseNumber, isBlank, field: 'kv_tol' });
  const refVal = parseNumber(f.kv_ref);
  if (!isBlank(f.kv_ref) && !(refVal > 0)) add('warn', 'common', L('Значение для сравнения должно быть положительным числом в единицах итога.', 'The comparison value must be a positive number in the units of the result.'), null, 'kv_ref');
  if (refVal > 0) {
    cmp.ref = refVal;
    for (const x of [trs, trs.ctrl].filter(Boolean)) {
      const v = cmp.at === 'surface' ? x.perUnitSurf : x.perUnit;
      if (Number.isFinite(v)) x.deviation = (v / refVal - 1) * 100;
    }
    if (cmp.at === 'surface' && !depth.on) add('warn', 'common', L('Значение для сравнения задано на поверхности, а PDD(2 см) не введена: сравнить не с чем.', 'The comparison value is given at the surface, but PDD(2 cm) is not entered: there is nothing to compare.'), null, ['kv_ref_at', 'kv_pdd2']);
  }

  const hasError = (scope) => messages.some((m) => m.level === 'error' && (m.scope === 'common' || m.scope === scope));
  if (!trs.ok && !hasError('trs')) add('error', 'trs', L('Не удалось вычислить дозу: проверьте ввод.', 'Could not calculate the dose: check the input.'));
  trs.blocked = hasError('trs');
  if (trs.ctrl) trs.ctrl.blocked = trs.ctrl.blocked || trs.blocked;
  {
    const p = ctrl.on ? trs.ctrl : trs;
    if (p && !p.blocked && Number.isFinite(p.deviation) && Math.abs(p.deviation) > cmp.tolerance) {
      const tolTxt = ru(cmp.tolerance, cmp.tolerance % 1 ? 1 : 0);
      add('warn', 'common', L(
        `Доза на единицу задания отличается от значения для сравнения на ${p.deviation > 0 ? '+' : ''}${ru(p.deviation, 2)} % — больше допуска ±${tolTxt} %. Проверьте установку камеры, сертификат, СПО и значение для сравнения.`,
        `The dose per unit setting differs from the comparison value by ${p.deviation > 0 ? '+' : ''}${ru(p.deviation, 2)} %, more than the ±${tolTxt} % tolerance. Check the chamber setup, the certificate, the HVL and the comparison value.`,
      ), null, 'kv_ref');
    }
  }
  const order = { error: 0, warn: 1, info: 2 };
  messages.sort((a, b) => order[a.level] - order[b.level]);

  // соответствие стандартным условиям (табл. 26, 27, 31)
  const shown = trs.blocked ? {} : ctrl.on ? (trs.ctrl && !trs.ctrl.blocked ? trs.ctrl : {}) : trs;
  const conditions = evaluateConditions(KV_CONDITIONS, {
    range, cal, qo, kq1, kv, chamber, fClin, ssd, sameGeometry, kgSource: kg.source, pchSource: phys.pchSource,
    nkFsGiven: !isBlank(f.kv_nk_fs), coneLargest: f.kv_cone_largest, coneShape: f.kv_cone_shape, coneSize, coneB, kleak, kpolRaw,
    phantom, labPhantom, phantomStatus,
  }, 'trs');
  const compliance = complianceFromConditions(conditions, Number.isFinite(shown.perUnit));

  // справочное сравнение с TG-61 или DIN 6809-4 / SSRMP No 9 — на итог не влияет
  const compare = qualityOk ? compareKv(f, { range, cal, qo, kq1, kv, hvl, ssd, fClin, chamber, phys, kg }) : { available: false, rows: [], notes: [], flags: [] };
  compare.flags.forEach((k) => flag(k, 'warn'));

  return {
    protocol: 'trs',
    form: f,
    range,
    cal,
    qo,
    material: mat,
    chamber,
    cert,
    compliance,
    notRev1,
    phantom: { clin: phantom, lab: labPhantom, status: phantomStatus, customUsed },
    inputs: { kv, hvl, hvlSource: Number.isFinite(hvlMeas) ? 'measured' : 'table', hvlNominal, ssd, coneSize, coneB, fClin, fLab, ssdLab, sameGeometry, T, P, H: env.H, T0, P0, V1, V2, kelec, kleak, M1, Mopp, M2, X, Xeff, unit: f.kv_set_unit, unitLabel: uLabel },
    timer,
    ctrl,
    depth,
    cmp,
    trs,
    andreo: { ...andreo, citation: andreo.used ? ANDREO_CITATION : null },
    compare,
    messages,
    flags,
    hasErrors: messages.some((m) => m.level === 'error'),
  };
}
