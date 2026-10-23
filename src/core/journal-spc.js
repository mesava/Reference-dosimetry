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
 * Общая часть сеансов аппарата по пучкам beamIds (обычно — одного вида: фотоны, электроны или ⁶⁰Co).
 * В сеансе учитываются пучки, у карты которых в этот момент есть границы (не меньше 5 сеансов отсчёта); нужно хотя бы
 * два таких пучка. Сеанс с подстройкой ускорителя берётся по значениям до подстройки — относительно прежнего уровня.
 * Возвращает { chart, rows, charts }: rows — точки карты общей части (value = c, %) с beams: [{ beamId, d, e, z, sigma }].
 */
export function sessionCommon(j, machineId, beamIds) {
  const charts = new Map(beamIds.map((id) => [id, beamChart(j, machineId, id)]));
  const rows = [];
  for (const s of j.sessions) {
    if (s.machineId !== machineId) continue;
    const beams = [];
    let restart = '';
    let day = NaN;
    for (const [beamId, ch] of charts) {
      const p = ch.points.find((q) => q.sessionId === s.id);
      if (!p) continue;
      day = p.day;
      if (p.restart && (p.reason === 'equipment' || p.reason === 'geometry' || p.reason === 'manual')) restart = p.reason;
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
    rows.push({ sessionId: s.id, date: s.date, day, value: c, n: beams.length, beams, restart: !!restart && rows.length > 0, reason: restart || undefined });
  }
  const chart = controlChart(rows);
  return { chart, rows: chart.points, charts };
}
