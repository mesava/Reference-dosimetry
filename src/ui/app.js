// Точка входа: язык, вкладки разделов, общий переключатель протокола, справки, вставка данных из буфера.
import { TERMS } from './terms.js';
import { TERMS_EN } from './terms-en.js';
import { L, setLang, getLang } from '../core/i18n.js';
import { initialLang, saveLang, applyLang, translateStatic, localizeDecimal } from './i18n.js';
import { $, $$, setActiveModule, getActiveModule, PROTOCOL_KEY, applyProtocol } from './common.js';
import { initCobalt, importCobalt, cobaltStatus } from './cobalt-ui.js';
import { initPhotons, importPhotons, photonsStatus } from './photons-ui.js';
import { initElectrons, importElectrons, electronsStatus } from './electrons-ui.js';

const TAB_KEY = 'reference-dosimetry.tab';
const MODULES = {
  co60: { title: () => L('⁶⁰Co — референсная дозиметрия', '⁶⁰Co — reference dosimetry'), file: 'cobalt', importData: importCobalt, status: cobaltStatus },
  photons: { title: () => L('МВ фотоны — референсная дозиметрия', 'MV photons — reference dosimetry'), file: 'photons', importData: importPhotons, status: photonsStatus },
  electrons: { title: () => L('Электроны — референсная дозиметрия', 'Electrons — reference dosimetry'), file: 'electrons', importData: importElectrons, status: electronsStatus },
};

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
  for (const key of Object.keys(MODULES)) {
    const on = key === name;
    $(`#module-${key}`).hidden = !on;
    const tab = $(`#tab-${key}`);
    if (on) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  setActiveModule(name);
  document.title = MODULES[name].title();
  store.set(TAB_KEY, name);
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
  initPaste();
  initDecimals();
  translateStatic(document.body);
  showModule(moduleFromHash() ?? store.get(TAB_KEY) ?? 'co60');
  window.addEventListener('hashchange', () => {
    const m = moduleFromHash();
    if (m) {
      showModule(m);
      window.scrollTo({ top: 0 });
    }
  });
  for (const a of $$('.modules a[data-module]')) {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      switchTo(a.dataset.module);
      window.scrollTo({ top: 0 });
    });
  }
}

init();
