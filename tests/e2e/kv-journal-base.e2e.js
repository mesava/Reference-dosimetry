// Журнал kV (0.47.0): после записанной калибровки проверка выхода берёт базу «Сравнить с» из неё (подсказка в поле,
// пометки под таблицей и в панели «Журнал», дата калибровки в протоколе); повторная запись того же дня — по режимам.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
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

const recText = async (page) => (await page.locator('#kv-jrec').innerText()).replace(/\n+/g, '\n');
const recBtn = (page) => page.locator('#kv-jrec [data-kvr="record"]');

test('kV-рентген: база «Сравнить с» из последней калибровки, протокол с датой калибровки, запись по режимам', async () => {
  const { page, errors } = await openPage(browser);
  const pause = (ms = 300) => page.waitForTimeout(ms);
  // пример со своим аппаратом в «Оборудовании» и записанная калибровка 15.09.2026
  await page.goto(`${server.url}/index.html#kv/modes`);
  await page.waitForSelector('#kv-messages li');
  await page.click('#kv-btn-sample');
  await pause();
  await page.fill('#kv_machine', 'Xstrahl 300');
  await page.fill('#kv_institution', 'Клиника');
  await pause();
  await page.locator('#kv-jbind [data-kvj="save"]').click();
  await pause();
  // первая калибровка: прежних калибровок нет — пометки о журнале нет
  assert.doesNotMatch(await recText(page), /Из последней калибровки|Калибровок в журнале/);
  await recBtn(page).click();
  await pause();

  // проверка выхода через месяц: базы строк — из калибровки
  await page.fill('#kv_date', '2026-10-20');
  await page.selectOption('#kv_rec_mode', 'check');
  await pause();
  assert.match(await recText(page), /Из последней калибровки режима: база «Сравнить с», а без своих серий — k_pol, k_s, τ и СПО\. Калибровка: 15\.09\.2026 \(режимы 1, 2\)\./);
  await kvPage(page, 'dose');
  await page.fill('#kvr0_kv_ref', '');
  await pause();
  const ref0 = page.locator('#kvr0_kv_ref');
  assert.equal(await ref0.getAttribute('placeholder'), '1,0012');
  assert.match(await ref0.getAttribute('title'), /^Из калибровки 15\.09\.2026 \(журнал\)/);
  // те же показания и поправки — отклонение 0
  assert.match(await page.locator('#kv-rows-body tr[data-i="0"] [data-o="dev"]').innerText(), /^[+−±]0,00$/);
  assert.match(await page.locator('#kv-rows-note').innerText(), /«Сравнить с» строк без своего значения — мощность дозы того же аппликатора при калибровке 15\.09\.2026 \(журнал\)/);
  // поле раздела 8 у выбранной строки — тоже подсказка
  assert.equal(await page.locator('#kv_ref').getAttribute('placeholder'), '1,0012');
  assert.match(await page.locator('#kv-ref-sub').innerText(), /^пусто — мощность дозы при калибровке 15\.09\.2026 \(журнал\)/);

  // протокол: база с датой калибровки
  await kvPage(page, 'summary');
  const first = (await page.locator('#kv-prot table.kv-prot-out tbody tr').first().innerText()).replace(/\s+/g, ' ').trim();
  assert.match(first, /Ø 10 см ст\. 50 2 г\/см² 1,0012 калибровка 15\.09\.2026 1,0012 ±2 [+−±]0,00 не требуется/);

  // запись проверки — отдельная запись (другой день)
  await recBtn(page).click();
  await pause();
  assert.match(await page.locator('#kv-status').innerText(), /^Измерение записано в журнал: Xstrahl 300, 20\.10\.2026, проверка выхода — режимов 2, строк аппликаторов 5\./);

  // в тот же день ещё раз — только режим 2 (режим 1 удалён из вкладки): заменяется только он
  await page.goto(`${server.url}/index.html#kv/modes`);
  await page.waitForSelector('#kv-modes tr[data-mr]');
  const del = page.locator('#kv-btn-del-mode');
  await del.click();
  await del.click();
  await pause();
  assert.equal(await page.locator('#kv-modes tr[data-mr]').count(), 1);
  assert.match(await recText(page), /За эту дату в журнале уже есть режим 1: его запись будет заменена, другие режимы этого дня останутся\./);
  await recBtn(page).click();
  await pause();
  assert.match(await page.locator('#kv-status').innerText(), /^Запись в журнале заменена: Xstrahl 300, 20\.10\.2026, проверка выхода — режимов 1, строк аппликаторов 2\./);
  await page.goto(`${server.url}/index.html#history`);
  await page.selectOption('#hs_machine', { label: 'Xstrahl 300' });
  await pause();
  const items = page.locator('#hs-kv-records .jsessions > li');
  assert.equal(await items.count(), 3);
  assert.match(await items.nth(0).innerText(), /^20\.10\.2026 · проверка выхода · режимов: 1, аппликаторов: 2/);
  assert.match(await items.nth(1).innerText(), /^20\.10\.2026 · проверка выхода · режимов: 1, аппликаторов: 3/);
  assert.match(await items.nth(1).innerText(), /Заменены более поздней записью того же дня: режим 2 \(150 кВ, СПО 0,500 мм Cu\)\./);
  // протокол прежней записи — с пометкой о замене
  await items.nth(1).locator('[data-report]').click();
  await pause();
  assert.match(await page.locator('#hs-report').innerText(), /режим 2 позже в тот же день записан заново/);

  // по-английски — панель «Журнал» без русского текста
  await page.goto(`${server.url}/index.html#kv/summary`);
  await page.waitForSelector('#kv-messages li');
  await page.locator('#lang_en').check();
  await pause(600);
  const ru = (t) => t.split('\n').filter((l) => CYR.test(l) && !/Xstrahl|Клиника|Сотрудник|Иванов|Петров|Ø|см|демо/.test(l));
  assert.deepEqual(ru(await recText(page)), []);
  await page.locator('#lang_ru').check();
  await pause(300);
  assert.deepEqual(errors, []);
});
