// Качество пучка прошлой калибровки во вкладке «МВ фотоны» (справочно) и TPR20,10, подставленный из неё с источником.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newJournal, normalizeJournal, recordTabBeam, tabBeamPatch, lastPhotonQuality, PH_BEAM_KEYS, PH_CHAMBER_KEYS, PH_ELECTROMETER_KEYS } from '../src/core/journal.js';
import { computePhotons } from '../src/core/photons.js';
import { SAMPLE_FORM } from '../src/core/sample.js';

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));
const TODAY = '2026-11-12';
const journal = () => {
  const j = newJournal();
  j.chambers = [{ id: 'c1', form: pick(SAMPLE_FORM, PH_CHAMBER_KEYS) }];
  j.electrometers = [{ id: 'e1', form: pick(SAMPLE_FORM, PH_ELECTROMETER_KEYS) }];
  j.machines = [{ id: 'm1', name: 'Линак-1', kind: 'linac', beams: [
    { id: 'b6', kind: 'photon', name: '6 МВ', active: true, form: pick(SAMPLE_FORM, PH_BEAM_KEYS) },
    { id: 'b10', kind: 'photon', name: '10 МВ', active: true, form: pick(SAMPLE_FORM, PH_BEAM_KEYS) },
  ] }];
  return normalizeJournal(j);
};
const tab = (over = {}) => ({ ...SAMPLE_FORM, meta_date: '2026-03-12', ...over });
const rec = (j, beamId, form) => {
  const r = recordTabBeam(j, { machineId: 'm1', beamId, form, kind: 'photon', today: TODAY });
  assert.ok(!r.error, r.error);
  return r.journal;
};

test('Прошлое качество пучка: последняя калибровка по TRS-398 до даты, показания на 20 и 10 см и TPR20,10', () => {
  let j = rec(journal(), 'b6', tab());
  j = rec(j, 'b6', tab({ meta_date: '2026-05-20', qtrs_v20: '1,1000', qtrs_v10: '1,6400' }));
  const tpr = computePhotons(tab()).trs.tpr;
  const q = lastPhotonQuality(j, 'b6', { before: '2026-04-01' });
  assert.equal(q.date, '2026-03-12');
  assert.equal(q.method, SAMPLE_FORM.qtrs_method);
  assert.equal(q.v20, SAMPLE_FORM.qtrs_v20);
  assert.equal(q.v10, SAMPLE_FORM.qtrs_v10);
  assert.ok(Math.abs(q.tpr - tpr) < 1e-12);
  // позже — более новая калибровка; другой пучок — своя (её нет)
  assert.equal(lastPhotonQuality(j, 'b6').date, '2026-05-20');
  assert.equal(lastPhotonQuality(j, 'b10'), null);
  // своя запись (та же дата) не считается прошлой
  const own = j.sessions.find((s) => s.date === '2026-05-20');
  assert.equal(lastPhotonQuality(j, 'b6', { before: '2026-05-20', exceptId: own.id }).date, '2026-03-12');
});

test('Прошлое качество пучка: проверки выхода и калибровки по TG-51 не берутся', () => {
  let j = rec(journal(), 'b6', tab());
  const p = tabBeamPatch(j, 'm1', 'b6', tab({ meta_date: '2026-04-01', rd_fixed: true }));
  j = rec(j, 'b6', tab({ ...p.patch, meta_date: '2026-04-01', rd_fixed: true }));
  j = rec(j, 'b6', tab({ meta_date: '2026-05-01', protocol: 'tg51' }));
  assert.equal(lastPhotonQuality(j, 'b6').date, '2026-03-12');
});

test('TPR20,10 из прошлой калибровки: источник — в формуле качества пучка (протокол) и в записи журнала', () => {
  const src = 'из калибровки этого пучка в журнале от 12.03.2026; в день измерения не измерялся';
  const r = computePhotons(tab({ qtrs_method: 'known', qtrs_tpr: '0,6650', qtrs_tpr_src: src }));
  assert.ok(Math.abs(r.trs.tpr - 0.665) < 1e-12);
  assert.equal(r.trs.tprSource, src);
  assert.match(r.trs.tprEquation, /введён вручную — из калибровки этого пучка/);
  assert.equal(computePhotons(tab({ qtrs_method: 'known', qtrs_tpr: '0,6650' })).trs.tprEquation, 'TPR20,10 введён вручную');
  // запись с подставленным TPR20,10: следующая калибровка видит способ и источник
  const j = rec(journal(), 'b6', tab({ qtrs_method: 'known', qtrs_tpr: '0,6650', qtrs_tpr_src: src }));
  const q = lastPhotonQuality(j, 'b6');
  assert.equal(q.method, 'known');
  assert.equal(q.src, src);
  assert.equal(q.v20, '');
  // при калибровке выбор пучка очищает и источник (качество измеряют)
  assert.equal(tabBeamPatch(j, 'm1', 'b6', tab({ meta_date: '2026-06-01', qtrs_tpr_src: src })).patch.qtrs_tpr_src, '');
});
