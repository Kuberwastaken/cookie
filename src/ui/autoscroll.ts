/**
 * Stick-to-bottom scrolling, the pattern terminals and chat clients use.
 *
 * The naive "am I near the bottom?" test is wrong here: this page appends big
 * blocks at once (the bid-request receipt, the raw-data table), which instantly
 * puts the viewport far from the bottom and would look identical to the reader
 * having scrolled up. So we track the reader's actual intent instead: any
 * deliberate upward scroll detaches, and returning near the bottom re-attaches.
 */

let stick = true;
let installed = false;

function install(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  addEventListener('wheel', (e) => {
    if (e.deltaY < 0) stick = false;
    else if (nearBottom()) stick = true;
  }, { passive: true });

  let touchY = 0;
  addEventListener('touchstart', (e) => { touchY = e.touches[0]?.clientY ?? 0; }, { passive: true });
  addEventListener('touchmove', (e) => {
    const y = e.touches[0]?.clientY ?? 0;
    if (y > touchY + 4) stick = false;      // dragging down = scrolling up
    else if (nearBottom()) stick = true;
    touchY = y;
  }, { passive: true });

  addEventListener('keydown', (e) => {
    if (['PageUp', 'ArrowUp', 'Home'].includes(e.key)) stick = false;
    if (['End', 'PageDown'].includes(e.key)) stick = true;
  });

  // Re-attach whenever the reader lands back at the bottom by any means.
  addEventListener('scroll', () => { if (nearBottom()) stick = true; }, { passive: true });
}

function nearBottom(): boolean {
  return document.documentElement.scrollHeight - (scrollY + innerHeight) < 120;
}

const reduceMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

let last = 0;

/**
 * Keep `el` comfortably in view while content streams in.
 * `smooth` for discrete reveals, instant for per-character typing (queued
 * smooth scrolls stutter badly when re-issued dozens of times a second).
 */
export function follow(el: HTMLElement, opts: { smooth?: boolean; force?: boolean; ratio?: number } = {}): void {
  install();
  if (reduceMotion()) return;
  if (!stick && !opts.force) return;

  const now = performance.now();
  if (!opts.force && now - last < 50) return;
  last = now;

  const bottom = el.getBoundingClientRect().bottom;
  const comfortable = innerHeight * (opts.ratio ?? 0.72);
  if (bottom > comfortable) {
    scrollBy({ top: bottom - comfortable, behavior: opts.smooth ? 'smooth' : 'auto' });
  }
}
