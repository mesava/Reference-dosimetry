// Брахитерапия: расчёт листов по полям формы. Числа — обезличенные данные рабочей таблицы отделения (проверка ⁶⁰Co
// в фантоме PTW 9193 и ¹⁹²Ir в колодезной камере), сверенные с её результатами.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBrachyWell, computeBrachyPhantom, computeBrachySweet, computeBrachyDecay, normalizeBrachy, fieldTime, BRACHY_DEFAULTS } from '../src/core/brachy-sheets.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} ≠ ${b} (±${tol})`);
const rel = (a, b, tolRel, msg) => near(a / b, 1, tolRel, msg);
const HALF_LIVES_CO = 1925.21;
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

test('Фантом, ⁶⁰Co: поглощённая доза в воде — в точке, Ḋ_w,1 (Ubrich табл. 7, Λ·S_K по HEBD) и 8 см по TG-43, как в рабочей таблице', () => {
  const r = computeBrachyPhantom({ ...CO, p_src: 'co0a86', p_main: 'ubrich-mc-31010' });
  const d = r.dose;
  // в точке измерения по положениям: 23,430; 23,745; 23,371; 23,137 мГр/мин (среднее 23,421)
  near(d.point, 23.421, 0.002);
  [23.43, 23.745, 23.371, 23.137].forEach((x, i) => near(d.holes[i].value, x, 0.002));
  // Ubrich 2014, табл. 7, PTW 31010: (k_tot)Ḋw,1 = 76,49 → Ḋ_w,1 = 1791,5 мГр/мин; на 8 см в воде 24,991 мГр/мин
  const rows = Object.fromEntries(d.rows.map((x) => [x.id, x]));
  rel(rows['ubrich-31010'].dw1, 1791.5, 2e-4);
  rel(rows['ubrich-31010'].d8, 24.991, 2e-4);
  // G_L(8)/G_L(1) при L = 0,35 см: 0,0156225/0,98998 (TG-43U1, ур. 4); g_L(8) = 0,884 (HEBD, табл. LII)
  near(d.gRatio, 0.0156225 / 0.98998, 1e-6);
  // Λ = 1,092 сГр·ч⁻¹·Ед⁻¹ (HEBD, табл. LIII): по сертификату 1,092·10132 U = 11064 сГр/ч = 1844,0 мГр/мин
  rel(d.expected, (1.092 * 10132) / 6, 3e-4);
  // основной вариант — Ubrich MC 31010: Λ·S_K = 1,092·9822/6
  rel(rows.main.dw1, (1.092 * 9822.7) / 6, 3e-4);
  near(rows.main.dev, rows['ubrich-31010'].dev + 0, 0.7); // оба ниже сертификата на 2,8–3,1 %
  assert.ok(rows['ubrich-31010'].dev < -2.7 && rows['ubrich-31010'].dev > -3);
  // без модели источника — только доза в точке и подсказка
  const n = computeBrachyPhantom(CO).dose;
  near(n.point, 23.421, 0.002);
  assert.equal(n.rows.length, 0);
  assert.ok(n.messages.some((m) => m.field === 'p_src'));
  // своя модель: Λ и g_L вручную, L = 0 — точечный источник
  const o = computeBrachyPhantom({ ...CO, p_src: 'other', p_lambda: '1,1', p_L: '', p_gL8: '0,9', p_main: 'dgmp' }).dose;
  near(o.gRatio, 1 / 64, 1e-12);
  near(o.rows[0].d8, (o.rows[0].dw1 / 64) * 0.9, 1e-9);
  // калибровка не в N_w — дозы нет
  assert.equal(computeBrachyPhantom({ ...CO, p_calib: 'Na', p_N_unit: 'mGy/nC', p_src: 'co0a86' }).dose.point, undefined);
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

test('Лист «Максимум отклика»: точки из полей, отклик в положении измерения и сдвиг от сертификата камеры', () => {
  const xs = [];
  for (let x = 40; x <= 72; x += 2) xs.push(x);
  const s_x = xs.map((x) => String(x).replace('.', ','));
  const s_M = xs.map((x) => (10 - 0.005 * (x - 56.3) ** 2).toFixed(4).replace('.', ','));
  const r = computeBrachySweet({ s_x: [...s_x, '', '74'], s_M: [...s_M, '', ''], w_pos: '50', s_cert_pos: '54' });
  assert.ok(r.ok);
  assert.equal(r.n, xs.length);
  near(r.xPeak, 56.3, 0.01);
  // строка с положением без показания — пропущена с предупреждением; пустая — без
  assert.ok(r.messages.some((m) => m.field === `s_x_${xs.length + 1}` && m.level === 'warn'));
  assert.ok(!r.messages.some((m) => m.field === `s_x_${xs.length}`));
  // 50 мм: отклик (10 − 0,005·6,3²)/10 = 98,0 % — предупреждение «мерьте в максимуме»
  near(r.atMeas.rel, 1 - 0.0005 * 6.3 ** 2, 0.0005);
  assert.ok(r.messages.some((m) => m.field === 'w_pos' && m.level === 'warn'));
  near(r.atCert.shift, 2.3, 0.01);
  assert.ok(r.messages.some((m) => m.field === 's_cert_pos'));
  // в максимуме — без предупреждения
  const ok = computeBrachySweet({ s_x, s_M, w_pos: '56,3', s_cert_pos: '56' });
  assert.ok(!ok.messages.some((m) => m.level === 'warn'));
  // пустой лист — подсказка, без ошибок
  const empty = computeBrachySweet({});
  assert.equal(empty.ok, false);
  assert.deepEqual(errors(empty), []);
});

test('Лист «Распад»: от сертификата ⁶⁰Co по месяцам на 5 лет, дата порога 20 ГБк; от измерения; ¹⁹²Ir по неделям', () => {
  const base = { nuclide: 'Co-60', cert_value: '33,11', cert_unit: 'GBq', cert_gamma: '306', cert_gamma_unit: 'uGy·m2/(h·GBq)', cert_date: '2021-10-27', cert_time: '12:00', cert_zone: '+3' };
  const r = computeBrachyDecay({ ...base, d_target: '20', d_target_unit: 'GBq' });
  assert.ok(r.ok);
  assert.deepEqual(errors(r), []);
  assert.deepEqual(r.step, { n: 1, unit: 'm' });
  assert.equal(r.rows.length, 61);
  assert.equal(r.rows[0].t, Date.UTC(2021, 9, 27, 9));
  near(r.rows[0].A, 33.11, 1e-9);
  near(r.rows[0].frac, 1, 1e-12);
  near(r.rows[60].frac, 2 ** (-r.rows[60].days / HALF_LIVES_CO), 1e-12);
  // K̇_R = Γ·A: 33,11 ГБк · 306 мкГр·м²/(ч·ГБк) = 10,13 мГр/ч
  near(r.rows[0].mGyh, 10.132, 0.001);
  assert.equal(new Date(r.target.t).toISOString().slice(0, 10), '2025-08-27');
  // свой шаг и пределы
  const q = computeBrachyDecay({ ...base, d_from: '2026-01-01', d_to: '2026-12-31', d_n: '3', d_unit: 'm', d_zone: '+3' });
  assert.equal(q.rows.length, 4);
  assert.equal(new Date(q.rows[3].t).toISOString().slice(0, 10), '2026-09-30');
  assert.ok(errors(computeBrachyDecay({ ...base, d_from: '2026-02-01', d_to: '2026-01-01' })).some((m) => m.field === 'd_to'));
  // от измерения: другой лист без результата — от сертификата с подсказкой
  const noWell = computeBrachyDecay({ ...base, d_basis: 'well' }, { well: { ok: false } });
  assert.ok(noWell.messages.some((m) => m.field === 'd_basis'));
  near(noWell.base.U, r.base.U, 1e-9);
  const tM = Date.UTC(2026, 0, 10, 8);
  const fromWell = computeBrachyDecay({ ...base, d_basis: 'well' }, { well: { ok: true, U: 5000, tMeas: tM } });
  assert.equal(fromWell.base.U, 5000);
  assert.equal(fromWell.rows[0].t, tM);
  // ¹⁹²Ir — по неделям, 16 недель
  const ir = computeBrachyDecay(IR_CERT);
  assert.deepEqual(ir.step, { n: 1, unit: 'w' });
  assert.equal(ir.rows.length, 17);
  near(ir.rows[16].frac, 2 ** (-112 / 73.827), 1e-12);
  // пусто — подсказка, без ошибок
  assert.deepEqual(errors(computeBrachyDecay({})), []);
});
