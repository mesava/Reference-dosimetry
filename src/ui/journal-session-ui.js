// «Журнал» → «Сеанс»: калибровка или проверка выхода всех фотонных пучков аппарата за один заход.
// Каждый пучок считается ядром вкладки «МВ фотоны» (journal.js собирает её форму из профилей и показаний);
// результат записывается в журнал кнопкой «Записать сеанс в журнал».
import { L, refText, getLang } from '../core/i18n.js';
import { PRESSURE_UNITS, unitLabel, isBlank, parseNumber } from '../core/units.js';
import { computeSessionBeam, finalizeSession, upsertSession, chamberText, electrometerText, machineOf, equipmentDue, recordedBase, SESSION_DEFAULTS, uid } from '../core/journal.js';
import { $, $$, esc, fmt, fmtSigned, today, makeStatus, copyText, currentProtocol, applyProtocol, notifyUpdate, richText, armButton, renderSignBlock, printToPdf, versionText } from './common.js';
import { localizeDecimals } from './i18n.js';
import { renderCells, readCells, setupCells, renderStaff, readStaff, makeCombo } from './widgets.js';
import { getJournal, setJournal, onJournal } from './journal-store.js';
import { setupFilePanel, machineOptions, fmtDate } from './journal-common.js';

const DRAFT_KEY = 'reference-dosimetry.session.v1';
const ROOT = () => $('#module-session');
let setStatus = () => {};
let bridge = { openInPhotons: () => {}, openEquipment: () => {} };
/** Связь с вкладкой «МВ фотоны» (показать там пучок сеанса) и с «Оборудованием» (открыть карточку пучка). */
export const setSessionBridge = (b) => (bridge = { ...bridge, ...b });

/**
 * Сеанс на форме: { id, machineId, date, mode, staff, notes, env, beams: { [beamId]: показания }, dirty }.
 * У пучка открытого из журнала сеанса есть base — настройки пучка, камеры и электрометра, записанные в сеансе:
 * сеанс считается по ним, пока не нажата «Пересчитать по текущему «Оборудованию»». dirty — есть правки после записи.
 */
let draft = { id: '', machineId: '', date: '', mode: 'cal', staff: [''], notes: '', env: { T: '', P: '', P_unit: 'kPa', H: '' }, beams: {}, dirty: false };
let computed = []; // [{ beam, calc }] по пучкам формы
/** Число из профиля или общего поля — с десятичным разделителем текущего языка (для подсказок в полях). */
const locNum = (v) => (getLang() === 'en' ? String(v ?? '').replace(/(\d),(\d)/g, '$1.$2') : String(v ?? '').replace(/(\d)\.(\d)/g, '$1,$2'));

function saveDraft() {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* хранилище недоступно */
  }
}
function loadDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if (d && typeof d === 'object') draft = { ...draft, ...d, env: { ...draft.env, ...(d.env || {}) }, beams: d.beams || {} };
  } catch {
    /* повреждённый черновик */
  }
}

/** Пучки сеанса: используемые в сеансах и те, что есть в открытом из журнала сеансе. */
const activeBeams = (m) => (m ? m.beams.filter((b) => b.kind === 'photon' && (b.active !== false || draft.beams[b.id]?.base)) : []);
const tg51 = () => currentProtocol() === 'tg51';
/** Поле %dd(10) пучка по способу TG-51. */
const q51Field = (f) => {
  const m = f.q51_method;
  if (m === 'foil50' || m === 'foil30') return ['q51_pdd10pb', L('%dd(10)<sub>Pb</sub> с фольгой, %', '%dd(10)<sub>Pb</sub> with foil, %')];
  if (m === 'manual') return ['q51_manual', '%dd(10)<sub>x</sub>, %'];
  return ['q51_pdd10', L('%dd(10), открытый пучок, %', '%dd(10), open beam, %')];
};
const blank3 = () => ['', '', ''];
const hasValues = (cells) => (cells || []).some((v) => !isBlank(v));

// ------------------------------------------------------------ разметка пучка
function cellsHtml(key, label, values) {
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

function beamCard(j, m, b, mode) {
  const d = draft.beams[b.id] || {};
  const id = b.id;
  // у открытого из журнала сеанса — камера, электрометр и настройки, записанные в нём
  const ch = d.base ? { form: d.base } : j.chambers.find((c) => c.id === b.chamberId);
  const el = d.base ? { form: d.base } : j.electrometers.find((e) => e.id === b.electrometerId);
  const f = d.base || b.form || {};
  const noChamber = !d.base && !ch;
  const info = [chamberText(ch) || L('камера не выбрана', 'no chamber selected'), electrometerText(el) || L('электрометр не выбран', 'no electrometer selected'), !isBlank(f.rd_V1) ? `V₁ ${locNum(f.rd_V1)} ${L('В', 'V')}` : '', !isBlank(f.rd_mu) ? `${locNum(f.rd_mu)} ${L('МЕ', 'MU')}` : ''].filter(Boolean).join(' · ');
  const [q51Key, q51Label] = q51Field(f);
  const [kp, kx] = tg51() ? ['P<sub>pol</sub>', 'P<sub>ion</sub>'] : ['k<sub>pol</sub>', 'k<sub>s</sub>'];
  const inp = (key, label, { ph = '', sub = '', cls = '' } = {}) =>
    `<div class="field ${cls}"><label for="jsb-${id}-${key}">${label}</label><input type="text" id="jsb-${id}-${key}" data-sb="${key}" class="num" inputmode="decimal" value="${esc(d[key] ?? '')}"${ph ? ` placeholder="${esc(ph)}"` : ''}>${sub ? `<span class="sub">${sub}</span>` : ''}</div>`;
  const pdd = f.qtrs_method === 'pdd2010';
  return `<div class="jcard jsb${d.include === false ? ' off' : ''}" data-beam="${esc(id)}">
    <div class="jcard-head"><label class="check"><input type="checkbox" data-sb="include"${d.include === false ? '' : ' checked'}> <b>${esc(b.name || '—')}</b></label><span class="chip jsb-chip" data-chip></span></div>
    <p class="jsb-info">${richText(info)}</p>
    ${noChamber ? `<p class="jsb-warn">${esc(L('У пучка не выбрана камера: выберите её в «Оборудовании».', 'The beam has no chamber selected: choose one in Equipment.'))} <button type="button" class="link-btn" data-goto-eq="${esc(id)}">${esc(L('Открыть пучок в «Оборудовании»', 'Open the beam in Equipment'))}</button></p>` : ''}
    <div class="jsb-body">
      <div class="grid three">
        ${inp('env_T', L('Температура воды, °C', 'Water temperature, °C'), { ph: locNum(draft.env.T), sub: L('пусто — общая', 'blank — common') })}
        ${inp('env_P', L('Давление', 'Pressure'), { ph: locNum(draft.env.P), sub: L('пусто — общее', 'blank — common') })}
      </div>
      <div class="series">
        ${cellsHtml(`jsb-${id}-rd_M1`, L('M при V₁, обычная полярность', 'M at V₁, normal polarity'), d.rd_M1 || blank3())}
        ${mode === 'cal' ? cellsHtml(`jsb-${id}-rd_Mopp`, L('M при V₁, обратная полярность', 'M at V₁, opposite polarity'), d.rd_Mopp || blank3()) : ''}
        ${mode === 'cal' ? cellsHtml(`jsb-${id}-rd_M2`, L('M при V₂', 'M at V₂'), d.rd_M2 || blank3()) : ''}
      </div>
      ${mode === 'cal'
        ? tg51()
          ? `<div class="grid three">
            ${inp(q51Key, q51Label, { ph: locNum(f[q51Key]), sub: L('качество пучка (TG-51); пусто — последнее из «Оборудования», там же способ', 'beam quality (TG-51); blank: the last one from Equipment, where the method is set') })}
          </div>`
          : `<div class="grid three">
            ${inp('qtrs_v20', pdd ? 'PDD(20)' : L('M на 20 см', 'M at 20 cm'), { ph: locNum(f.qtrs_v20) })}
            ${inp('qtrs_v10', pdd ? 'PDD(10)' : L('M на 10 см', 'M at 10 cm'), { ph: locNum(f.qtrs_v10), sub: L('качество пучка; пусто — последнее из «Оборудования»', 'beam quality; blank: the last one from Equipment') })}
          </div>`
        : `<div class="grid three">
            ${inp('rd_fixed_kpol', L(`${kp} из калибровки`, `${kp} from the calibration`), { sub: L('пусто — из журнала', 'blank: from the journal') })}
            ${inp('rd_fixed_ks', L(`${kx} из калибровки`, `${kx} from the calibration`), { sub: L('пусто — из журнала', 'blank: from the journal') })}
            <div class="field"><label for="jsb-${id}-rd_fixed_from">${esc(L('Дата калибровки', 'Calibration date'))}</label><input type="text" id="jsb-${id}-rd_fixed_from" data-sb="rd_fixed_from" value="${esc(d.rd_fixed_from ?? '')}"><span class="sub">${esc(L('для протокола, если значения введены вручную', 'for the report if the values are entered manually'))}</span></div>
          </div>
          <p class="sub-hint" data-fixed-note></p>`}
      <details class="jsb-more"${hasValues(d.ctrl_M) || hasValues(d.recal_M) ? ' open' : ''}>
        <summary>${esc(L('Контрольные измерения и подстройка ускорителя', 'Check measurements and linac adjustment'))}</summary>
        <div class="series">
          ${cellsHtml(`jsb-${id}-ctrl_M`, L('Контрольные измерения, M при V₁', 'Check measurements, M at V₁'), d.ctrl_M || blank3())}
        </div>
        <div class="grid">
          <div class="field"><label for="jsb-${id}-recal_needed">${esc(L('Ускоритель подстраивали?', 'Was the linac adjusted?'))}</label><select id="jsb-${id}-recal_needed" data-sb="recal_needed"><option value="">—</option><option value="yes"${d.recal_needed === 'yes' ? ' selected' : ''}>${esc(L('да', 'yes'))}</option><option value="no"${d.recal_needed === 'no' ? ' selected' : ''}>${esc(L('нет', 'no'))}</option></select><span class="sub">${esc(L('если выход был вне допуска', 'if the output was out of tolerance'))}</span></div>
        </div>
        <div class="series" data-recal${d.recal_needed === 'yes' ? '' : ' hidden'}>
          ${cellsHtml(`jsb-${id}-recal_M`, L('После подстройки, M при V₁', 'After adjustment, M at V₁'), d.recal_M || blank3())}
        </div>
      </details>
      <div class="jsb-result" data-result></div>
    </div>
  </div>`;
}

// ------------------------------------------------------------ форма ↔ черновик
function renderBeams() {
  const j = getJournal();
  const m = machineOf(j, draft.machineId);
  const box = $('#js-beams');
  if (!m) {
    box.innerHTML = `<p class="sub-hint">${esc(j.machines.length ? L('Выберите аппарат.', 'Select a machine.') : L('В журнале нет аппаратов: добавьте их в «Оборудовании» или откройте файл журнала.', 'The journal has no machines: add them in Equipment or open a journal file.'))}</p>`;
    return;
  }
  const beams = activeBeams(m);
  const recorded = beams.some((b) => draft.beams[b.id]?.base);
  const note = recorded
    ? `<div class="jsb-recorded"><p>${L(
        'Сеанс посчитан по настройкам, записанным в нём: камера, N<sub>D,w</sub>, электрометр и настройки пучка — как в день сеанса. Изменения в «Оборудовании» на него не влияют.',
        'The session is calculated with the settings recorded in it: chamber, N<sub>D,w</sub>, electrometer and beam settings as on the session day. Changes in Equipment do not affect it.',
      )}</p><button type="button" class="link-btn" id="js-btn-current">${esc(L('Пересчитать по текущему «Оборудованию»', 'Recalculate with the current Equipment'))}</button></div>`
    : '';
  box.innerHTML = note + (beams.map((b) => beamCard(j, m, b, draft.mode)).join('') || `<p class="sub-hint">${esc(L('У аппарата нет пучков фотонов: добавьте их в «Оборудовании».', 'The machine has no photon beams: add them in Equipment.'))}</p>`);
  for (const b of beams) {
    const d = draft.beams[b.id] || {};
    for (const key of ['rd_M1', 'rd_Mopp', 'rd_M2', 'ctrl_M', 'recal_M']) {
      const c = box.querySelector(`.cells[data-series="jsb-${b.id}-${key}"]`);
      if (!c) continue;
      renderCells(c, d[key] || blank3());
      setupCells(c, onEdit);
    }
  }
  localizeDecimals(box);
}

function writeHead() {
  const j = getJournal();
  if (!draft.machineId || !machineOf(j, draft.machineId)) draft.machineId = j.machines[0]?.id ?? '';
  $('#js_machine').innerHTML = machineOptions(j, draft.machineId);
  $('#js_machine').value = draft.machineId;
  const r = document.getElementById(`js_mode_${draft.mode}`);
  if (r) r.checked = true;
  $('#js_date').value = draft.date || today();
  renderStaff($('#js-staff-list'), draft.staff, onEdit);
  $('#js_T').value = draft.env.T ?? '';
  $('#js_P').value = draft.env.P ?? '';
  $('#js_P_unit').value = draft.env.P_unit || 'kPa';
  $('#js_H').value = draft.env.H ?? '';
  $('#js_notes').value = draft.notes ?? '';
}

/** Прочитать форму в черновик. */
function readDraft() {
  draft.machineId = $('#js_machine').value;
  draft.mode = $('input[name="js_mode"]:checked')?.value === 'check' ? 'check' : 'cal';
  draft.date = $('#js_date').value;
  draft.staff = readStaff($('#js-staff-list'));
  draft.env = { T: $('#js_T').value, P: $('#js_P').value, P_unit: $('#js_P_unit').value, H: $('#js_H').value };
  draft.notes = $('#js_notes').value;
  for (const card of $$('#js-beams .jsb')) {
    const id = card.dataset.beam;
    const d = { ...(draft.beams[id] || {}) };
    d.include = card.querySelector('[data-sb="include"]').checked;
    for (const el of card.querySelectorAll('[data-sb]:not([data-sb="include"])')) d[el.dataset.sb] = el.value;
    for (const key of ['rd_M1', 'rd_Mopp', 'rd_M2', 'ctrl_M', 'recal_M']) {
      const c = card.querySelector(`.cells[data-series="jsb-${id}-${key}"]`);
      if (c) d[key] = readCells(c);
    }
    draft.beams[id] = d;
  }
}

/** Сеанс для расчёта и записи из черновика (только пучки текущего аппарата). */
function sessionObject() {
  const j = getJournal();
  const m = machineOf(j, draft.machineId);
  return {
    ...SESSION_DEFAULTS,
    id: draft.id || '',
    machineId: draft.machineId,
    date: draft.date || today(),
    mode: draft.mode,
    protocol: currentProtocol(),
    staff: draft.staff,
    notes: draft.notes,
    env: { ...draft.env },
    beams: activeBeams(m).map((b) => ({ beamId: b.id, include: draft.beams[b.id]?.include !== false, ...(draft.beams[b.id] || {}) })),
  };
}

// ------------------------------------------------------------ расчёт и вывод
const chipOf = (sum, started) => {
  if (!started) return ['empty', L('нет показаний', 'no readings')];
  if (!sum.ok) return ['error', L('есть ошибки', 'has errors')];
  if (sum.status === 'out') return ['out', L(`вне допуска ±${fmt(sum.tol, sum.tol % 1 ? 1 : 0)} %`, `out of ±${fmt(sum.tol, sum.tol % 1 ? 1 : 0)}%`)];
  if (sum.status === 'nonominal') return ['ok', L('посчитано, номинал не задан', 'calculated, no nominal')];
  return ['ok', L(`в допуске ±${fmt(sum.tol, sum.tol % 1 ? 1 : 0)} %`, `within ±${fmt(sum.tol, sum.tol % 1 ? 1 : 0)}%`)];
};
const atText = (s) => (s.at === 'dmax' ? 'd_max' : 'z_ref');
const lvlName = () => ({ error: L('Ошибка', 'Error'), warn: L('Внимание', 'Warning'), info: L('Справка', 'Note') });

function compute() {
  const j = getJournal();
  const s = sessionObject();
  computed = s.beams.map((b) => {
    const calc = computeSessionBeam(j, s, b);
    return { input: b, calc, started: hasValues(b.rd_M1) };
  });
  return s;
}

function renderResults() {
  const s = compute();
  const tg = s.protocol === 'tg51';
  for (const { input, calc, started } of computed) {
    const card = $(`#js-beams .jsb[data-beam="${CSS.escape(input.beamId)}"]`);
    if (!card || !calc) continue;
    card.classList.toggle('off', input.include === false);
    const sum = calc.summary;
    const [cls, text] = chipOf(sum, started);
    const chip = card.querySelector('[data-chip]');
    chip.className = `chip jsb-chip ${cls}`;
    chip.textContent = input.include === false ? L('не участвует', 'excluded') : text;
    // средние показаний
    for (const out of card.querySelectorAll('output[data-mean]')) {
      const c = card.querySelector(`.cells[data-series="${CSS.escape(out.dataset.mean)}"]`);
      const v = readCells(c).map(parseNumber).filter(Number.isFinite);
      out.textContent = v.length ? fmt(Math.abs(v.reduce((a, x) => a + x, 0) / v.length), 4) : '';
    }
    card.querySelector('[data-recal]')?.toggleAttribute('hidden', card.querySelector('[data-sb="recal_needed"]')?.value !== 'yes');
    // откуда k_pol и k_s при проверке выхода
    const note = card.querySelector('[data-fixed-note]');
    if (note) {
      const [kp, kx] = tg ? ['P_pol', 'P_ion'] : ['k_pol', 'k_s'];
      const src = calc.fixedSrc || {};
      const valOf = (key) => parseNumber(calc.form[key]);
      const from = calc.form.rd_fixed_from;
      const whence = (code) =>
        ({
          manual: L('введён вручную', 'entered manually'),
          recorded: L(`как записано в сеансе${from ? ` (калибровка от ${from})` : ''}`, `as recorded in the session${from ? ` (calibration of ${from})` : ''}`),
          journal: L(`из калибровки этого пучка от ${fmtDate(calc.last?.date)}`, `from this beam's calibration of ${fmtDate(calc.last?.date)}`),
        })[code];
      const part = (name, key, code) => (code === 'none' ? L(`${name}: нет ни калибровки в журнале, ни значения вручную`, `${name}: neither a calibration in the journal nor a manual value`) : `${name} = ${fmt(valOf(key), 4)} — ${whence(code)}`);
      const q = tg ? (Number.isFinite(sum.quality) ? `%dd(10)x = ${fmt(sum.quality, 2)}` : '') : Number.isFinite(sum.quality) ? `TPR20,10 = ${fmt(sum.quality, 4)}` : '';
      let text;
      if (src.kpol === 'none' && src.ks === 'none') {
        text = L(`В журнале нет калибровки этого пучка до даты сеанса: проведите сеанс «Калибровка» или введите ${kp} и ${kx} из последней калибровки вручную.`, `The journal has no calibration of this beam before the session date: run a Calibration session or enter ${kp} and ${kx} from the last calibration manually.`);
      } else if (src.kpol === src.ks) {
        text = `${kp} = ${fmt(valOf('rd_fixed_kpol'), 4)} ${L('и', 'and')} ${kx} = ${fmt(valOf('rd_fixed_ks'), 4)} — ${whence(src.ks)}${q ? `; ${q}` : ''}.`;
      } else {
        text = `${part(kp, 'rd_fixed_kpol', src.kpol)}; ${part(kx, 'rd_fixed_ks', src.ks)}${q ? `; ${q}` : ''}.`;
      }
      note.innerHTML = richText(text);
      // в пустых полях — значения, которые будут использованы
      for (const [key, code] of [['rd_fixed_kpol', src.kpol], ['rd_fixed_ks', src.ks]]) {
        const el = card.querySelector(`[data-sb="${key}"]`);
        if (el) el.placeholder = code !== 'manual' && Number.isFinite(valOf(key)) ? fmt(valOf(key), 4) : '';
      }
      const fe = card.querySelector('[data-sb="rd_fixed_from"]');
      if (fe) fe.placeholder = isBlank(input.rd_fixed_from) && from ? from : '';
    }
    // итог пучка
    const res = card.querySelector('[data-result]');
    // разметку меняем, только если она изменилась: иначе щелчок по кнопке сразу после ввода (change при уходе
    // из поля) попадал бы в уже заменённую кнопку
    const put = (html) => {
      if (res._html === html) return;
      res._html = html;
      res.innerHTML = html;
    };
    if (!started) {
      put('');
      continue;
    }
    const lines = [];
    if (sum.hasValue) {
      lines.push(`<p class="jsb-dose"><b>${fmt(sum.value, 4)}</b> ${esc(L('Гр на 100 МЕ на', 'Gy per 100 MU at'))} ${richText(atText(sum))}${Number.isFinite(sum.deviation) ? ` · ${esc(L('от номинала', 'from nominal'))} <b>${fmtSigned(sum.deviation, 2)} %</b>` : ''}${sum.source === 'ctrl' ? ` · ${esc(L('по контрольным измерениям', 'from check measurements'))}` : sum.source === 'recal' ? ` · ${esc(L('после подстройки', 'after adjustment'))}${Number.isFinite(sum.preDeviation) ? ` (${esc(L('до неё', 'before'))} ${fmtSigned(sum.preDeviation, 2)} %)` : ''}` : ''}</p>`);
      const ks = tg ? 'P_ion' : 'k_s';
      const kp = tg ? 'P_pol' : 'k_pol';
      const prev = calc.prev && s.mode === 'cal' ? L(` (прошлая калибровка ${fmtDate(calc.prev.date)}: ${fmt(calc.prev.kpol, 4)} и ${fmt(calc.prev.ks, 4)})`, ` (previous calibration ${fmtDate(calc.prev.date)}: ${fmt(calc.prev.kpol, 4)} and ${fmt(calc.prev.ks, 4)})`) : '';
      lines.push(`<p class="jsb-k">${richText(`${kp} = ${fmt(sum.kpolRaw, 4)}, ${ks} = ${fmt(sum.ksRaw, 4)}${sum.ksFixed ? L(' (из калибровки)', ' (from the calibration)') : ''}${prev}; k_Q = ${fmt(sum.kQ, 4)}; ${tg ? `%dd(10)x = ${fmt(sum.quality, 2)}` : `TPR20,10 = ${fmt(sum.quality, 4)}`}`)}</p>`);
      if (Number.isFinite(sum.dKpol) && Math.abs(sum.dKpol) > 0.2) lines.push(`<p class="jsb-warn">${richText(L(`k_pol изменился на ${fmtSigned(sum.dKpol, 2)} % с прошлой калибровки: при изменении больше 0,2 % Report 374 советует выяснить причину (камера, кабель, электрометр).`, `k_pol changed by ${fmtSigned(sum.dKpol, 2)}% since the previous calibration: for a change above 0.2%, Report 374 advises investigating the cause (chamber, cable, electrometer).`))}</p>`);
    }
    const msgs = calc.result.messages.filter((m) => m.level !== 'info' || !sum.ok);
    const errs = msgs.filter((m) => m.level === 'error').length;
    if (errs && sum.hasValue) lines.push(`<p class="jsb-warn">${esc(L('Доза посчитана, но в настройках есть ошибки: пока их не исправить, пучок не записывается в журнал.', 'The dose is calculated, but the settings contain errors: until they are fixed, the beam is not recorded in the journal.'))}</p>`);
    if (msgs.length) {
      // замечания — те же, что на вкладке «МВ фотоны»: подсказать, где исправлять
      const where = errs
        ? `<li class="info"><span class="lvl">${esc(L('Где исправить', 'Where to fix'))}</span><span>${esc(
            calc.recorded
              ? L('Замечания — те же, что на вкладке «МВ фотоны», номера разделов в них — разделы вкладки. Показания и условия исправляются здесь. Сеанс посчитан по записанным в нём настройкам: чтобы применить исправленные в «Оборудовании», нажмите «Пересчитать по текущему «Оборудованию»» в начале раздела.', 'The messages are those of the MV photons tab, and section numbers in them refer to the tab. Readings and conditions are fixed here. The session is calculated with the settings recorded in it: to apply settings fixed in Equipment, click "Recalculate with the current Equipment" at the start of the section.')
              : L('Замечания — те же, что на вкладке «МВ фотоны», номера разделов в них — разделы вкладки. Показания и условия исправляются здесь, настройки пучка, камеры и электрометра — в «Оборудовании».', 'The messages are those of the MV photons tab, and section numbers in them refer to the tab. Readings and conditions are fixed here; beam, chamber and electrometer settings are fixed in Equipment.'),
          )}</span></li>`
        : '';
      lines.push(`<details class="jsb-msgs"${errs ? ' open' : ''}><summary>${esc(L(`Замечания: ${msgs.length}`, `Messages: ${msgs.length}`))}${errs ? ` · ${esc(L(`ошибок ${errs}`, `${errs} errors`))}` : ''}</summary><ul class="messages">${msgs.map((m) => `<li class="${m.level}"><span class="lvl">${esc(lvlName()[m.level])}</span><span>${richText(m.text)}</span>${m.ref ? `<span class="ref">${esc(refText(m.ref))}</span>` : ''}</li>`).join('')}${where}</ul></details>`);
    }
    lines.push(`<div class="row-tools"><button type="button" class="link-btn" data-open-tab="${esc(input.beamId)}">${esc(L('Открыть во вкладке «МВ фотоны»: все поправки и PDF по пучку', 'Open in the MV photons tab: all corrections and a PDF for the beam'))}</button>${errs && !calc.recorded ? `<button type="button" class="link-btn" data-goto-eq="${esc(input.beamId)}">${esc(L('Открыть пучок в «Оборудовании»', 'Open the beam in Equipment'))}</button>` : ''}</div>`);
    put(lines.join(''));
  }
  renderReadout(s);
}

function renderReadout(s) {
  const j = getJournal();
  const m = machineOf(j, s.machineId);
  const rows = computed.filter((c) => c.input.include !== false && c.calc);
  const okN = rows.filter((c) => c.started && c.calc.summary.ok && c.calc.summary.status !== 'out').length;
  const outN = rows.filter((c) => c.started && c.calc.summary.status === 'out').length;
  const errN = rows.filter((c) => c.started && !c.calc.summary.ok).length;
  const head = `${esc(m?.name || '—')} · ${esc(s.mode === 'cal' ? L('калибровка', 'calibration') : L('проверка выхода', 'output check'))} · ${esc(fmtDate(s.date))} · ${s.protocol === 'tg51' ? 'TG-51' : 'TRS-398 Rev.1'}`;
  const table = rows.length
    ? `<table class="factors jsum"><thead><tr><th>${esc(L('Пучок', 'Beam'))}</th><th class="v">${esc(L('Гр/100 МЕ', 'Gy/100 MU'))}</th><th class="v">${esc(L('Δ, %', 'Δ, %'))}</th></tr></thead><tbody>${rows
        .map(({ calc, started }) => {
          const sum = calc.summary;
          const [cls] = chipOf(sum, started);
          return `<tr class="st-${cls}"><td>${esc(calc.beam.name)}</td><td class="v">${started && sum.hasValue ? fmt(sum.value, 4) : '—'}</td><td class="v">${started && Number.isFinite(sum.deviation) ? fmtSigned(sum.deviation, 2) : '—'}</td></tr>`;
        })
        .join('')}</tbody></table>`
    : '';
  const chip = errN ? `<span class="chip bad">${esc(L(`с ошибками: ${errN}`, `with errors: ${errN}`))}</span>` : outN ? `<span class="chip warn">${esc(L(`вне допуска: ${outN}`, `out of tolerance: ${outN}`))}</span>` : rows.length && okN === rows.length ? `<span class="chip good">${esc(L('все в допуске', 'all within tolerance'))}</span>` : okN ? `<span class="chip good">${esc(L(`в допуске: ${okN} из ${rows.length}`, `within tolerance: ${okN} of ${rows.length}`))}</span>` : '';
  $('#js-result').innerHTML = `<div class="dose-row"><div class="proto"><span>${head}</span>${chip}</div>${table || `<div class="secondary">${esc(L('Введите показания пучков.', 'Enter the beam readings.'))}</div>`}</div>`;
  $('#js-mobile-value').textContent = rows.length ? L(`в допуске ${okN}, вне ${outN}, ошибок ${errN}`, `ok ${okN}, out ${outN}, errors ${errN}`) : '—';
  // замечания сеанса
  const msgs = [];
  for (const d of equipmentDue(j, s.date || today())) {
    msgs.push(['warn', d.status === 'overdue' ? L(`${d.text}: срок калибровки прошёл (${fmtDate(d.dueDate)}).`, `${d.text}: calibration overdue (${fmtDate(d.dueDate)}).`) : L(`${d.text}: срок калибровки ${fmtDate(d.dueDate)}, осталось ${d.days} дн.`, `${d.text}: calibration due ${fmtDate(d.dueDate)}, ${d.days} days left.`)]);
  }
  if (draft.id) msgs.push(['info', L('Редактируется сеанс, уже записанный в журнал: «Записать сеанс в журнал» заменит его.', 'A session already in the journal is being edited: "Record the session in the journal" will replace it.')]);
  if (errN) msgs.push(['warn', L('Пучки с ошибками в журнал не записываются — исправьте их или снимите отметку у пучка.', 'Beams with errors are not recorded in the journal: fix them or clear the beam checkbox.')]);
  $('#js-messages').innerHTML = msgs.length
    ? msgs.map(([lvl, t]) => `<li class="${lvl}"><span class="lvl">${esc(lvlName()[lvl])}</span><span>${richText(t)}</span></li>`).join('')
    : `<li class="info"><span class="lvl">${esc(L('Всё в порядке', 'All clear'))}</span><span>${esc(L('Сроки калибровки камер и электрометров в порядке.', 'Chamber and electrometer calibrations are within their dates.'))}</span></li>`;
  renderSignBlock($('#js-sign'), s.staff);
  notifyUpdate(ROOT());
}

function onEdit() {
  readDraft();
  draft.dirty = true;
  saveDraft();
  renderResults();
}

/** В сеансе есть показания, не записанные в журнал (для подтверждения перед открытием другого сеанса). */
export const sessionUnsaved = () => !!draft.dirty && Object.values(draft.beams).some((b) => hasValues(b?.rd_M1));

// ------------------------------------------------------------ действия
function record() {
  readDraft();
  const j = getJournal();
  const s = sessionObject();
  if (!s.id) s.id = uid('s');
  // в журнал — только пучки с результатом без ошибок
  const live = computed.filter((c) => c.input.include !== false && c.calc);
  const okIds = new Set(live.filter((c) => c.started && c.calc.summary.ok).map((c) => c.input.beamId));
  s.beams = s.beams.filter((b) => okIds.has(b.beamId));
  if (!s.beams.length) {
    const started = live.filter((c) => c.started).length;
    setStatus(
      !computed.length
        ? L('Записывать нечего: у аппарата нет пучков в сеансе.', 'Nothing to record: the machine has no beams in the session.')
        : !live.length
          ? L('Записывать нечего: у всех пучков снята отметка участия в сеансе.', 'Nothing to record: all beams are excluded from the session.')
        : !started
          ? L('Записывать нечего: введите показания хотя бы одного пучка.', 'Nothing to record: enter the readings of at least one beam.')
          : L('Записывать нечего: у всех пучков с показаниями есть ошибки — они перечислены под каждым пучком.', 'Nothing to record: every beam with readings has errors, listed under each beam.'),
    );
    return;
  }
  const fin = finalizeSession(j, s);
  setJournal(upsertSession(j, fin), 'session');
  draft.id = fin.id;
  draft.dirty = false;
  saveDraft();
  renderResults();
  const skipped = live.filter((c) => c.started && !okIds.has(c.input.beamId)).map((c) => c.calc.beam.name);
  setStatus(
    L(
      `Сеанс записан в журнал (пучков: ${fin.beams.length})${skipped.length ? `; не записаны из-за ошибок: ${skipped.join(', ')}` : ''}. Сохраните журнал в файл — кнопка «Сохранить журнал» ниже.`,
      `The session has been recorded in the journal (${fin.beams.length} beams)${skipped.length ? `; not recorded because of errors: ${skipped.join(', ')}` : ''}. Save the journal to the file with the "Save journal" button below.`,
    ),
  );
}

function newSession() {
  const keep = { machineId: draft.machineId, mode: draft.mode, staff: draft.staff, env: { ...draft.env, T: '', P: '', H: '' } };
  draft = { id: '', date: today(), notes: '', beams: {}, dirty: false, ...keep };
  saveDraft();
  writeHead();
  renderBeams();
  renderResults();
}

/** Открыть записанный сеанс для просмотра и правки (из «Журнала и трендов»): считается по записанным в нём настройкам. */
export function loadSession(s) {
  draft = {
    id: s.id,
    machineId: s.machineId,
    date: s.date,
    mode: s.mode === 'check' ? 'check' : 'cal',
    staff: s.staff?.length ? s.staff : [''],
    notes: s.notes || '',
    env: { ...draft.env, ...(s.env || {}) },
    beams: Object.fromEntries(
      s.beams.map((b) => {
        const { form, summary, ...input } = b;
        return [b.beamId, { ...input, include: true, ...(form ? { base: recordedBase(form) } : {}) }];
      }),
    ),
    dirty: false,
  };
  // протокол — тот, по которому сеанс записан
  const proto = s.protocol === 'tg51' ? 'tg51' : 'trs';
  const switched = proto !== currentProtocol();
  if (switched) applyProtocol(proto);
  saveDraft();
  writeHead();
  renderBeams();
  renderResults();
  setStatus(
    L(
      `Открыт сеанс от ${fmtDate(s.date)}${switched ? `; протокол в шапке переключён на ${proto === 'tg51' ? 'TG-51' : 'TRS-398'} — по нему сеанс записан` : ''}. Изменения попадут в журнал после «Записать сеанс в журнал».`,
      `Session of ${fmtDate(s.date)} opened${switched ? `; the header protocol has been switched to ${proto === 'tg51' ? 'TG-51' : 'TRS-398'}, the one the session was recorded with` : ''}. Changes go to the journal after "Record the session in the journal".`,
    ),
  );
}

/** Убрать у пучка черновика всё, что пришло из записанного сеанса: настройки, камеру и электрометр сеанса. */
function dropRecorded(d) {
  delete d.base;
  delete d.chamberId;
  delete d.electrometerId;
}

/** Считать сеанс по текущему «Оборудованию» вместо записанных в нём настроек. */
function useCurrentEquipment() {
  readDraft();
  for (const d of Object.values(draft.beams)) dropRecorded(d);
  draft.dirty = true;
  saveDraft();
  renderBeams();
  renderResults();
  setStatus(L('Сеанс пересчитан по текущему «Оборудованию». В журнал изменения попадут после «Записать сеанс в журнал».', 'The session has been recalculated with the current Equipment. The changes go to the journal after "Record the session in the journal".'));
}

function reportText() {
  const s = compute();
  const j = getJournal();
  const m = machineOf(j, s.machineId);
  const tg = s.protocol === 'tg51';
  const out = [];
  out.push(L('СЕАНС НА ВЕСЬ АППАРАТ', 'WHOLE-MACHINE SESSION'));
  out.push(`${L('Учреждение', 'Institution')}: ${j.institution || '—'}`);
  out.push(`${L('Аппарат', 'Machine')}: ${[m?.name, m?.serial ? `${L('№', 'S/N')} ${m.serial}` : ''].filter(Boolean).join(', ') || '—'}`);
  out.push(`${L('Дата', 'Date')}: ${fmtDate(s.date)}; ${L('режим', 'mode')}: ${s.mode === 'cal' ? L('калибровка', 'calibration') : L('проверка выхода (k_pol и k_s из последней калибровки)', 'output check (k_pol and k_s from the last calibration)')}; ${L('протокол', 'protocol')}: ${tg ? 'TG-51' : 'TRS-398 Rev.1'}`);
  out.push(`${L('Сотрудники', 'Staff')}: ${s.staff.filter((x) => x.trim()).join(', ') || '—'}`);
  out.push(`${L('Общие условия', 'Common conditions')}: T = ${s.env.T || '—'} °C; P = ${s.env.P || '—'} ${unitLabel(PRESSURE_UNITS[s.env.P_unit] || PRESSURE_UNITS.kPa)}${s.env.H ? `; ${L('влажность', 'humidity')} ${s.env.H} %` : ''}`);
  out.push('');
  for (const { input, calc, started } of computed) {
    if (input.include === false || !calc || !started) continue;
    const sum = calc.summary;
    out.push(`${calc.beam.name}: ${chamberText(calc.chamber)}; ${electrometerText(calc.electrometer)}`);
    if (sum.hasValue) {
      if (!sum.ok) out.push(`  ${L('Есть ошибки: пучок не записан в журнал', 'There are errors: the beam is not recorded in the journal')}`);
      out.push(`  ${L('Доза', 'Dose')}: ${fmt(sum.value, 4)} ${L('Гр на 100 МЕ на', 'Gy per 100 MU at')} ${atText(sum)}${Number.isFinite(sum.deviation) ? `; ${L('от номинала', 'from nominal')} ${fmtSigned(sum.deviation, 2)} % (${sum.status === 'out' ? L('вне допуска', 'out of tolerance') : L('в допуске', 'within tolerance')} ±${fmt(sum.tol, sum.tol % 1 ? 1 : 0)} %)` : ''}`);
      out.push(`  ${tg ? 'P_pol' : 'k_pol'} = ${fmt(sum.kpolRaw, 4)}; ${tg ? 'P_ion' : 'k_s'} = ${fmt(sum.ksRaw, 4)}${sum.ksFixed ? ` (${[L('из калибровки', 'from the calibration'), calc.form.rd_fixed_from].filter(Boolean).join(' ')})` : ''}; k_Q = ${fmt(sum.kQ, 4)}; ${tg ? `%dd(10)x = ${fmt(sum.quality, 2)}` : `TPR20,10 = ${fmt(sum.quality, 4)}`}`);
    } else out.push(`  ${L('Нет результата: есть ошибки', 'No result: there are errors')}`);
    for (const msg of calc.result.messages.filter((x) => x.level !== 'info')) out.push(`  - ${msg.text}`);
  }
  if (s.notes) out.push('', `${L('Примечания', 'Notes')}: ${s.notes}`);
  out.push('', `${L('Калькулятор референсной дозиметрии', 'Reference dosimetry calculator')}, ${versionText()}`);
  return out.join('\n');
}

export function sessionStatus(text) {
  setStatus(text);
}

export function initSession() {
  setStatus = makeStatus($('#js-status'));
  $('#js_P_unit').innerHTML = Object.entries(PRESSURE_UNITS).map(([k, u]) => `<option value="${k}">${unitLabel(u)}</option>`).join('');
  loadDraft();
  if (!draft.date) draft.date = today();
  writeHead();
  renderBeams();
  renderResults();
  setupFilePanel($('#js-file'), (t) => setStatus(t));
  $$('#js-sheet > section .combo').forEach((c) => makeCombo(c));

  const sheet = $('#js-sheet');
  // аппарат и режим обрабатываются по change (новый сеанс); их input пришёл бы раньше и пометил сеанс изменённым
  sheet.addEventListener('input', (e) => {
    if (e.target.id === 'js_machine' || e.target.name === 'js_mode') return;
    onEdit();
  });
  sheet.addEventListener('change', (e) => {
    if (e.target.id === 'js_machine' || e.target.name === 'js_mode') {
      // другой аппарат или режим — это новый сеанс: записанный остаётся в журнале как есть
      const wasRecorded = !!draft.id;
      const clean = wasRecorded && !draft.dirty;
      readDraft();
      if (wasRecorded) {
        draft.id = '';
        // показания записанного сеанса не переносятся в новый, иначе его легко записать второй раз
        if (clean) draft.beams = {};
        else for (const d of Object.values(draft.beams)) dropRecorded(d);
        setStatus(
          clean
            ? L('Начат новый сеанс: записанный остаётся в журнале без изменений, показания очищены.', 'A new session has been started: the recorded one stays in the journal unchanged; readings cleared.')
            : L('Начат новый сеанс: записанный ранее остаётся в журнале без изменений.', 'A new session has been started: the one recorded earlier stays in the journal unchanged.'),
        );
      }
      saveDraft();
      renderBeams();
      renderResults();
      return;
    }
    onEdit();
  });
  sheet.addEventListener('click', (e) => {
    if (e.target.closest('#js-btn-current')) {
      useCurrentEquipment();
      return;
    }
    const g = e.target.closest('[data-goto-eq]');
    if (g) {
      bridge.openEquipment(g.dataset.gotoEq);
      return;
    }
    const b = e.target.closest('[data-open-tab]');
    if (!b) return;
    const c = computed.find((x) => x.input.beamId === b.dataset.openTab);
    if (c?.calc) bridge.openInPhotons(c.calc.form, `${c.calc.machine.name} — ${c.calc.beam.name}, ${fmtDate(draft.date)}`);
  });
  $('#js-btn-add-staff').addEventListener('click', () => {
    const cur = readStaff($('#js-staff-list'));
    cur.push('');
    renderStaff($('#js-staff-list'), cur, onEdit);
    onEdit();
  });
  $('#js-btn-record').addEventListener('click', record);
  armButton($('#js-btn-new'), () => L('Новый сеанс', 'New session'), () => L('Нажмите ещё раз: показания очистятся', 'Click again: readings will be cleared'), () => {
    newSession();
    setStatus(L('Начат новый сеанс: аппарат, режим и сотрудники сохранены, показания очищены.', 'A new session started: machine, mode and staff kept, readings cleared.'));
  });
  $('#js-btn-copy').addEventListener('click', () => copyText(reportText(), L('Протокол сеанса скопирован.', 'The session report has been copied.'), setStatus));
  $('#js-btn-pdf').addEventListener('click', () => printToPdf([L('Сеанс', 'Session'), machineOf(getJournal(), draft.machineId)?.name, draft.date].filter(Boolean).join('_'), setStatus));
  $('#js-btn-print').addEventListener('click', () => window.print());
  document.addEventListener('change', (e) => {
    // поля качества пучка и подписи поправок зависят от протокола; черновик уже актуален (onEdit)
    if (e.target.name === 'protocol') {
      renderBeams();
      renderResults();
    }
  });
  onJournal(({ source, journal }) => {
    if (source === 'session') return;
    // сеанс, который здесь правят, удалили из журнала: запись станет новым сеансом
    if (draft.id && !journal.sessions.some((x) => x.id === draft.id)) {
      draft.id = '';
      saveDraft();
    }
    // правка «Оборудования» — сразу в карточки пучков (названия, камера, V₁), а не только в расчёт
    writeHead();
    renderBeams();
    renderResults();
  });
  document.addEventListener('langchange', () => {
    readDraft();
    $('#js_P_unit').innerHTML = Object.entries(PRESSURE_UNITS).map(([k, u]) => `<option value="${k}">${unitLabel(u)}</option>`).join('');
    writeHead();
    renderBeams();
    renderResults();
  });
}
