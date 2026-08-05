import type { Claim, SignalMap } from '../types';

export const ACTS: Record<number, { label: string; invasive?: boolean }> = {
  1: { label: 'Where you are' },
  2: { label: 'What you are using' },
  3: { label: 'What you are using it on' },
  4: { label: "Things that don't add up" },
  5: { label: 'What you have installed' },
  6: { label: 'What we can reach on your machine', invasive: true },
  7: { label: 'Who you are — not your device', invasive: true },
  8: { label: 'What you are worth' },
  9: { label: "We've met before" },
  10: { label: 'The receipt' },
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

  /** A live "scanning…" placeholder shown while slow probes run. Caller removes it. */
  scanning(text: string): HTMLElement {
    const el = document.createElement('section');
    el.className = 'act';
    el.innerHTML = `<p class="scanning">${escape(text)}<span class="dots"></span></p>`;
    this.root.append(el);
    return el;
  }

  /**
   * The interactive typing step. Shows a target sentence and an input; resolves
   * with the input element (whose keystrokes a probe has been recording) once
   * the user has typed enough, or immediately if they skip.
   */
  typingPrompt(target: string): Promise<{ input: HTMLInputElement | null; skipped: boolean }> {
    return new Promise((resolve) => {
      const wrap = document.createElement('section');
      wrap.className = 'act invasive';
      wrap.innerHTML = `
        <p class="act-label">Now let's profile you, not your device</p>
        <p class="claim likely" style="opacity:1;transform:none">Type this sentence. We'll read how you type, not just what.</p>
        <p class="type-target">${escape(target)}</p>
      `;
      const input = document.createElement('input');
      input.className = 'type-input';
      input.type = 'text';
      input.autocomplete = 'off';
      input.autocapitalize = 'off';
      input.spellcheck = false;
      input.setAttribute('aria-label', 'Type the sentence above');

      const hint = document.createElement('p');
      hint.className = 'type-hint';
      hint.textContent = 'Keep going…';

      const done = document.createElement('button');
      done.className = 'go';
      done.textContent = 'Read my typing';
      done.style.marginTop = '1rem';
      done.disabled = true;

      const skip = document.createElement('button');
      skip.className = 'go ghost';
      skip.textContent = 'Skip this';
      skip.style.marginLeft = '0.6rem';

      let settled = false;
      const finish = (skipped: boolean) => {
        if (settled) return; settled = true;
        input.disabled = true; done.remove(); skip.remove();
        resolve({ input: skipped ? null : input, skipped });
      };

      // Never cut the user off — only enable Done once there's enough to analyse.
      const MIN = 18;
      input.addEventListener('input', () => {
        const n = input.value.trim().length;
        done.disabled = n < MIN;
        if (n < MIN) { hint.textContent = 'Keep going…'; hint.className = 'type-hint'; }
        else if (n < target.length - 2) { hint.textContent = 'Enough to read you — finish the line or hit the button.'; hint.className = 'type-hint ready'; }
        else { hint.textContent = 'Perfect. Press Enter.'; hint.className = 'type-hint ready'; }
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && input.value.trim().length >= MIN) finish(false);
      });
      done.addEventListener('click', () => finish(false));
      skip.addEventListener('click', () => finish(true));

      wrap.append(input, hint, done, skip);
      this.root.append(wrap);
      input.focus();
    });
  }

  /** Render the OpenRTB receipt: a syntax-lit JSON block with a caption. */
  adReceipt(bidRequest: unknown, pixels: Array<{ name: string; value: string; means: string }>): void {
    const json = JSON.stringify(bidRequest, null, 2);
    const el = document.createElement('section');
    el.className = 'act';
    const pixelHtml = pixels.length
      ? `<p class="claim likely" style="opacity:1;transform:none">Your browser is already carrying tracking IDs:</p>` +
        pixels.map((p) => `<div class="how" style="margin-bottom:.6rem"><b>${escape(p.name)}</b> = ${escape(p.value)}\n${escape(p.means)}</div>`).join('')
      : '';
    el.innerHTML = `
      <p class="act-label">What you are worth</p>
      <p class="claim likely" style="opacity:1;transform:none">Every ad-supported page you open auctions you to dozens of bidders in about a tenth of a second. This is the actual message that describes you — built just now, from your real data, in the real format (OpenRTB 2.6):</p>
      <pre class="raw json-receipt">${escape(json)}</pre>
      <p class="how" style="border:0;margin:.4rem 0 1.4rem;padding:0">Everything here is real except <b>user.data.segment</b> — that's where a data broker attaches your inferred interests ("in-market for a car", "new parent", "cardholder"). We can't show yours because we're not a paying buyer. The bidders can.</p>
      ${pixelHtml}
    `;
    this.root.append(el);
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
