// Поддельный File System Access API и IndexedDB для проверки панели «Файл журнала» в headless Chromium.
// Состояние (файлы, ссылки, разрешения) — в sessionStorage, чтобы пережить перезагрузку; разрешения сбрасываются
// при каждой загрузке, как в настоящем браузере.
(() => {
  const KEY = '__fakefs';
  const load = () => JSON.parse(sessionStorage.getItem(KEY) || '{"files":{},"idb":{},"granted":{},"openName":""}');
  const save = (st) => sessionStorage.setItem(KEY, JSON.stringify(st));
  const st0 = load();
  st0.granted = {};
  save(st0);
  window.__fs = { load, save };
  let tick = Date.now();
  const now = () => (tick = Math.max(tick + 1, Date.now()));
  const fileHandle = (path) => ({
    kind: 'file',
    name: path.split('/').pop(),
    __path: path,
    async getFile() {
      const f = load().files[path];
      if (!f) throw new DOMException('not found', 'NotFoundError');
      return { name: path.split('/').pop(), lastModified: f.lastModified, text: async () => f.text };
    },
    async createWritable() {
      if (!load().granted[path]) throw new DOMException('denied', 'NotAllowedError');
      let buf = '';
      return {
        write: async (t) => {
          buf += t;
        },
        close: async () => {
          const s = load();
          s.files[path] = { text: buf, lastModified: now() };
          save(s);
        },
      };
    },
    async queryPermission() {
      return load().granted[path] ? 'granted' : 'prompt';
    },
    async requestPermission() {
      const s = load();
      s.granted[path] = true;
      save(s);
      return 'granted';
    },
  });
  const dirHandle = (path) => ({
    kind: 'directory',
    name: path,
    __path: path,
    async getFileHandle(n, { create } = {}) {
      const p = `${path}/${n}`;
      const s = load();
      if (!s.files[p]) {
        if (!create) throw new DOMException('not found', 'NotFoundError');
        s.files[p] = { text: '', lastModified: now() };
      }
      s.granted[p] = !!s.granted[path];
      save(s);
      return fileHandle(p);
    },
    async *entries() {
      for (const p of Object.keys(load().files)) if (p.startsWith(`${path}/`)) yield [p.slice(path.length + 1), fileHandle(p)];
    },
    async removeEntry(n) {
      const s = load();
      delete s.files[`${path}/${n}`];
      save(s);
    },
    async queryPermission() {
      return load().granted[path] ? 'granted' : 'prompt';
    },
    async requestPermission() {
      const s = load();
      s.granted[path] = true;
      save(s);
      return 'granted';
    },
  });
  window.showSaveFilePicker = async ({ suggestedName }) => {
    const s = load();
    s.granted[suggestedName] = true;
    s.files[suggestedName] = { text: '', lastModified: now() }; // как в Chrome: выбранный файл создаётся пустым
    save(s);
    return fileHandle(suggestedName);
  };
  window.showOpenFilePicker = async () => {
    const s = load();
    s.granted[s.openName] = true;
    save(s);
    return [fileHandle(s.openName)];
  };
  window.showDirectoryPicker = async () => {
    const s = load();
    s.granted.backups = true;
    save(s);
    return dirHandle('backups');
  };
  const revive = (e) => (e ? (e.kind === 'file' ? fileHandle(e.path) : dirHandle(e.path)) : undefined);
  const db = {
    close() {},
    transaction() {
      const tx = {};
      const store = {
        put(v, k) {
          const s = load();
          s.idb[k] = { kind: v.kind, path: v.__path };
          save(s);
          return {};
        },
        delete(k) {
          const s = load();
          delete s.idb[k];
          save(s);
          return {};
        },
        get(k) {
          return { result: revive(load().idb[k]) };
        },
      };
      tx.objectStore = () => store;
      setTimeout(() => tx.oncomplete?.());
      return tx;
    },
  };
  Object.defineProperty(window, 'indexedDB', {
    configurable: true,
    value: {
      open() {
        const req = {};
        setTimeout(() => {
          req.result = db;
          req.onsuccess?.();
        });
        return req;
      },
    },
  });
})();
