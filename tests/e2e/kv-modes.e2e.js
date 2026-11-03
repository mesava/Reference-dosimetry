// Вкладка «kV-рентген»: режимы аппарата (раздел 1), камера режима (раздел 2), сводка по режимам (раздел 9). Пример с двумя
// режимами: режим 2 без своих серий берёт k_pol и τ из режима 1; новая камера — k_pol не переносится; добавление и
// удаление режима и камеры; переход из сводки; протокол со всеми режимами; файл формата 3, файл 0.36 как один режим,
// черновик; по-английски без кириллицы.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startServer, launch, openPage } from './helpers.js';
import { SAMPLE_KV, SAMPLE_KV_ROWS } from '../../src/core/sample-kv.js';

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

const cyrLines = async (page) =>
  (await page.locator('#kv-sheet, #kv-readout').evaluateAll((els) => els.map((e) => e.innerText).join('\n')))
    .split('\n')
    .filter((l) => /[А-Яа-яЁё]/.test(l) && !/Загружен демонстрационный пример/.test(l));

test('kV-рентген: режимы аппарата — k_pol и τ из соседнего режима, камеры для всех режимов, сводка, протокол, файл; по-английски', async () => {
  const { ctx, page, errors } = await openPage(browser);
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const pause = (ms = 300) => page.waitForTimeout(ms);
  const chips = page.locator('#kv-modes .kv-mode');
  const sum = page.locator('#kv-sum-body tr');
  const cell = (i, o) => page.locator(`#kv-rows-body tr[data-i="${i}"] [data-o="${o}"]`).innerText();
  const text = (sel) => page.locator(sel).innerText();
  // таблица режимов: номер | кВ | мА | фильтр | СПО | камера
  const modeRows = () =>
    page.locator('#kv-modes tr').evaluateAll((trs) =>
      trs.map((tr) => [tr.querySelector('.kv-mode').textContent.trim(), ...['kv_kv', 'kv_ma', 'kv_filter', 'kv_hvl'].map((k) => tr.querySelector(`[data-k="${k}"]`).value), tr.querySelector('[data-ch]').selectedOptions[0].textContent].join(' | ')),
    );

  await page.goto(`${server.url}/index.html#kv`);
  await page.waitForSelector('#kv-messages li');
  // пустая вкладка: один режим, удалить нельзя; камера 1; в сводке одна строка
  assert.equal(await chips.count(), 1);
  assert.ok(await page.locator('#kv-btn-del-mode').isHidden());
  assert.deepEqual(await page.locator('#kv-mode-chamber option').allInnerTexts(), ['Камера 1 — камера не выбрана', '+ новая камера…']);
  assert.equal(await sum.count(), 1);
  assert.equal(await page.locator('#kv-s3').getAttribute('data-tag'), null);

  // пример: два режима, сводка — все строки обоих
  await page.click('#kv-btn-sample');
  await pause();
  assert.deepEqual(await modeRows(), ['1 | 200 | 10 | 0,5 мм Cu + 1 мм Al | 1,00 | 1 — PTW 30013 № 0000', '2 | 150 | 12 | 0,25 мм Cu + 1 мм Al | 0,50 | 1 — PTW 30013 № 0000']);
  assert.match(await page.locator('#kv-modes [data-m="0"]').getAttribute('aria-label'), /^Режим 1: 200 кВ, СПО 1,00 мм Cu; замечаний нет\. Открыть в разделах формы$/);
  assert.equal(await page.locator('#kv-modes [data-m="0"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#kv-modes [data-m="0"] .st').getAttribute('class'), 'st ok');
  assert.equal(await sum.count(), 5);
  const sumText = (await sum.allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
  assert.match(sumText[0], /^1\.1 200 кВ, СПО 1,00 мм Cu камера 1 Ø 10 см ст\. 50 1,0012 ?Гр\/мин, на 2 г\/см² 0,9950 \+0,62$/);
  assert.match(sumText[3], /^2\.1 150 кВ, СПО 0,50 мм Cu камера 1 Ø 10 см ст\. 50 0,9140 ?Гр\/мин, на 2 г\/см² 0,9100 \+0,44$/);
  assert.match(sumText[4], /^2\.2 6 × 8 см 50 0,8620/);
  assert.equal(await text('#kv-sum-note'), 'Режим 2: kpol и τ — из режима 1 (200 кВ, СПО 1,00 мм Cu).');
  assert.equal(await page.locator('#kv-s3').getAttribute('data-tag'), ' · режим 1');
  assert.equal(await page.locator('#kv-s2').getAttribute('data-tag'), null);
  assert.match(await text('#kv-mode-chamber-sub'), /^Камера 1 выбрана в режимах 1, 2: поля ниже меняют её во всех этих режимах\./);
  assert.ok(await page.locator('#kv-timer-from').isHidden());

  // режим 2: свои пучок и тубусы, k_pol и τ — из режима 1
  await page.click('#kv-modes [data-m="1"]');
  await pause();
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.m), '1');
  assert.equal(await page.inputValue('#kv_kv'), '150');
  assert.equal(await page.inputValue('#kv_hvl'), '0,50');
  assert.equal(await page.inputValue('#kv_ch_model'), 'PTW30013');
  assert.equal(await page.locator('#kv-rows-body tr').count(), 2);
  assert.deepEqual([await cell(0, 'd'), await cell(1, 'd')], ['0,9140', '0,8620']);
  assert.match(await text('#kv-row-of'), /^Режим 2 из 2 · 150 кВ, СПО 0,50 мм Cu · Строка 1 из 2 · Ø 10 см · РИП 50 см · стандартный тубус$/);
  assert.equal(await page.locator('#kv-s5').getAttribute('data-tag'), ' · режим 2');
  assert.match(await text('#kv-timer-from'), /^Своих данных ошибки таймера в этом режиме нет: τ взята из режима 1 \(200 кВ, СПО 1,00 мм Cu\)/);
  assert.match(await text('#kv-rows-note'), /В этом режиме серии при обратной полярности нет: kpol — из режима 1 \(200 кВ, СПО 1,00 мм Cu\), ближайшего по СПО с той же камерой\./);
  const msgs = await text('#kv-messages');
  assert.match(msgs, /τ = 0,0101 мин взята из режима 1 \(200 кВ, СПО 1,00 мм Cu\)/);
  assert.match(msgs, /k_?pol = 0,9995 взят из режима 1 \(200 кВ, СПО 1,00 мм Cu\)/);
  assert.equal(await page.inputValue('#kv_set_unit'), 'min');

  // «не учитывать» — τ не берётся, ошибка таймера не учтена
  await page.selectOption('#kv_timer_mode', 'none');
  await pause();
  assert.ok(await page.locator('#kv-timer-from').isHidden());
  assert.match(await text('#kv-messages'), /Ошибка таймера не учтена/);
  await page.selectOption('#kv_timer_mode', 'twopoint');
  await pause();
  assert.ok(await page.locator('#kv-timer-from').isVisible());

  // ввод в режиме 2 не меняет режим 1
  await page.fill('#kvr1_kv_env_T', '22,5');
  await pause();
  assert.notEqual(await cell(1, 'd'), '0,8620');
  assert.match((await sum.nth(1).innerText()).replace(/\s+/g, ' '), /0,9425/);
  await page.fill('#kvr1_kv_env_T', '21,7');
  await pause();

  // новая камера для режима 2: модель пустая, электрометр как у камеры 1; k_pol уже не переносится, τ — да
  await page.selectOption('#kv-mode-chamber', 'new');
  await pause();
  assert.deepEqual(await page.locator('#kv-mode-chamber option').allInnerTexts(), ['Камера 1 — PTW 30013 № 0000', 'Камера 2 — камера не выбрана', '+ новая камера…']);
  assert.equal(await page.inputValue('#kv-mode-chamber'), '1');
  assert.equal(await page.inputValue('#kv_ch_model'), '');
  assert.equal(await page.inputValue('#kv_el_model'), SAMPLE_KV.kv_el_model);
  assert.equal(await page.locator('#kv-s2').getAttribute('data-tag'), ' · камера 2');
  assert.doesNotMatch(await text('#kv-rows-note'), /kpol — из режима/);
  assert.ok(await page.locator('#kv-timer-from').isVisible());
  assert.ok(await page.locator('#kv-btn-del-ch').isVisible());
  // режим 1 по-прежнему с камерой 1
  assert.match((await sum.nth(0).innerText()).replace(/\s+/g, ' '), /камера 1/);
  assert.match((await sum.nth(3).innerText()).replace(/\s+/g, ' '), /камера 2/);
  // удаление камеры — вторым нажатием; режиму 2 снова назначается камера 1
  await page.click('#kv-btn-del-ch');
  await pause(100);
  assert.equal(await page.locator('#kv-mode-chamber option').count(), 3);
  await page.click('#kv-btn-del-ch');
  await pause();
  assert.equal(await page.locator('#kv-mode-chamber option').count(), 2);
  assert.equal(await page.inputValue('#kv_ch_model'), 'PTW30013');
  assert.match(await text('#kv-rows-note'), /kpol — из режима 1/);
  assert.match(await text('#kv-status'), /Камера 2 удалена; в режиме 2 выбрана камера 1/);

  // новый режим: тубусы режима 2 без показаний, пучок пустой; удаляется вторым нажатием
  await page.click('#kv-btn-add-mode');
  await pause();
  assert.equal(await chips.count(), 3);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'kv_kv');
  assert.equal(await page.inputValue('#kv_kv'), '');
  assert.equal(await page.inputValue('#kv-mode-chamber'), '0');
  assert.equal(await page.locator('#kv-rows-body tr').count(), 2);
  assert.equal(await page.inputValue('#kvr1_kv_cone_b'), '8');
  assert.equal(await page.inputValue('#kvr1_kv_M1_0'), '');
  assert.match(await page.locator('#kv-modes [data-m="2"]').getAttribute('aria-label'), /^Режим 3: пучок не задан; строки не заполнены/);
  assert.equal((await modeRows())[2], '3 |  |  |  |  | 1 — PTW 30013 № 0000');
  assert.equal(await page.locator('#kv-modes [data-m="2"] .st').getAttribute('class'), 'st empty');
  await page.click('#kv-btn-del-mode');
  await pause(100);
  assert.equal(await chips.count(), 3);
  await page.click('#kv-btn-del-mode');
  await pause();
  assert.equal(await chips.count(), 2);
  assert.equal(await page.inputValue('#kv_kv'), '150');

  // сводка: номер строки открывает режим и строку
  await page.click('#kv-sum-body tr[data-m="0"][data-i="1"] .kv-sum-pick');
  await pause();
  assert.equal(await page.locator('#kv-modes [data-m="0"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.inputValue('#kv_kv'), '200');
  assert.equal(await page.inputValue('#kv_env_T'), '21,4');
  assert.equal(await page.evaluate(() => document.activeElement?.closest('tr')?.dataset.i), '1');
  assert.match(await page.locator('#kv-sum-body tr[data-m="0"][data-i="1"]').getAttribute('class'), /active/);

  // протокол режима 2: все режимы коротко, подробно — выбранная строка, τ и k_pol из режима 1
  await page.click('#kv-modes [data-m="1"]');
  await pause();
  await page.click('#kv-btn-copy-report');
  await pause();
  const report = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(report, /Режимы аппарата \(2\); подробно ниже — режим 2, строка 2:\nРежим 1: 200 кВ, 10 мА, СПО 1,00 мм Cu, фильтр 0,5 мм Cu \+ 1 мм Al; камера 1 \(PTW 30013 № 0000\)\n {2}1\. Ø 10 см \(стандартный тубус\)/);
  assert.match(report, /\nРежим 2: 150 кВ, 12 мА, СПО 0,50 мм Cu, фильтр 0,25 мм Cu \+ 1 мм Al; камера 1 \(PTW 30013 № 0000\); k_pol и τ — из режима 1 \(200 кВ, СПО 1,00 мм Cu\)\n {2}1\. Ø 10 см \(стандартный тубус\), РИП 50 см; .*D = 0,9140 Гр\/мин на 2 г\/см², отклонение \+0,44 %\n/);
  assert.doesNotMatch(report, /\(k_pol из режима/);
  assert.match(report, /Пучок \(режим 2\): 150 кВ, 12 мА, СПО 0,50 мм Cu, фильтр 0,25 мм Cu \+ 1 мм Al\n/);
  assert.match(report, /τ = 0,0101 мин \(из режима 1 \(200 кВ, СПО 1,00 мм Cu\): в этом режиме не измерялась\)/);
  assert.match(report, /M\(V1, обратная\): в этом режиме не измерялось; k_pol из режима 1/);

  // файл формата 3: камеры, режимы, итоги всех строк; при открытии сверка по выбранной строке любого режима
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#kv-btn-save')]);
  const saved = JSON.parse(await readFile(await download.path(), 'utf8'));
  assert.equal(saved.version, 3);
  assert.equal(saved.mode, 1);
  assert.equal(saved.chambers.length, 1);
  assert.deepEqual(saved.modes.map((m) => m.rows.length), [3, 2]);
  assert.deepEqual(saved.modeResults.map((m) => m.map((x) => Math.round(x.value * 1e4) / 1e4)), [[1.0012, 0.9425, 1.0475], [0.914, 0.862]]);
  assert.equal(saved.form.kv_kv, '150');
  await page.click('#kv-btn-clear');
  await page.click('#kv-btn-clear');
  await pause();
  assert.equal(await chips.count(), 1);
  await page.setInputFiles('#kv-file-input', await download.path());
  await pause();
  assert.equal(await chips.count(), 2);
  assert.equal(await page.inputValue('#kv_kv'), '150');
  assert.match(await text('#kv-file-note'), /совпадает с сохранённым итогом/);
  await page.click('#kv-modes [data-m="0"]');
  await pause();
  assert.match(await text('#kv-file-note'), /совпадает с сохранённым итогом/);

  // черновик: после перезагрузки те же режимы и выбранный режим
  await page.reload();
  await page.waitForSelector('#kv-messages li');
  assert.equal(await chips.count(), 2);
  assert.equal(await page.inputValue('#kv_kv'), '200');
  assert.equal(await sum.count(), 5);

  // файл 0.36 (формат 2: строки одного режима) — один режим
  const v2 = { app: 'reference-dosimetry', module: 'kv', version: 2, form: SAMPLE_KV, rows: [SAMPLE_KV, ...SAMPLE_KV_ROWS], active: 0 };
  await page.setInputFiles('#kv-file-input', { name: 'v2.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(v2)) });
  await pause();
  assert.equal(await chips.count(), 1);
  assert.equal(await page.locator('#kv-rows-body tr').count(), 3);
  assert.equal(await cell(0, 'd'), '1,0012');
  assert.match(await text('#kv-row-of'), /^Строка 1 из 3 · /);

  // по-английски — без кириллицы, в том числе в режиме 2 (фильтр примера переводится)
  await page.click('#kv-btn-sample');
  await page.locator('#lang_en').check();
  await pause(600);
  assert.deepEqual(await modeRows(), ['1 | 200 | 10 | 0.5 mm Cu + 1 mm Al | 1.00 | 1 — PTW 30013 S/N 0000', '2 | 150 | 12 | 0.25 mm Cu + 1 mm Al | 0.50 | 1 — PTW 30013 S/N 0000']);
  assert.equal(await text('#kv-sum-note'), 'Mode 2: kpol and τ from mode 1 (200 kV, HVL 1.00 mm Cu).');
  assert.deepEqual(await cyrLines(page), []);
  await page.click('#kv-modes [data-m="1"]');
  await pause();
  assert.equal(await page.inputValue('#kv_filter'), '0.25 mm Cu + 1 mm Al');
  assert.match(await text('#kv-timer-from'), /^This mode has no timer error data of its own: τ is taken from mode 1 \(200 kV, HVL 1.00 mm Cu\)/);
  assert.deepEqual(await cyrLines(page), []);
  await page.locator('#lang_ru').check();
  await pause(300);
  assert.equal(await page.inputValue('#kv_filter'), '0,25 мм Cu + 1 мм Al');
  assert.deepEqual(errors, []);
});

test('kV-рентген: режимы и сводка по режимам на телефоне — без горизонтальной прокрутки страницы', async () => {
  const { page, errors } = await openPage(browser, { mobile: true, viewport: { width: 390, height: 844 } });
  await page.goto(`${server.url}/index.html#kv`);
  await page.waitForSelector('#kv-messages li');
  await page.click('#kv-btn-sample');
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0);
  assert.equal(await page.locator('#kv-sum thead').isVisible(), false);
  const cap = await page.locator('#kv-sum-body tr[data-m="1"][data-i="1"] td.v').nth(1).evaluate((e) => getComputedStyle(e, '::before').content);
  assert.equal(cap, '"D"');
  assert.deepEqual(errors, []);
});
