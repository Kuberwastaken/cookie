import type { Claim, Inference, SignalMap } from '../types';

const claim = (c: Omit<Claim, 'confidence'> & Partial<Pick<Claim, 'confidence'>>): Claim => ({
  confidence: 'likely', ...c,
});

/** physical px (css × dpr) → a specific Apple product. Keyed "wxh@dpr". */
const APPLE: Record<string, string> = {
  '2560x1664@2': 'MacBook Air (13-inch, M-series)',
  '2880x1864@2': 'MacBook Air (15-inch, M-series)',
  '2880x1800@2': 'MacBook Air (15-inch, M-series)',
  '2560x1600@2': 'MacBook Pro (13-inch)',
  '3024x1964@2': 'MacBook Pro (14-inch, M-series)',
  '3456x2234@2': 'MacBook Pro (16-inch, M-series)',
  '4480x2520@2': 'iMac (24-inch, M-series)',
  '5120x2880@2': 'a 27-inch 5K display (iMac or Studio Display)',
  '750x1334@2': 'iPhone SE',
  '1170x2532@3': 'iPhone 12 / 13 / 14',
  '1179x2556@3': 'iPhone 14 Pro / 15 / 16',
  '1290x2796@3': 'iPhone 14 Pro Max / 15 Plus / 16 Plus',
  '1640x2360@2': 'an iPad (10th gen) or iPad Air',
  '1668x2388@2': 'an iPad Pro (11-inch)',
  '2048x2732@2': 'an iPad Pro (12.9-inch)',
};

function num(s: SignalMap, id: string): number | undefined {
  const v = s[id]?.value;
  return typeof v === 'number' ? v : undefined;
}

/** Resolve the exact device from screen geometry, then corroborate with the GPU string. */
export const deviceModel: Inference = (s) => {
  const res = s['display.resolution']?.value as [number, number] | undefined;
  const dpr = num(s, 'display.pixelRatio');
  const out: Claim[] = [];
  if (!res || !dpr) return out;

  const [w, h] = res;
  // Try both orientations at the measured dpr and its rounding.
  const keys = [
    `${w}x${h}@${dpr}`, `${h}x${w}@${dpr}`,
    `${w}x${h}@${Math.round(dpr)}`, `${h}x${w}@${Math.round(dpr)}`,
  ];
  const model = keys.map((k) => APPLE[k]).find(Boolean);

  if (model) {
    out.push(claim({
      id: 'device.model',
      text: `You're reading this on ${startsWithArticle(model) ? model : `a ${model}`}.`,
      confidence: 'likely',
      act: 3, weight: 8,
      evidence: ['display.resolution', 'display.pixelRatio'],
      how: `${w}×${h} logical pixels at a ${dpr}× device pixel ratio is ${physical(w, h, dpr)} physical pixels, a resolution Apple ships on exactly one product line. No cookie, no permission: the screen just tells us.`,
    }));
  }

  // Fractional DPR means fractional UI scaling somewhere. Careful: DPR is
  // hardware density MULTIPLIED by scaling, so on a 2x HiDPI panel at 125% the
  // DPR is 2.5 — reporting that as "250%" was wrong. Factor out the likely base
  // density first, and only speak when the result looks like a real setting.
  if (dpr % 1 !== 0 && !model) {
    const scale = inferScaling(dpr);
    if (scale) {
      out.push(claim({
        id: 'device.winScale',
        text: `Your interface is scaled to about *${scale.pct}%*, not the default.`,
        confidence: 'guess', act: 3, weight: 4,
        evidence: ['display.pixelRatio'],
        how: `Your device pixel ratio is ${dpr}. That's your screen's hardware density (${scale.base}×) multiplied by your UI scaling, which works out to roughly ${scale.pct}%. It could be an OS display-scaling setting or browser zoom — we can tell it isn't the default, but not which one changed it.`,
      }));
    }
  }

  return out;
};

/** Turn the raw GPU string into a plain-English graphics-card call-out. */
export const gpuTier: Inference = (s) => {
  const raw = (s['gpu.renderer']?.value as string) || '';
  if (!raw) return [];
  const out: Claim[] = [];

  const pretty = prettifyGpu(raw);
  if (pretty) {
    out.push(claim({
      id: 'device.gpu',
      text: pretty.article
        ? `Your graphics is ${pretty.article} *${pretty.name}*.`
        : `Your graphics is *${pretty.name}*.`,
      confidence: pretty.exact ? 'certain' : 'likely',
      act: 3, weight: 9,
      evidence: ['gpu.renderer'],
      how: `WebGL exposes the raw GPU string through WEBGL_debug_renderer_info, here, "${truncate(raw, 90)}". Chrome hands this over with no permission prompt. It names your exact graphics hardware in the first frame.`,
    }));
  }

  // The worker/main-thread cross-check: a mismatch means the GPU string is spoofed.
  if (s['gpu.rendererMismatch']?.value === true) {
    out.push(claim({
      id: 'device.gpuSpoof',
      text: `And you're *faking it*, the GPU your page reports isn't the one your browser's background threads report.`,
      confidence: 'certain', act: 4, weight: 9,
      evidence: ['gpu.renderer', 'gpu.workerRenderer'],
      how: `We read the GPU string twice: once on the page, once inside a Web Worker. A real browser returns the same value both times. Yours doesn't, which means a privacy tool or anti-detect browser is rewriting it on the main thread but forgot the Worker. The lie is the fingerprint.`,
    }));
  }

  return out;
};

/** Multiple monitors, detected with no permission (Chrome's screen.isExtended). */
export const multiMonitor: Inference = (s) => {
  if (s['meta.multiMonitor']?.value !== true) return [];
  return [claim({
    id: 'device.screens',
    text: `You're running *more than one screen*.`,
    confidence: 'certain', act: 3, weight: 4,
    evidence: ['meta.multiMonitor'],
    how: `screen.isExtended returns true when a second display is attached, no permission prompt, just a boolean any site can read. It doesn't say what's on the other screen. Yet.`,
  })];
};

/** Refresh rate → ProMotion / gaming-monitor inference. */
export const displayInference: Inference = (s) => {
  const hz = num(s, 'display.refreshHz');
  if (!hz) return [];
  const out: Claim[] = [];
  if (hz >= 118 && hz <= 122) {
    out.push(claim({
      id: 'device.promotion',
      text: `Your screen refreshes *120 times a second*, a ProMotion or high-refresh panel.`,
      confidence: 'likely', act: 3, weight: 5,
      evidence: ['display.refreshHz'],
      how: `We counted how often the browser could paint a frame. It settled at ${hz}Hz, you paid for the nice screen.`,
    }));
  } else if (hz >= 140) {
    out.push(claim({
      id: 'device.gamingMonitor',
      text: `Your monitor runs at *${hz}Hz*. That's a gaming display.`,
      confidence: 'likely', act: 3, weight: 6,
      evidence: ['display.refreshHz'],
      how: `Frame-paint timing clocked your display at ${hz}Hz. Nothing but a dedicated gaming monitor runs that fast.`,
    }));
  }
  return out;
};

/** Cameras/mics attached, reads as more invasive than it is (counts need no permission). */
export const peripherals: Inference = (s) => {
  const cams = num(s, 'hw.cameras');
  const mics = num(s, 'hw.microphones');
  if (cams == null && mics == null) return [];

  // Without camera/mic permission the browser collapses enumerateDevices() to a
  // single placeholder entry per kind, so the numbers are NOT real counts, they
  // only prove a device of that kind exists. Claiming "1 microphone" to someone
  // with three is the kind of confident-and-wrong we refuse to ship.
  const exact = s['hw.deviceLabels']?.value === true;

  if (exact) {
    const parts: string[] = [];
    if (cams != null) parts.push(`*${cams}* camera${cams === 1 ? '' : 's'}`);
    if (mics != null) parts.push(`*${mics}* microphone${mics === 1 ? '' : 's'}`);
    if (!parts.length) return [];
    return [claim({
      id: 'device.peripherals',
      text: `You have ${parts.join(' and ')} plugged in right now.`,
      confidence: 'certain', act: 3, weight: 6,
      evidence: ['hw.cameras', 'hw.microphones', 'hw.speakers', 'hw.deviceLabels'],
      how: `enumerateDevices() lists every camera, mic and speaker attached. You've granted this browser device access at some point, so we get the real tally and the names too.`,
    })];
  }

  // Presence only, which is all the browser will honestly tell us.
  const kinds: string[] = [];
  if (cams) kinds.push('a camera');
  if (mics) kinds.push('a microphone');
  if (!kinds.length) return [];
  return [claim({
    id: 'device.peripherals',
    text: `You have ${kinds.join(' and ')} attached.`,
    confidence: 'likely', act: 3, weight: 5,
    evidence: ['hw.cameras', 'hw.microphones', 'hw.speakers', 'hw.deviceLabels'],
    how: `enumerateDevices() reveals which *kinds* of device you have without any permission prompt. It won't give the real number or the names until you grant access, so we won't pretend to know how many, only that they're there.`,
  })];
};

// --- helpers ---------------------------------------------------------------

function physical(w: number, h: number, dpr: number): string {
  return `${Math.round(w * dpr)}×${Math.round(h * dpr)}`;
}

function startsWithArticle(s: string): boolean {
  return /^(a|an|the)\s/i.test(s);
}

/**
 * Split a device pixel ratio into (hardware density × UI scaling). A 2x retina
 * panel at 125% reports dpr 2.5, which is 125% scaling, not 250%. We try each
 * plausible base density and keep the one whose implied scaling matches a real
 * setting people actually pick; if nothing matches, we say nothing.
 */
// Scaling factors people actually choose. 200%+ is deliberately absent: an
// integer DPR never reaches here, and reading dpr 2.5 as "250% on a 1x screen"
// (rather than 125% on a 2x screen) is exactly the bug this function exists to
// avoid. Ties prefer the larger base, i.e. the more modest scaling factor.
const COMMON_SCALES = [1.1, 1.25, 1.4, 1.5, 1.75];
function inferScaling(dpr: number): { pct: number; base: number } | null {
  let best: { pct: number; base: number; err: number } | null = null;
  for (const base of [1, 2, 3]) {
    const scale = dpr / base;
    if (scale < 1.05 || scale > 1.9) continue;
    for (const c of COMMON_SCALES) {
      const err = Math.abs(scale - c);
      if (err < 0.02 && (!best || err <= best.err)) {
        best = { pct: Math.round(c * 100), base, err };
      }
    }
  }
  return best ? { pct: best.pct, base: best.base } : null;
}

interface GpuGuess { name: string; article: string; exact: boolean; }

function prettifyGpu(raw: string): GpuGuess | null {
  const r = raw.toLowerCase();
  // Apple Silicon
  const apple = raw.match(/Apple\s+(M\d+(?:\s*(?:Pro|Max|Ultra))?)/i);
  if (apple) return { name: `Apple ${apple[1]}`, article: 'an', exact: true };
  // NVIDIA
  const nv = raw.match(/(?:GeForce\s+)?(RTX\s*\d{4}\s*(?:Ti)?|GTX\s*\d{3,4}\s*(?:Ti)?)/i);
  if (nv) return { name: `NVIDIA ${nv[1].replace(/\s+/g, ' ').toUpperCase()}`, article: 'an', exact: true };
  // AMD
  const amd = raw.match(/(Radeon\s+RX\s*\d{3,4}\s*(?:XT)?)/i);
  if (amd) return { name: amd[1], article: 'an', exact: true };
  // Intel integrated
  if (r.includes('intel')) {
    const iris = raw.match(/(Iris\s+Xe|UHD\s+Graphics\s*\d*|HD\s+Graphics\s*\d*)/i);
    return { name: iris ? `Intel ${iris[1]}` : 'Intel integrated graphics', article: 'an', exact: !!iris };
  }
  // Mobile
  const adreno = raw.match(/Adreno\s*\(TM\)\s*(\d+)/i);
  if (adreno) return { name: `Qualcomm Adreno ${adreno[1]}`, article: 'a', exact: true };
  const mali = raw.match(/Mali-(\w+)/i);
  if (mali) return { name: `ARM Mali-${mali[1]}`, article: 'an', exact: true };
  // Software renderer / VM
  if (/swiftshader|llvmpipe|basic render/i.test(raw)) {
    return { name: 'a software renderer (no real GPU, a VM, or a headless browser)', article: '', exact: true };
  }
  return null;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
