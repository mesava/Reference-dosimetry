// Журнал калибровок (вкладка «Журнал»): оборудование отделения — камеры, электрометры, аппараты с пучками —
// и сеансы на весь аппарат: калибровка (k_pol и k_s измеряются для каждого пучка) или проверка выхода (k_pol и k_s
// берутся из последней калибровки этого же пучка). Всё хранится одним файлом JSON, который можно держать на общем
// диске отделения.
//
// Расчёт каждого пучка выполняет ядро вкладки дозиметрии (photons.js): форма вкладки собирается из профиля пучка,
// записи камеры, записи электрометра и показаний сеанса. В сеанс записывается и сама форма — результат старого
// сеанса воспроизводится, даже если потом изменились N_D,w камеры или настройки пучка.

import { computePhotons, FORM_DEFAULTS, normalizeForm } from './photons.js';
import { findChamber, chamberLabel } from './chambers.js';
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
    : findChamber(f.ch_model) ? chamberLabel(findChamber(f.ch_model)) : String(f.ch_model || '—');
  return [model, isBlank(f.ch_serial) ? '' : `${L('№', 'S/N')} ${f.ch_serial}`].filter(Boolean).join(' ');
}
export function electrometerText(e) {
  if (!e) return '';
  const f = e.form || {};
  return [isBlank(f.el_model) ? L('электрометр', 'electrometer') : f.el_model, isBlank(f.el_serial) ? '' : `${L('№', 'S/N')} ${f.el_serial}`].filter(Boolean).join(' ');
}
/** Чего не хватает записи камеры для расчёта: модель и калибровочный коэффициент (⁶⁰Co или перекрёстный). */
export function chamberMissing(c) {
  const f = c?.form || {};
  const cross = f.ch_cal_route === 'cross';
  return [
    isBlank(f.ch_model) && L('модель', 'model'),
    !cross && isBlank(f.ch_ndw) && 'N_D,w',
    cross && isBlank(f.ch_cross_ndw) && 'N_D,w,Qcross',
    cross && isBlank(f.ch_cross_tpr) && L('TPR20,10 перекрёстной калибровки', 'cross-calibration TPR20,10'),
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
  return {
    date: best.session.date,
    sessionId: best.session.id,
    ks: best.beam.summary.ksRaw,
    kpol: best.beam.summary.kpolRaw,
    quality: pick(best.beam.form || {}, PH_QUALITY_KEYS),
  };
}

/** Дата для текста (ДД.ММ.ГГГГ по-русски, ГГГГ-ММ-ДД по-английски). */
const dateText = (iso, en) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''));
  if (!m) return String(iso ?? '');
  return en ? `${m[1]}-${m[2]}-${m[3]}` : `${m[3]}.${m[2]}.${m[1]}`;
};

/** Настройки пучка, камеры и электрометра из формы, записанной в сеанс (без показаний и условий сеанса). */
export const recordedBase = (form) => (form ? pick(form, [...PH_BEAM_KEYS, ...PH_CHAMBER_KEYS, ...PH_ELECTROMETER_KEYS, 'rd_fixed_kpol', 'rd_fixed_ks', 'rd_fixed_from']) : null);

/**
 * Форма вкладки «МВ фотоны» для пучка в сеансе: профиль пучка + камера + электрометр + показания.
 * input — показания пучка в сеансе: { env_T, env_P, rd_M1, rd_Mopp, rd_M2, qtrs_v20, qtrs_v10, q51_pdd10, …, ctrl_M, recal_needed, recal_M }.
 * input.base — настройки из записанного сеанса (recordedBase): открытый из журнала сеанс считается по ним, а не по
 * сегодняшнему оборудованию, иначе после смены N_D,w камеры старый сеанс тихо показал бы другую дозу.
 * В режиме проверки k_pol и k_s берутся из последней калибровки этого пучка (до даты сеанса); каждое можно задать вручную.
 */
export function photonBeamForm(j, session, machine, beam, input = {}, { en = false } = {}) {
  const base = input.base && typeof input.base === 'object' ? input.base : null;
  const ch = base ? null : chamberOf(j, input.chamberId || beam.chamberId);
  const el = base ? null : electrometerOf(j, input.electrometerId || beam.electrometerId);
  const f = base
    ? { ...FORM_DEFAULTS, ...pick(base, [...PH_BEAM_KEYS, ...PH_CHAMBER_KEYS, ...PH_ELECTROMETER_KEYS]) }
    : {
        ...FORM_DEFAULTS,
        ...pick(beam.form, PH_BEAM_KEYS),
        ...pick(beam.form, PH_QUALITY_KEYS),
        ...pick(ch?.form, PH_CHAMBER_KEYS),
        ...pick(el?.form, PH_ELECTROMETER_KEYS),
      };
  f.protocol = session.protocol === 'tg51' ? 'tg51' : 'trs';
  f.meta_institution = j.institution;
  f.meta_machine = [machine.name, machine.serial ? `${L('№', 'S/N')} ${machine.serial}` : ''].filter(Boolean).join(', ');
  f.meta_beam = beam.name;
  f.meta_date = session.date;
  f.meta_staff = Array.isArray(session.staff) && session.staff.length ? session.staff : [''];
  f.meta_notes = session.notes ?? '';
  // условия: свои у пучка или общие для сеанса
  const env = session.env || {};
  f.env_T = isBlank(input.env_T) ? env.T ?? '' : input.env_T;
  f.env_P = isBlank(input.env_P) ? env.P ?? '' : input.env_P;
  f.env_P_unit = env.P_unit || 'kPa';
  f.env_H = env.H ?? '';
  f.rd_M1 = input.rd_M1 ?? ['', '', ''];
  f.ctrl_M = input.ctrl_M ?? ['', '', ''];
  f.recal_needed = input.recal_needed ?? '';
  f.recal_M = input.recal_M ?? ['', '', ''];
  let last = null;
  // откуда k_pol и k_s при проверке выхода: 'manual' — введены в сеансе, 'recorded' — из записанного сеанса,
  // 'journal' — из последней калибровки пучка в журнале, 'none' — неоткуда
  const fixedSrc = { kpol: 'none', ks: 'none' };
  if (session.mode === 'check') {
    last = lastCalibration(j, beam.id, { before: session.date || '9999-12-31', exceptId: session.id });
    f.rd_fixed = true;
    f.rd_Mopp = ['', '', ''];
    f.rd_M2 = ['', '', ''];
    // шесть знаков после запятой: на дозу это влияет меньше чем на 10⁻⁶, а во вкладке читается
    const six = (v) => (en ? v.toFixed(6) : v.toFixed(6).replace('.', ','));
    // своё значение (например, калибровка была до журнала) важнее записанного в сеансе, записанное — важнее журнала
    const choose = (key, fromLast) => {
      if (!isBlank(input[key])) return ['manual', input[key]];
      if (base && !isBlank(base[key])) return ['recorded', base[key]];
      if (last) return ['journal', six(fromLast)];
      return ['none', ''];
    };
    [fixedSrc.kpol, f.rd_fixed_kpol] = choose('rd_fixed_kpol', last?.kpol);
    [fixedSrc.ks, f.rd_fixed_ks] = choose('rd_fixed_ks', last?.ks);
    const srcs = [fixedSrc.kpol, fixedSrc.ks];
    f.rd_fixed_from = !isBlank(input.rd_fixed_from)
      ? String(input.rd_fixed_from)
      : srcs.includes('recorded') && !isBlank(base?.rd_fixed_from)
        ? String(base.rd_fixed_from)
        : srcs.includes('journal')
          ? dateText(last.date, en)
          : '';
    // качество пучка — измеренное при той калибровке (у записанного сеанса оно уже в его форме)
    if (last && !base) Object.assign(f, Object.fromEntries(Object.entries(last.quality).filter(([, v]) => !isBlank(v))));
  } else {
    f.rd_fixed = false;
    f.rd_Mopp = input.rd_Mopp ?? ['', '', ''];
    f.rd_M2 = input.rd_M2 ?? ['', '', ''];
    // качество пучка: измеренное в этом сеансе, иначе последнее из профиля
    for (const k of PH_QUALITY_KEYS) if (!isBlank(input[k])) f[k] = input[k];
  }
  // у записанного сеанса камера и электрометр — как при записи (для подписей)
  const chamber = base ? { id: input.chamberId || '', form: pick(base, PH_CHAMBER_KEYS) } : ch;
  const electrometer = base ? { id: input.electrometerId || '', form: pick(base, PH_ELECTROMETER_KEYS) } : el;
  return { form: normalizeForm(f), chamber, electrometer, last, fixedSrc, recorded: !!base };
}

const mean = (cells) => {
  const v = (cells || []).map(parseNumber).filter(Number.isFinite);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN;
};

/** Итог пучка: доза в точке номинала, отклонение, статус, поправки — для таблицы сеанса, журнала и трендов. */
export function photonSummary(r) {
  const tg = r.protocol === 'tg51';
  const x = tg ? r.tg51 : r.trs;
  const errors = r.messages.filter((m) => m.level === 'error').length;
  const warns = r.messages.filter((m) => m.level === 'warn').length;
  const ctrlFailed = !x.blocked && !!x.ctrl?.blocked;
  const pre = x.ctrl && !x.ctrl.blocked && !x.blocked ? x.ctrl : x;
  const p = x.recal && !x.recal.blocked && !x.blocked ? x.recal : pre;
  const at = r.depth.nominalAt === 'dmax' && Number.isFinite(p.DmaxPerMU) ? 'dmax' : 'zref';
  const value = x.blocked || ctrlFailed ? NaN : at === 'dmax' ? p.DmaxPerMU : p.DperMU;
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
    at,
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
    quality: tg ? x.pdd10x : x.tpr,
    errors,
    warns,
  };
}

/** Расчёт пучка в сеансе. */
export function computeSessionBeam(j, session, beamInput, opts = {}) {
  const found = beamOf(j, beamInput.beamId);
  if (!found) return null;
  const machine = machineOf(j, session.machineId) || found.machine;
  if (found.beam.kind !== 'photon') return null;
  const built = photonBeamForm(j, session, machine, found.beam, beamInput, opts);
  const result = computePhotons(built.form);
  // предыдущая калибровка этого пучка — для сравнения k_pol и k_s (изменение k_pol больше 0,2 % — повод выяснить причину)
  const prev = lastCalibration(j, found.beam.id, { before: session.date || '9999-12-31', exceptId: session.id });
  const summary = photonSummary(result);
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
      return c ? { ...rest, chamberId: c.chamber?.id || b.chamberId || '', electrometerId: c.electrometer?.id || b.electrometerId || '', form: c.form, summary: c.summary } : rest;
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
    return { beam, points: points.filter((p) => Number.isFinite(p.day)).sort((a, b) => a.day - b.day) };
  });
}

// ---------------------------------------------------------------- перенос из вкладки «МВ фотоны»
const norm = (s) => String(s ?? '').trim().toLowerCase();
/**
 * Пучок из формы вкладки «МВ фотоны»: настройки пучка и последний показатель качества; камера и электрометр
 * находятся в журнале по модели и номеру или добавляются. Возвращает { journal, beam, addedChamber, addedElectrometer }.
 */
const sameChamber = (cf, f) => cf.ch_model === f.ch_model && norm(cf.ch_serial) === norm(f.ch_serial) && (f.ch_model !== 'CUSTOM' || norm(cf.cc_model) === norm(f.cc_model));
const sameElectrometer = (ef, f) => norm(ef.el_model) === norm(f.el_model) && norm(ef.el_serial) === norm(f.el_serial);
const tabForm = (form) => {
  const f = normalizeForm(form);
  // «Мои камеры» хранятся в браузере: в журнал камера попадает своими полями, чтобы файл был самодостаточным
  if (String(f.ch_model).startsWith('MY:')) f.ch_model = 'CUSTOM';
  return f;
};
const copyJournal = (j) => ({ ...j, chambers: j.chambers.map((c) => ({ ...c, form: { ...c.form } })), electrometers: j.electrometers.map((e) => ({ ...e, form: { ...e.form } })), machines: j.machines.map((m) => ({ ...m, beams: m.beams.map((b) => ({ ...b, form: { ...b.form } })) })) });
/** Камера формы вкладки: найти в журнале по модели и номеру или добавить (в копии журнала). */
function matchChamber(journal, f) {
  const ch = journal.chambers.find((c) => sameChamber(c.form, f));
  if (ch || isBlank(f.ch_model)) return { ch: ch ?? null, added: false };
  const added = { ...CHAMBER_DEFAULTS, id: uid('ch'), form: pick(f, PH_CHAMBER_KEYS) };
  journal.chambers.push(added);
  return { ch: added, added: true };
}
/** Электрометр формы вкладки: найти по модели и номеру или добавить. */
function matchElectrometer(journal, f) {
  const el = journal.electrometers.find((e) => sameElectrometer(e.form, f));
  if (el || (isBlank(f.el_model) && isBlank(f.el_serial) && isBlank(f.el_kelec))) return { el: el ?? null, added: false };
  const added = { ...ELECTROMETER_DEFAULTS, id: uid('el'), form: pick(f, PH_ELECTROMETER_KEYS) };
  journal.electrometers.push(added);
  return { el: added, added: true };
}

export function beamFromPhotonsForm(j, machineId, form) {
  const f = tabForm(form);
  const journal = copyJournal(j);
  const { ch, added: addedChamber } = matchChamber(journal, f);
  const { el, added: addedElectrometer } = matchElectrometer(journal, f);
  const name = String(f.meta_beam || '').trim() || L('Пучок фотонов', 'Photon beam');
  const beam = {
    ...BEAM_DEFAULTS,
    id: uid('b'),
    name,
    chamberId: ch?.id ?? '',
    electrometerId: el?.id ?? '',
    form: { ...pick(f, PH_BEAM_KEYS), ...pick(f, PH_QUALITY_KEYS), meta_fff: !!f.meta_fff || !!parseBeamName(name).fff },
  };
  const m = journal.machines.find((x) => x.id === machineId);
  if (m) m.beams.push(beam);
  return { journal, beam, addedChamber, addedElectrometer };
}

/**
 * Настройки пучка, отредактированные на вкладке «МВ фотоны» («Все настройки»), — обратно в журнал.
 * Камера и электрометр записи журнала общие для нескольких пучков, поэтому другая модель или номер на вкладке
 * означает другую камеру: она находится в журнале или добавляется, а прежняя запись не меняется. Та же камера
 * (модель и номер совпали) обновляется полями вкладки — это та же физическая камера и для других пучков.
 * Возвращает { journal, chamber: 'same' | 'found' | 'added' | 'none', electrometer: …, sharedChamber: [имена пучков] }.
 */
export function applyPhotonsFormToBeam(j, machineId, beamId, form) {
  const f = tabForm(form);
  const journal = copyJournal(j);
  const m = journal.machines.find((x) => x.id === machineId);
  const b = m?.beams.find((x) => x.id === beamId);
  if (!b) return { journal: j, chamber: 'none', electrometer: 'none', sharedChamber: [], sharedElectrometer: [] };
  b.form = { ...pick(f, PH_BEAM_KEYS) };
  if (!isBlank(f.meta_beam)) b.name = String(f.meta_beam).trim();
  // другие пучки с той же записью — только если запись действительно изменилась (иначе сообщать не о чем)
  const others = (key, id) => journal.machines.flatMap((mm) => mm.beams.filter((x) => x.id !== beamId && x[key] === id).map((x) => `${mm.name} — ${x.name}`));
  const changed = (form, keys) => {
    const a = normalizeForm({ ...FORM_DEFAULTS, ...form });
    return keys.some((k) => String(a[k] ?? '') !== String(f[k] ?? ''));
  };
  const res = { journal, chamber: 'none', electrometer: 'none', sharedChamber: [], sharedElectrometer: [] };
  const cur = journal.chambers.find((c) => c.id === b.chamberId);
  if (cur && sameChamber(cur.form, f)) {
    if (changed(cur.form, PH_CHAMBER_KEYS)) res.sharedChamber = others('chamberId', cur.id);
    cur.form = { ...cur.form, ...pick(f, PH_CHAMBER_KEYS) };
    res.chamber = 'same';
  } else if (!isBlank(f.ch_model)) {
    const { ch, added } = matchChamber(journal, f);
    if (!added) ch.form = { ...ch.form, ...pick(f, PH_CHAMBER_KEYS) };
    b.chamberId = ch.id;
    res.chamber = added ? 'added' : 'found';
  }
  const curEl = journal.electrometers.find((e) => e.id === b.electrometerId);
  if (curEl && sameElectrometer(curEl.form, f)) {
    if (changed(curEl.form, PH_ELECTROMETER_KEYS)) res.sharedElectrometer = others('electrometerId', curEl.id);
    curEl.form = { ...curEl.form, ...pick(f, PH_ELECTROMETER_KEYS) };
    res.electrometer = 'same';
  } else if (!isBlank(f.el_model) || !isBlank(f.el_serial)) {
    const { el, added } = matchElectrometer(journal, f);
    if (!added) el.form = { ...el.form, ...pick(f, PH_ELECTROMETER_KEYS) };
    b.electrometerId = el.id;
    res.electrometer = added ? 'added' : 'found';
  }
  return res;
}

/** Средние показания пучка (для таблицы сеанса). */
export const meanOf = mean;
