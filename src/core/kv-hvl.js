// СПО режима по измерению на листе «СПО и k_Q» вкладки «kV-рентген» (с 0.43.0) и набор пластин для него.
// TRS-398 Rev.1, разд. 8.3.2 (низкие энергии, мм Al) и 9.3.2 (средние, мм Al или Cu; в программе СПО средних энергий —
// в мм Cu): СПО — толщина поглотителя, ослабляющая узкий пучок до половины воздушной кермы падающего пучка; толщина,
// вдвое снижающая показание, находится интерполяцией, предпочтительно экспоненциальной функцией. Здесь — по двум
// толщинам x₁ и x₂ по обе стороны от половины (как в методике учреждения пользователя, лист «СПО»):
//   СПО = x₁ + (ln(D̄₀/2) − ln D̄₁)·(x₂ − x₁)/(ln D̄₂ − ln D̄₁),
// D̄₀ — среднее показание без фильтров, D̄₁ и D̄₂ — с фильтрами x₁ и x₂ (показания в любых одинаковых единицах).
// Неопределённость — по закону распространения: вклады u_A средних D̄₀, D̄₁, D̄₂, u(x₁), u(x₂) и ковариация
// cov(x₁, x₂) общих пластин; U = k·u_c при k = 2. Толщина набирается из пластин набора («Al1+Al2+Al8»): x — сумма
// измеренных толщин, u²(x) — сумма u²(t), cov(x₁, x₂) — сумма u²(t) пластин, входящих в обе толщины. Или вводится
// числом, тогда u(x) и cov — вручную.
// Допуски (u_A среднего, удаление D̄₁ и D̄₂ от D̄₀/2, расхождение контрольного D₀) — по методике учреждения, в Rev.1
// чисел нет; пусто — без проверки. Интерполяция, а не экстраполяция (D̄₀/2 между D̄₁ и D̄₂), проверяется всегда.
import { parseNumber, parseCells, isBlank, ru } from './units.js';
import { L } from './i18n.js';

const REF = { low: 'TRS-398 Rev.1, разд. 8.3.2', medium: 'TRS-398 Rev.1, разд. 9.3.2' };

/** Показания измерения СПО: без фильтров, с x₁, с x₂ и контрольное без фильтров в конце. */
export const KV_HVL_SERIES = ['kv_hl_D0', 'kv_hl_D1', 'kv_hl_D2', 'kv_hl_Dc'];
/** Набор пластин (общий для всех режимов): обозначение, материал, номинальная и измеренная толщина, u(t), мм. */
export const KV_PLATE_KEYS = ['kv_pl_name', 'kv_pl_mat', 'kv_pl_nom', 'kv_pl_t', 'kv_pl_u'];
/** Допуски измерения СПО по методике учреждения (общие): u_A среднего, %; D̄₁ и D̄₂ от D̄₀/2, %; контрольный D₀, %. */
export const KV_HVL_TOL_KEYS = ['kv_hl_ua_tol', 'kv_hl_band_tol', 'kv_hl_ctrl_tol'];
/** Поля измерения СПО режима (новый режим их не копирует, кроме расстояния, поля и флажка «в расчёт»). */
export const KV_HVL_OWN_KEYS = ['kv_hl_x1', 'kv_hl_x2', 'kv_hl_ux1', 'kv_hl_ux2', 'kv_hl_cov', ...KV_HVL_SERIES];

const str = (v) => (v === undefined || v === null ? '' : String(v));
const keyOf = (name) => str(name).trim().toLowerCase().replace(/\s+/g, '');

/** Знаков после запятой у СПО: не меньше трёх и не меньше трёх значащих цифр (1,143; 0,122; 0,0523). */
export const hvlDecimals = (v) => (Number.isFinite(v) && v > 0 ? Math.min(6, Math.max(3, 2 - Math.floor(Math.log10(v)))) : 3);
/** СПО, округлённый так, как он записывается в режим и в «Оборудование». */
export const hvlRound = (v) => {
  const d = hvlDecimals(v);
  return Math.round(v * 10 ** d) / 10 ** d;
};
/** СПО текстом с точкой: «1.143» — для записи в «Оборудование». */
export const hvlText = (v) => (Number.isFinite(v) ? hvlRound(v).toFixed(hvlDecimals(v)) : '');

/** Массив поля набора пластин той же длины, что и самый длинный. */
function plateColumns(f) {
  const n = Math.max(0, ...KV_PLATE_KEYS.map((k) => (Array.isArray(f?.[k]) ? f[k].length : 0)));
  const col = (k) => Array.from({ length: n }, (_, i) => str(Array.isArray(f?.[k]) ? f[k][i] : ''));
  return { n, name: col('kv_pl_name'), mat: col('kv_pl_mat'), nom: col('kv_pl_nom'), t: col('kv_pl_t'), u: col('kv_pl_u') };
}

/**
 * Набор пластин формы: { plates, byKey, errors, notes }. plates[k] = { row (с 1), name, key, mat ('Al'|'Cu'), t (мм —
 * измеренная, а без неё номинальная), nominal, u (мм; NaN — не введена), measured (введена ли измеренная) }. Пустые
 * строки пропускаются. errors — строки с ошибками (нет обозначения, толщины, повтор обозначения): такие пластины в
 * толщины не берутся; notes — справки (толщина взята номинальная).
 */
export function kvPlateSet(f) {
  const c = plateColumns(f);
  const plates = [];
  const byKey = new Map();
  const errors = [];
  const notes = [];
  for (let i = 0; i < c.n; i++) {
    if ([c.name[i], c.nom[i], c.t[i], c.u[i]].every(isBlank)) continue;
    const row = i + 1;
    const name = c.name[i].trim();
    const key = keyOf(name);
    const mat = c.mat[i] === 'Cu' ? 'Cu' : 'Al';
    const nominal = parseNumber(c.nom[i]);
    const tm = parseNumber(c.t[i]);
    const u = isBlank(c.u[i]) ? NaN : parseNumber(c.u[i]);
    const p = { row, name, key, mat, nominal, t: Number.isFinite(tm) ? tm : nominal, u, measured: Number.isFinite(tm) };
    if (!key) {
      errors.push({ row, text: L(`пластина в строке ${row} без обозначения`, `the plate in row ${row} has no name`) });
      continue;
    }
    if (key.includes('+')) {
      errors.push({ row, text: L(`обозначение «${name}» со знаком «+»: им складываются пластины`, `the name “${name}” contains “+”, which adds plates up`) });
      continue;
    }
    if (byKey.has(key)) {
      errors.push({ row, text: L(`обозначение «${name}» повторяется (строки ${byKey.get(key).row} и ${row})`, `the name “${name}” is repeated (rows ${byKey.get(key).row} and ${row})`) });
      continue;
    }
    if ((!isBlank(c.t[i]) && !Number.isFinite(tm)) || (!isBlank(c.nom[i]) && !Number.isFinite(nominal)) || (!isBlank(c.u[i]) && !Number.isFinite(u))) {
      errors.push({ row, text: L(`пластина ${name}: не удалось прочитать число`, `plate ${name}: could not read a number`) });
      continue;
    }
    if (!(p.t > 0)) {
      errors.push({ row, text: L(`пластина ${name}: нет толщины`, `plate ${name}: no thickness`) });
      continue;
    }
    if (Number.isFinite(u) && u < 0) {
      errors.push({ row, text: L(`пластина ${name}: u(t) не может быть отрицательной`, `plate ${name}: u(t) cannot be negative`) });
      continue;
    }
    if (!p.measured) notes.push(name);
    plates.push(p);
    byKey.set(key, p);
  }
  return { plates, byKey, errors, notes };
}

/**
 * Толщина поглотителя: число в мм или сумма пластин набора («Al1+Al2+Al8», регистр и пробелы не важны).
 * Возвращает { blank, value, u2 (NaN — неизвестна), plates (ключи), from: 'number'|'plates', error, uMissing }.
 */
export function parseThickness(text, set, mat) {
  const s = str(text).trim();
  if (!s) return { blank: true, value: NaN, u2: NaN, plates: [], from: '' };
  const v = parseNumber(s);
  if (Number.isFinite(v)) return { value: v, u2: NaN, plates: [], from: 'number', error: v > 0 ? null : L('толщина должна быть больше нуля', 'the thickness must be greater than zero') };
  const parts = s.split('+').map((x) => x.trim()).filter(Boolean);
  const keys = parts.map(keyOf);
  const out = { value: 0, u2: 0, plates: keys, names: [], from: 'plates', error: null, uMissing: [] };
  const fail = (t) => ({ ...out, value: NaN, u2: NaN, error: t });
  if (!parts.length) return fail(L(`не удалось прочитать «${s}»: число в мм или пластины через «+»`, `could not read “${s}”: a number in mm or plates joined by “+”`));
  const seen = new Set();
  for (let i = 0; i < keys.length; i++) {
    const p = set.byKey.get(keys[i]);
    if (!p) {
      const bad = set.errors.length && !set.plates.some((x) => x.key === keys[i]);
      return fail(bad ? L(`пластины «${parts[i]}» нет в наборе или в её строке ошибка`, `the plate “${parts[i]}” is not in the set or its row has an error`) : L(`пластины «${parts[i]}» нет в наборе`, `the plate “${parts[i]}” is not in the set`));
    }
    if (seen.has(keys[i])) return fail(L(`пластина ${p.name} указана дважды`, `the plate ${p.name} is listed twice`));
    seen.add(keys[i]);
    if (mat && p.mat !== mat) return fail(L(`пластина ${p.name} — ${p.mat}, а СПО режима — в мм ${mat}`, `the plate ${p.name} is ${p.mat} while the HVL of the mode is in mm ${mat}`));
    out.value += p.t;
    out.names.push(p.name);
    if (Number.isFinite(p.u)) out.u2 += p.u * p.u;
    else out.uMissing.push(p.name);
  }
  if (out.uMissing.length) out.u2 = out.uMissing.length === keys.length ? NaN : out.u2;
  return out;
}

/** Ковариация толщин из пластин: сумма u²(t) пластин, входящих в обе толщины. */
function plateCov(a, b, set) {
  let cov = 0;
  for (const k of a.plates) {
    if (!b.plates.includes(k)) continue;
    const u = set.byKey.get(k)?.u;
    if (Number.isFinite(u)) cov += u * u;
  }
  return cov;
}

const pct = (x, d = 2) => ru(x * 100, d);
const tol = (f, k) => {
  const v = parseNumber(f?.[k]);
  return Number.isFinite(v) && v > 0 ? v : NaN;
};
const tolText = (x) => ru(x, Number.isInteger(x) ? 0 : Number.isInteger(x * 10) ? 1 : 2);

/** Есть ли в режиме данные измерения СПО (хотя бы одно показание или толщина). */
export function kvHvlEntered(f) {
  return KV_HVL_SERIES.some((k) => parseCells(f?.[k]).n > 0 || !!parseCells(f?.[k]).error) || ['kv_hl_x1', 'kv_hl_x2'].some((k) => !isBlank(f?.[k]));
}

/**
 * СПО режима по измерению. f — форма режима (общие поля, в том числе набор пластин и допуски, и поля режима).
 * Возвращает { state: 'empty'|'error'|'done', range, mat, series: { D0, D1, D2, Dc } (parseCells + u — u_A среднего,
 * urel), x1, x2 (parseThickness + u), cov, half (D̄₀/2), r1 и r2 (D̄ᵢ/(D̄₀/2)), A, hvl, used (округлённый СПО), uc, U,
 * k, budget [{ key, value, u, c, contrib }], ctrlPct, bracket, messages [{ level, text, ref, field }], flags, ok, apply }.
 * ok — СПО вычислен без ошибок; apply — и отмечено «в расчёт режима».
 */
export function computeKvHvl(f) {
  const range = f?.kv_range === 'medium' ? 'medium' : 'low';
  const mat = range === 'medium' ? 'Cu' : 'Al';
  const ref = REF[range];
  const messages = [];
  const flags = {};
  const rank = { info: 0, warn: 1, error: 2 };
  const add = (level, text, field = null, r = null) => {
    messages.push({ level, text, ref: r });
    for (const k of [].concat(field ?? [])) if (!flags[k] || rank[level] > rank[flags[k]]) flags[k] = level;
  };
  const res = { state: 'empty', range, mat, messages, flags, k: 2, ok: false, apply: false, hvl: NaN, used: NaN, U: NaN, uc: NaN, budget: [] };
  if (!kvHvlEntered(f)) return res;
  res.state = 'done';
  const set = kvPlateSet(f);
  const names = { kv_hl_D0: L('D₀ — без фильтров', 'D₀, no filters'), kv_hl_D1: L('D₁ — с фильтром x₁', 'D₁, with filter x₁'), kv_hl_D2: L('D₂ — с фильтром x₂', 'D₂, with filter x₂'), kv_hl_Dc: L('контрольный D₀', 'control D₀') };
  const series = {};
  for (const key of KV_HVL_SERIES) {
    const s = parseCells(f[key]);
    const mean = Math.abs(s.mean);
    const u = s.n > 1 ? s.sd / Math.sqrt(s.n) : NaN;
    series[key.slice(6)] = { ...s, abs: mean, u, urel: mean > 0 ? u / mean : NaN };
    if (s.error) add('error', L(`«${names[key]}»: ${s.error}.`, `“${names[key]}”: ${s.error}.`), key);
    else if (s.n === 0 && key !== 'kv_hl_Dc') add('error', L(`Не заполнено поле «${names[key]}».`, `Field “${names[key]}” is empty.`), key);
    else if (s.n > 0 && s.mean === 0) add('error', L(`«${names[key]}»: среднее показание равно нулю.`, `“${names[key]}”: the mean reading is zero.`), key);
  }
  res.series = series;
  const { D0, D1, D2, Dc } = series;
  const okS = (s) => s.n > 0 && !s.error && s.mean !== 0;
  // показания одного знака: полярность одна во всех сериях
  const signs = [D0, D1, D2, Dc].filter(okS).map((s) => Math.sign(s.mean));
  if (new Set(signs).size > 1) add('error', L('Показания разного знака: все серии снимаются при одной полярности.', 'Readings of different sign: all series are taken at the same polarity.'), KV_HVL_SERIES.filter((k) => okS(series[k.slice(6)])));
  // u_A средних: одна ячейка — не оценить; больше допуска — предупреждение
  const uaTol = tol(f, 'kv_hl_ua_tol');
  for (const key of KV_HVL_SERIES) {
    const s = series[key.slice(6)];
    if (!okS(s)) continue;
    if (s.n === 1) add('info', L(`«${names[key]}»: одно показание — u_A среднего не оценить, его вклад в неопределённость не учтён.`, `“${names[key]}”: a single reading; u_A of the mean cannot be estimated and is not included in the uncertainty.`), key);
    else if (Number.isFinite(uaTol) && s.urel * 100 > uaTol) add('warn', L(`«${names[key]}»: u_A среднего ${pct(s.urel)} % — больше допуска ${tolText(uaTol)} % (по методике учреждения). Повторите облучения.`, `“${names[key]}”: u_A of the mean is ${pct(s.urel)} %, above the tolerance of ${tolText(uaTol)} % (local procedure). Repeat the exposures.`), key);
  }

  // толщины
  const th = {};
  for (const [k, uk] of [['kv_hl_x1', 'kv_hl_ux1'], ['kv_hl_x2', 'kv_hl_ux2']]) {
    const x = parseThickness(f[k], set, mat);
    const sym = k === 'kv_hl_x1' ? 'x₁' : 'x₂';
    if (x.blank) add('error', L(`Не заполнена толщина ${sym}: число в мм ${mat} или пластины набора через «+».`, `The thickness ${sym} is empty: a number in mm ${mat} or plates of the set joined by “+”.`), k);
    else if (x.error) add('error', L(`Толщина ${sym}: ${x.error}.`, `Thickness ${sym}: ${x.error}.`), k);
    if (x.from === 'number') {
      const u = isBlank(f[uk]) ? NaN : parseNumber(f[uk]);
      if (!isBlank(f[uk]) && !(u >= 0)) add('error', L(`u(${sym}): нужно неотрицательное число в мм.`, `u(${sym}): a non-negative number in mm is required.`), uk);
      x.u2 = u >= 0 ? u * u : NaN;
    }
    x.u = Math.sqrt(x.u2);
    if (!x.error && !x.blank && !Number.isFinite(x.u2)) {
      add('info', x.from === 'plates'
        ? L(`У пластин ${sym} (${x.names.join(', ')}) нет u(t): вклад толщины ${sym} в неопределённость не учтён.`, `The plates of ${sym} (${x.names.join(', ')}) have no u(t): the contribution of ${sym} to the uncertainty is not included.`)
        : L(`u(${sym}) не введена: вклад толщины ${sym} в неопределённость не учтён.`, `u(${sym}) is not entered: the contribution of ${sym} to the uncertainty is not included.`), x.from === 'number' ? uk : k);
    } else if (x.from === 'plates' && x.uMissing?.length) {
      add('info', L(`У пластин ${x.uMissing.join(', ')} (${sym}) нет u(t): их вклад не учтён.`, `The plates ${x.uMissing.join(', ')} (${sym}) have no u(t): their contribution is not included.`), k);
    }
    th[k === 'kv_hl_x1' ? 'x1' : 'x2'] = x;
  }
  const { x1, x2 } = th;
  res.x1 = x1;
  res.x2 = x2;
  // ковариация: общие пластины — из набора; числом — вручную
  let cov = 0;
  if (x1.from === 'plates' && x2.from === 'plates') cov = plateCov(x1, x2, set);
  else if (!isBlank(f.kv_hl_cov)) {
    cov = parseNumber(f.kv_hl_cov);
    if (!Number.isFinite(cov)) {
      add('error', L('cov(x₁, x₂): не удалось прочитать число (мм²).', 'cov(x₁, x₂): could not read the number (mm²).'), 'kv_hl_cov');
      cov = 0;
    }
  }
  res.cov = cov;
  const notes = set.notes.filter((n) => [...(x1.names ?? []), ...(x2.names ?? [])].includes(n));
  if (notes.length) add('info', L(`У пластин ${notes.join(', ')} нет измеренной толщины: взята номинальная.`, `The plates ${notes.join(', ')} have no measured thickness: the nominal one is used.`), ['kv_hl_x1', 'kv_hl_x2']);

  const haveD = okS(D0) && okS(D1) && okS(D2) && new Set(signs).size <= 1;
  const haveX = Number.isFinite(x1.value) && Number.isFinite(x2.value) && x1.value > 0 && x2.value > 0;
  if (haveD) {
    res.half = D0.abs / 2;
    res.r1 = D1.abs / res.half;
    res.r2 = D2.abs / res.half;
  }
  if (okS(D0) && okS(Dc) && new Set(signs).size <= 1) {
    res.ctrlPct = (Dc.abs / D0.abs - 1) * 100;
    const ct = tol(f, 'kv_hl_ctrl_tol');
    const t = L(`Контрольный D₀ в конце отличается от начального на ${ru(res.ctrlPct, 2).replace(/^(?=\d)/, '+')} %`, `The control D₀ at the end differs from the initial one by ${ru(res.ctrlPct, 2).replace(/^(?=\d)/, '+')} %`);
    if (Number.isFinite(ct) && Math.abs(res.ctrlPct) > ct) add('warn', L(`${t} — больше допуска ${tolText(ct)} % (по методике учреждения): выход аппарата менялся во время измерений, повторите их.`, `${t}, above the tolerance of ${tolText(ct)} % (local procedure): the output changed during the measurements; repeat them.`), 'kv_hl_Dc', ref);
    else add('info', `${t}.`, null, ref);
  } else if (okS(D0) && Dc.n === 0) {
    add('info', range === 'medium'
      ? L('Контрольного D₀ нет. Без камеры-монитора Rev.1 советует мерить без фильтров в начале, в середине и в конце измерений, чтобы видеть колебания выхода.', 'No control D₀. Without a monitor chamber, Rev.1 advises measuring without filters at the beginning, middle and end of the measurements to see output fluctuations.')
      : L('Контрольного D₀ нет. Без камеры-монитора Rev.1 советует мерить без фильтров в начале и в конце измерений, чтобы видеть колебания выхода.', 'No control D₀. Without a monitor chamber, Rev.1 advises measuring without filters at the beginning and end of the measurements to see output fluctuations.'), null, ref);
  }
  if (!haveD || !haveX || messages.some((m) => m.level === 'error')) {
    res.state = messages.some((m) => m.level === 'error') ? 'error' : 'done';
    return res;
  }

  // проверки ослабления
  if (Math.abs(x2.value - x1.value) < 1e-12) {
    add('error', L('Толщины x₁ и x₂ одинаковые: нужны две разные толщины по обе стороны от СПО.', 'The thicknesses x₁ and x₂ are equal: two different thicknesses on either side of the HVL are required.'), ['kv_hl_x1', 'kv_hl_x2']);
  } else if (Math.abs(D2.abs - D1.abs) < 1e-12 * D0.abs) {
    add('error', L('D̄₁ и D̄₂ одинаковые: по ним СПО не найти.', 'D̄₁ and D̄₂ are equal: the HVL cannot be found from them.'), ['kv_hl_D1', 'kv_hl_D2']);
  } else if ((x2.value - x1.value) * (D2.abs - D1.abs) > 0) {
    add('error', L('С большей толщиной показание больше: проверьте, какие показания к какой толщине относятся.', 'The reading is larger with the thicker filter: check which readings belong to which thickness.'), ['kv_hl_D1', 'kv_hl_D2', 'kv_hl_x1', 'kv_hl_x2']);
  }
  for (const [s, k] of [[D1, 'kv_hl_D1'], [D2, 'kv_hl_D2']]) {
    if (s.abs >= D0.abs) add('error', L(`«${names[k]}»: с фильтром показание не меньше, чем без него (D̄₀): проверьте ввод.`, `“${names[k]}”: the reading with the filter is not smaller than without it (D̄₀); check the input.`), k);
  }
  if (messages.some((m) => m.level === 'error')) {
    res.state = 'error';
    return res;
  }

  // СПО и бюджет неопределённости
  const dx = x2.value - x1.value;
  const Z = Math.log(D2.abs) - Math.log(D1.abs);
  const A = (Math.log(res.half) - Math.log(D1.abs)) / Z;
  res.A = A;
  res.hvl = x1.value + A * dx;
  res.used = hvlRound(res.hvl);
  const u0 = (s) => (Number.isFinite(s.u) ? s.u : 0);
  const ux = (x) => (Number.isFinite(x.u2) ? Math.sqrt(x.u2) : 0);
  const rows = [
    { key: 'D0', value: D0.abs, u: u0(D0), c: dx / (Z * D0.abs) },
    { key: 'D1', value: D1.abs, u: u0(D1), c: (dx * (A - 1)) / (Z * D1.abs) },
    { key: 'D2', value: D2.abs, u: u0(D2), c: (-dx * A) / (Z * D2.abs) },
    { key: 'x1', value: x1.value, u: ux(x1), c: 1 - A },
    { key: 'x2', value: x2.value, u: ux(x2), c: A },
  ].map((r) => ({ ...r, contrib: (r.c * r.u) ** 2 }));
  rows.push({ key: 'cov', value: cov, u: NaN, c: 2 * A * (1 - A), contrib: 2 * A * (1 - A) * cov });
  res.budget = rows;
  const sum = rows.reduce((a, r) => a + r.contrib, 0);
  res.uc = Math.sqrt(Math.max(0, sum));
  res.U = res.k * res.uc;

  // интерполяция, а не экстраполяция; удаление от D̄₀/2 — по методике учреждения
  res.bracket = (D1.abs - res.half) * (D2.abs - res.half) <= 0;
  if (!res.bracket) {
    add('warn', L(
      `D̄₀/2 не лежит между D̄₁ и D̄₂ (D̄₁ = ${pct(res.r1, 1)} %, D̄₂ = ${pct(res.r2, 1)} % от D̄₀/2): СПО найден экстраполяцией. Подберите толщины так, чтобы одно показание было выше половины, а другое ниже.`,
      `D̄₀/2 is not between D̄₁ and D̄₂ (D̄₁ = ${pct(res.r1, 1)} %, D̄₂ = ${pct(res.r2, 1)} % of D̄₀/2): the HVL is extrapolated. Choose thicknesses so that one reading is above half and the other below.`,
    ), ['kv_hl_D1', 'kv_hl_D2', 'kv_hl_x1', 'kv_hl_x2'], ref);
  }
  // правдоподобие: пучок ужесточается с толщиной, поэтому ослабление на мм между x₁ и x₂ не больше среднего от 0 до
  // меньшей толщины (μ_лок ≤ μ_ср). Заметно больше (с запасом 10 % и 3σ от u_A показаний) — толщины не те, что стояли
  // в пучке, или показания перепутаны. Проверка программы, не требование Rev.1.
  {
    const [a, b] = x1.value < x2.value ? [[x1, D1], [x2, D2]] : [[x2, D2], [x1, D1]];
    const muAvg = Math.log(D0.abs / a[1].abs) / a[0].value;
    const muLoc = Math.log(a[1].abs / b[1].abs) / (b[0].value - a[0].value);
    const relU = (s) => (Number.isFinite(s.urel) ? s.urel : 0);
    const sq = Math.hypot(relU(a[1]), relU(b[1])) / ((b[0].value - a[0].value) * muAvg);
    res.muRatio = muLoc / muAvg;
    if (muAvg > 0 && res.muRatio > 1.1 + 3 * sq) {
      add('warn', L(
        `Ослабление между x₁ и x₂ (${ru(muLoc, 3)} на мм) в ${ru(res.muRatio, 1)} раза сильнее среднего от 0 до ${ru(a[0].value, 3)} мм (${ru(muAvg, 3)} на мм). Пучок с толщиной ужесточается, и так не бывает: проверьте, те ли пластины стояли в пучке при D₁ и D₂ и не перепутаны ли показания.`,
        `The attenuation between x₁ and x₂ (${ru(muLoc, 3)} per mm) is ${ru(res.muRatio, 1)} times the mean from 0 to ${ru(a[0].value, 3)} mm (${ru(muAvg, 3)} per mm). The beam hardens with depth, so this cannot happen: check that these plates were in the beam for D₁ and D₂ and that the readings are not swapped.`,
      ), ['kv_hl_x1', 'kv_hl_x2', 'kv_hl_D1', 'kv_hl_D2']);
    }
  }
  const band = tol(f, 'kv_hl_band_tol');
  if (Number.isFinite(band)) {
    const far = [[res.r1, 'kv_hl_D1', 'D̄₁'], [res.r2, 'kv_hl_D2', 'D̄₂']].filter(([r]) => Math.abs(r - 1) * 100 > band + 1e-9);
    if (far.length) {
      add('warn', L(
        `${far.map(([r, , s]) => `${s} отличается от D̄₀/2 на ${ru((r - 1) * 100, 1).replace(/^(?=\d)/, '+')} %`).join(', ')} — больше ${tolText(band)} % (по методике учреждения): возьмите толщины ближе к СПО.`,
        `${far.map(([r, , s]) => `${s} differs from D̄₀/2 by ${ru((r - 1) * 100, 1).replace(/^(?=\d)/, '+')} %`).join(', ')}, more than ${tolText(band)} % (local procedure): take thicknesses closer to the HVL.`,
      ), far.map(([, k]) => k));
    }
  }
  const nominal = parseNumber(f.kv_hvl);
  if (Number.isFinite(nominal) && nominal > 0) {
    res.nominal = nominal;
    res.diffPct = (res.used / nominal - 1) * 100;
  }
  res.ok = true;
  res.apply = f.kv_hl_apply !== false && f.kv_hl_apply !== 'false';
  return res;
}
