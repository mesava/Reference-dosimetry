// Лист «Сводка и протокол» вкладки «kV-рентген» (с 0.45.0): данные для таблицы мощности дозы «аппликатор × режим»
// (как форма «Сводная» учреждения) и для протокола измерений (как форма «Протокол измерений»): проверка радиационного
// выхода — измеренная мощность дозы каждой строки аппликаторов против базового значения (поле «Сравнить с» строки)
// с допуском вкладки, и итоги остальных листов (СПО, ошибка таймера, линейность, воспроизводимость). Новых расчётов
// здесь нет: всё берётся из итогов computeKvVisit; отклонение — D/D_баз − 1, как в разделе 8 и сводке по режимам.
// Решение о калибровке — по допуску учреждения (в TRS-398 Rev.1 допуска на выход нет).
import { parseNumber, parseCells, isBlank } from './units.js';
import { kvRowLabel, kvRowEmpty, kvModeLabel } from './kv-session.js';
import { KV_CHAMBERS, kvChamberLabel } from './kv-tables.js';
import { L } from './i18n.js';

/** Режим m вкладки для таблиц и протокола: «200 кВ, СПО 1,00 мм Cu» или «пучок не задан». */
export const kvModeName = (visit, m) => kvModeLabel(visit.modes[m]?.shared) || L('пучок не задан', 'beam not set');

/** Камера вкладки: модель и серийный номер («PTW 30013 № 1001»). */
export function kvChamberName(ch) {
  const id = String(ch?.kv_ch_model ?? '');
  let name = '';
  if (id === 'CUSTOM' || id.startsWith('MY:')) name = [ch.kv_cc_maker, ch.kv_cc_model].map((v) => String(v ?? '').trim()).filter(Boolean).join(' ');
  else if (id) {
    const c = KV_CHAMBERS.find((x) => x.id === id);
    name = c ? kvChamberLabel(c) : id;
  }
  const sn = String(ch?.kv_ch_serial ?? '').trim();
  return [name || L('камера не выбрана', 'no chamber selected'), sn ? L(`№ ${sn}`, `S/N ${sn}`) : ''].filter(Boolean).join(' ');
}

/** Итог строки по контрольным измерениям, если они есть и без ошибок (как в разделе 8). */
const primaryOf = (x) => (x.ctrl && !x.ctrl.blocked && !x.blocked ? x.ctrl : x);
/** Доза строки не вычислена: ошибки ввода или ошибка контрольных измерений. */
const noDose = (x) => x.blocked || !!x.ctrl?.blocked;
/** Строка измерена: есть показания M₁ (или их ошибка) — пустые строки и тубусы без показаний в протокол не идут. */
const measured = (row) => {
  if (kvRowEmpty(row)) return false;
  const c = parseCells(row.kv_M1);
  return c.n > 0 || !!c.error;
};
const str = (v) => String(v ?? '').trim();

/**
 * Проверка радиационного выхода: измеренные строки всех режимов по порядку. У строки: m, i — режим и строка; label —
 * аппликатор («Ø 6 см»); ssd — РИП как введён; std — стандартный тубус режима (при нескольких строках); range —
 * 'low' | 'medium'; where — где доза сравнивается ('surface' | 'zref'); unit — единица мощности дозы («Гр/мин»);
 * D — измеренная мощность дозы там, где задано значение для сравнения; base — базовое значение (NaN — не задано);
 * dev — отклонение, %; tol — допуск, %; perUnit, perUnitSurf — доза на опорной глубине и на поверхности;
 * verdict — 'ok' (в допуске), 'over' (больше допуска — требуется калибровка), 'nobase' (базового значения нет),
 * 'na' (база на поверхности, а PDD не введена — сравнить не с чем), 'error' (доза не вычислена).
 */
export function kvOutputRows(visit, vr) {
  const out = [];
  visit.modes.forEach((md, m) => {
    const mr = vr.modes[m];
    md.rows.forEach((row, i) => {
      if (!measured(row)) return;
      const r = mr.results[i];
      const x = r.trs;
      const p = primaryOf(x);
      const none = noDose(x);
      const atSurf = r.range === 'medium' && r.cmp.at === 'surface' && Number.isFinite(p.perUnitSurf);
      const D = none ? NaN : atSurf ? p.perUnitSurf : p.perUnit;
      const base = Number.isFinite(r.cmp.ref) ? r.cmp.ref : NaN;
      const dev = none ? NaN : p.deviation;
      const tol = r.cmp.tolerance;
      const verdict = none ? 'error' : !Number.isFinite(base) ? 'nobase' : !Number.isFinite(dev) ? 'na' : Math.abs(dev) > tol ? 'over' : 'ok';
      out.push({
        m, i, label: kvRowLabel(row), ssd: str(row.kv_ssd), std: md.rows.length > 1 && i === mr.stdRow,
        range: r.range, where: r.range === 'low' || atSurf ? 'surface' : 'zref', unit: x.rateLabel,
        D, base, dev, tol, verdict,
        perUnit: none ? NaN : p.perUnit, perUnitSurf: none ? NaN : p.perUnitSurf,
      });
    });
  });
  return out;
}

/**
 * Таблица мощности дозы «аппликатор × режим» (форма «Сводная»): блоки по диапазону энергий и глубине — низкие
 * энергии на поверхности; средние на 2 г/см² и, если у какой-нибудь строки введена PDD(2 см), на поверхности.
 * Блок: { range, at ('surface' | 'zref'), modes [m…], units { m: «Гр/мин» }, unit (общая, '' — разные), apps
 * [{ key, label, ssd }] — аппликаторы в порядке появления, cells { 'm|key': { D, dev, verdict, i } } }; dev и verdict
 * — только там, где задано значение для сравнения (иначе NaN и '').
 */
export function kvDoseMatrix(visit, vr, rows = kvOutputRows(visit, vr)) {
  const blocks = [];
  for (const range of ['low', 'medium']) {
    const rs = rows.filter((r) => r.range === range);
    if (!rs.length) continue;
    const views = range === 'low' ? ['surface'] : ['zref', ...(rs.some((r) => Number.isFinite(r.perUnitSurf)) ? ['surface'] : [])];
    for (const at of views) {
      const modes = [...new Set(rs.map((r) => r.m))];
      const units = Object.fromEntries(modes.map((m) => [m, rs.find((r) => r.m === m).unit]));
      const uniq = [...new Set(Object.values(units))];
      const apps = [];
      const seen = new Set();
      const cells = {};
      const count = new Map();
      for (const r of rs) {
        // один и тот же аппликатор дважды в режиме — отдельные строки таблицы
        const base = `${r.label}|${r.ssd}`;
        const n = (count.get(`${r.m}|${base}`) ?? 0) + 1;
        count.set(`${r.m}|${base}`, n);
        const key = `${base}|${n}`;
        if (!seen.has(key)) {
          seen.add(key);
          apps.push({ key, label: r.label, ssd: r.ssd });
        }
        const here = r.where === at;
        cells[`${r.m}|${key}`] = {
          D: range === 'low' || at === 'zref' ? r.perUnit : r.perUnitSurf,
          dev: here ? r.dev : NaN,
          verdict: here ? r.verdict : '',
          i: r.i,
        };
      }
      blocks.push({ range, at, modes, units, unit: uniq.length === 1 ? uniq[0] : '', apps, cells });
    }
  }
  return blocks;
}

/** Условия измерения по строкам с показаниями: T, относительная влажность и P — { min, max } (NaN — не введены). */
export function kvClimate(visit) {
  const acc = { T: [], H: [], P: [] };
  for (const md of visit.modes) {
    for (const row of md.rows) {
      if (!measured(row)) continue;
      for (const [k, key] of [['T', 'kv_env_T'], ['H', 'kv_env_H'], ['P', 'kv_env_P']]) {
        const v = parseNumber(row[key]);
        if (Number.isFinite(v)) acc[k].push(v);
      }
    }
  }
  const span = (a) => (a.length ? { min: Math.min(...a), max: Math.max(...a) } : { min: NaN, max: NaN });
  return { T: span(acc.T), H: span(acc.H), P: span(acc.P), pUnit: visit.common.kv_env_P_unit };
}

const tolOf = (v) => {
  const x = parseNumber(v);
  return !isBlank(v) && Number.isFinite(x) && x > 0 ? x : NaN;
};

/**
 * Итоги листов для протокола: режимы, где проверка проводилась, и её результат.
 *   hvl — [{ m, ok, used, U, apply, mat, nominal }] — измерение СПО (лист «СПО и k_Q»);
 *   timer — [{ m, tau, tauS, unit, tol, inTol, ok }] — своя ошибка таймера режима (лист «Ошибка таймера»);
 *   ln — [{ m, ok, unit, q [Q…], dMax, dMaxAt, ref, clMax, clAt, dOver, clOver }] и tol { d, cl };
 *   rp — [{ m, ok, n, R, cv, over }] и tol;
 *   output — { n, ok, over, nobase, na, error } — счёт строк проверки выхода.
 */
export function kvSheetChecks(visit, vr, rows = kvOutputRows(visit, vr)) {
  const c = visit.common;
  const lnTol = { d: tolOf(c.kv_ln_tol), cl: tolOf(c.kv_ln_cl_tol) };
  const rpTol = tolOf(c.kv_rp_tol);
  const hvl = [];
  const timer = [];
  const ln = [];
  const rp = [];
  visit.modes.forEach((md, m) => {
    const mr = vr.modes[m];
    const h = mr.hvl;
    if (h && h.state !== 'empty') hvl.push({ m, ok: !!h.ok, used: h.used, U: h.U, apply: !!h.apply, mat: h.mat, nominal: str(md.shared.kv_hvl) });
    const r = mr.results[md.active] ?? mr.results[0];
    const t = r?.timer;
    if (mr.timer?.state === 'own' && t && Number.isFinite(t.tau)) {
      const bad = Object.entries(r.flags ?? {}).some(([k, v]) => v === 'error' && /^kv_(tp_|nx_|timer|tau)/.test(k));
      timer.push({ m, tau: t.tau, tauS: t.tauS, unit: t.unit, tol: t.tol, inTol: t.inTol, ok: !bad });
    }
    const a = mr.ln;
    if (a && a.state !== 'empty') {
      ln.push({
        m, ok: !!a.ok, unit: a.unit, q: (a.points ?? []).map((p) => p.q), ref: a.ref, dMax: a.dMax, dMaxAt: a.dMaxAt, clMax: a.clMax, clAt: a.clAt,
        dOver: !!a.ok && Number.isFinite(lnTol.d) && a.dMax * 100 > lnTol.d,
        clOver: !!a.ok && Number.isFinite(lnTol.cl) && a.clMax > lnTol.cl,
      });
    }
    const b = mr.rp;
    if (b && b.state !== 'empty') rp.push({ m, ok: !!b.ok, n: b.n, R: b.R, cv: b.cv, over: !!b.ok && Number.isFinite(rpTol) && b.R * 100 > rpTol });
  });
  const output = { n: rows.length, ok: 0, over: 0, nobase: 0, na: 0, error: 0 };
  for (const r of rows) output[r.verdict] += 1;
  return { hvl, timer, ln, lnTol, rp, rpTol, output };
}
