import type { Claim, Inference, SignalMap } from '../types';

/**
 * The opening hook: a snarky one-line judgement of your hardware, shown before
 * anything else. It reads the GPU, CPU, screen and platform in the first frame
 * and reacts like a person glancing at your machine. Every device class is
 * covered — Apple Silicon, Intel Macs, gaming rigs, work-laptop potatoes,
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

export const deviceHook: Inference = (s) => {
  const ua = str(s, 'platform.ua');
  const gpu = str(s, 'gpu.renderer').toLowerCase();
  const model = str(s, 'platform.model');            // UA-CH device model (Android)
  const cores = num(s, 'hw.cores') ?? 0;
  const hz = num(s, 'display.refreshHz') ?? 0;
  const res = s['display.resolution']?.value as [number, number] | undefined;
  const minDim = res ? Math.min(res[0], res[1]) : 0;
  const ev = ['gpu.renderer', 'hw.cores', 'platform.ua', 'display.resolution'];
  const HOW = `We read your GPU string, CPU core count, screen and platform in the first frame — enough to size up your hardware before you'd scrolled a pixel. It's a vibe, not a spec sheet, so don't @ us.`;
  const H = (t: string) => hook(t, HOW, ev);

  // 0) Not real hardware.
  if (/swiftshader|llvmpipe|vmware|virtualbox|parallels|basic render|microsoft basic/.test(gpu)) {
    return [H(`Hold on — this isn't real hardware. You're in a *virtual machine* or a headless browser. Respect the hustle, but I see you.`)];
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
    return [H(`You opened this on an *iPad*. Browsing the real web on a tablet — living dangerously, I respect it.`)];
  }

  // 2) Android — with taste-based exceptions.
  if (/Android/.test(ua)) {
    if (/SM-/.test(model) || /SamsungBrowser/.test(ua) || /samsung/i.test(model)) {
      return [H(`*Samsung?* Okay — a person of taste. Unexpected, but I respect it.`)];
    }
    if (/Pixel/i.test(model)) {
      return [H(`A *Pixel*. The Android for people who are quietly ashamed of Android. Clever.`)];
    }
    if (/Adreno\s*7|Adreno\s*8|Mali-G7|Mali-G8|immortalis/i.test(gpu)) {
      return [H(`A *flagship Android*. Powerful. Still Android. We contain multitudes.`)];
    }
    return [H(`Ew, you opened this on an *Android*? …okay. I guess. No judgement. (Some judgement.)`)];
  }

  // 3) Mac.
  if (/Macintosh|Mac OS X/.test(ua)) {
    const m = gpu.match(/apple\s+(m\d)(\s*(pro|max|ultra))?/i);
    if (m) {
      const chip = (m[1] + (m[3] ? ' ' + m[3] : '')).toUpperCase();
      const highEnd = /pro|max|ultra/i.test(gpu);
      return [H(highEnd
        ? `*Nice machine.* Apple ${chip} — that's the expensive one. Taste and disposable income, a lethal combo.`
        : `*Nice machine.* Apple Silicon (${chip}). Tasteful. Slightly smug. It suits you.`)];
    }
    return [H(`An *Intel Mac*. You've held onto this one a while, haven't you? Loyalty, or inertia — either way, respect.`)];
  }

  // 4) ChromeOS.
  if (/CrOS/.test(ua)) {
    return [H(`A *Chromebook*. Bold. Frugal. Bold. We'll make it work.`)];
  }

  // 5) Windows and other desktop — tier by GPU, then CPU.
  const gaming = /rtx\s*(30|40|50)|rtx\s*(20)[6-9]|radeon\s*rx\s*(6|7|9)\d{2}/i.test(gpu);
  const midGpu = /gtx\s*1[06]|rtx\s*20[0-5]|radeon\s*rx\s*5\d{2}/i.test(gpu);
  const weakGpu = /intel|uhd|hd graphics|iris/.test(gpu);
  const isWindows = /Windows/.test(ua);

  if (gaming || (isWindows && cores >= 12)) {
    const card = (gpu.match(/(rtx\s*\d{3,4}\s*(ti)?|radeon\s*rx\s*\d{3,4}\s*(xt)?)/i)?.[0] || '').toUpperCase().replace(/\s+/g, ' ').trim();
    return [H(`Okay, *nice rig*.${card ? ` That ${card} isn't for spreadsheets` : ` That's a gaming machine`} — and we both know it.${hz >= 120 ? ` A ${hz}Hz screen too. Show-off.` : ''}`)];
  }
  if (isWindows && weakGpu && cores <= 4) {
    return [H(`Wow. This is an *old machine* — or the work laptop IT handed you in 2018. Either way, my condolences.`)];
  }
  if (midGpu) {
    return [H(`A perfectly *respectable PC*. Not a beast, not a potato. The Toyota Corolla of computers.`)];
  }
  if (/Linux|X11/.test(ua)) {
    return [H(`*Linux* on the desktop. Of course it is. We're genuinely honored — say hi to your window manager.`)];
  }
  if (isWindows) {
    return [H(`A *Windows PC*. The people's choice. Statistically, this is most of you, and that's beautiful.`)];
  }

  // 6) Fallback.
  return [H(`Some kind of machine. Unusual enough that I can't place it at a glance — which is its own kind of flex.`)];
};
