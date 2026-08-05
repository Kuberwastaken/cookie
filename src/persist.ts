/**
 * The "clear your cookies, it won't help" demonstration.
 *
 * An identifier is written to several independent storage backends. Clearing any
 * one of them — including all cookies, which we never use — leaves the others
 * intact, and the next visit re-seeds the cleared ones from a survivor. This is
 * the evercookie pattern, and it is what tracking looks like without cookies.
 *
 * The token is random, meaningless, never leaves the browser, and `forget()`
 * genuinely destroys every copy.
 */

const KEY = 'nc.v1';
const DB = 'nc';
const STORE = 'kv';
const CACHE = 'nc-v1';
const CACHE_URL = '/__nc_id';

export interface Visit {
  id: string;
  first: number;
  count: number;
  /** which backends still held a copy when we arrived */
  survivors: string[];
  /** backends that had been wiped and which we just restored */
  restored: string[];
}

function newId(): string {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

// ---- backends -------------------------------------------------------------

const local = {
  name: 'localStorage',
  async get() { try { return localStorage.getItem(KEY); } catch { return null; } },
  async set(v: string) { try { localStorage.setItem(KEY, v); } catch { /* private mode */ } },
  async del() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } },
};

const session = {
  name: 'sessionStorage',
  async get() { try { return sessionStorage.getItem(KEY); } catch { return null; } },
  async set(v: string) { try { sessionStorage.setItem(KEY, v); } catch { /* ignore */ } },
  async del() { try { sessionStorage.removeItem(KEY); } catch { /* ignore */ } },
};

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const indexed = {
  name: 'IndexedDB',
  async get(): Promise<string | null> {
    try {
      const db = await idb();
      return await new Promise((resolve) => {
        const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
        r.onsuccess = () => resolve((r.result as string) ?? null);
        r.onerror = () => resolve(null);
      });
    } catch { return null; }
  },
  async set(v: string) {
    try {
      const db = await idb();
      db.transaction(STORE, 'readwrite').objectStore(STORE).put(v, KEY);
    } catch { /* ignore */ }
  },
  async del() {
    try {
      const db = await idb();
      db.transaction(STORE, 'readwrite').objectStore(STORE).delete(KEY);
    } catch { /* ignore */ }
  },
};

const cacheApi = {
  name: 'Cache Storage',
  async get(): Promise<string | null> {
    try {
      const c = await caches.open(CACHE);
      const res = await c.match(CACHE_URL);
      return res ? await res.text() : null;
    } catch { return null; }
  },
  async set(v: string) {
    try {
      const c = await caches.open(CACHE);
      await c.put(CACHE_URL, new Response(v));
    } catch { /* ignore */ }
  },
  async del() { try { await caches.delete(CACHE); } catch { /* ignore */ } },
};

const BACKENDS = [local, session, indexed, cacheApi];

// ---- public API -----------------------------------------------------------

export async function recall(): Promise<Visit> {
  const found = await Promise.all(
    BACKENDS.map(async (b) => ({ backend: b, raw: await b.get() })),
  );

  const survivors = found.filter((f) => f.raw).map((f) => f.backend.name);
  const restored = found.filter((f) => !f.raw).map((f) => f.backend.name);

  let record: { id: string; first: number; count: number } | null = null;
  for (const f of found) {
    if (!f.raw) continue;
    try {
      const parsed = JSON.parse(f.raw);
      if (parsed?.id) { record = parsed; break; }
    } catch { /* corrupt copy, try the next backend */ }
  }

  const visit: Visit = record
    ? { ...record, count: record.count + 1, survivors, restored }
    : { id: newId(), first: Date.now(), count: 1, survivors: [], restored: [] };

  // Re-seed every backend, including the ones that had been wiped.
  const payload = JSON.stringify({ id: visit.id, first: visit.first, count: visit.count });
  await Promise.all(BACKENDS.map((b) => b.set(payload)));

  return visit;
}

export async function forget(): Promise<void> {
  await Promise.all(BACKENDS.map((b) => b.del()));
}
