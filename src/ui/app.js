// Точка входа: язык, вкладки разделов, общий переключатель протокола, справки, вставка данных из буфера.
import { TERMS } from './terms.js';
import { TERMS_EN } from './terms-en.js';
import { L, setLang, getLang } from '../core/i18n.js';
import { initialLang, saveLang, applyLang, translateStatic, localizeDecimal } from './i18n.js';
import { $, $$, setActiveModule, getActiveModule, PROTOCOL_KEY, applyProtocol } from './common.js';
import { initCobalt, importCobalt, cobaltStatus, applyCobaltPatch, cobaltUncSource, cobaltCurrentForm, showInCobalt, setCobaltJournalSave } from './cobalt-ui.js';
import { initPhotons, importPhotons, photonsStatus, applyPhotonsPatch, photonsUncSource, photonsCurrentForm, showInPhotons, setPhotonsJournalSave } from './photons-ui.js';
import { initElectrons, importElectrons, electronsStatus, applyElectronsPatch, electronsUncSource, electronsCurrentForm, showInElectrons, setElectronsJournalSave } from './electrons-ui.js';
import { initCrossCal, importCrossCal, crossCalStatus, setCrossCalTransfer } from './crosscal-ui.js';
import { initUncTool, importUncTool, uncToolStatus, setUncSources } from './uncertainty-tool-ui.js';
import { initJaffe, importJaffe, jaffeStatus } from './jaffe-ui.js';
import { initEdepth, importEdepth, edepthStatus, setEdepthTransfer } from './edepth-ui.js';
import { initSectionNavs, refreshSectionNav } from './section-nav.js';
import { initJournalStore, importJournalObject, getJournal, onJournal } from './journal-store.js';
import { initStart, renderStart } from './start-ui.js';
import { initSecLinks, revealSection } from './sec-links.js';
import { initTabEquipment } from './tab-equipment-ui.js';
import { initSession, sessionStatus, setSessionBridge, loadSession, sessionUnsaved } from './journal-session-ui.js';
import { initEquipment, equipmentStatus, setEquipmentBridge, saveBeamFromTab, revealBeam, renderMyChambersTool } from './journal-equipment-ui.js';
import { initHistory, historyStatus, setHistoryBridge } from './journal-history-ui.js';

const TAB_KEY = 'reference-dosimetry.tab';
// последний открытый подраздел вкладки в шапке («Дозиметрия», «Камера и пучок», «Журнал»)
const subKey = (group) => `reference-dosimetry.sub.${group}`;
// tab — вкладка в шапке, к которой относится модуль. Адреса модулей (#photons, #tools, #session…) прежние: так открываются
// старые ссылки и закладки. Подразделы перечислены в порядке работы.
const MODULES = {
  start: { title: () => L('Референсная дозиметрия', 'Reference dosimetry'), file: '-', importData: () => {}, status: (t) => { $('#start-status').textContent = t; }, tab: 'start' },
  equipment: { title: () => L('Журнал — оборудование', 'Journal — equipment'), file: '-', importData: () => {}, status: (t) => equipmentStatus(t), tab: 'journal' },
  session: { title: () => L('Журнал — сеанс на весь аппарат', 'Journal — whole-machine session'), file: 'journal', importData: (obj) => importJournalObject(obj), status: (t) => sessionStatus(t), tab: 'journal' },
  history: { title: () => L('Журнал — сеансы и тренды', 'Journal — sessions and trends'), file: '-', importData: () => {}, status: (t) => historyStatus(t), tab: 'journal' },
  co60: { title: () => L('⁶⁰Co — референсная дозиметрия', '⁶⁰Co — reference dosimetry'), file: 'cobalt', importData: importCobalt, status: cobaltStatus, tab: 'dosimetry' },
  photons: { title: () => L('МВ фотоны — референсная дозиметрия', 'MV photons — reference dosimetry'), file: 'photons', importData: importPhotons, status: photonsStatus, tab: 'dosimetry' },
  electrons: { title: () => L('Электроны — референсная дозиметрия', 'Electrons — reference dosimetry'), file: 'electrons', importData: importElectrons, status: electronsStatus, tab: 'dosimetry' },
  jaffe: { title: () => L('Камера и пучок — график Яффе', 'Chamber and beam — Jaffé plot'), file: 'jaffe', importData: importJaffe, status: jaffeStatus, tab: 'prep' },
  tools: { title: () => L('Камера и пучок — перекрёстная калибровка', 'Chamber and beam — cross-calibration'), file: 'crosscal', importData: importCrossCal, status: crossCalStatus, tab: 'prep' },
  edepth: { title: () => L('Камера и пучок — кривая дозы электронов', 'Chamber and beam — electron depth dose'), file: 'edepth', importData: importEdepth, status: edepthStatus, tab: 'prep' },
  uncertainty: { title: () => L('Неопределённость поглощённой дозы', 'Absorbed dose uncertainty'), file: 'uncertainty', importData: importUncTool, status: uncToolStatus, tab: 'uncertainty' },
};
const tabOf = (name) => MODULES[name]?.tab ?? name;
/** Подраздел по умолчанию для вкладки в шапке (если с ней ещё не работали). */
const GROUP_DEFAULT = { start: 'start', journal: 'session', dosimetry: 'photons', prep: 'jaffe', uncertainty: 'uncertainty' };
/** Журнал пуст (нет ни аппаратов, ни камер): работа с ним начинается с «Оборудования». */
const journalEmpty = () => {
  const j = getJournal();
  return !j.machines.length && !j.chambers.length && !j.electrometers.length;
};
/** Какой подраздел открыть по щелчку на вкладке в шапке: тот, с которым работали последним. */
function moduleForGroup(group) {
  if (group === 'journal' && journalEmpty()) return 'equipment';
  const last = store.get(subKey(group));
  if (last && MODULES[last] && tabOf(last) === group) return last;
  return GROUP_DEFAULT[group] ?? 'start';
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

function showModule(name) {
  if (!MODULES[name]) name = 'start';
  for (const key of Object.keys(MODULES)) $(`#module-${key}`).hidden = key !== name;
  // вкладка в шапке и переключатель подразделов вкладки
  for (const a of $$('.modules a[data-module]')) {
    if (a.dataset.module === tabOf(name)) {
      a.setAttribute('aria-current', 'page');
      a.setAttribute('aria-controls', `module-${name}`);
    } else a.removeAttribute('aria-current');
  }
  for (const a of $$('.subtools a[data-module]')) {
    if (a.dataset.module === name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  setActiveModule(name);
  document.title = MODULES[name].title();
  store.set(TAB_KEY, name);
  store.set(subKey(tabOf(name)), name);
  if (name === 'start') renderStart();
  // «Мои камеры» меняются на вкладках дозиметрии: кнопку переноса в журнал обновить при открытии «Оборудования»
  if (name === 'equipment') renderMyChambersTool();
  refreshSectionNav($(`#module-${name}`));
}

/** Переключение по щелчку или по вставленным данным: адрес меняется без прокрутки к якорю. */
function switchTo(name) {
  if (location.hash !== `#${name}`) {
    try {
      history.replaceState(null, '', `#${name}`);
    } catch {
      /* в некоторых просмотрщиках адрес не меняется — не страшно */
    }
  }
  showModule(name);
}

function moduleFromHash() {
  const h = location.hash.replace('#', '');
  return MODULES[h] ? h : null;
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
    current: (kind) => (kind === 'electron' ? electronsCurrentForm() : kind === 'cobalt' ? cobaltCurrentForm() : photonsCurrentForm()),
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
  setSessionBridge({
    openInTab: (kind, form, title, section = '') => showInTab(kind, form, { mode: 'view', title }, section),
    openEquipment: (beamId) => {
      switchTo('equipment');
      revealBeam(beamId);
    },
  });
  setHistoryBridge({
    unsaved: () => sessionUnsaved(),
    openSession: (s) => {
      switchTo('session');
      loadSession(s);
      toTop();
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
  if (saved && $(`#protocol_${saved}`)) applyProtocol(saved);
  document.addEventListener('change', (e) => {
    if (e.target.name === 'protocol') store.set(PROTOCOL_KEY, e.target.value);
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
  initProtocol();
  initTerms();
  initHowto();
  initCobalt();
  initPhotons();
  initElectrons();
  initCrossCal();
  initUncTool();
  initJaffe();
  initEdepth();
  initJournalStore();
  initSession();
  initEquipment();
  initHistory();
  initJournalBridges();
  initStart();
  // камеры и электрометры журнала на вкладках дозиметрии (раздел 2 «Камера и электрометр»)
  initTabEquipment([
    { kind: 'cobalt', module: 'co60', box: '#co-jlink', read: cobaltCurrentForm, patch: applyCobaltPatch, status: cobaltStatus, demo: () => !$('#co-demo-flag').hidden },
    { kind: 'photon', module: 'photons', box: '#ph-jlink', read: photonsCurrentForm, patch: applyPhotonsPatch, status: photonsStatus, demo: () => !$('#demo-flag').hidden },
    { kind: 'electron', module: 'electrons', box: '#e-jlink', read: electronsCurrentForm, patch: applyElectronsPatch, status: electronsStatus, demo: () => !$('#e-demo-flag').hidden },
  ]);
  setUncSources({ co60: cobaltUncSource, photons: photonsUncSource, electrons: electronsUncSource });
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
  const oldJournal = store.get('reference-dosimetry.journal-sub');
  if (!store.get(subKey('journal')) && MODULES[oldJournal]) store.set(subKey('journal'), oldJournal);
  // первое открытие — «Начало»; дальше — то место, где работали в прошлый раз
  const saved = store.get(TAB_KEY);
  showModule(moduleFromHash() ?? (MODULES[saved] ? saved : 'start'));
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
    goTo(a.closest('.modules') ? moduleForGroup(want) : want);
  });
  onJournal(() => {
    if (getActiveModule() === 'start') renderStart();
  });
}

/** Открыть подраздел и прокрутить страницу в начало. */
function goTo(name) {
  switchTo(MODULES[name] ? name : 'start');
  window.scrollTo({ top: 0 });
}

init();
