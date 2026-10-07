// Точка входа: язык, вкладки разделов, общий переключатель протокола, справки, вставка данных из буфера.
import { TERMS } from './terms.js';
import { TERMS_EN } from './terms-en.js';
import { L, setLang, getLang } from '../core/i18n.js';
import { initialLang, saveLang, applyLang, translateStatic, localizeDecimal } from './i18n.js';
import { $, $$, setActiveModule, getActiveModule, PROTOCOL_KEY, applyProtocol } from './common.js';
import { initCobalt, importCobalt, cobaltStatus, applyCobaltPatch, cobaltUncSource } from './cobalt-ui.js';
import { initPhotons, importPhotons, photonsStatus, applyPhotonsPatch, photonsUncSource } from './photons-ui.js';
import { initElectrons, importElectrons, electronsStatus, applyElectronsPatch, electronsUncSource } from './electrons-ui.js';
import { initCrossCal, importCrossCal, crossCalStatus, setCrossCalTransfer } from './crosscal-ui.js';
import { initUncTool, importUncTool, uncToolStatus, setUncSources } from './uncertainty-tool-ui.js';
import { initSectionNavs, refreshSectionNav } from './section-nav.js';

const TAB_KEY = 'reference-dosimetry.tab';
const TOOL_KEY = 'reference-dosimetry.tool'; // последний открытый подраздел «Инструментов»
// tab — вкладка в шапке, к которой относится модуль (подразделы «Инструментов» — к вкладке tools)
const MODULES = {
  co60: { title: () => L('⁶⁰Co — референсная дозиметрия', '⁶⁰Co — reference dosimetry'), file: 'cobalt', importData: importCobalt, status: cobaltStatus },
  photons: { title: () => L('МВ фотоны — референсная дозиметрия', 'MV photons — reference dosimetry'), file: 'photons', importData: importPhotons, status: photonsStatus },
  electrons: { title: () => L('Электроны — референсная дозиметрия', 'Electrons — reference dosimetry'), file: 'electrons', importData: importElectrons, status: electronsStatus },
  tools: { title: () => L('Инструменты — перекрёстная калибровка', 'Tools — cross-calibration'), file: 'crosscal', importData: importCrossCal, status: crossCalStatus, tab: 'tools' },
  uncertainty: { title: () => L('Инструменты — неопределённость', 'Tools — uncertainty'), file: 'uncertainty', importData: importUncTool, status: uncToolStatus, tab: 'tools' },
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
  initCobalt();
  initPhotons();
  initElectrons();
  initCrossCal();
  initUncTool();
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
      // «Инструменты» в шапке открывают подраздел, с которым работали последним
      const top = a.closest('.modules') && a.dataset.module === 'tools';
      const last = store.get(TOOL_KEY);
      switchTo(top && MODULES[last] && tabOf(last) === 'tools' ? last : a.dataset.module);
      window.scrollTo({ top: 0 });
    });
  }
}

init();
