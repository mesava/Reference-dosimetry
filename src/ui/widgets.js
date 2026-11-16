// Элементы формы: поле со списком сохранённых значений, ячейки показаний, список сотрудников.
import { getList, addToList, removeFromList } from './store.js';
import { L } from '../core/i18n.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function fire(el) {
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

let comboSeq = 0;

// дополнительные значения списка не из браузера: сотрудники из «Оборудования» (журнал отделения) — app.js
const listSources = new Map();
/** Источник значений для списка name: функция без аргументов, возвращает массив строк; они идут первыми. */
export function setListSource(name, fn) {
  listSources.set(name, fn);
}
const fixedValues = (name) => {
  try {
    return (listSources.get(name)?.() ?? []).map((v) => String(v ?? '').trim()).filter(Boolean);
  } catch {
    return [];
  }
};

/**
 * Поле ввода со списком сохранённых значений.
 * Значение попадает в список при подтверждении ввода (событие change); из списка его можно удалить.
 */
export function makeCombo(wrapper, { onPick, openOnFocus = false } = {}) {
  if (wrapper.dataset.ready) return;
  wrapper.dataset.ready = '1';
  const listName = wrapper.dataset.list;
  const input = wrapper.querySelector('input');
  const menu = document.createElement('div');
  menu.className = 'combo-menu';
  menu.setAttribute('role', 'listbox');
  menu.id = `combo-menu-${++comboSeq}`;
  menu.hidden = true;
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'combo-toggle';
  toggle.setAttribute('aria-label', L('Показать сохранённые значения', 'Show saved values'));
  toggle.tabIndex = -1;
  toggle.innerHTML = '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2 4.5 6 8.5 10 4.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
  wrapper.append(toggle, menu);
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('aria-controls', menu.id);
  input.setAttribute('aria-expanded', 'false');

  let active = -1;
  let items = [];
  let currentFilter = '';

  const close = () => {
    menu.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    active = -1;
  };
  const render = (filter) => {
    currentFilter = filter ?? '';
    const fixed = fixedValues(listName);
    const all = [...fixed, ...getList(listName).filter((v) => !fixed.includes(v))];
    const q = (filter ?? '').trim().toLowerCase();
    items = q ? all.filter((v) => v.toLowerCase().includes(q) && v !== input.value) : all;
    if (items.length === 0) {
      menu.innerHTML = q ? '' : `<div class="combo-empty">${L('Список пуст. Введённое значение сохранится автоматически.', 'The list is empty. The value you enter will be saved automatically.')}</div>`;
    } else {
      // значения из «Оборудования» из списка не удаляются (их правят там), у сохранённых в браузере — «×»
      const fixedTip = L('Из «Оборудования», раздел 1', 'From Equipment, section 1');
      menu.innerHTML = items
        .map(
          (v, i) =>
            `<div class="combo-item${i === active ? ' active' : ''}${fixed.includes(v) ? ' fixed' : ''}" role="option" data-i="${i}"><span class="combo-pick">${esc(v)}</span>${
              fixed.includes(v)
                ? `<span class="combo-src" title="${esc(fixedTip)}">${L('отделение', 'department')}</span>`
                : `<button type="button" class="combo-del" data-i="${i}" aria-label="${L(`Удалить «${esc(v)}» из списка`, `Remove “${esc(v)}” from the list`)}" title="${L('Удалить из списка', 'Remove from the list')}">×</button>`
            }</div>`,
        )
        .join('');
    }
    return menu.innerHTML !== '';
  };
  const open = (filter) => {
    // поле только для чтения (во вкладке kV — значение из «Оборудования») список не открывает
    if (input.readOnly || input.disabled) return close();
    if (render(filter)) {
      menu.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    } else close();
  };
  const pick = (i) => {
    const v = items[i];
    if (v === undefined) return;
    input.value = v;
    close();
    fire(input);
    onPick?.(v);
  };

  toggle.addEventListener('mousedown', (e) => e.preventDefault());
  toggle.addEventListener('click', () => {
    if (menu.hidden) {
      active = -1;
      open('');
      input.focus();
    } else close();
  });
  input.addEventListener('input', (e) => {
    if (e.isTrusted) {
      active = -1;
      open(input.value);
    }
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (menu.hidden) {
        active = 0;
        open('');
      } else {
        active = Math.min(active + 1, items.length - 1);
        render(currentFilter);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!menu.hidden) {
        active = Math.max(active - 1, 0);
        render(currentFilter);
      }
    } else if (e.key === 'Enter' && !menu.hidden && active >= 0) {
      e.preventDefault();
      pick(active);
    } else if (e.key === 'Escape') {
      close();
    }
  });
  // поле сотрудника: пустое при входе — сразу список (сотрудники отделения из «Оборудования» и сохранённые)
  if (openOnFocus) {
    input.addEventListener('focus', () => {
      if (!input.value.trim() && menu.hidden) {
        active = -1;
        open('');
      }
    });
  }
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('change', () => addToList(listName, input.value));
  menu.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const del = e.target.closest('.combo-del');
    if (del) {
      removeFromList(listName, items[Number(del.dataset.i)]);
      active = -1;
      open(currentFilter);
      return;
    }
    const row = e.target.closest('.combo-item');
    if (row) pick(Number(row.dataset.i));
  });
}

// ------------------------------------------------------------ ячейки показаний

/** Отрисовывает ячейки показаний в контейнере .cells[data-series]. */
export function renderCells(container, values) {
  const list = container.querySelector('.cells-list');
  const vals = Array.isArray(values) && values.length ? values : ['', '', ''];
  const key = container.dataset.series;
  list.innerHTML = vals
    .map(
      (v, i) =>
        `<input type="text" class="num cell" inputmode="decimal" id="${key}_${i}" aria-label="${esc(container.dataset.label)}, ${L('измерение', 'reading')} ${i + 1}" value="${esc(v)}">`,
    )
    .join('');
  container.querySelector('.cell-remove').disabled = vals.length <= 1;
}

export function readCells(container) {
  return Array.from(container.querySelectorAll('.cell')).map((i) => i.value);
}

export function setupCells(container, onChange) {
  container.querySelector('.cell-add').addEventListener('click', () => {
    const vals = readCells(container);
    vals.push('');
    renderCells(container, vals);
    container.querySelectorAll('.cell')[vals.length - 1].focus();
    onChange();
  });
  container.querySelector('.cell-remove').addEventListener('click', () => {
    const vals = readCells(container);
    if (vals.length <= 1) return;
    vals.pop();
    renderCells(container, vals);
    onChange();
  });
}

// ------------------------------------------------------------ сотрудники

/** Список сотрудников; префикс id полей задаётся атрибутом data-prefix контейнера. */
export function renderStaff(container, values, onChange) {
  const vals = Array.isArray(values) && values.length ? values : [''];
  const prefix = container.dataset.prefix || 'meta_staff';
  container.innerHTML = vals
    .map(
      (v, i) => `<div class="staff-row">
        <div class="combo" data-list="staff"><input type="text" class="staff-input" id="${prefix}_${i}" aria-label="${L('Сотрудник', 'Staff member')} ${i + 1}" value="${esc(v)}"></div>
        ${i > 0 ? `<button type="button" class="icon-btn staff-remove" data-i="${i}" aria-label="${L(`Убрать сотрудника ${i + 1}`, `Remove staff member ${i + 1}`)}" title="${L('Убрать строку', 'Remove row')}">−</button>` : ''}
      </div>`,
    )
    .join('');
  container.querySelectorAll('.combo').forEach((c) => makeCombo(c, { openOnFocus: true }));
  container.querySelectorAll('.staff-remove').forEach((b) =>
    b.addEventListener('click', () => {
      const cur = readStaff(container);
      cur.splice(Number(b.dataset.i), 1);
      renderStaff(container, cur, onChange);
      onChange();
    }),
  );
}

export function readStaff(container) {
  return Array.from(container.querySelectorAll('.staff-input')).map((i) => i.value);
}

// ------------------------------------------------------------ таблица пар (время — показание)

/**
 * Таблица строк из двух чисел. Контейнер: .pairs[data-a][data-b] с .pairs-list внутри
 * и кнопками .pair-add / .pair-remove.
 */
export function renderPairs(container, a, b) {
  const n = Math.max(2, a?.length || 0, b?.length || 0);
  const ka = container.dataset.a;
  const kb = container.dataset.b;
  const la = container.dataset.labelA;
  const lb = container.dataset.labelB;
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push(`<div class="pair-row"><span class="pair-no">${i + 1}</span>
      <input type="text" class="num pair-a" inputmode="decimal" id="${ka}_${i}" aria-label="${esc(la)}, ${L('облучение', 'irradiation')} ${i + 1}" value="${esc(a?.[i] ?? '')}">
      <input type="text" class="num pair-b" inputmode="decimal" id="${kb}_${i}" aria-label="${esc(lb)}, ${L('облучение', 'irradiation')} ${i + 1}" value="${esc(b?.[i] ?? '')}"></div>`);
  }
  container.querySelector('.pairs-list').innerHTML = rows.join('');
  container.querySelector('.pair-remove').disabled = n <= 2;
}

export function readPairs(container) {
  return {
    a: Array.from(container.querySelectorAll('.pair-a')).map((i) => i.value),
    b: Array.from(container.querySelectorAll('.pair-b')).map((i) => i.value),
  };
}

export function setupPairs(container, onChange) {
  container.querySelector('.pair-add').addEventListener('click', () => {
    const { a, b } = readPairs(container);
    a.push('');
    b.push('');
    renderPairs(container, a, b);
    container.querySelectorAll('.pair-a')[a.length - 1].focus();
    onChange();
  });
  container.querySelector('.pair-remove').addEventListener('click', () => {
    const { a, b } = readPairs(container);
    if (a.length <= 2) return;
    a.pop();
    b.pop();
    renderPairs(container, a, b);
    onChange();
  });
}

// ------------------------------------------------------------ всплывающая подсказка с разметкой
// У элемента data-pop — HTML подсказки (собирается кодом, пользовательский текст экранирован). Окно одно на страницу и
// стоит в position: fixed, поэтому прокрутка таблиц его не обрезает. Мышь — по наведению, клавиатура — по фокусу,
// касание — по нажатию (повторное нажатие или касание вне элемента — закрыть).
let popEl = null;
let popFor = null;

function placePop(el) {
  const r = el.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  popEl.style.left = '0px';
  popEl.style.top = '0px';
  const w = popEl.offsetWidth;
  const h = popEl.offsetHeight;
  const left = Math.max(8, Math.min(r.left, vw - w - 8));
  const below = r.bottom + 6;
  const top = below + h <= vh - 8 || r.top - h - 6 < 8 ? Math.min(below, Math.max(8, vh - h - 8)) : r.top - h - 6;
  popEl.style.left = `${left}px`;
  popEl.style.top = `${top}px`;
}

function showPop(el) {
  if (!el.dataset.pop) return;
  popFor = el;
  popEl.innerHTML = el.dataset.pop;
  popEl.hidden = false;
  placePop(el);
}

function hidePop() {
  popFor = null;
  if (popEl) popEl.hidden = true;
}

export function setupHoverPop() {
  if (popEl) return;
  popEl = document.createElement('div');
  popEl.className = 'hover-pop';
  popEl.id = 'hover-pop';
  popEl.setAttribute('role', 'tooltip');
  popEl.setAttribute('data-i18n-skip', '');
  popEl.hidden = true;
  document.body.append(popEl);
  const target = (e) => e.target?.closest?.('[data-pop]');
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const el = target(e);
    if (el && el !== popFor) showPop(el);
  });
  document.addEventListener('pointerout', (e) => {
    if (e.pointerType === 'touch' || !popFor) return;
    if (target(e) === popFor && !popFor.contains(e.relatedTarget)) hidePop();
  });
  let touch = false;
  document.addEventListener('pointerdown', (e) => { touch = e.pointerType === 'touch'; });
  document.addEventListener('click', (e) => {
    if (!touch) return;
    const el = target(e);
    if (el && el !== popFor) showPop(el);
    else hidePop();
  });
  document.addEventListener('focusin', (e) => {
    const el = target(e);
    if (el && !touch) showPop(el);
  });
  document.addEventListener('focusout', (e) => {
    if (!touch && target(e) === popFor) hidePop();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hidePop(); });
  // прокрутка: окно идёт за элементом, ушедшим из виду — закрывается
  window.addEventListener('scroll', () => {
    if (!popFor) return;
    const r = popFor.getBoundingClientRect();
    if (!popFor.isConnected || r.bottom < 0 || r.top > document.documentElement.clientHeight || r.width === 0) hidePop();
    else placePop(popFor);
  }, { capture: true, passive: true });
  window.addEventListener('resize', hidePop);
}
