// «Дозиметрия» → «Сеанс»: калибровка нескольких пучков одного аппарата подряд в воде (TRS-398 Rev.1). На странице сеанса
// выбираются аппарат, дата, режим и пучки по порядку; затем каждый пучок открывается в своей вкладке дозиметрии с пучком
// журнала в разделе 1, а полоса сеанса над вкладкой ведёт от пучка к пучку («Записать и далее»). Ход сеанса — по записям
// журнала (core/session.js); план хранится в этом браузере.
import { L } from '../core/i18n.js';
import { PLAN_DEFAULTS, machineBeams, sessionMachines, normalizePlan, planProgress, nextPending } from '../core/session.js';
import { futureDateError } from '../core/journal.js';
import { $, esc, richText, today, fmtSigned } from './common.js';
import { getJournal, onJournal } from './journal-store.js';
import { fmtDate, countWord } from './journal-common.js';

const KEY = 'reference-dosimetry.session';
/** Полоса сеанса на вкладках дозиметрии. */
const BARS = { co60: '#co-sbar', photons: '#ph-sbar', electrons: '#e-sbar' };
const KIND_TEXT = { photon: () => L('фотоны', 'photons'), electron: () => L('электроны', 'electrons'), cobalt: () => '⁶⁰Co' };
const TAB_TEXT = { photon: () => L('«МВ фотоны»', 'MV photons'), electron: () => L('«Электроны»', 'Electrons'), cobalt: () => L('«⁶⁰Co»', '⁶⁰Co') };
const modeText = (mode) => (mode === 'check' ? L('проверка выхода в воде', 'output check in water') : L('калибровка в воде', 'calibration in water'));

let plan = { ...PLAN_DEFAULTS };
// мост к вкладкам (app.js): open(kind, machineId, beamId, { date, check }), record(kind) → true/false, bound(kind), go(module)
let bridge = null;
let statusEl = null;
// последняя разметка полос: перерисовывать только при изменении (иначе щелчок попадает в уже заменённую кнопку)
const lastBar = {};

function load() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (v && typeof v === 'object') plan = { ...PLAN_DEFAULTS, ...v };
  } catch {
    /* хранилище недоступно */
  }
}
function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(plan));
  } catch {
    /* хранилище недоступно */
  }
}
const status = (t) => {
  if (statusEl) statusEl.textContent = t;
};

/** Итог пучка для строки сеанса: отклонение от номинала или «записан». */
function resultChip(it) {
  if (!it.done) return it.current ? `<span class="chip">${esc(L('сейчас', 'now'))}</span>` : `<span class="chip none">${esc(L('не измерен', 'not measured'))}</span>`;
  const s = it.summary;
  const cls = s?.status === 'ok' ? 'ok' : s?.status === 'out' ? 'out' : s?.status === 'error' ? 'error' : '';
  const dev = Number.isFinite(s?.deviation) ? ` · ${fmtSigned(s.deviation, 2)} %` : '';
  return `<span class="chip ${cls}">✓ ${esc(L('записан', 'recorded'))}${esc(dev)}</span>`;
}

// ------------------------------------------------------------ страница «Сеанс»
function setupHtml(j) {
  const ms = sessionMachines(j);
  if (!ms.length) {
    return `<section class="start-card session-card"><h2>${esc(L('Сеанс', 'Session'))}</h2>
      <p class="start-when">${esc(L('Для сеанса нужны аппарат и его пучки в журнале отделения.', 'A session needs a machine and its beams in the department journal.'))}</p>
      <div class="start-row"><a class="start-go" href="#equipment" data-goto="equipment"><span>${esc(L('Оборудование', 'Equipment'))}</span><small>${esc(L('аппараты и пучки, камеры, электрометры', 'machines and beams, chambers, electrometers'))}</small></a></div></section>`;
  }
  const p = normalizePlan(j, plan);
  const machineId = p.machineId || ms[0].id;
  const beams = machineBeams(j, machineId);
  // порядок: выбранные — как в плане, затем остальные пучки аппарата
  const chosen = p.machineId === machineId ? p.beamIds : beams.map((b) => b.id);
  const order = [...chosen, ...beams.map((b) => b.id).filter((id) => !chosen.includes(id))];
  const date = p.date || today();
  const prog = planProgress(j, { ...p, machineId, beamIds: order, date });
  const opt = (v, t, cur) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(t)}</option>`;
  const rows = prog.items.map((it, i) => `<li class="session-beam">
      <label class="check"><input type="checkbox" data-sb="${esc(it.beamId)}"${chosen.includes(it.beamId) ? ' checked' : ''}> <span><b>${esc(it.name || L('пучок без названия', 'unnamed beam'))}</b> · ${esc(KIND_TEXT[it.kind]())} · ${esc(it.lastCal ? L(`последняя калибровка ${fmtDate(it.lastCal)}`, `last calibration ${fmtDate(it.lastCal)}`) : L('калибровок в журнале нет', 'no calibrations in the journal'))}</span></label>
      <span class="session-move"><button type="button" class="icon-btn" data-up="${i}"${i ? '' : ' disabled'} aria-label="${esc(L('Выше', 'Up'))}" title="${esc(L('Выше', 'Up'))}">↑</button><button type="button" class="icon-btn" data-down="${i}"${i < order.length - 1 ? '' : ' disabled'} aria-label="${esc(L('Ниже', 'Down'))}" title="${esc(L('Ниже', 'Down'))}">↓</button></span></li>`).join('');
  const n = chosen.filter((id) => order.includes(id)).length;
  const future = futureDateError(date, today());
  return `<section class="start-card session-card"><h2>${esc(L('Новый сеанс', 'New session'))}</h2>
    <p class="start-when">${esc(L(
      'Калибровка нескольких пучков одного аппарата подряд в воде, в референсных условиях TRS-398 Rev.1. Каждый пучок измеряется в своей вкладке («⁶⁰Co», «МВ фотоны», «Электроны») так же, как одиночный, и записывается в журнал; после записи открывается следующий.',
      'Calibration of several beams of one machine in a row in water, under TRS-398 Rev.1 reference conditions. Each beam is measured in its own tab (⁶⁰Co, MV photons, Electrons) just like a single beam and recorded to the journal; after recording, the next one opens.',
    ))}</p>
    <div class="grid">
      <div class="field span-2"><label for="ss_machine">${esc(L('Аппарат', 'Machine'))}</label><select id="ss_machine">${ms.map((m) => opt(m.id, [m.name || L('аппарат без названия', 'unnamed machine'), m.serial ? `№ ${m.serial}` : ''].filter(Boolean).join(', '), machineId)).join('')}</select></div>
      <div class="field"><label for="ss_date">${esc(L('Дата измерения', 'Measurement date'))}</label><input type="date" id="ss_date" value="${esc(date)}"></div>
    </div>
    ${future ? `<p class="jlink-st warn">${esc(future)}</p>` : ''}
    <fieldset class="plain session-mode"><legend class="label">${esc(L('Режим', 'Mode'))}</legend>
      <label class="check"><input type="radio" name="ss_mode" value="cal"${p.mode === 'check' ? '' : ' checked'}> <span>${esc(L('Калибровка: k_pol, k_s и качество пучка измеряются', 'Calibration: k_pol, k_s and beam quality are measured')).replace(/k_(pol|s)/g, 'k<sub>$1</sub>')}</span></label>
      <label class="check"><input type="radio" name="ss_mode" value="check"${p.mode === 'check' ? ' checked' : ''}> <span>${esc(L('Проверка выхода в воде: k_pol, k_s и качество пучка — из последней калибровки', 'Output check in water: k_pol, k_s and beam quality from the last calibration')).replace(/k_(pol|s)/g, 'k<sub>$1</sub>')}</span></label>
    </fieldset>
    <h3>${esc(L('Пучки сеанса', 'Session beams'))}</h3>
    <ol class="session-beams">${rows}</ol>
    <p class="start-note">${esc(L('Камера, электрометр и настройки каждого пучка подставляются из журнала, как при выборе пучка в разделе 1 вкладки. Сотрудники, температура, давление и показания вводятся во вкладке.', 'The chamber, electrometer and settings of each beam are filled in from the journal, as when a beam is selected in section 1 of the tab. Staff, temperature, pressure and readings are entered in the tab.'))}</p>
    <div class="actions"><button type="button" class="primary" data-ss="start"${n && !future ? '' : ' disabled'}>${esc(n ? `${L('Начать сеанс', 'Start the session')}: ${n} ${countWord(n, [L('пучок', 'beam'), L('пучка', 'beams'), L('пучков', 'beams')], ['beam', 'beams'])}` : L('Отметьте пучки', 'Select beams'))}</button></div>
  </section>`;
}

function activeHtml(j) {
  const prog = planProgress(j, plan);
  const p = prog.plan;
  const cur = prog.items[p.index];
  const rows = prog.items.map((it, i) => `<li class="session-beam${it.current ? ' current' : ''}">
      <span><b>${esc(it.name || L('пучок без названия', 'unnamed beam'))}</b> · ${esc(KIND_TEXT[it.kind]())}${it.done && it.protocol === 'tg51' ? ' · TG-51' : ''}</span>
      ${resultChip(it)}
      <button type="button" class="link-btn" data-open="${i}">${esc(it.done ? L('Открыть', 'Open') : L('Измерить', 'Measure'))}</button></li>`).join('');
  return `<section class="start-card session-card"><h2>${esc(L('Сеанс', 'Session'))}: ${esc(prog.machine.name || '—')} · ${esc(fmtDate(p.date))}</h2>
    <p class="start-when">${richText(L(
      `${modeText(p.mode)[0].toUpperCase()}${modeText(p.mode).slice(1)}. Записано в журнал: ${prog.done} из ${prog.total}.`,
      `${modeText(p.mode)[0].toUpperCase()}${modeText(p.mode).slice(1)}. Recorded to the journal: ${prog.done} of ${prog.total}.`,
    ))}</p>
    <ol class="session-beams">${rows}</ol>
    ${prog.finished
      ? `<p class="start-state">${esc(L('Все пучки сеанса записаны в журнал. Тренды и протокол записи — во вкладке «Журнал и тренды»; сохраните журнал в файл, если автосохранение не включено.', 'All session beams have been recorded to the journal. Trends and the record report are in the Journal and trends tab; save the journal file if autosave is off.'))}</p>
        <div class="actions"><a class="start-go" href="#history" data-goto="history"><span>${esc(L('Журнал и тренды', 'Journal and trends'))}</span></a><button type="button" class="primary" data-ss="end">${esc(L('Закрыть сеанс', 'Close the session'))}</button></div>`
      : `<div class="actions"><button type="button" class="primary" data-open="${p.index}">${esc(L(`Продолжить: ${cur.name}`, `Continue: ${cur.name}`))}</button><button type="button" data-ss="end">${esc(L('Завершить сеанс', 'End the session'))}</button></div>
        <p class="start-note">${esc(L('Завершить сеанс можно в любой момент: записанные пучки остаются в журнале.', 'The session can be ended at any time: the recorded beams stay in the journal.'))}</p>`}
  </section>`;
}

function renderPage() {
  const root = $('#session-root');
  if (!root) return;
  const j = getJournal();
  plan = normalizePlan(j, plan);
  root.innerHTML = plan.active ? activeHtml(j) : setupHtml(j);
}

// ------------------------------------------------------------ полоса сеанса на вкладках дозиметрии
function renderBars() {
  const j = getJournal();
  plan = normalizePlan(j, plan);
  const prog = plan.active ? planProgress(j, plan) : null;
  for (const [module, sel] of Object.entries(BARS)) {
    const el = $(sel);
    if (!el) continue;
    if (!prog) {
      el.hidden = true;
      el.innerHTML = '';
      lastBar[module] = '';
      continue;
    }
    const cur = prog.items[plan.index];
    const here = cur.module === module;
    const b = here ? bridge?.bound(cur.kind) : null;
    const bound = !!b && b.machineId === plan.machineId && b.beamId === cur.beamId;
    const next = nextPending(j, plan);
    const nextName = next >= 0 ? prog.items[next].name : '';
    const prev = plan.index > 0 ? prog.items[plan.index - 1] : null;
    const chips = prog.items.map((it, i) => `<button type="button" class="chip ${it.done ? 'ok' : it.current ? '' : 'none'}${it.current ? ' current' : ''}" data-open="${i}" title="${esc(it.done ? L('записан в журнал', 'recorded to the journal') : L('не измерен', 'not measured'))}">${it.done ? '✓' : it.current ? '●' : '○'} ${esc(it.name)}${it.done && Number.isFinite(it.summary?.deviation) ? ` · ${esc(fmtSigned(it.summary.deviation, 2))} %` : ''}</button>`).join('');
    let actions;
    if (here && bound) {
      actions = `${prev ? `<button type="button" data-open="${plan.index - 1}">← ${esc(prev.name)}</button>` : ''}<button type="button" class="primary" data-ss="record">${esc(next >= 0 ? L(`Записать и далее: ${nextName} →`, `Record and next: ${nextName} →`) : cur.done ? L('Записать заново и завершить', 'Record again and finish') : L('Записать и завершить', 'Record and finish'))}</button>${next >= 0 ? `<button type="button" data-open="${next}" title="${esc(L('Пучок остаётся в сеансе невыполненным', 'The beam stays in the session as not measured'))}">${esc(L('Пропустить', 'Skip'))}</button>` : ''}`;
    } else {
      const where = here ? '' : L(` (вкладка ${TAB_TEXT[cur.kind]()})`, ` (the ${TAB_TEXT[cur.kind]()} tab)`);
      actions = `<button type="button" class="primary" data-open="${plan.index}">${esc(L(`Открыть пучок сеанса: ${cur.name}${where}`, `Open the session beam: ${cur.name}${where}`))}</button>`;
    }
    const note = here && !bound ? `<p class="jlink-st warn">${esc(L('Во вкладке выбран другой пучок журнала или пучок не выбран: запись пойдёт не в сеанс.', 'Another journal beam (or none) is selected in the tab: the record will not go to the session.'))}</p>` : '';
    const html = `<div class="session-head"><b>${esc(L('Сеанс', 'Session'))} · ${esc(prog.machine.name || '—')} · ${esc(fmtDate(plan.date))} · ${esc(modeText(plan.mode))} · ${esc(L(`пучок ${plan.index + 1} из ${prog.total}`, `beam ${plan.index + 1} of ${prog.total}`))}</b>
      <span class="actions">${actions}<a class="link-btn" href="#session" data-goto="session">${esc(L('Сеанс', 'Session'))}</a></span></div>
      <div class="session-chips">${chips}</div>${note}`;
    el.hidden = false;
    if (html !== lastBar[module]) {
      lastBar[module] = html;
      el.innerHTML = html;
    }
  }
}

function render() {
  renderPage();
  renderBars();
}

// ------------------------------------------------------------ действия
/** Открыть пучок сеанса i в его вкладке с датой и режимом сеанса. */
function open(i) {
  const j = getJournal();
  plan = normalizePlan(j, { ...plan, index: i });
  if (!plan.active) return render();
  persist();
  const prog = planProgress(j, plan);
  const it = prog.items[plan.index];
  bridge?.open(it.kind, plan.machineId, it.beamId, { date: plan.date, check: plan.mode === 'check' });
  render();
}

function record() {
  const j = getJournal();
  const it = planProgress(j, plan).items[plan.index];
  if (!it || !bridge?.record(it.kind)) return;
  const next = nextPending(getJournal(), plan);
  if (next >= 0) open(next);
  else {
    render();
    bridge?.go('session');
    status(L('Все пучки сеанса записаны в журнал.', 'All session beams have been recorded to the journal.'));
  }
}

function readSetup() {
  const root = $('#session-root');
  const machineId = $('#ss_machine', root)?.value ?? plan.machineId;
  const order = [...root.querySelectorAll('[data-sb]')].map((x) => x.dataset.sb);
  const chosen = order.filter((id) => root.querySelector(`[data-sb="${CSS.escape(id)}"]`)?.checked);
  return { machineId, order, chosen, date: $('#ss_date', root)?.value || '', mode: root.querySelector('input[name="ss_mode"]:checked')?.value === 'check' ? 'check' : 'cal' };
}

function onSetupChange(e) {
  const s = readSetup();
  // другой аппарат — все его пучки отмечены
  const beamIds = e?.target?.id === 'ss_machine' ? machineBeams(getJournal(), s.machineId).map((b) => b.id) : s.chosen;
  plan = { ...PLAN_DEFAULTS, machineId: s.machineId, date: s.date, mode: s.mode, beamIds };
  persist();
  renderPage();
}

/** Подключить «Сеанс». b — мост к вкладкам дозиметрии (см. bridge). */
export function initSession(b) {
  bridge = b;
  statusEl = $('#session-status');
  load();
  const root = $('#session-root');
  root?.addEventListener('change', (e) => {
    if (!plan.active) onSetupChange(e);
  });
  root?.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.up || t.dataset.down) {
      const s = readSetup();
      const i = Number(t.dataset.up ?? t.dataset.down);
      const k = t.dataset.up ? i - 1 : i + 1;
      [s.order[i], s.order[k]] = [s.order[k], s.order[i]];
      plan = { ...PLAN_DEFAULTS, machineId: s.machineId, date: s.date, mode: s.mode, beamIds: s.order.filter((id) => s.chosen.includes(id)) };
      persist();
      renderPage();
      return;
    }
    if (t.dataset.ss === 'start') {
      const s = readSetup();
      const j = getJournal();
      const next = normalizePlan(j, { active: true, machineId: s.machineId, date: s.date, mode: s.mode, beamIds: s.order.filter((id) => s.chosen.includes(id)), index: 0 });
      if (!next.date) {
        status(L('Укажите дату измерения: по ней пучки ложатся в одну запись журнала.', 'Enter the measurement date: the beams are filed in one journal record by it.'));
        return;
      }
      const future = futureDateError(next.date, today());
      if (future) {
        status(future);
        return;
      }
      plan = next;
      // первый невыполненный пучок (сеанс за эту дату мог быть начат раньше)
      const first = planProgress(j, plan).items.findIndex((x) => !x.done);
      open(first >= 0 ? first : 0);
      status('');
      return;
    }
    if (t.dataset.ss === 'end') {
      plan = { ...normalizePlan(getJournal(), plan), active: false, index: 0 };
      persist();
      render();
      status(L('Сеанс завершён. Записанные пучки остаются в журнале.', 'The session has ended. The recorded beams stay in the journal.'));
      return;
    }
    if (t.dataset.open !== undefined) open(Number(t.dataset.open));
  });
  for (const sel of Object.values(BARS)) {
    $(sel)?.addEventListener('click', (e) => {
      const t = e.target.closest('button');
      if (!t) return;
      if (t.dataset.ss === 'record') record();
      else if (t.dataset.open !== undefined) open(Number(t.dataset.open));
    });
  }
  // привязка вкладки к пучку журнала меняется в разделе 1 — полосу перерисовать
  document.addEventListener('moduleupdate', renderBars);
  document.addEventListener('change', (e) => {
    if (e.target.closest?.('[data-jb]')) requestAnimationFrame(renderBars);
  });
  onJournal(render);
  document.addEventListener('langchange', render);
  render();
}

/** Перерисовать страницу сеанса (при её открытии). */
export const renderSessionPage = () => render();

/** Сообщение в строке состояния сеанса. */
export const sessionStatus = (t) => status(t);
