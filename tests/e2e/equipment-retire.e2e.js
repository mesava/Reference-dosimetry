// «Оборудование»: списание камеры и электрометра (с 0.68.0). Сломанная камера с записями в журнале не удаляется, но её
// можно списать: она остаётся в журнале, уходит в конец ярлыков и не предлагается во вкладке дозиметрии.
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

const journal = {
  app: 'reference-dosimetry', module: 'journal', version: 2, institution: 'ЛОР',
  chambers: [
    { id: 'c1', kind: 'photon', form: { ch_model: 'PTW30013', ch_serial: '111', ch_ndw: '0,05235', ch_ndw_unit: 'Gy/nC' }, dueDate: '2030-01-01' },
    { id: 'c2', kind: 'photon', form: { ch_model: 'PTW30013', ch_serial: '222', ch_ndw: '0,05300', ch_ndw_unit: 'Gy/nC' }, dueDate: '2030-01-01' },
  ],
  electrometers: [
    { id: 'e1', form: { el_model: 'PTW UNIDOS Tango', el_serial: '1', el_kelec: '1,000' }, dueDate: '2030-01-01' },
    { id: 'e2', form: { el_model: 'IBA Dose 1', el_serial: '2', el_kelec: '1,000' }, dueDate: '2030-01-01' },
  ],
  machines: [{ id: 'm1', name: 'Versa HD', kind: 'linac', calGeo: {}, beams: [{ id: 'b1', kind: 'photon', name: '6 МВ', active: true, form: {} }] }],
  sessions: [{ id: 's1', machineId: 'm1', date: '2026-10-01', beams: [{ beamId: 'b1', kind: 'photon', chamberId: 'c1', electrometerId: 'e1' }] }],
};

test('оборудование: списать камеру с записями — остаётся в журнале, в конце ярлыков, во вкладке не предлагается; вернуть в работу', async () => {
  const { ctx, page, errors } = await openPage(browser);
  await ctx.addInitScript((d) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('reference-dosimetry.journal.v1', d);
      sessionStorage.setItem('seeded', '1');
    }
  }, JSON.stringify({ journal }));
  await page.goto(`${server.url}/index.html#equipment`);
  await page.waitForSelector('#eq-ctabs a');
  const pause = () => page.waitForTimeout(300);
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('reference-dosimetry.journal.v1')).journal);

  // камера с записями: «Удалить» недоступно, «Списать камеру» есть
  await page.locator('#eq-ctabs a[data-eq-id="c1"]').click();
  await pause();
  const card = page.locator('[data-card="chamber:c1"]');
  assert.equal(await card.locator('[data-del="chamber:c1"]').isDisabled(), true);
  await card.locator('[data-retire="chamber:c1"]').click();
  await pause();
  const j1 = await stored();
  assert.match(j1.chambers.find((c) => c.id === 'c1').retired, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(j1.sessions[0].beams[0].chamberId, 'c1', 'запись журнала не изменилась');
  // ярлык — в конце ряда, с пометкой; в карточке — пояснение и дата списания
  const tabs = page.locator('#eq-ctabs a');
  assert.deepEqual(await tabs.evaluateAll((as) => as.map((a) => a.dataset.eqId)), ['c2', 'c1']);
  assert.equal(await page.locator('#eq-ctabs a[data-eq-id="c1"]').getAttribute('data-state'), 'retired');
  assert.match(await page.locator('#eq-ctabs a[data-eq-id="c1"]').innerText(), /списана/);
  assert.match(await page.locator('[data-card="chamber:c1"] .jretired').innerText(), /Камера списана/);
  assert.match(await page.locator('[data-card="chamber:c1"] .chips').innerText(), /списана/);
  assert.equal(await page.locator('[data-card="chamber:c1"] input[data-bind$="|retired"]').count(), 1);
  // электрометр — так же
  await page.locator('#eq-etabs a[data-eq-id="e1"]').click();
  await pause();
  await page.locator('[data-retire="electrometer:e1"]').click();
  await pause();
  assert.deepEqual(await page.locator('#eq-etabs a').evaluateAll((as) => as.map((a) => a.dataset.eqId)), ['e2', 'e1']);
  assert.match(await page.locator('#eq-result').innerText(), /из них списано 1/);

  // вкладка «МВ фотоны»: в списках журнала только камера и электрометр в работе
  await page.goto(`${server.url}/index.html#photons`);
  await page.waitForSelector('#ph-jlink [data-jl-pick="chamber"]', { state: 'attached' });
  const optIds = (what) => page.locator(`#ph-jlink [data-jl-pick="${what}"] option`).evaluateAll((os) => os.map((o) => o.value).filter(Boolean));
  assert.deepEqual(await optIds('chamber'), ['c2']);
  assert.deepEqual(await optIds('electrometer'), ['e2']);

  // вернуть в работу
  await page.goto(`${server.url}/index.html#equipment`);
  await page.waitForSelector('#eq-ctabs a');
  await page.locator('#eq-ctabs a[data-eq-id="c1"]').click();
  await pause();
  await page.locator('[data-unretire="chamber:c1"]').click();
  await pause();
  assert.equal((await stored()).chambers.find((c) => c.id === 'c1').retired, '');
  assert.deepEqual(await page.locator('#eq-ctabs a').evaluateAll((as) => as.map((a) => a.dataset.eqId)), ['c1', 'c2']);
  assert.equal(await page.locator('[data-card="chamber:c1"] .jretired').count(), 0);
  assert.deepEqual(errors, []);
});
