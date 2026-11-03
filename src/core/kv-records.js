// Журнал kV (с 0.46.0): запись измерения вкладки «kV-рентген» в журнал отделения (j.kvRecords). Одна запись —
// рентгенотерапевтический аппарат «Оборудования» за один день: вся вкладка (как файл .json вкладки — запись можно снова
// открыть во вкладке) и итоги по режимам (k_pol, k_s, τ, СПО, k_Q, линейность, воспроизводимость) и аппликаторам
// (мощность дозы, базовое значение, отклонение, решение о калибровке). Повторная запись того же дня заменяет прежнюю.
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

/** Записи kV-аппарата по дате (старые первыми). */
export const kvRecordsOf = (j, machineId) => (j.kvRecords ?? []).filter((r) => r.machineId === machineId);
/** Запись аппарата за дату или null: одна запись на аппарат за день. */
export const kvRecordOn = (j, machineId, date) => (j.kvRecords ?? []).find((r) => r.machineId === machineId && r.date === date) ?? null;
/** Режим аппарата, аппликатор или камера (электрометр) упоминается в записях kV: такие из «Оборудования» не удаляются. */
export const kvModeUsed = (j, machineId, modeId) => kvRecordsOf(j, machineId).some((r) => (r.summary?.modes ?? []).some((x) => x.modeId === modeId));
export const kvAppUsed = (j, machineId, appId) => kvRecordsOf(j, machineId).some((r) => (r.summary?.modes ?? []).some((x) => (x.rows ?? []).some((y) => y.applicatorId === appId)));
export const kvEquipUsed = (j, key, id) => (j.kvRecords ?? []).some((r) => (r.summary?.modes ?? []).some((x) => x[key] === id));

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
  // k_pol и k_s режима: свои (серии при обратной полярности и при V₂ в этом режиме) или взятые из другого режима
  const kpol = mr.polSrc >= 0 ? { v: num(mr.kpolFix), own: true } : mr.polMode >= 0 ? { v: num(vr.modes[mr.polMode].kpolFix), own: false } : null;
  const ks = !mr.ksOn ? null : mr.ksSrc >= 0 ? { v: num(mr.ksFix), own: true } : mr.ksMode >= 0 ? { v: num(vr.modes[mr.ksMode].ksFix), own: false } : null;
  const tauOwn = mr.timer.state === 'own';
  const tau = (tauOwn || mr.tauMode >= 0) && r && Number.isFinite(r.timer?.tau) ? { v: r.timer.tau, s: num(r.timer.tauS), unit: str(r.timer.unit), own: tauOwn } : null;
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
      source: r?.inputs?.hvlSource === 'measured' ? 'measured' : 'table',
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
        dev: num(y.dev),
        tol: num(y.tol),
        verdict: y.verdict,
      };
    }),
  };
}

const modesText = (list) => list.map((m) => m + 1).join(', ');

/**
 * Записать измерение вкладки в журнал. visit — данные вкладки, vr — её расчёт (computeKvVisit), file — вкладка как
 * файл .json (для «Открыть во вкладке»). Аппарат — связанный с вкладкой (kv_jmachine), дата — из вкладки (без даты и
 * с датой позже today не записывается), вид измерения — kv_rec_mode. Режимы вкладки находят свои режимы аппарата по
 * kv_jmode или по пучку, аппликаторы — по форме, размеру и РИП. Записать нельзя, если доза какой-нибудь строки с
 * показаниями не вычислена или на листах СПО, таймера, линейности, воспроизводимости есть ошибки.
 * Возвращает { journal, record, replaced } или { error }.
 */
export function recordKvVisit(j, { visit, vr = computeKvVisit(visit), file = null, today = localToday() }) {
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
  const lost = ms.filter((m) => !found.has(m));
  if (lost.length) {
    return {
      error: L(
        `${lost.length > 1 ? 'Режимы' : 'Режим'} ${modesText(lost)} не ${lost.length > 1 ? 'найдены' : 'найден'} у аппарата «${kvMachineText(machine) || 'без названия'}» в «Оборудовании»: сохраните аппарат в «Оборудование» (лист «Аппарат и режимы»), затем запишите.`,
        `Mode${lost.length > 1 ? 's' : ''} ${modesText(lost)} not found in the unit “${kvMachineText(machine) || 'unnamed'}” in Equipment: save the unit to Equipment (the Machine and modes sheet), then record.`,
      ),
    };
  }
  const old = kvRecordOn(j, machine.id, date);
  const modes = ms.map((m) => modeSummary(j, machine, visit, vr, m, found.get(m), rows.filter((r) => r.m === m), ch));
  const record = {
    id: old?.id ?? uid('kr'),
    machineId: machine.id,
    date,
    mode: kvRecMode(visit),
    staff: (Array.isArray(c.kv_staff) ? c.kv_staff : [c.kv_staff]).map(str).filter(Boolean),
    saved: new Date().toISOString(),
    version: APP_VERSION,
    file,
    summary: { modes, output: ch.output, notRev1: [...new Set(modes.flatMap((x) => x.notRev1))] },
  };
  const kvRecords = (j.kvRecords ?? []).filter((x) => x.id !== record.id).concat([record]).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return { journal: { ...j, kvRecords }, record, replaced: !!old };
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
