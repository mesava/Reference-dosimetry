// kV-рентген, справочное сравнение (шаг 4): таблицы TG-61 IV, V, VII–IX по источнику (узлы, интерполяция, границы),
// строка TG-61 для веток N_K против ручного отношения множителей, строка DIN 6809-4 / SSRMP No 9 = итог / k_g.
// Сравнение на итог TRS-398 Rev.1 не влияет.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeKv } from '../src/core/kv.js';
import {
  TG61_T4_AL, TG61_T5_AL, TG61_T5_HVL_AL, TG61_T5_D, TG61_T7, TG61_T8, TG61_T9,
  tg61MuenAir, tg61Bw, tg61MuenWater, tg61PQcham, tg61Psheath,
} from '../src/core/kv-tg61.js';
import { SAMPLE_KV } from '../src/core/sample-kv.js';
import { setLang } from '../src/core/i18n.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} ≠ ${b} (±${tol})`);
const lnMid = (a, b) => Math.sqrt(a * b); // середина отрезка по ln(СПО)

// Низкие энергии, N_K: PTW 23342 в свободном воздухе, N_K по качествам.
const LOW_NK = {
  kv_range: 'low', kv_kv: '50', kv_hvl: '1,0', kv_cone: '5', kv_ssd: '30',
  kv_ch_model: 'PTW23342', kv_foil: true, kv_cal: 'nk', kv_cert_form: 'n', kv_n_unit: 'Gy/nC',
  kv_cq_kv: ['30', '50', '70'], kv_cq_hvl: ['0,36', '1,0', '2,9'], kv_cq_val: ['1,30', '1,31', '1,32'],
  kv_env_T: '21', kv_env_P: '100', kv_set_unit: 'min', kv_set: '1', kv_timer_mode: 'manual', kv_tau: '0',
  kv_M1: ['2,000', '2,001', '1,999'], kv_Mopp: ['2,004', '2,005', '2,003'],
};
// Средние энергии, N_K: NE 2571 в чехле из ПММА 1 мм на 2 см в воде.
const MED_NK = {
  ...LOW_NK, kv_range: 'medium', kv_kv: '200', kv_hvl: '1,0', kv_cone: '10', kv_ssd: '50', kv_ch_model: 'NE2571', kv_foil: false,
  kv_cert_form: 'kq', kv_n: '0,045', kv_cq_kv: ['150', '200', '250'], kv_cq_hvl: ['0,5', '1', '2'], kv_cq_val: ['0,995', '1,000', '1,010'],
  kv_tg61_sleeve: 'pmma', kv_tg61_sleeve_t: '1',
};

test('TG-61, табл. IV, V: размеры и узлы по источнику; при РИП 10 см — строка (b)', () => {
  assert.equal(TG61_T4_AL.hvl.length, TG61_T4_AL.muen.length);
  assert.equal(tg61MuenAir(0.03).value, 1.047);
  assert.equal(tg61MuenAir(1.0).value, 1.02);
  assert.equal(tg61MuenAir(1.5).value, 1.017);
  assert.equal(tg61MuenAir(8.0).value, 1.045);
  assert.equal(tg61MuenAir(0.02).out, 'hvl');
  assert.equal(tg61MuenAir(9).out, 'hvl');

  // табл. V: (a) — 19 столбцов (до 4 мм Al), (b) — 22 (до 8 мм Al); по d — 7 строк; B_w растёт с полем
  for (const [ssd, rows] of Object.entries(TG61_T5_AL)) {
    assert.equal(rows.length, TG61_T5_D.length);
    rows.forEach((r) => assert.equal(r.length, Number(ssd) < 10 ? 19 : 22, `РИП ${ssd}`));
    for (let j = 0; j < rows[0].length; j++) for (let i = 1; i < rows.length; i++) assert.ok(rows[i][j] >= rows[i - 1][j], `РИП ${ssd}, d ${TG61_T5_D[i]}, столбец ${j}`);
  }
  assert.equal(TG61_T5_HVL_AL.length, 22);
  // контрольные узлы из TG-61 (стр. 884–885)
  assert.equal(tg61Bw(0.04, 1.5, 1).value, 1.001);
  assert.equal(tg61Bw(4.0, 7, 5).value, 1.213);
  assert.equal(tg61Bw(1.0, 30, 10).value, 1.157);
  assert.equal(tg61Bw(3.0, 50, 15).value, 1.346);
  assert.equal(tg61Bw(8.0, 100, 20).value, 1.508);
  assert.equal(tg61Bw(0.1, 10, 3).value, 1.018, 'РИП 10 см, d = 3 см — строка (b), в (a) 1,019');
  assert.equal(tg61Bw(5.0, 10, 10).value, 1.308);
});

test('TG-61, табл. V: по ln(СПО), по d и РИП — линейно; вне таблицы — NaN с причиной', () => {
  near(tg61Bw(lnMid(1.0, 1.2), 30, 10).value, (1.157 + 1.175) / 2, 1e-12, 'середина по ln(СПО)');
  near(tg61Bw(1.0, 30, 7.5).value, (1.130 + 1.157) / 2, 1e-12, 'середина по d');
  near(tg61Bw(1.0, 25, 10).value, (1.155 + 1.157) / 2, 1e-12, 'середина по РИП');
  near(tg61Bw(3.0, 8, 5).value, 1.207 + (1.211 - 1.207) / 3, 1e-12, 'между (a) и (b)');
  assert.equal(tg61Bw(4.5, 5, 10).out, 'hvl-short-ssd');
  assert.equal(tg61Bw(4.5, 8, 10).out, 'hvl-short-ssd', 'между 7 и 10 см нужна строка 7 см');
  assert.ok(Number.isFinite(tg61Bw(4.5, 10, 10).value), 'ровно 10 см — строка (b)');
  assert.equal(tg61Bw(1.0, 120, 10).out, 'ssd');
  assert.equal(tg61Bw(1.0, 30, 25).out, 'd');
  assert.equal(tg61Bw(1.0, 30, 0.5).out, 'd');
  assert.equal(tg61Bw(0.03, 30, 10).out, 'hvl');
});

test('TG-61, табл. VII–IX: узлы по источнику, интерполяция, камеры вкладки, чехол', () => {
  assert.equal(TG61_T7.hvl.length, TG61_T7.muen.length);
  assert.equal(tg61MuenWater(0.1).value, 1.026);
  assert.equal(tg61MuenWater(1).value, 1.06);
  assert.equal(tg61MuenWater(5).value, 1.105);
  near(tg61MuenWater(lnMid(1, 1.5)).value, (1.06 + 1.072) / 2, 1e-12);
  assert.equal(tg61MuenWater(6).out, 'hvl');

  for (const col of Object.values(TG61_T8.pq)) assert.equal(col.length, TG61_T8.hvl.length);
  assert.equal(tg61PQcham('NE2571', 1.5).value, 1.019);
  assert.equal(tg61PQcham('EXR-A12', 0.1).value, 1.002);
  assert.equal(tg61PQcham('N30001', 4.0).value, 1.006);
  assert.equal(tg61PQcham('NE2581', 0.6).value, 1.037);
  assert.equal(tg61PQcham('PTW30013', 1).out, 'chamber', 'PTW 30013 в табл. VIII нет');
  assert.equal(tg61PQcham('NE2571', 4.5).out, 'hvl');

  for (const m of ['pmma', 'polystyrene', 'nylon']) {
    assert.equal(TG61_T9[m].length, TG61_T9.hvl.length);
    TG61_T9[m].forEach((r) => assert.equal(r.length, TG61_T9.t.length));
  }
  assert.equal(tg61Psheath('pmma', 1, 0.5).value, 0.998);
  assert.equal(tg61Psheath('polystyrene', 3, 0.1).value, 0.972);
  assert.equal(tg61Psheath('nylon', 2, 0.3).value, 0.991);
  near(tg61Psheath('polystyrene', 1.5, 0.1).value, (0.99 + 0.981) / 2, 1e-12, 'середина по толщине');
  assert.equal(tg61Psheath('none', NaN, 0.5).value, 1);
  assert.equal(tg61Psheath('pmma', 4, 0.5).out, 't');
  assert.equal(tg61Psheath('pmma', 1, 0.05).out, 'hvl');
});

test('Низкие энергии, N_K: TG-61 ур. (3) — отношение доз = [μen/ρ] и B_w TG-61 к данным Andreo; P_stem,air сокращается', () => {
  setLang('ru');
  const r = computeKv(LOW_NK);
  assert.ok(r.trs.ok);
  const c = r.compare;
  assert.equal(c.kind, 'tg61-air');
  assert.ok(c.available);
  const ph = r.trs.phys;
  const expected = (tg61MuenAir(1.0).value / ph.muen) * (tg61Bw(1.0, 30, 5).value / ph.bw);
  near(c.ratio, expected, 1e-12);
  near(c.diffPct, (expected - 1) * 100, 1e-9);
  assert.deepEqual(c.rows.map((x) => x.sym), ['[μen/ρ]w,air', 'B_w', 'P_stem,air']);
  assert.equal(c.rows[1].cmp, 1.13);
  // поправка N_K на поле входит в обе формулы одинаково
  const r2 = computeKv({ ...LOW_NK, kv_nk_fs: '1,02' });
  near(r2.compare.ratio, c.ratio, 1e-12);
  assert.equal(r2.compare.rows[2].cmp, 1.02);
  // сравнение не меняет итог
  assert.equal(computeKv({ ...LOW_NK, kv_tg61_sleeve: 'nylon', kv_tg61_pq: '1,1' }).trs.D, r.trs.D);
  // ниже 40 кВ — пометка о рамках TG-61; при РИП < 10 см и СПО > 4 мм Al — не посчитано
  assert.ok(computeKv({ ...LOW_NK, kv_kv: '30', kv_hvl: '0,36' }).compare.notes.some((n) => /40–300 кВ/.test(n)));
  const out = computeKv({ ...LOW_NK, kv_kv: '100', kv_hvl: '4,5', kv_ssd: '5' }).compare;
  assert.equal(out.available, false);
  assert.match(out.reason, /до 4 мм Al/);
});

test('Средние энергии, N_K: TG-61 ур. (4) — [μen/ρ] табл. VII, P_Q,cham·P_sheath против p_ch; без P_Q,cham — не посчитано', () => {
  setLang('ru');
  const r = computeKv(MED_NK);
  const c = r.compare;
  assert.equal(c.kind, 'tg61-phantom');
  assert.ok(c.available);
  const ph = r.trs.phys;
  near(c.ratio, (1.06 / ph.muen) * ((1.023 * 0.999) / ph.pch), 1e-12);
  assert.deepEqual(c.rows.map((x) => x.cmp), [1.06, 1.023, 0.999]);
  // водостойкая камера без чехла
  near(computeKv({ ...MED_NK, kv_tg61_sleeve: 'none' }).compare.ratio, (1.06 / ph.muen) * (1.023 / ph.pch), 1e-12);
  // толщина вне табл. IX — не посчитано, поле подсвечено, итог есть
  const bad = computeKv({ ...MED_NK, kv_tg61_sleeve_t: '5' });
  assert.equal(bad.compare.available, false);
  assert.equal(bad.flags.kv_tg61_sleeve_t, 'warn');
  assert.ok(bad.trs.ok && !bad.trs.blocked);
  // PTW 30013 нет в табл. VIII: нужен P_Q,cham из литературы
  const p = computeKv({ ...MED_NK, kv_ch_model: 'PTW30013', kv_tg61_sleeve: 'none' });
  assert.equal(p.compare.available, false);
  assert.match(p.compare.reason, /PTW 30013 нет в табл\. VIII/);
  const pq = computeKv({ ...MED_NK, kv_ch_model: 'PTW30013', kv_tg61_sleeve: 'none', kv_tg61_pq: '1,020' });
  near(pq.compare.ratio, (1.06 / pq.trs.phys.muen) * (1.02 / pq.trs.phys.pch), 1e-12);
  assert.equal(computeKv({ ...MED_NK, kv_ch_model: 'PTW30013', kv_tg61_pq: '2' }).flags.kv_tg61_pq, 'warn');
  // ниже 100 кВ — пометка; поле далеко от 10×10 см² — пометка о рис. 3–4
  assert.ok(computeKv({ ...MED_NK, kv_kv: '90', kv_hvl: '0,15', kv_cq_hvl: ['0,1', '0,2', '0,5'] }).compare.notes.some((n) => /100–300 кВ/.test(n)));
  assert.ok(computeKv({ ...MED_NK, kv_cone: '5' }).compare.notes.some((n) => /рис\. 3 и 4/.test(n)));
});

test('N_D,w: строка DIN 6809-4 / SSRMP No 9 = итог / k_g; при поле как в лаборатории и при k_g = 1 — совпадает', () => {
  setLang('ru');
  const r = computeKv(SAMPLE_KV);
  const c = r.compare;
  assert.equal(c.kind, 'din');
  assert.equal(c.short, 'DIN / SSRMP');
  near(c.ratio, 1 / r.trs.kg.value, 1e-12);
  assert.equal(c.rows[0].cmp, 1);
  const same = computeKv({ ...SAMPLE_KV, kv_ssd: '100' });
  assert.equal(same.compare.ratio, 1);
  assert.ok(same.compare.notes.some((n) => /как в лаборатории/.test(n)));
  const one = computeKv({ ...SAMPLE_KV, kv_kg_src: 'one' });
  assert.equal(one.compare.ratio, 1);
  const co = computeKv({ ...SAMPLE_KV, kv_qo: 'co60' });
  assert.equal(co.compare.short, 'DIN 6809-4');
  // низкие энергии, поле больше 5 см: SSRMP рекомендует факторы выхода
  const low = computeKv({
    ...SAMPLE_KV, kv_range: 'low', kv_kv: '50', kv_hvl: '1,0', kv_cone: '8', kv_ssd: '30', kv_ch_model: 'PTW23342', kv_foil: true,
    kv_cert_form: 'k', kv_n: '1,250', kv_cq_kv: ['30', '50', '70'], kv_cq_hvl: ['0,36', '1,0', '2,9'], kv_cq_val: ['1,000', '1,012', '1,025'],
    kv_lab_f: '3', kv_lab_ssd: '30', kv_pdd2: '', kv_ref: '',
  });
  near(low.compare.ratio, 1 / low.trs.kg.value, 1e-12);
  assert.ok(low.compare.notes.some((n) => /факторы выхода/.test(n)));
  // по-английски — без кириллицы
  setLang('en');
  for (const x of [computeKv(SAMPLE_KV), computeKv(LOW_NK), computeKv(MED_NK), computeKv({ ...MED_NK, kv_ch_model: 'PTW30013' })]) {
    const text = [x.compare.title, x.compare.reason ?? '', ...x.compare.notes, ...x.compare.rows.flatMap((y) => [y.label, y.cmpSrc, y.rev1Src])].join(' ');
    assert.doesNotMatch(text, /[А-Яа-яЁё]/, text);
  }
  setLang('ru');
});
