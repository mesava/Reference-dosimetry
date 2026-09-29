// Сверка коэффициентов в базе камер с таблицами протоколов.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CHAMBERS, findChamber, LEGACY_NODES } from '../src/core/chambers.js';
import { kQAddendumFit, kQ as kQ51 } from '../src/core/tg51.js';
import { kQFit, kQ as kQtrs } from '../src/core/trs398.js';

const load = (name) => JSON.parse(readFileSync(new URL(`./data/${name}`, import.meta.url), 'utf8'));

test('TRS-398 Rev.1: ур. (34) с параметрами табл. 45 воспроизводит табл. 16 (26 камер × 12 точек)', () => {
  const t = load('trs398_table16.json');
  let checked = 0;
  for (const [id, row] of Object.entries(t.kQ)) {
    const c = findChamber(id);
    assert.ok(c?.trs, `нет параметров TRS для ${id}`);
    t.tpr.forEach((tpr, i) => {
      const k = kQFit(c.trs, tpr);
      assert.ok(Math.abs(k - row[i]) <= 0.00015, `${id} при TPR ${tpr}: ${k.toFixed(5)} ≠ ${row[i]}`);
      checked++;
    });
  }
  assert.equal(checked, 26 * 12);
});

test('TRS-398: k_Q = 1 при TPR20,10 = 0,57 для всех камер', () => {
  for (const c of CHAMBERS.filter((x) => x.trs)) {
    assert.ok(Math.abs(kQFit(c.trs, 0.57) - 1) < 1e-12, c.id);
  }
});

// Табличные значения аддендума — округлённые результаты расчёта, а не самой аппроксимации;
// наибольшее расхождение 0,00052 (PTW 31013 при 67: 0,99148 против 0,992).
test('Аддендум TG-51: ур. (1) воспроизводит табл. I (20 камер × 5 точек, ±0,0006)', () => {
  const t = load('tg51_addendum_table1.json');
  for (const [id, row] of Object.entries(t.kQ)) {
    const c = findChamber(id);
    assert.ok(c?.tg51, `нет параметров аддендума для ${id}`);
    t.x.forEach((x, i) => {
      const k = kQAddendumFit(c.tg51, x);
      assert.ok(Math.abs(k - row[i]) <= 0.0006, `${id} при ${x}: ${k.toFixed(5)} ≠ ${row[i]}`);
    });
    assert.equal(c.tg51.kq63, row[0], `${id}: kq63 не совпадает с табл. I`);
  }
});

test('TG-51 (1999), табл. I: интерполяция точно проходит через узлы', () => {
  for (const c of CHAMBERS.filter((x) => x.tg51Legacy)) {
    LEGACY_NODES.forEach((x, i) => {
      const r = kQ51(c, x);
      assert.ok(Math.abs(r.value - c.tg51Legacy[i]) < 1e-12, `${c.id} при ${x}`);
    });
    const mid = kQ51(c, 68.5);
    const expect = (c.tg51Legacy[2] + c.tg51Legacy[3]) / 2;
    assert.ok(Math.abs(mid.value - expect) < 1e-12);
  }
});

test('Каждая камера имеет хотя бы один набор данных k_Q', () => {
  for (const c of CHAMBERS) {
    assert.ok(c.tg51 || c.tg51Legacy || c.trs, c.id);
  }
  const ids = CHAMBERS.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, 'повторяющиеся id');
});

test('Границы применимости k_Q', () => {
  const c = findChamber('NE2571');
  assert.ok(kQ51(c, 86).error, '86 — вне диапазона аддендума');
  assert.ok(kQ51(c, 57.9).error);
  assert.ok(Number.isFinite(kQ51(c, 85.9).value));
  assert.ok(kQtrs(c, 0.559).error);
  assert.ok(kQtrs(c, 0.821).error);
  assert.ok(Number.isFinite(kQtrs(c, 0.82).value));
  assert.ok(kQtrs(findChamber('A1'), 0.67).error, 'A1 нет в TRS-398');
  assert.ok(kQ51(findChamber('A26'), 67).error, 'A26 нет в TG-51');
});
