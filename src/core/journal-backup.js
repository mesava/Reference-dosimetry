// Файл журнала на диске: копии в выбранной папке и защита от записи поверх чужой версии.
// Чистые функции без DOM (интерфейс — ui/journal-store.js), проверяются в node.

import { L } from './i18n.js';

/** Сколько последних копий хранить в папке копий. */
export const BACKUP_KEEP = 50;
/** Не чаще одной копии за столько минут при автосохранении и при сохранении вручную. */
export const BACKUP_MIN_MINUTES = { auto: 60, manual: 5 };

const base = (fileName) => String(fileName || 'journal.json').replace(/\.json$/i, '');
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const p2 = (n) => String(n).padStart(2, '0');

/** Начало имени копии (с 0.67.0): копии не путаются с самим журналом и в папке идут отдельно от него. */
export const COPY_WORD = { ru: 'копия-журнала', en: 'journal-copy' };

/** «журнал_ЛОР» → «копия-журнала_ЛОР»; имя, выбранное пользователем, — «копия-журнала_Терад». */
function copyBase(b, word) {
  const m = b.match(/^(?:журнал|journal)(?=_|$)/iu);
  return m ? word + b.slice(m[0].length) : `${word}_${b}`;
}

/** Имя копии: «копия-журнала_ЛОР_2026-10-16_234905.json» — имя файла журнала без .json, дата и время по местным часам. */
export function backupName(fileName, date = new Date()) {
  const d = `${date.getFullYear()}-${p2(date.getMonth() + 1)}-${p2(date.getDate())}`;
  const t = `${p2(date.getHours())}${p2(date.getMinutes())}${p2(date.getSeconds())}`;
  return `${copyBase(base(fileName), L(COPY_WORD.ru, COPY_WORD.en))}_${d}_${t}.json`;
}

/**
 * Копии этого журнала среди имён файлов папки — от новых к старым. Чужие файлы и копии других журналов не трогаются.
 * Узнаются копии на обоих языках и копии до 0.67.0 («журнал_ЛОР_2026-10-16_234905.json»).
 */
export function backupsOf(names, fileName) {
  const b = base(fileName);
  const heads = [b, copyBase(b, COPY_WORD.ru), copyBase(b, COPY_WORD.en)].map(escRe).join('|');
  const re = new RegExp(`^(?:${heads})_(\\d{4}-\\d{2}-\\d{2}_\\d{6})\\.json$`, 'u');
  return names
    .map((n) => [n, String(n).match(re)?.[1]])
    .filter(([, key]) => key)
    .sort((a, b2) => (a[1] < b2[1] ? 1 : a[1] > b2[1] ? -1 : 0))
    .map(([n]) => n);
}

/** Есть ли в журнале что сохранять в копию: у пустого журнала (нет учреждения, оборудования и записей) копий не делается. */
export function journalHasData(j) {
  if (!j) return false;
  if (String(j.institution || '').trim() || String(j.department || '').trim()) return true;
  return ['staff', 'chambers', 'electrometers', 'machines', 'sessions', 'plateChecks', 'kvRecords'].some((k) => Array.isArray(j[k]) && j[k].length > 0);
}

/** Какие копии удалить, чтобы осталось keep последних. */
export const backupsToDelete = (names, fileName, keep = BACKUP_KEEP) => backupsOf(names, fileName).slice(keep);

/** Пора ли делать копию: копий ещё не было или с последней прошло не меньше minMinutes. */
export function backupDue(lastIso, now = new Date(), minMinutes = BACKUP_MIN_MINUTES.auto) {
  const t = Date.parse(lastIso || '');
  return !Number.isFinite(t) || now.getTime() - t >= minMinutes * 60000;
}

/**
 * Что делать с файлом журнала на диске: перед записью и когда доступ к файлу восстановлен после перезагрузки.
 *   known — время изменения файла (мс), каким оно было при нашем последнем открытии или записи;
 *   disk  — время изменения файла сейчас;
 *   dirty — в браузере есть изменения, которых нет в файле.
 * Ответ:
 *   'none'      — файл не менялся, записывать нечего;
 *   'write'     — файл не менялся с нашей последней записи, наши изменения можно записать;
 *   'take-file' — файл изменили в другом месте (другой компьютер, вкладка), у нас изменений нет: взять версию из файла;
 *   'conflict'  — файл изменили в другом месте, и у нас тоже есть изменения: решает пользователь.
 * Если known неизвестно, файл считается изменённым в другом месте: так ничего не записывается поверх вслепую.
 */
export function syncDecision({ known, disk, dirty }) {
  const changed = !(Number.isFinite(known) && Number.isFinite(disk) && disk <= known);
  if (changed) return dirty ? 'conflict' : 'take-file';
  return dirty ? 'write' : 'none';
}
