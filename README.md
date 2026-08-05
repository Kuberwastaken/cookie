# I didn't set a cookie.

A live demonstration of everything a website learns about you before you click
anything — no cookies, no permission prompts, no consent dialog. It reads you
during the connection and in the first two seconds of JavaScript, then narrates
what it found back to you in plain English, as if a stranger were describing you
out loud.

The argument isn't "look how creepy *this* site is." It's: **the site you visit
after this one can do all of it too, and won't tell you.**

Nothing is stored on a server. Every measurement runs in your browser or is read
from the connection itself. There's a **Forget Me** button that genuinely wipes
the one thing the page does persist (a random return-visit tag).

## Why it's different from the existing tools

The space is crowded (EFF Cover Your Tracks, amiunique, browserleaks, CreepJS),
but they split into two camps: rigorous-but-hostile developer dashboards, and
friendly-but-shallow toys that get called out as vibe-coded. This aims at the
gap between them — CreepJS-grade signal work, delivered as a narrative.

Three things carry it:

1. **The contradiction engine.** Any single signal is old news. Cross-checking
   signals against each other is where the discomfort lives:
   - IP-geo timezone vs. the browser's own timezone → your VPN, and where you
     actually are.
   - The GPU string read on the page vs. the same string read inside a Web
     Worker → an anti-detect browser that spoofed one and forgot the other.
   - The User-Agent's claimed OS vs. the OS implied by which JS features exist.
   - Installed fonts' implied OS vs. the User-Agent.
2. **The invasive tier, behind explicit consent.** A timing-based scan of your
   own `localhost` (Ollama, Docker, Postgres, dev servers, Plex…), desktop-app
   detection via protocol handlers, and browser-extension enumeration. These are
   real deanonymisation techniques, gated behind a button that says so.
3. **"You cleared your cookies and I still know you."** A random tag is written
   across localStorage, IndexedDB, sessionStorage and the Cache API at once.
   Clear some, and the next visit restores them from the survivors — the
   evercookie pattern, which is what tracking looks like without cookies.

## Architecture

```
index.html            page shell — opens as a bare blinking cursor
src/types.ts          the contract: Probe → Signal, Inference → Claim
src/runner.ts         tiered probe runner, entropy + fingerprint
src/persist.ts        multi-backend evercookie (the return-visit demo)
src/probes/*          measurement only — each emits Signals, never renders
src/infer/*           Signals → second-person Claims (the narrative lives here)
src/ui/dossier.ts     the paced, act-by-act reveal engine
src/main.ts           orchestrator: gather → infer → reveal → gate → finale
functions/api/context.ts   Cloudflare Pages Function: request.cf geo/ASN/TLS
```

Probes are grouped in **tiers**: tier 0 (instant, passive), tier 1 (slower
rasterisation — canvas/audio/fonts), tier 2 (invasive, consent-gated). Inference
is fully decoupled from measurement: probes never know what claim they feed, and
the UI only ever renders claims. To add a signal, emit it from a probe and read
it by id in an inference — the ids are the contract in `docs/SIGNALS.md`.

Accuracy discipline: font detection uses `measureText` (not the unreliable
`document.fonts.check`) and carries a fake-font **sentinel** — if the fake name
"detects," the environment is lying and the probe emits nothing rather than a
fabricated dossier. That single guard is what keeps it off the vibe-coded list.

## Running it

```bash
npm install
npm run dev        # vite dev server at :5173 (edge context is stubbed)
npm run build      # typecheck + production build to dist/
npm run serve      # wrangler pages dev — exercises the real Pages Function
```

Geo, ASN and TLS signals come from Cloudflare's `request.cf` and only populate
on a real Cloudflare deployment (or `wrangler pages dev`); in plain `vite dev`
that act is simply skipped.

## Deploying (free)

Cloudflare Pages, free tier — static assets get unlimited bandwidth, so an HN
spike costs nothing, and `request.cf` gives geo/ASN/TLS with no external API.

```bash
npm run build
npx wrangler pages deploy dist        # first run walks you through login + project
```

## Ethics

The invasive probes are genuine attacks, so they sit behind an explicit,
labelled opt-in and log nothing. The site's whole credibility rests on not being
the cautionary tale it's describing: no server storage, no third-party calls, an
honest Forget Me button, and every technique explained in its own "how?" drawer.

A weekend project. MIT.
