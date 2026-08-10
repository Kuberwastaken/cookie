import type { SignalMap } from '../types';

/**
 * What's really behind a "Macintosh" user-agent. The UA alone can't say:
 * Safari (and Brave, and Firefox in some configs) masks the WebGL renderer to a
 * bare "Apple GPU", so "no M-chip in the GPU string" does NOT mean Intel — that
 * fallback was telling Apple Silicon owners they had a vintage Intel Mac while
 * the arch probe said ARM in the next breath. And iPads have shipped a desktop
 * "Macintosh" UA since iPadOS 13, so some "Macs" are tablets.
 *
 * Order of trust: a chip named in the GPU string, then the UA-CH architecture
 * hint (authoritative, Chromium-only), then the NaN sign-bit probe (covers
 * Safari/Firefox), and the touchscreen check first because Macs don't have one.
 */
export type MacVerdict =
  | { kind: 'ipad' }
  | { kind: 'apple-silicon'; chip?: string }
  | { kind: 'intel' }
  | { kind: 'unknown' };

/** Signal ids the verdict rests on, for claim evidence lists. */
export const MAC_EVIDENCE = ['gpu.renderer', 'platform.arch', 'deep.archGuess', 'hw.touchPoints'];

export function classifyMacintosh(s: SignalMap): MacVerdict {
  const str = (id: string) => (typeof s[id]?.value === 'string' ? (s[id].value as string) : '');
  const touch = typeof s['hw.touchPoints']?.value === 'number' ? (s['hw.touchPoints'].value as number) : 0;

  if (touch > 1) return { kind: 'ipad' };

  const m = str('gpu.renderer').match(/apple\s+(m\d+)(?:\s+(pro|max|ultra))?/i);
  if (m) {
    const chip = m[1].toUpperCase() + (m[2] ? ` ${m[2][0].toUpperCase()}${m[2].slice(1).toLowerCase()}` : '');
    return { kind: 'apple-silicon', chip };
  }

  const hinted = str('platform.arch').toLowerCase();
  const nan = str('deep.archGuess');
  const family = hinted.includes('arm') ? 'arm'
    : hinted.includes('x86') ? 'x86'
    : nan === 'ARM-family' ? 'arm'
    : nan === 'x86-family' ? 'x86'
    : undefined;

  if (family === 'arm') return { kind: 'apple-silicon' };
  if (family === 'x86') return { kind: 'intel' };
  return { kind: 'unknown' };
}
