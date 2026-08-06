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
  if (/news\.ycombinator\.com/.test(host)) return 'You came from Hacker News. Yes, this is already the part that knows that.';
  if (/lobste\.rs/.test(host)) return 'You came from Lobsters. Good taste.';
  if (/reddit\.com|redd\.it/.test(host)) return 'You came from Reddit. Someone posted this, and here you are.';
  if (/(twitter|x)\.com|t\.co/.test(host)) return 'You came from X. Someone tweeted this at you.';
  if (/linkedin\.com|lnkd\.in/.test(host)) return "You came from LinkedIn. Hope this counts as thought leadership.";
  if (/github\.com/.test(host)) return "You came from GitHub. So you're one of us.";
  if (/producthunt/.test(host)) return 'You came from Product Hunt. Hello, early adopter.';
  if (/news\.google|google\./.test(host)) return 'You came from a Google search. What did you type to end up here?';
  if (/bing\.com|duckduckgo\.com|search\.brave/.test(host)) return 'You came from a search engine. The privacy-conscious kind, even.';
  if (/t\.me|telegram/.test(host)) return 'You came from Telegram. Someone forwarded you this.';
  if (/mastodon|bsky|fosstodon|\.social/.test(host)) return 'You came from the fediverse. Of course you did.';
  if (/facebook\.com|fb\./.test(host)) return 'You came from Facebook. Bold of you, still being there.';
  if (/youtube\.com|youtu\.be/.test(host)) return 'You came from YouTube. A video sent you here.';
  if (/slack\.com/.test(host)) return 'You came from Slack. Someone dropped this in a channel.';
  if (/discord/.test(host)) return 'You came from Discord. Someone posted this in a server.';
  // Fall back to the bare domain, minus the noise that makes it look like a log line.
  return `You came from ${host.replace(/^www\./, '')}.`;
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
  const dpr = numOf('display.pixelRatio') ?? 1;
  // Physical pixels (CSS × DPR), what people actually recognise as their
  // resolution (e.g. 1080×2400), not the logical 420×934 the browser reports.
  const phys = res ? ([Math.round(res[0] * dpr), Math.round(res[1] * dpr)] as [number, number]) : undefined;

  const { headline, tier } = deviceProfile(ua, gpuL, str('platform.model'), res, cores);

  // A VM gets no spec brag, the fact that it's fake IS the punchline.
  if (tier === 'vm') return [`Hold on, this isn't even real hardware. It's a *virtual machine*. We'll play along.`];

  const out: string[] = [`Nice machine, by the way. *${headline}*.`];

  // Graphics first (per the brag order), then cores, screen, resolution.
  const bits: string[] = [];
  const gpuName = prettyGpu(gpu);
  if (gpuName && !/apple m/i.test(headline)) bits.push(gpuName);
  // Browsers cap/round hardwareConcurrency (Firefox tops out, Safari and
  // resistFingerprinting under-report hard), so we never state it as fact.
  if (cores) bits.push(`${cores} CPU cores that it admits to`);
  if (hz && hz >= 118) bits.push(`a ${hz}Hz ${/apple|iphone|ipad|mac/i.test(ua) ? 'ProMotion ' : ''}screen`);
  if (phys) bits.push(`a ${phys[0]}×${phys[1]} display`);

  if (bits.length >= 2) {
    const closer = tier === 'high' ? 'All the bells and whistles.' : tier === 'low' ? 'Doing its best, honestly.' : 'A perfectly capable setup.';
    out.push(`${cap(list(bits))}. ${closer}`);
  } else if (bits.length === 1) {
    out.push(`${cap(bits[0])}, no less.`);
  }

  if (tier === 'high') out.push("Wasn't that extremely expensive?");
  else if (tier === 'low') out.push("Bit of an *old ahh device*, though. Time for an upgrade maybe… in this economy.");

  return out;
}

type Tier = 'high' | 'mid' | 'low' | 'vm';
function deviceProfile(ua: string, gpuL: string, model: string, res: [number, number] | undefined, cores?: number): { headline: string; tier: Tier } {
  if (/swiftshader|llvmpipe|vmware|virtualbox|parallels|basic render/.test(gpuL)) {
    return { headline: 'a virtual machine', tier: 'vm' };
  }
  if (/iPhone/.test(ua)) {
    const minDim = res ? Math.min(res[0], res[1]) : 0;
    if (minDim && minDim <= 375) return { headline: 'an older iPhone (it still works, bless it)', tier: 'low' };
    return { headline: 'an iPhone', tier: 'high' };
  }
  if (/iPad/.test(ua)) return { headline: 'an iPad', tier: 'high' };
  if (/Android/.test(ua)) {
    // Adreno 7xx/8xx and Mali-G7xx/G78+ (and Immortalis) are flagship tiers.
    const adr = gpuL.match(/adreno\D*(\d{3,4})/);
    const mali = gpuL.match(/mali-g(\d{2,3})/);
    const flagship = (adr && +adr[1] >= 700) || (mali && +mali[1] >= 70) || /immortalis/.test(gpuL);
    if (/SM-/.test(model) || /SamsungBrowser/.test(ua)) return { headline: 'a Samsung, a person of taste', tier: flagship ? 'high' : 'mid' };
    if (/Pixel/i.test(model)) return { headline: 'a Pixel', tier: flagship ? 'high' : 'mid' };
    if (flagship) return { headline: 'a flagship Android', tier: 'high' };
    return { headline: 'an Android (…okay, no judgement)', tier: 'mid' };
  }
  if (/Macintosh|Mac OS X/.test(ua)) {
    const m = gpuL.match(/apple\s+(m\d)(\s*(pro|max|ultra))?/i);
    if (m) {
      const chip = (m[1] + (m[3] ? ' ' + m[3] : '')).toUpperCase();
      return { headline: `an Apple ${chip}`, tier: 'high' };
    }
    return { headline: 'an Intel Mac (a vintage one)', tier: 'low' };
  }
  if (/CrOS/.test(ua)) return { headline: 'a Chromebook', tier: 'low' };
  if (/rtx\s*(30|40|50)|radeon\s*rx\s*(6|7|9)\d{2}/.test(gpuL)) return { headline: 'a proper gaming rig', tier: 'high' };
  if (/Windows/.test(ua)) {
    if (/intel|uhd|iris|hd graphics/.test(gpuL) && cores != null && cores <= 4) return { headline: 'a Windows PC', tier: 'low' };
    if (cores != null && cores >= 12) return { headline: 'a Windows PC', tier: 'high' };
    return { headline: 'a Windows PC', tier: 'mid' };
  }
  if (/Linux|X11/.test(ua)) return { headline: 'a Linux box (of course it is)', tier: 'mid' };
  return { headline: 'some kind of machine I can only half-place', tier: 'mid' };
}

function prettyGpu(raw: string): string {
  const nv = raw.match(/(RTX\s*\d{3,4}\s*(?:Ti)?|GTX\s*\d{3,4})/i);
  if (nv) return `an NVIDIA ${nv[1].replace(/\s+/g, ' ').toUpperCase()}`;
  const amd = raw.match(/(Radeon\s+RX\s*\d{3,4}\s*(?:XT)?)/i);
  if (amd) return amd[1];
  const apple = raw.match(/Apple\s+M\d(\s*(Pro|Max|Ultra))?/i);
  if (apple) return `an Apple ${apple[0].replace(/Apple\s+/i, '')}`;
  if (/intel/i.test(raw)) return 'Intel graphics';
  const adreno = raw.match(/Adreno\D*(\d{3,4})/i);
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
