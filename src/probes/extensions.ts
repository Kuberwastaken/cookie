import type { Probe, Signal } from '../types';

const sig = (id: string, label: string, value: unknown, extra: Partial<Signal> = {}): Signal => ({
  id, label, value, ...extra,
});

/**
 * Well-known extension IDs and a web-accessible-resource path each ships
 * with by default. Chrome 130+'s `use_dynamic_url` mitigation randomises
 * this path per-install for extensions that opt in, so this list only
 * catches extensions that haven't (still the common case as of writing).
 */
const KNOWN_EXTENSIONS: Array<{ id: string; name: string; resource: string }> = [
  { id: 'nkbihfbeogaeaoehlefnkodbefgpgknn', name: 'MetaMask', resource: 'images/icon-128.png' },
  { id: 'cjpalhdlnbpafiaamejdnhcphjbkeiagm', name: 'uBlock Origin', resource: 'img/icon_128.png' },
  { id: 'ddkjiahejlhfcafbddmgiahcphecmpfh', name: 'uBlock Origin Lite', resource: 'img/icon_128.png' },
  { id: 'gighmmpiobklfepjocnamgkkbiglidom', name: 'AdBlock', resource: 'icons/icon128.png' },
  { id: 'cfhdojbkjhnklbpkdaibdccddilifddb', name: 'Adblock Plus', resource: 'icons/detected-abp/48.png' },
  { id: 'kbfnbcaeplbcioakkpcpgfkobkghlhen', name: 'Grammarly', resource: 'static/_/img/logo-red-48.png' },
  { id: 'hdokiejnpimakedhajhdlcegeplioahd', name: 'LastPass', resource: 'images/icon128.png' },
  { id: 'nngceckbapebfimnlniiiahkandclblb', name: 'Bitwarden', resource: 'images/icon128.png' },
  { id: 'eimadpbcbfnmbkopoojfekhnkhdbieeh', name: 'Dark Reader', resource: 'icons/dr_128x128.png' },
  { id: 'bmnlcjabgnpnenekpadlanbbkooimhnj', name: 'Honey', resource: 'images/icon128.png' },
  { id: 'fmkadmapgofadopljbjfkapdkoienihi', name: 'React DevTools', resource: 'icons/128.png' },
  { id: 'nhdogjmejiglipccpnnnanhbledajbpd', name: 'Vue DevTools', resource: 'icons/128.png' },
  { id: 'bhlhnicpbhignbdhedgjhgdocnmhomnp', name: 'ColorZilla', resource: 'icon128.png' },
  { id: 'liecbddmkiiihnedobmlmillhodjkdmb', name: 'Loom', resource: 'icon128.png' },
];

const RESOURCE_TIMEOUT_MS = 800;

/**
 * A chrome-extension:// URL for a file listed in web_accessible_resources
 * loads successfully only if that extension is installed. We probe via a
 * detached <img> rather than fetch, fetch to chrome-extension:// is
 * blocked cross-origin, but image loads resolve/reject based on whether the
 * resource exists at all, which is enough signal without reading any bytes.
 */
function probeExtension(url: string, outerSignal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (outerSignal.aborted) return resolve(false);
    const img = new Image();
    let settled = false;
    const timer = setTimeout(() => finish(false), RESOURCE_TIMEOUT_MS);
    const finish = (found: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      img.src = '';
      resolve(found);
    };
    img.onload = () => finish(true);
    img.onerror = () => finish(false);
    try {
      img.src = url;
    } catch {
      finish(false);
    }
  });
}

/** Decoy element shaped like the class names ad-block filter lists target. */
function detectAdblock(): Promise<boolean> {
  return new Promise((resolve) => {
    const bait = document.createElement('div');
    bait.className = 'pub_300x250 text-ad ad-banner adsbox';
    bait.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;';
    bait.innerHTML = '&nbsp;';
    document.body.appendChild(bait);

    // Give filter-list-driven CSS/JS a tick to act on the bait element.
    setTimeout(() => {
      const rect = bait.getBoundingClientRect();
      const style = getComputedStyle(bait);
      const blocked =
        bait.offsetParent === null ||
        rect.height === 0 ||
        style.display === 'none' ||
        style.visibility === 'hidden';
      bait.remove();
      resolve(blocked);
    }, 100);
  });
}

export const extProbe: Probe = {
  id: 'ext',
  title: 'Extensions',
  tier: 2,
  async run(ctx) {
    if (!ctx.consented) {
      return [sig('ext.adblock', 'Ad blocker', false, { error: 'no consent' })];
    }

    const out: Signal[] = [];
    const detected: Array<{ name: string; id: string }> = [];

    try {
      for (const ext of KNOWN_EXTENSIONS) {
        if (ctx.signal.aborted) break;
        const url = `chrome-extension://${ext.id}/${ext.resource}`;
        try {
          const found = await probeExtension(url, ctx.signal);
          if (found) detected.push({ name: ext.name, id: ext.id });
        } catch { /* individual probe failed; skip it */ }
      }
    } catch { /* fall through with whatever we gathered */ }

    out.push(sig('ext.detected', 'Detected extensions', detected, {
      display: detected.length ? detected.map((d) => d.name).join(', ') : 'none detected',
      entropy: detected.length ? 3 : 0,
    }));

    let adblock = false;
    try {
      adblock = await detectAdblock();
    } catch { /* bait element failed; assume no blocker */ }

    const nav = navigator as Navigator & { brave?: { isBrave?: () => Promise<boolean> } };
    let adblockName = 'unknown';
    if (adblock) {
      const knownBlocker = detected.find((d) =>
        ['uBlock Origin', 'uBlock Origin Lite', 'AdBlock', 'Adblock Plus'].includes(d.name));
      if (knownBlocker) {
        adblockName = knownBlocker.name;
      } else if (nav.brave) {
        adblockName = 'Brave shields';
      }
    }

    out.push(sig('ext.adblock', 'Ad blocker present', adblock));
    out.push(sig('ext.adblockName', 'Ad blocker identity', adblockName));

    return out;
  },
};
