// Сеанс: калибровка нескольких пучков одного аппарата подряд в воде, в референсных условиях TRS-398 Rev.1.
// План сеанса — вид пучков, аппарат, дата, режим и пучки по порядку. С 0.63.0 сеанс — лист вкладки «МВ фотоны» или
// «Электроны», и в плане только пучки этого вида (kind); план без вида (до 0.63.0) — все пучки аппарата. Каждый пучок
// измеряется на рабочем листе вкладки так же, как одиночный, и записывается в журнал (core/journal.js: recordTabBeam).
// Отдельного расчёта у сеанса нет: выполнен ли пучок и с каким итогом — по записи журнала за дату и режим сеанса.
import { machineOf, beamKind, lastCalibration } from './journal.js';

/** Вкладка дозиметрии для вида пучка. */
export const MODULE_OF = { photon: 'photons', electron: 'electrons', cobalt: 'co60' };

/** Виды пучков, у которых есть сеанс (у аппарата ⁶⁰Co пучок один). */
export const SESSION_KINDS = ['photon', 'electron'];

/** План сеанса: kind — вид пучков ('' — любые); active — сеанс начат; index — текущий пучок в beamIds. */
export const PLAN_DEFAULTS = { kind: '', active: false, machineId: '', date: '', mode: 'cal', beamIds: [], index: 0 };

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Действующие пучки аппарата в порядке «Оборудования»; kind — только пучки этого вида. */
export const machineBeams = (j, machineId, kind = '') => (machineOf(j, machineId)?.beams ?? []).filter((b) => b.active !== false && (!kind || beamKind(b) === kind));

/** Аппараты, у которых есть действующие пучки (kind — этого вида). */
export const sessionMachines = (j, kind = '') => j.machines.filter((m) => machineBeams(j, m.id, kind).length);

/**
 * План сеанса до 0.63.0 (один на все виды пучков) → планы по видам { photon, electron }: пучки — по виду, начатый
 * сеанс остаётся начатым у каждого вида, где есть его пучки; текущий — тот же пучок. Пучки ⁶⁰Co отбрасываются.
 */
export function splitPlan(j, plan) {
  const p = { ...PLAN_DEFAULTS, ...(plan && typeof plan === 'object' ? plan : {}) };
  const m = machineOf(j, String(p.machineId || ''));
  const ids = Array.isArray(p.beamIds) ? p.beamIds.map(String) : [];
  const cur = ids[Math.trunc(Number(p.index)) || 0];
  const out = {};
  for (const kind of SESSION_KINDS) {
    const beamIds = ids.filter((id) => m?.beams.some((b) => b.id === id && beamKind(b) === kind));
    out[kind] = normalizePlan(j, { ...p, kind, machineId: beamIds.length || !m ? p.machineId : '', beamIds, index: Math.max(0, beamIds.indexOf(cur)) });
  }
  return out;
}

/**
 * План, согласованный с журналом: аппарат и пучки, которых нет (удалены или выключены), отбрасываются, повторы — тоже;
 * режим — 'cal' или 'check', индекс — в пределах списка.
 */
export function normalizePlan(j, plan) {
  const p = { ...PLAN_DEFAULTS, ...(plan && typeof plan === 'object' ? plan : {}) };
  const kind = SESSION_KINDS.includes(p.kind) ? p.kind : '';
  const m = machineOf(j, String(p.machineId || ''));
  const ids = new Set(machineBeams(j, m?.id, kind).map((b) => b.id));
  const beamIds = [...new Set((Array.isArray(p.beamIds) ? p.beamIds : []).map(String))].filter((id) => ids.has(id));
  const index = Math.min(Math.max(0, Math.trunc(Number(p.index)) || 0), Math.max(0, beamIds.length - 1));
  return {
    kind,
    active: !!p.active && !!m && beamIds.length > 0 && ISO.test(String(p.date || '')),
    machineId: m?.id ?? '',
    date: ISO.test(String(p.date || '')) ? String(p.date) : '',
    mode: p.mode === 'check' ? 'check' : 'cal',
    beamIds,
    index,
  };
}

/**
 * Запись пучка в журнале за дату и режим сеанса: { session, entry } или null. Если пучок записан по обоим протоколам,
 * берётся TRS-398 Rev.1 (основной стандарт).
 */
export function beamRecord(j, plan, beamId) {
  const found = j.sessions
    .filter((s) => s.machineId === plan.machineId && s.date === plan.date && s.mode === plan.mode)
    .map((s) => ({ session: s, entry: s.beams.find((b) => b.beamId === beamId) }))
    .filter((x) => x.entry);
  return found.find((x) => x.session.protocol !== 'tg51') ?? found[0] ?? null;
}

/**
 * Ход сеанса: пучки по порядку плана — { beamId, name, kind, module, done, current, summary, protocol, lastCal } —
 * и сколько выполнено. summary — итог записи журнала (core/journal.js: beamSummary), lastCal — дата последней
 * калибровки пучка до даты сеанса (или '').
 */
export function planProgress(j, plan) {
  const p = normalizePlan(j, plan);
  const m = machineOf(j, p.machineId);
  const items = p.beamIds.map((id, i) => {
    const b = m.beams.find((x) => x.id === id);
    const kind = beamKind(b);
    const rec = beamRecord(j, p, id);
    const last = lastCalibration(j, id, { before: p.date || '9999-12-31' });
    return {
      beamId: id,
      name: b.name,
      kind,
      module: MODULE_OF[kind],
      done: !!rec,
      current: p.active && i === p.index,
      summary: rec?.entry.summary ?? null,
      protocol: rec ? (rec.session.protocol === 'tg51' ? 'tg51' : 'trs') : '',
      lastCal: last?.date ?? '',
    };
  });
  const done = items.filter((x) => x.done).length;
  return { plan: p, machine: m, items, done, total: items.length, finished: items.length > 0 && done === items.length };
}

/** Следующий невыполненный пучок после from (по кругу), кроме from; -1 — все выполнены. */
export function nextPending(j, plan, from = plan.index) {
  const { items } = planProgress(j, plan);
  for (let k = 1; k <= items.length; k++) {
    const i = (from + k) % items.length;
    if (!items[i].done && i !== from) return i;
  }
  return -1;
}
