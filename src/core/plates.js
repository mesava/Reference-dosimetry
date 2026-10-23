// Проверка выхода в пластинах (твёрдая вода, ПММА, полистирол) — не референсные условия.
// TRS-398 Rev.1, разд. 4.2.3: пластиковые фантомы (пластины) не используются для стандартной дозиметрии, но допустимы для
// рутинных измерений в целях обеспечения качества, если для пучка пользователя установлено отношение показаний
// дозиметра в пластике и в воде; разд. 7.8 — то же для электронов, ур. (45) и табл. 23.
// Поэтому калибровки в пластинах нет: выход считается относительно калибровки этого пучка в воде, к которой привязан
// набор пластин. Сразу после калибровки в воде (тот же дозиметр, та же установка) снимают показание в пластинах M_pl,0;
// при проверке D = D_кал · M_pl / M_pl,0. Показания приводятся к одним T и P (k_TP, TRS-398 Rev.1, ур. 10); k_elec, k_pol и
// k_s одного дозиметра в одном пучке в отношении сокращаются, k_Q и h_pl не нужны.
import { L } from './i18n.js';
import { parseNumber, parseCells, isBlank, pressureToKPa } from './units.js';
import { temperaturePressure } from './common.js';
import { TRS_ABS0 } from './trs398.js';
import { decayFactor } from './cobalt.js';
import { beamOf, beamKind, machineOf, lastCalibration, dayNumber, uid, sessionEquipDefaults, futureDateError } from './journal.js';

/**
 * Пластики: коэффициент пересчёта глубины c_pl, коэффициент пересчёта флюенса h_pl и номинальная плотность ρ_pl.
 * TRS-398 Rev.1, табл. 23 (пучки электронов). Значения справочные: плотность партии пластин измеряют (разд. 7.8.1).
 */
export const PLASTICS = [
  { id: 'solidwater', ru: '«Твёрдая вода» HE (Sun Nuclear)', en: 'Solid Water HE (Sun Nuclear)', cpl: 0.964, hpl: 1.0, rho: 1.03 },
  { id: 'wte', ru: 'WTe (Bart’s Health NHS Trust)', en: 'WTe (Bart’s Health NHS Trust)', cpl: 0.973, hpl: 0.999, rho: 1.04 },
  { id: 'plasticwater', ru: '«Пластиковая вода» (CIRS)', en: 'Plastic Water (CIRS)', cpl: 0.982, hpl: 0.998, rho: 1.01 },
  { id: 'virtualwater', ru: '«Виртуальная вода» (Med-Cal)', en: 'Virtual Water (Med-Cal)', cpl: 0.954, hpl: 1.003, rho: 1.06 },
  { id: 'pmma', ru: 'ПММА', en: 'PMMA', cpl: 0.947, hpl: 1.009, rho: 1.19 },
  { id: 'clearps', ru: 'Прозрачный полистирол', en: 'Clear polystyrene', cpl: 0.93, hpl: 1.026, rho: 1.06 },
  { id: 'whiteps', ru: 'Белый полистирол (например, PTW RW3)', en: 'White polystyrene (e.g. PTW RW3)', cpl: 0.933, hpl: 1.019, rho: 1.06 },
];
export const plasticOf = (id) => PLASTICS.find((p) => p.id === id) ?? null;
export const plasticName = (b) => {
  const p = plasticOf(b?.material);
  return p ? L(p.ru, p.en) : String(b?.materialName ?? '').trim() || L('другой пластик', 'other plastic');
};

/** Ур. (45) TRS-398 Rev.1: глубина в воде z_w = z_pl · c_pl, z_pl = t · ρ_pl (г/см²). Возвращает z_w, г/см². */
export function waterDepth(depthCm, rho, cpl) {
  return depthCm * rho * cpl;
}

/** Набор пластин и показание привязки (вводятся в «В пластинах», хранятся у пучка журнала: beam.plates). */
export const BINDING_DEFAULTS = { material: 'whiteps', materialName: '', rho: '', depth: '', below: '', notes: '', date: '', calSessionId: '', amount: '', M: ['', '', ''], T: '', P: '', P_unit: 'kPa' };
/** Измерение в пластинах (форма проверки). */
export const CHECK_DEFAULTS = { date: '', staff: '', amount: '', M: ['', '', ''], T: '', P: '', P_unit: 'kPa', notes: '' };

/** Единица облучения: МЕ у ускорителя, минуты у ⁶⁰Co. */
export const amountUnit = (kind) => (kind === 'cobalt' ? 'min' : 'MU');

/**
 * Показание, приведённое к 20 °C и 101,325 кПа и к единице облучения: M · k_TP / МЕ (у ⁶⁰Co — M · k_TP / (t + τ), τ —
 * ошибка таймера калибровки, мин). Опорные T₀ и P₀ в отношении M_pl / M_pl,0 сокращаются.
 * Возвращает { mean, n, relSd, kTP, perUnit, errors: [текст] }.
 */
export function correctedReading({ M, amount, T, P, P_unit = 'kPa' }, { tauMin = 0, kind = 'photon' } = {}) {
  const errors = [];
  const r = parseCells(M);
  if (r.error) errors.push(L(`Показания: ${r.error}.`, `Readings: ${r.error}.`));
  else if (!r.n) errors.push(L('Введите показания электрометра.', 'Enter the electrometer readings.'));
  const a = parseNumber(amount);
  if (!(a > 0)) errors.push(kind === 'cobalt' ? L('Введите время облучения, мин.', 'Enter the irradiation time, min.') : L('Введите число МЕ.', 'Enter the number of MU.'));
  const t = parseNumber(T);
  const p = parseNumber(P);
  if (!Number.isFinite(t)) errors.push(L('Введите температуру в пластинах у камеры.', 'Enter the temperature in the plates at the chamber.'));
  if (!(p > 0)) errors.push(L('Введите давление.', 'Enter the pressure.'));
  if (errors.length) return { mean: r.mean, n: r.n, relSd: r.relSd, kTP: NaN, perUnit: NaN, errors };
  const kTP = temperaturePressure({ T: t, P: pressureToKPa(p, P_unit), T0: 20, P0: 101.325, abs0: TRS_ABS0 });
  const tau = kind === 'cobalt' && Number.isFinite(tauMin) ? tauMin : 0;
  return { mean: Math.abs(r.mean), n: r.n, relSd: r.relSd, kTP, perUnit: (Math.abs(r.mean) * kTP) / (a + tau), errors };
}

/** Калибровки пучка в воде, к которым можно привязать пластины (новые первыми): { sessionId, date, summary }. */
export function waterCalibrations(j, beamId) {
  return j.sessions
    .filter((s) => s.mode === 'cal')
    .map((s) => ({ s, b: s.beams.find((x) => x.beamId === beamId && x.include !== false && x.summary?.ok && Number.isFinite(x.summary.value)) }))
    .filter((x) => x.b)
    .sort((a, b) => String(b.s.date).localeCompare(String(a.s.date)) || (a.s.protocol === 'tg51') - (b.s.protocol === 'tg51'))
    .map(({ s, b }) => ({ sessionId: s.id, date: s.date, protocol: s.protocol === 'tg51' ? 'tg51' : 'trs', summary: b.summary, chamberId: b.chamberId || '', electrometerId: b.electrometerId || '' }));
}

/**
 * Привязка набора пластин к калибровке пучка в воде: показание в пластинах сразу после калибровки.
 * input — BINDING_DEFAULTS; calSessionId — калибровка (по умолчанию — последняя до даты привязки).
 * Возвращает { binding } или { error }. binding хранит итог калибровки (D_кал, отклонение, допуск) и M_pl,0.
 */
export function makeBinding(j, beamId, input) {
  const found = beamOf(j, beamId);
  if (!found) return { error: L('Пучок не найден в журнале.', 'The beam was not found in the journal.') };
  const kind = beamKind(found.beam);
  const f = { ...BINDING_DEFAULTS, ...input };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(f.date))) return { error: L('Укажите дату привязки.', 'Enter the binding date.') };
  const future = futureDateError(f.date, f.today || undefined);
  if (future) return { error: future };
  const cals = waterCalibrations(j, beamId).filter((c) => c.date <= f.date);
  const cal = (f.calSessionId && cals.find((c) => c.sessionId === f.calSessionId)) || cals[0];
  if (!cal) return { error: L('У пучка нет калибровки в воде в журнале до даты привязки: сначала откалибруйте пучок в воде (TRS-398 Rev.1).', 'The beam has no calibration in water in the journal before the binding date: first calibrate the beam in water (TRS-398 Rev.1).') };
  const rho = parseNumber(f.rho);
  const depth = parseNumber(f.depth);
  if (!(rho > 0)) return { error: L('Введите измеренную плотность пластин, г/см³ (TRS-398 Rev.1, разд. 7.8.1: не номинальную).', 'Enter the measured density of the plates, g/cm³ (TRS-398 Rev.1, Sec. 7.8.1: not the nominal value).') };
  if (!(depth > 0)) return { error: L('Введите толщину пластика над камерой, см.', 'Enter the plastic thickness above the chamber, cm.') };
  if (f.material === 'other' && isBlank(f.materialName)) return { error: L('Укажите материал пластин.', 'Enter the plate material.') };
  const tauMin = kind === 'cobalt' ? cal.summary.tauMin : 0;
  const r = correctedReading(f, { tauMin, kind });
  if (r.errors.length) return { error: r.errors.join(' ') };
  const eq = sessionEquipDefaults(j, found.machine.id, kind, beamId);
  return {
    binding: {
      material: f.material,
      materialName: f.material === 'other' ? String(f.materialName).trim() : '',
      rho: String(f.rho),
      depth: String(f.depth),
      below: String(f.below ?? ''),
      notes: String(f.notes ?? ''),
      date: f.date,
      amount: String(f.amount),
      M: Array.isArray(f.M) ? f.M.map(String) : [],
      T: String(f.T),
      P: String(f.P),
      P_unit: f.P_unit || 'kPa',
      M0: r.perUnit,
      kTP0: r.kTP,
      calSessionId: cal.sessionId,
      calDate: cal.date,
      calProtocol: cal.protocol,
      calValue: cal.summary.value,
      calDeviation: cal.summary.deviation,
      calAt: cal.summary.at,
      tol: cal.summary.tol,
      tauMin: Number.isFinite(tauMin) ? tauMin : 0,
      chamberId: cal.chamberId || eq.chamberId,
      electrometerId: cal.electrometerId || eq.electrometerId,
      saved: new Date().toISOString(),
    },
  };
}

/** Привязка пучка в журнале (beam.plates) или null. */
export const bindingOf = (j, beamId) => beamOf(j, beamId)?.beam.plates ?? null;

/**
 * Проверка выхода в пластинах: input — CHECK_DEFAULTS, binding — привязка пучка.
 * Ускоритель: D = D_кал · M_pl / M_pl,0 (Гр на 100 МЕ в точке номинала калибровки), отклонение — от номинала калибровки
 * (если номинал не задан — от D_кал). ⁶⁰Co: мощность дозы, отклонение — от ожидаемой по распаду от даты привязки.
 * Возвращает { ok, errors, warnings, kind, kTP, perUnit, ratio, value, deviation, devFromCal, decay, tol, status, at }.
 */
export function platesResult(j, beamId, input, binding = bindingOf(j, beamId)) {
  const found = beamOf(j, beamId);
  const kind = beamKind(found?.beam);
  const f = { ...CHECK_DEFAULTS, ...input };
  const out = { ok: false, errors: [], warnings: [], kind, kTP: NaN, perUnit: NaN, ratio: NaN, value: NaN, deviation: NaN, devFromCal: NaN, decay: NaN, tol: binding?.tol ?? NaN, status: 'error', at: binding?.calAt ?? '' };
  if (!found) {
    out.errors.push(L('Пучок не найден в журнале.', 'The beam was not found in the journal.'));
    return out;
  }
  if (!binding || !(binding.M0 > 0)) {
    out.errors.push(L('Пластины не привязаны к калибровке пучка в воде: сначала выполните привязку (раздел 2).', 'The plates are not bound to a calibration of the beam in water: do the binding first (section 2).'));
    return out;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(f.date))) out.errors.push(L('Укажите дату измерения.', 'Enter the measurement date.'));
  else if (f.date < binding.date) out.errors.push(L(`Дата измерения раньше привязки пластин (${binding.date}).`, `The measurement date is before the plate binding (${binding.date}).`));
  else if (futureDateError(f.date, f.today || undefined)) out.errors.push(futureDateError(f.date, f.today || undefined));
  const r = correctedReading(f, { tauMin: binding.tauMin, kind });
  out.errors.push(...r.errors);
  out.kTP = r.kTP;
  out.perUnit = r.perUnit;
  if (out.errors.length) return out;
  out.ratio = r.perUnit / binding.M0;
  out.devFromCal = (out.ratio - 1) * 100;
  if (kind === 'cobalt') {
    // ⁶⁰Co: отношение включает распад от привязки до измерения; ожидаемое отношение — множитель распада
    const toBind = decayFactor(binding.calDate, binding.date);
    const d = decayFactor(binding.date, f.date);
    out.decay = d.factor;
    out.value = binding.calValue * (toBind.factor ?? 1) * out.ratio;
    out.deviation = (out.ratio / d.factor - 1) * 100;
  } else {
    out.value = binding.calValue * out.ratio;
    const nominal = Number.isFinite(binding.calDeviation) ? binding.calValue / (1 + binding.calDeviation / 100) : binding.calValue;
    out.deviation = (out.value / nominal - 1) * 100;
  }
  out.status = Number.isFinite(out.tol) && Math.abs(out.deviation) > out.tol ? 'out' : 'ok';
  out.ok = true;
  // привязка устарела: после неё пучок калибровали в воде заново
  const last = lastCalibration(j, beamId, { before: f.date });
  if (last && last.date > binding.calDate) {
    out.warnings.push({ level: 'warn', text: L(`После привязки пластин пучок калибровали в воде (${last.date}): повторите привязку к новой калибровке.`, `The beam was calibrated in water after the plate binding (${last.date}): repeat the binding to the new calibration.`) });
  }
  if (binding.date !== binding.calDate) {
    out.warnings.push({ level: 'info', text: L('Привязка сделана не в день калибровки в воде: выход между ними считается неизменным.', 'The binding was not made on the day of the calibration in water: the output is assumed unchanged between them.') });
  }
  const age = dayNumber(f.date) - dayNumber(binding.date);
  if (age > 365) out.warnings.push({ level: 'info', text: L('Привязке больше года: TRS-398 Rev.1 (разд. 4.2.3) советует периодически проверять отношение пластик/вода.', 'The binding is more than a year old: TRS-398 Rev.1 (Sec. 4.2.3) advises checking the plastic/water ratio periodically.') });
  if (out.status === 'out') {
    out.warnings.push({ level: 'warn', text: L('Выход в пластинах вне допуска. Пластины — не референсные условия: прежде чем подстраивать ускоритель, проверьте выход в воде.', 'The output in plates is out of tolerance. Plates are not reference conditions: check the output in water before adjusting the machine.') });
  }
  if (r.n > 1 && r.relSd > 0.002) out.warnings.push({ level: 'warn', text: L('Разброс показаний больше 0,2 %: проверьте тепловое равновесие пластин и камеры (TRS-398 Rev.1, разд. 4.2.3).', 'The reading spread exceeds 0.2%: check the thermal equilibrium of the plates and chamber (TRS-398 Rev.1, Sec. 4.2.3).') });
  return out;
}

/**
 * Записать проверку в пластинах в журнал (j.plateChecks). Тот же пучок за ту же дату заменяется.
 * Возвращает { journal, record, replaced } или { error }.
 */
export function recordPlates(j, { machineId, beamId, input }) {
  const found = beamOf(j, beamId);
  if (!found || found.machine.id !== machineId || !machineOf(j, machineId)) return { error: L('Пучок не найден в журнале: выберите аппарат и пучок заново.', 'The beam was not found in the journal: select the machine and beam again.') };
  const binding = found.beam.plates;
  const res = platesResult(j, beamId, input, binding);
  if (!res.ok) return { error: res.errors.join(' ') };
  const f = { ...CHECK_DEFAULTS, ...input };
  const old = (j.plateChecks || []).find((x) => x.beamId === beamId && x.date === f.date);
  const record = {
    id: old?.id || uid('p'),
    machineId,
    beamId,
    date: f.date,
    staff: String(f.staff ?? '').trim(),
    amount: String(f.amount),
    M: Array.isArray(f.M) ? f.M.map(String) : [],
    T: String(f.T),
    P: String(f.P),
    P_unit: f.P_unit || 'kPa',
    notes: String(f.notes ?? ''),
    binding: { date: binding.date, calDate: binding.calDate, calValue: binding.calValue, M0: binding.M0, material: binding.material, materialName: binding.materialName, rho: binding.rho, depth: binding.depth, chamberId: binding.chamberId, electrometerId: binding.electrometerId },
    summary: { value: res.value, ratio: res.ratio, deviation: res.deviation, devFromCal: res.devFromCal, decay: res.decay, tol: res.tol, status: res.status, at: res.at, kTP: res.kTP, perUnit: res.perUnit },
    saved: new Date().toISOString(),
  };
  const plateChecks = (j.plateChecks || []).filter((x) => x.id !== record.id).concat([record]).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return { journal: { ...j, plateChecks }, record, replaced: !!old };
}

/** Записать привязку у пучка журнала (beam.plates); null — убрать привязку. */
export function setBinding(j, beamId, binding) {
  return {
    ...j,
    machines: j.machines.map((m) => ({ ...m, beams: m.beams.map((b) => (b.id === beamId ? { ...b, plates: binding } : b)) })),
  };
}

/**
 * Точки контрольной карты проверок в пластинах пучка (core/spc.js controlChart): отклонение по датам; новая привязка
 * начинает новый отсчёт (reason 'binding').
 */
export function platesPoints(j, beamId) {
  let prev = '';
  const out = [];
  for (const p of (j.plateChecks || []).filter((x) => x.beamId === beamId)) {
    const day = dayNumber(p.date);
    if (!Number.isFinite(day) || !Number.isFinite(p.summary?.deviation)) continue;
    const key = `${p.binding?.date}|${p.binding?.M0}`;
    const restart = out.length > 0 && key !== prev;
    out.push({ day, date: p.date, value: p.summary.deviation, tol: p.summary.tol, id: p.id, restart, reason: restart ? 'binding' : undefined });
    prev = key;
  }
  return out;
}
