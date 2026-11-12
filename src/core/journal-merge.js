// Слияние правок журнала с двух компьютеров (общий файл в общей папке): трёхстороннее слияние по записям.
// base — журнал, каким его последний раз прочитали из файла или записали в файл здесь; mine — журнал в этом браузере;
// theirs — журнал в файле сейчас (его изменили на другом компьютере). Записи и карточки (камеры, электрометры,
// аппараты, пучки, режимы, записи журнала, пучки записи) сопоставляются по id, поля — по имени. Изменённое только
// с одной стороны берётся оттуда; одно и то же поле, изменённое по-разному с обеих сторон, — конфликт: его решает
// пользователь (взять версию из файла или записать свою), автоматически ничего не теряется.
import { L } from './i18n.js';
import { chamberText, electrometerText } from './journal.js';

// служебные поля файла: пишутся при каждой записи, их расхождение — не конфликт (берутся из файла)
const FILE_KEYS = new Set(['updated', 'appVersion', 'appDate', 'version']);

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** Ключ элемента списка: id, у пучка записи журнала — beamId; null — список не из записей. */
const keyOf = (x) => (isObj(x) ? (x.id ? `id:${x.id}` : x.beamId ? `beam:${x.beamId}` : null) : null);
const keyed = (list) => Array.isArray(list) && list.length > 0 && list.every((x) => keyOf(x) !== null);

/**
 * Трёхстороннее слияние значения. path — путь для текста конфликта; conflicts — куда сложить конфликты
 * [{ path, mine, theirs }]. При конфликте в итог идёт значение из файла (theirs), но слияние считается неудачным.
 */
function merge3(base, mine, theirs, path, conflicts) {
  if (same(mine, theirs)) return mine;
  if (same(base, mine)) return theirs;
  if (same(base, theirs)) return mine;
  // изменено с обеих сторон
  if (isObj(mine) && isObj(theirs)) {
    const b = isObj(base) ? base : {};
    const out = {};
    for (const k of new Set([...Object.keys(theirs), ...Object.keys(mine)])) {
      const v = merge3(b[k], mine[k], theirs[k], [...path, k], conflicts);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  const lists = [base ?? [], mine ?? [], theirs ?? []];
  if (lists.every(Array.isArray) && (keyed(mine) || keyed(theirs)) && lists.every((l) => l.length === 0 || keyed(l))) {
    return mergeList(...lists, path, conflicts);
  }
  conflicts.push({ path, mine, theirs });
  return theirs;
}

/** Слияние списка записей по ключу: порядок — как в файле, новые записи этого браузера — следом. */
function mergeList(base, mine, theirs, path, conflicts) {
  const map = (l) => new Map(l.map((x) => [keyOf(x), x]));
  const B = map(base);
  const M = map(mine);
  const T = map(theirs);
  const order = [...T.keys(), ...[...M.keys()].filter((k) => !T.has(k))];
  for (const k of B.keys()) if (!order.includes(k)) order.push(k);
  const out = [];
  for (const k of order) {
    const v = merge3(B.get(k), M.get(k), T.get(k), [...path, k], conflicts);
    if (v !== undefined) out.push(v);
  }
  return out;
}

/**
 * Записи журнала одного аппарата за день в одном режиме и по одному протоколу — одна запись (core/journal.js:
 * tabSessionOf). Если оба компьютера независимо завели такую запись (разные id), пучки объединяются в первую.
 */
function joinSessions(sessions, conflicts) {
  const out = [];
  const byKey = new Map();
  for (const s of sessions) {
    const key = [s.machineId, s.date, s.mode, s.protocol === 'tg51' ? 'tg51' : 'trs'].join('|');
    const first = byKey.get(key);
    if (!first) {
      byKey.set(key, s);
      out.push(s);
      continue;
    }
    for (const b of s.beams || []) {
      const i = first.beams.findIndex((x) => x.beamId === b.beamId);
      if (i < 0) first.beams.push(b);
      else if (!same(first.beams[i], b)) conflicts.push({ path: ['sessions', `id:${first.id}`, `beam:${b.beamId}`], mine: b, theirs: first.beams[i] });
    }
  }
  return out;
}

/**
 * Слить журналы. Возвращает { journal, conflicts }: conflicts пуст, если слияние прошло без участия пользователя.
 * Журналы — уже нормализованные (normalizeJournal).
 */
export function mergeJournals(base, mine, theirs) {
  const conflicts = [];
  const out = { ...theirs };
  for (const k of new Set([...Object.keys(theirs), ...Object.keys(mine)])) {
    if (FILE_KEYS.has(k)) continue;
    const v = merge3(base?.[k], mine[k], theirs[k], [k], conflicts);
    if (v === undefined) delete out[k];
    else out[k] = v;
  }
  if (Array.isArray(out.sessions)) {
    out.sessions = joinSessions(structuredClone(out.sessions), conflicts).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }
  return { journal: out, conflicts };
}

// подписи разделов журнала для текста конфликта
const PART = {
  institution: () => L('учреждение', 'institution'),
  department: () => L('отделение', 'department'),
  chambers: () => L('камера', 'chamber'),
  electrometers: () => L('электрометр', 'electrometer'),
  machines: () => L('аппарат', 'machine'),
  sessions: () => L('запись журнала', 'journal record'),
  plateChecks: () => L('проверка в пластинах', 'plate check'),
  kvRecords: () => L('запись kV', 'kV record'),
};

/** Название элемента журнала для текста конфликта. */
function itemName(part, item) {
  if (!item) return '';
  if (part === 'chambers') return chamberText(item);
  if (part === 'electrometers') return electrometerText(item);
  if (part === 'machines') return String(item.name || '');
  return item.date ? String(item.date).split('-').reverse().join('.') : '';
}

/**
 * Что разошлось — коротко, для панели «Файл журнала»: «камера PTW 30013 № 47364; запись журнала 19.10.2026».
 * journal — журнал из файла (по нему находятся названия).
 */
export function conflictSummary(conflicts, journal) {
  const seen = new Set();
  const out = [];
  for (const c of conflicts) {
    const [part, key] = c.path;
    const id = typeof key === 'string' && key.startsWith('id:') ? key.slice(3) : '';
    const tag = `${part}|${id}`;
    if (seen.has(tag)) continue;
    seen.add(tag);
    const item = id ? (journal?.[part] || []).find((x) => x.id === id) : null;
    out.push([PART[part]?.() ?? part, itemName(part, item)].filter(Boolean).join(' '));
  }
  return out.join('; ');
}
