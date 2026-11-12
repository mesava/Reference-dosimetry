// Сертификаты камеры (с 0.53.0). У записи камеры журнала два свидетельства о калибровке, и они не смешиваются:
//   'mv' — для МВ фотонов, электронов и ⁶⁰Co (калибровка в пучке ⁶⁰Co или перекрёстная): коэффициенты и условия — в
//          полях формы камеры (MV_CERT_KEYS), сведения о свидетельстве — на самой записи (calLab … calPol), как до 0.53.0;
//   'kv' — kV-сертификат (калибровка в рентгеновских пучках): коэффициенты и условия — chamber.kv (с 0.50.0), сведения о
//          свидетельстве — chamber.kvCal (с 0.53.0; до того сведения были общими с 'mv').
// У каждого своя история (chamber.certHistory): «Новый сертификат» переносит действующий в историю. Вкладки, у которых
// дата измерения раньше даты действующего сертификата, берут сертификат, действовавший на эту дату (certOn). Записи
// журнала хранят свои значения (снимок при записи) и после замены сертификата не пересчитываются.
import { isBlank } from './units.js';
import { FORM_DEFAULTS } from './photons.js';
import { E_DEFAULTS } from './electrons.js';

/** Сведения о свидетельстве: лаборатория, №, дата калибровки, срок, электрометр, напряжение и полярность при калибровке. */
export const CERT_META_KEYS = ['calLab', 'calCert', 'calDate', 'dueDate', 'calEl', 'calV', 'calPol'];
/**
 * Поля формы камеры, относящиеся к свидетельству для МВ и ⁶⁰Co: N_D,w в ⁶⁰Co, k_лаб, T₀ и P₀ свидетельства, поправки
 * лаборатории, перекрёстные калибровки (фотоны и электроны).
 */
export const MV_CERT_KEYS = [
  'ch_ndw', 'ch_ndw_unit', 'ch_klab', 'ch_T0', 'ch_P0', 'lab_pol_applied', 'lab_kpol', 'lab_ks_applied', 'lab_ks',
  'ch_cal_route', 'ch_cross_ndw', 'ch_cross_ndw_unit', 'ch_cross_tpr',
  'e_cal_route', 'e_cross_ndw', 'e_cross_ndw_unit', 'e_cross_r50', 'e_cross_kn', 'e_cross_kn_unit',
];
/**
 * Значения по умолчанию полей MV_CERT_KEYS (как во вкладках «МВ фотоны» и «Электроны»): снимок свидетельства в истории —
 * полный, иначе в прошлую дату «протекли» бы поля действующего, которых в записи камеры не было (способ калибровки,
 * перекрёстные коэффициенты, поправки лаборатории).
 */
const MV_DEFAULTS = Object.fromEntries(MV_CERT_KEYS.map((k) => [k, structuredClone(k.startsWith('e_') ? E_DEFAULTS[k] : FORM_DEFAULTS[k]) ?? '']));
/** Коэффициенты, которые у нового свидетельства свои: при «Новый сертификат» они очищаются (остальное остаётся как образец). */
const MV_NEW_CLEAR = ['ch_ndw', 'ch_cross_ndw', 'e_cross_ndw', 'e_cross_kn', 'lab_kpol', 'lab_ks'];
/** То же у kV-сертификата: N, значения таблицы качеств, поправки лаборатории на полярность и рекомбинацию. */
const KV_NEW_CLEAR = ['kv_n', 'kv_lab_kpol', 'kv_lab_ks'];
const META_NEW_CLEAR = ['calCert', 'calDate', 'dueDate'];

const ISO = /^\d{4}-\d{2}-\d{2}$/;
export const isIsoDate = (s) => ISO.test(String(s ?? ''));
const str = (v) => (v === undefined || v === null ? '' : String(v));
const copy = (v) => (v === undefined ? undefined : structuredClone(v));
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o && k in o && o[k] !== undefined).map((k) => [k, copy(o[k])]));

/** Сведения о свидетельстве из объекта o: все поля CERT_META_KEYS строками (нет — пусто). */
export const certMetaOf = (o) => Object.fromEntries(CERT_META_KEYS.map((k) => [k, str(o?.[k])]));
/** Сведения о действующем свидетельстве камеры c вида kind ('mv' | 'kv'). */
export const certMeta = (c, kind) => certMetaOf(kind === 'kv' ? c?.kvCal : c);
/** Коэффициенты и условия действующего свидетельства: 'kv' — копия chamber.kv (или null), 'mv' — поля формы MV_CERT_KEYS. */
export const certData = (c, kind) => (kind === 'kv' ? (c?.kv && typeof c.kv === 'object' ? structuredClone(c.kv) : null) : mvFull(c?.form));
/** Поля свидетельства для МВ и ⁶⁰Co полностью: чего в форме нет — по умолчанию. */
const mvFull = (form) => ({ ...structuredClone(MV_DEFAULTS), ...pick(form, MV_CERT_KEYS) });

/** Есть ли в данных свидетельства калибровочный коэффициент. */
export function certHasData(kind, data) {
  if (!data) return false;
  if (kind === 'kv') return !isBlank(data.kv_n) || (Array.isArray(data.kv_cq_val) && data.kv_cq_val.some((v) => !isBlank(v)));
  return ['ch_ndw', 'ch_cross_ndw', 'e_cross_ndw', 'e_cross_kn'].some((k) => !isBlank(data[k]));
}
/** Действующее свидетельство вида kind что-то содержит (коэффициент, № или дату) — его есть смысл переносить в историю. */
export const certFilled = (c, kind) => {
  const m = certMeta(c, kind);
  return certHasData(kind, certData(c, kind)) || !isBlank(m.calCert) || !isBlank(m.calDate);
};

/** Запись истории в нормальном виде или null (не та запись). */
export function normalizeCertEntry(h) {
  if (!h || typeof h !== 'object' || (h.kind !== 'mv' && h.kind !== 'kv')) return null;
  const data = h.kind === 'kv' ? (h.data && typeof h.data === 'object' ? h.data : null) : mvFull(h.data);
  return { id: str(h.id), kind: h.kind, archived: str(h.archived), meta: certMetaOf(h.meta), elText: str(h.elText), data };
}
/** История вида kind: по дате калибровки (без даты — в начале), в один день — по дате переноса. */
export function certHistory(c, kind) {
  return (Array.isArray(c?.certHistory) ? c.certHistory : [])
    .map(normalizeCertEntry)
    .filter((h) => h && h.kind === kind)
    .sort((a, b) => a.meta.calDate.localeCompare(b.meta.calDate) || a.archived.localeCompare(b.archived));
}

/**
 * Свидетельство вида kind, действовавшее на дату date (ISO): { meta, data, src, id }. Действующее и записи истории —
 * одна шкала по датам калибровки: берётся последнее с датой не позже date.
 *   src 'current' — действующее (дата не задана, или оно последнее не позже date, или истории с датами нет);
 *   src 'history' — из истории (id — запись истории);
 *   src 'early' — дата раньше всех известных свидетельств: взято самое раннее (из истории).
 * Действующее без даты калибровки (например, сразу после «Новый сертификат») — самое новое: оно берётся для дат не
 * раньше последнего датированного, но пустое (без коэффициента) уступает последнему из истории.
 */
export function certOn(c, kind, date) {
  const cur = { meta: certMeta(c, kind), data: certData(c, kind), src: 'current', id: '' };
  if (!c || !isIsoDate(date)) return cur;
  const hist = certHistory(c, kind).filter((h) => isIsoDate(h.meta.calDate));
  if (!hist.length) return cur;
  const of = (h, src) => ({ meta: { ...h.meta }, data: copy(h.data) ?? null, src, id: h.id });
  const curDated = isIsoDate(cur.meta.calDate);
  // шкала: записи истории и действующее (если у него есть дата)
  const line = [...hist.map((h) => ({ date: h.meta.calDate, h })), ...(curDated ? [{ date: cur.meta.calDate, h: null }] : [])].sort((a, b) => a.date.localeCompare(b.date));
  const before = line.filter((x) => x.date <= date).at(-1);
  if (!curDated) {
    // действующее без даты — новее всех: для дат не раньше последнего из истории, если в нём уже есть коэффициент
    const last = hist.at(-1);
    if (date >= last.meta.calDate && certHasData(kind, cur.data)) return cur;
    return before ? of(before.h, 'history') : of(hist[0], 'early');
  }
  if (before) return before.h ? of(before.h, 'history') : cur;
  const first = line[0];
  return first.h ? of(first.h, 'early') : cur;
}

/**
 * «Новый сертификат»: действующее свидетельство вида kind — в историю, поля нового — по образцу прежнего без
 * коэффициентов, № и дат (лаборатория, электрометр, напряжение, полярность, T₀ и P₀, условия лаборатории, таблица
 * качеств без значений остаются). Возвращает новую запись камеры (c не меняется). id — id записи истории, today — дата
 * переноса, elText — электрометр при калибровке текстом (на случай, если его потом удалят из «Оборудования»).
 */
export function archiveCert(c, kind, { id, today = '', elText = '' } = {}) {
  const out = structuredClone(c);
  const entry = { id: str(id), kind, archived: str(today), meta: certMeta(c, kind), elText: str(elText), data: certData(c, kind) };
  out.certHistory = [...(Array.isArray(c.certHistory) ? c.certHistory : []), entry];
  if (kind === 'kv') {
    out.kvCal = certMetaOf(c.kvCal);
    for (const k of META_NEW_CLEAR) out.kvCal[k] = '';
    if (out.kv && typeof out.kv === 'object') {
      for (const k of KV_NEW_CLEAR) if (k in out.kv) out.kv[k] = '';
      if (Array.isArray(out.kv.kv_cq_val)) out.kv.kv_cq_val = out.kv.kv_cq_val.map(() => '');
    }
  } else {
    for (const k of META_NEW_CLEAR) out[k] = '';
    out.form = { ...(out.form || {}) };
    for (const k of MV_NEW_CLEAR) if (k in out.form) out.form[k] = '';
    if ('ch_klab' in out.form) out.form.ch_klab = '1,000';
  }
  return out;
}

/**
 * «Сделать действующим»: запись истории histId становится действующим свидетельством; прежнее действующее (если в нём
 * что-то есть) уходит в историю под id newId. Возвращает новую запись камеры или null (такой записи нет).
 */
export function restoreCert(c, histId, { newId, today = '', elText = '' } = {}) {
  const list = Array.isArray(c.certHistory) ? c.certHistory : [];
  const h = normalizeCertEntry(list.find((x) => x && x.id === histId));
  if (!h) return null;
  const out = structuredClone(c);
  out.certHistory = list.filter((x) => !(x && x.id === histId));
  if (certFilled(c, h.kind)) out.certHistory.push({ id: str(newId), kind: h.kind, archived: str(today), meta: certMeta(c, h.kind), elText: str(elText), data: certData(c, h.kind) });
  if (h.kind === 'kv') {
    out.kvCal = { ...h.meta };
    // у записи истории без коэффициентов действующий kV-сертификат тоже без них (а не с коэффициентами заменённого)
    if (h.data) out.kv = structuredClone(h.data);
    else delete out.kv;
  } else {
    Object.assign(out, h.meta);
    out.form = { ...(out.form || {}), ...mvFull(h.data) };
  }
  return out;
}

/** Убрать запись истории histId. Возвращает новую запись камеры. */
export const removeCert = (c, histId) => ({ ...c, certHistory: (Array.isArray(c.certHistory) ? c.certHistory : []).filter((x) => !(x && x.id === histId)) });

/** Снимок сведений о свидетельстве для записи журнала: { no, date, lab, src } (src — откуда: 'current' | 'history' | 'early'). */
export const certStamp = (on) => ({ no: str(on?.meta?.calCert).trim(), date: str(on?.meta?.calDate).trim(), lab: str(on?.meta?.calLab).trim(), src: on?.src || 'current' });
/** Снимок пуст (ни №, ни даты, ни лаборатории). */
export const stampBlank = (s) => !s || (isBlank(s.no) && isBlank(s.date) && isBlank(s.lab));
