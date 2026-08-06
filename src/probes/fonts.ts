import { hash } from '../runner';
import type { Probe, Signal } from '../types';

const sig = (id: string, label: string, value: unknown, extra: Partial<Signal> = {}): Signal => ({
  id, label, value, ...extra,
});

/**
 * Candidate font list: ~120 real font names spanning Windows, macOS, Linux
 * system fonts and software-specific fonts (LaTeX, Office, Adobe, dev tools,
 * CJK language packs). Detection is a signal, not a guarantee, a font may be
 * absent from the OS it "belongs" to (portable installs, custom images), so
 * inference below is expressed as buckets/confidence, never certainty.
 */
const CANDIDATES: string[] = [
  // Windows system
  'Cambria Math', 'Nirmala UI', 'HoloLens MDL2 Assets', 'Segoe UI', 'Segoe Fluent Icons',
  'Segoe MDL2 Assets', 'Segoe UI Symbol', 'Segoe Print', 'Segoe Script', 'Calibri', 'Cambria',
  'Candara', 'Consolas', 'Constantia', 'Corbel', 'Ebrima', 'Gabriola', 'Gadugi', 'Javanese Text',
  'Leelawadee UI', 'Malgun Gothic', 'Microsoft Himalaya', 'Microsoft JhengHei', 'Microsoft New Tai Lue',
  'Microsoft PhagsPa', 'Microsoft Tai Le', 'Microsoft Uighur', 'Microsoft YaHei', 'Microsoft Yi Baiti',
  'MingLiU-ExtB', 'Mongolian Baiti', 'MS Gothic', 'MS Mincho', 'MV Boli', 'Myanmar Text',
  'Sitka', 'SimSun', 'SimSun-ExtB', 'Sylfaen', 'Yu Gothic', 'Yu Mincho',

  // macOS system
  'Helvetica Neue', 'Luminari', 'Galvji', 'Geneva', 'Menlo', '.SF NS', 'Apple Color Emoji',
  'Apple SD Gothic Neo', 'Avenir', 'Avenir Next', 'American Typewriter', 'Andale Mono',
  'Arial Hebrew', 'Athelas', 'Baskerville', 'Big Caslon', 'Bodoni 72', 'Chalkboard SE',
  'Charter', 'Cochin', 'Damascus', 'Didot', 'Futura', 'Gill Sans', 'Hoefler Text',
  'Kailasa', 'Kefa', 'Marker Felt', 'Monaco', 'Noteworthy', 'Optima', 'Palatino',
  'Papyrus', 'PingFang SC', 'PingFang TC', 'Savoye LET', 'Skia', 'Snell Roundhand',
  'Superclarendon', 'Zapfino',

  // Linux
  'Ubuntu', 'DejaVu Sans', 'Liberation Sans', 'Noto Color Emoji', 'Cantarell', 'DejaVu Serif',
  'DejaVu Sans Mono', 'Liberation Serif', 'Liberation Mono', 'Noto Sans', 'Noto Serif',
  'Droid Sans', 'FreeSans', 'FreeSerif', 'Nimbus Sans', 'Nimbus Roman', 'Ubuntu Mono',
  'Ubuntu Condensed', 'Roboto',

  // LaTeX / TeX Live / MacTeX
  'Latin Modern Roman', 'Latin Modern Math', 'CMU Serif', 'TeX Gyre Termes', 'TeX Gyre Heros',
  'TeX Gyre Pagella', 'XITS', 'STIX Two Math',

  // Microsoft Office
  'Bookman Old Style', 'Book Antiqua', 'Century Gothic', 'Franklin Gothic Medium',
  'Perpetua', 'Rockwell',

  // Adobe (legacy CS)
  'Myriad Pro', 'Minion Pro', 'Trajan Pro', 'Adobe Garamond Pro', 'Adobe Caslon Pro',
  'Bickham Script Pro',

  // Developer / coding fonts
  'JetBrains Mono', 'Cascadia Code', 'Fira Code', 'Source Code Pro', 'Hack', 'Iosevka',
  'Victor Mono',

  // CJK / language packs (some overlap with Windows list above, intentionally
  // duplicated conceptually via 'Meiryo' which Windows also ships)
  'Meiryo',
];

const GENERIC_BASELINES = ['monospace', 'sans-serif', 'serif'] as const;
// Two probe strings with different glyph mixes; a real font must shift BOTH.
const PROBE_STRINGS = [
  'mmmmmmmmmmlli-.,WQ@#gjpqy0123456789',
  'ABCDEFabcdef你好こんにちは한국어',
];
const PROBE_SIZE = '72px';
// Sub-pixel noise (esp. under software rasterisers) can wobble widths a hair;
// require a real shift, not a rounding artefact.
const THRESHOLD = 0.75;
// A name no real system ships. If this "detects", the environment is lying
// (headless font stacks return true for everything) and we can't trust anything.
const SENTINEL = 'ZZName_NoSuchFontEver_9137xQ';

/**
 * Measure-based detection only. We deliberately do NOT use document.fonts.check()
 *, it returns true for unavailable fonts in several browsers and in headless
 * Chrome, which would make every software inference a false positive.
 *
 * Returns null if the sentinel tripped (detection is unreliable in this env).
 */
function detectFonts(candidates: string[]): string[] | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Baseline widths for each generic × each probe string.
  const baseline: Record<string, number[]> = {};
  for (const base of GENERIC_BASELINES) {
    baseline[base] = PROBE_STRINGS.map((str) => {
      ctx.font = `${PROBE_SIZE} ${base}`;
      return ctx.measureText(str).width;
    });
  }

  // A font is present only if, under EVERY generic fallback, adding it in front
  // shifts BOTH probe strings' widths past the noise threshold. Overriding all
  // three fallbacks is what distinguishes a real font from a metric coincidence.
  const present = (name: string): boolean => {
    for (const base of GENERIC_BASELINES) {
      for (let i = 0; i < PROBE_STRINGS.length; i++) {
        ctx.font = `${PROBE_SIZE} "${name}", ${base}`;
        const w = ctx.measureText(PROBE_STRINGS[i]).width;
        if (Math.abs(w - baseline[base][i]) < THRESHOLD) return false;
      }
    }
    return true;
  };

  if (present(SENTINEL)) return null; // environment lies about font availability
  return candidates.filter(present);
}

const WINDOWS_TELLS = [
  'Cambria Math', 'Nirmala UI', 'HoloLens MDL2 Assets', 'Segoe UI',
  'Segoe Fluent Icons', 'Segoe MDL2 Assets',
];
const MACOS_TELLS = [
  'Helvetica Neue', 'Luminari', 'Galvji', 'Geneva', 'Menlo', '.SF NS', 'Apple Color Emoji',
];
const LINUX_TELLS = [
  'Ubuntu', 'DejaVu Sans', 'Liberation Sans', 'Noto Color Emoji', 'Cantarell',
];

interface SoftwareMatch {
  name: string;
  fonts: string[];
  confidence: 'certain' | 'likely' | 'guess';
}

function inferSoftware(detected: Set<string>): SoftwareMatch[] {
  const out: SoftwareMatch[] = [];

  const latexFonts = [
    'Latin Modern Roman', 'Latin Modern Math', 'CMU Serif', 'TeX Gyre Termes',
    'TeX Gyre Heros', 'TeX Gyre Pagella', 'XITS', 'STIX Two Math',
  ].filter((f) => detected.has(f));
  // Require 2+ hits: a single Latin Modern / STIX face reaches machines via
  // other software too, and "you write papers" was firing on people who don't.
  if (latexFonts.length >= 2) {
    out.push({ name: 'LaTeX / TeX Live / MacTeX', fonts: latexFonts, confidence: 'guess' });
  }

  const officeFonts = [
    'Bookman Old Style', 'Book Antiqua', 'Century Gothic', 'Franklin Gothic Medium',
    'Perpetua', 'Rockwell',
  ].filter((f) => detected.has(f));
  if (officeFonts.length >= 2) {
    out.push({ name: 'Microsoft Office', fonts: officeFonts, confidence: 'guess' });
  }

  const adobeFonts = [
    'Myriad Pro', 'Minion Pro', 'Trajan Pro', 'Adobe Garamond Pro', 'Adobe Caslon Pro',
    'Bickham Script Pro',
  ].filter((f) => detected.has(f));
  if (adobeFonts.length >= 1) {
    out.push({ name: 'Adobe (legacy CS)', fonts: adobeFonts, confidence: 'guess' });
  }

  const devFonts = [
    'JetBrains Mono', 'Cascadia Code', 'Fira Code', 'Source Code Pro', 'Hack', 'Iosevka',
    'Victor Mono',
  ].filter((f) => detected.has(f));
  if (devFonts.length >= 1) {
    out.push({ name: 'Developer / coding tools', fonts: devFonts, confidence: 'guess' });
  }

  const jpFonts = ['MS Gothic', 'Meiryo'].filter((f) => detected.has(f));
  if (jpFonts.length >= 1) {
    out.push({ name: 'Japanese language pack', fonts: jpFonts, confidence: 'likely' });
  }
  const zhFonts = ['SimSun', 'Microsoft YaHei'].filter((f) => detected.has(f));
  if (zhFonts.length >= 1) {
    out.push({ name: 'Chinese language pack', fonts: zhFonts, confidence: 'likely' });
  }
  const koFonts = ['Malgun Gothic'].filter((f) => detected.has(f));
  if (koFonts.length >= 1) {
    out.push({ name: 'Korean language pack', fonts: koFonts, confidence: 'likely' });
  }
  const saFonts = ['Nirmala UI'].filter((f) => detected.has(f));
  if (saFonts.length >= 1) {
    out.push({ name: 'South Asian script language pack', fonts: saFonts, confidence: 'likely' });
  }

  return out;
}

/** Rasterisation and system-font enumeration, an old trick, still brutally effective. */
export const fontProbe: Probe = {
  id: 'fonts',
  title: 'Fonts',
  tier: 1,
  async run() {
    const detected = detectFonts(CANDIDATES);
    if (detected === null) {
      // Sentinel tripped or no canvas, refuse to guess rather than emit noise.
      return [
        sig('fonts.count', 'Font count', 0),
        sig('fonts.software', 'Implied installed software', [], { display: '', entropy: 0 }),
        sig('fonts.__error', 'Fonts', null, { error: 'font detection unreliable in this environment' }),
      ];
    }
    const detectedSet = new Set(detected);
    const sorted = [...detected].sort();

    // OS inference: bucket by which OS-tell fonts hit, most hits wins.
    const windowsHits = WINDOWS_TELLS.filter((f) => detectedSet.has(f));
    const macosHits = MACOS_TELLS.filter((f) => detectedSet.has(f));
    const linuxHits = LINUX_TELLS.filter((f) => detectedSet.has(f));

    const buckets: Array<{ os: 'windows' | 'macos' | 'linux'; hits: string[] }> = [
      { os: 'windows', hits: windowsHits },
      { os: 'macos', hits: macosHits },
      { os: 'linux', hits: linuxHits },
    ];
    buckets.sort((a, b) => b.hits.length - a.hits.length);

    let impliedOS: 'windows' | 'macos' | 'linux' | 'android' | 'unknown' = 'unknown';
    if (buckets[0].hits.length > 0 && buckets[0].hits.length > (buckets[1]?.hits.length ?? 0)) {
      impliedOS = buckets[0].os;
    } else if (buckets[0].hits.length > 0) {
      // tie among top buckets, leave undetermined rather than guessing
      impliedOS = 'unknown';
    }

    let impliedOSVersion: string | null = null;
    if (detectedSet.has('Segoe Fluent Icons')) {
      impliedOSVersion = 'Windows 11';
    } else if (detectedSet.has('Segoe MDL2 Assets')) {
      impliedOSVersion = 'Windows 10';
    }

    const software = inferSoftware(detectedSet);
    const fontsHash = hash(sorted.join('|'));

    return [
      sig('fonts.list', 'Detected fonts', sorted, {
        display: sorted.slice(0, 12).join(', ') + (sorted.length > 12 ? `, +${sorted.length - 12} more` : ''),
        entropy: 6,
      }),
      sig('fonts.count', 'Font count', sorted.length, { entropy: 2 }),
      sig('fonts.hash', 'Font fingerprint', fontsHash, { entropy: 4 }),
      sig('fonts.impliedOS', 'Implied OS', impliedOS),
      sig('fonts.impliedOSVersion', 'Implied OS version', impliedOSVersion),
      sig('fonts.software', 'Implied installed software', software, {
        display: software.map((s) => s.name).join(', '),
        entropy: software.length ? 2 : 0,
      }),
    ];
  },
};
