// Журнал kV для проверок трендов и контрольных карт: пример вкладки (два режима, одна камера), записанный 12 раз —
// калибровки 05.11.2025 и 05.05.2026, между ними ежемесячные проверки выхода. Показания всех серий строки (M₁,
// обратная полярность, V₂, контрольные) умножаются на множитель дня, так что мощность дозы меняется ровно на него, а
// поправки — нет. У режимов — только разброс около 0,2 %; в последний день оба режима выше на 1,5 % (общий сдвиг —
// сигнал и карт режимов, и общей части). Данные условные.
import { normalizeJournal, newJournal } from '../src/core/journal.js';
import { normalizeKvVisit, newKvMode } from '../src/core/kv-session.js';
import { kvMachineFromVisit } from '../src/core/kv-journal.js';
import { recordKvVisit } from '../src/core/kv-records.js';
import { SAMPLE_KV, SAMPLE_KV_ROWS, SAMPLE_KV_MODE2 } from '../src/core/sample-kv.js';

export const FIXTURE_TODAY = '2026-11-03';
export const FIXTURE_DATES = ['2025-11-05', '2025-12-03', '2026-01-14', '2026-02-04', '2026-03-04', '2026-04-08', '2026-05-05', '2026-06-03', '2026-07-08', '2026-08-05', '2026-09-02', '2026-10-07'];
export const FIXTURE_CALS = new Set(['2025-11-05', '2026-05-05']);
// разброс от записи к записи, % (условный, около 0,2 %)
const NOISE1 = [0, 0.18, -0.12, 0.25, -0.2, 0.05, 0.15, -0.22, 0.1, -0.05, 0.2, 0];
const NOISE2 = [0, -0.15, 0.2, -0.1, 0.12, -0.25, 0.05, 0.18, -0.08, 0.22, -0.12, 0];
/** Множители мощности дозы режимов в i-й день. */
export const fixtureFactor = (i) => {
  const shift = i === FIXTURE_DATES.length - 1 ? 1.5 : 0;
  return [1 + (NOISE1[i] + shift) / 100, 1 + (NOISE2[i] + shift) / 100];
};

const scale = (cells, k) => (cells ?? []).map((s) => (s ? (Number(String(s).replace(',', '.')) * k).toFixed(4).replace('.', ',') : s));

/** Пример вкладки: два режима, одна камера, k_s выключен. */
export function fixtureVisit() {
  const v = normalizeKvVisit({ form: SAMPLE_KV, rows: [SAMPLE_KV, ...SAMPLE_KV_ROWS], active: 0 });
  const m2 = newKvMode(v.modes[0]);
  Object.assign(m2.shared, SAMPLE_KV_MODE2.shared);
  m2.rows = SAMPLE_KV_MODE2.rows.map((r) => ({ ...r }));
  v.modes.push(m2);
  v.common.kv_machine = 'РТА';
  return normalizeKvVisit(v);
}

/** Журнал с аппаратом и 12 записями. Возвращает { j, machine, modeIds, records, visitOf (i → вкладка i-го дня) }. */
export function kvHistoryJournal({ upTo = FIXTURE_DATES.length } = {}) {
  const v = fixtureVisit();
  const res = kvMachineFromVisit(newJournal(), v);
  v.common.kv_jmachine = res.machineId;
  v.modes.forEach((md, i) => (md.shared.kv_jmode = res.modeIds[i]));
  let j = normalizeJournal(res.journal);
  // вкладка i-го дня
  const visitOf = (i) => {
    const date = FIXTURE_DATES[i];
    const w = structuredClone(v);
    Object.assign(w.common, { kv_date: date, kv_rec_mode: FIXTURE_CALS.has(date) ? 'cal' : 'check' });
    const f = fixtureFactor(i);
    w.modes.forEach((md, m) => {
      for (const r of md.rows) {
        Object.assign(r, { kv_ref: '', kv_M1: scale(r.kv_M1, f[m]), kv_Mopp: scale(r.kv_Mopp, f[m]), kv_M2: scale(r.kv_M2, f[m]), kv_Mc: scale(r.kv_Mc, f[m]) });
      }
    });
    return normalizeKvVisit(w);
  };
  const records = [];
  for (let i = 0; i < upTo; i++) {
    const rec = recordKvVisit(j, { visit: visitOf(i), today: FIXTURE_TODAY });
    if (rec.error) throw new Error(`${FIXTURE_DATES[i]}: ${rec.error}`);
    j = rec.journal;
    records.push(rec.record);
  }
  const machine = j.machines.find((x) => x.id === res.machineId);
  return { j, machine, modeIds: res.modeIds, records, visitOf };
}
