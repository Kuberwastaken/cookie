import type { EdgeContext, Signal, SignalMap } from './types';
import { runProbes } from './runner';
import { Dossier } from './ui/dossier';
import { recall, forget, type Visit } from './persist';
import {
  inferAll, returnVisit, verdict,
  behavioralClaims, typingClaims, personalityTheatre,
  buildBidRequest, pixelCookies,
} from './infer';

// probes
import { platformProbe, displayProbe, hardwareProbe, environmentProbe, codecProbe, voiceProbe } from './probes/core';
import { gpuProbe, canvasProbe, audioProbe, domRectProbe } from './probes/render';
import { fontProbe } from './probes/fonts';
import { liesProbe } from './probes/lies';
import { automationProbe } from './probes/automation';
import { incognitoProbe } from './probes/incognito';
import { cpuArchProbe, mathProbe, applePayProbe, mathmlProbe } from './probes/deep';
import { metaProbe } from './probes/meta';
import { behaviorCapture } from './probes/interactive';
import { localNetProbe } from './probes/localnet';
import { appsProbe } from './probes/apps';
import { extProbe } from './probes/extensions';
import { webrtcProbe } from './probes/webrtc';
import { permissionProbe } from './probes/permissions';

const PASSIVE = [
  platformProbe, displayProbe, hardwareProbe, environmentProbe, codecProbe, voiceProbe,
  gpuProbe, canvasProbe, audioProbe, domRectProbe, fontProbe,
  liesProbe, automationProbe, incognitoProbe,
  cpuArchProbe, mathProbe, applePayProbe, mathmlProbe, metaProbe,
];
const INVASIVE = [localNetProbe, appsProbe, extProbe, webrtcProbe, permissionProbe];

const TYPING_TARGET = 'the quick brown fox jumps over the lazy dog';

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

  // Start watching behaviour immediately, so it accumulates through the whole visit.
  behaviorCapture.attach();

  await dossier.boot();

  const [signals, visit] = await Promise.all([
    (async () => {
      const s: SignalMap = {};
      await loadEdge(s);
      const gathered = await runProbes(PASSIVE, { consented: false, signal: controller.signal });
      return Object.assign(s, gathered);
    })(),
    recall(),
  ]);

  // Acts 1–5: the passive dossier. Act 6+ claims wait for the gate / later acts,
  // even when their underlying signal was gathered passively.
  for (const c of inferAll(signals).filter((c) => c.act < 6)) await dossier.reveal(c, signals);

  // Act 6: the invasive gate.
  const consent = await dossier.gate(
    "Everything so far was passive — no permission, no click, nothing stored. There's a louder set: scanning your own machine, leaking your IP from behind a VPN, reading which permissions and devices you've already granted. Want to see those?",
    'Show me the invasive ones',
  );

  if (consent) {
    const scan = dossier.scanning('Scanning your machine — open ports, real IP, granted permissions, paired devices');
    const invasive = await runProbes(INVASIVE, { consented: true, signal: controller.signal });
    Object.assign(signals, invasive);
    scan.remove();
    const invasiveClaims = inferAll(signals).filter((c) => c.act === 6);
    if (invasiveClaims.length) {
      for (const c of invasiveClaims) await dossier.reveal(c, signals);
    } else {
      dossier.section('<p class="act-label">What we can reach on your machine</p><p class="claim likely" style="opacity:1;transform:none">Nothing detectable this time — your browser blocked the probes, or there was nothing listening. That\'s the good outcome.</p>');
    }
  }

  // Act 7: who you are (behavioural). Interactive typing, then the profile.
  const { input } = await dossier.typingPrompt(TYPING_TARGET);
  const stop = input ? behaviorCapture.captureTyping(input, TYPING_TARGET) : null;
  // Give the sampler a moment to flush the last keyups.
  await new Promise((r) => setTimeout(r, stop ? 400 : 0));
  if (stop) Object.assign(signals, keyed(stop()));
  Object.assign(signals, keyed(behaviorCapture.snapshot()));

  const profile = [
    ...behavioralClaims(signals),
    ...typingClaims(signals),
    ...personalityTheatre(signals),
  ].sort((a, b) => a.weight - b.weight);
  for (const c of profile) await dossier.reveal(c, signals);

  // Act 8: what you're worth (the ad-profile receipt).
  dossier.adReceipt(buildBidRequest(signals), pixelCookies());

  // Act 9: return visit.
  for (const c of returnVisit(visit)) await dossier.reveal(c, signals);

  // Act 10: the receipt.
  const { claims: vClaims, fingerprint, bits } = verdict(signals);
  for (const c of vClaims) await dossier.reveal(c, signals);
  renderFinale(dossier, signals, fingerprint, bits);
}

function keyed(signals: Signal[]): SignalMap {
  const m: SignalMap = {};
  for (const s of signals) m[s.id] = s;
  return m;
}

function renderFinale(dossier: Dossier, signals: SignalMap, fingerprint: string, bits: number) {
  const rows = Object.values(signals)
    .filter((s) => !s.error)
    .map((s) => `<tr><td>${esc(s.label)}</td><td>${esc(display(s))}</td></tr>`)
    .join('');

  const el = dossier.section(`
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
