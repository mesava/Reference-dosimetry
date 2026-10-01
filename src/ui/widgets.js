// Элементы формы: поле со списком сохранённых значений, ячейки показаний, список сотрудников.
import { getList, addToList, removeFromList } from './store.js';
import { L } from '../core/i18n.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function fire(el) {
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

let comboSeq = 0;

/**
 * Поле ввода со списком сохранённых значений.
 * Значение попадает в список при подтверждении ввода (событие change); из списка его можно удалить.
 */
export function makeCombo(wrapper, { onPick } = {}) {
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
    const all = getList(listName);
    const q = (filter ?? '').trim().toLowerCase();
    items = q ? all.filter((v) => v.toLowerCase().includes(q) && v !== input.value) : all;
    if (items.length === 0) {
      menu.innerHTML = q ? '' : `<div class="combo-empty">${L('Список пуст. Введённое значение сохранится автоматически.', 'The list is empty. The value you enter will be saved automatically.')}</div>`;
    } else {
      menu.innerHTML = items
        .map(
          (v, i) =>
            `<div class="combo-item${i === active ? ' active' : ''}" role="option" data-i="${i}"><span class="combo-pick">${esc(v)}</span><button type="button" class="combo-del" data-i="${i}" aria-label="${L(`Удалить «${esc(v)}» из списка`, `Remove “${esc(v)}” from the list`)}" title="${L('Удалить из списка', 'Remove from the list')}">×</button></div>`,
        )
        .join('');
    }
    return menu.innerHTML !== '';
  };
  const open = (filter) => {
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
  container.querySelectorAll('.combo').forEach((c) => makeCombo(c));
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
