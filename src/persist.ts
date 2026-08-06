/**
 * The "clear your cookies, it won't help" demonstration.
 *
 * An identifier is written to several independent storage backends. Clearing any
 * one of them, including all cookies, which we never use, leaves the others
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
  /** how many times this browser has completed the typing test before */
  typed: number;
  /** false when the browser refused to keep our tag (ETP strict, storage
   *  blocked, "clear on close"). We then cannot recognise a returning visitor,
   *  and we say so instead of insisting it's their first visit. */
  persisted: boolean;
  /** which backends still held a copy when we arrived */
  survivors: string[];
  /** backends that had been wiped and which we just restored */
  restored: string[];
}

interface Stored { id: string; first: number; count: number; typed?: number; }

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

/**
 * window.name survives navigation within a tab and is NOT cleared by "clear
 * cookies and site data", one of the last evercookie backends still standing
 * in 2026, and almost no privacy tool covers it. We tuck the tag into a JSON
 * wrapper so we don't clobber a value another site legitimately set.
 */
const NAME_PREFIX = 'nc::';
const windowName = {
  name: 'window.name',
  async get(): Promise<string | null> {
    try {
      const n = window.name;
      if (n.startsWith(NAME_PREFIX)) return n.slice(NAME_PREFIX.length);
      return null;
    } catch { return null; }
  },
  async set(v: string) { try { window.name = NAME_PREFIX + v; } catch { /* ignore */ } },
  async del() { try { if (window.name.startsWith(NAME_PREFIX)) window.name = ''; } catch { /* ignore */ } },
};

const BACKENDS = [local, session, indexed, cacheApi, windowName];

// ---- public API -----------------------------------------------------------

export async function recall(): Promise<Visit> {
  const found = await Promise.all(
    BACKENDS.map(async (b) => ({ backend: b, raw: await b.get() })),
  );

  const survivors = found.filter((f) => f.raw).map((f) => f.backend.name);
  const restored = found.filter((f) => !f.raw).map((f) => f.backend.name);

  let record: Stored | null = null;
  for (const f of found) {
    if (!f.raw) continue;
    try {
      const parsed = JSON.parse(f.raw) as Stored;
      if (parsed?.id) { record = parsed; break; }
    } catch { /* corrupt copy, try the next backend */ }
  }

  const visit: Visit = record
    ? { ...record, typed: record.typed ?? 0, count: record.count + 1, persisted: false, survivors, restored }
    : { id: newId(), first: Date.now(), count: 1, typed: 0, persisted: false, survivors: [], restored: [] };

  await writeAll({ id: visit.id, first: visit.first, count: visit.count, typed: visit.typed });

  // Verify the tag actually survived the write. If every backend comes back
  // empty, storage is being blocked and we will never recognise this visitor.
  const readBack = await Promise.all(BACKENDS.map((b) => b.get()));
  visit.persisted = readBack.some((r) => !!r);
  return visit;
}

async function writeAll(rec: Stored): Promise<void> {
  const payload = JSON.stringify(rec);
  await Promise.all(BACKENDS.map((b) => b.set(payload)));
}

/** Record that the visitor just completed the typing test, across all backends. */
export async function markTyped(): Promise<void> {
  const found = await Promise.all(BACKENDS.map((b) => b.get()));
  let rec: Stored | null = null;
  for (const raw of found) {
    if (!raw) continue;
    try { const p = JSON.parse(raw) as Stored; if (p?.id) { rec = p; break; } } catch { /* skip */ }
  }
  if (!rec) return;
  rec.typed = (rec.typed ?? 0) + 1;
  await writeAll(rec);
}

export async function forget(): Promise<void> {
  await Promise.all(BACKENDS.map((b) => b.del()));
}
