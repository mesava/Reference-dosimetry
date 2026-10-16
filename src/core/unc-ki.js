// Раскрытие строки «Поправки на влияющие величины k_i» бюджета TRS-398 по поправкам.
//
// В модели D_w,Q = M_Q·N_D,w·k_Q каждая поправка k_i — отдельная входная величина; в табл. 13, 17, 24 TRS-398 Rev.1 их
// неопределённость дана одной укрупнённой строкой (0,3 %). k_elec по разд. 4.4.3.2 тоже входит в ∏k_i. Так же раскрыты
// строки в аддендуме TG-51 (табл. II) и Report 385 (табл. 8): P_TP, влажность, P_elec, P_pol, P_ion, утечка,
// предварительное облучение, P_rp. Их значения из примера (i) — «типовые» для каждой поправки.
//
// У каждой поправки две части:
//   - по измерениям и приборам: k_pol и k_s — по сериям показаний (тип А: стандартное отклонение среднего,
//     распространение через формулу поправки), k_TP — по u(T) и u(P) приборов (тип B из свидетельств и разрешения);
//   - своя оценка (тип B): методическая часть — применимость метода, процедура, свидетельство электрометра и т. п.
// Принятое значение: если своя оценка введена — √(измерения² + своя²); иначе — большее из «по измерениям» и типового
// (типовое значение покрывает обе части; статистика одной серии его не уменьшает). Итог строки — сумма в квадратуре.

import { parseNumber, parseCells, isBlank, ru } from './units.js';
import { L } from './i18n.js';
import * as TRS from './trs398.js';

const ADD = 'аддендум TG-51 (2014), табл. II, пример (i)';
const R385 = 'Report 385, табл. 8, пример (i)';

/** Поправки и их типовые значения (%, k = 1) по пучку. */
export function kiFactors(beam) {
  const ref = beam === 'electrons' ? R385 : ADD;
  const list = [
    {
      key: 'kTP',
      label: L('Температура и давление k_TP', 'Temperature and pressure k_TP'),
      typ: 0.1,
      how: L(
        'По измерениям — из u(T) и u(P) термометра и барометра (поверка, разрешение, расхождение приборов): u_r² = (u(T)/(273,15 + T))² + (u(P)/P)². Своя оценка — тепловое равновесие воды и камеры, место измерения температуры.',
        'Measured part: from u(T) and u(P) of the thermometer and barometer (calibration, resolution, disagreement between instruments): u_r² = (u(T)/(273.15 + T))² + (u(P)/P)². Your estimate: thermal equilibrium of water and chamber, where the temperature is measured.',
      ),
    },
    {
      key: 'kh',
      label: L('Влажность', 'Humidity'),
      typ: 0.05,
      how: L('Относительная влажность 40–60 % — 0,05 %, 20–80 % — 0,15 % (аддендум TG-51, разд. 5.A.6).', 'Relative humidity 40–60% — 0.05%, 20–80% — 0.15% (TG-51 addendum, Sec. 5.A.6).'),
    },
    {
      key: 'kelec',
      label: L('Калибровка электрометра k_elec', 'Electrometer calibration k_elec'),
      typ: 0.07,
      how: L(
        'По свидетельству электрометра: U/k; если дан предел ±a — a/√3 (±0,5 % → 0,29 %). Если камера и электрометр откалиброваны вместе, k_elec = 1 и его неопределённость уже в N_D,w — введите 0 (TRS-398, разд. 4.4.3.2).',
        'From the electrometer certificate: U/k; if a limit ±a is given, a/√3 (±0.5% → 0.29%). If the chamber and electrometer were calibrated together, k_elec = 1 and its uncertainty is already in N_D,w: enter 0 (TRS-398, Sec. 4.4.3.2).',
      ),
    },
    {
      key: 'kpol',
      label: L('Полярность k_pol', 'Polarity k_pol'),
      typ: 0.05,
      how: L(
        'По измерениям — распространение по сериям M₊ и M₋. Своя оценка — процедура: выдержка после смены полярности, повтор первой полярности (аддендум TG-51, разд. 5.C.1).',
        'Measured part: propagated from the M₊ and M₋ series. Your estimate: the procedure, waiting after the polarity change and repeating the first polarity (TG-51 addendum, Sec. 5.C.1).',
      ),
    },
    {
      key: 'ks',
      label: L('Рекомбинация k_s', 'Recombination k_s'),
      typ: 0.1,
      how: L(
        'По измерениям — распространение по сериям при V₁ и V₂ через формулу k_s. Своя оценка — применимость метода двух напряжений к камере (поведение по теории, проверено графиком Яффе), начальная рекомбинация (аддендум TG-51, разд. 5.C.2).',
        'Measured part: propagated from the series at V₁ and V₂ through the k_s formula. Your estimate: whether the two-voltage method holds for the chamber (theory-like behaviour, checked with a Jaffé plot), initial recombination (TG-51 addendum, Sec. 5.C.2).',
      ),
    },
    {
      key: 'kleak',
      label: L('Утечка k_leak', 'Leakage k_leak'),
      typ: 0.05,
      how: L('Утечка не больше 0,1 % показания — k_leak = 1 с неопределённостью около 0,05–0,1 % (аддендум TG-51, разд. 5.C.4).', 'Leakage at or below 0.1% of the reading: k_leak = 1 with an uncertainty of about 0.05–0.1% (TG-51 addendum, Sec. 5.C.4).'),
    },
    {
      key: 'pre',
      label: L('Предварительное облучение', 'Pre-irradiation'),
      typ: 0.1,
      how: L('Камера облучена дозой больше 10 Гр, стабильность показаний проверена; без этого — до 1 % (аддендум TG-51, разд. 5.C.3).', 'Chamber irradiated to more than 10 Gy and stability of the readings checked; otherwise up to 1% (TG-51 addendum, Sec. 5.C.3).'),
    },
  ];
  if (beam === 'photons') {
    list.push({
      key: 'kvol',
      label: L('Усреднение по объёму k_vol', 'Volume averaging k_vol'),
      typ: 0.05,
      how: L('Пучок с выравнивающим фильтром — около 0,05 % (P_rp, аддендум TG-51, разд. 5.C.7); пучок БВФ — по оценке k_vol (формула, табл. 11 или профиль).', 'Flattened beam: about 0.05% (P_rp, TG-51 addendum, Sec. 5.C.7); FFF beam: from the k_vol estimate (formula, Table 11 or profile).'),
    });
  }
  return list.map((x) => ({ ...x, ref }));
}

/** Данные раскрытия из скрытого поля формы (JSON) или объекта. */
export function parseKi(v) {
  if (v && typeof v === 'object') return { ...v };
  if (isBlank(v)) return {};
  try {
    const o = JSON.parse(String(v));
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
}

/**
 * Разрешение по записи показаний: шаг последнего знака (18,39 → 0,01). Нули в конце при вводе часто опускают
 * (18,40 → 18,4), поэтому по нескольким сериям берётся самый мелкий шаг: resolutionOf(a, b, …).
 */
export function resolutionOf(...series) {
  const steps = series.map(stepOf).filter(Number.isFinite);
  return steps.length ? Math.min(...steps) : NaN;
}
function stepOf(cells) {
  let d = -1;
  for (const c of Array.isArray(cells) ? cells : []) {
    if (isBlank(c)) continue;
    const m = String(c).trim().match(/[.,](\d+)$/);
    d = Math.max(d, m ? m[1].length : 0);
  }
  return d < 0 ? NaN : 10 ** -d;
}

/**
 * Серия показаний: среднее и его стандартная неопределённость (тип А) — s/√m, где s — по всем n показаниям, m — число
 * показаний, усреднённых в результате (по умолчанию n); снизу ограничена разрешением прибора δ/√12 (GUM, F.2.2.1:
 * одинаковые показания не значат нулевой неопределённости). Возвращает null, если показаний меньше двух.
 */
export function seriesUncertainty(cells, { m = NaN, res } = {}) {
  const s = parseCells(cells);
  if (s.error || !(s.n >= 2) || !Number.isFinite(s.mean) || s.mean === 0) return null;
  const mm = Number.isFinite(m) && m >= 1 ? m : s.n;
  // res не задано — по записи этой серии; задано, но не число (NaN) — без границы по разрешению
  const delta = res === undefined ? resolutionOf(cells) : Number.isFinite(res) && res > 0 ? res : NaN;
  const uStat = s.sd / Math.sqrt(mm);
  const uRes = Number.isFinite(delta) ? delta / Math.sqrt(12) : 0;
  const u = Math.max(uStat, uRes);
  return { n: s.n, m: mm, mean: s.mean, s: s.sd, res: delta, uStat, uRes, u, fromRes: uRes > uStat, rel: Math.abs(u / s.mean) };
}

/** k_s по отношению показаний r = M₁/M₂ — той же формулой, что вкладка дозиметрии. */
function ksAt(eq, r) {
  if (!eq) return NaN;
  if (eq.kind === 'eq16') return (eq.n * eq.n - 1) / (eq.n * eq.n - r);
  const x = TRS.ks({ m1: r, m2: 1, v1: eq.v1, v2: eq.v2, beam: eq.beam || 'pulsed' });
  return x.error ? NaN : x.value;
}

/**
 * Части «по измерениям» для k_pol, k_s, k_TP. series: { Mp, Mm, M1, M2, ks: { kind: 'trs', v1, v2, beam } | { kind: 'eq16', n } }
 * (Mp — обычная полярность при V₁, Mm — обратная, M2 — при V₂; M1 — при V₁, по умолчанию Mp).
 */
export function kiMeasured(spec, { res } = {}) {
  const out = {};
  const sr = spec.series || {};
  const a = seriesUncertainty(sr.Mp, { res });
  const b = seriesUncertainty(sr.Mm, { res });
  // обычная и обратная полярность — показания разного знака; при одном знаке это не пара для k_pol
  if (a && b && Math.sign(a.mean) !== Math.sign(b.mean)) {
    const A = Math.abs(a.mean);
    const B = Math.abs(b.mean);
    const k = (A + B) / (2 * A);
    const u = Math.hypot((B / (2 * A * A)) * a.u, b.u / (2 * A));
    out.kpol = {
      pct: (u / k) * 100,
      how: L(`по сериям M₊ (${a.n}) и M₋ (${b.n}): k_pol = ${ru(k, 5)}`, `from the M₊ (${a.n}) and M₋ (${b.n}) series: k_pol = ${ru(k, 5)}`),
    };
  }
  const c1 = seriesUncertainty(sr.M1 ?? sr.Mp, { res });
  const c2 = seriesUncertainty(sr.M2, { res });
  // показания при V₁ и V₂ одного знака, M₁ ≥ M₂ — иначе вкладка дозиметрии сама выдаёт ошибку
  if (c1 && c2 && sr.ks && Math.sign(c1.mean) === Math.sign(c2.mean) && Math.abs(c1.mean) >= Math.abs(c2.mean)) {
    const r = Math.abs(c1.mean) / Math.abs(c2.mean);
    const ur = r * Math.hypot(c1.rel, c2.rel);
    const k = ksAt(sr.ks, r);
    const h = 1e-6;
    const d = (ksAt(sr.ks, r + h) - ksAt(sr.ks, r - h)) / (2 * h);
    if (Number.isFinite(k) && Number.isFinite(d)) {
      out.ks = {
        pct: ((Math.abs(d) * ur) / k) * 100,
        how: L(`по сериям при V₁ (${c1.n}) и V₂ (${c2.n}): M₁/M₂ = ${ru(r, 5)}, k_s = ${ru(k, 5)}`, `from the series at V₁ (${c1.n}) and V₂ (${c2.n}): M₁/M₂ = ${ru(r, 5)}, k_s = ${ru(k, 5)}`),
      };
    }
  }
  const ok = (x) => Number.isFinite(x) && x >= 0;
  const uT = parseNumber(spec.uT);
  const uP = parseNumber(spec.uP);
  if (ok(uT) || ok(uP)) {
    const T = Number.isFinite(sr.T) ? sr.T : 20;
    const P = Number.isFinite(sr.P) && sr.P > 0 ? sr.P : 101.325;
    const pct = Math.hypot(ok(uT) ? uT / (273.15 + T) : 0, ok(uP) ? uP / P : 0) * 100;
    out.kTP = {
      pct,
      how: L(`по u(T) = ${ok(uT) ? ru(uT, 2) : '—'} °C и u(P) = ${ok(uP) ? ru(uP, 3) : '—'} кПа при T = ${ru(T, 1)} °C, P = ${ru(P, 2)} кПа`, `from u(T) = ${ok(uT) ? ru(uT, 2) : '—'} °C and u(P) = ${ok(uP) ? ru(uP, 3) : '—'} kPa at T = ${ru(T, 1)} °C, P = ${ru(P, 2)} kPa`),
    };
  }
  return out;
}

/**
 * Раскрытие k_i. spec — данные раскрытия: { on, uT, uP, series, own: { ключ: строка } }; res — разрешение прибора, нКл.
 * Возвращает { factors, pct, messages } или null, если раскрытие выключено.
 */
export function kiBreakdown(beam, specIn, { res } = {}) {
  const spec = parseKi(specIn);
  if (!spec.on) return null;
  const meas = kiMeasured(spec, { res });
  const own = spec.own && typeof spec.own === 'object' ? spec.own : {};
  const messages = [];
  for (const [k, name] of [['uT', 'u(T)'], ['uP', 'u(P)']]) {
    if (isBlank(spec[k])) continue;
    const x = parseNumber(spec[k]);
    if (!Number.isFinite(x) || x < 0) messages.push({ level: 'warn', text: L(`Раскрытие k_i: ${name} «${spec[k]}» не прочитано — нужно неотрицательное число.`, `k_i breakdown: ${name} "${spec[k]}" could not be read; a non-negative number is needed.`), field: `unc_ki_${k}` });
  }
  const typical = [];
  const factors = kiFactors(beam).map((f) => {
    const m = meas[f.key];
    const raw = own[f.key];
    let o = NaN;
    let invalid = false;
    if (!isBlank(raw)) {
      o = parseNumber(raw);
      if (!Number.isFinite(o) || o < 0) {
        invalid = true;
        o = NaN;
        messages.push({ level: 'warn', text: L(`k_i, «${f.label}»: своя оценка «${raw}» не прочитана — взято типовое значение.`, `k_i, "${f.label}": your estimate "${raw}" could not be read; the typical value is used.`), field: `unc_ki_own_${f.key}` });
      }
    }
    const mp = m ? m.pct : NaN;
    let value;
    let basis;
    if (Number.isFinite(o)) {
      value = Math.hypot(Number.isFinite(mp) ? mp : 0, o);
      basis = Number.isFinite(mp) ? 'both' : 'own';
    } else if (Number.isFinite(mp) && mp > f.typ) {
      value = mp;
      basis = 'meas';
    } else {
      value = f.typ;
      basis = 'typ';
      typical.push(f.label);
    }
    return { ...f, meas: Number.isFinite(mp) ? mp : NaN, measHow: m?.how ?? '', own: o, ownRaw: isBlank(raw) ? '' : String(raw), invalid, value, basis };
  });
  if (typical.length) {
    messages.push({
      level: 'info',
      text: L(
        `Раскрытие k_i: без своей оценки (тип B) взяты типовые значения примера (i) ${beam === 'electrons' ? 'Report 385' : 'аддендума TG-51'} — они предполагают тщательную процедуру. ${typical.join(', ')}.`,
        `k_i breakdown: where there is no estimate of your own (type B), the typical values of example (i) of the ${beam === 'electrons' ? 'Report 385' : 'TG-51 addendum'} are used; they assume a careful procedure. ${typical.join(', ')}.`,
      ),
    });
  }
  const pct = Math.sqrt(factors.reduce((s, f) => s + f.value * f.value, 0));
  return { factors, pct, messages, measured: meas };
}
