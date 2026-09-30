// Точка входа: вкладки разделов, общий переключатель протокола, справки, вставка данных из буфера.
import { TERMS } from './terms.js';
import { $, $$, setActiveModule, getActiveModule, PROTOCOL_KEY, applyProtocol } from './common.js';
import { initCobalt, importCobalt, cobaltStatus } from './cobalt-ui.js';
import { initPhotons, importPhotons, photonsStatus } from './photons-ui.js';
import { initElectrons, importElectrons, electronsStatus } from './electrons-ui.js';

const TAB_KEY = 'reference-dosimetry.tab';
const MODULES = {
  co60: { title: '⁶⁰Co — референсная дозиметрия', file: 'cobalt', importData: importCobalt, status: cobaltStatus },
  photons: { title: 'МВ фотоны — референсная дозиметрия', file: 'photons', importData: importPhotons, status: photonsStatus },
  electrons: { title: 'Электроны — референсная дозиметрия', file: 'electrons', importData: importElectrons, status: electronsStatus },
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
  document.title = MODULES[name].title;
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
  const t = TERMS[key];
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
      MODULES[getActiveModule()].status('В буфере обмена повреждённые данные.');
      return;
    }
    const target = Object.keys(MODULES).find((k) => MODULES[k].file === obj?.module);
    if (!target) {
      MODULES[getActiveModule()].status('Эти данные не относятся ни к одному разделу калькулятора.');
      return;
    }
    if (target !== getActiveModule()) switchTo(target);
    try {
      MODULES[target].importData(obj);
      MODULES[target].status('Данные вставлены из буфера обмена.');
    } catch (err) {
      MODULES[target].status(err.message);
    }
  });
}

function init() {
  initProtocol();
  initTerms();
  initCobalt();
  initPhotons();
  initElectrons();
  initPaste();
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
