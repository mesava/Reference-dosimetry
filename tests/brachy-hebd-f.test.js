// Функция анизотропии F(r,θ) по таблицам HEBD (Perez-Calatayud et al. 2012, AAPM Report 229): значения в узлах — как в
// таблицах, билинейная интерполяция и экстраполяция по HEBD, табл. III, F(r, 90°) = 1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HEBD_F, hebdF } from '../src/core/brachy-hebd-f.js';
import { DOSE_SOURCES } from '../src/core/brachy-data.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} ≠ ${b} (±${tol})`);

test('Таблица F(r,θ) есть у каждой модели HEBD с Λ; θ от 0 до 180°, на 90° F = 1', () => {
  const ids = DOSE_SOURCES.filter((x) => x.lambda).map((x) => x.id).sort();
  assert.deepEqual(Object.keys(HEBD_F).sort(), ids);
  for (const [id, t] of Object.entries(HEBD_F)) {
    assert.equal(t.theta[0], 0, id);
    assert.equal(t.theta.at(-1), 180, id);
    assert.equal(t.r.at(-1), 10, id);
    assert.ok(t.F.every((row) => row.length === t.r.length && row.every((x) => x > 0.2 && x < 2)), id);
    assert.ok(t.F[t.theta.indexOf(90)].every((x) => x === 1), id);
    for (let i = 1; i < t.theta.length; i++) assert.ok(t.theta[i] > t.theta[i - 1], id);
  }
});

test('Значения в узлах — как в таблицах HEBD', () => {
  // табл. VI (mHDR-v1): θ = 0°, r = 1 см — 0,626; θ = 180°, r = 10 см — 0,738
  near(hebdF('mhdr-v1', 1, 0).value, 0.626, 1e-12);
  near(hebdF('mhdr-v1', 10, 180).value, 0.738, 1e-12);
  // табл. VIII (mHDR-v2, две части): θ = 0°, r = 0,4 см — 0,692; r = 10 см — 0,798; θ = 180°, r = 1 см — 0,525
  near(hebdF('mhdr-v2', 0.4, 0).value, 0.692, 1e-12);
  near(hebdF('mhdr-v2', 10, 0).value, 0.798, 1e-12);
  near(hebdF('mhdr-v2', 1, 180).value, 0.525, 1e-12);
  // табл. LVI (Co0.A86): θ = 40°, r = 2 см — 0,996; θ = 180°, r = 1 см — 0,931
  near(hebdF('co0a86', 2, 40).value, 0.996, 1e-12);
  near(hebdF('co0a86', 1, 180).value, 0.931, 1e-12);
  assert.equal(hebdF('co0a86', 1, 180).table, 'LVI');
});

test('Билинейная интерполяция и экстраполяция (HEBD, табл. III)', () => {
  // mHDR-v2, θ = 1° между 0° и 2°, r = 1,25 см между 1 и 1,5 см: (0,610 + 0,614)/2 и (0,634 + 0,640)/2 → 0,6245
  near(hebdF('mhdr-v2', 1.25, 1).value, (0.612 + 0.637) / 2, 1e-12);
  // mHDR-v1, θ = 4° между 3° (0,637) и 5° (0,658), r = 1 см
  near(hebdF('mhdr-v1', 1, 4).value, 0.6475, 1e-12);
  // дальше 10 см — значение на 10 см (нулевой порядок)
  const far = hebdF('co0a86', 12, 0);
  near(far.value, 0.952, 1e-12);
  assert.equal(far.extra, 'far');
  assert.equal(hebdF('co0a86', 5, 0).extra, '');
  // вне диапазона θ и неизвестная модель
  assert.equal(hebdF('co0a86', 1, 181), null);
  assert.equal(hebdF('other', 1, 0), null);
});
