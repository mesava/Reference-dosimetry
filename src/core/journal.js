// Журнал калибровок (вкладка «Журнал»): оборудование отделения — камеры, электрометры, аппараты с пучками
// (ускорители — фотоны и электроны, аппараты ⁶⁰Co) —
// и сеансы на весь аппарат: калибровка (k_pol и k_s измеряются для каждого пучка) или проверка выхода (k_pol и k_s
// берутся из последней калибровки этого же пучка). Всё хранится одним файлом JSON, который можно держать на общем
// диске отделения.
//
// Расчёт каждого пучка выполняет ядро вкладки дозиметрии (photons.js — фотоны, electrons.js — электроны,
// cobalt.js — ⁶⁰Co): форма
// вкладки собирается из профиля пучка, записи камеры, записи электрометра и показаний сеанса. В сеанс записывается
// и сама форма — результат старого сеанса воспроизводится, даже если потом изменились N_D,w камеры или настройки пучка.
//
// Запись камеры одна для фотонов, электронов и ⁶⁰Co (та же физическая камера, тот же N_D,w): общие поля хранятся под
// именами вкладки «МВ фотоны» (ch_model, ch_ndw, …), а то, что есть только у электронов (перекрёстная калибровка
// в пучке электронов, «другая камера»), — под именами вкладки «Электроны» (e_cal_route, e_cross_*, e_other_*).
// У вкладки «⁶⁰Co» своих полей камеры нет: её список камер — те же базы фотонов и электронов.

import { computePhotons, FORM_DEFAULTS, normalizeForm } from './photons.js';
import { computeElectrons, E_DEFAULTS, normalizeElectrons, parseElectronBeam } from './electrons.js';
import { computeCobalt, CO_DEFAULTS, normalizeCobalt } from './cobalt.js';
import { PP_PREFIX } from './co60-chambers.js';
import { findChamber, chamberLabel } from './chambers.js';
import { findEChamber, eChamberLabel } from './electron-chambers.js';
import { parseNumber, isBlank, parseBeamName } from './units.js';
import { L } from './i18n.js';

/** version — наибольший формат файла, который понимает эта версия калькулятора (2 — с аппаратами ⁶⁰Co). */
export const JOURNAL_TAG = { app: 'reference-dosimetry', module: 'journal', version: 2 };
/**
 * Формат файла журнала: 2, если в нём есть аппараты или пучки ⁶⁰Co (прежняя версия страницы сочла бы их фотонами и
 * должна отказаться открыть файл), иначе 1 — такой журнал открывается и прежней версией.
 */
export const journalFormat = (j) => (j.machines.some((m) => m.kind === 'cobalt' || m.beams.some((b) => b.kind === 'cobalt')) ? 2 : 1);

/** Короткий идентификатор записи: префикс, время и случайная часть. */
export function uid(prefix) {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

// ---------------------------------------------------------------- поля формы вкладки «МВ фотоны» по владельцу
/** Камера: тип, номер, калибровочный коэффициент и условия свидетельства, поправки лаборатории, своя камера. */
export const PH_CHAMBER_KEYS = [
  'ch_model', 'ch_serial', 'ch_ndw', 'ch_ndw_unit', 'ch_klab', 'ch_T0', 'ch_P0',
  'ch_cal_route', 'ch_cross_ndw', 'ch_cross_ndw_unit', 'ch_cross_tpr',
  'lab_pol_applied', 'lab_kpol', 'lab_ks_applied', 'lab_ks',
  'cc_maker', 'cc_model', 'cc_volume', 'cc_length', 'cc_radius', 'cc_wall', 'cc_wall_thickness', 'cc_electrode', 'cc_waterproof', 'cc_analog', 'cc_a', 'cc_b',
];
export const PH_ELECTROMETER_KEYS = ['el_model', 'el_serial', 'el_kelec'];
/** Сеанс: условия, показания, качество пучка, измеренное в этот раз, подстройка ускорителя, сведения о сеансе. */
export const PH_SESSION_KEYS = [
  'meta_institution', 'meta_machine', 'meta_beam', 'meta_date', 'meta_staff', 'meta_notes',
  'env_T', 'env_H', 'env_P', 'env_P_unit',
  'rd_M1', 'rd_Mopp', 'rd_M2', 'rd_fixed', 'rd_fixed_kpol', 'rd_fixed_ks', 'rd_fixed_from',
  'ctrl_M', 'ctrl_mu', 'recal_needed', 'recal_M', 'recal_mu', 'protocol',
];
/** Пучок: всё остальное — геометрия, напряжения, МЕ, способ определения качества и k_Q, k_vol, пересчёт на d_max, номинал. */
export const PH_BEAM_KEYS = Object.keys(FORM_DEFAULTS).filter((k) => ![...PH_CHAMBER_KEYS, ...PH_ELECTROMETER_KEYS, ...PH_SESSION_KEYS].includes(k));
/** Показатель качества: в профиле — последнее измеренное значение, в сеансе калибровки — новое. */
export const PH_QUALITY_KEYS = ['qtrs_v20', 'qtrs_v10', 'q51_pdd10', 'q51_pdd10pb', 'q51_manual'];

// ---------------------------------------------------------------- поля формы вкладки «Электроны» по владельцу
export const E_CHAMBER_KEYS = [
  'e_ch_model', 'e_other_name', 'e_other_type', 'e_other_r', 'e_ch_serial',
  'e_cal_route', 'e_ndw', 'e_ndw_unit', 'e_klab', 'e_cross_ndw', 'e_cross_ndw_unit', 'e_cross_r50', 'e_cross_kn', 'e_cross_kn_unit',
  'e_T0', 'e_P0', 'e_lab_pol_applied', 'e_lab_kpol', 'e_lab_ks_applied', 'e_lab_ks',
];
export const E_ELECTROMETER_KEYS = ['e_el_model', 'e_el_serial', 'e_kelec'];
export const E_SESSION_KEYS = [
  'protocol', 'e_institution', 'e_machine', 'e_beam', 'e_date', 'e_staff', 'e_notes',
  'e_env_T', 'e_env_H', 'e_env_P', 'e_env_P_unit',
  'e_M1', 'e_Mopp', 'e_M2', 'e_fixed', 'e_fixed_kpol', 'e_fixed_ks', 'e_fixed_from',
  'e_ctrl_M', 'e_ctrl_mu', 'e_recal_needed', 'e_recal_M', 'e_recal_mu',
];
/** Пучок электронов: энергия, геометрия, напряжения, МЕ, способ R50 и k_Q, пересчёт на z_max, номинал. */
export const E_BEAM_KEYS = Object.keys(E_DEFAULTS).filter((k) => ![...E_CHAMBER_KEYS, ...E_ELECTROMETER_KEYS, ...E_SESSION_KEYS].includes(k));
/** Качество пучка электронов: R50 (или I50) и PDD(z_ref) — по одной кривой, измеряются вместе. */
export const E_QUALITY_KEYS = ['e_i50', 'e_r50', 'e_pdd'];

// ---------------------------------------------------------------- поля формы вкладки «⁶⁰Co» по владельцу
export const CO_CHAMBER_KEYS = [
  'co_ch_model', 'co_cc_maker', 'co_cc_model', 'co_cc_type', 'co_ch_serial', 'co_ndw', 'co_ndw_unit', 'co_klab', 'co_T0', 'co_P0',
  'co_lab_pol_applied', 'co_lab_kpol', 'co_lab_ks_applied', 'co_lab_ks',
];
export const CO_ELECTROMETER_KEYS = ['co_el_model', 'co_el_serial', 'co_kelec'];
/** Сеанс: сведения, условия, показания (и для ошибки таймера — облучения с разным временем или t против n·t/n), проверка выхода. */
export const CO_SESSION_KEYS = [
  'protocol', 'co_institution', 'co_machine', 'co_date', 'co_staff', 'co_notes',
  'co_env_T', 'co_env_H', 'co_env_P', 'co_env_P_unit',
  'co_M1', 'co_Mopp', 'co_M2', 'co_Mc', 'co_tt', 'co_tm', 'co_nx_M1', 'co_nx_Mn',
  'co_fixed', 'co_fixed_kpol', 'co_fixed_ks', 'co_fixed_from',
];
/** Пучок ⁶⁰Co: геометрия, время облучения и способ ошибки таймера, напряжения, пересчёт на z_max, источник, сравнение. */
export const CO_BEAM_KEYS = Object.keys(CO_DEFAULTS).filter((k) => ![...CO_CHAMBER_KEYS, ...CO_ELECTROMETER_KEYS, ...CO_SESSION_KEYS].includes(k));
/** Показания сеанса калибровки ⁶⁰Co для ошибки таймера (кроме основных серий). */
export const CO_TIMER_KEYS = ['co_tt', 'co_tm', 'co_nx_M1', 'co_nx_Mn'];

// общие поля записи камеры: имя на вкладке «МВ фотоны» ↔ имя на вкладке «Электроны»
const CH_COMMON = [['ch_serial', 'e_ch_serial'], ['ch_ndw', 'e_ndw'], ['ch_ndw_unit', 'e_ndw_unit'], ['ch_klab', 'e_klab'], ['ch_T0', 'e_T0'], ['ch_P0', 'e_P0'], ['lab_pol_applied', 'e_lab_pol_applied'], ['lab_kpol', 'e_lab_kpol'], ['lab_ks_applied', 'e_lab_ks_applied'], ['lab_ks', 'e_lab_ks']];
// только для электронов
const CH_E_ONLY = ['e_cal_route', 'e_cross_ndw', 'e_cross_ndw_unit', 'e_cross_r50', 'e_cross_kn', 'e_cross_kn_unit', 'e_other_name', 'e_other_type', 'e_other_r'];
const EL_COMMON = [['el_model', 'e_el_model'], ['el_serial', 'e_el_serial'], ['el_kelec', 'e_kelec']];
// общие поля записи камеры и электрометра ↔ имена вкладки «⁶⁰Co»
const CO_CH_COMMON = [['ch_serial', 'co_ch_serial'], ['ch_ndw', 'co_ndw'], ['ch_ndw_unit', 'co_ndw_unit'], ['ch_klab', 'co_klab'], ['ch_T0', 'co_T0'], ['ch_P0', 'co_P0'], ['lab_pol_applied', 'co_lab_pol_applied'], ['lab_kpol', 'co_lab_kpol'], ['lab_ks_applied', 'co_lab_ks_applied'], ['lab_ks', 'co_lab_ks']];
const CO_EL_COMMON = [['el_model', 'co_el_model'], ['el_serial', 'co_el_serial'], ['el_kelec', 'co_kelec']];

/** Для каких пучков журнала выбрана камера: { photon, electron, cobalt }. */
export function chamberUses(j, chamberId) {
  const u = { photon: false, electron: false, cobalt: false };
  for (const m of j.machines) for (const b of m.beams) if (b.chamberId === chamberId && b.active !== false) u[beamKind(b)] = true;
  // камера выбирается в сеансе: где ею мерили — по записанным сеансам
  for (const s of j.sessions || []) for (const b of s.beams || []) if (b.chamberId === chamberId) u[beamKind(b)] = true;
  return u;
}
/** Камеру можно взять для фотонов: она есть в базе вкладки «МВ фотоны» или своя. */
export const photonCapable = (cf) => !!findChamber(cf?.ch_model) || cf?.ch_model === 'CUSTOM' || String(cf?.ch_model || '').startsWith('MY:');
/** Камеру можно взять для электронов: она есть в базе вкладки «Электроны», «другая» или своя (цилиндрическая). */
export const electronCapable = (cf) => !!findEChamber(cf?.ch_model) || cf?.ch_model === 'OTHER' || cf?.ch_model === 'CUSTOM';
/** Камеру можно взять для ⁶⁰Co: любую — в пучке ⁶⁰Co допускаются и цилиндрические, и плоскопараллельные (TRS-398, разд. 5.2.1). */
export const cobaltCapable = (cf) => !isBlank(cf?.ch_model);

/** Запись камеры → поля камеры вкладки «Электроны». */
export function electronChamberForm(cf = {}) {
  const out = {};
  const m = cf.ch_model ?? '';
  if (findEChamber(m) || m === 'OTHER' || isBlank(m)) out.e_ch_model = m;
  else {
    // своя или «фотонная» цилиндрическая камера: для электронов — «другая», k_Q только вручную
    out.e_ch_model = 'OTHER';
    out.e_other_name = m === 'CUSTOM' ? [cf.cc_maker, cf.cc_model].filter((x) => !isBlank(x)).join(' ') : findChamber(m) ? chamberLabel(findChamber(m)) : String(m);
    out.e_other_type = 'cyl';
    // радиус полости: у своей камеры — её параметр, у камеры из базы фотонов — из базы
    const dbR = findChamber(m)?.rCavMm;
    out.e_other_r = m === 'CUSTOM' ? (cf.cc_radius ?? '') : Number.isFinite(dbR) ? String(dbR).replace('.', ',') : '';
  }
  for (const [ph, e] of CH_COMMON) if (ph in cf) out[e] = cf[ph];
  // название, тип и радиус «другой» камеры хранятся только у «другой»: у своей и у камеры из базы они берутся выше
  for (const k of CH_E_ONLY) if (k in cf && !isBlank(cf[k]) && (m === 'OTHER' || !k.startsWith('e_other_'))) out[k] = cf[k];
  return out;
}
/** Поля камеры вкладки «Электроны» → запись камеры. */
export function chamberFormFromElectrons(ef = {}) {
  const out = { ch_model: ef.e_ch_model ?? '' };
  for (const [ph, e] of CH_COMMON) if (e in ef) out[ph] = ef[e];
  for (const k of CH_E_ONLY) if (k in ef) out[k] = ef[k];
  return out;
}
const electronElForm = (ef = {}) => Object.fromEntries(EL_COMMON.filter(([ph]) => ph in ef).map(([ph, e]) => [e, ef[ph]]));
export const elFormFromElectrons = (f = {}) => Object.fromEntries(EL_COMMON.filter(([, e]) => e in f).map(([ph, e]) => [ph, f[e]]));

/**
 * Запись камеры → поля камеры вкладки «⁶⁰Co». Камеры из базы фотонов — тем же id, плоскопараллельные из базы
 * электронов — с префиксом PP:, своя, «другая» и цилиндрическая только из базы электронов — как своя камера
 * (k_Q = 1, от модели зависят только опорная точка и замечания).
 */
export function cobaltChamberForm(cf = {}) {
  const out = {};
  const m = String(cf.ch_model ?? '');
  const ec = findEChamber(m);
  if (isBlank(m) || findChamber(m)) out.co_ch_model = m;
  else if (ec && ec.type === 'pp') out.co_ch_model = PP_PREFIX + m;
  else {
    out.co_ch_model = 'CUSTOM';
    if (m === 'OTHER') Object.assign(out, { co_cc_maker: '', co_cc_model: String(cf.e_other_name ?? ''), co_cc_type: cf.e_other_type === 'cyl' ? 'cyl' : 'pp' });
    else if (ec) Object.assign(out, { co_cc_maker: '', co_cc_model: eChamberLabel(ec), co_cc_type: 'cyl' });
    else Object.assign(out, { co_cc_maker: String(cf.cc_maker ?? ''), co_cc_model: m === 'CUSTOM' || m.startsWith('MY:') ? String(cf.cc_model ?? '') : m, co_cc_type: 'cyl' });
  }
  for (const [ph, co] of CO_CH_COMMON) if (ph in cf) out[co] = cf[ph];
  return out;
}
/** Поля камеры вкладки «⁶⁰Co» → запись камеры (своя плоскопараллельная — «другая» камера, как у электронов). */
export function chamberFormFromCobalt(cof = {}) {
  const id = String(cof.co_ch_model ?? '');
  const out = {};
  if (id.startsWith(PP_PREFIX)) out.ch_model = id.slice(PP_PREFIX.length);
  else if (id === 'CUSTOM' || id.startsWith('MY:')) {
    if (cof.co_cc_type === 'pp') Object.assign(out, { ch_model: 'OTHER', e_other_name: [cof.co_cc_maker, cof.co_cc_model].filter((x) => !isBlank(x)).join(' '), e_other_type: 'pp' });
    else Object.assign(out, { ch_model: 'CUSTOM', cc_maker: cof.co_cc_maker ?? '', cc_model: cof.co_cc_model ?? '' });
  } else out.ch_model = id;
  for (const [ph, co] of CO_CH_COMMON) if (co in cof) out[ph] = cof[co];
  return out;
}
const cobaltElForm = (ef = {}) => Object.fromEntries(CO_EL_COMMON.filter(([ph]) => ph in ef).map(([ph, co]) => [co, ef[ph]]));
export const elFormFromCobalt = (f = {}) => Object.fromEntries(CO_EL_COMMON.filter(([, co]) => co in f).map(([ph, co]) => [ph, f[co]]));

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj && k in obj).map((k) => [k, obj[k]]));

// ---------------------------------------------------------------- записи по умолчанию
/** Запись камеры: maker — производитель, выбранный в карточке (пока модель не выбрана); length — своя длина полости, мм;
 * calEl, calV, calPol, calLab, calCert — сведения о калибровке: электрометр, с которым её калибровали, напряжение и
 * полярность, лаборатория, № свидетельства (пусто — проверок по ним нет, см. calibrationChecks). */
export const CHAMBER_DEFAULTS = { id: '', kind: 'photon', form: {}, calDate: '', dueDate: '', notes: '', length: '', calEl: '', calV: '', calPol: '', calLab: '', calCert: '' };
export const ELECTROMETER_DEFAULTS = { id: '', form: {}, calDate: '', dueDate: '', notes: '' };
/** kind: 'linac' — ускоритель (пучки фотонов и электронов), 'cobalt' — аппарат ⁶⁰Co. */
export const MACHINE_DEFAULTS = { id: '', name: '', serial: '', kind: 'linac', notes: '', beams: [] };
/** kind: 'photon' | 'electron' | 'cobalt'. refSrc (⁶⁰Co): с чем сравнивать мощность дозы — 'last' (последняя калибровка в журнале с поправкой на распад) или 'profile' (значение из настроек пучка). */
export const BEAM_DEFAULTS = { id: '', kind: 'photon', name: '', chamberId: '', electrometerId: '', form: {}, active: true };
export const SESSION_DEFAULTS = { id: '', machineId: '', date: '', mode: 'cal', protocol: 'trs', staff: [''], notes: '', env: { T: '', P: '', P_unit: 'kPa', H: '' }, beams: [], saved: '' };

export function newJournal() {
  return { ...JOURNAL_TAG, institution: '', department: '', chambers: [], electrometers: [], machines: [], sessions: [] };
}

const arr = (v) => (Array.isArray(v) ? v : []);
const withId = (x, prefix) => (x.id ? x : { ...x, id: uid(prefix) });

/** Проверка и дополнение журнала из файла: недостающие поля — по умолчанию, у записей без id — новый id. */
export function normalizeJournal(obj) {
  if (!obj || obj.app !== JOURNAL_TAG.app || obj.module !== JOURNAL_TAG.module) {
    throw new Error(L('Это не файл журнала калькулятора референсной дозиметрии.', 'This is not a journal file of the reference dosimetry calculator.'));
  }
  const v = Number(obj.version);
  if (Number.isFinite(v) && v > JOURNAL_TAG.version) {
    throw new Error(L(
      `Журнал сохранён более новой версией калькулятора (формат ${v}, эта страница понимает до ${JOURNAL_TAG.version}): обновите страницу (Ctrl+F5).`,
      `The journal was saved by a newer version of the calculator (format ${v}; this page supports up to ${JOURNAL_TAG.version}): reload the page (Ctrl+F5).`,
    ));
  }
  const j = { ...newJournal(), ...obj, version: JOURNAL_TAG.version };
  j.institution = String(j.institution ?? '');
  j.department = String(j.department ?? '');
  j.chambers = arr(obj.chambers).map((c) => withId({ ...CHAMBER_DEFAULTS, ...c, form: { ...(c?.form || {}) } }, 'ch'));
  j.electrometers = arr(obj.electrometers).map((e) => withId({ ...ELECTROMETER_DEFAULTS, ...e, form: { ...(e?.form || {}) } }, 'el'));
  j.machines = arr(obj.machines).map((m) => {
    const machine = withId({ ...MACHINE_DEFAULTS, ...m }, 'm');
    machine.beams = arr(m?.beams).map((b) => withId({ ...BEAM_DEFAULTS, ...b, form: { ...(b?.form || {}) } }, 'b'));
    return machine;
  });
  j.sessions = arr(obj.sessions)
    .map((s) => withId({ ...SESSION_DEFAULTS, ...s, env: { ...SESSION_DEFAULTS.env, ...(s?.env || {}) }, beams: arr(s?.beams) }, 's'))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return j;
}

// ---------------------------------------------------------------- подписи
/**
 * Длина полости камеры из записи журнала (поле «Длина полости» карточки камеры) — в поле k_vol пучка фотонов, если у
 * пучка своя длина не задана. Нужна для k_vol в пучках БВФ; без неё — длина из базы камер (TRS-398 Rev.1, табл. 4).
 */
export function withChamberLength(form, ch) {
  if (!ch || isBlank(ch.length) || !isBlank(form.prof_length)) return form;
  return { ...form, prof_length: ch.length };
}

/** «Учреждение, подразделение» — для протоколов и вкладок дозиметрии. */
export const orgText = (j) => [j?.institution, j?.department].map((x) => String(x ?? '').trim()).filter(Boolean).join(', ');
export function chamberText(c) {
  if (!c) return '';
  const f = c.form || {};
  const model = f.ch_model === 'CUSTOM' || String(f.ch_model || '').startsWith('MY:')
    ? [f.cc_maker, f.cc_model].filter((s) => !isBlank(s)).join(' ') || L('своя камера', 'custom chamber')
    : f.ch_model === 'OTHER'
      ? String(f.e_other_name || '').trim() || L('другая камера', 'other chamber')
      : findChamber(f.ch_model) ? chamberLabel(findChamber(f.ch_model)) : findEChamber(f.ch_model) ? eChamberLabel(findEChamber(f.ch_model)) : String(f.ch_model || '—');
  return [model, isBlank(f.ch_serial) ? '' : `${L('№', 'S/N')} ${f.ch_serial}`].filter(Boolean).join(' ');
}
/** Свидетельство о калибровке камеры для протокола: «свидетельство № 123 от 12.03.2026, ВНИИФТРИ». */
export function certText(c) {
  if (!c) return '';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(c.calDate || '') ? c.calDate.split('-').reverse().join('.') : '';
  const no = String(c.calCert || '').trim();
  const lab = String(c.calLab || '').trim();
  if (!no && !lab && !date) return '';
  const head = [no ? L(`свидетельство № ${no}`, `certificate No. ${no}`) : L('калибровка', 'calibrated'), date ? L(`от ${date}`, `of ${date}`) : ''].filter(Boolean).join(' ');
  return [head, lab].filter(Boolean).join(', ');
}
export function electrometerText(e) {
  if (!e) return '';
  const f = e.form || {};
  return [isBlank(f.el_model) ? L('электрометр', 'electrometer') : f.el_model, isBlank(f.el_serial) ? '' : `${L('№', 'S/N')} ${f.el_serial}`].filter(Boolean).join(' ');
}
/**
 * Чего не хватает записи камеры для расчёта: модель и калибровочные коэффициенты — N_D,w в ⁶⁰Co или перекрёстные
 * (для фотонов — N_D,w,Qcross и TPR20,10, для электронов — N_D,w,Qcross с R50 или (k_Qecal·N_D,w)pp).
 * uses — для каких пучков камера выбрана ({ photon, electron, cobalt }); без него — для фотонов, если камера для них годится.
 * Для ⁶⁰Co нужен N_D,w в пучке ⁶⁰Co (перекрёстная калибровка к нему не относится).
 */
export function chamberMissing(c, uses = null, protocol = '') {
  const f = c?.form || {};
  if (isBlank(f.ch_model)) return [L('модель', 'model')];
  const u = uses && (uses.photon || uses.electron || uses.cobalt) ? uses : photonCapable(f) ? { photon: true } : { electron: true };
  const ph = !!u.photon && photonCapable(f);
  const el = !!u.electron && electronCapable(f);
  const co = !!u.cobalt;
  const phCross = ph && f.ch_cal_route === 'cross';
  const elCross = el && f.e_cal_route === 'cross';
  const needNdw = (ph && !phCross) || (el && !elCross) || co;
  return [
    f.ch_model === 'OTHER' && isBlank(f.e_other_name) && L('название', 'name'),
    needNdw && isBlank(f.ch_ndw) && 'N_D,w',
    phCross && isBlank(f.ch_cross_ndw) && L('N_D,w,Qcross (фотоны)', 'N_D,w,Qcross (photons)'),
    phCross && isBlank(f.ch_cross_tpr) && L('TPR20,10 перекрёстной калибровки', 'cross-calibration TPR20,10'),
    // перекрёстная калибровка в электронах: TRS-398 — N_D,w,Qcross и R50 пучка калибровки (ур. 41), Report 385 — (k_Qecal·N_D,w)pp (ур. 5);
    // нужно то, что требует протокол (без протокола — хотя бы одно из двух)
    elCross && protocol !== 'tg51' && (protocol === 'trs' || isBlank(f.e_cross_kn)) && isBlank(f.e_cross_ndw) && L('N_D,w,Qcross (электроны, TRS-398)', 'N_D,w,Qcross (electrons, TRS-398)'),
    elCross && protocol !== 'tg51' && (protocol === 'trs' || !isBlank(f.e_cross_ndw)) && isBlank(f.e_cross_r50) && L('R50 перекрёстной калибровки (TRS-398)', 'cross-calibration R50 (TRS-398)'),
    elCross && protocol === 'tg51' && isBlank(f.e_cross_kn) && L('(k_Qecal·N_D,w)pp (электроны, Report 385)', '(k_Qecal·N_D,w)pp (electrons, Report 385)'),
  ].filter(Boolean);
}
const V1_KEY = { photon: 'rd_V1', electron: 'e_V1', cobalt: 'co_V1' };
const POL_KEY = { photon: 'rd_polarity', electron: 'e_polarity', cobalt: 'co_polarity' };

/**
 * Согласие пучка с калибровкой камеры: [{ level, text }].
 * — N_D,w относится к камере вместе с электрометром, с которым её калибровали: с другим электрометром нужен его k_elec;
 * — напряжение и полярность: поправки лаборатории (k_pol, k_s) и N_D,w относятся к условиям калибровки.
 * form — поля пучка (V₁ и полярность), kind — 'photon' | 'electron' | 'cobalt'.
 */
export function calibrationChecks(j, chamberId, electrometerId, form = {}, kind = 'photon') {
  const ch = chamberOf(j, chamberId);
  if (!ch) return [];
  const out = [];
  const chName = chamberText(ch) || L('камера', 'the chamber');
  const calEl = ch.calEl ? electrometerOf(j, ch.calEl) : null;
  if (calEl && electrometerId && electrometerId !== calEl.id) {
    const el = electrometerOf(j, electrometerId);
    const k = parseNumber(el?.form?.el_kelec);
    const one = !Number.isFinite(k) || Math.abs(k - 1) < 1e-9;
    out.push({
      level: one ? 'warn' : 'info',
      text: one
        ? L(
          `${chName} калибровалась с электрометром ${electrometerText(calEl)}, а выбран ${electrometerText(el)} с k_elec = 1: N_D,w относится к камере вместе с электрометром калибровки. Для другого электрометра нужен его k_elec из свидетельства (или выберите электрометр калибровки).`,
          `${chName} was calibrated with the electrometer ${electrometerText(calEl)}, but ${electrometerText(el)} with k_elec = 1 is selected: N_D,w refers to the chamber together with the calibration electrometer. Another electrometer needs its own k_elec from its certificate (or select the calibration electrometer).`,
        )
        : L(
          `${chName} калибровалась с электрометром ${electrometerText(calEl)}; с ${electrometerText(el)} учитывается его k_elec = ${String(el.form.el_kelec)}.`,
          `${chName} was calibrated with the electrometer ${electrometerText(calEl)}; with ${electrometerText(el)} its k_elec = ${String(el.form.el_kelec).replace(',', '.')} is applied.`,
        ),
    });
  }
  const calV = parseNumber(ch.calV);
  const v1 = Math.abs(parseNumber(form[V1_KEY[kind]]));
  if (Number.isFinite(calV) && calV > 0 && Number.isFinite(v1) && Math.abs(v1 - calV) > 0.5) {
    out.push({
      level: 'info',
      text: L(
        `Рабочее напряжение V₁ = ${String(v1).replace('.', ',')} В отличается от напряжения калибровки камеры ${String(calV).replace('.', ',')} В: поправки лаборатории (k_pol, k_s), если они внесены в N_D,w, относятся к напряжению калибровки.`,
        `The operating voltage V₁ = ${v1} V differs from the chamber calibration voltage ${calV} V: laboratory corrections (k_pol, k_s), if included in N_D,w, refer to the calibration voltage.`,
      ),
    });
  }
  const pol = form[POL_KEY[kind]];
  if ((ch.calPol === '+' || ch.calPol === '-') && (pol === '+' || pol === '-') && pol !== ch.calPol) {
    const s = (p) => (p === '+' ? '+' : '−');
    out.push({
      level: 'info',
      text: L(
        `Полярность измерения (${s(pol)}) не та, что при калибровке камеры (${s(ch.calPol)}): обычно измеряют при полярности калибровки. При другой k_pol нужно измерить при обеих полярностях, а поправку лаборатории на полярность взять по свидетельству.`,
        `The measurement polarity (${s(pol)}) differs from the chamber calibration polarity (${s(ch.calPol)}): measurements are usually made at the calibration polarity. Otherwise k_pol must be measured at both polarities, and the laboratory polarity correction taken from the certificate.`,
      ),
    });
  }
  return out;
}

/** Чего не хватает записи электрометра: k_elec. */
export const electrometerMissing = (e) => (isBlank(e?.form?.el_kelec) ? ['k_elec'] : []);
export const machineOf = (j, id) => j.machines.find((m) => m.id === id) ?? null;
export const chamberOf = (j, id) => j.chambers.find((c) => c.id === id) ?? null;
export const electrometerOf = (j, id) => j.electrometers.find((e) => e.id === id) ?? null;
export function beamOf(j, id) {
  for (const m of j.machines) {
    const b = m.beams.find((x) => x.id === id);
    if (b) return { machine: m, beam: b };
  }
  return null;
}

// ---------------------------------------------------------------- сроки калибровки
/** Дата в формате ГГГГ-ММ-ДД → число дней от 1970-01-01 (UTC); NaN, если не дата. */
export function dayNumber(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? '').trim());
  if (!m) return NaN;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  return Number.isFinite(t) ? Math.round(t / 86400000) : NaN;
}
/** Срок следующей калибровки: 'none' — не задан, 'ok', 'soon' — осталось не больше 30 дней, 'overdue' — прошёл. */
export function dueStatus(dueDate, today, soonDays = 30) {
  const d = dayNumber(dueDate);
  const t = dayNumber(today);
  if (!Number.isFinite(d) || !Number.isFinite(t)) return { status: 'none', days: NaN };
  const days = d - t;
  return { status: days < 0 ? 'overdue' : days <= soonDays ? 'soon' : 'ok', days };
}
/** Камеры и электрометры, у которых срок калибровки прошёл или подходит. */
export function equipmentDue(j, today) {
  const out = [];
  for (const c of j.chambers) {
    const s = dueStatus(c.dueDate, today);
    if (s.status === 'overdue' || s.status === 'soon') out.push({ kind: 'chamber', id: c.id, text: chamberText(c), ...s, dueDate: c.dueDate });
  }
  for (const e of j.electrometers) {
    const s = dueStatus(e.dueDate, today);
    if (s.status === 'overdue' || s.status === 'soon') out.push({ kind: 'electrometer', id: e.id, text: electrometerText(e), ...s, dueDate: e.dueDate });
  }
  return out.sort((a, b) => a.days - b.days);
}

// ---------------------------------------------------------------- виды пучков
// Имена полей формы вкладки для частей, которые собирает журнал: показания, проверка выхода, условия, сведения.
const KINDS = {
  photon: {
    defaults: FORM_DEFAULTS,
    normalize: normalizeForm,
    compute: computePhotons,
    beamKeys: PH_BEAM_KEYS,
    chamberKeys: PH_CHAMBER_KEYS,
    electrometerKeys: PH_ELECTROMETER_KEYS,
    qualityKeys: PH_QUALITY_KEYS,
    chamberForm: (cf) => pick(cf, PH_CHAMBER_KEYS),
    chamberFromTab: (f) => pick(f, PH_CHAMBER_KEYS),
    electrometerForm: (ef) => pick(ef, PH_ELECTROMETER_KEYS),
    electrometerFromTab: (f) => pick(f, PH_ELECTROMETER_KEYS),
    atMax: 'dmax',
    k: {
      M1: 'rd_M1', Mopp: 'rd_Mopp', M2: 'rd_M2', ctrl: 'ctrl_M', recal: 'recal_M', recalNeeded: 'recal_needed',
      fixed: 'rd_fixed', fixedKpol: 'rd_fixed_kpol', fixedKs: 'rd_fixed_ks', fixedFrom: 'rd_fixed_from',
      T: 'env_T', P: 'env_P', PUnit: 'env_P_unit', H: 'env_H',
      institution: 'meta_institution', machine: 'meta_machine', beam: 'meta_beam', date: 'meta_date', staff: 'meta_staff', notes: 'meta_notes',
      V1: 'rd_V1', mu: 'rd_mu',
    },
  },
  electron: {
    defaults: E_DEFAULTS,
    normalize: normalizeElectrons,
    compute: computeElectrons,
    beamKeys: E_BEAM_KEYS,
    chamberKeys: E_CHAMBER_KEYS,
    electrometerKeys: E_ELECTROMETER_KEYS,
    qualityKeys: E_QUALITY_KEYS,
    chamberForm: (cf) => electronChamberForm(cf),
    chamberFromTab: (f) => chamberFormFromElectrons(pick(f, E_CHAMBER_KEYS)),
    electrometerForm: (ef) => electronElForm(ef),
    electrometerFromTab: (f) => elFormFromElectrons(pick(f, E_ELECTROMETER_KEYS)),
    atMax: 'zmax',
    k: {
      M1: 'e_M1', Mopp: 'e_Mopp', M2: 'e_M2', ctrl: 'e_ctrl_M', recal: 'e_recal_M', recalNeeded: 'e_recal_needed',
      fixed: 'e_fixed', fixedKpol: 'e_fixed_kpol', fixedKs: 'e_fixed_ks', fixedFrom: 'e_fixed_from',
      T: 'e_env_T', P: 'e_env_P', PUnit: 'e_env_P_unit', H: 'e_env_H',
      institution: 'e_institution', machine: 'e_machine', beam: 'e_beam', date: 'e_date', staff: 'e_staff', notes: 'e_notes',
      V1: 'e_V1', mu: 'e_mu',
    },
  },
  // ⁶⁰Co: вместо МЕ — время облучения, подстройки выхода нет; ошибка таймера измеряется при калибровке, а при проверке
  // выхода берётся из неё (как k_pol и k_s). Качество пучка не измеряют (k_Q = 1).
  cobalt: {
    defaults: CO_DEFAULTS,
    normalize: normalizeCobalt,
    compute: computeCobalt,
    beamKeys: CO_BEAM_KEYS,
    chamberKeys: CO_CHAMBER_KEYS,
    electrometerKeys: CO_ELECTROMETER_KEYS,
    qualityKeys: [],
    timerKeys: CO_TIMER_KEYS,
    chamberForm: (cf) => cobaltChamberForm(cf),
    chamberFromTab: (f) => chamberFormFromCobalt(pick(f, CO_CHAMBER_KEYS)),
    electrometerForm: (ef) => cobaltElForm(ef),
    electrometerFromTab: (f) => elFormFromCobalt(pick(f, CO_ELECTROMETER_KEYS)),
    atMax: 'zmax',
    k: {
      M1: 'co_M1', Mopp: 'co_Mopp', M2: 'co_M2', ctrl: 'co_Mc', recal: '', recalNeeded: '',
      fixed: 'co_fixed', fixedKpol: 'co_fixed_kpol', fixedKs: 'co_fixed_ks', fixedFrom: 'co_fixed_from', fixedTau: 'co_tau',
      T: 'co_env_T', P: 'co_env_P', PUnit: 'co_env_P_unit', H: 'co_env_H',
      institution: 'co_institution', machine: 'co_machine', beam: '', date: 'co_date', staff: 'co_staff', notes: 'co_notes',
      V1: 'co_V1', mu: '', time: 'co_time',
    },
  },
};
const kindOf = (kind) => KINDS[kind] ?? KINDS.photon;
/** Имена полей сеанса для пучка данного вида: показания, проверка выхода, качество пучка, ошибка таймера (⁶⁰Co). */
export const beamKeys = (kind) => ({ ...kindOf(kind).k, quality: kindOf(kind).qualityKeys, timer: kindOf(kind).timerKeys ?? [] });
/** Вид пучка по записи ('photon' | 'electron' | 'cobalt'). */
export const beamKind = (beam) => (beam?.kind === 'electron' || beam?.kind === 'cobalt' ? beam.kind : 'photon');

// ---------------------------------------------------------------- сеанс
/** Последняя калибровка пучка до даты (не включая сеанс exceptId): k_pol, k_s, показатель качества. */
export function lastCalibration(j, beamId, { before = '9999-12-31', exceptId = '' } = {}) {
  let best = null;
  for (const s of j.sessions) {
    if (s.mode !== 'cal' || s.id === exceptId || !(String(s.date) <= before)) continue;
    const b = s.beams.find((x) => x.beamId === beamId && x.include !== false && x.summary?.ok && Number.isFinite(x.summary.ksRaw) && Number.isFinite(x.summary.kpolRaw));
    if (b && (!best || String(s.date) >= String(best.session.date))) best = { session: s, beam: b };
  }
  if (!best) return null;
  const K = kindOf(beamKind(beamOf(j, beamId)?.beam));
  const sum = best.beam.summary;
  return {
    date: best.session.date,
    sessionId: best.session.id,
    ks: sum.ksRaw,
    kpol: sum.kpolRaw,
    quality: pick(best.beam.form || {}, K.qualityKeys),
    // ⁶⁰Co: мощность дозы (сГр/мин на z_ref и на z_max), ошибка таймера в минутах, дата установки источника
    rate: sum.rate,
    rateMax: sum.rateMax,
    tauMin: sum.tauMin,
    actDate: String(best.beam.form?.co_act_date ?? ''),
  };
}

/** Дата для текста (ДД.ММ.ГГГГ по-русски, ГГГГ-ММ-ДД по-английски). */
const dateText = (iso, en) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''));
  if (!m) return String(iso ?? '');
  return en ? `${m[1]}-${m[2]}-${m[3]}` : `${m[3]}.${m[2]}.${m[1]}`;
};

/** Настройки пучка, камеры и электрометра из формы, записанной в сеанс (без показаний и условий сеанса). */
export function recordedBase(form, kind = 'photon') {
  if (!form) return null;
  const K = kindOf(kind);
  return pick(form, [...K.beamKeys, ...K.chamberKeys, ...K.electrometerKeys, K.k.fixedKpol, K.k.fixedKs, K.k.fixedFrom].filter(Boolean));
}

/**
 * Форма вкладки дозиметрии для пучка в сеансе: профиль пучка + камера + электрометр + показания.
 * input — показания пучка в сеансе (имена полей вкладки: rd_M1… у фотонов, e_M1… у электронов) и свои условия
 * env_T, env_P. input.base — настройки из записанного сеанса (recordedBase): открытый из журнала сеанс считается по
 * ним, а не по сегодняшнему оборудованию, иначе после смены N_D,w камеры старый сеанс тихо показал бы другую дозу.
 * В режиме проверки k_pol и k_s берутся из последней калибровки этого пучка (до даты сеанса); каждое можно задать вручную.
 */
/**
 * Условия измерения пучка, которые задаются в сеансе (карточка пучка сеанса): напряжения, полярность, МЕ (у ⁶⁰Co — время),
 * геометрия. Пусто — из настроек пучка в «Оборудовании» (вкладка дозиметрии).
 */
export const SESSION_BEAM_KEYS = {
  photon: ['setup_geometry', 'rd_V1', 'rd_V2', 'rd_polarity', 'rd_mu'],
  electron: ['e_ssd', 'e_V1', 'e_V2', 'e_polarity', 'e_mu'],
  cobalt: ['co_V1', 'co_V2', 'co_polarity', 'co_time'],
};

export function beamForm(j, session, machine, beam, input = {}, { en = false } = {}) {
  const kind = beamKind(beam);
  const K = kindOf(kind);
  const k = K.k;
  const base = input.base && typeof input.base === 'object' ? input.base : null;
  const ch = base ? null : chamberOf(j, input.chamberId || beam.chamberId);
  const el = base ? null : electrometerOf(j, input.electrometerId || beam.electrometerId);
  const f = base
    ? { ...K.defaults, ...pick(base, [...K.beamKeys, ...K.chamberKeys, ...K.electrometerKeys]) }
    : kind === 'photon'
      ? withChamberLength({ ...K.defaults, ...pick(beam.form, K.beamKeys), ...K.chamberForm(ch?.form || {}), ...K.electrometerForm(el?.form || {}) }, ch)
      : { ...K.defaults, ...pick(beam.form, K.beamKeys), ...K.chamberForm(ch?.form || {}), ...K.electrometerForm(el?.form || {}) };
  for (const key of SESSION_BEAM_KEYS[kind]) if (!isBlank(input[key])) f[key] = input[key];
  f.protocol = session.protocol === 'tg51' ? 'tg51' : 'trs';
  f[k.institution] = orgText(j);
  const machineText = [machine.name, machine.serial ? `${L('№', 'S/N')} ${machine.serial}` : ''].filter(Boolean).join(', ');
  // у вкладки «⁶⁰Co» нет поля пучка: название пучка (установки) — после аппарата
  f[k.machine] = k.beam ? machineText : [machineText, beam.name].filter((x) => !isBlank(x)).join(' — ');
  if (k.beam) f[k.beam] = beam.name;
  f[k.date] = session.date;
  f[k.staff] = Array.isArray(session.staff) && session.staff.length ? session.staff : [''];
  f[k.notes] = session.notes ?? '';
  // условия: свои у пучка или общие для сеанса
  const env = session.env || {};
  f[k.T] = isBlank(input.env_T) ? env.T ?? '' : input.env_T;
  f[k.P] = isBlank(input.env_P) ? env.P ?? '' : input.env_P;
  f[k.PUnit] = (isBlank(input.env_P) ? env.P_unit : input.env_P_unit || env.P_unit) || 'kPa';
  f[k.H] = env.H ?? '';
  f[k.M1] = input[k.M1] ?? ['', '', ''];
  f[k.ctrl] = input[k.ctrl] ?? ['', '', ''];
  if (k.recalNeeded) f[k.recalNeeded] = input[k.recalNeeded] ?? '';
  if (k.recal) f[k.recal] = input[k.recal] ?? ['', '', ''];
  // шесть знаков после запятой: на дозу это влияет меньше чем на 10⁻⁶, а во вкладке читается
  const six = (v) => (en ? v.toFixed(6) : v.toFixed(6).replace('.', ','));
  let last = null;
  // откуда k_pol и k_s (у ⁶⁰Co — и τ) при проверке выхода: 'manual' — введены в сеансе, 'recorded' — из записанного
  // сеанса, 'journal' — из последней калибровки пучка в журнале, 'profile' — τ из настроек пучка, 'none' — неоткуда,
  // '' — не нужно (ошибка таймера не учитывается или заряд накоплен при выдвинутом источнике)
  const fixedSrc = kind === 'cobalt' ? { kpol: 'none', ks: 'none', tau: '' } : { kpol: 'none', ks: 'none' };
  // ⁶⁰Co: ошибка таймера нужна, если она не исключена способом измерения
  const timed = kind === 'cobalt' && f.co_timer_mode !== 'window' && f.co_timer_mode !== 'none';
  if (session.mode === 'check') {
    last = lastCalibration(j, beam.id, { before: session.date || '9999-12-31', exceptId: session.id });
    f[k.fixed] = true;
    f[k.Mopp] = ['', '', ''];
    f[k.M2] = ['', '', ''];
    // своё значение (например, калибровка была до журнала) важнее записанного в сеансе, записанное — важнее журнала
    const choose = (key, fromLast) => {
      if (!isBlank(input[key])) return ['manual', input[key]];
      if (base && !isBlank(base[key])) return ['recorded', base[key]];
      if (last && Number.isFinite(fromLast)) return ['journal', six(fromLast)];
      return ['none', ''];
    };
    [fixedSrc.kpol, f[k.fixedKpol]] = choose(k.fixedKpol, last?.kpol);
    [fixedSrc.ks, f[k.fixedKs]] = choose(k.fixedKs, last?.ks);
    if (timed) {
      // τ из калибровки (в единицах времени пучка); без калибровки — известное значение из настроек пучка
      const profileTau = f.co_timer_mode === 'manual' && !base ? f.co_tau : '';
      const lastTau = Number.isFinite(last?.tauMin) ? last.tauMin * (f.co_time_unit === 's' ? 60 : 1) : NaN;
      [fixedSrc.tau, f.co_tau] = choose(k.fixedTau, lastTau);
      if (fixedSrc.tau === 'none' && !isBlank(profileTau)) [fixedSrc.tau, f.co_tau] = ['profile', profileTau];
      f.co_timer_mode = 'manual';
    }
    const srcs = [fixedSrc.kpol, fixedSrc.ks, fixedSrc.tau];
    f[k.fixedFrom] = !isBlank(input[k.fixedFrom])
      ? String(input[k.fixedFrom])
      : srcs.includes('recorded') && !isBlank(base?.[k.fixedFrom])
        ? String(base[k.fixedFrom])
        : srcs.includes('journal')
          ? dateText(last.date, en)
          : '';
    // качество пучка — измеренное при той калибровке (у записанного сеанса оно уже в его форме)
    if (last && !base) Object.assign(f, Object.fromEntries(Object.entries(last.quality).filter(([, v]) => !isBlank(v))));
  } else {
    f[k.fixed] = false;
    f[k.Mopp] = input[k.Mopp] ?? ['', '', ''];
    f[k.M2] = input[k.M2] ?? ['', '', ''];
    // качество пучка: измеренное в этом сеансе, иначе последнее из профиля
    for (const q of K.qualityKeys) if (!isBlank(input[q])) f[q] = input[q];
    // ⁶⁰Co: облучения для ошибки таймера; известное τ можно ввести в сеансе вместо значения из настроек пучка
    for (const t of K.timerKeys ?? []) if (input[t] !== undefined) f[t] = input[t];
    if (kind === 'cobalt' && f.co_timer_mode === 'manual' && !isBlank(input.co_tau)) f.co_tau = input.co_tau;
  }
  // ⁶⁰Co: с чем сравнивать мощность дозы. По умолчанию — с последней калибровкой этого пучка в журнале (до даты
  // сеанса), приведённой к дате сеанса по распаду; после замены источника — со значением из настроек пучка, если оно
  // относится к новому источнику. У записанного сеанса значение для сравнения уже в его форме.
  let ref = null;
  if (kind === 'cobalt') {
    if (base) ref = { src: 'recorded' };
    else {
      const act = String(f.co_act_date ?? '').trim();
      const prev = beam.refSrc === 'profile' ? null : last ?? lastCalibration(j, beam.id, { before: session.date || '9999-12-31', exceptId: session.id });
      // источник заменён после той калибровки: она сделана раньше даты установки или с другой датой установки
      const newSource = !!prev && !isBlank(act) && (String(prev.date) < act || (!isBlank(prev.actDate) && prev.actDate !== act));
      let atMax = !!f.co_dd_on && f.co_ref_at !== 'zref';
      // в калибровке не было пересчёта на z_max — сравнение на z_ref (и итог показывается там же)
      const atFallback = !!prev && atMax && !Number.isFinite(prev.rateMax) && Number.isFinite(prev.rate);
      if (atFallback) atMax = false;
      const v = prev ? (atMax ? prev.rateMax : prev.rate) : NaN;
      if (prev && !newSource && Number.isFinite(v)) {
        if (atFallback) f.co_ref_at = 'zref';
        f.co_ref_rate = six(v);
        f.co_ref_date = prev.date;
        ref = { src: 'journal', last: prev, at: atMax ? 'zmax' : 'zref', atFallback };
      } else {
        // значение из настроек пучка, датированное раньше установки источника, относится к прежнему источнику
        const refDate = String(f.co_ref_date ?? '').trim();
        const staleProfile = !isBlank(f.co_ref_rate) && !isBlank(refDate) && !isBlank(act) && refDate < act;
        if (staleProfile) f.co_ref_rate = '';
        ref = { src: isBlank(f.co_ref_rate) ? 'none' : 'profile', newSource, staleProfile, last: prev, wanted: beam.refSrc !== 'profile' };
      }
    }
  }
  // у записанного сеанса камера и электрометр — как при записи (для подписей; поля — как у записи камеры)
  const chamber = base ? { id: input.chamberId || '', form: K.chamberFromTab(base) } : ch;
  const electrometer = base ? { id: input.electrometerId || '', form: K.electrometerFromTab(base) } : el;
  return { form: K.normalize(f), chamber, electrometer, last, fixedSrc, recorded: !!base, kind, ref };
}
/** Прежнее имя (фотоны). */
export const photonBeamForm = beamForm;

const mean = (cells) => {
  const v = (cells || []).map(parseNumber).filter(Number.isFinite);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN;
};

/**
 * Итог пучка ⁶⁰Co: мощность дозы (сГр/мин) на глубине, где задано значение для сравнения (z_max или z_ref),
 * отклонение от ожидаемой, поправки и ошибка таймера (в минутах — для проверок выхода с другой единицей времени).
 */
function cobaltSummary(r) {
  const tg = r.protocol === 'tg51';
  const x = tg ? r.tg51 : r.trs;
  const errors = r.messages.filter((m) => m.level === 'error').length;
  const warns = r.messages.filter((m) => m.level === 'warn').length;
  const ctrlFailed = !x.blocked && !!x.ctrl?.blocked;
  const p = x.ctrl && !x.ctrl.blocked && !x.blocked ? x.ctrl : x;
  const atMax = r.depth.expectedAt === 'zmax' && Number.isFinite(p.rateMax);
  const none = x.blocked || ctrlFailed;
  const value = none ? NaN : atMax ? p.rateMax : p.rate;
  const hasValue = Number.isFinite(value);
  const ok = hasValue && errors === 0;
  const dev = none ? NaN : p.deviation;
  const tol = r.depth.tolerance;
  const timed = ['measured', 'nexp', 'manual'].includes(r.timer?.mode);
  const toMin = r.form?.co_time_unit === 's' ? 1 / 60 : 1;
  return {
    ok,
    hasValue,
    value, // сГр/мин
    at: atMax ? 'zmax' : 'zref',
    rate: hasValue ? p.rate : NaN, // на z_ref
    rateMax: hasValue ? p.rateMax : NaN, // на z_max
    DperMU: NaN,
    DmaxPerMU: NaN,
    deviation: dev,
    tol,
    expected: r.depth.expected,
    status: !ok ? 'error' : !Number.isFinite(dev) ? 'nonominal' : Math.abs(dev) > tol ? 'out' : 'ok',
    source: p === x.ctrl ? 'ctrl' : 'main',
    preDeviation: NaN,
    ksRaw: tg ? x.PionRaw : x.ksRaw,
    kpolRaw: tg ? x.PpolRaw : x.kpolRaw,
    ksFixed: !!(tg ? x.PionFixed : x.ksFixed),
    kQ: 1,
    kQName: 'k_Q',
    quality: NaN,
    tauMin: timed && Number.isFinite(r.timer.tau) ? r.timer.tau * toMin : NaN,
    // калибровочные коэффициенты: их смена начинает новый отсчёт контрольной карты
    ndw: Number(r.inputs?.ndw),
    kelec: Number(r.inputs?.kelec),
    errors,
    warns,
  };
}

/** Итог пучка: доза в точке номинала, отклонение, статус, поправки — для таблицы сеанса, журнала и трендов. */
export function beamSummary(r, kind = 'photon') {
  if (kind === 'cobalt') return cobaltSummary(r);
  const tg = r.protocol === 'tg51';
  const x = tg ? r.tg51 : r.trs;
  const atMax = kindOf(kind).atMax;
  const errors = r.messages.filter((m) => m.level === 'error').length;
  const warns = r.messages.filter((m) => m.level === 'warn').length;
  const ctrlFailed = !x.blocked && !!x.ctrl?.blocked;
  const pre = x.ctrl && !x.ctrl.blocked && !x.blocked ? x.ctrl : x;
  const p = x.recal && !x.recal.blocked && !x.blocked ? x.recal : pre;
  const at = r.depth.nominalAt === atMax && Number.isFinite(p.DmaxPerMU) ? atMax : 'zref';
  const value = x.blocked || ctrlFailed ? NaN : at === atMax ? p.DmaxPerMU : p.DperMU;
  const tol = r.depth.tolerance;
  const dev = x.blocked || ctrlFailed ? NaN : p.deviation;
  // доза могла посчитаться и при ошибке в другом месте формы (например, в пересчёте на d_max):
  // такой пучок показывается, но в журнал не записывается и «в допуске» не считается
  const hasValue = Number.isFinite(value);
  const ok = hasValue && errors === 0;
  return {
    ok,
    hasValue,
    value, // сГр/МЕ (= Гр на 100 МЕ) в точке номинала
    at, // 'zref' | 'dmax' (фотоны) | 'zmax' (электроны)
    DperMU: hasValue ? p.DperMU : NaN,
    DmaxPerMU: hasValue ? p.DmaxPerMU : NaN,
    deviation: dev,
    tol,
    status: !ok ? 'error' : !Number.isFinite(dev) ? 'nonominal' : Math.abs(dev) > tol ? 'out' : 'ok',
    source: p === x.recal ? 'recal' : p === x.ctrl ? 'ctrl' : 'main',
    preDeviation: p === x.recal ? x.recal.pre?.deviation : NaN,
    ksRaw: tg ? x.PionRaw : x.ksRaw,
    kpolRaw: tg ? x.PpolRaw : x.kpolRaw,
    ksFixed: !!(tg ? x.PionFixed : x.ksFixed),
    kQ: x.kQ,
    // при перекрёстной калибровке это не k_Q,Q₀: TRS-398 — k_Q,Qcross (ур. 30, 44), Report 385 — k′_Q (ур. 6)
    kQName: r.inputs?.cross ? (tg && kind === 'electron' ? 'k′_Q' : 'k_Q,Qcross') : 'k_Q',
    quality: kind === 'electron' ? r.quality?.r50 : tg ? x.pdd10x : x.tpr, // R50 (электроны), %dd(10)x или TPR20,10
    // калибровочные коэффициенты: их смена начинает новый отсчёт контрольной карты
    ndw: Number(r.inputs?.ndwEff),
    kelec: Number(r.inputs?.kelec),
    errors,
    warns,
  };
}
export const photonSummary = (r) => beamSummary(r, 'photon');

/**
 * Камера и электрометр сеанса по умолчанию для пучков данного вида на аппарате: те, которыми мерили в последнем записанном
 * сеансе этого аппарата; иначе — выбранные раньше у пучков (журналы до 0.21.0); иначе — первая подходящая камера и первый
 * электрометр. Возвращает { chamberId, electrometerId } (пустые строки, если выбрать не из чего).
 */
export function sessionEquipDefaults(j, machineId, kind) {
  const can = { photon: photonCapable, electron: electronCapable, cobalt: cobaltCapable }[kind] ?? photonCapable;
  const okCh = (id) => !!id && j.chambers.some((c) => c.id === id && can(c.form));
  const okEl = (id) => !!id && j.electrometers.some((e) => e.id === id);
  let chamberId = '';
  let electrometerId = '';
  const sessions = (j.sessions || []).filter((s) => s.machineId === machineId).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  for (const s of sessions) {
    for (const b of s.beams || []) {
      if (beamKind(b) !== kind) continue;
      if (!chamberId && okCh(b.chamberId)) chamberId = b.chamberId;
      if (!electrometerId && okEl(b.electrometerId)) electrometerId = b.electrometerId;
    }
    if (chamberId && electrometerId) break;
  }
  const m = machineOf(j, machineId);
  for (const b of m?.beams || []) {
    if (beamKind(b) !== kind) continue;
    if (!chamberId && okCh(b.chamberId)) chamberId = b.chamberId;
    if (!electrometerId && okEl(b.electrometerId)) electrometerId = b.electrometerId;
  }
  if (!chamberId) chamberId = j.chambers.find((c) => can(c.form))?.id ?? '';
  if (!electrometerId) electrometerId = j.electrometers[0]?.id ?? '';
  return { chamberId, electrometerId };
}

/** Расчёт пучка в сеансе. */
export function computeSessionBeam(j, session, beamInput, opts = {}) {
  const found = beamOf(j, beamInput.beamId);
  if (!found) return null;
  const machine = machineOf(j, session.machineId) || found.machine;
  const kind = beamKind(found.beam);
  const built = beamForm(j, session, machine, found.beam, beamInput, opts);
  const result = kindOf(kind).compute(built.form);
  // согласие с калибровкой камеры (электрометр, напряжение, полярность) — замечания к расчёту пучка
  if (!(beamInput.base && typeof beamInput.base === 'object')) {
    const notes = calibrationChecks(j, beamInput.chamberId || found.beam.chamberId, beamInput.electrometerId || found.beam.electrometerId, built.form, kind);
    if (notes.length && Array.isArray(result.messages)) result.messages.push(...notes.map((n) => ({ level: n.level, scope: 'common', text: n.text, ref: null, cal: true })));
  }
  // предыдущая калибровка этого пучка — для сравнения k_pol и k_s (изменение k_pol больше 0,2 % — повод выяснить причину)
  const prev = lastCalibration(j, found.beam.id, { before: session.date || '9999-12-31', exceptId: session.id });
  const summary = beamSummary(result, kind);
  if (prev && session.mode === 'cal' && Number.isFinite(summary.kpolRaw) && Number.isFinite(summary.ksRaw)) {
    summary.dKpol = (summary.kpolRaw / prev.kpol - 1) * 100;
    summary.dKs = (summary.ksRaw / prev.ks - 1) * 100;
  }
  return { ...built, prev, beam: found.beam, machine, result, summary };
}

// ---------------------------------------------------------------- проверка дозиметра второй камерой (core/journal-check.js)
/** Доза на МЕ (мощность дозы у ⁶⁰Co) на z_ref по основной серии — без контрольных измерений и подстройки. */
export function mainValue(r, kind = 'photon') {
  const x = r?.protocol === 'tg51' ? r.tg51 : r?.trs;
  if (!x || x.blocked) return NaN;
  return kind === 'cobalt' ? x.rate : x.DperMU;
}

/**
 * Настройки для расчёта второй камеры: пучок — как у рабочей камеры в этом сеансе (workForm — форма, по которой она
 * посчитана, с качеством пучка этого сеанса), камера и электрометр — свои: из журнала (chamberId, electrometerId; без
 * электрометра — тот же, что у рабочей камеры) или записанные при проверке (recorded — её форма).
 * От камеры зависят k_Q и (в пучке БВФ) k_vol: они берутся по модели второй камеры и длине её полости; k_Q и k_vol,
 * введённые для рабочей камеры, к ней не относятся — их можно ввести для второй (kQ, kvol). Поправка на рекомбинацию по
 * глубине для показателя качества — по k_s рабочей камеры (ks10): качество измерено ею. ⁶⁰Co: ошибка таймера — та же,
 * что у рабочей камеры (tau, в единицах времени пучка): она относится к аппарату, а не к камере.
 */
export function checkBase(j, workForm, kind, { chamberId = '', electrometerId = '', recorded = null, kQ = '', kvol = '', ks10 = NaN, tau = NaN, en = false } = {}) {
  const K = kindOf(kind);
  const six = (v) => (en ? v.toFixed(6) : v.toFixed(6).replace('.', ','));
  const exact = (v) => {
    const t = v.toFixed(12).replace(/0+$/, '').replace(/\.$/, '');
    return en ? t : t.replace('.', ',');
  };
  const ch = recorded ? null : chamberOf(j, chamberId);
  const el = recorded || !electrometerId ? null : electrometerOf(j, electrometerId);
  const b = {
    ...pick(workForm, K.beamKeys),
    ...(recorded ? pick(recorded, K.chamberKeys) : K.chamberForm(ch?.form || {})),
    ...(recorded ? pick(recorded, K.electrometerKeys) : el ? K.electrometerForm(el.form) : pick(workForm, K.electrometerKeys)),
  };
  const own = (v) => !isBlank(v);
  if (kind === 'photon') {
    if (own(kQ)) Object.assign(b, { kqtrs_mode: 'manual', kqtrs_manual: kQ, kq51_manual_on: true, kq51_manual: kQ });
    else {
      if (b.kqtrs_mode === 'manual') b.kqtrs_mode = 'formula';
      b.kq51_manual_on = false;
    }
    b.prof_length = '';
    if (own(kvol)) Object.assign(b, { prof_mode: 'manual', prof_value: kvol });
    else if (b.prof_mode === 'manual') b.prof_mode = 'formula22';
    if (b.q_rec_on && isBlank(b.q_rec_ks) && Number.isFinite(ks10)) b.q_rec_ks = six(ks10);
  } else if (kind === 'electron') {
    if (own(kQ)) Object.assign(b, { e_kqtrs_mode: 'manual', e_kqtrs_manual: kQ, e_kq51_mode: 'manual', e_kq51_manual: kQ });
    else {
      if (b.e_kqtrs_mode === 'manual') b.e_kqtrs_mode = 'table';
      if (b.e_kq51_mode === 'manual') b.e_kq51_mode = 'fit';
    }
  } else if (kind === 'cobalt' && b.co_timer_mode !== 'window' && b.co_timer_mode !== 'none') {
    b.co_timer_mode = 'manual';
    b.co_tau = Number.isFinite(tau) ? exact(tau) : '';
  }
  return b;
}

/**
 * Расчёт второй камеры проверки дозиметра по настройкам input.base (checkBase) и её показаниям. session.mode: 'cal' —
 * k_pol и k_s второй камеры измерены в этом сеансе, 'check' — заданы (input[fixedKpol], input[fixedKs]). Сравнения
 * с прошлой калибровкой пучка нет: та калибровка — рабочей камеры.
 */
export function computeCheckBeam(j, session, input, opts = {}) {
  const found = beamOf(j, input.beamId);
  if (!found) return null;
  const machine = machineOf(j, session.machineId) || found.machine;
  const kind = beamKind(found.beam);
  const built = beamForm(j, session, machine, found.beam, input, opts);
  const result = kindOf(kind).compute(built.form);
  return { ...built, beam: found.beam, machine, result, summary: beamSummary(result, kind) };
}

/** Сеанс для записи в журнал: у каждого пучка — показания, итог и форма, по которой он посчитан. */
export function finalizeSession(j, session, opts = {}) {
  const s = { ...session, id: session.id || uid('s'), saved: new Date().toISOString() };
  s.beams = session.beams
    .filter((b) => b.include !== false)
    .map((b) => {
      const c = computeSessionBeam(j, s, b, opts);
      const { base, ...rest } = b;
      return c ? { ...rest, kind: c.kind, chamberId: c.chamber?.id || b.chamberId || '', electrometerId: c.electrometer?.id || b.electrometerId || '', form: c.form, summary: c.summary } : rest;
    });
  return s;
}

/** Добавить или заменить сеанс в журнале (новый объект журнала). */
export function upsertSession(j, s) {
  // отметку «новый отсчёт контрольной карты» ставят в «Журнале и трендах»; повторная запись сеанса её не снимает
  const old = j.sessions.find((x) => x.id === s.id);
  const rec = old?.spcRestart && s.spcRestart === undefined ? { ...s, spcRestart: true } : s;
  const sessions = j.sessions.filter((x) => x.id !== s.id).concat([rec]).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return { ...j, sessions };
}

// ---------------------------------------------------------------- тренды
/** Ряды для графика: по каждому пучку аппарата — сеансы по дате с отклонением, k_s и k_pol. */
export function trendSeries(j, machineId) {
  const m = machineOf(j, machineId);
  if (!m) return [];
  return m.beams.map((beam) => {
    const points = [];
    for (const s of j.sessions) {
      if (s.machineId !== machineId) continue;
      const b = s.beams.find((x) => x.beamId === beam.id && x.summary);
      if (!b) continue;
      points.push({
        date: s.date,
        day: dayNumber(s.date),
        mode: s.mode,
        sessionId: s.id,
        deviation: b.summary.deviation,
        value: b.summary.value,
        tol: b.summary.tol,
        ks: b.summary.ksFixed ? NaN : b.summary.ksRaw,
        kpol: b.summary.ksFixed ? NaN : b.summary.kpolRaw,
        tau: b.summary.ksFixed ? NaN : b.summary.tauMin,
        status: b.summary.status,
      });
    }
    return { beam, kind: beamKind(beam), points: points.filter((p) => Number.isFinite(p.day)).sort((a, b) => a.day - b.day) };
  });
}

/**
 * Точки контрольной карты пучка (core/spc.js controlChart) по сеансам аппарата.
 * Сеанс с подстройкой ускорителя даёт две точки: «до подстройки» (последняя в прежнем отсчёте) и «после» — с неё
 * начинается новый отсчёт. Новый отсчёт начинается и при смене камеры, электрометра, N_D,w или k_elec (сравниваются
 * только известные значения: в сеансах до версии 0.16.0 коэффициенты не записывались) и по отметке «новый отсчёт»
 * у сеанса (session.spcRestart).
 */
export function controlPoints(j, machineId, beamId) {
  const out = [];
  let prev = null;
  const differs = (a, b) => !isBlank(a) && !isBlank(b) && a !== b;
  const differsNum = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a / b - 1) > 1e-9;
  for (const s of j.sessions) {
    if (s.machineId !== machineId) continue;
    const b = s.beams.find((x) => x.beamId === beamId && x.summary);
    const day = dayNumber(s.date);
    if (!b || !Number.isFinite(day) || !Number.isFinite(b.summary.deviation)) continue;
    const sum = b.summary;
    const sig = { chamberId: b.chamberId || '', electrometerId: b.electrometerId || '', ndw: Number(sum.ndw), kelec: Number(sum.kelec) };
    const equipment = prev && (differs(sig.chamberId, prev.chamberId) || differs(sig.electrometerId, prev.electrometerId) || differsNum(sig.ndw, prev.ndw) || differsNum(sig.kelec, prev.kelec));
    const base = { day, date: s.date, sessionId: s.id, mode: s.mode, tol: sum.tol };
    let restart = equipment ? 'equipment' : s.spcRestart ? 'manual' : '';
    if (sum.source === 'recal' && Number.isFinite(sum.preDeviation)) {
      out.push({ ...base, value: sum.preDeviation, stage: 'found', restart: !!restart, reason: restart || undefined });
      restart = 'adjust';
    }
    out.push({ ...base, value: sum.deviation, stage: restart === 'adjust' ? 'left' : 'single', restart: !!restart && out.length > 0, reason: restart || undefined });
    prev = sig;
  }
  return out;
}

// ---------------------------------------------------------------- перенос из вкладок дозиметрии
const norm = (s) => String(s ?? '').trim().toLowerCase();
const sameElectrometer = (ef, f) => norm(ef.el_model) === norm(f.el_model) && norm(ef.el_serial) === norm(f.el_serial);
/**
 * Та же камера: модель и № (у своей камеры — и её модель, у «другой» — название). Для электронов модель сравнивается
 * так, как камера видна на вкладке «Электроны» (своя цилиндрическая камера там — «другая» с тем же названием).
 */
function sameChamber(cf, chForm, kind) {
  if (norm(cf.ch_serial) !== norm(chForm.ch_serial)) return false;
  if (kind === 'cobalt') {
    // как камера видна на вкладке «⁶⁰Co»: «другая» и своя — своей камерой с тем же названием и типом
    const a = cobaltChamberForm(cf);
    const b = cobaltChamberForm(chForm);
    if (a.co_ch_model !== b.co_ch_model) return false;
    return a.co_ch_model !== 'CUSTOM' || (norm(a.co_cc_model) === norm(b.co_cc_model) && a.co_cc_type === b.co_cc_type);
  }
  if (kind === 'electron') {
    const a = electronChamberForm(cf);
    if (a.e_ch_model !== chForm.ch_model) return false;
    return chForm.ch_model !== 'OTHER' || norm(a.e_other_name) === norm(chForm.e_other_name);
  }
  if (cf.ch_model !== chForm.ch_model) return false;
  return chForm.ch_model !== 'CUSTOM' || norm(cf.cc_model) === norm(chForm.cc_model);
}
/** Форма вкладки: нормализованная; «Мои камеры» хранятся в браузере — в журнал камера попадает своими полями. */
function tabForm(form, kind) {
  if (kind === 'electron') return normalizeElectrons(form);
  if (kind === 'cobalt') {
    const f = normalizeCobalt(form);
    if (String(f.co_ch_model).startsWith('MY:')) f.co_ch_model = 'CUSTOM';
    // поля своей камеры у камеры из базы скрыты и не относятся к ней: не сравнивать и не переносить
    if (f.co_ch_model !== 'CUSTOM') Object.assign(f, { co_cc_maker: CO_DEFAULTS.co_cc_maker, co_cc_model: CO_DEFAULTS.co_cc_model, co_cc_type: CO_DEFAULTS.co_cc_type });
    return f;
  }
  const f = normalizeForm(form);
  if (String(f.ch_model).startsWith('MY:')) f.ch_model = 'CUSTOM';
  // то же у фотонов: поля своей камеры у камеры из базы — от прежней своей камеры
  if (f.ch_model !== 'CUSTOM') for (const k of PH_CHAMBER_KEYS) if (k.startsWith('cc_')) f[k] = FORM_DEFAULTS[k];
  return f;
}
const copyJournal = (j) => ({ ...j, chambers: j.chambers.map((c) => ({ ...c, form: { ...c.form } })), electrometers: j.electrometers.map((e) => ({ ...e, form: { ...e.form } })), machines: j.machines.map((m) => ({ ...m, beams: m.beams.map((b) => ({ ...b, form: { ...b.form } })) })) });
/** Камера формы вкладки: найти в журнале по модели и номеру или добавить (в копии журнала). chForm — поля записи. */
function matchChamber(journal, chForm, kind) {
  const ch = journal.chambers.find((c) => sameChamber(c.form, chForm, kind));
  if (ch || isBlank(chForm.ch_model)) return { ch: ch ?? null, added: false };
  const added = { ...CHAMBER_DEFAULTS, id: uid('ch'), form: { ...chForm } };
  journal.chambers.push(added);
  return { ch: added, added: true };
}
/** Электрометр: найти по модели и номеру или добавить. elForm — поля записи (el_model, el_serial, el_kelec). */
function matchElectrometer(journal, elForm) {
  const el = journal.electrometers.find((e) => sameElectrometer(e.form, elForm));
  if (el || (isBlank(elForm.el_model) && isBlank(elForm.el_serial) && isBlank(elForm.el_kelec))) return { el: el ?? null, added: false };
  const added = { ...ELECTROMETER_DEFAULTS, id: uid('el'), form: { ...elForm } };
  journal.electrometers.push(added);
  return { el: added, added: true };
}
/**
 * Поля записи камеры, которые вкладка данного вида может изменить (у электронов и ⁶⁰Co модель записи не трогаем).
 * recForm — запись журнала: у своей камеры и камеры из базы, показанных на вкладке «Электроны» «другой» камерой,
 * название и тип не записываются, а радиус своей камеры записывается в её параметр cc_radius.
 */
const chamberUpdate = (chForm, kind, recForm = {}) => {
  if (kind !== 'electron' && kind !== 'cobalt') return chForm;
  const { ch_model, ...rest } = chForm;
  if (kind === 'electron' && recForm.ch_model !== 'OTHER') {
    const { e_other_name, e_other_type, e_other_r, ...own } = rest;
    if (recForm.ch_model === 'CUSTOM' && e_other_r !== undefined) own.cc_radius = e_other_r;
    return own;
  }
  if (kind === 'cobalt') {
    // своя камера вкладки «⁶⁰Co» — это своя камера, «другая» или камера из базы электронов записи: её название
    // хранится в поле своего вида, остальные поля названия в запись не попадают
    const { e_other_name, e_other_type, cc_maker, cc_model, ...own } = rest;
    if (recForm.ch_model === 'OTHER') return { ...own, ...pick(rest, ['e_other_name', 'e_other_type']) };
    if (recForm.ch_model === 'CUSTOM') return { ...own, ...pick(rest, ['cc_maker', 'cc_model']) };
    return own;
  }
  return rest;
};

/**
 * Пучок из формы вкладки («МВ фотоны», «Электроны» или «⁶⁰Co»): настройки пучка и последний показатель качества; камера и
 * электрометр находятся в журнале по модели и номеру или добавляются.
 * Возвращает { journal, beam, addedChamber, addedElectrometer }.
 */
export function beamFromTabForm(j, machineId, form, kind = 'photon') {
  const K = kindOf(kind);
  const f = tabForm(form, kind);
  const journal = copyJournal(j);
  const { ch, added: addedChamber } = matchChamber(journal, K.chamberFromTab(f), kind);
  const { el, added: addedElectrometer } = matchElectrometer(journal, K.electrometerFromTab(f));
  const name = kind === 'cobalt'
    ? `⁶⁰Co, ${f.co_geometry === 'SAD' ? L('РИК', 'SCD') : L('РИП', 'SSD')} ${String(f.co_distance || '').trim() || '—'} ${L('см', 'cm')}`
    : String(f[K.k.beam] || '').trim() || (kind === 'electron' ? L('Пучок электронов', 'Electron beam') : L('Пучок фотонов', 'Photon beam'));
  const beamForm = pick(f, K.beamKeys);
  if (kind === 'electron') {
    if (isBlank(beamForm.e_energy)) {
      const e = parseElectronBeam(name).energy;
      if (Number.isFinite(e)) beamForm.e_energy = String(e).replace('.', ',');
    }
  } else if (kind === 'photon') beamForm.meta_fff = !!f.meta_fff || !!parseBeamName(name).fff;
  const beam = { ...BEAM_DEFAULTS, id: uid('b'), kind, name, chamberId: ch?.id ?? '', electrometerId: el?.id ?? '', form: beamForm };
  const m = journal.machines.find((x) => x.id === machineId);
  if (m) m.beams.push(beam);
  return { journal, beam, addedChamber, addedElectrometer };
}
/** Прежнее имя (фотоны). */
export const beamFromPhotonsForm = (j, machineId, form) => beamFromTabForm(j, machineId, form, 'photon');

/**
 * Настройки пучка, отредактированные на вкладке («Все настройки»), — обратно в журнал.
 * Камера и электрометр записи журнала общие для нескольких пучков (и для фотонов, и для электронов), поэтому другая
 * модель или номер на вкладке означает другую камеру: она находится в журнале или добавляется, а прежняя запись не
 * меняется. Та же камера (модель и номер совпали) обновляется полями вкладки — это та же физическая камера и для
 * других пучков.
 * Возвращает { journal, chamber: 'same' | 'found' | 'added' | 'none', electrometer: …, sharedChamber, sharedElectrometer }.
 */
export function applyTabFormToBeam(j, machineId, beamId, form, kind = 'photon') {
  const K = kindOf(kind);
  const f = tabForm(form, kind);
  const journal = copyJournal(j);
  const m = journal.machines.find((x) => x.id === machineId);
  const b = m?.beams.find((x) => x.id === beamId);
  if (!b) return { journal: j, chamber: 'none', electrometer: 'none', sharedChamber: [], sharedElectrometer: [] };
  b.form = { ...pick(f, K.beamKeys) };
  // длина полости, подставленная из записи камеры, — не своя длина пучка: в пучок не записывается
  const chamberRec = journal.chambers.find((c) => c.id === b.chamberId);
  if (kind === 'photon' && chamberRec && !isBlank(chamberRec.length) && sameValue(b.form.prof_length, chamberRec.length)) b.form.prof_length = '';
  if (K.k.beam && !isBlank(f[K.k.beam])) b.name = String(f[K.k.beam]).trim();
  // другие пучки с той же записью — только если запись действительно изменилась (иначе сообщать не о чем)
  const others = (key, id) => journal.machines.flatMap((mm) => mm.beams.filter((x) => x.id !== beamId && x[key] === id).map((x) => `${mm.name} — ${x.name}`));
  const changed = (current, keys) => {
    const a = K.normalize({ ...K.defaults, ...current });
    return keys.some((key) => String(a[key] ?? '') !== String(f[key] ?? ''));
  };
  const chForm = K.chamberFromTab(f);
  const elForm = K.electrometerFromTab(f);
  const res = { journal, chamber: 'none', electrometer: 'none', sharedChamber: [], sharedElectrometer: [] };
  const cur = journal.chambers.find((c) => c.id === b.chamberId);
  if (cur && sameChamber(cur.form, chForm, kind)) {
    if (changed(K.chamberForm(cur.form), K.chamberKeys)) res.sharedChamber = others('chamberId', cur.id);
    cur.form = { ...cur.form, ...chamberUpdate(chForm, kind) };
    res.chamber = 'same';
  } else if (!isBlank(chForm.ch_model)) {
    const { ch, added } = matchChamber(journal, chForm, kind);
    if (!added) ch.form = { ...ch.form, ...chamberUpdate(chForm, kind, ch.form) };
    b.chamberId = ch.id;
    res.chamber = added ? 'added' : 'found';
  }
  const curEl = journal.electrometers.find((e) => e.id === b.electrometerId);
  if (curEl && sameElectrometer(curEl.form, elForm)) {
    if (changed(K.electrometerForm(curEl.form), K.electrometerKeys)) res.sharedElectrometer = others('electrometerId', curEl.id);
    curEl.form = { ...curEl.form, ...elForm };
    res.electrometer = 'same';
  } else if (!isBlank(elForm.el_model) || !isBlank(elForm.el_serial)) {
    const { el, added } = matchElectrometer(journal, elForm);
    if (!added) el.form = { ...el.form, ...elForm };
    b.electrometerId = el.id;
    res.electrometer = added ? 'added' : 'found';
  }
  return res;
}
/** Прежнее имя (фотоны). */
export const applyPhotonsFormToBeam = (j, machineId, beamId, form) => applyTabFormToBeam(j, machineId, beamId, form, 'photon');

/** Средние показания пучка (для таблицы сеанса). */
export const meanOf = mean;

// ---------------------------------------------------------------- камеры отделения на вкладках дозиметрии
// Вкладка дозиметрии видит камеры и электрометры журнала: выбор подставляет их поля, а если поля вкладки отличаются от
// записи журнала (например, N_D,w после новой поверки), это видно, и можно взять значения из журнала или записать в него.

/** Поля камеры вкладки, которые сравниваются с журналом: без модели и номера и без того, что сейчас не используется. */
function chamberCompareKeys(kind, f, rec = {}) {
  return kindOf(kind).chamberKeys.filter((k) => {
    if (/(^|_)ch_(model|serial)$/.test(k)) return false;
    if (/lab_kpol$/.test(k)) return !f[k.replace('lab_kpol', 'lab_pol_applied')];
    if (/lab_ks$/.test(k)) return !f[k.replace('lab_ks', 'lab_ks_applied')];
    if (kind === 'photon') {
      if (/^ch_cross_/.test(k)) return f.ch_cal_route === 'cross';
      if (/^ch_(ndw|ndw_unit|klab)$/.test(k)) return f.ch_cal_route !== 'cross';
      if (/^cc_/.test(k)) return f.ch_model === 'CUSTOM';
    }
    if (kind === 'electron') {
      if (/^e_cross_/.test(k)) return f.e_cal_route === 'cross';
      if (/^e_(ndw|ndw_unit|klab)$/.test(k)) return f.e_cal_route !== 'cross';
      if (/^e_other_/.test(k)) {
        if (f.e_ch_model !== 'OTHER') return false;
        // своя камера и камера из базы фотонов: название и тип — от записи; радиус своей камеры сравнивается, из базы — нет
        if (rec.ch_model !== 'OTHER') return k === 'e_other_r' && rec.ch_model === 'CUSTOM';
        return k !== 'e_other_r' || f.e_other_type === 'cyl';
      }
    }
    // ⁶⁰Co: название и тип своей камеры — её тождество (по ним камера найдена), на расчёт не влияют (k_Q = 1)
    if (kind === 'cobalt' && /^co_cc_/.test(k)) return false;
    return true;
  });
}

/** Одинаковые значения поля: числа сравниваются как числа (1,000 = 1), флажки — как флажки, текст — без пробелов по краям. */
function sameValue(a, b) {
  if (typeof a === 'boolean' || typeof b === 'boolean') return !!a === !!b;
  const x = parseNumber(a);
  const y = parseNumber(b);
  if (Number.isFinite(x) && Number.isFinite(y)) return Math.abs(x - y) <= 1e-12 * Math.max(1, Math.abs(x));
  return String(a ?? '').trim() === String(b ?? '').trim();
}

/**
 * Камера и электрометр вкладки в журнале: найденные записи (по модели и номеру) и поля, которые отличаются.
 * Возвращает { chamber, chamberDiffs: [{ key, tab, journal }], electrometer, electrometerDiffs }.
 */
export function tabEquipment(j, form, kind = 'photon') {
  const K = kindOf(kind);
  const f = tabForm(form, kind);
  const chForm = K.chamberFromTab(f);
  const elForm = K.electrometerFromTab(f);
  const chamber = isBlank(chForm.ch_model) ? null : j.chambers.find((c) => sameChamber(c.form, chForm, kind)) ?? null;
  const elBlank = isBlank(elForm.el_model) && isBlank(elForm.el_serial);
  const electrometer = elBlank ? null : j.electrometers.find((e) => sameElectrometer(e.form, elForm)) ?? null;
  // запись журнала на вкладке: поля, которых в записи нет, — по умолчанию (а не как на вкладке)
  const diffs = (rec, recToTab, keys, own) => {
    if (!rec) return [];
    const jf = K.normalize({ ...K.defaults, ...f, ...Object.fromEntries(own.map((k) => [k, K.defaults[k]])), ...recToTab(rec.form) });
    return keys.filter((k) => !sameValue(f[k], jf[k])).map((k) => ({ key: k, tab: f[k], journal: jf[k] }));
  };
  return {
    chamber,
    chamberDiffs: diffs(chamber, K.chamberForm, chamberCompareKeys(kind, f, chamber?.form), K.chamberKeys),
    electrometer,
    electrometerDiffs: diffs(electrometer, K.electrometerForm, K.electrometerKeys.filter((k) => !/_(model|serial)$/.test(k)), K.electrometerKeys),
    hasChamber: !isBlank(chForm.ch_model),
    hasElectrometer: !elBlank,
  };
}

/** Поля вкладки из записи камеры (электрометра) журнала — для «взять из журнала». */
// поля, которых в записи нет, — по умолчанию (как их видит сверка tabEquipment), а не прежние значения вкладки
export const chamberTabFields = (rec, kind = 'photon') => {
  const K = kindOf(kind);
  return { ...pick(K.defaults, K.chamberKeys), ...K.chamberForm(rec?.form || {}) };
};
export const electrometerTabFields = (rec, kind = 'photon') => {
  const K = kindOf(kind);
  return { ...pick(K.defaults, K.electrometerKeys), ...K.electrometerForm(rec?.form || {}) };
};

/**
 * Записать камеру и (или) электрометр вкладки в журнал: та же запись (модель и номер совпали) обновляется полями вкладки
 * (у электронов и ⁶⁰Co модель записи не меняется), иначе добавляется новая. Возвращает
 * { journal, chamber: 'updated' | 'added' | 'none', electrometer: …, chamberId, electrometerId }.
 */
export function applyTabEquipment(j, form, kind = 'photon', { chamber = true, electrometer = true } = {}) {
  const K = kindOf(kind);
  const f = tabForm(form, kind);
  const journal = copyJournal(j);
  const res = { journal, chamber: 'none', electrometer: 'none', chamberId: '', electrometerId: '' };
  if (chamber) {
    const chForm = K.chamberFromTab(f);
    if (!isBlank(chForm.ch_model)) {
      const { ch, added } = matchChamber(journal, chForm, kind);
      if (!added) ch.form = { ...ch.form, ...chamberUpdate(chForm, kind, ch.form) };
      res.chamber = added ? 'added' : 'updated';
      res.chamberId = ch.id;
    }
  }
  if (electrometer) {
    const elForm = K.electrometerFromTab(f);
    if (!isBlank(elForm.el_model) || !isBlank(elForm.el_serial)) {
      const { el, added } = matchElectrometer(journal, elForm);
      if (!added) el.form = { ...el.form, ...elForm };
      res.electrometer = added ? 'added' : 'updated';
      res.electrometerId = el.id;
    }
  }
  return res;
}

/**
 * «Мои камеры» браузера (свои камеры вкладок, без номера и N_D,w) → записи журнала: цилиндрическая — своя камера
 * (поля cc_*), плоскопараллельная — «другая». Камеры с той же моделью, что уже есть в журнале, пропускаются.
 * Возвращает { journal, added: [названия] }.
 */
export function myChambersToJournal(j, mine) {
  const journal = copyJournal(j);
  const added = [];
  // та же камера могла попасть в журнал своей (с «МВ фотонов») или «другой» (с «Электронов» или «⁶⁰Co»)
  const has = (name) =>
    journal.chambers.some((c) => (c.form.ch_model === 'OTHER' && norm(c.form.e_other_name) === norm(name)) || (c.form.ch_model === 'CUSTOM' && norm([c.form.cc_maker, c.form.cc_model].filter((x) => !isBlank(x)).join(' ')) === norm(name)));
  for (const m of Array.isArray(mine) ? mine : []) {
    const name = [m.cc_maker, m.cc_model].filter((x) => !isBlank(x)).join(' ');
    if (isBlank(name)) continue;
    const pp = m.cc_type === 'pp';
    if (has(name)) continue;
    const form = pp
      ? { ch_model: 'OTHER', e_other_name: name, e_other_type: 'pp', ch_serial: '', ch_ndw: '', ch_ndw_unit: 'Gy/nC', ch_klab: '1,000', ch_T0: '20', ch_P0: '101,325' }
      : { ch_model: 'CUSTOM', ...Object.fromEntries(PH_CHAMBER_KEYS.filter((k) => k.startsWith('cc_') && k in m).map((k) => [k, m[k]])), ch_serial: '', ch_ndw: '', ch_ndw_unit: 'Gy/nC', ch_klab: '1,000', ch_T0: '20', ch_P0: '101,325' };
    journal.chambers.push({ ...CHAMBER_DEFAULTS, id: uid('ch'), form, notes: '' });
    added.push(name);
  }
  return { journal, added };
}

// ---------------------------------------------------------------- измерение во вкладке дозиметрии → журнал
// Пучок журнала выбирается во вкладке «⁶⁰Co», «МВ фотоны» или «Электроны»: настройки пучка, камера и электрометр
// подставляются во вкладку, измерение идёт со всеми поправками, а результат кнопкой «Записать в журнал» попадает в
// журнал. Пучки одного аппарата за один день в одном режиме (калибровка или проверка выхода) и по одному протоколу —
// одна запись (сеанс), как и раньше: тренды, контрольная карта и последняя калибровка читаются из неё.

const SESSION_KEYS = { photon: PH_SESSION_KEYS, electron: E_SESSION_KEYS, cobalt: CO_SESSION_KEYS };
const fixedOf = (form, kind) => !!form?.[kindOf(kind).k.fixed];

/**
 * Поля пучка журнала для вкладки: настройки пучка, камера и электрометр сеанса (по умолчанию — которыми мерили этот
 * аппарат последний раз), учреждение, аппарат и пучок. В режиме проверки выхода (во вкладке включена «Проверка выхода»)
 * — k_pol, k_s (у ⁶⁰Co и τ) и качество пучка из последней калибровки пучка в журнале; при калибровке качество пучка
 * очищается: его измеряют. Показания, условия, дата и сотрудники вкладки не меняются.
 * equip — { chamberId, electrometerId } (по умолчанию — sessionEquipDefaults). Возвращает { patch, last, kind } или null.
 */
export function tabBeamPatch(j, machineId, beamId, tab = {}, equip = null) {
  const found = beamOf(j, beamId);
  const machine = machineOf(j, machineId) || found?.machine;
  if (!found || !machine) return null;
  const kind = beamKind(found.beam);
  const K = kindOf(kind);
  const k = K.k;
  const check = fixedOf(tab, kind);
  const eq = equip || sessionEquipDefaults(j, machine.id, kind);
  const date = String(tab[k.date] || '') || '9999-12-31';
  const session = { ...SESSION_DEFAULTS, id: '', machineId: machine.id, date, mode: check ? 'check' : 'cal', protocol: tab.protocol === 'tg51' ? 'tg51' : 'trs' };
  const { form, last } = beamForm(j, session, machine, found.beam, { chamberId: eq.chamberId, electrometerId: eq.electrometerId });
  const keys = [...K.beamKeys, ...K.chamberKeys, ...K.electrometerKeys, k.institution, k.machine, k.beam].filter(Boolean);
  if (check) keys.push(k.fixed, k.fixedKpol, k.fixedKs, k.fixedFrom);
  const patch = Object.fromEntries(keys.filter((x) => x in form).map((x) => [x, form[x]]));
  // пустое учреждение журнала не стирает учреждение вкладки; энергия — по названию пучка, если в настройках её нет
  if (isBlank(patch[k.institution])) delete patch[k.institution];
  if (kind === 'photon' && isBlank(patch.meta_energy)) {
    const e = parseBeamName(found.beam.name).energy;
    if (Number.isFinite(e)) patch.meta_energy = String(e).replace('.', ',');
  }
  if (kind === 'electron' && isBlank(patch.e_energy)) {
    const e = parseElectronBeam(found.beam.name).energy;
    if (Number.isFinite(e)) patch.e_energy = String(e).replace('.', ',');
  }
  if (!check) for (const q of K.qualityKeys) patch[q] = '';
  return { patch, last, kind, chamberId: eq.chamberId, electrometerId: eq.electrometerId };
}

/** Запись журнала (сеанс) для измерения вкладки: тот же аппарат, дата, режим и протокол; null — такой ещё нет. */
export function tabSessionOf(j, { machineId, form, kind = 'photon' }) {
  const k = kindOf(kind).k;
  const date = String(form?.[k.date] || '');
  const mode = fixedOf(form, kind) ? 'check' : 'cal';
  const protocol = form?.protocol === 'tg51' ? 'tg51' : 'trs';
  return j.sessions.find((x) => x.machineId === machineId && x.date === date && x.mode === mode && (x.protocol === 'tg51' ? 'tg51' : 'trs') === protocol) ?? null;
}

/** Запись вкладки в журнале, если она уже есть: тот же пучок, аппарат, дата, режим и протокол. */
export function tabRecordOf(j, { machineId, beamId, form, kind = 'photon' }) {
  const s = tabSessionOf(j, { machineId, form, kind });
  const b = s?.beams.find((x) => x.beamId === beamId);
  return s && b ? { session: s, beam: b } : null;
}

/**
 * Записать измерение вкладки в журнал. form — форма вкладки (как её считает вкладка), kind — вид пучка.
 * Дата — из вкладки (без даты не записывается), режим — «Проверка выхода» вкладки, протокол — из формы.
 * Возвращает { journal, session, replaced, chamberFound, electrometerFound } или { error }.
 */
export function recordTabBeam(j, { machineId, beamId, form, kind = 'photon' }) {
  const found = beamOf(j, beamId);
  const machine = machineOf(j, machineId);
  if (!found || !machine || found.machine.id !== machine.id) return { error: L('Пучок не найден в журнале: выберите аппарат и пучок заново.', 'The beam was not found in the journal: select the machine and beam again.') };
  if (beamKind(found.beam) !== kind) return { error: L('Пучок журнала другого вида: выберите пучок этой вкладки.', 'The journal beam is of another kind: select a beam for this tab.') };
  const K = kindOf(kind);
  const k = K.k;
  const f = K.normalize({ ...K.defaults, ...form });
  const date = String(f[k.date] || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: L('Укажите дату измерения в разделе 1: по ней измерение ложится в журнал.', 'Enter the measurement date in section 1: the measurement is filed in the journal by it.') };
  const result = K.compute(f);
  const summary = beamSummary(result, kind);
  if (!summary.ok) return { error: L('Есть ошибки в расчёте (см. «Замечания»): исправьте их, затем запишите в журнал.', 'The calculation has errors (see Messages): fix them, then record to the journal.') };
  const t = tabEquipment(j, f, kind);
  const mode = fixedOf(f, kind) ? 'check' : 'cal';
  const protocol = f.protocol === 'tg51' ? 'tg51' : 'trs';
  const old = tabRecordOf(j, { machineId, beamId, form: f, kind });
  const staff = Array.isArray(f[k.staff]) ? f[k.staff].filter((x) => !isBlank(x)) : [];
  const env = { T: String(f[k.T] ?? ''), P: String(f[k.P] ?? ''), P_unit: f[k.PUnit] || 'kPa', H: String(f[k.H] ?? '') };
  const entry = {
    ...pick(f, SESSION_KEYS[kind]),
    beamId,
    kind,
    include: true,
    chamberId: t.chamber?.id ?? '',
    electrometerId: t.electrometer?.id ?? '',
    form: f,
    summary,
    source: 'tab',
  };
  const base = tabSessionOf(j, { machineId, form: f, kind }) ?? { ...SESSION_DEFAULTS, id: uid('s'), machineId, date, mode, protocol, beams: [] };
  // сотрудники записи — все, кто мерил пучки этой записи
  const allStaff = [...new Set([...(base.staff || []).filter((x) => !isBlank(x)), ...staff])];
  const session = {
    ...base,
    staff: allStaff.length ? allStaff : [''],
    env: base.beams.length ? base.env : env,
    beams: [...base.beams.filter((x) => x.beamId !== beamId), entry],
    saved: new Date().toISOString(),
  };
  return { journal: upsertSession(j, session), session, replaced: !!old, chamberFound: !!t.chamber, electrometerFound: !!t.electrometer };
}

/**
 * Расчёт вкладки как рабочей камеры пучка журнала — для проверки дозиметра второй камерой (core/journal-check.js):
 * { kind, form, result, summary, beam, machine, chamber, electrometer } (камера и электрометр — записи журнала,
 * найденные по модели и №; null, если их там нет).
 */
export function tabWork(j, beamId, form, kind = 'photon') {
  const found = beamOf(j, beamId);
  if (!found) return null;
  const K = kindOf(kind);
  const f = K.normalize({ ...K.defaults, ...form });
  const result = K.compute(f);
  const t = tabEquipment(j, f, kind);
  return { kind, form: f, result, summary: beamSummary(result, kind), beam: found.beam, machine: found.machine, chamber: t.chamber, electrometer: t.electrometer };
}
