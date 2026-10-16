// Таблица бюджета неопределённости с полями «Своё» и строки бюджета для протокола текстом
// (вкладка «Неопределённость»).
// Расчёт — в core/uncertainty.js; свои значения строк хранятся в скрытом поле формы (JSON), чтобы
// сохраняться в черновике и файле вместе с остальными полями.
import { L, getLang, refText } from '../core/i18n.js';
import { parseOverrides } from '../core/uncertainty.js';
import { fmt, esc, richText } from './common.js';
import { kiReportLines, setupReportLines } from './unc-ki-ui.js';
import { estHtml, estToggleHtml, updateEst } from './unc-est-ui.js';
import { estimateText } from '../core/unc-est.js';

const num = (v, d = 2) => (Number.isFinite(v) ? fmt(v, d) : '—');

/** Число с двумя значащими цифрами (для ±U в единицах дозы). */
export function fmt2sig(v) {
  if (!Number.isFinite(v) || v === 0) return fmt(v, 2);
  const d = Math.max(0, 1 - Math.floor(Math.log10(Math.abs(v))));
  return fmt(v, d);
}

/** Обозначения величин в подписях: k_Q → k<sub>Q</sub> и т. п. */
const rich = richText;

/**
 * Подключает поле «Своё» к скрытому полю формы: ввод обновляет JSON до того, как событие дойдёт до формы
 * (форма по нему пересчитывает модуль). Кнопка «Очистить свои значения строк» возвращает типовые.
 */
export function setupBudget(box, hidden, notesHidden) {
  box.addEventListener('input', (e) => {
    const inp = e.target.closest?.('input[data-unc-key]');
    if (!inp) return;
    const map = parseOverrides(hidden.value);
    const v = inp.value.trim();
    if (v) map[inp.dataset.uncKey] = v;
    else {
      delete map[inp.dataset.uncKey];
      // без своего значения статус и комментарий не нужны; источник и способ (если заданы) остаются
      if (notesHidden) {
        const notes = parseOverrides(notesHidden.value);
        const n = notes[inp.dataset.uncKey];
        if (n && !n.src && !n.m && !n.doc) delete notes[inp.dataset.uncKey];
        notesHidden.value = Object.keys(notes).length ? JSON.stringify(notes) : '';
      }
    }
    hidden.value = Object.keys(map).length ? JSON.stringify(map) : '';
  });
  box.addEventListener('click', (e) => {
    if (!e.target.closest?.('[data-unc-reset]')) return;
    hidden.value = '';
    // «как получено» строк бюджета — тоже; у раскрытий k_i и установки — свои данные, они остаются
    if (notesHidden) {
      const notes = parseOverrides(notesHidden.value);
      for (const k of Object.keys(notes)) if (!/^(ki|setup)\./.test(k)) delete notes[k];
      notesHidden.value = Object.keys(notes).length ? JSON.stringify(notes) : '';
    }
    for (const inp of box.querySelectorAll('input[data-unc-key]')) inp.value = '';
    hidden.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

// подписи значений для телефонной раскладки (там строки таблицы — карточки без шапки)
const capDef = () => `data-cap="${esc(L('Типовое', 'Typical'))}"`;
const capUsed = () => `data-cap="${esc(L('Принято', 'Used'))}"`;

function typeTag(r) {
  if (r.fromKi || r.fromSetup) return L('раскрыта ниже', 'broken down below');
  if (r.certRow) return L('тип B', 'type B');
  if (r.over) return L('своё', 'yours');
  return r.type === 'A' ? L('тип A', 'type A') : L('тип B', 'type B');
}

function rowHtml(r) {
  // строки, заменённые свидетельством, в расчёт не идут — своего значения у них нет
  const input = r.id && !r.replaced
    ? `<input type="text" class="num unc-in" id="${esc(r.id)}" data-unc-key="${esc(r.key)}" inputmode="decimal" autocomplete="off" placeholder=" " aria-label="${esc(L(`Своё значение, %: ${r.label}`, `Your value, %: ${r.label}`))}">`
    : '';
  // «как получено»: источник, способ расчёта u, статус и комментарий — у строк, где можно ввести своё значение
  const note = r.id && !r.replaced ? `${estToggleHtml(r.key)}${estHtml(r.key, r.label)}` : '';
  return `<tr data-key="${esc(r.key)}" class="${r.replaced ? 'replaced' : ''}">
    <td class="unc-name"><span class="unc-label">${rich(r.label)}</span> <span class="unc-type"></span>
      <span class="unc-how"></span><span class="unc-ref">${esc(refText(r.ref || ''))}</span>${note}</td>
    <td class="v" data-def ${capDef()}></td>
    <td class="unc-own">${input}</td>
    <td class="v" data-used ${capUsed()}></td>
  </tr>`;
}

function fullHtml(b, sectionLabel) {
  const head = `<thead><tr><th>${L('Составляющая', 'Component')}</th><th class="v">${L('Типовое', 'Typical')}</th><th class="unc-own">${L('Своё', 'Yours')}</th><th class="v">${L('Принято', 'Used')}</th></tr></thead>`;
  const body = b.groups
    .map((g, i) => {
      const sub = g.subtotal ? `<tr class="sub" data-sub="${i}"><td>${esc(L(`Суммарная неопределённость: ${g.title.replace(/\.\s.*$/, '').toLowerCase()}`, `Combined uncertainty: ${g.title.replace(/\.\s.*$/, '').toLowerCase()}`))}</td><td class="v" data-def ${capDef()}></td><td></td><td class="v" data-used ${capUsed()}></td></tr>` : '';
      return `<tr class="group"><td colspan="4">${rich(g.title)}</td></tr>${g.rows.map(rowHtml).join('')}${sub}`;
    })
    .join('');
  const totals = `<tr class="total" data-total="uc"><td>${L('Суммарная стандартная неопределённость u<sub>c</sub> (k = 1)', 'Combined standard uncertainty u<sub>c</sub> (k = 1)')}</td><td class="v" data-def ${capDef()}></td><td></td><td class="v" data-used ${capUsed()}></td></tr>
    <tr class="total" data-total="U"><td>${L('Расширенная неопределённость U (k = 2)', 'Expanded uncertainty U (k = 2)')}</td><td class="v" data-def ${capDef()}></td><td></td><td class="v" data-used ${capUsed()}></td></tr>`;
  return `<p class="unc-tpl"><span class="muted">${L('Типовой бюджет:', 'Typical budget:')}</span> <b data-tpl-title></b></p>
    <p class="unc-note" data-tpl-note hidden></p>
    <div class="table-wrap"><table class="factors unc-table" aria-label="${esc(sectionLabel)}">${head}<tbody>${body}${totals}</tbody></table></div>
    <p class="unc-dose" data-dose hidden></p>
    <div class="unc-actions no-print"><button type="button" class="unc-reset" data-unc-reset>${L('Очистить свои значения строк', 'Clear your row values')}</button></div>`;
}

/**
 * Отрисовка бюджета. Таблица пересоздаётся, только когда меняется её состав (образец, строки, язык);
 * иначе обновляются значения — поле, в котором сейчас вводят, не теряет фокус.
 * @param {HTMLElement} box
 * @param {object} b — результат uncertaintyBudget
 * @param {object} o
 * @param {HTMLInputElement} o.hidden — скрытое поле со своими значениями
 * @param {string} [o.doseText] — строка «U в единицах дозы» под таблицей (HTML)
 */
export function renderBudget(box, b, { hidden, notesHidden, doseText = '' }) {
  if (!box || !b) return;
  const over = parseOverrides(hidden?.value);
  const notes = parseOverrides(notesHidden?.value);
  const sig = [getLang(), b.template.id, b.template.situation, b.rows.map((r) => `${r.key}${r.replaced ? '*' : ''}`).join(',')].join('|');
  if (box.dataset.sig !== sig) {
    box.innerHTML = fullHtml(b, L('Бюджет неопределённости', 'Uncertainty budget'));
    box.dataset.sig = sig;
  }
  box.querySelector('[data-tpl-title]').textContent = b.template.title;
  const note = box.querySelector('[data-tpl-note]');
  note.hidden = !b.template.note;
  note.textContent = b.template.note || '';
  const trs = [...box.querySelectorAll('tr[data-key]')];
  b.rows.forEach((r, i) => {
    const tr = trs[i];
    if (!tr) return;
    tr.querySelector('[data-def]').textContent = num(r.def);
    tr.querySelector('[data-used]').textContent = r.replaced ? '—' : num(r.value);
    tr.querySelector('.unc-type').textContent = r.replaced ? L('не учитывается — вместо неё U из свидетельства', 'not used — U from the certificate instead') : typeTag(r);
    tr.querySelector('.unc-how').innerHTML = r.how ? rich(r.how) : '';
    tr.classList.toggle('own', !!r.over);
    tr.classList.toggle('from-a', !!r.fromTypeA);
    const inp = tr.querySelector('input[data-unc-key]');
    if (inp) {
      inp.hidden = !!(r.fromKi || r.fromSetup);
      if (document.activeElement !== inp) inp.value = r.fromKi || r.fromSetup ? '' : (over[r.key] ?? '');
    }
    // строка раскрыта ниже — своего значения и «как получено» у неё нет
    const broken = r.fromKi || r.fromSetup;
    const tg = tr.querySelector('[data-est-toggle]');
    const eb = tr.querySelector('[data-est-box]');
    if (broken) {
      if (tg) tg.hidden = true;
      if (eb) eb.hidden = true;
    } else updateEst(tr, r.key, notes[r.key], { keep: !!r.over });
    if (inp) {
      inp.readOnly = !!r.byMethod;
      inp.classList.toggle('by-method', !!r.byMethod);
      if (r.byMethod && document.activeElement !== inp) inp.value = fmt(r.byMethod.u, 3);
    }
  });
  b.groups.forEach((g, i) => {
    const tr = box.querySelector(`tr[data-sub="${i}"]`);
    if (!tr || !g.subtotal) return;
    tr.querySelector('[data-def]').textContent = num(g.subtotal.def);
    tr.querySelector('[data-used]').textContent = num(g.subtotal.value);
  });
  const uc = box.querySelector('tr[data-total="uc"]');
  uc.querySelector('[data-def]').textContent = num(b.ucDefPct);
  uc.querySelector('[data-used]').textContent = num(b.ucPct);
  const U = box.querySelector('tr[data-total="U"]');
  U.querySelector('[data-def]').textContent = num(b.k * b.ucDefPct);
  U.querySelector('[data-used]').textContent = num(b.UPct);
  const dose = box.querySelector('[data-dose]');
  dose.hidden = !doseText;
  dose.innerHTML = doseText;
}

/** Строка под таблицей бюджета: U в единицах итоговой величины. */
export function budgetDoseText(b, value, unit, where) {
  if (!b || !Number.isFinite(value)) return '';
  const abs = (Math.abs(value) * b.UPct) / 100;
  return L(
    `Для результата ${fmt(value, value >= 10 ? 2 : 4)} ${unit}${where ? ` ${where}` : ''}: U = ±${fmt2sig(abs)} ${unit} (k = 2).`,
    `For the result ${fmt(value, value >= 10 ? 2 : 4)} ${unit}${where ? ` ${where}` : ''}: U = ±${fmt2sig(abs)} ${unit} (k = 2).`,
  );
}

/** Протокол текстом: бюджет построчно и итог. */
export function budgetReportLines(b, value, unit) {
  if (!b) return [];
  const out = [];
  out.push(L(`Неопределённость (типовой бюджет: ${b.template.title}; относительные стандартные неопределённости, %, k = 1):`, `Uncertainty (typical budget: ${b.template.title}; relative standard uncertainties, %, k = 1):`));
  for (const g of b.groups) {
    out.push(`  ${g.title}`);
    for (const r of g.rows) {
      if (r.replaced) continue;
      const tag = r.fromKi ? L(' (раскрыта по поправкам)', ' (broken down by correction)') : r.fromSetup ? L(' (раскрыта по составляющим)', ' (broken down by component)') : r.over ? L(' (своё)', ' (yours)') : r.fromTypeA ? L(' (тип А по серии показаний)', ' (type A from the readings)') : r.fromCert ? L(' (из свидетельства)', ' (from the certificate)') : r.ref ? L(` (типовое: ${refText(r.ref)})`, ` (typical: ${refText(r.ref)})`) : '';
      out.push(`    ${r.label}: ${num(r.value)}${tag}`);
      if (r.over) out.push(`      ${estimateText(r.note, r.value) || L('источник не указан', 'source not given')}`);
      if (r.fromKi && b.ki) out.push(...kiReportLines(b.ki).map((x) => `  ${x}`));
      if (r.fromSetup && b.setup) out.push(...setupReportLines(b.setup).map((x) => `  ${x}`));
    }
    if (g.subtotal) out.push(L(`    Суммарная: ${num(g.subtotal.value)}`, `    Combined: ${num(g.subtotal.value)}`));
  }
  const abs = Number.isFinite(value) ? (Math.abs(value) * b.UPct) / 100 : NaN;
  out.push(
    L(
      `  u_c (k = 1) = ${num(b.ucPct)} %; U (k = 2) = ${fmt(b.UPct, 1)} %${Number.isFinite(abs) ? ` = ±${fmt2sig(abs)} ${unit}` : ''}`,
      `  u_c (k = 1) = ${num(b.ucPct)}%; U (k = 2) = ${fmt(b.UPct, 1)}%${Number.isFinite(abs) ? ` = ±${fmt2sig(abs)} ${unit}` : ''}`,
    ),
  );
  return out;
}
