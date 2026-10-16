// Ссылки на файлы и папки (File System Access API) между сеансами браузера: Chrome и Edge позволяют хранить их
// в IndexedDB. Сам доступ после перезагрузки браузер даёт заново — по нажатию пользователя (requestPermission).
// Любая ошибка хранилища (частное окно, запрет, другой браузер) — просто «ссылки нет».

const DB = 'reference-dosimetry';
const STORE = 'handles';

function openDb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function run(mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => {
          db.close();
          resolve(req?.result);
        };
        tx.onerror = tx.onabort = () => {
          db.close();
          reject(tx.error);
        };
      }),
  );
}

/** Сохранить ссылку (null — удалить). */
export async function putHandle(key, handle) {
  try {
    if (typeof indexedDB === 'undefined') return;
    await run('readwrite', (s) => (handle ? s.put(handle, key) : s.delete(key)));
  } catch {
    /* ссылка не сохранилась — после перезагрузки файл придётся выбрать заново */
  }
}

/** Прочитать ссылку или null. */
export async function getHandle(key) {
  try {
    if (typeof indexedDB === 'undefined') return null;
    return (await run('readonly', (s) => s.get(key))) ?? null;
  } catch {
    return null;
  }
}

/** Состояние доступа на запись: 'granted' | 'prompt' | 'denied'. request — спросить пользователя (нужно его нажатие). */
export async function writePermission(handle, request = false) {
  try {
    const opts = { mode: 'readwrite' };
    if ((await handle.queryPermission?.(opts)) === 'granted') return 'granted';
    if (!request) return 'prompt';
    return (await handle.requestPermission?.(opts)) ?? 'denied';
  } catch {
    return 'denied';
  }
}
