import type { Probe, Signal } from '../types';

const sig = (id: string, label: string, value: unknown, extra: Partial<Signal> = {}): Signal => ({
  id, label, value, ...extra,
});

/** Platform, browser and locale, the mundane stuff, stated with uncomfortable precision. */
export const platformProbe: Probe = {
  id: 'platform',
  title: 'Platform',
  tier: 0,
  async run() {
    const n = navigator as Navigator & {
      userAgentData?: {
        platform?: string;
        mobile?: boolean;
        brands?: Array<{ brand: string; version: string }>;
        getHighEntropyValues?: (h: string[]) => Promise<Record<string, unknown>>;
      };
      deviceMemory?: number;
      oscpu?: string;
    };

    const out: Signal[] = [
      sig('platform.ua', 'User-Agent', navigator.userAgent, { entropy: 10 }),
      sig('platform.platform', 'navigator.platform', navigator.platform, { entropy: 2 }),
      sig('platform.languages', 'Languages', navigator.languages, {
        display: navigator.languages?.join(', '),
        entropy: 4,
      }),
      sig('platform.dnt', 'Do Not Track', navigator.doNotTrack ?? null),
      sig('platform.gpc', 'Global Privacy Control',
        (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl ?? null),
      sig('platform.cookieEnabled', 'Cookies enabled', navigator.cookieEnabled),
      sig('platform.pdfViewer', 'PDF viewer',
        (navigator as Navigator & { pdfViewerEnabled?: boolean }).pdfViewerEnabled ?? null),
      sig('platform.webdriver', 'navigator.webdriver', navigator.webdriver ?? false),
    ];

    // High-entropy client hints: the browser will volunteer CPU architecture,
    // OS version and even device model, no permission required.
    if (n.userAgentData?.getHighEntropyValues) {
      try {
        const hints = await n.userAgentData.getHighEntropyValues([
          'architecture', 'bitness', 'model', 'platformVersion',
          'fullVersionList', 'uaFullVersion', 'wow64',
        ]);
        out.push(
          sig('platform.arch', 'CPU architecture', hints.architecture ?? null, { entropy: 1 }),
          sig('platform.bitness', 'Bitness', hints.bitness ?? null),
          sig('platform.model', 'Device model', hints.model || null, { entropy: 3 }),
          sig('platform.osVersion', 'OS version', hints.platformVersion ?? null, { entropy: 3 }),
          sig('platform.browserVersions', 'Full browser versions', hints.fullVersionList ?? null, {
            display: Array.isArray(hints.fullVersionList)
              ? (hints.fullVersionList as Array<{ brand: string; version: string }>)
                  .map((b) => `${b.brand} ${b.version}`).join(', ')
              : undefined,
            entropy: 4,
          }),
        );
      } catch { /* hint request rejected */ }
    }

    if (n.userAgentData?.platform) {
      out.push(sig('platform.uadPlatform', 'UA-CH platform', n.userAgentData.platform));
      out.push(sig('platform.mobile', 'Mobile', n.userAgentData.mobile ?? null));
    }

    return out;
  },
};

/** Screen geometry, pixel ratio, and, via rAF, the actual refresh rate. */
export const displayProbe: Probe = {
  id: 'display',
  title: 'Display',
  tier: 0,
  async run() {
    const s = screen;
    const out: Signal[] = [
      sig('display.resolution', 'Screen resolution', [s.width, s.height], {
        display: `${s.width} × ${s.height}`, entropy: 4.8,
      }),
      sig('display.available', 'Available area', [s.availWidth, s.availHeight], {
        display: `${s.availWidth} × ${s.availHeight}`, entropy: 4,
      }),
      sig('display.pixelRatio', 'Device pixel ratio', devicePixelRatio, { entropy: 1.5 }),
      sig('display.colorDepth', 'Colour depth', s.colorDepth),
      sig('display.viewport', 'Viewport', [innerWidth, innerHeight], {
        display: `${innerWidth} × ${innerHeight}`,
      }),
      sig('display.orientation', 'Orientation', s.orientation?.type ?? null),
    ];

    // The gap between the browser window and the screen tells you roughly how
    // much OS chrome is present, menu bar, dock, taskbar position.
    out.push(sig('display.chromeHeight', 'OS chrome height', s.height - s.availHeight));
    out.push(sig('display.chromeWidth', 'OS chrome width', s.width - s.availWidth));

    // Refresh rate: sample rAF deltas and take the median, which survives the
    // occasional dropped frame far better than a mean.
    const hz = await new Promise<number>((resolve) => {
      const times: number[] = [];
      let last = performance.now();
      let frames = 0;
      const tick = (now: number) => {
        times.push(now - last);
        last = now;
        if (++frames < 22) requestAnimationFrame(tick);
        else {
          const sorted = times.slice(2).sort((a, b) => a - b);
          const median = sorted[Math.floor(sorted.length / 2)] || 16.7;
          resolve(Math.round(1000 / median));
        }
      };
      requestAnimationFrame(tick);
      setTimeout(() => resolve(0), 900);
    });
    out.push(sig('display.refreshHz', 'Refresh rate', hz, { display: hz ? `${hz} Hz` : 'unknown', entropy: 1.2 }));

    return out;
  },
};

/** CPU, memory, input capability, and connected media device counts. */
export const hardwareProbe: Probe = {
  id: 'hw',
  title: 'Hardware',
  tier: 0,
  async run() {
    const n = navigator as Navigator & {
      deviceMemory?: number;
      connection?: { effectiveType?: string; downlink?: number; rtt?: number; saveData?: boolean; type?: string };
      getBattery?: () => Promise<{ level: number; charging: boolean; chargingTime: number; dischargingTime: number }>;
    };

    const out: Signal[] = [
      sig('hw.cores', 'CPU cores', navigator.hardwareConcurrency ?? null, { entropy: 2.4 }),
      sig('hw.memory', 'Device memory (GB, bucketed)', n.deviceMemory ?? null, { entropy: 1.8 }),
      sig('hw.touchPoints', 'Max touch points', navigator.maxTouchPoints ?? 0),
      sig('hw.pointerCoarse', 'Coarse pointer', matchMedia('(pointer: coarse)').matches),
      sig('hw.hover', 'Hover capable', matchMedia('(hover: hover)').matches),
    ];

    if (n.connection) {
      out.push(
        sig('hw.netType', 'Connection type', n.connection.effectiveType ?? n.connection.type ?? null),
        sig('hw.downlink', 'Downlink (Mbps)', n.connection.downlink ?? null),
        sig('hw.rtt', 'Round-trip time (ms)', n.connection.rtt ?? null),
        sig('hw.saveData', 'Save-Data', n.connection.saveData ?? null),
      );
    }

    // Device counts require no permission at all; only the *labels* are gated.
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const count = (kind: string) => devices.filter((d) => d.kind === kind).length;
      out.push(
        sig('hw.cameras', 'Cameras attached', count('videoinput'), { entropy: 1.2 }),
        sig('hw.microphones', 'Microphones attached', count('audioinput'), { entropy: 1.2 }),
        sig('hw.speakers', 'Audio outputs attached', count('audiooutput'), { entropy: 1.2 }),
        sig('hw.deviceLabels', 'Device labels readable', devices.some((d) => d.label !== '')),
      );
    } catch { /* enumerateDevices unavailable */ }

    if (n.getBattery) {
      try {
        const b = await n.getBattery();
        out.push(
          sig('hw.batteryLevel', 'Battery level', b.level, { display: `${Math.round(b.level * 100)}%`, entropy: 2 }),
          sig('hw.charging', 'Charging', b.charging),
        );
      } catch { /* battery gated */ }
    }

    return out;
  },
};

/** Timezone, locale formatting quirks, and the accessibility media queries. */
export const environmentProbe: Probe = {
  id: 'env',
  title: 'Environment',
  tier: 0,
  async run() {
    const dtf = Intl.DateTimeFormat().resolvedOptions();
    const mq = (q: string) => matchMedia(q).matches;

    return [
      sig('env.timezone', 'Timezone', dtf.timeZone, { entropy: 3.2 }),
      sig('env.tzOffset', 'UTC offset (minutes)', -new Date().getTimezoneOffset()),
      sig('env.locale', 'Locale', dtf.locale, { entropy: 2 }),
      sig('env.calendar', 'Calendar', dtf.calendar),
      sig('env.numbering', 'Numbering system', dtf.numberingSystem),
      sig('env.currency', 'Inferred currency format',
        new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(1234.5)),
      sig('env.localTime', 'Local time', new Date().toString()),
      sig('env.hour', 'Local hour (0-23)', new Date().getHours()),

      sig('env.colorScheme', 'Prefers colour scheme', mq('(prefers-color-scheme: dark)') ? 'dark' : 'light'),
      sig('env.reducedMotion', 'Prefers reduced motion', mq('(prefers-reduced-motion: reduce)'), { entropy: 1 }),
      sig('env.reducedTransparency', 'Prefers reduced transparency', mq('(prefers-reduced-transparency: reduce)')),
      sig('env.contrast', 'Prefers contrast',
        mq('(prefers-contrast: more)') ? 'more' : mq('(prefers-contrast: less)') ? 'less' : 'no-preference'),
      sig('env.forcedColors', 'Forced colours', mq('(forced-colors: active)'), { entropy: 1.5 }),
      sig('env.invertedColors', 'Inverted colours', mq('(inverted-colors: inverted)')),
      sig('env.monochrome', 'Monochrome display', mq('(monochrome: 1)')),
      sig('env.dynamicRange', 'HDR capable', mq('(dynamic-range: high)')),
      sig('env.colorGamut', 'Colour gamut',
        mq('(color-gamut: rec2020)') ? 'rec2020' : mq('(color-gamut: p3)') ? 'p3' : 'srgb', { entropy: 1 }),
    ];
  },
};

/** Codec support, a decent proxy for OS version and hardware tier. */
export const codecProbe: Probe = {
  id: 'codecs',
  title: 'Codecs',
  tier: 0,
  async run() {
    const v = document.createElement('video');
    const a = document.createElement('audio');
    const CANDIDATES: Array<[string, string, HTMLMediaElement]> = [
      ['h264', 'video/mp4; codecs="avc1.42E01E"', v],
      ['hevc', 'video/mp4; codecs="hvc1.1.6.L93.B0"', v],
      ['av1', 'video/mp4; codecs="av01.0.08M.08"', v],
      ['vp9', 'video/webm; codecs="vp9"', v],
      ['dolbyVision', 'video/mp4; codecs="dvh1.05.07"', v],
      ['aac', 'audio/mp4; codecs="mp4a.40.2"', a],
      ['flac', 'audio/flac', a],
      ['opus', 'audio/webm; codecs="opus"', a],
      ['eac3', 'audio/mp4; codecs="ec-3"', a],
    ];

    const support: Record<string, string> = {};
    for (const [name, type, el] of CANDIDATES) support[name] = el.canPlayType(type) || 'no';

    // NOTE: we deliberately do NOT call requestMediaKeySystemAccess() to probe
    // Widevine. It makes Firefox show a "allow DRM content?" prompt, which would
    // make this page's central claim ("it asked for zero permissions") a lie.
    // canPlayType() alone is passive and prompts nothing.

    return [
      sig('codecs.support', 'Codec support', support, {
        display: Object.entries(support).filter(([, r]) => r !== 'no').map(([k]) => k).join(', '),
        entropy: 2.5,
      }),
      sig('codecs.hash', 'Codec fingerprint', JSON.stringify(support)),
    ];
  },
};

/** Installed speech voices: a surprisingly loud signal about OS and language packs. */
export const voiceProbe: Probe = {
  id: 'voices',
  title: 'Speech voices',
  tier: 1,
  async run() {
    const voices = await new Promise<SpeechSynthesisVoice[]>((resolve) => {
      const got = speechSynthesis.getVoices();
      if (got.length) return resolve(got);
      const t = setTimeout(() => resolve(speechSynthesis.getVoices()), 600);
      speechSynthesis.onvoiceschanged = () => { clearTimeout(t); resolve(speechSynthesis.getVoices()); };
    });

    const names = voices.map((v) => `${v.name}|${v.lang}`);
    const langs = [...new Set(voices.map((v) => v.lang))].sort();

    return [
      sig('voices.count', 'Installed voices', voices.length, { entropy: 3 }),
      sig('voices.langs', 'Voice languages', langs, { display: langs.join(', '), entropy: 4 }),
      sig('voices.hash', 'Voice list', names, { display: names.slice(0, 8).join(', '), entropy: 6 }),
      sig('voices.local', 'Locally-synthesised voices', voices.filter((v) => v.localService).length),
    ];
  },
};
