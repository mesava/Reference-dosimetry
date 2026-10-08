// Бюджет неопределённости: образцы воспроизводят итоги таблиц протоколов, свидетельство заменяет лабораторную часть,
// свои значения и повторяемость (тип А) учитываются, на дозу бюджет не влияет.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uncertaintyBudget, pickTemplate, typeAOf, quad, parseOverrides } from '../src/core/uncertainty.js';
import { parseCells } from '../src/core/units.js';
import { computeUncertaintyTool, normalizeUncTool, UT_DEFAULTS } from '../src/core/uncertainty-tool.js';
import { SAMPLE_UNC } from '../src/core/sample-uncertainty.js';
import { computePhotons } from '../src/core/photons.js';
import { computeElectrons } from '../src/core/electrons.js';
import { computeCobalt } from '../src/core/cobalt.js';
import { computeCrossCal, crossCalTargets } from '../src/core/crosscal.js';
import { SAMPLE_FORM } from '../src/core/sample.js';
import { SAMPLE_ELECTRONS } from '../src/core/sample-electrons.js';
import { SAMPLE_COBALT } from '../src/core/sample-cobalt.js';
import { SAMPLE_CROSSCAL_CO60 } from '../src/core/sample-crosscal.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} ≠ ${b} (±${tol})`);
const r1 = (x) => Math.round(x * 10) / 10;
const row = (b, key) => b.rows.find((r) => r.key === key);

test('образцы TRS-398 (табл. 13, 17, 24): итоги этапов и суммарная неопределённость, как в таблицах', () => {
  // [параметры, этап 1, этап 2, суммарная] — значения из таблиц с одним знаком после запятой
  const cases = [
    [{ beam: 'co60', protocol: 'trs' }, 't13', 0.6, 0.5, 0.8],
    [{ beam: 'photons', protocol: 'trs' }, 't17', 0.6, 0.8, 1.0],
    [{ beam: 'electrons', protocol: 'trs', chamberType: 'cyl' }, 't24cyl', 0.6, 0.9, 1.1],
    [{ beam: 'electrons', protocol: 'trs', chamberType: 'pp' }, 't24pp', 0.6, 1.0, 1.2],
  ];
  for (const [o, id, s1, s2, total] of cases) {
    const b = uncertaintyBudget(o);
    assert.equal(b.template.id, id);
    assert.equal(r1(b.groups[0].subtotal.def), s1, `${id}: этап 1`);
    assert.equal(r1(b.groups[1].subtotal.def), s2, `${id}: этап 2`);
    assert.equal(r1(b.ucPct), total, `${id}: суммарная`);
    near(b.UPct, 2 * b.ucPct, 1e-12);
    assert.equal(b.custom, false);
  }
  // прим. c к табл. 24: для плоскопараллельной камеры при R50 < 2 г/см² k_Q — 0,8 %
  assert.equal(row(uncertaintyBudget({ beam: 'electrons', protocol: 'trs', chamberType: 'pp', r50: 1.8 }), 't24.st_kq').def, 0.8);
  assert.equal(row(uncertaintyBudget({ beam: 'electrons', protocol: 'trs', chamberType: 'pp', r50: 2.5 }), 't24.st_kq').def, 0.7);
  // табл. 24 для цилиндрической камеры: стабильность дозиметра 0,2 %, для плоскопараллельной — 0,4 %
  assert.equal(row(uncertaintyBudget({ beam: 'electrons', protocol: 'trs', chamberType: 'cyl' }), 't24.st_stab').def, 0.2);
  assert.equal(row(uncertaintyBudget({ beam: 'electrons', protocol: 'trs', chamberType: 'pp' }), 't24.st_stab').def, 0.4);
});

test('образцы TG-51: аддендум табл. II, Report 385 табл. 8 и 9 — примеры (i) и (ii)', () => {
  const cases = [
    [{ beam: 'photons', protocol: 'tg51' }, 'add2', 17, 0.9, 2.1],
    [{ beam: 'electrons', protocol: 'tg51', chamberType: 'cyl' }, 'r385t8', 17, 0.9, 2.0],
    [{ beam: 'electrons', protocol: 'tg51', chamberType: 'pp', crossE: true }, 'r385t9', 27, 1.1, 2.5],
  ];
  for (const [o, id, n, i, ii] of cases) {
    const a = uncertaintyBudget({ ...o, situation: 'i' });
    const b = uncertaintyBudget({ ...o, situation: 'ii' });
    assert.equal(a.template.id, id);
    assert.equal(a.rows.length, n, `${id}: число строк`);
    assert.equal(r1(a.ucPct), i, `${id} (i)`);
    assert.equal(r1(b.ucPct), ii, `${id} (ii)`);
  }
  // Report 385, разд. 8.3.3: выбор k_Q по R50 — 0,08 % для цилиндрической и 0,12 % для плоскопараллельной камеры
  assert.equal(row(uncertaintyBudget({ beam: 'electrons', protocol: 'tg51', chamberType: 'cyl' }), 'r385t8.kqassign').def, 0.08);
  assert.equal(row(uncertaintyBudget({ beam: 'electrons', protocol: 'tg51', chamberType: 'pp' }), 'r385t8.kqassign').def, 0.12);
  // N_D,w лабораторий AAPM — 0,75 % в обоих примерах
  assert.equal(row(uncertaintyBudget({ beam: 'photons', protocol: 'tg51', situation: 'ii' }), 'add2.ndw').def, 0.75);
});

test('выбор образца: ⁶⁰Co всегда по TRS-398 (TG-51 бюджета не даёт), перекрёстная калибровка в электронах — табл. 24/9', () => {
  assert.equal(pickTemplate({ beam: 'co60', protocol: 'tg51' }), 't13');
  assert.match(uncertaintyBudget({ beam: 'co60', protocol: 'tg51' }).template.note, /TG-51/);
  assert.equal(uncertaintyBudget({ beam: 'co60', protocol: 'trs' }).template.note, '');
  assert.equal(pickTemplate({ beam: 'electrons', protocol: 'trs', chamberType: 'pp', crossE: true }), 't24x');
  // разд. 7.10: после перекрёстной калибровки неопределённость — как у цилиндрической камеры табл. 24
  near(uncertaintyBudget({ beam: 'electrons', protocol: 'trs', chamberType: 'pp', crossE: true }).ucPct, uncertaintyBudget({ beam: 'electrons', protocol: 'trs', chamberType: 'cyl' }).ucPct, 1e-12);
  assert.equal(pickTemplate({ beam: 'electrons', protocol: 'tg51', chamberType: 'pp', crossE: true }), 'r385t9');
});

test('рабочая камера после перекрёстной калибровки: строка 0,6 % даёт прирост около 0,2 % (TRS-398, разд. 5.7, 6.8)', () => {
  for (const [o, base] of [[{ beam: 'photons', protocol: 'trs' }, 1.0], [{ beam: 'co60', protocol: 'trs' }, 0.8]]) {
    const plain = uncertaintyBudget(o);
    const cross = uncertaintyBudget({ ...o, crossCo: true });
    assert.equal(r1(plain.ucPct), base);
    assert.ok(cross.rows.some((r) => r.cross && r.def === 0.6));
    near(cross.ucPct - plain.ucPct, 0.2, 0.05, 'прирост');
  }
  // фотоны в пучке Q_cross (разд. 4.5.2) — та же строка
  assert.ok(uncertaintyBudget({ beam: 'photons', protocol: 'trs', crossQ: true }).rows.some((r) => r.cross));
  // в электронах после перекрёстной калибровки строки нет: её учитывает сам образец
  assert.ok(!uncertaintyBudget({ beam: 'electrons', protocol: 'trs', chamberType: 'pp', crossE: true, crossCo: true }).rows.some((r) => r.cross));
});

test('U из свидетельства заменяет лабораторную часть: этап 1 TRS-398 или строку N_D,w TG-51', () => {
  const b = uncertaintyBudget({ beam: 'photons', protocol: 'trs', certU: '1,2', certK: '2' });
  const st1 = b.groups[0];
  assert.deepEqual(st1.rows.filter((r) => r.replaced).map((r) => r.key), ['t17.lab_psdl', 't17.lab_stab', 't17.lab_user']);
  const cert = st1.rows.find((r) => r.certRow);
  near(cert.value, 0.6, 1e-12);
  near(st1.subtotal.value, 0.6, 1e-12);
  near(st1.subtotal.def, Math.sqrt(0.5 ** 2 + 0.1 ** 2 + 0.4 ** 2), 1e-12, 'столбец образца остаётся как в таблице');
  near(b.ucPct, quad([0.6, 0.2, 0.3, 0.3, 0.3, 0.6]), 1e-12);
  assert.equal(b.custom, true);
  // TG-51: строка N_D,w — U/k, остальное без изменений
  const g = uncertaintyBudget({ beam: 'photons', protocol: 'tg51', certU: '1,5', certK: '3' });
  near(row(g, 'add2.ndw').value, 0.5, 1e-12);
  assert.equal(g.rows.filter((r) => r.replaced).length, 0);
  // пустой k — 2; ошибки ввода — предупреждения, образец остаётся
  near(row(uncertaintyBudget({ beam: 'photons', protocol: 'tg51', certU: '1', certK: '' }), 'add2.ndw').value, 0.5, 1e-12);
  const bad = uncertaintyBudget({ beam: 'photons', protocol: 'trs', certU: 'abc', prefix: 'x_' });
  assert.equal(bad.cert, null);
  assert.ok(bad.messages.some((m) => m.level === 'warn' && m.field === 'x_unc_cert_U'));
  assert.ok(uncertaintyBudget({ beam: 'photons', protocol: 'trs', certU: '25' }).messages.some((m) => /неправдоподобно/.test(m.text)));
  assert.ok(uncertaintyBudget({ beam: 'photons', protocol: 'trs', certU: '1', certK: '0' }).messages.some((m) => /k = 2/.test(m.text)));
});

test('свои значения строк: заменяют образец, нечитаемые — предупреждение; ключи не смешиваются между образцами', () => {
  const over = JSON.stringify({ 't17.st_setup': '0,2', 't17.st_ki': 'abc', 'add2.ssd': '0,9' });
  const b = uncertaintyBudget({ beam: 'photons', protocol: 'trs', over, prefix: '' });
  assert.equal(row(b, 't17.st_setup').value, 0.2);
  assert.equal(row(b, 't17.st_setup').over, true);
  assert.equal(row(b, 't17.st_ki').value, 0.3);
  assert.ok(b.messages.some((m) => m.field === 'unc_ov_t17.st_ki'));
  near(b.ucPct, quad([0.5, 0.1, 0.4, 0.2, 0.2, 0.3, 0.3, 0.6]), 1e-12);
  assert.equal(b.custom, true);
  // значение для образца TG-51 на TRS-398 не действует, и наоборот
  const g = uncertaintyBudget({ beam: 'photons', protocol: 'tg51', over });
  assert.equal(row(g, 'add2.ssd').value, 0.9);
  assert.equal(row(g, 'add2.depth').value, 0.17);
  // 0 допустим (например, P_elec, если камеру калибровали вместе с электрометром)
  assert.equal(row(uncertaintyBudget({ beam: 'photons', protocol: 'tg51', over: { 'add2.pelec': '0' } }), 'add2.pelec').value, 0);
  assert.deepEqual(parseOverrides('не JSON'), {});
  assert.deepEqual(parseOverrides(''), {});
});

test('повторяемость показаний (тип А): s/√n; в расчёт идёт большее из неё и значения образца', () => {
  const s = parseCells(['1', '2', '3']);
  near(typeAOf(s).pct, (1 / Math.sqrt(3) / 2) * 100, 1e-12);
  assert.equal(typeAOf(parseCells(['5', '', ''])), null, 'одно показание — оценки нет');
  const small = uncertaintyBudget({ beam: 'photons', protocol: 'trs', typeA: { n: 3, pct: 0.02 } });
  assert.equal(row(small, 't17.st_read').value, 0.3);
  assert.equal(row(small, 't17.st_read').type, 'B');
  const big = uncertaintyBudget({ beam: 'photons', protocol: 'trs', typeA: { n: 3, pct: 0.45 } });
  assert.equal(row(big, 't17.st_read').value, 0.45);
  assert.equal(row(big, 't17.st_read').type, 'A');
  // TG-51: строка «стабильность ускорителя»
  assert.equal(row(uncertaintyBudget({ beam: 'photons', protocol: 'tg51', typeA: { n: 5, pct: 0.12 } }), 'add2.linac').value, 0.12);
  // своё значение важнее
  assert.equal(row(uncertaintyBudget({ beam: 'photons', protocol: 'trs', typeA: { n: 3, pct: 0.45 }, over: { 't17.st_read': '0,25' } }), 't17.st_read').value, 0.25);
});

test('инструмент «Неопределённость»: демонстрационный пример — табл. 17, U из свидетельства, U в единицах итога', () => {
  const r = computeUncertaintyTool(SAMPLE_UNC);
  assert.deepEqual(r.messages.filter((m) => m.level !== 'info').map((m) => m.text), []);
  assert.equal(r.budget.template.id, 't17');
  near(r.budget.groups[0].subtotal.value, 0.6, 1e-12, 'этап 1 из свидетельства: 1,2 %/2');
  near(r.typeA.pct, typeAOf(parseCells(SAMPLE_UNC.unc_M)).pct, 1e-12);
  near(r.abs, (1.0046 * r.UPct) / 100, 1e-15);
  near(r.UPct, 2 * r.ucPct, 1e-12);
  // пустая форма: образец без своих значений, U в единицах дозы нет
  const e = computeUncertaintyTool({ ...UT_DEFAULTS });
  assert.equal(r1(e.ucPct), 1.0);
  assert.ok(Number.isNaN(e.abs));
  assert.equal(e.budget.custom, false);
});

test('инструмент: пучок, протокол, тип камеры и способ калибровки выбирают образец', () => {
  const t = (o) => computeUncertaintyTool({ ...UT_DEFAULTS, ...o });
  assert.equal(t({ unc_beam_type: 'co60' }).budget.template.id, 't13');
  assert.equal(t({ unc_beam_type: 'co60', protocol: 'tg51' }).budget.template.id, 't13');
  assert.equal(t({ unc_beam_type: 'photons', protocol: 'tg51', unc_sit: 'ii' }).budget.template.id, 'add2');
  assert.equal(r1(t({ unc_beam_type: 'photons', protocol: 'tg51', unc_sit: 'ii' }).ucPct), 2.1);
  assert.equal(t({ unc_beam_type: 'electrons', unc_ch_type: 'pp' }).budget.template.id, 't24pp');
  assert.equal(t({ unc_beam_type: 'electrons', unc_ch_type: 'pp', unc_route: 'crossQ' }).budget.template.id, 't24x');
  assert.equal(t({ unc_beam_type: 'electrons', unc_ch_type: 'pp', unc_route: 'crossQ', protocol: 'tg51' }).budget.template.id, 'r385t9');
  // перекрёстная калибровка в ⁶⁰Co или в пучке Q_cross — строка 0,6 %
  assert.ok(t({ unc_beam_type: 'co60', unc_route: 'crossCo' }).budget.rows.some((r) => r.cross));
  assert.ok(t({ unc_beam_type: 'photons', unc_route: 'crossQ' }).budget.rows.some((r) => r.cross));
  // способ, недопустимый для пучка, заменяется на «в лаборатории»
  assert.equal(normalizeUncTool({ unc_beam_type: 'co60', unc_route: 'crossQ' }).unc_route, 'lab');
  // сочетания, которых протоколы не описывают, — предупреждения
  assert.ok(t({ unc_beam_type: 'photons', unc_route: 'crossQ', protocol: 'tg51' }).flags.unc_route === 'warn');
  assert.ok(t({ unc_beam_type: 'electrons', unc_ch_type: 'cyl', unc_route: 'crossQ', protocol: 'tg51' }).flags.unc_ch_type === 'warn');
  // R50: плоскопараллельная камера при R50 < 2 г/см² — k_Q 0,8 %; цилиндрическая при R50 < 3 по TRS-398 — предупреждение
  assert.equal(row(t({ unc_beam_type: 'electrons', unc_ch_type: 'pp', unc_r50: '1,8' }).budget, 't24.st_kq').def, 0.8);
  assert.equal(t({ unc_beam_type: 'electrons', unc_ch_type: 'cyl', unc_r50: '2,5' }).flags.unc_r50, 'warn');
  assert.equal(t({ unc_beam_type: 'electrons', unc_r50: 'abc' }).flags.unc_r50, 'warn');
});

test('инструмент: проверки показаний и итога; ошибки ввода — предупреждения, бюджет считается', () => {
  const t = (o) => computeUncertaintyTool({ ...UT_DEFAULTS, ...o });
  assert.equal(t({ unc_M: ['1', 'x', ''] }).flags.unc_M, 'warn');
  assert.equal(t({ unc_M: ['10', '10,8', '10'] }).flags.unc_M, 'warn', 'разброс больше 5 %');
  assert.equal(t({ unc_M: ['10', '10,1', '10'] }).flags.unc_M, 'info', 'разброс больше 0,5 %');
  assert.equal(t({ unc_M: ['10', '', ''] }).typeA, null);
  const big = t({ unc_M: ['10', '10,1', '10'] });
  assert.ok(big.typeA.pct > 0.3);
  assert.equal(row(big.budget, 't17.st_read').value, big.typeA.pct, 'большой разброс заменяет значение образца');
  const bad = t({ unc_value: '—' });
  assert.equal(bad.flags.unc_value, 'warn');
  assert.ok(Number.isNaN(bad.abs));
  assert.ok(Number.isFinite(bad.UPct));
  assert.ok(!bad.hasErrors);
  assert.equal(t({ unc_cert_U: 'abc' }).flags.unc_cert_U, 'warn');
  assert.equal(t({ unc_over: JSON.stringify({ 't17.st_ki': 'x' }) }).flags['unc_ov_t17.st_ki'], 'warn');
});

test('вкладки дозиметрии бюджета не содержат; перенос из перекрёстной калибровки его не касается', () => {
  assert.equal(computePhotons(SAMPLE_FORM).unc, undefined);
  assert.equal(computeElectrons(SAMPLE_ELECTRONS).unc, undefined);
  assert.equal(computeCobalt(SAMPLE_COBALT).unc, undefined);
  for (const x of crossCalTargets(computeCrossCal(SAMPLE_CROSSCAL_CO60))) assert.ok(!Object.keys(x.patch).some((k) => /unc/.test(k)));
});
