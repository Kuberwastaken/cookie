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
      how: `We can't list your files, but we can ask the browser which fonts render. "${hit.fonts.slice(0, 3).join('", "')}" are installed — and those ship with ${hit.name}. ${line.aside}`,
    }));
  }
  return out;
};

/** OS and OS-version from font tells — often more precise than the User-Agent. */
export const osFromFonts: Inference = (s) => {
  const ver = s['fonts.impliedOSVersion']?.value as string | undefined;
  const os = s['fonts.impliedOS']?.value as string | undefined;
  if (ver) {
    return [claim({
      id: 'sw.osVersion',
      text: `You're on *${ver}*.`,
      confidence: 'likely', act: 2, weight: 5,
      evidence: ['fonts.impliedOSVersion'],
      how: `${ver} ships a system font that earlier versions don't. We checked for it and it rendered — so we can name not just your OS but its version, without asking.`,
    })];
  }
  if (os && os !== 'unknown') {
    return [claim({
      id: 'sw.os',
      text: `Your operating system is *${cap(os)}*.`,
      confidence: 'likely', act: 2, weight: 3,
      evidence: ['fonts.impliedOS'],
      how: `Certain fonts only exist on ${cap(os)}. They rendered, so that's what you're running — inferred from fonts, independent of whatever your User-Agent claims.`,
    })];
  }
  return [];
};

/** Speech-synthesis voices leak installed language packs → languages you use. */
export const languagePacks: Inference = (s) => {
  const langs = s['voices.langs']?.value as string[] | undefined;
  const count = s['voices.count']?.value as number | undefined;
  if (!langs?.length) return [];

  const human = [...new Set(langs.map((l) => languageName(l.split('-')[0])))].filter(Boolean);
  const extra = human.filter((l) => l && l !== 'English');
  const out: Claim[] = [];

  if (extra.length) {
    out.push(claim({
      id: 'sw.langpacks',
      text: `Your machine has voices installed for ${list(extra)}. You probably ${extra.length > 1 ? 'read those languages' : 'read ' + extra[0]}.`,
      confidence: 'guess', act: 5, weight: 5,
      evidence: ['voices.langs', 'voices.count'],
      how: `speechSynthesis.getVoices() lists every text-to-speech voice on your system — ${count} of them here. The language packs you've installed hint at the languages you actually use.`,
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
      text: `Your hardware decodes *Dolby Vision* — that's Apple silicon or a high-end setup.`,
      confidence: 'likely', act: 3, weight: 4,
      evidence: ['codecs.support'],
      how: `Dolby Vision and hardware HEVC decode together point at recent Apple hardware or a licensed premium chip. We asked what your browser can play; it told us.`,
    }));
  } else if (has('av1')) {
    out.push(claim({
      id: 'sw.av1',
      text: `You can hardware-decode *AV1* — recent, capable silicon.`,
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
      text: `You've got *LaTeX* installed. You write academic papers, or you're a grad student.`,
      weight: 8,
      aside: `Almost nobody outside research and academia has these — it's one of the most revealing fonts you can leak.`,
    };
  }
  if (name.includes('adobe')) {
    return { text: `You have *Adobe Creative Cloud* fonts installed.`, weight: 5, aside: `You do design or photography work.` };
  }
  if (name.includes('office')) {
    return { text: `You use *Microsoft Office*.`, weight: 3, aside: `Common, but still: we know.` };
  }
  if (name.includes('developer') || name.includes('coding')) {
    return { text: `You have programmer fonts installed — you *write code*.`, weight: 6, aside: `These fonts don't come with any OS; you went and installed them.` };
  }
  if (name.includes('japanese') || name.includes('chinese') || name.includes('korean') || name.includes('asian') || name.includes('language')) {
    return { text: `You have *${hit.name}* language support installed.`, weight: 5, aside: `That's a strong hint about a language you read or write.` };
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
