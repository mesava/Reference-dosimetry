// Журнал kV (с 0.46.0): запись измерения вкладки «kV-рентген» в журнал отделения (j.kvRecords). Запись — измерение
// рентгенотерапевтического аппарата «Оборудования» в один день: вся вкладка (как файл .json вкладки — запись можно снова
// открыть во вкладке) и итоги по режимам (k_pol, k_s, τ, СПО, k_Q, линейность, воспроизводимость) и аппликаторам
// (мощность дозы, базовое значение, отклонение, решение о калибровке). С 0.47.0 запись — по режимам: повторная запись
// того же дня заменяет только режимы, которые в ней есть (у прежней записи остаются другие режимы); последняя
// калибровка режима даёт базу «Сравнить с» и, при проверке выхода, k_pol, k_s, τ и СПО (kvJournalInputs).
// Расчёта здесь нет: итоги — из computeKvVisit и листа «Сводка и протокол» (core/kv-summary.js).
import { computeKvVisit, kvModeLabel } from './kv-session.js';
import { kvOutputRows, kvSheetChecks, kvChamberName } from './kv-summary.js';
import { kvSameApp, kvSameMode, kvFindChamber, kvFindElectrometer, kvMachineText } from './kv-journal.js';
import { uid, futureDateError, localToday } from './journal.js';
import { isBlank } from './units.js';
import { APP_VERSION } from './version.js';
import { L } from './i18n.js';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const str = (v) => (v === undefined || v === null ? '' : String(v)).trim();
/** Число для JSON: NaN и ±∞ — null. */
const num = (v) => (Number.isFinite(v) ? v : null);

/** Вид измерения вкладки: 'cal' — калибровка, 'check' — проверка выхода. */
export const kvRecMode = (visit) => (visit?.common?.kv_rec_mode === 'check' ? 'check' : 'cal');
export const kvRecModeText = (mode) => (mode === 'check' ? L('проверка выхода', 'output check') : L('калибровка', 'calibration'));

/** Порядок записей kV: по дате, в один день — по времени записи. */
export const kvRecordOrder = (a, b) => String(a.date).localeCompare(String(b.date)) || String(a.saved ?? '').localeCompare(String(b.saved ?? ''));
/** Записи kV-аппарата по дате (старые первыми). */
export const kvRecordsOf = (j, machineId) => (j.kvRecords ?? []).filter((r) => r.machineId === machineId);
/** Записи аппарата за дату (в один день их может быть несколько — с разными режимами). */
export const kvRecordsOn = (j, machineId, date) => kvRecordsOf(j, machineId).filter((r) => r.date === date);
/** Первая запись аппарата за дату или null. */
export const kvRecordOn = (j, machineId, date) => kvRecordsOn(j, machineId, date)[0] ?? null;
/** Режим аппарата, аппликатор или камера (электрометр) упоминается в записях kV: такие из «Оборудования» не удаляются. */
export const kvModeUsed = (j, machineId, modeId) => kvRecordsOf(j, machineId).some((r) => (r.summary?.modes ?? []).some((x) => x.modeId === modeId));
export const kvAppUsed = (j, machineId, appId) => kvRecordsOf(j, machineId).some((r) => (r.summary?.modes ?? []).some((x) => (x.rows ?? []).some((y) => y.applicatorId === appId)));
export const kvEquipUsed = (j, key, id) => (j.kvRecords ?? []).some((r) => (r.summary?.modes ?? []).some((x) => x[key] === id));

/**
 * Режимы вкладки → режимы аппарата: Map(номер режима вкладки → режим аппарата). Режим вкладки находит свой по kv_jmode,
 * иначе по пучку (kvSameMode); один режим аппарата — одному режиму вкладки.
 */
export function kvModeMap(machine, visit) {
  const used = new Set();
  const found = new Map();
  visit.modes.forEach((md, m) => {
    const s = md.shared;
    const x = machine.modes.find((y) => y.id === s.kv_jmode && !used.has(y.id)) ?? machine.modes.find((y) => !used.has(y.id) && kvSameMode(y, s));
    if (x) {
      used.add(x.id);
      found.set(m, x);
    }
  });
  return found;
}

/** Итог режима modeId в записи или null. */
export const kvModeIn = (rec, modeId) => (rec.summary?.modes ?? []).find((x) => x.modeId === modeId) ?? null;

/** Последняя калибровка режима modeId аппарата раньше даты before (ISO): { rec, x } — запись и итог режима в ней, или null. */
export function kvLastCal(j, machineId, modeId, before) {
  const list = kvRecordsOf(j, machineId).filter((r) => r.mode !== 'check' && String(r.date) < before).sort(kvRecordOrder);
  for (let k = list.length - 1; k >= 0; k--) {
    const x = kvModeIn(list[k], modeId);
    if (x) return { rec: list[k], x };
  }
  return null;
}

/** Камера режима вкладки — та же, что в итоге режима записи (по записи «Оборудования», иначе по модели и номеру). */
function sameChamber(j, vc, x) {
  const c = kvFindChamber(j, vc);
  if (x.chamberId && c) return c.id === x.chamberId;
  return kvChamberName(vc) === x.chamber;
}
const fin = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Значения из журнала для вкладки (с 0.47.0) — по последней калибровке каждого режима раньше даты вкладки (без даты —
 * раньше today). Вкладка не связана с аппаратом — null. Иначе { kind, date, machineId, modes }: modes[m] — null (режима
 * вкладки нет у аппарата) или { cal, bases, pol, ks, tau, hvl, chamberOther }:
 *   cal — { id, date } последней калибровки режима (null — калибровок нет);
 *   bases[i] — { ref, date } — база строки i: мощность дозы того же аппликатора (форма, размер, РИП) при калибровке,
 *     там же, где сравнивается строка (низкие энергии — поверхность; средние — 2 г/см² или поверхность), в тех же
 *     единицах задания; null — не с чем сравнить;
 *   pol, ks — { v, date } — k_pol и k_s калибровки (только проверка выхода и та же камера; иначе null, chamberOther —
 *     камера другая); tau — { v, unit, date }; hvl — { used, U, date } — СПО, измеренный при калибровке.
 * Результат идёт в computeKvVisit(visit, jx).
 */
export function kvJournalInputs(j, visit, today = localToday()) {
  const c = visit?.common ?? {};
  if (!j || isBlank(c.kv_jmachine)) return null;
  const machine = (j.machines ?? []).find((x) => x.kind === 'kv' && x.id === c.kv_jmachine);
  if (!machine) return null;
  const date = ISO.test(str(c.kv_date)) ? str(c.kv_date) : today;
  const check = kvRecMode(visit) === 'check';
  const map = kvModeMap(machine, visit);
  const modes = visit.modes.map((md, m) => {
    const y = map.get(m);
    if (!y) return null;
    const last = kvLastCal(j, machine.id, y.id, date);
    if (!last) return { cal: null, bases: [], pol: null, ks: null, tau: null, hvl: null, chamberOther: false };
    const { rec, x } = last;
    const s = md.shared;
    const surf = s.kv_range === 'medium' && s.kv_ref_at === 'surface';
    const unitOk = !x.setUnit || x.setUnit === str(s.kv_set_unit);
    const bases = md.rows.map((row) => {
      if (!unitOk || isBlank(row.kv_cone)) return null;
      const z = (x.rows ?? []).find((w) => kvSameApp(w, row));
      const v = z ? (surf ? z.perUnitSurf : z.perUnit) : null;
      return fin(v) && v > 0 ? { ref: v, date: rec.date } : null;
    });
    const out = { cal: { id: rec.id, date: rec.date }, bases, pol: null, ks: null, tau: null, hvl: null, chamberOther: false };
    if (!check) return out;
    const same = sameChamber(j, visit.chambers[md.chamber] ?? {}, x);
    out.chamberOther = !same;
    if (same && fin(x.kpol?.v)) out.pol = { v: x.kpol.v, date: rec.date };
    if (same && fin(x.ks?.v)) out.ks = { v: x.ks.v, date: rec.date };
    if (fin(x.tau?.v)) out.tau = { v: x.tau.v, unit: str(x.tau.unit), date: rec.date };
    if (x.hvl && x.hvl.source !== 'table' && fin(x.hvl.used) && x.hvl.used > 0) out.hvl = { used: x.hvl.used, U: fin(x.hvl.U) ? x.hvl.U : null, date: x.hvl.date || rec.date };
    return out;
  });
  return { kind: check ? 'check' : 'cal', date, machineId: machine.id, modes };
}

/** Режимы вкладки, по которым есть что записать: строки с показаниями или данные листов СПО, таймера, линейности, воспроизводимости. */
function dataModes(rows, ch) {
  const ms = new Set(rows.map((r) => r.m));
  for (const list of [ch.hvl, ch.timer, ch.ln, ch.rp]) for (const x of list) ms.add(x.m);
  return [...ms].sort((a, b) => a - b);
}

/** Итог режима m для журнала. x — режим аппарата, rows — строки проверки выхода этого режима, ch — итоги листов. */
function modeSummary(j, machine, visit, vr, m, x, rows, ch) {
  const md = visit.modes[m];
  const mr = vr.modes[m];
  const s = md.shared;
  const r = mr.results[mr.stdRow >= 0 ? mr.stdRow : md.active] ?? mr.results[0];
  const vc = visit.chambers[md.chamber] ?? {};
  const chamber = kvFindChamber(j, vc);
  const electrometer = kvFindElectrometer(j, vc);
  // k_pol и k_s режима: свои (серии при обратной полярности и при V₂ в этом режиме), из другого режима вкладки или,
  // при проверке выхода, из последней калибровки режима (src: 'own' | 'mode' | 'journal'; date — дата калибровки)
  const jx = mr.jx ?? null;
  const kpol = mr.polSrc >= 0 ? { v: num(mr.kpolFix), own: true, src: 'own' }
    : jx?.pol ? { v: num(jx.pol.v), own: false, src: 'journal', date: jx.pol.date }
      : mr.polMode >= 0 ? { v: num(vr.modes[mr.polMode].kpolFix), own: false, src: 'mode' } : null;
  const ks = !mr.ksOn ? null : mr.ksSrc >= 0 ? { v: num(mr.ksFix), own: true, src: 'own' }
    : jx?.ks ? { v: num(jx.ks.v), own: false, src: 'journal', date: jx.ks.date }
      : mr.ksMode >= 0 ? { v: num(vr.modes[mr.ksMode].ksFix), own: false, src: 'mode' } : null;
  const tauOwn = mr.timer.state === 'own';
  const tauSrc = tauOwn ? 'own' : jx?.tau ? 'journal' : mr.tauMode >= 0 ? 'mode' : '';
  const tau = tauSrc && r && Number.isFinite(r.timer?.tau) ? { v: r.timer.tau, s: num(r.timer.tauS), unit: str(r.timer.unit), own: tauOwn, src: tauSrc, ...(tauSrc === 'journal' ? { date: jx.tau.date } : {}) } : null;
  const t = ch.timer.find((y) => y.m === m);
  const h = mr.hvl;
  const ln = ch.ln.find((y) => y.m === m);
  const rp = ch.rp.find((y) => y.m === m);
  const notRev1 = [...new Set(rows.flatMap((y) => mr.results[y.i]?.notRev1 ?? []))];
  return {
    m,
    modeId: x.id,
    title: kvModeLabel(s),
    range: s.kv_range === 'medium' ? 'medium' : 'low',
    kv: str(s.kv_kv),
    ma: str(s.kv_ma),
    filter: str(s.kv_filter),
    chamberId: chamber?.id ?? '',
    electrometerId: electrometer?.id ?? '',
    chamber: kvChamberName(vc),
    setUnit: str(r?.inputs?.unit),
    kpol,
    ks,
    tau,
    tauTol: t && Number.isFinite(t.tol) && t.tol ? { tol: t.tol, inTol: !!t.inTol } : null,
    hvl: {
      nominal: str(s.kv_hvl),
      measured: h?.ok ? num(h.used) : null,
      U: h?.ok ? num(h.U) : null,
      apply: !!h?.apply,
      used: num(r?.inputs?.hvl),
      source: ['measured', 'journal'].includes(r?.inputs?.hvlSource) ? r.inputs.hvlSource : 'table',
      // дата измерения СПО: свой — дата записи, из журнала — дата калибровки
      date: r?.inputs?.hvlSource === 'journal' ? str(jx?.hvl?.date) : r?.inputs?.hvlSource === 'measured' ? str(visit.common.kv_date) : '',
      mat: r?.material === 'Cu' || s.kv_range === 'medium' ? 'Cu' : 'Al',
    },
    cert: r ? { form: str(r.form?.kv_cert_form), value: num(r.cert?.value), kQ: num(r.cert?.kQ), NQ: num(r.cert?.NQ) } : null,
    ln: ln ? { q: ln.q, dMax: num(ln.dMax), clMax: num(ln.clMax), dOver: ln.dOver, clOver: ln.clOver } : null,
    rp: rp ? { n: rp.n, R: num(rp.R), cv: num(rp.cv), over: rp.over } : null,
    notRev1,
    rows: rows.map((y) => {
      const row = md.rows[y.i];
      const a = machine.applicators.find((z) => kvSameApp(z, row));
      return {
        i: y.i,
        applicatorId: a?.id ?? '',
        label: y.label,
        shape: str(row.kv_cone_shape) || 'circle',
        a: str(row.kv_cone),
        b: row.kv_cone_shape === 'rect' ? str(row.kv_cone_b) : '',
        ssd: y.ssd,
        std: y.std,
        unit: y.unit,
        where: y.where,
        D: num(y.D),
        perUnit: num(y.perUnit),
        perUnitSurf: num(y.perUnitSurf),
        base: num(y.base),
        baseAt: y.where,
        // база из журнала — дата калибровки; '' — введена вручную или её нет
        baseDate: y.baseDate ?? '',
        dev: num(y.dev),
        tol: num(y.tol),
        verdict: y.verdict,
      };
    }),
  };
}

const modesText = (list) => list.map((m) => m + 1).join(', ');

/** Итоги записи по оставшимся режимам: счёт строк проверки выхода и отступления от Rev.1 заново. */
function trimSummary(summary, modes) {
  const output = { n: 0, ok: 0, over: 0, nobase: 0, na: 0, error: 0 };
  for (const x of modes) {
    for (const y of x.rows ?? []) {
      output.n += 1;
      if (y.verdict in output) output[y.verdict] += 1;
    }
  }
  const gone = (summary.modes ?? []).filter((x) => !modes.includes(x)).map((x) => ({ m: x.m, modeId: x.modeId, title: x.title }));
  return { ...summary, modes, output, notRev1: [...new Set(modes.flatMap((x) => x.notRev1 ?? []))], replaced: [...(summary.replaced ?? []), ...gone] };
}

/**
 * Записать измерение вкладки в журнал. visit — данные вкладки, vr — её расчёт (computeKvVisit со значениями из журнала),
 * file — вкладка как файл .json (для «Открыть во вкладке»). Аппарат — связанный с вкладкой (kv_jmachine), дата — из
 * вкладки (без даты и с датой позже today не записывается), вид измерения — kv_rec_mode. Режимы вкладки находят свои
 * режимы аппарата по kv_jmode или по пучку, аппликаторы — по форме, размеру и РИП. Записать нельзя, если доза
 * какой-нибудь строки с показаниями не вычислена или на листах СПО, таймера, линейности, воспроизводимости есть ошибки.
 * Запись по режимам: у прежних записей аппарата за тот же день режимы этой записи снимаются (запись без режимов
 * удаляется, её id переходит к новой; у остальных в summary.replaced — снятые режимы).
 * Возвращает { journal, record, replaced, replacedModes } или { error }: replaced — заменены ли прежние данные,
 * replacedModes — номера режимов вкладки (с 0), чьи прежние записи за этот день заменены.
 */
export function recordKvVisit(j, { visit, today = localToday(), vr = computeKvVisit(visit, kvJournalInputs(j, visit, today)), file = null }) {
  const c = visit.common;
  if (isBlank(c.kv_jmachine)) {
    return { error: L('Вкладка не связана с аппаратом «Оборудования»: выберите аппарат в блоке «Журнал отделения» на листе «Аппарат и режимы».', 'The tab is not linked to a unit in Equipment: select the unit in the “Department journal” block on the Machine and modes sheet.') };
  }
  const machine = j.machines.find((x) => x.kind === 'kv' && x.id === c.kv_jmachine);
  if (!machine) return { error: L('Аппарат вкладки не найден в «Оборудовании»: выберите его заново в блоке «Журнал отделения».', 'The unit of the tab was not found in Equipment: select it again in the “Department journal” block.') };
  const date = str(c.kv_date);
  if (!ISO.test(date)) return { error: L('Укажите дату измерения на листе «Аппарат и режимы»: по ней измерение ложится в журнал.', 'Enter the measurement date on the Machine and modes sheet: the measurement is filed in the journal by it.') };
  const future = futureDateError(date, today);
  if (future) return { error: future };
  const rows = kvOutputRows(visit, vr);
  const ch = kvSheetChecks(visit, vr, rows);
  const ms = dataModes(rows, ch);
  if (!ms.length) return { error: L('Записывать нечего: показаний нет ни на одном листе.', 'Nothing to record: there are no readings on any sheet.') };
  const bad = rows.filter((r) => r.verdict === 'error');
  if (bad.length) {
    const list = bad.map((r) => L(`режим ${r.m + 1}, ${r.label || '—'}`, `mode ${r.m + 1}, ${r.label || '—'}`)).join('; ');
    return { error: L(`Доза не вычислена (${list}): исправьте ошибки (см. «Замечания»), затем запишите.`, `The dose was not calculated (${list}): fix the errors (see Messages), then record.`) };
  }
  const sheetErr = [
    [ch.hvl.filter((x) => !x.ok), L('«СПО и k_Q»', 'HVL and k_Q')],
    [ch.timer.filter((x) => !x.ok), L('«Ошибка таймера»', 'Timer error')],
    [ch.ln.filter((x) => !x.ok), L('«Линейность»', 'Linearity')],
    [ch.rp.filter((x) => !x.ok), L('«Воспроизводимость»', 'Reproducibility')],
  ].filter(([list]) => list.length);
  if (sheetErr.length) {
    const list = sheetErr.map(([l, name]) => L(`${name} — режим ${modesText(l.map((x) => x.m))}`, `${name}: mode ${modesText(l.map((x) => x.m))}`)).join('; ');
    return { error: L(`Ошибки на листах: ${list}. Исправьте их или очистите незаконченные измерения, затем запишите.`, `Errors on the sheets: ${list}. Fix them or clear the unfinished measurements, then record.`) };
  }
  // режимы вкладки → режимы аппарата (по kv_jmode, иначе по пучку; один режим аппарата — одному режиму вкладки)
  const found = kvModeMap(machine, visit);
  const lost = ms.filter((m) => !found.has(m));
  if (lost.length) {
    return {
      error: L(
        `${lost.length > 1 ? 'Режимы' : 'Режим'} ${modesText(lost)} не ${lost.length > 1 ? 'найдены' : 'найден'} у аппарата «${kvMachineText(machine) || 'без названия'}» в «Оборудовании»: сохраните аппарат в «Оборудование» (лист «Аппарат и режимы»), затем запишите.`,
        `Mode${lost.length > 1 ? 's' : ''} ${modesText(lost)} not found in the unit “${kvMachineText(machine) || 'unnamed'}” in Equipment: save the unit to Equipment (the Machine and modes sheet), then record.`,
      ),
    };
  }
  const modes = ms.map((m) => modeSummary(j, machine, visit, vr, m, found.get(m), rows.filter((r) => r.m === m), ch));
  // прежние записи того же дня: режимы этой записи у них снимаются
  const ids = new Set(modes.map((x) => x.modeId));
  const changed = new Map();
  for (const r of kvRecordsOn(j, machine.id, date)) {
    const left = (r.summary?.modes ?? []).filter((x) => !ids.has(x.modeId));
    if (left.length === (r.summary?.modes ?? []).length) continue;
    changed.set(r.id, left.length ? { ...r, summary: trimSummary(r.summary, left) } : null);
  }
  const whole = [...changed].find(([, v]) => v === null)?.[0];
  const record = {
    id: whole ?? uid('kr'),
    machineId: machine.id,
    date,
    mode: kvRecMode(visit),
    staff: (Array.isArray(c.kv_staff) ? c.kv_staff : [c.kv_staff]).map(str).filter(Boolean),
    saved: new Date().toISOString(),
    version: APP_VERSION,
    file,
    summary: { modes, output: ch.output, notRev1: [...new Set(modes.flatMap((x) => x.notRev1))] },
  };
  const kvRecords = (j.kvRecords ?? [])
    .map((x) => (changed.has(x.id) ? changed.get(x.id) : x))
    .filter((x) => x && x.id !== record.id)
    .concat([record])
    .sort(kvRecordOrder);
  const before = new Set(kvRecordsOn(j, machine.id, date).flatMap((r) => (r.summary?.modes ?? []).map((x) => x.modeId)));
  const replacedModes = modes.filter((x) => before.has(x.modeId)).map((x) => x.m);
  return { journal: { ...j, kvRecords }, record, replaced: replacedModes.length > 0, replacedModes };
}

/** Итог записи для списка: { modes, rows, over [{ m, label, dev }], nobase } — режимов, строк, вне допуска, без базы. */
export function kvRecordCounts(rec) {
  const modes = rec.summary?.modes ?? [];
  const over = [];
  let rows = 0;
  let nobase = 0;
  for (const x of modes) {
    for (const y of x.rows ?? []) {
      rows += 1;
      if (y.verdict === 'over') over.push({ m: x.m, title: x.title, label: y.label, dev: y.dev });
      if (y.verdict === 'nobase') nobase += 1;
    }
  }
  return { modes: modes.length, rows, over, nobase };
}
