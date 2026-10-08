// Общие части подразделов вкладки «Журнал»: панель файла журнала, подписи дат и сроков, список аппаратов.
import { L } from '../core/i18n.js';
import { dueStatus } from '../core/journal.js';
import { esc, armButton, dateText, today } from './common.js';
import { journalFile, openJournalFile, saveJournalFile, resetJournal, fileLine, onJournal, getJournal } from './journal-store.js';

export const fmtDate = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(String(iso ?? '')) ? dateText(iso) : '—');

/** Слово при числе: countWord(2, ['аппарат', 'аппарата', 'аппаратов'], ['machine', 'machines']) → «аппарата». */
export function countWord(n, ru, en) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  const r = a > 10 && a < 20 ? ru[2] : b === 1 ? ru[0] : b >= 2 && b <= 4 ? ru[1] : ru[2];
  return L(r, n === 1 ? en[0] : en[1]);
}

/** Метка срока калибровки: «до 01.11.2026 · осталось 24 дн.» и класс статуса. */
export function dueChip(dueDate) {
  const s = dueStatus(dueDate, today());
  if (s.status === 'none') return `<span class="chip due none">${esc(L('срок не задан', 'no due date'))}</span>`;
  const txt =
    s.status === 'overdue'
      ? L(`срок прошёл ${fmtDate(dueDate)}`, `overdue since ${fmtDate(dueDate)}`)
      : s.status === 'soon'
        ? L(`до ${fmtDate(dueDate)} · осталось ${s.days} дн.`, `until ${fmtDate(dueDate)} · ${s.days} days left`)
        : L(`до ${fmtDate(dueDate)}`, `until ${fmtDate(dueDate)}`);
  return `<span class="chip due ${s.status}">${esc(txt)}</span>`;
}

/** Варианты списка аппаратов. */
export function machineOptions(j, selected = '') {
  if (!j.machines.length) return `<option value="">${esc(L('— в «Оборудовании» нет аппаратов —', '— no machines in Equipment —'))}</option>`;
  return j.machines.map((m) => `<option value="${esc(m.id)}"${m.id === selected ? ' selected' : ''}>${esc([m.name || L('без названия', 'unnamed'), m.serial ? `${L('№', 'S/N')} ${m.serial}` : ''].filter(Boolean).join(', '))}</option>`).join('');
}

/**
 * Панель «Файл журнала» в правой колонке подраздела: что открыто, есть ли несохранённые изменения, кнопки
 * открыть / сохранить / сохранить как / новый журнал. setStatus — строка состояния подраздела.
 */
export function setupFilePanel(el, setStatus) {
  if (!el) return;
  const render = () => {
    const f = journalFile();
    el.innerHTML = `<h2>${esc(L('Файл журнала', 'Journal file'))}</h2>
      <p class="jfile-line">${fileLine()}</p>
      <div class="actions">
        <button type="button" data-jf="open">${esc(L('Открыть журнал', 'Open journal'))}</button>
        <button type="button" class="${f.dirty ? 'primary' : ''}" data-jf="save">${esc(L('Сохранить журнал', 'Save journal'))}</button>
        <button type="button" data-jf="saveas">${esc(L('Сохранить как…', 'Save as…'))}</button>
        <button type="button" data-jf="new">${esc(L('Новый журнал', 'New journal'))}</button>
      </div>
      <input type="file" accept="application/json,.json" hidden data-jf="input">
      <p class="sub-hint">${esc(
        f.direct
          ? L('Сохранение идёт прямо в открытый файл.', 'Saving goes directly to the opened file.')
          : window.showSaveFilePicker
            ? L('Журнал — обычный файл .json: держите его, например, на общем диске отделения и открывайте перед работой.', 'The journal is an ordinary .json file: keep it, for example, on a shared department drive and open it before work.')
            : L('Этот браузер не умеет сохранять в открытый файл: при сохранении журнал скачивается, замените им прежний файл. Прямое сохранение есть в Chrome и Edge.', 'This browser cannot save to the opened file: on saving, the journal is downloaded; replace the previous file with it. Direct saving works in Chrome and Edge.'),
      )}</p>`;
    const input = el.querySelector('[data-jf="input"]');
    const btnOpen = el.querySelector('[data-jf="open"]');
    const openText = () => L('Открыть журнал', 'Open journal');
    btnOpen.addEventListener('click', async () => {
      // несохранённые изменения пропали бы молча: открыть другой журнал — только повторным нажатием
      if (journalFile().dirty && !btnOpen.dataset.armed) {
        btnOpen.dataset.armed = '1';
        btnOpen.classList.add('danger-armed');
        btnOpen.textContent = L('Изменения не сохранены — открыть другой?', 'Changes not saved: open another?');
        setTimeout(() => {
          if (!btnOpen.dataset.armed) return;
          delete btnOpen.dataset.armed;
          btnOpen.classList.remove('danger-armed');
          btnOpen.textContent = openText();
        }, 4000);
        return;
      }
      delete btnOpen.dataset.armed;
      btnOpen.classList.remove('danger-armed');
      btnOpen.textContent = openText();
      // во фрейме окно выбора файла браузера недоступно — сразу обычный выбор файла
      if (!window.showOpenFilePicker || window.self !== window.top) {
        input.click();
        return;
      }
      try {
        const msg = await openJournalFile();
        if (msg) setStatus(msg);
      } catch (e) {
        if (e.pickerFailed) input.click();
        else setStatus(e.message);
      }
    });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.value = '';
      if (!file) return;
      try {
        setStatus(await openJournalFile(file));
      } catch (e) {
        setStatus(e.message);
      }
    });
    el.querySelector('[data-jf="save"]').addEventListener('click', async () => {
      const msg = await saveJournalFile();
      if (msg) setStatus(msg);
    });
    el.querySelector('[data-jf="saveas"]').addEventListener('click', async () => {
      const msg = await saveJournalFile({ saveAs: true });
      if (msg) setStatus(msg);
    });
    const btnNew = el.querySelector('[data-jf="new"]');
    armButton(btnNew, () => L('Новый журнал', 'New journal'), () => (journalFile().dirty ? L('Изменения не сохранены — точно?', 'Changes not saved — sure?') : L('Нажмите ещё раз', 'Click again')), () => {
      resetJournal();
      setStatus(L('Начат новый пустой журнал.', 'A new empty journal has been started.'));
    });
  };
  render();
  onJournal(({ source }) => {
    // панель целиком перерисовывается только при открытии, сохранении и новом журнале; при правках — строка
    // состояния и выделение кнопки «Сохранить» (так не сбрасывается двухшаговая кнопка «Новый журнал»)
    if (['open', 'save', 'new'].includes(source)) {
      render();
      return;
    }
    const line = el.querySelector('.jfile-line');
    if (line) line.innerHTML = fileLine();
    el.querySelector('[data-jf="save"]')?.classList.toggle('primary', journalFile().dirty);
  });
  document.addEventListener('langchange', render);
}

/** Пустой журнал или нет. */
export const journalEmpty = () => {
  const j = getJournal();
  return !j.machines.length && !j.chambers.length && !j.electrometers.length && !j.sessions.length;
};
