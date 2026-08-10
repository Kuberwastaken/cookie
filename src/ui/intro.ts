/**
 * The intro types inline into the page and STACKS, nothing disappears. Each
 * line is a normal serif paragraph with blue *emphasis*, typed character by
 * character, the page scrolling to follow. When the intro finishes it simply
 * flows into the dossier below in the same theme; there's no seam.
 *
 * A segment is either a literal line or a function resolving to more lines, the
 * latter lets static narration type while the probes finish, then splices in
 * your real specs.
 */

import { follow as followScroll } from './autoscroll';

export type IntroSegment = string | (() => Promise<string[]>);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const reduce = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function delayFor(ch: string): number {
  if (ch === '.' || ch === '?' || ch === '!') return 240;
  if (ch === ',' || ch === ';' || ch === ':') return 100;
  if (ch === '—' || ch === '…') return 320;
  return 22 + Math.random() * 26;
}

async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((res) => { t = setTimeout(() => res(fallback), ms); });
  const out = await Promise.race([p, timeout]);
  clearTimeout(t!);
  return out;
}

interface Token { text: string; em: boolean; }
function parse(line: string): Token[] {
  const tokens: Token[] = [];
  const re = /\*([^*]+)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    if (m.index > last) tokens.push({ text: line.slice(last, m.index), em: false });
    tokens.push({ text: m[1], em: true });
    last = re.lastIndex;
  }
  if (last < line.length) tokens.push({ text: line.slice(last), em: false });
  return tokens;
}

export async function runIntro(root: HTMLElement, segments: IntroSegment[], autoMs = 1500): Promise<void> {
  const state = { skipped: false };

  const skip = document.createElement('button');
  skip.type = 'button';
  skip.className = 'intro-skip';
  skip.textContent = 'skip intro';
  const hint = document.createElement('p');
  hint.className = 'intro-hint';
  hint.textContent = 'press enter →';
  document.body.append(skip, hint);

  // Skipping doesn't discard the intro, it prints the rest of it instantly:
  // every remaining line still lands on the page, just without the typing.
  const skipAll = () => { state.skipped = true; rush?.(); skip.remove(); hint.remove(); };
  skip.addEventListener('click', skipAll);
  const escHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') skipAll(); };
  addEventListener('keydown', escHandler);

  const follow = (el: HTMLElement, force = false) => followScroll(el, { force });

  // Enter/Space means "hurry up": finish the line that's typing right now, and
  // if nothing is typing, move to the next one. Previously the key only did
  // anything in the brief gap after a line finished, so it felt broken.
  let rush: (() => void) | null = null;
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    rush?.();
  };
  addEventListener('keydown', onKey);

  const waitAdvance = () =>
    new Promise<void>((res) => {
      if (state.skipped) return res();
      let done = false;
      const finish = () => { if (done) return; done = true; rush = null; clearTimeout(t); res(); };
      rush = finish;
      const t = setTimeout(finish, autoMs);
    });

  const typeInto = async (p: HTMLElement, line: string) => {
    let rushed = false;
    rush = () => { rushed = true; };
    for (const tok of parse(line)) {
      const target = tok.em ? document.createElement('em') : document.createTextNode('');
      p.append(target);
      if (reduce() || state.skipped || rushed) { target.textContent = tok.text; continue; }
      let i = 0;
      for (const ch of tok.text) {
        target.textContent += ch;
        if (++i % 3 === 0) follow(p);
        await sleep(delayFor(ch));
        if (state.skipped || rushed) { target.textContent = tok.text; break; }
      }
    }
    rush = null;
    follow(p, true);
  };

  for (const seg of segments) {
    const lines = typeof seg === 'string' ? [seg] : await withTimeout(seg(), 8000, []);
    for (const line of lines) {
      const p = document.createElement('p');
      p.className = 'say typing';
      root.append(p);
      if (!reduce() && !state.skipped) await sleep(340);
      await typeInto(p, line);
      p.classList.remove('typing');
      follow(p);
      await waitAdvance();
    }
  }

  removeEventListener('keydown', escHandler);
  removeEventListener('keydown', onKey);
  skip.remove();
  hint.remove();
}
