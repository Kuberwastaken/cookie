import type { Probe, Signal } from '../types';

const sig = (id: string, label: string, value: unknown, extra: Partial<Signal> = {}): Signal => ({
  id, label, value, ...extra,
});

/** Private-mode detection. Every heuristic here is soft: modern browsers have
 * deliberately closed most of the old quota/API gaps (Chrome's FileSystem
 * quota trick was patched years ago; Firefox private windows now share the
 * same storage limits as normal ones in recent versions). Treat the output
 * as a guess, never a certainty — the UI should hedge accordingly. */
export const incognitoProbe: Probe = {
  id: 'incognito',
  title: 'Private browsing',
  tier: 0,
  async run() {
    const out: Signal[] = [];
    let isPrivate = false;
    let method: string | null = null;

    // navigator.storage.estimate(): historically Chrome incognito capped quota
    // to a small fraction of disk (or of RAM) instead of the real free space.
    // As of recent Chrome this gap has mostly been closed, so this is weak
    // evidence at best — a low absolute quota, not a reliable ratio anymore.
    let quota: number | null = null;
    try {
      if (navigator.storage?.estimate) {
        const est = await navigator.storage.estimate();
        quota = est.quota ?? null;
        // A few hundred MB or less is unusually small for a modern desktop
        // browser's persistent-storage quota; treat it as a weak signal only.
        if (typeof quota === 'number' && quota > 0 && quota < 200 * 1024 * 1024) {
          isPrivate = true;
          method = 'storage.estimate() quota unusually small';
        }
      }
    } catch { /* storage API gated or unsupported */ }

    // Safari-specific: in older private windows, IndexedDB either threw
    // synchronously on open or silently failed to persist. Recent Safari has
    // largely fixed this too, so a successful open here proves very little.
    if (!isPrivate) {
      try {
        await new Promise<void>((resolve, reject) => {
          const req = indexedDB.open('nocookies-idb-probe');
          req.onerror = () => reject(req.error ?? new Error('idb open failed'));
          req.onsuccess = () => { req.result.close(); resolve(); };
          setTimeout(() => reject(new Error('idb open timed out')), 800);
        });
      } catch {
        isPrivate = true;
        method = 'IndexedDB open failed/blocked';
      }
    }

    // Safari-specific: StorageManager.getDirectory() (Origin Private File
    // System) has historically thrown inside private windows.
    if (!isPrivate) {
      try {
        const sm = navigator.storage as (StorageManager & { getDirectory?: () => Promise<unknown> }) | undefined;
        if (sm?.getDirectory) {
          await sm.getDirectory();
        }
      } catch (err) {
        // Only trust this if it's not just "unsupported" — many non-Safari
        // browsers don't implement getDirectory at all and would throw here
        // in a normal window too, so this stays a weak, best-effort signal.
        if (/private|denied|NotAllowed/i.test(err instanceof Error ? err.message : String(err))) {
          isPrivate = true;
          method = 'StorageManager.getDirectory() denied';
        }
      }
    }

    out.push(
      sig('incognito.private', 'Likely private browsing', isPrivate, {
        display: isPrivate ? `probably (${method})` : 'no strong signal',
      }),
      sig('incognito.method', 'Detection method', method),
      sig('incognito.quota', 'Storage quota (bytes)', quota, {
        display: quota != null ? `${Math.round(quota / (1024 * 1024))} MB` : 'unknown',
      }),
    );

    return out;
  },
};
