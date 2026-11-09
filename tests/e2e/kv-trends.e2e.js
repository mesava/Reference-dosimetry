// «Журнал и тренды» kV (0.48.0): после записанных калибровки и проверки выхода у аппарата — график выхода по режимам,
// сводная по датам (только калибровки или с проверками), её копия для Excel, режим по датам, CSV записей; по-английски
// без русского текста, на телефоне страница без прокрутки вбок.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startServer, launch, openPage, kvPage, CYR } from './helpers.js';

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

const rowsText = (page, sel) => page.locator(sel).evaluateAll((trs) => trs.map((tr) => tr.innerText.replace(/\s+/g, ' ').trim()));

test('kV-рентген: «Журнал и тренды» — выход по режимам, сводная по датам, режим по датам, CSV', async () => {
  const { ctx, page, errors } = await openPage(browser);
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const pause = (ms = 300) => page.waitForTimeout(ms);
  // калибровка 15.09.2026 (пример) и проверка выхода 20.10.2026 с теми же показаниями
  await page.goto(`${server.url}/index.html#kv/modes`);
  await page.waitForSelector('#kv-messages li');
  await page.click('#kv-btn-sample');
  await pause();
  await page.fill('#kv_machine', 'Xstrahl 300');
  await page.fill('#kv_institution', 'Клиника');
  await pause();
  await page.locator('#kv-jbind [data-kvj="save"]').click();
  await pause();
  const rec = page.locator('#kv-jrec [data-kvr="record"]');
  await rec.click();
  await pause();
  await page.fill('#kv_date', '2026-10-20');
  await page.selectOption('#kv_rec_mode', 'check');
  await pause();
  await kvPage(page, 'dose');
  for (const i of [0, 1, 2]) await page.fill(`#kvr${i}_kv_ref`, '');
  await pause();
  await rec.click();
  await pause();
  assert.match(await page.locator('#kv-status').innerText(), /^Измерение записано в журнал: Xstrahl 300, 20\.10\.2026, проверка выхода/);

  await page.goto(`${server.url}/index.html#history`);
  await page.selectOption('#hs_machine', { label: 'Xstrahl 300' });
  await pause();
  for (const id of ['hs-kv-out-sec', 'hs-kv-sum-sec', 'hs-kv-mode-sec', 'hs-kv-sec']) assert.ok(await page.locator(`#${id}`).isVisible(), id);
  assert.equal(await page.locator('#hs-sheet section.hs-beam:visible').count(), 0);

  // 2. выход по режимам: по линии на режим, полые значки — проверки
  assert.equal(await page.locator('#hs-kv-chart svg').count(), 1);
  const legend = await page.locator('#hs-kv-legend .item').allInnerTexts();
  assert.equal(legend.length, 4);
  assert.match(legend[0], /^1\. \d+ кВ, СПО [\d,]+ мм (Cu|Al) — Ø 10 см$/);
  assert.match(legend[1], /^2\. 150 кВ, СПО 0,500 мм Cu — Ø 10 см$/);
  assert.match(legend[2], /полый значок — проверка выхода/);

  // 3. сводная по датам: только калибровки, затем с проверками
  const head = () => page.locator('#hs-kv-sum thead th').allInnerTexts();
  assert.deepEqual((await head()).slice(3), ['15.09.2026']);
  const sum = await rowsText(page, '#hs-kv-sum tbody tr');
  assert.equal(sum.length, 5);
  assert.match(sum[0], /^1\. .+ Гр\/мин, на 2 г\/см² Ø 10 см ст\. 50 1,0012 [+−]0,62 %$/);
  await page.locator('#hs_kv_checks').check();
  await pause();
  assert.deepEqual((await head()).slice(3).map((s) => s.replace(/\s+/g, ' ').toLowerCase()), ['15.09.2026 калибровка', '20.10.2026 проверка']);
  assert.equal(await page.locator('#hs-kv-sum td.kv-sum-check').count(), 5);
  assert.match((await rowsText(page, '#hs-kv-sum tbody tr'))[0], /1,0012 [+−]0,62 % 1,0012 ±0,00 %$/);
  await page.click('#hs-kv-copy');
  await pause();
  const tsv = (await page.evaluate(() => navigator.clipboard.readText())).split('\n');
  assert.equal(tsv[0], 'Режим\tАппликатор\tРИП, см\tЕдиница\t15.09.2026\t20.10.2026');
  assert.equal(tsv.length, 6);
  assert.match(tsv[1], /\tØ 10 см\t50\tГр\/мин\t1,0012\t1,0012$/);

  // 4. режим по датам: новые сверху (у проверки свои серии вкладки — значения свои, без пометки «из калибровки»)
  const mode = await rowsText(page, '#hs-kv-mode tbody tr');
  assert.equal(mode.length, 2);
  assert.match(mode[0], /^20\.10\.2026 проверка 1,000 ± 0,\d{3} [+−][\d,]+ с 0,9995 — [\d,]+ [\d,]+ % CL [\d,]+ [\d,]+ %$/);
  // камера одна во всех записях режима — над таблицей
  assert.match(await page.locator('#hs-kv-mode .kv-mode-ch').innerText(), /^Камера: PTW 30013/);
  assert.match(mode[1], /^15\.09\.2026 калибровка /);
  assert.doesNotMatch(mode[1], /из калибровки/);
  const opts = await page.locator('#hs_kv_mode option').allInnerTexts();
  assert.equal(opts.length, 2);
  await page.selectOption('#hs_kv_mode', { index: 1 });
  await pause();
  assert.equal(await page.locator('#hs-kv-mode tbody tr').count(), 2);
  assert.match(await page.locator('#hs-kv-mode thead').innerText(), /СПО, мм Cu/);

  // 5. CSV записей аппарата: по строке на аппликатор режима в записи
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#hs-kv-csv')]);
  const csv = await readFile(await download.path(), 'utf8');
  assert.ok(csv.startsWith('﻿'));
  const lines = csv.slice(1).trimEnd().split('\r\n');
  assert.equal(lines.length, 1 + 10);
  assert.match(lines[0], /^Аппарат;Дата;Вид;Режим;/);
  assert.match(await page.locator('#hs-status').innerText(), /Записи аппарата выгружены в CSV/);

  // по-английски — без русского текста (кроме названий и обозначений, введённых пользователем)
  await page.locator('#lang_en').check();
  await pause(600);
  const ru = (t) => t.split('\n').filter((l) => CYR.test(l) && !/Xstrahl|Клиника|Ø|см/.test(l));
  for (const id of ['hs-kv-out-sec', 'hs-kv-sum-sec', 'hs-kv-mode-sec', 'hs-kv-sec']) assert.deepEqual(ru(await page.locator(`#${id}`).innerText()), [], id);
  await page.locator('#lang_ru').check();
  await pause(300);

  // на телефоне — без прокрутки страницы вбок (таблицы прокручиваются внутри)
  await page.setViewportSize({ width: 390, height: 844 });
  await pause(400);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0);
  assert.deepEqual(errors, []);
});
