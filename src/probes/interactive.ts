import type { Signal } from '../types';

const sig = (id: string, label: string, value: unknown, extra: Partial<Signal> = {}): Signal => ({
  id, label, value, ...extra,
});

/**
 * Behavioural capture. Unlike the one-shot probes, this accumulates events over
 * the whole visit and is read on demand. Everything here is passive except the
 * keystroke sampler, which only records while the user types into our own box.
 *
 * Honesty policy (see docs): device-type, reading speed and pointer motion are
 * reported as facts because they're reliable; anything about the *person* (age,
 * mood, personality) is emitted with low confidence and labelled as a guess.
 */

interface WheelSample { dy: number; mode: number; }
interface MoveSample { x: number; y: number; t: number; }
export interface KeyEvent { key: string; down: number; up: number; }

class BehaviorCapture {
  private started = performance.now();
  private pointerType: 'mouse' | 'trackpad' | 'touch' | 'pen' | 'none' = 'none';
  private sawTouch = false;
  private sawPen = false;
  private wheels: WheelSample[] = [];
  private moves: MoveSample[] = [];
  private lastMove: MoveSample | null = null;
  private pathLen = 0;
  private clicks = 0;
  private hesitations: number[] = []; // ms hovering a link before clicking it
  private hoverStart = 0;
  private keyboardNavCount = 0;
  private pointerNavCount = 0;
  private maxScroll = 0;
  private scrollSamples: Array<{ depth: number; t: number }> = [];
  private backspaces = 0;
  private tabAways = 0;
  private attached = false;

  attach() {
    if (this.attached) return;
    this.attached = true;

    addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') { this.sawTouch = true; this.pointerType = 'touch'; }
      else if (e.pointerType === 'pen') { this.sawPen = true; this.pointerType = 'pen'; }
      else if (this.pointerType === 'none' || this.pointerType === 'mouse') this.pointerType = 'mouse';

      const s = { x: e.clientX, y: e.clientY, t: performance.now() };
      if (this.lastMove) {
        this.pathLen += Math.hypot(s.x - this.lastMove.x, s.y - this.lastMove.y);
      }
      // Keep a bounded sample for velocity/jerk stats.
      if (this.moves.length < 4000) this.moves.push(s);
      this.lastMove = s;
    }, { passive: true });

    addEventListener('wheel', (e) => {
      if (this.wheels.length < 600) this.wheels.push({ dy: e.deltaY, mode: e.deltaMode });
    }, { passive: true });

    addEventListener('pointerdown', () => { this.clicks++; }, { passive: true });

    // Hover-before-click hesitation on links/buttons.
    addEventListener('pointerover', (e) => {
      const t = e.target as HTMLElement;
      if (t?.closest?.('a,button,.how-toggle,.go')) this.hoverStart = performance.now();
    }, { passive: true });
    addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (this.hoverStart && t?.closest?.('a,button,.how-toggle,.go')) {
        this.hesitations.push(performance.now() - this.hoverStart);
        this.hoverStart = 0;
      }
      this.pointerNavCount++;
    }, { passive: true });

    addEventListener('keydown', (e) => {
      if (e.key === 'Tab' || e.key === 'Enter' || e.key.startsWith('Arrow')) this.keyboardNavCount++;
      if (e.key === 'Backspace') this.backspaces++;
    }, { passive: true });

    // Every time the tab loses foreground, count it, "you looked away N times."
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.tabAways++;
    });

    addEventListener('scroll', () => {
      const max = document.documentElement.scrollHeight - innerHeight;
      if (max > 0) {
        const depth = scrollY / max;
        this.maxScroll = Math.max(this.maxScroll, depth);
        const now = performance.now();
        const last = this.scrollSamples[this.scrollSamples.length - 1];
        if (!last || now - last.t > 60) this.scrollSamples.push({ depth, t: now });
      }
    }, { passive: true });
  }

  // --- pointer / device ----------------------------------------------------

  /**
   * Mouse vs trackpad from wheel-delta shape. The reliable discriminator is the
   * MEDIAN delta magnitude: a mouse wheel clicks in big, repeating notches
   * (~100-120px, only a couple of distinct values); a trackpad emits small,
   * varied, often fractional deltas. We lean trackpad unless it clearly looks
   * like a chunky wheel, and flag `sure:false` when the evidence is thin.
   */
  private classifyPointer(): { type: string; why: string; sure: boolean } {
    if (this.sawPen) return { type: 'stylus', why: 'pen pointer events', sure: true };
    if (this.pointerType === 'touch') return { type: 'touchscreen', why: 'touch pointer events', sure: true };

    if (this.wheels.length < 3) return { type: this.pointerType, why: 'barely scrolled, hard to tell', sure: false };

    const pixel = this.wheels.filter((w) => w.mode === 0);
    const lineMode = this.wheels.filter((w) => w.mode === 1);
    if (!pixel.length && lineMode.length) return { type: 'mouse', why: 'line-mode wheel notches', sure: true };

    const mags = pixel.map((w) => Math.abs(w.dy)).filter((x) => x > 0).sort((a, b) => a - b);
    if (!mags.length) return { type: this.pointerType, why: 'no usable scroll deltas', sure: false };
    const median = mags[Math.floor(mags.length / 2)];
    const anyFractional = pixel.some((w) => !Number.isInteger(w.dy));
    const distinct = new Set(pixel.map((w) => Math.abs(Math.round(w.dy)))).size;

    // macOS trackpads emit fractional pixel deltas, a dead giveaway.
    if (anyFractional) return { type: 'trackpad', why: 'fractional, fine-grained scroll deltas', sure: true };
    // A mouse wheel: big deltas, very few distinct values (repeating notches).
    if (median >= 90 && distinct <= 4) return { type: 'mouse', why: 'big, repeating wheel notches', sure: true };
    // Everything else, small and/or varied, is a trackpad.
    return { type: 'trackpad', why: 'small, varied scroll deltas', sure: median < 60 || distinct > 5 };
  }

  // --- reading -------------------------------------------------------------

  private reading(): { skimmed: boolean; wpm: number; depth: number } {
    const depth = Math.min(1, this.maxScroll);
    // Estimate words that passed through the viewport and the time it took.
    const words = (document.body.innerText || '').trim().split(/\s+/).length;
    const dwell = (performance.now() - this.started) / 1000 / 60; // minutes
    const wordsRead = words * depth;
    const wpm = dwell > 0 ? Math.round(wordsRead / dwell) : 0;
    // Skim if they reached depth fast: fastest genuine reading is ~600wpm.
    const skimmed = depth > 0.5 && wpm > 700;
    return { skimmed, wpm, depth };
  }

  // --- motion --------------------------------------------------------------

  private motion(): { efficiency: number; humanlike: boolean; jerk: number } {
    if (this.moves.length < 8) return { efficiency: 1, humanlike: true, jerk: 0 };
    const first = this.moves[0];
    const last = this.moves[this.moves.length - 1];
    const straight = Math.hypot(last.x - first.x, last.y - first.y);
    const efficiency = this.pathLen > 0 ? Math.min(1, straight / this.pathLen) : 1;

    // Mean absolute jerk (third derivative) as a "smoothness" proxy.
    let jerkSum = 0, n = 0;
    for (let i = 3; i < this.moves.length; i++) {
      const a = this.moves[i - 3], b = this.moves[i - 2], c = this.moves[i - 1], d = this.moves[i];
      const v1 = dist(a, b), v2 = dist(b, c), v3 = dist(c, d);
      jerkSum += Math.abs((v3 - v2) - (v2 - v1));
      n++;
    }
    const jerk = n ? jerkSum / n : 0;
    // Perfectly straight, zero-jerk paths are robotic; humans wobble.
    const humanlike = efficiency < 0.995 && jerk > 0.01;
    return { efficiency, humanlike, jerk };
  }

  snapshot(): Signal[] {
    const p = this.classifyPointer();
    const r = this.reading();
    const m = this.motion();
    const medianHes = this.hesitations.length
      ? [...this.hesitations].sort((a, b) => a - b)[Math.floor(this.hesitations.length / 2)]
      : 0;

    return [
      sig('bhv.pointer', 'Pointer device', p.type, { display: `${p.type} (${p.why})`, entropy: 1.5 }),
      sig('bhv.pointerSure', 'Pointer classification confident', p.sure),
      sig('bhv.dwellSec', 'Time on page (s)', Math.round((performance.now() - this.started) / 1000)),
      sig('bhv.scrollDepth', 'Scroll depth', +r.depth.toFixed(2)),
      sig('bhv.wpm', 'Reading speed (wpm)', r.wpm),
      sig('bhv.skimmed', 'Skimmed rather than read', r.skimmed),
      sig('bhv.pathEfficiency', 'Cursor path efficiency', +m.efficiency.toFixed(3)),
      sig('bhv.human', 'Human-like motion', m.humanlike),
      sig('bhv.clicks', 'Clicks', this.clicks),
      sig('bhv.hesitationMs', 'Median hover-before-click (ms)', Math.round(medianHes)),
      sig('bhv.keyboardNav', 'Keyboard navigations', this.keyboardNavCount),
      sig('bhv.pointerNav', 'Pointer navigations', this.pointerNavCount),
      sig('bhv.backspaces', 'Corrections (backspaces)', this.backspaces),
      sig('bhv.tabAways', 'Times you looked away', this.tabAways),
      sig('bhv.keyboardOnly', 'Keyboard-only navigation',
        this.keyboardNavCount > 3 && this.pointerNavCount === 0),
    ];
  }

  // --- keystroke sampler (interactive) ------------------------------------

  /** Attach to an input; returns a function that yields the typed-rhythm signals. */
  captureTyping(input: HTMLInputElement, target: string): () => Signal[] {
    const events: KeyEvent[] = [];
    const downAt = new Map<string, number>();
    input.addEventListener('keydown', (e) => {
      if (!downAt.has(e.key)) downAt.set(e.key, performance.now());
    });
    input.addEventListener('keyup', (e) => {
      const d = downAt.get(e.key);
      if (d != null) { events.push({ key: e.key, down: d, up: performance.now() }); downAt.delete(e.key); }
    });

    return () => analyzeTyping(events, target, input.value);
  }
}

export function analyzeTyping(events: KeyEvent[], target: string, typed: string): Signal[] {
  const chars = events.filter((e) => e.key.length === 1);
  if (chars.length < 8) {
    return [sig('key.tooShort', 'Typing sample', true, { error: 'not enough keystrokes' })];
  }
  // Dwell = key held; flight = gap between consecutive key presses.
  const dwell = chars.map((e) => e.up - e.down);
  const flight: number[] = [];
  for (let i = 1; i < chars.length; i++) flight.push(chars[i].down - chars[i - 1].down);

  const meanDwell = mean(dwell);
  const meanFlight = mean(flight);
  const totalMs = chars[chars.length - 1].up - chars[0].down;
  const cpm = totalMs > 0 ? Math.round((chars.length / totalMs) * 60000) : 0;
  const wpm = Math.round(cpm / 5);

  // Nobody types faster than ~220 wpm. Sub-20ms gaps between keys mean it wasn't
  // typed at all, a paste, or an autofill. Call it out instead of printing junk.
  if (meanFlight < 20 || wpm > 220) {
    return [sig('key.pasted', 'Typing sample', true, { display: 'not typed, pasted or autofilled' })];
  }
  // Rhythm consistency: low variance = steady, practiced typist.
  const flightCv = stdev(flight) / (meanFlight || 1);
  const corrections = events.filter((e) => e.key === 'Backspace').length;

  // A crude "typing fingerprint", the digraph latency profile, hashed.
  const digraphs: Record<string, number[]> = {};
  for (let i = 1; i < chars.length; i++) {
    const pair = (chars[i - 1].key + chars[i].key).toLowerCase();
    (digraphs[pair] ??= []).push(chars[i].down - chars[i - 1].down);
  }

  return [
    sig('key.wpm', 'Typing speed (wpm)', wpm, { entropy: 2 }),
    sig('key.meanDwell', 'Mean key-hold (ms)', Math.round(meanDwell), { entropy: 2 }),
    sig('key.meanFlight', 'Mean between-key (ms)', Math.round(meanFlight), { entropy: 2 }),
    sig('key.rhythmCv', 'Rhythm variability', +flightCv.toFixed(2), { entropy: 2 }),
    sig('key.corrections', 'Corrections while typing', corrections),
    sig('key.count', 'Keystrokes analysed', chars.length),
    sig('key.digraphs', 'Digraph latency profile', digraphs),
  ];
}

// --- helpers ---------------------------------------------------------------

function dist(a: MoveSample, b: MoveSample) { return Math.hypot(b.x - a.x, b.y - a.y); }
function mean(xs: number[]) { return xs.reduce((s, x) => s + x, 0) / (xs.length || 1); }
function stdev(xs: number[]) {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

export const behaviorCapture = new BehaviorCapture();
