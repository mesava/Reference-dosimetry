// Рентгенотерапевтический аппарат в «Оборудовании» (0.41.0): аппликаторы и режимы в журнале, формат файла 3,
// референсный аппликатор по TRS-398 Rev.1 (табл. 31) и замечания по вводу.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeJournal, newJournal, journalFormat, JOURNAL_TAG } from '../src/core/journal.js';
import {
  normalizeKvMachine, newKvApplicator, newKvMachineMode, applicatorDiameter, applicatorSize, applicatorText, kvMachineModeTitle, hvlUnit, kvRefCandidates, kvMachineChecks,
} from '../src/core/kv-machine.js';

const app = (id, a, ssd, shape = 'circle', b = '') => ({ id, name: id.toUpperCase(), shape, a, b, ssd });
const unit = (apps, modes) => normalizeKvMachine({ id: 'mk', name: 'РТА', kind: 'kv', applicators: apps, modes });
const mode = (extra = {}) => ({ id: 'k1', range: 'medium', kv: '200', ma: '15', filter: '0,5 мм Cu', hvl: '1,0', chamberId: 'ch1', ...extra });

test('аппарат kV в журнале: нормализация, пучков и геометрии нет, формат файла 3', () => {
  const j = normalizeJournal({
    ...JOURNAL_TAG,
    machines: [
      { id: 'm1', name: 'Versa HD', beams: [] },
      { id: 'mk', name: 'РТА', kind: 'kv', calGeo: { photon: {} }, applicators: [{ id: 'a1', a: 10, ssd: 50, shape: 'oval' }, { name: 'F5' }], modes: [{ id: 'k1', range: 'high', kv: 200, applicators: ['a1', 'a1', 'nope'], refApplicator: 'nope', hvlSource: 'x' }] },
    ],
  });
  const m = j.machines[1];
  assert.equal(m.kind, 'kv');
  assert.deepEqual(m.beams, []);
  assert.equal('calGeo' in m, false);
  assert.equal(m.tube, '');
  // числа — строками, неизвестная форма — круг, аппликатор без id — с новым id
  assert.deepEqual([m.applicators[0].a, m.applicators[0].ssd, m.applicators[0].shape], ['10', '50', 'circle']);
  assert.match(m.applicators[1].id, /^a/);
  // режим: неизвестный диапазон — средние энергии, СПО номинальный, только свои аппликаторы без повторов
  const x = m.modes[0];
  assert.deepEqual([x.range, x.kv, x.hvlSource, x.refApplicator], ['medium', '200', 'nominal', '']);
  assert.deepEqual(x.applicators, ['a1']);
  // формат: 3 с аппаратом kV, страница понимает 3
  assert.equal(JOURNAL_TAG.version, 3);
  assert.equal(journalFormat(j), 3);
  assert.equal(journalFormat(newJournal()), 1);
  // журнал формата 4 — от более новой версии: не открывается
  assert.throws(() => normalizeJournal({ ...JOURNAL_TAG, version: 4, machines: [] }), /формат 4/);
  // ускоритель не меняется
  assert.ok(j.machines[0].calGeo);
});

test('аппликаторы: диаметр круга той же площади, размер и подпись', () => {
  assert.equal(applicatorDiameter(app('a', '10', '')), 10);
  assert.ok(Math.abs(applicatorDiameter(app('a', '10', '', 'square')) - 20 / Math.sqrt(Math.PI)) < 1e-12);
  assert.ok(Math.abs(applicatorDiameter(app('a', '8', '', 'rect', '10')) - 2 * Math.sqrt(80 / Math.PI)) < 1e-12);
  assert.ok(Number.isNaN(applicatorDiameter(app('a', '', ''))));
  assert.ok(Number.isNaN(applicatorDiameter(app('a', '8', '', 'rect', ''))));
  assert.equal(applicatorSize(app('a', '10', '', 'square')), '10 × 10 см');
  assert.equal(applicatorSize(app('a', '6', '', 'rect', '8')), '6 × 8 см');
  assert.equal(applicatorText(app('f3', '3', '30')), 'F3, Ø 3 см, РИП 30 см');
  assert.equal(applicatorText({ name: '', shape: 'circle', a: '', ssd: '' }), '');
  // новый аппликатор — с формой и РИП прежнего, без размера
  const n = newKvApplicator(app('a', '10', '50', 'square'));
  assert.deepEqual([n.shape, n.ssd, n.a, n.name], ['square', '50', '', '']);
  assert.notEqual(n.id, 'a');
});

test('режимы: обозначение, единица СПО, новый режим копирует камеру и аппликаторы', () => {
  assert.equal(kvMachineModeTitle({ kv: '120', ma: '10', filter: '2 мм Al' }), '120 кВ / 10 мА / 2 мм Al');
  assert.equal(kvMachineModeTitle({ label: ' Поверхностный ', kv: '120' }), 'Поверхностный');
  assert.equal(kvMachineModeTitle({}), '');
  assert.equal(hvlUnit('low'), 'мм Al');
  assert.equal(hvlUnit('medium'), 'мм Cu');
  const from = { id: 'k1', range: 'low', kv: '50', hvl: '1', chamberId: 'ch1', electrometerId: 'el1', applicators: ['a1'], refApplicator: 'a1' };
  const x = newKvMachineMode(from);
  assert.deepEqual([x.range, x.chamberId, x.electrometerId, x.applicators, x.refApplicator, x.kv, x.hvl], ['low', 'ch1', 'el1', ['a1'], 'a1', '', '']);
  assert.notEqual(x.id, 'k1');
  x.applicators.push('a2');
  assert.deepEqual(from.applicators, ['a1'], 'список аппликаторов — копия');
});

test('референсный аппликатор по TRS-398 Rev.1, табл. 31 (средние энергии)', () => {
  const apps = [app('f3', '3', '30'), app('f5', '5', '30'), app('f10', '10', '50'), app('q10', '10', '30', 'square'), app('f15', '15', '50')];
  const all = apps.map((a) => a.id);
  // сопоставимые с 10 × 10 см: Ø 10 см и квадрат 10 × 10 (Ø экв. 11,28 см); из них — с наибольшим РИП
  assert.deepEqual(kvRefCandidates(unit(apps, []), mode({ applicators: all })), { ids: ['f10'], how: 'comparable' });
  assert.deepEqual(kvRefCandidates(unit(apps, []), mode({ applicators: ['f3', 'q10'] })), { ids: ['q10'], how: 'comparable' });
  // прямоугольник 8 × 10 см — круг той же площади 10,09 см, сопоставим
  const rect = [app('r', '8', '30', 'rect', '10')];
  assert.deepEqual(kvRefCandidates(unit(rect, []), mode({ applicators: ['r'] })), { ids: ['r'], how: 'comparable' });
  // все тубусы аппарата меньше 10 см — самый большой квадратный или круглый (сноска к табл. 31)
  const small = [app('f3', '3', '30'), app('f5', '5', '30'), app('f5b', '5', '50')];
  assert.deepEqual(kvRefCandidates(unit(small, []), mode({ applicators: ['f3', 'f5', 'f5b'] })), { ids: ['f5b'], how: 'largest' });
  // у аппарата есть Ø 10 см, но у режима не отмечен — подходящего среди отмеченных нет
  assert.deepEqual(kvRefCandidates(unit(apps, []), mode({ applicators: ['f3', 'f5'] })), { ids: [], how: 'none' });
  // низкие энергии — по условиям калибровки камеры, проверяется во вкладке
  assert.equal(kvRefCandidates(unit(apps, []), mode({ range: 'low', applicators: all })).how, 'low');
});

test('замечания по аппарату kV', () => {
  const apps = [app('f3', '3', '30'), app('f10', '10', '50'), { id: 'bad', name: 'X', shape: 'rect', a: '5', b: '', ssd: 'ноль' }, { id: 'e', name: '', shape: 'circle', a: '', ssd: '' }];
  const j = { chambers: [{ id: 'ch1', kv: { kv_n: '45,1' } }, { id: 'ch2' }] };
  const texts = (m) => kvMachineChecks(unit(apps, [m]), j).map((c) => `${c.level}: ${c.short}`);
  const ok = mode({ applicators: ['f3', 'f10'], refApplicator: 'f10' });
  // аппликаторы: размер и РИП
  const appChecks = kvMachineChecks(unit(apps, [ok]), j).filter((c) => c.appId);
  assert.deepEqual(appChecks.map((c) => [c.appId, c.level]), [['bad', 'error'], ['bad', 'error'], ['e', 'warn']]);
  assert.match(appChecks[0].text, /^аппликатор 3 \(X\): размер — число/);
  // заполненный режим со стандартным по Rev.1 — без замечаний
  assert.equal(kvMachineChecks(unit(apps, [ok]), j).filter((c) => c.modeId).length, 0);
  // стандартный не тот
  const wrong = texts({ ...ok, refApplicator: 'f3' });
  assert.ok(wrong.some((t) => /^warn: по TRS-398 Rev\.1 \(табл\. 31\) стандартный — F10, Ø 10 см, РИП 50 см, а выбран F3/.test(t)), wrong.join('\n'));
  // стандартный не отмечен — ошибка; не выбран — замечания нет: он необязателен и в дозу не входит
  assert.ok(texts({ ...ok, applicators: ['f10'], refApplicator: 'f3' }).includes('error: стандартный аппликатор не отмечен у режима'));
  assert.equal(kvMachineChecks(unit(apps, [{ ...ok, refApplicator: '' }]), j).filter((c) => c.modeId).length, 0);
  // напряжение вне диапазона, СПО, камера
  assert.ok(texts({ ...ok, kv: '50' }).some((t) => /^warn: 50 кВ вне диапазона средних энергий \(80–300 кВ/.test(t)));
  assert.ok(texts({ ...ok, range: 'low', kv: '150' }).some((t) => /^warn: 150 кВ вне диапазона низких энергий/.test(t)));
  assert.ok(texts({ ...ok, hvl: '' }).includes('warn: СПО не введён: без него k_Q не определить'));
  assert.ok(texts({ ...ok, hvl: 'abc' }).includes('error: СПО — число миллиметров больше нуля'));
  assert.ok(texts({ ...ok, hvlSource: 'measured' }).includes('info: СПО измерен: укажите дату измерения'));
  assert.equal(texts({ ...ok, hvlSource: 'measured', hvlDate: '2026-10-01' }).filter((t) => /дату/.test(t)).length, 0);
  assert.ok(texts({ ...ok, chamberId: '' }).includes('warn: камера не выбрана'));
  // камера без kV-сертификата — справка: он вводится во вкладке и сохраняется в запись камеры
  assert.ok(texts({ ...ok, chamberId: 'ch2' }).some((t) => /^info: у камеры нет kV-сертификата/.test(t)));
  assert.ok(texts({ ...ok, chamberId: 'ch9' }).includes('error: камеры нет в «Оборудовании»'));
  assert.ok(texts({ ...ok, applicators: [], refApplicator: '' }).includes('warn: не отмечено ни одного аппликатора'));
  // в полном тексте — номер и обозначение режима
  const full = kvMachineChecks(unit(apps, [{ ...ok, chamberId: '' }]), j).find((c) => c.modeId);
  assert.equal(full.text, 'режим 1 (200 кВ / 15 мА / 0,5 мм Cu): камера не выбрана');
});
