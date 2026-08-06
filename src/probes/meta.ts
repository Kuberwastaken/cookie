import type { Probe, Signal } from '../types';

const sig = (id: string, label: string, value: unknown, extra: Partial<Signal> = {}): Signal => ({
  id, label, value, ...extra,
});

/**
 * Meta signals about the browsing session itself, the stuff that makes a
 * developer audience sit up: we can tell your DevTools are open, and roughly
 * how much free disk you have.
 */
export const metaProbe: Probe = {
  id: 'meta',
  title: 'Session',
  tier: 1,
  async run() {
    const out: Signal[] = [];

    // --- Where you came from (nobody reads this, and it's right there) ---
    try {
      const ref = document.referrer || '';
      out.push(sig('nav.referrer', 'Referrer', ref || '(none, typed in or bookmarked)'));
      if (ref) {
        try { out.push(sig('nav.referrerHost', 'Came from', new URL(ref).hostname, { entropy: 2 })); }
        catch { /* malformed referrer */ }
      }
    } catch { /* ignore */ }

    // --- Multiple monitors (no permission on Chrome) ---
    try {
      if ('isExtended' in screen) {
        out.push(sig('meta.multiMonitor', 'Multiple screens', (screen as Screen & { isExtended?: boolean }).isExtended === true));
      }
    } catch { /* ignore */ }

    // DevTools detection removed: both heuristics (viewport-gap and the
    // console-getter tripwire) false-positived on people with DevTools closed,
    // and a confidently wrong "we see you inspecting us" is worse than silence.

    // --- Free storage estimate ---
    try {
      const est = await navigator.storage?.estimate?.();
      if (est?.quota) {
        out.push(sig('meta.storageQuota', 'Storage quota (bytes)', est.quota, {
          display: `${(est.quota / 1e9).toFixed(1)} GB`, entropy: 2.5,
        }));
        out.push(sig('meta.storageUsed', 'Storage used (bytes)', est.usage ?? 0));
      }
    } catch { /* ignore */ }

    return out;
  },
};
