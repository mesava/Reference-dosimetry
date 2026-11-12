// Рентгенотерапевтический аппарат в «Оборудовании» (журнал, machine.kind === 'kv', с 0.41.0).
// У аппарата — список аппликаторов (обозначение, форма, размер, РИП) и режимы (диапазон, напряжение, ток, фильтр, СПО,
// камера, отмеченные аппликаторы, стандартный аппликатор). Камера режима выбирается в разделе 4 «Оборудования» (таблица
// «Камеры режимов», с 0.50.0), электрометр — «Электрометр при калибровке» камеры (electrometerId режима — последний
// электрометр вкладки, когда у камеры он не указан). Пучков (beams) у него нет: измеряют во вкладке
// «kV-рентген», куда режимы аппарата подставляются (этап C2). Расчёта здесь нет, только проверки ввода и проверка
// референсного аппликатора по TRS-398 Rev.1 (средние энергии — табл. 31; низкие зависят от калибровки камеры, табл. 26
// и 27, и проверяются во вкладке).
import { parseNumber, isBlank, ru } from './units.js';
import { L } from './i18n.js';
import { KV_CHAMBERS } from './kv-tables.js';
import { findChamber } from './chambers.js';
import { findEChamber } from './electron-chambers.js';

const str = (v) => (v === undefined || v === null ? '' : String(v));
const arr = (v) => (Array.isArray(v) ? v : []);
const rid = (prefix) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export const KV_SHAPES = ['circle', 'square', 'rect'];
export const KV_RANGES = ['low', 'medium'];
// ------------------------------------------------------------ модели камер: вкладка kV ↔ запись камеры журнала
/** id камеры вкладки kV → id записи камеры журнала (база фотонов) там, где они разные. */
const KV_TO_JOURNAL = { 'IBA-FC65-G': 'FC65G', 'IBA-FC65-P': 'FC65P', 'EXR-A12': 'A12' };
const JOURNAL_TO_KV = Object.fromEntries(Object.entries(KV_TO_JOURNAL).map(([k, v]) => [v, k]));
/** Камера только для kV-рентгена — её нет в базах фотонов и электронов (PTW 23342, 23344, 34013); null — не такая. */
export const findKvOnlyChamber = (id) =>
  !id || KV_TO_JOURNAL[id] || findChamber(id) || findEChamber(id) ? null : KV_CHAMBERS.find((c) => c.id === id) ?? null;
export const KV_ONLY_CHAMBERS = KV_CHAMBERS.filter((c) => findKvOnlyChamber(c.id));
/** Модель записи журнала для камеры вкладки kV. */
export const journalModelOfKv = (id) => KV_TO_JOURNAL[id] ?? id;
/** Модель вкладки kV для записи журнала; пусто — камеры нет в списке вкладки. */
export const kvModelOfJournal = (id) => JOURNAL_TO_KV[id] ?? (KV_CHAMBERS.some((c) => c.id === id && !KV_TO_JOURNAL[c.id]) ? id : '');
/**
 * Тип камеры записи журнала: 'pp' — плоскопараллельная, 'cyl' — цилиндрическая, '' — неизвестен. По базе вкладки kV,
 * базе электронов (плоскопараллельные) и полю «Тип» у другой камеры; камеры базы фотонов — цилиндрические.
 */
export function journalChamberType(ch) {
  const f = ch?.form ?? {};
  const id = str(f.ch_model);
  const kv = KV_CHAMBERS.find((c) => c.id === kvModelOfJournal(id));
  if (kv) return kv.type;
  if (id === 'OTHER') return f.e_other_type === 'cyl' ? 'cyl' : 'pp';
  if (findEChamber(id)?.type === 'pp') return 'pp';
  if (findChamber(id)) return 'cyl';
  return '';
}
/**
 * Камера годится для режима диапазона range: для средних энергий — только цилиндрическая (TRS-398 Rev.1, разд. 9.2.1,
 * табл. 31; DIN 6809-4, разд. 6.2.1 — компактные камеры). Для низких энергий годятся обе: плоскопараллельная для
 * внутрифантомного метода, цилиндрическая — для воздушного от 70 кВ (разд. 8.2.1); это проверяется во вкладке.
 */
export const kvChamberFitsRange = (ch, range) => range !== 'medium' || journalChamberType(ch) !== 'pp';

/** Аппликатор: name — обозначение на тубусе («F30»), shape, a (диаметр или сторона, см), b (вторая сторона), ssd (РИП, см). */
export const KV_APPLICATOR_DEFAULTS = { id: '', name: '', shape: 'circle', a: '', b: '', ssd: '' };
/**
 * Режим: label — своё обозначение (пусто — по кВ, мА и фильтру), range — 'low' (СПО в мм Al) или 'medium' (мм Cu),
 * hvl — СПО, которым считается k_Q; hvlSource — 'nominal' (паспорт, приёмка) или 'measured' (измерен, дата hvlDate);
 * chamberId — камера режима; electrometerId — электрометр, с которым режим мерили во вкладке последний раз (до 0.50.0 —
 * выбранный у режима): он подставляется, только если у камеры не указан «Электрометр при калибровке»;
 * applicators — id отмеченных аппликаторов аппарата, refApplicator — id стандартного.
 */
export const KV_MODE_DEFAULTS = {
  id: '', label: '', range: 'medium', kv: '', ma: '', filter: '', hvl: '', hvlSource: 'nominal', hvlDate: '',
  chamberId: '', electrometerId: '', applicators: [], refApplicator: '', notes: '',
};
/** Аппарат: tube — номер (серийный) рентгеновской трубки; после замены трубки СПО меряют заново. */
export const KV_MACHINE_EXTRA = { tube: '', applicators: [], modes: [], plates: [] };
/**
 * Пластина набора для измерения СПО (с 0.43.0; вводится на листе «СПО и k_Q» вкладки kV и сохраняется с аппаратом):
 * name — обозначение («Al1»), mat — 'Al' | 'Cu', nom и t — номинальная и измеренная толщина, u — u(t), мм.
 */
export const KV_PLATE_DEFAULTS = { name: '', mat: 'Al', nom: '', t: '', u: '' };

export function newKvApplicator(from = {}) {
  return { ...KV_APPLICATOR_DEFAULTS, shape: from.shape ?? 'circle', ssd: str(from.ssd), id: rid('a') };
}
export function newKvMachineMode(from = null, extra = {}) {
  const base = from
    ? { range: from.range, chamberId: from.chamberId, applicators: [...arr(from.applicators)], refApplicator: from.refApplicator }
    : {};
  return { ...KV_MODE_DEFAULTS, ...base, ...extra, id: rid('k') };
}

function normApplicator(a) {
  const x = { ...KV_APPLICATOR_DEFAULTS, ...(a && typeof a === 'object' ? a : {}) };
  for (const k of ['id', 'name', 'a', 'b', 'ssd']) x[k] = str(x[k]);
  if (!KV_SHAPES.includes(x.shape)) x.shape = 'circle';
  if (!x.id) x.id = rid('a');
  return x;
}
function normMode(m, appIds) {
  const x = { ...KV_MODE_DEFAULTS, ...(m && typeof m === 'object' ? m : {}) };
  for (const k of ['id', 'label', 'kv', 'ma', 'filter', 'hvl', 'hvlDate', 'chamberId', 'electrometerId', 'refApplicator', 'notes']) x[k] = str(x[k]);
  if (!KV_RANGES.includes(x.range)) x.range = 'medium';
  if (x.hvlSource !== 'measured') x.hvlSource = 'nominal';
  // только аппликаторы этого аппарата, без повторов
  x.applicators = [...new Set(arr(x.applicators).map(str))].filter((id) => appIds.has(id));
  if (x.refApplicator && !appIds.has(x.refApplicator)) x.refApplicator = '';
  if (!x.id) x.id = rid('k');
  return x;
}

/** Аппарат kV из файла журнала: недостающие поля — по умолчанию, у аппликаторов и режимов без id — новый id. */
export function normalizeKvMachine(m) {
  const out = { ...m, kind: 'kv', tube: str(m?.tube), beams: [] };
  out.applicators = arr(m?.applicators).map(normApplicator);
  const ids = new Set(out.applicators.map((a) => a.id));
  out.modes = arr(m?.modes).map((x) => normMode(x, ids));
  out.plates = arr(m?.plates)
    .map((p) => {
      const x = { ...KV_PLATE_DEFAULTS, ...(p && typeof p === 'object' ? p : {}) };
      for (const k of ['name', 'nom', 't', 'u']) x[k] = str(x[k]);
      x.mat = x.mat === 'Cu' ? 'Cu' : 'Al';
      return { name: x.name, mat: x.mat, nom: x.nom, t: x.t, u: x.u };
    })
    .filter((x) => [x.name, x.nom, x.t, x.u].some((v) => !isBlank(v)));
  delete out.calGeo;
  return out;
}

const num = (v) => parseNumber(v);
/** Диаметр круга той же площади, см (NaN — размер не введён). */
export function applicatorDiameter(a) {
  const x = num(a?.a);
  if (!(x > 0)) return NaN;
  if (a.shape === 'square') return (2 * x) / Math.sqrt(Math.PI);
  if (a.shape === 'rect') {
    const y = num(a.b);
    return y > 0 ? 2 * Math.sqrt((x * y) / Math.PI) : NaN;
  }
  return x;
}
/** Размер аппликатора: «Ø 10 см», «10 × 10 см», «6 × 8 см»; пусто, если размер не введён. */
export function applicatorSize(a) {
  const x = str(a?.a).trim();
  if (!x) return '';
  const cm = L('см', 'cm');
  if (a.shape === 'square') return `${x} × ${x} ${cm}`;
  if (a.shape === 'rect') return `${x} × ${str(a.b).trim() || '?'} ${cm}`;
  return `Ø ${x} ${cm}`;
}
/** Аппликатор в тексте: «F30, Ø 3 см, РИП 30 см». */
export function applicatorText(a) {
  const ssd = str(a?.ssd).trim();
  return [str(a?.name).trim(), applicatorSize(a), ssd ? L(`РИП ${ssd} см`, `SSD ${ssd} cm`) : ''].filter(Boolean).join(', ');
}
/** Обозначение режима: своё или «120 кВ / 10 мА / 4,0 мм Al» по кВ, мА и фильтру. */
export function kvMachineModeTitle(m) {
  if (!isBlank(m?.label)) return str(m.label).trim();
  const kv = str(m?.kv).trim();
  const ma = str(m?.ma).trim();
  const flt = str(m?.filter).trim();
  return [kv ? L(`${kv} кВ`, `${kv} kV`) : '', ma ? L(`${ma} мА`, `${ma} mA`) : '', flt].filter(Boolean).join(' / ');
}
export const hvlUnit = (range) => (range === 'low' ? L('мм Al', 'mm Al') : L('мм Cu', 'mm Cu'));

/** Средние энергии: тубус, сопоставимый с 10 × 10 см или Ø 10 см (табл. 31, сноска c) — круг той же площади от 9,5 до 11,8 см. */
const medComparable = (d) => d > 9.5 && d < 20 / Math.sqrt(Math.PI) + 0.5;

/**
 * Референсный аппликатор режима по TRS-398 Rev.1 для средних энергий (табл. 31): из отмеченных у режима — поле 10 × 10 см
 * или Ø 10 см либо сопоставимого размера, а если все меньше — самый большой квадратный или круглый тубус аппарата;
 * из нескольких таких — с наибольшим РИП (сноска b). Возвращает { ids, how }: ids — подходящие аппликаторы (с
 * наибольшим РИП), how — 'comparable' | 'largest' | 'none' | 'low' (низкие энергии: зависит от калибровки камеры).
 */
export function kvRefCandidates(machine, mode) {
  if (mode.range === 'low') return { ids: [], how: 'low' };
  const apps = arr(machine.applicators);
  const own = apps.filter((a) => mode.applicators.includes(a.id) && Number.isFinite(applicatorDiameter(a)));
  const bySsd = (list) => {
    const ssd = Math.max(...list.map((a) => (num(a.ssd) > 0 ? num(a.ssd) : -Infinity)));
    return list.filter((a) => (Number.isFinite(ssd) ? num(a.ssd) === ssd : true)).map((a) => a.id);
  };
  const comparable = own.filter((a) => medComparable(applicatorDiameter(a)));
  if (comparable.length) return { ids: bySsd(comparable), how: 'comparable' };
  // все меньше 10 см: самый большой квадратный или круглый тубус аппарата (не только отмеченных)
  const sq = apps.filter((a) => a.shape !== 'rect' && Number.isFinite(applicatorDiameter(a)));
  if (!sq.length) return { ids: [], how: 'none' };
  const dMax = Math.max(...sq.map(applicatorDiameter));
  if (dMax > 9.5) return { ids: [], how: 'none' };
  const largest = sq.filter((a) => Math.abs(applicatorDiameter(a) - dMax) < 1e-9);
  return { ids: bySsd(largest), how: 'largest' };
}

/**
 * Замечания по аппарату: [{ level: 'error'|'warn'|'info', modeId | appId, text, short }] — text с номером режима или
 * аппликатора (для списка замечаний), short без него (для карточки режима). Режим без напряжения или СПО, СПО не число,
 * нет камеры или она не для диапазона режима, нет отмеченных аппликаторов, стандартный не отмечен или не тот, что по Rev.1.
 */
export function kvMachineChecks(machine, j = null) {
  const out = [];
  const apps = arr(machine.applicators);
  const byId = new Map(apps.map((a) => [a.id, a]));
  apps.forEach((a, i) => {
    const n = `${L('аппликатор', 'applicator')} ${i + 1}${isBlank(a.name) ? '' : ` (${a.name})`}`;
    const add = (level, text) => out.push({ level, appId: a.id, text: `${n}: ${text}`, short: text });
    if (isBlank(a.a)) add('warn', L('размер не введён', 'the size is not entered'));
    else if (!(num(a.a) > 0) || (a.shape === 'rect' && !(num(a.b) > 0))) add('error', L('размер — число сантиметров больше нуля', 'the size is a number of centimetres greater than zero'));
    if (!isBlank(a.ssd) && !(num(a.ssd) > 0)) add('error', L('РИП — число сантиметров больше нуля', 'the SSD is a number of centimetres greater than zero'));
  });
  machine.modes.forEach((m, i) => {
    const t = kvMachineModeTitle(m);
    const n = `${L('режим', 'mode')} ${i + 1}${t ? ` (${t})` : ''}`;
    const add = (level, text) => out.push({ level, modeId: m.id, text: `${n}: ${text}`, short: text });
    const kv = num(m.kv);
    if (isBlank(m.kv)) add('warn', L('напряжение не введено', 'the voltage is not entered'));
    else if (!(kv > 0)) add('error', L('напряжение — число киловольт больше нуля', 'the voltage is a number of kilovolts greater than zero'));
    else if (m.range === 'low' && (kv < 10 || kv > 100)) add('warn', L(`${ru(kv, 0)} кВ вне диапазона низких энергий (10–100 кВ, TRS-398 Rev.1, разд. 8)`, `${ru(kv, 0)} kV is outside the low-energy range (10–100 kV, TRS-398 Rev.1, Sec. 8)`));
    else if (m.range === 'medium' && (kv < 80 || kv > 300)) add('warn', L(`${ru(kv, 0)} кВ вне диапазона средних энергий (80–300 кВ, TRS-398 Rev.1, разд. 9)`, `${ru(kv, 0)} kV is outside the medium-energy range (80–300 kV, TRS-398 Rev.1, Sec. 9)`));
    if (!isBlank(m.ma) && !(num(m.ma) > 0)) add('warn', L('ток трубки — число миллиампер больше нуля', 'the tube current is a number of milliamperes greater than zero'));
    if (isBlank(m.hvl)) add('warn', L('СПО не введён: без него k_Q не определить', 'the HVL is not entered: k_Q cannot be determined without it'));
    else if (!(num(m.hvl) > 0)) add('error', L('СПО — число миллиметров больше нуля', 'the HVL is a number of millimetres greater than zero'));
    if (m.hvlSource === 'measured' && isBlank(m.hvlDate)) add('info', L('СПО измерен: укажите дату измерения', 'the HVL is measured: enter the date of the measurement'));
    const ch = j?.chambers.find((c) => c.id === m.chamberId);
    if (!m.chamberId) add('warn', L('камера не выбрана: её выбирают в таблице «Камеры режимов» ниже', 'no chamber selected: it is selected in the Chambers of the modes table below'));
    else if (j && !ch) add('error', L('камеры нет в «Оборудовании»', 'the chamber is not in Equipment'));
    else if (ch && !kvChamberFitsRange(ch, m.range)) add('error', L('плоскопараллельная камера не для средних энергий: по TRS-398 Rev.1 (разд. 9.2.1, табл. 31) — только цилиндрическая 0,1–1,0 см³ на глубине 2 г/см²; плоскопараллельную калибруют на поверхности фантома для низких энергий', 'a plane-parallel chamber is not for medium energies: TRS-398 Rev.1 (Sec. 9.2.1, Table 31) requires a cylindrical chamber of 0.1–1.0 cm³ at a depth of 2 g/cm²; a plane-parallel chamber is calibrated at the phantom surface for low energies'));
    else if (ch && !(ch.kv && (!isBlank(ch.kv.kv_n) || arr(ch.kv.kv_cq_val).some((v) => !isBlank(v))))) {
      add('info', L('у камеры нет kV-сертификата: введите его в карточке камеры (раздел 4)', 'the chamber has no kV certificate: enter it in the chamber card (section 4)'));
    }
    if (!m.applicators.length) add('warn', L('не отмечено ни одного аппликатора', 'no applicators are ticked'));
    // стандартный аппликатор необязателен: в дозу он не входит (во вкладке стандартный тубус определяется по геометрии)
    if (!m.refApplicator) {
      // не выбран — замечания нет
    } else if (!m.applicators.includes(m.refApplicator)) add('error', L('стандартный аппликатор не отмечен у режима', 'the standard applicator is not ticked for the mode'));
    else {
      const c = kvRefCandidates(machine, m);
      const ref = byId.get(m.refApplicator);
      const names = (ids) => ids.map((id) => applicatorText(byId.get(id))).join('; ');
      if (c.how === 'comparable' || c.how === 'largest') {
        if (!c.ids.includes(m.refApplicator)) {
          add('warn', L(
            `по TRS-398 Rev.1 (табл. 31) стандартный — ${names(c.ids)}${c.how === 'largest' ? ' (самый большой квадратный или круглый тубус аппарата: 10 × 10 см нет)' : ''}, а выбран ${applicatorText(ref)}`,
            `by TRS-398 Rev.1 (Table 31) the standard one is ${names(c.ids)}${c.how === 'largest' ? ' (the largest square or circular applicator of the unit: there is no 10 × 10 cm one)' : ''}, but ${applicatorText(ref)} is selected`,
          ));
        }
      } else if (c.how === 'none') {
        add('warn', L(
          `по TRS-398 Rev.1 (табл. 31) стандартное поле — 10 × 10 см или Ø 10 см, сопоставимый тубус или самый большой квадратный или круглый; у ${applicatorText(ref)} поле ${ru(applicatorDiameter(ref), 1)} см`,
          `by TRS-398 Rev.1 (Table 31) the standard field is 10 × 10 cm or 10 cm in diameter, a comparable applicator, or the largest square or circular one; ${applicatorText(ref)} has a field of ${ru(applicatorDiameter(ref), 1)} cm`,
        ));
      }
    }
  });
  return out;
}
