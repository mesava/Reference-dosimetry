// Точка входа: язык, вкладки разделов, общий переключатель протокола, справки, вставка данных из буфера.
import { TERMS } from './terms.js';
import { TERMS_EN } from './terms-en.js';
import { L, setLang, getLang } from '../core/i18n.js';
import { initialLang, saveLang, applyLang, translateStatic, localizeDecimal } from './i18n.js';
import { $, $$, setActiveModule, getActiveModule, PROTOCOL_KEY, applyProtocol } from './common.js';
import { initCobalt, importCobalt, cobaltStatus, applyCobaltPatch, cobaltUncSource } from './cobalt-ui.js';
import { initPhotons, importPhotons, photonsStatus, applyPhotonsPatch, photonsUncSource, photonsCurrentForm, showInPhotons, setPhotonsJournalSave } from './photons-ui.js';
import { initElectrons, importElectrons, electronsStatus, applyElectronsPatch, electronsUncSource } from './electrons-ui.js';
import { initCrossCal, importCrossCal, crossCalStatus, setCrossCalTransfer } from './crosscal-ui.js';
import { initUncTool, importUncTool, uncToolStatus, setUncSources } from './uncertainty-tool-ui.js';
import { initJaffe, importJaffe, jaffeStatus } from './jaffe-ui.js';
import { initEdepth, importEdepth, edepthStatus, setEdepthTransfer } from './edepth-ui.js';
import { initSectionNavs, refreshSectionNav } from './section-nav.js';
import { initJournalStore, importJournalObject } from './journal-store.js';
import { initSession, sessionStatus, setSessionBridge, loadSession, sessionUnsaved } from './journal-session-ui.js';
import { initEquipment, equipmentStatus, setEquipmentBridge, saveBeamFromTab, revealBeam } from './journal-equipment-ui.js';
import { initHistory, historyStatus, setHistoryBridge } from './journal-history-ui.js';

const TAB_KEY = 'reference-dosimetry.tab';
const TOOL_KEY = 'reference-dosimetry.tool'; // последний открытый подраздел «Инструментов»
const JOURNAL_SUB_KEY = 'reference-dosimetry.journal-sub'; // последний открытый подраздел «Журнала»
// tab — вкладка в шапке, к которой относится модуль (подразделы «Инструментов» — к вкладке tools)
const MODULES = {
  co60: { title: () => L('⁶⁰Co — референсная дозиметрия', '⁶⁰Co — reference dosimetry'), file: 'cobalt', importData: importCobalt, status: cobaltStatus },
  photons: { title: () => L('МВ фотоны — референсная дозиметрия', 'MV photons — reference dosimetry'), file: 'photons', importData: importPhotons, status: photonsStatus },
  electrons: { title: () => L('Электроны — референсная дозиметрия', 'Electrons — reference dosimetry'), file: 'electrons', importData: importElectrons, status: electronsStatus },
  tools: { title: () => L('Инструменты — перекрёстная калибровка', 'Tools — cross-calibration'), file: 'crosscal', importData: importCrossCal, status: crossCalStatus, tab: 'tools' },
  uncertainty: { title: () => L('Инструменты — неопределённость', 'Tools — uncertainty'), file: 'uncertainty', importData: importUncTool, status: uncToolStatus, tab: 'tools' },
  jaffe: { title: () => L('Инструменты — график Яффе', 'Tools — Jaffé plot'), file: 'jaffe', importData: importJaffe, status: jaffeStatus, tab: 'tools' },
  edepth: { title: () => L('Инструменты — кривая дозы электронов', 'Tools — electron depth dose'), file: 'edepth', importData: importEdepth, status: edepthStatus, tab: 'tools' },
  session: { title: () => L('Журнал — сеанс на весь аппарат', 'Journal — whole-machine session'), file: 'journal', importData: (obj) => importJournalObject(obj), status: (t) => sessionStatus(t), tab: 'journal' },
  equipment: { title: () => L('Журнал — оборудование', 'Journal — equipment'), file: '-', importData: () => {}, status: (t) => equipmentStatus(t), tab: 'journal' },
  history: { title: () => L('Журнал — сеансы и тренды', 'Journal — sessions and trends'), file: '-', importData: () => {}, status: (t) => historyStatus(t), tab: 'journal' },
};
const tabOf = (name) => MODULES[name]?.tab ?? name;

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
  if (!MODULES[name]) name = 'co60';
  for (const key of Object.keys(MODULES)) $(`#module-${key}`).hidden = key !== name;
  // вкладка в шапке и переключатель подразделов «Инструментов»
  for (const a of $$('.modules a[data-module]')) {
    if (a.dataset.module === tabOf(name)) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  for (const a of $$('.subtools a[data-module]')) {
    if (a.dataset.module === name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  setActiveModule(name);
  document.title = MODULES[name].title();
  store.set(TAB_KEY, name);
  if (tabOf(name) === 'tools') store.set(TOOL_KEY, name);
  if (tabOf(name) === 'journal') store.set(JOURNAL_SUB_KEY, name);
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

// ------------------------------------------------------------ журнал ↔ вкладка «МВ фотоны»
function initJournalBridges() {
  const toTop = () => window.scrollTo({ top: 0 });
  setEquipmentBridge({
    current: () => photonsCurrentForm(),
    edit: (form, { title, target }) => {
      switchTo('photons');
      showInPhotons(form, { mode: 'edit', title, target });
      toTop();
    },
  });
  // «Сохранить в журнал» на вкладке «МВ фотоны» (работает и после перезагрузки страницы)
  setPhotonsJournalSave((target, form, title) => {
    const text = saveBeamFromTab(target, form, title);
    switchTo('equipment');
    revealBeam(target?.beamId);
    equipmentStatus(text);
  });
  setSessionBridge({
    openInPhotons: (form, title) => {
      switchTo('photons');
      showInPhotons(form, { mode: 'view', title });
      toTop();
    },
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
  setUncSources({ co60: cobaltUncSource, photons: photonsUncSource, electrons: electronsUncSource });
  initTransfer();
  initPaste();
  initDecimals();
  translateStatic(document.body);
  // ячейки, списки и подписи модули отрисовали до перевода статического текста: по-английски перерисовать
  if (getLang() === 'en') document.dispatchEvent(new CustomEvent('langchange', { detail: { lang: 'en' } }));
  initSectionNavs();
  showModule(moduleFromHash() ?? store.get(TAB_KEY) ?? 'co60');
  window.addEventListener('hashchange', () => {
    const m = moduleFromHash();
    if (m) {
      showModule(m);
      window.scrollTo({ top: 0 });
    }
  });
  for (const a of $$('.modules a[data-module], .subtools a[data-module]')) {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      // «Инструменты» и «Журнал» в шапке открывают подраздел, с которым работали последним
      const top = a.closest('.modules');
      const want = a.dataset.module;
      const last = top && want === 'tools' ? store.get(TOOL_KEY) : top && want === 'journal' ? store.get(JOURNAL_SUB_KEY) : null;
      const group = want === 'journal' ? 'journal' : 'tools';
      switchTo(last && MODULES[last] && tabOf(last) === group ? last : want === 'journal' ? 'session' : want);
      window.scrollTo({ top: 0 });
    });
  }
}

init();
