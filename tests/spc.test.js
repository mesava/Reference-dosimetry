// Контрольная карта выхода: I-MR, правила Western Electric, CUSUM, тренд; точки карты по сеансам журнала.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseline, controlChart, linearTrend, t975, D2, MIN_POINTS, BASELINE_POINTS } from '../src/core/spc.js';
import { controlPoints, upsertSession } from '../src/core/journal.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} ≠ ${b} (±${tol})`);
// детерминированный «шум» ±0,2 % без тренда
const noise = (i) => [0.1, -0.15, 0.05, 0.2, -0.1, -0.05, 0.15, -0.2, 0.0, 0.1][i % 10];
const pts = (values, step = 30) => values.map((value, i) => ({ day: 20000 + i * step, value }));

test('I-MR: CL — среднее, σ = MR̄/1,128', () => {
  const b = baseline([0, 1, 0, 1]);
  near(b.cl, 0.5, 1e-12, 'CL');
  near(b.mrBar, 1, 1e-12, 'MR̄');
  near(b.sigma, 1 / D2, 1e-12, 'σ');
  assert.equal(D2, 1.128);
});

test('Меньше 5 точек — границ и сигналов нет', () => {
  const r = controlChart(pts([0, 0.1, 5, -5]));
  assert.equal(r.current.limits, false);
  assert.ok(r.points.every((p) => !p.signals.length));
  assert.equal(MIN_POINTS, 5);
});

test('Точка за 3σ', () => {
  const v = Array.from({ length: 12 }, (_, i) => noise(i));
  v[11] = 1.5;
  const r = controlChart(pts(v));
  assert.ok(r.points[11].signals.includes('3s'), JSON.stringify(r.points[11]));
  assert.ok(r.points.slice(0, 11).every((p) => !p.signals.includes('3s')));
});

test('2 из 3 за 2σ по одну сторону; 8 подряд по одну сторону; 6 подряд растут', () => {
  const v = Array.from({ length: 20 }, (_, i) => noise(i));
  const r0 = controlChart(pts(v));
  const { cl, sigma } = r0.current;
  // 2 из 3: две точки за +2,5σ через одну
  const a = [...v, cl + 2.5 * sigma, cl, cl + 2.5 * sigma];
  const ra = controlChart(pts(a));
  assert.ok(ra.points.at(-1).watch.includes('2of3'));
  assert.ok(!ra.points.at(-1).signals.includes('2of3'), '2 из 3 — наблюдение, не сигнал');
  // 8 подряд выше CL (небольшое смещение, не за 2σ)
  const b = [...v, cl - 0.5 * sigma, ...Array(8).fill(cl + 0.5 * sigma)];
  const rb = controlChart(pts(b));
  assert.ok(rb.points.at(-1).watch.includes('run8'));
  assert.ok(!rb.points.at(-2).watch.includes('run8'), 'на седьмой точке ещё нет');
  // 6 подряд растут
  const c = [...v, ...[0, 1, 2, 3, 4, 5].map((k) => cl - sigma + 0.3 * k * sigma)];
  const rc = controlChart(pts(c));
  assert.ok(rc.points.at(-1).watch.includes('trend6'));
});

test('Границы — по первым 20 точкам и дальше не меняются; CUSUM замечает сдвиг на 1σ', () => {
  const v = Array.from({ length: BASELINE_POINTS }, (_, i) => noise(i));
  const r0 = controlChart(pts(v));
  const { cl, sigma } = r0.current;
  const shifted = [...v, ...Array(15).fill(0).map((_, i) => cl + sigma + noise(i) * 0.1)];
  const r = controlChart(pts(shifted));
  near(r.current.cl, cl, 1e-12, 'CL не сдвинулся');
  near(r.current.sigma, sigma, 1e-12, 'σ не сдвинулась');
  const first = r.points.findIndex((p) => p.signals.includes('cusumUp'));
  assert.ok(first > BASELINE_POINTS && first < BASELINE_POINTS + 15, `CUSUM: ${first}`);
  assert.ok(!r.points.some((p) => p.signals.includes('3s')), 'за 3σ сдвиг на 1σ не выходит — его ловит CUSUM');
  // после сигнала сумма обнуляется: точка сразу за сигналом сигнала CUSUM не даёт
  assert.ok(!r.points[first + 1].signals.includes('cusumUp'), 'сумма начата заново');
  // одиночный выброс не тянет сигнал за собой
  const spike = controlChart(pts([...v, cl + 6 * sigma, ...v.slice(0, 5)]));
  assert.ok(spike.points[BASELINE_POINTS].signals.includes('cusumUp'));
  assert.ok(spike.points.slice(BASELINE_POINTS + 1).every((p) => !p.signals.includes('cusumUp')));
});

test('Новый отсчёт: свои CL и σ после подстройки', () => {
  const v = Array.from({ length: 8 }, (_, i) => 1.5 + noise(i));
  const w = Array.from({ length: 6 }, (_, i) => noise(i + 3));
  const input = [...pts(v), ...pts(w).map((p, i) => ({ ...p, day: p.day + 400, restart: i === 0, reason: i === 0 ? 'adjust' : undefined }))];
  const r = controlChart(input);
  assert.equal(r.segments.length, 2);
  assert.equal(r.segments[1].reason, 'adjust');
  near(r.segments[0].cl, v.reduce((a, x) => a + x, 0) / v.length, 1e-12, 'CL до');
  near(r.segments[1].cl, w.reduce((a, x) => a + x, 0) / w.length, 1e-12, 'CL после');
  assert.ok(r.segments[1].provisional, '6 точек — границы предварительные');
  assert.ok(r.points.every((p) => !p.watch.includes('run8')), 'подстройка не даёт ложного «8 подряд»');
});

test('Тренд: значимость по t-критерию и прогноз выхода за допуск', () => {
  near(t975(10), 2.228, 1e-12, 't(10)');
  // дрейф +0,1 %/мес с шумом ±0,2 %
  const v = Array.from({ length: 12 }, (_, i) => 0.1 * i * (30.4375 / 30) + noise(i) * 0.5);
  const r = controlChart(pts(v), { tol: 2 });
  assert.ok(r.trend.significant);
  near(r.trend.perMonth, 0.1, 0.02, '%/мес');
  assert.equal(r.forecast.side, 1);
  const lastDay = r.points.at(-1).day;
  assert.ok(r.forecast.day > lastDay && r.forecast.day < lastDay + 365, `прогноз ${r.forecast.day - lastDay} сут`);
  // без дрейфа — незначим, прогноза нет
  const flat = controlChart(pts(Array.from({ length: 12 }, (_, i) => noise(i))), { tol: 2 });
  assert.equal(flat.trend.significant, false);
  assert.equal(flat.forecast, null);
  // прямая без разброса
  const lt = linearTrend([0, 1, 2, 3, 4], [0, 1, 2, 3, 4]);
  assert.equal(lt.significant, true);
});

test('Точки карты по журналу: подстройка — две точки и новый отсчёт; смена N_D,w и отметка пользователя', () => {
  const sum = (deviation, extra = {}) => ({ ok: true, deviation, value: 1 + deviation / 100, tol: 2, status: 'ok', source: 'ctrl', preDeviation: NaN, ndw: 0.0538, kelec: 1, ...extra });
  const sess = (id, date, summary, extra = {}) => ({ id, machineId: 'm1', date, mode: 'check', beams: [{ beamId: 'b1', chamberId: 'c1', electrometerId: 'e1', summary }], ...extra });
  const j = {
    machines: [{ id: 'm1', beams: [{ id: 'b1', name: '6 МВ' }] }],
    sessions: [
      sess('s1', '2026-01-10', sum(0.2)),
      sess('s2', '2026-02-10', sum(0.4)),
      sess('s3', '2026-03-10', sum(0.1, { source: 'recal', preDeviation: 2.4 })),
      sess('s4', '2026-04-10', sum(0.15)),
      sess('s5', '2026-05-10', sum(0.6, { ndw: 0.0541 })),
      sess('s6', '2026-06-10', sum(0.5, { ndw: 0.0541 })),
      sess('s7', '2026-07-10', sum(0.55, { ndw: 0.0541 }), { spcRestart: true }),
      // сеанс без коэффициентов (журнал до 0.16.0) — не новый отсчёт
      sess('s8', '2026-08-10', sum(0.5, { ndw: undefined, kelec: undefined })),
      sess('s9', '2026-09-10', sum(0.45), { machineId: 'm2' }),
    ],
  };
  const p = controlPoints(j, 'm1', 'b1');
  assert.deepEqual(
    p.map((x) => [x.sessionId, x.stage, x.value, x.restart, x.reason]),
    [
      ['s1', 'single', 0.2, false, undefined],
      ['s2', 'single', 0.4, false, undefined],
      ['s3', 'found', 2.4, false, undefined],
      ['s3', 'left', 0.1, true, 'adjust'],
      ['s4', 'single', 0.15, false, undefined],
      ['s5', 'single', 0.6, true, 'equipment'],
      ['s6', 'single', 0.5, false, undefined],
      ['s7', 'single', 0.55, true, 'manual'],
      ['s8', 'single', 0.5, false, undefined],
    ],
  );
  const r = controlChart(p, { tol: 2 });
  assert.deepEqual(r.segments.map((s) => s.reason), ['start', 'adjust', 'equipment', 'manual']);
});

test('Общая часть сеансов: сдвиг всех пучков вместе и сдвиг одного пучка различаются', async () => {
  const { sessionCommon, median } = await import('../src/core/journal-spc.js');
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 10]), 2.5);
  const beams = ['b6', 'b10', 'b15'];
  const offs = { b6: 0.2, b10: -0.1, b15: 0.4 };
  const sum = (deviation) => ({ ok: true, deviation, tol: 2, status: 'ok', source: 'ctrl', preDeviation: NaN });
  const mk = (n, extra = () => 0) =>
    Array.from({ length: n }, (_, i) => ({
      id: `s${i}`,
      machineId: 'm1',
      date: `2026-${String(1 + Math.floor(i / 2)).padStart(2, '0')}-${i % 2 ? '20' : '05'}`,
      mode: 'check',
      beams: beams.map((b, k) => ({ beamId: b, chamberId: 'c1', electrometerId: 'e1', summary: sum(offs[b] + noise(i + 3 * k) + extra(i, b)) })),
    }));
  // 10 спокойных сеансов, в последнем все пучки +1 %
  const j1 = { machines: [{ id: 'm1', beams: beams.map((id) => ({ id })) }], sessions: mk(11, (i) => (i === 10 ? 1 : 0)) };
  const r1 = sessionCommon(j1, 'm1', beams);
  const last1 = r1.rows.at(-1);
  near(last1.value, 1, 0.3, 'общая часть ≈ +1 %');
  assert.ok(last1.signals.includes('3s'), `общая часть за 3σ: ${JSON.stringify(last1)}`);
  assert.ok(last1.beams.every((b) => Math.abs(b.z) < 3), 'собственные части малы');
  // в последнем ушёл только 10 МВ
  const j2 = { machines: j1.machines, sessions: mk(11, (i, b) => (i === 10 && b === 'b10' ? -1.2 : 0)) };
  const r2 = sessionCommon(j2, 'm1', beams);
  const last2 = r2.rows.at(-1);
  assert.ok(Math.abs(last2.value) < 0.3, `общая часть мала: ${last2.value}`);
  assert.ok(!last2.signals.includes('3s'));
  const b10 = last2.beams.find((b) => b.beamId === 'b10');
  assert.ok(b10.z < -3, `10 МВ ушёл сам: z = ${b10.z}`);
  // до 5 сеансов у пучков нет границ — общей части тоже нет
  const j3 = { machines: j1.machines, sessions: mk(4) };
  assert.equal(sessionCommon(j3, 'm1', beams).rows.length, 0);
});

test('Повторная запись сеанса не снимает отметку «новый отсчёт карты»', () => {
  const j = { sessions: [{ id: 's1', date: '2026-01-01', spcRestart: true }] };
  assert.equal(upsertSession(j, { id: 's1', date: '2026-01-02' }).sessions[0].spcRestart, true);
  assert.equal(upsertSession(j, { id: 's1', date: '2026-01-02', spcRestart: false }).sessions[0].spcRestart, false);
});

test('Выброс в базе границ: точка за 3σ не входит в CL и σ, обычные точки не становятся «сдвигом»', () => {
  const v = Array.from({ length: 9 }, (_, i) => noise(i) * 0.3);
  const r = controlChart(pts([...v, 1.0]));
  const seg = r.current;
  assert.equal(seg.excluded, 1);
  assert.ok(Math.abs(seg.cl) < 0.02, `CL = ${seg.cl}`);
  assert.ok(seg.sigma < 0.1, `σ = ${seg.sigma}`);
  assert.ok(r.points[9].signals.includes('3s'));
  assert.ok(r.points.slice(0, 9).every((p) => !p.watch.includes('run8')), 'до выброса — без «8 подряд»');
  // без выбросов — как раньше
  const b = baseline([0, 1, 0, 1]);
  assert.deepEqual(b.excluded, []);
  // мало точек — ничего не исключается
  assert.deepEqual(baseline([0, 0.1, 0, 5]).excluded, []);
});

test('Частота ложных сигналов (моделирование): сигналы — только 3σ и CUSUM, остальные правила — наблюдения', () => {
  // стабильный процесс: границы по 20 точкам, затем 12 «сеансов»; детерминированный генератор
  let seed = 777;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const N = 2000;
  const rate = (shift, after, pick) => {
    let hits = 0;
    for (let t = 0; t < N; t++) {
      const r = controlChart(Array.from({ length: 20 + after }, (_, i) => ({ day: i * 30, value: gauss() + (i >= 20 ? shift : 0) })));
      if (r.points.slice(20).some(pick)) hits++;
    }
    return hits / N;
  };
  const sig = (p) => p.signals.length > 0;
  const any = (p) => p.signals.length > 0 || p.watch.length > 0;
  const falseSig = rate(0, 12, sig);
  const falseAny = rate(0, 12, any);
  assert.ok(falseSig > 0.1 && falseSig < 0.22, `ложный сигнал за 12 сеансов: ${falseSig}`);
  assert.ok(falseAny > falseSig + 0.04, `со всеми правилами чаще: ${falseAny} против ${falseSig}`);
  const detect = rate(1, 12, sig);
  assert.ok(detect > 0.6, `сдвиг 1σ за 12 сеансов замечен: ${detect}`);
});
