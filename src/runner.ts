import type { Probe, ProbeContext, Signal, SignalMap } from './types';

/** Wrap a probe so a thrown error becomes an error Signal instead of killing the run. */
async function safeRun(probe: Probe, ctx: ProbeContext): Promise<Signal[]> {
  const t0 = performance.now();
  try {
    const out = await probe.run(ctx);
    const ms = performance.now() - t0;
    return out.map((s) => ({ ...s, ms: s.ms ?? ms }));
  } catch (err) {
    return [
      {
        id: `${probe.id}.__error`,
        label: probe.title,
        value: null,
        error: err instanceof Error ? err.message : String(err),
        ms: performance.now() - t0,
      },
    ];
  }
}

export interface RunOptions {
  consented: boolean;
  signal: AbortSignal;
  /** called every time a probe finishes, so the UI can stream claims in */
  onProgress?: (probe: Probe, signals: Signal[], all: SignalMap) => void;
}

/**
 * Run probes tier by tier. Within a tier everything runs concurrently; tiers are
 * sequential so later probes can read earlier signals (e.g. software inference
 * needs the font list). Tier 2 is skipped unless the user consented.
 */
export async function runProbes(probes: Probe[], opts: RunOptions): Promise<SignalMap> {
  const all: SignalMap = {};
  const tiers: Array<0 | 1 | 2> = [0, 1, 2];

  for (const tier of tiers) {
    if (tier === 2 && !opts.consented) continue;
    const batch = probes.filter((p) => p.tier === tier);
    if (!batch.length) continue;

    await Promise.all(
      batch.map(async (probe) => {
        const ctx: ProbeContext = { signals: all, consented: opts.consented, signal: opts.signal };
        const signals = await safeRun(probe, ctx);
        for (const s of signals) all[s.id] = s;
        opts.onProgress?.(probe, signals, all);
      }),
    );
  }

  return all;
}

/**
 * Shannon-ish entropy total. Each signal self-reports estimated bits; we sum and
 * cap, because correlated signals (GPU + platform + fonts) do not add linearly.
 * The cap keeps us honest rather than claiming absurd 400-bit uniqueness.
 */
export function totalEntropy(signals: SignalMap): number {
  let sum = 0;
  for (const s of Object.values(signals)) {
    if (s.error || typeof s.entropy !== 'number') continue;
    sum += s.entropy;
  }
  // Diminishing returns past ~20 bits; correlated signals overlap heavily.
  return sum <= 20 ? sum : 20 + Math.log2(sum - 19);
}

/** FNV-1a, small, fast, dependency-free, good enough for a display fingerprint. */
export function hash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Stable device fingerprint from the signals that do not change between visits. */
export function deviceFingerprint(signals: SignalMap): string {
  const STABLE = [
    'gpu.renderer', 'gpu.vendor', 'canvas.hash', 'audio.hash', 'fonts.hash',
    'display.resolution', 'display.pixelRatio', 'hw.cores', 'hw.memory',
    'platform.os', 'voices.hash', 'codecs.hash',
  ];
  const parts = STABLE.map((id) => `${id}=${signals[id]?.display ?? signals[id]?.value ?? ''}`);
  return hash(parts.join('|'));
}
