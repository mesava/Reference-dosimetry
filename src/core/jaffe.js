// Инструмент «График Яффе» (вкладка «Инструменты»): ввод в эксплуатацию системы камера — кабель — электрометр.
//
// По показаниям M при ряде напряжений V строится зависимость 1/M от 1/V (импульсный пучок; в непрерывном —
// начальная рекомбинация) или от 1/V² (общая рекомбинация в непрерывном пучке):
//   1/M = 1/M_нас + A/V   — Report 374, ур. (A.3);   1/M = 1/M_нас + B/V²   — ур. (A.4);
// по прямой в линейной области находят M_нас (пересечение с осью 1/V = 0) и
//   k_s = M_нас/M₁ — TRS-398 Rev.1, ур. (15); Report 374, ур. (A.2) (P_ion).
// Напряжение, выше которого точки уходят от прямой (умножение заряда), — V_max: рабочее напряжение не должно его
// превышать (TRS-398, разд. 4.4.3.4, сноска 23; Report 374, разд. 4.4.4, прил. A.5).
// Метод двух напряжений проверяется сравнением с k_s по графику; полярность — отдельным графиком при обратной
// полярности (TRS-398, сноска 25; табл. 3, п. 5). Зависимость от дозы за импульс: P_ion = 1 + C_init + C_gen·D_pp
// (аддендум TG-51, ур. 2 и табл. III; Report 374, ур. A.5): линейность, C_init < 0,002.
// Обобщённый подход ди Алмейды и Ниателя (TRS-398 Rev.1, разд. 4.4.3.4 d, ур. 17): метод двух напряжений при серии
// мощностей дозы, прямая M₁/M₂ = (1 + b₀) + b₁·M₁; k_s = 1 + b₀/(n − 1) + b₁·M₁/(n² − 1), для импульсных пучков
// второй член b₁·M₁/(n − 1); n = V₁/V₂. Позволяет найти k_s при любом показании M₁ без повторного измерения.

import { parseNumber, isBlank, ru } from './units.js';
import { L } from './i18n.js';
import * as TRS from './trs398.js';
import * as TG51 from './tg51.js';

export const JF_ROWS = 8;
export const DPP_ROWS = 3;

export const JF_DEFAULTS = {
  protocol: 'trs',

  jf_institution: '',
  jf_date: '',
  jf_staff: [''],
  jf_notes: '',
  jf_chamber: '',
  jf_ch_serial: '',
  jf_electrometer: '',
  jf_el_serial: '',
  jf_cable: '',
  jf_machine: '',
  jf_beam: '',
  jf_conditions: '',
  jf_beam_type: 'pulsed', // 'pulsed' | 'scanned' | 'continuous'

  jf_v_man: '', // напряжение, рекомендованное производителем (максимальное), В
  jf_v1: '', // рабочее напряжение, В
  jf_v2: '', // пониженное напряжение для метода двух напряжений, В
  jf_axis: 'v', // 'v' — 1/M от 1/V; 'v2' — 1/M от 1/V²
  jf_fit: 'auto', // линейная область: 'auto' | 'manual'
  jf_tol: '0,1', // допуск линейности, % (наибольшее отклонение точки от прямой)

  // строки таблицы: напряжение, показание при обычной полярности, при обратной (по желанию), в аппроксимации (вручную)
  jf_V: Array(JF_ROWS).fill(''),
  jf_M: Array(JF_ROWS).fill(''),
  jf_Mopp: Array(JF_ROWS).fill(''),
  jf_use: Array(JF_ROWS).fill(true),

  // зависимость от дозы за импульс (по желанию): условие, D_pp, k_s
  jf_dpp_unit: 'mGy', // 'mGy' — мГр за импульс; 'rel' — относительная величина
  jf_dpp_cond: Array(DPP_ROWS).fill(''),
  jf_dpp_x: Array(DPP_ROWS).fill(''),
  jf_dpp_m1: Array(DPP_ROWS).fill(''), // показание при V₁ (для метода двух напряжений и ур. 17)
  jf_dpp_m2: Array(DPP_ROWS).fill(''), // показание при V₂
  jf_dpp_ks: Array(DPP_ROWS).fill(''), // готовый k_s, если M₁ и M₂ не введены
  jf_dpp_mq: '', // показание M₁, для которого найти k_s по ур. 17
};

const REF = { trs: 'TRS-398 Rev.1', r374: 'WGTG51 Report 374', add: 'аддендум TG-51 (2014)' };

const arr = (v, n, fill = '') => {
  const a = Array.isArray(v) ? v.slice() : [];
  while (a.length < n) a.push(fill);
  return a;
};

export function normalizeJaffe(input) {
  const f = { ...JF_DEFAULTS, ...input };
  if (f.protocol !== 'tg51') f.protocol = 'trs';
  if (!['pulsed', 'scanned', 'continuous'].includes(f.jf_beam_type)) f.jf_beam_type = 'pulsed';
  if (f.jf_axis !== 'v2') f.jf_axis = 'v';
  if (f.jf_fit !== 'manual') f.jf_fit = 'auto';
  if (f.jf_dpp_unit !== 'rel') f.jf_dpp_unit = 'mGy';
  // число строк — по введённым массивам (у пустой формы — как по умолчанию)
  const given = (keys, def) => {
    const lens = keys.map((k) => (Array.isArray(input?.[k]) ? input[k].length : 0));
    return Math.max(...lens) || def;
  };
  const n = Math.max(3, given(['jf_V', 'jf_M', 'jf_Mopp', 'jf_use'], JF_ROWS));
  const cut = (v, k, fill = '') => arr(v, k, fill).slice(0, k);
  f.jf_V = cut(f.jf_V, n).map(String);
  f.jf_M = cut(f.jf_M, n).map(String);
  f.jf_Mopp = cut(f.jf_Mopp, n).map(String);
  f.jf_use = cut(f.jf_use, n, true).map((x) => x !== false && x !== 'false');
  const dk = ['jf_dpp_cond', 'jf_dpp_x', 'jf_dpp_m1', 'jf_dpp_m2', 'jf_dpp_ks'];
  const m = Math.max(1, given(dk, DPP_ROWS));
  for (const k of dk) f[k] = cut(f[k], m).map(String);
  if (!Array.isArray(f.jf_staff) || f.jf_staff.length === 0) f.jf_staff = [''];
  return f;
}

/** Линейная регрессия y = a + b·x методом наименьших квадратов, с остатками и неопределённостью свободного члена. */
export function linearFit(xs, ys) {
  const n = xs.length;
  if (n < 2) return null;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  if (!(sxx > 0)) return null;
  const b = sxy / sxx;
  const a = my - b * mx;
  const res = ys.map((y, i) => y - (a + b * xs[i]));
  const ssr = res.reduce((s, r) => s + r * r, 0);
  const sst = ys.reduce((s, y) => s + (y - my) ** 2, 0);
  const s = n > 2 ? Math.sqrt(ssr / (n - 2)) : NaN;
  return { a, b, n, res, r2: sst > 0 ? 1 - ssr / sst : 1, seA: n > 2 ? s * Math.sqrt(1 / n + (mx * mx) / sxx) : NaN, seB: n > 2 ? s / Math.sqrt(sxx) : NaN };
}

/** Наибольшее относительное отклонение точек от прямой, доля. */
const maxRel = (fit, xs, ys) => Math.max(...ys.map((y, i) => Math.abs(y - (fit.a + fit.b * xs[i])) / (fit.a + fit.b * xs[i])));

/** Отклонение крайней точки участка от прямой по остальным его точкам, доля (прямая её не «подтягивает»). */
function endDev(ix, end, xs, ys) {
  const rest = ix.filter((k) => k !== end);
  const fit = linearFit(rest.map((k) => xs[k]), rest.map((k) => ys[k]));
  if (!fit) return 0;
  const line = fit.a + fit.b * xs[end];
  return Math.abs(ys[end] - line) / line;
}

/**
 * Линейная область автоматически: самый длинный непрерывный по напряжению участок (не меньше трёх точек), на котором
 * все точки отклоняются от прямой не больше чем на tol, а крайние точки (самое низкое и самое высокое напряжение) —
 * и от прямой по остальным точкам участка (для участков из четырёх точек и больше): так начало умножения заряда не
 * растворяется в аппроксимации. При равной длине выбирается участок с более высокими напряжениями.
 * Возвращает индексы точек (в порядке возрастания V) или null.
 */
export function autoWindow(xs, ys, tol) {
  const n = xs.length;
  for (let len = n; len >= 3; len--) {
    for (let i = n - len; i >= 0; i--) {
      const ix = [];
      for (let k = i; k < i + len; k++) ix.push(k);
      const fx = ix.map((k) => xs[k]);
      const fy = ix.map((k) => ys[k]);
      const fit = linearFit(fx, fy);
      if (!fit || maxRel(fit, fx, fy) > tol) continue;
      if (len >= 4 && (endDev(ix, ix[0], xs, ys) > tol || endDev(ix, ix[len - 1], xs, ys) > tol)) continue;
      return ix;
    }
  }
  return null;
}

export function computeJaffe(form) {
  const f = normalizeJaffe(form);
  const messages = [];
  const flags = {};
  const rank = { info: 0, warn: 1, error: 2 };
  const add = (level, text, ref = null, field = null, id = null) => {
    messages.push({ level, scope: 'common', text, ref, ...(id ? { id } : {}) });
    for (const k of [].concat(field ?? [])) if (!flags[k] || rank[level] > rank[flags[k]]) flags[k] = level;
  };
  const num = (key, label, { required = false } = {}) => {
    if (isBlank(f[key])) {
      if (required) add('error', L(`Не заполнено поле «${label}».`, `Field "${label}" is empty.`), null, key);
      return NaN;
    }
    const v = parseNumber(f[key]);
    if (!Number.isFinite(v)) add('error', L(`Не удалось прочитать число в поле «${label}».`, `Could not read a number in field "${label}".`), null, key);
    return v;
  };

  const beam = f.jf_beam_type;
  const pulsed = beam !== 'continuous';
  const KS = f.protocol === 'tg51' ? 'P_ion' : 'k_s'; // обозначение поправки на рекомбинацию в тексте
  const axis = f.jf_axis;
  const xOf = (V) => (axis === 'v2' ? 1 / (V * V) : 1 / V);

  const vMan = num('jf_v_man', L('Напряжение производителя', 'Manufacturer voltage'));
  const V1 = num('jf_v1', L('Рабочее напряжение V₁', 'Working voltage V₁'), { required: true });
  const V2 = num('jf_v2', L('Пониженное напряжение V₂', 'Reduced voltage V₂'));
  let tol = parseNumber(f.jf_tol);
  if (!Number.isFinite(tol) || tol <= 0) {
    if (!isBlank(f.jf_tol)) add('warn', L('Не удалось прочитать допуск линейности: принято 0,1 %.', 'Could not read the linearity tolerance: 0.1% is assumed.'), null, 'jf_tol');
    tol = 0.1;
  }
  for (const [v, key] of [[vMan, 'jf_v_man'], [V1, 'jf_v1'], [V2, 'jf_v2']]) {
    if (Number.isFinite(v) && v <= 0) add('error', L('Напряжение вводится по модулю, больше нуля.', 'Enter the voltage as a positive magnitude.'), null, key);
  }

  // ---------------------------------------------- точки
  const pts = [];
  const seenV = new Map();
  for (let i = 0; i < f.jf_V.length; i++) {
    const rawV = f.jf_V[i];
    const rawM = f.jf_M[i];
    const rawO = f.jf_Mopp[i];
    if (isBlank(rawV) && isBlank(rawM) && isBlank(rawO)) continue;
    const kV = `jf_V.${i}`;
    const kM = `jf_M.${i}`;
    const kO = `jf_Mopp.${i}`;
    const V = Math.abs(parseNumber(rawV));
    const M = Math.abs(parseNumber(rawM));
    const O = isBlank(rawO) ? NaN : Math.abs(parseNumber(rawO));
    const row = i + 1;
    if (isBlank(rawV) || !Number.isFinite(V) || V === 0) {
      add('error', L(`Строка ${row}: не удалось прочитать напряжение.`, `Row ${row}: could not read the voltage.`), null, kV);
      continue;
    }
    if (isBlank(rawM) || !Number.isFinite(M) || M === 0) {
      add('error', L(`Строка ${row}: не удалось прочитать показание при обычной полярности.`, `Row ${row}: could not read the normal-polarity reading.`), null, kM);
      continue;
    }
    if (!isBlank(rawO) && (!Number.isFinite(O) || O === 0)) add('warn', L(`Строка ${row}: не удалось прочитать показание при обратной полярности — оно не учитывается.`, `Row ${row}: could not read the opposite-polarity reading; it is ignored.`), null, kO);
    if (seenV.has(V)) {
      add('error', L(`Напряжение ${ru(V, 0)} В введено дважды (строки ${seenV.get(V) + 1} и ${row}): усредните показания в одной строке.`, `Voltage ${ru(V, 0)} V is entered twice (rows ${seenV.get(V) + 1} and ${row}): average the readings in one row.`), null, [kV]);
      continue;
    }
    seenV.set(V, i);
    pts.push({ i, V, M, Mopp: Number.isFinite(O) && O > 0 ? O : NaN, use: f.jf_use[i], x: xOf(V), y: 1 / M });
  }
  pts.sort((p, q) => p.V - q.V);
  const n = pts.length;

  const out = { form: f, protocol: f.protocol, beam, pulsed, axis, vMan, V1, V2, tol, points: pts, fit: null, window: [], messages, flags };

  if (n < 3) {
    add('error', L('Для графика Яффе нужно не меньше трёх напряжений (лучше 6–8, от трети рабочего напряжения до напряжения производителя).', 'A Jaffé plot needs at least three voltages (6–8 is better, from a third of the working voltage up to the manufacturer voltage).'), `${REF.r374}, прил. A.5`, 'jf_V.0');
    return finish(out);
  }

  // ---------------------------------------------- линейная область и прямая
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  let win;
  if (f.jf_fit === 'manual') {
    win = pts.map((p, k) => (p.use ? k : -1)).filter((k) => k >= 0);
    if (win.length < 3) {
      add('error', L('Отметьте для аппроксимации не меньше трёх точек линейной области.', 'Select at least three points of the linear region for the fit.'), null, 'jf_fit');
      return finish(out);
    }
  } else {
    win = autoWindow(xs, ys, tol / 100);
    if (!win) {
      add(
        'warn',
        L(
          `Ни на одном участке из трёх и более соседних точек отклонение от прямой не укладывается в ${ru(tol, 2)} %: проверьте показания, увеличьте допуск или выберите точки вручную. Если 1/M не линейно ни от 1/V, ни от 1/V², k_s нужно определять обобщённым подходом ди Алмейды и Ниателя (ур. 17, раздел 5) или выбрать напряжения в линейной области.`,
          `No stretch of three or more neighbouring points stays within ${ru(tol, 2)}% of a straight line: check the readings, increase the tolerance or select the points manually. If 1/M is linear neither in 1/V nor in 1/V², k_s must be determined with the generalized approach of de Almeida and Niatel (Eq. 17, section 5) or voltages in the linear region must be chosen.`,
        ),
        `${REF.trs}, разд. 4.4.3.4 c–d, ур. 17`,
        'jf_tol',
      );
      win = pts.map((p, k) => k);
    }
  }
  out.window = win;
  for (const k of win) pts[k].inFit = true;
  const fit = linearFit(win.map((k) => xs[k]), win.map((k) => ys[k]));
  if (!fit || !(fit.a > 0)) {
    add('error', L('Прямая по выбранным точкам не пересекает ось 1/V = 0 при положительном 1/M: проверьте показания.', 'The line through the selected points does not cross 1/V = 0 at a positive 1/M: check the readings.'), null, 'jf_M.0');
    return finish(out);
  }
  out.fit = fit;
  out.Msat = 1 / fit.a;
  out.uMsatRel = fit.seA / fit.a; // относительная стандартная неопределённость M_нас по разбросу точек
  for (const p of pts) {
    p.ks = p.y * out.Msat; // M_нас/M — k_s при этом напряжении
    p.line = fit.a + fit.b * p.x;
    p.dev = (p.y - p.line) / p.line; // отклонение 1/M от прямой, доля
  }
  out.maxDevPct = Math.max(...win.map((k) => Math.abs(pts[k].dev))) * 100; // наибольшее отклонение в линейной области, %
  out.vLow = pts[win[0]].V;
  out.vHigh = pts[win[win.length - 1]].V;
  const above = pts.filter((p, k) => k > win[win.length - 1]);
  const below = pts.filter((p, k) => k < win[0]);
  out.vMaxOpen = above.length === 0; // выше линейной области точек нет: V_max не ниже наибольшего напряжения
  out.vMax = out.vHigh;

  if (fit.b < 0) {
    add('error', L('1/M растёт с напряжением: показание падает при большем напряжении. Проверьте показания и полярность.', '1/M increases with voltage: the reading drops at a higher voltage. Check the readings and the polarity.'), null, 'jf_M.0');
  }
  if (above.some((p) => p.dev < 0)) {
    // напряжение производителя выше V_max — главное, что нужно знать: при нём работать нельзя
    const manAbove = Number.isFinite(vMan) && vMan > out.vHigh + 1e-9;
    add(
      manAbove ? 'warn' : 'info',
      L(
        `Выше ${ru(out.vHigh, 0)} В показания растут быстрее прямой — признак умножения заряда. V_max = ${ru(out.vHigh, 0)} В: работать нужно не выше этого напряжения.${manAbove ? ` Напряжение производителя ${ru(vMan, 0)} В выше V_max — при нём работать нельзя.` : ''}`,
        `Above ${ru(out.vHigh, 0)} V the readings grow faster than the line — a sign of charge multiplication. V_max = ${ru(out.vHigh, 0)} V: do not work above this voltage.${manAbove ? ` The manufacturer voltage ${ru(vMan, 0)} V is above V_max — do not work at it.` : ''}`,
      ),
      `${REF.r374}, прил. A.5; ${REF.add}, прил. A; ${REF.trs}, разд. 4.4.3.4`,
      manAbove ? 'jf_v_man' : null,
      'mult',
    );
  } else if (above.length) {
    add(
      'warn',
      L(
        `Точки выше ${ru(out.vHigh, 0)} В не легли на прямую: показания там ниже ожидаемых. Это не умножение заряда — проверьте установление показаний и дрейф (повторите рабочее напряжение).`,
        `Points above ${ru(out.vHigh, 0)} V do not lie on the line: the readings there are lower than expected. This is not charge multiplication — check the settling of the readings and drift (repeat the working voltage).`,
      ),
      null,
      'jf_M.0',
    );
  }
  if (below.length) {
    add('info', L(`Точки ниже ${ru(out.vLow, 0)} В в аппроксимацию не вошли: при малых напряжениях линейность может нарушаться.`, `Points below ${ru(out.vLow, 0)} V were left out of the fit: linearity may break down at low voltages.`), null);
  }
  if (n < 5) add('info', L('Для уверенной проверки линейности нужно 5–8 напряжений.', 'Five to eight voltages are needed to check the linearity with confidence.'), `${REF.r374}, прил. A.5`, 'jf_V.0');

  // ---------------------------------------------- рабочее напряжение
  const at = (V) => pts.find((p) => Math.abs(p.V - V) < 1e-6);
  if (Number.isFinite(V1) && V1 > 0) {
    out.ks1Line = 1 + (fit.b / fit.a) * xOf(V1); // по прямой
    const p1 = at(V1);
    out.ks1Meas = p1 ? p1.ks : NaN; // по показанию при V₁: TRS-398 ур. (15)
    out.ks1 = Number.isFinite(out.ks1Meas) ? out.ks1Meas : out.ks1Line;
    if (!p1) add('info', L(`Показания при V₁ = ${ru(V1, 0)} В нет: ${KS} взят по прямой.`, `There is no reading at V₁ = ${ru(V1, 0)} V: ${KS} is taken from the line.`), null, 'jf_v1');
    if (V1 > out.vHigh + 1e-9 && !out.vMaxOpen) {
      add(
        'warn',
        L(
          `Рабочее напряжение ${ru(V1, 0)} В выше V_max = ${ru(out.vHigh, 0)} В, вне линейной области. Выберите рабочее напряжение не выше V_max.`,
          `The working voltage ${ru(V1, 0)} V is above V_max = ${ru(out.vHigh, 0)} V, outside the linear region. Choose a working voltage not above V_max.`,
        ),
        `${REF.r374}, разд. 4.4.4, прил. A.5; ${REF.trs}, сноска 23`,
        'jf_v1',
      );
    } else if (V1 > out.vHigh + 1e-9) {
      add('warn', L(`Рабочее напряжение ${ru(V1, 0)} В выше измеренного диапазона: линейность при нём не проверена.`, `The working voltage ${ru(V1, 0)} V is above the measured range: linearity is not verified at it.`), `${REF.r374}, прил. A.5`, 'jf_v1');
    } else if (V1 < out.vLow - 1e-9) {
      add('warn', L(`Рабочее напряжение ${ru(V1, 0)} В ниже линейной области.`, `The working voltage ${ru(V1, 0)} V is below the linear region.`), null, 'jf_v1');
    }
    if (Number.isFinite(vMan) && V1 > vMan) {
      add('warn', L('Рабочее напряжение не должно превышать напряжение, рекомендованное производителем.', 'The working voltage must not exceed the voltage recommended by the manufacturer.'), `${REF.trs}, сноска 23`, ['jf_v1', 'jf_v_man']);
    }
    if (out.ks1 > 1.05) {
      add('warn', L(`${KS} = ${ru(out.ks1, 4)} больше 1,05: метод двух напряжений неприменим, нужны другие методы или другая камера.`, `${KS} = ${ru(out.ks1, 4)} exceeds 1.05: the two-voltage method does not apply; other methods or another chamber are needed.`), `${REF.trs}, табл. 3`, 'jf_v1');
    }
    if (out.ks1 < 1 - 1e-6) add('error', L(`${KS} меньше 1: камера не может собрать больше заряда, чем образовалось. Проверьте показания.`, `${KS} is below 1: a chamber cannot collect more charge than is produced. Check the readings.`), null, 'jf_M.0');
  }

  // диапазон напряжений: от трети напряжения производителя (или рабочего) до него
  const vRef = Number.isFinite(vMan) ? vMan : V1;
  if (Number.isFinite(vRef) && vRef > 0) {
    if (pts[0].V > vRef / 3 + 1e-9) add('info', L(`Самое низкое напряжение ${ru(pts[0].V, 0)} В: Report 374 советует начинать примерно с трети напряжения производителя (${ru(vRef / 3, 0)} В).`, `The lowest voltage is ${ru(pts[0].V, 0)} V: Report 374 advises starting at about a third of the manufacturer voltage (${ru(vRef / 3, 0)} V).`), `${REF.r374}, прил. A.5`, 'jf_V.0');
    if (pts[n - 1].V < vRef - 1e-9) add('info', L(`Самое высокое напряжение ${ru(pts[n - 1].V, 0)} В ниже ${ru(vRef, 0)} В: выше него линейность не проверена.`, `The highest voltage ${ru(pts[n - 1].V, 0)} V is below ${ru(vRef, 0)} V: linearity above it is not verified.`), `${REF.trs}, разд. 4.4.3.4`, 'jf_V.0');
  }
  if (pulsed && axis === 'v2') add('info', L('Для импульсных пучков график строят от 1/V: метод двух напряжений предполагает линейность 1/M от 1/V.', 'For pulsed beams the plot uses 1/V: the two-voltage method assumes 1/M is linear in 1/V.'), `${REF.trs}, разд. 4.4.3.4`, 'jf_axis');

  // ---------------------------------------------- метод двух напряжений для сравнения
  /** k_s методом двух напряжений при V₁, V₂ из раздела 2 — по формулам выбранного протокола. */
  function twoVoltage(m1, m2) {
    if (f.protocol === 'tg51') {
      return {
        value: TG51.pIon({ mH: m1, mL: m2, vH: V1, vL: V2, beam: pulsed ? 'pulsed' : 'continuous' }),
        equation: pulsed ? L('P_ion, TG-51 ур. (12)', 'P_ion, TG-51 Eq. (12)') : L('P_ion, TG-51 ур. (11)', 'P_ion, TG-51 Eq. (11)'),
      };
    }
    if (!pulsed && axis === 'v2') {
      const nn = (V1 / V2) ** 2;
      return { value: (nn - 1) / (nn - m1 / m2), equation: L('TRS-398 ур. (16)', 'TRS-398 Eq. (16)') };
    }
    const k = TRS.ks({ m1, m2, v1: V1, v2: V2, beam: beam === 'scanned' ? 'scanned' : 'pulsed' });
    return { value: k.value, equation: `TRS-398, ${k.equation || ''}`, error: k.error };
  }
  const nOK = Number.isFinite(V1) && Number.isFinite(V2) && V1 > 0 && V2 > 0 && V2 < V1;
  if (Number.isFinite(V1) && Number.isFinite(V2) && V1 > 0 && V2 > 0) {
    const p1 = at(V1);
    const p2 = at(V2);
    if (V2 >= V1) add('error', L('Пониженное напряжение V₂ должно быть меньше рабочего V₁.', 'The reduced voltage V₂ must be lower than the working voltage V₁.'), null, 'jf_v2');
    else if (p1 && p2) {
      const two = { n: V1 / V2, ...twoVoltage(p1.M, p2.M) };
      if (two.error) add('warn', two.error, `${REF.trs}, табл. 10`, 'jf_v2');
      if (Number.isFinite(two.value) && Number.isFinite(out.ks1)) {
        two.diffPct = (two.value / out.ks1 - 1) * 100;
        if (Math.abs(two.diffPct) > 0.1) {
          add(
            'warn',
            L(
              `Метод двух напряжений (${ru(two.value, 4)}) расходится с графиком Яффе (${ru(out.ks1, 4)}) на ${ru(two.diffPct, 2)} %: при этих V₁ и V₂ им пользоваться нельзя — выберите напряжения в линейной области.`,
              `The two-voltage method (${ru(two.value, 4)}) differs from the Jaffé plot (${ru(out.ks1, 4)}) by ${ru(two.diffPct, 2)}%: do not use it with these V₁ and V₂ — choose voltages in the linear region.`,
            ),
            `${REF.trs}, разд. 4.4.3.4; ${REF.add}, разд. 5.C.2`,
            ['jf_v1', 'jf_v2'],
          );
        }
      }
      if (V2 < out.vLow - 1e-9 || V1 > out.vHigh + 1e-9) {
        add('warn', L('Для метода двух напряжений и V₁, и V₂ должны лежать в линейной области графика.', 'For the two-voltage method both V₁ and V₂ must lie in the linear region of the plot.'), `${REF.trs}, разд. 4.4.3.4`, ['jf_v1', 'jf_v2']);
      }
      if (two.n < 2) add('warn', L('V₁/V₂ меньше 2: метод двух напряжений теряет точность (TRS-398: в идеале V₁/V₂ ≥ 3).', 'V₁/V₂ is below 2: the two-voltage method loses accuracy (TRS-398: ideally V₁/V₂ ≥ 3).'), `${REF.trs}, разд. 4.4.3.4`, 'jf_v2');
      out.two = two;
    } else {
      add('info', L('Чтобы сравнить с методом двух напряжений, введите показания и при V₁, и при V₂.', 'To compare with the two-voltage method, enter readings at both V₁ and V₂.'), null, 'jf_v2');
    }
  }

  // ---------------------------------------------- начальная рекомбинация в непрерывном пучке
  if (!pulsed && axis === 'v' && Number.isFinite(out.ks1)) {
    out.cInit = out.ks1 - 1;
    if (out.cInit > 0.002) {
      add('warn', L(`Начальная рекомбинация ${ru(out.cInit * 100, 2)} % больше 0,2 %: камера не отвечает критериям эталонного класса.`, `Initial recombination ${ru(out.cInit * 100, 2)}% exceeds 0.2%: the chamber does not meet the reference-class criteria.`), `${REF.trs}, табл. 3; ${REF.add}, табл. III`, 'jf_v1');
    }
  }

  // ---------------------------------------------- обратная полярность
  const opp = win.map((k) => pts[k]).filter((p) => Number.isFinite(p.Mopp));
  for (const p of pts) if (Number.isFinite(p.Mopp)) p.kpol = (p.M + p.Mopp) / (2 * p.M);
  if (opp.length >= 3) {
    const fo = linearFit(opp.map((p) => p.x), opp.map((p) => 1 / p.Mopp));
    if (fo && fo.a > 0) {
      const MsatO = 1 / fo.a;
      for (const p of pts) if (Number.isFinite(p.Mopp)) p.ksOpp = MsatO / p.Mopp;
      const p1 = Number.isFinite(V1) ? at(V1) : null;
      const ks1Opp = p1 && Number.isFinite(p1.ksOpp) ? p1.ksOpp : Number.isFinite(V1) ? 1 + (fo.b / fo.a) * xOf(V1) : NaN;
      out.opp = { fit: fo, Msat: MsatO, ks1: ks1Opp, diffPct: (ks1Opp - out.ks1) * 100, n: opp.length };
      if (Math.abs(out.opp.diffPct) > 0.1) {
        add(
          'warn',
          L(
            `${KS} при обратной полярности (${ru(ks1Opp, 4)}) отличается от обычной (${ru(out.ks1, 4)}) на ${ru(Math.abs(out.opp.diffPct), 2)} %: у камеры эталонного класса разница меньше 0,1 %. Возможна неполадка камеры.`,
            `${KS} at the opposite polarity (${ru(ks1Opp, 4)}) differs from the normal one (${ru(out.ks1, 4)}) by ${ru(Math.abs(out.opp.diffPct), 2)}%: for a reference-class chamber the difference is below 0.1%. The chamber may be faulty.`,
          ),
          `${REF.trs}, табл. 3, сноска 25; ${REF.add}, табл. III`,
          'jf_Mopp.0',
        );
      }
    }
    // k_pol в линейной области: от чего до чего меняется с напряжением
    const kp = opp.map((p) => p.kpol);
    out.kpolMin = Math.min(...kp);
    out.kpolMax = Math.max(...kp);
    out.kpolRange = (out.kpolMax - out.kpolMin) * 100;
  } else if (pts.some((p) => Number.isFinite(p.Mopp))) {
    add('info', L('Для графика при обратной полярности нужно не меньше трёх показаний в линейной области.', 'At least three readings in the linear region are needed for the opposite-polarity plot.'), null, 'jf_Mopp.0');
  }

  // ---------------------------------------------- зависимость от дозы за импульс и ур. 17
  const dpp = [];
  for (let i = 0; i < f.jf_dpp_x.length; i++) {
    const [rx, r1, r2, rk] = [f.jf_dpp_x[i], f.jf_dpp_m1[i], f.jf_dpp_m2[i], f.jf_dpp_ks[i]];
    if ([rx, r1, r2, rk].every(isBlank)) continue;
    const row = { i, cond: f.jf_dpp_cond[i], x: NaN, m1: NaN, m2: NaN, ks: NaN, src: null };
    if (!isBlank(rx)) {
      row.x = parseNumber(rx);
      if (!Number.isFinite(row.x) || row.x < 0) {
        add('warn', L(`Доза за импульс, строка ${i + 1}: не удалось прочитать.`, `Dose per pulse, row ${i + 1}: could not read.`), null, `jf_dpp_x.${i}`);
        row.x = NaN;
      }
    }
    const hasM = !isBlank(r1) || !isBlank(r2);
    if (hasM) {
      const m1 = Math.abs(parseNumber(r1));
      const m2 = Math.abs(parseNumber(r2));
      if (!(m1 > 0) || !(m2 > 0)) {
        add('warn', L(`Строка ${i + 1}: для метода двух напряжений нужны оба показания, M₁ и M₂.`, `Row ${i + 1}: the two-voltage method needs both readings, M₁ and M₂.`), null, [`jf_dpp_m1.${i}`, `jf_dpp_m2.${i}`]);
      } else if (!nOK) {
        add('warn', L(`Строка ${i + 1}: задайте V₁ и V₂ в разделе 2 — по ним считается k_s.`, `Row ${i + 1}: set V₁ and V₂ in section 2 — k_s is calculated with them.`), null, ['jf_v1', 'jf_v2']);
      } else {
        row.m1 = m1;
        row.m2 = m2;
        const t = twoVoltage(m1, m2);
        row.ks = t.value;
        row.src = 'two';
        row.equation = t.equation;
        if (t.error) add('warn', t.error, `${REF.trs}, табл. 10`, 'jf_v2');
        if (m1 < m2) add('warn', L(`Строка ${i + 1}: M₁ меньше M₂ — при пониженном напряжении камера не может собрать больше заряда. Проверьте показания.`, `Row ${i + 1}: M₁ is below M₂ — the chamber cannot collect more charge at the reduced voltage. Check the readings.`), null, `jf_dpp_m1.${i}`);
      }
    } else if (!isBlank(rk)) {
      const k = parseNumber(rk);
      if (!Number.isFinite(k) || k < 1 || k > 1.2) {
        add('warn', L(`${KS}, строка ${i + 1}: введите значение от 1 до 1,2.`, `${KS}, row ${i + 1}: enter a value between 1 and 1.2.`), null, `jf_dpp_ks.${i}`);
      } else {
        row.ks = k;
        row.src = 'in';
      }
    }
    dpp.push(row);
  }
  if (dpp.length) {
    out.dpp = { points: dpp, unit: f.jf_dpp_unit };
    // аддендум TG-51: k_s = 1 + C_init + C_gen·D_pp
    const px = dpp.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.ks));
    if (px.length && px.length < 3) {
      add('info', L('Зависимость от дозы за импульс: нужно не меньше трёх значений (меняйте РИП или глубину, а не частоту импульсов).', 'Dose-per-pulse dependence: at least three values are needed (vary the SSD or depth, not the pulse repetition frequency).'), `${REF.r374}, разд. 4.4.4`, 'jf_dpp_x.0');
    } else if (px.length >= 3) {
      const fd = linearFit(px.map((p) => p.x), px.map((p) => p.ks));
      if (fd) {
        out.dpp.fit = fd;
        out.dpp.cInit = fd.a - 1;
        out.dpp.cGen = fd.b;
        for (const p of px) p.dev = (p.ks - (fd.a + fd.b * p.x)) * 100;
        out.dpp.maxDev = Math.max(...px.map((p) => Math.abs(p.dev)));
        if (out.dpp.cInit > 0.002) add('warn', L(`Начальная рекомбинация C_init = ${ru(out.dpp.cInit * 100, 2)} % больше 0,2 %: камера не отвечает критериям эталонного класса.`, `Initial recombination C_init = ${ru(out.dpp.cInit * 100, 2)}% exceeds 0.2%: the chamber does not meet the reference-class criteria.`), `${REF.add}, табл. III; ${REF.trs}, табл. 3`, 'jf_dpp_ks.0');
        if (out.dpp.cInit < -0.0005) add('warn', L(`Прямая пересекает D_pp = 0 ниже 1: проверьте значения ${KS} и дозы за импульс.`, `The line crosses D_pp = 0 below 1: check the ${KS} and dose-per-pulse values.`), null, 'jf_dpp_ks.0');
        if (!(fd.b > 0)) add('warn', L(`${KS} не растёт с дозой за импульс: у камеры эталонного класса наклон положительный.`, `${KS} does not increase with the dose per pulse: a reference-class chamber has a positive slope.`), `${REF.add}, прил. A`, 'jf_dpp_x.0');
        if (out.dpp.maxDev > 0.1) add('warn', L(`Точки отклоняются от прямой до ${ru(out.dpp.maxDev, 2)} %: зависимость ${KS} от дозы за импульс должна быть линейной.`, `Points deviate from the line by up to ${ru(out.dpp.maxDev, 2)}%: ${KS} must depend linearly on the dose per pulse.`), `${REF.trs}, табл. 3; ${REF.add}, табл. III`, 'jf_dpp_ks.0');
      }
    }
    // TRS-398, ур. 17: M₁/M₂ = (1 + b₀) + b₁·M₁ по строкам с показаниями при двух напряжениях
    const pm = dpp.filter((p) => p.src === 'two');
    if (pm.length >= 2) {
      const n = V1 / V2;
      const fe = linearFit(pm.map((p) => p.m1), pm.map((p) => p.m1 / p.m2));
      if (fe) {
        const gen = pulsed ? n - 1 : n * n - 1; // знаменатель члена общей рекомбинации
        const e = { n, b0: fe.a - 1, b1: fe.b, gen, fit: fe, pulsed };
        e.ksAt = (m1) => 1 + e.b0 / (n - 1) + (e.b1 * m1) / gen;
        e.cInit = e.b0 / (n - 1); // вклад, не зависящий от мощности дозы (начальная рекомбинация)
        for (const p of pm) {
          p.ks17 = e.ksAt(p.m1);
          p.dev17 = ((p.m1 / p.m2 - (fe.a + fe.b * p.m1)) / (n - 1)) * 100; // отклонение, пересчитанное в k_s, %
        }
        e.maxDev = Math.max(...pm.map((p) => Math.abs(p.dev17)));
        // показание при V₁ из раздела 3 (если сняты в тех же единицах и при том же числе МЕ)
        const p1 = Number.isFinite(V1) ? at(V1) : null;
        if (p1) e.ksRef = e.ksAt(p1.M);
        const mq = parseNumber(f.jf_dpp_mq);
        if (!isBlank(f.jf_dpp_mq)) {
          if (Number.isFinite(mq) && mq > 0) e.ksQ = e.ksAt(Math.abs(mq));
          else add('warn', L('Не удалось прочитать показание M₁ для пересчёта k_s.', 'Could not read the M₁ reading for the k_s conversion.'), null, 'jf_dpp_mq');
        }
        out.eq17 = e;
        if (pm.length < 3) add('info', L('Ур. 17 по двум условиям: для проверки линейности M₁/M₂ от M₁ нужно три и больше.', 'Eq. 17 from two conditions: three or more are needed to check that M₁/M₂ is linear in M₁.'), `${REF.trs}, ур. 17`, 'jf_dpp_m1.0');
        if (e.cInit > 0.002) add('warn', L(`Начальная рекомбинация по ур. 17, b₀/(n − 1) = ${ru(e.cInit * 100, 2)} %, больше 0,2 %: камера не отвечает критериям эталонного класса.`, `Initial recombination from Eq. 17, b₀/(n − 1) = ${ru(e.cInit * 100, 2)}%, exceeds 0.2%: the chamber does not meet the reference-class criteria.`), `${REF.trs}, ур. 17, табл. 3`, 'jf_dpp_m1.0');
        if (pm.length >= 3 && e.maxDev > 0.1) add('warn', L(`Точки M₁/M₂ отклоняются от прямой до ${ru(e.maxDev, 2)} % (в пересчёте на ${KS}): проверьте показания.`, `The M₁/M₂ points deviate from the line by up to ${ru(e.maxDev, 2)}% (in terms of ${KS}): check the readings.`), `${REF.trs}, ур. 17`, 'jf_dpp_m1.0');
        if (fe.b < 0) add('warn', L('M₁/M₂ уменьшается с ростом M₁: общая рекомбинация должна расти с мощностью дозы. Проверьте показания и порядок условий.', 'M₁/M₂ decreases as M₁ grows: general recombination must grow with the dose rate. Check the readings and the order of the conditions.'), `${REF.trs}, ур. 17`, 'jf_dpp_m1.0');
      }
    }
  }
  out.checks = checks(out, KS);
  return finish(out);
}

/**
 * Сводка проверок системы для табло: status 'ok' | 'fail' | 'na' (нет данных).
 * Критерии — TRS-398 Rev.1, табл. 3 и разд. 4.4.3.4; аддендум TG-51, табл. III; Report 374, прил. A.5.
 */
function checks(o, KS) {
  const c = [];
  const push = (id, status, label, value, ref) => c.push({ id, status, label, value, ref });
  const pct = (x, d = 2) => L(`${ru(x, d)} %`, `${ru(x, d)}%`);
  push('linear', o.maxDevPct <= o.tol + 1e-9 ? 'ok' : 'fail', L('Линейность графика в выбранной области', 'Linearity of the plot in the selected region'), L(`до ${pct(o.maxDevPct)} (допуск ${pct(o.tol, 2)})`, `up to ${pct(o.maxDevPct)} (tolerance ${pct(o.tol, 2)})`), `${REF.r374}, прил. A.5`);
  if (Number.isFinite(o.V1) && o.V1 > 0) {
    const inside = o.V1 >= o.vLow - 1e-9 && o.V1 <= o.vHigh + 1e-9;
    push('v1', inside ? 'ok' : 'fail', L('Рабочее напряжение V₁ в линейной области, не выше V_max', 'Working voltage V₁ in the linear region, not above V_max'), L(`${ru(o.V1, 0)} В; область ${ru(o.vLow, 0)}–${ru(o.vHigh, 0)} В`, `${ru(o.V1, 0)} V; region ${ru(o.vLow, 0)}–${ru(o.vHigh, 0)} V`), `${REF.r374}, разд. 4.4.4, прил. A.5`);
    if (Number.isFinite(o.vMan)) push('vman', o.V1 <= o.vMan + 1e-9 ? 'ok' : 'fail', L('V₁ не выше напряжения производителя', 'V₁ not above the manufacturer voltage'), L(`${ru(o.V1, 0)} В ≤ ${ru(o.vMan, 0)} В`, `${ru(o.V1, 0)} V ≤ ${ru(o.vMan, 0)} V`).replace('≤', o.V1 <= o.vMan + 1e-9 ? '≤' : '>'), `${REF.trs}, сноска 23`);
  }
  if (Number.isFinite(o.ks1)) push('ks', o.ks1 <= 1.05 ? 'ok' : 'fail', L(`${KS} при V₁ не больше 1,05`, `${KS} at V₁ not above 1.05`), ru(o.ks1, 4), `${REF.trs}, табл. 3`);
  push(
    'pol',
    o.opp ? (Math.abs(o.opp.diffPct) < 0.1 ? 'ok' : 'fail') : 'na',
    L(`${KS} при двух полярностях различается меньше чем на 0,1 %`, `${KS} at the two polarities differs by less than 0.1%`),
    o.opp ? pct(o.opp.diffPct) : L('нет показаний при обратной полярности', 'no opposite-polarity readings'),
    `${REF.trs}, табл. 3, сноска 25; ${REF.add}, табл. III`,
  );
  push(
    'two',
    o.two && Number.isFinite(o.two.diffPct) ? (Math.abs(o.two.diffPct) <= 0.1 ? 'ok' : 'fail') : 'na',
    L('Метод двух напряжений согласуется с графиком (в пределах 0,1 %)', 'The two-voltage method agrees with the plot (within 0.1%)'),
    o.two && Number.isFinite(o.two.diffPct) ? pct(o.two.diffPct) : L('V₂ не задано или нет показания при нём', 'V₂ not set or no reading at it'),
    `${REF.trs}, разд. 4.4.3.4`,
  );
  if (o.pulsed) {
    // по дозе за импульс (аддендум TG-51) или, если её нет, по ур. 17 TRS-398 (M₁/M₂ от M₁ при трёх и более условиях)
    const d = o.dpp?.fit ? o.dpp : null;
    const e = !d && o.eq17 && o.dpp.points.filter((p) => p.src === 'two').length >= 3 ? o.eq17 : null;
    const ci = d ? d.cInit : e ? e.cInit : NaN;
    push('cinit', Number.isFinite(ci) ? (ci < 0.002 ? 'ok' : 'fail') : 'na', L('Начальная рекомбинация меньше 0,2 %', 'Initial recombination below 0.2%'), Number.isFinite(ci) ? `${pct(ci * 100)}${e ? L(' (ур. 17)', ' (Eq. 17)') : ' (C_init)'}` : L('нужны три условия с разной дозой за импульс', 'three conditions with different dose per pulse are needed'), d ? `${REF.add}, табл. III; ${REF.trs}, табл. 3` : `${REF.trs}, табл. 3, ур. 17`);
    const lin = d ? d.maxDev <= 0.1 && d.cGen > 0 : e ? e.maxDev <= 0.1 && e.b1 > 0 : null;
    push('dpp', lin === null ? 'na' : lin ? 'ok' : 'fail', L(`${KS} линейно растёт с дозой за импульс`, `${KS} increases linearly with the dose per pulse`), d ? L(`отклонение до ${pct(d.maxDev, 3)}`, `deviation up to ${pct(d.maxDev, 3)}`) : e ? L(`отклонение до ${pct(e.maxDev, 3)} (ур. 17)`, `deviation up to ${pct(e.maxDev, 3)} (Eq. 17)`) : L('нет данных', 'no data'), d ? `${REF.add}, табл. III; ${REF.r374}, разд. 4.4.4` : `${REF.trs}, табл. 3, ур. 17`);
  } else if (o.axis === 'v') {
    push('cinit', Number.isFinite(o.cInit) ? (o.cInit < 0.002 ? 'ok' : 'fail') : 'na', L(`Начальная рекомбинация (${KS} − 1) меньше 0,2 %`, `Initial recombination (${KS} − 1) below 0.2%`), Number.isFinite(o.cInit) ? pct(o.cInit * 100) : '—', `${REF.trs}, табл. 3; ${REF.add}, табл. III`);
  }
  return c;
}

function finish(out) {
  const order = { error: 0, warn: 1, info: 2 };
  out.messages.sort((a, b) => order[a.level] - order[b.level]);
  out.hasErrors = out.messages.some((m) => m.level === 'error');
  out.blocked = out.hasErrors || !out.fit;
  return out;
}
