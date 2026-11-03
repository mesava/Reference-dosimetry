// «Журнал и тренды» для рентгенотерапевтического аппарата (с 0.48.0): ряды по датам из записей журнала kV
// (core/kv-records.js) — выход режимов по стандартному тубусу (отклонение от базы), сводная мощности дозы «режим ×
// аппликатор» по датам (как форма «Сводная» учреждения), СПО, τ, k_pol, k_s, k_Q, линейность и воспроизводимость режима
// по датам и выгрузка записей в CSV. Расчёта здесь нет: всё — из итогов записей (summary.modes), как их посчитала вкладка.
import { L, getLang } from './i18n.js';
import { dayNumber } from './journal.js';
import { KV_SET_UNITS } from './kv.js';
import { applicatorSize } from './kv-machine.js';
import { kvRecordsOf, kvRecordOrder, kvRecModeText } from './kv-records.js';
import { kvMachineText } from './kv-journal.js';
import { csvNum, csvCell } from './journal-csv.js';
import { signalText } from './spc-text.js';

const str = (v) => (v === undefined || v === null ? '' : String(v)).trim();
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const ru = (v, d) => {
  const s = v.toFixed(d);
  return getLang() === 'en' ? s : s.replace('.', ',');
};

/** Единица мощности дозы режима по единице задания записи («Гр/мин», «сГр/МЕ»). */
export const kvRateUnit = (setUnit) => {
  const u = KV_SET_UNITS[setUnit];
  return u ? L(u.rateLabel, u.rateLabelEn) : '';
};

/** Режим записи коротко на языке интерфейса: «200 кВ, СПО 1,00 мм Cu» (по данным итога, не по тексту записи). */
export function kvModeTitleOf(x) {
  const kv = str(x?.kv);
  const hvl = str(x?.hvl?.nominal);
  const mat = x?.hvl?.mat === 'Al' || (x?.range === 'low' && x?.hvl?.mat !== 'Cu') ? 'Al' : 'Cu';
  const h = hvl ? (getLang() === 'en' ? hvl.replace(',', '.') : hvl.replace('.', ',')) : '';
  return [kv ? L(`${kv} кВ`, `${kv} kV`) : '', h ? L(`СПО ${h} мм ${mat}`, `HVL ${h} mm ${mat}`) : ''].filter(Boolean).join(', ') || str(x?.title);
}

/** Аппликатор строки записи: обозначение из «Оборудования» и размер («F20, Ø 6 см»), иначе размер из строки. */
export function kvAppLabel(machine, y) {
  const a = machine?.applicators?.find((z) => z.id === y.applicatorId);
  const size = applicatorSize(a ?? y) || str(y.label);
  const name = str(a?.name);
  return name ? `${name}, ${size}` : size;
}

/** Записи аппарата по порядку и режимы аппарата, которые в них есть: [{ modeId, n (номер в «Оборудовании», с 1), title, range }]. */
export function kvTrendModes(j, machine) {
  const recs = kvRecordsOf(j, machine.id).slice().sort(kvRecordOrder);
  const last = new Map();
  for (const r of recs) for (const x of r.summary?.modes ?? []) last.set(x.modeId, x);
  const order = (id) => {
    const i = machine.modes.findIndex((y) => y.id === id);
    return i < 0 ? 1e6 : i;
  };
  return [...last.entries()]
    .sort((a, b) => order(a[0]) - order(b[0]))
    .map(([modeId, x]) => ({ modeId, n: order(modeId) < 1e6 ? order(modeId) + 1 : 0, title: kvModeTitleOf(x), range: x.range === 'low' ? 'low' : 'medium' }));
}

/** Пары (запись, итог режима) аппарата по датам; kind — 'cal' | 'check' | '' (все). */
function modeEntries(j, machineId, modeId, kind = '') {
  const out = [];
  for (const r of kvRecordsOf(j, machineId).slice().sort(kvRecordOrder)) {
    if (kind && (r.mode === 'check' ? 'check' : 'cal') !== kind) continue;
    const x = (r.summary?.modes ?? []).find((y) => y.modeId === modeId);
    if (x) out.push({ rec: r, x });
  }
  return out;
}

/** Строка стандартного тубуса режима в записи: отмеченная «ст.», иначе референсный аппликатор режима аппарата, иначе первая. */
export function kvStdRow(machine, modeId, x) {
  const rows = x.rows ?? [];
  const ref = machine.modes.find((y) => y.id === modeId)?.refApplicator;
  return rows.find((y) => y.std) ?? (ref ? rows.find((y) => y.applicatorId === ref) : null) ?? rows[0] ?? null;
}

/**
 * Выход по датам: по ряду на режим — стандартный тубус режима в каждой записи, где он есть. Ряд: { modeId, n, title,
 * points [{ date, day, kind ('cal' | 'check'), recId, label, D, unit, base, baseDate, dev, tol, verdict }] }; dev — NaN,
 * если базы не было (первая калибровка).
 */
export function kvOutputSeries(j, machine) {
  return kvTrendModes(j, machine).map((md) => ({
    ...md,
    points: modeEntries(j, machine.id, md.modeId)
      .map(({ rec, x }) => {
        const y = kvStdRow(machine, md.modeId, x);
        if (!y) return null;
        return {
          date: rec.date,
          day: dayNumber(rec.date),
          kind: rec.mode === 'check' ? 'check' : 'cal',
          recId: rec.id,
          label: kvAppLabel(machine, y),
          D: fin(y.D) ? y.D : NaN,
          unit: kvRateUnit(x.setUnit),
          base: fin(y.base) ? y.base : NaN,
          baseDate: str(y.baseDate),
          dev: fin(y.dev) && y.verdict !== 'error' && y.verdict !== 'nobase' ? y.dev : NaN,
          tol: fin(y.tol) ? y.tol : NaN,
          verdict: str(y.verdict),
        };
      })
      .filter(Boolean),
  }));
}

/**
 * Сводная мощности дозы по датам (как форма «Сводная»): строки — режим × аппликатор (в порядке режимов «Оборудования»),
 * колонки — даты записей (старые слева). checks — с проверками выхода (иначе только калибровки).
 * Возвращает { cols [{ date, kinds: Set }], rows [{ modeId, n, title, unit, where, label, ssd, key, cells { date: { D, dev,
 * verdict, kind, std } } }] }. D — мощность дозы на опорной глубине (низкие энергии — на поверхности, средние — 2 г/см²),
 * dev — отклонение от базы, как в записи (там, где сравнивалась строка).
 */
export function kvDoseByDate(j, machine, { checks = false } = {}) {
  const modes = kvTrendModes(j, machine);
  const colMap = new Map();
  const rows = [];
  for (const md of modes) {
    const byKey = new Map();
    for (const { rec, x } of modeEntries(j, machine.id, md.modeId, checks ? '' : 'cal')) {
      const kind = rec.mode === 'check' ? 'check' : 'cal';
      if (!colMap.has(rec.date)) colMap.set(rec.date, new Set());
      colMap.get(rec.date).add(kind);
      for (const y of x.rows ?? []) {
        const key = y.applicatorId || `${y.shape}|${str(y.a)}|${str(y.b)}|${str(y.ssd)}`;
        if (!byKey.has(key)) {
          byKey.set(key, { modeId: md.modeId, n: md.n, title: md.title, unit: kvRateUnit(x.setUnit), where: md.range === 'low' ? 'surface' : 'zref', label: kvAppLabel(machine, y), ssd: str(y.ssd), key, cells: {} });
        }
        const row = byKey.get(key);
        row.cells[rec.date] = { D: fin(y.perUnit) ? y.perUnit : NaN, dev: fin(y.dev) && !['error', 'nobase'].includes(y.verdict) ? y.dev : NaN, verdict: str(y.verdict), kind, std: !!y.std };
      }
    }
    // аппликаторы режима — в порядке «Оборудования», затем остальные
    const appOrder = (r) => {
      const i = machine.applicators.findIndex((a) => a.id === r.key);
      return i < 0 ? 1e6 : i;
    };
    rows.push(...[...byKey.values()].sort((a, b) => appOrder(a) - appOrder(b)));
  }
  const cols = [...colMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, kinds]) => ({ date, kinds }));
  return { cols, rows };
}

/**
 * Режим по датам: СПО, τ, k_pol, k_s, k_Q, линейность и воспроизводимость в каждой записи режима. Строка: { date, kind,
 * recId, chamber, hvl { used, U, source, date, mat } | null, tau { v, s, unit, src, date } | null, kpol { v, src, date } |
 * null, ks — так же, cert { form, value, kQ, NQ } | null, ln { q, dMax, clMax, dOver, clOver } | null, rp { n, R, over } | null }.
 */
export function kvModeHistory(j, machine, modeId) {
  return modeEntries(j, machine.id, modeId).map(({ rec, x }) => ({
    date: rec.date,
    kind: rec.mode === 'check' ? 'check' : 'cal',
    recId: rec.id,
    chamber: str(x.chamber),
    hvl: x.hvl && fin(x.hvl.used) ? { used: x.hvl.used, U: fin(x.hvl.measured) && x.hvl.source === 'measured' ? x.hvl.U : null, source: x.hvl.source || 'table', date: str(x.hvl.date), mat: x.hvl.mat === 'Al' ? 'Al' : 'Cu' } : null,
    tau: x.tau && fin(x.tau.v) ? { v: x.tau.v, s: fin(x.tau.s) ? x.tau.s : NaN, unit: str(x.tau.unit), src: x.tau.src || (x.tau.own ? 'own' : 'mode'), date: str(x.tau.date) } : null,
    kpol: x.kpol && fin(x.kpol.v) ? { v: x.kpol.v, src: x.kpol.src || (x.kpol.own ? 'own' : 'mode'), date: str(x.kpol.date) } : null,
    ks: x.ks && fin(x.ks.v) ? { v: x.ks.v, src: x.ks.src || (x.ks.own ? 'own' : 'mode'), date: str(x.ks.date) } : null,
    cert: x.cert && fin(x.cert.value) ? { form: str(x.cert.form), value: x.cert.value, kQ: fin(x.cert.kQ) ? x.cert.kQ : NaN, NQ: fin(x.cert.NQ) ? x.cert.NQ : NaN } : null,
    ln: x.ln && fin(x.ln.dMax) ? { q: x.ln.q, dMax: x.ln.dMax, clMax: fin(x.ln.clMax) ? x.ln.clMax : NaN, dOver: !!x.ln.dOver, clOver: !!x.ln.clOver } : null,
    rp: x.rp && fin(x.rp.R) ? { n: x.rp.n, R: x.rp.R, over: !!x.rp.over } : null,
  }));
}

/** Откуда значение режима: '' — своё, «из режима вкладки», «из калибровки 15.09.2026». */
export function kvSrcText(src, date = '') {
  if (src === 'journal') return L(`из калибровки ${date.split('-').reverse().join('.')}`, `from the calibration of ${date}`);
  if (src === 'mode') return L('из другого режима', 'from another mode');
  return '';
}

/**
 * Сводная по датам текстом для вставки в Excel (табуляция; десятичный разделитель языка): режим, аппликатор, РИП,
 * единица и мощность дозы по датам.
 */
export function kvDoseByDateTsv(t) {
  const lines = [[L('Режим', 'Mode'), L('Аппликатор', 'Applicator'), L('РИП, см', 'SSD, cm'), L('Единица', 'Unit'), ...t.cols.map((c) => c.date.split('-').reverse().join('.'))].join('\t')];
  for (const r of t.rows) lines.push([`${r.n ? `${r.n}. ` : ''}${r.title}`, r.label, r.ssd, r.unit, ...t.cols.map((c) => (fin(r.cells[c.date]?.D) ? ru(r.cells[c.date].D, 4) : ''))].join('\t'));
  return lines.join('\n');
}

const whereText = (w) => (w === 'surface' ? L('поверхность', 'surface') : L('2 г/см²', '2 g/cm²'));
const verdictText = (v) => ({ ok: L('в допуске', 'within tolerance'), over: L('требуется калибровка', 'calibration required'), nobase: L('нет базы', 'no baseline'), na: L('не с чем сравнить', 'nothing to compare'), error: L('доза не вычислена', 'dose not calculated') })[v] ?? '';

/**
 * Записи kV аппарата в CSV для Excel: по строке на аппликатор режима в записи — дата, вид, режим, аппликатор, мощность
 * дозы, база (и дата калибровки, если из журнала), отклонение, допуск, решение, k_pol, k_s, τ, СПО, k_Q, камера,
 * сотрудники, сигналы контрольной карты режима (у стандартного тубуса; signals — core/kv-spc.js kvChartSignals).
 * Разделитель и десятичный знак — по языку (как журнал ускорителей, core/journal-csv.js).
 */
export function kvRecordsCsv(j, machine, signals = new Map()) {
  const en = getLang() === 'en';
  const sep = en ? ',' : ';';
  const dec = en ? '.' : ',';
  const head = [
    L('Аппарат', 'Unit'), L('Дата', 'Date'), L('Вид', 'Kind'), L('Режим', 'Mode'), L('кВ', 'kV'), L('мА', 'mA'), L('Фильтр', 'Filter'),
    L('Аппликатор', 'Applicator'), L('РИП, см', 'SSD, cm'), L('Стандартный тубус', 'Reference applicator'), L('Мощность дозы', 'Dose rate'), L('Единица', 'Unit'), L('Где', 'Where'),
    L('База', 'Baseline'), L('База — калибровка', 'Baseline calibration'), L('Отклонение, %', 'Deviation, %'), L('Допуск, %', 'Tolerance, %'), L('Калибровка', 'Calibration'),
    'k_pol', L('k_pol откуда', 'k_pol from'), 'k_s', L('k_s откуда', 'k_s from'), L('τ', 'τ'), L('Единица τ', 'τ unit'), L('τ откуда', 'τ from'),
    L('СПО в расчёте, мм', 'HVL used, mm'), L('Материал', 'Material'), L('СПО откуда', 'HVL from'), 'k_Q', L('Камера', 'Chamber'), L('Сотрудники', 'Staff'), L('Контрольная карта', 'Control chart'),
  ];
  const srcCsv = (o) => (!o ? '' : o.src === 'journal' ? kvSrcText('journal', o.date) : o.src === 'mode' ? kvSrcText('mode') : L('измерен', 'measured'));
  const lines = [head.map((h) => csvCell(h, sep)).join(sep)];
  const name = kvMachineText(machine);
  for (const r of kvRecordsOf(j, machine.id).slice().sort(kvRecordOrder)) {
    for (const x of r.summary?.modes ?? []) {
      const hvlSrc = x.hvl?.source === 'journal' ? kvSrcText('journal', x.hvl.date) : x.hvl?.source === 'measured' ? L('измерен', 'measured') : L('из таблицы режимов', 'from the modes table');
      const sg = signals.get(`${r.id}|${x.modeId}`);
      const std = kvStdRow(machine, x.modeId, x);
      const rules = sg ? [...sg.signals.map(signalText), ...sg.watch.map((k) => L(`наблюдение: ${signalText(k)}`, `observation: ${signalText(k)}`))].join('; ') : '';
      for (const y of x.rows ?? []) {
        const row = [
          name, r.date, kvRecModeText(r.mode), kvModeTitleOf(x), str(x.kv), str(x.ma), str(x.filter),
          kvAppLabel(machine, y), str(y.ssd), y.std ? L('да', 'yes') : '', csvNum(y.D, 5, dec), kvRateUnit(x.setUnit), whereText(y.where),
          csvNum(y.base, 5, dec), str(y.baseDate), csvNum(y.verdict === 'error' ? NaN : y.dev, 3, dec), csvNum(y.tol, 1, dec), verdictText(y.verdict),
          csvNum(x.kpol?.v, 5, dec), srcCsv(x.kpol), csvNum(x.ks?.v, 5, dec), srcCsv(x.ks), csvNum(x.tau?.v, 5, dec), str(x.tau?.unit), srcCsv(x.tau),
          csvNum(x.hvl?.used, 3, dec), x.hvl?.mat ?? '', hvlSrc, csvNum(x.cert?.kQ, 4, dec), str(x.chamber), (r.staff ?? []).join(', '), y === std ? rules : '',
        ];
        lines.push(row.map((v) => csvCell(v, sep)).join(sep));
      }
    }
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}
