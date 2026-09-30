// Сохранение справочников и своих камер в браузере пользователя (localStorage).
// Хранилище может быть недоступно (приватный режим, запрет сайта) — тогда списки просто пустые.

const LISTS_KEY = 'reference-dosimetry.lists.v1';
const CHAMBERS_KEY = 'reference-dosimetry.chambers.v1';
const MAX_ITEMS = 50;

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function storageWorks() {
  try {
    const k = '__refdos_probe__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

export function getList(name) {
  const all = load(LISTS_KEY, {});
  return Array.isArray(all[name]) ? all[name] : [];
}

/** Добавляет значение в начало списка (без повторов). */
export function addToList(name, value) {
  const v = String(value ?? '').trim();
  if (!v) return;
  const all = load(LISTS_KEY, {});
  const list = (Array.isArray(all[name]) ? all[name] : []).filter((x) => x !== v);
  list.unshift(v);
  all[name] = list.slice(0, MAX_ITEMS);
  save(LISTS_KEY, all);
}

export function removeFromList(name, value) {
  const all = load(LISTS_KEY, {});
  all[name] = (Array.isArray(all[name]) ? all[name] : []).filter((x) => x !== value);
  save(LISTS_KEY, all);
}

export function getMyChambers() {
  const list = load(CHAMBERS_KEY, []);
  return Array.isArray(list) ? list : [];
}

export function saveMyChamber(chamber) {
  const list = getMyChambers().filter((c) => c.id !== chamber.id);
  list.push(chamber);
  return save(CHAMBERS_KEY, list);
}

export function deleteMyChamber(id) {
  save(CHAMBERS_KEY, getMyChambers().filter((c) => c.id !== id));
}
