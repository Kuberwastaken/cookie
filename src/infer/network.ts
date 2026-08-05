import type { Claim, Inference, SignalMap } from '../types';

const claim = (c: Omit<Claim, 'confidence'> & Partial<Pick<Claim, 'confidence'>>): Claim => ({
  confidence: 'likely', ...c,
});

/** WebRTC IP leak → your real address, VPN or not. Act 6 (invasive). */
export const webrtcClaims: Inference = (s) => {
  if (s['webrtc.blocked']?.value === true) return [];
  const out: Claim[] = [];

  const publicIP = s['webrtc.publicIP']?.value as string | null | undefined;
  const localIPs = (s['webrtc.localIPs']?.value as string[] | undefined) ?? [];
  const edgeIP = s['edge.ip']?.value as string | undefined;

  if (publicIP) {
    const mismatch = edgeIP && edgeIP !== publicIP;
    out.push(claim({
      id: 'net.webrtcPublic',
      text: mismatch
        ? `WebRTC just leaked a *different public IP* than the one you're browsing from. If you're on a VPN, this is the address it's supposed to be hiding.`
        : `WebRTC handed us your public IP directly: *${publicIP}*.`,
      confidence: 'likely', act: 6, weight: mismatch ? 9 : 6,
      evidence: ['webrtc.publicIP', 'edge.ip'],
      how: `A hidden WebRTC connection asks a STUN server "what's my address?" and the browser answers, outside the page's control, and historically outside many VPNs' too. ${mismatch ? "The two IPs disagreeing is the leak." : ''}`,
    }));
  }

  if (localIPs.length) {
    out.push(claim({
      id: 'net.webrtcLocal',
      text: `Your device's address on your own network is *${localIPs[0]}*.`,
      confidence: 'certain', act: 6, weight: 6,
      evidence: ['webrtc.localIPs'],
      how: `WebRTC leaked your LAN IP (${localIPs.join(', ')}). That's the address your router gave your machine, normally invisible to websites, exposed here through the same mechanism video calls use.`,
    }));
  } else if (s['webrtc.mdnsProtected']?.value === true) {
    out.push(claim({
      id: 'net.mdns',
      text: `Your browser hid your local IP behind an mDNS alias, good. That protection is on.`,
      confidence: 'certain', act: 6, weight: 2,
      evidence: ['webrtc.mdnsProtected'],
      how: `Modern browsers replace your real LAN IP with a random *.local name in WebRTC candidates. Yours did. That's one of the few fingerprinting defenses that's on by default.`,
    }));
  }

  return out;
};

/** Permission-state probing → "you already granted camera/mic/location." */
export const permissionClaims: Inference = (s) => {
  const granted = (s['perm.granted']?.value as string[] | undefined) ?? [];
  const paired = (s['perm.pairedDevices']?.value as string[] | undefined) ?? [];
  const caps = s['perm.capabilities']?.value as Record<string, boolean> | undefined;
  const out: Claim[] = [];

  const spicy = granted.filter((g) => ['camera', 'microphone', 'geolocation'].includes(g));
  if (spicy.length) {
    out.push(claim({
      id: 'net.granted',
      text: `You've already given this browser *${humanList(spicy)}* access on some site, and we can see that without asking.`,
      confidence: 'certain', act: 6, weight: 8,
      evidence: ['perm.granted', 'perm.states'],
      how: `navigator.permissions.query() reports whether a permission is granted, denied, or unset, and it never shows a prompt to check. Most people assume a site can't know your camera's already unlocked until it asks. It can.`,
    }));
  }

  if (paired.length) {
    out.push(claim({
      id: 'net.paired',
      text: `You've paired a device to this site before, we can still see it: *${paired[0]}*.`,
      confidence: 'certain', act: 6, weight: 7,
      evidence: ['perm.pairedDevices'],
      how: `Once you grant a site access to a USB, HID or serial device, it can re-list that device on every future visit with no prompt, silently, before you interact. ${paired.length > 1 ? `We found ${paired.length}.` : ''}`,
    }));
  }

  // The "what your browser refuses vs. allows" contrast, a thoughtful beat.
  if (caps) {
    const invasive = ['idle', 'pressure'].filter((k) => caps[k]);
    if (invasive.length) {
      out.push(claim({
        id: 'net.idle',
        text: caps.idle
          ? `Your browser will tell a website *when you walk away from your desk*. (Chrome ships this. Firefox and Safari refused to, on the record, calling it surveillance.)`
          : `Your browser exposes how hard your CPU is working right now, in real time.`,
        confidence: 'certain', act: 6, weight: 5,
        evidence: ['perm.capabilities'],
        how: `The Idle Detection and Compute Pressure APIs are Chrome-only. Idle Detection lets a page know you've stopped touching your device; Mozilla and Apple declined to implement it specifically because of what it enables. Which browser you chose decides how much of this a site can do.`,
      }));
    }
  }

  return out;
};

/** CPU architecture from the NaN sign-bit trick, a silent "creepy fact." */
export const deepClaims: Inference = (s) => {
  const out: Claim[] = [];
  // Prefer the browser's own UA-CH architecture hint, which is authoritative.
  // The NaN sign-bit trick is only a fallback, and we stay silent when the two
  // disagree rather than confidently telling an i9 owner they're on ARM.
  const hinted = (s['platform.arch']?.value as string | undefined)?.toLowerCase();
  const nanGuess = s['deep.archGuess']?.value as string | undefined;
  const hintedFamily = hinted ? (hinted.includes('arm') ? 'ARM-family' : hinted.includes('x86') ? 'x86-family' : undefined) : undefined;
  const agree = hintedFamily && nanGuess && hintedFamily === nanGuess;
  const arch = hintedFamily ?? (nanGuess && nanGuess !== 'unknown' ? nanGuess : undefined);

  if (arch && (!hintedFamily || !nanGuess || nanGuess === 'unknown' || agree)) {
    out.push(claim({
      id: 'net.arch',
      text: `Your CPU is *${arch}*.`,
      confidence: hintedFamily ? 'certain' : 'guess', act: 2, weight: 4,
      evidence: ['platform.arch', 'deep.archGuess', 'deep.nanArch'],
      how: hintedFamily
        ? `Your browser volunteers its CPU architecture in a client hint, no permission needed.${agree ? ' We double-checked with an arithmetic trick: compute Infinity minus Infinity and the resulting NaN has a sign bit that differs between x86 and ARM. Both agree.' : ''}`
        : `Compute Infinity minus Infinity and you get NaN, "not a number." But NaN has a sign bit, and which way it points differs between x86 and ARM processors. One subtraction, and your CPU family leaks. This is a heuristic, so treat it as a guess.`,
    }));
  }
  if (s['deep.applePay']?.value === 'available') {
    out.push(claim({
      id: 'net.applePay',
      text: `You have a *payment card set up in Apple Pay* on this device.`,
      confidence: 'likely', act: 5, weight: 5,
      evidence: ['deep.applePay'],
      how: `ApplePaySession.canMakePayments() returns true only when there's an actual card provisioned. A website can check silently, no prompt, and infer you're set up to pay.`,
    }));
  }
  const flavor = s['deep.vendorFlavor']?.value as string | undefined;
  if (flavor && flavor !== 'standard') {
    out.push(claim({
      id: 'net.vendor',
      text: `Your real browser is *${flavor}*, even though it shares an engine with others and the User-Agent barely says so.`,
      confidence: 'likely', act: 2, weight: 4,
      evidence: ['deep.vendorFlavor'],
      how: `Browsers leave vendor-specific global variables lying around (Yandex, UC, Samsung Internet, Chrome-on-iOS). We checked for them. On iOS especially, every browser is really Safari underneath, but this tells them apart.`,
    }));
  }
  return out;
};

function humanList(items: string[]): string {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
