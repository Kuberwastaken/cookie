import type { Probe, Signal } from '../types';

const sig = (id: string, label: string, value: unknown, extra: Partial<Signal> = {}): Signal => ({
  id, label, value, ...extra,
});

/** A small local WebGL renderer read, the full worker/main cross-check lives
 * in gpuProbe; here we just need the string for the software-render tell. */
function readRenderer(): string | null {
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') || c.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return null;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return renderer || null;
  } catch {
    return null;
  }
}

interface Check { hit: boolean; weight: number; reason: string; }

/** Headless/bot/VM detection, scored from a weighted checklist of classic
 * automation tells. No single check is conclusive; the combined score is. */
export const automationProbe: Probe = {
  id: 'bot',
  title: 'Automation',
  tier: 0,
  async run() {
    const n = navigator;
    const ua = n.userAgent || '';
    const renderer = readRenderer();
    const w = window as any;

    const checks: Check[] = [];

    checks.push({ hit: n.webdriver === true, weight: 0.9, reason: 'navigator.webdriver is true' });

    checks.push({ hit: /HeadlessChrome/i.test(ua), weight: 0.9, reason: 'UA contains "HeadlessChrome"' });

    // Classic headless tell: permission state disagrees with the Notification API.
    let notifMismatch = false;
    try {
      if ('Notification' in window && n.permissions?.query) {
        const perm = await n.permissions.query({ name: 'notifications' as PermissionName });
        if (Notification.permission === 'denied' && perm.state === 'prompt') notifMismatch = true;
      }
    } catch { /* permissions API gated or unsupported */ }
    checks.push({ hit: notifMismatch, weight: 0.6, reason: 'Notification.permission=denied but permissions.query=prompt' });

    const isDesktopUA = !/Mobi|Android|iPhone|iPad/i.test(ua);
    checks.push({
      hit: isDesktopUA && n.plugins?.length === 0,
      weight: 0.35,
      reason: 'zero plugins on a desktop UA',
    });

    const claimsChrome = /Chrome\//.test(ua) && !/Edg\/|OPR\//.test(ua);
    checks.push({ hit: claimsChrome && !w.chrome, weight: 0.5, reason: 'Chrome UA but window.chrome is missing' });

    const noChrome = screen.height === screen.availHeight && innerWidth === screen.width;
    checks.push({ hit: noChrome, weight: 0.25, reason: 'no OS chrome: viewport fills the whole screen' });

    const softwareRenderer = renderer ? /SwiftShader|llvmpipe/i.test(renderer) : false;
    checks.push({ hit: softwareRenderer, weight: 0.5, reason: `software WebGL renderer (${renderer})` });

    checks.push({ hit: n.languages?.length === 0, weight: 0.3, reason: 'navigator.languages is empty' });

    const score = checks.reduce((sum, c) => sum + (c.hit ? c.weight : 0), 0);
    const maxScore = checks.reduce((sum, c) => sum + c.weight, 0);
    const normalized = maxScore > 0 ? Math.min(1, score / maxScore) : 0;
    const headless = normalized >= 0.3;
    const reasons = checks.filter((c) => c.hit).map((c) => c.reason);

    // VM detection is a separate signal from headless, a real human can be
    // on a VM (CI runner, cloud desktop) without being a bot at all.
    // Only adapters that genuinely mean "running inside a hypervisor". Excluded
    // on purpose: "Microsoft Basic Render Driver" (shows up on bare metal that
    // merely has Hyper-V installed, or lacks a GPU driver) and llvmpipe (plain
    // software rendering on Linux). Both produced false "you're in a VM" calls.
    const vmRenderer = renderer ? /VMware|VirtualBox|Parallels|QEMU|virgl/i.test(renderer) : false;

    return [
      sig('bot.score', 'Automation score', normalized, { display: normalized.toFixed(2) }),
      sig('bot.headless', 'Likely headless/automated', headless),
      sig('bot.reasons', 'Reasons', reasons, { display: reasons.join('; ') || 'none' }),
      sig('bot.vm', 'Virtual machine detected', vmRenderer, { display: renderer ?? 'unknown' }),
    ];
  },
};
