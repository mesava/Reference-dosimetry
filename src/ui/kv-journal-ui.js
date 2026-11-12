// Вкладка «kV-рентген», лист «Аппарат и режимы»: блок «Журнал отделения» (с 0.42.0). Выбор рентгенотерапевтического
// аппарата из «Оборудования» (или ручной ввод — разовая проверка), отметка его режимов и «Подставить отмеченные режимы»;
// «Сохранить аппарат в Оборудование» — режимы, аппликаторы, камеры с kV-сертификатом и электрометры вкладки в журнал
// (core/kv-journal.js). Данные вкладки (visit) живут в kv-ui.js: сюда приходят функции доступа к ним.
// С 0.46.0 — панель «Журнал» справа: «Записать в журнал» — измерение аппарата за день (core/kv-records.js); с 0.47.0
// запись по режимам и что взято из последней калибровки режима (база «Сравнить с», при проверке выхода — поправки).
// С 0.50.0 постоянное режимов из «Оборудования» во вкладке только показывается: «Сохранить измеренное в Оборудование»
// возвращает туда СПО, а «Обновить из Оборудования» подтягивает изменённые там пучок, камеру и kV-сертификат.
import { L } from '../core/i18n.js';
import { kvMachineModeTitle, applicatorText, hvlUnit } from '../core/kv-machine.js';
import { kvVisitFromMachine, kvMachineFromVisit, kvSaveText, kvMachineText, kvRefreshFromMachine, kvRefreshRisk } from '../core/kv-journal.js';
import { recordKvVisit, kvRecMode, kvRecModeText, kvRecordCounts, kvRecordsOn } from '../core/kv-records.js';
import { chamberText } from '../core/journal.js';
import { parseCells } from '../core/units.js';
import { $, esc, richText, dateText, today, fmtSigned } from './common.js';
import { getJournal, updateJournal, onJournal } from './journal-store.js';

let api = null;
/** Снятые флажки режимов: id аппарата → множество id режимов (по умолчанию отмечены все). */
const unticked = new Map();
/** Подстановка поверх показаний ждёт второго нажатия; сохранение с другим СПО ждёт ответа. */
let armedFill = 0;
let hvlAsk = null;
let note = '';
let lastHtml = '';
let lastRec = '';

const kvMachines = (j) => j.machines.filter((m) => m.kind === 'kv');
const machineName = (m) => kvMachineText(m) || L('аппарат без названия', 'unnamed unit');
const ticked = (m) => m.modes.filter((x) => !unticked.get(m.id)?.has(x.id)).map((x) => x.id);
/** Во вкладке есть показания (в любом режиме и строке). */
const hasReadings = (v) =>
  v.modes.some((md) => md.rows.some((r) => ['kv_M1', 'kv_Mopp', 'kv_M2', 'kv_Mc'].some((k) => parseCells(r[k]).n > 0)) || ['kv_hl_D0', 'kv_hl_D1', 'kv_hl_D2', 'kv_hl_Dc', 'kv_ln_M1', 'kv_ln_M2', 'kv_ln_M3', 'kv_ln_M4', 'kv_ln_M5', 'kv_rp_M'].some((k) => parseCells(md.shared[k]).n > 0));
/** Источник СПО режима «Оборудования»: «номинальный» или «измеренный 03.11.2026». */
const hvlSourceText = (source, date) =>
  source === 'measured' ? L(`измеренный${date ? ` ${dateText(date)}` : ''}`, `measured${date ? ` ${dateText(date)}` : ''}`) : L('номинальный', 'nominal');

/** Вопрос о СПО при сохранении: что в «Оборудовании», что во вкладке и чем заменить. */
function hvlAskText(list, date) {
  const line = (h) =>
    L(
      `режим ${h.mode + 1} — ${h.was} ${hvlUnit(h.range)} (${hvlSourceText(h.source, h.sourceDate)}) → ${h.now} ${hvlUnit(h.range)} (${h.measured ? hvlSourceText('measured', date) : 'из таблицы режимов'})`,
      `mode ${h.mode + 1}: ${h.was} ${hvlUnit(h.range)} (${hvlSourceText(h.source, h.sourceDate)}) → ${h.now} ${hvlUnit(h.range)} (${h.measured ? hvlSourceText('measured', date) : 'from the modes table'})`,
    );
  const nominalByMeasured = list.every((h) => h.measured && h.source !== 'measured');
  return L(
    `СПО в «Оборудовании» другой: ${list.map(line).join('; ')}. ${nominalByMeasured ? 'Заменить номинальный измеренным?' : 'Заменить значениями вкладки?'}`,
    `The HVL in Equipment differs: ${list.map(line).join('; ')}. ${nominalByMeasured ? 'Replace the nominal value with the measured one?' : 'Replace with the values of the tab?'}`,
  );
}

/** Режим аппарата строкой списка: «Режим 1 — 200 кВ / 15 мА: СПО 1,0 мм Cu; PTW 30013 № 1001; аппликаторы F5, F10 (референсный F10)». */
function modeLine(j, m, x, i) {
  const t = kvMachineModeTitle(x);
  const ch = j.chambers.find((c) => c.id === x.chamberId);
  const apps = m.applicators.filter((a) => x.applicators.includes(a.id));
  const ref = m.applicators.find((a) => a.id === x.refApplicator);
  const parts = [
    x.hvl
      ? L(`СПО ${x.hvl} ${hvlUnit(x.range)}`, `HVL ${x.hvl} ${hvlUnit(x.range)}`) + (x.hvlSource === 'measured' ? ` (${hvlSourceText('measured', x.hvlDate)})` : '')
      : L('СПО не задан', 'no HVL'),
    ch ? chamberText(ch) : L('камера не выбрана', 'no chamber'),
    apps.length ? L(`аппликаторов ${apps.length}`, `${apps.length} applicator${apps.length === 1 ? '' : 's'}`) + (ref ? L(`, стандартный ${ref.name || applicatorText(ref)}`, `, standard ${ref.name || applicatorText(ref)}`) : '') : L('аппликаторы не отмечены', 'no applicators ticked'),
  ];
  return `${L(`Режим ${i + 1}`, `Mode ${i + 1}`)}${t ? ` — ${t}` : ''}: ${parts.join('; ')}`;
}

/** Блок «Журнал отделения» на листе «Аппарат и режимы». */
export function renderKvJournal() {
  const el = $('#kv-jbind');
  // до первого расчёта вкладки (при запуске) показывать нечего: блок нарисует расчёт
  if (!el || !api || !api.vr?.()) return;
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
  // режимы из «Оборудования», у которых там изменились пучок, камера или kV-сертификат
  const fresh = m ? kvRefreshFromMachine(j, m, v) : null;
  // дата измерения раньше действующего kV-сертификата, а прежнего в истории камеры нет (с 0.53.0): обновление подставит
  // действующий — например, запись прошлого года, открытая после замены сертификата
  const risk = fresh?.changed ? kvRefreshRisk(j, m, v) : [];
  const riskTxt = risk.length
    ? ` ${L(
      `Внимание: дата измерения вкладки раньше действующего kV-сертификата (${risk.map((x) => `${x.chamber}: № ${x.no || '—'} от ${dateText(x.date)}`).join('; ')}), а прежнего сертификата в истории камеры нет — обновление пересчитает это измерение по действующему. Если измерение считалось по прежнему сертификату, внесите его в историю камеры («Оборудование», карточка камеры).`,
      `Note: the measurement date of the tab is earlier than the current kV certificate (${risk.map((x) => `${x.chamber}: No. ${x.no || '—'} of ${dateText(x.date)}`).join('; ')}), and the chamber history has no earlier certificate: the update will recalculate this measurement with the current one. If it was calculated with the earlier certificate, add that one to the chamber history (Equipment, the chamber card).`,
    )}`
    : '';
  const refresh = fresh?.changed
    ? `<p class="jlink-st warn">${esc(L('В «Оборудовании» изменились пучок, камера или kV-сертификат режимов вкладки (сертификат — действовавший на дату измерения).', 'The beam, chamber or kV certificate of the tab modes changed in Equipment (the certificate valid on the measurement date).'))} <button type="button" class="link-btn" data-kvj="refresh">${esc(L('Обновить из «Оборудования»', 'Update from Equipment'))}</button> ${esc(L('— показания и электрометр останутся.', 'The readings and the electrometer stay.'))}${esc(riskTxt)}</p>`
    : '';
  const st = m
    ? L(`Аппарат журнала: ${machineName(m)}. Подстановка заменяет режимы вкладки отмеченными режимами аппарата — пучок, камера с kV-сертификатом и аппликаторы из «Оборудования» (во вкладке они только показываются и правятся в «Оборудовании»), электрометр — при калибровке камеры; без показаний, дата и сотрудники остаются. Измерение записывается в журнал кнопкой «Записать в журнал» (панель «Журнал» справа).`, `Journal unit: ${machineName(m)}. Filling in replaces the modes of the tab with the ticked modes of the unit: the beam, the chamber with its kV certificate and the applicators from Equipment (in the tab they are only shown and are edited in Equipment), the electrometer at the chamber calibration; without readings, the date and staff stay. The measurement is recorded to the journal with “Record to journal” (the Journal panel on the right).`)
    : ms.length
      ? L('Ручной ввод: вкладка не связана с аппаратом «Оборудования». Выберите аппарат, чтобы подставить его режимы, или сохраните вкладку в «Оборудование» — появится новый аппарат.', 'Manual entry: the tab is not linked to a unit in Equipment. Select a unit to fill in its modes, or save the tab to Equipment as a new unit.')
      : L('В «Оборудовании» рентгенотерапевтических аппаратов нет: вкладка заполняется вручную. «Сохранить аппарат в Оборудование» заведёт аппарат с режимами, аппликаторами и камерами вкладки.', 'There are no x-ray therapy units in Equipment: the tab is filled in by hand. “Save the unit to Equipment” creates a unit with the modes, applicators and chambers of the tab.');
  const ask = hvlAsk
    ? `<div class="kvj-ask" role="group" aria-label="${esc(L('СПО в «Оборудовании» другой', 'The HVL in Equipment differs'))}"><p>${richText(hvlAskText(hvlAsk, v.common.kv_date))}</p>
      <div class="row-tools"><button type="button" class="primary" data-kvj="save-hvl">${esc(L('Заменить СПО', 'Replace the HVL'))}</button><button type="button" data-kvj="save-keep">${esc(L('Оставить СПО из «Оборудования»', 'Keep the HVL from Equipment'))}</button><button type="button" class="link-btn" data-kvj="save-cancel">${esc(L('Отмена', 'Cancel'))}</button></div></div>`
    : '';
  const html = `<div class="jbind-row"><span class="jlink-h">${esc(L('Журнал отделения', 'Department journal'))}</span>${sel}</div>
    ${body}
    <p class="jlink-st ${m ? 'ok' : 'none'}">${richText(st)}</p>${note ? `<p class="jlink-st warn" data-sec-target="equipment">${richText(note)}</p>` : ''}
    ${refresh}
    ${ask}
    <div class="row-tools"><button type="button" class="link-btn" data-kvj="save"${hvlAsk ? ' disabled' : ''}>${esc(m ? L(`Сохранить измеренное в «Оборудование» (${m.name || L('без названия', 'unnamed')})`, `Save the measured data to Equipment (${m.name || 'unnamed'})`) : L('Сохранить аппарат в «Оборудование»', 'Save the unit to Equipment'))}</button></div>`;
  if (html !== lastHtml) {
    lastHtml = html;
    el.innerHTML = html;
  }
  renderRecord(j, v, m);
}

/** Почему записать нельзя ('' — можно) и проба записи (без файла вкладки). */
function recordDry(j, v) {
  if (api.isDemo()) return { why: L('Открыт демонстрационный пример: в журнал он не записывается.', 'A demonstration example is open: it is not recorded to the journal.'), dry: null };
  const dry = recordKvVisit(j, { visit: v, vr: api.vr?.(), today: today() });
  return { why: dry.error ?? '', dry };
}

const listText = (ms) => ms.map((m) => m + 1).join(', ');
const modesWord = (ms) => (ms.length > 1 ? L(`режимы ${listText(ms)}`, `modes ${listText(ms)}`) : L(`режим ${listText(ms)}`, `mode ${listText(ms)}`));

/**
 * Что вкладка берёт из журнала (jx — kvJournalInputs, vr — расчёт): последняя калибровка по режимам — база «Сравнить
 * с» и, при проверке выхода, k_pol, k_s, τ и СПО; режимы без калибровки в журнале; режимы с другой камерой.
 */
function journalText(v, jx, vr) {
  if (!jx) return '';
  const byDate = new Map();
  const none = [];
  const other = [];
  jx.modes.forEach((x, m) => {
    if (!x) return;
    if (!x.cal) none.push(m);
    else byDate.set(x.cal.date, [...(byDate.get(x.cal.date) ?? []), m]);
    if (x.chamberOther && vr?.modes[m] && (vr.modes[m].polSrc < 0 || (vr.modes[m].ksOn && vr.modes[m].ksSrc < 0))) other.push(m);
  });
  const check = jx.kind === 'check';
  const out = [];
  if (byDate.size) {
    const cals = [...byDate].map(([d, ms]) => (v.modes.length > 1 ? L(`${dateText(d)} (${modesWord(ms)})`, `${dateText(d)} (${modesWord(ms)})`) : dateText(d))).join('; ');
    out.push(check
      ? L(`Из последней калибровки режима: база «Сравнить с», а без своих серий — k_pol, k_s, τ и СПО. Калибровка: ${cals}.`, `From the last calibration of the mode: the “Compare with” baseline and, without series of their own, k_pol, k_s, τ and the HVL. Calibration: ${cals}.`)
      : L(`База «Сравнить с» — из последней калибровки режима: ${cals}.`, `The “Compare with” baseline is from the last calibration of the mode: ${cals}.`));
  }
  // при калибровке без прежних калибровок пометка не нужна: база для первой калибровки — ввод в эксплуатацию
  if (none.length && check) out.push(L(`Калибровок в журнале раньше этой даты нет: ${modesWord(none)} — база и поправки не подставлены.`, `No calibrations in the journal before this date: ${modesWord(none)}; the baseline and corrections are not filled in.`));
  if (other.length) out.push(L(`Камера не та, что при калибровке: ${modesWord(other)} — k_pol и k_s из журнала не взяты.`, `The chamber differs from the calibration: ${modesWord(other)}; k_pol and k_s are not taken from the journal.`));
  return out.join(' ');
}

/** Панель «Журнал» справа: запись измерения аппарата за день (видна, когда вкладка связана с аппаратом). */
function renderRecord(j, v, m) {
  const el = $('#kv-jrec');
  if (!el) return;
  if (!v.common.kv_jmachine) {
    el.hidden = true;
    el.innerHTML = '';
    lastRec = '';
    return;
  }
  const { why, dry } = recordDry(j, v);
  const date = String(v.common.kv_date || '');
  const ok = dry && !dry.error;
  const old = ok && dry.replaced ? dry.replacedModes : null;
  // заменяется весь день (других режимов за эту дату в журнале не останется) или только часть режимов
  const day = old ? kvRecordsOn(j, m.id, date) : [];
  const full = old && kvRecordsOn(dry.journal, m.id, date).length === 1;
  const kinds = [...new Set(day.map((r) => kvRecModeText(r.mode)))].join(L(' и ', ' and '));
  const oldText = !old ? ''
    : full
      ? (day.length > 1
        ? L(`Записи аппарата за эту дату уже есть в журнале (${kinds}): они будут заменены.`, `Records of the unit for this date are already in the journal (${kinds}): they will be replaced.`)
        : L(`Запись аппарата за эту дату уже есть в журнале (${kinds}): она будет заменена.`, `A record of the unit for this date is already in the journal (${kinds}): it will be replaced.`))
      : L(`За эту дату в журнале уже есть ${modesWord(old)}: ${old.length > 1 ? 'их записи будут заменены' : 'его запись будет заменена'}, другие режимы этого дня останутся.`, `The journal already has ${modesWord(old)} for this date: ${old.length > 1 ? 'their records' : 'its record'} will be replaced, other modes of the day stay.`);
  const n = ok ? kvRecordCounts(dry.record) : null;
  const jt = journalText(v, api.jx?.(), api.vr?.());
  const what = n
    ? L(
      `В запись: режимов ${n.modes}, строк аппликаторов ${n.rows}${n.over.length ? `; вне допуска: ${n.over.length}` : ''}${n.nobase ? `; без базового значения: ${n.nobase}` : ''}.`,
      `To be recorded: modes ${n.modes}, applicator rows ${n.rows}${n.over.length ? `; out of tolerance: ${n.over.length}` : ''}${n.nobase ? `; without a baseline: ${n.nobase}` : ''}.`,
    )
    : '';
  const html = `<h2>${esc(L('Журнал', 'Journal'))}</h2>
    <p>${esc([m ? machineName(m) : '—', kvRecModeText(kvRecMode(v)), date ? dateText(date) : L('дата не указана', 'no date')].join(' · '))}</p>
    ${oldText ? `<p class="sub-hint">${esc(oldText)}</p>` : ''}
    ${jt ? `<p class="sub-hint kv-jrec-src">${esc(jt)}</p>` : ''}
    ${why ? `<p class="jlink-st warn">${richText(why)}</p>` : what ? `<p class="sub-hint">${esc(what)}</p>` : ''}
    <div class="actions"><button type="button" class="primary" data-kvr="record"${why ? ' disabled' : ''}>${esc(old ? L('Заменить запись в журнале', 'Replace the journal record') : L('Записать в журнал', 'Record to journal'))}</button></div>
    <p class="sub-hint">${esc(L('Запись — измерение аппарата за день по режимам: повторная запись того же дня заменяет только свои режимы. Записи, протокол и «Открыть во вкладке» — «Журнал» → «Журнал и тренды».', 'A record is the measurement of the unit on a day, by mode: recording the same day again replaces only its own modes. The records, the report and “Open in the tab” are in Journal → Journal and trends.'))}</p>`;
  el.hidden = false;
  if (html !== lastRec) {
    lastRec = html;
    el.innerHTML = html;
  }
}

function record() {
  const v = api.getVisit();
  const { why } = recordDry(getJournal(), v);
  if (why) {
    api.status(why);
    return;
  }
  let res = null;
  updateJournal((j) => {
    res = recordKvVisit(j, { visit: v, vr: api.vr?.(), file: api.file?.() ?? null, today: today() });
    return res.error ? j : res.journal;
  }, 'kv');
  if (res.error) {
    api.status(res.error);
    return;
  }
  const m = res.journal.machines.find((x) => x.id === res.record.machineId);
  const n = kvRecordCounts(res.record);
  const over = n.over.length
    ? L(` Вне допуска — требуется калибровка: ${n.over.map((x) => `режим ${x.m + 1}, ${x.label} (${fmtSigned(x.dev, 2)} %)`).join('; ')}.`, ` Out of tolerance, calibration required: ${n.over.map((x) => `mode ${x.m + 1}, ${x.label} (${fmtSigned(x.dev, 2)} %)`).join('; ')}.`)
    : '';
  api.status(L(
    `${res.replaced ? 'Запись в журнале заменена' : 'Измерение записано в журнал'}: ${machineName(m)}, ${dateText(res.record.date)}, ${kvRecModeText(res.record.mode)} — режимов ${n.modes}, строк аппликаторов ${n.rows}.${res.replaced && res.replacedModes.length < n.modes ? ` Заменены прежние данные этого дня: ${modesWord(res.replacedModes)}.` : ''}${over} Записи и протокол — «Журнал и тренды»; сохраните журнал в файл, если автосохранение не включено.`,
    `${res.replaced ? 'The journal record has been replaced' : 'The measurement has been recorded to the journal'}: ${machineName(m)}, ${dateText(res.record.date)}, ${kvRecModeText(res.record.mode)}: modes ${n.modes}, applicator rows ${n.rows}.${res.replaced && res.replacedModes.length < n.modes ? ` Earlier data of the day replaced: ${modesWord(res.replacedModes)}.` : ''}${over} The records and the report are in Journal and trends; save the journal file if autosave is off.`,
  ));
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
    ? L(`kV-сертификата в «Оборудовании» нет у камеры ${res.noCert.join(', ')}: введите его в карточке камеры («Оборудование», раздел 4), затем нажмите здесь «Обновить из «Оборудования»».`, `No kV certificate in Equipment for ${res.noCert.join(', ')}: enter it in the chamber card (Equipment, section 4), then click “Update from Equipment” here.`)
    : '';
  api.replaceVisit(res.visit);
  const n = res.visit.modes.length;
  api.status(L(`Подставлены режимы аппарата «${machineName(m)}»: ${n}. Пучок, камера с kV-сертификатом и аппликаторы — из «Оборудования» и правятся там; электрометр можно заменить на день измерений; показания вводятся на листе «Поглощённая доза».`, `Modes of the unit “${machineName(m)}” filled in: ${n}. The beam, the chamber with its kV certificate and the applicators come from Equipment and are edited there; the electrometer can be replaced for the day; the readings are entered on the Absorbed dose sheet.`));
}

/** «Обновить из Оборудования»: пучок, камера и kV-сертификат режимов из «Оборудования» — по нынешним данным там. */
function refreshFromMachine() {
  const j = getJournal();
  const v = api.getVisit();
  const m = kvMachines(j).find((x) => x.id === v.common.kv_jmachine);
  if (!m) return;
  const res = kvRefreshFromMachine(j, m, v);
  note = '';
  if (!res.changed) return;
  api.replaceVisit(res.visit);
  api.status(L('Пучок, камера и kV-сертификат режимов обновлены из «Оборудования»; показания, задания и электрометр остались.', 'The beam, chamber and kV certificate of the modes are updated from Equipment; the readings, settings and electrometer stay.'));
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
  // вкладка теперь связана с аппаратом: её постоянное — как в «Оборудовании» (например, СПО режима — сохранённый измеренный)
  // но не когда у вкладки свой (более старый) сертификат: обновление подставило бы действующий — оставляем баннер
  const risky = (res.report.certOlder?.length ?? 0) > 0 || kvRefreshRisk(getJournal(), m, api.getVisit()).length > 0;
  const fresh = kvRefreshFromMachine(getJournal(), m, api.getVisit());
  if (fresh.changed && !risky) api.replaceVisit(fresh.visit);
  api.status(kvSaveText(m, res.report));
}

/**
 * Подключить блок: a — { getVisit, replaceVisit(visit), setLinks(machineId, modeId(md, i)), status(text), isDemo(), vr(),
 * jx(), file() } — vr — расчёт вкладки, jx — значения из журнала (kvJournalInputs), file — вкладка как файл .json.
 */
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
    else if (k === 'refresh') refreshFromMachine();
    else if (k === 'save') save();
    else if (k === 'save-hvl') save(true);
    else if (k === 'save-keep') save(false);
    else if (k === 'save-cancel') {
      hvlAsk = null;
      renderKvJournal();
    }
  });
  $('#kv-jrec')?.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-kvr]');
    if (b && !b.disabled && b.dataset.kvr === 'record') record();
  });
  onJournal(() => renderKvJournal());
  renderKvJournal();
}
