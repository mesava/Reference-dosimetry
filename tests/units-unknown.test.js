// Единица N_D,w или давления не из списка (файл другой версии, правленный вручную файл): расчёт не падает с исключением,
// а показывает ошибку в замечаниях; без неё расчёт тот же.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setLang } from '../src/core/i18n.js';
import { unitConverters, ndwToGyPerNC } from '../src/core/units.js';
import { computePhotons } from '../src/core/photons.js';
import { computeElectrons } from '../src/core/electrons.js';
import { computeCobalt } from '../src/core/cobalt.js';
import { computeKv } from '../src/core/kv.js';
import { computeCrossCal } from '../src/core/crosscal.js';
import { SAMPLE_FORM } from '../src/core/sample.js';
import { SAMPLE_ELECTRONS } from '../src/core/sample-electrons.js';
import { SAMPLE_COBALT } from '../src/core/sample-cobalt.js';
import { SAMPLE_KV } from '../src/core/sample-kv.js';
import { SAMPLE_CROSSCAL } from '../src/core/sample-crosscal.js';

setLang('ru');

test('unitConverters: известные единицы — как раньше, неизвестные и свойства прототипа — NaN и одна ошибка', () => {
  const msgs = [];
  const conv = unitConverters((...a) => msgs.push(a));
  assert.ok(Math.abs(conv.ndw(5.4, 'cGy/nC') - 0.054) < 1e-15);
  assert.ok(Math.abs(conv.pressure(1013.25, 'hPa') - 101.325) < 1e-12);
  assert.ok(Number.isNaN(conv.ndw(5.4, '')));
  assert.ok(Number.isNaN(conv.ndw(5.4, '')));
  assert.ok(Number.isNaN(conv.ndw(5.4, 'toString')));
  assert.ok(Number.isNaN(conv.pressure(100, 'bar')));
  assert.equal(msgs.length, 3, 'одна ошибка на единицу');
  assert.ok(msgs.every(([level]) => level === 'error'));
  assert.match(msgs[0][2], /Не выбрана единица N_D,w/);
  assert.match(msgs[2][2], /«bar»/);
  assert.throws(() => ndwToGyPerNC(1, 'constructor'), /Неизвестная единица/);
});

const cases = [
  ['МВ фотоны', computePhotons, SAMPLE_FORM, ['ch_ndw_unit', 'env_P_unit']],
  ['электроны', computeElectrons, SAMPLE_ELECTRONS, ['e_ndw_unit', 'e_env_P_unit']],
  ['⁶⁰Co', computeCobalt, SAMPLE_COBALT, ['co_ndw_unit', 'co_env_P_unit']],
  ['кВ-рентген', computeKv, SAMPLE_KV, ['kv_n_unit', 'kv_env_P_unit']],
  ['перекрёстная калибровка', computeCrossCal, SAMPLE_CROSSCAL, ['cc_ref_ndw_unit', 'cc_P_unit']],
];
for (const [name, compute, sample, keys] of cases) {
  test(`${name}: неизвестная единица — ошибка в замечаниях, а не исключение`, () => {
    assert.equal(compute(sample).hasErrors, false, 'пример считается без ошибок');
    for (const key of keys) {
      for (const bad of ['', 'bogus']) {
        let r;
        assert.doesNotThrow(() => (r = compute({ ...sample, [key]: bad })), `${key} = «${bad}»`);
        assert.ok(r.hasErrors, `${key} = «${bad}»: есть ошибка`);
        assert.ok(r.messages.some((m) => m.level === 'error' && /единиц/.test(m.text)), `${key}: сообщение о единице`);
      }
    }
  });
}
