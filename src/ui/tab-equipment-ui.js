// Камеры и электрометры журнала на вкладках дозиметрии («⁶⁰Co», «МВ фотоны», «Электроны»): строка «Журнал отделения»
// в разделе «Камера и электрометр». Выбор из журнала подставляет поля камеры (электрометра); если камера вкладки есть в
// журнале, видно, совпадают ли её поля с записью журнала, и можно взять значения из журнала или записать их в журнал.
// Сами по себе данные не перезаписываются ни там, ни там. Без камер и электрометров в журнале строки нет.
import { L, getLang } from '../core/i18n.js';
import { NDW_UNITS, unitLabel, isBlank } from '../core/units.js';
import {
  tabEquipment, applyTabEquipment, chamberTabFields, electrometerTabFields, chamberText, electrometerText,
  photonCapable, electronCapable, cobaltCapable, dueStatus,
} from '../core/journal.js';
import { $, esc, today, richText, currentProtocol } from './common.js';
import { getJournal, updateJournal, onJournal } from './journal-store.js';
import { fmtDate } from './journal-common.js';

const CAPABLE = { photon: photonCapable, electron: electronCapable, cobalt: cobaltCapable };

/** Подпись поля для списка отличий (ключ без префикса вкладки). */
function fieldLabel(key) {
  const k = key.replace(/^(ch_|e_|co_|el_)/, '');
  if (/^cc_/.test(k) || /^cc_/.test(key.replace(/^co_/, ''))) return L('параметры своей камеры', 'custom chamber parameters');
  return (
    {
      ndw: 'N_D,w',
      ndw_unit: L('единицы N_D,w', 'N_D,w units'),
      klab: L('k_лаб', 'k_lab'),
      T0: 'T₀',
      P0: 'P₀',
      lab_pol_applied: L('поправка на полярность в лаборатории', 'polarity correction at the laboratory'),
      lab_kpol: L('k_pol лаборатории', 'laboratory k_pol'),
      lab_ks_applied: L('поправка на рекомбинацию в лаборатории', 'recombination correction at the laboratory'),
      lab_ks: L('k_s лаборатории', 'laboratory k_s'),
      cal_route: L('способ калибровки', 'calibration route'),
      cross_ndw: 'N_D,w,Qcross',
      cross_ndw_unit: L('единицы N_D,w,Qcross', 'N_D,w,Qcross units'),
      cross_tpr: L('TPR_20,10 перекрёстной калибровки', 'cross-calibration TPR_20,10'),
      cross_r50: L('R_50 перекрёстной калибровки', 'cross-calibration R_50'),
      cross_kn: '(k_Qecal·N_D,w)pp',
      cross_kn_unit: L('единицы (k_Qecal·N_D,w)pp', '(k_Qecal·N_D,w)pp units'),
      other_name: L('название', 'name'),
      other_type: L('тип', 'type'),
      other_r: L('радиус полости', 'cavity radius'),
      kelec: 'k_elec',
    }[k] ?? k
  );
}

/** Значение поля журнала для подписи: числа — с разделителем языка, флажки — да/нет, единицы — названием. */
function valueText(key, v) {
  if (typeof v === 'boolean') return v ? L('внесена', 'applied') : L('не внесена', 'not applied');
  if (/cal_route$/.test(key)) return v === 'cross' ? L('перекрёстная калибровка', 'cross-calibration') : L('N_D,w в ⁶⁰Co', 'N_D,w in ⁶⁰Co');
  if (/other_type$/.test(key)) return v === 'cyl' ? L('цилиндрическая', 'cylindrical') : L('плоскопараллельная', 'plane-parallel');
  if (/_unit$/.test(key)) return unitLabel(NDW_UNITS[v] || { label: String(v) });
  if (isBlank(v)) return '—';
  const s = String(v);
  return getLang() === 'en' ? s.replace(/(\d),(\d)/g, '$1.$2') : s.replace(/(\d)\.(\d)/g, '$1,$2');
}

/** Отличия: «N_D,w — в журнале 0,05389; k_лаб — в журнале 1,000» (одинаковые подписи cc_* — один раз). */
function diffText(diffs) {
  const seen = new Set();
  const parts = [];
  for (const d of diffs) {
    const label = fieldLabel(d.key);
    if (seen.has(label)) continue;
    seen.add(label);
    parts.push(/параметры своей|custom chamber/.test(label) ? label : L(`${label} — в журнале ${valueText(d.key, d.journal)}`, `${label}: ${valueText(d.key, d.journal)} in the journal`));
  }
  return parts.join('; ');
}

/**
 * Калибровочный коэффициент записи для списка вкладки: «0,05389 Гр/нКл». Способ калибровки у фотонов и электронов свой:
 * при перекрёстной — её коэффициент (у электронов для TG-51 — (k_Qecal·N_D,w)pp); у ⁶⁰Co — всегда N_D,w в ⁶⁰Co.
 */
function ndwText(rec, kind, tg51) {
  const f = rec.form || {};
  let v = f.ch_ndw;
  let unit = f.ch_ndw_unit;
  if (kind === 'photon' && f.ch_cal_route === 'cross') [v, unit] = [f.ch_cross_ndw, f.ch_cross_ndw_unit];
  if (kind === 'electron' && f.e_cal_route === 'cross') [v, unit] = tg51 ? [f.e_cross_kn, f.e_cross_kn_unit] : [f.e_cross_ndw, f.e_cross_ndw_unit];
  if (isBlank(v)) return '';
  return `${valueText('ch_ndw', v)} ${valueText('ch_ndw_unit', unit || 'Gy/nC')}`;
}

/** Срок калибровки записи для подписи: «поверка до …» или «срок калибровки прошёл …». */
function dueText(rec) {
  const s = dueStatus(rec.dueDate, today());
  if (s.status === 'overdue') return L(`срок калибровки прошёл ${fmtDate(rec.dueDate)}`, `calibration overdue since ${fmtDate(rec.dueDate)}`);
  if (s.status === 'soon') return L(`срок калибровки ${fmtDate(rec.dueDate)} — скоро`, `calibration due ${fmtDate(rec.dueDate)}, soon`);
  if (s.status === 'ok') return L(`действует до ${fmtDate(rec.dueDate)}`, `valid until ${fmtDate(rec.dueDate)}`);
  return '';
}

/**
 * Строка «Журнал отделения» на вкладке и группа «Камеры отделения» в начале списка камер вкладки (cfg.select).
 * cfg: { kind, module, box: селектор, select: селектор списка камер вкладки, read() — форма вкладки,
 * patch(поля) — подставить поля во вкладку, status(текст) — строка состояния вкладки, demo() — открыт ли демонстрационный пример }.
 */
function makeLink(cfg) {
  const box = () => $(cfg.box);
  // списки и строки состояния обновляются отдельно и только при изменении: иначе список терял бы фокус и
  // закрывался при каждом пересчёте вкладки (а с клавиатуры можно было бы выбрать только первую запись)
  let lastRow = '';
  let lastSt = '';
  const JRN = 'JRN:';

  /**
   * Группа «Камеры отделения» в начале списка камер вкладки: выбор подставляет запись журнала (модель, №, N_D,w…),
   * и в списке остаётся модель камеры. Список вкладка иногда собирает заново — группа тогда добавляется снова.
   */
  function syncGroup(chambers) {
    const sel = cfg.select ? $(cfg.select) : null;
    if (!sel) return;
    const tg51 = currentProtocol() === 'tg51';
    const html = chambers.length
      ? chambers.map((c) => `<option value="${esc(JRN + c.id)}">${esc([chamberText(c), ndwText(c, cfg.kind, tg51), dueText(c)].filter(Boolean).join(' · '))}</option>`).join('')
      : '';
    let g = sel.querySelector('optgroup[data-jl-group]');
    if (!html) {
      g?.remove();
      return;
    }
    if (!g) {
      g = document.createElement('optgroup');
      g.dataset.jlGroup = '1';
      g.dataset.i18nSkip = '';
      sel.insertBefore(g, sel.firstElementChild?.value === '' ? sel.firstElementChild.nextSibling : sel.firstElementChild);
    }
    g.label = L('Камеры отделения (журнал)', 'Department chambers (journal)');
    if (g.dataset.html !== html) {
      const keep = sel.value;
      g.innerHTML = html;
      g.dataset.html = html;
      sel.value = keep;
    }
  }

  function render() {
    const el = box();
    if (!el) return;
    const j = getJournal();
    const chambers = j.chambers.filter((c) => CAPABLE[cfg.kind](c.form));
    syncGroup(chambers);
    if (!chambers.length && !j.electrometers.length) {
      el.hidden = true;
      el.innerHTML = '';
      lastRow = lastSt = '';
      return;
    }
    const t = tabEquipment(j, cfg.read(), cfg.kind);
    const tg51 = currentProtocol() === 'tg51';
    const pick = (what, list, text) =>
      list.length
        ? `<select data-jl-pick="${what}" aria-label="${esc(what === 'chamber' ? L('Камера из журнала отделения', 'Chamber from the department journal') : L('Электрометр из журнала отделения', 'Electrometer from the department journal'))}"><option value="">${esc(what === 'chamber' ? L('камера из журнала…', 'chamber from the journal…') : L('электрометр из журнала…', 'electrometer from the journal…'))}</option>${list.map((x) => `<option value="${esc(x.id)}">${esc(text(x))}</option>`).join('')}</select>`
        : '';
    const line = (what) => {
      const has = what === 'chamber' ? t.hasChamber : t.hasElectrometer;
      if (!has) return '';
      const rec = what === 'chamber' ? t.chamber : t.electrometer;
      const diffs = what === 'chamber' ? t.chamberDiffs : t.electrometerDiffs;
      const name = what === 'chamber' ? L('Камера', 'Chamber') : L('Электрометр', 'Electrometer');
      if (!rec) {
        // демонстрационный пример вкладки в журнал не предлагаем
        if (cfg.demo?.()) return '';
        return `<p class="jlink-st none">${esc(L(`${name} вкладки в журнале отделения не найден${what === 'chamber' ? 'а' : ''} (по модели и номеру).`, `This ${what === 'chamber' ? 'chamber' : 'electrometer'} was not found in the department journal (by model and serial number).`))} <button type="button" class="link-btn" data-jl-put="${what}">${esc(L('Добавить в журнал', 'Add to the journal'))}</button></p>`;
      }
      const recText = what === 'chamber' ? chamberText(rec) : electrometerText(rec);
      const due = dueText(rec);
      const st = dueStatus(rec.dueDate, today()).status;
      if (diffs.length) {
        return `<p class="jlink-st warn">${richText(L(`${name} ${recText} есть в журнале, но поля отличаются: ${diffText(diffs)}.`, `${name} ${recText} is in the journal, but fields differ: ${diffText(diffs)}.`))} <button type="button" class="link-btn" data-jl-take="${what}">${esc(L('Взять из журнала', 'Take from the journal'))}</button> <button type="button" class="link-btn" data-jl-put="${what}">${esc(L('Записать в журнал', 'Write to the journal'))}</button></p>`;
      }
      return `<p class="jlink-st ${st === 'overdue' || st === 'soon' ? 'warn' : 'ok'}">${richText(L(`${name} ${recText} — как в журнале${due ? `; ${due}` : ''}.`, `${name} ${recText}: as in the journal${due ? `; ${due}` : ''}.`))}</p>`;
    };
    const row = `<span class="jlink-h">${esc(L('Журнал отделения', 'Department journal'))}</span>${pick('chamber', chambers, (c) => [chamberText(c), ndwText(c, cfg.kind, tg51), dueText(c)].filter(Boolean).join(' · '))}${pick('electrometer', j.electrometers, (e) => [electrometerText(e), dueText(e)].filter(Boolean).join(' · '))}`;
    const stHtml = `${line('chamber')}${line('electrometer')}`;
    el.hidden = false;
    if (!el.querySelector('.jlink-row')) {
      el.innerHTML = '<div class="jlink-row"></div><div class="jlink-sts"></div>';
      lastRow = lastSt = '';
    }
    if (row !== lastRow) {
      lastRow = row;
      el.querySelector('.jlink-row').innerHTML = row;
    }
    if (stHtml !== lastSt) {
      lastSt = stHtml;
      el.querySelector('.jlink-sts').innerHTML = stHtml;
    }
    // в списке выбрана запись журнала, которая сейчас на вкладке (по модели и номеру)
    const setPick = (what, rec) => {
      const sel = el.querySelector(`[data-jl-pick="${what}"]`);
      if (sel) sel.value = rec && [...sel.options].some((o) => o.value === rec.id) ? rec.id : '';
    };
    setPick('chamber', t.chamber);
    setPick('electrometer', t.electrometer);
  }

  function take(what, rec) {
    if (!rec) return;
    cfg.patch(what === 'chamber' ? chamberTabFields(rec, cfg.kind) : electrometerTabFields(rec, cfg.kind));
    cfg.status(
      what === 'chamber'
        ? L(`Подставлена камера из журнала: ${chamberText(rec)} (модель, №, калибровочный коэффициент, T₀, P₀, поправки лаборатории); подсвечены изменённые поля.`, `Chamber taken from the journal: ${chamberText(rec)} (model, serial number, calibration coefficient, T₀, P₀, laboratory corrections); the changed fields are highlighted.`)
        : L(`Подставлен электрометр из журнала: ${electrometerText(rec)}.`, `Electrometer taken from the journal: ${electrometerText(rec)}.`),
    );
  }

  function put(what) {
    let res = null;
    updateJournal((j) => {
      res = applyTabEquipment(j, cfg.read(), cfg.kind, { chamber: what === 'chamber', electrometer: what === 'electrometer' });
      return res.journal;
    }, 'tab-equipment');
    const state = what === 'chamber' ? res.chamber : res.electrometer;
    const name = what === 'chamber' ? L('Камера', 'The chamber') : L('Электрометр', 'The electrometer');
    cfg.status(
      state === 'added'
        ? L(`${name} добавлен${what === 'chamber' ? 'а' : ''} в журнал отделения: укажите даты калибровки в «Оборудовании» и сохраните журнал в файл.`, `${name} has been added to the department journal: enter its calibration dates in Equipment and save the journal to the file.`)
        : L(`${name} в журнале обновлен${what === 'chamber' ? 'а' : ''} полями вкладки — для всех пучков, где он${what === 'chamber' ? 'а' : ''} выбран${what === 'chamber' ? 'а' : ''}. Сохраните журнал в файл.`, `${name} in the journal has been updated with the tab fields, for all beams that use it. Save the journal to the file.`),
    );
    render();
  }

  function init() {
    const el = box();
    if (!el) return;
    // выбор камеры отделения в списке камер вкладки: форма вкладки его не видит (значение JRN:… — не модель),
    // вместо этого подставляются поля записи журнала
    const isJrn = (e) => cfg.select && e.target.matches?.(cfg.select) && String(e.target.value).startsWith(JRN);
    document.addEventListener('input', (e) => {
      if (isJrn(e)) e.stopImmediatePropagation();
    }, true);
    document.addEventListener('change', (e) => {
      if (!isJrn(e)) return;
      e.stopImmediatePropagation();
      const id = e.target.value.slice(JRN.length);
      take('chamber', getJournal().chambers.find((c) => c.id === id));
      // если подстановка не сменила значение списка (та же модель) — вернуть модель вкладки
      if (String(e.target.value).startsWith(JRN)) e.target.value = cfg.read()[e.target.id] ?? '';
    }, true);
    // список и кнопки — свои, форма вкладки их не читает: событие дальше не идёт
    el.addEventListener('change', (e) => {
      const sel = e.target.closest('[data-jl-pick]');
      if (!sel) return;
      e.stopPropagation();
      const j = getJournal();
      const list = sel.dataset.jlPick === 'chamber' ? j.chambers : j.electrometers;
      take(sel.dataset.jlPick, list.find((x) => x.id === sel.value));
    });
    el.addEventListener('input', (e) => e.stopPropagation());
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-jl-take], [data-jl-put]');
      if (!b) return;
      e.preventDefault();
      if (b.dataset.jlPut) put(b.dataset.jlPut);
      else {
        const t = tabEquipment(getJournal(), cfg.read(), cfg.kind);
        take(b.dataset.jlTake, b.dataset.jlTake === 'chamber' ? t.chamber : t.electrometer);
      }
    });
    document.addEventListener('moduleupdate', (e) => {
      const root = e.detail?.root;
      if (root && root.id === `module-${cfg.module}`) render();
    });
    onJournal(() => render());
    document.addEventListener('langchange', () => {
      lastRow = lastSt = '';
      render();
    });
    render();
  }
  return { init, render };
}

/** Подключить строку «Журнал отделения» ко вкладкам дозиметрии. */
export function initTabEquipment(list) {
  for (const cfg of list) makeLink(cfg).init();
}
