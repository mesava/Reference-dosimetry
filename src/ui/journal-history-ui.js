// Вкладка «Журнал и тренды»: записи аппарата, тренд отклонения выхода от номинала по пучкам, контрольная карта
// пучка и общая часть сеансов (journal-spc-ui.js), k_pol и k_s по калибровкам, сроки калибровки, выгрузка в CSV.
// С 0.46.0 — и рентгенотерапевтические аппараты: записи журнала kV (аппарат за день), «Открыть во вкладке», протокол.
import { L } from '../core/i18n.js';
import { trendSeries, machineOf, equipmentDue, equipmentNoDue, dayNumber, beamKind, moveSession } from '../core/journal.js';
import { $, esc, fmt, fmtSigned, today, makeStatus, armButton, notifyUpdate, richText, downloadText, copyText, printToPdf } from './common.js';
import { sessionReportText } from './journal-report.js';
import { scatterChart, legendSwatch } from './chart.js';
import { getJournal, updateJournal, onJournal } from './journal-store.js';
import { renderSpc, renderCommon, spcMessages, renderChecks, checkSignalMessages, renderKvSpc, renderKvCommon, kvSpcMessages } from './journal-spc-ui.js';
import { kvModeCharts, kvChartSignals } from '../core/kv-spc.js';
import { journalCsv, checksCsv, csvFileName } from '../core/journal-csv.js';
import { setupFilePanel, beamMachines, fmtDate, countWord, dayToIso, monthLabel, monthTicks } from './journal-common.js';
import { kvRecordsOf, kvRecordCounts, kvRecModeText, kvJournalInputs } from '../core/kv-records.js';
import { kvOutputSeries, kvDoseByDate, kvDoseByDateTsv, kvModeHistory, kvTrendModes, kvSrcText, kvRecordsCsv } from '../core/kv-trends.js';
import { KV_SET_UNITS } from '../core/kv.js';
import { kvMachineText } from '../core/kv-journal.js';
import { normalizeKvVisit, computeKvVisit } from '../core/kv-session.js';
import { kvProtocolHtml } from './kv-summary-ui.js';

const ROOT = () => $('#module-history');
let setStatus = () => {};
let machineId = '';
let kindFilter = 'photon'; // какие пучки показывать, если у аппарата их несколько видов (фотоны, электроны, ⁶⁰Co)
let kindChosen = false; // вид выбран переключателем (до смены аппарата)
let spcBeamId = ''; // пучок контрольной карты
let commonRes = null; // общая часть записей показанного вида
let checkKey = ''; // пара камер «Контроля дозиметра»
let checkRes = null; // её карта и оценка стабильности
/** Ряды трендов выбранного аппарата и вида пучков; переключатель вида — только если у аппарата их несколько. */
function seriesOf(j) {
  const all = trendSeries(j, machineId);
  const kinds = new Set(all.map((s) => s.kind));
  if (!kindChosen || !kinds.has(kindFilter)) {
    // сначала вид, у которого есть сеансы; у аппарата ⁶⁰Co — пучки ⁶⁰Co
    const order = machineOf(j, machineId)?.kind === 'cobalt' ? ['cobalt', 'photon', 'electron'] : ['photon', 'electron', 'cobalt'];
    const withData = new Set(all.filter((s) => s.points.length).map((s) => s.kind));
    kindFilter = order.find((k) => withData.has(k)) ?? order.find((k) => kinds.has(k)) ?? 'photon';
  }
  $('#hs-kind-field').hidden = kinds.size < 2;
  for (const k of ['photon', 'electron', 'cobalt']) {
    const r = document.getElementById(`hs_kind_${k}`);
    if (!r) continue;
    r.closest('label').hidden = !kinds.has(k);
    r.checked = k === kindFilter;
  }
  return all.filter((s) => s.kind === kindFilter);
}
let bridge = { openInTab: () => {}, toBudget: () => {}, openKv: () => {} };
/**
 * openInTab(kind, form, title) — записанный пучок во вкладке дозиметрии (для просмотра); toBudget(u, text) — в бюджет
 * неопределённости; openKv(file, title) — запись журнала kV во вкладке «kV-рентген».
 */
export const setHistoryBridge = (b) => (bridge = { ...bridge, ...b });

function renderChart(series) {
  const box = $('#hs-chart');
  const legend = $('#hs-legend');
  const withData = series.filter((s) => s.points.some((p) => Number.isFinite(p.deviation)));
  if (!withData.length) {
    box.innerHTML = `<p class="chart-empty">${esc(kindFilter === 'cobalt' ? L('График появится, когда в журнале будут записи этого аппарата со значением для сравнения: после первой калибровки или со значением из «Оборудования».', 'The plot appears once the journal has records of this machine with a comparison value: after the first calibration or with the value from Equipment.') : L('График появится, когда в журнале будут записи этого аппарата с номинальным выходом.', 'The plot appears once the journal has records of this machine with a nominal output.'))}</p>`;
    legend.innerHTML = '';
    return;
  }
  const cls = (i) => `t${(i % 8) + 1}`;
  const all = withData.flatMap((s) => s.points.filter((p) => Number.isFinite(p.deviation)));
  // линия допуска — по допуску пучков (наибольший из записанных), ось — не уже ±2 %
  const tols = all.map((p) => p.tol).filter(Number.isFinite);
  const tol = tols.length ? Math.max(...tols) : 2;
  const yr = Math.max(tol, 2);
  const days = all.map((p) => p.day);
  const x0 = Math.min(...days);
  const x1 = Math.max(...days);
  const co = kindFilter === 'cobalt';
  const spec = {
    label: co ? L('Отклонение мощности дозы от ожидаемой по датам записей', 'Dose rate deviation from the expected value by record date') : L('Отклонение выхода от номинала по датам записей', 'Output deviation from nominal by record date'),
    xLabel: L('Дата измерения', 'Measurement date'),
    yLabel: co ? L('Отклонение от ожидаемой, %', 'Deviation from expected, %') : L('Отклонение от номинала, %', 'Deviation from nominal, %'),
    fmt,
    xFmt: monthLabel,
    xTicks: monthTicks,
    xInclude: x0 === x1 ? [x0 - 15, x1 + 15] : [],
    yInclude: [-yr, yr],
    aspect: 0.5,
    series: [
      ...withData.map((s, i) => ({ cls: cls(i), line: true, points: s.points.filter((p) => Number.isFinite(p.deviation)).map((p) => ({ x: p.day, y: p.deviation })) })),
      ...withData.map((s, i) => ({
        cls: cls(i),
        shape: 'circle',
        points: s.points.filter((p) => Number.isFinite(p.deviation)).map((p) => ({ x: p.day, y: p.deviation, hollow: p.mode === 'check', title: `${s.beam.name}, ${fmtDate(p.date)}: ${fmtSigned(p.deviation, 2)} % (${p.mode === 'cal' ? L('калибровка', 'calibration') : L('проверка', 'check')})` })),
      })),
    ],
    lines: [
      { cls: 'aux', a: tol, b: 0, x0: x0 - 400, x1: x1 + 400, dashed: true },
      { cls: 'aux', a: -tol, b: 0, x0: x0 - 400, x1: x1 + 400, dashed: true },
    ],
    notes: [{ x: x0, y: tol, text: `+${fmt(tol, tol % 1 ? 1 : 0)} %`, anchor: 'start' }, { x: x0, y: -tol, text: `−${fmt(tol, tol % 1 ? 1 : 0)} %`, anchor: 'start', below: true }],
    crosshair: (x) => {
      // ближайшая дата сеанса и значения всех пучков в этот день
      let best = days[0];
      for (const d of days) if (Math.abs(d - x) < Math.abs(best - x)) best = d;
      const rows = withData
        .map((s, i) => {
          const p = s.points.find((q) => q.day === best && Number.isFinite(q.deviation));
          return p ? { cls: cls(i), y: p.deviation, text: `${s.beam.name}: ${fmtSigned(p.deviation, 2)} %` } : null;
        })
        .filter(Boolean);
      return rows.length ? { x: best, head: fmtDate(dayToIso(best)), rows } : null;
    },
  };
  scatterChart(box, spec);
  legend.innerHTML =
    withData.map((s, i) => `<span class="item">${legendSwatch({ line: true, cls: cls(i) })}<span>${esc(s.beam.name)}</span></span>`).join('') +
    `<span class="item">${legendSwatch({ cls: 't1', hollow: true })}<span>${esc(L('полый значок — проверка выхода', 'hollow marker: output check'))}</span></span>` +
    `<span class="item">${legendSwatch({ line: true, dashed: true, cls: 'aux' })}<span>${esc(L('допуск', 'tolerance'))}</span></span>`;
}

function renderTables(j, series) {
  const sessions = j.sessions.filter((s) => s.machineId === machineId);
  const beams = series.map((s) => s.beam);
  const ids = new Set(beams.map((b) => b.id));
  // в таблицах — сеансы, где есть пучки показанного вида (список сеансов ниже — все)
  const shown = sessions.filter((s) => s.beams.some((b) => ids.has(b.beamId)));
  // таблица значений графика
  const head = `<tr><th>${esc(L('Дата', 'Date'))}</th><th>${esc(L('Режим', 'Mode'))}</th>${beams.map((b) => `<th class="v">${esc(b.name)}</th>`).join('')}</tr>`;
  const cell = (s, b, f) => {
    const x = s.beams.find((y) => y.beamId === b.id)?.summary;
    return x ? f(x) : '—';
  };
  $('#hs-table').innerHTML = shown.length
    ? `<table class="factors"><thead>${head}</thead><tbody>${shown
        .slice()
        .reverse()
        .map((s) => `<tr><td>${esc(fmtDate(s.date))}</td><td>${esc(s.mode === 'cal' ? L('калибровка', 'calibration') : L('проверка', 'check'))}</td>${beams.map((b) => `<td class="v">${cell(s, b, (x) => (x.ok ? `${fmt(x.value, kindFilter === 'cobalt' ? 2 : 4)}<br><small class="${x.status === 'out' ? 'st-out' : ''}">${Number.isFinite(x.deviation) ? `${fmtSigned(x.deviation, 2)} %` : ''}</small>` : '—'))}</td>`).join('')}</tr>`)
        .join('')}</tbody></table><p class="sub-hint">${esc(kindFilter === 'cobalt' ? L('В ячейке: мощность дозы, сГр/мин (на z_max или z_ref — где задано значение для сравнения), и отклонение от ожидаемой.', 'In each cell: the dose rate, cGy/min (at z_max or z_ref, where the comparison value is given), and the deviation from the expected value.') : L('В ячейке: доза в точке номинала, Гр на 100 МЕ, и отклонение от номинала.', 'In each cell: the dose at the nominal point, Gy per 100 MU, and the deviation from nominal.'))}</p>`
    : `<p class="sub-hint">${esc(L('Записей этого аппарата нет.', 'No records for this machine.'))}</p>`;
  // k_pol и k_s по калибровкам
  const cals = shown.filter((s) => s.mode === 'cal');
  const kHead = `<tr><th>${esc(L('Калибровка', 'Calibration'))}</th>${beams.map((b) => `<th class="v">${esc(b.name)}</th>`).join('')}</tr>`;
  $('#hs-ktable').innerHTML = cals.length
    ? `<table class="factors"><thead>${kHead}</thead><tbody>${cals
        .slice()
        .reverse()
        .map((s) => `<tr><td>${esc(fmtDate(s.date))}</td>${beams.map((b) => `<td class="v">${cell(s, b, (x) => (Number.isFinite(x.kpolRaw) ? `${fmt(x.kpolRaw, 4)}<br>${fmt(x.ksRaw, 4)}${kindFilter === 'cobalt' ? `<br>${Number.isFinite(x.tauMin) ? `${fmtSigned(x.tauMin * 60, 2)} ${esc(L('с', 's'))}` : '—'}` : ''}` : '—'))}</td>`).join('')}</tr>`)
        .join('')}</tbody></table><p class="sub-hint">${richText(kindFilter === 'cobalt'
          ? L('В ячейке: k_pol (сверху), k_s и ошибка таймера τ в секундах, измеренные при калибровке. Их изменение от калибровки к калибровке — ранний признак неполадки камеры, кабеля, электрометра или привода источника.', 'In each cell: k_pol (top), k_s and the timer error τ in seconds, measured at the calibration. A change between calibrations is an early sign of a problem with the chamber, cable, electrometer or source drive.')
          : L('В ячейке: k_pol (сверху) и k_s, измеренные при калибровке. Их изменение от калибровки к калибровке — ранний признак неполадки камеры, кабеля или электрометра.', 'In each cell: k_pol (top) and k_s measured at the calibration. A change between calibrations is an early sign of a problem with the chamber, cable or electrometer.'))}</p>`
    : `<p class="sub-hint">${esc(L('Калибровок этого аппарата в журнале нет.', 'No calibrations of this machine in the journal.'))}</p>`;
  // список сеансов
  $('#hs-sessions').innerHTML = sessions.length
    ? `<ul class="jsessions">${sessions
        .slice()
        .reverse()
        .map((s) => {
          const bs = s.beams.filter((b) => b.summary);
          const m = machineOf(j, machineId);
          const out = bs.filter((b) => b.summary.status === 'out').map((b) => m?.beams.find((x) => x.id === b.beamId)?.name).filter(Boolean);
          const beamLines = bs
            .map((b) => {
              const name = m?.beams.find((x) => x.id === b.beamId)?.name || '—';
              const x = b.summary;
              const co = beamKind(b) === 'cobalt';
              const val = x.ok ? `${fmt(x.value, co ? 2 : 4)}${Number.isFinite(x.deviation) ? ` (${fmtSigned(x.deviation, 2)} %)` : ''}` : '—';
              return `<li class="${x.status === 'out' ? 'st-out' : ''}"><span>${esc(name)}: ${esc(val)}</span>${b.form ? `<button type="button" class="link-btn" data-open-beam="${esc(s.id)}|${esc(b.beamId)}">${esc(L('Открыть во вкладке', 'Open in the tab'))}</button>` : ''}</li>`;
            })
            .join('');
          return `<li><div><b>${esc(fmtDate(s.date))}</b> · ${esc(s.mode === 'cal' ? L('калибровка', 'calibration') : L('проверка выхода', 'output check'))} · ${esc(L(`пучков: ${bs.length}`, `beams: ${bs.length}`))}${(s.checks || []).length ? ` · ${esc(L(`проверок второй камерой: ${s.checks.length}`, `second-chamber checks: ${s.checks.length}`))}` : ''}${out.length ? ` · <span class="st-out">${esc(L(`вне допуска: ${out.join(', ')}`, `out of tolerance: ${out.join(', ')}`))}</span>` : ''}${s.staff?.some((x) => x.trim()) ? `<br><small>${esc(s.staff.filter((x) => x.trim()).join(', '))}</small>` : ''}</div>
            <ul class="jsess-beams">${beamLines}</ul>
            ${s.spcRestart ? `<small class="chip">${esc(L('с этой записи — новый отсчёт контрольной карты', 'a new control-chart count starts here'))}</small>` : ''}
            <div class="row-tools"><button type="button" class="link-btn" data-report="${esc(s.id)}">${esc(L('Протокол', 'Report'))}</button><button type="button" class="link-btn" data-spc-restart="${esc(s.id)}" title="${esc(L('Например, после ремонта или замены узла ускорителя без записанной подстройки: до и после — разные процессы.', 'For example, after a repair or replacement of a linac part without a recorded adjustment: before and after are different processes.'))}">${esc(s.spcRestart ? L('Убрать новый отсчёт карты', 'Remove the new chart count') : L('Новый отсчёт карты', 'New chart count'))}</button><button type="button" class="link-btn" data-move-session="${esc(s.id)}">${esc(L('Перенести на другую дату', 'Move to another date'))}</button><button type="button" class="link-btn danger" data-del-session="${esc(s.id)}">${esc(L('Удалить', 'Delete'))}</button></div>
            <div class="jmove" data-move-form="${esc(s.id)}" hidden><label>${esc(L('Новая дата записи', 'New date of the record'))} <input type="date" data-move-date value="${esc(s.date)}" max="${esc(today())}"></label> <button type="button" class="primary" data-move-ok="${esc(s.id)}">${esc(L('Перенести', 'Move'))}</button> <button type="button" data-move-cancel>${esc(L('Отмена', 'Cancel'))}</button>
              <p class="sub-hint">${esc(L('Переносятся все пучки записи вместе; показания, поправки и доза не меняются (у ⁶⁰Co ожидаемая мощность дозы пересчитывается по распаду на новую дату).', 'All beams of the record are moved together; the readings, corrections and dose do not change (for ⁶⁰Co the expected dose rate is decay-corrected to the new date).'))}</p><p class="jmove-err st-out" role="alert"></p></div></li>`;
        })
        .join('')}</ul>`
    : `<p class="sub-hint">${esc(L('Записей пока нет: выберите пучок журнала во вкладке «⁶⁰Co», «МВ фотоны» или «Электроны» (раздел 1), измерьте и нажмите «Записать в журнал».', 'No records yet: select a journal beam in the ⁶⁰Co, MV photons or Electrons tab (section 1), measure and click "Record to journal".'))}</p>`;
  for (const btn of $('#hs-sessions').querySelectorAll('[data-del-session]')) {
    armButton(btn, btn.textContent, () => L('Удалить запись?', 'Delete the record?'), () => {
      updateJournal((jj) => ({ ...jj, sessions: jj.sessions.filter((x) => x.id !== btn.dataset.delSession) }), 'history');
      setStatus(L('Запись удалена из журнала. Сохраните журнал в файл.', 'The record has been deleted from the journal. Save the journal to the file.'));
    });
  }
}

/** Проверки аппарата в пластинах (не референсные условия): таблица по датам; без проверок — одна строка. */
function renderPlates(j) {
  const m = machineOf(j, machineId);
  const rows = (j.plateChecks || []).filter((x) => x.machineId === machineId).slice().reverse();
  // раздел виден всегда: номера разделов не скачут
  $('#hs-plates-sec').hidden = false;
  if (!rows.length) {
    $('#hs-plates').innerHTML = `<p class="chart-empty">${esc(L('Проверок этого аппарата в пластинах пока нет: «Дозиметрия» → «В пластинах».', 'There are no checks of this machine in plates yet: Dosimetry → In plates.'))}</p>`;
    return;
  }
  const name = (id) => m?.beams.find((b) => b.id === id)?.name || '—';
  const co = (id) => beamKind(m?.beams.find((b) => b.id === id)) === 'cobalt';
  $('#hs-plates').innerHTML = `<table class="factors"><thead><tr><th>${esc(L('Дата', 'Date'))}</th><th>${esc(L('Пучок', 'Beam'))}</th><th class="v">${esc(L('Отношение к привязке', 'Ratio to the binding'))}</th><th class="v">${esc(L('Отклонение', 'Deviation'))}</th><th class="v">${esc(L('В пластинах без перевода', 'In plates, not converted'))}</th><th>${esc(L('Привязка', 'Binding'))}</th></tr></thead><tbody>${rows
    .map((r) => `<tr class="${r.summary?.status === 'out' ? 'st-out' : ''}"><td>${esc(fmtDate(r.date))}</td><td>${esc(name(r.beamId))}</td><td class="v">${esc(fmt(r.summary?.ratio, 4))}</td><td class="v">${esc(fmtSigned(r.summary?.deviation, 2))} %${co(r.beamId) ? ` ${esc(L('от ожидаемой', 'from expected'))}` : ''}</td><td class="v">${Number.isFinite(r.summary?.Dpl) ? `${esc(fmt(r.summary.Dpl, co(r.beamId) ? 2 : 4))} ${esc(co(r.beamId) ? L('сГр/мин', 'cGy/min') : L('сГр/МЕ', 'cGy/MU'))}` : '—'}</td><td>${esc(L(`к калибровке ${fmtDate(r.binding?.calDate)}`, `to the calibration of ${fmtDate(r.binding?.calDate)}`))}</td></tr>`)
    .join('')}</tbody></table><div class="actions"><a class="link-btn" href="#plates" data-goto="plates">${esc(L('Открыть «В пластинах»', 'Open In plates'))}</a></div>`;
}

// ------------------------------------------------------------ рентгенотерапевтический аппарат (записи kV)
const kvMachines = (j) => j.machines.filter((m) => m.kind === 'kv');
const isKv = (j) => machineOf(j, machineId)?.kind === 'kv';
/** Список аппаратов: ускорители и аппараты ⁶⁰Co, затем рентгенотерапевтические. */
function machineSelect(j) {
  const opt = (m, text) => `<option value="${esc(m.id)}"${m.id === machineId ? ' selected' : ''}>${esc(text)}</option>`;
  const beams = beamMachines(j).map((m) => opt(m, [m.name || L('без названия', 'unnamed'), m.serial ? `${L('№', 'S/N')} ${m.serial}` : ''].filter(Boolean).join(', ')));
  const kv = kvMachines(j).map((m) => opt(m, kvMachineText(m) || L('без названия', 'unnamed')));
  if (!beams.length && !kv.length) return `<option value="">${esc(L('— в «Оборудовании» нет аппаратов —', '— no machines in Equipment —'))}</option>`;
  return beams.join('') + (kv.length ? `<optgroup label="${esc(L('Рентгенотерапевтические аппараты', 'X-ray therapy units'))}">${kv.join('')}</optgroup>` : '');
}
const kvTitle = (j, r) => `${kvMachineText(machineOf(j, r.machineId)) || '—'}, ${fmtDate(r.date)}`;
/** Мощность дозы строки записи: «Ø 10 см (ст.) 1,0012 Гр/мин (+0,62 %)». */
function kvRowText(y) {
  const v = Number.isFinite(y.D) ? `${fmt(y.D, 4)} ${y.unit}` : '—';
  const d = Number.isFinite(y.dev) ? ` (${fmtSigned(y.dev, 2)} %)` : '';
  return `${y.label || '—'}${y.std ? L(' (ст.)', ' (ref.)') : ''} ${v}${d}`;
}

function renderKvRecords(j) {
  const recs = kvRecordsOf(j, machineId).slice().reverse();
  $('#hs-kv-records').innerHTML = recs.length
    ? `<ul class="jsessions">${recs
        .map((r) => {
          const n = kvRecordCounts(r);
          const over = n.over.map((x) => L(`режим ${x.m + 1}, ${x.label} (${fmtSigned(x.dev, 2)} %)`, `mode ${x.m + 1}, ${x.label} (${fmtSigned(x.dev, 2)} %)`));
          const lines = (r.summary?.modes ?? [])
            .map((x) => {
              // строка режима — стандартный тубус; другие аппликаторы вне допуска — отдельной пометкой
              const y = x.rows.find((z) => z.std) ?? x.rows[0];
              const others = x.rows.filter((z) => z !== y && z.verdict === 'over').map((z) => `${z.label} (${fmtSigned(z.dev, 2)} %)`);
              const more = [
                x.rows.length > 1 ? `<small>${esc(L(`аппликаторов ${x.rows.length}`, `${x.rows.length} applicators`))}</small>` : '',
                others.length ? `<small class="st-out">${esc(L(`вне допуска: ${others.join(', ')}`, `out of tolerance: ${others.join(', ')}`))}</small>` : '',
              ].filter(Boolean).join(' · ');
              return `<li class="${y?.verdict === 'over' ? 'st-out' : ''}"><span>${esc(L(`Режим ${x.m + 1}`, `Mode ${x.m + 1}`))}${x.title ? ` — ${esc(x.title)}` : ''}: ${esc(y ? kvRowText(y) : L('без проверки выхода', 'no output check'))}${more ? ` ${more}` : ''}</span></li>`;
            })
            .join('');
          // режимы, которые позже в тот же день записаны заново (запись по режимам, с 0.47.0)
          const gone = (r.summary?.replaced ?? []).map((x) => L(`режим ${x.m + 1}${x.title ? ` (${x.title})` : ''}`, `mode ${x.m + 1}${x.title ? ` (${x.title})` : ''}`));
          const goneLi = gone.length ? `<li class="kv-rec-gone"><small>${esc(L(`Заменены более поздней записью того же дня: ${gone.join(', ')}.`, `Replaced by a later record of the same day: ${gone.join(', ')}.`))}</small></li>` : '';
          const staff = (r.staff ?? []).filter((s) => String(s).trim());
          return `<li><div><b>${esc(fmtDate(r.date))}</b> · ${esc(kvRecModeText(r.mode))} · ${esc(L(`режимов: ${n.modes}, аппликаторов: ${n.rows}`, `modes: ${n.modes}, applicators: ${n.rows}`))}${over.length ? ` · <span class="st-out">${esc(L(`вне допуска: ${over.join('; ')}`, `out of tolerance: ${over.join('; ')}`))}</span>` : ''}${staff.length ? `<br><small>${esc(staff.join(', '))}</small>` : ''}
            ${r.spcRestart ? `<small class="chip">${esc(L('с этой записи — новый отсчёт контрольной карты', 'a new control-chart count starts here'))}</small>` : ''}</div>
            <ul class="jsess-beams">${lines}${goneLi}</ul>
            <div class="row-tools">${r.file ? `<button type="button" class="link-btn" data-kv-open="${esc(r.id)}">${esc(L('Открыть во вкладке', 'Open in the tab'))}</button>` : ''}${r.file ? `<button type="button" class="link-btn" data-report="${esc(r.id)}">${esc(L('Протокол', 'Report'))}</button>` : ''}<button type="button" class="link-btn" data-kv-spc="${esc(r.id)}" title="${esc(L('Например, после ремонта или замены трубки: до и после — разные ряды.', 'For example, after a repair or replacement of the tube: before and after are different series.'))}">${esc(r.spcRestart ? L('Убрать новый отсчёт карты', 'Remove the new chart count') : L('Новый отсчёт карты', 'New chart count'))}</button><button type="button" class="link-btn danger" data-kv-del="${esc(r.id)}">${esc(L('Удалить', 'Delete'))}</button></div></li>`;
        })
        .join('')}</ul>`
    : `<p class="sub-hint">${esc(L('Записей пока нет: во вкладке «kV-рентген» выберите этот аппарат (лист «Аппарат и режимы», блок «Журнал отделения»), измерьте и нажмите «Записать в журнал» (панель «Журнал» справа).', 'No records yet: in the kV x-rays tab select this unit (the Machine and modes sheet, the Department journal block), measure and click “Record to journal” (the Journal panel on the right).'))}</p>`;
  for (const btn of $('#hs-kv-records').querySelectorAll('[data-kv-del]')) {
    armButton(btn, btn.textContent, () => L('Удалить запись?', 'Delete the record?'), () => {
      updateJournal((jj) => ({ ...jj, kvRecords: (jj.kvRecords ?? []).filter((x) => x.id !== btn.dataset.kvDel) }), 'history');
      setStatus(L('Запись удалена из журнала. Сохраните журнал в файл.', 'The record has been deleted from the journal. Save the journal to the file.'));
    });
  }
}

function renderKvReadout(j, ctl = null) {
  const m = machineOf(j, machineId);
  const recs = kvRecordsOf(j, machineId);
  const last = recs.at(-1);
  const lastCal = recs.filter((r) => r.mode === 'cal').at(-1);
  const outLast = last ? kvRecordCounts(last).over.length : 0;
  $('#hs-result').innerHTML = `<div class="dose-row"><div class="proto"><span>${esc(kvMachineText(m) || '—')}</span>${last ? (outLast ? `<span class="chip warn">${esc(L(`вне допуска: ${outLast}`, `out of tolerance: ${outLast}`))}</span>` : `<span class="chip good">${esc(L('последняя запись в допуске', 'last record within tolerance'))}</span>`) : ''}</div>
    <div class="dose-big">${recs.length}<small>${esc(countWord(recs.length, [L('запись', 'record'), L('записи', 'records'), L('записей', 'records')], ['record', 'records']))}</small></div>
    <div class="secondary">${esc(L(`последняя: ${last ? fmtDate(last.date) : '—'}; последняя калибровка: ${lastCal ? fmtDate(lastCal.date) : '—'}`, `last: ${last ? fmtDate(last.date) : '—'}; last calibration: ${lastCal ? fmtDate(lastCal.date) : '—'}`))}</div></div>`;
  const msgs = equipmentDue(j, today()).map((d) => `<li class="${d.status === 'overdue' ? 'warn' : 'info'}"><span class="lvl">${esc(d.status === 'overdue' ? L('Срок калибровки прошёл', 'Calibration overdue') : L('Срок калибровки подходит', 'Calibration due soon'))}</span><span>${esc(`${d.text}: ${fmtDate(d.dueDate)}`)}</span></li>`);
  if (lastCal && dayNumber(today()) - dayNumber(lastCal.date) > 365) msgs.push(`<li class="info"><span class="lvl">${esc(L('Калибровка', 'Calibration'))}</span><span>${esc(L(`Последняя калибровка аппарата — больше года назад (${fmtDate(lastCal.date)}).`, `The unit's last calibration was more than a year ago (${fmtDate(lastCal.date)}).`))}</span></li>`);
  const nr = [...new Set(recs.flatMap((r) => r.summary?.notRev1 ?? []))];
  if (nr.length) msgs.push(`<li class="warn"><span class="lvl">${esc(L('Не по TRS-398 Rev.1', 'Not TRS-398 Rev.1'))}</span><span>${esc(L(`В записях есть расчёт не по TRS-398 Rev.1: ${nr.join('; ')}.`, `The records include calculations not according to TRS-398 Rev.1: ${nr.join('; ')}.`))}</span></li>`);
  if (ctl) for (const x of kvSpcMessages(ctl.charts, ctl.common)) msgs.push(`<li class="${x.level}"><span class="lvl">${esc(x.head)}</span><span>${esc(x.text)}</span></li>`);
  $('#hs-messages').innerHTML = msgs.join('') || `<li class="info"><span class="lvl">${esc(L('Всё в порядке', 'All clear'))}</span><span>${esc(L('Ни один срок калибровки камер и электрометров не истёк и не истекает в ближайшие 30 дней.', 'No chamber or electrometer calibration has expired or expires within the next 30 days.'))}</span></li>`;
  $('#hs-mobile-value').textContent = `${kvMachineText(m) || '—'}: ${recs.length}`;
}


// ------------------------------------------------------------ рентгенотерапевтический аппарат: тренды (с 0.48.0)
let kvModeSel = ''; // режим таблицы «Режим по датам»
let kvSpcSel = ''; // режим контрольной карты
let kvChecks = false; // сводная по датам — с проверками выхода
const kvModeName = (s) => `${s.n ? `${s.n}. ` : ''}${s.title}`;
const kindShort = (k) => (k === 'check' ? L('проверка', 'check') : L('калибровка', 'calibration'));

/** Выход по режимам: отклонение стандартного тубуса режима от базы по датам, по линии на режим. */
function renderKvChart(j) {
  const m = machineOf(j, machineId);
  const box = $('#hs-kv-chart');
  const legend = $('#hs-kv-legend');
  const series = kvOutputSeries(j, m)
    .map((s) => ({ ...s, pts: s.points.filter((p) => Number.isFinite(p.dev) && Number.isFinite(p.day)) }))
    .filter((s) => s.pts.length);
  if (!series.length) {
    box.innerHTML = `<p class="chart-empty">${esc(L('График появится, когда у записей будет база для сравнения: со второй калибровки режима (база — предыдущая калибровка) или со значением «Сравнить с», введённым во вкладке.', 'The plot appears once the records have a baseline: from the second calibration of a mode (the baseline is the previous calibration) or with a “Compare with” value entered in the tab.'))}</p>`;
    legend.innerHTML = '';
    return;
  }
  const cls = (i) => `t${(i % 8) + 1}`;
  const all = series.flatMap((s) => s.pts);
  const tols = all.map((p) => p.tol).filter(Number.isFinite);
  const tol = tols.length ? Math.max(...tols) : 2;
  const yr = Math.max(tol, 2);
  const days = all.map((p) => p.day);
  const x0 = Math.min(...days);
  const x1 = Math.max(...days);
  const tip = (s, p) => `${kvModeName(s)}, ${p.label}, ${fmtDate(p.date)}: ${fmtSigned(p.dev, 2)} % (${kindShort(p.kind)})`;
  scatterChart(box, {
    label: L('Отклонение мощности дозы стандартного тубуса от базы по датам записей', 'Deviation of the reference-applicator dose rate from the baseline by record date'),
    xLabel: L('Дата измерения', 'Measurement date'),
    yLabel: L('Отклонение от базы, %', 'Deviation from the baseline, %'),
    fmt,
    xFmt: monthLabel,
    xTicks: monthTicks,
    xInclude: x0 === x1 ? [x0 - 15, x1 + 15] : [],
    yInclude: [-yr, yr],
    aspect: 0.5,
    series: [
      ...series.map((s, i) => ({ cls: cls(i), line: true, points: s.pts.map((p) => ({ x: p.day, y: p.dev })) })),
      ...series.map((s, i) => ({ cls: cls(i), shape: 'circle', points: s.pts.map((p) => ({ x: p.day, y: p.dev, hollow: p.kind === 'check', title: tip(s, p) })) })),
    ],
    lines: [
      { cls: 'aux', a: tol, b: 0, x0: x0 - 400, x1: x1 + 400, dashed: true },
      { cls: 'aux', a: -tol, b: 0, x0: x0 - 400, x1: x1 + 400, dashed: true },
    ],
    notes: [{ x: x0, y: tol, text: `+${fmt(tol, tol % 1 ? 1 : 0)} %`, anchor: 'start' }, { x: x0, y: -tol, text: `−${fmt(tol, tol % 1 ? 1 : 0)} %`, anchor: 'start', below: true }],
    crosshair: (x) => {
      let best = days[0];
      for (const d of days) if (Math.abs(d - x) < Math.abs(best - x)) best = d;
      const rows = series
        .map((s, i) => {
          const p = s.pts.find((q) => q.day === best);
          return p ? { cls: cls(i), y: p.dev, text: `${kvModeName(s)}: ${fmtSigned(p.dev, 2)} %` } : null;
        })
        .filter(Boolean);
      return rows.length ? { x: best, head: fmtDate(dayToIso(best)), rows } : null;
    },
  });
  legend.innerHTML =
    series.map((s, i) => `<span class="item">${legendSwatch({ line: true, cls: cls(i) })}<span>${esc(`${kvModeName(s)} — ${s.pts.at(-1).label}`)}</span></span>`).join('') +
    `<span class="item">${legendSwatch({ cls: 't1', hollow: true })}<span>${esc(L('полый значок — проверка выхода', 'hollow marker: output check'))}</span></span>` +
    `<span class="item">${legendSwatch({ line: true, dashed: true, cls: 'aux' })}<span>${esc(L('допуск', 'tolerance'))}</span></span>`;
}

/** Контрольная карта режима и общая часть режимов (core/kv-spc.js): { charts, common }. */
function renderKvControl(j) {
  const m = machineOf(j, machineId);
  const charts = kvModeCharts(j, m);
  kvSpcSel = renderKvSpc(charts, kvSpcSel);
  const common = renderKvCommon(j, m, charts);
  return { charts, common };
}

/** Сводная по датам: мощность дозы «режим × аппликатор», колонки — даты (калибровки или все записи). */
function renderKvSummary(j) {
  const m = machineOf(j, machineId);
  const t = kvDoseByDate(j, m, { checks: kvChecks });
  $('#hs_kv_checks').checked = kvChecks;
  $('#hs-kv-copy').disabled = !t.rows.length;
  if (!t.rows.length) {
    $('#hs-kv-sum').innerHTML = `<p class="sub-hint">${esc(kvChecks || !kvRecordsOf(j, machineId).length ? L('Записей этого аппарата нет.', 'No records for this unit.') : L('Калибровок этого аппарата в журнале нет: отметьте «С проверками выхода», чтобы увидеть проверки.', 'No calibrations of this unit in the journal: tick “Include output checks” to see the checks.'))}</p>`;
    return;
  }
  const kinds = (c) => [...c.kinds].map(kindShort).join(', ');
  const head = `<tr><th>${esc(L('Режим', 'Mode'))}</th><th>${esc(L('Аппликатор', 'Applicator'))}</th><th class="v">${esc(L('РИП, см', 'SSD, cm'))}</th>${t.cols.map((c) => `<th class="v">${esc(fmtDate(c.date))}${kvChecks ? `<br><small>${esc(kinds(c))}</small>` : ''}</th>`).join('')}</tr>`;
  const groups = new Map();
  for (const r of t.rows) groups.set(r.modeId, [...(groups.get(r.modeId) ?? []), r]);
  const body = [...groups.values()]
    .map((rs) =>
      rs
        .map((r, k) => {
          const std = Object.values(r.cells).some((c) => c.std);
          const cells = t.cols
            .map((c) => {
              const x = r.cells[c.date];
              if (!x || !Number.isFinite(x.D)) return '<td class="v">—</td>';
              const dev = Number.isFinite(x.dev) ? `<br><small class="${x.verdict === 'over' ? 'st-out' : ''}">${esc(`${fmtSigned(x.dev, 2)} %`)}</small>` : '';
              return `<td class="v${x.kind === 'check' ? ' kv-sum-check' : ''}">${fmt(x.D, 4)}${dev}</td>`;
            })
            .join('');
          return `<tr${k === 0 ? ' class="grp"' : ''}>${k === 0 ? `<td class="mode" rowspan="${rs.length}">${esc(kvModeName(r))}<br><small>${esc(`${r.unit}, ${r.where === 'surface' ? L('на поверхности', 'at the surface') : L('на 2 г/см²', 'at 2 g/cm²')}`)}</small></td>` : ''}<td>${esc(r.label)}${std ? ` <span class="kv-std">${esc(L('ст.', 'ref.'))}</span>` : ''}</td><td class="v">${esc(r.ssd || '—')}</td>${cells}</tr>`;
        })
        .join(''),
    )
    .join('');
  $('#hs-kv-sum').innerHTML = `<table class="factors kv-sum-dates"><thead>${head}</thead><tbody>${body}</tbody></table>${kvChecks ? `<p class="sub-hint">${esc(L('Проверки выхода — курсивом.', 'Output checks are in italics.'))}</p>` : ''}`;
}

/** Значение со своим источником мелким шрифтом: «из калибровки 15.09.2026», «из другого режима». */
const withSrc = (txt, o) => {
  const s = o ? kvSrcText(o.src, o.date) : '';
  return `${txt}${s ? `<br><small>${esc(s)}</small>` : ''}`;
};

/** Режим по датам: СПО, τ, k_pol, k_s, сертификат, линейность и воспроизводимость режима в каждой записи. */
function renderKvModeTable(j) {
  const m = machineOf(j, machineId);
  const modes = kvTrendModes(j, m);
  if (!modes.some((x) => x.modeId === kvModeSel)) kvModeSel = modes[0]?.modeId ?? '';
  $('#hs_kv_mode').innerHTML = modes.map((x) => `<option value="${esc(x.modeId)}"${x.modeId === kvModeSel ? ' selected' : ''}>${esc(kvModeName(x))}</option>`).join('');
  $('#hs_kv_mode').disabled = !modes.length;
  const rows = kvModeHistory(j, m, kvModeSel).slice().reverse();
  if (!rows.length) {
    $('#hs-kv-mode').innerHTML = `<p class="sub-hint">${esc(L('Записей этого аппарата нет.', 'No records for this unit.'))}</p>`;
    return;
  }
  const mat = rows.find((r) => r.hvl)?.hvl.mat ?? 'Cu';
  const unitOf = (u) => (KV_SET_UNITS[u] ? L(KV_SET_UNITS[u].label, KV_SET_UNITS[u].labelEn) : u);
  // камера одна во всех записях режима — над таблицей, а не колонкой
  const chs = [...new Set(rows.map((r) => r.chamber))];
  const oneCh = chs.length === 1;
  const tr = rows.map((r) => {
    // с неопределённостью — оба с одним числом знаков (3, у U < 0,001 мм — 4)
    const hd = Number.isFinite(r.hvl?.U) ? (r.hvl.U < 0.001 ? 4 : 3) : r.hvl?.used < 1 ? 3 : 2;
    const hvlTxt = r.hvl ? `${fmt(r.hvl.used, hd)}${Number.isFinite(r.hvl.U) ? ` ± ${fmt(r.hvl.U, hd)}` : ''}` : '';
    const hvl = !r.hvl ? '—' : r.hvl.source === 'table' ? `${hvlTxt}<br><small>${esc(L('из таблицы режимов', 'from the modes table'))}</small>` : withSrc(hvlTxt, r.hvl.source === 'journal' ? { src: 'journal', date: r.hvl.date } : null);
    const tau = r.tau ? withSrc(Number.isFinite(r.tau.s) ? `${fmtSigned(r.tau.s, 2)} ${esc(L('с', 's'))}` : `${fmtSigned(r.tau.v, 3)} ${esc(unitOf(r.tau.unit))}`, r.tau) : '—';
    const k = (o) => (o ? withSrc(fmt(o.v, 4), o) : '—');
    const cert = r.cert ? (Number.isFinite(r.cert.kQ) ? fmt(r.cert.kQ, 4) : `${fmt(r.cert.value, 6)}<br><small>N</small>`) : '—';
    const ln = r.ln ? `${fmt(r.ln.dMax * 100, 2)} %${Number.isFinite(r.ln.clMax) ? `<br><small>CL ${fmt(r.ln.clMax, 4)}</small>` : ''}` : '—';
    const rp = r.rp ? `${fmt(r.rp.R * 100, 2)} %` : '—';
    return `<tr><td>${esc(fmtDate(r.date))}</td><td>${esc(kindShort(r.kind))}</td><td class="v">${hvl}</td><td class="v">${tau}</td><td class="v">${k(r.kpol)}</td><td class="v">${k(r.ks)}</td><td class="v">${cert}</td><td class="v${r.ln && (r.ln.dOver || r.ln.clOver) ? ' st-out' : ''}">${ln}</td><td class="v${r.rp?.over ? ' st-out' : ''}">${rp}</td>${oneCh ? '' : `<td class="kv-ch">${esc(r.chamber || '—')}</td>`}</tr>`;
  });
  $('#hs-kv-mode').innerHTML = `${oneCh ? `<p class="sub-hint kv-mode-ch">${esc(L(`Камера: ${chs[0] || '—'}`, `Chamber: ${chs[0] || '—'}`))}</p>` : ''}<table class="factors"><thead><tr><th>${esc(L('Дата', 'Date'))}</th><th>${esc(L('Вид', 'Kind'))}</th><th class="v">${esc(L(`СПО, мм ${mat}`, `HVL, mm ${mat}`))}</th><th class="v">τ</th><th class="v">k<sub>pol</sub></th><th class="v">k<sub>s</sub></th><th class="v">${esc(L('k_Q (сертификат)', 'k_Q (certificate)')).replace('k_Q', 'k<sub>Q</sub>')}</th><th class="v">${esc(L('Линейность', 'Linearity'))}</th><th class="v">${esc(L('Воспроизв., R', 'Reprod., R'))}</th>${oneCh ? '' : `<th>${esc(L('Камера', 'Chamber'))}</th>`}</tr></thead><tbody>${tr.join('')}</tbody></table>
    <p class="sub-hint">${esc(L('СПО — в расчёте (± U при k = 2, если измерен в этой записи); τ — в секундах при задании по времени; линейность — наибольшее отклонение от пропорциональности и CL; воспроизводимость — R = |1 − K_min/K_max|. Новые записи сверху.', 'HVL: as used (± U at k = 2 if measured in this record); τ in seconds for a time setting; linearity: the largest deviation from proportionality and CL; reproducibility: R = |1 − K_min/K_max|. Newest records first.'))}</p>`;
}

/** Разделы страницы: у рентгенотерапевтического аппарата — разделы kV (выход, сводная, режим по датам, записи), у остальных — тренды пучков. */
function showSections(kv) {
  for (const s of document.querySelectorAll('#hs-sheet section.hs-kv')) s.hidden = !kv;
  $('#hs-kind-field').hidden = kv || $('#hs-kind-field').hidden;
  for (const s of document.querySelectorAll('#hs-sheet section.hs-beam')) {
    if (kv) s.hidden = true;
    // разделы проверок второй камерой и в пластинах показывают их отрисовщики
    else if (!s.matches('#hs-check-sec, #hs-plates-sec')) s.hidden = false;
  }
}

// ------------------------------------------------------------ протокол записи
let reportId = '';
function showReport(id) {
  reportId = id;
  renderReport();
  $('#hs-report')?.scrollIntoView({ block: 'start' });
}
function renderReport() {
  const box = $('#hs-report');
  if (!box) return;
  const j = getJournal();
  const s = j.sessions.find((x) => x.id === reportId);
  const kv = s ? null : (j.kvRecords ?? []).find((x) => x.id === reportId && x.file);
  if (kv) {
    // протокол измерений записи kV — как на листе «Сводка и протокол», по вкладке из записи
    const visit = normalizeKvVisit(kv.file);
    box.hidden = false;
    box.innerHTML = `<header><h2>${esc(L(`Протокол измерений: ${kvTitle(j, kv)}`, `Measurement report: ${kvTitle(j, kv)}`))}</h2></header>
      ${kv.summary?.replaced?.length ? `<p class="sub-hint no-print">${esc(L(`В протоколе — вся вкладка этой записи; ${kv.summary.replaced.length > 1 ? 'режимы' : 'режим'} ${kv.summary.replaced.map((x) => x.m + 1).join(', ')} позже в тот же день ${kv.summary.replaced.length > 1 ? 'записаны' : 'записан'} заново (см. другую запись).`, `The report shows the whole tab of this record; ${kv.summary.replaced.length > 1 ? 'modes' : 'mode'} ${kv.summary.replaced.map((x) => x.m + 1).join(', ')} ${kv.summary.replaced.length > 1 ? 'were' : 'was'} recorded again later the same day (see the other record).`))}</p>` : ''}
      <div class="kv-prot">${kvProtocolHtml(visit, computeKvVisit(visit, kv.file.journal ?? kvJournalInputs(j, visit)))}</div>
      <div class="actions no-print"><button type="button" data-rep="pdf">${esc(L('Сохранить в PDF', 'Save as PDF'))}</button><button type="button" data-rep="close">${esc(L('Закрыть', 'Close'))}</button></div>`;
    return;
  }
  if (!s) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  const m = machineOf(j, s.machineId);
  box.hidden = false;
  box.innerHTML = `<header><h2>${esc(L(`Протокол: ${m?.name || '—'}, ${fmtDate(s.date)}`, `Report: ${m?.name || '—'}, ${fmtDate(s.date)}`))}</h2></header>
    <pre class="jreport">${esc(sessionReportText(j, s))}</pre>
    <div class="actions no-print"><button type="button" data-rep="copy">${esc(L('Копировать протокол', 'Copy the report'))}</button><button type="button" data-rep="pdf">${esc(L('Сохранить в PDF', 'Save as PDF'))}</button><button type="button" data-rep="close">${esc(L('Закрыть', 'Close'))}</button></div>`;
}

function renderReadout(j, series) {
  const m = machineOf(j, machineId);
  const sessions = j.sessions.filter((s) => s.machineId === machineId);
  const last = sessions.at(-1);
  const lastCal = sessions.filter((s) => s.mode === 'cal').at(-1);
  const outLast = last ? last.beams.filter((b) => b.summary?.status === 'out').length : 0;
  $('#hs-result').innerHTML = `<div class="dose-row"><div class="proto"><span>${esc(m?.name || '—')}</span>${last ? (outLast ? `<span class="chip warn">${esc(L(`вне допуска: ${outLast}`, `out of tolerance: ${outLast}`))}</span>` : `<span class="chip good">${esc(L('последняя запись в допуске', 'last record within tolerance'))}</span>`) : ''}</div>
    <div class="dose-big">${sessions.length}<small>${esc(countWord(sessions.length, [L('запись', 'record'), L('записи', 'records'), L('записей', 'records')], ['record', 'records']))}</small></div>
    <div class="secondary">${esc(L(`последний: ${last ? fmtDate(last.date) : '—'}; последняя калибровка: ${lastCal ? fmtDate(lastCal.date) : '—'}`, `last: ${last ? fmtDate(last.date) : '—'}; last calibration: ${lastCal ? fmtDate(lastCal.date) : '—'}`))}</div></div>`;
  const msgs = equipmentDue(j, today()).map((d) => `<li class="${d.status === 'overdue' ? 'warn' : 'info'}"><span class="lvl">${esc(d.status === 'overdue' ? L('Срок калибровки прошёл', 'Calibration overdue') : L('Срок калибровки подходит', 'Calibration due soon'))}</span><span>${esc(`${d.text}: ${fmtDate(d.dueDate)}`)}</span></li>`);
  const noDue = equipmentNoDue(j);
  if (noDue.length) msgs.push(`<li class="info"><span class="lvl">${esc(L('Срок калибровки не задан', 'No calibration due date'))}</span><span>${esc(L(`${noDue.map((x) => x.text || (x.kind === 'chamber' ? 'камера' : 'электрометр')).join('; ')}: укажите «Действует до» в «Оборудовании», иначе напоминания о сроке калибровки не будет.`, `${noDue.map((x) => x.text || x.kind).join('; ')}: enter "Valid until" in Equipment, otherwise there will be no calibration due reminder.`))}</span></li>`);
  for (const x of [...spcMessages(j, machineId, series.map((s) => s.beam), commonRes), ...checkSignalMessages(j, machineId)]) msgs.push(`<li class="${x.level}"><span class="lvl">${esc(x.head)}</span><span>${esc(x.text)}</span></li>`);
  if (lastCal && dayNumber(today()) - dayNumber(lastCal.date) > 365) msgs.push(`<li class="info"><span class="lvl">${esc(L('Калибровка', 'Calibration'))}</span><span>${esc(L(`Последняя калибровка аппарата — больше года назад (${fmtDate(lastCal.date)}).`, `The machine's last calibration was more than a year ago (${fmtDate(lastCal.date)}).`))}</span></li>`);
  $('#hs-messages').innerHTML = msgs.join('') || `<li class="info"><span class="lvl">${esc(L('Всё в порядке', 'All clear'))}</span><span>${esc(L('Ни один срок калибровки камер и электрометров не истёк и не истекает в ближайшие 30 дней.', 'No chamber or electrometer calibration has expired or expires within the next 30 days.'))}</span></li>`;
  $('#hs-mobile-value').textContent = `${m?.name || '—'}: ${sessions.length}`;
}

/** Контрольная карта выбранного пучка и общая часть записей (пучки показанного вида). */
function renderControl(j, series) {
  const beams = series.map((s) => s.beam);
  spcBeamId = renderSpc(j, machineId, beams, spcBeamId, { cobalt: kindFilter === 'cobalt' });
  commonRes = renderCommon(j, machineId, beams);
  checkRes = renderChecks(j, machineId, checkKey);
  if (checkRes) checkKey = checkRes.pair.key;
}

function render() {
  const j = getJournal();
  if (![...beamMachines(j), ...kvMachines(j)].some((m) => m.id === machineId)) machineId = beamMachines(j)[0]?.id ?? kvMachines(j)[0]?.id ?? '';
  $('#hs_machine').innerHTML = machineSelect(j);
  if (isKv(j)) {
    showSections(true);
    renderKvChart(j);
    const ctl = renderKvControl(j);
    renderKvSummary(j);
    renderKvModeTable(j);
    renderKvRecords(j);
    renderKvReadout(j, ctl);
    renderReport();
    notifyUpdate(ROOT());
    return;
  }
  showSections(false);
  const series = seriesOf(j);
  renderChart(series);
  renderControl(j, series);
  renderTables(j, series);
  renderPlates(j);
  renderReadout(j, series);
  renderReport();
  notifyUpdate(ROOT());
}

export function historyStatus(text) {
  setStatus(text);
}

export function initHistory() {
  setStatus = makeStatus($('#hs-status'));
  setupFilePanel($('#hs-file'), (t) => setStatus(t));
  render();
  $('#hs_beam').addEventListener('change', (e) => {
    spcBeamId = e.target.value;
    renderSpc(getJournal(), machineId, seriesOf(getJournal()).map((s) => s.beam), spcBeamId, { cobalt: kindFilter === 'cobalt' });
  });
  $('#hs_check').addEventListener('change', (e) => {
    checkKey = e.target.value;
    checkRes = renderChecks(getJournal(), machineId, checkKey);
  });
  $('#hs-check-unc').addEventListener('click', () => {
    if (!checkRes || !Number.isFinite(checkRes.cc.u)) return;
    bridge.toBudget(checkRes.cc.u, checkRes.note);
  });
  $('#hs-check-csv').addEventListener('click', () => {
    const j = getJournal();
    downloadText(checksCsv(j), csvFileName(j, new Date(), L('проверки_дозиметра', 'dosimeter_checks')), 'text/csv;charset=utf-8');
    setStatus(L('Проверки дозиметра выгружены в CSV.', 'The dosimeter checks have been exported to CSV.'));
  });
  $('#hs-csv').addEventListener('click', () => {
    const j = getJournal();
    if (!j.sessions.length) {
      setStatus(L('В журнале нет записей — выгружать нечего.', 'The journal has no records: nothing to export.'));
      return;
    }
    downloadText(journalCsv(j), csvFileName(j), 'text/csv;charset=utf-8');
    setStatus(L('Журнал выгружен в CSV: файл открывается в Excel двойным щелчком.', 'The journal has been exported to CSV: the file opens in Excel with a double click.'));
  });
  $('#hs_machine').addEventListener('change', (e) => {
    machineId = e.target.value;
    kindChosen = false;
    render();
  });
  for (const r of document.querySelectorAll('input[name="hs_kind"]')) {
    r.addEventListener('change', () => {
      kindFilter = ['electron', 'cobalt'].includes(r.value) ? r.value : 'photon';
      kindChosen = true;
      render();
    });
  }
  $('#hs-report').addEventListener('click', (e) => {
    const b = e.target.closest('[data-rep]');
    if (!b) return;
    const j = getJournal();
    const s = j.sessions.find((x) => x.id === reportId) ?? (j.kvRecords ?? []).find((x) => x.id === reportId);
    if (b.dataset.rep === 'close' || !s) {
      reportId = '';
      renderReport();
      return;
    }
    if (b.dataset.rep === 'copy') copyText(sessionReportText(j, s), L('Протокол скопирован.', 'The report has been copied.'), setStatus);
    else {
      // печатается только протокол (styles.css: body.print-hs-report)
      document.body.classList.add('print-hs-report');
      const off = () => {
        document.body.classList.remove('print-hs-report');
        window.removeEventListener('afterprint', off);
      };
      window.addEventListener('afterprint', off);
      printToPdf([L('Протокол', 'Report'), ...(s.file ? ['kV'] : []), machineOf(j, s.machineId)?.name, s.date].filter(Boolean).join('_'), setStatus);
    }
  });
  $('#hs-sessions').addEventListener('click', (e) => {
    // перенос записи на другую дату (moveSession): поле даты под кнопками записи
    const mv = e.target.closest('[data-move-session]');
    if (mv) {
      const form = $('#hs-sessions').querySelector(`[data-move-form="${CSS.escape(mv.dataset.moveSession)}"]`);
      if (form) {
        form.hidden = !form.hidden;
        if (!form.hidden) form.querySelector('[data-move-date]')?.focus();
      }
      return;
    }
    if (e.target.closest('[data-move-cancel]')) {
      const form = e.target.closest('[data-move-form]');
      if (form) form.hidden = true;
      return;
    }
    const ok = e.target.closest('[data-move-ok]');
    if (ok) {
      const form = ok.closest('[data-move-form]');
      const id = ok.dataset.moveOk;
      const was = getJournal().sessions.find((x) => x.id === id)?.date;
      const res = moveSession(getJournal(), id, form?.querySelector('[data-move-date]')?.value, { today: today() });
      if (res.error) {
        const err = form?.querySelector('.jmove-err');
        if (err) err.textContent = res.error;
        return;
      }
      updateJournal(() => res.journal, 'history');
      const more = res.updated ? L(` Проверок выхода, взявших k_pol и k_s из этой калибровки: ${res.updated} — они ссылаются на новую дату.`, ` Output checks that took k_pol and k_s from this calibration: ${res.updated}; they now refer to the new date.`) : '';
      setStatus(L(`Запись ${fmtDate(was)} перенесена на ${fmtDate(res.session.date)}.${more} Сохраните журнал в файл.`, `The record of ${fmtDate(was)} has been moved to ${fmtDate(res.session.date)}.${more} Save the journal to the file.`));
      return;
    }
    const r = e.target.closest('[data-spc-restart]');
    if (r) {
      const id = r.dataset.spcRestart;
      const on = !getJournal().sessions.find((x) => x.id === id)?.spcRestart;
      updateJournal((jj) => ({ ...jj, sessions: jj.sessions.map((x) => (x.id === id ? { ...x, spcRestart: on } : x)) }), 'history');
      setStatus(on ? L('С этой записи контрольная карта начинает новый отсчёт.', 'The control chart starts a new count from this record.') : L('Отметка нового отсчёта снята.', 'The new count mark has been removed.'));
      return;
    }
    const ob = e.target.closest('[data-open-beam]');
    if (ob) {
      const [sid, bid] = ob.dataset.openBeam.split('|');
      const jj = getJournal();
      const s = jj.sessions.find((x) => x.id === sid);
      const b = s?.beams.find((x) => x.beamId === bid);
      if (!b?.form) return;
      const m = machineOf(jj, s.machineId);
      const name = m?.beams.find((x) => x.id === bid)?.name || '—';
      bridge.openInTab(beamKind(b), b.form, `${m?.name || '—'} — ${name}, ${fmtDate(s.date)}`);
      return;
    }
    const rb = e.target.closest('[data-report]');
    if (rb) showReport(rb.dataset.report);
  });
  // рентгенотерапевтический аппарат: сводная с проверками, её копия для Excel, режим таблицы, CSV записей
  $('#hs_kv_checks').addEventListener('change', (e) => {
    kvChecks = e.target.checked;
    renderKvSummary(getJournal());
  });
  $('#hs-kv-copy').addEventListener('click', () => {
    const j = getJournal();
    const m = machineOf(j, machineId);
    if (!m) return;
    copyText(kvDoseByDateTsv(kvDoseByDate(j, m, { checks: kvChecks })), L('Сводная скопирована: вставьте её в Excel.', 'The summary has been copied: paste it into Excel.'), setStatus);
  });
  $('#hs_kv_spc_mode').addEventListener('change', (e) => {
    kvSpcSel = e.target.value;
    renderKvSpc(kvModeCharts(getJournal(), machineOf(getJournal(), machineId)), kvSpcSel);
  });
  $('#hs_kv_mode').addEventListener('change', (e) => {
    kvModeSel = e.target.value;
    renderKvModeTable(getJournal());
  });
  $('#hs-kv-csv').addEventListener('click', () => {
    const j = getJournal();
    const m = machineOf(j, machineId);
    if (!m || !kvRecordsOf(j, machineId).length) {
      setStatus(L('Записей этого аппарата нет — выгружать нечего.', 'This unit has no records: nothing to export.'));
      return;
    }
    downloadText(kvRecordsCsv(j, m, kvChartSignals(j, m)), csvFileName(j, new Date(), `kV_${kvMachineText(m) || m.id}`.replace(/[^\p{L}\p{N}_.-]+/gu, '-')), 'text/csv;charset=utf-8');
    setStatus(L('Записи аппарата выгружены в CSV: по строке на аппликатор режима в записи; файл открывается в Excel двойным щелчком.', 'The records of the unit have been exported to CSV, one line per applicator of a mode in a record; the file opens in Excel with a double click.'));
  });
  $('#hs-kv-records').addEventListener('click', (e) => {
    const o = e.target.closest('[data-kv-open]');
    if (o) {
      const j = getJournal();
      const r = (j.kvRecords ?? []).find((x) => x.id === o.dataset.kvOpen);
      if (r?.file) {
        try {
          bridge.openKv(r.file, `${kvTitle(j, r)}, ${kvRecModeText(r.mode)}`);
        } catch (err) {
          setStatus(err.message);
        }
      }
      return;
    }
    const sp = e.target.closest('[data-kv-spc]');
    if (sp) {
      const id = sp.dataset.kvSpc;
      const on = !(getJournal().kvRecords ?? []).find((x) => x.id === id)?.spcRestart;
      updateJournal((jj) => ({ ...jj, kvRecords: (jj.kvRecords ?? []).map((x) => (x.id === id ? { ...x, spcRestart: on } : x)) }), 'history');
      setStatus(on ? L('С этой записи контрольные карты режимов начинают новый отсчёт.', 'The control charts of the modes start a new count from this record.') : L('Отметка нового отсчёта снята.', 'The new count mark has been removed.'));
      return;
    }
    const rb = e.target.closest('[data-report]');
    if (rb) showReport(rb.dataset.report);
  });
  onJournal(({ source }) => {
    if (source.endsWith(':input') && source !== 'equipment:input') return;
    render();
  });
  document.addEventListener('langchange', render);
  // график перестраивается по ширине
  let w = 0;
  new ResizeObserver(() => {
    const box = $('#hs-chart');
    if (!box || box.clientWidth === w || !box.clientWidth || isKv(getJournal())) return;
    w = box.clientWidth;
    const series = seriesOf(getJournal());
    renderChart(series);
    renderControl(getJournal(), series);
  }).observe($('#hs-chart'));
  let wk = 0;
  new ResizeObserver(() => {
    const box = $('#hs-kv-chart');
    if (!box || box.clientWidth === wk || !box.clientWidth || !isKv(getJournal())) return;
    wk = box.clientWidth;
    renderKvChart(getJournal());
    renderKvControl(getJournal());
  }).observe($('#hs-kv-chart'));
}
