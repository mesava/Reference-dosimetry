// kV-рентген: несколько режимов аппарата (пучков), у каждого своя таблица аппликаторов (раздел
// «Аппликаторы»). У строки свои аппликатор, РИП, задание, температура, давление, показания, PDD и значение для сравнения
// (KV_ROW_KEYS); пучок, фантом и ошибка таймера — общие для строк режима; камера с сертификатом — одна из введённых камер.
// Каждая строка считается обычным computeKv по форме «общее + камера + режим + строка».
// k_pol и k_s: серии при обратной полярности и при пониженном напряжении V₂ обычно снимают с одним аппликатором
// режима. Строка без своей серии берёт k_pol (k_s) из первой строки, где серия есть; строка со своей серией считает
// свой. Значения передаются в computeKv полями kv_pol_from / kv_kpol_fix и kv_ks_from / kv_ks_fix.
// Стандартный тубус (standardRow): по нему референсная доза; остальные тубусы, отличающиеся от стандартного только
// полем, — измерения в нестандартных условиях (TRS-398 Rev.1, разд. 9.5), а не отступление от референсных условий.
import { computeKv, KV_DEFAULTS, KV_SET_UNITS, normalizeKv } from './kv.js';
import { parseCells, parseNumber, isBlank } from './units.js';
import { L, getLang } from './i18n.js';

/** Поля строки (аппликатора); остальные поля формы — общие для всех строк. */
export const KV_ROW_KEYS = [
  'kv_cone_shape', 'kv_cone', 'kv_cone_b', 'kv_cone_largest', 'kv_ssd',
  'kv_set',
  'kv_env_T', 'kv_env_H', 'kv_env_P',
  'kv_M1', 'kv_Mopp', 'kv_M2', 'kv_Mc', 'kv_ctrl_set',
  'kv_kg_lab', 'kv_kg_nk', 'kv_nk_fs', 'kv_pch',
  'kv_pdd2', 'kv_ref',
];
const ROW_SET = new Set(KV_ROW_KEYS);

const copy = (v) => (Array.isArray(v) ? [...v] : v);
const pick = (f, keys) => Object.fromEntries(keys.map((k) => [k, copy(f[k])]));

/** Пустая строка; from — строка, из которой берутся форма тубуса, РИП, задание, T, P и влажность (новая строка таблицы). */
export function emptyKvRow(from = null) {
  const row = pick(KV_DEFAULTS, KV_ROW_KEYS);
  if (from) for (const k of ['kv_cone_shape', 'kv_ssd', 'kv_set', 'kv_env_T', 'kv_env_H', 'kv_env_P']) row[k] = copy(from[k]);
  return row;
}

/** Плоская форма → общие поля и поля строки. */
export function splitKvForm(form) {
  const f = normalizeKv(form);
  const shared = {};
  // только поля формы: служебные kv_pol_from / kv_kpol_fix и прочее из файла в общие не попадают
  for (const k of Object.keys(KV_DEFAULTS)) if (!ROW_SET.has(k)) shared[k] = copy(f[k]);
  return { shared, row: pick(f, KV_ROW_KEYS) };
}

/** Форма строки i: общие поля + поля строки. */
export const kvRowForm = (sess, i) => ({ ...sess.shared, ...sess.rows[i] });

/**
 * Данные вкладки: { shared, rows, active }. Принимает плоскую форму одного расчёта (файлы и черновики до 0.36.0 —
 * одна строка) или { form, rows, active }, как в файле: form — плоская форма выбранной строки, rows — все строки.
 */
export function normalizeKvSession(input) {
  const src = input && typeof input === 'object' ? input : {};
  const flat = src.form && typeof src.form === 'object' ? src.form : src;
  const { shared, row } = splitKvForm(flat);
  let rows = Array.isArray(src.rows) && src.rows.length ? src.rows.map((r) => splitKvForm({ ...shared, ...(r && typeof r === 'object' ? r : {}) }).row) : [row];
  const a = Number(src.active);
  const active = Number.isInteger(a) && a >= 0 && a < rows.length ? a : 0;
  // плоская форма — это выбранная строка: она точнее, если строки и форма разошлись
  if (Array.isArray(src.rows) && src.rows.length && src.form) rows = rows.map((r, i) => (i === active ? row : r));
  return { shared, rows, active };
}

/** Аппликатор строки коротко: «Ø 6 см», «10 × 10 см», «6 × 8 см»; пусто, если размер не введён. */
export function kvRowLabel(row) {
  const a = String(row?.kv_cone ?? '').trim();
  if (!a) return '';
  const cm = L('см', 'cm');
  if (row.kv_cone_shape === 'square') return `${a} × ${a} ${cm}`;
  if (row.kv_cone_shape === 'rect') return `${a} × ${String(row.kv_cone_b ?? '').trim() || '?'} ${cm}`;
  return `Ø ${a} ${cm}`;
}

/** «строки 2 (Ø 6 см)» — откуда взят k_pol или k_s (продолжает фразу «взят из …»). */
const fromText = (rows, j) => {
  const lab = kvRowLabel(rows[j]);
  return L(`строки ${j + 1}${lab ? ` (${lab})` : ''}`, `row ${j + 1}${lab ? ` (${lab})` : ''}`);
};

const hasSeries = (cells) => {
  const s = parseCells(cells);
  return s.n > 0 || !!s.error;
};

/** Условия поля, которыми стандартный тубус отличается от остальных: табл. 31 (средние энергии) и табл. 26 (низкие, N_K). */
const FIELD_CONDS = ['kvMedField', 'kvLowNkField'];
const fieldState = (r) => r.compliance?.conditions?.find((c) => FIELD_CONDS.includes(c.id) && c.state !== 'na')?.state;

/**
 * Стандартный тубус таблицы (номер строки с 0; −1 — такого нет). Средние энергии (табл. 31): поле 10 × 10 см или Ø 10 см,
 * тубус сопоставимого размера или самый большой квадратный или круглый; из нескольких таких — с наибольшим РИП (сноска b).
 * Низкие энергии: N_K — поле по табл. 26 или N_K с поправкой на поле (разд. 8.4.1); N_D,w — поле и РИП как при калибровке
 * (табл. 27). Пустые строки не рассматриваются.
 */
function standardRow(rows, results) {
  let best = -1;
  rows.forEach((row, i) => {
    if (kvRowEmpty(row)) return;
    const r = results[i];
    const ok = r.range === 'low' && r.cal === 'ndw' ? r.inputs.sameGeometry === true : fieldState(r) === 'met';
    if (!ok) return;
    if (best < 0 || (r.range === 'medium' && r.inputs.ssd > results[best].inputs.ssd)) best = i;
  });
  return best;
}

/** Поля, по которым видно ошибку ввода данных таймера режима (тогда его τ другим режимам передаётся как ошибка). */
const TIMER_KEYS = ['kv_timer', 'kv_nx_t', 'kv_nx_n', 'kv_nx_M1', 'kv_nx_Mn'];
const bad = (r, keys) => keys.some((k) => r.flags[k] === 'error');

/**
 * Данные ошибки таймера режима: 'own' — свои (облучения, n облучений или известное τ), 'none' — не введены
 * (облучения с разным заданием или n облучений без показаний: τ можно взять из другого режима), 'off' — выбрано
 * «не учитывать», 'window' — заряд накоплен при включённой трубке (τ в итог не входит).
 */
export function kvTimerState(form) {
  const f = normalizeKv(form);
  if (f.kv_timer_mode === 'window') return 'window';
  if (f.kv_timer_mode === 'none') return 'off';
  if (f.kv_timer_mode === 'measured' && [...f.kv_tt, ...f.kv_tm].every(isBlank)) return 'none';
  if (f.kv_timer_mode === 'nexp' && !hasSeries(f.kv_nx_M1) && !hasSeries(f.kv_nx_Mn)) return 'none';
  return 'own';
}

/**
 * Расчёт всех строк режима. Возвращает { results, polSrc, ksSrc, stdRow, nonRef, ksOn, kpolFix, ksFix, timer }:
 * results[i] — результат computeKv строки i, polSrc / ksSrc — номер строки (с 0), из которой берётся k_pol / k_s для
 * строк без своих серий (−1 — нет такой), stdRow — стандартный тубус (−1 — нет), nonRef[i] — строка i отличается от
 * стандартных условий только полем при стандартном тубусе в таблице: измерение в нестандартных условиях (разд. 9.5);
 * kpolFix / ksFix — k_pol и k_s режима из его серий (NaN — серии нет или в ней ошибка), timer — { state, unit, tau }:
 * данные ошибки таймера режима (kvTimerState) и его τ (NaN — не вычислена).
 * ext — значения из другого режима той же камеры (computeKvVisit), если в этом режиме своих серий нет:
 * ext.pol / ext.ks = { from, fix } — k_pol / k_s, ext.tau = { from, fix } — τ в единицах задания этого режима.
 */
export function computeKvSession(sess, ext = {}) {
  const rows = sess.rows;
  const forms = rows.map((_, i) => kvRowForm(sess, i));
  const f0 = normalizeKv(forms[0] ?? sess.shared);
  const polSrc = rows.findIndex((r) => hasSeries(r.kv_Mopp));
  const ksOn = f0.kv_ks_on;
  const ksSrc = ksOn ? rows.findIndex((r) => hasSeries(r.kv_M2)) : -1;
  const state = kvTimerState(f0);
  const tauExt = ext.tau && state === 'none' ? { kv_tau_from: ext.tau.from, kv_tau_fix: ext.tau.fix } : {};
  // строки-источники считаются первыми: их k_pol и k_s нужны остальным строкам
  const first = new Map();
  const calc = (i) => {
    if (!first.has(i)) first.set(i, computeKv({ ...forms[i], ...tauExt }));
    return first.get(i);
  };
  // значение источника — только если его серия без ошибок (k_s < 1 и k_s > 1,05 — ошибки, их не передаём)
  const kpolFix = polSrc >= 0 && !bad(calc(polSrc), ['kv_Mopp', 'kv_M1', 'kpol']) ? calc(polSrc).trs.kpolRaw : NaN;
  const ksFix = ksSrc >= 0 && !bad(calc(ksSrc), ['kv_M2', 'kv_M1', 'kv_V1', 'kv_V2', 'ks']) ? calc(ksSrc).trs.ksRaw : NaN;
  const polExt = polSrc < 0 && ext.pol ? { kv_pol_from: ext.pol.from, kv_kpol_fix: ext.pol.fix, kv_pol_mode: true } : null;
  const ksExt = ksSrc < 0 && ksOn && ext.ks ? { kv_ks_from: ext.ks.from, kv_ks_fix: ext.ks.fix, kv_ks_mode: true } : null;
  const results = rows.map((row, i) => {
    const extra = {};
    if (polSrc >= 0 && polSrc !== i && !hasSeries(row.kv_Mopp)) Object.assign(extra, { kv_pol_from: fromText(rows, polSrc), kv_kpol_fix: kpolFix });
    else if (polExt) Object.assign(extra, polExt);
    if (ksSrc >= 0 && ksSrc !== i && !hasSeries(row.kv_M2)) Object.assign(extra, { kv_ks_from: fromText(rows, ksSrc), kv_ks_fix: ksFix });
    else if (ksExt) Object.assign(extra, ksExt);
    if (!Object.keys(extra).length) return calc(i);
    return computeKv({ ...forms[i], ...tauExt, ...extra });
  });
  const stdRow = standardRow(rows, results);
  const nonRef = results.map((r, i) => {
    if (stdRow < 0 || i === stdRow || kvRowEmpty(rows[i])) return false;
    const notmet = (r.compliance?.conditions ?? []).filter((c) => c.state === 'notmet');
    return notmet.length > 0 && notmet.every((c) => FIELD_CONDS.includes(c.id));
  });
  let tau = NaN;
  if (state === 'own') tau = f0.kv_timer_mode === 'manual' ? parseNumber(f0.kv_tau) : bad(results[0], TIMER_KEYS) ? NaN : results[0].timer.tau;
  return { results, polSrc, ksSrc, stdRow, nonRef, ksOn, kpolFix, ksFix, timer: { state, unit: f0.kv_set_unit, tau } };
}

// ------------------------------------------------------------ несколько режимов аппарата и камер
// Одно измерение на аппарате — несколько режимов (напряжение, фильтр, СПО) со своими таблицами аппликаторов и одна-две
// камеры с сертификатами. Поля формы делятся на четыре группы: общие для всех режимов (KV_COMMON_KEYS), камеры
// (KV_CHAMBER_KEYS: камера, сертификат, электрометр, напряжения и полярность), строки (KV_ROW_KEYS) и режима — все
// остальные (пучок, фантом, задание и ошибка таймера, k_g). Режим выбирает одну из введённых камер; k_Q камеры
// берётся по СПО режима.
// Режим без своих серий при обратной полярности (при V₂) берёт k_pol (k_s) из ближайшего по СПО режима с той же
// камерой, где серия есть; режим без своих данных ошибки таймера — τ из ближайшего по напряжению режима, где она
// измерена (таймер — свойство аппарата, камера значения не имеет).

/** Поля, общие для всех режимов. */
export const KV_COMMON_KEYS = ['kv_institution', 'kv_machine', 'kv_date', 'kv_staff', 'kv_notes', 'kv_env_P_unit', 'kv_tol'];
/** Поля камеры: камера, сертификат и условия калибровки, электрометр, напряжения и полярность. */
export const KV_CHAMBER_KEYS = [
  'kv_ch_model', 'kv_cc_maker', 'kv_cc_model', 'kv_cc_type', 'kv_ch_serial', 'kv_foil',
  'kv_cal', 'kv_qo', 'kv_cert_form', 'kv_n', 'kv_n_unit', 'kv_cq_kv', 'kv_cq_hvl', 'kv_cq_val',
  'kv_lab_shape', 'kv_lab_f', 'kv_lab_ssd', 'kv_lab_phantom', 'kv_T0', 'kv_P0',
  'kv_el_model', 'kv_el_serial', 'kv_kelec', 'kv_lab_pol_applied', 'kv_lab_kpol', 'kv_lab_ks_applied', 'kv_lab_ks',
  'kv_tg61_sleeve', 'kv_tg61_sleeve_t',
  'kv_V1', 'kv_V2', 'kv_polarity', 'kv_ks_on', 'kv_rec_trs', 'kv_kleak',
];
const COMMON_SET = new Set(KV_COMMON_KEYS);
const CHAMBER_SET = new Set(KV_CHAMBER_KEYS);
/** Поля режима: всё, что не строка, не камера и не общее. */
export const KV_MODE_KEYS = Object.keys(KV_DEFAULTS).filter((k) => !ROW_SET.has(k) && !COMMON_SET.has(k) && !CHAMBER_SET.has(k));
/** Поля, которые новый режим не копирует из текущего: пучок и данные ошибки таймера у него свои. */
const MODE_OWN_KEYS = ['kv_kv', 'kv_filter', 'kv_hvl', 'kv_tau', 'kv_tt', 'kv_tm', 'kv_nx_t', 'kv_nx_M1', 'kv_nx_Mn'];
/** Поля камеры, которые новая камера копирует из текущей: электрометр, условия сертификата и измерения заряда. */
const CHAMBER_KEEP_KEYS = ['kv_el_model', 'kv_el_serial', 'kv_kelec', 'kv_T0', 'kv_P0', 'kv_V1', 'kv_V2', 'kv_polarity', 'kv_ks_on', 'kv_rec_trs', 'kv_kleak'];

/** Плоская форма → общие поля, поля камеры, режима и строки. */
export function splitKvVisitForm(form) {
  const { shared, row } = splitKvForm(form);
  return { common: pick(shared, KV_COMMON_KEYS), chamber: pick(shared, KV_CHAMBER_KEYS), mode: pick(shared, KV_MODE_KEYS), row };
}

/** Режим m как данные таблицы аппликаторов: { shared, rows, active } (shared — общие поля, камера режима и режим). */
export function modeSession(visit, m) {
  const mode = visit.modes[m];
  return { shared: { ...visit.common, ...visit.chambers[mode.chamber], ...mode.shared }, rows: mode.rows, active: mode.active };
}

/** Плоская форма строки i режима m. */
export const kvVisitRowForm = (visit, m, i) => kvRowForm(modeSession(visit, m), i);

const clampIndex = (v, n) => {
  const a = Number(v);
  return Number.isInteger(a) && a >= 0 && a < n ? a : 0;
};

/**
 * Данные вкладки: { common, chambers, modes, mode }; modes[m] = { shared, chamber, rows, active } — поля режима, номер
 * камеры, строки аппликаторов и выбранная строка; mode — выбранный режим. Принимает файл и черновик формата 3
 * ({ common, chambers, modes, mode } и, в файле, form — плоская форма выбранной строки выбранного режима), формата 2
 * ({ form, rows, active } — один режим) и плоскую форму одного расчёта (до 0.36.0 — один режим с одной строкой).
 */
export function normalizeKvVisit(input) {
  const src = input && typeof input === 'object' ? input : {};
  if (!Array.isArray(src.modes) || !src.modes.length) {
    const s = normalizeKvSession(src);
    return {
      common: pick(s.shared, KV_COMMON_KEYS),
      chambers: [pick(s.shared, KV_CHAMBER_KEYS)],
      modes: [{ shared: pick(s.shared, KV_MODE_KEYS), chamber: 0, rows: s.rows, active: s.active }],
      mode: 0,
    };
  }
  const obj = (v) => (v && typeof v === 'object' ? v : {});
  const common = splitKvVisitForm(obj(src.common)).common;
  const chambers = (Array.isArray(src.chambers) && src.chambers.length ? src.chambers : [{}]).map((c) => splitKvVisitForm(obj(c)).chamber);
  const modes = src.modes.map((m0) => {
    const m = obj(m0);
    const shared = splitKvVisitForm(obj(m.shared)).mode;
    const rows = Array.isArray(m.rows) && m.rows.length ? m.rows.map((r) => splitKvForm(obj(r)).row) : [emptyKvRow()];
    return { shared, chamber: clampIndex(m.chamber, chambers.length), rows, active: clampIndex(m.active, rows.length) };
  });
  const visit = { common, chambers, modes, mode: clampIndex(src.mode, modes.length) };
  // плоская форма — выбранная строка выбранного режима: она точнее, если части и форма разошлись
  if (src.form && typeof src.form === 'object') {
    const p = splitKvVisitForm(src.form);
    const cur = visit.modes[visit.mode];
    visit.common = p.common;
    visit.chambers[cur.chamber] = p.chamber;
    cur.shared = p.mode;
    cur.rows[cur.active] = p.row;
  }
  return visit;
}

/** Новый режим по образцу режима from: те же камера, фантом, единица задания и тубусы (без показаний), пучок пустой. */
export function newKvMode(from) {
  const shared = pick(splitKvVisitForm({}).mode, KV_MODE_KEYS);
  if (from) for (const k of KV_MODE_KEYS) if (!MODE_OWN_KEYS.includes(k)) shared[k] = copy(from.shared[k]);
  // известное τ у образца — значение его режима: новый режим без своих данных берёт τ из ближайшего (computeKvVisit)
  if (shared.kv_timer_mode === 'manual') shared.kv_timer_mode = 'measured';
  const rows = from ? from.rows.map((r) => ({ ...emptyKvRow(r), kv_cone: r.kv_cone, kv_cone_b: r.kv_cone_b, kv_cone_largest: r.kv_cone_largest })) : [emptyKvRow()];
  return { shared, chamber: from ? from.chamber : 0, rows, active: 0 };
}

/** Новая камера: поля камеры пустые, электрометр, T₀, P₀ и напряжения — как у камеры from. */
export function newKvChamber(from) {
  const c = splitKvVisitForm({}).chamber;
  if (from) for (const k of CHAMBER_KEEP_KEYS) c[k] = copy(from[k]);
  return c;
}

/** Режим коротко: «120 кВ, СПО 0,26 мм Cu»; пусто, если ни напряжение, ни СПО не введены. */
export function kvModeLabel(shared) {
  const kv = String(shared?.kv_kv ?? '').trim();
  const hvl = String(shared?.kv_hvl ?? '').trim();
  const mat = shared?.kv_range === 'medium' ? 'Cu' : 'Al';
  const parts = [kv ? L(`${kv} кВ`, `${kv} kV`) : '', hvl ? L(`СПО ${hvl} мм ${mat}`, `HVL ${hvl} mm ${mat}`) : ''].filter(Boolean);
  return parts.join(', ');
}

/** «режима 2 (120 кВ, СПО 0,26 мм Cu)» — откуда взят k_pol, k_s или τ (продолжает фразу «взят из …»). */
export function kvModeFrom(visit, j) {
  const lab = kvModeLabel(visit.modes[j]?.shared);
  return L(`режима ${j + 1}${lab ? ` (${lab})` : ''}`, `mode ${j + 1}${lab ? ` (${lab})` : ''}`);
}

const num = (v) => parseNumber(v);
const lnDist = (a, b) => (a > 0 && b > 0 ? Math.abs(Math.log(a / b)) : NaN);
/** Близость режимов по качеству пучка: в одном диапазоне — по ln(СПО), иначе по ln(кВ) со штрафом. */
function hvlDistance(a, b) {
  if (a.range === b.range) {
    const d = lnDist(a.hvl, b.hvl);
    if (Number.isFinite(d)) return d;
  }
  const k = lnDist(a.kv, b.kv);
  return Number.isFinite(k) ? (a.range === b.range ? 5 : 10) + k : 1000;
}
/** Близость режимов по напряжению на трубке (для τ); без напряжения — по СПО в одном диапазоне. */
function kvDistance(a, b) {
  const k = lnDist(a.kv, b.kv);
  if (Number.isFinite(k)) return k;
  const d = a.range === b.range ? lnDist(a.hvl, b.hvl) : NaN;
  return Number.isFinite(d) ? 5 + d : 1000;
}
/** τ в единицах задания to: минуты и секунды пересчитываются, Гр и МЕ — только в те же единицы (иначе NaN). */
function convertTau(tau, from, to) {
  if (from === to) return tau;
  if (KV_SET_UNITS[from]?.time && KV_SET_UNITS[to]?.time) return from === 'min' ? tau * 60 : tau / 60;
  return NaN;
}

// пересчёт режима по ключу «язык | данные режима | значения из других режимов»: при вводе меняется один режим
const memo = new Map();
function computeMemo(sess, ext) {
  const key = `${getLang()}|${JSON.stringify(sess)}|${JSON.stringify(ext)}`;
  if (memo.has(key)) return memo.get(key);
  const r = computeKvSession(sess, ext);
  memo.set(key, r);
  if (memo.size > 64) memo.delete(memo.keys().next().value);
  return r;
}

/**
 * Расчёт всех режимов: каждый режим — computeKvSession. Возвращает { modes }: modes[m] — результат режима m и номера
 * режимов, из которых взяты k_pol, k_s и τ (polMode, ksMode, tauMode; −1 — свои или взять неоткуда).
 */
export function computeKvVisit(visit) {
  const n = visit.modes.length;
  const sess = visit.modes.map((_, m) => modeSession(visit, m));
  const own = sess.map((s) => computeMemo(s, {}));
  const info = sess.map((s, m) => {
    const f = s.shared;
    return { range: f.kv_range === 'medium' ? 'medium' : 'low', kv: num(f.kv_kv), hvl: num(f.kv_hvl), chamber: visit.modes[m].chamber };
  });
  const nearest = (m, ok, dist) => {
    let best = -1;
    let bestD = Infinity;
    for (let j = 0; j < n; j++) {
      if (j === m || !ok(j)) continue;
      const d = dist(info[m], info[j]);
      if (d < bestD) [best, bestD] = [j, d];
    }
    return best;
  };
  const modes = own.map((o, m) => {
    const sameCh = (j) => info[j].chamber === info[m].chamber;
    const polMode = o.polSrc < 0 ? nearest(m, (j) => sameCh(j) && own[j].polSrc >= 0, hvlDistance) : -1;
    const ksMode = o.ksOn && o.ksSrc < 0 ? nearest(m, (j) => sameCh(j) && own[j].ksOn && own[j].ksSrc >= 0, hvlDistance) : -1;
    const unit = o.timer.unit;
    const tauOf = (j) => convertTau(own[j].timer.tau, own[j].timer.unit, unit);
    const tauOk = (j) => own[j].timer.state === 'own' && Number.isFinite(convertTau(1, own[j].timer.unit, unit));
    const tauMode = o.timer.state === 'none' ? nearest(m, tauOk, kvDistance) : -1;
    if (polMode < 0 && ksMode < 0 && tauMode < 0) return { ...o, polMode, ksMode, tauMode };
    const ext = {};
    if (polMode >= 0) ext.pol = { from: kvModeFrom(visit, polMode), fix: own[polMode].kpolFix };
    if (ksMode >= 0) ext.ks = { from: kvModeFrom(visit, ksMode), fix: own[ksMode].ksFix };
    if (tauMode >= 0) ext.tau = { from: kvModeFrom(visit, tauMode), fix: tauOf(tauMode) };
    return { ...computeMemo(sess[m], ext), polMode, ksMode, tauMode };
  });
  return { modes };
}

/** Строка без данных (для подсказок): ни размера тубуса, ни показаний. */
export const kvRowEmpty = (row) => isBlank(row.kv_cone) && parseCells(row.kv_M1).n === 0;
