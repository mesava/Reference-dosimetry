// Журнал в интерфейсе: одна рабочая копия на три подраздела вкладки «Журнал» (сеанс, оборудование, журнал и тренды).
// Рабочая копия хранится в браузере (черновик), чтобы обновление страницы её не стёрло; сам журнал — файл JSON.
// В Chrome и Edge (File System Access API) журнал связывается с файлом на диске: изменения записываются в него
// автоматически, связь переживает перезагрузку (после неё браузер один раз спрашивает разрешение), а в выбранную
// папку копий кладутся датированные копии. Перед каждой записью проверяется, не изменили ли файл в другом месте
// (другой компьютер, другая вкладка): поверх чужой версии журнал не пишется. В остальных браузерах журнал
// сохраняется скачиванием файла с тем же именем.
import { newJournal, normalizeJournal, JOURNAL_TAG, journalFormat } from '../core/journal.js';
import { backupName, backupsToDelete, backupDue, syncDecision, BACKUP_MIN_MINUTES, BACKUP_KEEP } from '../core/journal-backup.js';
import { APP_VERSION, APP_DATE } from '../core/version.js';
import { L } from '../core/i18n.js';
import { downloadText, esc, dateText } from './common.js';
import { putHandle, getHandle, writePermission } from './handle-store.js';

const DRAFT_KEY = 'reference-dosimetry.journal.v1';
const AUTOSAVE_KEY = 'reference-dosimetry.journal.autosave';
const AUTOSAVE_DELAY = 1500;

const state = {
  journal: newJournal(),
  fileName: '',
  handle: null, // файл на диске, в который можно писать сейчас
  pending: null, // файл из прошлого сеанса браузера: доступ нужно подтвердить нажатием
  known: NaN, // время изменения файла при нашем последнем открытии или записи
  dirty: false,
  dirtySince: '',
  savedAt: '',
  conflict: false, // файл изменён в другом месте, а у нас есть свои изменения
  error: '',
  backupDir: null,
  backupPending: null,
  lastBackupAt: '',
  backupError: '',
};
const listeners = new Set();
const fileListeners = new Set();
let autosaveTimer = 0;
let rev = 0; // номер правки журнала: запись в файл помечает «сохранено», только если после неё правок не было
let writing = Promise.resolve();

const fsa = () => typeof window !== 'undefined' && !!window.showSaveFilePicker;

function readAutosave() {
  try {
    return localStorage.getItem(AUTOSAVE_KEY) !== '0';
  } catch {
    return true;
  }
}
let autosave = readAutosave();

function saveDraft() {
  try {
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ journal: state.journal, fileName: state.fileName, dirty: state.dirty, dirtySince: state.dirtySince, savedAt: state.savedAt, known: state.known, lastBackupAt: state.lastBackupAt }),
    );
  } catch {
    /* хранилище недоступно — работаем без черновика */
  }
}
function loadDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if (d?.journal) {
      state.journal = normalizeJournal(d.journal);
      state.fileName = String(d.fileName || '');
      state.dirty = !!d.dirty;
      state.dirtySince = String(d.dirtySince || '');
      state.savedAt = String(d.savedAt || '');
      state.known = Number(d.known);
      state.lastBackupAt = String(d.lastBackupAt || '');
    }
  } catch {
    /* повреждённый черновик — начинаем с пустого журнала */
  }
}

/** Подписка на изменения журнала: fn({ journal, source }). */
export function onJournal(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const emit = (source) => listeners.forEach((fn) => fn({ journal: state.journal, source }));

/**
 * Подписка на состояние файла (журнал при этом не меняется): fn(source), source — 'link' (связь с файлом),
 * 'autosave' (записано или ошибка записи), 'conflict', 'backup'. Отдельно от onJournal, чтобы формы журнала
 * не перерисовывались, пока в них вводят.
 */
export function onFileState(fn) {
  fileListeners.add(fn);
  return () => fileListeners.delete(fn);
}
const emitFile = (source) => fileListeners.forEach((fn) => fn(source));

export const getJournal = () => state.journal;
export const journalFile = () => ({
  name: state.fileName,
  dirty: state.dirty,
  dirtySince: state.dirtySince,
  savedAt: state.savedAt,
  direct: !!state.handle,
  canDirect: fsa(),
  pending: state.pending ? state.pending.name || state.fileName : '',
  conflict: state.conflict,
  autosave,
  error: state.error,
  backup: {
    name: state.backupDir?.name || '',
    pending: state.backupPending?.name || '',
    lastAt: state.lastBackupAt,
    error: state.backupError,
    keep: BACKUP_KEEP,
  },
});

function markDirty() {
  if (!state.dirty) state.dirtySince = new Date().toISOString();
  state.dirty = true;
}
function markSaved() {
  state.dirty = false;
  state.dirtySince = '';
  state.savedAt = new Date().toISOString();
  state.error = '';
}

/** Заменить журнал (изменение из интерфейса): помечается несохранённым и, если файл связан, записывается в него. */
export function setJournal(j, source = '') {
  state.journal = j;
  rev += 1;
  markDirty();
  saveDraft();
  emit(source);
  scheduleAutosave();
}

/** Изменить журнал функцией: fn(копия) → новый журнал. */
export function updateJournal(fn, source = '') {
  setJournal(fn(structuredClone(state.journal)), source);
}

const fileText = () => JSON.stringify({ ...state.journal, ...JOURNAL_TAG, version: journalFormat(state.journal), appVersion: APP_VERSION, appDate: APP_DATE, updated: new Date().toISOString() }, null, 1);
const pickerTypes = [{ description: L('Журнал калибровок (JSON)', 'Calibration journal (JSON)'), accept: { 'application/json': ['.json'] } }];
const defaultName = () => {
  const inst = String(state.journal.institution || '').trim().replace(/[^\p{L}\p{N}_.-]+/gu, '-');
  return `${L('журнал', 'journal')}${inst ? `_${inst}` : ''}.json`;
};
const timeText = (iso) => {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${dateText(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`)} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** Связать журнал с файлом на диске (или разорвать связь: null). */
function linkFile(handle, known = NaN) {
  state.handle = handle;
  state.pending = null;
  state.known = known;
  state.conflict = false;
  putHandle('journal', handle);
}

/** Разрешить браузеру хранить данные страницы постоянно (черновик журнала не удалится при нехватке места). */
function persistStorage() {
  try {
    navigator.storage?.persist?.();
  } catch {
    /* не поддерживается */
  }
}

function loadText(text, name) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error(L('Файл не прочитан: это не JSON.', 'The file could not be read: it is not JSON.'));
  }
  state.journal = normalizeJournal(obj);
  state.fileName = name;
  state.dirty = false;
  state.dirtySince = '';
  state.savedAt = '';
  state.error = '';
}

/** Открыть файл журнала. Возвращает текст для строки состояния; бросает ошибку с понятным текстом. */
export async function openJournalFile(fileFromInput = null) {
  let file = fileFromInput;
  let handle = null;
  if (!file && window.showOpenFilePicker) {
    try {
      [handle] = await window.showOpenFilePicker({ types: pickerTypes, multiple: false });
    } catch (e) {
      if (e?.name === 'AbortError') return '';
      // окно выбора недоступно (например, страница во фрейме): интерфейс откроет обычный выбор файла
      const err = new Error(String(e?.message || e));
      err.pickerFailed = true;
      throw err;
    }
    file = await handle.getFile();
  }
  if (!file) return '';
  loadText(await file.text(), file.name);
  clearTimeout(autosaveTimer);
  linkFile(handle, handle ? file.lastModified : NaN);
  saveDraft();
  persistStorage();
  emit('open');
  const j = state.journal;
  return L(
    `Открыт журнал «${file.name}»: аппаратов ${j.machines.length}, камер ${j.chambers.length}, записей ${j.sessions.length}.`,
    `Journal "${file.name}" opened: ${j.machines.length} machines, ${j.chambers.length} chambers, ${j.sessions.length} sessions.`,
  );
}

/** Журнал из объекта (вставка из буфера обмена): как открытие файла, но без связи с файлом на диске. */
export function importJournalObject(obj) {
  if (state.dirty) {
    throw new Error(L(
      'Журнал не вставлен: в открытом журнале есть несохранённые изменения. Сохраните его («Сохранить журнал») или начните «Новый журнал», затем вставьте снова.',
      'The journal was not pasted: the open journal has unsaved changes. Save it ("Save journal") or start a "New journal", then paste again.',
    ));
  }
  clearTimeout(autosaveTimer);
  state.journal = normalizeJournal(obj);
  state.fileName = '';
  linkFile(null);
  markDirty();
  saveDraft();
  emit('open');
}

const conflictText = () =>
  L(
    'Файл журнала изменили в другом месте (на другом компьютере или в другой вкладке) после того, как его открыли здесь. Журнал не записан поверх: выберите, какую версию оставить.',
    'The journal file was changed elsewhere (on another computer or in another tab) after it was opened here. The journal was not written over it: choose which version to keep.',
  );

/** Записать журнал в связанный файл. force — поверх версии, изменённой в другом месте. Возвращает текст или бросает ошибку. */
async function writeLinked({ manual = false, force = false } = {}) {
  const h = state.handle;
  if (!force && syncDecision({ known: state.known, disk: (await h.getFile()).lastModified, dirty: true }) === 'conflict') {
    state.conflict = true;
    emitFile('conflict');
    return conflictText();
  }
  const text = fileText();
  const at = rev;
  const w = await h.createWritable();
  await w.write(text);
  await w.close();
  state.known = (await h.getFile()).lastModified;
  state.fileName = h.name || state.fileName;
  state.conflict = false;
  // пока шла запись, журнал могли изменить: тогда он остаётся несохранённым и запишется следующим автосохранением
  if (at === rev) markSaved();
  else scheduleAutosave();
  await makeBackup(text, manual);
  saveDraft();
  return '';
}

/** Сохранить журнал: в связанный файл (если браузер это умеет) или скачиванием. saveAs — всегда спросить имя. */
export async function saveJournalFile({ saveAs = false } = {}) {
  clearTimeout(autosaveTimer);
  if (fsa() && (saveAs || (!state.handle && !state.pending))) {
    try {
      const h = await window.showSaveFilePicker({ suggestedName: state.fileName || defaultName(), types: pickerTypes });
      // новый файл (или выбранный поверх): записываем сразу, без проверки на чужие изменения
      linkFile(h, NaN);
      state.fileName = h.name || state.fileName;
      await queue(() => writeLinked({ manual: true, force: true }));
      persistStorage();
      emit('save');
      return L(`Журнал сохранён в файл «${state.fileName}».`, `The journal has been saved to "${state.fileName}".`);
    } catch (e) {
      if (e?.name === 'AbortError') return '';
      linkFile(null);
    }
  }
  if (state.pending) {
    const msg = await reconnectJournalFile();
    if (!state.handle) return msg;
  }
  if (state.handle) {
    try {
      const msg = await queue(() => writeLinked({ manual: true }));
      if (state.conflict) emitFile('conflict');
      else emit('save');
      return msg || L(`Журнал сохранён в файл «${state.fileName}».`, `The journal has been saved to "${state.fileName}".`);
    } catch {
      return writeFailed();
    }
  }
  const name = state.fileName || defaultName();
  downloadText(fileText(), name);
  state.fileName = name;
  markSaved();
  saveDraft();
  emit('save');
  return L(
    `Журнал скачан как «${name}». Этот браузер не сохраняет прямо в открытый файл: замените им прежний файл журнала.`,
    `The journal has been downloaded as "${name}". This browser cannot save directly to the opened file: replace the previous journal file with it.`,
  );
}

/** Записи в файл идут по очереди: автосохранение не пересекается с сохранением вручную. */
function queue(fn) {
  const run = writing.then(fn, fn);
  writing = run.catch(() => {});
  return run;
}

function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  if (!autosave || !state.handle || state.conflict) return;
  autosaveTimer = setTimeout(async () => {
    if (!state.dirty || !state.handle) return;
    try {
      await queue(() => writeLinked());
      emitFile(state.conflict ? 'conflict' : 'autosave');
    } catch {
      writeFailed();
    }
  }, AUTOSAVE_DELAY);
}

/**
 * Запись в файл не удалась (сетевой диск недоступен, файл перемещён или удалён, доступ отозван): связь с файлом
 * не забывается — его можно попробовать снова кнопкой «Продолжить с файлом», а изменения остаются в браузере.
 */
function writeFailed() {
  state.error = L(
    `Не удалось записать журнал в файл «${state.fileName}»: диск недоступен, файл перемещён или удалён, или доступ к нему отозван. Изменения сохранены в браузере. Попробуйте ещё раз («Продолжить с файлом») или сохраните журнал в другой файл («Сохранить как…»).`,
    `The journal could not be written to "${state.fileName}": the drive is unavailable, the file was moved or deleted, or access was revoked. The changes are kept in the browser. Try again (Continue with the file) or save the journal to another file (Save as…).`,
  );
  state.pending = state.handle;
  state.handle = null;
  emitFile('link');
  return state.error;
}

/** Включить или выключить автосохранение в связанный файл. */
export function setAutosave(on) {
  autosave = !!on;
  try {
    localStorage.setItem(AUTOSAVE_KEY, autosave ? '1' : '0');
  } catch {
    /* настройка не запомнится */
  }
  if (autosave && state.dirty) scheduleAutosave();
  emitFile('autosave');
}

/**
 * Восстановить доступ к файлу журнала (и папке копий) из прошлого сеанса браузера — по нажатию пользователя.
 * После этого сверяется файл на диске: если его изменили в другом месте, а здесь изменений нет — журнал берётся
 * из файла; если изменения есть и тут, и там — конфликт, решает пользователь.
 */
export async function reconnectJournalFile() {
  const h = state.pending;
  if (!h) return '';
  if ((await writePermission(h, true)) !== 'granted') {
    return L('Браузер не дал доступ к файлу журнала. Откройте журнал заново («Открыть журнал»).', 'The browser did not grant access to the journal file. Open the journal again ("Open journal").');
  }
  if (state.backupPending && (await writePermission(state.backupPending, true)) === 'granted') {
    state.backupDir = state.backupPending;
    state.backupPending = null;
  }
  return syncWithDisk(h);
}

async function syncWithDisk(h) {
  let file;
  try {
    file = await h.getFile();
  } catch {
    state.pending = null;
    putHandle('journal', null);
    emitFile('link');
    return L(`Файл «${state.fileName}» не найден: он перемещён или удалён. Откройте журнал заново.`, `The file "${state.fileName}" was not found: it was moved or deleted. Open the journal again.`);
  }
  const known = state.known;
  state.handle = h;
  state.pending = null;
  state.error = '';
  const decision = syncDecision({ known, disk: file.lastModified, dirty: state.dirty });
  if (decision === 'take-file') {
    loadText(await file.text(), file.name);
    state.known = file.lastModified;
    saveDraft();
    emit('open');
    return L(
      `Журнал «${file.name}» изменили в другом месте — загружена версия из файла.`,
      `The journal "${file.name}" was changed elsewhere: the version from the file has been loaded.`,
    );
  }
  if (decision === 'conflict') {
    state.conflict = true;
    emitFile('conflict');
    return conflictText();
  }
  emitFile('link');
  if (decision === 'write') scheduleAutosave();
  return L(`Журнал снова связан с файлом «${file.name}».`, `The journal is linked to the file "${file.name}" again.`);
}

/** Решить конфликт: 'file' — взять версию из файла (изменения в браузере пропадут), 'mine' — записать свою поверх. */
export async function resolveConflict(choice) {
  const h = state.handle;
  if (!h || !state.conflict) return '';
  if (choice === 'file') {
    const file = await h.getFile();
    loadText(await file.text(), file.name);
    state.known = file.lastModified;
    state.conflict = false;
    saveDraft();
    emit('open');
    return L(`Загружена версия из файла «${file.name}».`, `The version from "${file.name}" has been loaded.`);
  }
  await queue(() => writeLinked({ manual: true, force: true }));
  emit('save');
  return L(`Журнал записан в файл «${state.fileName}» поверх другой версии.`, `The journal has been written to "${state.fileName}" over the other version.`);
}

/** Выбрать папку копий: туда при сохранении кладутся датированные копии журнала (хранятся последние BACKUP_KEEP). */
export async function chooseBackupDir() {
  if (!window.showDirectoryPicker) return '';
  let dir;
  try {
    dir = await window.showDirectoryPicker({ id: 'journal-backups', mode: 'readwrite' });
  } catch (e) {
    if (e?.name === 'AbortError') return '';
    return L('Папка не выбрана: браузер не дал к ней доступ.', 'No folder was selected: the browser did not grant access to it.');
  }
  state.backupDir = dir;
  state.backupPending = null;
  state.lastBackupAt = '';
  putHandle('backupDir', dir);
  await makeBackup(fileText(), true);
  saveDraft();
  emitFile('backup');
  return state.backupError || L(`Копии журнала будут сохраняться в папку «${dir.name}».`, `Journal copies will be saved to the folder "${dir.name}".`);
}

/** Больше не делать копий. */
export function forgetBackupDir() {
  state.backupDir = null;
  state.backupPending = null;
  state.backupError = '';
  putHandle('backupDir', null);
  emitFile('backup');
}

async function makeBackup(text, manual) {
  const dir = state.backupDir;
  if (!dir) return;
  if (!backupDue(state.lastBackupAt, new Date(), manual ? BACKUP_MIN_MINUTES.manual : BACKUP_MIN_MINUTES.auto)) return;
  try {
    const name = backupName(state.fileName || defaultName());
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(text);
    await w.close();
    state.lastBackupAt = new Date().toISOString();
    state.backupError = '';
    const names = [];
    for await (const [n, h] of dir.entries()) if (h.kind === 'file') names.push(n);
    for (const n of backupsToDelete(names, state.fileName || defaultName())) await dir.removeEntry(n);
  } catch {
    state.backupError = L(`Копия не записана: нет доступа к папке «${dir.name}».`, `The copy was not written: no access to the folder "${dir.name}".`);
  }
}

/** Новый пустой журнал. */
export function resetJournal() {
  clearTimeout(autosaveTimer);
  state.journal = newJournal();
  state.fileName = '';
  linkFile(null);
  state.dirty = false;
  state.dirtySince = '';
  state.savedAt = '';
  state.error = '';
  saveDraft();
  emit('new');
}

/** Строка о файле для панели файла в каждом подразделе. */
export function fileLine() {
  const f = journalFile();
  const name = f.name ? L(`«${esc(f.name)}»`, `"${esc(f.name)}"`) : L('новый, ещё не сохранён в файл', 'new, not yet saved to a file');
  let st = '';
  if (f.conflict) st = `<span class="jf-dirty">${L('файл изменён в другом месте', 'file changed elsewhere')}</span>`;
  else if (f.dirty) {
    const since = f.dirtySince && f.dirtySince.slice(0, 10) !== new Date().toISOString().slice(0, 10) ? L(` с ${esc(timeText(f.dirtySince))}`, ` since ${esc(timeText(f.dirtySince))}`) : '';
    st = `<span class="jf-dirty">${L('есть несохранённые изменения', 'unsaved changes')}${since}</span>`;
  } else if (f.name) st = `<span class="jf-clean">${f.direct && f.savedAt ? L(`сохранён ${esc(timeText(f.savedAt))}`, `saved ${esc(timeText(f.savedAt))}`) : L('сохранён', 'saved')}</span>`;
  return `${L('Журнал', 'Journal')}: <b>${name}</b>${st ? ` · ${st}` : ''}`;
}

/** Строка о копиях для панели файла. */
export function backupLine() {
  const b = journalFile().backup;
  if (b.pending) return L(`Папка копий «${esc(b.pending)}» — доступ подтвердится вместе с файлом журнала.`, `Copies folder "${esc(b.pending)}": access will be confirmed together with the journal file.`);
  if (!b.name) return L('Папка копий не выбрана.', 'No copies folder selected.');
  const last = b.lastAt ? L(`, последняя копия ${esc(timeText(b.lastAt))}`, `, last copy ${esc(timeText(b.lastAt))}`) : '';
  const err = b.error ? ` <span class="jf-dirty">${esc(b.error)}</span>` : '';
  return L(`Копии: папка «${esc(b.name)}»${last}; хранятся ${b.keep} последних.`, `Copies: folder "${esc(b.name)}"${last}; the last ${b.keep} are kept.`) + err;
}

/** Рабочая копия из браузера (если есть) и связь с файлом из прошлого сеанса. */
export function initJournalStore() {
  loadDraft();
  restoreLinks();
}

async function restoreLinks() {
  if (!fsa()) return;
  const [h, dir] = await Promise.all([getHandle('journal'), getHandle('backupDir')]);
  if (dir) {
    if ((await writePermission(dir)) === 'granted') state.backupDir = dir;
    else state.backupPending = dir;
  }
  // связь действует, только если черновик в браузере — от этого же файла
  if (h && state.fileName && h.name === state.fileName) {
    if ((await writePermission(h)) === 'granted') {
      await syncWithDisk(h);
      return;
    }
    state.pending = h;
  } else if (h) putHandle('journal', null);
  emitFile('link');
}
