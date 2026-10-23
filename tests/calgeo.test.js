// Геометрия калибровки дозы аппарата: одна на пучки фотонов и одна на пучки электронов, у пучка — «как у аппарата» или своя.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeJournal, newJournal, beamForm, saveBeamSettings, syncCalGeo, machineCalGeo, calGeoText, sameCalGeo, controlPoints, SESSION_DEFAULTS,
} from '../src/core/journal.js';
import { FORM_DEFAULTS } from '../src/core/photons.js';
import { E_DEFAULTS } from '../src/core/electrons.js';

const ph = (id, name, form = {}) => ({ id, kind: 'photon', name, active: true, form: { rd_mu: '100', ...form } });
const el = (id, name, form = {}) => ({ id, kind: 'electron', name, active: true, form: { e_mu: '100', ...form } });
// журнал до 0.29.0: геометрия — только в настройках пучков
const old = () => {
  const j = newJournal();
  j.machines = [{
    id: 'm1', name: 'Versa HD', kind: 'linac', beams: [
      ph('b6', '6 МВ', { setup_geometry: 'SAD', dd_on: true, dd_nominal_at: 'zref' }),
      ph('b10', '10 МВ', { setup_geometry: 'SAD', dd_on: true, dd_nominal_at: 'zref' }),
      ph('b6f', '6 МВ БВФ', { setup_geometry: 'SSD', dd_on: true, dd_nominal_at: 'dmax' }),
      el('e6', '6 МэВ', { e_ssd: '100', e_dd_on: true, e_nominal_at: 'zmax' }),
    ],
  }];
  return j;
};

test('Журнал до 0.29.0: геометрия большинства пучков — у аппарата, у остальных своя; настройки пучков не меняются', () => {
  const j = normalizeJournal(old());
  const m = j.machines[0];
  assert.equal(machineCalGeo(m, 'photon').setup_geometry, 'SAD');
  assert.equal(machineCalGeo(m, 'photon').dd_nominal_at, 'zref');
  assert.deepEqual(m.beams.map((b) => [b.id, b.geoOwn]), [['b6', false], ['b10', false], ['b6f', true], ['e6', false]]);
  assert.equal(m.beams.find((b) => b.id === 'b6f').form.setup_geometry, 'SSD');
  // электроны: РИП 100 см, номинал на z_max — как у единственного пучка (и как по умолчанию)
  assert.deepEqual(machineCalGeo(m, 'electron'), { e_ssd: '100', e_dd_on: true, e_nominal_at: 'zmax' });
  // аппарат без пучков — геометрия по умолчанию (РИП 100 см, номинал на d_max)
  const empty = normalizeJournal({ ...newJournal(), machines: [{ id: 'm2', beams: [] }] }).machines[0];
  assert.equal(calGeoText('photon', machineCalGeo(empty, 'photon')), 'РИП 100 см, номинал на d_max');
  assert.equal(machineCalGeo(empty, 'photon').setup_geometry, FORM_DEFAULTS.setup_geometry);
  assert.equal(machineCalGeo(empty, 'electron').e_nominal_at, E_DEFAULTS.e_nominal_at);
});

test('Геометрия аппарата подставляется в пучки «как у аппарата» и в форму вкладки; своя геометрия пучка не меняется', () => {
  const j = normalizeJournal(old());
  const m = j.machines[0];
  m.calGeo.photon = { ...m.calGeo.photon, setup_geometry: 'SSD', dd_nominal_at: 'dmax' };
  syncCalGeo(m);
  for (const id of ['b6', 'b10']) assert.equal(m.beams.find((b) => b.id === id).form.setup_geometry, 'SSD');
  const s = { ...SESSION_DEFAULTS, machineId: 'm1', date: '2026-10-23' };
  assert.equal(beamForm(j, s, m, m.beams[0]).form.dd_nominal_at, 'dmax');
  // своя геометрия: пучок БВФ переведён на РИО — аппарат его не трогает
  const f = m.beams.find((b) => b.id === 'b6f');
  f.form.setup_geometry = 'SAD';
  m.calGeo.photon.setup_geometry = 'SSD';
  syncCalGeo(m);
  assert.equal(f.form.setup_geometry, 'SAD');
  // снова «как у аппарата»
  f.geoOwn = false;
  syncCalGeo(m);
  assert.equal(f.form.setup_geometry, 'SSD');
  // геометрия аппарата и флаги пучков сохраняются в файле
  const again = normalizeJournal(JSON.parse(JSON.stringify(j)));
  assert.equal(machineCalGeo(again.machines[0], 'photon').setup_geometry, 'SSD');
  assert.equal(again.machines[0].beams.some((b) => b.geoOwn), false);
});

test('Сохранение настроек пучка из вкладки: другая геометрия — у пучка своя, та же — остаётся «как у аппарата»', () => {
  const j = normalizeJournal(old());
  const same = saveBeamSettings(j, 'm1', 'b6', { ...FORM_DEFAULTS, setup_geometry: 'SAD', dd_on: true, dd_nominal_at: 'zref', rd_mu: '200' }, 'photon');
  assert.equal(same.geoOwn, false);
  assert.equal(same.journal.machines[0].beams[0].geoOwn, false);
  const diff = saveBeamSettings(j, 'm1', 'b6', { ...FORM_DEFAULTS, setup_geometry: 'SSD', dd_on: true, dd_nominal_at: 'dmax' }, 'photon');
  assert.equal(diff.geoOwn, true);
  assert.equal(diff.journal.machines[0].beams[0].geoOwn, true);
  // исходный журнал не изменился
  assert.equal(j.machines[0].beams[0].geoOwn, false);
  assert.equal(j.machines[0].calGeo.photon.setup_geometry, 'SAD');
});

test('Сравнение геометрий: поля, не влияющие на установку, не различают геометрию', () => {
  // ручные РИП, поле и глубина — только при ручном вводе; точка номинала — только при пересчёте на d_max
  assert.equal(sameCalGeo('photon', { setup_geometry: 'SSD', setup_ssd: '90' }, { setup_geometry: 'SSD', setup_ssd: '100' }), true);
  assert.equal(sameCalGeo('photon', { setup_geometry: 'manual', setup_ssd: '90' }, { setup_geometry: 'manual', setup_ssd: '100' }), false);
  assert.equal(sameCalGeo('photon', { dd_on: false, dd_nominal_at: 'dmax' }, { dd_on: false, dd_nominal_at: 'zref' }), true);
  assert.equal(sameCalGeo('photon', { setup_geometry: 'SAD', dd_on: true, dd_sad: 'tmr' }, { setup_geometry: 'SAD', dd_on: true, dd_sad: 'pdd' }), false);
  assert.equal(sameCalGeo('electron', { e_ssd: '100' }, { e_ssd: '100,0' }), true);
  assert.equal(sameCalGeo('electron', { e_ssd: '100' }, { e_ssd: '105' }), false);
  assert.equal(calGeoText('photon', { setup_geometry: 'SAD', dd_on: true, dd_nominal_at: 'dmax', dd_sad: 'tmr' }), 'РИО 100 см, номинал на d_max (через TMR)');
  assert.equal(calGeoText('electron', { e_ssd: '105', e_dd_on: true, e_nominal_at: 'zref' }), 'РИП 105 см, номинал на z_ref');
});

test('Контрольная карта: смена геометрии калибровки или точки номинала начинает новый отсчёт', () => {
  const sum = (deviation, at) => ({ ok: true, deviation, value: 1, tol: 2, status: 'ok', source: 'main', preDeviation: NaN, ndw: 0.0538, kelec: 1, at });
  const sess = (id, date, at, form) => ({ id, machineId: 'm1', date, mode: 'check', beams: [{ beamId: 'b1', kind: 'photon', chamberId: 'c1', electrometerId: 'e1', summary: sum(0.2, at), form }] });
  const ssd = { setup_geometry: 'SSD', dd_on: true, dd_nominal_at: 'dmax' };
  const j = {
    machines: [{ id: 'm1', beams: [{ id: 'b1', kind: 'photon', name: '6 МВ' }] }],
    sessions: [
      sess('s1', '2026-01-10', 'dmax', ssd),
      sess('s2', '2026-02-10', 'dmax', ssd),
      sess('s3', '2026-03-10', 'zref', { ...ssd, dd_nominal_at: 'zref' }),
      sess('s4', '2026-04-10', 'zref', { ...ssd, dd_nominal_at: 'zref', setup_geometry: 'SAD' }),
      sess('s5', '2026-05-10', 'zref', { ...ssd, dd_nominal_at: 'zref', setup_geometry: 'SAD' }),
    ],
  };
  assert.deepEqual(controlPoints(j, 'm1', 'b1').map((p) => [p.sessionId, p.restart, p.reason]), [
    ['s1', false, undefined],
    ['s2', false, undefined],
    ['s3', true, 'geometry'],
    ['s4', true, 'geometry'],
    ['s5', false, undefined],
  ]);
});
