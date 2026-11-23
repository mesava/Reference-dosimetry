// Файл журнала на диске: имена и хранение копий, решение «записать / взять из файла / конфликт».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backupName, backupsOf, backupsToDelete, backupDue, syncDecision, journalHasData, BACKUP_KEEP } from '../src/core/journal-backup.js';
import { setLang } from '../src/core/i18n.js';
import { newJournal } from '../src/core/journal.js';

test('Имя копии: «копия-журнала», остаток имени журнала без .json, дата и время по местным часам', () => {
  const d = new Date(2026, 9, 16, 9, 5, 7);
  assert.equal(backupName('журнал_ЛОР.json', d), 'копия-журнала_ЛОР_2026-10-16_090507.json');
  assert.equal(backupName('журнал.json', d), 'копия-журнала_2026-10-16_090507.json');
  assert.equal(backupName('Journal.JSON', d), 'копия-журнала_2026-10-16_090507.json');
  assert.equal(backupName('Терад.json', d), 'копия-журнала_Терад_2026-10-16_090507.json');
  assert.equal(backupName('журналы-2026.json', d), 'копия-журнала_журналы-2026_2026-10-16_090507.json');
  assert.equal(backupName('', d), 'копия-журнала_2026-10-16_090507.json');
  setLang('en');
  try {
    assert.equal(backupName('journal_ENT.json', d), 'journal-copy_ENT_2026-10-16_090507.json');
  } finally {
    setLang('ru');
  }
});

test('Копии журнала в папке: только свои (и прежние, до 0.67.0), от новых к старым; лишние сверх keep — на удаление', () => {
  const names = [
    'копия-журнала_2026-10-15_120000.json',
    'журнал_2026-10-16_090507.json', // копия до 0.67.0
    'journal-copy_2026-10-17_100000.json', // копия из английской версии
    'журнал_2026-10-01_080000.json',
    'журнал.json', // сам журнал
    'журнал_ЛОР_2026-10-16_090507.json', // копия другого журнала (до 0.67.0)
    'копия-журнала_ЛОР_2026-10-16_090507.json', // копия другого журнала
    'журнал_2026-10-16_0905.json', // не тот формат
    'заметки.txt',
  ];
  assert.deepEqual(backupsOf(names, 'журнал.json'), [
    'journal-copy_2026-10-17_100000.json', 'журнал_2026-10-16_090507.json', 'копия-журнала_2026-10-15_120000.json', 'журнал_2026-10-01_080000.json',
  ]);
  assert.deepEqual(backupsOf(names, 'журнал_ЛОР.json'), ['журнал_ЛОР_2026-10-16_090507.json', 'копия-журнала_ЛОР_2026-10-16_090507.json']);
  assert.deepEqual(backupsToDelete(names, 'журнал.json', 2), ['копия-журнала_2026-10-15_120000.json', 'журнал_2026-10-01_080000.json']);
  assert.deepEqual(backupsToDelete(names, 'журнал.json'), [], `хранится ${BACKUP_KEEP}`);
  // спецсимволы в имени не ломают отбор
  assert.deepEqual(backupsOf(['a(1)_2026-10-16_090507.json', 'a1_2026-10-16_090507.json', 'копия-журнала_a(1)_2026-10-17_090507.json'], 'a(1).json'),
    ['копия-журнала_a(1)_2026-10-17_090507.json', 'a(1)_2026-10-16_090507.json']);
});

test('Копия пустого журнала не делается: нет учреждения, оборудования и записей', () => {
  assert.equal(journalHasData(newJournal()), false);
  assert.equal(journalHasData(null), false);
  assert.equal(journalHasData({ ...newJournal(), institution: ' ' }), false);
  assert.equal(journalHasData({ ...newJournal(), institution: 'ЛОР' }), true);
  assert.equal(journalHasData({ ...newJournal(), machines: [{ id: 'm1' }] }), true);
  assert.equal(journalHasData({ ...newJournal(), kvRecords: [{ id: 'r1' }] }), true);
});

test('Копия не чаще заданного интервала; первая — сразу', () => {
  const now = new Date('2026-10-16T12:00:00Z');
  assert.equal(backupDue('', now), true);
  assert.equal(backupDue('2026-10-16T11:30:00Z', now, 60), false);
  assert.equal(backupDue('2026-10-16T11:00:00Z', now, 60), true);
  assert.equal(backupDue('2026-10-16T11:54:00Z', now, 5), true);
});

test('Запись в файл: не поверх версии, изменённой в другом месте', () => {
  assert.equal(syncDecision({ known: 1000, disk: 1000, dirty: false }), 'none');
  assert.equal(syncDecision({ known: 1000, disk: 1000, dirty: true }), 'write');
  assert.equal(syncDecision({ known: 1000, disk: 5000, dirty: false }), 'take-file');
  assert.equal(syncDecision({ known: 1000, disk: 5000, dirty: true }), 'conflict');
  // время изменения неизвестно — вслепую не пишем
  assert.equal(syncDecision({ known: NaN, disk: 5000, dirty: true }), 'conflict');
  assert.equal(syncDecision({ known: undefined, disk: 5000, dirty: false }), 'take-file');
});
