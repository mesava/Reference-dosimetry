// «Журнал» → «Оборудование»: учреждение и подразделение, порядок разделов, выбор электрометра и камеры по
// производителю и модели, сведения о калибровке камеры и замечания у пучка; камеры отделения в списке камер вкладки.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, openPage } from './helpers.js';

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

const CYR = /[А-Яа-яЁё]/;

test('оборудование: подразделение, производитель → модель, калибровка камеры, камеры отделения во вкладке', async () => {
  const { page, errors } = await openPage(browser);
  await page.goto(`${server.url}/index.html#equipment`);
  await page.waitForSelector('#eq_department');
  const pause = () => page.waitForTimeout(250);

  // порядок разделов: учреждение, аппараты и пучки, электрометры, камеры
  const heads = await page.locator('#eq-sheet .step h2').allInnerTexts();
  assert.deepEqual(heads, ['Учреждение', 'Аппараты и пучки', 'Электрометры', 'Камеры']);

  await page.fill('#eq_institution', 'ООО Пример');
  await page.fill('#eq_department', 'Отделение лучевой терапии');
  // аппарат и пучок раньше камер и электрометров; у пучка в «Оборудовании» — только название
  await page.click('#eq-add-machine');
  await pause();
  await page.locator('[data-card^="machine:"] input[data-bind$="|name"]').fill('Versa HD');
  await page.locator('[data-add-beam]').click();
  await pause();
  await page.locator('[data-card^="beam:"] input[data-bind$="|name"]').fill('6 МВ');
  const beamCard = page.locator('[data-card^="beam:"]');
  assert.equal(await beamCard.locator('select:not([data-bind$="|geoOwn"])').count(), 0, 'у пучка нет выбора камеры и электрометра (только геометрия калибровки)');
  assert.equal(await beamCard.locator('input[data-bind$="|form.rd_V1"]').count(), 0, 'у пучка нет напряжений');

  // электрометры: производитель → модель; «Другой» — своё название
  await page.click('#eq-add-electrometer');
  await pause();
  const el1 = page.locator('[data-card^="electrometer:"]').nth(0);
  await el1.locator('select[data-bind$="|maker"]').selectOption('PTW');
  await pause();
  await el1.locator('select[data-bind$="|form.el_model"]').selectOption('PTW UNIDOS Tango');
  await pause();
  await page.click('#eq-add-electrometer');
  await pause();
  // электрометр — свой лист (с 0.52.0): видна карточка нового, у раздела — ярлыки
  assert.equal(await page.locator('[data-card^="electrometer:"]').count(), 1);
  assert.equal(await page.locator('#eq-etabs a').count(), 2);
  const el2 = page.locator('[data-card^="electrometer:"]');
  const el2id = (await el2.getAttribute('data-card')).split(':')[1];
  await el2.locator('select[data-bind$="|maker"]').selectOption('other');
  await pause();
  await el2.locator('input[data-bind$="|form.el_model"]').fill('Самодельный ЭМ-1');
  await pause();
  assert.deepEqual((await page.locator('#eq-etabs a').allInnerTexts()).map((t) => t.trim()), ['PTW UNIDOS Tango', 'Самодельный ЭМ-1']);

  // камера: производитель → модель, размеры из базы
  await page.click('#eq-add-chamber');
  await pause();
  const ch = page.locator('[data-card^="chamber:"]');
  await ch.locator('select[data-bind$="|maker"]').selectOption('PTW');
  await pause();
  await ch.locator('select[data-bind$="|form.ch_model"]').selectOption('PTW30013');
  await pause();
  assert.match(await ch.innerText(), /из базы: радиус полости 3,05 мм/);
  await ch.locator('input[data-bind$="|form.ch_serial"]').fill('739475');
  await ch.locator('input[data-bind$="|form.ch_ndw"]').fill('0,05235');
  await ch.locator('input[data-bind$="|calCert"]').fill('123');
  // камеру калибровали со вторым электрометром при −400 В
  await ch.locator('select[data-bind$="|calEl"]').selectOption(el2id);
  await pause();
  await ch.locator('input[data-bind$="|calV"]').fill('400');
  await ch.locator('input[data-bind$="|calV"]').press('Tab');
  await pause();
  await ch.locator('select[data-bind$="|calPol"]').selectOption('-');
  await pause();

  // вкладка «МВ фотоны» с пучком журнала: замечания о калибровке камеры — в блоке «Журнал» под результатом
  await page.goto(`${server.url}/index.html#photons`);
  await page.waitForSelector('#messages li');
  await page.locator('#ph-jbind [data-jb=machine]').selectOption({ label: 'Versa HD' });
  await page.waitForTimeout(300);
  await page.locator('#ph-jbind [data-jb=beam]').selectOption({ label: '6 МВ' });
  await page.waitForTimeout(500);
  assert.equal(await page.inputValue('#ch_serial'), '739475', 'камера журнала подставлена');
  // электрометр вкладки — PTW UNIDOS Tango (первый в журнале), а камеру калибровали с «Самодельным»
  await page.fill('#el_model', 'PTW UNIDOS Tango');
  await page.fill('#el_serial', '');
  await page.fill('#rd_V1', '300');
  await page.selectOption('#rd_polarity', '+');
  await page.waitForTimeout(500);
  const cal = await page.locator('#ph-jrec').innerText();
  assert.match(cal, /калибровалась с электрометром Самодельный ЭМ-1, а выбран PTW UNIDOS Tango/);
  assert.match(cal, /V₁ = 300 В отличается от напряжения калибровки камеры 400 В/);
  assert.match(cal, /Полярность измерения \(\+\) не та/);
  // V₁ = 400 В и отрицательная полярность — замечаний о напряжении и полярности нет
  await page.fill('#rd_V1', '400');
  await page.selectOption('#rd_polarity', '-');
  await page.waitForTimeout(500);
  assert.doesNotMatch(await page.locator('#ph-jrec').innerText(), /отличается от напряжения калибровки|Полярность измерения/);

  // вкладка «МВ фотоны»: камеры отделения в начале списка камер; выбор подставляет запись журнала
  await page.goto(`${server.url}/index.html#photons`);
  await page.waitForSelector('#messages li');
  await page.waitForSelector('#ch_model optgroup[data-jl-group] option', { state: 'attached' });
  const opt = page.locator('#ch_model optgroup[data-jl-group] option').first();
  assert.match(await opt.textContent(), /PTW 30013 № 739475/);
  await page.selectOption('#ch_model', await opt.getAttribute('value'));
  await page.waitForTimeout(500);
  assert.equal(await page.inputValue('#ch_model'), 'PTW30013');
  assert.equal(await page.inputValue('#ch_serial'), '739475');
  assert.equal(await page.inputValue('#ch_ndw'), '0,05235');
  assert.match(await page.locator('#ph-jlink').innerText(), /как в журнале/);

  // по-английски — без кириллицы в карточках оборудования (кроме введённых названий)
  await page.goto(`${server.url}/index.html#equipment`);
  await page.locator('#lang_en').check();
  await page.waitForTimeout(500);
  const card = (await page.locator('[data-card^="chamber:"]').innerText()).split('\n').filter((l) => CYR.test(l) && !/739475|ЭМ-1/.test(l));
  assert.deepEqual(card, []);
  assert.deepEqual(errors, []);
});

test('оборудование: аппараты, электрометры и камеры — листы с ярлыками, кнопки добавления над ярлыками', async () => {
  const { page, errors } = await openPage(browser);
  await page.goto(`${server.url}/index.html#equipment`);
  await page.waitForSelector('#eq_department');
  const pause = () => page.waitForTimeout(250);
  assert.ok(await page.locator('#eq-mtabs').isHidden(), 'без аппаратов ярлыков нет');
  for (const [btn, name] of [['#eq-add-machine', 'Halcyon'], ['#eq-add-machine', 'Versa HD'], ['#eq-add-cobalt', 'Тератрон'], ['#eq-add-kv', 'Терад 200']]) {
    await page.click(btn);
    await pause();
    // новый аппарат открыт своим листом, фокус — на названии
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.bind?.endsWith('|name')), true, `${name}: фокус на названии`);
    await page.locator('[data-card^="machine:"] input[data-bind$="|name"]').fill(name);
    await pause();
  }
  // одна карточка аппарата, ярлыки — по аппаратам, с видом аппарата
  assert.equal(await page.locator('[data-card^="machine:"]').count(), 1);
  assert.deepEqual((await page.locator('#eq-mtabs a').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim()), ['Halcyon ускоритель', 'Versa HD ускоритель', 'Тератрон ⁶⁰Co', 'Терад 200 рентгенотерапевтический']);
  assert.equal(await page.locator('#eq-mtabs a[aria-current="page"]').innerText().then((t) => t.split(/\s/)[0]), 'Терад');
  // кнопки добавления — над ярлыками и карточкой
  const y = async (sel) => (await page.locator(sel).boundingBox()).y;
  assert.ok((await y('#eq-add-machine')) < (await y('#eq-mtabs')), 'кнопки над ярлыками');
  assert.ok((await y('#eq-mtabs')) < (await y('[data-card^="machine:"]')), 'ярлыки над карточкой');
  // ярлык открывает аппарат; у аппарата с пучками — отметка
  await page.locator('#eq-mtabs a', { hasText: 'Versa HD' }).click();
  await pause();
  assert.equal(await page.locator('[data-card^="machine:"] input[data-bind^="machine|"][data-bind$="|name"]').inputValue(), 'Versa HD');
  // тип аппарата задаётся кнопкой добавления и не меняется (с 0.52.3): выбора «Тип» у ускорителя и ⁶⁰Co нет
  assert.equal(await page.locator('[data-card^="machine:"] select[data-bind$="|kind"]').count(), 0);
  await page.locator('#eq-mtabs a', { hasText: 'Тератрон' }).click();
  await pause();
  assert.equal(await page.locator('[data-card^="machine:"] select[data-bind$="|kind"]').count(), 0);
  assert.match(await page.locator('[data-card^="machine:"] .jcard-head').innerText(), /аппарат ⁶⁰Co/);
  await page.locator('#eq-mtabs a', { hasText: 'Versa HD' }).click();
  await pause();
  await page.locator('[data-add-beam]').click();
  await pause();
  await page.locator('[data-card^="beam:"] input[data-bind$="|name"]').fill('6 МВ');
  await pause();
  assert.equal(await page.locator('#eq-mtabs a', { hasText: 'Versa HD' }).getAttribute('data-state'), 'done');
  assert.equal(await page.locator('#eq-mtabs a', { hasText: 'Halcyon' }).getAttribute('data-state'), null);
  // открытый аппарат помнится после перезагрузки
  await page.reload();
  await page.waitForSelector('[data-card^="machine:"]');
  assert.equal(await page.locator('[data-card^="machine:"] input[data-bind^="machine|"][data-bind$="|name"]').inputValue(), 'Versa HD');
  // удалить открытый аппарат (без записей) — открывается следующий
  await page.locator('#eq-mtabs a', { hasText: 'Halcyon' }).click();
  await pause();
  const del = page.locator('[data-card^="machine:"] [data-del^="machine:"]');
  await del.click();
  await del.click();
  await pause();
  assert.equal(await page.locator('#eq-mtabs a').count(), 3);
  assert.equal(await page.locator('[data-card^="machine:"] input[data-bind^="machine|"][data-bind$="|name"]').inputValue(), 'Versa HD');
  // камеры: свой лист, кнопка над ярлыками; не заполнено — жёлтая отметка
  await page.click('#eq-add-chamber');
  await pause();
  await page.click('#eq-add-chamber');
  await pause();
  assert.equal(await page.locator('[data-card^="chamber:"]').count(), 1);
  assert.equal(await page.locator('#eq-ctabs a').count(), 2);
  assert.equal(await page.locator('#eq-ctabs a').nth(1).getAttribute('aria-current'), 'page');
  assert.equal(await page.locator('#eq-ctabs a').nth(0).getAttribute('data-state'), 'warn');
  assert.ok((await y('#eq-add-chamber')) < (await y('#eq-ctabs')));
  // по-английски — подписи ярлыков без кириллицы (кроме названий)
  await page.locator('#lang_en').check();
  await pause();
  assert.deepEqual((await page.locator('#eq-mtabs a small').allInnerTexts()), ['linac', '⁶⁰Co', 'x-ray therapy']);
  assert.deepEqual((await page.locator('#eq-ctabs a').allInnerTexts()).map((t) => t.trim()), ['New chamber', 'New chamber']);
  await page.locator('#lang_ru').check();
  await pause();
  assert.deepEqual(errors, []);
});

test('оборудование на телефоне: страница не шире экрана (длинные отметки «не заполнено» переносятся)', async () => {
  const { page, errors } = await openPage(browser, { viewport: { width: 360, height: 800 } });
  await page.goto(`${server.url}/index.html#equipment`);
  await page.waitForSelector('#eq_department');
  await page.click('#eq-add-machine');
  await page.waitForTimeout(250);
  await page.locator('[data-add-beam]').click();
  await page.locator('[data-add-ebeam]').click();
  await page.click('#eq-add-electrometer');
  await page.click('#eq-add-chamber');
  await page.waitForTimeout(400);
  for (const d of await page.locator('details[data-card^="beam:"]').all()) if (!(await d.getAttribute('open'))) await d.locator('summary').click();
  await page.waitForTimeout(250);
  for (const h of ['equipment', 'history', 'photons', 'electrons', 'co60']) {
    if (h !== 'equipment') await page.goto(`${server.url}/index.html#${h}`);
    await page.waitForTimeout(500);
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(sw <= 360, `${h}: ширина страницы ${sw} px при экране 360 px`);
  }
  assert.deepEqual(errors, []);
});

test('телефон: поля ввода не мельче 16 px — iOS не увеличивает страницу при вводе, и она не «уезжает» вбок', async () => {
  const { page, errors } = await openPage(browser, { viewport: { width: 390, height: 844 }, mobile: true });
  const small = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.module:not([hidden]) input, .module:not([hidden]) select, .module:not([hidden]) textarea')]
        .filter((e) => e.offsetParent && !/^(checkbox|radio|button|submit|file|range|color|hidden)$/.test(e.type))
        .map((e) => ({ id: e.id || e.name || e.className, size: parseFloat(getComputedStyle(e).fontSize) }))
        .filter((x) => x.size < 16),
    );
  await page.goto(`${server.url}/index.html#equipment`);
  await page.waitForSelector('#eq_department');
  await page.click('#eq-add-machine');
  await page.click('#eq-add-chamber');
  await page.waitForTimeout(400);
  for (const h of ['equipment', 'photons', 'electrons', 'co60', 'jaffe', 'uncertainty']) {
    if (h !== 'equipment') await page.goto(`${server.url}/index.html#${h}`);
    await page.waitForTimeout(500);
    if (h === 'photons') {
      await page.click('#btn-sample');
      await page.waitForTimeout(400);
    }
    assert.deepEqual(await small(), [], h);
    // Safari (WebKit) не обрезает рамкой текст выбранного пункта длинного списка, и он расширяет страницу (на «МВ
    // фотоны» — «Геометрия измерения дозы», «Как получен TPR20,10»); проверено в WebKitGTK. Защита — contain: paint.
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.module:not([hidden]) select')].filter((e) => !/paint/.test(getComputedStyle(e).contain)).map((e) => e.id)), [], `${h}: select без contain: paint`);
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(sw <= 390, `${h}: ширина страницы ${sw} px при экране 390 px`);
  }
  assert.deepEqual(errors, []);
});

test('оборудование: разметка из файла журнала (id записей, названия пучков) не выполняется на странице', async () => {
  const { ctx, page, errors } = await openPage(browser);
  const X = `"'><img src=x onerror="window.__xss=(window.__xss||0)+1">`;
  const journal = {
    app: 'reference-dosimetry', module: 'journal', version: 2,
    chambers: [{ id: `ch${X}`, kind: 'photon', form: { ch_model: 'PTW30013', ch_serial: '1' } }],
    electrometers: [{ id: `el${X}`, form: { el_model: 'PTW UNIDOS webline', el_serial: '2' } }],
    machines: [{ id: `m${X}`, name: `Аппарат${X}`, kind: 'linac', calGeo: {}, beams: [
      { id: `b${X}`, kind: 'photon', name: `6 МВ${X}`, geoOwn: true, form: {} },
      { id: 'b2', kind: 'photon', name: '10 МВ', form: {} },
    ] }],
    sessions: [],
  };
  await ctx.addInitScript((d) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('reference-dosimetry.journal.v1', d);
      sessionStorage.setItem('seeded', '1');
    }
  }, JSON.stringify({ journal }));
  await page.goto(`${server.url}/index.html#equipment`);
  await page.waitForSelector('[data-card^="machine:"]');
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.__xss), undefined, 'обработчик из файла не выполнен');
  assert.equal(await page.locator('#module-equipment img[src="x"]').count(), 0, 'в разметке нет элементов из файла');
  // название пучка со своей геометрией показано как текст
  const subs = await page.locator('#module-equipment .field .sub').allTextContents();
  assert.ok(subs.some((t) => t.includes(`своя у: 6 МВ${X}`)), subs.join(' | '));
  // поля по-прежнему связаны с записями: ввод меняет журнал
  await page.locator(`[data-card^="beam:"] input[data-bind$="|name"]`).first().fill('6 МВ БВФ');
  await page.waitForTimeout(300);
  const names = await page.evaluate(() => JSON.parse(localStorage.getItem('reference-dosimetry.journal.v1')).journal.machines[0].beams.map((b) => [b.id, b.name]));
  assert.deepEqual(names, [[`b${X}`, '6 МВ БВФ'], ['b2', '10 МВ']]);
  assert.deepEqual(errors, []);
});
