// Выгрузка журнала в CSV: формат для русского и английского Excel, строки по пучкам, сигналы карты, общая часть.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { journalCsv, csvFileName } from '../src/core/journal-csv.js';
import { beamSummary } from '../src/core/journal.js';
import { computePhotons } from '../src/core/photons.js';
import { SAMPLE_FORM as SAMPLE } from '../src/core/sample.js';
import { setLang } from '../src/core/i18n.js';

const noise = (i) => [0.1, -0.15, 0.05, 0.2, -0.1, -0.05, 0.15, -0.2, 0.0, 0.1][i % 10];
const sum = (deviation, extra = {}) => ({ ok: true, hasValue: true, value: 1 + deviation / 100, at: 'dmax', deviation, tol: 2, status: Math.abs(deviation) > 2 ? 'out' : 'ok', source: 'ctrl', preDeviation: NaN, kpolRaw: 1.0003, ksRaw: 1.0052, ksFixed: false, kQ: 0.9875, quality: 0.6805, ndw: 0.05389, kelec: 1, ...extra });

function journal() {
  const beams = ['b6', 'b10'];
  return {
    institution: 'Отделение; № 1',
    chambers: [{ id: 'c1', form: { ch_model: 'PTW30013', ch_serial: '7' } }],
    electrometers: [{ id: 'e1', form: { el_model: 'UNIDOS', el_serial: '3' } }],
    machines: [{ id: 'm1', name: 'Versa HD', serial: '151', beams: [{ id: 'b6', kind: 'photon', name: '6 МВ' }, { id: 'b10', kind: 'photon', name: '10 МВ' }] }],
    sessions: Array.from({ length: 8 }, (_, i) => ({
      id: `s${i}`,
      machineId: 'm1',
      date: `2026-0${1 + i}-15`,
      mode: i ? 'check' : 'cal',
      protocol: 'trs',
      staff: ['Иванов И. И.', ''],
      notes: i === 7 ? 'после "ремонта"\nмонитора' : '',
      env: { T: '21,5', P: '100,1', P_unit: 'kPa' },
      beams: beams.map((b, k) => ({ beamId: b, chamberId: 'c1', electrometerId: 'e1', summary: sum((i === 7 ? 1.5 : 0) + noise(i + 3 * k)) })),
    })),
  };
}

test('CSV для русского Excel: метка UTF-8, «;», десятичная запятая, кавычки', () => {
  setLang('ru');
  const text = journalCsv(journal());
  assert.ok(text.startsWith('﻿'), 'метка порядка байтов');
  const lines = text.slice(1).split('\r\n').filter(Boolean);
  // строки в примечании с переводом строки — внутри кавычек
  const rows = text.slice(1).match(/(?:[^\r\n"]|"(?:[^"]|"")*")+/g);
  assert.equal(rows.length, 1 + 8 * 2, 'заголовок + по строке на пучок в сеансе');
  const head = rows[0].split(';');
  assert.equal(head[0], 'Аппарат');
  assert.ok(head.includes('Сигналы контрольной карты'));
  const r1 = rows[1].split(';');
  assert.equal(r1[0], 'Versa HD');
  assert.equal(r1[2], '2026-01-15');
  assert.equal(r1[3], 'калибровка');
  assert.match(r1[7], /^1,00\d{3}$/, 'доза с запятой');
  assert.equal(r1[8], 'Гр/100 МЕ');
  assert.equal(r1[14], '1,00030', 'k_pol');
  assert.match(r1[20], /^PTW 30013.* № 7$/, 'камера с номером');
  assert.equal(r1[21], '0,053890', 'N_D,w');
  assert.ok(lines.length > 0);
  // примечание с кавычками и переводом строки
  assert.ok(text.includes('"после ""ремонта""\r\nмонитора"') || text.includes('"после ""ремонта""\nмонитора"'));
  // в последнем сеансе оба пучка сдвинулись на +1,5 %: сигнал карты и общая часть
  const last = rows.at(-1).split(';');
  assert.ok(/за 3σ/.test(rows.at(-1)), 'сигнал карты в последнем сеансе');
  assert.ok(rows.at(-1).includes('1,'), 'общая часть около +1,5 %');
  assert.ok(last.length >= head.length - 1);
});

test('CSV для английского Excel: «,» и точка; имя файла', () => {
  setLang('en');
  try {
    const text = journalCsv(journal());
    const rows = text.slice(1).match(/(?:[^\r\n"]|"(?:[^"]|"")*")+/g);
    assert.equal(rows[0].split(',')[0], 'Machine');
    const r1 = rows[1].split(',');
    assert.match(r1[7], /^1\.00\d{3}$/);
    assert.equal(r1[3], 'calibration');
    assert.equal(csvFileName({ institution: 'ENT dept' }, new Date(2026, 9, 16)), 'journal_ENT-dept_2026-10-16.csv');
  } finally {
    setLang('ru');
  }
  assert.equal(csvFileName({ institution: '' }, new Date(2026, 9, 16)), 'журнал_2026-10-16.csv');
});

test('Итог пучка хранит N_D,w и k_elec — для нового отсчёта карты при их смене', () => {
  const r = computePhotons(SAMPLE);
  const s = beamSummary(r, 'photon');
  assert.ok(Number.isFinite(s.ndw) && s.ndw > 0, `N_D,w: ${s.ndw}`);
  assert.ok(Number.isFinite(s.kelec), `k_elec: ${s.kelec}`);
});
