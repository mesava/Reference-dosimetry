// Приёмка «В пластинах» на независимых данных: два ускорителя (А и Б) одного отделения, фотоны 6 и 10 МВ (PTW 30013) и
// 6 и 10 МВ БВФ (PTW 31010). Калибровка в воде — 17.09.2024, на следующий день — измерение в пластинах RW3 (PTW 29672,
// адаптеры 29672/U7 и U6: 9,3 и 9,5 см пластин над адаптером, точка отсчёта камеры на 10 см). Эталон — рабочие таблицы
// отделения в Excel, не связанные с калькулятором. Данные обезличены: без учреждения, ФИО и заводских номеров.
//
// Ввод — «как в таблицах»: РИО 100 см (РИП 90 см), z_ref = 10 см, P₀ = 101,3 кПа (в таблицах 1013 гПа), k_Q — значение
// таблицы (вручную), V₁/V₂ = 400/200 В. В воде доза — по отдельной серии (контрольные измерения), k_pol и k_s — по серии
// 400/200 В. В пластинах таблица считает дозу по формуле для воды без перевода в воду: по серии +400 В с k_pol и k_s этого
// дня и k_vol по ур. (22) — это «доза в пластинах без перевода в воду» модуля, если ввести k_s и k_pol в пластинах.
// k_vol в таблице воды не учитывался (= 1), в таблице пластин — учитывался.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePhotons, FORM_DEFAULTS } from '../src/core/photons.js';
import { newJournal, normalizeJournal, recordTabBeam, PH_BEAM_KEYS, PH_CHAMBER_KEYS, PH_ELECTROMETER_KEYS } from '../src/core/journal.js';
import { makeBinding, setBinding, platesResult, waterReading, kspolFactor, waterCalibrations } from '../src/core/plates.js';

const c = (x) => String(x).replace('.', ',');
const cells = (a) => a.map(c);
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));
const near = (a, b, rel, msg) => assert.ok(Math.abs(a / b - 1) <= rel, `${msg}: ${a} ≠ ${b} (±${rel * 100} %)`);

// показания по модулю (M₋ в таблицах записан без знака); xl — доза таблицы, сГр за mu; kvol — k_vol таблицы пластин
const DATA = {
  А: {
    water: { T: 22.5, P: 1030.42 },
    plates: { T: 20.9, P: 1031.2 },
    beams: {
      '6 МВ': { mu: 100, kq: 0.987204, tpr: 0.6814,
        w: { ctrl: [18.9, 18.91, 18.92], M1: [16.06, 16.06, 16.06], Mo: [16.06, 16.06, 16.05], M2: [16, 16, 16], xl: 100.09720684571721 },
        p: { M1: [18.46, 18.47, 18.47], Mo: [18.48, 18.49, 18.49], M2: [18.42, 18.42, 18.42], xl: 97.09567463626809 } },
      '10 МВ': { mu: 100, kq: 0.976522, tpr: 0.7346,
        w: { ctrl: [19.05, 19.06, 19.06], M1: [17.09, 17.09, 17.08], Mo: [17.1, 17.1, 17.1], M2: [16.98, 16.98, 16.99], xl: 100.05998535116709 },
        p: { M1: [18.49, 18.49, 18.49], Mo: [18.52, 18.52, 18.52], M2: [18.43, 18.42, 18.43], xl: 96.27693595303413 } },
      '6 МВ БВФ': { mu: 500, kq: 0.98723, tpr: 0.6771,
        w: { ctrl: [17.09, 17.1, 17.11], M1: [16.49, 16.5, 16.5], Mo: [16.52, 16.51, 16.52], M2: [16.4, 16.41, 16.41], xl: 500.0717210418088 },
        p: { M1: [16.86, 16.87, 16.88], Mo: [16.9, 16.91, 16.92], M2: [16.79, 16.8, 16.8], kvol: 1.00025266345, xl: 490.17476033898544 } },
      '10 МВ БВФ': { mu: 500, kq: 0.9783075, tpr: 0.7263,
        w: { ctrl: [17.19, 17.2, 17.2], M1: [17.36, 17.36, 17.36], Mo: [17.39, 17.4, 17.4], M2: [17.19, 17.2, 17.2], xl: 500.5603276681357 },
        p: { M1: [16.68, 16.68, 16.67], Mo: [16.69, 16.69, 16.71], M2: [16.48, 16.5, 16.49], kvol: 1.00038154285, xl: 483.2758207515527 } },
    },
  },
  Б: {
    water: { T: 21.8, P: 1002.9 },
    plates: { T: 22.1, P: 1028.9 },
    beams: {
      '6 МВ': { mu: 100, kq: 0.987204, tpr: 0.6749,
        w: { ctrl: [18.46, 18.45, 18.45], M1: [18.83, 18.84, 18.84], Mo: [18.84, 18.85, 18.86], M2: [18.79, 18.8, 18.8], xl: 100.0106241475903 },
        p: { M1: [18.4, 18.41, 18.41], Mo: [18.43, 18.46, 18.46], M2: [18.4, 18.4, 18.39], xl: 97.26671428579365 } },
      '10 МВ': { mu: 100, kq: 0.976522, tpr: 0.7307,
        w: { ctrl: [18.63, 18.63, 18.61], M1: [19.15, 19.16, 19.17], Mo: [19.18, 19.18, 19.18], M2: [19.08, 19.08, 19.1], xl: 100.02326695124233 },
        p: { M1: [18.57, 18.57, 18.58], Mo: [18.6, 18.59, 18.59], M2: [18.5, 18.51, 18.51], xl: 97.31166720749822 } },
      '6 МВ БВФ': { mu: 500, kq: 0.98723, tpr: 0.6702,
        w: { ctrl: [16.71, 16.73, 16.73], M1: [16.85, 16.85, 16.87], Mo: [16.85, 16.84, 16.85], M2: [16.77, 16.78, 16.78], xl: 500.4825709043348 },
        p: { M1: [16.84, 16.85, 16.86], Mo: [16.87, 16.88, 16.88], M2: [16.77, 16.78, 16.77], kvol: 1.0002345889, xl: 492.585978891988 } },
      '10 МВ БВФ': { mu: 500, kq: 0.9783075, tpr: 0.7224,
        w: { ctrl: [16.75, 16.75, 16.75], M1: [16.81, 16.8, 16.81], Mo: [16.82, 16.83, 16.83], M2: [16.62, 16.64, 16.62], xl: 500.18451858288546 },
        p: { M1: [16.86, 16.86, 16.87], Mo: [16.89, 16.9, 16.9], M2: [16.72, 16.71, 16.71], kvol: 1.0003713268, xl: 490.81126789430226 } },
    },
  },
};
const fff = (name) => name.includes('БВФ');
const BASE = {
  ...FORM_DEFAULTS, protocol: 'trs', setup_geometry: 'SAD', ch_T0: '20', ch_P0: '101,3', el_kelec: '1', env_P_unit: 'hPa',
  rd_V1: '400', rd_V2: '200', rd_polarity: '+', rd_beam: 'pulsed', dd_on: false, dd_nominal: '1,000', dd_nominal_at: 'zref',
  qtrs_method: 'ratio', qtrs_v10: '100', kqtrs_mode: 'manual',
};
/** Форма «МВ фотоны»: set — 'w' (вода) или 'p' (пластины, доза по серии +400 В); kvol22 — k_vol по ур. (22), иначе 1. */
function form(machine, name, set, kvol22) {
  const b = DATA[machine].beams[name];
  const s = b[set];
  const env = set === 'w' ? DATA[machine].water : DATA[machine].plates;
  return {
    ...BASE, meta_beam: name, meta_fff: fff(name), meta_date: set === 'w' ? '2024-09-17' : '2024-09-18',
    ch_model: fff(name) ? 'PTW31010' : 'PTW30013', ch_ndw: fff(name) ? '0,297' : '0,05389',
    env_T: c(env.T), env_P: c(env.P), rd_mu: String(b.mu), rd_M1: cells(s.M1), rd_Mopp: s.Mo.map((x) => c(-x)), rd_M2: cells(s.M2),
    ctrl_M: s.ctrl ? cells(s.ctrl) : [''], qtrs_v20: c(b.tpr * 100), kqtrs_manual: c(b.kq),
    ...(fff(name) && kvol22 ? { prof_mode: 'formula22', prof_length: '6,5', prof_sdd: '100' } : { prof_mode: 'manual', prof_value: '1' }),
  };
}
/** Журнал с одним пучком, откалиброванным в воде 17.09.2024. */
function journal(machine, name, kvol22) {
  const f = form(machine, name, 'w', kvol22);
  let j = newJournal();
  j.chambers = [{ id: 'c1', form: pick(f, PH_CHAMBER_KEYS) }];
  j.electrometers = [{ id: 'e1', form: pick(f, PH_ELECTROMETER_KEYS) }];
  j.machines = [{ id: 'm', name: `Ускоритель ${machine}`, kind: 'linac', beams: [{ id: 'b', kind: 'photon', name, active: true, form: pick(f, PH_BEAM_KEYS) }] }];
  j = normalizeJournal(j);
  const r = recordTabBeam(j, { machineId: 'm', beamId: 'b', form: f, kind: 'photon', today: '2026-11-01' });
  assert.ok(!r.error, r.error);
  return r.journal;
}
const each = (fn) => {
  for (const m of Object.keys(DATA)) for (const name of Object.keys(DATA[m].beams)) fn(m, name, DATA[m].beams[name]);
};
const platesInput = (m, b, extra = {}) => ({ amount: String(b.mu), M: cells(b.p.M1), T: c(DATA[m].plates.T), P: c(DATA[m].plates.P), P_unit: 'hPa', today: '2026-11-01', ...extra });

test('RW3: калибровка в воде 17.09.2024 — доза совпадает с таблицей (k_TP с 273,15 вместо 273,2 — 1·10⁻⁶)', () => {
  each((m, name, b) => {
    const r = computePhotons(form(m, name, 'w', false));
    assert.deepEqual(r.messages.filter((x) => x.level === 'error'), [], `${m} ${name}`);
    near(r.trs.ctrl.DcGy, b.w.xl, 2e-6, `${m} ${name}: доза в воде`);
  });
});

test('RW3: доза в пластинах без перевода в воду — как в таблице, если ввести k_s и k_pol, перемеренные в пластинах', () => {
  each((m, name, b) => {
    // k_vol калибровки по ур. (22), как в таблице пластин
    const j0 = journal(m, name, true);
    const rp = computePhotons({ ...form(m, name, 'p', true), ctrl_M: [''] });
    if (b.p.kvol) near(rp.trs.kvol, b.p.kvol, 1e-12, `${m} ${name}: k_vol`);
    const k = { ks: c(rp.trs.ks), kpol: c(rp.trs.kpol) };
    const { binding, error } = makeBinding(j0, 'b', { material: 'whiteps', rho: '1,045', depth: '10', date: '2024-09-18', ...platesInput(m, b, k) });
    assert.ok(!error, error);
    const j = setBinding(j0, 'b', binding);
    near(binding.Dpl0 * b.mu, b.p.xl, 2e-6, `${m} ${name}: доза в пластинах при привязке`);
    // проверка теми же показаниями без k_s и k_pol — берутся из привязки: выход = итог калибровки, доза в пластинах та же
    const res = platesResult(j, 'b', { date: '2024-09-18', ...platesInput(m, b) });
    assert.ok(res.ok, res.errors.join(' '));
    near(res.ratio, 1, 1e-12, `${m} ${name}: M_pl / M_pl,0`);
    near(res.value, waterCalibrations(j, 'b')[0].summary.value, 1e-12, `${m} ${name}: выход по пластинам`);
    near(res.Dpl * b.mu, b.p.xl, 2e-6, `${m} ${name}: доза в пластинах`);
    // отношение пластины/вода — как отношение доз двух таблиц (k_vol в таблице воды не учитывался)
    const xlRatio = b.p.xl / b.w.xl / (b.p.kvol ?? 1);
    near(res.plw, xlRatio, 2e-6, `${m} ${name}: пластины/вода`);
  });
});

test('RW3: без k_s и k_pol в пластинах — поправки калибровки в воде; отличие от таблицы — перемер k_s и k_pol', () => {
  // А, 10 МВ: k_s 1,00594 в воде и 1,00333 в пластинах — доза в пластинах на 0,22 % больше таблицы
  const b = DATA.А.beams['10 МВ'];
  const j0 = journal('А', '10 МВ', false);
  const { binding } = makeBinding(j0, 'b', { material: 'whiteps', rho: '1,045', depth: '10', date: '2024-09-18', ...platesInput('А', b) });
  const wr = waterReading(j0, binding.calSessionId, 'b');
  near(wr.ks, 1.0059382981063423, 1e-12, 'k_s калибровки');
  near(wr.kpol, 1.000390167772142, 1e-12, 'k_pol калибровки');
  near(wr.F * wr.Mw, waterCalibrations(j0, 'b')[0].summary.value, 1e-12, 'F · M_w = D_кал');
  const rp = computePhotons({ ...form('А', '10 МВ', 'p', false), ctrl_M: [''] });
  near(binding.Dpl0 * b.mu, b.p.xl * (wr.ks * wr.kpol) / (rp.trs.ks * rp.trs.kpol), 2e-6, 'доза в пластинах с k_s, k_pol калибровки');
  assert.ok(Math.abs((binding.Dpl0 * b.mu) / b.p.xl - 1 - 0.002175) < 2e-5);
});

test('k_s и k_pol в пластинах: множитель к показанию, проверка ввода', () => {
  const cal = { ks: 1.004, kpol: 1.001 };
  assert.equal(kspolFactor({ ks: '', kpol: '' }, cal).factor, 1);
  near(kspolFactor({ ks: '1,002', kpol: '' }, cal).factor, 1.002 / 1.004, 1e-15, 'k_s');
  near(kspolFactor({ ks: '1,002', kpol: '1,0005' }, cal).factor, (1.002 * 1.0005) / (1.004 * 1.001), 1e-15, 'k_s · k_pol');
  assert.match(kspolFactor({ ks: '2' }, cal).errors[0], /от 0,9 до 1,1/);
  assert.match(kspolFactor({ ks: '1,002' }, null).errors[0], /неизвестен/);
});
