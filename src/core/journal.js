// Журнал калибровок (вкладка «Журнал»): оборудование отделения — камеры, электрометры, аппараты с пучками —
// и сеансы на весь аппарат: калибровка (k_pol и k_s измеряются для каждого пучка) или проверка выхода (k_pol и k_s
// берутся из последней калибровки этого же пучка). Всё хранится одним файлом JSON, который можно держать на общем
// диске отделения.
//
// Расчёт каждого пучка выполняет ядро вкладки дозиметрии (photons.js — фотоны, electrons.js — электроны): форма
// вкладки собирается из профиля пучка, записи камеры, записи электрометра и показаний сеанса. В сеанс записывается
// и сама форма — результат старого сеанса воспроизводится, даже если потом изменились N_D,w камеры или настройки пучка.
//
// Запись камеры одна для фотонов и электронов (та же физическая камера, тот же N_D,w): общие поля хранятся под
// именами вкладки «МВ фотоны» (ch_model, ch_ndw, …), а то, что есть только у электронов (перекрёстная калибровка
// в пучке электронов, «другая камера»), — под именами вкладки «Электроны» (e_cal_route, e_cross_*, e_other_*).

import { computePhotons, FORM_DEFAULTS, normalizeForm } from './photons.js';
import { computeElectrons, E_DEFAULTS, normalizeElectrons, parseElectronBeam } from './electrons.js';
import { findChamber, chamberLabel } from './chambers.js';
import { findEChamber, eChamberLabel } from './electron-chambers.js';
import { parseNumber, isBlank, parseBeamName } from './units.js';
import { L } from './i18n.js';

export const JOURNAL_TAG = { app: 'reference-dosimetry', module: 'journal', version: 1 };

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

// общие поля записи камеры: имя на вкладке «МВ фотоны» ↔ имя на вкладке «Электроны»
const CH_COMMON = [['ch_serial', 'e_ch_serial'], ['ch_ndw', 'e_ndw'], ['ch_ndw_unit', 'e_ndw_unit'], ['ch_klab', 'e_klab'], ['ch_T0', 'e_T0'], ['ch_P0', 'e_P0'], ['lab_pol_applied', 'e_lab_pol_applied'], ['lab_kpol', 'e_lab_kpol'], ['lab_ks_applied', 'e_lab_ks_applied'], ['lab_ks', 'e_lab_ks']];
// только для электронов
const CH_E_ONLY = ['e_cal_route', 'e_cross_ndw', 'e_cross_ndw_unit', 'e_cross_r50', 'e_cross_kn', 'e_cross_kn_unit', 'e_other_name', 'e_other_type', 'e_other_r'];
const EL_COMMON = [['el_model', 'e_el_model'], ['el_serial', 'e_el_serial'], ['el_kelec', 'e_kelec']];

/** Для каких пучков журнала выбрана камера: { photon, electron }. */
export function chamberUses(j, chamberId) {
  const u = { photon: false, electron: false };
  for (const m of j.machines) for (const b of m.beams) if (b.chamberId === chamberId && b.active !== false) u[b.kind === 'electron' ? 'electron' : 'photon'] = true;
  return u;
}
/** Камеру можно взять для фотонов: она есть в базе вкладки «МВ фотоны» или своя. */
export const photonCapable = (cf) => !!findChamber(cf?.ch_model) || cf?.ch_model === 'CUSTOM' || String(cf?.ch_model || '').startsWith('MY:');
/** Камеру можно взять для электронов: она есть в базе вкладки «Электроны», «другая» или своя (цилиндрическая). */
export const electronCapable = (cf) => !!findEChamber(cf?.ch_model) || cf?.ch_model === 'OTHER' || cf?.ch_model === 'CUSTOM';

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
    out.e_other_r = cf.cc_radius ?? '';
  }
  for (const [ph, e] of CH_COMMON) if (ph in cf) out[e] = cf[ph];
  for (const k of CH_E_ONLY) if (k in cf && !isBlank(cf[k])) out[k] = cf[k];
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

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj && k in obj).map((k) => [k, obj[k]]));

// ---------------------------------------------------------------- записи по умолчанию
export const CHAMBER_DEFAULTS = { id: '', kind: 'photon', form: {}, calDate: '', dueDate: '', notes: '' };
export const ELECTROMETER_DEFAULTS = { id: '', form: {}, calDate: '', dueDate: '', notes: '' };
export const MACHINE_DEFAULTS = { id: '', name: '', serial: '', kind: 'linac', notes: '', beams: [] };
export const BEAM_DEFAULTS = { id: '', kind: 'photon', name: '', chamberId: '', electrometerId: '', form: {}, active: true };
export const SESSION_DEFAULTS = { id: '', machineId: '', date: '', mode: 'cal', protocol: 'trs', staff: [''], notes: '', env: { T: '', P: '', P_unit: 'kPa', H: '' }, beams: [], saved: '' };

export function newJournal() {
  return { ...JOURNAL_TAG, institution: '', chambers: [], electrometers: [], machines: [], sessions: [] };
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
export function electrometerText(e) {
  if (!e) return '';
  const f = e.form || {};
  return [isBlank(f.el_model) ? L('электрометр', 'electrometer') : f.el_model, isBlank(f.el_serial) ? '' : `${L('№', 'S/N')} ${f.el_serial}`].filter(Boolean).join(' ');
}
/**
 * Чего не хватает записи камеры для расчёта: модель и калибровочные коэффициенты — N_D,w в ⁶⁰Co или перекрёстные
 * (для фотонов — N_D,w,Qcross и TPR20,10, для электронов — N_D,w,Qcross с R50 или (k_Qecal·N_D,w)pp).
 * uses — для каких пучков камера выбрана ({ photon, electron }); без него — для фотонов, если камера для них годится.
 */
export function chamberMissing(c, uses = null, protocol = '') {
  const f = c?.form || {};
  if (isBlank(f.ch_model)) return [L('модель', 'model')];
  const u = uses && (uses.photon || uses.electron) ? uses : photonCapable(f) ? { photon: true } : { electron: true };
  const ph = !!u.photon && photonCapable(f);
  const el = !!u.electron && electronCapable(f);
  const phCross = ph && f.ch_cal_route === 'cross';
  const elCross = el && f.e_cal_route === 'cross';
  const needNdw = (ph && !phCross) || (el && !elCross);
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
};
const kindOf = (kind) => KINDS[kind === 'electron' ? 'electron' : 'photon'];
/** Имена полей сеанса для пучка данного вида: показания, проверка выхода, качество пучка. */
export const beamKeys = (kind) => ({ ...kindOf(kind).k, quality: kindOf(kind).qualityKeys });
/** Вид пучка по записи ('photon' | 'electron'). */
export const beamKind = (beam) => (beam?.kind === 'electron' ? 'electron' : 'photon');

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
  return {
    date: best.session.date,
    sessionId: best.session.id,
    ks: best.beam.summary.ksRaw,
    kpol: best.beam.summary.kpolRaw,
    quality: pick(best.beam.form || {}, K.qualityKeys),
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
  return pick(form, [...K.beamKeys, ...K.chamberKeys, ...K.electrometerKeys, K.k.fixedKpol, K.k.fixedKs, K.k.fixedFrom]);
}

/**
 * Форма вкладки дозиметрии для пучка в сеансе: профиль пучка + камера + электрометр + показания.
 * input — показания пучка в сеансе (имена полей вкладки: rd_M1… у фотонов, e_M1… у электронов) и свои условия
 * env_T, env_P. input.base — настройки из записанного сеанса (recordedBase): открытый из журнала сеанс считается по
 * ним, а не по сегодняшнему оборудованию, иначе после смены N_D,w камеры старый сеанс тихо показал бы другую дозу.
 * В режиме проверки k_pol и k_s берутся из последней калибровки этого пучка (до даты сеанса); каждое можно задать вручную.
 */
export function beamForm(j, session, machine, beam, input = {}, { en = false } = {}) {
  const kind = beamKind(beam);
  const K = kindOf(kind);
  const k = K.k;
  const base = input.base && typeof input.base === 'object' ? input.base : null;
  const ch = base ? null : chamberOf(j, input.chamberId || beam.chamberId);
  const el = base ? null : electrometerOf(j, input.electrometerId || beam.electrometerId);
  const f = base
    ? { ...K.defaults, ...pick(base, [...K.beamKeys, ...K.chamberKeys, ...K.electrometerKeys]) }
    : { ...K.defaults, ...pick(beam.form, K.beamKeys), ...K.chamberForm(ch?.form || {}), ...K.electrometerForm(el?.form || {}) };
  f.protocol = session.protocol === 'tg51' ? 'tg51' : 'trs';
  f[k.institution] = j.institution;
  f[k.machine] = [machine.name, machine.serial ? `${L('№', 'S/N')} ${machine.serial}` : ''].filter(Boolean).join(', ');
  f[k.beam] = beam.name;
  f[k.date] = session.date;
  f[k.staff] = Array.isArray(session.staff) && session.staff.length ? session.staff : [''];
  f[k.notes] = session.notes ?? '';
  // условия: свои у пучка или общие для сеанса
  const env = session.env || {};
  f[k.T] = isBlank(input.env_T) ? env.T ?? '' : input.env_T;
  f[k.P] = isBlank(input.env_P) ? env.P ?? '' : input.env_P;
  f[k.PUnit] = env.P_unit || 'kPa';
  f[k.H] = env.H ?? '';
  f[k.M1] = input[k.M1] ?? ['', '', ''];
  f[k.ctrl] = input[k.ctrl] ?? ['', '', ''];
  f[k.recalNeeded] = input[k.recalNeeded] ?? '';
  f[k.recal] = input[k.recal] ?? ['', '', ''];
  let last = null;
  // откуда k_pol и k_s при проверке выхода: 'manual' — введены в сеансе, 'recorded' — из записанного сеанса,
  // 'journal' — из последней калибровки пучка в журнале, 'none' — неоткуда
  const fixedSrc = { kpol: 'none', ks: 'none' };
  if (session.mode === 'check') {
    last = lastCalibration(j, beam.id, { before: session.date || '9999-12-31', exceptId: session.id });
    f[k.fixed] = true;
    f[k.Mopp] = ['', '', ''];
    f[k.M2] = ['', '', ''];
    // шесть знаков после запятой: на дозу это влияет меньше чем на 10⁻⁶, а во вкладке читается
    const six = (v) => (en ? v.toFixed(6) : v.toFixed(6).replace('.', ','));
    // своё значение (например, калибровка была до журнала) важнее записанного в сеансе, записанное — важнее журнала
    const choose = (key, fromLast) => {
      if (!isBlank(input[key])) return ['manual', input[key]];
      if (base && !isBlank(base[key])) return ['recorded', base[key]];
      if (last) return ['journal', six(fromLast)];
      return ['none', ''];
    };
    [fixedSrc.kpol, f[k.fixedKpol]] = choose(k.fixedKpol, last?.kpol);
    [fixedSrc.ks, f[k.fixedKs]] = choose(k.fixedKs, last?.ks);
    const srcs = [fixedSrc.kpol, fixedSrc.ks];
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
  }
  // у записанного сеанса камера и электрометр — как при записи (для подписей; поля — как у записи камеры)
  const chamber = base ? { id: input.chamberId || '', form: kind === 'electron' ? chamberFormFromElectrons(pick(base, E_CHAMBER_KEYS)) : pick(base, PH_CHAMBER_KEYS) } : ch;
  const electrometer = base ? { id: input.electrometerId || '', form: kind === 'electron' ? elFormFromElectrons(pick(base, E_ELECTROMETER_KEYS)) : pick(base, PH_ELECTROMETER_KEYS) } : el;
  return { form: K.normalize(f), chamber, electrometer, last, fixedSrc, recorded: !!base, kind };
}
/** Прежнее имя (фотоны). */
export const photonBeamForm = beamForm;

const mean = (cells) => {
  const v = (cells || []).map(parseNumber).filter(Number.isFinite);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN;
};

/** Итог пучка: доза в точке номинала, отклонение, статус, поправки — для таблицы сеанса, журнала и трендов. */
export function beamSummary(r, kind = 'photon') {
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
    errors,
    warns,
  };
}
export const photonSummary = (r) => beamSummary(r, 'photon');

/** Расчёт пучка в сеансе. */
export function computeSessionBeam(j, session, beamInput, opts = {}) {
  const found = beamOf(j, beamInput.beamId);
  if (!found) return null;
  const machine = machineOf(j, session.machineId) || found.machine;
  const kind = beamKind(found.beam);
  const built = beamForm(j, session, machine, found.beam, beamInput, opts);
  const result = kindOf(kind).compute(built.form);
  // предыдущая калибровка этого пучка — для сравнения k_pol и k_s (изменение k_pol больше 0,2 % — повод выяснить причину)
  const prev = lastCalibration(j, found.beam.id, { before: session.date || '9999-12-31', exceptId: session.id });
  const summary = beamSummary(result, kind);
  if (prev && session.mode === 'cal' && Number.isFinite(summary.kpolRaw) && Number.isFinite(summary.ksRaw)) {
    summary.dKpol = (summary.kpolRaw / prev.kpol - 1) * 100;
    summary.dKs = (summary.ksRaw / prev.ks - 1) * 100;
  }
  return { ...built, prev, beam: found.beam, machine, result, summary };
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
  const sessions = j.sessions.filter((x) => x.id !== s.id).concat([s]).sort((a, b) => String(a.date).localeCompare(String(b.date)));
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
        status: b.summary.status,
      });
    }
    return { beam, kind: beamKind(beam), points: points.filter((p) => Number.isFinite(p.day)).sort((a, b) => a.day - b.day) };
  });
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
  const f = normalizeForm(form);
  if (String(f.ch_model).startsWith('MY:')) f.ch_model = 'CUSTOM';
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
/** Поля записи камеры, которые вкладка данного вида может изменить (у электронов модель записи не трогаем). */
const chamberUpdate = (chForm, kind) => {
  if (kind !== 'electron') return chForm;
  const { ch_model, ...rest } = chForm;
  return rest;
};

/**
 * Пучок из формы вкладки («МВ фотоны» или «Электроны»): настройки пучка и последний показатель качества; камера и
 * электрометр находятся в журнале по модели и номеру или добавляются.
 * Возвращает { journal, beam, addedChamber, addedElectrometer }.
 */
export function beamFromTabForm(j, machineId, form, kind = 'photon') {
  const K = kindOf(kind);
  const f = tabForm(form, kind);
  const journal = copyJournal(j);
  const { ch, added: addedChamber } = matchChamber(journal, K.chamberFromTab(f), kind);
  const { el, added: addedElectrometer } = matchElectrometer(journal, K.electrometerFromTab(f));
  const name = String(f[K.k.beam] || '').trim() || (kind === 'electron' ? L('Пучок электронов', 'Electron beam') : L('Пучок фотонов', 'Photon beam'));
  const beamForm = pick(f, K.beamKeys);
  if (kind === 'electron') {
    if (isBlank(beamForm.e_energy)) {
      const e = parseElectronBeam(name).energy;
      if (Number.isFinite(e)) beamForm.e_energy = String(e).replace('.', ',');
    }
  } else beamForm.meta_fff = !!f.meta_fff || !!parseBeamName(name).fff;
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
  if (!isBlank(f[K.k.beam])) b.name = String(f[K.k.beam]).trim();
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
    if (!added) ch.form = { ...ch.form, ...chamberUpdate(chForm, kind) };
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
