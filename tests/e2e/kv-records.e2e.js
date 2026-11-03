// Журнал kV (0.46.0): вид измерения во вкладке «kV-рентген», панель «Журнал» справа — «Записать в журнал» (аппарат за
// день; повторная запись заменяет), когда записать нельзя; «Журнал и тренды» для рентгенотерапевтического аппарата —
// записи, протокол измерений, «Открыть во вкладке» с возвратом прежних данных, удаление; в «Оборудовании» режим с
// записями не удалить; по-английски и на телефоне.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, openPage, kvPage, CYR } from './helpers.js';
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

const status = (page) => page.locator('#kv-status').innerText();
const rec = (page) => page.locator('#kv-jrec');
const recText = async (page) => (await rec(page).innerText()).replace(/\n+/g, '\n');
const recBtn = (page) => page.locator('#kv-jrec [data-kvr="record"]');

/** Пример со своим аппаратом, сохранённый в «Оборудование»: вкладка связана с аппаратом. */
async function linkedSample(page) {
  await page.goto(`${server.url}/index.html#kv/modes`);
  await page.waitForSelector('#kv-messages li');
  await page.click('#kv-btn-sample');
  await page.waitForTimeout(300);
  await page.fill('#kv_machine', 'Xstrahl 300');
  await page.fill('#kv_institution', 'Клиника');
  await page.waitForTimeout(300);
  await page.locator('#kv-jbind [data-kvj="save"]').click();
  await page.waitForTimeout(300);
}

test('kV-рентген: запись в журнал, «Журнал и тренды», протокол записи, «Открыть во вкладке»', async () => {
  const { page, errors } = await openPage(browser);
  const pause = (ms = 300) => page.waitForTimeout(ms);
  await page.goto(`${server.url}/index.html#kv/modes`);
  await page.waitForSelector('#kv-messages li');
  // вкладка не связана с аппаратом — панели «Журнал» нет; демонстрационный пример не записывается
  assert.ok(await rec(page).isHidden());
  await linkedSample(page);
  assert.ok(await rec(page).isVisible());
  assert.match(await recText(page), /^Журнал\nXstrahl 300 · калибровка · 15\.09\.2026\nВ запись: режимов 2, строк аппликаторов 5\./);
  assert.equal(await recBtn(page).innerText(), 'Записать в журнал');

  // дата не указана — записать нельзя
  await page.fill('#kv_date', '');
  await pause();
  assert.ok(await recBtn(page).isDisabled());
  assert.match(await recText(page), /Укажите дату измерения на листе «Аппарат и режимы»/);
  await page.fill('#kv_date', '2026-09-15');
  await pause();

  // записать: статус, панель — «заменить»
  await recBtn(page).click();
  await pause();
  assert.match(await status(page), /^Измерение записано в журнал: Xstrahl 300, 15\.09\.2026, калибровка — режимов 2, строк аппликаторов 5\./);
  assert.equal(await recBtn(page).innerText(), 'Заменить запись в журнале');
  assert.match(await recText(page), /Запись аппарата за эту дату уже есть в журнале \(калибровка\): она будет заменена\./);
  // вид измерения — проверка выхода; база строки 2 режима 1 ниже — вне допуска; заменить
  await page.selectOption('#kv_rec_mode', 'check');
  await kvPage(page, 'dose');
  await page.fill('#kvr1_kv_ref', '0,9100');
  await pause();
  assert.match(await recText(page), /Xstrahl 300 · проверка выхода · 15\.09\.2026/);
  assert.match(await recText(page), /вне допуска: 1/);
  await recBtn(page).click();
  await pause();
  assert.match(await status(page), /^Запись в журнале заменена: Xstrahl 300, 15\.09\.2026, проверка выхода — режимов 2, строк аппликаторов 5\. Вне допуска — требуется калибровка: режим 1, 6 × 8 см \(\+3,57 %\)\./);
  // протокол на листе «Сводка и протокол» — с видом измерения
  await kvPage(page, 'summary');
  assert.match(await page.locator('#kv-prot table.kv-prot-head').innerText(), /Вид измерения\tпроверка выхода/);

  // «Журнал и тренды»: аппарат в списке, запись
  await page.goto(`${server.url}/index.html#history`);
  await page.waitForSelector('#hs_machine');
  await page.selectOption('#hs_machine', { label: 'Xstrahl 300' });
  await pause();
  assert.ok(await page.locator('#hs-kv-sec').isVisible());
  assert.ok(await page.locator('#hs-chart').isHidden());
  const item = page.locator('#hs-kv-records .jsessions > li').first();
  assert.match(await item.innerText(), /^15\.09\.2026 · проверка выхода · режимов: 2, аппликаторов: 5 · вне допуска: режим 1, 6 × 8 см \(\+3,57 %\)/);
  assert.match(await item.innerText(), /Режим 1 — 200 кВ, СПО 1,00 мм Cu: Ø 10 см \(ст\.\) 1,0012 Гр\/мин \(\+0,62 %\) аппликаторов 3/);
  assert.match(await page.locator('#hs-result').innerText(), /^Xstrahl 300\nвне допуска: 1\n1запись\nпоследняя: 15\.09\.2026; последняя калибровка: —$/);

  // протокол записи — как на листе «Сводка и протокол»
  await item.locator('[data-report]').click();
  await pause();
  assert.match(await page.locator('#hs-report h2').innerText(), /^Протокол измерений: Xstrahl 300, 15\.09\.2026$/);
  assert.equal((await page.locator('#hs-report table.kv-prot-out tbody tr').allInnerTexts())[1].replace(/\s+/g, ' ').trim(), '6 × 8 см 50 2 г/см² 0,9100 0,9425 ±2 +3,57 требуется');
  assert.match(await page.locator('#hs-report').innerText(), /Радиационный выход вне допуска — требуется калибровка: режим 1, 6 × 8 см \(\+3,57 %\)\./);
  // печать — только протокол
  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => document.body.classList.add('print-hs-report'));
  assert.ok(await page.locator('#hs-kv-sec').isHidden());
  assert.ok(await page.locator('#hs-report').isVisible());
  await page.evaluate(() => document.body.classList.remove('print-hs-report'));
  await page.emulateMedia({ media: 'screen' });
  await page.locator('#hs-report [data-rep="close"]').click();
  await pause();
  assert.ok(await page.locator('#hs-report').isHidden());

  // во вкладке тем временем другие данные; «Открыть во вкладке» — запись, плашка, «Вернуть прежние данные»
  await page.goto(`${server.url}/index.html#kv/modes`);
  await page.waitForSelector('#kv-messages li');
  await page.fill('#kv_date', '2026-10-20');
  await kvPage(page, 'summary');
  await page.fill('#kv_notes', 'другое измерение');
  await pause();
  await page.goto(`${server.url}/index.html#history`);
  await page.selectOption('#hs_machine', { label: 'Xstrahl 300' });
  await pause();
  await page.locator('#hs-kv-records [data-kv-open]').first().click();
  await pause(500);
  assert.ok(await page.locator('#module-kv').isVisible());
  assert.match(await page.locator('#kv-journal-bar').innerText(), /^Запись журнала: Xstrahl 300, 15\.09\.2026, проверка выхода\./);
  assert.equal(await page.inputValue('#kv_date'), '2026-09-15');
  assert.equal(await page.inputValue('#kv_rec_mode'), 'check');
  assert.match(await page.locator('#kv-file-note').innerText(), /совпадает с сохранённым итогом/);
  assert.equal(await recBtn(page).innerText(), 'Заменить запись в журнале');
  await page.locator('#kv-journal-bar [data-jv="back"]').click();
  await pause();
  assert.ok(await page.locator('#kv-journal-bar').isHidden());
  assert.equal(await page.inputValue('#kv_date'), '2026-10-20');
  assert.equal(await page.inputValue('#kv_notes'), 'другое измерение');

  // «Оборудование»: режим и аппликатор с записями не удалить
  await page.goto(`${server.url}/index.html#equipment`);
  await pause();
  assert.ok(await page.locator('[data-del^="kvmode:"]').first().isDisabled());
  assert.ok(await page.locator('[data-del^="kvapp:"]').first().isDisabled());
  assert.ok(await page.locator('.jkv [data-del^="machine:"]').isDisabled());

  // удалить запись — со второго нажатия; режим снова можно удалить
  await page.goto(`${server.url}/index.html#history`);
  await page.selectOption('#hs_machine', { label: 'Xstrahl 300' });
  await pause();
  const del = page.locator('#hs-kv-records [data-kv-del]').first();
  await del.click();
  await del.click();
  await pause();
  assert.match(await page.locator('#hs-kv-records').innerText(), /Записей пока нет/);
  await page.goto(`${server.url}/index.html#equipment`);
  await pause();
  assert.ok(await page.locator('[data-del^="kvmode:"]').first().isEnabled());

  // по-английски — без русского текста в разделе записей и в панели «Журнал»
  await page.goto(`${server.url}/index.html#kv/summary`);
  await page.waitForSelector('#kv-messages li');
  await recBtn(page).click();
  await pause();
  await page.locator('#lang_en').check();
  await pause(600);
  const ru = (t) => t.split('\n').filter((l) => CYR.test(l) && !/Xstrahl|Клиника|Сотрудник|Иванов|Петров|другое измерение|Ø|см|демо/.test(l));
  assert.deepEqual(ru(await recText(page)), []);
  await page.goto(`${server.url}/index.html#history`);
  await page.selectOption('#hs_machine', { label: 'Xstrahl 300' });
  await pause();
  assert.deepEqual(ru(await page.locator('#hs-kv-sec').innerText()), []);
  await page.locator('#lang_ru').check();
  await pause(300);
  assert.deepEqual(errors, []);
});

test('kV-рентген: «Журнал и тренды» для рентгенотерапевтического аппарата на телефоне', async () => {
  const { page, errors } = await openPage(browser, { mobile: true, viewport: { width: 390, height: 844 } });
  await linkedSample(page);
  await page.locator('#kv-jrec [data-kvr="record"]').click();
  await page.waitForTimeout(300);
  await page.goto(`${server.url}/index.html#history`);
  await page.selectOption('#hs_machine', { label: 'Xstrahl 300' });
  await page.waitForTimeout(300);
  await page.locator('#hs-kv-records [data-report]').first().click();
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0);
  assert.ok(await page.locator('#hs-report table.kv-prot-out').isVisible());
  assert.deepEqual(errors, []);
});

test('kV-рентген: после перезагрузки страницы на вкладке kV панель «Журнал» и база «Сравнить с» — по журналу', async () => {
  // до 0.49.2 журнал загружался после вкладок: вкладка, связанная с аппаратом, при запуске считалась с пустым журналом
  // («Аппарат вкладки не найден», без базы из калибровки), пока не изменишь какое-нибудь поле
  const { j, visitOf } = kvHistoryJournal({ upTo: 11 });
  const v = visitOf(11);
  const { page, errors } = await openPage(browser);
  await page.goto(`${server.url}/index.html#kv/modes`);
  await page.evaluate(([jj, vv]) => {
    localStorage.setItem('reference-dosimetry.journal.v1', JSON.stringify({ journal: jj }));
    localStorage.setItem('reference-dosimetry.kv.v1', JSON.stringify({ version: 3, ...vv }));
  }, [j, v]);
  await page.reload();
  await page.waitForSelector('#kv-jrec:not([hidden])');
  await page.waitForTimeout(300);
  const t = await recText(page);
  assert.match(t, /РТА · проверка выхода · 07\.10\.2026/);
  assert.match(t, /Калибровка: 05\.05\.2026 \(режимы 1, 2\)\./);
  assert.doesNotMatch(t, /не найден/);
  assert.equal(await recBtn(page).isDisabled(), false);
  await kvPage(page, 'dose');
  assert.match(await page.locator('#kvr0_kv_ref').getAttribute('title'), /^Из калибровки 05\.05\.2026 \(журнал\)/);
  assert.deepEqual(errors, []);
  await page.context().close();
});
