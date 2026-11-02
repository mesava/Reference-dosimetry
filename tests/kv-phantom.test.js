// kV-рентген: прямоугольные тубусы (круг той же площади) и материал фантома с проверкой по источникам:
// TRS-398 Rev.1 (разд. 4.2.3, 8.2.2, табл. 27, 31), TG-61 (разд. IV.A), SSRMP No 9 (разд. 2.3, 5.7.1.2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeKv, equivalentDiameter, normalizeKv, KV_DEFAULTS } from '../src/core/kv.js';
import { KV_PHANTOMS, resolveKvPhantom, kvPhantomStatus } from '../src/core/kv-tables.js';
import { SAMPLE_KV } from '../src/core/sample-kv.js';
import { setLang } from '../src/core/i18n.js';

// Низкие энергии, N_D,w: PTW 23342 на поверхности фантома, поле и РИП как в лаборатории.
const LOW = {
  ...KV_DEFAULTS,
  kv_range: 'low', kv_kv: '50', kv_hvl: '1,0', kv_cone: '3', kv_ssd: '30',
  kv_ch_model: 'PTW23342', kv_foil: true, kv_cal: 'ndw', kv_cert_form: 'kq', kv_n: '1,250',
  kv_cq_kv: ['30', '50', '70'], kv_cq_hvl: ['0,36', '1,0', '2,9'], kv_cq_val: ['1,000', '1,012', '1,025'],
  kv_lab_f: '3', kv_lab_ssd: '30', kv_env_T: '21', kv_env_P: '100', kv_set_unit: 'min', kv_set: '1',
  kv_timer_mode: 'manual', kv_tau: '0', kv_M1: ['2,000', '2,001', '1,999'], kv_Mopp: ['-2,001', '-2,002', '-2,000'],
  kv_phantom: 'pmma', kv_lab_phantom: 'pmma',
};
// Средние энергии, N_K: PTW 30013 на 2 см.
const MED = {
  ...LOW, kv_range: 'medium', kv_kv: '200', kv_hvl: '1,0', kv_cone: '10', kv_ssd: '50', kv_ch_model: 'PTW30013', kv_foil: false,
  kv_cal: 'nk', kv_n: '0,045', kv_cq_kv: ['150', '200', '250'], kv_cq_hvl: ['0,5', '1', '2'], kv_cq_val: ['0,995', '1,000', '1,010'],
  kv_lab_f: '', kv_lab_ssd: '', kv_phantom: 'water', kv_lab_phantom: '',
};
const cond = (r, id) => r.compliance.conditions.find((c) => c.id === id);
const errors = (r) => r.messages.filter((m) => m.level === 'error').map((m) => m.text);

test('Прямоугольный тубус: круг той же площади d = 2√(ab/π); вытянутое больше чем вдвое — предупреждение', () => {
  assert.ok(Math.abs(equivalentDiameter('rect', 8, 10) - 2 * Math.sqrt(80 / Math.PI)) < 1e-12);
  assert.ok(Math.abs(equivalentDiameter('rect', 6, 6) - equivalentDiameter('square', 6)) < 1e-12);
  const r = computeKv({ ...MED, kv_cone_shape: 'rect', kv_cone: '8', kv_cone_b: '10' });
  assert.deepEqual(errors(r), []);
  assert.ok(Math.abs(r.inputs.fClin - 10.0925) < 1e-4);
  assert.equal(r.inputs.coneB, 10);
  assert.ok(r.messages.some((m) => m.level === 'info' && /Прямоугольное поле 8 × 10 см заменено кругом равной площади диаметром 10,09 см/.test(m.text)));
  assert.ok(!r.messages.some((m) => /вытянуто/.test(m.text)));
  const long = computeKv({ ...MED, kv_cone_shape: 'rect', kv_cone: '4', kv_cone_b: '15' });
  assert.ok(long.messages.some((m) => m.level === 'warn' && /4 × 15 см вытянуто больше чем вдвое/.test(m.text)));
  assert.equal(long.flags.kv_cone_b, 'warn');
  // вторая сторона обязательна
  const noB = computeKv({ ...MED, kv_cone_shape: 'rect', kv_cone: '8' });
  assert.ok(errors(noB).some((t) => /Сторона b тубуса/.test(t)));
  assert.equal(noB.flags.kv_cone_b, 'error');
  // у круглого и квадратного тубуса вторая сторона не читается
  assert.deepEqual(errors(computeKv({ ...MED, kv_cone_shape: 'square', kv_cone_b: 'x' })), []);
  // неизвестная форма — круг
  assert.equal(normalizeKv({ kv_cone_shape: 'oval' }).kv_cone_shape, 'circle');
});

test('Средние энергии: поле 10 × 10 см, Ø 10 см и сопоставимый тубус — по табл. 31; прямоугольный «самый большой» — нет', () => {
  const field = (o) => cond(computeKv({ ...MED, ...o }), 'kvMedField');
  assert.equal(field({ kv_cone_shape: 'circle', kv_cone: '10' }).state, 'met');
  // 10 × 10 см прямо названо в табл. 31 (прежде круг той же площади 11,3 см считался «не 10 см»)
  assert.equal(field({ kv_cone_shape: 'square', kv_cone: '10' }).state, 'met');
  assert.equal(field({ kv_cone_shape: 'rect', kv_cone: '8', kv_cone_b: '10' }).state, 'met');
  const small = field({ kv_cone_shape: 'square', kv_cone: '6' });
  assert.equal(small.state, 'notmet');
  assert.match(small.reason, /поле 6 × 6 см вместо 10 × 10 см или Ø 10 см/);
  assert.equal(field({ kv_cone_shape: 'square', kv_cone: '6', kv_cone_largest: true }).state, 'met');
  const rectLargest = field({ kv_cone_shape: 'rect', kv_cone: '4', kv_cone_b: '6', kv_cone_largest: true });
  assert.equal(rectLargest.state, 'notmet');
  assert.match(rectLargest.reason, /самый большой тубус аппарата прямоугольный \(4 × 6 см\)/);
  assert.equal(field({ kv_cone_shape: 'circle', kv_cone: '15' }).state, 'notmet');
});

test('Низкие энергии, N_K: стандартное поле — Ø 10 см или 10 × 10 см (разд. 8.4.1)', () => {
  const NK = { ...LOW, kv_cal: 'nk', kv_n: '0,045', kv_cq_val: ['1,000', '1,000', '1,000'], kv_cone: '10', kv_lab_f: '', kv_lab_ssd: '', kv_phantom: '' };
  const field = (o) => cond(computeKv({ ...NK, ...o }), 'kvLowNkField');
  assert.equal(field({}).state, 'met');
  assert.equal(field({ kv_cone_shape: 'square', kv_cone: '10' }).state, 'met');
  assert.equal(field({ kv_cone_shape: 'rect', kv_cone: '10', kv_cone_b: '10' }).state, 'met');
  const sq = field({ kv_cone_shape: 'square', kv_cone: '8' });
  assert.equal(sq.state, 'notmet');
  assert.match(sq.reason, /поле 8 × 8 см без поправки N_K/);
  assert.match(field({ kv_cone: '8' }).reason, /поле Ø 8 см без поправки N_K/);
  // камера в свободном воздухе — условий фантома нет
  const r = computeKv({ ...NK, kv_phantom: 'rw3' });
  assert.equal(r.phantom.clin, null);
  for (const id of ['kvLowPhantom', 'kvLowPhantomLab', 'kvMedPhantom']) assert.equal(cond(r, id).state, 'na', id);
  assert.equal(r.flags.kv_phantom, undefined);
});

test('Список материалов: у каждого есть оценка по источникам для низких, средних энергий и PDD', () => {
  assert.deepEqual(KV_PHANTOMS.map((p) => p.id), ['water', 'pmma', 'pwdt', 'sw457', 'vw', 'a150', 'rw3', 'pw', 'ps']);
  for (const p of [...KV_PHANTOMS.map((x) => resolveKvPhantom(x.id)), resolveKvPhantom('custom', 'X')]) {
    for (const use of ['low', 'medium', 'pdd']) {
      const s = kvPhantomStatus(p, use);
      assert.ok(['ok', 'warn', 'no', 'unknown'].includes(s.state), `${p.id} ${use}`);
      assert.match(s.text, /TRS-398 Rev\.1|TG-61|SSRMP No 9|опорная среда/, `${p.id} ${use}: есть источник`);
    }
  }
  // средние энергии — только вода
  assert.deepEqual(KV_PHANTOMS.filter((p) => kvPhantomStatus(resolveKvPhantom(p.id), 'medium').state === 'ok').map((p) => p.id), ['water']);
  // PDD: SSRMP No 9, разд. 5.7.1.2
  const pdd = (state) => KV_PHANTOMS.filter((p) => kvPhantomStatus(resolveKvPhantom(p.id), 'pdd').state === state).map((p) => p.id);
  assert.deepEqual(pdd('ok'), ['water', 'pwdt', 'sw457', 'vw', 'a150']);
  assert.deepEqual(pdd('warn'), ['pmma', 'rw3', 'pw', 'ps']);
  // низкие энергии: ПММА и водоэквивалентные пластики (табл. 27), полистирол — нет
  assert.equal(kvPhantomStatus(resolveKvPhantom('ps'), 'low').state, 'no');
  assert.equal(kvPhantomStatus(resolveKvPhantom('custom'), 'low').state, 'unknown');
  assert.equal(resolveKvPhantom(''), null);
  assert.equal(normalizeKv({ kv_phantom: 'wood', kv_lab_phantom: 'rw3', kv_pdd_phantom: 'custom' }).kv_phantom, '');
  assert.equal(normalizeKv({ kv_lab_phantom: 'rw3' }).kv_lab_phantom, 'rw3');
});

test('Низкие энергии, N_D,w: фантом — ПММА или водоэквивалентный пластик и тот же, что при калибровке', () => {
  const r = computeKv(LOW);
  assert.deepEqual(errors(r), []);
  assert.equal(cond(r, 'kvLowPhantom').state, 'met');
  assert.equal(cond(r, 'kvLowPhantomLab').state, 'met');
  assert.equal(cond(r, 'kvMedPhantom').state, 'na');
  assert.equal(r.compliance.status, 'standard');
  // RW3 при калибровке на ПММА: другое обратное рассеяние — нестандартные условия
  const rw3 = computeKv({ ...LOW, kv_phantom: 'rw3' });
  assert.equal(cond(rw3, 'kvLowPhantom').state, 'met');
  const lab = cond(rw3, 'kvLowPhantomLab');
  assert.equal(lab.state, 'notmet');
  assert.match(lab.reason, /фантом — RW3 \(PTW\), а камера калибровалась на фантоме ПММА \(оргстекло\)/);
  assert.equal(rw3.compliance.status, 'nonstandard');
  assert.ok(rw3.messages.some((m) => m.level === 'warn' && /не тот, на котором камера калибровалась/.test(m.text)));
  assert.equal(rw3.flags.kv_lab_phantom, 'warn');
  // доза от материала не зависит: он в расчёт не входит
  assert.equal(rw3.trs.perUnit, r.trs.perUnit);
  // полистирол — не по табл. 27
  const ps = computeKv({ ...LOW, kv_phantom: 'ps', kv_lab_phantom: 'ps' });
  assert.equal(cond(ps, 'kvLowPhantom').state, 'notmet');
  assert.equal(cond(ps, 'kvLowPhantomLab').state, 'met');
  assert.equal(ps.flags.kv_phantom, 'warn');
  // свой материал: водоэквивалентность — «не проверено»; тот же свой у лаборатории — совпадает
  const own = computeKv({ ...LOW, kv_phantom: 'custom', kv_lab_phantom: 'custom', kv_ph_name: 'Пластик X (фирма Y)', kv_ph_rho: '1,04' });
  assert.equal(cond(own, 'kvLowPhantom').state, 'unknown');
  assert.match(cond(own, 'kvLowPhantom').reason, /свой материал «Пластик X \(фирма Y\)»: водоэквивалентность проверьте/);
  assert.equal(cond(own, 'kvLowPhantomLab').state, 'met');
  assert.equal(own.compliance.status, 'standard');
  assert.equal(own.phantom.customUsed, true);
  assert.equal(own.flags.kv_ph_name, undefined);
  // не указан — «не проверено»
  const none = computeKv({ ...LOW, kv_phantom: '', kv_lab_phantom: '' });
  assert.deepEqual(none.compliance.unchecked.map((x) => x.text), ['не указан материал фантома', 'не указан материал фантома']);
  assert.match(cond(computeKv({ ...LOW, kv_lab_phantom: '' }), 'kvLowPhantomLab').reason, /не указан фантом, на котором калибровалась камера/);
});

test('Низкие энергии: k_g табл. 28 относится к фантому из ПММА — для другого материала замечание', () => {
  const big = { ...LOW, kv_cone: '10' };
  assert.ok(!computeKv(big).messages.some((m) => /определён для фантома из ПММА/.test(m.text)));
  const r = computeKv({ ...big, kv_phantom: 'water', kv_lab_phantom: 'water' });
  assert.equal(r.trs.kg.source, 'table');
  assert.ok(r.messages.some((m) => m.level === 'info' && /k_g в ур\. \(52\) определён для фантома из ПММА, а фантом — вода: применимость табл\. 28–29/.test(m.text)));
});

test('Средние энергии: только вода (табл. 31; TG-61, разд. IV.A); пластик — нестандартные условия', () => {
  const r = computeKv(MED);
  assert.equal(cond(r, 'kvMedPhantom').state, 'met');
  assert.equal(cond(r, 'kvLowPhantom').state, 'na');
  assert.equal(r.compliance.status, 'standard');
  for (const id of ['pmma', 'rw3', 'pwdt', 'custom']) {
    const x = computeKv({ ...MED, kv_phantom: id, kv_ph_name: 'Z' });
    assert.equal(cond(x, 'kvMedPhantom').state, 'notmet', id);
    assert.equal(x.compliance.status, 'nonstandard', id);
    assert.equal(x.flags.kv_phantom, 'warn', id);
    assert.ok(x.messages.some((m) => /референсная доза определяется только в воде/.test(m.text)), id);
  }
  // то же для N_D,w и Qo = ⁶⁰Co (DIN 6809-4)
  const ndw = computeKv({ ...MED, kv_cal: 'ndw', kv_qo: 'co60', kv_cert_form: 'co', kv_n: '0,05389', kv_phantom: 'rw3' });
  assert.equal(cond(ndw, 'kvMedPhantom').state, 'notmet');
  // не указан — «не проверено»
  assert.equal(cond(computeKv({ ...MED, kv_phantom: '' }), 'kvMedPhantom').state, 'unknown');
});

test('PDD(2 см): фантом по SSRMP No 9, разд. 5.7.1.2; свой материал — название и плотность', () => {
  const pdd = (o) => computeKv({ ...MED, kv_pdd2: '88', ...o });
  const msg = (r) => r.messages.filter((m) => m.scope === 'depth').map((m) => `${m.level}: ${m.text}`);
  assert.deepEqual(msg(pdd({ kv_pdd_phantom: 'water' })), []);
  assert.deepEqual(msg(pdd({ kv_pdd_phantom: 'sw457' })), []);
  assert.deepEqual(msg(pdd({ kv_pdd_phantom: '' })), []);
  const rw3 = pdd({ kv_pdd_phantom: 'rw3' });
  assert.equal(rw3.flags.kv_pdd_phantom, 'warn');
  assert.match(msg(rw3).join(), /^warn: PDD\(2 см\) снята в фантоме: RW3 \(PTW\); SSRMP No 9 не рекомендует/);
  // PDD на итог на глубине 2 см не влияет, условие референсных условий не меняется
  assert.equal(rw3.compliance.status, 'standard');
  const own = pdd({ kv_pdd_phantom: 'custom' });
  assert.equal(own.flags.kv_pdd_phantom, 'info');
  assert.equal(own.phantom.customUsed, true);
  assert.equal(own.flags.kv_ph_name, 'warn');
  assert.equal(pdd({ kv_pdd_phantom: 'custom', kv_ph_name: 'X', kv_ph_rho: '12' }).flags.kv_ph_rho, 'warn');
  assert.equal(pdd({ kv_pdd_phantom: 'custom', kv_ph_name: 'X', kv_ph_rho: '1,05' }).flags.kv_ph_rho, undefined);
  // без PDD фантом PDD не проверяется
  assert.equal(computeKv({ ...MED, kv_pdd_phantom: 'rw3' }).flags.kv_pdd_phantom, undefined);
});

test('Демо-набор: вода, все условия kV проверены и выполнены', () => {
  const r = computeKv(SAMPLE_KV);
  assert.equal(r.compliance.status, 'standard');
  assert.deepEqual(r.compliance.unchecked, []);
  assert.equal(cond(r, 'kvMedPhantom').state, 'met');
});

test('По-английски: замечания, условия и оценки материалов без кириллицы', () => {
  setLang('en');
  try {
    const runs = [
      computeKv({ ...LOW, kv_phantom: 'rw3', kv_cone: '10' }),
      computeKv({ ...LOW, kv_phantom: 'ps', kv_lab_phantom: '' }),
      computeKv({ ...LOW, kv_phantom: 'custom', kv_lab_phantom: 'pmma' }),
      computeKv({ ...MED, kv_phantom: 'pw', kv_pdd2: '88', kv_pdd_phantom: 'custom', kv_ph_rho: '9', kv_cone_shape: 'rect', kv_cone: '4', kv_cone_b: '15', kv_cone_largest: true }),
    ];
    const texts = runs.flatMap((r) => [...r.messages.map((m) => m.text), ...r.compliance.conditions.flatMap((c) => [c.label, c.reason ?? ''])]);
    for (const p of [...KV_PHANTOMS.map((x) => resolveKvPhantom(x.id)), resolveKvPhantom('custom')]) {
      texts.push(p.name, ...['low', 'medium', 'pdd'].map((u) => kvPhantomStatus(p, u).text));
    }
    for (const s of texts) assert.ok(!/[А-Яа-яЁё]/.test(s), s);
  } finally {
    setLang('ru');
  }
});
