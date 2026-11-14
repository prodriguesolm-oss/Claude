// Persistência em IndexedDB (no próprio iPhone).
// Toda escrita é uma transação atômica: ou grava tudo, ou nada — e a interface só
// é atualizada depois que o iOS confirma a gravação.

const NAME = 'agentonator';
const VERSION = 1;
export const STORES = ['places', 'events', 'visits', 'commitments', 'history', 'photos', 'meta'];

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) {
      reject(new Error('Este navegador não oferece armazenamento local (IndexedDB).'));
      return;
    }
    const req = indexedDB.open(NAME, VERSION);
    const timer = setTimeout(() => {
      // bug conhecido do iOS: às vezes a primeira abertura trava; tentamos de novo
      dbPromise = null;
      reject(Object.assign(new Error('Tempo esgotado ao abrir o banco local'), { name: 'TimeoutError' }));
    }, 6000);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: s === 'meta' ? 'key' : 'id' });
      }
    };
    req.onsuccess = () => {
      clearTimeout(timer);
      const db = req.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      db.onclose = () => { dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => { clearTimeout(timer); dbPromise = null; reject(req.error); };
    req.onblocked = () => console.warn('[db] abertura bloqueada por outra aba');
  });
  return dbPromise;
}

const retriable = (e) => e && (e.name === 'InvalidStateError' || e.name === 'TimeoutError' || e.name === 'UnknownError' || /connection|closing|closed/i.test(e.message || ''));

async function withDB(fn) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fn(await openDB());
    } catch (e) {
      lastErr = e;
      if (!retriable(e)) throw e;
      dbPromise = null; // conexão perdida (o iOS às vezes derruba ao voltar do segundo plano)
      await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
    }
  }
  throw lastErr;
}

/** ops: [{type:'put', store, value} | {type:'delete', store, key} | {type:'clear', store}] */
export function tx(ops) {
  if (!ops.length) return Promise.resolve();
  return withDB((db) => new Promise((resolve, reject) => {
    const stores = [...new Set(ops.map((o) => o.store))];
    const t = db.transaction(stores, 'readwrite');
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Gravação abortada'));
    for (const op of ops) {
      const s = t.objectStore(op.store);
      if (op.type === 'put') s.put(op.value);
      else if (op.type === 'delete') s.delete(op.key);
      else if (op.type === 'clear') s.clear();
    }
  }));
}

export function getAll(store) {
  return withDB((db) => new Promise((resolve, reject) => {
    const r = db.transaction(store, 'readonly').objectStore(store).getAll();
    r.onsuccess = () => resolve(r.result || []);
    r.onerror = () => reject(r.error);
  }));
}

export function get(store, key) {
  return withDB((db) => new Promise((resolve, reject) => {
    const r = db.transaction(store, 'readonly').objectStore(store).get(key);
    r.onsuccess = () => resolve(r.result || null);
    r.onerror = () => reject(r.error);
  }));
}

export async function loadAll() {
  const out = {};
  for (const s of STORES) if (s !== 'photos') out[s] = await getAll(s);
  return out;
}

/** Pede ao iOS para não apagar os dados em caso de pouco espaço. */
export async function requestPersist() {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch { /* não suportado */ }
  return false;
}

export async function estimate() {
  try { return (await navigator.storage?.estimate?.()) || null; } catch { return null; }
}
