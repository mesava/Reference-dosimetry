// Кривая дозы электронов: s_w,air по Burns et al., разбор данных сканера, сдвиг точки измерения по протоколам,
// R50 по I50 (ур. 37), параметры кривой (R80, R50, Rp, Dx, PDD(z_ref)), ошибки ввода.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeEdepth, swAirBurns, parseCurveText, depthShift, normalizeEdepth, resolveChamber, ED_DEFAULTS, curveCsv, valueAt } from '../src/core/edepth.js';
import { SAMPLE_EDEPTH } from '../src/core/sample-edepth.js';
import { r50FromI50 } from '../src/core/electrons.js';
import { readFileSync } from 'node:fs';

const T22 = JSON.parse(readFileSync(new URL('./data/trs398_table22.json', import.meta.url), 'utf8'));

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} ≠ ${b} (±${tol})`);
const has = (r, level, re) => r.messages.some((m) => m.level === level && re.test(m.text));
const text = (rows) => rows.map(([z, v]) => `${z}\t${v}`).join('\n');

test('TRS-398 Rev.1, табл. 22: выражение Burns et al. воспроизводит все 350 значений s_w,air в пределах округления', () => {
  assert.equal(T22.zr50.length * T22.r50.length, 350);
  T22.zr50.forEach((y, i) =>
    T22.r50.forEach((r50, j) => near(swAirBurns(r50, y * r50), T22.sw[i][j], 0.0006, `R50 = ${r50}, z/R50 = ${y}`)),
  );
  // нижние строки таблицы: z_ref (округлено до 0,1 г/см²) и s_w,air на этой глубине (2–3 знака)
  T22.r50.forEach((r50, j) => {
    near(T22.zref[j], 0.6 * r50 - 0.1, 0.051, `z_ref при R50 = ${r50}`);
    near(swAirBurns(r50, T22.zref[j]), T22.swZref[j], 0.0015, `s_w,air(z_ref) при R50 = ${r50}`);
  });
});

test('s_w,air по Burns et al. на z_ref совпадает в пределах 0,25 % с их же выражением для опорной глубины, 1,253 − 0,1487·R50^0,214', () => {
  for (const r50 of [2, 3, 5, 7.5, 10]) {
    const zref = 0.6 * r50 - 0.1;
    // два выражения — аппроксимации одних и тех же расчётов, расходятся до ~0,2 %
    near(swAirBurns(r50, zref) / (1.253 - 0.1487 * r50 ** 0.214), 1, 0.0025, `R50 = ${r50}`);
  }
  // растёт с глубиной (спектр смягчается) и убывает с энергией
  assert.ok(swAirBurns(5, 4) > swAirBurns(5, 1));
  assert.ok(swAirBurns(3, 2) > swAirBurns(8, 2));
});

test('разбор данных: табуляция, точка с запятой и десятичная запятая, CSV через запятую, заголовки, блок PTW mcc', () => {
  const a = parseCurveText('Depth [mm]\tDose [%]\n0.0\t85.1\n1.0\t86.0\n');
  assert.deepEqual(a.points.map((p) => [p.z, p.v]), [[0, 85.1], [1, 86]]);
  assert.equal(a.skipped, 1);
  const b = parseCurveText('z;I\n0,5;85,1\n1,5;86,25');
  assert.deepEqual(b.points.map((p) => [p.z, p.v]), [[0.5, 85.1], [1.5, 86.25]]);
  const c = parseCurveText('0.5,85.1\n1.5, 86.25\n2,87');
  assert.deepEqual(c.points.map((p) => [p.z, p.v]), [[0.5, 85.1], [1.5, 86.25], [2, 87]]);
  const d = parseCurveText('0,5 85,1\n1 8,6E+01');
  assert.deepEqual(d.points.map((p) => [p.z, p.v]), [[0.5, 85.1], [1, 86]]);
  const mcc = 'BEGIN_SCAN 1\n\tBEGIN_DATA\n\t\t0.00\t9.120E-01\t0\n\t\t1.00\t9.230E-01\t0\n\tEND_DATA\nEND_SCAN 1\nBEGIN_SCAN 2\n\tBEGIN_DATA\n\t\t0.00\t5.0\n\tEND_DATA\n';
  const m = parseCurveText(mcc);
  assert.equal(m.curves, 2);
  assert.deepEqual(m.points.map((p) => [p.z, p.v]), [[0, 0.912], [1, 0.923]]);
});

test('сдвиг точки измерения: TRS-398 — 0,5·r_cyl и водный эквивалент окна; Report 385 — табл. 2 и 3', () => {
  const sh = (o) => depthShift(normalizeEdepth({ ...ED_DEFAULTS, ...o }), resolveChamber(normalizeEdepth({ ...ED_DEFAULTS, ...o })));
  near(sh({ ed_ch_model: 'ROOS' }).value, 0.132, 1e-12); // 132 мг/см², табл. 5
  near(sh({ ed_ch_model: 'ROOS', protocol: 'tg51' }).value, 0.16, 1e-12); // 1,6 мм, табл. 3
  near(sh({ ed_ch_model: 'NE2571' }).value, -0.16, 1e-12); // r_cyl = 3,2 мм
  near(sh({ ed_ch_model: 'PTW30013', protocol: 'tg51' }).value, -0.12, 1e-12); // 1,2 мм, табл. 2
  const f12 = sh({ ed_ch_model: 'PTW30012', protocol: 'tg51' });
  near(f12.value, -0.155, 1e-12);
  assert.equal(f12.fallback, true);
  assert.equal(sh({ ed_shift_mode: 'none' }).value, 0);
  near(sh({ ed_shift_mode: 'manual', ed_shift_manual: '-0,8' }).value, -0.08, 1e-12);
  assert.ok(Number.isNaN(sh({ ed_ch_model: 'A11' }).value)); // нет толщины окна в табл. 5
  near(sh({ ed_ch_model: 'OTHER', ed_other_type: 'cyl', ed_other_r: '3' }).value, -0.15, 1e-12);
  assert.equal(sh({ ed_detector: 'dose' }).value, 0);
});

test('камера: R50 по I50 (ур. 37), доза = ионизация × s_w,air, нормировка на максимум', () => {
  const r = computeEdepth(SAMPLE_EDEPTH);
  assert.equal(r.blocked, false);
  near(r.r50, r50FromI50(r.i50).value, 1e-12);
  // глубина в данных — от наружной поверхности окна Roos: точки сдвинуты на 1,32 мм
  near(r.points[0].zEff, 0.132, 1e-9);
  const raw = r.points.map((p) => p.I * swAirBurns(r.r50, Math.min(Math.max(p.zEff, 0.02 * r.r50), 1.2 * r.r50)));
  const mx = Math.max(...raw);
  r.points.forEach((p, i) => near(p.D, (raw[i] / mx) * 100, 1e-9));
  // модельная кривая дозы, из которой получен образец: R50 = 5,094 см
  near(r.r50dose, 5.094, 0.01);
  near(r.zref, 0.6 * r.r50 - 0.1, 1e-12);
  near(r.pddZref, valueAt(r.points.map((p) => p.zEff), r.points.map((p) => p.D), r.zref), 1e-12);
  assert.ok(r.pddZref > 99 && r.pddZref <= 100);
  assert.ok(r.r100 > 2.3 && r.r100 < 3.1, `R100 ${r.r100}`);
  assert.ok(r.r90 < r.r80 && r.r80 < r.r50dose && r.r50dose < r.rp);
  near(r.dx, 2.4, 0.3);
  // CSV для системы планирования
  const csv = curveCsv(r).split('\n');
  assert.equal(csv.length, r.points.length + 1);
  assert.match(csv[1], /^0,132;/);
});

test('детектор дозы: без пересчёта; R50 — по кривой; R_p и D_x по касательной и фону', () => {
  const rows = [];
  for (let i = 0; i <= 70; i++) {
    const z = i / 10;
    rows.push([z.toFixed(1), Math.max(2, z <= 3 ? 100 : 100 - 50 * (z - 3)).toFixed(3)]);
  }
  const r = computeEdepth({ ...ED_DEFAULTS, ed_detector: 'dose', ed_unit: 'cm', ed_data: text(rows) });
  assert.equal(r.blocked, false);
  near(r.r50, 4.0, 1e-9);
  near(r.r80, 3.4, 1e-9);
  near(r.rp, 4.96, 1e-6);
  near(r.dx, 2, 1e-6);
  r.points.forEach((p) => near(p.D, p.I, 1e-12));
  assert.ok(has(r, 'info', /должен отвечать дозе/));
});

test('предупреждения и ошибки: нет данных, нет спада до 50 %, максимум в конце, цилиндрическая камера при R50 < 3', () => {
  assert.ok(has(computeEdepth({ ...ED_DEFAULTS }), 'error', /Вставьте кривую/));
  const flat = text(Array.from({ length: 20 }, (_, i) => [i, 100 - i]));
  assert.ok(has(computeEdepth({ ...ED_DEFAULTS, ed_data: flat }), 'error', /не опускается до 50/));
  const rising = text(Array.from({ length: 20 }, (_, i) => [i, 50 + i]));
  assert.ok(has(computeEdepth({ ...ED_DEFAULTS, ed_data: rising }), 'error', /Максимум — в конце/));
  // R50 ≈ 2 г/см² цилиндрической камерой
  const low = [];
  for (let i = 0; i <= 40; i++) {
    const z = i / 10;
    low.push([z * 10, Math.max(1, z <= 1 ? 100 : 100 - 80 * (z - 1)).toFixed(2)]);
  }
  const c = computeEdepth({ ...ED_DEFAULTS, ed_ch_model: 'NE2571', ed_data: text(low) });
  assert.ok(c.r50 < 3);
  assert.ok(has(c, 'warn', /нужна плоскопараллельная камера/));
  // другая камера без радиуса — ошибка на поле
  const o = computeEdepth({ ...SAMPLE_EDEPTH, ed_ch_model: 'OTHER', ed_other_type: 'cyl' });
  assert.equal(o.flags.ed_other_r, 'error');
});

test('нормализация: неизвестная камера → Roos, неизвестные режимы → по умолчанию', () => {
  const f = normalizeEdepth({ ed_ch_model: 'XYZ', ed_detector: 'q', ed_shift_mode: 'q', ed_unit: 'q' });
  assert.equal(f.ed_ch_model, 'ROOS');
  assert.equal(f.ed_detector, 'chamber');
  assert.equal(f.ed_shift_mode, 'auto');
  assert.equal(f.ed_unit, 'mm');
});
