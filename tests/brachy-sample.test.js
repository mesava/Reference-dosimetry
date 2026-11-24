// Пример вкладки «Брахитерапия» (0.77.0): все листы считаются, результаты в пределах допусков TRS-492.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleBrachy, isBrachySample } from '../src/core/sample-brachy.js';
import { computeBrachyWell, computeBrachyPhantom, computeBrachyCross, computeBrachyStability, computeBrachySweet, computeBrachyDecay, computeBrachyTg43, normalizeBrachy } from '../src/core/brachy-sheets.js';

const o = { offsetMin: 180 };

test('пример: сила источника по колодезной камере и фантому — в пределах 3 % от сертификата', () => {
  const f = normalizeBrachy(sampleBrachy());
  assert.equal(isBrachySample(f), true);
  assert.equal(isBrachySample({ src_name: 'другой' }), false);
  const w = computeBrachyWell(f, o);
  assert.equal(w.ok, true);
  assert.ok(Math.abs(w.compare.dev) < 1, `колодезная: ${w.compare.dev}`);
  assert.equal(w.compare.level, 'ok');
  const p = computeBrachyPhantom(f, o);
  assert.ok(p.main);
  assert.ok(Math.abs(p.compare.dev) < 3, `фантом: ${p.compare.dev}`);
  assert.ok(Number.isFinite(p.dose.point));
});

test('пример: максимум, сличение, стабильность, распад, TG-43 считаются', () => {
  const f = normalizeBrachy(sampleBrachy());
  const s = computeBrachySweet(f);
  assert.equal(s.ok, true);
  assert.ok(Math.abs(s.xPeak - 1230) < 1);
  const x = computeBrachyCross(f, o);
  assert.equal(x.ok, true);
  assert.ok(Math.abs(x.prev.dev) < 0.5);
  const st = computeBrachyStability(f, o);
  assert.equal(st.ok, true);
  assert.equal(st.pass, true);
  assert.ok(computeBrachyDecay(f, o).ok);
  const t = computeBrachyTg43(f, { ...o, now: Date.parse('2026-09-15T07:00:00Z'), well: computeBrachyWell(f, o), phantom: computeBrachyPhantom(f, o) });
  assert.equal(t.ok, true);
});
