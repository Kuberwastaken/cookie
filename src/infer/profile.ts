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

  // Input device — the honest, surprising one.
  const pointer = str(s, 'bhv.pointer');
  if (pointer && pointer !== 'none') {
    const label: Record<string, string> = {
      trackpad: `You're on a *trackpad* — almost certainly a laptop.`,
      mouse: `You're using a *mouse*, not a trackpad.`,
      touchscreen: `You're on a *touchscreen*.`,
      stylus: `You're using a *stylus*.`,
    };
    if (label[pointer]) {
      out.push(claim({
        id: 'pf.pointer', text: label[pointer], confidence: 'likely', act: 7, weight: 4,
        evidence: ['bhv.pointer'],
        how: `Your scroll deltas gave it away. Trackpads emit fine-grained, fractional, never-repeating scroll amounts; a mouse wheel clicks in fixed integer notches. There's no API that tells us the difference — we inferred it from the shape of your scrolling.`,
      }));
    }
  }

  // Reading vs skimming — lands hard, fully defensible.
  const skimmed = s['bhv.skimmed']?.value === true;
  const wpm = num(s, 'bhv.wpm');
  const depth = num(s, 'bhv.scrollDepth');
  if (skimmed && wpm) {
    out.push(claim({
      id: 'pf.skim',
      text: `You didn't really read this. You scrolled through at about *${wpm.toLocaleString()} words a minute* — that's skimming, not reading.`,
      confidence: 'likely', act: 7, weight: 6,
      evidence: ['bhv.wpm', 'bhv.scrollDepth'],
      how: `We tracked how fast the page scrolled past you versus how many words were on it. Genuine reading tops out around 600 wpm. You were well past that — you wanted the bottom, not the words.`,
    }));
  } else if (depth != null && depth > 0.85 && wpm && wpm < 500) {
    out.push(claim({
      id: 'pf.read',
      text: `You actually read this — all the way down, at a real reading pace. Thank you. Most people don't.`,
      confidence: 'likely', act: 7, weight: 3,
      evidence: ['bhv.wpm', 'bhv.scrollDepth'],
      how: `Your scroll speed stayed in the range of genuine reading and you reached the bottom. We can tell the difference between reading and skimming from timing alone.`,
    }));
  }

  // Keyboard-only navigation → accessibility signal, delivered respectfully.
  if (s['bhv.keyboardOnly']?.value === true) {
    out.push(claim({
      id: 'pf.keyboard',
      text: `You've navigated this entire page with the *keyboard* — not once with the pointer.`,
      confidence: 'certain', act: 7, weight: 4,
      evidence: ['bhv.keyboardNav', 'bhv.pointerNav'],
      how: `Every navigation was a Tab or arrow key, zero clicks. That's often how people who rely on assistive technology move through a page — and it's completely visible to any site, as a behavioural signal, without asking.`,
    }));
  }

  // Hesitation → soft "stress" framing, explicitly hedged.
  const hes = num(s, 'bhv.hesitationMs');
  if (hes != null && hes > 900) {
    out.push(claim({
      id: 'pf.hesitate',
      text: `You hover over things for about *${(hes / 1000).toFixed(1)} seconds* before clicking. That's not reading the label — that's hesitating.`,
      confidence: 'guess', act: 7, weight: 3,
      evidence: ['bhv.hesitationMs'],
      how: `We timed the gap between your cursor landing on a button and you actually clicking it. Long hovers correlate weakly with uncertainty or caution — take this one with a large grain of salt.`,
    }));
  }

  return out;
}

/** Claims from the interactive "type this sentence" step. */
export function typingClaims(s: SignalMap): Claim[] {
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
    how: `We timestamped every key down and up. Speed is the easy part — the valuable part is the rhythm between keys, which is stable enough per person to be used as a login factor by real companies (TypingDNA, BioCatch).`,
  }));

  if (cv != null) {
    const steady = cv < 0.6;
    out.push(claim({
      id: 'pf.rhythm',
      text: steady
        ? `Your typing rhythm is *steady and practised* — you spend a lot of time at a keyboard.`
        : `Your typing rhythm is *uneven* — hunt-and-peck, or you were distracted.`,
      confidence: 'guess', act: 7, weight: 4,
      evidence: ['key.rhythmCv', 'key.meanDwell'],
      how: `The variability in your between-key timing (${cv.toFixed(2)}) is what distinguishes a touch-typist from a two-finger typist. From a full paragraph this alone can re-identify you across sites — from one sentence it's just a hint.${dwell ? ` Your keys were held ~${dwell}ms each.` : ''}`,
    }));
  }
  return out;
}

/**
 * The OCEAN readout — the demo's thesis made literal. We generate a Big Five
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

  // Deliberately flimsy heuristics — the point is that they're flimsy.
  const traits = {
    Openness: skimmed ? 'curious, jumps ahead' : 'methodical',
    Conscientiousness: corrections > 3 ? 'careful, self-correcting' : 'moves fast, low friction',
    Extraversion: efficiency > 0.85 ? 'decisive, direct' : 'exploratory',
    Agreeableness: hes > 800 ? 'considered, cautious' : 'quick to commit',
    Neuroticism: hes > 1200 || corrections > 5 ? 'a little anxious today' : 'relaxed',
  };
  const summary = Object.entries(traits).map(([k, v]) => `${k}: ${v}`).join(' · ');

  return [claim({
    id: 'pf.ocean',
    text: `Based on ${dwell} seconds of watching you, here's your personality: *${traits.Openness}, ${traits.Neuroticism}*. This is roughly as scientific as a horoscope, and we did it anyway — which is exactly the point.`,
    confidence: 'guess', act: 7, weight: 7,
    evidence: ['bhv.pathEfficiency', 'bhv.hesitationMs', 'bhv.dwellSec'],
    how: `Full Big Five guess: ${summary}. Real personality inference from digital behaviour is a genuine research field — Kosinski's 2013 study predicted traits from tens of thousands of people with hundreds of data points each. We have a few seconds of one session, which is almost no signal. Ad-tech makes exactly this kind of guess about you constantly, with far more data, and never shows you the result. We're showing you ours, and telling you it's mostly nonsense. Theirs is better, and you never see it.`,
  })];
}
