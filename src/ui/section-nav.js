// Список разделов слева, как в варианте дизайна «Клиника»: страница остаётся одной длинной формой,
// щелчок по пункту прокручивает к разделу, текущий раздел подсвечивается при прокрутке.
// У каждого пункта — состояние: есть ошибка или предупреждение (по подсветке полей), заполнен, пуст.
// На широком экране список — отдельная колонка слева, на среднем — узкая колонка с номерами,
// на телефоне — выпадающий список из кнопки в нижней строке с результатом.
import { L } from '../core/i18n.js';

const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const navs = [];

/** Видимые разделы модуля по порядку. */
const stepsOf = (s) => [...s.sheet.querySelectorAll(':scope > section.step')].filter((sec) => !sec.hidden);

/** Подпись пункта: data-nav раздела (короткое название) или заголовок раздела без кнопок справок. */
function labelOf(sec) {
  const short = sec.getAttribute('data-nav');
  if (short) return { html: escHtml(short), text: short };
  const h = sec.querySelector('h2');
  if (!h) return { html: '', text: '' };
  const clone = h.cloneNode(true);
  clone.querySelectorAll('button').forEach((b) => b.replaceWith(...b.childNodes));
  return { html: clone.innerHTML.trim(), text: clone.textContent.replace(/\s+/g, ' ').trim() };
}
const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const numberOf = (sec) => sec.querySelector('.step-no')?.textContent.trim() ?? '';

const visible = (el) => el.offsetParent !== null || el.getClientRects().length > 0;

/**
 * Состояние раздела по форме: ошибка / предупреждение (подсвеченные поля и выводы), заполнен, пуст.
 * Раздел без текстовых полей: с выбранными переключателями или списками — заполнен; только с выключенными
 * флажками — не включён; без полей вовсе (график) — результат. Необязательный раздел (data-optional) без
 * введённых значений — «по желанию», а не «не заполнен».
 */
function stateOf(sec) {
  if (sec.classList.contains('inactive')) return 'inactive';
  const flagged = (cls) => [...sec.querySelectorAll(`.${cls}`)].some(visible);
  if (flagged('flag-error')) return 'error';
  if (flagged('flag-warn')) return 'warn';
  const fields = [...sec.querySelectorAll('input[type="text"], input[type="date"], textarea')].filter(visible);
  if (fields.some((f) => f.value.trim() !== '')) return 'done';
  if (!fields.length) {
    const choices = [...sec.querySelectorAll('select, input[type="radio"]')].filter(visible);
    const checks = [...sec.querySelectorAll('input[type="checkbox"]')].filter(visible);
    if (choices.length) return 'done';
    if (checks.length) return checks.some((c) => c.checked) ? 'done' : 'off';
    if (!sec.hasAttribute('data-optional')) return 'output';
  }
  return sec.hasAttribute('data-optional') ? 'optional' : 'empty';
}

const STATE_TEXT = () => ({
  error: L('есть ошибки', 'has errors'),
  warn: L('есть предупреждения', 'has warnings'),
  done: L('заполнен', 'filled in'),
  empty: L('не заполнен', 'not filled in'),
  optional: L('по желанию', 'optional'),
  off: L('не включён', 'turned off'),
  output: L('результат расчёта', 'calculation output'),
  inactive: L('не требуется', 'not required'),
});

const CHECK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5 6.5 11.5 12.5 4.5"/></svg>';

function render(s) {
  const steps = stepsOf(s);
  const items = steps.map((sec) => ({ sec, id: sec.getAttribute('aria-labelledby') || sec.id, no: numberOf(sec), ...labelOf(sec) }));
  const sig = items.map((i) => `${i.id}|${i.no}|${i.text}`).join('\n');
  if (sig !== s.sig) {
    s.sig = sig;
    s.items = items;
    s.list.innerHTML = items
      .map(
        (i, k) => `<li data-k="${k}"><button type="button" class="secnav-item" data-k="${k}" title="${escHtml(`${i.no}. ${i.text}`)}">` +
          `<span class="secnav-no" aria-hidden="true"><span class="n">${escHtml(i.no)}</span>${CHECK}</span>` +
          `<span class="secnav-label">${i.html}</span><span class="visually-hidden secnav-state"></span></button></li>`,
      )
      .join('');
    s.current = -1;
  }
  const texts = STATE_TEXT();
  s.items.forEach((i, k) => {
    const li = s.list.children[k];
    const st = stateOf(i.sec);
    li.dataset.state = st;
    li.querySelector('.secnav-state').textContent = `, ${texts[st]}`;
  });
  spy(s, true);
}

/** Текущий раздел: последний, чей верх прошёл линию в верхней трети окна. */
function spy(s, force = false) {
  if (!s.items?.length || !visible(s.sheet)) return;
  let k = 0;
  if (performance.now() < s.lockUntil) k = s.locked;
  else {
    const line = Math.min(window.innerHeight * 0.3, 260);
    s.items.forEach((i, n) => {
      if (i.sec.getBoundingClientRect().top - line <= 0) k = n;
    });
    const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
    if (atBottom) {
      const last = s.items.length - 1;
      if (s.items[last].sec.getBoundingClientRect().top < window.innerHeight) k = last;
    }
  }
  if (k === s.current && !force) return;
  s.current = k;
  [...s.list.children].forEach((li, n) => {
    const b = li.firstElementChild;
    if (n === k) b.setAttribute('aria-current', 'location');
    else b.removeAttribute('aria-current');
  });
  const i = s.items[k];
  if (i) s.toggleText.textContent = `${i.no}/${numberOf(s.items[s.items.length - 1].sec)}`;
  // на узкой колонке текущий пункт держим в видимой части списка
  const li = s.list.children[k];
  if (li && s.nav.scrollHeight > s.nav.clientHeight + 4) {
    const top = li.offsetTop - s.nav.scrollTop;
    if (top < 0 || top + li.offsetHeight > s.nav.clientHeight) s.nav.scrollTop = li.offsetTop - s.nav.clientHeight / 3;
  }
}

function goTo(s, k) {
  const i = s.items[k];
  if (!i) return;
  setOpen(s, false);
  const smooth = !reduceMotion();
  s.locked = k;
  s.lockUntil = performance.now() + (smooth ? 900 : 100);
  i.sec.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
  const h = i.sec.querySelector('h2');
  if (h) {
    if (!h.hasAttribute('tabindex')) h.setAttribute('tabindex', '-1');
    h.focus({ preventScroll: true });
  }
  spy(s, true);
}

function setOpen(s, open) {
  s.nav.classList.toggle('open', open);
  s.toggle.setAttribute('aria-expanded', String(open));
  if (open) {
    s.nav.scrollTop = 0;
    const cur = s.list.children[s.current]?.firstElementChild;
    cur?.focus({ preventScroll: false });
  }
}

function texts(s) {
  s.nav.setAttribute('aria-label', L('Разделы рабочего листа', 'Worksheet sections'));
  s.title.textContent = L('Разделы', 'Sections');
  s.toggle.setAttribute('aria-label', L('Разделы рабочего листа', 'Worksheet sections'));
  s.toggle.title = L('Перейти к разделу', 'Go to a section');
}

/** Подключает список разделов к модулю (элемент .module с .layout и .sheet внутри). */
export function initSectionNav(module) {
  const layout = module.querySelector('.layout');
  const sheet = module.querySelector('.sheet');
  if (!layout || !sheet) return;
  const nav = document.createElement('nav');
  nav.className = 'secnav';
  nav.id = `${module.id}-secnav`;
  nav.dataset.i18nSkip = '';
  nav.innerHTML = '<p class="secnav-title"></p><ol class="secnav-list"></ol>';
  layout.prepend(nav);

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'secnav-toggle';
  toggle.setAttribute('aria-controls', nav.id);
  toggle.setAttribute('aria-expanded', 'false');
  toggle.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4h11M2.5 8h11M2.5 12h11"/></svg><span></span>';
  module.querySelector('.mobile-result')?.prepend(toggle);

  const s = { module, nav, sheet, list: nav.querySelector('.secnav-list'), title: nav.querySelector('.secnav-title'), toggle, toggleText: toggle.querySelector('span'), sig: '', items: [], current: -1, lockUntil: 0, locked: 0 };
  navs.push(s);
  texts(s);

  nav.addEventListener('click', (e) => {
    const b = e.target.closest('.secnav-item');
    if (b) goTo(s, Number(b.dataset.k));
  });
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(s, !nav.classList.contains('open'));
  });
  document.addEventListener('click', (e) => {
    if (nav.classList.contains('open') && !nav.contains(e.target)) setOpen(s, false);
  });
  nav.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && nav.classList.contains('open')) {
      setOpen(s, false);
      toggle.focus();
    }
  });
  render(s);
}

/** Обновить состояние пунктов (после пересчёта модуля, смены языка или вкладки). */
export function refreshSectionNav(module) {
  for (const s of navs) {
    if (module && s.module !== module) continue;
    if (s.module.hidden) continue;
    render(s);
  }
}

let ticking = false;
function onScroll() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    ticking = false;
    for (const s of navs) if (!s.module.hidden) spy(s);
  });
}

export function initSectionNavs() {
  document.querySelectorAll('.module').forEach((m) => initSectionNav(m));
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  // пересчёт модуля: состояние пунктов (кадром позже — после подсветки полей)
  document.addEventListener('moduleupdate', (e) => requestAnimationFrame(() => refreshSectionNav(e.detail?.root)));
  document.addEventListener('langchange', () => {
    for (const s of navs) {
      texts(s);
      s.sig = '';
    }
    requestAnimationFrame(() => refreshSectionNav());
  });
}
