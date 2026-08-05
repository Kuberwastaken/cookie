import type { Probe, Signal } from '../types';

const sig = (id: string, label: string, value: unknown, extra: Partial<Signal> = {}): Signal => ({
  id, label, value, ...extra,
});

/** Custom URL scheme -> the desktop app that registers it. */
const SCHEMES: Array<{ scheme: string; app: string }> = [
  { scheme: 'slack:', app: 'Slack' },
  { scheme: 'zoommtg:', app: 'Zoom' },
  { scheme: 'discord:', app: 'Discord' },
  { scheme: 'spotify:', app: 'Spotify' },
  { scheme: 'steam:', app: 'Steam' },
  { scheme: 'vscode:', app: 'VS Code' },
  { scheme: 'figma:', app: 'Figma' },
  { scheme: 'notion:', app: 'Notion' },
  { scheme: 'obsidian:', app: 'Obsidian' },
  { scheme: 'postman:', app: 'Postman' },
  { scheme: 'tg:', app: 'Telegram' },
  { scheme: 'whatsapp:', app: 'WhatsApp' },
  { scheme: 'msteams:', app: 'Microsoft Teams' },
  { scheme: 'itms-apps:', app: 'App Store' },
  { scheme: 'com.apple.mobilesms:', app: 'Messages' },
];

const PROBE_WINDOW_MS = 700;

/**
 * Scheme flooding, contained: a hidden iframe's src is set to a candidate
 * scheme. If nothing is registered, the navigation fails immediately and the
 * iframe fires `error` (or the load silently no-ops) well inside the probe
 * window. If something IS registered, the browser either hands off to the
 * OS/app-picker or simply never signals failure back to the iframe, so we
 * see neither a fast error nor a normal load before the window closes.
 * That asymmetry, fast-error vs. silence, is the whole signal.
 *
 * This never touches window.location and never opens a real external
 * handoff from the top-level document, so there's no visible "open app?"
 * prompt storm for the demo. Chrome and other browsers throttle/rate-limit
 * repeated unregistered-scheme navigations from the same page, which is why
 * this is explicitly marked unreliable (`apps.reliable = false`), repeated
 * runs, or runs after several unregistered hits, will under-report.
 */
function probeScheme(scheme: string, outerSignal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (outerSignal.aborted) return resolve(false);

    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.setAttribute('sandbox', 'allow-scripts');

    let settled = false;
    const finish = (registered: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      iframe.remove();
      resolve(registered);
    };

    iframe.addEventListener('error', () => finish(false));
    iframe.addEventListener('load', () => finish(false));

    const timer = setTimeout(() => finish(true), PROBE_WINDOW_MS);

    try {
      document.body.appendChild(iframe);
      iframe.src = scheme;
    } catch {
      finish(false);
    }
  });
}

export const appsProbe: Probe = {
  id: 'apps',
  title: 'Installed apps',
  tier: 2,
  async run(ctx) {
    if (!ctx.consented) {
      return [sig('apps.reliable', 'App probe', false, { error: 'no consent' })];
    }

    const installed: string[] = [];
    const probed: string[] = [];

    try {
      for (const { scheme, app } of SCHEMES) {
        if (ctx.signal.aborted) break;
        probed.push(scheme);
        try {
          const registered = await probeScheme(scheme, ctx.signal);
          if (registered) installed.push(app);
        } catch { /* individual scheme probe failed; skip it */ }
      }
    } catch { /* fall through with whatever we gathered */ }

    return [
      sig('apps.installed', 'Detected apps', installed, {
        display: installed.length ? installed.join(', ') : 'none detected',
        entropy: installed.length ? 2 : 0,
      }),
      sig('apps.probed', 'Schemes probed', probed, { display: `${probed.length} schemes` }),
      // Best-effort only: browsers throttle repeated scheme navigation and
      // the timing/error heuristic has real false-negative and false-positive
      // rates, so this is never presented as a certain result.
      sig('apps.reliable', 'Reliable', false),
    ];
  },
};
