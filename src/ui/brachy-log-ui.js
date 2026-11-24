// Записи брахитерапии в «Журнале и трендах» (с 0.79.0; в 0.76.0–0.78.0 — отдельный лист «Журнал» вкладки
// «Брахитерапия»): список записей j.brachyRecords с отбором по афтерлоадеру или камере (выбор аппарата на странице:
// «br:» — все записи, «br:m:id» — афтерлоадер, «br:c:id» — камера), контрольные карты силы источника и стабильности
// камеры (I-MR, сигналы 3σ и CUSUM, core/spc.js). Записи делают листы вкладки (core/brachy-records.js).
import { L } from '../core/i18n.js';
import { unitLabel } from '../core/units.js';
import { HALF_LIVES, CERT_TOLERANCE } from '../core/brachy-data.js';
import { WELL_N_UNITS } from '../core/brachy-sheets.js';
import { isWellModel, brachyMachines, sourceModelName } from '../core/brachy-journal.js';
import { chamberText, dayNumber, isRetired } from '../core/journal.js';
import { controlChart } from '../core/spc.js';
import { brachySheetText, brachyRecordsOf } from '../core/brachy-records.js';
import { esc, fmt, fmtSigned } from './common.js';
import { drawChart, legendHtml, segmentLine, trendLine, signalsHtml, pointRules } from './journal-spc-ui.js';

/** Значение выбора аппарата «все записи брахитерапии». */
export const BR_ALL = 'br:';
export const isBrachyPick = (v) => String(v ?? '').startsWith('br:');

export const machineName = (m) => m?.name || L('афтерлоадер без названия', 'unnamed afterloader');
export const isoDateText = (d) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d ?? ''));
  return m ? L(`${m[3]}.${m[2]}.${m[1]}`, String(d)) : String(d ?? '');
};
export const chipHtml = (cmp) => (cmp ? `<span class="chip ${cmp.level === 'ok' ? 'ok' : cmp.level === 'warn' ? 'out' : 'error'}">${esc(fmtSigned(cmp.dev, 2))} % ${esc(L('от сертификата', 'from the certificate'))}</span>` : '');
/** Методы проверки стабильности колодезной камеры (TRS-492, разд. 8.5). */
export const ST_METHODS = () => [
  ['check', L('контрольный источник (8.5.2), ±0,5 %', 'check source (8.5.2), ±0.5%')],
  ['beam', L('внешний пучок 6 МВ / ⁶⁰Co (8.5.3), ±0,5 %', 'external beam 6 MV / ⁶⁰Co (8.5.3), ±0.5%')],
  ['hdr', L('источник HDR до замены (8.5.4), ±0,5 %', 'HDR source until exchange (8.5.4), ±0.5%')],
  ['redundant', L('вторая камера (8.5.1), ±0,1 %', 'redundant chamber (8.5.1), ±0.1%')],
];
export const stabMethodText = (k) => Object.fromEntries(ST_METHODS())[k] ?? k;

/** Камеры, по которым есть записи брахитерапии, и колодезные камеры «Оборудования». */
function brachyChambers(j) {
  const used = new Set((j.brachyRecords ?? []).flatMap((r) => [r.chamberId, r.refChamberId]).filter(Boolean));
  return j.chambers.filter((c) => used.has(c.id) || (isWellModel(c.form?.ch_model) && !isRetired(c)));
}
/** Есть ли что показать по брахитерапии: афтерлоадеры, колодезные камеры или записи. */
export const hasBrachy = (j) => brachyMachines(j).length > 0 || (j.brachyRecords ?? []).length > 0 || brachyChambers(j).some((c) => isWellModel(c.form?.ch_model));

/** Пункты выбора аппарата «Журнала и трендов» для брахитерапии (группа списка). */
export function brachyPickOptions(j, cur) {
  if (!hasBrachy(j)) return '';
  const opt = (v, t) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(t)}</option>`;
  return `<optgroup label="${esc(L('Брахитерапия', 'Brachytherapy'))}">${opt(BR_ALL, L('брахитерапия: все записи', 'brachytherapy: all records'))}${brachyMachines(j)
    .map((m) => opt(`br:m:${m.id}`, L(`афтерлоадер: ${machineName(m)}`, `afterloader: ${machineName(m)}`)))
    .join('')}${brachyChambers(j)
    .map((c) => opt(`br:c:${c.id}`, L(`камера: ${chamberText(c)}`, `chamber: ${chamberText(c)}`)))
    .join('')}</optgroup>`;
}
/** Выбор ещё есть в журнале. */
export function brachyPickValid(j, pick) {
  if (!hasBrachy(j) || !isBrachyPick(pick)) return false;
  const [, k, id] = String(pick).split(':');
  if (!k) return true;
  return k === 'm' ? brachyMachines(j).some((m) => m.id === id) : brachyChambers(j).some((c) => c.id === id);
}
/** Подпись выбора. */
export function brachyPickText(j, pick) {
  const [, k, id] = String(pick).split(':');
  if (k === 'm') return machineName(j.machines.find((m) => m.id === id));
  if (k === 'c') return chamberText(j.chambers.find((c) => c.id === id)) || L('камера', 'chamber');
  return L('Брахитерапия', 'Brachytherapy');
}
/** Записи по выбору, по дате (старые сначала). */
export function brachyPickRecords(j, pick) {
  const [, k, id] = String(pick).split(':');
  return brachyRecordsOf(j, k === 'm' ? { machineId: id } : k === 'c' ? { chamberId: id } : {});
}

/** Источник записи коротко: модель и номер. */
function recSource(j, r) {
  const m = j.machines.find((x) => x.id === r.machineId);
  const s = m?.sources?.find((x) => x.id === r.sourceId);
  if (!s) return '';
  return [sourceModelName(s), s.serial ? `№ ${s.serial}` : ''].filter(Boolean).join(', ');
}
/** Результат записи для таблицы: текст и отметка. */
export function recResult(r) {
  const s = r.summary ?? {};
  if (r.sheet === 'well' || r.sheet === 'phantom') {
    const text = L(`${fmt(s.mGyh, 3)} мГр/ч на 1 м (${fmt(s.U, 0)} U)`, `${fmt(s.mGyh, 3)} mGy/h at 1 m (${fmt(s.U, 0)} U)`) + (s.variantLabel ? ` · ${s.variantLabel}` : '');
    return { text, chip: Number.isFinite(s.dev) ? chipHtml({ dev: s.dev, level: s.level || 'ok' }) : '' };
  }
  if (r.sheet === 'stab') {
    const cls = s.pass ? 'ok' : 'out';
    return { text: `${stabMethodText(s.method)}: ${fmt(s.value, 4)} / ${fmt(s.base, 4)}`, chip: Number.isFinite(s.dev) ? `<span class="chip ${cls}">${esc(fmtSigned(s.dev, 2))} % ${esc(L(`от исходного (±${fmt(s.tol, 1)} %)`, `from the baseline (±${fmt(s.tol, 1)}%)`))}</span>` : '' };
  }
  if (r.sheet === 'cross') {
    const u = unitLabel(WELL_N_UNITS[s.unit]) ?? '';
    return { text: `N = ${Number.isFinite(s.N) ? fmt(+s.N.toPrecision(6), Math.max(0, 5 - Math.floor(Math.log10(Math.abs(s.N))))) : '—'} ${u}`, chip: Number.isFinite(s.dev) ? `<span class="chip ${Math.abs(s.dev) <= 0.5 ? 'ok' : 'out'}">${esc(fmtSigned(s.dev, 2))} % ${esc(L('от прежнего', 'from the previous'))}</span>` : '' };
  }
  if (r.sheet === 'sweet') {
    const p = s.plateau;
    const pl = p && Number.isFinite(p.from) && Number.isFinite(p.to) ? L(`; плато 99 %: ${fmt(p.from, 1)}–${fmt(p.to, 1)} мм`, `; 99% plateau: ${fmt(p.from, 1)}–${fmt(p.to, 1)} mm`) : '';
    return { text: L(`максимум ${fmt(s.xPeak, 1)} мм${pl}`, `maximum ${fmt(s.xPeak, 1)} mm${pl}`), chip: Number.isFinite(s.shift) ? `<span class="chip ${Math.abs(s.shift) <= 1 ? 'ok' : 'out'}">${esc(fmtSigned(s.shift, 1))} ${esc(L('мм от сертификата', 'mm from the certificate'))}</span>` : '' };
  }
  return { text: '', chip: '' };
}
/** Запись вне допуска: сила источника — |отклонение| > 3 % (HDR, TRS-492, разд. 8.6.2), стабильность — вне своего допуска. */
export function recordOut(r) {
  const s = r.summary ?? {};
  if (r.sheet === 'well' || r.sheet === 'phantom') return Number.isFinite(s.dev) && Math.abs(s.dev) > CERT_TOLERANCE.hdrInvestigate;
  if (r.sheet === 'stab') return s.pass === false;
  return false;
}

/** Таблица записей (новые сверху). */
export function brachyRecordsHtml(j, pick) {
  const recs = brachyPickRecords(j, pick).slice().reverse();
  if (!recs.length) {
    return `<p class="chart-empty">${esc((j.brachyRecords ?? []).length
      ? L('По этому выбору записей нет.', 'No records for this selection.')
      : L('Записей брахитерапии пока нет: на листах «Колодезная камера», «Фантом PTW 9193», «Стабильность», «Сличение камер» и «Максимум отклика» вкладки «Брахитерапия» — кнопка «Записать в журнал».', 'No brachytherapy records yet: the Well-type chamber, PTW 9193 phantom, Stability, Cross-calibration and Sweet spot sheets of the Brachytherapy tab have the Record to the journal button.'))}</p>`;
  }
  const rows = recs.map((r) => {
    const m = j.machines.find((x) => x.id === r.machineId);
    const c = j.chambers.find((x) => x.id === r.chamberId);
    const ref = j.chambers.find((x) => x.id === r.refChamberId);
    const res = recResult(r);
    const who = [m ? machineName(m) : '', c ? chamberText(c) : '', ref ? L(`эталонная: ${chamberText(ref)}`, `reference: ${chamberText(ref)}`) : ''].filter(Boolean);
    return `<tr>
      <td data-cap="${esc(L('Дата', 'Date'))}">${esc(isoDateText(r.date))}</td>
      <td data-cap="${esc(L('Измерение', 'Measurement'))}"><b>${esc(brachySheetText(r.sheet))}${r.summary?.nuclide ? ` · ${esc(HALF_LIVES[r.summary.nuclide]?.label ?? r.summary.nuclide)}` : ''}</b>${who.length ? `<br>${who.map(esc).join('<br>')}` : ''}${recSource(j, r) ? `<br><small>${esc(recSource(j, r))}</small>` : ''}</td>
      <td data-cap="${esc(L('Результат', 'Result'))}">${esc(res.text)} ${res.chip}${r.notes ? `<br><small>${esc(r.notes)}</small>` : ''}</td>
      <td data-cap="${esc(L('Выполнил', 'Performed by'))}">${esc((r.staff ?? []).join(', ') || '—')}</td>
      <td class="del"><button type="button" class="link-btn" data-br-open="${esc(r.id)}">${esc(L('Открыть на листе', 'Open on the sheet'))}</button> <button type="button" class="link-btn danger" data-br-del="${esc(r.id)}">${esc(L('Удалить', 'Delete'))}</button></td>
    </tr>`;
  }).join('');
  return `<div class="table-wrap"><table class="factors jf-table br-log-t"><thead><tr><th>${esc(L('Дата', 'Date'))}</th><th>${esc(L('Измерение', 'Measurement'))}</th><th>${esc(L('Результат', 'Result'))}</th><th>${esc(L('Выполнил', 'Performed by'))}</th><th class="del"><span class="visually-hidden">${esc(L('Действия', 'Actions'))}</span></th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

/** Группы для контрольных карт: сила источника — по аппарату и листу, стабильность — по камере и методу. */
export function spcGroups(j, recs) {
  const groups = new Map();
  const add = (key, g, r) => {
    if (!groups.has(key)) groups.set(key, { ...g, recs: [] });
    groups.get(key).recs.push(r);
  };
  for (const r of recs) {
    if (!Number.isFinite(r.summary?.dev)) continue;
    if (r.sheet === 'well' || r.sheet === 'phantom') {
      const m = j.machines.find((x) => x.id === r.machineId);
      add(`s|${r.machineId}|${r.sheet}`, { kind: 'src', sheet: r.sheet, title: L(`Сила источника, ${r.sheet === 'well' ? 'колодезная камера' : 'фантом PTW 9193'}: ${machineName(m)}`, `Source strength, ${r.sheet === 'well' ? 'well-type chamber' : 'PTW 9193 phantom'}: ${machineName(m)}`) }, r);
    } else if (r.sheet === 'stab') {
      const c = j.chambers.find((x) => x.id === r.chamberId);
      add(`c|${r.chamberId}|${r.summary.method}`, { kind: 'stab', title: L(`Стабильность: ${chamberText(c) || 'камера'} (${stabMethodText(r.summary.method)})`, `Stability: ${chamberText(c) || 'chamber'} (${stabMethodText(r.summary.method)})`), tol: r.summary.tol || 0.5 }, r);
    }
  }
  return [...groups.values()].map((g) => ({ ...g, recs: g.recs.slice().sort((x, y) => String(x.date).localeCompare(String(y.date))) }));
}
/** Точки карты: новый отсчёт — после замены источника (сила источника) или с новым исходным значением (стабильность). */
function spcPoints(g) {
  return g.recs.map((r, i) => {
    const prev = g.recs[i - 1];
    const restart = !!prev && (g.kind === 'src' ? r.sourceId !== prev.sourceId : r.summary.base !== prev.summary.base);
    return { day: dayNumber(r.date), value: r.summary.dev, date: r.date, ...(restart ? { restart: true, reason: g.kind === 'src' ? 'source' : 'baseline' } : {}) };
  });
}
const groupTol = (g) => (g.kind === 'src' ? CERT_TOLERANCE.hdrInvestigate : g.tol);
/** Карты групп выбора: [{ g, chart }]. */
export function brachyCharts(j, pick) {
  return spcGroups(j, brachyPickRecords(j, pick)).map((g) => ({ g, chart: controlChart(spcPoints(g), { tol: groupTol(g) }) }));
}

/** Разметка контрольных карт (рисует drawBrachyCharts). */
export function brachyChartsHtml(charts) {
  if (!charts.length) return `<p class="chart-empty">${esc(L('Карты появятся, когда в журнале будут записи силы источника с отклонением от сертификата или проверки стабильности камеры с исходным значением.', 'The charts appear once the journal has source strength records with a deviation from the certificate or chamber stability checks with a baseline.'))}</p>`;
  return `${charts.map(({ g, chart }, i) => {
    const tol = groupTol(g);
    const tolText = g.kind === 'src'
      ? L(`допуск: ±${CERT_TOLERANCE.hdrInvestigate} % — выяснить причину, ±${CERT_TOLERANCE.hdrStop} % — не использовать (HDR, TRS-492, разд. 8.6.2)`, `tolerance: ±${CERT_TOLERANCE.hdrInvestigate}%: investigate, ±${CERT_TOLERANCE.hdrStop}%: do not use (HDR, TRS-492, Sec. 8.6.2)`)
      : L(`допуск ±${fmt(tol, 1)} % (TRS-492, разд. 8.5)`, `tolerance ±${fmt(tol, 1)}% (TRS-492, Sec. 8.5)`);
    return `<h3 class="sub-h">${esc(g.title)}</h3>
      <div class="chart-box" id="br-spc-${i}"></div>
      <div class="chart-legend">${legendHtml([
        [{ cls: 't1' }, g.kind === 'src' ? L('отклонение от сертификата', 'deviation from the certificate') : L('отклонение от исходного', 'deviation from the baseline')],
        [{ cls: 'sig', shape: 'square' }, L('сигнал карты', 'chart signal')],
        [{ line: true, cls: 'cl' }, L('центральная линия', 'centre line')],
        [{ line: true, cls: 'lim2' }, '±2σ'],
        [{ line: true, cls: 'lim3', dashed: true }, '±3σ'],
        [{ line: true, cls: 'aux', dashed: true }, tolText],
      ])}</div>
      <div class="hs-spc-summary"><p>${chart.current ? segmentLine(chart) : ''}</p>${chart.trend || chart.trendWait ? `<p>${trendLine(chart, tol)}</p>` : ''}${signalsHtml(chart, () => '', g.kind === 'src' ? L('Сигналов нет: сила источника меняется в пределах обычного разброса.', 'No signals: the source strength varies within its usual scatter.') : L('Сигналов нет: показание камеры меняется в пределах обычного разброса.', 'No signals: the chamber reading varies within its usual scatter.'))}</div>`;
  }).join('')}
    <p class="sub-hint">${esc(L('Отсчёт карты начинается заново после замены источника (сила источника) и с новым исходным значением камеры (стабильность). Сигнал — повод разобраться, а не выход за допуск: точка за 3σ — скачок, накопленная сумма (CUSUM) — небольшой устойчивый сдвиг. σ = MR̄/1,128 по первым 20 записям отсчёта (Montgomery, Introduction to Statistical Quality Control; Pawlicki и др., Med Phys 32 (2005) 2777).', 'The chart count restarts after a source exchange (source strength) and with a new chamber baseline (stability). A signal is a reason to investigate, not an out-of-tolerance result: a point beyond 3σ is a jump, the cumulative sum (CUSUM) a small sustained shift. σ = MR̄/1.128 from the first 20 records of the count (Montgomery, Introduction to Statistical Quality Control; Pawlicki et al., Med Phys 32 (2005) 2777).'))}</p>`;
}

/** Нарисовать карты в разметке brachyChartsHtml. */
export function drawBrachyCharts(charts) {
  charts.forEach(({ g, chart }, i) => {
    const box = document.getElementById(`br-spc-${i}`);
    if (!box) return;
    const tol = groupTol(g);
    const days = chart.points.map((p) => p.day);
    const x0 = Math.min(...days) - 400;
    const x1 = Math.max(...days) + 400;
    const stop = CERT_TOLERANCE.hdrStop;
    drawChart(box, chart, {
      tol,
      label: L(`Контрольная карта: ${g.title}`, `Control chart: ${g.title}`),
      yLabel: g.kind === 'src' ? L('Отклонение от сертификата, %', 'Deviation from the certificate, %') : L('Отклонение от исходного, %', 'Deviation from the baseline, %'),
      check: () => false,
      pointTitle: (p) => `${isoDateText(p.date)}: ${fmtSigned(p.value, 2)} %${Number.isFinite(p.z) ? ` (${fmtSigned(p.z, 1)}σ)` : ''}${pointRules(p)}`,
      extraLines: g.kind === 'src' ? [stop, -stop].map((a) => ({ cls: 'aux', a, b: 0, x0, x1, dashed: true })) : [],
      extraNotes: g.kind === 'src' ? [{ x: Math.min(...days), y: stop, text: `+${stop} %`, anchor: 'start' }, { x: Math.min(...days), y: -stop, text: `−${stop} %`, anchor: 'start', below: true }] : [],
      yExtra: g.kind === 'src' ? [-stop, stop] : [],
    });
  });
}

/** Замечания по картам и последним записям: [{ level, head, text }]. */
export function brachyMessages(j, pick, charts) {
  const out = [];
  for (const { g, chart } of charts) {
    const last = g.recs.at(-1);
    if (last && recordOut(last)) out.push({ level: 'warn', head: L('Вне допуска', 'Out of tolerance'), text: L(`${g.title}: последняя запись ${isoDateText(last.date)} — ${fmtSigned(last.summary.dev, 2)} %.`, `${g.title}: the last record ${isoDateText(last.date)} is ${fmtSigned(last.summary.dev, 2)}%.`) });
    const cur = chart.current;
    const sig = (cur ? chart.points.slice(cur.from, cur.to + 1) : chart.points).filter((p) => p.signals.length);
    if (sig.length) out.push({ level: 'warn', head: L('Сигнал карты', 'Chart signal'), text: L(`${g.title}: сигналов в текущем отсчёте — ${sig.length}, последний ${isoDateText(sig.at(-1).date)}.`, `${g.title}: ${sig.length} signal(s) in the current count, the last on ${isoDateText(sig.at(-1).date)}.`) });
  }
  // стабильность колодезной камеры — не реже четырёх раз в год (TRS-492, разд. 8.4)
  const stab = brachyPickRecords(j, pick).filter((r) => r.sheet === 'stab');
  const lastStab = stab.at(-1);
  if (lastStab && dayNumber(new Date().toISOString().slice(0, 10)) - dayNumber(lastStab.date) > 92) out.push({ level: 'info', head: L('Стабильность камеры', 'Chamber stability'), text: L(`Последняя проверка стабильности — ${isoDateText(lastStab.date)}, больше трёх месяцев назад: проверяйте не реже четырёх раз в год (TRS-492, разд. 8.4).`, `The last stability check was ${isoDateText(lastStab.date)}, more than three months ago: check at least four times a year (TRS-492, Sec. 8.4).`) });
  return out;
}
