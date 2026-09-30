// Модуль «⁶⁰Co»: связывает форму с расчётным ядром cobalt.js.
import { computeCobalt, CO_DEFAULTS, normalizeCobalt } from '../core/cobalt.js';
import { SAMPLE_COBALT } from '../core/sample-cobalt.js';
import { PRESSURE_UNITS, NDW_UNITS } from '../core/units.js';
import { makeCombo, renderCells, readCells, setupCells, renderStaff, readStaff, renderPairs, readPairs, setupPairs } from './widgets.js';
import {
  $, $$, fmt, fmtSigned, esc, today, makeStatus, copyText, downloadText,
  currentProtocol, renderOutputs, renderFlags, applyShowRules, armButton,
} from './common.js';

const DRAFT_KEY = 'reference-dosimetry.cobalt.v1';
const FILE_TAG = { app: 'reference-dosimetry', module: 'cobalt', version: 1 };
const SERIES_KEYS = ['co_M1', 'co_Mopp', 'co_M2'];
const PAIR_KEYS = ['co_tt', 'co_tm'];
const ROOT = () => document.getElementById('module-co60');
let setStatus = () => {};
export const cobaltStatus = (text) => setStatus(text);

const PROTO = {
  trs: { name: 'TRS-398 Rev.1' },
  tg51: { name: 'TG-51' },
};

// ------------------------------------------------------------ форма ↔ данные
const seriesBox = (key) => (key === 'co_timer' ? null : $(`#co-sheet .cells[data-series="${key}"]`));
const pairsBox = () => $('#co_timer');

function readForm() {
  const data = {};
  for (const key of Object.keys(CO_DEFAULTS)) {
    if (key === 'protocol') data.protocol = currentProtocol();
    else if (key === 'co_staff') data.co_staff = readStaff($('#co-staff-list'));
    else if (SERIES_KEYS.includes(key)) data[key] = readCells(seriesBox(key));
    else if (PAIR_KEYS.includes(key)) continue;
    else {
      const el = document.getElementById(key);
      if (!el) continue;
      data[key] = el.type === 'checkbox' ? el.checked : el.value;
    }
  }
  const { a, b } = readPairs(pairsBox());
  data.co_tt = a;
  data.co_tm = b;
  return data;
}

function writeForm(values) {
  const data = normalizeCobalt(values);
  for (const [key, value] of Object.entries(data)) {
    if (key === 'protocol' || PAIR_KEYS.includes(key)) continue;
    if (key === 'co_staff') renderStaff($('#co-staff-list'), value, update);
    else if (SERIES_KEYS.includes(key)) renderCells(seriesBox(key), value);
    else {
      const el = document.getElementById(key);
      if (!el) continue;
      if (el.type === 'checkbox') el.checked = !!value;
      else el.value = value ?? '';
    }
  }
  renderPairs(pairsBox(), data.co_tt, data.co_tm);
}

// ------------------------------------------------------------ видимость и подписи
const zText = (z) => (Number.isFinite(z) ? fmt(z, z % 1 ? 1 : 0) : '—');

function applyVisibility(data, result) {
  applyShowRules(ROOT(), data, data.protocol);
  const sad = data.co_geometry === 'SAD';
  const z = zText(result.inputs.zref);
  const unit = result.inputs.unitLabel;
  $('#co-lbl-distance').textContent = sad ? 'РИК, см' : 'РИП, см';
  $('#co-refpoint').textContent =
    data.co_ch_type === 'pp'
      ? 'Опорная точка — внутренняя поверхность входного окна, в центре окна (TRS-398, табл. 12).'
      : 'Опорная точка — на оси камеры в центре объёма полости (TRS-398, табл. 12).';
  $('#co-lbl-pdd').textContent = `PDD(${z}), %`;
  $('#co-lbl-tmr').textContent = `TMR(${z})`;
  $('#co-lbl-tau').textContent = `τ, ${unit}`;
  $('#co-lbl-tt').textContent = `Заданное время, ${unit}`;
  $('#co-dd-hint').textContent = sad
    ? `Установка по РИК: мощность дозы переносится на z_max через TMR(${z}) из данных ввода в эксплуатацию (TRS-398, разд. 5.4.3).`
    : `D(z_max) = D(${z} см) / PDD(${z}) · 100. Для ⁶⁰Co z_max ≈ 0,5 см. PDD — клиническая, для того же РИП и поля 10 × 10 см (TRS-398, разд. 5.4.3).`;
  const d = result.depth;
  $('#co-decay-note').textContent = Number.isFinite(d.decay)
    ? `распад за ${fmt(d.days, 0)} сут: × ${fmt(d.decay, 4)}`
    : Number.isFinite(d.refRate)
      ? 'без поправки на распад'
      : '';
}

// ------------------------------------------------------------ вывод
function doseRow(key, x, result) {
  const depthOn = result.depth.on && Number.isFinite(x.rateMax);
  const main = depthOn ? x.rateMax : x.rate;
  const mainGy = depthOn ? x.rateMaxGy : x.rateGy;
  const z = zText(result.inputs.zref);
  const where = depthOn ? 'на z<sub>max</sub>' : `на ${z} г/см²`;
  let chip = '';
  if (depthOn && Number.isFinite(x.deviation) && !x.blocked) {
    const cls = Math.abs(x.deviation) <= 1 ? 'good' : Math.abs(x.deviation) > 2 ? 'bad' : '';
    chip = `<span class="chip ${cls}" title="Отклонение от ожидаемой мощности дозы">${fmtSigned(x.deviation, 2)} %</span>`;
  }
  const i = result.inputs;
  const secondary = [
    `${fmt(mainGy, 4)} Гр/мин ${where}`,
    `D<sub>w</sub>(${z} г/см²) = ${fmt(x.D, 4)} Гр за ${fmt(i.tSet, i.tSet % 1 ? 2 : 0)} ${i.unitLabel} (t + τ = ${fmt(i.tEff, 3)})`,
    depthOn ? `${fmt(x.rate, 2)} сГр/мин на ${z} г/см²` : null,
  ].filter(Boolean).join('<br>');
  return `<div class="dose-row ${x.blocked ? 'blocked' : ''}">
    <div class="proto"><span>${PROTO[key].name}</span>${chip}</div>
    <div class="dose-big">${x.blocked || !Number.isFinite(main) ? '—' : fmt(main, 2)}<small>сГр/мин ${where}</small></div>
    <div class="secondary">${x.blocked ? 'Исправьте ошибки из списка замечаний' : secondary}</div>
  </div>`;
}

function renderReadout(result, data) {
  const keys = data.protocol === 'both' ? ['trs', 'tg51'] : [data.protocol];
  const pick = (k) => (k === 'trs' ? result.trs : result.tg51);
  $('#co-dose-rows').innerHTML = keys.map((k) => doseRow(k, pick(k), result)).join('');

  const delta = $('#co-delta');
  if (result.comparison) {
    delta.hidden = false;
    delta.innerHTML = `TG-51 относительно TRS-398: <b>${fmtSigned(result.comparison.dRel, 2)} %</b>`;
  } else delta.hidden = true;

  const first = keys.map((k) => ({ k, x: pick(k) })).find((o) => !o.x.blocked && o.x.ok);
  const mv = $('#co-mobile-value');
  if (first) {
    const val = result.depth.on && Number.isFinite(first.x.rateMax) ? first.x.rateMax : first.x.rate;
    mv.innerHTML = `${first.k === 'trs' ? 'TRS' : 'TG-51'}: <b>${fmt(val, 2)}</b> сГр/мин${Number.isFinite(first.x.deviation) ? ` (${fmtSigned(first.x.deviation, 2)} %)` : ''}`;
  } else {
    const n = result.messages.filter((m) => m.level === 'error').length;
    mv.textContent = n ? `Ошибок: ${n}` : '—';
  }

  const lvlName = { error: 'Ошибка', warn: 'Внимание', info: 'Справка' };
  const scopeName = { common: '', depth: 'Пересчёт на z_max · ', trs: 'TRS-398 · ', tg51: 'TG-51 · ' };
  const list = result.messages.filter((m) => m.scope === 'common' || m.scope === 'depth' || keys.includes(m.scope));
  $('#co-messages').innerHTML = list.length
    ? list.map((m) => `<li class="${m.level}"><span class="lvl">${scopeName[m.scope]}${lvlName[m.level]}</span><span>${esc(m.text)}</span>${m.ref ? `<span class="ref">${esc(m.ref)}</span>` : ''}</li>`).join('')
    : '<li class="info"><span class="lvl">Всё в порядке</span><span>Замечаний к введённым данным нет.</span></li>';

  const t = result.trs;
  const g = result.tg51;
  const showT = keys.includes('trs');
  const showG = keys.includes('tg51');
  const i = result.inputs;
  const z = zText(i.zref);
  const rows = [
    ['Температура и давление', ['k<sub>TP</sub>', t.kTP, 4], ['P<sub>TP</sub>', g.PTP, 4]],
    ['Электрометр', ['k<sub>elec</sub>', t.kelec, 4], ['P<sub>elec</sub>', g.Pelec, 4]],
    ['Полярность', ['k<sub>pol</sub>', t.kpol, 4], ['P<sub>pol</sub>', g.Ppol, 4]],
    ['Рекомбинация', ['k<sub>s</sub>', t.ks, 4], ['P<sub>ion</sub>', g.Pion, 4]],
    ['Утечка', ['k<sub>leak</sub>', t.kleak, 4], ['P<sub>leak</sub>', g.Pleak, 4]],
    ['Исправленное показание, нКл', ['M', t.M, 4], ['M', g.M, 4]],
    ['N<sub>D,w</sub>, Гр/нКл', ['', i.ndw, 5], ['', i.ndw, 5]],
    ['Поправка на качество', ['k<sub>Q</sub>', t.enabled ? 1 : NaN, 3], ['k<sub>Q</sub>', g.enabled ? 1 : NaN, 3]],
    [`D<sub>w</sub>(${z}) за облучение, Гр`, ['', t.D, 4, true], ['', g.D, 4, true]],
    [`t + τ, ${i.unitLabel}`, ['', i.tEff, 4], ['', i.tEff, 4]],
    [`На ${z} г/см², сГр/мин`, ['', t.rate, 2, true], ['', g.rate, 2, true], 'total'],
    [`На ${z} г/см², Гр/мин`, ['', t.rateGy, 4, true], ['', g.rateGy, 4, true]],
  ];
  if (result.depth.on) {
    rows.push([result.depth.label || 'PDD/TMR', ['', result.depth.factor, 4], ['', result.depth.factor, 4]]);
    rows.push(['На z<sub>max</sub>, сГр/мин', ['', t.rateMax, 2, true], ['', g.rateMax, 2, true], 'total']);
    rows.push(['На z<sub>max</sub>, Гр/мин', ['', t.rateMaxGy, 4, true], ['', g.rateMaxGy, 4, true]]);
  }
  const cell = ([sym, v, d, dose], blocked) => `<td class="v">${sym ? `<i>${sym}</i> ` : ''}${dose && blocked ? '—' : fmt(v, d)}</td>`;
  $('#co-factors').innerHTML =
    `<thead><tr><th>Величина</th>${showT ? '<th>TRS-398</th>' : ''}${showG ? '<th>TG-51</th>' : ''}</tr></thead><tbody>` +
    rows.map((r) => `<tr class="${r[3] || ''}"><td>${r[0]}</td>${showT ? cell(r[1], t.blocked) : ''}${showG ? cell(r[2], g.blocked) : ''}</tr>`).join('') +
    '</tbody>';
}

// ------------------------------------------------------------ протокол текстом
function reportText(data, r) {
  const L = [];
  const line = (k, v) => L.push(`${k}: ${v}`);
  const cells = (a) => (Array.isArray(a) ? a.filter((x) => String(x).trim() !== '').join('; ') : a);
  const i = r.inputs;
  const z = zText(i.zref);
  L.push('ПРОТОКОЛ РЕФЕРЕНСНОЙ ДОЗИМЕТРИИ — ⁶⁰Co');
  line('Протокол', data.protocol === 'both' ? 'TRS-398 Rev.1 и TG-51' : PROTO[data.protocol].name);
  line('Учреждение', data.co_institution || '—');
  line('Аппарат', data.co_machine || '—');
  line('Дата', data.co_date || '—');
  line('Измерения выполнили', data.co_staff.filter((s) => s.trim()).join(', ') || '—');
  line('Геометрия', `${data.co_geometry === 'SAD' ? 'РИК' : 'РИП'} = ${data.co_distance} см, поле 10×10 см ${data.co_geometry === 'SAD' ? 'в плоскости камеры' : 'на поверхности воды'}, z_ref = ${z} г/см²`);
  L.push('');
  line('Камера', `${data.co_ch_model || '—'} (${data.co_ch_type === 'pp' ? 'плоскопараллельная' : 'цилиндрическая'}), № ${data.co_ch_serial || '—'}`);
  line('N_D,w', `${data.co_ndw} ${NDW_UNITS[data.co_ndw_unit]?.label ?? ''} (= ${fmt(i.ndw, 6)} Гр/нКл); T0 = ${data.co_T0} °C, P0 = ${data.co_P0} кПа`);
  line('Электрометр', `${data.co_el_model || '—'}, № ${data.co_el_serial || '—'}, k_elec = ${data.co_kelec}`);
  line('Условия', `T = ${data.co_env_T} °C, P = ${data.co_env_P} ${PRESSURE_UNITS[data.co_env_P_unit]?.label ?? ''}`);
  const tm = r.timer;
  const timerTxt =
    data.co_timer_mode === 'measured'
      ? `по ${tm.n ?? '—'} облучениям: ${data.co_tt
          .map((t, k) => [t, data.co_tm[k]])
          .filter(([a, b]) => String(a ?? '').trim() && String(b ?? '').trim())
          .map(([a, b]) => `${a} ${i.unitLabel} → ${b} нКл`)
          .join('; ')}`
      : data.co_timer_mode === 'manual'
        ? 'введено'
        : 'не учитывалась';
  line('Время облучения', `t = ${data.co_time} ${i.unitLabel}; τ = ${fmt(tm.tau, 4)} ${i.unitLabel} (${timerTxt}); t + τ = ${fmt(i.tEff, 4)} ${i.unitLabel}`);
  line('Напряжения', `V1 = ${data.co_V1} В, V2 = ${data.co_V2} В, обычная полярность ${data.co_polarity}`);
  line('M(V1, обычная), нКл', `${cells(data.co_M1)} → среднее ${fmt(Math.abs(i.M1.mean), 4)}`);
  line('M(V1, обратная), нКл', `${cells(data.co_Mopp)} → среднее ${fmt(Math.abs(i.Mopp.mean), 4)}`);
  line('M(V2), нКл', `${cells(data.co_M2)} → среднее ${fmt(Math.abs(i.M2.mean), 4)}`);
  L.push('');
  const blocks = data.protocol === 'both' ? ['trs', 'tg51'] : [data.protocol];
  for (const k of blocks) {
    const x = k === 'trs' ? r.trs : r.tg51;
    L.push(`— ${PROTO[k].name} —`);
    if (k === 'trs') L.push(`k_TP = ${fmt(x.kTP)}; k_elec = ${fmt(x.kelec)}; k_pol = ${fmt(x.kpol)}; k_s = ${fmt(x.ks)} (${x.ksEquation || '—'}); k_leak = ${fmt(x.kleak)}; k_Q = 1`);
    else L.push(`P_TP = ${fmt(x.PTP)}; P_elec = ${fmt(x.Pelec)}; P_pol = ${fmt(x.Ppol)}; P_ion = ${fmt(x.Pion)} (ур. 11); P_leak = ${fmt(x.Pleak)}; k_Q = 1,000`);
    if (x.blocked) {
      L.push('РЕЗУЛЬТАТ НЕ ВЫЧИСЛЕН: есть ошибки ввода (см. замечания).');
    } else {
      L.push(`M = ${fmt(x.M)} нКл; D_w(${z}) = ${fmt(x.D)} Гр за облучение; ${fmt(x.rate, 2)} сГр/мин = ${fmt(x.rateGy, 4)} Гр/мин на z_ref`);
      if (r.depth.on && r.depth.ok && Number.isFinite(x.rateMax)) {
        let s = `z_max = ${data.co_zmax} см; ${r.depth.label} = ${fmt(r.depth.factor)}; на z_max ${fmt(x.rateMax, 2)} сГр/мин = ${fmt(x.rateMaxGy, 4)} Гр/мин`;
        if (Number.isFinite(x.deviation)) {
          const dec = Number.isFinite(r.depth.decay) ? ` (${data.co_ref_rate} сГр/мин на ${data.co_ref_date}, распад × ${fmt(r.depth.decay, 4)})` : '';
          s += `; ожидалось ${fmt(r.depth.expected, 2)} сГр/мин${dec}, отклонение ${fmtSigned(x.deviation, 2)} %`;
        }
        L.push(s);
      } else if (r.depth.on) {
        L.push('Пересчёт на z_max не выполнен: исправьте данные раздела 6.');
      }
    }
    L.push('');
  }
  if (r.comparison) L.push(`TG-51 относительно TRS-398: ${fmtSigned(r.comparison.dRel, 2)} %`, '');
  const msgs = r.messages.filter((m) => m.level !== 'info');
  if (msgs.length) {
    L.push('Замечания:');
    msgs.forEach((m) => L.push(`- ${m.text}${m.ref ? ` [${m.ref}]` : ''}`));
    L.push('');
  }
  if (data.co_notes) L.push(`Примечания: ${data.co_notes}`);
  return L.join('\n');
}

// ------------------------------------------------------------ сохранение
function saveDraft(data) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(data));
  } catch {
    /* хранилище недоступно */
  }
}
function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Загрузка данных из файла или буфера обмена. Бросает ошибку, если файл не от этого модуля. */
export function importCobalt(obj) {
  if (!obj || obj.app !== FILE_TAG.app || typeof obj.form !== 'object') throw new Error('Это не файл калькулятора референсной дозиметрии.');
  if (obj.module !== FILE_TAG.module) throw new Error('Это файл другого раздела: откройте его на вкладке «МВ фотоны».');
  writeForm(obj.form);
  update();
}

// ------------------------------------------------------------ цикл
let current = { data: null, result: null };
function update() {
  const data = readForm();
  const result = computeCobalt(data);
  current = { data: result.form, result };
  applyVisibility(result.form, result);
  renderOutputs(ROOT(), result);
  renderFlags(ROOT(), result.flags, seriesBox);
  renderReadout(result, result.form);
  $('#co-demo-flag').hidden = !(data.co_institution === SAMPLE_COBALT.co_institution && data.co_machine === SAMPLE_COBALT.co_machine);
  saveDraft(result.form);
}

export function initCobalt() {
  setStatus = makeStatus($('#co-status'));
  $('#co_ndw_unit').innerHTML = Object.entries(NDW_UNITS).map(([k, u]) => `<option value="${k}">${u.label}</option>`).join('');
  $('#co_env_P_unit').innerHTML = Object.entries(PRESSURE_UNITS).map(([k, u]) => `<option value="${k}">${u.label}</option>`).join('');
  $$('#co-sheet .cells').forEach((box) => setupCells(box, update));
  setupPairs(pairsBox(), update);
  $$('#co-sheet > section .combo').forEach((c) => makeCombo(c));

  const draft = loadDraft();
  writeForm(draft ? draft : SAMPLE_COBALT);
  update();
  if (!draft) setStatus('Загружен демонстрационный пример. Нажмите «Очистить», чтобы ввести свои данные.');

  const sheet = $('#co-sheet');
  sheet.addEventListener('input', update);
  sheet.addEventListener('change', update);
  document.addEventListener('change', (e) => {
    if (e.target.name === 'protocol') update();
  });

  $('#co-btn-add-staff').addEventListener('click', () => {
    const cur = readStaff($('#co-staff-list'));
    cur.push('');
    renderStaff($('#co-staff-list'), cur, update);
    $$('#co-staff-list .staff-input').at(-1).focus();
    update();
  });
  for (const b of $$('[data-co-preset]')) {
    b.addEventListener('click', () => {
      const [t0, p0] = b.dataset.coPreset.split('|');
      $('#co_T0').value = t0;
      $('#co_P0').value = p0;
      update();
    });
  }
  for (const b of $$('[data-co-distance]')) {
    b.addEventListener('click', () => {
      $('#co_distance').value = b.dataset.coDistance;
      update();
    });
  }

  $('#co-btn-sample').addEventListener('click', () => {
    writeForm(SAMPLE_COBALT);
    update();
    setStatus('Загружен демонстрационный пример (вымышленные данные).');
  });
  armButton($('#co-btn-clear'), 'Очистить', 'Точно очистить?', () => {
    writeForm({ ...CO_DEFAULTS, co_date: today() });
    update();
    setStatus('Форма очищена.');
  });

  const payload = () => JSON.stringify({ ...FILE_TAG, savedAt: new Date().toISOString(), form: current.data }, null, 2);
  $('#co-btn-save').addEventListener('click', () => {
    const name = ['Co60', current.data.co_machine, current.data.co_date].filter(Boolean).join('_').replace(/[^\p{L}\p{N}_.-]+/gu, '-');
    downloadText(payload(), `dosimetry_${name}.json`);
    setStatus('Файл сохранён.');
  });
  $('#co-btn-load').addEventListener('click', () => $('#co-file-input').click());
  $('#co-file-input').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      importCobalt(JSON.parse(await file.text()));
      setStatus(`Открыт файл ${file.name}.`);
    } catch (err) {
      setStatus(err instanceof SyntaxError ? 'Файл повреждён: это не JSON.' : err.message);
    }
    e.target.value = '';
  });
  $('#co-btn-copy-json').addEventListener('click', () => copyText(payload(), 'Данные скопированы. Чтобы вставить их обратно, нажмите Ctrl+V на странице вне полей ввода.', setStatus));
  $('#co-btn-copy-report').addEventListener('click', () => copyText(reportText(current.data, current.result), 'Протокол скопирован в буфер обмена.', setStatus));
  $('#co-btn-print').addEventListener('click', () => window.print());
}
