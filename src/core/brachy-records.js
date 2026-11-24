// Записи брахитерапии в журнале отделения (j.brachyRecords, с 0.76.0): измерение листа вкладки «Брахитерапия» за
// день — сила источника колодезной камерой или в фантоме PTW 9193, проверка стабильности камеры, сличение камер,
// максимум отклика. В записи — итог (summary) для списка и трендов и снимок полей листа (form) — открыть запись на листе.
// Повторная запись того же листа, дня, аппарата и камеры заменяет прежнюю.

import { L } from './i18n.js';
import { isBlank } from './units.js';
import { futureDateError, localToday, uid } from './journal.js';
import { APP_VERSION } from './version.js';
import { BRACHY_DEFAULTS } from './brachy-sheets.js';

const str = (v) => (v === undefined || v === null ? '' : String(v));
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const num = (x) => (Number.isFinite(x) ? x : null);

/** Листы, измерения которых записываются в журнал. */
export const BRACHY_RECORD_SHEETS = ['well', 'phantom', 'stab', 'cross', 'sweet'];

/** Название вида записи (листа). */
export function brachySheetText(sheet) {
  return {
    well: L('сила источника, колодезная камера', 'source strength, well-type chamber'),
    phantom: L('сила источника, фантом PTW 9193', 'source strength, PTW 9193 phantom'),
    stab: L('стабильность камеры', 'chamber stability'),
    cross: L('сличение камер', 'cross-calibration'),
    sweet: L('максимум отклика', 'sweet spot'),
  }[sheet] ?? sheet;
}

/** Поле даты измерения листа. */
export const BRACHY_DATE_KEY = { well: 'w_date', phantom: 'p_date', stab: 'st_date', cross: 'x_ref_date', sweet: 's_date' };

/** Поля листа в снимке записи: общие (источник, выбор из «Оборудования») и свои по префиксу. */
const SHEET_PREFIX = { well: ['w_', 'u_scen', 'u_over_w'], phantom: ['p_', 'u_scen', 'u_over_p'], stab: ['st_'], cross: ['x_'], sweet: ['s_', 'w_pos'] };
const COMMON = ['nuclide', 'half', 'src_name', 'cert_', 'j_'];
export function brachyFormSnapshot(sheet, form) {
  const keep = [...COMMON, ...(SHEET_PREFIX[sheet] ?? [])];
  const out = {};
  for (const k of Object.keys(BRACHY_DEFAULTS)) if (keep.some((p) => k === p || k.startsWith(p))) out[k] = structuredClone(form[k] ?? BRACHY_DEFAULTS[k]);
  return out;
}

/**
 * Итог записи по результату листа r: well, phantom — ОМВК (мГр/ч на 1 м), S_K (U), отклонение от сертификата;
 * stab — значение, исходное, отклонение и допуск; cross — N рабочей камеры, отношение, отличие от прежнего;
 * sweet — максимум, плато 99 % и сдвиг от положения в сертификате.
 */
export function brachySummary(sheet, form, r) {
  const base = { nuclide: str(form.nuclide) };
  if (sheet === 'well' || sheet === 'phantom') {
    return {
      ...base,
      mGyh: num(r.mGyh),
      U: num(r.U),
      expected: num(r.compare?.expected),
      dev: num(r.compare?.dev),
      level: str(r.compare?.level),
      variant: sheet === 'phantom' ? str(r.main?.id) : '',
      variantLabel: sheet === 'phantom' ? str(r.main?.label) : '',
    };
  }
  if (sheet === 'stab') return { ...base, method: str(r.method), value: num(r.value), base: num(r.base), dev: num(r.dev), pass: r.pass === undefined ? null : !!r.pass, tol: num(r.tol), unit: str(form.st_unit) };
  if (sheet === 'cross') return { ...base, N: num(r.N), unit: str(r.unit), ratio: num(r.ratio), prev: num(r.prev?.N), dev: num(r.prev?.dev) };
  if (sheet === 'sweet') return { ...base, xPeak: num(r.xPeak), plateau: r.plateau?.[99] ? { from: num(r.plateau[99].from), to: num(r.plateau[99].to) } : null, shift: num(r.atCert?.shift) };
  return base;
}

/** Аппарат и камера записи по листу: сила источника — афтерлоадер; стабильность и максимум — колодезная камера; сличение — рабочая камера. */
function recordLinks(sheet, form) {
  return {
    machineId: ['well', 'phantom', 'sweet'].includes(sheet) ? str(form.j_machine) : '',
    sourceId: ['well', 'phantom'].includes(sheet) ? str(form.j_source) : '',
    chamberId: sheet === 'phantom' ? str(form.j_phantom) : sheet === 'cross' ? str(form.j_fld) : str(form.j_well),
    refChamberId: sheet === 'cross' ? str(form.j_ref) : '',
  };
}

/**
 * Записать измерение листа в журнал. r — результат расчёта листа; sourceId — источник аппарата на дату (если выбран
 * «по дате измерения», его id подставляет вызывающий). Возвращает { journal, record, replaced } или { error }.
 */
export function recordBrachy(j, { sheet, form, r, staff = [], notes = '', sourceId = '', today = localToday() }) {
  if (!BRACHY_RECORD_SHEETS.includes(sheet)) return { error: L('Этот лист в журнал не записывается.', 'This sheet is not recorded in the journal.') };
  const date = str(form[BRACHY_DATE_KEY[sheet]]);
  if (!ISO.test(date)) return { error: L('Укажите дату измерения: по ней запись ложится в журнал.', 'Enter the measurement date: the record is filed in the journal by it.') };
  const future = futureDateError(date, today);
  if (future) return { error: future };
  if (!r?.ok) return { error: L('Расчёт не выполнен: заполните лист (см. замечания), затем запишите.', 'The calculation is not done: complete the sheet (see the messages), then record.') };
  if ((sheet === 'well' || sheet === 'phantom') && !Number.isFinite(r.U)) return { error: L('Сила источника не вычислена.', 'The source strength was not calculated.') };
  const links = recordLinks(sheet, form);
  if (!links.sourceId && sourceId) links.sourceId = sourceId;
  if (['well', 'phantom'].includes(sheet) && !links.machineId) return { error: L('Выберите афтерлоадер из «Оборудования» в разделе 1: записи силы источника ведутся по аппарату и его источникам.', 'Select the afterloader from Equipment in section 1: source strength records are kept by afterloader and its sources.') };
  if (sheet === 'cross' && !links.chamberId) return { error: L('Выберите рабочую камеру из «Оборудования»: записи сличения ведутся по камере.', 'Select the field chamber from Equipment: cross-calibration records are kept by chamber.') };
  if ((sheet === 'stab' || sheet === 'sweet') && !links.chamberId) return { error: L('Выберите колодезную камеру из «Оборудования»: записи ведутся по камере.', 'Select the well-type chamber from Equipment: the records are kept by chamber.') };
  if (sheet === 'stab' && !Number.isFinite(r.dev)) return { error: L('Нет исходного значения: отклонение не вычислено. Введите исходное или запишите это значение как исходное.', 'There is no baseline: the deviation was not calculated. Enter the baseline or record this value as the baseline.') };
  const same = (x) => x.sheet === sheet && x.date === date && x.machineId === links.machineId && x.chamberId === links.chamberId && (sheet !== 'stab' || x.summary?.method === r.method);
  const old = (j.brachyRecords ?? []).find(same);
  const record = {
    id: old?.id ?? uid('br'),
    ...(old?.spcRestart ? { spcRestart: true } : {}),
    sheet,
    ...links,
    date,
    staff: staff.map(str).map((s) => s.trim()).filter(Boolean),
    notes: str(notes),
    saved: new Date().toISOString(),
    version: APP_VERSION,
    summary: brachySummary(sheet, form, r),
    form: brachyFormSnapshot(sheet, form),
  };
  const brachyRecords = (j.brachyRecords ?? []).filter((x) => x.id !== record.id).concat([record]).sort(brachyRecordOrder);
  return { journal: { ...j, brachyRecords }, record, replaced: !!old };
}

export const brachyRecordOrder = (a, b) => str(a.date).localeCompare(str(b.date)) || str(a.saved).localeCompare(str(b.saved));

/** Удалить запись. */
export function removeBrachyRecord(j, id) {
  return { ...j, brachyRecords: (j.brachyRecords ?? []).filter((x) => x.id !== id) };
}

/** Записи с отбором: sheet, machineId, chamberId (пусто — любые). */
export function brachyRecordsOf(j, { sheet = '', machineId = '', chamberId = '' } = {}) {
  return (j.brachyRecords ?? []).filter((r) => (!sheet || r.sheet === sheet) && (!machineId || r.machineId === machineId) && (!chamberId || r.chamberId === chamberId || r.refChamberId === chamberId));
}

/** Перенести снимок записи в поля листов (остальные поля формы не трогаются). */
export function formFromRecord(form, rec) {
  return { ...form, ...structuredClone(rec?.form ?? {}) };
}

/** Есть ли что записывать: пустой ли лист (без даты) — для подсказки кнопки. */
export const brachyHasDate = (sheet, form) => !isBlank(form?.[BRACHY_DATE_KEY[sheet]]);
