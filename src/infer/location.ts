import type { Claim, Inference, SignalMap } from '../types';

const claim = (c: Omit<Claim, 'confidence'> & Partial<Pick<Claim, 'confidence'>>): Claim => ({
  confidence: 'likely', ...c,
});

const str = (s: SignalMap, id: string): string | undefined => {
  const v = s[id]?.value;
  return typeof v === 'string' && v ? v : undefined;
};

/** Where the edge placed you, before a single byte of JavaScript ran. */
export const geolocation: Inference = (s) => {
  const city = str(s, 'edge.city');
  const region = str(s, 'edge.region');
  const country = str(s, 'edge.country');
  const org = str(s, 'edge.asOrg');
  const out: Claim[] = [];

  const place = [city, region].filter(Boolean).join(', ') || country;
  if (place) {
    out.push(claim({
      id: 'loc.city',
      text: `You're in or near *${place}*${country && place !== country ? `, ${country}` : ''}.`,
      confidence: city ? 'likely' : 'guess',
      act: 1, weight: 7,
      evidence: ['edge.city', 'edge.region', 'edge.country', 'edge.ip'],
      how: `Your IP address resolves to this location. This is known at the network layer — before the page renders, before any cookie. Every site you visit sees your IP and can look this up instantly.`,
    }));
  }

  if (org) {
    const isp = cleanOrg(org);
    out.push(claim({
      id: 'loc.isp',
      text: isCorporate(org)
        ? `You're on *${isp}*'s network — this looks like a corporate or institutional connection.`
        : `Your internet provider is *${isp}*.`,
      confidence: 'likely', act: 1, weight: 5,
      evidence: ['edge.asOrg', 'edge.asn'],
      how: `Every IP belongs to an Autonomous System registered to an organisation. Yours is "${org}". On a company or university network, that's often the employer's name.`,
    }));
  }

  return out;
};

/**
 * The contradiction engine. IP geo vs. browser timezone is the single most
 * legible "your VPN doesn't hide you" moment, and almost nobody demos it.
 */
export const vpnContradiction: Inference = (s) => {
  const ipTz = str(s, 'edge.timezone');           // timezone Cloudflare derived from the IP
  const browserTz = str(s, 'env.timezone');        // timezone the browser actually reports
  const out: Claim[] = [];

  if (ipTz && browserTz && ipTz !== browserTz) {
    const ipCity = ipTz.split('/').pop()?.replace(/_/g, ' ');
    const realCity = browserTz.split('/').pop()?.replace(/_/g, ' ');
    out.push(claim({
      id: 'loc.vpn',
      text: `Your IP says *${ipCity}*. Your computer's clock says *${realCity}*. One of those is a VPN — and your clock is the one telling the truth.`,
      confidence: 'likely', act: 4, weight: 9,
      evidence: ['edge.timezone', 'env.timezone', 'edge.city'],
      how: `The network sees your VPN exit (${ipTz}). But your operating system's own timezone (${browserTz}) travelled with you through the tunnel — the VPN can't rewrite it. When the two disagree, you're tunnelling, and the OS timezone points at where you actually are.`,
    }));
  }

  // Language vs. country → the "multilingual, travelling, or VPN" tell.
  const langs = s['platform.languages']?.value as string[] | undefined;
  const country = str(s, 'edge.country');
  if (langs?.length && country && !langMatchesCountry(langs, country)) {
    const langName = languageName(langs[0].split('-')[0]) || langs[0];
    // If the timezone ALSO disagrees with the IP, VPN jumps to the top of the list.
    const tzMismatch = ipTz && browserTz && ipTz !== browserTz;
    out.push(claim({
      id: 'loc.langMismatch',
      text: tzMismatch
        ? `Your browser speaks *${langName}*, your IP is in *${country}*, and your clock is in a third place. That's not a traveller. That's a *VPN*.`
        : `Your browser speaks *${langName}*, but your IP is in *${country}*, where that isn't the local language. So you're one of three things: *multilingual, travelling, or on a VPN* — and we can tell it's one of them.`,
      confidence: tzMismatch ? 'likely' : 'guess', act: 4, weight: tzMismatch ? 7 : 5,
      evidence: ['platform.languages', 'edge.country', 'edge.timezone', 'env.timezone'],
      how: `Your configured language (${langs.join(', ')}) doesn't match the country your IP resolves to (${country}). On its own that's a soft signal; combined with a timezone that also disagrees, it's a near-certain VPN. Every site sees both of these on arrival and can draw the same conclusion.`,
    }));
  }

  return out;
};

const LANG_NAMES: Record<string, string> = {
  en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian',
  pt: 'Portuguese', nl: 'Dutch', ru: 'Russian', ja: 'Japanese', ko: 'Korean',
  zh: 'Chinese', ar: 'Arabic', hi: 'Hindi', tr: 'Turkish', pl: 'Polish',
  sv: 'Swedish', da: 'Danish', fi: 'Finnish', no: 'Norwegian', cs: 'Czech',
  he: 'Hebrew', th: 'Thai', vi: 'Vietnamese', id: 'Indonesian', uk: 'Ukrainian',
};
function languageName(code: string): string { return LANG_NAMES[code.toLowerCase()] ?? ''; }

/** TLS/HTTP fingerprint captured during the handshake, before any JS. */
export const handshake: Inference = (s) => {
  const tls = str(s, 'edge.tlsVersion');
  const cipher = str(s, 'edge.tlsCipher');
  const proto = str(s, 'edge.httpProtocol');
  if (!tls && !proto) return [];
  const bits = [tls, proto].filter(Boolean).join(' over ');
  return [claim({
    id: 'loc.handshake',
    text: `We fingerprinted your connection *during the handshake* — ${bits}${cipher ? `, ${cipher}` : ''} — before your browser had run a single line of our code.`,
    confidence: 'certain', act: 1, weight: 6,
    evidence: ['edge.tlsVersion', 'edge.tlsCipher', 'edge.httpProtocol', 'edge.tlsHelloLength'],
    how: `The TLS negotiation that secures this page also identifies your browser: the cipher list, the protocol version, the ClientHello size. That happens at the very start of the connection. By the time you "arrived," you were already described.`,
  })];
};

// --- helpers ---------------------------------------------------------------

function cleanOrg(org: string): string {
  return org.replace(/,?\s*(inc|llc|ltd|gmbh|s\.a\.|co\.|corp)\.?$/i, '').trim();
}

const CONSUMER_ISP = /comcast|verizon|at&t|t-mobile|spectrum|charter|cox|xfinity|vodafone|telekom|orange|jio|airtel|bt\b|sky|virgin|telus|rogers|bell|frontier|centurylink|starlink|deutsche telekom/i;

function isCorporate(org: string): boolean {
  if (CONSUMER_ISP.test(org)) return false;
  return /university|institute|corp|technolog|systems|solutions|bank|google|amazon|microsoft|apple|meta|labs|ltd|inc|gmbh/i.test(org);
}

function langMatchesCountry(langs: string[], country: string): boolean {
  // Cheap allowlist of common language↔country pairs to suppress obvious non-mismatches.
  const map: Record<string, string[]> = {
    US: ['en'], GB: ['en'], AU: ['en'], CA: ['en', 'fr'], IE: ['en'], NZ: ['en'],
    DE: ['de'], AT: ['de'], CH: ['de', 'fr', 'it'], FR: ['fr'], ES: ['es'],
    MX: ['es'], AR: ['es'], IT: ['it'], NL: ['nl'], BR: ['pt'], PT: ['pt'],
    JP: ['ja'], KR: ['ko'], CN: ['zh'], TW: ['zh'], IN: ['en', 'hi', 'ta', 'te', 'bn'],
    RU: ['ru'], SE: ['sv'], NO: ['no', 'nb'], DK: ['da'], FI: ['fi'], PL: ['pl'],
  };
  const allowed = map[country];
  if (!allowed) return true; // unknown country → don't cry mismatch
  return langs.some((l) => allowed.includes(l.split('-')[0].toLowerCase()));
}
