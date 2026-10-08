// Журнал в интерфейсе: одна рабочая копия на три подраздела вкладки «Журнал» (сеанс, оборудование, журнал и тренды).
// Рабочая копия хранится в браузере (черновик), чтобы обновление страницы её не стёрло; сам журнал — файл JSON,
// который открывают и сохраняют явно. В Chrome и Edge (File System Access API) сохранение идёт прямо в открытый
// файл, в остальных браузерах — скачиванием файла с тем же именем.
import { newJournal, normalizeJournal, JOURNAL_TAG } from '../core/journal.js';
import { APP_VERSION, APP_DATE } from '../core/version.js';
import { L } from '../core/i18n.js';
import { downloadText, esc } from './common.js';

const DRAFT_KEY = 'reference-dosimetry.journal.v1';

const state = { journal: newJournal(), fileName: '', handle: null, dirty: false, savedAt: '' };
const listeners = new Set();

function saveDraft() {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ journal: state.journal, fileName: state.fileName, dirty: state.dirty, savedAt: state.savedAt }));
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
      state.savedAt = String(d.savedAt || '');
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

export const getJournal = () => state.journal;
export const journalFile = () => ({ name: state.fileName, dirty: state.dirty, savedAt: state.savedAt, direct: !!state.handle });

/** Заменить журнал (изменение из интерфейса): помечается несохранённым. */
export function setJournal(j, source = '') {
  state.journal = j;
  state.dirty = true;
  saveDraft();
  emit(source);
}

/** Изменить журнал функцией: fn(копия) → новый журнал. */
export function updateJournal(fn, source = '') {
  setJournal(fn(structuredClone(state.journal)), source);
}

const fileText = () => JSON.stringify({ ...state.journal, ...JOURNAL_TAG, appVersion: APP_VERSION, appDate: APP_DATE, updated: new Date().toISOString() }, null, 1);
const pickerTypes = [{ description: L('Журнал калибровок (JSON)', 'Calibration journal (JSON)'), accept: { 'application/json': ['.json'] } }];
const defaultName = () => {
  const inst = String(state.journal.institution || '').trim().replace(/[^\p{L}\p{N}_.-]+/gu, '-');
  return `${L('журнал', 'journal')}${inst ? `_${inst}` : ''}.json`;
};

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
  let obj;
  try {
    obj = JSON.parse(await file.text());
  } catch {
    throw new Error(L('Файл не прочитан: это не JSON.', 'The file could not be read: it is not JSON.'));
  }
  state.journal = normalizeJournal(obj);
  state.fileName = file.name;
  state.handle = handle;
  state.dirty = false;
  state.savedAt = '';
  saveDraft();
  emit('open');
  const j = state.journal;
  return L(
    `Открыт журнал «${file.name}»: аппаратов ${j.machines.length}, камер ${j.chambers.length}, сеансов ${j.sessions.length}.`,
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
  state.journal = normalizeJournal(obj);
  state.fileName = '';
  state.handle = null;
  state.dirty = true;
  saveDraft();
  emit('open');
}

/** Сохранить журнал: в открытый файл (если браузер это умеет) или скачиванием. saveAs — всегда спросить имя. */
export async function saveJournalFile({ saveAs = false } = {}) {
  const text = fileText();
  if (window.showSaveFilePicker && (saveAs || !state.handle)) {
    try {
      state.handle = await window.showSaveFilePicker({ suggestedName: state.fileName || defaultName(), types: pickerTypes });
    } catch (e) {
      if (e?.name === 'AbortError') return '';
      state.handle = null;
    }
  }
  if (state.handle) {
    try {
      const w = await state.handle.createWritable();
      await w.write(text);
      await w.close();
      state.fileName = state.handle.name || state.fileName;
      state.dirty = false;
      state.savedAt = new Date().toISOString();
      saveDraft();
      emit('save');
      return L(`Журнал сохранён в файл «${state.fileName}».`, `The journal has been saved to "${state.fileName}".`);
    } catch {
      state.handle = null; // нет доступа к файлу — сохраняем скачиванием
    }
  }
  const name = state.fileName || defaultName();
  downloadText(text, name);
  state.fileName = name;
  state.dirty = false;
  state.savedAt = new Date().toISOString();
  saveDraft();
  emit('save');
  return L(
    `Журнал скачан как «${name}». Этот браузер не сохраняет прямо в открытый файл: замените им прежний файл журнала.`,
    `The journal has been downloaded as "${name}". This browser cannot save directly to the opened file: replace the previous journal file with it.`,
  );
}

/** Новый пустой журнал. */
export function resetJournal() {
  state.journal = newJournal();
  state.fileName = '';
  state.handle = null;
  state.dirty = false;
  state.savedAt = '';
  saveDraft();
  emit('new');
}

/** Строка о файле для панели файла в каждом подразделе. */
export function fileLine() {
  const f = journalFile();
  const name = f.name ? L(`«${esc(f.name)}»`, `"${esc(f.name)}"`) : L('новый, ещё не сохранён в файл', 'new, not yet saved to a file');
  const state2 = f.dirty ? `<span class="jf-dirty">${L('есть несохранённые изменения', 'unsaved changes')}</span>` : f.name ? `<span class="jf-clean">${L('сохранён', 'saved')}</span>` : '';
  return `${L('Журнал', 'Journal')}: <b>${name}</b>${state2 ? ` · ${state2}` : ''}`;
}

/** Рабочая копия из браузера (если есть). */
export function initJournalStore() {
  loadDraft();
}
