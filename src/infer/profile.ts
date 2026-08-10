import type { Claim, SignalMap } from '../types';

const claim = (c: Omit<Claim, 'confidence'> & Partial<Pick<Claim, 'confidence'>>): Claim => ({
  confidence: 'likely', ...c,
});

const num = (s: SignalMap, id: string): number | undefined => {
  const v = s[id]?.value;
  return typeof v === 'number' ? v : undefined;
};
const str = (s: SignalMap, id: string): string | undefined => {
  const v = s[id]?.value;
  return typeof v === 'string' ? v : undefined;
};

/**
 * Behavioural claims. Honesty policy baked into the confidence field:
 *   - device type / reading / motion → reliable → 'certain' or 'likely'
 *   - person-level guesses (mood, age, personality) → 'guess', and the copy
 *     says out loud that it's a guess. The OCEAN readout is deliberate theatre.
 */

/** Act 7-ish: "who you are, not what device." Reliable behavioural facts first. */
export function behavioralClaims(s: SignalMap): Claim[] {
  const out: Claim[] = [];

  // Input device. Mouse-vs-trackpad is inference, not an API, so we only assert
  // it when the scroll evidence is clear; otherwise we stay quiet rather than
  // guess wrong (calling a trackpad a "mouse" is the classic false positive).
  const pointer = str(s, 'bhv.pointer');
  const pointerSure = s['bhv.pointerSure']?.value === true;
  if (pointer && pointer !== 'none') {
    const label: Record<string, string> = {
      trackpad: `You're on a *trackpad*, almost certainly a laptop.`,
      mouse: `You're using a *mouse*, not a trackpad.`,
      touchscreen: `You're on a *touchscreen*.`,
      stylus: `You're using a *stylus*.`,
    };
    const isInferred = pointer === 'mouse' || pointer === 'trackpad';
    if (label[pointer] && (!isInferred || pointerSure)) {
      out.push(claim({
        id: 'pf.pointer', text: label[pointer], confidence: isInferred ? 'likely' : 'certain', act: 7, weight: 4,
        evidence: ['bhv.pointer'],
        how: `Your scroll deltas gave it away. Trackpads emit small, varied, often fractional scroll amounts; a mouse wheel clicks in big, repeating notches (~100px each). There's no API that tells us the difference, we inferred it from the shape of your scrolling.`,
      }));
    }
  }

  // Reading vs skimming, lands hard, fully defensible.
  const skimmed = s['bhv.skimmed']?.value === true;
  const wpm = num(s, 'bhv.wpm');
  const depth = num(s, 'bhv.scrollDepth');
  if (skimmed && wpm) {
    out.push(claim({
      id: 'pf.skim',
      text: `You didn't really read this. You scrolled through at about *${wpm.toLocaleString()} words a minute*, that's skimming, not reading.`,
      confidence: 'likely', act: 7, weight: 6,
      evidence: ['bhv.wpm', 'bhv.scrollDepth'],
      how: `We tracked how fast the page scrolled past you versus how many words were on it. Genuine reading tops out around 600 wpm. You were well past that, you wanted the bottom, not the words.`,
    }));
  } else if (depth != null && depth > 0.85 && wpm && wpm < 500) {
    out.push(claim({
      id: 'pf.read',
      text: `You actually read this, all the way down, at a real reading pace. Thank you. Most people don't.`,
      confidence: 'likely', act: 7, weight: 3,
      evidence: ['bhv.wpm', 'bhv.scrollDepth'],
      how: `Your scroll speed stayed in the range of genuine reading and you reached the bottom. We can tell the difference between reading and skimming from timing alone.`,
    }));
  }

  // Keyboard-only navigation → accessibility signal, delivered respectfully.
  if (s['bhv.keyboardOnly']?.value === true) {
    out.push(claim({
      id: 'pf.keyboard',
      text: `You've navigated this entire page with the *keyboard*, not once with the pointer.`,
      confidence: 'certain', act: 7, weight: 4,
      evidence: ['bhv.keyboardNav', 'bhv.pointerNav'],
      how: `Every navigation was a Tab or arrow key, zero clicks. That's often how people who rely on assistive technology move through a page, and it's completely visible to any site, as a behavioural signal, without asking.`,
    }));
  }

  // Tab-away count, passive attention tracking.
  const tabAways = num(s, 'bhv.tabAways');
  if (tabAways != null && tabAways >= 2) {
    out.push(claim({
      id: 'pf.tabaway',
      text: `You've looked away and come back *${tabAways} times* while this was open. We counted.`,
      confidence: 'certain', act: 7, weight: 3,
      evidence: ['bhv.tabAways'],
      how: `The Page Visibility API tells any site the exact moment you switch tabs or apps, and when you return. Every site you leave open is quietly counting how often it holds your attention.`,
    }));
  }

  // Hesitation → soft "stress" framing, explicitly hedged.
  const hes = num(s, 'bhv.hesitationMs');
  if (hes != null && hes > 900) {
    out.push(claim({
      id: 'pf.hesitate',
      text: `You hover over things for about *${(hes / 1000).toFixed(1)} seconds* before clicking. That's not reading the label, that's hesitating.`,
      confidence: 'guess', act: 7, weight: 3,
      evidence: ['bhv.hesitationMs'],
      how: `We timed the gap between your cursor landing on a button and you actually clicking it. Long hovers correlate weakly with uncertainty or caution, take this one with a large grain of salt.`,
    }));
  }

  return out;
}

/** Claims from the interactive "type this sentence" step. */
export function typingClaims(s: SignalMap): Claim[] {
  // Caught a paste / autofill instead of real typing.
  if (s['key.pasted']?.value === true) {
    return [claim({
      id: 'pf.pasted',
      text: `You *pasted* that, or your browser autofilled it. We were timing the keystrokes, and there weren't any.`,
      confidence: 'certain', act: 7, weight: 5,
      evidence: ['key.pasted'],
      how: `Real typing has 80–200ms gaps between keys. Yours arrived faster than any human hand moves, so it wasn't typed. Sites watch keystroke timing exactly like this to tell people from scripts.`,
    })];
  }
  const wpm = num(s, 'key.wpm');
  if (!wpm) return [];
  const out: Claim[] = [];
  const dwell = num(s, 'key.meanDwell');
  const cv = num(s, 'key.rhythmCv');
  const corrections = num(s, 'key.corrections') ?? 0;

  out.push(claim({
    id: 'pf.typing',
    text: `You type at about *${wpm} words a minute*${corrections > 2 ? `, and you corrected yourself ${corrections} times` : ''}.`,
    confidence: 'certain', act: 7, weight: 5,
    evidence: ['key.wpm', 'key.corrections'],
    how: `We timestamped every key down and up. Speed is the easy part, the valuable part is the rhythm between keys, which is stable enough per person to be used as a login factor by real companies (TypingDNA, BioCatch).`,
  }));

  if (cv != null) {
    const steady = cv < 0.6;
    out.push(claim({
      id: 'pf.rhythm',
      text: steady
        ? `Your typing rhythm is *steady and practised*, you spend a lot of time at a keyboard.`
        : `Your typing rhythm is *uneven*, hunt-and-peck, or you were distracted.`,
      confidence: 'guess', act: 7, weight: 4,
      evidence: ['key.rhythmCv', 'key.meanDwell'],
      how: `The variability in your between-key timing (${cv.toFixed(2)}) is what distinguishes a touch-typist from a two-finger typist. From a full paragraph this alone can re-identify you across sites, from one sentence it's just a hint.${dwell ? ` Your keys were held ~${dwell}ms each.` : ''}`,
    }));
  }
  return out;
}

/** "You've done this before", the cheeky callback when they retype. */
export function repeatTyping(timesBefore: number): Claim[] {
  if (timesBefore < 1) return [];
  const nth = timesBefore + 1;
  return [claim({
    id: 'pf.repeat',
    text: `Also, you've *done this typing test before*. This is time number *${nth}*. We remember. It's honestly just fun watching you do it again.`,
    confidence: 'certain', act: 7, weight: 8,
    evidence: [],
    how: `We tucked a note away the first time you typed, not in a cookie (you'd have cleared that), but across localStorage, IndexedDB, the Cache API and window.name at once. Clearing your cookies didn't touch it. So we knew the moment you started typing that you'd been here before.`,
  })];
}

/**
 * The OCEAN readout, the demo's thesis made literal. We generate a Big Five
 * profile from a single session, then immediately admit it's astrology. The
 * honesty IS the payload: real personality prediction (Kosinski et al., 2013)
 * needed hundreds of data points per person; we have a few seconds of mouse.
 */
export function personalityTheatre(s: SignalMap): Claim[] {
  const efficiency = num(s, 'bhv.pathEfficiency') ?? 0.9;
  const hes = num(s, 'bhv.hesitationMs') ?? 0;
  const skimmed = s['bhv.skimmed']?.value === true;
  const corrections = num(s, 'key.corrections') ?? num(s, 'bhv.backspaces') ?? 0;
  const dwell = num(s, 'bhv.dwellSec') ?? 0;
  const tabAways = num(s, 'bhv.tabAways') ?? 0;
  const depth = num(s, 'bhv.scrollDepth') ?? 0;
  const scrollWpm = num(s, 'bhv.wpm') ?? 0;
  const keyWpm = num(s, 'key.wpm') ?? 0;
  const rhythmCv = num(s, 'key.rhythmCv');
  const clamp = (x: number) => Math.max(0, Math.min(1, x));

  // Deliberately flimsy Big Five scores, the point is that they're flimsy. Each
  // is centred at 0.5 so an unremarkable session sits in the middle and only
  // real behaviour pushes a trait to an extreme, so we don't hand everyone the
  // same "methodical, relaxed" readout. Signals only nudge when they're actually
  // present (a default 0.9 efficiency, meaning "no wandering measured", must NOT
  // read as decisive), which is why every bump is gated on a real reading.
  let openness = 0.5;
  if (skimmed) openness += 0.35;
  openness += Math.min(tabAways, 3) * 0.07;
  if (scrollWpm > 700) openness += 0.12;
  if (depth > 0 && depth < 0.5) openness += 0.1;
  if (!skimmed && depth > 0.9 && scrollWpm > 0 && scrollWpm < 350) openness -= 0.28;

  let consc = 0.5;
  consc += Math.min(corrections, 5) * 0.06;
  if (depth > 0.9) consc += 0.15;
  else if (depth > 0 && depth < 0.4) consc -= 0.2;
  if (hes > 700) consc += 0.1;
  if (skimmed) consc -= 0.2;

  let extra = 0.5;
  if (hes > 0 && hes < 250) extra += 0.2;
  if (hes > 900) extra -= 0.2;
  if (keyWpm > 65) extra += 0.15;
  if (efficiency < 0.6) extra -= 0.2;
  if (skimmed) extra += 0.1;

  let agree = 0.5;
  if (hes > 800) agree += 0.2;
  if (rhythmCv != null && rhythmCv < 0.55) agree += 0.12;
  if (corrections > 3) agree += 0.1;
  if (hes > 0 && hes < 250) agree -= 0.15;

  let neuro = 0.5;
  if (hes > 1200) neuro += 0.25; else if (hes > 700) neuro += 0.1;
  neuro += Math.min(corrections, 6) * 0.05;
  neuro += Math.min(tabAways, 3) * 0.06;
  if (rhythmCv != null && rhythmCv > 0.85) neuro += 0.12;
  if (dwell > 0 && dwell < 8 && !skimmed) neuro += 0.08;
  if (hes > 0 && hes < 300 && corrections === 0) neuro -= 0.2;

  // Three phrases per trait, low → high. Each is a clean, self-contained
  // descriptor (no internal commas or "and") so any two combine as a readable
  // "you're X and Y" instead of a jumbled list.
  const PHRASES: Record<string, [string, string, string]> = {
    Openness: ['methodical', 'focused', 'restlessly curious'],
    Conscientiousness: ['breezy', 'organised', 'meticulous'],
    Extraversion: ['reserved', 'measured', 'decisive'],
    Agreeableness: ['blunt', 'easygoing', 'diplomatic'],
    Neuroticism: ['unflappable', 'a little wired', 'on edge'],
  };
  const tier = (x: number) => (x < 0.42 ? 0 : x < 0.66 ? 1 : 2);

  const scores = [
    { key: 'Openness', score: clamp(openness) },
    { key: 'Conscientiousness', score: clamp(consc) },
    { key: 'Extraversion', score: clamp(extra) },
    { key: 'Agreeableness', score: clamp(agree) },
    { key: 'Neuroticism', score: clamp(neuro) },
  ];
  const traits: Record<string, string> = {};
  for (const { key, score } of scores) traits[key] = PHRASES[key][tier(score)];

  // Headline the two traits furthest from the middle, not always the same pair,
  // so people stop all reading "methodical, relaxed". A per-session seed (fonts
  // / GPU) breaks ties, so even a no-signal visit varies which two show.
  const seedStr = str(s, 'fonts.hash') ?? str(s, 'gpu.renderer') ?? str(s, 'platform.ua') ?? '';
  let seed = 0;
  for (let i = 0; i < seedStr.length; i++) seed = (seed + seedStr.charCodeAt(i)) % 97;
  const ranked = scores
    .map((sc, i) => ({ ...sc, rank: Math.abs(sc.score - 0.5) + ((seed + i) % 5) / 1000 }))
    .sort((a, b) => b.rank - a.rank);
  const a = traits[ranked[0].key];
  const b = traits[ranked[1].key];

  const summary = scores.map(({ key }) => `${key}: ${traits[key]}`).join(' · ');

  return [claim({
    id: 'pf.ocean',
    text: `Based on ${dwell} seconds of watching you, here's the read: you're *${a}* and *${b}*. This is roughly as scientific as a horoscope, and we did it anyway, which is exactly the point.`,
    confidence: 'guess', act: 7, weight: 7,
    evidence: ['bhv.pathEfficiency', 'bhv.hesitationMs', 'bhv.dwellSec'],
    how: `Full Big Five guess: ${summary}. Real personality inference from digital behaviour is a genuine research field, Kosinski's 2013 study predicted traits from tens of thousands of people with hundreds of data points each. We have a few seconds of one session, which is almost no signal. Ad-tech makes exactly this kind of guess about you constantly, with far more data, and never shows you the result. We're showing you ours, and telling you it's mostly nonsense. Theirs is better, and you never see it.`,
  })];
}
