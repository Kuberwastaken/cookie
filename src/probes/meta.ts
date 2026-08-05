import type { Probe, Signal } from '../types';

const sig = (id: string, label: string, value: unknown, extra: Partial<Signal> = {}): Signal => ({
  id, label, value, ...extra,
});

/**
 * Meta signals about the browsing session itself — the stuff that makes a
 * developer audience sit up: we can tell your DevTools are open, and roughly
 * how much free disk you have.
 */
export const metaProbe: Probe = {
  id: 'meta',
  title: 'Session',
  tier: 1,
  async run() {
    const out: Signal[] = [];

    // --- DevTools detection (heuristic, hedge accordingly) ---
    // 1) A docked panel shrinks the viewport well below the window size.
    let bySize = false;
    try {
      const wGap = outerWidth - innerWidth;
      const hGap = outerHeight - innerHeight;
      bySize = wGap > 200 || hGap > 200;
    } catch { /* ignore */ }

    // 2) The console lazily serialises logged objects — a getter on a logged
    // object only fires if a console panel is actually rendering it.
    let byGetter = false;
    try {
      const bait: { toString?: unknown } = {};
      Object.defineProperty(bait, 'id', { get() { byGetter = true; return 'nc'; }, configurable: true });
      // eslint-disable-next-line no-console
      console.debug('%c', 'font-size:0', bait);
    } catch { /* ignore */ }

    out.push(sig('meta.devtools', 'DevTools open', bySize || byGetter, {
      display: bySize || byGetter ? `yes (${byGetter ? 'console serialisation' : 'window geometry'})` : 'no',
    }));

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
