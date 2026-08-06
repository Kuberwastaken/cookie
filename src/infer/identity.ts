import type { Claim, Inference, SignalMap } from '../types';
import type { Visit } from '../persist';
import { deviceFingerprint, totalEntropy } from '../runner';

const claim = (c: Omit<Claim, 'confidence'> & Partial<Pick<Claim, 'confidence'>>): Claim => ({
  confidence: 'likely', ...c,
});

/** Map a User-Agent string to the OS family it claims, matching fonts.impliedOS. */
function osFromUA(ua: string): 'windows' | 'macos' | 'linux' | 'android' | 'ios' | null {
  if (/Windows/.test(ua)) return 'windows';
  if (/Android/.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
  if (/Macintosh|Mac OS X/.test(ua)) return 'macos';
  if (/Linux|X11/.test(ua)) return 'linux';
  return null;
}

const cap = (s: string): string => (s === 'macos' ? 'macOS' : s === 'ios' ? 'iOS' : s.charAt(0).toUpperCase() + s.slice(1));

/** Collapse to a family so Apple(iOS/macOS) and Unix(Linux/Android) don't false-flag. */
function osFamily(os: string): 'windows' | 'apple' | 'unix' | null {
  if (os === 'windows') return 'windows';
  if (os === 'macos' || os === 'ios') return 'apple';
  if (os === 'linux' || os === 'android') return 'unix';
  return null;
}

/**
 * Independent OS read from the installed text-to-speech voices. Font detection
 * is measurement-based and can misfire (it once told a Windows 11 user their
 * fonts were Linux's), so we require this second opinion before accusing anyone
 * of spoofing their User-Agent.
 */
function osFromVoices(s: SignalMap): 'windows' | 'apple' | 'unix' | null {
  const names = s['voices.hash']?.value;
  if (!Array.isArray(names) || !names.length) return null;
  const joined = names.join(' ').toLowerCase();
  if (/microsoft /.test(joined)) return 'windows';
  if (/siri|com\.apple|samantha|daniel|moira|karen|fiona|alex\b/.test(joined)) return 'apple';
  if (/google |espeak|festival/.test(joined)) return 'unix';
  return null;
}

/**
 * The lie-detector claims. Catching the browser in a contradiction is the
 * "I can't hide" beat, it plays in Act 4 alongside the VPN mismatch.
 */
export const lieDetection: Inference = (s) => {
  const out: Claim[] = [];

  const tampered = (s['lies.tamperedApis']?.value as string[] | undefined) ?? [];
  if (tampered.length >= 2) {
    out.push(claim({
      id: 'lie.tampered',
      text: `Something on your machine is *rewriting your browser's own functions* to hide you, we can see the fingerprints of the tampering on ${tampered.length} of them.`,
      confidence: 'certain', act: 4, weight: 8,
      evidence: ['lies.tamperedApis', 'lies.records'],
      how: `Native browser functions have a fixed signature: calling toString() on them returns "[native code]". A privacy extension or anti-detect browser that fakes your fingerprint has to replace those functions, and the replacements don't match. We checked, and ${tampered.slice(0, 3).join(', ')} failed. The attempt to hide is itself a signal.`,
    }));
  }

  // UA-spoof detection, but ONLY when the reliable font-based OS contradicts the
  // UA. The JS-feature-matrix guess (lies.featurePlatform) is too noisy, it
  // misreads ordinary Chrome-on-Mac as Windows, so we don't trust it alone.
  const uaOS = osFromUA((s['platform.ua']?.value as string) || '');
  const fontOS = s['fonts.impliedOS']?.value as string | undefined;
  const uaFam = uaOS ? osFamily(uaOS) : null;
  const fontFam = fontOS ? osFamily(fontOS) : null;
  // Only cry "spoofed" when a second, independent signal (the installed voice
  // list) also disagrees with the User-Agent. Fonts alone are too noisy.
  const voiceFam = osFromVoices(s);
  const corroborated = voiceFam != null && voiceFam !== uaFam;
  if (uaOS && fontOS && fontOS !== 'unknown' && uaFam && fontFam && uaFam !== fontFam && corroborated) {
    out.push(claim({
      id: 'lie.platform',
      text: `Your User-Agent says *${cap(uaOS)}*, but your installed fonts are *${cap(fontOS)}*'s. One of those is lying, and it isn't the fonts.`,
      confidence: 'likely', act: 4, weight: 8,
      evidence: ['fonts.impliedOS', 'platform.ua'],
      how: `The User-Agent string is trivial to fake, so we corroborate it. Certain fonts only ship on certain operating systems, and yours are ${cap(fontOS)}'s, not the ${cap(uaOS)} your User-Agent claims.`,
    }));
  }

  if (s['lies.brave']?.value === true) {
    out.push(claim({
      id: 'lie.brave',
      text: `You're using *Brave*, you didn't tell us, but the browser gives itself away.`,
      confidence: 'certain', act: 4, weight: 5,
      evidence: ['lies.brave'],
      how: `Brave ships a hidden navigator.brave API and a characteristic set of anti-fingerprinting behaviours. Ironically, the fingerprinting defenses are themselves a fingerprint.`,
    }));
  }

  const litter = (s['lies.clientLitter']?.value as string[] | undefined) ?? [];
  if (litter.length >= 3) {
    out.push(claim({
      id: 'lie.litter',
      text: `Oh, and your extensions leave *litter* all over the page, ${litter.length} global variables a clean browser doesn't have. You might as well be carrying a bright red balloon around the internet.`,
      confidence: 'likely', act: 4, weight: 5,
      evidence: ['lies.clientLitter'],
      how: `We compared your window object against a pristine one inside a nested iframe your extensions can't reach. The extra globals (${litter.slice(0, 3).join(', ')}…) were injected by extensions running right now.`,
    }));
  }

  return out;
};

/** Bot/VM detection, mostly relevant for the HN crowd testing with automation. */
export const automation: Inference = (s) => {
  const out: Claim[] = [];
  if (s['bot.headless']?.value === true) {
    const reasons = (s['bot.reasons']?.value as string[] | undefined) ?? [];
    out.push(claim({
      id: 'id.bot',
      text: `You're not a person, you're an *automated browser*. Nice try.`,
      confidence: 'likely', act: 4, weight: 6,
      evidence: ['bot.score', 'bot.reasons'],
      how: `Headless and automated browsers leak tells: ${reasons.slice(0, 2).join('; ') || 'webdriver flags, missing chrome runtime, software rendering'}. You tripped ${reasons.length} of them.`,
    }));
  }
  if (s['bot.vm']?.value === true) {
    out.push(claim({
      id: 'id.vm',
      text: `You're inside a *virtual machine*.`,
      confidence: 'likely', act: 4, weight: 5,
      evidence: ['gpu.renderer', 'bot.vm'],
      how: `Your GPU renderer string names a virtual display adapter (VMware / VirtualBox / Parallels / software rasteriser). Real hardware doesn't report that.`,
    }));
  }
  return out;
};

/** How they arrived, phrased for the return-visit beat. */
function arrivalFlavor(): { direct: string; source: string } {
  let host = '';
  try { host = document.referrer ? new URL(document.referrer).hostname : ''; } catch { host = ''; }
  if (!host) return { direct: 'And you came straight here, no link, no search. You remembered the URL by heart. That is almost sweet.', source: '' };
  let name = host.replace(/^www\./, '');
  if (/news\.ycombinator/.test(host)) name = 'Hacker News';
  else if (/(twitter|x)\.com|t\.co/.test(host)) name = 'X';
  else if (/reddit/.test(host)) name = 'Reddit';
  else if (/linkedin/.test(host)) name = 'LinkedIn';
  else if (/github/.test(host)) name = 'GitHub';
  else if (/google\./.test(host)) name = 'a Google search';
  return { direct: '', source: `And you came back from ${name} again.` };
}

/** The return-visit gotcha, the whole argument, made personal. */
export function returnVisit(visit: Visit): Claim[] {
  const wiped = visit.restored.length;
  const arrival = arrivalFlavor();

  // Storage is being blocked outright, so we genuinely cannot tell whether
  // you've been here before. Say that, rather than insisting it's your first
  // visit every single time (which is what people kept, correctly, calling out).
  if (!visit.persisted) {
    return [claim({
      id: 'id.nostore',
      text: `I tried to tag you so I'd know you next time. Your browser *threw it away*. Every store I reached for came back empty, so as far as I'm concerned you're a stranger every single visit. That's your setup working, and it's rarer than you'd think.`,
      confidence: 'certain', act: 9, weight: 9,
      evidence: [],
      how: `We write a random tag to localStorage, IndexedDB, the Cache API and window.name, then read it straight back. Nothing survived, which means strict tracking protection, a private window, or clear-on-close. Note this cuts both ways: if your browser also randomises canvas and audio (Firefox's resistFingerprinting does), your fingerprint changes every visit too, which is exactly why it looks different each time.`,
    })];
  }

  // First-time visitor still gets a line, foreshadowing the persistence.
  if (visit.count <= 1) {
    return [claim({
      id: 'id.return',
      text: arrival.direct
        ? `First time here, and you typed the link in yourself, bold. Either way, I'll *remember you* now. That's rather the point.`
        : `First time here? I'll *remember you* now, no cookie required. Come back and I'll prove it.`,
      confidence: 'certain', act: 9, weight: 8,
      evidence: [],
      how: `I just stored a random tag, not in a cookie, but across localStorage, IndexedDB, the Cache API and window.name at once. Clear your cookies, come back, and I'll still know you. That's the whole demonstration.`,
    })];
  }

  const daysAgo = Math.max(0, Math.round((Date.now() - visit.first) / 86400000));
  const when = daysAgo === 0 ? 'earlier today' : daysAgo === 1 ? 'yesterday' : `${daysAgo} days ago`;
  const lede = visit.count >= 4
    ? `You *really* like this website, don't you? This is visit number *${visit.count}*.`
    : `I've seen you before, you first showed up *${when}*. This is visit number *${visit.count}*.`;

  const out: Claim[] = [claim({
    id: 'id.return',
    text: `${lede} ${arrival.direct || arrival.source}`.trim(),
    confidence: 'certain', act: 9, weight: 8,
    evidence: [],
    how: `On your first visit I stored a random tag, not in a cookie, but across localStorage, IndexedDB, the Cache API and window.name at once. I never learned your name; I just recognised the tag, and counted.`,
  })];

  if (wiped > 0) {
    out.push(claim({
      id: 'id.evercookie',
      text: `And you *cleared some of it*, ${wiped} of my hiding places were empty when you arrived. I restored them from the ones you missed. This is what tracking looks like without cookies.`,
      confidence: 'certain', act: 9, weight: 10,
      evidence: [],
      how: `You wiped ${visit.restored.join(', ')}, but ${visit.survivors.join(', ')} still held the tag. I copied it back into the empty ones. To actually forget you, every store has to be cleared at the same instant, which is why "clear cookies" was never enough. (There's a Forget Me button below. It genuinely works.)`,
    }));
  }
  return out;
}

/** The receipt: uniqueness, entropy, and the fingerprint hash. */
export function verdict(s: SignalMap): { claims: Claim[]; fingerprint: string; bits: number } {
  const fingerprint = deviceFingerprint(s);
  const bits = totalEntropy(s);
  // 2^bits people share your bucket; invert for "1 in N".
  const oneIn = Math.round(Math.pow(2, bits));

  const claims: Claim[] = [claim({
    id: 'id.entropy',
    text: `Putting it together: roughly *1 in ${format(oneIn)}* browsers look like yours. None of this used a cookie.`,
    confidence: 'likely', act: 10, weight: 9,
    evidence: ['gpu.renderer', 'canvas.hash', 'fonts.hash', 'audio.hash'],
    how: `We summed the identifying information across every signal (${bits.toFixed(1)} bits of entropy) and turned it into a rarity. The exact number is an estimate; the point is that "anonymous" browsing isn't.`,
  })];

  return { claims, fingerprint, bits };
}

function format(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} billion`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} million`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)},000`;
  return String(n);
}
