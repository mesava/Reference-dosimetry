// Выгрузка журнала в CSV для Excel: по строке на пучок в сеансе.
// Для русского интерфейса — разделитель «;» и десятичная запятая (так CSV открывает русский Excel), для английского —
// «,» и точка. В начале файла — метка порядка байтов UTF-8, чтобы Excel узнал кодировку при открытии двойным щелчком.
import { L, getLang } from './i18n.js';
import { machineOf, beamKind, chamberText, electrometerText } from './journal.js';
import { beamChart, sessionCommon } from './journal-spc.js';
import { signalText } from './spc-text.js';
import { checkPairs, checkChart } from './journal-check.js';

const BOM = '﻿';

/** Число для CSV: d знаков после запятой, десятичный разделитель языка; пусто, если числа нет. */
function num(v, d, dec) {
  if (!Number.isFinite(v)) return '';
  const s = v.toFixed(d);
  return dec === ',' ? s.replace('.', ',') : s;
}

/** Ячейка CSV: в кавычках, если в ней разделитель, кавычки или перевод строки. */
function cell(v, sep) {
  const s = String(v ?? '');
  return /["\r\n]/.test(s) || s.includes(sep) ? `"${s.replace(/"/g, '""')}"` : s;
}

const kindText = (k) => ({ photon: L('фотоны', 'photons'), electron: L('электроны', 'electrons'), cobalt: '⁶⁰Co' })[k];
const statusText = (s) => ({ ok: L('в допуске', 'within tolerance'), out: L('вне допуска', 'out of tolerance'), nonominal: L('нет номинала', 'no nominal'), error: L('ошибка', 'error') })[s] ?? '';

/** Текст CSV всего журнала (все аппараты и сеансы). */
export function journalCsv(j) {
  const ru = getLang() !== 'en';
  const sep = ru ? ';' : ',';
  const dec = ru ? ',' : '.';
  const head = [
    L('Аппарат', 'Machine'),
    L('Заводской №', 'Serial No.'),
    L('Дата', 'Date'),
    L('Режим', 'Mode'),
    L('Протокол', 'Protocol'),
    L('Пучок', 'Beam'),
    L('Вид', 'Kind'),
    L('Доза в точке номинала', 'Dose at the nominal point'),
    L('Единица', 'Unit'),
    L('Точка', 'Point'),
    L('Отклонение, %', 'Deviation, %'),
    L('Допуск, %', 'Tolerance, %'),
    L('Статус', 'Status'),
    L('До подстройки, %', 'Before adjustment, %'),
    'k_pol',
    'k_s',
    L('k_s и k_pol', 'k_s and k_pol'),
    'k_Q',
    L('Качество пучка', 'Beam quality'),
    L('τ, с', 'τ, s'),
    L('Камера', 'Chamber'),
    'N_D,w',
    L('Электрометр', 'Electrometer'),
    'k_elec',
    'T, °C',
    'P',
    L('Единица P', 'P unit'),
    L('Сигналы контрольной карты', 'Control chart signals'),
    L('Общая часть сеанса, %', 'Common part of the session, %'),
    L('Собственная часть пучка, %', 'Own part of the beam, %'),
    L('Сотрудники', 'Staff'),
    L('Примечания', 'Notes'),
  ];
  const lines = [head.map((h) => cell(h, sep)).join(sep)];
  // сигналы карты и общая часть — по аппаратам и видам пучков
  const signals = new Map(); // `${sessionId}|${beamId}` → текст
  const common = new Map(); // `${sessionId}|${beamId}` → { c, e }
  for (const m of j.machines) {
    for (const b of m.beams) {
      const ch = beamChart(j, m.id, b.id);
      for (const p of ch.points) {
        if (!p.signals.length) continue;
        const key = `${p.sessionId}|${b.id}`;
        const txt = `${p.stage === 'found' ? L('до подстройки: ', 'before adjustment: ') : ''}${p.signals.map(signalText).join(', ')}`;
        signals.set(key, signals.has(key) ? `${signals.get(key)}; ${txt}` : txt);
      }
    }
    for (const kind of ['photon', 'electron', 'cobalt']) {
      const ids = m.beams.filter((b) => beamKind(b) === kind).map((b) => b.id);
      if (ids.length < 2) continue;
      for (const r of sessionCommon(j, m.id, ids).rows) for (const b of r.beams) common.set(`${r.sessionId}|${b.beamId}`, { c: r.value, e: b.e });
    }
  }
  const chamberById = new Map(j.chambers.map((c) => [c.id, c]));
  const elById = new Map(j.electrometers.map((e) => [e.id, e]));
  for (const s of j.sessions) {
    const m = machineOf(j, s.machineId);
    for (const sb of s.beams) {
      const x = sb.summary;
      if (!x) continue;
      const beam = m?.beams.find((b) => b.id === sb.beamId);
      const kind = beam ? beamKind(beam) : sb.kind || 'photon';
      const co = kind === 'cobalt';
      const cm = common.get(`${s.id}|${sb.beamId}`);
      const row = [
        m?.name ?? '',
        m?.serial ?? '',
        s.date,
        s.mode === 'cal' ? L('калибровка', 'calibration') : L('проверка выхода', 'output check'),
        s.protocol === 'tg51' ? 'TG-51' : 'TRS-398',
        beam?.name ?? '',
        kindText(kind),
        num(x.value, co ? 3 : 5, dec),
        co ? L('сГр/мин', 'cGy/min') : L('Гр/100 МЕ', 'Gy/100 MU'),
        x.at === 'zref' ? 'z_ref' : x.at === 'dmax' ? 'd_max' : x.at === 'zmax' ? 'z_max' : '',
        num(x.deviation, 3, dec),
        num(x.tol, 1, dec),
        statusText(x.status),
        num(x.preDeviation, 3, dec),
        num(x.kpolRaw, 5, dec),
        num(x.ksRaw, 5, dec),
        x.ksFixed ? L('из калибровки', 'from the calibration') : Number.isFinite(x.ksRaw) ? L('измерены', 'measured') : '',
        num(x.kQ, 4, dec),
        num(x.quality, 4, dec),
        num(Number.isFinite(x.tauMin) ? x.tauMin * 60 : NaN, 2, dec),
        chamberText(chamberById.get(sb.chamberId)),
        num(x.ndw, 6, dec),
        electrometerText(elById.get(sb.electrometerId)),
        num(x.kelec, 4, dec),
        String(s.env?.T ?? ''),
        String(s.env?.P ?? ''),
        String(s.env?.P_unit ?? ''),
        signals.get(`${s.id}|${sb.beamId}`) ?? '',
        num(cm?.c, 3, dec),
        num(cm?.e, 3, dec),
        (s.staff || []).filter((t) => String(t).trim()).join(', '),
        String(s.notes ?? ''),
      ];
      lines.push(row.map((v) => cell(v, sep)).join(sep));
    }
  }
  return BOM + lines.join('\r\n') + '\r\n';
}

/** Текст CSV проверок дозиметра второй камерой (все аппараты): по строке на проверку. */
export function checksCsv(j) {
  const ru = getLang() !== 'en';
  const sep = ru ? ';' : ',';
  const dec = ru ? ',' : '.';
  const head = [
    L('Аппарат', 'Machine'),
    L('Дата', 'Date'),
    L('Режим сеанса', 'Session mode'),
    L('Протокол', 'Protocol'),
    L('Пучок', 'Beam'),
    L('Рабочая камера', 'Working chamber'),
    L('N_D,w рабочей', 'N_D,w working'),
    L('Электрометр рабочей', 'Working electrometer'),
    L('Вторая камера', 'Second chamber'),
    L('N_D,w второй', 'N_D,w second'),
    L('Электрометр второй', 'Second electrometer'),
    L('Доза по рабочей на z_ref', 'Dose from the working chamber at z_ref'),
    L('Доза по второй на z_ref', 'Dose from the second chamber at z_ref'),
    L('Единица', 'Unit'),
    L('Отношение', 'Ratio'),
    L('Отношение − 1, %', 'Ratio − 1, %'),
    L('k_pol второй', 'k_pol second'),
    L('k_s второй', 'k_s second'),
    L('k_pol и k_s второй', 'k_pol and k_s second'),
    L('Сигналы карты', 'Chart signals'),
  ];
  const srcText = (sum) => (sum.measured ? L('измерены', 'measured') : [sum.kpolSrc, sum.ksSrc].map((x) => ({ manual: L('введён', 'entered'), previous: L('из прошлой проверки', 'from the previous check'), assumed: L('принят 1', 'taken as 1') })[x] ?? '').join(' / '));
  const signals = new Map(); // `${sessionId}|${checkId}` → текст
  for (const m of j.machines) {
    for (const pair of checkPairs(j, m.id)) {
      for (const p of checkChart(j, pair).chart.points) if (p.signals.length) signals.set(`${p.sessionId}|${p.check.id}`, p.signals.map(signalText).join(', '));
    }
  }
  const chamberById = new Map(j.chambers.map((c) => [c.id, c]));
  const elById = new Map(j.electrometers.map((e) => [e.id, e]));
  const lines = [head.map((h) => cell(h, sep)).join(sep)];
  for (const s of j.sessions) {
    const m = machineOf(j, s.machineId);
    for (const c of s.checks ?? []) {
      const x = c.summary;
      if (!x) continue;
      const beam = m?.beams.find((b) => b.id === c.beamId);
      const co = (beam ? beamKind(beam) : x.kind) === 'cobalt';
      const row = [
        m?.name ?? '',
        s.date,
        s.mode === 'cal' ? L('калибровка', 'calibration') : L('проверка выхода', 'output check'),
        s.protocol === 'tg51' ? 'TG-51' : 'TRS-398',
        beam?.name ?? '',
        chamberText(chamberById.get(x.workChamberId)),
        num(x.workNdw, 6, dec),
        electrometerText(elById.get(x.workElectrometerId)),
        chamberText(chamberById.get(c.chamberId)),
        num(x.ndw, 6, dec),
        electrometerText(elById.get(x.electrometerId)),
        num(x.workValue, co ? 3 : 5, dec),
        num(x.value, co ? 3 : 5, dec),
        co ? L('сГр/мин', 'cGy/min') : L('Гр/100 МЕ', 'Gy/100 MU'),
        num(x.ratio, 5, dec),
        num(x.diff, 3, dec),
        num(x.kpol, 5, dec),
        num(x.ks, 5, dec),
        srcText(x),
        signals.get(`${s.id}|${c.id}`) ?? '',
      ];
      lines.push(row.map((v) => cell(v, sep)).join(sep));
    }
  }
  return BOM + lines.join('\r\n') + '\r\n';
}

/** Имя файла: «журнал_ЛОР_2026-10-16.csv» (part — «проверки_дозиметра» и т. п.). */
export function csvFileName(j, date = new Date(), part = '') {
  const inst = String(j.institution || '').trim().replace(/[^\p{L}\p{N}_.-]+/gu, '-');
  const p = (n) => String(n).padStart(2, '0');
  return `${L('журнал', 'journal')}${inst ? `_${inst}` : ''}${part ? `_${part}` : ''}_${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}.csv`;
}
