// kV-рентген: несколько аппликаторов одного режима — строки таблицы раздела «Аппликаторы».
// У строки свои аппликатор, РИП, задание, температура, давление, показания, PDD и значение для сравнения
// (KV_ROW_KEYS); всё остальное — режим, камера, сертификат, ошибка таймера — общее. Каждая строка считается обычным
// computeKv по форме «общее + строка».
// k_pol и k_s: серии при обратной полярности и при пониженном напряжении V₂ обычно снимают с одним аппликатором
// режима. Строка без своей серии берёт k_pol (k_s) из первой строки, где серия есть; строка со своей серией считает
// свой. Значения передаются в computeKv полями kv_pol_from / kv_kpol_fix и kv_ks_from / kv_ks_fix.
import { computeKv, KV_DEFAULTS, normalizeKv } from './kv.js';
import { parseCells, isBlank } from './units.js';
import { L } from './i18n.js';

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

/**
 * Расчёт всех строк. Возвращает { results, polSrc, ksSrc }: results[i] — результат computeKv строки i,
 * polSrc / ksSrc — номер строки (с 0), из которой берётся k_pol / k_s для строк без своих серий (−1 — нет такой).
 */
export function computeKvSession(sess) {
  const rows = sess.rows;
  const forms = rows.map((_, i) => kvRowForm(sess, i));
  const results = forms.map((f) => computeKv(f));
  const polSrc = rows.findIndex((r) => hasSeries(r.kv_Mopp));
  const ksOn = forms[0] ? normalizeKv(forms[0]).kv_ks_on : false;
  const ksSrc = ksOn ? rows.findIndex((r) => hasSeries(r.kv_M2)) : -1;
  // значение источника — только если его серия без ошибок (k_s < 1 и k_s > 1,05 — ошибки, их не передаём)
  const bad = (r, keys) => keys.some((k) => r.flags[k] === 'error');
  const kpolFix = polSrc >= 0 && !bad(results[polSrc], ['kv_Mopp', 'kv_M1', 'kpol']) ? results[polSrc].trs.kpolRaw : NaN;
  const ksFix = ksSrc >= 0 && !bad(results[ksSrc], ['kv_M2', 'kv_M1', 'kv_V1', 'kv_V2', 'ks']) ? results[ksSrc].trs.ksRaw : NaN;
  for (let i = 0; i < rows.length; i++) {
    const needPol = polSrc >= 0 && polSrc !== i && !hasSeries(rows[i].kv_Mopp);
    const needKs = ksSrc >= 0 && ksSrc !== i && !hasSeries(rows[i].kv_M2);
    if (!needPol && !needKs) continue;
    const extra = {};
    if (needPol) Object.assign(extra, { kv_pol_from: fromText(rows, polSrc), kv_kpol_fix: kpolFix });
    if (needKs) Object.assign(extra, { kv_ks_from: fromText(rows, ksSrc), kv_ks_fix: ksFix });
    results[i] = computeKv({ ...forms[i], ...extra });
  }
  return { results, polSrc, ksSrc };
}

/** Строка без данных (для подсказок): ни размера тубуса, ни показаний. */
export const kvRowEmpty = (row) => isBlank(row.kv_cone) && parseCells(row.kv_M1).n === 0;
