// Контрольные карты журнала: карта пучка и общая часть сеансов.
//
// Общая часть сеанса. В сеансе все пучки аппарата меряют в один день одной камерой при одних температуре и давлении.
// Отклонение каждого пучка от его обычного уровня (центральной линии его карты) d = x − CL делится на общую для
// сеанса часть c — медиану d по пучкам — и собственную часть пучка e = d − c. Ряд c по сеансам — отдельный процесс со
// своей картой: если c вышла за свои границы, сдвинулись все пучки вместе и причина скорее общая (дозиметр, термометр
// и барометр, N_D,w, мониторная камера ускорителя); если велико e одного пучка (больше 3σ его карты) — причина в этом пучке.
// Медиана, а не среднее: один ушедший пучок не тянет за собой общую часть.
import { controlPoints } from './journal.js';
import { controlChart } from './spc.js';

/** Карта пучка: controlChart по точкам журнала; tol — допуск последнего сеанса пучка (по умолчанию 2 %). */
export function beamChart(j, machineId, beamId) {
  const pts = controlPoints(j, machineId, beamId);
  const tol = [...pts].reverse().find((p) => Number.isFinite(p.tol))?.tol ?? 2;
  return { ...controlChart(pts, { tol }), tol };
}

export const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  const n = s.length;
  if (!n) return NaN;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};

/** Собственная часть пучка считается заметной, если больше BEAM_Z его σ. */
export const BEAM_Z = 3;

/**
 * Общая часть записей по картам charts (Map id → карта ряда): keys — записи по порядку [{ key, date }], точка карты
 * относится к записи, если её поле field равно key. В записи учитываются ряды, у карты которых в этот момент есть границы
 * (не меньше 5 записей отсчёта); нужно хотя бы два таких ряда. Запись с подстройкой ускорителя берётся по значениям до
 * подстройки — относительно прежнего уровня. Возвращает { chart, rows, charts }: rows — точки карты общей части
 * (value = c, %; поле field — key) с beams: [{ beamId, d, e, z, sigma }] (beamId — id ряда).
 */
export function commonOf(charts, keys, field) {
  const rows = [];
  for (const { key, date } of keys) {
    const beams = [];
    let restart = '';
    let day = NaN;
    for (const [beamId, ch] of charts) {
      const p = ch.points.find((q) => q[field] === key);
      if (!p) continue;
      day = p.day;
      if (p.restart && ['equipment', 'geometry', 'applicator', 'manual'].includes(p.reason)) restart = p.reason;
      const seg = ch.segments[p.segment];
      if (!seg?.limits) continue;
      beams.push({ beamId, d: p.value - seg.cl, sigma: seg.sigma });
    }
    if (beams.length < 2) continue;
    const c = median(beams.map((b) => b.d));
    for (const b of beams) {
      b.e = b.d - c;
      b.z = b.e / b.sigma;
    }
    rows.push({ [field]: key, date, day, value: c, n: beams.length, beams, restart: !!restart && rows.length > 0, reason: restart || undefined });
  }
  const chart = controlChart(rows);
  return { chart, rows: chart.points, charts };
}

/**
 * Общая часть сеансов аппарата по пучкам beamIds (обычно — одного вида: фотоны, электроны или ⁶⁰Co): commonOf по
 * сеансам аппарата; у строк — sessionId.
 */
export function sessionCommon(j, machineId, beamIds) {
  const charts = new Map(beamIds.map((id) => [id, beamChart(j, machineId, id)]));
  const keys = j.sessions.filter((s) => s.machineId === machineId).map((s) => ({ key: s.id, date: s.date }));
  return commonOf(charts, keys, 'sessionId');
}
