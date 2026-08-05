import type { SignalMap } from '../types';
import type { IntroSegment } from './intro';

/**
 * Builds the intro narration. Static thesis lines are literal (they type while
 * the probes are still running); the spec call-out is a lazy segment that awaits
 * the gathered signals and splices in your real hardware.
 */
export function buildIntroSegments(signals: SignalMap, gather: Promise<unknown>): IntroSegment[] {
  const segments: IntroSegment[] = [];

  const ref = referrerLine();
  if (ref) segments.push(ref);

  segments.push(
    'Hi.',
    'For years, everyone online has known the deal: websites can *fingerprint* you. Identify you. Follow you around.',
    "So we decline the cookie banners. We hunt for the *reject all* button. We feel a little safer.",
    'I have some bad news.',
    "Modern browsers don't really *need the cookie* anymore.",
    'This page set *none*. It asked for *zero permissions*. You have clicked *nothing*.',
    'And yet.',
  );

  // Lazy: wait for the probes, then narrate the machine we found.
  segments.push(async () => {
    await gather;
    return specLines(signals);
  });

  segments.push("Anyway. Let me show you the rest of what I already know about you.");
  return segments;
}

function referrerLine(): string | null {
  let host = '';
  try { host = document.referrer ? new URL(document.referrer).hostname : ''; } catch { host = ''; }
  if (!host) return null;
  if (/news\.ycombinator\.com/.test(host)) return 'You came from Hacker News. Hi. Yes — this is already the part that knows that.';
  if (/reddit\.com/.test(host)) return 'You came from Reddit. Someone posted this, and here you are.';
  if (/(twitter|x)\.com|t\.co/.test(host)) return 'You came from X. Someone tweeted this at you.';
  if (/github\.com/.test(host)) return "You came from GitHub. So you're one of us.";
  if (/producthunt/.test(host)) return 'You came from Product Hunt. Hello, early adopter.';
  if (/google\./.test(host)) return 'You came from a Google search. What did you type to end up here?';
  return `You came from ${host}.`;
}

function specLines(s: SignalMap): string[] {
  const str = (id: string) => (typeof s[id]?.value === 'string' ? (s[id].value as string) : '');
  const numOf = (id: string) => (typeof s[id]?.value === 'number' ? (s[id].value as number) : undefined);

  const ua = str('platform.ua');
  const gpu = str('gpu.renderer');
  const gpuL = gpu.toLowerCase();
  const cores = numOf('hw.cores');
  const hz = numOf('display.refreshHz');
  const res = s['display.resolution']?.value as [number, number] | undefined;

  const { headline, expensive } = deviceHeadline(ua, gpuL, str('platform.model'), res);

  const out: string[] = [];
  out.push(`Nice machine, by the way. *${headline}*.`);

  // Assemble the spec brag from whatever we actually measured.
  const bits: string[] = [];
  if (cores) bits.push(`${cores} CPU cores`);
  const gpuName = prettyGpu(gpu);
  if (gpuName && !/apple m/i.test(headline)) bits.push(gpuName);
  if (hz && hz >= 118) bits.push(`a ${hz}Hz ${/apple|iphone|ipad|mac/i.test(ua) ? 'ProMotion ' : ''}screen`);
  if (res) bits.push(`a ${res[0]}×${res[1]} display`);

  if (bits.length >= 2) {
    out.push(`${cap(list(bits))}. All the bells and whistles.`);
    if (expensive) out.push("Wasn't that extremely expensive?");
  } else if (bits.length === 1) {
    out.push(`${cap(bits[0])}, no less.`);
  }

  return out;
}

function deviceHeadline(ua: string, gpuL: string, model: string, res?: [number, number]): { headline: string; expensive: boolean } {
  if (/swiftshader|llvmpipe|vmware|virtualbox|parallels|basic render/.test(gpuL)) {
    return { headline: "wait — this isn't even real hardware, it's a virtual machine", expensive: false };
  }
  if (/iPhone/.test(ua)) {
    const minDim = res ? Math.min(res[0], res[1]) : 0;
    if (minDim && minDim <= 375) return { headline: 'an older iPhone (it still works, bless it)', expensive: false };
    return { headline: 'an iPhone', expensive: true };
  }
  if (/iPad/.test(ua)) return { headline: 'an iPad', expensive: true };
  if (/Android/.test(ua)) {
    if (/SM-/.test(model) || /SamsungBrowser/.test(ua)) return { headline: 'a Samsung — a person of taste', expensive: false };
    if (/Pixel/i.test(model)) return { headline: 'a Pixel', expensive: false };
    return { headline: 'an Android (…okay, no judgement)', expensive: false };
  }
  if (/Macintosh|Mac OS X/.test(ua)) {
    const m = gpuL.match(/apple\s+(m\d)(\s*(pro|max|ultra))?/i);
    if (m) {
      const chip = (m[1] + (m[3] ? ' ' + m[3] : '')).toUpperCase();
      return { headline: `an Apple ${chip}`, expensive: /pro|max|ultra/.test(gpuL) };
    }
    return { headline: 'an Intel Mac (a vintage one)', expensive: false };
  }
  if (/CrOS/.test(ua)) return { headline: 'a Chromebook', expensive: false };
  if (/rtx\s*(30|40|50)|radeon\s*rx\s*(6|7|9)\d{2}/.test(gpuL)) return { headline: 'a proper gaming rig', expensive: true };
  if (/Windows/.test(ua)) return { headline: 'a Windows PC', expensive: false };
  if (/Linux|X11/.test(ua)) return { headline: 'a Linux box (of course it is)', expensive: false };
  return { headline: 'some kind of machine I can only half-place', expensive: false };
}

function prettyGpu(raw: string): string {
  const nv = raw.match(/(RTX\s*\d{3,4}\s*(?:Ti)?|GTX\s*\d{3,4})/i);
  if (nv) return `an NVIDIA ${nv[1].replace(/\s+/g, ' ').toUpperCase()}`;
  const amd = raw.match(/(Radeon\s+RX\s*\d{3,4}\s*(?:XT)?)/i);
  if (amd) return amd[1];
  const apple = raw.match(/Apple\s+M\d(\s*(Pro|Max|Ultra))?/i);
  if (apple) return `an Apple ${apple[0].replace(/Apple\s+/i, '')}`;
  if (/intel/i.test(raw)) return 'Intel graphics';
  const adreno = raw.match(/Adreno\s*\(TM\)\s*(\d+)/i);
  if (adreno) return `an Adreno ${adreno[1]}`;
  const mali = raw.match(/Mali-\w+/i);
  if (mali) return mali[0];
  return '';
}

function list(items: string[]): string {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}
function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }
