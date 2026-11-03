// Рентгенотерапевтический аппарат в «Оборудовании» (журнал, machine.kind === 'kv', с 0.41.0).
// У аппарата — список аппликаторов (обозначение, форма, размер, РИП) и режимы (диапазон, напряжение, ток, фильтр, СПО,
// камера и электрометр, отмеченные аппликаторы, референсный аппликатор). Пучков (beams) у него нет: измеряют во вкладке
// «kV-рентген», куда режимы аппарата подставляются (этап C2). Расчёта здесь нет, только проверки ввода и проверка
// референсного аппликатора по TRS-398 Rev.1 (средние энергии — табл. 31; низкие зависят от калибровки камеры, табл. 26
// и 27, и проверяются во вкладке).
import { parseNumber, isBlank, ru } from './units.js';
import { L } from './i18n.js';

const str = (v) => (v === undefined || v === null ? '' : String(v));
const arr = (v) => (Array.isArray(v) ? v : []);
const rid = (prefix) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export const KV_SHAPES = ['circle', 'square', 'rect'];
export const KV_RANGES = ['low', 'medium'];
/** Аппликатор: name — обозначение на тубусе («F30»), shape, a (диаметр или сторона, см), b (вторая сторона), ssd (РИП, см). */
export const KV_APPLICATOR_DEFAULTS = { id: '', name: '', shape: 'circle', a: '', b: '', ssd: '' };
/**
 * Режим: label — своё обозначение (пусто — по кВ, мА и фильтру), range — 'low' (СПО в мм Al) или 'medium' (мм Cu),
 * hvl — СПО, которым считается k_Q; hvlSource — 'nominal' (паспорт, приёмка) или 'measured' (измерен, дата hvlDate);
 * applicators — id отмеченных аппликаторов аппарата, refApplicator — id референсного.
 */
export const KV_MODE_DEFAULTS = {
  id: '', label: '', range: 'medium', kv: '', ma: '', filter: '', hvl: '', hvlSource: 'nominal', hvlDate: '',
  chamberId: '', electrometerId: '', applicators: [], refApplicator: '', notes: '',
};
/** Аппарат: tube — номер (серийный) рентгеновской трубки; после замены трубки СПО меряют заново. */
export const KV_MACHINE_EXTRA = { tube: '', applicators: [], modes: [] };

export function newKvApplicator(from = {}) {
  return { ...KV_APPLICATOR_DEFAULTS, shape: from.shape ?? 'circle', ssd: str(from.ssd), id: rid('a') };
}
export function newKvMachineMode(from = null, extra = {}) {
  const base = from
    ? { range: from.range, chamberId: from.chamberId, electrometerId: from.electrometerId, applicators: [...arr(from.applicators)], refApplicator: from.refApplicator }
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
 * нет камеры, нет отмеченных аппликаторов, референсный не выбран или не отмечен, референсный не тот, что по Rev.1.
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
    if (!m.chamberId) add('warn', L('камера не выбрана', 'no chamber selected'));
    else if (j && !j.chambers.some((c) => c.id === m.chamberId)) add('error', L('камеры нет в «Оборудовании»', 'the chamber is not in Equipment'));
    if (!m.applicators.length) add('warn', L('не отмечено ни одного аппликатора', 'no applicators are ticked'));
    if (!m.refApplicator) {
      if (m.applicators.length) add('warn', L('референсный аппликатор не выбран', 'the reference applicator is not selected'));
    } else if (!m.applicators.includes(m.refApplicator)) add('error', L('референсный аппликатор не отмечен у режима', 'the reference applicator is not ticked for the mode'));
    else {
      const c = kvRefCandidates(machine, m);
      const ref = byId.get(m.refApplicator);
      const names = (ids) => ids.map((id) => applicatorText(byId.get(id))).join('; ');
      if (c.how === 'comparable' || c.how === 'largest') {
        if (!c.ids.includes(m.refApplicator)) {
          add('warn', L(
            `по TRS-398 Rev.1 (табл. 31) референсный — ${names(c.ids)}${c.how === 'largest' ? ' (самый большой квадратный или круглый тубус аппарата: 10 × 10 см нет)' : ''}, а выбран ${applicatorText(ref)}`,
            `by TRS-398 Rev.1 (Table 31) the reference is ${names(c.ids)}${c.how === 'largest' ? ' (the largest square or circular applicator of the unit: there is no 10 × 10 cm one)' : ''}, but ${applicatorText(ref)} is selected`,
          ));
        }
      } else if (c.how === 'none') {
        add('warn', L(
          `по TRS-398 Rev.1 (табл. 31) референсное поле — 10 × 10 см или Ø 10 см, сопоставимый тубус или самый большой квадратный или круглый; у ${applicatorText(ref)} поле ${ru(applicatorDiameter(ref), 1)} см`,
          `by TRS-398 Rev.1 (Table 31) the reference field is 10 × 10 cm or 10 cm in diameter, a comparable applicator, or the largest square or circular one; ${applicatorText(ref)} has a field of ${ru(applicatorDiameter(ref), 1)} cm`,
        ));
      }
    }
  });
  return out;
}
