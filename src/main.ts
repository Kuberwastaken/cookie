import type { EdgeContext, Signal, SignalMap } from './types';
import { runProbes } from './runner';
import { Dossier } from './ui/dossier';
import { recall, forget, type Visit } from './persist';
import { inferAll, returnVisit, verdict } from './infer';

// probes
import { platformProbe, displayProbe, hardwareProbe, environmentProbe, codecProbe, voiceProbe } from './probes/core';
import { gpuProbe, canvasProbe, audioProbe, domRectProbe } from './probes/render';
import { fontProbe } from './probes/fonts';
import { liesProbe } from './probes/lies';
import { automationProbe } from './probes/automation';
import { incognitoProbe } from './probes/incognito';
import { behaviorProbe } from './probes/behavior';
import { localNetProbe } from './probes/localnet';
import { appsProbe } from './probes/apps';
import { extProbe } from './probes/extensions';

const PASSIVE = [
  platformProbe, displayProbe, hardwareProbe, environmentProbe, codecProbe, voiceProbe,
  gpuProbe, canvasProbe, audioProbe, domRectProbe, fontProbe,
  liesProbe, automationProbe, incognitoProbe, behaviorProbe,
];
const INVASIVE = [localNetProbe, appsProbe, extProbe];

/** Pull the edge context and fold it into the signal map under `edge.*`. */
async function loadEdge(signals: SignalMap): Promise<void> {
  try {
    const res = await fetch('/api/context', { headers: { accept: 'application/json' } });
    if (!res.ok) return;
    const ctx = (await res.json()) as EdgeContext & Record<string, unknown>;
    const put = (id: string, label: string, value: unknown) => {
      if (value != null && value !== '') signals[id] = { id, label, value };
    };
    put('edge.ip', 'IP address', ctx.ip);
    put('edge.city', 'City (from IP)', ctx.city);
    put('edge.region', 'Region (from IP)', ctx.region);
    put('edge.country', 'Country (from IP)', ctx.country);
    put('edge.postalCode', 'Postal code (from IP)', ctx.postalCode);
    put('edge.latitude', 'Latitude', ctx.latitude);
    put('edge.longitude', 'Longitude', ctx.longitude);
    put('edge.timezone', 'Timezone (from IP)', ctx.timezone);
    put('edge.asn', 'ASN', ctx.asn);
    put('edge.asOrg', 'Network operator', ctx.asOrganization);
    put('edge.colo', 'Edge datacenter', ctx.colo);
    put('edge.tlsVersion', 'TLS version', ctx.tlsVersion);
    put('edge.tlsCipher', 'TLS cipher', ctx.tlsCipher);
    put('edge.tlsHelloLength', 'ClientHello length', ctx.tlsClientHelloLength);
    put('edge.httpProtocol', 'HTTP protocol', ctx.httpProtocol);
    put('edge.acceptLanguage', 'Accept-Language', ctx.acceptLanguage);
    put('edge.headerOrder', 'Header order', ctx.headerOrder);
    put('edge.clientHints', 'Client hints', ctx.clientHints);
  } catch { /* dev without the function, or offline — the page still works client-side */ }
}

async function main() {
  const root = document.getElementById('dossier')!;
  const dossier = new Dossier(root);
  const controller = new AbortController();
  addEventListener('beforeunload', () => controller.abort());

  await dossier.boot();

  // Gather passive signals and edge context together.
  const [signals, visit] = await Promise.all([
    (async () => {
      const s: SignalMap = {};
      await loadEdge(s);
      const gathered = await runProbes(PASSIVE, { consented: false, signal: controller.signal });
      return Object.assign(s, gathered);
    })(),
    recall(),
  ]);

  // Reveal the passive dossier act by act.
  const passiveClaims = inferAll(signals);
  for (const c of passiveClaims) await dossier.reveal(c, signals);

  // The invasive gate.
  const consent = await dossier.gate(
    "Everything above was passive — no permission, no click, nothing stored. There's a louder set of tricks: scanning the services running on your own machine, guessing which desktop apps and browser extensions you have. Want to see those too?",
    'Show me the invasive ones',
  );

  if (consent) {
    const invasive = await runProbes(INVASIVE, { consented: true, signal: controller.signal });
    Object.assign(signals, invasive);
    const invasiveClaims = inferAll(signals).filter((c) => c.act === 6);
    if (invasiveClaims.length) {
      for (const c of invasiveClaims) await dossier.reveal(c, signals);
    } else {
      dossier.section('<p class="act-label">What is running on your machine</p><p class="claim likely">Nothing detectable this time — your browser blocked the probes, or there was nothing listening. That\'s the good outcome.</p>');
    }
  }

  // Return-visit act.
  for (const c of returnVisit(visit)) await dossier.reveal(c, signals);

  // The receipt.
  const { claims: vClaims, fingerprint, bits } = verdict(signals);
  for (const c of vClaims) await dossier.reveal(c, signals);
  renderFinale(dossier, signals, fingerprint, bits, visit);
}

function renderFinale(
  dossier: Dossier, signals: SignalMap, fingerprint: string, bits: number, visit: Visit,
) {
  const rows = Object.values(signals)
    .filter((s) => !s.error && !s.id.startsWith('edge.') === false || !s.error)
    .filter((s) => !s.error)
    .map((s) => `<tr><td>${esc(s.label)}</td><td>${esc(display(s))}</td></tr>`)
    .join('');

  const el = dossier.section(`
    <p class="act-label">The receipt</p>
    <p class="verdict">Your device fingerprint, this visit:</p>
    <p class="fingerprint">${fingerprint}</p>
    <p class="how" style="border:0;margin:0 0 2rem;padding:0">${bits.toFixed(1)} bits of entropy · assembled from ${Object.keys(signals).length} signals · zero cookies · zero permission prompts</p>
    <p><button class="go" id="raw-btn">Show me the raw data</button>
       <button class="go ghost" id="forget-btn" style="margin-left:.6rem">Forget me</button></p>
    <div id="raw-wrap" hidden><table class="raw"><tbody>${rows}</tbody></table></div>
    <p class="footnote">
      Nothing on this page was stored on a server. Everything ran in your browser, or was
      read from the connection itself. The point isn't that this site is creepy — it's that
      the site you visit <i>after</i> this one can do all of it too, and won't tell you.
      <br><br>Made as a weekend project. It's open source.
    </p>
  `);

  el.querySelector('#raw-btn')?.addEventListener('click', () => {
    const wrap = el.querySelector<HTMLElement>('#raw-wrap')!;
    wrap.hidden = !wrap.hidden;
  });
  el.querySelector('#forget-btn')?.addEventListener('click', async () => {
    await forget();
    const btn = el.querySelector('#forget-btn')!;
    btn.textContent = 'Forgotten — reload to confirm';
    (btn as HTMLButtonElement).disabled = true;
  });
}

function display(s: Signal): string {
  if (s.display) return s.display;
  const v = s.value;
  if (v == null) return String(v);
  if (typeof v === 'object') { try { return JSON.stringify(v); } catch { return String(v); } }
  return String(v);
}

function esc(s: string): string {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
}

main().catch((err) => {
  const root = document.getElementById('dossier');
  if (root) root.innerHTML = `<p class="claim">Something broke while reading you. Ironically, that's the private outcome. <span class="how">${esc(String(err))}</span></p>`;
});
