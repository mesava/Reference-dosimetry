// Вкладка «kV-рентген», лист «Аппарат и режимы»: блок «Журнал отделения» (с 0.42.0). Выбор рентгенотерапевтического
// аппарата из «Оборудования» (или ручной ввод — разовая проверка), отметка его режимов и «Подставить отмеченные режимы»;
// «Сохранить аппарат в Оборудование» — режимы, аппликаторы, камеры с kV-сертификатом и электрометры вкладки в журнал
// (core/kv-journal.js). Данные вкладки (visit) живут в kv-ui.js: сюда приходят функции доступа к ним.
import { L } from '../core/i18n.js';
import { kvMachineModeTitle, applicatorText, hvlUnit } from '../core/kv-machine.js';
import { kvVisitFromMachine, kvMachineFromVisit, kvSaveText, kvMachineText } from '../core/kv-journal.js';
import { chamberText } from '../core/journal.js';
import { parseCells } from '../core/units.js';
import { $, esc, richText } from './common.js';
import { getJournal, updateJournal, onJournal } from './journal-store.js';

let api = null;
/** Снятые флажки режимов: id аппарата → множество id режимов (по умолчанию отмечены все). */
const unticked = new Map();
/** Подстановка поверх показаний ждёт второго нажатия; сохранение с другим СПО ждёт ответа. */
let armedFill = 0;
let hvlAsk = null;
let note = '';
let lastHtml = '';

const kvMachines = (j) => j.machines.filter((m) => m.kind === 'kv');
const machineName = (m) => kvMachineText(m) || L('аппарат без названия', 'unnamed unit');
const ticked = (m) => m.modes.filter((x) => !unticked.get(m.id)?.has(x.id)).map((x) => x.id);
/** Во вкладке есть показания (в любом режиме и строке). */
const hasReadings = (v) => v.modes.some((md) => md.rows.some((r) => ['kv_M1', 'kv_Mopp', 'kv_M2', 'kv_Mc'].some((k) => parseCells(r[k]).n > 0)));

/** Режим аппарата строкой списка: «Режим 1 — 200 кВ / 15 мА: СПО 1,0 мм Cu; PTW 30013 № 1001; аппликаторы F5, F10 (референсный F10)». */
function modeLine(j, m, x, i) {
  const t = kvMachineModeTitle(x);
  const ch = j.chambers.find((c) => c.id === x.chamberId);
  const apps = m.applicators.filter((a) => x.applicators.includes(a.id));
  const ref = m.applicators.find((a) => a.id === x.refApplicator);
  const parts = [
    x.hvl ? L(`СПО ${x.hvl} ${hvlUnit(x.range)}`, `HVL ${x.hvl} ${hvlUnit(x.range)}`) : L('СПО не задан', 'no HVL'),
    ch ? chamberText(ch) : L('камера не выбрана', 'no chamber'),
    apps.length ? L(`аппликаторов ${apps.length}`, `${apps.length} applicator${apps.length === 1 ? '' : 's'}`) + (ref ? L(`, референсный ${ref.name || applicatorText(ref)}`, `, reference ${ref.name || applicatorText(ref)}`) : '') : L('аппликаторы не отмечены', 'no applicators ticked'),
  ];
  return `${L(`Режим ${i + 1}`, `Mode ${i + 1}`)}${t ? ` — ${t}` : ''}: ${parts.join('; ')}`;
}

/** Блок «Журнал отделения» на листе «Аппарат и режимы». */
export function renderKvJournal() {
  const el = $('#kv-jbind');
  if (!el || !api) return;
  const j = getJournal();
  const v = api.getVisit();
  const ms = kvMachines(j);
  const m = ms.find((x) => x.id === v.common.kv_jmachine) ?? null;
  const opt = (val, text, cur) => `<option value="${esc(val)}"${val === cur ? ' selected' : ''}>${esc(text)}</option>`;
  const sel = `<select data-kvj="machine" aria-label="${esc(L('Рентгенотерапевтический аппарат из «Оборудования»', 'X-ray therapy unit from Equipment'))}">${opt('', L('вручную — разовая проверка', 'by hand: one-off check'), m ? m.id : '')}${ms.map((x) => opt(x.id, machineName(x), m ? m.id : '')).join('')}</select>`;
  let body = '';
  if (m) {
    const t = new Set(ticked(m));
    body = m.modes.length
      ? `<div class="kvj-modes" role="group" aria-label="${esc(L('Режимы аппарата', 'Modes of the unit'))}">${m.modes.map((x, i) => `<label class="check"><input type="checkbox" data-kvj-mode="${esc(x.id)}"${t.has(x.id) ? ' checked' : ''}> <span>${richText(modeLine(j, m, x, i))}</span></label>`).join('')}</div>
        <div class="row-tools"><button type="button" class="link-btn${armedFill ? ' danger-armed' : ''}" data-kvj="fill"${t.size ? '' : ' disabled'}>${esc(armedFill ? L('Нажмите ещё раз: показания вкладки заменятся', 'Click again: the tab readings will be replaced') : L('Подставить отмеченные режимы', 'Fill in the ticked modes'))}</button></div>`
      : `<p class="jlink-st none">${esc(L('У аппарата нет режимов: заведите их в «Оборудовании» или сохраните туда режимы вкладки.', 'The unit has no modes: add them in Equipment or save the modes of the tab there.'))}</p>`;
  }
  const st = m
    ? L(`Аппарат журнала: ${machineName(m)}. Подстановка заменяет режимы вкладки отмеченными режимами аппарата — пучок, камера с kV-сертификатом из «Оборудования», электрометр и аппликаторы, без показаний; дата и сотрудники остаются.`, `Journal unit: ${machineName(m)}. Filling in replaces the modes of the tab with the ticked modes of the unit: the beam, the chamber with its kV certificate from Equipment, the electrometer and the applicators, without readings; the date and staff stay.`)
    : ms.length
      ? L('Ручной ввод: вкладка не связана с аппаратом «Оборудования». Выберите аппарат, чтобы подставить его режимы, или сохраните вкладку в «Оборудование» — появится новый аппарат.', 'Manual entry: the tab is not linked to a unit in Equipment. Select a unit to fill in its modes, or save the tab to Equipment as a new unit.')
      : L('В «Оборудовании» рентгенотерапевтических аппаратов нет: вкладка заполняется вручную. «Сохранить аппарат в Оборудование» заведёт аппарат с режимами, аппликаторами и камерами вкладки.', 'There are no x-ray therapy units in Equipment: the tab is filled in by hand. “Save the unit to Equipment” creates a unit with the modes, applicators and chambers of the tab.');
  const ask = hvlAsk
    ? `<div class="kvj-ask" role="group" aria-label="${esc(L('СПО в «Оборудовании» другой', 'The HVL in Equipment differs'))}"><p>${richText(L(`СПО в «Оборудовании» другой: ${hvlAsk.map((h) => `режим ${h.mode + 1} — ${h.was} → ${h.now} ${hvlUnit(h.range)} (${h.source === 'measured' ? 'измеренный' : 'номинальный'})`).join('; ')}. Заменить значениями вкладки?`, `The HVL in Equipment differs: ${hvlAsk.map((h) => `mode ${h.mode + 1}: ${h.was} → ${h.now} ${hvlUnit(h.range)} (${h.source})`).join('; ')}. Replace with the values of the tab?`))}</p>
      <div class="row-tools"><button type="button" class="primary" data-kvj="save-hvl">${esc(L('Заменить СПО', 'Replace the HVL'))}</button><button type="button" data-kvj="save-keep">${esc(L('Оставить СПО из «Оборудования»', 'Keep the HVL from Equipment'))}</button><button type="button" class="link-btn" data-kvj="save-cancel">${esc(L('Отмена', 'Cancel'))}</button></div></div>`
    : '';
  const html = `<div class="jbind-row"><span class="jlink-h">${esc(L('Журнал отделения', 'Department journal'))}</span>${sel}</div>
    ${body}
    <p class="jlink-st ${m ? 'ok' : 'none'}">${richText(st)}</p>${note ? `<p class="jlink-st warn">${richText(note)}</p>` : ''}
    ${ask}
    <div class="row-tools"><button type="button" class="link-btn" data-kvj="save"${hvlAsk ? ' disabled' : ''}>${esc(m ? L(`Сохранить аппарат в «Оборудование» (${m.name || L('без названия', 'unnamed')})`, `Save the unit to Equipment (${m.name || 'unnamed'})`) : L('Сохранить аппарат в «Оборудование»', 'Save the unit to Equipment'))}</button></div>`;
  if (html !== lastHtml) {
    lastHtml = html;
    el.innerHTML = html;
  }
}

function pickMachine(id) {
  const m = kvMachines(getJournal()).find((x) => x.id === id) ?? null;
  armedFill = 0;
  hvlAsk = null;
  note = '';
  api.setLinks(m ? m.id : '', (md) => (m && m.modes.some((x) => x.id === md.shared.kv_jmode) ? md.shared.kv_jmode : ''));
  api.status(m
    ? L(`Выбран аппарат «${machineName(m)}». Отметьте режимы и нажмите «Подставить отмеченные режимы» — или измерьте и сохраните вкладку в его карточку кнопкой «Сохранить аппарат в Оборудование».`, `The unit “${machineName(m)}” selected. Tick the modes and click “Fill in the ticked modes”, or measure and save the tab to its card with “Save the unit to Equipment”.`)
    : L('Ручной ввод: вкладка больше не связана с аппаратом «Оборудования».', 'Manual entry: the tab is no longer linked to a unit in Equipment.'));
}

function fill() {
  const j = getJournal();
  const v = api.getVisit();
  const m = kvMachines(j).find((x) => x.id === v.common.kv_jmachine);
  if (!m) return;
  const ids = ticked(m);
  if (!ids.length) return;
  if (hasReadings(v) && !armedFill) {
    armedFill = setTimeout(() => {
      armedFill = 0;
      renderKvJournal();
    }, 4000);
    renderKvJournal();
    return;
  }
  clearTimeout(armedFill);
  armedFill = 0;
  const res = kvVisitFromMachine(j, m, ids, v);
  if (!res) return;
  note = res.noCert.length
    ? L(`kV-сертификата в «Оборудовании» нет у камеры ${res.noCert.join(', ')}: введите его в разделе 2 и сохраните аппарат в «Оборудование» — в следующий раз он подставится.`, `No kV certificate in Equipment for ${res.noCert.join(', ')}: enter it in section 2 and save the unit to Equipment; next time it will be filled in.`)
    : '';
  api.replaceVisit(res.visit);
  const n = res.visit.modes.length;
  api.status(L(`Подставлены режимы аппарата «${machineName(m)}»: ${n}. Пучок, камера, электрометр и аппликаторы — из «Оборудования»; показания вводятся на листе «Поглощённая доза».`, `Modes of the unit “${machineName(m)}” filled in: ${n}. The beam, chamber, electrometer and applicators come from Equipment; the readings are entered on the Absorbed dose sheet.`));
}

function save(replaceHvl = null) {
  const v = api.getVisit();
  if (api.isDemo()) {
    api.status(L('Открыт демонстрационный пример: в «Оборудование» он не сохраняется.', 'The demonstration example is open: it is not saved to Equipment.'));
    return;
  }
  const dry = kvMachineFromVisit(getJournal(), v);
  if (replaceHvl === null && dry.report.hvl.length) {
    hvlAsk = dry.report.hvl;
    renderKvJournal();
    return;
  }
  hvlAsk = null;
  let res = null;
  updateJournal((j) => {
    res = kvMachineFromVisit(j, v, { replaceHvl: !!replaceHvl });
    return res.journal;
  }, 'kv');
  note = '';
  api.setLinks(res.machineId, (md, i) => res.modeIds[i] ?? '');
  const m = res.journal.machines.find((x) => x.id === res.machineId);
  api.status(kvSaveText(m, res.report));
}

/** Подключить блок: a — { getVisit, replaceVisit(visit), setLinks(machineId, modeId(md, i)), status(text), isDemo() }. */
export function setupKvJournal(a) {
  api = a;
  const el = $('#kv-jbind');
  if (!el) return;
  el.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.kvj === 'machine') pickMachine(t.value);
    else if (t.dataset.kvjMode) {
      const id = api.getVisit().common.kv_jmachine;
      const set = unticked.get(id) ?? new Set();
      if (t.checked) set.delete(t.dataset.kvjMode);
      else set.add(t.dataset.kvjMode);
      unticked.set(id, set);
      renderKvJournal();
    }
  });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-kvj]');
    if (!b || b.disabled) return;
    const k = b.dataset.kvj;
    if (k === 'fill') fill();
    else if (k === 'save') save();
    else if (k === 'save-hvl') save(true);
    else if (k === 'save-keep') save(false);
    else if (k === 'save-cancel') {
      hvlAsk = null;
      renderKvJournal();
    }
  });
  onJournal(() => renderKvJournal());
  renderKvJournal();
}
