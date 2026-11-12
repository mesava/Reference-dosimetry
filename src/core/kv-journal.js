// Вкладка «kV-рентген» ↔ рентгенотерапевтический аппарат «Оборудования» (с 0.42.0).
// kvVisitFromMachine — отмеченные режимы аппарата во вкладку: пучок режима (диапазон, кВ, мА, фильтр, СПО), камера режима
// с kV-сертификатом из её записи, электрометр, строки — отмеченные у режима аппликаторы (показания пустые).
// kvMachineFromVisit — обратно, кнопкой «Сохранить аппарат в Оборудование»: режимы, аппликаторы, камеры с kV-сертификатом
// и электрометры вкладки — в журнал. Ничего не удаляет: аппликаторы режима только добавляются, СПО «Оборудования»
// заменяется значением вкладки, только если пользователь согласился. Расчёта здесь нет.
// С 0.43.0: СПО, измеренный на листе «СПО и k_Q» и взятый в расчёт режима, записывается в режим как измеренный (с датой
// измерения) — вместо номинального только с согласия пользователя; набор пластин для СПО хранится с аппаратом.
// С 0.50.0 «Оборудование» — источник постоянных данных: kV-сертификат вводится в карточке камеры, камера режима — в
// таблице «Камеры режимов», электрометр — «Электрометр при калибровке» камеры. Режимы вкладки, подставленные из
// «Оборудования», при сохранении возвращают туда только измеренное (СПО и набор пластин); вкладка без связи с аппаратом
// по-прежнему заводит или дополняет аппарат целиком.
import { KV_CHAMBER_KEYS, newKvMode, newKvChamber, emptyKvRow, computeKvVisit } from './kv-session.js';
import { normalizeKvMachine, newKvApplicator, newKvMachineMode, kvRefCandidates, journalModelOfKv, kvModelOfJournal } from './kv-machine.js';
import { uid, CHAMBER_DEFAULTS, ELECTROMETER_DEFAULTS, MACHINE_DEFAULTS, orgText, chamberText, electrometerText, chamberUse, localToday } from './journal.js';
import { findEChamber } from './electron-chambers.js';
import { parseNumber, isBlank, dec } from './units.js';
import { hvlText } from './kv-hvl.js';
import { certOn, certMetaOf, isIsoDate, certFilled, archiveCert } from './chamber-certs.js';
import { L } from './i18n.js';

const str = (v) => (v === undefined || v === null ? '' : String(v));
const copy = (v) => (Array.isArray(v) ? [...v] : v);
const norm = (v) => str(v).trim().toLowerCase().replace(/\s+/g, ' ');
const num = (v) => parseNumber(v);
const sameNum = (a, b) => {
  const x = num(a);
  const y = num(b);
  return Number.isFinite(x) && Number.isFinite(y) ? Math.abs(x - y) < 1e-9 : norm(a) === norm(b);
};

/** Поля записи камеры, относящиеся к модели, номеру и электрометру: у записи журнала они свои. */
const CHAMBER_ID_KEYS = ['kv_ch_model', 'kv_cc_maker', 'kv_cc_model', 'kv_cc_type', 'kv_ch_serial', 'kv_el_model', 'kv_el_serial', 'kv_kelec'];
/**
 * Сведения о свидетельстве kV-сертификата во вкладке (с 0.53.0): №, дата, лаборатория и откуда сертификат. В записи
 * камеры они хранятся отдельно (chamber.kvCal: calCert, calDate, calLab), не в chamber.kv.
 */
export const KV_CERT_META_KEYS = ['kv_cert_no', 'kv_cert_date', 'kv_cert_lab', 'kv_cert_src'];
/**
 * kV-сертификат и условия измерения камеры: тип калибровки, таблица качеств, условия лаборатории, T₀, P₀, поправки
 * лаборатории, напряжения и полярность. Хранятся в записи камеры журнала отдельно от её N_D,w в ⁶⁰Co (chamber.kv).
 */
export const KV_CERT_KEYS = KV_CHAMBER_KEYS.filter((k) => !CHAMBER_ID_KEYS.includes(k) && !KV_CERT_META_KEYS.includes(k));

/**
 * Поля kV-сертификата, которые вводятся в карточке камеры «Оборудования» (с 0.50.0): вид коэффициента, Q_o и глубина,
 * форма записи, N, таблица качеств и пересчёт СПО по DIN, условия лаборатории, фольга, T₀ и P₀, поправки лаборатории.
 * Остальные поля KV_CERT_KEYS (напряжения, полярность, рекомбинация, утечка, гильза TG-61) — условия измерения: их
 * задают во вкладке.
 */
export const KV_CERT_FORM_KEYS = [
  'kv_cal', 'kv_qo', 'kv_cal_depth', 'kv_cert_form', 'kv_n', 'kv_n_unit', 'kv_cq_kv', 'kv_cq_hvl', 'kv_cq_mat', 'kv_cq_val', 'kv_cq_din',
  'kv_lab_shape', 'kv_lab_f', 'kv_lab_ssd', 'kv_lab_phantom', 'kv_foil', 'kv_T0', 'kv_P0', 'kv_lab_pol_applied', 'kv_lab_kpol', 'kv_lab_ks_applied', 'kv_lab_ks',
];

/** Есть ли в kV-сертификате записи камеры калибровочный коэффициент или таблица качеств. */
export const hasKvCert = (kv) => !!kv && (!isBlank(kv.kv_n) || (Array.isArray(kv.kv_cq_val) && kv.kv_cq_val.some((v) => !isBlank(v))));

/**
 * Электрометр режима аппарата: «Электрометр при калибровке» камеры режима (src 'cal'), иначе электрометр, которым режим
 * мерили во вкладке последний раз (до 0.50.0 — выбранный у режима; src 'last'); { el: null, src: '' } — нет ни того,
 * ни другого (электрометр вводится во вкладке).
 */
export function kvModeElectrometer(j, x, date = '') {
  const ch = j.chambers.find((c) => c.id === x?.chamberId);
  // электрометр при калибровке — kV-сертификата (с 0.53.0 — свой, kvCal), действовавшего на дату измерения date
  const calEl = ch ? certOn(ch, 'kv', date).meta.calEl : '';
  const cal = calEl ? j.electrometers.find((e) => e.id === calEl) : null;
  if (cal) return { el: cal, src: 'cal' };
  const last = x?.electrometerId ? j.electrometers.find((e) => e.id === x.electrometerId) : null;
  return last ? { el: last, src: 'last' } : { el: null, src: '' };
}

/** Аппарат текстом для поля «Аппарат» вкладки: «Xstrahl 300, № 123». */
export const kvMachineText = (m) => [str(m?.name).trim(), isBlank(m?.serial) ? '' : `№ ${str(m.serial).trim()}`].filter(Boolean).join(', ');

/**
 * Камера вкладки из записи камеры и электрометра журнала; base — камера вкладки, откуда берутся поля, которых в записи
 * нет; date — дата измерения (ISO): kV-сертификат — действовавший на эту дату (с 0.53.0, certOn: при дате раньше
 * действующего — из истории камеры).
 */
export function kvChamberFromRecord(ch, el, base = null, date = '') {
  const out = newKvChamber(base);
  if (ch) {
    const f = ch.form || {};
    const on = certOn(ch, 'kv', date);
    const kv = on.data || {};
    const id = kvModelOfJournal(f.ch_model);
    if (id) out.kv_ch_model = id;
    else if (!isBlank(f.ch_model)) {
      // камеры нет в списке вкладки kV: своя камера с названием записи (свою из вкладки — с её полями)
      out.kv_ch_model = 'CUSTOM';
      const own = !isBlank(kv.kv_cc_model) || !isBlank(kv.kv_cc_maker);
      out.kv_cc_maker = own ? str(kv.kv_cc_maker) : '';
      out.kv_cc_model = own ? str(kv.kv_cc_model) : chamberText({ form: { ...f, ch_serial: '' } });
      out.kv_cc_type = own ? (kv.kv_cc_type === 'cyl' ? 'cyl' : 'pp') : f.ch_model === 'OTHER' ? (f.e_other_type === 'cyl' ? 'cyl' : 'pp') : findEChamber(f.ch_model)?.type === 'pp' ? 'pp' : 'cyl';
    }
    out.kv_ch_serial = str(f.ch_serial);
    for (const k of KV_CERT_KEYS) if (k in kv) out[k] = copy(kv[k]);
    // своя камера: название и тип — из действующей записи (в сертификате из истории их может не быть)
    if (out.kv_ch_model === 'CUSTOM' && !isBlank(ch.kv?.kv_cc_model)) Object.assign(out, { kv_cc_maker: str(ch.kv.kv_cc_maker), kv_cc_model: str(ch.kv.kv_cc_model), kv_cc_type: ch.kv.kv_cc_type === 'cyl' ? 'cyl' : 'pp' });
    Object.assign(out, { kv_cert_no: str(on.meta.calCert).trim(), kv_cert_date: str(on.meta.calDate).trim(), kv_cert_lab: str(on.meta.calLab).trim(), kv_cert_src: on.src !== 'current' ? on.src : isIsoDate(date) && isIsoDate(on.meta.calDate) && date < on.meta.calDate ? 'newer' : '' });
  }
  if (el) {
    out.kv_el_model = str(el.form?.el_model);
    out.kv_el_serial = str(el.form?.el_serial);
    out.kv_kelec = isBlank(el.form?.el_kelec) ? '1,000' : str(el.form.el_kelec);
  }
  return out;
}

/**
 * Вкладка с отмеченными режимами аппарата machine журнала j. visit — текущие данные вкладки: из её выбранного режима
 * берутся фантом, единица задания и способ ошибки таймера, из строки — задание, из камеры — поля, которых нет в записи;
 * дата, сотрудники и примечания сохраняются. Электрометр режима — kvModeElectrometer. Режимы с одной камерой и одним
 * электрометром делят камеру вкладки.
 * Строки режима — отмеченные аппликаторы (выбрана строка референсного); у самого большого тубуса (табл. 31, когда
 * 10 × 10 см нет) — отметка «самый большой тубус аппарата». Возвращает { visit, noCert } — noCert: камеры без kV-сертификата.
 */
export function kvVisitFromMachine(j, machine, modeIds, visit) {
  const picked = machine.modes.filter((x) => modeIds.includes(x.id));
  if (!picked.length) return null;
  const tpl = visit.modes[visit.mode] ?? visit.modes[0];
  const tplRow = tpl.rows[tpl.active] ?? tpl.rows[0];
  const base = visit.chambers[tpl.chamber] ?? visit.chambers[0];
  const chambers = [];
  const index = new Map();
  const noCert = [];
  const date = str(visit.common?.kv_date).trim();
  const modes = picked.map((x) => {
    const el = kvModeElectrometer(j, x, date).el;
    const key = `${x.chamberId}|${el?.id ?? ''}`;
    if (!index.has(key)) {
      const ch = j.chambers.find((c) => c.id === x.chamberId) ?? null;
      index.set(key, chambers.length);
      chambers.push(kvChamberFromRecord(ch, el, base, date));
      if (ch && !hasKvCert(certOn(ch, 'kv', date).data)) noCert.push(chamberText(ch));
    }
    const md = newKvMode(tpl);
    Object.assign(md.shared, { kv_jmode: x.id, kv_range: x.range === 'medium' ? 'medium' : 'low', kv_kv: str(x.kv), kv_ma: str(x.ma), kv_filter: str(x.filter), kv_hvl: str(x.hvl) });
    md.chamber = index.get(key);
    const c = kvRefCandidates(machine, x);
    const apps = machine.applicators.filter((a) => x.applicators.includes(a.id));
    md.rows = apps.length
      ? apps.map((a) => ({ ...emptyKvRow(), kv_set: copy(tplRow?.kv_set ?? ''), kv_cone_shape: a.shape, kv_cone: str(a.a), kv_cone_b: a.shape === 'rect' ? str(a.b) : '', kv_ssd: str(a.ssd), kv_cone_largest: c.how === 'largest' && c.ids.includes(a.id) }))
      : [emptyKvRow()];
    md.active = Math.max(0, apps.findIndex((a) => a.id === x.refApplicator));
    return md;
  });
  const common = { ...visit.common, kv_jmachine: machine.id, kv_machine: kvMachineText(machine) };
  if (!isBlank(orgText(j))) common.kv_institution = orgText(j);
  // набор пластин аппарата — на лист «СПО и k_Q» (у аппарата без набора остаётся набор вкладки)
  if (machine.plates?.length) {
    common.kv_pl_name = machine.plates.map((p) => p.name);
    common.kv_pl_mat = machine.plates.map((p) => p.mat);
    common.kv_pl_nom = machine.plates.map((p) => p.nom);
    common.kv_pl_t = machine.plates.map((p) => p.t);
    common.kv_pl_u = machine.plates.map((p) => p.u);
  }
  return { visit: { common, chambers, modes, mode: 0 }, noCert: [...new Set(noCert)] };
}

/**
 * Режимы вкладки, подставленные из аппарата machine, — по нынешнему «Оборудованию» (с 0.50.0): пучок (диапазон, кВ, мА,
 * фильтр, номинальный СПО) и камера режима с kV-сертификатом; электрометр, напряжения и полярность камеры вкладки,
 * строки аппликаторов, задания и показания остаются. Режимы с одной камерой вкладки, у которых в «Оборудовании» теперь
 * разные камеры, получают свои камеры вкладки. Возвращает { visit, changed } — changed: что-то изменилось.
 */
export function kvRefreshFromMachine(j, machine, visit) {
  const v = structuredClone(visit);
  const keep = ['kv_el_model', 'kv_el_serial', 'kv_kelec', 'kv_V1', 'kv_V2', 'kv_polarity', 'kv_ks_on', 'kv_rec_trs', 'kv_kleak', 'kv_tg61_sleeve', 'kv_tg61_sleeve_t'];
  const owner = new Map(); // камера вкладки → id камеры «Оборудования», которая в ней теперь
  const date = str(v.common?.kv_date).trim();
  v.modes.forEach((md) => {
    const x = machine.modes.find((y) => y.id === md.shared.kv_jmode);
    if (!x) return;
    Object.assign(md.shared, { kv_range: x.range === 'medium' ? 'medium' : 'low', kv_kv: str(x.kv), kv_ma: str(x.ma), kv_filter: str(x.filter), kv_hvl: str(x.hvl) });
    const ch = j.chambers.find((c) => c.id === x.chamberId);
    if (!ch) return;
    if (owner.has(md.chamber) && owner.get(md.chamber) !== ch.id) {
      v.chambers.push(structuredClone(v.chambers[md.chamber]));
      md.chamber = v.chambers.length - 1;
    }
    owner.set(md.chamber, ch.id);
    const cur = v.chambers[md.chamber];
    v.chambers[md.chamber] = { ...kvChamberFromRecord(ch, null, cur, date), ...pick(cur, keep) };
  });
  // десятичная запятая или точка (вкладка на английском показывает точку) — не изменение
  // сведения о свидетельстве у камеры вкладки, где их нет (вкладки до 0.53.0), — не изменение; где есть — изменение
  const blankMeta = visit.chambers.map((c) => ['kv_cert_no', 'kv_cert_date', 'kv_cert_lab'].every((k) => isBlank(c?.[k])));
  const strip = (c, i) => ((blankMeta[i] ?? blankMeta[0]) ? Object.fromEntries(Object.entries(c).filter(([k]) => !KV_CERT_META_KEYS.includes(k))) : c);
  const same = (o) => JSON.stringify({ ...o, chambers: o.chambers.map(strip) }, (k, x) => (typeof x === 'string' ? x.replace(/(\d),(\d)/g, '$1.$2') : x));
  return { visit: v, changed: same(v) !== same(visit) };
}

/**
 * Камеры режимов вкладки, у которых дата измерения раньше даты действующего kV-сертификата, а прежнего в истории камеры
 * нет (с 0.53.0): «Обновить из «Оборудования»» подставит им действующий сертификат. [{ chamber, cert }] — названия
 * камер и действующий сертификат текстом («№ 0174-26 от 2026-10-07»).
 */
export function kvRefreshRisk(j, machine, visit) {
  const date = str(visit?.common?.kv_date).trim();
  if (!isIsoDate(date)) return [];
  const out = new Map();
  for (const md of visit.modes ?? []) {
    const x = machine.modes.find((y) => y.id === md.shared?.kv_jmode);
    const ch = x ? j.chambers.find((c) => c.id === x.chamberId) : null;
    if (!ch || out.has(ch.id)) continue;
    const on = certOn(ch, 'kv', date);
    if (on.src === 'current' && isIsoDate(on.meta.calDate) && date < on.meta.calDate) out.set(ch.id, { chamber: chamberText(ch), no: on.meta.calCert, date: on.meta.calDate });
  }
  return [...out.values()];
}

/** Тот же аппликатор: форма, размер и РИП (числа — по значению). a — аппликатор аппарата, r — строка вкладки. */
export const kvSameApp = (a, r) =>
  a.shape === (r.kv_cone_shape || 'circle') && sameNum(a.a, r.kv_cone) && (a.shape !== 'rect' || sameNum(a.b, r.kv_cone_b)) && (isBlank(a.ssd) && isBlank(r.kv_ssd) ? true : sameNum(a.ssd, r.kv_ssd));
/** Режим «Оборудования», совпадающий с режимом вкладки по диапазону, напряжению, фильтру и току (если он есть у обоих). */
export const kvSameMode = (y, s) =>
  y.range === (s.kv_range === 'medium' ? 'medium' : 'low') && sameNum(y.kv, s.kv_kv) && norm(y.filter) === norm(s.kv_filter) && (isBlank(y.ma) || isBlank(s.kv_ma) || sameNum(y.ma, s.kv_ma));

/** Набор пластин вкладки (непустые строки) в виде пластин аппарата. */
function visitPlates(common) {
  const n = Math.max(0, ...['kv_pl_name', 'kv_pl_mat', 'kv_pl_nom', 'kv_pl_t', 'kv_pl_u'].map((k) => (Array.isArray(common[k]) ? common[k].length : 0)));
  const at = (k, i) => str(Array.isArray(common[k]) ? common[k][i] : '').trim();
  return Array.from({ length: n }, (_, i) => ({ name: at('kv_pl_name', i), mat: at('kv_pl_mat', i) === 'Cu' ? 'Cu' : 'Al', nom: at('kv_pl_nom', i), t: at('kv_pl_t', i), u: at('kv_pl_u', i) }))
    .filter((x) => [x.name, x.nom, x.t, x.u].some((v) => v !== ''));
}

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, copy(o[k])]));
const sameKv = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Модель камеры вкладки в журнале: { custom, model, name } (своя камера — «другая» с названием). */
function chamberModel(vc) {
  const id = str(vc.kv_ch_model);
  const custom = id === 'CUSTOM' || id.startsWith('MY:');
  return { custom, model: custom ? 'OTHER' : journalModelOfKv(id), name: custom ? [vc.kv_cc_maker, vc.kv_cc_model].map((s) => str(s).trim()).filter(Boolean).join(' ') : '' };
}

/** Запись камеры журнала для камеры вкладки — по модели и № (своя камера — по названию); null — такой нет. */
export function kvFindChamber(j, vc) {
  if (!str(vc?.kv_ch_model)) return null;
  const { custom, model, name } = chamberModel(vc);
  // своя камера вкладки — «другая» камера журнала с тем же названием или камера журнала не из списка вкладки
  // (подставленная своей с названием записи, kvChamberFromRecord): по названию без номера
  const sameCustom = (c) =>
    c.form?.ch_model === 'OTHER' ? norm(c.form?.e_other_name) === norm(name) : !kvModelOfJournal(c.form?.ch_model) && norm(chamberText({ form: { ...c.form, ch_serial: '' } })) === norm(name);
  return j.chambers.find((c) => norm(c.form?.ch_serial) === norm(vc.kv_ch_serial) && (custom ? !isBlank(c.form?.ch_model) && sameCustom(c) : c.form?.ch_model === model)) ?? null;
}

/** Запись электрометра журнала для камеры вкладки — по модели и №; null — такой нет. */
export function kvFindElectrometer(j, vc) {
  const model = str(vc?.kv_el_model).trim();
  if (!model) return null;
  return j.electrometers.find((e) => norm(e.form?.el_model) === norm(model) && norm(e.form?.el_serial) === norm(vc.kv_el_serial)) ?? null;
}

/** Камера вкладки → запись камеры журнала (найти по модели и №, иначе добавить); kV-сертификат — в запись. */
function upsertChamber(j, vc, rep) {
  const id = str(vc.kv_ch_model);
  if (!id) return '';
  const { custom, model, name } = chamberModel(vc);
  const kv = pick(vc, KV_CERT_KEYS);
  if (custom) Object.assign(kv, { kv_cc_maker: str(vc.kv_cc_maker), kv_cc_model: str(vc.kv_cc_model), kv_cc_type: vc.kv_cc_type === 'cyl' ? 'cyl' : 'pp' });
  // сведения о свидетельстве вкладки (с 0.53.0) — для записи камеры, которой ещё нет
  const meta = certMetaOf({ calCert: str(vc.kv_cert_no).trim(), calDate: isIsoDate(str(vc.kv_cert_date).trim()) ? str(vc.kv_cert_date).trim() : '', calLab: str(vc.kv_cert_lab).trim() });
  let ch = kvFindChamber(j, vc);
  if (!ch) {
    // камера, добавленная из вкладки kV, отмечена только для kV-рентгена
    ch = {
      ...CHAMBER_DEFAULTS,
      id: uid('ch'),
      form: { ch_model: model, ch_serial: str(vc.kv_ch_serial), ch_ndw: '', ch_ndw_unit: 'Gy/nC', ch_klab: '1,000', ch_T0: '20', ch_P0: '101,325', ...(custom ? { e_other_name: name, e_other_type: vc.kv_cc_type === 'cyl' ? 'cyl' : 'pp' } : {}) },
      kv,
      kvCal: meta,
      certHistory: [],
      use: { photon: false, electron: false, kv: true },
    };
    j.chambers.push(ch);
    rep.chambersAdded.push(chamberText(ch));
  } else {
    if (!chamberUse(ch, j).kv) ch.use = { ...chamberUse(ch, j), kv: true };
    // сертификат вкладки старше действующего в «Оборудовании» (или без даты, когда у действующего она есть): действующий
    // им не перезаписывается — новый сертификат вводится в карточке камеры (с 0.53.0)
    const curDate = str(ch.kvCal?.calDate).trim();
    const tabDate = meta.calDate;
    const older = hasKvCert(ch.kv) && isIsoDate(curDate) && (!tabDate || tabDate < curDate);
    if (older) {
      if (!sameKv(ch.kv, kv)) rep.certOlder.push(chamberText(ch));
    } else if (!sameKv(ch.kv, kv)) {
      // у вкладки другое свидетельство (новее действующего): действующее — в историю камеры, сведения — из вкладки
      const cur = certMetaOf(ch.kvCal);
      const other = (meta.calCert || meta.calDate) && (meta.calCert !== cur.calCert || meta.calDate !== cur.calDate);
      if (other && certFilled(ch, 'kv')) {
        const elId = cur.calEl;
        Object.assign(ch, archiveCert(ch, 'kv', { id: uid('cert'), today: localToday(), elText: elId ? electrometerText(j.electrometers.find((e) => e.id === elId)) : '' }));
        ch.kvCal = { ...certMetaOf({}), calCert: meta.calCert, calDate: meta.calDate, calLab: meta.calLab };
        rep.certArchived.push(chamberText(ch));
      } else if (meta.calCert || meta.calDate || meta.calLab) ch.kvCal = { ...cur, calCert: meta.calCert, calDate: meta.calDate, calLab: meta.calLab };
      ch.kv = kv;
      rep.certSaved.push(chamberText(ch));
    }
  }
  return ch.id;
}

/** Электрометр камеры вкладки → запись журнала (по модели и №, иначе добавить). */
function upsertElectrometer(j, vc, rep) {
  const model = str(vc.kv_el_model).trim();
  if (!model) return '';
  let el = kvFindElectrometer(j, vc);
  if (!el) {
    el = { ...ELECTROMETER_DEFAULTS, id: uid('el'), form: { el_model: model, el_serial: str(vc.kv_el_serial), el_kelec: isBlank(vc.kv_kelec) ? '1,000' : str(vc.kv_kelec) } };
    j.electrometers.push(el);
    rep.electrometersAdded.push(electrometerText(el));
  }
  return el.id;
}

/**
 * «Сохранить аппарат в Оборудование»: журнал j0 с аппаратом вкладки (связанным — по kv_jmachine, иначе по названию,
 * иначе новым). Режим, подставленный из «Оборудования» (вкладка связана с этим аппаратом, kv_jmode — его режим),
 * возвращает только измеренное: СПО (как ниже) и электрометр, которым мерили (если он есть в «Оборудовании»; он
 * подставится, когда у камеры не указан электрометр при калибровке) — пучок, камера с kV-сертификатом и аппликаторы
 * правятся в «Оборудовании» (с 0.50.0). Другой режим вкладки находит свой режим «Оборудования» по пучку (иначе
 * добавляется): пучок — из вкладки; СПО — тоже, если в «Оборудовании» его нет или replaceHvl (иначе расхождение — в
 * report.hvl); камера и электрометр — записи журнала (найденные или добавленные, kV-сертификат — в запись камеры);
 * аппликаторы строк добавляются к аппарату и отмечаются у режима; стандартный — стандартный тубус вкладки, если он
 * определён. Возвращает { journal, machineId, modeIds (по режимам вкладки), report }.
 */
export function kvMachineFromVisit(j0, visit, { replaceHvl = false } = {}) {
  const j = structuredClone(j0);
  const rep = { machineAdded: false, modesAdded: 0, modesUpdated: 0, modesLinked: 0, appsAdded: 0, chambersAdded: [], certSaved: [], certOlder: [], certArchived: [], electrometersAdded: [], hvl: [], hvlMeasured: 0, platesSaved: 0 };
  const name = str(visit.common.kv_machine).trim();
  let m = j.machines.find((x) => x.kind === 'kv' && x.id === visit.common.kv_jmachine)
    ?? (name ? j.machines.find((x) => x.kind === 'kv' && (norm(x.name) === norm(name) || norm(kvMachineText(x)) === norm(name))) : null);
  if (!m) {
    m = normalizeKvMachine({ ...MACHINE_DEFAULTS, id: uid('m'), kind: 'kv', name });
    j.machines.push(m);
    rep.machineAdded = true;
  }
  const vr = computeKvVisit(visit);
  const date = str(visit.common.kv_date);
  /**
   * СПО режима x: измеренный на листе «СПО и k_Q» (если взят в расчёт, h — его итог) или из таблицы режимов (s.kv_hvl).
   * Пустой в «Оборудовании» — записывается; другой — только при replaceHvl (расхождение — в report.hvl); тот же
   * измеренный заново — с новой датой. onlyMeasured — режим из «Оборудования»: значение таблицы режимов не возвращается.
   */
  const saveHvl = (x, h, s, i, onlyMeasured = false) => {
    const measured = !!h?.apply;
    if (onlyMeasured && !measured) return;
    const now = measured ? dec(hvlText(h.used)) : str(s.kv_hvl);
    const setHvl = () => {
      x.hvl = now;
      if (measured) {
        x.hvlSource = 'measured';
        x.hvlDate = date;
        rep.hvlMeasured++;
      } else {
        x.hvlSource = 'nominal'; // значение таблицы режимов вкладки
        x.hvlDate = '';
      }
    };
    if (isBlank(x.hvl)) {
      if (!isBlank(now)) setHvl();
    } else if (!isBlank(now) && !sameNum(x.hvl, now)) {
      rep.hvl.push({ mode: i, was: x.hvl, now, source: x.hvlSource, sourceDate: x.hvlDate, measured, range: x.range });
      if (replaceHvl) setHvl();
    } else if (measured && (x.hvlSource !== 'measured' || x.hvlDate !== date)) setHvl(); // то же значение — измерен заново
  };
  const plates = visitPlates(visit.common);
  if (plates.length && JSON.stringify(plates) !== JSON.stringify(m.plates ?? [])) {
    m.plates = plates;
    rep.platesSaved = plates.length;
  }
  const used = new Set();
  const linkedMachine = m.id === visit.common.kv_jmachine;
  // режимы «Оборудования», на которые ссылаются режимы вкладки: другие режимы вкладки их не занимают
  const reserved = new Set(linkedMachine ? visit.modes.map((md) => md.shared.kv_jmode).filter((id) => !isBlank(id) && m.modes.some((y) => y.id === id)) : []);
  const modeIds = visit.modes.map((md, i) => {
    const s = md.shared;
    // режим из «Оборудования»: постоянное не меняется, только СПО и электрометр дня
    const lx = linkedMachine && !isBlank(s.kv_jmode) ? m.modes.find((y) => y.id === s.kv_jmode && !used.has(y.id)) : null;
    if (lx) {
      used.add(lx.id);
      rep.modesLinked++;
      saveHvl(lx, vr.modes[i]?.hvl, s, i, true);
      const el = kvFindElectrometer(j, visit.chambers[md.chamber] ?? {});
      if (el) lx.electrometerId = el.id;
      return lx.id;
    }
    const ids = [];
    for (const r of md.rows) {
      if (isBlank(r.kv_cone)) continue;
      let a = m.applicators.find((x) => kvSameApp(x, r));
      if (!a) {
        a = { ...newKvApplicator(), shape: ['square', 'rect'].includes(r.kv_cone_shape) ? r.kv_cone_shape : 'circle', a: str(r.kv_cone).trim(), b: r.kv_cone_shape === 'rect' ? str(r.kv_cone_b).trim() : '', ssd: str(r.kv_ssd).trim() };
        m.applicators.push(a);
        rep.appsAdded++;
      }
      if (!ids.includes(a.id)) ids.push(a.id);
    }
    let x = m.modes.find((y) => !used.has(y.id) && !reserved.has(y.id) && kvSameMode(y, s));
    if (x) rep.modesUpdated++;
    else {
      x = newKvMachineMode();
      m.modes.push(x);
      rep.modesAdded++;
    }
    used.add(x.id);
    Object.assign(x, { range: s.kv_range === 'medium' ? 'medium' : 'low', kv: str(s.kv_kv), ma: str(s.kv_ma), filter: str(s.kv_filter) });
    saveHvl(x, vr.modes[i]?.hvl, s, i);
    const vc = visit.chambers[md.chamber] ?? {};
    const chId = upsertChamber(j, vc, rep);
    if (chId) x.chamberId = chId;
    const elId = upsertElectrometer(j, vc, rep);
    if (elId) x.electrometerId = elId;
    // аппликаторы режима: отмеченные раньше остаются, тубусы вкладки добавляются; порядок — как у аппарата
    x.applicators = m.applicators.map((a) => a.id).filter((id) => x.applicators.includes(id) || ids.includes(id));
    const std = vr.modes[i]?.stdRow ?? -1;
    const stdApp = std >= 0 ? m.applicators.find((a) => kvSameApp(a, md.rows[std])) : null;
    if (stdApp) x.refApplicator = stdApp.id;
    else if (!x.applicators.includes(x.refApplicator)) x.refApplicator = '';
    return x.id;
  });
  return { journal: j, machineId: m.id, modeIds, report: rep };
}

/** Итог сохранения текстом для строки состояния. */
export function kvSaveText(m, rep) {
  const name = m?.name || L('без названия', 'unnamed');
  const parts = [
    rep.machineAdded ? L(`добавлен аппарат «${name}»`, `the unit “${name}” added`) : '',
    rep.modesAdded ? L(`режимов добавлено: ${rep.modesAdded}`, `modes added: ${rep.modesAdded}`) : '',
    rep.modesUpdated ? L(`режимов обновлено: ${rep.modesUpdated}`, `modes updated: ${rep.modesUpdated}`) : '',
    rep.modesLinked ? L(`у режимов из «Оборудования» (${rep.modesLinked}) пучок, камера и аппликаторы не менялись — они правятся в «Оборудовании»`, `the modes from Equipment (${rep.modesLinked}) keep their beam, chamber and applicators: these are edited in Equipment`) : '',
    rep.appsAdded ? L(`аппликаторов добавлено: ${rep.appsAdded}`, `applicators added: ${rep.appsAdded}`) : '',
    rep.chambersAdded.length ? L(`камеры добавлены: ${rep.chambersAdded.join(', ')}`, `chambers added: ${rep.chambersAdded.join(', ')}`) : '',
    rep.certSaved.length ? L(`kV-сертификат записан в камеры: ${rep.certSaved.join(', ')}`, `kV certificate saved to the chambers: ${rep.certSaved.join(', ')}`) : '',
    rep.certArchived.length ? L(`прежний kV-сертификат перенесён в историю камеры (${rep.certArchived.join(', ')})`, `the previous kV certificate moved to the chamber history (${rep.certArchived.join(', ')})`) : '',
    rep.certOlder.length ? L(`kV-сертификат вкладки старше действующего и не записан (${rep.certOlder.join(', ')}): новый сертификат вводится в карточке камеры`, `the kV certificate of the tab is older than the current one and was not saved (${rep.certOlder.join(', ')}): a new certificate is entered in the chamber card`) : '',
    rep.electrometersAdded.length ? L(`электрометры добавлены: ${rep.electrometersAdded.join(', ')}`, `electrometers added: ${rep.electrometersAdded.join(', ')}`) : '',
    rep.hvlMeasured ? L(`измеренный СПО записан в режимов: ${rep.hvlMeasured}`, `measured HVL saved to modes: ${rep.hvlMeasured}`) : '',
    rep.platesSaved ? L(`набор пластин для СПО сохранён (${rep.platesSaved})`, `the HVL plate set saved (${rep.platesSaved})`) : '',
  ].filter(Boolean);
  return L(
    `Аппарат «${name}» сохранён в «Оборудование»${parts.length ? `: ${parts.join('; ')}` : ''}. Сохраните журнал в файл.`,
    `The unit “${name}” saved to Equipment${parts.length ? `: ${parts.join('; ')}` : ''}. Save the journal to the file.`,
  );
}

/** kV-сертификат записи камеры коротко: «N_K, N по качествам — 3 точки, СПО 0,5–2,9; поле Ø 3 см, РИП 30 см». */
export function kvCertText(kv) {
  if (!hasKvCert(kv)) return '';
  const cal = kv.kv_cal === 'nk' ? L('N_K (воздушная керма)', 'N_K (air kerma)') : 'N_D,w';
  const form = { kq: L('N_Qo и k_Q по качествам', 'N_Qo and k_Q by quality'), n: L('N по качествам', 'N by quality'), k: L('N и множитель K по качествам', 'N and factor K by quality'), co: L('только N_D,w в ⁶⁰Co', 'N_D,w in ⁶⁰Co only') }[kv.kv_cert_form] ?? '';
  const hvls = (Array.isArray(kv.kv_cq_hvl) ? kv.kv_cq_hvl : []).filter((h, i) => !isBlank(h) && !isBlank(kv.kv_cq_val?.[i]));
  const nums = hvls.map(num).filter(Number.isFinite);
  const pts = hvls.length ? L(`${hvls.length} ${hvls.length === 1 ? 'точка' : hvls.length < 5 ? 'точки' : 'точек'}`, `${hvls.length} point${hvls.length === 1 ? '' : 's'}`) : '';
  const range = nums.length > 1 ? L(`СПО ${hvls[nums.indexOf(Math.min(...nums))]}–${hvls[nums.indexOf(Math.max(...nums))]} мм`, `HVL ${hvls[nums.indexOf(Math.min(...nums))]}–${hvls[nums.indexOf(Math.max(...nums))]} mm`) : '';
  const lab = !isBlank(kv.kv_lab_f) ? L(`поле лаборатории ${kv.kv_lab_shape === 'square' ? `${kv.kv_lab_f} × ${kv.kv_lab_f} см` : `Ø ${kv.kv_lab_f} см`}${isBlank(kv.kv_lab_ssd) ? '' : `, РИП ${kv.kv_lab_ssd} см`}`, `laboratory field ${kv.kv_lab_shape === 'square' ? `${kv.kv_lab_f} × ${kv.kv_lab_f} cm` : `${kv.kv_lab_f} cm diameter`}${isBlank(kv.kv_lab_ssd) ? '' : `, SSD ${kv.kv_lab_ssd} cm`}`) : '';
  return [cal, [form, pts].filter(Boolean).join(' — '), range, lab].filter(Boolean).join('; ');
}
