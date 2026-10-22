// «Дозиметрия» → «В пластинах»: проверка выхода в пластинах (твёрдая вода, ПММА, полистирол) — не референсные условия.
// Набор пластин привязывается к калибровке пучка в воде (TRS-398 Rev.1, разд. 4.2.3): показание в пластинах сразу после
// калибровки; затем выход считается относительно неё. Расчёт — core/plates.js; привязка хранится у пучка журнала,
// проверки — в журнале (j.plateChecks); черновик формы — в этом браузере.
import { L } from '../core/i18n.js';
import { PRESSURE_UNITS, unitLabel, parseNumber } from '../core/units.js';
import { machineOf, beamKind, chamberOf, electrometerOf, chamberText, electrometerText } from '../core/journal.js';
import {
  PLASTICS, plasticOf, plasticName, waterDepth, BINDING_DEFAULTS, CHECK_DEFAULTS, amountUnit, correctedReading,
  waterCalibrations, makeBinding, bindingOf, platesResult, recordPlates, setBinding, platesPoints,
} from '../core/plates.js';
import { $, esc, fmt, fmtSigned, richText, today, armButton } from './common.js';
import { renderCells, readCells, setupCells } from './widgets.js';
import { getJournal, updateJournal, onJournal } from './journal-store.js';
import { cellsHtml, fmtDate } from './journal-common.js';
import { renderPlatesSpc } from './journal-spc-ui.js';
import { sessionMachines, machineBeams } from '../core/session.js';

const KEY = 'reference-dosimetry.plates';
const KIND_TEXT = { photon: () => L('фотоны', 'photons'), electron: () => L('электроны', 'electrons'), cobalt: () => '⁶⁰Co' };
const AT_TEXT = { zref: 'z_ref', dmax: 'd_max', zmax: 'z_max' };
// диэлектрики: в пучках электронов в них накапливается заряд (TRS-398 Rev.1, разд. 7.8)
const INSULATORS = new Set(['pmma', 'clearps', 'whiteps']);

const DRAFT_DEFAULTS = { machineId: '', beamId: '', rebind: false, bind: { ...BINDING_DEFAULTS }, check: { ...CHECK_DEFAULTS } };
let draft = structuredClone(DRAFT_DEFAULTS);
let statusEl = null;

function load() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    // даты не запоминаются: по умолчанию — сегодня
    if (v && typeof v === 'object') draft = { ...DRAFT_DEFAULTS, ...v, bind: { ...BINDING_DEFAULTS, ...v.bind, date: '' }, check: { ...CHECK_DEFAULTS, ...v.check, date: '' } };
  } catch {
    /* хранилище недоступно */
  }
}
function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(draft));
  } catch {
    /* хранилище недоступно */
  }
}
const status = (t) => {
  if (statusEl) statusEl.textContent = t;
};

/** Аппарат и пучок черновика, согласованные с журналом. */
function current(j) {
  const ms = sessionMachines(j);
  const m = ms.find((x) => x.id === draft.machineId) ?? ms[0] ?? null;
  const beams = m ? machineBeams(j, m.id) : [];
  const beam = beams.find((b) => b.id === draft.beamId) ?? beams[0] ?? null;
  draft.machineId = m?.id ?? '';
  draft.beamId = beam?.id ?? '';
  return { ms, m, beams, beam, kind: beam ? beamKind(beam) : 'photon' };
}

const opt = (v, t, cur) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(t)}</option>`;
const unitOpts = (cur) => Object.entries(PRESSURE_UNITS).map(([k, u]) => opt(k, unitLabel(u), cur)).join('');
const valueUnit = (kind) => (kind === 'cobalt' ? L('сГр/мин', 'cGy/min') : L('сГр/МЕ', 'cGy/MU'));
const amountLabel = (kind) => (kind === 'cobalt' ? L('Время облучения, мин', 'Irradiation time, min') : L('Число МЕ', 'Number of MU'));
const protoText = (p) => (p === 'tg51' ? 'TG-51' : 'TRS-398 Rev.1');
const sub = (s) => richText(s);

// ------------------------------------------------------------ разметка
function bannerHtml() {
  return `<div class="plates-banner"><b>${esc(L('Нестандартные условия', 'Non-standard conditions'))}</b>: ${esc(L(
    'проверка выхода в пластинах — не референсная дозиметрия по TRS-398 Rev.1. Пластины допустимы для рутинного контроля, если для пучка установлено отношение показаний в пластике и в воде (TRS-398 Rev.1, разд. 4.2.3): поэтому набор пластин привязывается к калибровке пучка в воде, и выход считается относительно неё. Калибровки в пластинах нет.',
    'an output check in plates is not reference dosimetry per TRS-398 Rev.1. Plates are acceptable for routine QA once the ratio of readings in plastic and in water has been established for the beam (TRS-398 Rev.1, Sec. 4.2.3): so the plate set is bound to a calibration of the beam in water and the output is calculated relative to it. There is no calibration in plates.',
  ))}</div>`;
}

function beamCardHtml(c) {
  const machineOpts = c.ms.map((m) => opt(m.id, [m.name || L('аппарат без названия', 'unnamed machine'), m.serial ? `№ ${m.serial}` : ''].filter(Boolean).join(', '), c.m.id)).join('');
  const beamOpts = c.beams.map((b) => opt(b.id, `${b.name || L('пучок без названия', 'unnamed beam')} · ${KIND_TEXT[beamKind(b)]()}`, c.beam.id)).join('');
  return `<section class="start-card plates-card"><h2><span class="step-no">1</span> ${esc(L('Аппарат и пучок', 'Machine and beam'))}</h2>
    <div class="grid">
      <div class="field"><label for="pl_machine">${esc(L('Аппарат', 'Machine'))}</label><select id="pl_machine" data-full>${machineOpts}</select></div>
      <div class="field"><label for="pl_beam">${esc(L('Пучок', 'Beam'))}</label><select id="pl_beam" data-full>${beamOpts}</select></div>
    </div></section>`;
}

function bindingSummaryHtml(j, c, b) {
  const p = plasticOf(b.material);
  const rho = parseNumber(b.rho);
  const depth = parseNumber(b.depth);
  const zw = c.kind === 'electron' && p ? waterDepth(depth, rho, p.cpl) : NaN;
  const ch = chamberOf(j, b.chamberId);
  const el = electrometerOf(j, b.electrometerId);
  const rows = [
    [L('Калибровка в воде', 'Calibration in water'), `${fmtDate(b.calDate)} · ${protoText(b.calProtocol)} · ${fmt(b.calValue, c.kind === 'cobalt' ? 2 : 4)} ${valueUnit(c.kind)} (${AT_TEXT[b.calAt] ?? 'z_ref'})${Number.isFinite(b.calDeviation) ? ` · ${fmtSigned(b.calDeviation, 2)} %` : ''}`],
    [L('Привязка пластин', 'Plate binding'), fmtDate(b.date)],
    [L('Пластины', 'Plates'), `${plasticName(b)}, ρ = ${fmt(rho, 3)} ${L('г/см³', 'g/cm³')}`],
    [L('Над камерой', 'Above the chamber'), `${fmt(depth, 1)} ${L('см', 'cm')}${Number.isFinite(zw) ? ` · z_w = ${fmt(zw, 2)} ${L('г/см²', 'g/cm²')}` : ''}${b.below ? ` · ${L('под камерой', 'below the chamber')} ${b.below} ${L('см', 'cm')}` : ''}`],
    [L('Дозиметр', 'Dosimeter'), [ch ? chamberText(ch) : '', el ? electrometerText(el) : ''].filter(Boolean).join('; ') || '—'],
    ['M_pl,0', `${fmt(b.M0, 5)} ${c.kind === 'cobalt' ? L('нКл/мин', 'nC/min') : L('нКл/МЕ', 'nC/MU')} (k_TP = ${fmt(b.kTP0, 4)})`],
  ];
  return `<table class="factors plates-sum"><tbody>${rows.map(([k, v]) => `<tr><th>${sub(k)}</th><td>${sub(v)}</td></tr>`).join('')}</tbody></table>
    ${b.notes ? `<p class="start-note">${esc(b.notes)}</p>` : ''}
    <div class="actions"><button type="button" data-pl="rebind">${esc(L('Новая привязка', 'New binding'))}</button></div>`;
}

function bindingFormHtml(j, c, cals) {
  const f = draft.bind;
  if (!cals.length) {
    return `<p class="jlink-st warn">${esc(L(
      `У пучка нет калибровки в воде в журнале. Сначала откалибруйте пучок в воде во вкладке «${c.kind === 'cobalt' ? '⁶⁰Co' : c.kind === 'electron' ? 'Электроны' : 'МВ фотоны'}» и запишите в журнал, затем сразу, тем же дозиметром, измерьте в пластинах и привяжите их здесь.`,
      `The beam has no calibration in water in the journal. First calibrate the beam in water in the ${c.kind === 'cobalt' ? '⁶⁰Co' : c.kind === 'electron' ? 'Electrons' : 'MV photons'} tab and record it to the journal, then right away, with the same dosimeter, measure in plates and bind them here.`,
    ))}</p>`;
  }
  const calId = cals.some((x) => x.sessionId === f.calSessionId) ? f.calSessionId : cals[0].sessionId;
  const calOpts = cals.map((x) => opt(x.sessionId, `${fmtDate(x.date)} · ${protoText(x.protocol)} · ${fmt(x.summary.value, c.kind === 'cobalt' ? 2 : 4)} ${valueUnit(c.kind)}${Number.isFinite(x.summary.deviation) ? ` · ${fmtSigned(x.summary.deviation, 2)} %` : ''}`, calId)).join('');
  const matOpts = PLASTICS.map((p) => opt(p.id, L(p.ru, p.en), f.material)).join('') + opt('other', L('другой пластик', 'other plastic'), f.material);
  const p = plasticOf(f.material);
  return `<p class="start-when">${esc(L(
    'Сразу после калибровки пучка в воде, тем же дозиметром и в тот же день, измерьте в пластинах в той укладке, в которой будете проверять выход. Это показание — опора всех проверок: k_elec, k_pol и k_s одного дозиметра в отношении сокращаются, k_Q не нужен.',
    'Right after calibrating the beam in water, with the same dosimeter and on the same day, measure in plates in the set-up you will use for output checks. This reading is the basis of all checks: k_elec, k_pol and k_s of one dosimeter cancel in the ratio, k_Q is not needed.',
  )).replace(/k_(elec|pol|s|Q)/g, 'k<sub>$1</sub>')}</p>
    <div class="grid">
      <div class="field span-2"><label for="plb_cal">${esc(L('Калибровка пучка в воде', 'Calibration of the beam in water'))}</label><select id="plb_cal" data-b="calSessionId" data-full>${calOpts}</select></div>
      <div class="field"><label for="plb_date">${esc(L('Дата привязки', 'Binding date'))}</label><input type="date" id="plb_date" data-b="date" value="${esc(f.date || cals.find((x) => x.sessionId === calId)?.date || today())}"></div>
      <div class="field span-2"><label for="plb_material">${esc(L('Материал пластин (TRS-398 Rev.1, табл. 23)', 'Plate material (TRS-398 Rev.1, Table 23)'))}</label><select id="plb_material" data-b="material" data-full>${matOpts}</select></div>
      <div class="field"${f.material === 'other' ? '' : ' hidden'}><label for="plb_name">${esc(L('Название пластика', 'Plastic name'))}</label><input type="text" id="plb_name" data-b="materialName" value="${esc(f.materialName)}"></div>
      <div class="field"><label for="plb_rho">${esc(L('Измеренная плотность ρ, г/см³', 'Measured density ρ, g/cm³'))}</label><input type="text" class="num" inputmode="decimal" id="plb_rho" data-b="rho" value="${esc(f.rho)}" placeholder="${esc(p ? String(p.rho).replace('.', L(',', '.')) : '')}"></div>
      <div class="field"><label for="plb_depth">${esc(L('Пластик над камерой, см', 'Plastic above the chamber, cm'))}</label><input type="text" class="num" inputmode="decimal" id="plb_depth" data-b="depth" value="${esc(f.depth)}"></div>
      <div class="field"><label for="plb_below">${esc(L('Пластик под камерой, см', 'Plastic below the chamber, cm'))}</label><input type="text" class="num" inputmode="decimal" id="plb_below" data-b="below" value="${esc(f.below)}"></div>
    </div>
    <p class="sub-hint" id="plb-zw"></p>
    <div class="grid">
      <div class="field"><label for="plb_amount">${esc(amountLabel(c.kind))}</label><input type="text" class="num" inputmode="decimal" id="plb_amount" data-b="amount" value="${esc(f.amount)}"></div>
      <div class="field"><label for="plb_T">${esc(L('Температура в пластинах, °C', 'Temperature in the plates, °C'))}</label><input type="text" class="num" inputmode="decimal" id="plb_T" data-b="T" value="${esc(f.T)}"></div>
      <div class="field"><label for="plb_P">${esc(L('Давление', 'Pressure'))}</label><div class="inline"><input type="text" class="num" inputmode="decimal" id="plb_P" data-b="P" value="${esc(f.P)}"><select id="plb_P_unit" data-b="P_unit" aria-label="${esc(L('Единица давления', 'Pressure unit'))}">${unitOpts(f.P_unit)}</select></div></div>
    </div>
    <div class="series">${cellsHtml('plb-M', L('Показания в пластинах при привязке', 'Readings in plates at the binding'), f.M)}</div>
    <div class="field"><label for="plb_notes">${esc(L('Примечание (укладка, номер набора)', 'Notes (set-up, set number)'))}</label><input type="text" id="plb_notes" data-b="notes" value="${esc(f.notes)}"></div>
    <p class="sub-hint" id="plb-live"></p>
    <div class="actions"><button type="button" class="primary" data-pl="bind">${esc(L('Сохранить привязку', 'Save the binding'))}</button>${bindingOf(j, c.beam.id) ? `<button type="button" data-pl="cancel">${esc(L('Отмена', 'Cancel'))}</button>` : ''}</div>`;
}

function checkFormHtml(c, b) {
  const f = draft.check;
  if (!b) return `<p class="start-note">${esc(L('Проверка станет доступна после привязки пластин (раздел 2).', 'The check becomes available after the plates are bound (section 2).'))}</p>`;
  return `<div class="grid">
      <div class="field"><label for="plc_date">${esc(L('Дата измерения', 'Measurement date'))}</label><input type="date" id="plc_date" data-c="date" value="${esc(f.date || today())}"></div>
      <div class="field span-2"><label for="plc_staff">${esc(L('Сотрудники', 'Staff'))}</label><input type="text" id="plc_staff" data-c="staff" value="${esc(f.staff)}"></div>
      <div class="field"><label for="plc_amount">${esc(amountLabel(c.kind))}</label><input type="text" class="num" inputmode="decimal" id="plc_amount" data-c="amount" value="${esc(f.amount || b.amount)}"></div>
      <div class="field"><label for="plc_T">${esc(L('Температура в пластинах, °C', 'Temperature in the plates, °C'))}</label><input type="text" class="num" inputmode="decimal" id="plc_T" data-c="T" value="${esc(f.T)}"></div>
      <div class="field"><label for="plc_P">${esc(L('Давление', 'Pressure'))}</label><div class="inline"><input type="text" class="num" inputmode="decimal" id="plc_P" data-c="P" value="${esc(f.P)}"><select id="plc_P_unit" data-c="P_unit" aria-label="${esc(L('Единица давления', 'Pressure unit'))}">${unitOpts(f.P_unit)}</select></div></div>
    </div>
    <div class="series">${cellsHtml('plc-M', L('Показания в пластинах', 'Readings in plates'), f.M)}</div>
    <div class="field"><label for="plc_notes">${esc(L('Примечание', 'Notes'))}</label><input type="text" id="plc_notes" data-c="notes" value="${esc(f.notes)}"></div>
    <div class="plates-result" id="plc-result" aria-live="polite"></div>
    <div class="actions"><button type="button" class="primary" data-pl="record">${esc(L('Записать в журнал', 'Record to journal'))}</button></div>
    <p class="start-note">${esc(L('Та же дата того же пучка в журнале заменяется. Пластины — не референсные условия: при выходе вне допуска сначала проверьте выход в воде.', 'The same date of the same beam in the journal is replaced. Plates are not reference conditions: if the output is out of tolerance, check it in water first.'))}</p>`;
}

function historyHtml(j, c) {
  const rows = (j.plateChecks || []).filter((x) => x.beamId === c.beam.id).slice().reverse();
  const table = rows.length
    ? `<div class="table-wrap"><table class="factors"><thead><tr><th>${esc(L('Дата', 'Date'))}</th><th class="v">${sub('M_pl / M_pl,0')}</th><th class="v">${esc(L('Доза', 'Dose'))}, ${esc(valueUnit(c.kind))}</th><th class="v">${esc(c.kind === 'cobalt' ? L('От ожидаемой', 'From expected') : L('От номинала', 'From nominal'))}</th><th>${esc(L('Сотрудники', 'Staff'))}</th><th></th></tr></thead><tbody>${rows
        .map((r) => `<tr class="${r.summary?.status === 'out' ? 'st-out' : ''}"><td>${esc(fmtDate(r.date))}</td><td class="v">${esc(fmt(r.summary?.ratio, 4))}</td><td class="v">${esc(fmt(r.summary?.value, c.kind === 'cobalt' ? 2 : 4))}</td><td class="v">${esc(fmtSigned(r.summary?.deviation, 2))} %</td><td>${esc(r.staff || '')}</td><td><button type="button" class="link-btn danger" data-pl-del="${esc(r.id)}">${esc(L('Удалить', 'Delete'))}</button></td></tr>`)
        .join('')}</tbody></table></div>`
    : `<p class="sub-hint">${esc(L('Проверок этого пучка в пластинах пока нет.', 'No checks of this beam in plates yet.'))}</p>`;
  return `${table}
    <div class="chart-box" id="pl-chart"></div>
    <div class="chart-legend" id="pl-legend"></div>
    <div class="hs-spc-summary" id="pl-summary"></div>`;
}

function emptyHtml() {
  return `<section class="start-card plates-card"><h2>${esc(L('В пластинах', 'In plates'))}</h2>${bannerHtml()}
    <p class="start-when">${esc(L('Для проверки в пластинах нужны аппарат и его пучки в журнале отделения и калибровка пучка в воде.', 'A check in plates needs a machine and its beams in the department journal and a calibration of the beam in water.'))}</p>
    <div class="start-row"><a class="start-go" href="#equipment" data-goto="equipment"><span>${esc(L('Оборудование', 'Equipment'))}</span><small>${esc(L('аппараты и пучки, камеры, электрометры', 'machines and beams, chambers, electrometers'))}</small></a></div></section>`;
}

// ------------------------------------------------------------ отрисовка
function render() {
  const root = $('#plates-root');
  if (!root) return;
  const j = getJournal();
  const c = current(j);
  if (!c.beam) {
    root.innerHTML = emptyHtml();
    return;
  }
  const b = bindingOf(j, c.beam.id);
  const showForm = !b || draft.rebind;
  const cals = waterCalibrations(j, c.beam.id);
  root.innerHTML = `${bannerHtml()}
    ${beamCardHtml(c)}
    <section class="start-card plates-card"><h2><span class="step-no">2</span> ${esc(L('Привязка пластин к калибровке в воде', 'Binding the plates to the calibration in water'))}</h2>
      ${showForm ? bindingFormHtml(j, c, cals) : bindingSummaryHtml(j, c, b)}</section>
    <section class="start-card plates-card"><h2><span class="step-no">3</span> ${esc(L('Проверка выхода', 'Output check'))}</h2>${checkFormHtml(c, b)}</section>
    <section class="start-card plates-card"><h2><span class="step-no">4</span> ${esc(L('Проверки пучка в пластинах', 'Checks of the beam in plates'))}</h2>${historyHtml(j, c)}</section>`;
  for (const [key, vals] of [['plb-M', draft.bind.M], ['plc-M', draft.check.M]]) {
    const el = root.querySelector(`.cells[data-series="${key}"]`);
    if (!el) continue;
    renderCells(el, vals);
    setupCells(el, onInput);
  }
  const box = $('#pl-chart', root);
  if (box) renderPlatesSpc({ box, legend: $('#pl-legend', root), summary: $('#pl-summary', root) }, platesPoints(j, c.beam.id), { tol: b?.tol ?? NaN, name: c.beam.name || '—', cobalt: c.kind === 'cobalt' });
  for (const btn of root.querySelectorAll('[data-pl-del]')) {
    armButton(btn, btn.textContent, () => L('Удалить проверку?', 'Delete the check?'), () => {
      updateJournal((jj) => ({ ...jj, plateChecks: (jj.plateChecks || []).filter((x) => x.id !== btn.dataset.plDel) }), 'plates');
      status(L('Проверка удалена из журнала. Сохраните журнал в файл.', 'The check has been deleted from the journal. Save the journal to the file.'));
    });
  }
  // поля по умолчанию (дата, калибровка, МЕ) — в черновик, чтобы расчёт видел то же, что показано
  readForm();
  live();
}

/** Пересчёт без перерисовки формы: глубина в воде, показание привязки, итог проверки. */
function live() {
  const root = $('#plates-root');
  const j = getJournal();
  const c = current(j);
  if (!c.beam || !root) return;
  for (const o of root.querySelectorAll('output[data-mean]')) {
    const v = readCells(root.querySelector(`.cells[data-series="${o.dataset.mean}"]`)).map(parseNumber).filter(Number.isFinite);
    o.textContent = v.length ? fmt(Math.abs(v.reduce((a, x) => a + x, 0) / v.length), 4) : '';
  }
  const zwEl = $('#plb-zw', root);
  if (zwEl) {
    const f = draft.bind;
    const p = plasticOf(f.material);
    const rho = parseNumber(f.rho);
    const depth = parseNumber(f.depth);
    const parts = [];
    if (rho > 0 && depth > 0) parts.push(L(`Массовая толщина над камерой: ${fmt(rho * depth, 2)} г/см².`, `Mass thickness above the chamber: ${fmt(rho * depth, 2)} g/cm².`));
    if (c.kind === 'electron') {
      if (p && rho > 0 && depth > 0) parts.push(L(`Глубина в воде z_w = z_pl · c_pl = ${fmt(waterDepth(depth, rho, p.cpl), 2)} г/см² (c_pl = ${fmt(p.cpl, 3)}; TRS-398 Rev.1, ур. 45, табл. 23).`, `Water depth z_w = z_pl · c_pl = ${fmt(waterDepth(depth, rho, p.cpl), 2)} g/cm² (c_pl = ${fmt(p.cpl, 3)}; TRS-398 Rev.1, Eq. 45, Table 23).`));
      else if (!p) parts.push(L('Для пластика не из табл. 23 c_pl неизвестен: глубина в воде не пересчитывается.', 'For a plastic not in Table 23, c_pl is unknown: the water depth is not calculated.'));
      if (INSULATORS.has(f.material)) parts.push(L('В ПММА и полистироле в пучке электронов накапливается заряд: показание зависит от истории облучения пластин (TRS-398 Rev.1, разд. 7.8). Облучайте и укладывайте пластины одинаково.', 'Charge builds up in PMMA and polystyrene in an electron beam: the reading depends on the irradiation history of the plates (TRS-398 Rev.1, Sec. 7.8). Irradiate and stack the plates the same way each time.'));
    }
    zwEl.innerHTML = parts.map(sub).join(' ');
  }
  const bl = $('#plb-live', root);
  if (bl) {
    const cals = waterCalibrations(j, c.beam.id);
    const cal = cals.find((x) => x.sessionId === draft.bind.calSessionId) ?? cals[0];
    const r = correctedReading(draft.bind, { tauMin: c.kind === 'cobalt' ? cal?.summary.tauMin : 0, kind: c.kind });
    bl.innerHTML = r.errors.length ? '' : sub(L(`k_TP = ${fmt(r.kTP, 4)}; M_pl,0 = ${fmt(r.perUnit, 5)} ${c.kind === 'cobalt' ? 'нКл/мин' : 'нКл/МЕ'}.`, `k_TP = ${fmt(r.kTP, 4)}; M_pl,0 = ${fmt(r.perUnit, 5)} ${c.kind === 'cobalt' ? 'nC/min' : 'nC/MU'}.`));
  }
  const out = $('#plc-result', root);
  if (out) {
    const b = bindingOf(j, c.beam.id);
    const check = { ...draft.check, date: draft.check.date || today(), amount: draft.check.amount || b?.amount || '' };
    const res = platesResult(j, c.beam.id, check, b);
    if (!res.ok) {
      out.innerHTML = res.errors.map((e) => `<p class="jlink-st none">${esc(e)}</p>`).join('');
      return;
    }
    const at = AT_TEXT[res.at] ?? 'z_ref';
    const cls = res.status === 'out' ? 'out' : 'ok';
    const lines = [
      `k_TP = ${fmt(res.kTP, 4)}`,
      `M_pl = ${fmt(res.perUnit, 5)} ${c.kind === 'cobalt' ? L('нКл/мин', 'nC/min') : L('нКл/МЕ', 'nC/MU')}`,
      `M_pl / M_pl,0 = ${fmt(res.ratio, 4)} (${fmtSigned(res.devFromCal, 2)} % ${L('от калибровки', 'from the calibration')})`,
      c.kind === 'cobalt' ? L(`распад от привязки: ${fmt(res.decay, 4)}`, `decay since the binding: ${fmt(res.decay, 4)}`) : '',
    ].filter(Boolean);
    out.innerHTML = `<div class="plates-dose"><span>${sub(c.kind === 'cobalt' ? L(`Мощность дозы в воде (${at}), по пластинам`, `Dose rate in water (${at}), from plates`) : L(`Доза в воде на 1 МЕ (${at}), по пластинам`, `Dose in water per MU (${at}), from plates`))}</span>
        <b>${esc(fmt(res.value, c.kind === 'cobalt' ? 2 : 4))} ${esc(valueUnit(c.kind))}</b>
        <span class="chip ${cls}">${esc(fmtSigned(res.deviation, 2))} % ${esc(c.kind === 'cobalt' ? L('от ожидаемой', 'from expected') : L('от номинала', 'from nominal'))}${Number.isFinite(res.tol) ? ` · ${esc(L('допуск', 'tolerance'))} ±${esc(fmt(res.tol, 1))} %` : ''}</span></div>
      <p class="sub-hint">${lines.map(sub).join('; ')}.</p>
      ${res.warnings.map((w) => `<p class="jlink-st ${w.level === 'warn' ? 'warn' : 'none'}">${esc(w.text)}</p>`).join('')}`;
  }
}

// ------------------------------------------------------------ ввод и действия
function readForm() {
  const root = $('#plates-root');
  if (!root) return;
  for (const el of root.querySelectorAll('[data-b]')) draft.bind[el.dataset.b] = el.value;
  for (const el of root.querySelectorAll('[data-c]')) draft.check[el.dataset.c] = el.value;
  const bc = root.querySelector('.cells[data-series="plb-M"]');
  if (bc) draft.bind.M = readCells(bc);
  const cc = root.querySelector('.cells[data-series="plc-M"]');
  if (cc) draft.check.M = readCells(cc);
}

function onInput() {
  readForm();
  persist();
  live();
}

function onChange(e) {
  const t = e.target;
  if (t.id === 'pl_machine' || t.id === 'pl_beam') {
    readForm();
    if (t.id === 'pl_machine') {
      draft.machineId = t.value;
      draft.beamId = '';
    } else draft.beamId = t.value;
    // другой пучок: привязка и показания — заново; дата, сотрудники, T и P остаются
    draft.rebind = false;
    draft.bind = { ...BINDING_DEFAULTS, date: draft.bind.date, T: draft.bind.T, P: draft.bind.P, P_unit: draft.bind.P_unit };
    draft.check = { ...draft.check, amount: '', M: ['', '', ''], notes: '' };
    persist();
    render();
    status('');
    return;
  }
  if (t.dataset.full !== undefined) {
    readForm();
    // другая калибровка — дата привязки по умолчанию её
    if (t.id === 'plb_cal') draft.bind.date = '';
    persist();
    render();
  }
}

function bind() {
  readForm();
  const j = getJournal();
  const c = current(j);
  const res = makeBinding(j, c.beam.id, draft.bind);
  if (res.error) {
    status(res.error);
    return;
  }
  draft.rebind = false;
  draft.bind = { ...BINDING_DEFAULTS };
  persist();
  updateJournal((jj) => setBinding(jj, c.beam.id, res.binding), 'plates');
  status(L(`Пластины привязаны к калибровке ${fmtDate(res.binding.calDate)}. Сохраните журнал в файл, если автосохранение не включено.`, `The plates are bound to the calibration of ${fmtDate(res.binding.calDate)}. Save the journal file if autosave is off.`));
}

function record() {
  readForm();
  const j = getJournal();
  const c = current(j);
  const b = bindingOf(j, c.beam.id);
  const input = { ...draft.check, date: draft.check.date || today(), amount: draft.check.amount || b?.amount || '' };
  const res = recordPlates(j, { machineId: c.m.id, beamId: c.beam.id, input });
  if (res.error) {
    status(res.error);
    return;
  }
  updateJournal(() => res.journal, 'plates');
  draft.check = { ...draft.check, M: ['', '', ''], notes: '' };
  persist();
  render();
  status(res.replaced
    ? L(`Проверка ${fmtDate(res.record.date)} в журнале заменена.`, `The check of ${fmtDate(res.record.date)} has been replaced in the journal.`)
    : L(`Проверка ${fmtDate(res.record.date)} записана в журнал.`, `The check of ${fmtDate(res.record.date)} has been recorded to the journal.`));
}

/** Подключить «В пластинах». */
export function initPlates() {
  statusEl = $('#plates-status');
  load();
  const root = $('#plates-root');
  root?.addEventListener('input', onInput);
  root?.addEventListener('change', onChange);
  root?.addEventListener('click', (e) => {
    const t = e.target.closest('button[data-pl]');
    if (!t) return;
    const a = t.dataset.pl;
    if (a === 'bind') bind();
    else if (a === 'record') record();
    else if (a === 'rebind' || a === 'cancel') {
      const j = getJournal();
      const old = bindingOf(j, current(j).beam?.id);
      draft.rebind = a === 'rebind';
      // новая привязка: набор пластин и укладка — как в прежней
      if (a === 'rebind' && old) draft.bind = { ...BINDING_DEFAULTS, material: old.material, materialName: old.materialName, rho: old.rho, depth: old.depth, below: old.below, notes: old.notes };
      persist();
      render();
    }
  });
  onJournal(({ source } = {}) => {
    if (source === 'plates' || !String(source || '').endsWith(':input')) render();
  });
  document.addEventListener('langchange', render);
  render();
}

/** Перерисовать страницу (при её открытии). */
export const renderPlatesPage = () => render();

/** Сообщение в строке состояния. */
export const platesStatus = (t) => status(t);
