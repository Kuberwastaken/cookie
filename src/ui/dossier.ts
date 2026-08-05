import type { Claim, SignalMap } from '../types';

export const ACTS: Record<number, { label: string; invasive?: boolean }> = {
  1: { label: 'Where you are' },
  2: { label: 'What you are using' },
  3: { label: 'What you are using it on' },
  4: { label: "Things that don't add up" },
  5: { label: 'What you have installed' },
  6: { label: 'What is running on your machine right now', invasive: true },
  7: { label: 'You, specifically', invasive: true },
  8: { label: 'The receipt' },
};

const HEDGE: Record<Claim['confidence'], string> = {
  certain: '',
  likely: '',
  guess: '',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const reduceMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export class Dossier {
  private root: HTMLElement;
  private acts = new Map<number, HTMLElement>();

  constructor(root: HTMLElement) {
    this.root = root;
  }

  /** The page opens as a bare blinking cursor — nothing has "loaded" yet. */
  async boot(): Promise<void> {
    const el = document.createElement('p');
    el.className = 'boot';
    el.innerHTML = '<span class="caret"></span>';
    this.root.append(el);
    await sleep(reduceMotion() ? 0 : 900);
    el.remove();
  }

  private act(n: number): HTMLElement {
    let el = this.acts.get(n);
    if (el) return el;
    const meta = ACTS[n] ?? { label: '' };
    el = document.createElement('section');
    el.className = meta.invasive ? 'act invasive' : 'act';
    el.innerHTML = `<p class="act-label">${escape(meta.label)}</p>`;
    this.root.append(el);
    this.acts.set(n, el);
    return el;
  }

  /**
   * Render one claim. Pacing is deliberate: heavier claims get a longer beat
   * before them, so the reveal lands rather than dumping.
   */
  async reveal(claim: Claim, signals: SignalMap): Promise<void> {
    const beat = reduceMotion() ? 0 : Math.min(120 + claim.weight * 55, 900);
    await sleep(beat);

    const host = this.act(claim.act);
    const p = document.createElement('p');
    p.className = `claim ${claim.confidence}`;
    p.innerHTML = markup(claim.text) + `${HEDGE[claim.confidence]}`;

    const btn = document.createElement('button');
    btn.className = 'how-toggle';
    btn.type = 'button';
    btn.textContent = 'how?';
    btn.setAttribute('aria-expanded', 'false');

    const drawer = document.createElement('div');
    drawer.className = 'how';
    drawer.hidden = true;
    drawer.innerHTML = evidenceHtml(claim, signals);

    btn.addEventListener('click', () => {
      drawer.hidden = !drawer.hidden;
      btn.setAttribute('aria-expanded', String(!drawer.hidden));
    });

    p.append(btn);
    host.append(p, drawer);
  }

  /** The consent gate between the passive acts and the invasive ones. */
  gate(prompt: string, cta: string): Promise<boolean> {
    return new Promise((resolve) => {
      const wrap = document.createElement('section');
      wrap.className = 'act gate';
      const p = document.createElement('p');
      p.textContent = prompt;
      const yes = document.createElement('button');
      yes.className = 'go';
      yes.textContent = cta;
      const no = document.createElement('button');
      no.className = 'go ghost';
      no.textContent = 'No thanks';
      no.style.marginLeft = '0.6rem';
      yes.addEventListener('click', () => { wrap.remove(); resolve(true); });
      no.addEventListener('click', () => { wrap.remove(); resolve(false); });
      wrap.append(p, yes, no);
      this.root.append(wrap);
    });
  }

  section(html: string): HTMLElement {
    const el = document.createElement('section');
    el.className = 'act';
    el.innerHTML = html;
    this.root.append(el);
    return el;
  }
}

/** `*emphasis*` in claim text becomes the highlighted span. */
function markup(text: string): string {
  return escape(text).replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

function escape(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function evidenceHtml(claim: Claim, signals: SignalMap): string {
  const lines = claim.evidence.map((id) => {
    const s = signals[id];
    if (!s) return `${id} = <i>unavailable</i>`;
    const v = s.display ?? stringify(s.value);
    return `${escape(s.label)} = <b>${escape(truncate(v, 220))}</b>`;
  });
  return `${escape(claim.how)}\n\n${lines.join('\n')}`;
}

function stringify(v: unknown): string {
  if (v == null) return String(v);
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
