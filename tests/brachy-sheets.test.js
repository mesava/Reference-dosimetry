// Брахитерапия: расчёт листов по полям формы. Числа — обезличенные данные рабочей таблицы отделения (проверка ⁶⁰Co
// в фантоме PTW 9193 и ¹⁹²Ir в колодезной камере), сверенные с её результатами.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBrachyWell, computeBrachyPhantom, normalizeBrachy, fieldTime, BRACHY_DEFAULTS } from '../src/core/brachy-sheets.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} ≠ ${b} (±${tol})`);
const rel = (a, b, tolRel, msg) => near(a / b, 1, tolRel, msg);
const errors = (r) => r.messages.filter((m) => m.level === 'error');

test('Поля по умолчанию и нормализация черновика', () => {
  const f = normalizeBrachy({ p_holes: [{ T: 20 }], w_I: 'x', nuclide: 'Xx' });
  assert.equal(f.p_holes.length, 4);
  assert.deepEqual(f.p_holes[0], { T: '20', P: '', M: ['', '', ''] });
  assert.deepEqual(f.w_I, BRACHY_DEFAULTS.w_I);
  assert.equal(f.nuclide, 'Ir-192');
  // пустая форма — без ошибок, только подсказки
  assert.deepEqual(errors(computeBrachyWell({})), []);
  assert.deepEqual(errors(computeBrachyPhantom({})), []);
});

test('Время поля: дата, время, пояс; пояс компьютера по умолчанию', () => {
  assert.equal(fieldTime('2026-11-02', '10:00', '+3').ms, Date.UTC(2026, 10, 2, 7));
  assert.equal(fieldTime('2026-11-02', '10:00', '', 180).ms, Date.UTC(2026, 10, 2, 7));
  assert.equal(fieldTime('2026-11-02', '10:00', 'UTC').ms, Date.UTC(2026, 10, 2, 10));
  assert.equal(fieldTime('2026-11-02', '', '+3').dateOnly, true);
  assert.ok(fieldTime('', '', '').missing);
});

// паспорт ¹⁹²Ir: 1,79·10⁻⁵ Гр/с на 1 м на 09.10.2026 11:00 (UTC+3)
const IR_CERT = { nuclide: 'Ir-192', cert_value: '1,79e-5', cert_unit: 'Gy/s', cert_date: '2026-10-09', cert_time: '11:00', cert_zone: '+3', cert_gamma: '30,18', cert_gamma_unit: 'aGy·m2/(s·Bq)' };

test('Колодезная камера, ¹⁹²Ir: как в рабочей таблице (5 показаний, k_TP), сравнение с паспортом на дату измерения', () => {
  const r = computeBrachyWell({
    ...IR_CERT,
    w_N: '9,897e5',
    w_T0: '20',
    w_P0: '1013,25',
    w_P0_unit: 'hPa',
    w_T: '21',
    w_P: '1012',
    w_P_unit: 'hPa',
    w_I: ['52', '52', '51,5', '52', '52'],
    w_leak: '0',
    w_date: '2026-11-02',
    w_time: '10:00',
    w_zone: '+3',
  });
  assert.deepEqual(errors(r), []);
  const kTP = (294.15 / 293.15) * (1013.25 / 1012);
  near(r.factors.kTP, kTP, 1e-12);
  near(r.mGyh, 51.9e-9 * kTP * 9.897e5 * 1e3, 1e-9);
  near(r.mGyh, 51.605, 0.001);
  // паспорт на дату измерения — 51,459 мГр/ч (как в таблице); отклонение +0,28 %
  near(r.compare.expected / 1e3, 51.459, 0.001);
  near(r.compare.dev, 0.28, 0.01);
  assert.equal(r.compare.level, 'ok');
  // кажущаяся активность через Γ паспорта (только справочно)
  rel(r.A, r.U / 108.648, 1e-12);
  // через N_AA сертификата камеры (Бк/А)
  const a = computeBrachyWell({ ...IR_CERT, w_N: '9,897e5', w_NAA: '8,996e18', w_I: ['52'], w_T: '20', w_P: '101,325', w_P_unit: 'kPa' });
  near(a.A, 52e-9 * 8.996e18 / 1e9, 1e-9);
  assert.ok(a.messages.some((m) => m.level === 'warn' && m.field === 'w_I'), 'меньше трёх показаний');
});

test('Колодезная камера: k_pol, k_s (ур. 33; линейно для TW33004), k_sm, утечка, дата без времени', () => {
  const base = { ...IR_CERT, w_N: '9,693e5', w_I: ['50', '50', '50'], w_T: '20', w_P: '101,325', w_P_unit: 'kPa', w_date: '2026-11-02', w_time: '10:00', w_zone: '+3' };
  const r = computeBrachyWell({ ...base, w_pol_plus: '50', w_pol_minus: '50,1', w_ks_m1: '50,1', w_ks_m2: '50', w_ks_v1: '400', w_ks_v2: '200', w_leak: '0,25' });
  near(r.factors.kPol, (50 + 50.1) / 100, 1e-12);
  near(r.factors.kS, 3 / (4 - 50.1 / 50), 1e-12);
  near(r.factors.kLeak, 0.995, 1e-12);
  const tw = computeBrachyWell({ ...base, w_model: 'PTW TW33004', w_ks_m1: '50,1', w_ks_m2: '50' });
  near(tw.factors.kS, 1 / (2 - 50.1 / 50), 1e-12);
  const t8 = computeBrachyWell({ ...base, w_ksm_mode: 'table', w_sm: 'vs2000', w_sm0: 'flexisource' });
  assert.equal(t8.factors.kSm, 0.987);
  assert.equal(computeBrachyWell({ ...base, w_ksm_mode: 'same' }).factors.kSm, 1);
  const none = computeBrachyWell(base);
  assert.equal(none.factors.ksmU, 2);
  assert.equal(computeBrachyWell({ ...base, w_ksm_mode: 'manual', w_ksm: '1,01' }).factors.kSm, 1.01);
  const d = computeBrachyWell({ ...base, cert_time: '' });
  assert.ok(d.messages.some((m) => m.field === 'cert_time' && m.level === 'warn'));
  // без даты измерения сравнения нет
  assert.equal(computeBrachyWell({ ...base, w_date: '' }).compare, null);
});

// проверка ⁶⁰Co в фантоме: камера Фармера, N_D,w = 48,36 мГр/нКл, 4 отверстия × 3 заряда по 1 мин
const CO = {
  nuclide: 'Co-60',
  cert_value: '33,11',
  cert_unit: 'GBq',
  cert_gamma: '306',
  cert_gamma_unit: 'uGy·m2/(h·GBq)',
  cert_date: '2026-11-02',
  cert_time: '10:00',
  cert_zone: '+3',
  p_model: 'IBA FC65-G',
  p_N: '48,36',
  p_N_unit: 'mGy/nC',
  p_tau: '1',
  p_P_unit: 'kPa',
  p_holes: [
    { T: '19,2', P: '97,59', M: ['0,467', '0,467', '0,467'] },
    { T: '19,4', P: '97,6', M: ['0,474', '0,472', '0,473'] },
    { T: '19,3', P: '97,59', M: ['0,465', '0,466', '0,466'] },
    { T: '', P: '', M: ['0,461', '0,462', '0,46'] },
  ],
  p_pol_plus: ['0,467', '0,466', '0,467'],
  p_pol_minus: ['0,467', '0,468', '0,467'],
  p_ks_v2: ['0,465', '0,465', '0,465'],
  p_date: '2026-11-02',
  p_time: '10:00',
  p_zone: '+3',
};

test('Фантом, ⁶⁰Co: варианты как в рабочей таблице (k_zp 1,276 ± k_A, Ubrich MC), мощность дозы в фантоме', () => {
  const r = computeBrachyPhantom(CO);
  assert.deepEqual(errors(r), []);
  near(r.factors.kPol, 1.000714, 1e-6);
  near(r.factors.kS, 1.001196, 1e-6);
  const v = Object.fromEntries(r.variants.map((x) => [x.id, x]));
  // таблица отделения: 10,358 (k_zp 1,276), 10,635 (то же с k_A 1,0267), 9,823 (Ubrich MC 31010)
  rel(v.dgmp.mGyh, 10.358, 2e-4);
  rel(v['dgmp-ka'].mGyh, 10.635, 2e-4);
  rel(v['ubrich-mc-31010'].mGyh, 9.823, 2e-4);
  // опора — 33,11 ГБк × 0,306 мГр·м²·ч⁻¹·ГБк⁻¹ = 10,13 мГр/ч
  near(r.expected / 1e3, 10.132, 0.001);
  near(v.dgmp.dev, 2.2, 0.05);
  near(v['dgmp-ka'].dev, 5.0, 0.05);
  near(v['ubrich-mc-31010'].dev, -3.05, 0.02);
  // Ḋ_w в точке измерения = N_D,w · Ṁ: 23,42 мГр/мин
  near(r.Dw, 23.42, 0.01);
  // для ⁶⁰Co основной вариант не выбран — только таблица
  assert.equal(r.main, null);
  assert.ok(r.messages.some((m) => m.field === 'p_main'));
  // выбран вариант с k_A — отклонение 4,96 %: «выяснить причину»
  const m = computeBrachyPhantom({ ...CO, p_main: 'dgmp-ka' });
  assert.equal(m.compare.level, 'warn');
  // свой k_tot по колодезной камере: K̇ = 10,132 мГр/ч → k_tot; с ним основной вариант совпадает с сертификатом
  const own = computeBrachyPhantom({ ...CO, p_wellK: '10,13166' });
  const k = own.ktotFromWell;
  const o = computeBrachyPhantom({ ...CO, p_ktot: String(k), p_main: 'own' });
  near(o.compare.dev, 0, 1e-9);
  assert.equal(o.compare.level, 'ok');
});

test('Фантом, ¹⁹²Ir: k_zp по камере (PTW 30013 → M30001), множитель 6,869·10⁻³, мощность дозы 0,2435·K̇', () => {
  const ir = {
    ...IR_CERT,
    p_model: 'PTW TM30013',
    p_N: '5,4e-2',
    p_N_unit: 'Gy/nC',
    p_T0: '20',
    p_P0: '101,325',
    p_holes: [
      { T: '20', P: '101,325', M: ['1', '1', '1'] },
      { T: '', P: '', M: ['1'] },
      { T: '', P: '', M: ['1'] },
      { T: '', P: '', M: ['1'] },
    ],
  };
  const r = computeBrachyPhantom(ir);
  assert.deepEqual(errors(r), []);
  assert.equal(r.main.id, 'dgmp');
  near(r.main.factor, 6.869e-3, 6e-7);
  near(r.rate, 60, 1e-12);
  near(r.mGyh, r.main.factor * 5.4e-2 * 60 * 1e3, 1e-9);
  // Ḋ_w,zp (сГр/мин) = 0,2435·K̇ (мГр/ч), руководство PTW, ур. (15)
  near(r.Dw / 10, 0.2435 * r.mGyh * (6.869e-3 / r.main.factor), 0.002 * r.Dw);
  // k_A стали и свой k_zp
  const ka = computeBrachyPhantom({ ...ir, p_main: 'dgmp-ka' });
  near(ka.mGyh, r.mGyh * 1.0165, 1e-9);
  const own = computeBrachyPhantom({ ...ir, p_kzp: '1,2' });
  near(own.main.kzp, 1.2, 0);
  // камера не из DGMP 13 — предупреждение и нет варианта DGMP
  const ex = computeBrachyPhantom({ ...ir, p_model: 'Exradin A12' });
  assert.ok(ex.messages.some((m) => m.field === 'p_kzp'));
  assert.equal(ex.main, null);
  // IBA FC65-G — приближённо как M30001, с предупреждением
  const fc = computeBrachyPhantom({ ...ir, p_model: 'IBA FC65-G' });
  near(fc.main.kzp, r.main.kzp, 1e-12);
  assert.ok(fc.messages.some((m) => m.level === 'warn' && m.field === 'p_model'));
  // меньше 4 положений — предупреждение; несоответствие единицы и типа калибровки — ошибка
  assert.ok(computeBrachyPhantom({ ...ir, p_holes: [ir.p_holes[0]] }).messages.some((m) => m.level === 'warn' && m.field === 'p_hole0'));
  assert.equal(errors(computeBrachyPhantom({ ...ir, p_calib: 'Ns' })).length, 1);
});
