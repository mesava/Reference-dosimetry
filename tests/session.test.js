// «Сеанс»: план (аппарат, дата, режим, пучки по порядку) и ход сеанса по записям журнала.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newJournal, normalizeJournal, recordTabBeam, PH_BEAM_KEYS, PH_CHAMBER_KEYS, PH_ELECTROMETER_KEYS } from '../src/core/journal.js';
import { normalizePlan, planProgress, nextPending, sessionMachines, machineBeams, beamRecord, splitPlan, MODULE_OF } from '../src/core/session.js';
import { SAMPLE_FORM } from '../src/core/sample.js';

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));

const journal = () => {
  const j = newJournal();
  j.chambers = [{ id: 'c1', form: pick(SAMPLE_FORM, PH_CHAMBER_KEYS) }];
  j.electrometers = [{ id: 'e1', form: pick(SAMPLE_FORM, PH_ELECTROMETER_KEYS) }];
  j.machines = [
    { id: 'm1', name: 'Versa HD', serial: '7213', kind: 'linac', beams: [
      { id: 'b6', kind: 'photon', name: '6 МВ', active: true, form: pick(SAMPLE_FORM, PH_BEAM_KEYS) },
      { id: 'b6f', kind: 'photon', name: '6 МВ БВФ', active: true, form: pick(SAMPLE_FORM, PH_BEAM_KEYS) },
      { id: 'b10', kind: 'photon', name: '10 МВ', active: true, form: pick(SAMPLE_FORM, PH_BEAM_KEYS) },
      { id: 'b18', kind: 'photon', name: '18 МВ', active: false, form: {} },
      { id: 'e6', kind: 'electron', name: '6 МэВ', active: true, form: {} },
    ] },
    { id: 'm2', name: 'Пустой', kind: 'linac', beams: [] },
  ];
  return normalizeJournal(j);
};
const tab = (over = {}) => ({ ...SAMPLE_FORM, meta_date: '2026-10-22', ...over });
const plan = (over = {}) => ({ active: true, machineId: 'm1', date: '2026-10-22', mode: 'cal', beamIds: ['b10', 'b6', 'b6f'], index: 0, ...over });

test('Сеанс: аппараты и пучки — только действующие; вкладка по виду пучка', () => {
  const j = journal();
  assert.deepEqual(sessionMachines(j).map((m) => m.id), ['m1']);
  assert.deepEqual(machineBeams(j, 'm1').map((b) => b.id), ['b6', 'b6f', 'b10', 'e6']);
  assert.deepEqual(MODULE_OF, { photon: 'photons', electron: 'electrons', cobalt: 'co60' });
});

test('Сеанс: план согласуется с журналом — порядок сохраняется, лишние пучки, повторы и неверный индекс отбрасываются', () => {
  const j = journal();
  const p = normalizePlan(j, plan({ beamIds: ['b10', 'b18', 'x', 'b6', 'b10'], index: 9, mode: 'что-то' }));
  assert.deepEqual(p.beamIds, ['b10', 'b6'], 'выключенный 18 МВ, несуществующий и повтор — убраны');
  assert.equal(p.index, 1);
  assert.equal(p.mode, 'cal');
  assert.equal(p.active, true);
  // без даты, без пучков или с удалённым аппаратом сеанс не активен
  assert.equal(normalizePlan(j, plan({ date: '22.10.2026' })).active, false);
  assert.equal(normalizePlan(j, plan({ beamIds: [] })).active, false);
  assert.equal(normalizePlan(j, plan({ machineId: 'нет' })).active, false);
  assert.equal(normalizePlan(j, null).active, false);
});

test('Сеанс: ход — по записям журнала за дату и режим сеанса; следующий — первый невыполненный', () => {
  let j = journal();
  let pr = planProgress(j, plan());
  assert.equal(pr.done, 0);
  assert.equal(pr.total, 3);
  assert.equal(pr.items[0].current, true);
  assert.equal(pr.items[0].module, 'photons');
  assert.equal(nextPending(j, plan()), 1);
  // записан 10 МВ (текущий) — выполнен, с итогом записи
  j = recordTabBeam(j, { machineId: 'm1', beamId: 'b10', form: tab({ meta_beam: '10 МВ' }), kind: 'photon' }).journal;
  pr = planProgress(j, plan());
  assert.equal(pr.done, 1);
  assert.ok(pr.items[0].done && Number.isFinite(pr.items[0].summary.deviation));
  assert.equal(pr.items[0].protocol, 'trs');
  // пропуск: со второго пучка следующий невыполненный — третий, затем по кругу — снова второй
  assert.equal(nextPending(j, plan({ index: 1 })), 2);
  assert.equal(nextPending(j, plan({ index: 2 })), 1);
  // запись другой даты или режима к сеансу не относится
  const other = recordTabBeam(j, { machineId: 'm1', beamId: 'b6', form: tab({ meta_date: '2026-10-21' }), kind: 'photon' }).journal;
  assert.equal(planProgress(other, plan()).done, 1);
  const check = recordTabBeam(j, { machineId: 'm1', beamId: 'b6', form: tab({ rd_fixed: true, rd_fixed_kpol: '1,000', rd_fixed_ks: '1,002', rd_fixed_from: '19.10.2026' }), kind: 'photon' });
  assert.ok(!check.error, check.error);
  assert.equal(planProgress(check.journal, plan()).done, 1, 'проверка выхода — не калибровка сеанса');
  assert.equal(planProgress(check.journal, plan({ mode: 'check' })).done, 1, 'в сеансе проверки выхода — засчитана');
  // все записаны — сеанс выполнен, следующего нет
  for (const id of ['b6', 'b6f']) j = recordTabBeam(j, { machineId: 'm1', beamId: id, form: tab(), kind: 'photon' }).journal;
  pr = planProgress(j, plan());
  assert.equal(pr.finished, true);
  assert.equal(nextPending(j, plan()), -1);
});

test('Сеанс: пучок, записанный по обоим протоколам, — итог по TRS-398 Rev.1', () => {
  let j = journal();
  j = recordTabBeam(j, { machineId: 'm1', beamId: 'b6', form: tab({ protocol: 'tg51' }), kind: 'photon' }).journal;
  assert.equal(beamRecord(j, plan(), 'b6').session.protocol, 'tg51');
  j = recordTabBeam(j, { machineId: 'm1', beamId: 'b6', form: tab({ protocol: 'trs' }), kind: 'photon' }).journal;
  assert.equal(beamRecord(j, plan(), 'b6').session.protocol, 'trs');
});

test('Сеанс по виду пучков (0.63.0): лист вкладки — только её энергии', () => {
  const j = journal();
  assert.deepEqual(machineBeams(j, 'm1', 'photon').map((b) => b.id), ['b6', 'b6f', 'b10']);
  assert.deepEqual(machineBeams(j, 'm1', 'electron').map((b) => b.id), ['e6']);
  assert.deepEqual(sessionMachines(j, 'electron').map((m) => m.id), ['m1']);
  assert.deepEqual(sessionMachines(j, 'cobalt'), []);
  // в плане фотонов пучок электронов отбрасывается; неизвестный вид — как раньше, любые пучки
  const p = normalizePlan(j, plan({ kind: 'photon', beamIds: ['b10', 'e6', 'b6'] }));
  assert.equal(p.kind, 'photon');
  assert.deepEqual(p.beamIds, ['b10', 'b6']);
  assert.deepEqual(normalizePlan(j, plan({ kind: 'cobalt', beamIds: ['b10', 'e6'] })).beamIds, ['b10', 'e6']);
  assert.equal(normalizePlan(j, plan({ kind: 'electron', beamIds: ['b10'] })).active, false);
});

test('Сеанс: план до 0.63.0 (фотоны и электроны вместе) делится по видам, текущий пучок сохраняется', () => {
  const j = journal();
  const by = splitPlan(j, plan({ beamIds: ['b10', 'e6', 'b6'], index: 2 }));
  assert.deepEqual(by.photon.beamIds, ['b10', 'b6']);
  assert.equal(by.photon.index, 1, 'текущий 6 МВ — второй в плане фотонов');
  assert.equal(by.photon.active, true);
  assert.deepEqual(by.electron.beamIds, ['e6']);
  assert.equal(by.electron.active, true);
  assert.equal(by.electron.index, 0);
  // только фотоны: план электронов пустой и не начат
  const ph = splitPlan(j, plan({ active: false }));
  assert.deepEqual(ph.photon.beamIds, ['b10', 'b6', 'b6f']);
  assert.equal(ph.photon.active, false);
  assert.deepEqual(ph.electron.beamIds, []);
  assert.equal(ph.electron.active, false);
  assert.deepEqual(splitPlan(j, null).photon.beamIds, []);
});
