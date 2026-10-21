// Проверки, добавленные по итогам аудита (октябрь 2026): статус соответствия референсным условиям,
// настраиваемый допуск, итог при ошибках в контрольных измерениях, камеры только для БВФ, Report 385.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computePhotons, FORM_DEFAULTS } from '../src/core/photons.js';
import { computeElectrons } from '../src/core/electrons.js';
import { computeCobalt } from '../src/core/cobalt.js';
import { SAMPLE_FORM } from '../src/core/sample.js';
import { SAMPLE_ELECTRONS } from '../src/core/sample-electrons.js';
import { SAMPLE_COBALT } from '../src/core/sample-cobalt.js';
import { APP_VERSION } from '../src/core/version.js';

const errorsOf = (r) => r.messages.filter((m) => m.level === 'error');
const reasons = (r) => r.compliance.reasons.map((x) => x.text).join(' | ');

/** Versa HD 6 FFF из рабочей книги (см. photons.test.js). */
const VERSA = {
  ...FORM_DEFAULTS, protocol: 'trs', meta_beam: '6 FFF', meta_fff: true, setup_geometry: 'SAD',
  ch_model: 'PTW31010', ch_ndw: '0,297', ch_T0: '20', ch_P0: '101,325', el_kelec: '1',
  env_T: '21,8', env_P: '1014,42', env_P_unit: 'hPa', rd_mu: '500', rd_V1: '400', rd_V2: '200',
  rd_M1: ['16,67', '16,67', '16,66'], rd_Mopp: ['-16,65', '-16,66', '-16,66'], rd_M2: ['16,54', '16,55', '16,55'],
  qtrs_method: 'pdd2010', qtrs_v20: '39,16', qtrs_v10: '67,22', kqtrs_mode: 'manual', kqtrs_manual: '0,9871',
  prof_mode: 'formula22', prof_length: '6,5', prof_sdd: '100', dd_on: false, dd_nominal: '1,000',
  ctrl_M: ['16,83', '16,83', '16,81'],
};

test('Статус соответствия: демо-наборы — без отступлений; ⁶⁰Co по TG-51 на 5 г/см² — нестандартные условия', () => {
  for (const protocol of ['trs', 'tg51']) {
    assert.equal(computePhotons({ ...SAMPLE_FORM, protocol }).compliance.status, 'standard', `фотоны, ${protocol}`);
    assert.equal(computeElectrons({ ...SAMPLE_ELECTRONS, protocol }).compliance.status, 'standard', `электроны, ${protocol}`);
  }
  assert.equal(computeCobalt({ ...SAMPLE_COBALT, protocol: 'trs' }).compliance.status, 'standard');
  const co = computeCobalt({ ...SAMPLE_COBALT, protocol: 'tg51' });
  assert.equal(co.compliance.status, 'nonstandard');
  assert.match(reasons(co), /z_ref = 5/);
});

test('Статус соответствия: поле, глубина и РИП вне референсных условий', () => {
  const f = { ...SAMPLE_FORM, protocol: 'trs', setup_geometry: 'manual', setup_ssd: '100', setup_field: '15', setup_depth: '10' };
  const r = computePhotons(f);
  assert.deepEqual(errorsOf(r), []);
  assert.equal(r.compliance.status, 'nonstandard');
  assert.match(reasons(r), /поле 15 × 15 см/);
  // РИП ≠ 100 см — отступление только для TRS-398 (TG-51 допускает клиническое расстояние)
  const ssd = { ...f, setup_field: '10', setup_ssd: '90' };
  assert.match(reasons(computePhotons(ssd)), /РИП 90 см/);
  assert.equal(computePhotons({ ...ssd, protocol: 'tg51' }).compliance.status, 'standard');
  // итога нет — статуса нет
  assert.equal(computePhotons({ ...f, rd_M1: ['', '', ''] }).compliance.status, 'invalid');
});

test('Камеры, включённые в TRS-398 Rev.1 только для БВФ: в пучке с фильтром — отступление', () => {
  const fff = computePhotons(VERSA);
  assert.deepEqual(errorsOf(fff), []);
  assert.equal(fff.compliance.status, 'standard', reasons(fff));
  assert.ok(fff.messages.some((m) => m.level === 'info' && /табл. 4/.test(m.text)), 'для БВФ остаётся справка');
  const wff = computePhotons({ ...VERSA, meta_beam: '6 МВ', meta_fff: false, prof_mode: 'manual' });
  assert.equal(wff.compliance.status, 'nonstandard');
  assert.match(reasons(wff), /PTW 31010 в пучке с выравнивающим фильтром/);
  assert.ok(wff.messages.some((m) => m.level === 'warn' && /с выравнивающим фильтром TRS-398 Rev.1 её не предусматривает/.test(m.text)));
});

test('TG-51, БВФ без свинцовой фольги: расчёт идёт, но условия нестандартные', () => {
  const r = computePhotons({ ...VERSA, protocol: 'tg51', q51_method: 'open', q51_pdd10: '63,0', kq51_manual_on: true, kq51_manual: '0,995', prof_mode: 'manual', prof_value: '1,002' });
  assert.ok(Number.isFinite(r.tg51.ctrl.DperMU));
  assert.equal(r.compliance.status, 'nonstandard');
  assert.match(reasons(r), /без свинцовой фольги/);
});

test('БВФ: энергия берётся из названия пучка; без энергии — предупреждение об области применимости', () => {
  assert.ok(!computePhotons(VERSA).messages.some((m) => /Укажите номинальную энергию/.test(m.text)), '6 FFF → 6 МВ');
  const r = computePhotons({ ...VERSA, meta_beam: 'Пучок БВФ', meta_energy: '' });
  assert.ok(r.messages.some((m) => m.level === 'warn' && /Укажите номинальную энергию/.test(m.text)));
  const hi = computePhotons({ ...VERSA, meta_beam: '15 FFF' });
  assert.match(reasons(hi), /15 МВ/);
});

test('Напоминание о флажке БВФ, если название пучка о фильтре ничего не говорит', () => {
  const remind = (f) => f.messages.some((m) => /Пучок считается пучком с выравнивающим фильтром/.test(m.text));
  assert.ok(remind(computePhotons({ ...SAMPLE_FORM, meta_beam: '6 МВ', meta_fff: false })));
  assert.ok(!remind(computePhotons({ ...SAMPLE_FORM, meta_beam: '6 МВ СВФ', meta_fff: false })));
  assert.ok(!remind(computePhotons(VERSA)));
});

test('Допуск на отклонение от номинала настраивается (по умолчанию 2 %)', () => {
  // по контрольным измерениям доза 0,9983 Гр на 100 МЕ: −0,17 % от 1,000; −1,7 % от 1,0156
  const nom = '1,0156';
  const def = computePhotons({ ...VERSA, dd_nominal: nom });
  assert.equal(def.recal.tolerance, 2);
  assert.equal(def.recal.needed, false);
  const tight = computePhotons({ ...VERSA, dd_nominal: nom, dd_tol: '1' });
  assert.equal(tight.recal.needed, true);
  assert.ok(tight.messages.some((m) => /больше 1 %/.test(m.text)));
  assert.ok(tight.messages.some((m) => m.scope === 'recal' && /±1 %/.test(m.text)));
  const bad = computePhotons({ ...VERSA, dd_tol: 'abc' });
  assert.equal(bad.recal.tolerance, 2);
  assert.ok(bad.messages.some((m) => m.level === 'warn' && /Допуск на отклонение от номинала не распознан/.test(m.text)));
  // электроны: то же поле e_tol
  const e = computeElectrons({ ...SAMPLE_ELECTRONS, e_tol: '0,1' });
  assert.equal(e.recal.tolerance, 0.1);
});

test('Ошибки в контрольных измерениях: итог не подменяется показанием M₁ основного раздела', () => {
  const r = computePhotons({ ...VERSA, ctrl_M: ['16,83', '16,83', '1,681'] }); // опечатка в 10 раз
  assert.ok(errorsOf(r).some((m) => m.scope === 'ctrl'));
  assert.equal(r.trs.blocked, false, 'поправки раздела 3 посчитаны');
  assert.equal(r.trs.ctrl.blocked, true);
  assert.equal(r.compliance.status, 'invalid', 'итога нет');
  assert.equal(r.recal.needed, false);
  const e = computeElectrons({ ...SAMPLE_ELECTRONS, e_ctrl_M: ['1', 'x', ''] });
  assert.ok(errorsOf(e).some((m) => m.scope === 'ctrl'));
  assert.equal(e.compliance.status, 'invalid');
  const co = computeCobalt({ ...SAMPLE_COBALT, co_Mc: ['1', 'x', ''] });
  assert.ok(errorsOf(co).some((m) => m.scope === 'ctrl'));
  assert.equal(co.compliance.status, 'invalid');
});

test('Report 385: ручной k_Q для камеры без данных Report 385 — предупреждение и нестандартные условия', () => {
  const base = { ...SAMPLE_ELECTRONS, protocol: 'tg51', e_kq51_mode: 'manual', e_kq51_manual: '0,95' };
  const ok = computeElectrons(base);
  assert.equal(ok.compliance.status, 'standard', 'камера из Report 385 с ручным k_Q');
  const r = computeElectrons({ ...base, e_ch_model: 'SNC350P' });
  assert.deepEqual(errorsOf(r), []);
  assert.ok(r.messages.some((m) => m.level === 'warn' && /не является расчётом по Report 385/.test(m.text)));
  assert.equal(r.compliance.status, 'nonstandard');
  // в TRS-398 k_Q, измеренный в лаборатории, допустим
  assert.ok(!computeElectrons({ ...base, protocol: 'trs', e_kqtrs_mode: 'manual', e_kqtrs_manual: '0,95', e_ch_model: 'SNC350P' }).messages.some((m) => /Report 385 нет данных/.test(m.text)));
});

test('Версия калькулятора совпадает с package.json', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(APP_VERSION, pkg.version);
  // метаданные для цитирования (GitHub «Cite this repository», Zenodo)
  const cff = readFileSync(new URL('../CITATION.cff', import.meta.url), 'utf8');
  assert.match(cff, new RegExp(`^version: ${APP_VERSION.replace(/\./g, '\\.')}$`, 'm'), 'версия в CITATION.cff');
  assert.match(cff, new RegExp(`^license: ${pkg.license}$`, 'm'), 'лицензия в CITATION.cff');
});

test('⁶⁰Co: k_s лаборатории чуть больше измеренного — отношение < 1, расчёт не блокируется', () => {
  for (const protocol of ['trs', 'tg51']) {
    const base = computeCobalt({ ...SAMPLE_COBALT, protocol });
    const x0 = protocol === 'trs' ? base.trs : base.tg51;
    const raw = protocol === 'trs' ? x0.ksRaw : x0.PionRaw;
    const lab = (raw + 0.0005).toFixed(4).replace('.', ',');
    const r = computeCobalt({ ...SAMPLE_COBALT, protocol, co_lab_ks_applied: false, co_lab_ks: lab });
    assert.deepEqual(errorsOf(r), [], `${protocol}: k_s = ${raw}, лаборатория ${lab}`);
    const x = protocol === 'trs' ? r.trs : r.tg51;
    assert.ok((protocol === 'trs' ? x.ks : x.Pion) < 1);
  }
});

test('Большая подстройка выхода: напоминание перемерить k_s, если менялась доза за импульс', () => {
  const base = { ...VERSA, dd_nominal: '1,030', recal_needed: 'yes' };
  const big = computePhotons({ ...base, recal_M: ['17,34', '17,34', '17,32'] }); // ≈ −3 %
  assert.ok(Math.abs(big.trs.recal.preVsNew) > 2);
  assert.ok(big.messages.some((m) => m.scope === 'recal' && /перемерьте k_s/.test(m.text)));
  const small = computePhotons({ ...base, recal_M: ['17,0', '17,0', '17,0'] }); // ≈ −1 %
  assert.ok(Math.abs(small.trs.recal.preVsNew) < 2);
  assert.ok(!small.messages.some((m) => /перемерьте k_s/.test(m.text)));
});

test('Report 385: область 1,70–8,70 см проверяется при любом способе k_Q (электроны и перекрёстная калибровка)', async () => {
  const { computeCrossCal } = await import('../src/core/crosscal.js');
  const { SAMPLE_CROSSCAL } = await import('../src/core/sample-crosscal.js');
  const scopeWarn = (r) => r.messages.some((m) => m.level === 'warn' && /вне области Report 385/.test(m.text) && /разд\. 1/.test(m.ref));
  const fitError = (r) => r.messages.some((m) => m.level === 'error' && /вне диапазона Report 385/.test(m.text));
  for (const [r50, inside] of [[1.69, false], [1.70, true], [8.70, true], [8.71, false], [9.20, false]]) {
    const R = String(r50).replace('.', ',');
    // электроны: ручной k_Q — доза есть, вне области — «нестандартные условия»; расчётный — вне области ошибка
    const base = { ...SAMPLE_ELECTRONS, protocol: 'tg51', e_r50_method: 'r50', e_r50: R };
    const man = computeElectrons({ ...base, e_kq51_mode: 'manual', e_kq51_manual: '0,95' });
    assert.equal(fitError(man), false, `ручной k_Q, R50 = ${r50}`);
    assert.equal(scopeWarn(man), !inside, `ручной k_Q, R50 = ${r50}: предупреждение об области`);
    if (!inside) {
      assert.equal(man.compliance.status, 'nonstandard', `R50 = ${r50}`);
      assert.match(reasons(man), /вне области Report 385/);
      assert.ok(Number.isFinite(man.tg51.kQ), 'число считается');
    }
    const fit = computeElectrons({ ...base, e_kq51_mode: 'fit' });
    assert.equal(fitError(fit), !inside, `расчётный k_Q, R50 = ${r50}`);
    // перекрёстная калибровка: ручные k_Q обеих камер и расчётные
    const cc = { ...SAMPLE_CROSSCAL, protocol: 'tg51', cc_r50_method: 'r50', cc_r50: R };
    const ccMan = computeCrossCal({ ...cc, cc_ref_kq51_mode: 'manual', cc_ref_kq51_manual: '1,03', cc_fld_kq51_mode: 'manual', cc_fld_kq51_manual: '0,99' });
    assert.equal(fitError(ccMan), false, `перекрёстная, ручные k_Q, R50 = ${r50}`);
    assert.equal(scopeWarn(ccMan), !inside, `перекрёстная, ручные k_Q, R50 = ${r50}`);
    assert.ok(Number.isFinite(ccMan.tg51.KN));
    assert.equal(fitError(computeCrossCal(cc)), !inside, `перекрёстная, расчётные k_Q, R50 = ${r50}`);
    // одна камера с ручным k_Q, другая — по аппроксимации: вне области — ошибка (аппроксимация там не проверена)
    assert.equal(fitError(computeCrossCal({ ...cc, cc_fld_kq51_mode: 'manual', cc_fld_kq51_manual: '0,99' })), !inside, `перекрёстная, смешанные k_Q, R50 = ${r50}`);
  }
});

test('Ручной k_Q: источник попадает в подпись k_Q (протокол), без источника — справка у поля', () => {
  const noSrc = computePhotons(VERSA);
  assert.ok(noSrc.messages.some((m) => m.level === 'info' && /Источник введённого вручную k_Q не указан/.test(m.text)));
  assert.equal(noSrc.flags?.kqtrs_src ?? 'info', 'info');
  const withSrc = computePhotons({ ...VERSA, kqtrs_src: 'Свидетельство № 1, 01.01.2026' });
  assert.ok(!withSrc.messages.some((m) => /Источник введённого вручную/.test(m.text)));
  assert.match(withSrc.trs.kQSource, /— Свидетельство № 1, 01\.01\.2026$/);
  const e = computeElectrons({ ...SAMPLE_ELECTRONS, protocol: 'tg51', e_kq51_mode: 'manual', e_kq51_manual: '0,95', e_kq51_src: 'ВНИИФТРИ, 2026' });
  assert.match(e.tg51.kQSource, /ВНИИФТРИ, 2026/);
  // расчётный k_Q — справки об источнике нет
  assert.ok(!computePhotons({ ...VERSA, kqtrs_mode: 'formula' }).messages.some((m) => /Источник введённого вручную/.test(m.text)));
});
