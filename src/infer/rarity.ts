import type { SignalMap } from '../types';

/**
 * A rarity funnel: for each coarse attribute we know roughly how common it is in
 * the global browsing population, so we can show "X% of people share this" and
 * multiply down to a running "1 in N". The prevalences are deliberately rough
 * (public market-share ballparks, ~2026) and independence is a simplification,
 * this is an illustration of how fast identifiers compound, not a measurement.
 */

export interface RarityRow {
  label: string;
  value: string;
  pct: number;      // fraction of users sharing this value (0..1)
  cumulative: number; // running "1 in N" after this row
}

const OS_PREV: Record<string, number> = { windows: 0.30, android: 0.40, apple: 0.25, linux: 0.04 };
const BROWSER_PREV: Record<string, number> = { chrome: 0.64, safari: 0.18, edge: 0.05, firefox: 0.03, samsung: 0.03, opera: 0.02 };
const LANG_PREV: Record<string, number> = {
  en: 0.35, zh: 0.07, es: 0.08, pt: 0.05, fr: 0.04, de: 0.04, ja: 0.03, ru: 0.03,
  ar: 0.03, hi: 0.03, ko: 0.02, it: 0.02, nl: 0.01, tr: 0.02, pl: 0.01,
};
// Rough share of users in the busiest timezones; everything else is long-tail.
const TZ_PREV: Record<string, number> = {
  'America/New_York': 0.06, 'America/Chicago': 0.03, 'America/Los_Angeles': 0.04,
  'Europe/London': 0.03, 'Europe/Paris': 0.03, 'Europe/Berlin': 0.03, 'Europe/Moscow': 0.02,
  'Asia/Shanghai': 0.06, 'Asia/Kolkata': 0.06, 'Asia/Tokyo': 0.03, 'Asia/Singapore': 0.01,
  'Asia/Dubai': 0.01, 'Australia/Sydney': 0.01, 'America/Sao_Paulo': 0.03,
};
// Common screen resolutions (desktop + popular phones); long tail otherwise.
const RES_PREV: Record<string, number> = {
  '1920x1080': 0.20, '1366x768': 0.06, '1536x864': 0.05, '2560x1440': 0.04,
  '1440x900': 0.03, '1280x720': 0.02, '3840x2160': 0.02,
  '390x844': 0.04, '393x852': 0.03, '430x932': 0.02, '360x800': 0.03, '414x896': 0.02,
};

function osFamilyOf(s: SignalMap): { key: string; label: string } {
  const ua = (s['platform.ua']?.value as string) || '';
  if (/Windows/.test(ua)) return { key: 'windows', label: 'Windows' };
  if (/Android/.test(ua)) return { key: 'android', label: 'Android' };
  if (/iPhone|iPad|Macintosh|Mac OS X/.test(ua)) return { key: 'apple', label: /iPhone|iPad/.test(ua) ? 'iOS' : 'macOS' };
  if (/Linux|X11/.test(ua)) return { key: 'linux', label: 'Linux' };
  const f = s['fonts.impliedOS']?.value as string | undefined;
  if (f && f !== 'unknown') return { key: f === 'macos' ? 'apple' : f, label: f };
  return { key: 'other', label: 'an unusual OS' };
}

function browserOf(ua: string): { key: string; label: string } {
  if (/Edg\//.test(ua)) return { key: 'edge', label: 'Edge' };
  if (/SamsungBrowser/.test(ua)) return { key: 'samsung', label: 'Samsung Internet' };
  if (/OPR\/|Opera/.test(ua)) return { key: 'opera', label: 'Opera' };
  if (/Firefox\//.test(ua)) return { key: 'firefox', label: 'Firefox' };
  if (/Chrome\//.test(ua)) return { key: 'chrome', label: 'Chrome' };
  if (/Safari\//.test(ua)) return { key: 'safari', label: 'Safari' };
  return { key: 'other', label: 'an unusual browser' };
}

const LANG_NAME: Record<string, string> = {
  en: 'English', zh: 'Chinese', es: 'Spanish', pt: 'Portuguese', fr: 'French',
  de: 'German', ja: 'Japanese', ru: 'Russian', ar: 'Arabic', hi: 'Hindi',
  ko: 'Korean', it: 'Italian', nl: 'Dutch', tr: 'Turkish', pl: 'Polish',
};

export function rarityFunnel(s: SignalMap): { rows: RarityRow[]; oneIn: number } {
  const rows: Array<{ label: string; value: string; pct: number }> = [];

  const os = osFamilyOf(s);
  rows.push({ label: 'Operating system', value: os.label, pct: OS_PREV[os.key] ?? 0.02 });

  const ua = (s['platform.ua']?.value as string) || '';
  const br = browserOf(ua);
  rows.push({ label: 'Browser', value: br.label, pct: BROWSER_PREV[br.key] ?? 0.02 });

  // Prefer the Accept-Language header: it carries the content languages you
  // actually configured. navigator.languages often reports the browser's UI
  // locale instead (en-US on an English build), which mislabelled people whose
  // real preference is a smaller regional language.
  const acceptLang = (s['edge.acceptLanguage']?.value as string | undefined)?.split(',')[0]?.trim();
  const langFull = acceptLang
    ?? (s['platform.languages']?.value as string[] | undefined)?.[0]
    ?? (s['env.locale']?.value as string | undefined) ?? 'en';
  const langBase = langFull.split('-')[0].toLowerCase();
  rows.push({ label: 'Primary language', value: LANG_NAME[langBase] ?? langFull, pct: LANG_PREV[langBase] ?? 0.01 });

  const tz = s['env.timezone']?.value as string | undefined;
  if (tz) rows.push({ label: 'Timezone', value: tz, pct: TZ_PREV[tz] ?? 0.008 });

  const res = s['display.resolution']?.value as [number, number] | undefined;
  if (res) {
    const key = `${res[0]}x${res[1]}`;
    rows.push({ label: 'Screen resolution', value: `${res[0]} × ${res[1]}`, pct: RES_PREV[key] ?? 0.01 });
  }

  const dntOn = s['platform.dnt']?.value === '1' || s['platform.dnt']?.value === true || s['platform.gpc']?.value === true;
  rows.push({ label: 'Do Not Track', value: dntOn ? 'on (rare)' : 'off', pct: dntOn ? 0.1 : 0.9 });

  // Compound into a running 1-in-N.
  let product = 1;
  const withCumulative: RarityRow[] = rows.map((r) => {
    product *= Math.max(r.pct, 0.0001);
    return { ...r, cumulative: Math.round(1 / product) };
  });

  return { rows: withCumulative, oneIn: Math.round(1 / product) };
}
