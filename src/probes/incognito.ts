import type { Probe, Signal } from '../types';

const sig = (id: string, label: string, value: unknown, extra: Partial<Signal> = {}): Signal => ({
  id, label, value, ...extra,
});

/**
 * Private-browsing detection, deliberately attempted on Safari ONLY.
 *
 * The old tricks are dead, and the replacements are worse than nothing:
 *  - Chrome's storage-quota gap is gone. Chrome now clamps an Incognito
 *    window's reported quota to the same shape as a normal one, so there is no
 *    threshold left to test. The only maintained replacement in the wild is an
 *    IndexedDB durability-timing microbenchmark, which as of mid-2026 has an
 *    open, confirmed ~50/50 false positive on ramdisk-backed profiles (CI,
 *    VDI, tmpfs home directories) and rests on a storage backend Chrome has
 *    already flagged for replacement. Chrome's Guest mode is also
 *    indistinguishable from Incognito by Google's stated design.
 *  - Firefox private windows have had working IndexedDB since Firefox 115, so
 *    "IDB open fails" is dead code, and the remaining candidate (OPFS throwing)
 *    has an unexplained false positive reported on Firefox 150 and cannot be
 *    cleanly separated from ETP Strict / resistFingerprinting in an ordinary
 *    window.
 *
 * So: on Chrome and Firefox we do not guess at all. On Safari, private windows
 * still make the Origin Private File System unavailable, which is a real,
 * mechanism-backed signal, and we report it as "likely" rather than certain
 * because genuine low-disk conditions raise the same error.
 */

const SAFARI = () => {
  const ua = navigator.userAgent;
  return /Safari/.test(ua) && !/Chrome|Chromium|Edg\/|OPR\//.test(ua);
};

export const incognitoProbe: Probe = {
  id: 'incognito',
  title: 'Private browsing',
  tier: 0,
  async run() {
    const out: Signal[] = [];
    let isPrivate = false;
    let method: string | null = null;
    let attempted = false;

    // Keep the raw quota purely as a fingerprint signal. It is NOT used to
    // decide private mode any more.
    let quota: number | null = null;
    try {
      const est = await navigator.storage?.estimate?.();
      quota = est?.quota ?? null;
    } catch { /* gated or unsupported */ }

    if (SAFARI()) {
      attempted = true;
      const sm = navigator.storage as (StorageManager & { getDirectory?: () => Promise<unknown> }) | undefined;
      if (typeof sm?.getDirectory === 'function') {
        try {
          // Must run on the main thread: OPFS fails differently inside workers
          // regardless of browsing mode.
          await sm.getDirectory();
        } catch (err) {
          const e = err as { name?: string; message?: string };
          const msg = `${e?.name ?? ''} ${e?.message ?? ''}`;
          // Safari's private-window signature. Anything else (SecurityError,
          // InvalidStateError) we ignore rather than over-read.
          if (/unknown transient reason/i.test(msg) || e?.name === 'UnknownError') {
            isPrivate = true;
            method = 'Safari: Origin Private File System unavailable';
          }
        }
      }
    }

    out.push(
      sig('incognito.private', 'Likely private browsing', isPrivate, {
        display: isPrivate ? `likely (${method})` : attempted ? 'no signal' : 'not testable on this browser',
      }),
      sig('incognito.method', 'Detection method', method),
      sig('incognito.attempted', 'Detection attempted', attempted),
      sig('incognito.quota', 'Storage quota (bytes)', quota, {
        display: quota != null ? `${Math.round(quota / (1024 * 1024))} MB` : 'unknown',
        entropy: 2,
      }),
    );

    return out;
  },
};
