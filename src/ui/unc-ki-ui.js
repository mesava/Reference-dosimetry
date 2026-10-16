// «Раскрытие k_i» на вкладке «Неопределённость» (TRS-398): таблица поправок с частью «по измерениям» и своей оценкой.
// Расчёт — core/unc-ki.js; данные хранятся в скрытом поле unc_ki (JSON), чтобы сохраняться в черновике и файле.
import { L, getLang, refText } from '../core/i18n.js';
import { parseKi, kiFactors } from '../core/unc-ki.js';
import { fmt, esc, richText } from './common.js';

const num = (v, d = 2) => (Number.isFinite(v) ? fmt(v, d) : '—');
const SRC = { photons: () => L('МВ фотоны', 'MV photons'), electrons: () => L('Электроны', 'Electrons'), co60: () => '⁶⁰Co' };

function write(hidden, fn) {
  const o = parseKi(hidden.value);
  fn(o);
  hidden.value = Object.keys(o).length ? JSON.stringify(o) : '';
}

/** Ввод в таблице раскрытия обновляет JSON до того, как событие дойдёт до формы (форма по нему пересчитывает модуль). */
export function setupKi(box, hidden) {
  const onEdit = (e) => {
    const el = e.target.closest?.('[data-ki]');
    if (!el) return;
    const path = el.dataset.ki;
    write(hidden, (o) => {
      if (path === 'on') o.on = el.checked;
      else if (path.startsWith('own.')) {
        o.own = { ...(o.own || {}) };
        const v = el.value.trim();
        if (v) o.own[path.slice(4)] = v;
        else delete o.own[path.slice(4)];
      } else {
        const v = el.value.trim();
        if (v) o[path] = v;
        else delete o[path];
      }
    });
  };
  box.addEventListener('input', onEdit);
  box.addEventListener('change', onEdit);
}

/** Строка о сериях, взятых с вкладки дозиметрии. */
function seriesLine(o, b) {
  const sr = o.series;
  if (!sr) {
    return L(
      'Серий показаний нет: возьмите данные с вкладки дозиметрии (раздел 1) — по ним посчитаются k_pol и k_s, или введите свою оценку.',
      'No series of readings: take the data from a dosimetry tab (section 1) to calculate k_pol and k_s from them, or enter your own estimate.',
    );
  }
  const n = (a) => (Array.isArray(a) ? a.filter((x) => String(x ?? '').trim()).length : 0);
  const src = SRC[o.source]?.() ?? '';
  const parts = [L(`M₊: ${n(sr.Mp)}`, `M₊: ${n(sr.Mp)}`), L(`M₋: ${n(sr.Mm)}`, `M₋: ${n(sr.Mm)}`), L(`при V₂: ${n(sr.M2)}`, `at V₂: ${n(sr.M2)}`)];
  const missing = !b.measured.kpol && !b.measured.ks
    ? L(' k_pol и k_s по измерениям не посчитаны: нужно не меньше двух показаний в каждой серии, M₊ и M₋ разного знака.', ' k_pol and k_s are not calculated from measurements: at least two readings in each series are needed, M₊ and M₋ of opposite sign.')
    : !b.measured.ks
      ? L(' k_s по измерениям не посчитан: проверьте на вкладке V₁, V₂ (отношение из табл. 10 TRS-398) и показания при V₂ (M₁ ≥ M₂).', ' k_s is not calculated from measurements: check V₁, V₂ on the tab (a ratio from TRS-398 Table 10) and the readings at V₂ (M₁ ≥ M₂).')
      : !b.measured.kpol
        ? L(' k_pol по измерениям не посчитан: нужны серии M₊ и M₋ разного знака.', ' k_pol is not calculated from measurements: M₊ and M₋ series of opposite sign are needed.')
        : '';
  return L(`Серии с вкладки «${src}»: ${parts.join(', ')}.${missing}`, `Series from the ${src} tab: ${parts.join(', ')}.${missing}`);
}

/**
 * Отрисовка. r — результат computeUncertaintyTool. Таблица пересоздаётся при смене состава (язык, пучок, включено ли
 * раскрытие); иначе обновляются значения, и поле, в котором сейчас вводят, не теряет фокус.
 */
export function renderKi(box, r, hidden) {
  if (!box) return;
  const o = parseKi(hidden.value);
  const trs = r.budget.template.stages;
  const b = r.budget.ki;
  const on = !!o.on && trs;
  box.dataset.on = on ? '1' : '';
  const sig = [getLang(), r.beam, trs ? 'trs' : 'tg', on ? 'on' : 'off'].join('|');
  if (box.dataset.sig !== sig) {
    box.dataset.sig = sig;
    if (!trs) {
      box.innerHTML = `<p class="sub-hint">${esc(L('В TG-51 поправки уже разложены в бюджете отдельными строками (P_TP, влажность, P_pol, P_ion, утечка и т. д.); раскрытие k_i — для TRS-398.', 'In TG-51 the corrections are already separate rows of the budget (P_TP, humidity, P_pol, P_ion, leakage, etc.); the k_i breakdown is for TRS-398.')).replace(/P_(TP|pol|ion)/g, 'P<sub>$1</sub>')}</p>`;
      return;
    }
    const head = `<label class="check"><input type="checkbox" data-ki="on"${on ? ' checked' : ''}> <span>${richText(L('Раскрыть строку «Поправки на влияющие величины k_i» по поправкам', 'Break down the “Correction for influence quantities k_i” row by correction'))}</span></label>
      <p class="sub-hint">${richText(L(
        'У каждой поправки — часть по измерениям и приборам (серии показаний — тип А; u(T), u(P) приборов) и своя оценка (тип B: процедура, применимость метода, свидетельство). Без своей оценки берётся большее из «по измерениям» и типового значения: типовое покрывает обе части, а разброс одной серии его не уменьшает. Итог — сумма в квадратуре; он заменяет 0,3 % строки k_i.',
        'Each correction has a part from measurements and instruments (series of readings: type A; u(T), u(P) of the instruments) and your own estimate (type B: procedure, applicability of the method, certificate). Without your estimate, the larger of the measured part and the typical value is used: the typical value covers both parts, and the scatter of one series does not reduce it. The total is the sum in quadrature; it replaces the 0.3% of the k_i row.',
      ))}</p>`;
    if (!on) {
      box.innerHTML = head;
      return;
    }
    const rows = kiFactors(r.beam)
      .map(
        (f) => `<tr data-ki-row="${f.key}">
      <td class="unc-name"><span class="unc-label">${richText(f.label)}</span> <span class="unc-type"></span><span class="unc-how">${richText(f.how)}</span><span class="unc-ref">${esc(refText(f.ref))}</span><span class="unc-how" data-meas-how></span></td>
      <td class="v" data-typ data-cap="${esc(L('Типовое', 'Typical'))}"></td>
      <td class="v" data-meas data-cap="${esc(L('По измерениям', 'Measured'))}"></td>
      <td class="unc-own"><input type="text" class="num unc-in" id="unc_ki_own_${f.key}" data-ki="own.${f.key}" inputmode="decimal" autocomplete="off" placeholder=" " aria-label="${esc(L(`Своя оценка (тип B), %: ${f.label}`, `Your estimate (type B), %: ${f.label}`))}"></td>
      <td class="v" data-used data-cap="${esc(L('Принято', 'Used'))}"></td>
    </tr>`,
      )
      .join('');
    box.innerHTML = `${head}
      <div class="grid ki-inputs">
        <div class="field"><label for="unc_ki_uT">u(T), °C</label><input type="text" id="unc_ki_uT" class="num" data-ki="uT" inputmode="decimal" placeholder=" "><span class="sub">${esc(L('термометр: поверка (U/k), разрешение, расхождение приборов', 'thermometer: calibration (U/k), resolution, disagreement between instruments'))}</span></div>
        <div class="field"><label for="unc_ki_uP">${esc(L('u(P), кПа', 'u(P), kPa'))}</label><input type="text" id="unc_ki_uP" class="num" data-ki="uP" inputmode="decimal" placeholder=" "><span class="sub">${esc(L('барометр: так же; 1 гПа = 0,1 кПа', 'barometer: likewise; 1 hPa = 0.1 kPa'))}</span></div>
      </div>
      <p class="sub-hint" data-ki-series></p>
      <div class="table-wrap"><table class="factors unc-table ki-table" aria-label="${esc(L('Раскрытие k_i', 'k_i breakdown'))}">
        <thead><tr><th>${esc(L('Поправка', 'Correction'))}</th><th class="v">${esc(L('Типовое', 'Typical'))}</th><th class="v">${esc(L('По измерениям', 'Measured'))}</th><th class="unc-own">${esc(L('Своя оценка', 'Your estimate'))}</th><th class="v">${esc(L('Принято', 'Used'))}</th></tr></thead>
        <tbody>${rows}<tr class="total" data-ki-total><td>${richText(L('Итог строки k_i (в квадратуре)', 'Total of the k_i row (in quadrature)'))}</td><td class="v" data-typ data-cap="${esc(L('Типовое', 'Typical'))}"></td><td></td><td></td><td class="v" data-used data-cap="${esc(L('Принято', 'Used'))}"></td></tr></tbody>
      </table></div>`;
  }
  if (!on || !b) return;
  const set = (sel, v) => {
    const el = box.querySelector(sel);
    if (el && document.activeElement !== el) el.value = v ?? '';
  };
  set('[data-ki="uT"]', o.uT);
  set('[data-ki="uP"]', o.uP);
  box.querySelector('[data-ki-series]').innerHTML = richText(seriesLine(o, b));
  const basisText = { typ: L('типовое', 'typical'), meas: L('по измерениям', 'measured'), own: L('своя оценка', 'your estimate'), both: L('измерения ⊕ своя', 'measured ⊕ yours') };
  for (const f of b.factors) {
    const tr = box.querySelector(`tr[data-ki-row="${f.key}"]`);
    if (!tr) continue;
    tr.querySelector('[data-typ]').textContent = num(f.typ);
    tr.querySelector('[data-meas]').textContent = Number.isFinite(f.meas) ? num(f.meas, 3) : '—';
    tr.querySelector('[data-used]').textContent = num(f.value);
    tr.querySelector('.unc-type').textContent = basisText[f.basis];
    tr.querySelector('[data-meas-how]').innerHTML = f.measHow ? richText(L(`По измерениям: ${f.measHow}.`, `Measured: ${f.measHow}.`)) : '';
    tr.classList.toggle('own', f.basis === 'own' || f.basis === 'both');
    set(`[data-ki="own.${f.key}"]`, o.own?.[f.key]);
  }
  const tot = box.querySelector('[data-ki-total]');
  tot.querySelector('[data-typ]').textContent = num(Math.sqrt(b.factors.reduce((s, f) => s + f.typ * f.typ, 0)));
  tot.querySelector('[data-used]').textContent = num(b.pct);
}

/** Протокол текстом: раскрытие k_i построчно. */
export function kiReportLines(b) {
  if (!b) return [];
  const basis = { typ: L('типовое', 'typical'), meas: L('по измерениям', 'measured'), own: L('своя оценка', 'your estimate'), both: L('по измерениям и своя оценка', 'measured and your estimate') };
  const out = [L('  Раскрытие строки k_i (относительные стандартные неопределённости, %):', '  Breakdown of the k_i row (relative standard uncertainties, %):')];
  for (const f of b.factors) {
    // составляющие — только когда принятое значение сложено из двух частей
    const parts = f.basis === 'both' ? L(`по измерениям ${num(f.meas, 3)}, своя ${num(f.own)}`, `measured ${num(f.meas, 3)}, yours ${num(f.own)}`) : f.basis === 'meas' ? L(`типовое ${num(f.typ)}`, `typical ${num(f.typ)}`) : '';
    out.push(`    ${f.label}: ${num(f.value)} (${basis[f.basis]}${parts ? `; ${parts}` : ''})`);
  }
  out.push(L(`    Итог k_i: ${num(b.pct)}`, `    k_i total: ${num(b.pct)}`));
  return out;
}
