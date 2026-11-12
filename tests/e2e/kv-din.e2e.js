// Вкладка «kV-рентген» (0.49.3): металл СПО у строк сертификата, окно пересчёта СПО Al ↔ Cu по DIN 6809-4 (справочно,
// «не по Rev.1»), график ошибки таймера (задание от показания, как в книге учреждения) и линейность — удаление задания
// и график. Пример: поверка с качествами 100 и 120 кВ в мм Al и 140–200 кВ в мм Cu; по-английски — без кириллицы.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, openPage, CYR } from './helpers.js';

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

const CERT = [['100', '2,48', 'Al', '1,010'], ['120', '5,58', 'Al', '1,000'], ['140', '0,42', 'Cu', '0,995'], ['150', '0,768', 'Cu', '0,993'], ['200', '1,45', 'Cu', '0,990']];

test('kV-рентген: металл СПО сертификата, пересчёт по DIN 6809-4, графики таймера и линейности, удаление задания; по-английски', async () => {
  const { ctx, page, errors } = await openPage(browser);
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const pause = (ms = 300) => page.waitForTimeout(ms);
  await page.goto(`${server.url}/index.html#kv/modes`);
  await page.waitForSelector('#kv-messages li');
  await page.click('#kv-btn-sample');
  await pause();

  // металл новой строки — как у пучка и следует за диапазоном, пока его не выбрали вручную
  assert.equal(await page.inputValue('#kv_cq_mat_0'), 'Cu');
  assert.ok(await page.locator('#kv-din-box').isHidden());
  await page.selectOption('#kv_cal', 'ndw');
  await page.selectOption('#kv_qo', 'kv');
  await page.selectOption('#kv_cert_form', 'k');
  await page.fill('#kv_n', '0,05389');
  await pause();
  for (let i = 0; i < CERT.length; i++) {
    if ((await page.locator('#kv-cert-rows .pair-row').count()) <= i) await page.click('#kv-cert-add');
    await page.fill(`#kv_cq_kv_${i}`, CERT[i][0]);
    await page.fill(`#kv_cq_hvl_${i}`, CERT[i][1]);
    if (CERT[i][2] === 'Al') await page.selectOption(`#kv_cq_mat_${i}`, 'Al');
    await page.fill(`#kv_cq_val_${i}`, CERT[i][3]);
  }
  await pause();
  assert.deepEqual(await page.$$eval('#kv-cert-rows .cq-mat', (s) => s.map((x) => `${x.value}${x.dataset.auto ? '*' : ''}`)), ['Al', 'Al', 'Cu*', 'Cu*', 'Cu*']);
  // строки в мм Al без пересчёта в интерполяцию не идут — предупреждение и флажок пересчёта
  assert.ok(await page.locator('#kv-din-box').isVisible());
  assert.match(await page.locator('#kv-din-sub').innerText(), /строки 1, 2 — СПО в мм Al/);
  assert.match(await page.locator('#kv-messages').innerText(), /Строки 1, 2 сертификата — СПО в мм Al, а СПО пучка в мм Cu: в интерполяцию они не идут/);

  // окно пересчёта: таблица 5, сверка, строки сертификата, калькулятор; «Подставить в расчёт»
  await page.click('#kv-din-open');
  await pause();
  const dlg = page.locator('#kv-din-dialog');
  assert.ok(await dlg.isVisible());
  const body = await page.locator('#kv-din-body').innerText();
  assert.match(body, /TH 100\s+100\s+4,63\s+0,18/);
  assert.match(body, /TG-61, M150\s+10,2\s+0,67\s+0,689\s+\+2,8 %/);
  assert.match(body, /±5 % по СПО внутри TH 100–300/);
  assert.match(body, /1\s+100\s+2,480\s+≈ 0,067\s+вне табл\. 5 — экстраполяция/);
  assert.match(body, /Сейчас пересчёт выключен/);
  await page.fill('#kv-din-x', '5,58');
  await pause();
  assert.equal(await page.locator('#kv-din-out').innerText(), '≈ 0,242 мм Cu (±5 %)');
  await page.click('#kv-din-apply');
  await pause();
  assert.ok(await dlg.isHidden());
  assert.ok(await page.locator('#kv_cq_din').isChecked());
  assert.match(await page.locator('#kv-messages').innerText(), /пересчитан из мм Al в мм Cu по DIN 6809-4, табл\. 5 — это оценка, не TRS-398 Rev\.1/);
  assert.match(await page.locator('#kv-compliance').innerText(), /^Нестандартные условия/);
  // протокол: металл строк и пересчитанный СПО
  await page.click('#kv-btn-copy-report');
  await pause();
  const report = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(report, /Качества сертификата: 100 кВ \/ 2,48 мм Al \(≈ 0,067 мм Cu по DIN 6809-4, экстраполяция\) → 1,010; 120 кВ \/ 5,58 мм Al \(≈ 0,242 мм Cu по DIN 6809-4\) → 1,000; 140 кВ \/ 0,42 мм Cu → 0,995/);
  assert.match(report, /Пересчёт СПО Al ↔ Cu: DIN 6809-4, табл\. 5 \(оценка, не TRS-398 Rev\.1\)/);
  // «Не пересчитывать» — строки снова не используются, в протоколе — отдельной строкой
  await page.click('#kv-din-open');
  await pause();
  await page.click('#kv-din-off');
  await pause();
  assert.ok(!(await page.locator('#kv_cq_din').isChecked()));
  await page.click('#kv-btn-copy-report');
  await pause();
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /Не использованы \(СПО в другом металле\): 100 кВ \/ 2,48 мм Al → 1,010; 120 кВ \/ 5,58 мм Al → 1,000/);

  // ошибка таймера по двум заданиям (пример): график — задание от показания, прямая через −τ
  await page.goto(`${server.url}/index.html#kv/timer`);
  await pause();
  assert.ok(await page.locator('#kv-timer-chart-wrap').isVisible());
  assert.equal(await page.locator('#kv-timer-chart svg .pt').count(), 2 + 6 + 1);
  assert.match(await page.locator('#kv-timer-eq').innerText(), /^Прямая: T = [\d,]+·M − 0,6\d+ с \(через две точки\)\. При нулевом показании задание равно −τ, откуда τ = \+0,61 с/);
  // способа «X против n облучений» в списке нет; серия облучений — график с R²
  assert.equal(await page.locator('#kv_timer_mode option[value="nexp"]').evaluate((o) => o.hidden), true);
  await page.selectOption('#kv_timer_mode', 'measured');
  await pause();
  // задания серии — в минутах (по умолчанию в секундах), по одному показанию при задании
  await page.selectOption('#kv_ts_unit', 'min');
  const pairs = [['0,5', '4,02'], ['1', '8,02'], ['2', '16,02']];
  for (let j = 0; j < pairs.length; j++) {
    await page.fill(`#kv_ts_t_${j}`, pairs[j][0]);
    await page.fill(`#kv_ts_R_${j}_0`, pairs[j][1]);
  }
  await pause();
  assert.match(await page.locator('#kv-timer-eq').innerText(), /^Прямая: T = 0,12500·M − 0,0025000 мин, R² = 1,00000\. .*τ = \+0,0025 мин/);
  await page.selectOption('#kv_timer_mode', 'none');
  await pause();
  assert.ok(await page.locator('#kv-timer-chart-wrap').isHidden());

  // линейность: график и удаление задания со сдвигом следующих
  await page.goto(`${server.url}/index.html#kv/linearity`);
  await pause();
  const lnQ = ['0,5', '1', '2'];
  const lnM = [['5,01', '5,02', '5,01'], ['10,05', '10,04', '10,03'], ['20,12', '20,15', '20,13']];
  for (let i = 0; i < lnQ.length; i++) {
    await page.fill(`#kv_ln_q${i + 1}`, lnQ[i]);
    const cells = page.locator(`#kv-sheet .cells[data-series="kv_ln_M${i + 1}"] input`);
    for (let j = 0; j < 3; j++) await cells.nth(j).fill(lnM[i][j]);
    await pause(150);
  }
  await pause();
  assert.ok(await page.locator('#kv-ln-chart-wrap').isVisible());
  assert.equal(await page.locator('#kv-ln-chart svg .pt').count(), 3);
  assert.match(await page.locator('#kv-ln-eq').innerText(), /^Прямая по точкам: M̄ = 10,\d+·Q [+−] [\d,]+, R² = (0,99\d+|1,00000)\./);
  assert.ok(await page.locator('[data-ln-del="3"]').isHidden());
  await page.click('[data-ln-del="1"]');
  await pause();
  assert.equal(await page.inputValue('#kv_ln_q2'), '2');
  assert.equal(await page.inputValue('#kv_ln_q3'), '');
  assert.equal(await page.locator('#kv-sheet .cells[data-series="kv_ln_M2"] input').first().inputValue(), '20,12');
  assert.match(await page.locator('#kv-ln-eq').innerText(), /\(через две точки\)/);

  // по-английски — окно пересчёта и графики без кириллицы
  await page.locator('#lang_en').check();
  await pause(600);
  assert.ok(!CYR.test(await page.locator('#kv-ln-chart-wrap').innerText()), await page.locator('#kv-ln-chart-wrap').innerText());
  await page.goto(`${server.url}/index.html#kv/modes`);
  await pause();
  assert.equal(await page.inputValue('#kv_cq_hvl_1'), '5.58');
  await page.click('#kv-din-open');
  await pause();
  const en = await page.locator('#kv-din-dialog').innerText();
  assert.ok(!CYR.test(en), en.split('\n').filter((l) => CYR.test(l)).join('\n'));
  assert.match(en, /HVL conversion Al ↔ Cu with DIN 6809-4 \(for reference\)/);
  await page.click('#kv-din-close');
  await page.goto(`${server.url}/index.html#kv/timer`);
  await pause();
  assert.ok(!CYR.test(await page.locator('#kv-s3').locator('xpath=ancestor::section').innerText()));
  await page.locator('#lang_ru').check();
  await pause(300);
  assert.deepEqual(errors, []);
  await ctx.close();
});
