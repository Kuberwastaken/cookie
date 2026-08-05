/**
 * The cinematic intro. Full-screen, centred, monospace — a machine typing to
 * you, one line at a time, advancing on Enter (or on its own after a beat).
 * Modelled on the typewriter feel of the judge-my-linkedin project: variable
 * per-character delays, a "thinking" pause before each line, a blinking caret.
 *
 * A segment is either a literal line, or a function that resolves to more lines
 * — the latter lets us keep typing static narration while the probes finish,
 * then splice in your real specs the moment they're ready.
 */

export type IntroSegment = string | (() => Promise<string[]>);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const reduce = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function delayFor(ch: string): number {
  if (ch === '.' || ch === '?' || ch === '!') return 260;
  if (ch === ',' || ch === ';' || ch === ':') return 110;
  if (ch === '—' || ch === '…') return 340;
  if (ch === '\n') return 200;
  return 24 + Math.random() * 28;
}

async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((res) => { t = setTimeout(() => res(fallback), ms); });
  const out = await Promise.race([p, timeout]);
  clearTimeout(t!);
  return out;
}

export async function runIntro(root: HTMLElement, segments: IntroSegment[], autoMs = 1600): Promise<void> {
  const overlay = document.createElement('div');
  overlay.className = 'intro';
  const line = document.createElement('p');
  line.className = 'intro-line';
  const cursor = document.createElement('span');
  cursor.className = 'intro-cursor';
  const hint = document.createElement('p');
  hint.className = 'intro-hint';
  hint.textContent = 'press enter →';
  const skip = document.createElement('button');
  skip.type = 'button';
  skip.className = 'intro-skip';
  skip.textContent = 'skip intro';
  line.append(cursor);
  overlay.append(skip, line, hint);
  root.append(overlay);

  let skipped = false;
  const skipAll = () => { skipped = true; };
  skip.addEventListener('click', skipAll);
  const escHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') skipAll(); };
  addEventListener('keydown', escHandler);

  const waitAdvance = () =>
    new Promise<void>((res) => {
      if (skipped) return res();
      let done = false;
      const finish = () => { if (done) return; done = true; removeEventListener('keydown', key); clearTimeout(t); res(); };
      const key = (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); finish(); } };
      addEventListener('keydown', key);
      const t = setTimeout(finish, autoMs);
    });

  const typeLine = async (text: string) => {
    const tn = document.createTextNode('');
    line.replaceChildren(tn, cursor);
    line.style.opacity = '1';
    if (reduce()) { tn.textContent = text; return; }
    for (const ch of text) {
      if (skipped) { tn.textContent = text; return; }
      tn.textContent += ch;
      await sleep(delayFor(ch));
    }
  };

  for (const seg of segments) {
    if (skipped) break;
    const lines = typeof seg === 'string' ? [seg] : await withTimeout(seg(), 8000, []);
    for (const text of lines) {
      if (skipped) break;
      if (!reduce()) await sleep(360); // a beat before each line, as if thinking
      await typeLine(text);
      await waitAdvance();
      if (!reduce()) { line.style.transition = 'opacity .3s'; line.style.opacity = '0'; await sleep(320); }
    }
  }

  removeEventListener('keydown', escHandler);
  overlay.style.transition = 'opacity .4s';
  overlay.style.opacity = '0';
  await sleep(reduce() ? 0 : 420);
  overlay.remove();
}
