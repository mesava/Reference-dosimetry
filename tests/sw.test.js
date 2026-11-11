// Сервис-воркер (sw.js): файлы страницы — из сети с проверкой у сервера (cache: 'no-cache', с 0.52.2), чтобы после
// выкладки новая версия открывалась сразу, а не через 10 минут (max-age=600 у GitHub Pages); без сети — сохранённая копия.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

/** sw.js в песочнице: обработчики событий, fetch и caches — подменённые. */
function load({ online = true } = {}) {
  const handlers = {};
  const calls = [];
  const store = new Map();
  const cache = {
    put: async (req, res) => store.set(req.url, res),
    match: async (req) => store.get(typeof req === 'string' ? new URL(req, 'https://x.test/app/').href : req.url) ?? undefined,
    addAll: async () => {},
  };
  const ctx = {
    self: { location: { origin: 'https://x.test' }, addEventListener: (type, fn) => (handlers[type] = fn), skipWaiting: () => {}, clients: { claim: () => {} } },
    caches: { open: async () => cache, keys: async () => [], delete: async () => true },
    fetch: async (req, init) => {
      calls.push({ url: req.url, init });
      if (!online) throw new TypeError('offline');
      return { ok: true, body: 'fresh', clone() { return this; } };
    },
    URL,
  };
  vm.runInNewContext(SRC, ctx);
  const request = (url, mode = 'no-cors') => {
    let out;
    handlers.fetch({ request: { method: 'GET', url, mode }, respondWith: (p) => (out = p) });
    return out;
  };
  return { request, calls, store };
}

test('сервис-воркер: запрос к сети — с проверкой у сервера (cache: no-cache), ответ кладётся в копию', async () => {
  const sw = load();
  const res = await sw.request('https://x.test/app/src/ui/journal-equipment-ui.js');
  assert.equal(res.body, 'fresh');
  assert.equal(sw.calls.length, 1);
  assert.equal(sw.calls[0].init?.cache, 'no-cache');
  assert.ok(sw.store.has('https://x.test/app/src/ui/journal-equipment-ui.js'));
});

test('сервис-воркер: без сети — сохранённая копия; чужие адреса не перехватываются', async () => {
  const sw = load({ online: false });
  sw.store.set('https://x.test/app/src/core/version.js', { ok: true, body: 'cached' });
  assert.equal((await sw.request('https://x.test/app/src/core/version.js')).body, 'cached');
  assert.equal(sw.request('https://fonts.example/x.css'), undefined);
});
