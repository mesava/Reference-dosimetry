// Сквозной расчёт: результат computePhotons сверяется с расчётом «вручную» по формулам протоколов.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePhotons, FORM_DEFAULTS } from '../src/core/photons.js';
import { SAMPLE_FORM } from '../src/core/sample.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} ≠ ${b} (±${tol})`);
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

test('Демо-набор: TRS-398 Rev.1 и TG-51 совпадают с ручным расчётом', () => {
  const r = computePhotons(SAMPLE_FORM);
  const errors = r.messages.filter((m) => m.level === 'error');
  assert.deepEqual(errors, [], 'в демо-наборе не должно быть ошибок');

  const M1 = mean([12.346, 12.348, 12.345]);
  const Mopp = mean([12.339, 12.341]);
  const M2 = mean([12.302, 12.304]);
  const ndw = 0.05335;
  const kpol = (M1 + Mopp) / (2 * M1);

  // TRS-398 Rev.1
  const kTP = ((273.15 + 21.4) / (273.15 + 20)) * (101.325 / 99.62);
  const r12 = M1 / M2;
  const ksExp = 1.198 - 0.875 * r12 + 0.677 * r12 * r12; // табл. 10, n = 3
  const a = 1.18273;
  const b = -0.13256;
  const kQtrs = (1 + Math.exp((a - 0.57) / b)) / (1 + Math.exp((a - 0.668) / b));
  const Dtrs = M1 * kTP * kpol * ksExp * ndw * kQtrs;
  near(r.trs.kTP, kTP, 1e-12, 'k_TP');
  near(r.trs.ks, ksExp, 1e-12, 'k_s');
  near(r.trs.kQ, kQtrs, 1e-12, 'k_Q TRS');
  near(r.trs.D, Dtrs, 1e-12, 'D TRS');
  near(r.trs.DmaxPerMU, (Dtrs * 100) / 100 / 0.664, 1e-12, 'D(d_max)/МЕ TRS');

  // TG-51 + аддендум
  const PTP = ((273.2 + 21.4) / (273.2 + 20)) * (101.325 / 99.62);
  const Pion = (1 - 3) / (r12 - 3);
  const kQ51 = 0.9652 + 2.141e-3 * 66.4 - 2.623e-5 * 66.4 * 66.4;
  const D51 = M1 * PTP * Pion * kpol * ndw * kQ51;
  near(r.tg51.PTP, PTP, 1e-12, 'P_TP');
  near(r.tg51.Pion, Pion, 1e-12, 'P_ion');
  near(r.tg51.kQ, kQ51, 1e-12, 'k_Q TG-51');
  near(r.tg51.D, D51, 1e-12, 'D TG-51');

  near(r.comparison.dRel, (D51 / Dtrs - 1) * 100, 1e-9, 'расхождение протоколов');
  // Порядок величины: доза на d_max около 1 сГр/МЕ
  assert.ok(r.trs.DmaxPerMU > 0.98 && r.trs.DmaxPerMU < 1.02);
});

test('Report 374, прил. A.3.2: пересчёт на d_max через PDD', () => {
  // 0,6600 сГр/МЕ на 10 см и %dd(10) = 66,0 → 1,0000 сГр/МЕ на d_max.
  // Подбираем показание так, чтобы доза на 10 см была ровно 0,6600 сГр/МЕ при всех поправках = 1.
  const form = {
    ...FORM_DEFAULTS,
    protocol: 'tg51',
    ch_model: 'NE2571',
    ch_ndw: '1',
    ch_T0: '22',
    ch_P0: '101,33',
    env_T: '22',
    env_P: '101,33',
    rd_mu: '100',
    rd_V1: '300',
    rd_V2: '150',
    rd_M1: '0,66',
    rd_Mopp: '0,66',
    rd_M2: '0,66',
    q51_method: 'manual',
    q51_manual: '66',
    kq51_manual_on: true,
    kq51_manual: '1',
    dd_pdd: '66,0',
  };
  const r = computePhotons(form);
  near(r.tg51.DperMU, 0.66, 1e-12);
  near(r.tg51.DmaxPerMU, 1.0, 1e-12);
  // вариант с k_Q = 0,9985 и %dd(10) = 67,0 → 0,65901/0,67 = 0,98360 (в отчёте опечатка 0,6659)
  const r2 = computePhotons({ ...form, kq51_manual: '0,9985', dd_pdd: '67,0' });
  near(r2.tg51.DperMU, 0.65901, 1e-12);
  near(r2.tg51.DmaxPerMU, 0.9836, 5e-5);
});

test('Проверки: P_ion > 1,05, забытая фольга в БВФ, давление в неверных единицах', () => {
  const base = { ...SAMPLE_FORM };
  const r1 = computePhotons({ ...base, rd_M2: '11,2' });
  assert.ok(r1.messages.some((m) => m.level === 'error' && /P_ion/.test(m.text)));
  assert.ok(r1.messages.some((m) => m.level === 'error' && /k_s/.test(m.text)));
  assert.ok(r1.tg51.blocked && r1.trs.blocked);

  const r2 = computePhotons({ ...base, meta_fff: true, q51_method: 'interim' });
  assert.ok(r2.messages.some((m) => m.level === 'error' && /БВФ/.test(m.text)));

  const r3 = computePhotons({ ...base, env_P: '747' }); // мм рт. ст., а единица — кПа
  assert.ok(r3.messages.some((m) => m.level === 'error' && /Давление/.test(m.text)));
  const r4 = computePhotons({ ...base, env_P: '747', env_P_unit: 'mmHg' });
  assert.ok(!r4.messages.some((m) => m.level === 'error'));
});

test('Лаборатория не вносила поправки: k′_pol = k_pol/k_pol,Q0 и k_s/k_s,Q0', () => {
  const r0 = computePhotons(SAMPLE_FORM);
  const r = computePhotons({ ...SAMPLE_FORM, lab_pol_applied: false, lab_kpol: '1,002', lab_ks_applied: false, lab_ks: '1,001' });
  near(r.trs.kpol, r0.trs.kpol / 1.002, 1e-12);
  near(r.trs.ks, r0.trs.ks / 1.001, 1e-12);
  near(r.tg51.Ppol, r0.tg51.Ppol / 1.002, 1e-12);
  near(r.tg51.Pion, r0.tg51.Pion / 1.001, 1e-12);
  // расхождение протоколов не должно меняться от этих настроек
  near(r.comparison.dRel, r0.comparison.dRel, 1e-9);
});

test('Камера не из списка требует k_Q вручную; 31003 и IC10 есть только в TG-51', () => {
  const other = computePhotons({ ...SAMPLE_FORM, ch_model: 'OTHER' });
  assert.ok(other.messages.some((m) => m.level === 'error' && m.scope === 'trs' && /вручную/.test(m.text)));
  assert.ok(other.messages.some((m) => m.level === 'error' && m.scope === 'tg51' && /вручную/.test(m.text)));
  const manual = computePhotons({ ...SAMPLE_FORM, ch_model: 'OTHER', kqtrs_manual_on: true, kqtrs_manual: '0,99', kq51_manual_on: true, kq51_manual: '0,99' });
  assert.ok(!manual.hasErrors);
  const r31003 = computePhotons({ ...SAMPLE_FORM, ch_model: 'PTW31003' });
  assert.ok(r31003.tg51.ok && !r31003.tg51.blocked);
  assert.ok(r31003.trs.blocked);
});

test('Большой разброс показаний: предупреждение или ошибка', () => {
  const warn = computePhotons({ ...SAMPLE_FORM, rd_M1: '12,30 12,45' });
  assert.ok(warn.messages.some((m) => m.level === 'warn' && /Разброс/.test(m.text)));
  const err = computePhotons({ ...SAMPLE_FORM, rd_M1: '12 346 12,348' }); // пробел внутри числа
  assert.ok(err.messages.some((m) => m.level === 'error' && /расходятся/.test(m.text)));
});

test('Поправка на профиль: вручную, по формуле (22), по профилю', () => {
  const man = computePhotons({ ...SAMPLE_FORM, prof_mode: 'manual', prof_value: '1,004' });
  const r0 = computePhotons(SAMPLE_FORM);
  near(man.trs.D, r0.trs.D * 1.004, 1e-12);
  near(man.tg51.D, r0.tg51.D * 1.004, 1e-12);

  const gen = computePhotons({ ...SAMPLE_FORM, meta_fff: true, q51_method: 'foil30', q51_pdd10pb: '66,4', prof_mode: 'generic' });
  near(gen.profile.value, 1 + (0.0062 * 0.668 - 0.0036) * 2.3 * 2.3 * (100 / 110) ** 2, 1e-12);

  const text = Array.from({ length: 31 }, (_, i) => `${i - 15} ${1 - 1e-5 * (i - 15) ** 2}`).join('\n');
  const pr = computePhotons({ ...SAMPLE_FORM, prof_mode: 'profile', prof_text: text });
  near(pr.profile.value, 1 / (1 - (1e-5 * 23 * 23) / 12), 2e-6);
});

test('Геометрия РИО: пересчёт через TMR', () => {
  const r = computePhotons({ ...SAMPLE_FORM, setup_geometry: 'SAD', dd_tmr: '0,736' });
  near(r.trs.DmaxPerMU, r.trs.DperMU / 0.736, 1e-12);
  const bad = computePhotons({ ...SAMPLE_FORM, setup_geometry: 'SAD', dd_tmr: '73,6' });
  assert.ok(bad.messages.some((m) => m.level === 'error' && /TMR/.test(m.text)));
});
