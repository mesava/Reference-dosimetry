// Статус соответствия референсным условиям строится из перечня условий (src/core/conditions.js), а не из замечаний.
// Для каждого условия каждого модуля — ввод, при котором оно нарушено; добавленное условие без такого теста
// роняет проверку полноты.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePhotons } from '../src/core/photons.js';
import { computeElectrons } from '../src/core/electrons.js';
import { computeCobalt } from '../src/core/cobalt.js';
import { SAMPLE_FORM } from '../src/core/sample.js';
import { SAMPLE_ELECTRONS } from '../src/core/sample-electrons.js';
import { SAMPLE_COBALT } from '../src/core/sample-cobalt.js';
import { PHOTON_CONDITIONS, ELECTRON_CONDITIONS, COBALT_CONDITIONS, evaluateConditions } from '../src/core/conditions.js';

const opp = (cells, factor) => cells.map((x) => '-' + (Math.abs(parseFloat(String(x).replace(',', '.'))) * factor).toFixed(4).replace('.', ','));
const state = (r, id) => r.compliance.conditions.find((c) => c.id === id)?.state;

/** [модуль, расчёт, перечень условий, { id: [протокол, изменения формы] }] */
const CASES = [
  [
    'фотоны',
    (f) => computePhotons({ ...SAMPLE_FORM, ...f }),
    PHOTON_CONDITIONS,
    {
      ssd: ['trs', { setup_geometry: 'manual', setup_ssd: '90', setup_field: '10', setup_depth: '10' }],
      field: ['tg51', { setup_geometry: 'manual', setup_ssd: '100', setup_field: '12', setup_depth: '10' }],
      depth: ['trs', { setup_geometry: 'manual', setup_ssd: '100', setup_field: '10', setup_depth: '5' }],
      fffEnergy: ['trs', { meta_fff: true, meta_energy: '15' }],
      fffFoil: ['tg51', { meta_fff: true, meta_energy: '6', q51_method: 'open', prof_mode: 'manual', prof_value: '1,002' }],
      fffOnlyChamber: ['trs', { ch_model: 'PTW31010', meta_fff: false }],
      leakage: ['trs', { rd_kleak: '1,003' }],
      polarity: ['tg51', { rd_Mopp: opp(SAMPLE_FORM.rd_M1, 1.012) }],
      kQ: ['trs', { ch_model: 'CUSTOM', cc_model: 'X', cc_analog: 'PTW30013', kqtrs_mode: 'formula' }],
    },
  ],
  [
    'электроны',
    (f) => computeElectrons({ ...SAMPLE_ELECTRONS, ...f }),
    ELECTRON_CONDITIONS,
    {
      ssd: ['trs', { e_ssd: '105' }],
      ssd385: ['tg51', { e_ssd: '115' }],
      field: ['trs', { e_field: '8' }],
      r50range: ['tg51', { e_r50_method: 'r50', e_r50: '9,2', e_kq51_mode: 'manual', e_kq51_manual: '0,9' }],
      chamber385: ['tg51', { e_ch_model: 'OTHER', e_kq51_mode: 'manual', e_kq51_manual: '0,9', e_kqtrs_mode: 'manual', e_kqtrs_manual: '0,9' }],
      kQtrs: ['trs', { e_ch_model: 'MARKUS', e_cal_route: 'co60', e_kqtrs_mode: 'r385' }],
      leakage: ['tg51', { e_kleak: '1,003' }],
      polarity: ['trs', { e_Mopp: opp(SAMPLE_ELECTRONS.e_M1, 1.05) }],
    },
  ],
  [
    '⁶⁰Co',
    (f) => computeCobalt({ ...SAMPLE_COBALT, ...f }),
    COBALT_CONDITIONS,
    {
      distance: ['trs', { co_distance: '90' }],
      zref: ['tg51', { co_zref: '5' }],
      refclass: ['trs', { co_ch_model: 'PTW31010' }],
      leakage: ['trs', { co_kleak: '1,003' }],
      polarity: ['trs', { co_Mopp: opp(SAMPLE_COBALT.co_M1, 1.012) }],
    },
  ],
];

test('Условия протокола: у каждого условия есть ввод, при котором оно нарушено, — итог есть, статус «нестандартные условия»', () => {
  for (const [name, run, spec, cases] of CASES) {
    assert.deepEqual(Object.keys(cases).sort(), [...new Set(spec.map((c) => c.id))].sort(), `${name}: для каждого условия нужен тест`);
    for (const [id, [protocol, change]] of Object.entries(cases)) {
      const r = run({ protocol, ...change });
      assert.equal(r.compliance.status, 'nonstandard', `${name}, ${id}: ${r.messages.filter((m) => m.level === 'error').map((m) => m.text).join(' | ')}`);
      assert.equal(state(r, id), 'notmet', `${name}, ${id}`);
      const c = r.compliance.conditions.find((x) => x.id === id);
      assert.ok(r.compliance.reasons.some((x) => x.text === c.reason), `${name}, ${id}: причина в списке`);
      assert.ok(c.ref, `${name}, ${id}: есть ссылка на протокол`);
    }
  }
});

test('Условия протокола: демо-наборы — все применимые условия проверены и выполнены', () => {
  for (const [name, run] of CASES) {
    for (const protocol of ['trs', 'tg51']) {
      const r = run({ protocol, ...(name === '⁶⁰Co' ? { co_zref: '10' } : {}) });
      assert.equal(r.compliance.status, 'standard', `${name}, ${protocol}`);
      assert.deepEqual(r.compliance.unchecked, [], `${name}, ${protocol}`);
      assert.ok(r.compliance.conditions.every((c) => c.state === 'met' || c.state === 'na'), `${name}, ${protocol}`);
      // условия только своего протокола
      assert.ok(r.compliance.conditions.every((c) => c.scope === 'common' || c.scope === protocol), `${name}, ${protocol}`);
    }
  }
});

test('Условия протокола: без нужного значения условие «не проверено», а не «выполнено»', () => {
  for (const spec of [PHOTON_CONDITIONS, ELECTRON_CONDITIONS, COBALT_CONDITIONS]) {
    for (const scope of ['trs', 'tg51']) {
      const all = evaluateConditions(spec, {}, scope);
      assert.ok(all.length > 0);
      for (const c of all) assert.notEqual(c.state, 'met', `${c.id}: пустые данные не дают «выполнено»`);
      for (const c of all.filter((x) => x.state === 'unknown')) assert.ok(c.reason, `${c.id}: есть текст «не проверено»`);
    }
  }
});

test('Пучок БВФ без номинальной энергии по TRS-398: доза считается, условие энергии — «не проверено»', () => {
  const r = computePhotons({ ...SAMPLE_FORM, protocol: 'trs', meta_fff: true, meta_energy: '', meta_beam: 'БВФ' });
  assert.equal(r.compliance.status, 'standard');
  assert.equal(state(r, 'fffEnergy'), 'unknown');
  assert.match(r.compliance.unchecked.map((x) => x.text).join(), /энерги/);
});

test('Своя геометрия фотонов: любые РИП, поле и глубина допустимы — доза считается, статус «нестандартные условия» с причинами', () => {
  const r = computePhotons({ ...SAMPLE_FORM, protocol: 'trs', setup_geometry: 'manual', setup_ssd: '90', setup_field: '15', setup_depth: '5' });
  assert.ok(Number.isFinite(r.trs.DperMU), 'доза посчитана');
  assert.equal(r.compliance.status, 'nonstandard');
  assert.deepEqual(r.compliance.conditions.filter((c) => c.state === 'notmet').map((c) => c.id).sort(), ['depth', 'field', 'ssd']);
  // по TG-51 клиническое РИП допускается: остаются поле и глубина
  const t = computePhotons({ ...SAMPLE_FORM, protocol: 'tg51', setup_geometry: 'manual', setup_ssd: '90', setup_field: '15', setup_depth: '5' });
  assert.deepEqual(t.compliance.conditions.filter((c) => c.state === 'notmet').map((c) => c.id).sort(), ['depth', 'field']);
  // установка по РИО — референсная (РИК 100 см)
  assert.equal(state(computePhotons({ ...SAMPLE_FORM, protocol: 'trs', setup_geometry: 'SAD' }), 'ssd'), 'met');
});

test('Проверка выхода с k_pol из калибровки: условие полярности к ней не относится', () => {
  const r = computePhotons({ ...SAMPLE_FORM, rd_fixed: true, rd_fixed_kpol: '1,01', rd_fixed_ks: '1,002' });
  assert.equal(state(r, 'polarity'), 'na');
});
