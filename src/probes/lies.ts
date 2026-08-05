import type { Probe, Signal } from '../types';

const sig = (id: string, label: string, value: unknown, extra: Partial<Signal> = {}): Signal => ({
  id, label, value, ...extra,
});

interface Record_ { api: string; reason: string; }

/** A native function's toString() must end in the engine-generated marker.
 * Getters need Object.getOwnPropertyDescriptor, not a direct property read. */
function nativeCheck(label: string, fn: unknown): string | null {
  try {
    if (typeof fn !== 'function') return 'not a function';
    const s = Function.prototype.toString.call(fn);
    if (!/\{\s*\[native code\]\s*\}\s*$/.test(s)) return `toString mismatch: "${s.slice(0, 60)}"`;
    return null;
  } catch (err) {
    return `threw: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/** Curated targets: the functions/getters most commonly patched by spoofing
 * extensions and automation stacks. Kept small on purpose, CreepJS checks
 * dozens; we only want the high-value tells. */
function nativeIntegrityChecks(): Record_[] {
  const records: Record_[] = [];
  const fnTargets: Array<[string, unknown]> = [
    ['Function.prototype.toString', Function.prototype.toString],
    ['navigator.permissions.query', navigator.permissions?.query],
    ['HTMLCanvasElement.prototype.toDataURL', HTMLCanvasElement.prototype.toDataURL],
    ['CanvasRenderingContext2D.prototype.getImageData', CanvasRenderingContext2D.prototype.getImageData],
    ['WebGLRenderingContext.prototype.getParameter', (window as any).WebGLRenderingContext?.prototype?.getParameter],
    ['Navigator.prototype.getGamepads', (window as any).Navigator?.prototype?.getGamepads],
    ['Date.prototype.getTimezoneOffset', Date.prototype.getTimezoneOffset],
    ['Intl.DateTimeFormat.prototype.resolvedOptions', Intl.DateTimeFormat.prototype.resolvedOptions],
    ['AudioBuffer.prototype.getChannelData', (window as any).AudioBuffer?.prototype?.getChannelData],
    ['Element.prototype.getBoundingClientRect', Element.prototype.getBoundingClientRect],
  ];
  for (const [name, fn] of fnTargets) {
    if (fn === undefined) continue; // API not present on this browser at all, not a lie
    const reason = nativeCheck(name, fn);
    if (reason) records.push({ api: name, reason });
  }

  const getterTargets: Array<[string, unknown, string]> = [
    ['navigator.hardwareConcurrency', Object.getPrototypeOf(navigator), 'hardwareConcurrency'],
    ['navigator.deviceMemory', Object.getPrototypeOf(navigator), 'deviceMemory'],
    ['navigator.platform', Object.getPrototypeOf(navigator), 'platform'],
    ['navigator.userAgent', Object.getPrototypeOf(navigator), 'userAgent'],
    ['screen.width', Object.getPrototypeOf(screen), 'width'],
    ['screen.height', Object.getPrototypeOf(screen), 'height'],
  ];
  for (const [label, proto, prop] of getterTargets) {
    try {
      const desc = Object.getOwnPropertyDescriptor(proto as object, prop);
      if (!desc || typeof desc.get !== 'function') continue; // not implemented as a getter here
      const reason = nativeCheck(label, desc.get);
      if (reason) records.push({ api: label, reason });
    } catch (err) {
      records.push({ api: label, reason: `threw: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  return records;
}

/** Lightweight proxy/wrapper smell test: a genuine native function has exactly
 * ['length','name'] own properties and its own toString.name is 'toString'. */
function proxySmellChecks(): Record_[] {
  const records: Record_[] = [];
  const targets: Array<[string, unknown]> = [
    ['Function.prototype.toString', Function.prototype.toString],
    ['HTMLCanvasElement.prototype.toDataURL', HTMLCanvasElement.prototype.toDataURL],
    ['navigator.permissions.query', navigator.permissions?.query],
  ];
  for (const [name, fn] of targets) {
    try {
      if (typeof fn !== 'function') continue;
      const own = Object.getOwnPropertyNames(fn).sort();
      const expected = ['length', 'name'].sort();
      if (own.join(',') !== expected.join(',')) {
        records.push({ api: name, reason: `unexpected own properties: ${own.join(',')}` });
      }
      if (fn.toString.name !== 'toString') {
        records.push({ api: name, reason: 'toString.name has been overridden' });
      }
    } catch { /* the probe itself throwing is not conclusive here, skip */ }
  }
  return records;
}

/** Nest a clean iframe, diff its window's own property names against ours,
 * survivors are almost always injected by extensions or userscripts. */
function clientLitter(): string[] {
  try {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed; width:0; height:0; overflow:hidden; visibility:hidden;';
    const iframe = document.createElement('iframe');
    wrap.appendChild(iframe);
    document.body.appendChild(wrap);
    const cleanWin = iframe.contentWindow as (Window & typeof globalThis) | null;
    if (!cleanWin) { document.body.removeChild(wrap); return []; }
    const cleanKeys = new Set(Object.getOwnPropertyNames(cleanWin));
    const topKeys = Object.getOwnPropertyNames(window);
    const win = window as unknown as Record<string, unknown>;
    const extra = topKeys.filter((k) => {
      if (cleanKeys.has(k)) return false;
      // Frame indices (window[0], window[1]…) appear because the page has
      // iframes and the blank baseline doesn't, not injected litter.
      if (/^\d+$/.test(k)) return false;
      // An extension global is always a valid identifier; anything else
      // (weird keys) isn't what we're looking for.
      if (!/^[A-Za-z_$][\w$]*$/.test(k)) return false;
      // Named-access DOM globals are NOT injected litter: any element with an
      // id (e.g. our own <main id="dossier">) shows up as window[id]. Exclude
      // anything whose value is a DOM node / collection, and anything that
      // throws or is undefined on access.
      let v: unknown;
      try { v = win[k]; } catch { return false; }
      if (v == null) return false;
      if (v instanceof Node) return false;
      if (typeof HTMLCollection !== 'undefined' && v instanceof HTMLCollection) return false;
      if (typeof NodeList !== 'undefined' && v instanceof NodeList) return false;
      if (typeof Window !== 'undefined' && v instanceof Window) return false; // frame refs
      return true;
    });
    document.body.removeChild(wrap);
    return extra.slice(0, 40);
  } catch {
    return [];
  }
}

/** Firefox resistFingerprinting / Tor Browser round performance.now() to a
 * coarse step (historically 100ms/20ms/2ms depending on version); a tight
 * sampling loop shows every delta landing on that step. */
function timerCoarsened(): boolean {
  try {
    const deltas: number[] = [];
    let last = performance.now();
    for (let i = 0; i < 200; i++) {
      const now = performance.now();
      if (now !== last) deltas.push(now - last);
      last = now;
    }
    if (deltas.length === 0) return false;
    const nonZero = deltas.filter((d) => d > 0);
    if (nonZero.length === 0) return false;
    const minDelta = Math.min(...nonZero);
    // sub-millisecond resolution is normal; anything coarser than ~1ms is a tell
    return minDelta >= 1;
  } catch {
    return false;
  }
}

/** Malformed statements whose exact error text differs by JS engine, a
 * classic way to unmask a UA string claiming a browser the engine isn't. */
function identifyEngine(): string {
  const messages: string[] = [];
  const grab = (f: () => void) => {
    try { f(); } catch (err) { messages.push(err instanceof Error ? err.message : String(err)); }
  };
  grab(() => { (null as any)[0]; });
  grab(() => { (1).toFixed(-1); });
  grab(() => { Reflect.get(null as any, 'x' as any); });
  grab(() => { new (Array as any)(-1); });
  grab(() => { decodeURIComponent('%'); });

  const text = messages.join(' | ');
  if (/Cannot read propert(y|ies) of null/i.test(text) || /is not a function/i.test(text)) return 'v8';
  if (/null has no properties|can't access property/i.test(text)) return 'spidermonkey';
  if (/null is not an object/i.test(text)) return 'javascriptcore';
  return 'unknown';
}

/** Feature matrix → best-guess "real" platform, independent of the UA string
 * the browser is willing to hand over. */
function featureImpliedPlatform(): { platform: string; mismatch: boolean } {
  const n = navigator as any;
  const w = window as any;
  const has = (v: unknown) => v !== undefined && v !== null;

  const isIOS = has(n.standalone) || (has(w.ApplePaySession) && /iPhone|iPad|iPod/.test(n.userAgent) === false && n.maxTouchPoints > 0 && !w.MSStream);
  const isMac = has(w.ApplePaySession) && !isIOS;
  const isAndroid = (has(n.getGamepads) || true) && n.maxTouchPoints > 0 && !isIOS && !isMac && /Android/i.test(n.userAgent);
  const isWindowsish = has(w.chrome) && !isMac && !isAndroid && !isIOS && n.maxTouchPoints === 0;

  let platform: 'windows' | 'macos' | 'linux' | 'android' | 'ios' | 'unknown' = 'unknown';
  if (isIOS) platform = 'ios';
  else if (isAndroid) platform = 'android';
  else if (isMac) platform = 'macos';
  else if (isWindowsish) platform = 'windows';
  else if (has(w.chrome) || has(w.SharedWorker)) platform = 'linux';

  const ua = String(n.userAgent || '').toLowerCase();
  const uaClaims = ua.includes('windows') ? 'windows'
    : ua.includes('mac os') ? 'macos'
    : ua.includes('android') ? 'android'
    : (ua.includes('iphone') || ua.includes('ipad')) ? 'ios'
    : ua.includes('linux') ? 'linux'
    : 'unknown';

  const mismatch = platform !== 'unknown' && uaClaims !== 'unknown' && platform !== uaClaims;
  return { platform, mismatch };
}

/** Curated port of CreepJS's tamper-detection ideas: catch a browser lying
 * about itself via patched natives, proxy wrappers, injected globals, timer
 * resolution, and engine/platform fingerprints that disagree with the UA. */
export const liesProbe: Probe = {
  id: 'lies',
  title: 'Lies',
  tier: 0,
  async run() {
    const records: Record_[] = [...nativeIntegrityChecks(), ...proxySmellChecks()];
    const tamperedApis = [...new Set(records.map((r) => r.api))];

    const litter = clientLitter();
    const coarsened = timerCoarsened();

    const brave = Boolean((navigator as any).brave?.isBrave);
    let braveMode: 'aggressive' | 'standard' | undefined;
    if (brave) {
      // Aggressive shields tend to strip/limit things like WebGL debug info
      // or the Storage API; this is a best-effort guess, not a certainty.
      try {
        const c = document.createElement('canvas');
        const gl = c.getContext('webgl');
        const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
        braveMode = dbg ? 'standard' : 'aggressive';
      } catch { /* leave undefined */ }
    }

    let pluginInconsistency = false;
    try {
      const plugins = Array.from(navigator.plugins ?? []);
      const mimeTypes = Array.from(navigator.mimeTypes ?? []);
      const mimeSet = new Set(mimeTypes.map((m) => m.type));
      const pluginMimeSet = new Set<string>();
      for (const p of plugins) {
        for (let i = 0; i < p.length; i++) pluginMimeSet.add(p.item(i)!.type);
      }
      for (const t of pluginMimeSet) if (!mimeSet.has(t)) pluginInconsistency = true;
      for (const m of mimeTypes) if (m.enabledPlugin && !plugins.includes(m.enabledPlugin)) pluginInconsistency = true;
    } catch { /* plugin APIs unavailable, e.g. mobile */ }

    const jsEngine = identifyEngine();
    const { platform: featurePlatform, mismatch: uaPlatformMismatch } = featureImpliedPlatform();

    return [
      sig('lies.records', 'Tamper findings', records, {
        display: records.length ? `${records.length} anomalies` : 'none found',
      }),
      sig('lies.count', 'Tamper count', records.length),
      sig('lies.tamperedApis', 'Tampered APIs', tamperedApis, { display: tamperedApis.join(', ') || 'none' }),
      sig('lies.clientLitter', 'Injected window globals', litter, {
        display: litter.length ? `${litter.length} extra globals` : 'none',
      }),
      sig('lies.timerCoarsened', 'Timer resolution coarsened', coarsened),
      sig('lies.brave', 'Brave detected', brave),
      sig('lies.braveMode', 'Brave shields mode', braveMode ?? null),
      sig('lies.pluginInconsistency', 'Plugin/MIME inconsistency', pluginInconsistency),
      sig('lies.uaPlatformMismatch', 'UA vs feature-implied platform mismatch', uaPlatformMismatch),
      sig('lies.featurePlatform', 'Feature-implied platform', featurePlatform),
      sig('lies.jsEngine', 'JS engine (from error text)', jsEngine),
    ];
  },
};
