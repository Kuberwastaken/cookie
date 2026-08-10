import type { Claim, Inference, SignalMap } from '../types';
import { classifyMacintosh, MAC_EVIDENCE } from './mac';

/**
 * The opening hook: a snarky one-line judgement of your hardware, shown before
 * anything else. It reads the GPU, CPU, screen and platform in the first frame
 * and reacts like a person glancing at your machine. Every device class is
 * covered, Apple Silicon, Intel Macs, gaming rigs, work-laptop potatoes,
 * Android (with Samsung/Pixel exceptions), old and new iPhones, iPads, Linux,
 * Chromebooks and VMs.
 */

const str = (s: SignalMap, id: string): string => {
  const v = s[id]?.value;
  return typeof v === 'string' ? v : '';
};
const num = (s: SignalMap, id: string): number | undefined => {
  const v = s[id]?.value;
  return typeof v === 'number' ? v : undefined;
};

function hook(text: string, how: string, evidence: string[]): Claim {
  return { id: 'hook.device', text, confidence: 'guess', act: 0, weight: 10, evidence, how };
}

/** Where you came from, the fourth-wall opener, before the device judgement. */
const REFERRERS: Array<{ match: RegExp; text: string }> = [
  { match: /news\.ycombinator\.com/, text: `You came from *Hacker News*. Hi. Yes, this is the part of the demo that already knows that.` },
  { match: /lobste\.rs/, text: `You came from *Lobsters*. Good taste.` },
  { match: /reddit\.com|redd\.it/, text: `You came from *Reddit*. Which sub, though. We can guess.` },
  { match: /(twitter|x)\.com|t\.co/, text: `You came from *X*. Someone tweeted this at you, didn't they.` },
  { match: /facebook\.com|fb\./, text: `You came from *Facebook*. Bold, still being there.` },
  { match: /linkedin\.com|lnkd\.in/, text: `You came from *LinkedIn*. Networking, are we.` },
  { match: /youtube\.com|youtu\.be/, text: `You came from *YouTube*. A video sent you. We'd love to know which.` },
  { match: /github\.com/, text: `You came from *GitHub*. So you're one of us. You'll enjoy the source.` },
  { match: /producthunt\.com/, text: `You came from *Product Hunt*. Hello, early adopter.` },
  { match: /google\./, text: `You came from a *Google search*. What did you type to land here?` },
  { match: /bing\.com|duckduckgo\.com/, text: `You came from a *search engine*, the good kind, apparently.` },
  { match: /t\.me|telegram/, text: `You came from *Telegram*. Someone forwarded you.` },
  { match: /mastodon|\.social/, text: `You came from the *fediverse*. Respect.` },
];

export const referrerHook: Inference = (s) => {
  const host = str(s, 'nav.referrerHost');
  if (!host) return [];
  const known = REFERRERS.find((r) => r.match.test(host));
  const text = known ? known.text : `You came from *${host}*.`;
  return [{
    id: 'hook.referrer', text, confidence: 'certain', act: 0, weight: 0,
    evidence: ['nav.referrerHost', 'nav.referrer'],
    how: `Every link you click sends the page you left in the Referer header, and document.referrer hands it to any script. Almost nobody reads it. We read it first, before anything else, which is why this is the opening line.`,
  }];
};

export const deviceHook: Inference = (s) => {
  const ua = str(s, 'platform.ua');
  const gpu = str(s, 'gpu.renderer').toLowerCase();
  const model = str(s, 'platform.model');            // UA-CH device model (Android)
  const cores = num(s, 'hw.cores') ?? 0;
  const hz = num(s, 'display.refreshHz') ?? 0;
  const res = s['display.resolution']?.value as [number, number] | undefined;
  const minDim = res ? Math.min(res[0], res[1]) : 0;
  const ev = ['gpu.renderer', 'hw.cores', 'platform.ua', 'display.resolution'];
  const HOW = `We read your GPU string, CPU core count, screen and platform in the first frame, enough to size up your hardware before you'd scrolled a pixel. It's a vibe, not a spec sheet, so don't @ us.`;
  const H = (t: string) => hook(t, HOW, ev);

  // 0) Not real hardware.
  if (/swiftshader|llvmpipe|vmware|virtualbox|parallels|basic render|microsoft basic/.test(gpu)) {
    return [H(`Hold on, this isn't real hardware. You're in a *virtual machine* or a headless browser. Respect the hustle, but I see you.`)];
  }

  // 1) iPhone / iPad.
  if (/iPhone/.test(ua)) {
    // Small logical width ⇒ older/SE-class device.
    if (minDim && minDim <= 375) {
      return [H(`That is an *ancient iPhone*. It still boots, which is honestly more than I expected. Museum-adjacent.`)];
    }
    if (minDim && minDim >= 428) {
      return [H(`An *iPhone Pro Max*. The big one. Compensating for nothing, I'm sure.`)];
    }
    return [H(`An *iPhone*. Of course it is. Predictable, expensive, fine.`)];
  }
  if (/iPad/.test(ua)) {
    return [H(`You opened this on an *iPad*. Browsing the real web on a tablet, living dangerously, I respect it.`)];
  }

  // 2) Android, with taste-based exceptions.
  if (/Android/.test(ua)) {
    if (/SM-/.test(model) || /SamsungBrowser/.test(ua) || /samsung/i.test(model)) {
      return [H(`*Samsung?* Okay, a person of taste. Unexpected, but I respect it.`)];
    }
    if (/Pixel/i.test(model)) {
      return [H(`A *Pixel*. The Android for people who are quietly ashamed of Android. Clever.`)];
    }
    if (/Adreno\s*7|Adreno\s*8|Mali-G7|Mali-G8|immortalis/i.test(gpu)) {
      return [H(`A *flagship Android*. Powerful. Still Android. We contain multitudes.`)];
    }
    return [H(`Ew, you opened this on an *Android*? …okay. I guess. No judgement. (Some judgement.)`)];
  }

  // 3) Mac, or an iPad wearing the desktop "Macintosh" UA. Safari masks the
  // GPU string to a bare "Apple GPU", so absence of an M-chip there proves
  // nothing — classifyMacintosh folds in the CPU-arch and touchscreen signals.
  if (/Macintosh|Mac OS X/.test(ua)) {
    const mac = classifyMacintosh(s);
    const M = (t: string) => hook(t, HOW, [...ev, ...MAC_EVIDENCE]);
    if (mac.kind === 'ipad') {
      return [M(`An *iPad* pretending to be a Mac. The desktop user-agent was a nice try, but Macs don't have touchscreens.`)];
    }
    if (mac.kind === 'apple-silicon' && mac.chip) {
      const highEnd = /pro|max|ultra/i.test(mac.chip);
      return [M(highEnd
        ? `*Nice machine.* Apple ${mac.chip}, that's the expensive one. Taste and disposable income, a lethal combo.`
        : `*Nice machine.* Apple Silicon (${mac.chip}). Tasteful. Slightly smug. It suits you.`)];
    }
    if (mac.kind === 'apple-silicon') {
      return [M(`*Nice machine.* Apple Silicon. Your browser hides which chip, but the CPU itself told on you.`)];
    }
    if (mac.kind === 'intel') {
      return [M(`An *Intel Mac*. You've held onto this one a while, haven't you? Loyalty, or inertia, either way, respect.`)];
    }
    return [M(`A *Mac*. Beyond that it's keeping quiet, which, honestly, fair.`)];
  }

  // 4) ChromeOS.
  if (/CrOS/.test(ua)) {
    return [H(`A *Chromebook*. Bold. Frugal. Bold. We'll make it work.`)];
  }

  // 5) Windows and other desktop, tier by GPU, then CPU.
  const gaming = /rtx\s*(30|40|50)|rtx\s*(20)[6-9]|radeon\s*rx\s*(6|7|9)\d{2}/i.test(gpu);
  const midGpu = /gtx\s*1[06]|rtx\s*20[0-5]|radeon\s*rx\s*5\d{2}/i.test(gpu);
  const weakGpu = /intel|uhd|hd graphics|iris/.test(gpu);
  const isWindows = /Windows/.test(ua);

  if (gaming || (isWindows && cores >= 12)) {
    const card = (gpu.match(/(rtx\s*\d{3,4}\s*(ti)?|radeon\s*rx\s*\d{3,4}\s*(xt)?)/i)?.[0] || '').toUpperCase().replace(/\s+/g, ' ').trim();
    return [H(`Okay, *nice rig*.${card ? ` That ${card} isn't for spreadsheets` : ` That's a gaming machine`}, and we both know it.${hz >= 120 ? ` A ${hz}Hz screen too. Show-off.` : ''}`)];
  }
  if (isWindows && weakGpu && cores <= 4) {
    return [H(`Wow. This is an *old machine*, or the work laptop IT handed you in 2018. Either way, my condolences.`)];
  }
  if (midGpu) {
    return [H(`A perfectly *respectable PC*. Not a beast, not a potato. The Toyota Corolla of computers.`)];
  }
  if (/Linux|X11/.test(ua)) {
    return [H(`*Linux* on the desktop. Of course it is. We're genuinely honored, say hi to your window manager.`)];
  }
  if (isWindows) {
    return [H(`A *Windows PC*. The people's choice. Statistically, this is most of you, and that's beautiful.`)];
  }

  // 6) Fallback.
  return [H(`Some kind of machine. Unusual enough that I can't place it at a glance, which is its own kind of flex.`)];
};
