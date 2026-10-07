// Бюджет неопределённости: образцы воспроизводят итоги таблиц протоколов, свидетельство заменяет лабораторную часть,
// свои значения и повторяемость (тип А) учитываются, на дозу бюджет не влияет.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uncertaintyBudget, pickTemplate, typeAOf, quad, parseOverrides } from '../src/core/uncertainty.js';
import { parseCells } from '../src/core/units.js';
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

test('вкладки: бюджет в результате, тип А по серии итога, на дозу и соответствие условиям не влияет', () => {
  const p = computePhotons(SAMPLE_FORM);
  assert.equal(p.unc.template.id, 't17');
  near(p.unc.typeA.pct, typeAOf(parseCells(SAMPLE_FORM.rd_M1)).pct, 1e-12, 'контрольных измерений нет — по M₁ раздела 4');
  const p2 = computePhotons({ ...SAMPLE_FORM, unc_cert_U: 'abc', unc_over: JSON.stringify({ 't17.st_kq': '0,3' }) });
  assert.equal(p2.trs.DperMU, p.trs.DperMU);
  assert.equal(p2.compliance.status, p.compliance.status);
  assert.ok(p2.messages.some((m) => m.scope === 'unc' && m.level === 'warn'));
  assert.equal(p2.flags.unc_cert_U, 'warn');
  assert.ok(!p2.messages.some((m) => m.scope === 'unc' && m.level === 'error'));
  // контрольные измерения: тип А по ним
  const pc = computePhotons({ ...SAMPLE_FORM, ctrl_M: ['20,10', '20,20', '20,30'] });
  near(pc.unc.typeA.pct, typeAOf(parseCells(['20,10', '20,20', '20,30'])).pct, 1e-12);
  // TG-51 и пример (ii)
  assert.equal(computePhotons({ ...SAMPLE_FORM, protocol: 'tg51', unc_sit: 'ii' }).unc.template.id, 'add2');
  // перекрёстная калибровка в ⁶⁰Co отмечена — строка в бюджете
  assert.ok(computePhotons({ ...SAMPLE_FORM, unc_cross: true }).unc.rows.some((r) => r.cross));

  const e = computeElectrons(SAMPLE_ELECTRONS);
  assert.ok(e.unc && Number.isFinite(e.unc.UPct));
  assert.equal(e.unc.template.family, 't24');
  assert.equal(computeElectrons({ ...SAMPLE_ELECTRONS, protocol: 'tg51' }).unc.template.id, 'r385t8');

  const c = computeCobalt(SAMPLE_COBALT);
  assert.equal(c.unc.template.id, 't13');
  assert.equal(r1(c.unc.ucPct), 0.8);
  const c2 = computeCobalt({ ...SAMPLE_COBALT, co_unc_cert_U: '1,4' });
  near(c2.unc.groups[0].subtotal.value, 0.7, 1e-12);
  assert.equal(c2.trs.rate, c.trs.rate);
});

test('перенос из «Инструментов» (⁶⁰Co): в бюджете отмечается перекрёстная калибровка рабочей камеры', () => {
  const t = crossCalTargets(computeCrossCal(SAMPLE_CROSSCAL_CO60));
  assert.equal(t.find((x) => x.target === 'co60').patch.co_unc_cross, true);
  assert.equal(t.find((x) => x.target === 'photons').patch.unc_cross, true);
});
