// Протокол записи журнала (все пучки аппарата за день в одном режиме) — текстом для «Журнал и тренды»: учреждение,
// аппарат, дата, режим, протокол, сотрудники, условия; по каждому пучку — камера (со свидетельством), электрометр,
// итог, поправки, качество и замечания расчёта; проверки дозиметра второй камерой. Пучки считаются заново по
// записанным в журнал формам — так же, как во вкладке дозиметрии в день измерения.
import { L, refText } from '../core/i18n.js';
import { unitLabel, PRESSURE_UNITS } from '../core/units.js';
import { machineOf, chamberText, certText, electrometerText, chamberOf, electrometerOf, beamKind, beamKeys, orgText } from '../core/journal.js';
import { computePhotons } from '../core/photons.js';
import { computeElectrons } from '../core/electrons.js';
import { computeCobalt } from '../core/cobalt.js';
import { CHECK_REF } from '../core/journal-check.js';
import { fmt, fmtSigned, versionText } from './common.js';
import { fmtDate } from './journal-common.js';

const COMPUTE = { photon: computePhotons, electron: computeElectrons, cobalt: computeCobalt };
const atText = (s) => ({ dmax: 'd_max', zmax: 'z_max' })[s.at] ?? 'z_ref';
const qualityText = (sum, kind, tg) =>
  !Number.isFinite(sum.quality) ? '' : kind === 'electron' ? L(`R50 = ${fmt(sum.quality, 3)} г/см²`, `R50 = ${fmt(sum.quality, 3)} g/cm²`) : tg ? `%dd(10)x = ${fmt(sum.quality, 2)}` : `TPR20,10 = ${fmt(sum.quality, 4)}`;
const srcText = (code) => ({ measured: L('измерен', 'measured'), manual: L('введён', 'entered'), previous: L('из прежней проверки', 'from an earlier check'), assumed: L('принят 1', 'taken as 1') })[code] ?? '';

/** Текст протокола записи журнала s. */
export function sessionReportText(j, s) {
  const m = machineOf(j, s.machineId);
  const tg = s.protocol === 'tg51';
  const out = [];
  out.push(L('ПРОТОКОЛ: АППАРАТ ЗА ДЕНЬ', 'REPORT: MACHINE FOR THE DAY'));
  out.push(`${L('Учреждение', 'Institution')}: ${orgText(j) || '—'}`);
  out.push(`${L('Аппарат', 'Machine')}: ${[m?.name, m?.serial ? `${L('№', 'S/N')} ${m.serial}` : ''].filter(Boolean).join(', ') || '—'}`);
  const coOnly = s.beams.length > 0 && s.beams.every((b) => beamKind(b) === 'cobalt');
  out.push(`${L('Дата', 'Date')}: ${fmtDate(s.date)}; ${L('режим', 'mode')}: ${s.mode === 'cal' ? L('калибровка', 'calibration') : coOnly ? L('проверка выхода (k_pol, k_s и τ из последней калибровки)', 'output check (k_pol, k_s and τ from the last calibration)') : L('проверка выхода (k_pol и k_s из последней калибровки)', 'output check (k_pol and k_s from the last calibration)')}; ${L('протокол', 'protocol')}: ${tg ? 'TG-51' : 'TRS-398 Rev.1'}`);
  out.push(`${L('Сотрудники', 'Staff')}: ${(s.staff || []).filter((x) => String(x).trim()).join(', ') || '—'}`);
  const env = s.env || {};
  if (env.T || env.P) out.push(`${L('Условия', 'Conditions')}: T = ${env.T || '—'} °C; P = ${env.P || '—'} ${unitLabel(PRESSURE_UNITS[env.P_unit] || PRESSURE_UNITS.kPa)}${env.H ? `; ${L('влажность', 'humidity')} ${env.H} %` : ''}`);
  out.push('');
  for (const b of s.beams) {
    const kind = beamKind(b);
    const name = m?.beams.find((x) => x.id === b.beamId)?.name || '—';
    const ch = chamberOf(j, b.chamberId);
    const el = electrometerOf(j, b.electrometerId);
    const cert = certText(ch);
    out.push(`${name}: ${chamberText(ch) || L('камера не из журнала', 'chamber not from the journal')}${cert ? ` (${cert})` : ''}; ${electrometerText(el) || L('электрометр не из журнала', 'electrometer not from the journal')}`);
    const sum = b.summary || {};
    if (sum.ok) {
      const co = kind === 'cobalt';
      const v = co ? `${fmt(sum.value, 2)} ${L('сГр/мин на', 'cGy/min at')}` : `${fmt(sum.value, 4)} ${L('Гр на 100 МЕ на', 'Gy per 100 MU at')}`;
      const k = beamKeys(kind);
      const f = b.form || {};
      const dev = Number.isFinite(sum.deviation) ? `; ${co ? L('от ожидаемой', 'from expected') : L('от номинала', 'from nominal')} ${fmtSigned(sum.deviation, 2)} % (${sum.status === 'out' ? L('вне допуска', 'out of tolerance') : L('в допуске', 'within tolerance')} ±${fmt(sum.tol, sum.tol % 1 ? 1 : 0)} %)` : '';
      out.push(`  ${co ? L('Мощность дозы', 'Dose rate') : L('Доза', 'Dose')}: ${v} ${atText(sum)}${dev}`);
      out.push(`  ${tg ? 'P_pol' : 'k_pol'} = ${fmt(sum.kpolRaw, 4)}; ${tg ? 'P_ion' : 'k_s'} = ${fmt(sum.ksRaw, 4)}${sum.ksFixed ? ` (${[L('из калибровки', 'from the calibration'), f[k.fixedFrom]].filter(Boolean).join(' ')})` : ''}${co ? '' : `; ${sum.kQName || 'k_Q'} = ${fmt(sum.kQ, 4)}`}${Number.isFinite(sum.quality) ? `; ${qualityText(sum, kind, tg)}` : ''}`);
      // замечания расчёта — по записанной форме
      try {
        const r = COMPUTE[kind](b.form);
        for (const msg of r.messages.filter((x) => x.level !== 'info')) out.push(`  - ${msg.text}`);
      } catch {
        /* старая запись без полной формы */
      }
    } else out.push(`  ${L('Нет результата', 'No result')}`);
  }
  const checks = (s.checks || []).filter((c) => c.summary?.ok);
  if (checks.length) {
    out.push('', L(`ПРОВЕРКА ДОЗИМЕТРА ВТОРОЙ КАМЕРОЙ (${CHECK_REF})`, `DOSIMETER CHECK WITH A SECOND CHAMBER (${refText(CHECK_REF)})`));
    for (const c of checks) {
      const sum = c.summary;
      const name = m?.beams.find((x) => x.id === c.beamId)?.name || '—';
      const co = sum.kind === 'cobalt';
      const v = (x) => (co ? `${fmt(x, 2)} ${L('сГр/мин', 'cGy/min')}` : `${fmt(x, 4)} ${L('Гр на 100 МЕ', 'Gy per 100 MU')}`);
      out.push(`${name}: ${L('рабочая', 'working')} ${chamberText(chamberOf(j, sum.workChamberId)) || '—'}; ${L('вторая', 'second')} ${chamberText(chamberOf(j, c.chamberId)) || '—'}`);
      out.push(`  ${L('На z_ref', 'At z_ref')}: ${L('рабочая', 'working')} ${v(sum.workValue)}, ${L('вторая', 'second')} ${v(sum.value)}; ${L('отношение', 'ratio')} ${fmt(sum.ratio, 4)} (${fmtSigned(sum.diff, 2)} %)`);
      out.push(`  ${tg ? 'P_pol' : 'k_pol'} = ${fmt(sum.kpol, 4)} (${srcText(sum.kpolSrc)}); ${tg ? 'P_ion' : 'k_s'} = ${fmt(sum.ks, 4)} (${srcText(sum.ksSrc)})`);
    }
  }
  if (s.notes) out.push('', `${L('Примечания', 'Notes')}: ${s.notes}`);
  // подписи сотрудников
  const staff = (s.staff || []).filter((x) => String(x).trim());
  out.push('', ...(staff.length ? staff : ['']).map((x) => `${x || L('ФИО', 'Name')} — ______________ (${L('подпись', 'signature')})`));
  out.push('', `${L('Калькулятор референсной дозиметрии', 'Reference dosimetry calculator')}, ${versionText()}`);
  return out.join('\n');
}
