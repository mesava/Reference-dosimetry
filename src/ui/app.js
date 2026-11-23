// Точка входа: язык, вкладки разделов, общий переключатель протокола, справки, вставка данных из буфера.
import { TERMS } from './terms.js';
import { TERMS_EN } from './terms-en.js';
import { L, setLang, getLang } from '../core/i18n.js';
import { initialLang, saveLang, applyLang, translateStatic, localizeDecimal } from './i18n.js';
import { $, $$, esc, setActiveModule, getActiveModule, PROTOCOL_KEY, applyProtocol, currentProtocol, today } from './common.js';
import { FORM_DEFAULTS } from '../core/photons.js';
import { E_DEFAULTS } from '../core/electrons.js';
import { CO_DEFAULTS } from '../core/cobalt.js';
import { initCobalt, importCobalt, cobaltStatus, applyCobaltPatch, cobaltUncSource, cobaltCurrentForm, showInCobalt, setCobaltJournalSave } from './cobalt-ui.js';
import { initPhotons, importPhotons, photonsStatus, applyPhotonsPatch, photonsUncSource, photonsCurrentForm, showInPhotons, setPhotonsJournalSave } from './photons-ui.js';
import { initElectrons, importElectrons, electronsStatus, applyElectronsPatch, electronsUncSource, electronsCurrentForm, showInElectrons, setElectronsJournalSave } from './electrons-ui.js';
import { initKv, importKv, kvStatus, kvUncSource, kvShown, showKvRecord } from './kv-ui.js';
import { initCrossCal, importCrossCal, crossCalStatus, setCrossCalTransfer } from './crosscal-ui.js';
import { initUncTool, importUncTool, uncToolStatus, setUncSources, applyStability } from './uncertainty-tool-ui.js';
import { initJaffe, importJaffe, jaffeStatus } from './jaffe-ui.js';
import { initEdepth, importEdepth, edepthStatus, setEdepthTransfer } from './edepth-ui.js';
import { initSectionNavs, refreshSectionNav } from './section-nav.js';
import { initJournalStore, importJournalObject, onJournal, onFileState, getJournal } from './journal-store.js';
import { setListSource, setupHoverPop } from './widgets.js';
import { staffNames } from '../core/journal.js';
import { initStart, renderStart } from './start-ui.js';
import { initPwa } from './pwa.js';
import { initLook, setBeamLook } from './look.js';
import { initSecLinks, revealSection } from './sec-links.js';
import { initTabEquipment } from './tab-equipment-ui.js';
import { initTabJournal } from './tab-journal-ui.js';
import { initEquipment, equipmentStatus, setEquipmentBridge, saveBeamFromTab, revealBeam, renderMyChambersTool, equipmentShown } from './journal-equipment-ui.js';
import { initHistory, historyStatus, setHistoryBridge } from './journal-history-ui.js';
import { initSession, renderSessionPage, sessionStatus, setSessionSheet, sessionInfo, sessionLastKind } from './session-ui.js';
import { initPlates, renderPlatesPage, platesStatus, platesLastKind } from './plates-ui.js';
import { initBrachy, renderBrachy, brachyStatus } from './brachy-ui.js';

const TAB_KEY = 'reference-dosimetry.tab';
// последний открытый подраздел вкладки в шапке («Дозиметрия», «Инструменты»)
const subKey = (group) => `reference-dosimetry.sub.${group}`;
// tab — вкладка в шапке, к которой относится модуль. Адреса модулей (#photons, #tools…) прежние: так открываются
// старые ссылки и закладки. Подразделы перечислены в порядке работы.
const MODULES = {
  start: { title: () => L('Клиническая дозиметрия', 'Clinical dosimetry'), file: '-', importData: () => {}, status: (t) => { $('#start-status').textContent = t; }, tab: 'start', proto: false },
  equipment: { title: () => L('Оборудование отделения', 'Department equipment'), file: '-', importData: () => {}, status: (t) => equipmentStatus(t), tab: 'equipment', proto: false },
  history: { title: () => L('Журнал и тренды', 'Journal and trends'), file: 'journal', importData: (obj) => importJournalObject(obj), status: (t) => historyStatus(t), tab: 'history', proto: false },
  co60: { title: () => L('⁶⁰Co — референсная дозиметрия', '⁶⁰Co — reference dosimetry'), file: 'cobalt', importData: importCobalt, status: cobaltStatus, tab: 'dosimetry' },
  photons: { title: () => L('МВ фотоны — референсная дозиметрия', 'MV photons — reference dosimetry'), file: 'photons', importData: importPhotons, status: photonsStatus, tab: 'dosimetry' },
  electrons: { title: () => L('Электроны — референсная дозиметрия', 'Electrons — reference dosimetry'), file: 'electrons', importData: importElectrons, status: electronsStatus, tab: 'dosimetry' },
  // kV-рентген — только TRS-398 Rev.1: переключатель протокола в шапке скрыт
  kv: { title: () => L('kV-рентген — референсная дозиметрия', 'kV x-rays — reference dosimetry'), file: 'kv', importData: importKv, status: kvStatus, tab: 'dosimetry', proto: false },
  // брахитерапия (в разработке): листы «Колодезная камера» и «Фантом PTW 9193», адрес #brachy/well, #brachy/phantom
  brachy: { title: () => L('Брахитерапия — сила источника', 'Brachytherapy — source strength'), file: '-', importData: () => {}, status: (t) => brachyStatus(t), tab: 'dosimetry', proto: false },
  // лист «Сеанс» вкладок «МВ фотоны» и «Электроны»: энергии аппарата подряд, каждая — на рабочем листе вкладки
  // (протокол — на рабочем листе); адрес #photons/session, #electrons/session
  session: { title: (kind) => `${kind === 'electron' ? L('Электроны', 'Electrons') : L('МВ фотоны', 'MV photons')} — ${L('сеанс: все энергии', 'session: all energies')}`, file: '-', importData: () => {}, status: (t) => sessionStatus(t), tab: 'dosimetry', proto: false },
  // лист «В пластинах» вкладок пучков: проверка выхода относительно калибровки в воде — не референсные условия;
  // адрес #co60/plates, #photons/plates, #electrons/plates
  plates: { title: (kind) => `${{ cobalt: '⁶⁰Co', electron: L('Электроны', 'Electrons') }[kind] ?? L('МВ фотоны', 'MV photons')} — ${L('проверка выхода в пластинах', 'output check in plates')}`, file: '-', importData: () => {}, status: (t) => platesStatus(t), tab: 'dosimetry', proto: false },
  jaffe: { title: () => L('Инструменты — график Яффе', 'Tools — Jaffé plot'), file: 'jaffe', importData: importJaffe, status: jaffeStatus, tab: 'prep' },
  tools: { title: () => L('Инструменты — перекрёстная калибровка', 'Tools — cross-calibration'), file: 'crosscal', importData: importCrossCal, status: crossCalStatus, tab: 'prep' },
  edepth: { title: () => L('Инструменты — кривая дозы электронов', 'Tools — electron depth dose'), file: 'edepth', importData: importEdepth, status: edepthStatus, tab: 'prep' },
  uncertainty: { title: () => L('Инструменты — неопределённость поглощённой дозы', 'Tools — absorbed dose uncertainty'), file: 'uncertainty', importData: importUncTool, status: uncToolStatus, tab: 'prep' },
  // «Литература»: открывается из подвала и с «Начала»; вкладки в шапке у неё нет, местом работы не запоминается
  refs: { title: () => L('Литература', 'References'), file: '-', importData: () => {}, status: () => {}, tab: 'refs', transient: true, proto: false },
};
const tabOf = (name) => MODULES[name]?.tab ?? name;
/** Подраздел по умолчанию для вкладки в шапке (если с ней ещё не работали). */
const GROUP_DEFAULT = { start: 'start', equipment: 'equipment', dosimetry: 'photons', prep: 'jaffe', history: 'history' };
/** Какой подраздел открыть по щелчку на вкладке в шапке: тот, с которым работали последним (с листом вкладки пучков). */
function moduleForGroup(group) {
  const last = store.get(subKey(group));
  const r = resolveRoute(last);
  if (r && tabOf(r.module) === group) return r.route;
  return GROUP_DEFAULT[group] ?? 'start';
}

// ------------------------------------------------------------ листы вкладок пучков (с 0.63.0)
// «⁶⁰Co»: «В воде» | «В пластинах»; «МВ фотоны» и «Электроны»: «Одна энергия» | «Сеанс: все энергии» | «В пластинах».
// «Одна энергия» и «В воде» — рабочий лист вкладки; «Сеанс» — страница плана, а когда сеанс начат — рабочий лист с
// полосой сеанса (план — #photons/session/plan); «В пластинах» — страница проверки в пластинах для пучков этого вида.
// До 0.63.0 «Сеанс» (#session) и «В пластинах» (#plates) были подвкладками «Дозиметрии»: старые адреса ведут на лист
// вида пучков, с которым работали последним.
const BEAM_TABS = { co60: 'cobalt', photons: 'photon', electrons: 'electron' };
const TAB_OF_KIND = { cobalt: 'co60', photon: 'photons', electron: 'electrons' };
const SESSION_TABS = ['photons', 'electrons'];
// последний открытый лист вкладки пучков: щелчок по подвкладке возвращает к нему
const sheetKey = (tab) => `reference-dosimetry.sheet.${tab}`;

/** Адрес (без #) → { module, owner — вкладка пучков, sheet, kind, route — адрес без старых имён } или null. */
function resolveRoute(raw) {
  let r = String(raw ?? '');
  if (r === 'session') r = `${TAB_OF_KIND[sessionLastKind()] ?? 'photons'}/session`;
  else if (r === 'plates') r = `${TAB_OF_KIND[platesLastKind()] ?? 'photons'}/plates`;
  const [head, sub, sub2] = r.split('/');
  if (head in BEAM_TABS) {
    const kind = BEAM_TABS[head];
    if (sub === 'plates') return { module: 'plates', owner: head, sheet: 'plates', kind, route: `${head}/plates` };
    if (sub === 'session' && SESSION_TABS.includes(head)) {
      if (sub2 === 'plan') return { module: 'session', owner: head, sheet: 'session', kind, route: `${head}/session/plan` };
      return { module: sessionInfo(kind).active ? head : 'session', owner: head, sheet: 'session', kind, route: `${head}/session` };
    }
    return { module: head, owner: head, sheet: 'single', kind, route: head };
  }
  if (!MODULES[head] || head === 'session' || head === 'plates') return null;
  // #kv/timer, #brachy/phantom — подраздел и его лист
  return { module: head, owner: head, sheet: '', kind: '', route: head === 'kv' || head === 'brachy' ? r : head };
}

let route = null;
/** Ярлыки листов вкладки пучков owner; sheet — открытый лист. */
function sheetsHtml(owner, sheet) {
  const kind = BEAM_TABS[owner];
  const items = [[owner, 'single', kind === 'cobalt' ? L('В воде', 'In water') : L('Одна энергия', 'Single energy')]];
  if (SESSION_TABS.includes(owner)) items.push([`${owner}/session`, 'session', L('Сеанс: все энергии', 'Session: all energies')]);
  items.push([`${owner}/plates`, 'plates', L('В пластинах', 'In plates')]);
  return items
    .map(([to, key, text]) => {
      // начатый сеанс — точка и ход на ярлыке
      const s = key === 'session' ? sessionInfo(kind) : null;
      const state = s?.active ? (s.finished ? 'done' : 'warn') : 'none';
      const more = s?.active ? ` · ${s.done} ${L('из', 'of')} ${s.total}` : '';
      return `<a href="#${esc(to)}" data-goto="${esc(to)}" data-state="${state}"${key === sheet ? ' aria-current="page"' : ''}>${esc(text + more)}</a>`;
    })
    .join('');
}
function renderSheets() {
  for (const nav of $$('nav.beam-sheets')) {
    // на страницах «Сеанс» и «В пластинах» — ярлыки той вкладки, из которой их открыли
    const owner = nav.dataset.owner || route?.owner;
    if (!(owner in BEAM_TABS)) continue;
    const html = sheetsHtml(owner, route?.owner === owner ? route.sheet : 'single');
    if (nav.innerHTML !== html) nav.innerHTML = html;
    nav.setAttribute('aria-label', L('Листы вкладки', 'Tab sheets'));
  }
}

const store = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* хранилище недоступно */
    }
  },
};

// ------------------------------------------------------------ тема: как в системе / светлая / тёмная
const THEME_KEY = 'reference-dosimetry.theme';
const THEMES = ['auto', 'light', 'dark'];
let theme = 'auto';
function applyTheme(t) {
  theme = THEMES.includes(t) ? t : 'auto';
  if (theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  const btn = $('#theme-toggle');
  if (!btn) return;
  btn.dataset.state = theme;
  const label = { auto: L('Тема: как в системе', 'Theme: system'), light: L('Тема: светлая', 'Theme: light'), dark: L('Тема: тёмная', 'Theme: dark') }[theme];
  btn.title = `${label}. ${L('Нажмите, чтобы переключить', 'Click to switch')}`;
  btn.setAttribute('aria-label', label);
}
function initTheme() {
  applyTheme(store.get(THEME_KEY));
  $('#theme-toggle')?.addEventListener('click', () => {
    const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    store.set(THEME_KEY, next);
    applyTheme(next);
  });
  document.addEventListener('langchange', () => applyTheme(theme));
}

function showModule(raw) {
  const r = resolveRoute(raw) ?? resolveRoute('start');
  const name = r.module;
  route = r;
  for (const key of Object.keys(MODULES)) $(`#module-${key}`).hidden = key !== name;
  // вкладка в шапке и переключатель подразделов вкладки («Сеанс» и «В пластинах» — листы своей вкладки пучков)
  for (const a of $$('.modules a[data-module]')) {
    if (a.dataset.module === tabOf(name)) {
      a.setAttribute('aria-current', 'page');
      a.setAttribute('aria-controls', `module-${name}`);
    } else a.removeAttribute('aria-current');
  }
  for (const a of $$('.subtools a[data-module]')) {
    if (a.dataset.module === r.owner) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  // полоса сеанса — на рабочем листе, открытом как лист «Сеанс»
  for (const t of SESSION_TABS) setSessionSheet(t, name === t && r.sheet === 'session');
  renderSheets();
  // цвет вида пучка (⁶⁰Co, МВ фотоны, электроны, kV) — у его вкладки и листов «Сеанс», «В пластинах»
  setBeamLook(r.owner);
  setActiveModule(name);
  // переключатель протокола — только там, где он влияет на расчёт (proto: false — «Начало», «Литература», заглушки,
  // «Оборудование» — «не заполнено» по TRS-398 Rev.1; «Журнал и тренды»: записи хранят свой протокол); выбранный протокол при этом не меняется
  const sw = $('.protocol-switch');
  if (sw) sw.hidden = MODULES[name].proto === false;
  document.title = MODULES[name].title(r.kind);
  if (!MODULES[name].transient) {
    store.set(TAB_KEY, r.route);
    store.set(subKey(tabOf(name)), r.route);
    if (r.owner in BEAM_TABS) store.set(sheetKey(r.owner), r.route);
  }
  if (name === 'start') renderStart();
  if (name === 'session') renderSessionPage(r.kind);
  if (name === 'plates') renderPlatesPage(r.kind);
  // kV-рентген: лист из адреса #kv/<лист> или тот, с которым работали
  if (name === 'kv') kvShown();
  if (name === 'brachy') renderBrachy(r.route.split('/')[1]);
  // «Мои камеры» меняются на вкладках дозиметрии: кнопку переноса в журнал обновить при открытии «Оборудования»
  if (name === 'equipment') {
    renderMyChambersTool();
    equipmentShown();
  }
  refreshSectionNav($(`#module-${name}`));
}

/** Адрес в строке браузера — без прокрутки к якорю. */
function setHash(to) {
  try {
    history.replaceState(null, '', `#${to}`);
  } catch {
    /* в некоторых просмотрщиках адрес не меняется — не страшно */
  }
}

/** Переключение по щелчку или по вставленным данным: адрес меняется без прокрутки к якорю. */
function switchTo(to) {
  const r = resolveRoute(to);
  if (!r) to = 'start';
  // #kv/<лист>: лист выбирает сама вкладка kV
  if (location.hash !== `#${to}` && !(to === 'kv' && location.hash.startsWith('#kv/'))) setHash(to);
  showModule(to);
}

/** Адрес из строки браузера; старые #session и #plates (до 0.63.0) заменяются адресом листа. */
function moduleFromHash() {
  const raw = location.hash.replace('#', '');
  const r = resolveRoute(raw);
  if (!r) return null;
  if (raw === 'session' || raw === 'plates') setHash(r.route);
  return r.route;
}

// ------------------------------------------------------------ перенос результата между вкладками
/** Перекрёстная калибровка → раздел «Камера и электрометр» нужной вкладки: подставить значения, открыть вкладку и раздел. */
const TRANSFER = {
  electrons: { apply: (p) => applyElectronsPatch(p), section: '#e-s3', status: (t) => electronsStatus(t), sec: 2 },
  photons: { apply: (p) => applyPhotonsPatch(p), section: '#s2', status: (t) => photonsStatus(t), sec: 2 },
  co60: { apply: (p) => applyCobaltPatch(p), section: '#co-s2', status: (t) => cobaltStatus(t), sec: 2 },
};
function initTransfer() {
  // кривая дозы электронов → вкладка «Электроны»: качество пучка (раздел 3) и пересчёт на z_max (раздел 8)
  setEdepthTransfer((patch) => {
    switchTo('electrons');
    applyElectronsPatch(patch);
    $('#e-s2')?.closest('section')?.scrollIntoView({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    electronsStatus(
      L(
        `Из «Кривой дозы электронов» перенесены ${patch.e_r50_method === 'i50' ? 'R50,ion (I50)' : 'R50'}${patch.e_pdd ? ', PDD(z_ref)' : ''}${patch.e_zmax ? ' и z_max' : ''}; подсвечены заполненные поля.`,
        `Transferred from Electron depth dose: ${patch.e_r50_method === 'i50' ? 'R50,ion (I50)' : 'R50'}${patch.e_pdd ? ', PDD(z_ref)' : ''}${patch.e_zmax ? ' and z_max' : ''}; the filled fields are highlighted.`,
      ),
    );
  });
  setCrossCalTransfer((target, patch) => {
    const t = TRANSFER[target];
    if (!t) return;
    switchTo(target);
    t.apply(patch);
    const sec = $(t.section)?.closest('section');
    sec?.scrollIntoView({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    t.status(
      L(
        `Коэффициент перекрёстной калибровки перенесён в раздел ${t.sec} («Камера и электрометр»); подсвечены заполненные поля. Остальные разделы — для измерений в нужном пучке.`,
        `The cross-calibration coefficient has been transferred to section ${t.sec} (Chamber and electrometer); the filled fields are highlighted. The other sections are for measurements in the beam of interest.`,
      ),
    );
  });
}

// ------------------------------------------------------------ журнал ↔ вкладки дозиметрии
function initJournalBridges() {
  const toTop = () => window.scrollTo({ top: 0 });
  // пучок журнала во вкладке дозиметрии: фотоны, электроны или ⁶⁰Co
  const showInTab = (kind, form, opts, section = '') => {
    const module = { electron: 'electrons', cobalt: 'co60' }[kind] ?? 'photons';
    switchTo(module);
    ({ electrons: showInElectrons, co60: showInCobalt, photons: showInPhotons })[module](form, opts);
    // ссылка «раздел N» из журнала — сразу к этому разделу
    if (section) requestAnimationFrame(() => revealSection(module, section) || toTop());
    else toTop();
  };
  setEquipmentBridge({
    edit: (kind, form, { title, target }) => showInTab(kind, form, { mode: 'edit', title, target }),
  });
  // «Сохранить в журнал» на вкладке дозиметрии (работает и после перезагрузки страницы)
  const saveToJournal = (target, form, title) => {
    const text = saveBeamFromTab(target, form, title);
    switchTo('equipment');
    revealBeam(target?.beamId);
    equipmentStatus(text);
  };
  setPhotonsJournalSave((target, form, title) => saveToJournal({ kind: 'photon', ...target }, form, title));
  setElectronsJournalSave((target, form, title) => saveToJournal({ ...target, kind: 'electron' }, form, title));
  setCobaltJournalSave((target, form, title) => saveToJournal({ ...target, kind: 'cobalt' }, form, title));
  setHistoryBridge({
    // записанный пучок — во вкладке дозиметрии со всеми поправками (просмотр)
    openInTab: (kind, form, title) => showInTab(kind, form, { mode: 'view', title }),
    // запись журнала kV — во вкладке «kV-рентген» со всеми листами (прежние данные вкладки возвращаются с плашки)
    openKv: (file, title) => {
      switchTo('kv');
      showKvRecord(file, title);
      toTop();
    },
    // оценка стабильности дозиметра по проверкам второй камерой — в бюджет неопределённости
    toBudget: (u, text) => {
      switchTo('uncertainty');
      applyStability(u, text);
      requestAnimationFrame(() => document.getElementById('unc-budget')?.scrollIntoView({ block: 'start' }));
    },
  });
}

// ------------------------------------------------------------ «как проводить и как считается» в инструментах
// Блок раскрыт по умолчанию; если его свернуть, в этом браузере он останется свёрнутым.
function initHowto() {
  for (const d of $$('details.howto[data-howto]')) {
    const key = `reference-dosimetry.howto.${d.dataset.howto}`;
    if (store.get(key) === 'closed') d.open = false;
    d.addEventListener('toggle', () => store.set(key, d.open ? 'open' : 'closed'));
  }
}

// ------------------------------------------------------------ справки
function openTerm(key) {
  const t = (getLang() === 'en' && TERMS_EN[key]) || TERMS[key];
  if (!t) return;
  $('#term-title').innerHTML = t.title;
  $('#term-body').innerHTML = t.html;
  const dlg = $('#term-dialog');
  if (typeof dlg.showModal === 'function') dlg.showModal();
  else dlg.setAttribute('open', '');
  $('#term-body').scrollTop = 0;
}

function initTerms() {
  document.addEventListener('click', (e) => {
    const term = e.target.closest('.term');
    if (term) {
      e.preventDefault();
      openTerm(term.dataset.term);
    }
  });
  const dlg = $('#term-dialog');
  $('#term-close').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) dlg.close();
  });
}

// ------------------------------------------------------------ протокол
function initProtocol() {
  let saved = store.get(PROTOCOL_KEY);
  if (!saved) {
    // раньше протокол хранился в черновике фотонов
    try {
      saved = JSON.parse(store.get('reference-dosimetry.photons.v2') || 'null')?.protocol ?? null;
    } catch {
      saved = null;
    }
  }
  // значение — из хранилища или старого черновика: по id, а не селектором (строка с кавычками ломала querySelector)
  if (typeof saved === 'string' && document.getElementById(`protocol_${saved}`)?.name === 'protocol') applyProtocol(saved);
  // TG-51 — только справочное сравнение: при его выборе в шапке видна пометка
  const note = $('#protocol-note');
  const showNote = () => note && (note.hidden = currentProtocol() !== 'tg51');
  showNote();
  document.addEventListener('change', (e) => {
    if (e.target.name !== 'protocol') return;
    store.set(PROTOCOL_KEY, e.target.value);
    showNote();
  });
}

// ------------------------------------------------------------ десятичный разделитель
// Число, введённое с точкой в русском интерфейсе (или с запятой в английском), после ввода приводится
// к разделителю языка: так оно выглядит в протоколе и PDF как остальные. Значение при этом не меняется.
function initDecimals() {
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement) || !el.matches('input.num')) return;
    if (localizeDecimal(el)) el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

// ------------------------------------------------------------ вставка данных из буфера
function initPaste() {
  document.addEventListener('paste', (e) => {
    if (e.target.closest('input, textarea, select')) return;
    const text = e.clipboardData?.getData('text');
    if (!text || !text.includes('"reference-dosimetry"')) return;
    let obj;
    try {
      obj = JSON.parse(text);
    } catch {
      MODULES[getActiveModule()].status(L('В буфере обмена повреждённые данные.', 'The clipboard data are damaged.'));
      return;
    }
    const target = Object.keys(MODULES).find((k) => MODULES[k].file === obj?.module);
    if (!target) {
      MODULES[getActiveModule()].status(L('Эти данные не относятся ни к одному разделу калькулятора.', 'These data do not belong to any section of the calculator.'));
      return;
    }
    if (target !== getActiveModule()) switchTo(target);
    try {
      MODULES[target].importData(obj);
      MODULES[target].status(L('Данные вставлены из буфера обмена.', 'Data pasted from the clipboard.'));
    } catch (err) {
      MODULES[target].status(err.message);
    }
  });
}

// ------------------------------------------------------------ язык
function initLang() {
  // язык задаётся до первого расчёта, чтобы модули сразу вывели текст на нём
  setLang(initialLang());
  document.documentElement.lang = getLang();
  const r = document.getElementById(`lang_${getLang()}`);
  if (r) r.checked = true;
  document.addEventListener('change', (e) => {
    if (e.target.name !== 'lang') return;
    saveLang(e.target.value);
    applyLang(e.target.value);
    document.title = MODULES[getActiveModule()].title();
  });
}

function init() {
  initLang();
  initTheme();
  initLook();
  initProtocol();
  initTerms();
  setupHoverPop();
  initHowto();
  // журнал — до вкладок: вкладки при запуске считаются по журналу (kV — связь с аппаратом, база из калибровки), а
  // загрузка черновика журнала их не оповещает
  initJournalStore();
  // сотрудники отделения из «Оборудования» — первыми в списке у полей сотрудников всех вкладок
  setListSource('staff', () => staffNames(getJournal()));
  initCobalt();
  initPhotons();
  initElectrons();
  initKv();
  initCrossCal();
  initUncTool();
  initJaffe();
  initEdepth();
  initEquipment();
  initHistory();
  initJournalBridges();
  initPwa();
  initStart();
  // камеры и электрометры журнала на вкладках дозиметрии (раздел 2 «Камера и электрометр»)
  initTabEquipment([
    { kind: 'cobalt', module: 'co60', box: '#co-jlink', select: '#co_ch_model', read: cobaltCurrentForm, patch: applyCobaltPatch, status: cobaltStatus, demo: () => !$('#co-demo-flag').hidden, blank: () => ({ ...CO_DEFAULTS, co_date: today() }) },
    { kind: 'photon', module: 'photons', box: '#ph-jlink', select: '#ch_model', read: photonsCurrentForm, patch: applyPhotonsPatch, status: photonsStatus, demo: () => !$('#demo-flag').hidden, blank: () => ({ ...FORM_DEFAULTS, meta_date: today() }) },
    { kind: 'electron', module: 'electrons', box: '#e-jlink', select: '#e_ch_model', read: electronsCurrentForm, patch: applyElectronsPatch, status: electronsStatus, demo: () => !$('#e-demo-flag').hidden, blank: () => ({ ...E_DEFAULTS, e_date: today() }) },
  ]);
  const tabJournals = initTabJournal([
    { kind: 'cobalt', module: 'co60', bind: '#co-jbind', rec: '#co-jrec', check: '#co-jcheck', read: cobaltCurrentForm, patch: applyCobaltPatch, status: cobaltStatus, demo: () => !$('#co-demo-flag').hidden, blank: () => ({ ...CO_DEFAULTS, co_date: today() }) },
    { kind: 'photon', module: 'photons', bind: '#ph-jbind', rec: '#ph-jrec', check: '#ph-jcheck', prev: '#ph-qprev', read: photonsCurrentForm, patch: applyPhotonsPatch, status: photonsStatus, demo: () => !$('#demo-flag').hidden, blank: () => ({ ...FORM_DEFAULTS, meta_date: today() }) },
    { kind: 'electron', module: 'electrons', bind: '#e-jbind', rec: '#e-jrec', check: '#e-jcheck', read: electronsCurrentForm, patch: applyElectronsPatch, status: electronsStatus, demo: () => !$('#e-demo-flag').hidden, blank: () => ({ ...E_DEFAULTS, e_date: today() }) },
  ]);
  // сеанс: пучок журнала открывается в своей вкладке, «Записать и далее» — запись вкладки в журнал
  initSession({
    open: (kind, machineId, beamId, opts) => {
      switchTo(`${TAB_OF_KIND[kind] ?? 'photons'}/session`);
      tabJournals[kind]?.select(machineId, beamId, opts);
      window.scrollTo({ top: 0 });
    },
    record: (kind) => tabJournals[kind]?.record() ?? false,
    bound: (kind) => tabJournals[kind]?.bound() ?? null,
    go: (name) => goTo(name),
  });
  initPlates();
  initBrachy();
  setUncSources({ co60: cobaltUncSource, photons: photonsUncSource, electrons: electronsUncSource, kv: kvUncSource });
  initTransfer();
  initPaste();
  initDecimals();
  translateStatic(document.body);
  // ячейки, списки и подписи модули отрисовали до перевода статического текста: по-английски перерисовать
  if (getLang() === 'en') document.dispatchEvent(new CustomEvent('langchange', { detail: { lang: 'en' } }));
  initSectionNavs();
  initSecLinks({ go: (name) => switchTo(name) });
  // подразделы, с которыми работали в версиях до 0.12.0 («Инструменты» и «Журнал» в шапке)
  const oldTool = store.get('reference-dosimetry.tool');
  if (!store.get(subKey('prep')) && ['jaffe', 'tools', 'edepth'].includes(oldTool)) store.set(subKey('prep'), oldTool);
  // первое открытие — «Начало»; дальше — то место, где работали в прошлый раз
  const saved = store.get(TAB_KEY);
  showModule(moduleFromHash() ?? (resolveRoute(saved) ? saved : 'start'));
  // ход сеанса — на ярлыке «Сеанс»
  document.addEventListener('sessionchange', renderSheets);
  document.addEventListener('langchange', renderSheets);
  window.addEventListener('hashchange', () => {
    const m = moduleFromHash();
    if (m) {
      showModule(m);
      window.scrollTo({ top: 0 });
    }
  });
  // вкладка в шапке открывает подраздел, с которым работали последним; переключатель подразделов — сам подраздел
  document.addEventListener('click', (e) => {
    const a = e.target.closest('.modules a[data-module], .subtools a[data-module], a[data-goto]');
    if (!a || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault();
    const want = a.dataset.goto || a.dataset.module;
    goTo(a.closest('.modules') ? moduleForGroup(want) : a.closest('.subtools') ? sheetFor(want) : want);
  });
  onJournal(() => {
    if (getActiveModule() === 'start') renderStart();
  });
  onFileState((source) => {
    if (source !== 'autosave' && getActiveModule() === 'start') renderStart();
  });
}

/** Подвкладка «Дозиметрии»: вкладка пучков — с листом, с которым работали последним. */
function sheetFor(tab) {
  if (!(tab in BEAM_TABS)) return tab;
  const r = resolveRoute(store.get(sheetKey(tab)));
  return r?.owner === tab ? r.route : tab;
}

/** Открыть подраздел (адрес) и прокрутить страницу в начало. */
function goTo(to) {
  switchTo(resolveRoute(to) ? to : 'start');
  window.scrollTo({ top: 0 });
}

init();
