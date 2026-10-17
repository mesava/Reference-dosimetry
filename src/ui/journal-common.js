// Общие части подразделов вкладки «Журнал»: панель файла журнала, подписи дат и сроков, список аппаратов.
import { L } from '../core/i18n.js';
import { dueStatus } from '../core/journal.js';
import { esc, armButton, dateText, today } from './common.js';
import {
  journalFile, openJournalFile, saveJournalFile, resetJournal, fileLine, backupLine, onJournal, onFileState, getJournal,
  reconnectJournalFile, resolveConflict, setAutosave, chooseBackupDir, forgetBackupDir,
} from './journal-store.js';

/** Ячейки серии показаний (нКл) со средним: разметка; заполняются widgets.renderCells. */
export function cellsHtml(key, label, values) {
  return `<div class="cells" data-series="${esc(key)}" data-label="${esc(label)}">
    <span class="label">${esc(label)}, ${esc(L('нКл', 'nC'))}</span>
    <div class="cells-row">
      <div class="cells-list"></div>
      <div class="cells-tools">
        <button type="button" class="icon-btn cell-add" aria-label="${esc(L('Добавить ячейку', 'Add a cell'))}" title="${esc(L('Добавить измерение', 'Add a reading'))}">+</button>
        <button type="button" class="icon-btn cell-remove" aria-label="${esc(L('Убрать последнюю ячейку', 'Remove the last cell'))}" title="${esc(L('Убрать последнюю ячейку', 'Remove the last cell'))}">−</button>
      </div>
      <div class="cell-mean"><span>${esc(L('Среднее', 'Mean'))}</span><output data-mean="${esc(key)}"></output></div>
    </div>
  </div>`;
}

export const fmtDate = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(String(iso ?? '')) ? dateText(iso) : '—');

// ось дат графиков журнала (сутки от 1970-01-01)
export const dayToIso = (d) => new Date(d * 86400000).toISOString().slice(0, 10);
const monthName = (m) =>
  [L('янв', 'Jan'), L('фев', 'Feb'), L('мар', 'Mar'), L('апр', 'Apr'), L('май', 'May'), L('июн', 'Jun'), L('июл', 'Jul'), L('авг', 'Aug'), L('сен', 'Sep'), L('окт', 'Oct'), L('ноя', 'Nov'), L('дек', 'Dec')][m - 1];
/** Месяц и год по номеру суток: «май 2027» / «May 2027». */
export const monthYear = (d) => {
  const [y, m] = dayToIso(d).split('-');
  return `${monthName(Number(m))} ${y}`;
};
/** Подпись деления оси дат (деления — начала месяцев): «мар 2026» / «Mar 2026». */
export const monthLabel = (d) => {
  const iso = dayToIso(d);
  const [y, m, dd] = iso.split('-');
  return dd === '01' ? `${monthName(Number(m))} ${y}` : fmtDate(iso);
};
/** Деления оси дат: начала месяцев (или кварталов, если месяцев много). */
export function monthTicks(x0, x1, count) {
  const a = new Date(x0 * 86400000);
  const ticks = [];
  for (let y = a.getUTCFullYear(), m = a.getUTCMonth() + 1; ; m++) {
    if (m > 11) {
      m = 0;
      y++;
    }
    const d = Date.UTC(y, m, 1) / 86400000;
    if (d > x1) break;
    ticks.push(d);
  }
  if (ticks.length <= count) return ticks.length >= 2 ? ticks : [x0, x1].map(Math.round);
  const step = Math.ceil(ticks.length / count);
  return ticks.filter((_, i) => i % step === 0);
}

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
 * открыть / сохранить / сохранить как / новый журнал; в Chrome и Edge — автосохранение в файл, продолжение работы
 * с файлом после перезагрузки, выбор версии при конфликте и папка копий. setStatus — строка состояния подраздела.
 */
export function setupFilePanel(el, setStatus) {
  if (!el) return;
  const run = async (fn) => {
    try {
      const msg = await fn();
      if (msg) setStatus(msg);
    } catch (e) {
      setStatus(e?.message || String(e));
    }
  };
  const hint = (f) => {
    if (!f.canDirect) {
      return L(
        'Этот браузер не умеет сохранять в открытый файл: при сохранении журнал скачивается, замените им прежний файл. Автосохранение в файл и папка копий есть в Chrome и Edge.',
        'This browser cannot save to the opened file: on saving, the journal is downloaded; replace the previous file with it. Autosaving to the file and a copies folder are available in Chrome and Edge.',
      );
    }
    if (f.direct && f.autosave) {
      return L(
        'Изменения записываются в файл автоматически. Файл можно держать на общем диске отделения: если журнал изменят на другом компьютере, поверх он не запишется — программа предложит выбрать версию.',
        'Changes are written to the file automatically. The file can be kept on a shared department drive: if the journal is changed on another computer, it will not be overwritten; you will be asked which version to keep.',
      );
    }
    if (f.direct) return L('Сохранение идёт прямо в открытый файл — кнопкой «Сохранить журнал».', 'Saving goes directly to the opened file, with the Save journal button.');
    if (f.pending) return L('Пока доступ к файлу не подтверждён, изменения хранятся только в этом браузере.', 'Until access to the file is confirmed, changes are kept only in this browser.');
    return L(
      'Журнал — обычный файл .json. Откройте или сохраните его один раз: дальше изменения будут записываться в него автоматически, а после перезагрузки страницы файл не нужно выбирать заново.',
      'The journal is an ordinary .json file. Open or save it once: after that, changes are written to it automatically, and after reloading the page you do not need to select the file again.',
    );
  };
  const render = () => {
    const f = journalFile();
    const reconnect = f.pending
      ? `<div class="jfile-box">
          <button type="button" class="primary" data-jf="reconnect">${esc(L(`Продолжить с файлом «${f.pending}»`, `Continue with "${f.pending}"`))}</button>
          <p class="sub-hint">${esc(L('Браузер спросит разрешение записывать в этот файл — после этого изменения снова будут сохраняться в него автоматически.', 'The browser will ask for permission to write to this file; after that, changes are saved to it automatically again.'))}</p>
        </div>`
      : '';
    const conflict = f.conflict
      ? `<div class="jfile-box warn" role="alert">
          <p>${esc(L(
            'Файл журнала изменили в другом месте (на другом компьютере или в другой вкладке) после того, как его открыли здесь, а в этом браузере тоже есть изменения. Поверх файла журнал не записан.',
            'The journal file was changed elsewhere (on another computer or in another tab) after it was opened here, and this browser also has changes. The journal was not written over the file.',
          ))}</p>
          <div class="actions">
            <button type="button" data-jf="take-file">${esc(L('Взять версию из файла', 'Take the version from the file'))}</button>
            <button type="button" data-jf="keep-mine">${esc(L('Записать мою поверх', 'Write mine over it'))}</button>
          </div>
          <p class="sub-hint">${esc(L('Взять версию из файла — изменения в этом браузере пропадут. Чтобы сохранить обе версии, сохраните свою отдельным файлом: «Сохранить как…».', 'Taking the version from the file discards the changes in this browser. To keep both versions, save yours as a separate file: Save as….'))}</p>
        </div>`
      : '';
    const error = f.error ? `<p class="jf-error" role="alert">${esc(f.error)}</p>` : '';
    const auto = f.canDirect
      ? `<label class="jf-auto"><input type="checkbox" data-jf="autosave"${f.autosave ? ' checked' : ''}> ${esc(L('Сохранять изменения в файл автоматически', 'Save changes to the file automatically'))}</label>`
      : '';
    const backup =
      f.canDirect && window.showDirectoryPicker
        ? `<div class="jf-backup">
            <p class="jfile-backup">${backupLine()}</p>
            <div class="actions">
              <button type="button" data-jf="backup-dir">${esc(f.backup.name ? L('Другая папка копий…', 'Another copies folder…') : L('Выбрать папку копий…', 'Choose a copies folder…'))}</button>
              ${f.backup.name || f.backup.pending ? `<button type="button" data-jf="backup-off">${esc(L('Не делать копий', 'Stop making copies'))}</button>` : ''}
            </div>
            <p class="sub-hint">${esc(L(
              'При сохранении в папку кладётся копия журнала с датой и временем — не чаще раза в час при автосохранении и раза в 5 минут при сохранении вручную. Лучше выбрать папку на другом диске или на сетевом диске.',
              'On saving, a copy of the journal with the date and time is put into the folder: at most once an hour when autosaving and once in 5 minutes when saving manually. A folder on another drive or a network drive is best.',
            ))}</p>
          </div>`
        : '';
    el.innerHTML = `<h2>${esc(L('Файл журнала', 'Journal file'))}</h2>
      <p class="jfile-line">${fileLine()}</p>
      ${reconnect}${conflict}${error}
      <div class="actions">
        <button type="button" data-jf="open">${esc(L('Открыть журнал', 'Open journal'))}</button>
        <button type="button" class="${f.dirty && !f.pending ? 'primary' : ''}" data-jf="save">${esc(L('Сохранить журнал', 'Save journal'))}</button>
        <button type="button" data-jf="saveas">${esc(L('Сохранить как…', 'Save as…'))}</button>
        <button type="button" data-jf="new">${esc(L('Новый журнал', 'New journal'))}</button>
      </div>
      ${auto}
      <input type="file" accept="application/json,.json" hidden data-jf="input">
      <p class="sub-hint">${esc(hint(f))}</p>
      ${backup}`;
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
      run(() => openJournalFile(file));
    });
    el.querySelector('[data-jf="save"]').addEventListener('click', () => run(() => saveJournalFile()));
    el.querySelector('[data-jf="saveas"]').addEventListener('click', () => run(() => saveJournalFile({ saveAs: true })));
    const btnNew = el.querySelector('[data-jf="new"]');
    armButton(btnNew, () => L('Новый журнал', 'New journal'), () => (journalFile().dirty ? L('Изменения не сохранены — точно?', 'Changes not saved — sure?') : L('Нажмите ещё раз', 'Click again')), () => {
      resetJournal();
      setStatus(L('Начат новый пустой журнал.', 'A new empty journal has been started.'));
    });
    el.querySelector('[data-jf="reconnect"]')?.addEventListener('click', () => run(() => reconnectJournalFile()));
    el.querySelector('[data-jf="take-file"]')?.addEventListener('click', () => run(() => resolveConflict('file')));
    const btnMine = el.querySelector('[data-jf="keep-mine"]');
    if (btnMine) armButton(btnMine, () => L('Записать мою поверх', 'Write mine over it'), () => L('Другая версия пропадёт — точно?', 'The other version will be lost: sure?'), () => run(() => resolveConflict('mine')));
    el.querySelector('[data-jf="autosave"]')?.addEventListener('change', (e) => setAutosave(e.target.checked));
    el.querySelector('[data-jf="backup-dir"]')?.addEventListener('click', () => run(() => chooseBackupDir()));
    el.querySelector('[data-jf="backup-off"]')?.addEventListener('click', () => {
      forgetBackupDir();
      setStatus(L('Копии журнала больше не делаются.', 'Journal copies are no longer made.'));
    });
  };
  // строка состояния, выделение «Сохранить», строка копий и ошибка — без перерисовки панели (так не сбрасываются
  // двухшаговые кнопки)
  const refresh = () => {
    const f = journalFile();
    const line = el.querySelector('.jfile-line');
    if (line) line.innerHTML = fileLine();
    el.querySelector('[data-jf="save"]')?.classList.toggle('primary', f.dirty && !f.pending);
    const b = el.querySelector('.jfile-backup');
    if (b) b.innerHTML = backupLine();
    const err = el.querySelector('.jf-error');
    if (!!err !== !!f.error || (err && err.textContent !== f.error)) render();
  };
  render();
  onJournal(({ source }) => {
    // панель целиком перерисовывается только при открытии, сохранении и новом журнале; при правках — строка
    // состояния и выделение кнопки «Сохранить» (так не сбрасывается двухшаговая кнопка «Новый журнал»)
    if (['open', 'save', 'new'].includes(source)) render();
    else refresh();
  });
  onFileState((source) => (source === 'autosave' ? refresh() : render()));
  document.addEventListener('langchange', render);
}

/** Пустой журнал или нет. */
export const journalEmpty = () => {
  const j = getJournal();
  return !j.machines.length && !j.chambers.length && !j.electrometers.length && !j.sessions.length;
};
