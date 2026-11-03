// Контрольные карты kV (0.49.0): журнал с 12 записями аппарата (tests/kv-fixture.js) — карта режима с сигналом
// последнего дня и полосой допуска, общая часть режимов, замечание справа, «Новый отсчёт карты» у записи, CSV с
// сигналами; по-английски без русского текста, на телефоне без прокрутки вбок.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startServer, launch, openPage, CYR } from './helpers.js';
import { kvHistoryJournal } from '../kv-fixture.js';

let server;
let browser;
before(async () => {
  server = await startServer();
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await server?.close();
});

test('kV-рентген: контрольная карта режима, общая часть режимов, новый отсчёт карты', async () => {
  const { j } = kvHistoryJournal();
  const { page, errors } = await openPage(browser);
  const pause = (ms = 300) => page.waitForTimeout(ms);
  await page.goto(`${server.url}/index.html#history`);
  await page.evaluate((jj) => localStorage.setItem('reference-dosimetry.journal.v1', JSON.stringify({ journal: jj })), j);
  await page.reload();
  await page.waitForSelector('#hs_machine');
  await page.selectOption('#hs_machine', { label: 'РТА' });
  await pause();
  for (const id of ['hs-kv-spc-sec', 'hs-kv-common-sec']) assert.ok(await page.locator(`#${id}`).isVisible(), id);
  assert.deepEqual(
    await page.locator('#hs-sheet section.hs-kv:visible .step-no').allInnerTexts(),
    ['2', '3', '4', '5', '6', '7'],
  );

  // 3. карта режима 1: 12 записей, сигнал 07.10.2026, полоса допуска от калибровки 05.05.2026
  assert.deepEqual(await page.locator('#hs_kv_spc_mode option').allInnerTexts(), ['1. 200 кВ, СПО 1,00 мм Cu', '2. 150 кВ, СПО 0,50 мм Cu']);
  assert.equal(await page.locator('#hs-kv-spc-chart svg').count(), 1);
  const sum = await page.locator('#hs-kv-spc-summary').innerText();
  assert.match(sum, /Стандартный тубус: Ø 10 см\. 0 % — [\d,]+ Гр\/мин \(05\.11\.2025, первая запись отсчёта\)\. База последней записи — [\d,]+ Гр\/мин \(калибровка 05\.05\.2026\), на карте \+0,15 %\./);
  assert.match(sum, /Текущий отсчёт — с 05\.11\.2025 \(с первой записи\), записей: 12\./);
  assert.match(sum, /Сигналы \(последние сверху\):\n+07\.10\.2026: \+1,50 % — точка за 3σ/);
  assert.match(await page.locator('#hs-kv-spc-legend').innerText(), /допуск от базы \(калибровка 05\.05\.2026\)/);
  await page.selectOption('#hs_kv_spc_mode', { index: 1 });
  await pause();
  assert.match(await page.locator('#hs-kv-spc-summary').innerText(), /07\.10\.2026: \+1,50 % — точка за 3σ/);

  // 4. общая часть: сдвинулись все режимы вместе
  const common = await page.locator('#hs-kv-common-summary').innerText();
  assert.match(common, /Последний день \(07\.10\.2026\): общая часть \+1,4\d % по 2 режимам/);
  assert.match(common, /Сдвинулись все режимы вместе \(точка за 3σ/);
  // замечания справа
  const msgs = await page.locator('#hs-messages').innerText();
  assert.match(msgs, /Контрольная карта\s+1\. 200 кВ, СПО 1,00 мм Cu, 07\.10\.2026: точка за 3σ/i);
  assert.match(msgs, /Общая часть режимов\s+07\.10\.2026: \+1,4\d % — сдвинулись все режимы вместе/i);

  // CSV — сигнал в строке стандартного тубуса
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#hs-kv-csv')]);
  const csv = await readFile(await download.path(), 'utf8');
  assert.equal(csv.split('\r\n').filter((l) => /точка за 3σ/.test(l)).length, 2);

  // «Новый отсчёт карты» у записи 03.06.2026: отсчёт карты — с неё
  const item = page.locator('#hs-kv-records .jsessions > li').filter({ hasText: '03.06.2026' });
  await item.locator('[data-kv-spc]').click();
  await pause();
  assert.match(await page.locator('#hs-status').innerText(), /С этой записи контрольные карты режимов начинают новый отсчёт/);
  assert.match(await item.innerText(), /с этой записи — новый отсчёт контрольной карты/);
  assert.match(await page.locator('#hs-kv-spc-summary').innerText(), /Текущий отсчёт — с 03\.06\.2026 \(по отметке «новый отсчёт»\), записей: 5\./);
  assert.match(await item.locator('[data-kv-spc]').innerText(), /Убрать новый отсчёт карты/);
  await item.locator('[data-kv-spc]').click();
  await pause();
  assert.match(await page.locator('#hs-kv-spc-summary').innerText(), /записей: 12\./);

  // по-английски — без русского текста (кроме названий, введённых пользователем)
  await page.locator('#lang_en').check();
  await pause(600);
  const ru = (t) => t.split('\n').filter((l) => CYR.test(l) && !/РТА|Ø|см/.test(l));
  for (const id of ['hs-kv-spc-sec', 'hs-kv-common-sec', 'hs-kv-sec']) assert.deepEqual(ru(await page.locator(`#${id}`).innerText()), [], id);
  await page.locator('#lang_ru').check();
  await pause(300);

  // на телефоне — без прокрутки страницы вбок
  await page.setViewportSize({ width: 390, height: 844 });
  await pause(400);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0);
  assert.deepEqual(errors, []);
});
