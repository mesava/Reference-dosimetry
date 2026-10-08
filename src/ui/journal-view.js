// Пучок журнала на вкладке дозиметрии («МВ фотоны», «Электроны»): «Все настройки» пучка из «Оборудования» и
// «Открыть во вкладке» из сеанса. Форма журнала загружается во вкладку, прежние данные вкладки откладываются и
// возвращаются кнопкой на плашке над рабочим листом (или после «Сохранить в журнал»). Отложенные данные хранятся и
// в браузере: после перезагрузки страницы плашка и кнопки остаются.
import { L } from '../core/i18n.js';
import { esc } from './common.js';

/**
 * bar — элемент плашки; storageKey — ключ в браузере; readForm() — форма вкладки; writeForm(form, withProtocol) —
 * записать форму во вкладку; refresh() — пересчитать вкладку; setStatus(text) — строка состояния вкладки.
 * Возвращает { show, restore, render, load, setSave }.
 */
export function makeJournalView({ bar, storageKey, readForm, writeForm, refresh, setStatus }) {
  let view = null; // { stash, mode: 'edit' | 'view', title, target }
  let save = null; // (target, form, title) => void — запись настроек пучка в журнал (задаёт app.js)

  const persist = () => {
    try {
      if (view) localStorage.setItem(storageKey, JSON.stringify(view));
      else localStorage.removeItem(storageKey);
    } catch {
      /* хранилище недоступно */
    }
  };

  function restore() {
    if (!view) return;
    const { stash } = view;
    view = null;
    persist();
    writeForm(stash, false);
    refresh();
    render();
  }

  function render() {
    const el = bar();
    if (!el) return;
    if (!view) {
      el.hidden = true;
      el.innerHTML = '';
      return;
    }
    el.hidden = false;
    const edit = view.mode === 'edit';
    el.innerHTML = `<p>${esc(
      edit
        ? L(`Настройки пучка журнала: ${view.title}. Измените нужное и нажмите «Сохранить в журнал»: в журнал попадут настройки пучка, камеры и электрометра (показания и условия — нет).`, `Journal beam settings: ${view.title}. Change what is needed and click "Save to journal": the beam, chamber and electrometer settings go to the journal (readings and conditions do not).`)
        : L(`Пучок из сеанса журнала: ${view.title}. Здесь видны все поправки и замечания; изменения во вкладке в журнал не попадают.`, `Beam from a journal session: ${view.title}. All corrections and messages are shown here; changes in this tab do not go to the journal.`),
    )}</p><div class="actions">${edit ? `<button type="button" class="primary" data-jv="save">${esc(L('Сохранить в журнал', 'Save to journal'))}</button>` : ''}<button type="button" data-jv="back">${esc(edit ? L('Отмена — вернуть данные вкладки', 'Cancel: restore the tab data') : L('Вернуть прежние данные вкладки', 'Restore the previous tab data'))}</button></div>`;
    el.querySelector('[data-jv="save"]')?.addEventListener('click', () => {
      const f = readForm();
      const done = view;
      restore();
      setStatus(L(`Настройки пучка «${done.title}» сохранены в журнал; вкладке возвращены прежние данные. Сохраните журнал в файл.`, `Beam settings "${done.title}" saved to the journal; the tab's previous data restored. Save the journal to the file.`));
      save?.(done.target, f, done.title);
    });
    el.querySelector('[data-jv="back"]').addEventListener('click', () => {
      restore();
      setStatus(L('Вкладке возвращены прежние данные.', "The tab's previous data have been restored."));
    });
  }

  /** mode 'edit' — настройки пучка с сохранением в журнал (target — какой пучок), 'view' — пучок сеанса. */
  function show(form, { mode = 'view', title = '', target = null } = {}) {
    if (!view) view = { stash: readForm() };
    Object.assign(view, { mode, title, target });
    persist();
    writeForm(form, true);
    refresh();
    render();
  }

  /** После перезагрузки страницы: плашка, если во вкладке был пучок журнала. */
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (v && v.stash && (v.mode === 'edit' || v.mode === 'view')) view = v;
    } catch {
      /* повреждённая запись — без плашки */
    }
    render();
  }

  return { show, restore, render, load, setSave: (fn) => (save = fn) };
}
