import type { Claim, Inference, SignalMap } from '../types';

const claim = (c: Omit<Claim, 'confidence'> & Partial<Pick<Claim, 'confidence'>>): Claim => ({
  confidence: 'likely', ...c,
});

interface SoftwareHit { name: string; fonts: string[]; confidence: Claim['confidence']; }

/** Installed software inferred from font presence. The LaTeX hit is the star. */
export const softwareFromFonts: Inference = (s) => {
  const hits = (s['fonts.software']?.value as SoftwareHit[] | undefined) ?? [];
  const out: Claim[] = [];

  for (const hit of hits) {
    const line = softwareLine(hit);
    if (!line) continue;
    out.push(claim({
      id: `sw.${slug(hit.name)}`,
      text: line.text,
      confidence: hit.confidence,
      act: 5, weight: line.weight,
      evidence: ['fonts.software', 'fonts.list'],
      how: `We can't list your files, but we can ask the browser which fonts render. "${hit.fonts.slice(0, 3).join('", "')}" are installed, and those ship with ${hit.name}. ${line.aside}`,
    }));
  }
  return out;
};

/** OS and OS-version from font tells, often more precise than the User-Agent. */
export const osFromFonts: Inference = (s) => {
  const ver = s['fonts.impliedOSVersion']?.value as string | undefined;
  const os = s['fonts.impliedOS']?.value as string | undefined;
  if (ver) {
    return [claim({
      id: 'sw.osVersion',
      text: `You're on *${ver}*.`,
      confidence: 'likely', act: 2, weight: 5,
      evidence: ['fonts.impliedOSVersion'],
      how: `${ver} ships a system font that earlier versions don't. We checked for it and it rendered, so we can name not just your OS but its version, without asking.`,
    })];
  }
  if (os && os !== 'unknown') {
    return [claim({
      id: 'sw.os',
      text: `Your operating system is *${cap(os)}*.`,
      confidence: 'likely', act: 2, weight: 3,
      evidence: ['fonts.impliedOS'],
      how: `Certain fonts only exist on ${cap(os)}. They rendered, so that's what you're running, inferred from fonts, independent of whatever your User-Agent claims.`,
    })];
  }
  return [];
};

/**
 * Speech-synthesis voices. We do NOT infer "languages you read" from these,
 * Windows and macOS ship dozens of language voices by default, so that's noise.
 * The honest signal is (a) the exact voice list as a fingerprint, and (b) the
 * languages the user actually *configured* in their browser, which is a real
 * preference, not a shipped default.
 */
export const languagePacks: Inference = (s) => {
  const count = s['voices.count']?.value as number | undefined;
  const prefs = s['platform.languages']?.value as string[] | undefined;
  const out: Claim[] = [];

  // Real signal: extra configured languages beyond the primary one.
  if (prefs && prefs.length > 1) {
    const names = [...new Set(prefs.map((l) => languageName(l.split('-')[0])).filter(Boolean))];
    const nonEnglish = names.filter((n) => n !== 'English');
    if (names.length > 1) {
      out.push(claim({
        id: 'sw.langprefs',
        text: nonEnglish.length
          ? `You've set your browser to prefer ${list(names)}, so you likely read ${list(nonEnglish)}.`
          : `You've configured multiple language preferences: ${list(names)}.`,
        confidence: 'likely', act: 5, weight: 4,
        evidence: ['platform.languages'],
        how: `Your browser sends an ordered list of languages you prefer (navigator.languages) on every request, you configured this, it isn't a default. Sites use it to guess where you're from and what you read.`,
      }));
    }
  }

  // Fingerprint signal: the voice list itself, not the languages.
  if (count && count > 0) {
    out.push(claim({
      id: 'sw.voices',
      text: `Your system has *${count} text-to-speech voices* installed, the exact set is a strong fingerprint.`,
      confidence: 'likely', act: 5, weight: 2,
      evidence: ['voices.count', 'voices.hash'],
      how: `speechSynthesis.getVoices() returns every installed voice. The list varies by OS, OS version, and any voices you've downloaded, enough variation to help pin your exact setup, no permission needed.`,
    }));
  }
  return out;
};

/** Codec/DRM support → hardware generation and streaming setup. */
export const codecInference: Inference = (s) => {
  const support = s['codecs.support']?.value as Record<string, string> | undefined;
  if (!support) return [];
  const out: Claim[] = [];
  const has = (k: string) => support[k] && support[k] !== 'no' && support[k] !== '';

  if (has('hevc') && has('dolbyVision')) {
    out.push(claim({
      id: 'sw.appleHw',
      text: `Your hardware decodes *Dolby Vision*, that's Apple silicon or a high-end setup.`,
      confidence: 'likely', act: 3, weight: 4,
      evidence: ['codecs.support'],
      how: `Dolby Vision and hardware HEVC decode together point at recent Apple hardware or a licensed premium chip. We asked what your browser can play; it told us.`,
    }));
  } else if (has('av1')) {
    out.push(claim({
      id: 'sw.av1',
      text: `You can hardware-decode *AV1*, recent, capable silicon.`,
      confidence: 'guess', act: 3, weight: 2,
      evidence: ['codecs.support'],
      how: `AV1 hardware decode only exists on recent GPUs and SoCs (Intel 11th-gen+, RTX 30-series+, Apple M-series). So your machine isn't old.`,
    }));
  }
  return out;
};

// --- helpers ---------------------------------------------------------------

function softwareLine(hit: SoftwareHit): { text: string; weight: number; aside: string } | null {
  const name = hit.name.toLowerCase();
  if (name.includes('latex') || name.includes('tex')) {
    return {
      text: `You've got *LaTeX's fonts* installed. Academic papers, or a maths-heavy day job.`,
      weight: 8,
      aside: `Almost nobody outside research and academia has these, it's one of the most revealing fonts you can leak.`,
    };
  }
  if (name.includes('adobe')) {
    return { text: `You have *Adobe's fonts* installed.`, weight: 5, aside: `Design or photography software put them there, though fonts stick around long after the app is gone.` };
  }
  if (name.includes('office')) {
    return { text: `*Microsoft Office's fonts* are on this machine.`, weight: 3, aside: `Fonts outlive the software that installed them, so this means Office was here at some point, not necessarily that you still use it.` };
  }
  if (name.includes('developer') || name.includes('coding')) {
    return { text: `You have programmer fonts installed, you *write code*.`, weight: 6, aside: `These fonts don't come with any OS; you went and installed them.` };
  }
  if (name.includes('japanese') || name.includes('chinese') || name.includes('korean') || name.includes('asian') || name.includes('language')) {
    return { text: `You have *${hit.name}* support installed.`, weight: 5, aside: `That's a strong hint about a language you read or write.` };
  }
  return { text: `You have *${hit.name}* installed.`, weight: 3, aside: '' };
}

const LANG: Record<string, string> = {
  en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian',
  pt: 'Portuguese', nl: 'Dutch', ru: 'Russian', ja: 'Japanese', ko: 'Korean',
  zh: 'Chinese', ar: 'Arabic', hi: 'Hindi', tr: 'Turkish', pl: 'Polish',
  sv: 'Swedish', da: 'Danish', fi: 'Finnish', no: 'Norwegian', cs: 'Czech',
  el: 'Greek', he: 'Hebrew', th: 'Thai', vi: 'Vietnamese', id: 'Indonesian',
  uk: 'Ukrainian', ro: 'Romanian', hu: 'Hungarian', ta: 'Tamil', te: 'Telugu',
};

function languageName(code: string): string { return LANG[code] ?? ''; }
function list(items: string[]): string {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }
function slug(s: string): string { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-'); }
