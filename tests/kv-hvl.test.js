// Лист «СПО и k_Q» вкладки kV-рентген (0.43.0): СПО по D₀, D₁, D₂ и толщинам x₁, x₂ (интерполяция по ln), бюджет
// неопределённости с ковариацией общих пластин, U при k = 2, проверки; набор пластин; измеренный СПО — в расчёт режима
// (k_Q и всё, что зависит от СПО); запись в «Оборудование» измеренным с датой.
// Сверка: рабочая книга учреждения (лист «СПО» и «Толщины», 7 режимов, числа без названий) — СПО и U(k = 2) совпадают
// с её формулами до округления double.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeKvHvl, kvPlateSet, parseThickness, hvlRound, hvlText, hvlDecimals } from '../src/core/kv-hvl.js';
import { normalizeKvVisit, computeKvVisit, newKvMode } from '../src/core/kv-session.js';
import { kvMachineFromVisit, kvVisitFromMachine } from '../src/core/kv-journal.js';
import { normalizeJournal, JOURNAL_TAG } from '../src/core/journal.js';
import { normalizeKvMachine } from '../src/core/kv-machine.js';
import { SAMPLE_KV, SAMPLE_KV_MODE2 } from '../src/core/sample-kv.js';

// набор пластин рабочей книги: обозначение, материал, номинал, измерено, u(t), мм
const PLATES = [
  ['Al1', 'Al', 0.1, 0.1], ['Al2', 'Al', 0.1, 0.092], ['Al3', 'Al', 0.1, 0.092], ['Al4', 'Al', 0.1, 0.095], ['Al5', 'Al', 0.1, 0.092],
  ['Al6', 'Al', 0.5, 0.462], ['Al7', 'Al', 0.5, 0.466], ['Al8', 'Al', 0.5, 0.465], ['Al9', 'Al', 0.5, 0.47], ['Al10', 'Al', 0.5, 0.465],
  ['Al11', 'Al', 1, 0.957], ['Al12', 'Al', 1, 0.949],
  ['Cu1', 'Cu', 0.1, 0.104], ['Cu2', 'Cu', 0.1, 0.1], ['Cu3', 'Cu', 0.1, 0.102], ['Cu4', 'Cu', 0.1, 0.105], ['Cu5', 'Cu', 0.25, 0.257],
  ['Cu6', 'Cu', 0.5, 0.512], ['Cu7', 'Cu', 1, 1.004], ['Cu8', 'Cu', 1, 0.993], ['Cu9', 'Cu', 2, 2.043],
].map(([n, m, nom, t]) => [n, m, String(nom), String(t), m === 'Al' ? '0.002894' : '0.002902']);
const plateForm = (list = PLATES) => ({
  kv_pl_name: list.map((p) => p[0]), kv_pl_mat: list.map((p) => p[1]), kv_pl_nom: list.map((p) => p[2]), kv_pl_t: list.map((p) => p[3]), kv_pl_u: list.map((p) => p[4]),
});
// режимы: диапазон, D₀, D₁, D₂, x₁, x₂ и СПО, U из рабочей книги
const MODES = [
  ['low', [235.4, 235.2, 235.6], [125.2, 125.25, 125.15], [114.791, 114.65, 114.66], 'Al1+Al2+Al8+Al9', 'Al1+Al2+Al11', 1.1425157334623688, 0.009463990696909114],
  ['low', [225.2, 225, 225.4], [116.4, 116.3, 116.5], [111.42, 111.43, 111.35], 'Al2+Al4+Al12', 'Al2+Al3+Al4+Al6+Al10', 1.188917580570078, 0.011382063989628292],
  ['low', [327.4, 327.5, 327.299], [167.5, 167.45, 167.55], [161.5, 161.45, 161.51], 'Al1+Al2+Al3+Al8+Al10', 'Al1+Al2+Al3+Al8+Al9', 1.2171384574454611, 0.01232273381571252],
  ['medium', [126.4, 126.1, 126.7], [65.2, 65.25, 65.15], [45.2, 45.1, 45.2], 'Cu2', 'Cu3+Cu5', 0.12198089315452665, 0.005724495543906744],
  ['medium', [180, 179.9, 179.95], [93, 93.05, 92.95], [72.1, 72.1, 72.15], 'Cu3+Cu4', 'Cu4+Cu5', 0.2271541312022977, 0.0077394812640463025],
  ['medium', [216.9, 216.85, 216.95], [110.5, 110.45, 110.4], [102, 102.1, 102.11], 'Cu2+Cu3+Cu6', 'Cu1+Cu2+Cu5+Cu6', 0.7739827858656091, 0.009677390502577593],
  ['medium', [175.7, 175.8, 175.9], [90.2, 90.1, 90.15], [86.2, 86.05, 86.1], 'Cu7', 'Cu3+Cu4+Cu8', 1.1122305817638152, 0.007269993563156307],
];
const cells = (a) => a.map(String);
const form = ([range, D0, D1, D2, x1, x2], extra = {}) => ({
  ...plateForm(), kv_range: range, kv_hl_D0: cells(D0), kv_hl_D1: cells(D1), kv_hl_D2: cells(D2), kv_hl_Dc: [], kv_hl_x1: x1, kv_hl_x2: x2, kv_hl_apply: true, ...extra,
});
const has = (r, level, re) => r.messages.some((m) => m.level === level && re.test(m.text));

test('СПО и U (k = 2) — как в рабочей книге учреждения, 7 режимов', () => {
  for (const m of MODES) {
    const r = computeKvHvl(form(m));
    assert.ok(r.ok, m[4]);
    assert.ok(Math.abs(r.hvl - m[6]) < 1e-12, `${m[4]}: ${r.hvl} vs ${m[6]}`);
    assert.ok(Math.abs(r.U - m[7]) < 1e-12, `${m[4]}: U ${r.U} vs ${m[7]}`);
    assert.equal(r.k, 2);
  }
  // ковариация — сумма u²(t) общих пластин: Al1 и Al2; у Cu7 и Cu3+Cu4+Cu8 общих нет
  assert.ok(Math.abs(computeKvHvl(form(MODES[0])).cov - 2 * 0.002894 ** 2) < 1e-15);
  assert.equal(computeKvHvl(form(MODES[6])).cov, 0);
  // СПО в расчёт — округлённый до трёх знаков
  assert.equal(computeKvHvl(form(MODES[0])).used, 1.143);
  assert.equal(computeKvHvl(form(MODES[3])).used, 0.122);
});

test('проверки рабочей книги: удаление от D̄₀/2 по допуску учреждения, правдоподобие ослабления', () => {
  // 120 кВ: D̄₂ на 28,5 % ниже D̄₀/2 — при допуске 20 % предупреждение, без допуска — нет
  assert.ok(has(computeKvHvl(form(MODES[3], { kv_hl_band_tol: '20' })), 'warn', /D̄₂ отличается от D̄₀\/2 на −28,5 % — больше 20 %/));
  assert.ok(!computeKvHvl(form(MODES[3])).messages.some((m) => m.level === 'warn'));
  // 50 и 100 кВ: между x₁ и x₂ (0,022 и 0,005 мм) ослабление в 7 и 13 раз сильнее среднего от 0 до x₁ — так не бывает
  assert.ok(has(computeKvHvl(form(MODES[0])), 'warn', /в 7,1 раза сильнее среднего от 0 до 1,127 мм/));
  assert.ok(has(computeKvHvl(form(MODES[2])), 'warn', /в 13,2 раза сильнее/));
  for (const i of [1, 4, 5, 6]) assert.ok(!computeKvHvl(form(MODES[i])).messages.some((m) => m.level !== 'info'), String(i));
});

test('набор пластин и толщина: сумма, u², ошибки', () => {
  const set = kvPlateSet(plateForm());
  assert.equal(set.plates.length, 21);
  const x = parseThickness(' al1 + Al2+AL8 ', set, 'Al');
  assert.ok(Math.abs(x.value - 0.657) < 1e-12);
  assert.ok(Math.abs(x.u2 - 3 * 0.002894 ** 2) < 1e-15);
  assert.deepEqual(x.names, ['Al1', 'Al2', 'Al8']);
  assert.match(parseThickness('Al1+Al13', set, 'Al').error, /пластины «Al13» нет в наборе/);
  assert.match(parseThickness('Al1+al1', set, 'Al').error, /указана дважды/);
  assert.match(parseThickness('Cu1', set, 'Al').error, /Cu1 — Cu, а СПО режима — в мм Al/);
  assert.deepEqual([parseThickness('1,127', set, 'Al').value, parseThickness('1,127', set, 'Al').from], [1.127, 'number']);
  assert.equal(parseThickness('', set, 'Al').blank, true);
  // ошибки набора: без обозначения, повтор, без толщины; без измеренной — номинальная
  const bad = kvPlateSet(plateForm([['', 'Al', '0.1', '', ''], ['Al1', 'Al', '0.1', '', '0.003'], ['al1', 'Al', '0.2', '0.2', ''], ['Al2', 'Al', '', '', '0.003']]));
  assert.deepEqual(bad.errors.map((e) => e.row), [1, 3, 4]);
  assert.deepEqual(bad.notes, ['Al1']);
  assert.equal(bad.byKey.get('al1').t, 0.1);
});

test('проверки измерения: пусто, ошибки ввода, экстраполяция, u_A, контрольный D₀, числа с u и cov', () => {
  assert.equal(computeKvHvl({ kv_range: 'low' }).state, 'empty');
  const base = MODES[1];
  // нет x₂ — ошибка; D₁ больше D₀ — ошибка; с большей толщиной показание больше — ошибка
  assert.ok(has(computeKvHvl(form(base, { kv_hl_x2: '' })), 'error', /Не заполнена толщина x₂/));
  assert.ok(has(computeKvHvl(form(base, { kv_hl_D1: ['230', '230', '230'] })), 'error', /не меньше, чем без него/));
  assert.ok(has(computeKvHvl(form(base, { kv_hl_x1: 'Al2+Al3+Al4+Al6+Al10', kv_hl_x2: 'Al2+Al4+Al12' })), 'error', /С большей толщиной показание больше/));
  // обе толщины меньше СПО — экстраполяция (предупреждение, СПО считается)
  const ex = computeKvHvl(form(base, { kv_hl_D2: ['115,0', '115,1', '115,0'] }));
  assert.ok(ex.ok);
  assert.ok(has(ex, 'warn', /D̄₀\/2 не лежит между D̄₁ и D̄₂/));
  // u_A среднего больше допуска; одно показание — u_A не оценить
  assert.ok(has(computeKvHvl(form(base, { kv_hl_D0: ['225', '230', '220'], kv_hl_ua_tol: '1' })), 'warn', /u_A среднего 1,28 % — больше допуска 1 %/));
  assert.ok(has(computeKvHvl(form(base, { kv_hl_D0: ['225,2'] })), 'info', /одно показание/));
  // контрольный D₀: в допуске — справка, больше — предупреждение; без него — справка Rev.1
  assert.ok(has(computeKvHvl(form(base, { kv_hl_Dc: ['225,4'], kv_hl_ctrl_tol: '1' })), 'info', /Контрольный D₀ в конце отличается от начального на \+0,09 %/));
  assert.ok(has(computeKvHvl(form(base, { kv_hl_Dc: ['229'], kv_hl_ctrl_tol: '1' })), 'warn', /больше допуска 1 %/));
  assert.ok(has(computeKvHvl(form(base)), 'info', /Контрольного D₀ нет/));
  // толщины числом: u(x) и cov — из полей; как с пластинами при тех же значениях
  const pl = computeKvHvl(form(base));
  const num = computeKvHvl(form(base, { kv_hl_x1: '1,136', kv_hl_x2: '1,206', kv_hl_ux1: String(Math.sqrt(3) * 0.002894), kv_hl_ux2: String(Math.sqrt(5) * 0.002894), kv_hl_cov: String(2 * 0.002894 ** 2) }));
  assert.ok(Math.abs(num.hvl - pl.hvl) < 1e-12 && Math.abs(num.U - pl.U) < 1e-12);
  assert.ok(has(computeKvHvl(form(base, { kv_hl_x1: '1,136' })), 'info', /u\(x₁\) не введена/));
  // округление СПО для записи
  assert.deepEqual([hvlDecimals(1.14), hvlDecimals(0.122), hvlDecimals(0.0523)], [3, 3, 4]);
  assert.deepEqual([hvlRound(1.14251), hvlRound(0.052349), hvlText(0.5)], [1.143, 0.0523, '0.500']);
});

test('измеренный СПО — в расчёт режима: k_Q и всё по СПО; «в расчёт» снят — СПО из таблицы режимов', () => {
  const v = normalizeKvVisit({ ...SAMPLE_KV });
  // пример: СПО 1,00 мм Cu и измеренный 1,000 — расчёт тот же, источник — измеренный
  let r = computeKvVisit(v).modes[0];
  assert.equal(r.hvl.used, 1);
  assert.equal(r.results[0].inputs.hvlSource, 'measured');
  const kq0 = r.results[0].cert.value;
  // измеренный СПО больше: k_Q сертификата по нему (линейно по ln СПО между 1,05 и 2,00)
  v.modes[0].shared.kv_hl_D2 = ['14,95', '14,96', '14,95'];
  r = computeKvVisit(v).modes[0];
  assert.ok(r.hvl.used > 1.05, String(r.hvl.used));
  assert.equal(r.results[0].inputs.hvl, r.hvl.used);
  assert.ok(r.results[0].cert.value > kq0);
  assert.ok(r.results[0].messages.some((m) => m.level === 'info' && /СПО пучка — измеренный на листе «СПО и k_Q»/.test(m.text)));
  // «в расчёт» снят — СПО из таблицы режимов
  v.modes[0].shared.kv_hl_apply = false;
  r = computeKvVisit(v).modes[0];
  assert.equal(r.results[0].inputs.hvl, 1);
  assert.equal(r.results[0].inputs.hvlSource, 'table');
  assert.equal(r.results[0].cert.value, kq0);
  // ошибка в измерении — СПО из таблицы режимов
  v.modes[0].shared.kv_hl_apply = true;
  v.modes[0].shared.kv_hl_x2 = 'Cu99';
  r = computeKvVisit(v).modes[0];
  assert.equal(r.hvl.ok, false);
  assert.equal(r.results[0].inputs.hvlSource, 'table');
  // новый режим не копирует измерение СПО
  const m = newKvMode(v.modes[0]);
  assert.deepEqual([m.shared.kv_hl_x1, m.shared.kv_hl_D0.join('')], ['', '']);
  assert.equal(m.shared.kv_hl_dist, SAMPLE_KV.kv_hl_dist);
});

test('«Оборудование»: измеренный СПО — с вопросом вместо номинального, с датой; набор пластин с аппаратом', () => {
  const j0 = normalizeJournal({
    ...JOURNAL_TAG,
    machines: [{ id: 'mk', kind: 'kv', name: 'РТА', modes: [{ id: 'k200', range: 'medium', kv: '200', ma: '10', filter: SAMPLE_KV.kv_filter, hvl: '1,05' }, { id: 'k150', range: 'medium', kv: '150', ma: '12', filter: SAMPLE_KV_MODE2.shared.kv_filter, hvl: '0,500', hvlSource: 'measured', hvlDate: '2025-04-01' }] }],
  });
  const v = normalizeKvVisit({ ...SAMPLE_KV, kv_machine: 'РТА' });
  const m2 = newKvMode(v.modes[0]);
  Object.assign(m2.shared, SAMPLE_KV_MODE2.shared);
  v.modes.push(m2);
  const dry = kvMachineFromVisit(j0, v);
  // режим 200 кВ: номинальный 1,05 → измеренный 1,000 — вопрос; режим 150 кВ: то же значение — измерен заново, без вопроса
  assert.deepEqual(dry.report.hvl, [{ mode: 0, was: '1,05', now: '1,000', source: 'nominal', sourceDate: '', measured: true, range: 'medium' }]);
  const kept = dry.journal.machines[0].modes;
  assert.deepEqual(kept.map((x) => [x.hvl, x.hvlSource, x.hvlDate]), [['1,05', 'nominal', ''], ['0,500', 'measured', SAMPLE_KV.kv_date]]);
  const res = kvMachineFromVisit(j0, v, { replaceHvl: true });
  assert.deepEqual(res.journal.machines[0].modes.map((x) => [x.hvl, x.hvlSource, x.hvlDate]), [['1,000', 'measured', SAMPLE_KV.kv_date], ['0,500', 'measured', SAMPLE_KV.kv_date]]);
  assert.equal(res.report.hvlMeasured, 2);
  // набор пластин — с аппаратом; при подстановке — обратно на лист
  const mk = normalizeKvMachine(res.journal.machines[0]);
  assert.equal(mk.plates.length, 6);
  const back = kvVisitFromMachine(res.journal, mk, ['k200'], normalizeKvVisit(null)).visit;
  assert.deepEqual(back.common.kv_pl_name, SAMPLE_KV.kv_pl_name);
  assert.deepEqual(back.common.kv_pl_t, SAMPLE_KV.kv_pl_t);
  // СПО режима — измеренный из «Оборудования», измерения на листе нет
  assert.equal(back.modes[0].shared.kv_hvl, '1,000');
  assert.equal(back.modes[0].shared.kv_hl_x1, '');
  // измеренный не в расчёте, в таблице режимов другой: замена — номинальным, без даты
  v.modes[0].shared.kv_hl_apply = false;
  v.modes[0].shared.kv_hvl = '1,10';
  const nom = kvMachineFromVisit(res.journal, v, { replaceHvl: true });
  assert.deepEqual(nom.report.hvl, [{ mode: 0, was: '1,000', now: '1,10', source: 'measured', sourceDate: SAMPLE_KV.kv_date, measured: false, range: 'medium' }]);
  assert.deepEqual([0, 1].map((i) => ['hvl', 'hvlSource', 'hvlDate'].map((k) => nom.journal.machines[0].modes[i][k])), [['1,10', 'nominal', ''], ['0,500', 'measured', SAMPLE_KV.kv_date]]);
});
