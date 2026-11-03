// Вкладка «kV-рентген», лист «СПО и k_Q» (0.43.0): измерение СПО режима (D₀, D₁, D₂, контрольный D₀; толщины числом
// или пластинами набора), СПО и U, бюджет, допуски по методике учреждения; таблица СПО и k_Q по всем режимам (номер
// открывает режим); набор пластин (добавить, удалить, измеренная толщина); измеренный СПО — в расчёт режима и на
// лист дозы; ошибка в толщине — расчёт по СПО таблицы режимов; пустой лист не печатается; по-английски и на телефоне.
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

const out = (page, k) => page.locator(`#kv-sheet output[data-hl="${k}"]`).innerText();
const sheetState = (page) => page.getAttribute('#kv-pages a[data-kv-go="hvl"]', 'data-state');
const hvlRows = (page) => page.locator('#kv-hvlq-body tr').evaluateAll((trs) => trs.map((tr) => tr.innerText.replace(/\s+/g, ' ').trim()));

test('kV-рентген: лист «СПО и k_Q» — измерение, бюджет, таблица режимов, набор пластин, СПО в расчёте', async () => {
  const { ctx, page, errors } = await openPage(browser);
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const pause = (ms = 300) => page.waitForTimeout(ms);
  await page.goto(`${server.url}/index.html#kv/hvl`);
  await page.waitForSelector('#kv-messages li');

  // пустой лист: выводов нет, бюджет скрыт, набора нет; в печать лист не идёт
  assert.equal(await out(page, 'hvl'), '—');
  assert.ok(await page.locator('#kv-hl-budget-box').isHidden());
  assert.equal(await page.locator('#kv-plates-body tr').count(), 0);
  await page.emulateMedia({ media: 'print' });
  assert.ok(await page.locator('section[aria-labelledby="kv-sh1"]').isHidden());
  await page.emulateMedia({ media: 'screen' });

  // демонстрационный пример: режим 1 — Cu1+Cu3+Cu4 и Cu1+Cu6, СПО 1,000 ± 0,0078 мм Cu
  await page.click('#kv-btn-sample');
  await pause();
  assert.equal(await page.locator('#kv-plates-body tr').count(), 6);
  assert.equal(await page.inputValue('#kv_hl_x1'), 'Cu1+Cu3+Cu4');
  assert.equal(await page.locator('#kv-hl-x1-sub').innerText(), '0,8510 мм Cu = Cu1 + Cu3 + Cu4; u = 0,0052 мм');
  assert.equal(await page.locator('#kv-hl-x2-sub').innerText(), '1,103 мм Cu = Cu1 + Cu6; u = 0,0042 мм');
  assert.ok(await page.locator('#kv-hl-ux1-f').isHidden());
  assert.match(await out(page, 'D0'), /^30,120 uA 0,02 %$/);
  assert.equal(await out(page, 'half'), '15,060');
  assert.equal(await out(page, 'r1'), '+10,9 %');
  assert.equal(await out(page, 'r2'), '−6,9 %');
  assert.equal(await out(page, 'ctrl'), '+0,02 %');
  assert.equal(await out(page, 'hvl'), '1,000');
  assert.equal(await out(page, 'U'), '0,0078');
  await page.locator('#kv-hl-budget-box summary').click();
  assert.equal(await page.locator('#kv-hl-budget tr').count(), 8);
  assert.match(await page.locator('#kv-hl-budget tr').last().innerText(), /U \(k = 2\), мм\s+0,0078/);
  // таблица по режимам: измеренный ± U, СПО в расчёте, соседние качества сертификата, k_Q, N_Q
  const rows = await hvlRows(page);
  assert.equal(rows.length, 2);
  assert.match(rows[0], /^1 200 кВ, СПО 1,00 мм Cu 1 — PTW 30013 № 0000 1,000 ± 0,0078 мм Cu, k = 2 1,000 измеренный 0,500 \(150 кВ\) – 1,050 \(200 кВ\) 1,0056 0,045554/);
  assert.match(rows[1], /0,500 ± 0,0086 мм Cu, k = 2 0,500 измеренный/);
  assert.equal(await sheetState(page), 'done');
  // измеренный СПО — в расчёте: подпись поля на листе 1, строка пучка на листе дозы, замечание
  await kvPage(page, 'modes');
  assert.equal(await page.locator('#kv-hvl-sub').innerText(), 'в расчёте — измеренный на листе «СПО и kQ»: 1,000 ± 0,0078 мм (k = 2)');
  await kvPage(page, 'dose');
  assert.equal(await page.locator('#kv-dose-beam').innerText(), 'Режим 1: 200 кВ · СПО 1,000 мм Cu (измеренный) · kQ = 1,0056 · τ = +0,61 с. СПО и kQ — лист «СПО и kQ», τ — лист «Ошибка таймера».');
  assert.match(await page.locator('#kv-messages').innerText(), /СПО пучка — измеренный на листе «СПО и kQ»: 1,000 мм Cu/);

  // номер режима в таблице открывает режим
  await kvPage(page, 'hvl');
  await page.locator('#kv-hvlq-body .kv-hq-pick').nth(1).click();
  await pause();
  assert.equal(await page.locator('#kv-modebar-list [data-m="1"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.inputValue('#kv_hl_x1'), 'Cu1+Cu2+Cu3');
  assert.equal(await out(page, 'hvl'), '0,500');
  await page.locator('#kv-hvlq-body .kv-hq-pick').nth(0).click();
  await pause();

  // допуск по методике учреждения: D̄₁ от D̄₀/2 не более 5 % — предупреждение, лист с предупреждением
  await page.fill('#kv_hl_band_tol', '5');
  await pause();
  assert.ok(await page.locator('#kv-sheet output[data-hl="r1"]').evaluate((el) => el.classList.contains('flag-warn')));
  assert.equal(await sheetState(page), 'warn');
  await page.fill('#kv_hl_band_tol', '20');
  await pause();

  // набор пластин: измеренная толщина меняет x₂; новая пластина — следующее обозначение того же материала
  await page.locator('#kv-plates-body tr').nth(5).locator('input[data-pk="kv_pl_t"]').fill('1,012');
  await pause();
  assert.match(await page.locator('#kv-hl-x2-sub').innerText(), /^1,113 мм Cu = Cu1 \+ Cu6/);
  await page.locator('#kv-plates-body tr').nth(5).locator('input[data-pk="kv_pl_t"]').fill('1,002');
  await page.click('#kv-btn-add-plate');
  await pause();
  assert.equal(await page.locator('#kv-plates-body tr').count(), 7);
  assert.equal(await page.locator('#kv-plates-body tr').nth(6).locator('input[data-pk="kv_pl_name"]').inputValue(), 'Cu7');
  assert.equal(await page.locator('#kv-plates-body tr').nth(6).locator('select[data-pk="kv_pl_mat"]').inputValue(), 'Cu');
  await page.locator('#kv-plates-body [data-pl-del="6"]').click();
  await pause();
  assert.equal(await page.locator('#kv-plates-body tr').count(), 6);

  // толщина числом — поля u(x) и cov
  await page.fill('#kv_hl_x1', '0,851');
  await pause();
  assert.ok(await page.locator('#kv-hl-ux1-f').isVisible());
  assert.ok(await page.locator('#kv-hl-cov-f').isVisible());
  assert.ok(await page.locator('#kv-hl-ux2-f').isHidden());
  // пластины нет в наборе — ошибка, расчёт по СПО таблицы режимов
  await page.fill('#kv_hl_x1', 'Cu1+Cu99');
  await pause();
  assert.match(await page.locator('#kv-hl-x1-sub').innerText(), /пластины «Cu99» нет в наборе/);
  assert.equal(await out(page, 'hvl'), '—');
  assert.equal(await sheetState(page), 'error');
  assert.match((await hvlRows(page))[0], / не вычислен 1,000 из таблицы режимов /);
  await kvPage(page, 'modes');
  assert.equal(await page.locator('#kv-hvl-sub').innerText(), 'первый слой половинного ослабления');
  await kvPage(page, 'hvl');
  await page.fill('#kv_hl_x1', 'Cu1+Cu3+Cu4');
  await pause();
  // «Измеренный СПО — в расчёт режима» снят: в расчёте — СПО таблицы режимов
  await page.uncheck('#kv_hl_apply');
  await pause();
  assert.match((await hvlRows(page))[0], /1,000 ± 0,0078 мм Cu, k = 2 1,000 из таблицы режимов /);
  await kvPage(page, 'modes');
  assert.match(await page.locator('#kv-hvl-sub').innerText(), /^первый слой половинного ослабления; измеренный \(1,000 мм\) в расчёт не взят$/);
  await kvPage(page, 'hvl');
  await page.check('#kv_hl_apply');
  await pause();

  // протокол: измерение СПО по режимам и допуски
  await page.click('#kv-btn-copy-report');
  await pause();
  const report = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(report, /\nПучок \(режим 1\): 200 кВ, 10 мА, СПО 1,000 мм Cu \(измеренный\), /);
  assert.match(report, /\nСПО и k_Q по режимам:\n {2}Режим 1 \(200 кВ, СПО 1,00 мм Cu\): D₀: 30,11; 30,12; 30,13; x₁ = 0,8510 мм \(Cu1\+Cu3\+Cu4\): 16,70; 16,71; 16,70; x₂ = 1,103 мм \(Cu1\+Cu6\): /);
  assert.match(report, /Допуски измерения СПО \(по методике учреждения\): u_A среднего ≤ 1 %; D̄₁ и D̄₂ от D̄₀\/2 ≤ 20 %; контрольный D₀ от начального ≤ 1 %\./);

  // по-английски — лист без русского текста
  await kvPage(page, 'hvl');
  await page.locator('#lang_en').check();
  await pause(600);
  const texts = await page.locator('#kv-sheet section[data-kv-page="hvl"], #kv-messages, #kv-pages, #module-kv-secnav').allInnerTexts();
  const lines = texts.join('\n').split('\n').filter((l) => CYR.test(l));
  assert.deepEqual(lines, []);
  assert.equal(await page.locator('#kv-hl-x1-sub').innerText(), '0.8510 mm Cu = Cu1 + Cu3 + Cu4; u = 0.0052 mm');
  assert.match(await page.locator('#kv-hl-budget tr').nth(3).innerText(), /^x₁, mm/);
  await page.locator('#lang_ru').check();
  await pause(300);
  assert.deepEqual(errors, []);
});

test('kV-рентген: лист «СПО и k_Q» на телефоне — без прокрутки страницы вбок', async () => {
  const { page, errors } = await openPage(browser, { mobile: true, viewport: { width: 390, height: 844 } });
  await page.goto(`${server.url}/index.html#kv/modes`);
  await page.waitForSelector('#kv-messages li');
  await page.click('#kv-btn-sample');
  await page.waitForTimeout(300);
  await kvPage(page, 'hvl');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0);
  // кнопка удаления пластины целиком в строке
  const fits = await page.locator('#kv-plates-body tr').first().evaluate((tr) => {
    const b = tr.querySelector('[data-pl-del]').getBoundingClientRect();
    const r = tr.getBoundingClientRect();
    return b.right <= r.right + 1;
  });
  assert.ok(fits);
  assert.deepEqual(errors, []);
});
