// kV-рентген, данные P. Andreo (2019): файл данных не изменён при переносе, а калькулятор B_w и [μen/ρ]w,air
// повторяет веб-приложение МАГАТЭ kvx-rays.iaea.org во всех 117 контрольных точках (233 величины) до 4-го знака.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { kvCalculator, ANDREO_CITATION } from '../src/core/kv-data.js';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const round4 = (v) => Math.round(v * 1e4) / 1e4;
const same4 = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} ≠ ${b}`);

test('Данные Andreo: файл совпадает с полученным от автора (SHA-256 в data/andreo-kv/README.md)', () => {
  const js = read('data/andreo-kv/andreo_webapp.js');
  const head = 'export default ', tail = ';\n';
  assert.ok(js.startsWith(head) && js.endsWith(tail), 'обёртка модуля: export default <JSON>;');
  const json = js.slice(head.length, -tail.length);
  const sha = createHash('sha256').update(json, 'utf8').digest('hex');
  const recorded = read('data/andreo-kv/README.md').match(/SHA-256.*?\b([0-9a-f]{64})\b/)?.[1];
  assert.ok(recorded, 'в README записан SHA-256');
  assert.equal(sha, recorded);
  const data = JSON.parse(json);
  assert.deepEqual(Object.keys(data).filter((k) => k !== 'meta').sort(), ['bw_al', 'bw_cu', 'muen_fia', 'muen_z2']);
});

test('Данные Andreo: ссылка на источник', () => {
  assert.match(ANDREO_CITATION, /Andreo P 2019 .*Phys\. Med\. Biol\. 64 205019/);
});

test('Калькулятор B_w и [μen/ρ]: 117 контрольных точек сайта МАГАТЭ, совпадение до 4-го знака', () => {
  const kv = kvCalculator();
  assert.equal(kvCalculator(), kv, 'калькулятор создаётся один раз');
  const { points } = JSON.parse(read('tests/data/kv_control_points.json'));
  assert.equal(points.length, 117);
  let n = 0;
  for (const p of points) {
    const id = `${p.id} (${p.calculator}, ${p.kV} kV, СПО ${p.hvl})`;
    const check = (got, want, what) => {
      same4(got, want, `${id} ${what}`);
      n++;
    };
    if (p.calculator === 'BmuenAl' || p.calculator === 'BmuenCu') {
      const material = p.calculator === 'BmuenAl' ? 'Al' : 'Cu';
      const mu = kv.muenFIA(p.hvl, material);
      check(mu.value, p.site.muFIA, '[μen/ρ]FIA');
      if (p.group === 'fia') continue; // в развёртке по СПО сравнивается только [μen/ρ]FIA
      const bw = (material === 'Al' ? kv.bw : kv.bwCu)(p.kV, p.hvl, p.ssd, p.f);
      check(bw.value, p.site.Bw, 'B_w');
      check(round4(bw.raw * mu.raw), p.site.prod, 'B_w·[μen/ρ]FIA');
    } else if (p.calculator === 'muen2Cu') {
      check(kv.muenZ2(p.kV, p.hvl, p.ssd, p.f).value, p.site.muz2, '[μen/ρ]z=2');
    } else if (p.calculator === 'kgBwAl' || p.calculator === 'kgmuen2Cu') {
      const r = (p.calculator === 'kgBwAl' ? kv.kgBw : kv.kgMuenZ2)(p.kV, p.hvl, p.ref, p.clin);
      check(r.ref, p.site.ref, 'опорные условия');
      check(r.clin, p.site.clin, 'клинические условия');
      check(r.value, p.site.kg, 'отношение');
    } else {
      assert.fail(`${id}: неизвестный калькулятор`);
    }
  }
  assert.equal(n, 233);
});

test('Калькулятор B_w: предупреждения о выходе за сетку и о недостижимом СПО', () => {
  const kv = kvCalculator();
  const codes = (r) => r.warnings.map((w) => w.code);
  assert.deepEqual(codes(kv.bw(50, 1, 30, 10)), []);
  assert.ok(codes(kv.bw(50, 1, 30, 40)).includes('geom_extrap'));
  // 50 кВ: СПО моноэнергетических фотонов 50 кэВ в Al ≈ 7 мм — спектр не может иметь СПО 8 мм Al
  const hm = kv.hvlMax(50, 'Al');
  assert.ok(hm > 6.5 && hm < 7.5, `hvlMax(50 кВ, Al) = ${hm}`);
  assert.ok(codes(kv.bw(50, 8, 30, 10)).includes('hvl_unphysical'));
  assert.ok(codes(kv.muenFIA(30, 'Al')).includes('hvl_extrap_c1'));
});
