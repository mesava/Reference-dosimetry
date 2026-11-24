// Брахитерапия в журнале отделения (с 0.75.0): афтерлоадер — аппарат «Оборудования» (machine.kind = 'brachy') с историей
// источников (сертификат каждого источника, даты установки и замены); сертификат колодезной камеры — в карточке
// камеры (chamber.brachy: строки «аппарат + адаптер + нуклид» с N, общие T₀, P₀ и сведения о свидетельстве).
// Всё хранится в общем файле журнала; формат файла с этими данными — 5 (journalFormat).

import { isBlank } from './units.js';
import { L } from './i18n.js';
import { HALF_LIVES, DOSE_SOURCES, KSM_SOURCES, WELL_CHAMBERS, WELL_OTHER } from './brachy-data.js';

const str = (v) => (v === undefined || v === null ? '' : String(v));
const arr = (v) => (Array.isArray(v) ? v : []);
const rid = (prefix) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** Источник афтерлоадера: нуклид, модель (id из DOSE_SOURCES или своя), номер, сертификат (как на листах), установка и замена. */
export const BRACHY_SOURCE_DEFAULTS = {
  id: '',
  nuclide: 'Ir-192',
  model: '', // id из DOSE_SOURCES или '' — своя (modelName)
  modelName: '',
  serial: '',
  certValue: '',
  certUnit: 'mGy/h',
  certGamma: '',
  certGammaUnit: 'uGy·m2/(h·GBq)',
  certDate: '',
  certTime: '',
  certZone: '',
  certU: '',
  installed: '', // дата установки (ISO)
  removed: '', // дата замены (ISO); пусто — источник в аппарате
  notes: '',
};

/** Строка сертификата колодезной камеры: аппарат и адаптер, нуклид, модель источника калибровки, N и его U, опорная точка. */
export const BRACHY_CERT_ROW_DEFAULTS = { id: '', label: '', nuclide: 'Ir-192', sm0: '', N: '', N_unit: 'Gy·m2/(h·A)', U: '', pos: '' };
/** Сертификат колодезной камеры: строки, условия T₀, P₀ (кПа) и сведения о свидетельстве. */
export const BRACHY_CERT_DEFAULTS = { rows: [], T0: '20', P0: '101,325', lab: '', cert: '', calDate: '', dueDate: '' };

export const newBrachySource = (fields = {}) => ({ ...BRACHY_SOURCE_DEFAULTS, id: rid('bs'), ...fields });
export const newBrachyCertRow = (fields = {}) => ({ ...BRACHY_CERT_ROW_DEFAULTS, id: rid('bc'), ...fields });

/** Афтерлоадер из файла: источники — с полями по умолчанию, по дате установки. */
export function normalizeBrachyMachine(m) {
  const out = { ...m, kind: 'brachy', beams: [] };
  out.channelLen = str(m.channelLen);
  out.sources = arr(m.sources)
    .filter((s) => s && typeof s === 'object')
    .map((s) => {
      const x = { ...BRACHY_SOURCE_DEFAULTS, ...s };
      for (const k of Object.keys(BRACHY_SOURCE_DEFAULTS)) x[k] = str(x[k]);
      if (!Object.hasOwn(HALF_LIVES, x.nuclide)) x.nuclide = 'Ir-192';
      if (!x.id) x.id = rid('bs');
      return x;
    })
    .sort((a, b) => str(a.installed).localeCompare(str(b.installed)));
  return out;
}

/** Сертификат колодезной камеры из файла или null (если его нет). */
export function normalizeBrachyCert(b) {
  if (!b || typeof b !== 'object') return null;
  const out = { ...BRACHY_CERT_DEFAULTS, ...b };
  for (const k of ['T0', 'P0', 'lab', 'cert', 'calDate', 'dueDate']) out[k] = str(out[k]);
  out.rows = arr(b.rows)
    .filter((r) => r && typeof r === 'object')
    .map((r) => {
      const x = { ...BRACHY_CERT_ROW_DEFAULTS, ...r };
      for (const k of Object.keys(BRACHY_CERT_ROW_DEFAULTS)) x[k] = str(x[k]);
      if (!x.id) x.id = rid('bc');
      return x;
    });
  return out;
}

/** В журнале есть данные брахитерапии (формат файла 5). */
export const hasBrachy = (j) =>
  (j.machines ?? []).some((m) => m.kind === 'brachy') || (j.chambers ?? []).some((c) => c.brachy && (c.brachy.rows?.length || !isBlank(c.brachy.cert))) || (j.brachyRecords ?? []).length > 0;

/** Колодезная камера базы по модели (ch_model). */
export const findWellChamber = (id) => WELL_CHAMBERS.find((c) => c.id === id) ?? null;
/** Модель камеры — колодезная (из базы или «другая колодезная»). */
export const isWellModel = (id) => !!findWellChamber(id) || id === WELL_OTHER;
/** Название колодезной камеры: «PTW TW33004 SourceCheck 4π»; у «другой» — введённое название. */
export function wellChamberLabel(f) {
  const w = findWellChamber(f?.ch_model);
  if (w) return `${w.maker} ${w.model}`;
  return f?.ch_model === WELL_OTHER ? str(f.e_other_name).trim() || L('другая колодезная камера', 'other well-type chamber') : '';
}
/** Модели источников для строки сертификата (sm0): источники TG-43 и табл. 8 TRS-492 без повторов. */
export const SOURCE_MODELS = [...DOSE_SOURCES.map((x) => ({ id: x.id, name: x.name, nuclide: x.nuclide })), ...KSM_SOURCES.filter((k) => !DOSE_SOURCES.some((x) => x.id === k.id)).map((k) => ({ id: k.id, name: k.name, nuclide: 'Ir-192' }))];

/** Чего не хватает сертификату колодезной камеры: строки с N. */
export function brachyCertMissing(c) {
  const rows = c?.brachy?.rows ?? [];
  if (!rows.length) return [L('строка сертификата (аппарат, адаптер, нуклид, N)', 'a certificate row (afterloader, adapter, nuclide, N)')];
  return rows.some((r) => isBlank(r.N)) ? [L('N в строке сертификата', 'N in a certificate row')] : [];
}

/** Афтерлоадеры журнала. */
export const brachyMachines = (j) => (j?.machines ?? []).filter((m) => m.kind === 'brachy');

/** Источник, стоявший в аппарате на дату date (ISO): установлен не позже даты и не заменён до неё; без даты — текущий. */
export function sourceOn(m, date = '') {
  const list = m?.sources ?? [];
  const d = str(date);
  const ok = (s) => (!d || isBlank(s.installed) || s.installed <= d) && (isBlank(s.removed) || (d && s.removed > d));
  const cur = list.filter(ok);
  return cur.at(-1) ?? null;
}

/** Модель источника: название из DOSE_SOURCES или своё. */
export function sourceModelName(s) {
  if (!s) return '';
  return SOURCE_MODELS.find((x) => x.id === s.model)?.name ?? s.modelName ?? '';
}

/** Источник одной строкой: «¹⁹²Ir, mHDR-v2, № D36A-1234, установлен 01.10.2026». */
export function sourceText(s) {
  if (!s) return '';
  const p = (x) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(x));
    return m ? L(`${m[3]}.${m[2]}.${m[1]}`, x) : str(x);
  };
  return [HALF_LIVES[s.nuclide]?.label, sourceModelName(s), s.serial ? L(`№ ${s.serial}`, `No. ${s.serial}`) : '', s.installed ? L(`установлен ${p(s.installed)}`, `installed ${p(s.installed)}`) : '', s.removed ? L(`заменён ${p(s.removed)}`, `replaced ${p(s.removed)}`) : '']
    .filter(Boolean)
    .join(', ');
}

/** Поля листов «Брахитерапии» из источника аппарата: нуклид, название, сертификат; модель — для дозы по TG-43. */
export function sourceToForm(s, m = null) {
  if (!s) return {};
  const model = DOSE_SOURCES.some((x) => x.id === s.model && x.lambda) ? s.model : '';
  return {
    nuclide: s.nuclide,
    src_name: [m?.name, sourceModelName(s), s.serial ? `№ ${s.serial}` : ''].filter(Boolean).join(', '),
    cert_value: s.certValue,
    cert_unit: s.certUnit,
    cert_gamma: s.certGamma,
    cert_gamma_unit: s.certGammaUnit,
    cert_date: s.certDate,
    cert_time: s.certTime,
    cert_zone: s.certZone,
    cert_U: s.certU,
    ...(model ? { p_src: model, t_src: model } : {}),
  };
}

/** Строки сертификата камеры для нуклида (сначала подходящие). */
export const certRowsFor = (c, nuclide) => (c?.brachy?.rows ?? []).filter((r) => !nuclide || r.nuclide === nuclide);

/**
 * Поля листа «Колодезная камера» из камеры журнала и строки её сертификата: модель, номер, N, U, T₀, P₀; k_sm,sm0 —
 * «тот же источник», если модель источника аппарата совпадает с моделью калибровки (sm0).
 */
export function wellChamberToForm(c, row, { name = '', sourceModel = '' } = {}) {
  if (!c || !row) return {};
  const b = c.brachy ?? BRACHY_CERT_DEFAULTS;
  const out = {
    w_model: name,
    w_serial: str(c.form?.ch_serial),
    w_N: row.N,
    w_N_unit: row.N_unit,
    w_NU: row.U,
    w_T0: b.T0 || '20',
    w_P0: b.P0 || '101,325',
    w_P0_unit: 'kPa',
  };
  if (!isBlank(row.pos)) out.s_cert_pos = row.pos;
  if (!isBlank(row.sm0) && !isBlank(sourceModel)) out.w_ksm_mode = row.sm0 === sourceModel ? 'same' : 'none';
  return out;
}

/**
 * Поля листа «Фантом PTW 9193» из камеры журнала: модель, номер, N_D,w в ⁶⁰Co (свидетельство для МВ и ⁶⁰Co) с единицей
 * и k_лаб, T₀, P₀; калибровка — N_w (поглощённая доза в воде). name — название камеры (chamberText без номера).
 */
export function phantomChamberToForm(c, { name = '' } = {}) {
  if (!c) return {};
  const f = c.form ?? {};
  const out = { p_model: name, p_serial: str(f.ch_serial), p_calib: 'Nw', p_T0: str(f.ch_T0) || '20', p_P0: str(f.ch_P0) || '101,325', p_P0_unit: 'kPa' };
  if (!isBlank(f.ch_ndw)) {
    // k_лаб — множитель к N_D,w из протокола поверки
    const klab = Number(String(f.ch_klab ?? '').replace(',', '.'));
    const n = Number(String(f.ch_ndw).replace(',', '.'));
    out.p_N = Number.isFinite(klab) && klab > 0 && klab !== 1 && Number.isFinite(n) ? String(+(n * klab).toPrecision(6)).replace('.', ',') : str(f.ch_ndw);
    out.p_N_unit = str(f.ch_ndw_unit) || 'Gy/nC';
  }
  return out;
}
