import type { Probe, Signal } from '../types';

const sig = (id: string, label: string, value: unknown, extra: Partial<Signal> = {}): Signal => ({
  id, label, value, ...extra,
});

/**
 * Behaviour is passive: we don't run a fixed measurement, we start listeners and
 * let the page read the accumulator later. Pointer *type* is the fun tell,
 * a trackpad, a mouse and a touchscreen scroll with distinguishable granularity.
 */
class BehaviorState {
  pointer: 'mouse' | 'trackpad' | 'touch' | 'none' = 'none';
  moves = 0;
  private jitter = 0;
  private lastX = 0;
  private lastY = 0;
  start = performance.now();
  maxScroll = 0;

  attach() {
    addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') this.pointer = 'touch';
      else if (this.pointer !== 'touch') this.pointer = 'mouse';
      if (this.moves > 0) {
        const dx = e.clientX - this.lastX;
        const dy = e.clientY - this.lastY;
        this.jitter += Math.abs(dx) + Math.abs(dy);
      }
      this.lastX = e.clientX; this.lastY = e.clientY; this.moves++;
    }, { passive: true });

    // Trackpads emit fractional, high-frequency wheel deltas; mice emit chunky ones.
    addEventListener('wheel', (e) => {
      if (e.deltaMode === 0 && Math.abs(e.deltaY) < 40 && !Number.isInteger(e.deltaY)) {
        if (this.pointer === 'mouse') this.pointer = 'trackpad';
      }
    }, { passive: true });

    addEventListener('scroll', () => {
      const max = document.documentElement.scrollHeight - innerHeight;
      if (max > 0) this.maxScroll = Math.max(this.maxScroll, scrollY / max);
    }, { passive: true });
  }

  snapshot(): Signal[] {
    const dwell = performance.now() - this.start;
    return [
      sig('behavior.pointer', 'Pointer type', this.pointer),
      sig('behavior.dwellMs', 'Time on page (ms)', Math.round(dwell)),
      sig('behavior.scrollDepth', 'Scroll depth', Math.min(1, this.maxScroll)),
      sig('behavior.moveEntropy', 'Pointer path jitter', this.moves ? Math.round(this.jitter / this.moves) : 0),
    ];
  }
}

export const behaviorState = new BehaviorState();

export const behaviorProbe: Probe = {
  id: 'behavior',
  title: 'Behaviour',
  tier: 0,
  async run() {
    behaviorState.attach();
    // Give the user a beat to move before the first snapshot.
    await new Promise((r) => setTimeout(r, 400));
    return behaviorState.snapshot();
  },
};
