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
      how: `Your IP address resolves to this location. This is known at the network layer, before the page renders, before any cookie. Every site you visit sees your IP and can look this up instantly.`,
    }));
  }

  if (org && !isPlaceholderOrg(org)) {
    const isp = cleanOrg(org);
    out.push(claim({
      id: 'loc.isp',
      text: isCorporate(org)
        ? `You're on *${isp}*'s network, this looks like a corporate or institutional connection.`
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
/** Actual UTC offset (minutes) a named timezone is at right now, handles DST. */
function tzOffsetMinutes(tz: string): number | null {
  try {
    const d = new Date();
    const utc = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }));
    const local = new Date(d.toLocaleString('en-US', { timeZone: tz }));
    return Math.round((local.getTime() - utc.getTime()) / 60000);
  } catch { return null; }
}

export const vpnContradiction: Inference = (s) => {
  const ipTz = str(s, 'edge.timezone');           // timezone derived from the IP
  const browserTz = str(s, 'env.timezone');        // timezone the browser reports
  const out: Claim[] = [];

  // Compare real UTC OFFSETS, not zone-name strings, Asia/Calcutta and
  // Asia/Kolkata are the same place, and only the offset difference is a VPN.
  const ipOff = ipTz ? tzOffsetMinutes(ipTz) : null;
  const browserOff = browserTz
    ? tzOffsetMinutes(browserTz)
    : (typeof s['env.tzOffset']?.value === 'number' ? (s['env.tzOffset'].value as number) : null);
  const offsetMismatch = ipOff != null && browserOff != null && Math.abs(ipOff - browserOff) > 20;

  if (ipTz && browserTz && offsetMismatch) {
    const ipCity = ipTz.split('/').pop()?.replace(/_/g, ' ');
    const realCity = browserTz.split('/').pop()?.replace(/_/g, ' ');
    out.push(claim({
      id: 'loc.vpn',
      text: `Your IP puts you in *${ipCity}* (${fmtOffset(ipOff!)}). Your computer's clock is set to *${realCity}* (${fmtOffset(browserOff!)}). One of those is a VPN, and your clock is the one telling the truth.`,
      confidence: 'likely', act: 4, weight: 9,
      evidence: ['edge.timezone', 'env.timezone', 'edge.city'],
      how: `The network sees your VPN exit (${ipTz}, ${fmtOffset(ipOff!)}). But your operating system's own timezone (${browserTz}, ${fmtOffset(browserOff!)}) travelled with you through the tunnel, the VPN can't rewrite it. The offsets genuinely differ, so you're tunnelling, and the OS timezone points at where you actually are.`,
    }));
  }

  // Language vs. country → the "multilingual, travelling, or VPN" tell.
  const langs = s['platform.languages']?.value as string[] | undefined;
  const country = str(s, 'edge.country');
  if (langs?.length && country && !langMatchesCountry(langs, country)) {
    const langName = languageName(langs[0].split('-')[0]) || langs[0];
    // If the timezone offset ALSO disagrees, VPN jumps to the top of the list.
    const tzMismatch = offsetMismatch;
    out.push(claim({
      id: 'loc.langMismatch',
      text: tzMismatch
        ? `Your browser speaks *${langName}*, your IP is in *${country}*, and your clock is in a third place. That's not a traveller. That's a *VPN*.`
        : `Your browser speaks *${langName}*, but your IP is in *${country}*, where that isn't the local language. So you're one of three things: *multilingual, travelling, or on a VPN*, and we can tell it's one of them.`,
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

function fmtOffset(min: number): string {
  const sign = min >= 0 ? '+' : '-';
  const a = Math.abs(min);
  return `UTC${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

/** The local-time emotional beat, measured, never usually spoken aloud. */
export const localTimeBeat: Inference = (s) => {
  const hour = s['env.hour']?.value;
  if (typeof hour !== 'number') return [];
  const local = str(s, 'env.localTime') || '';
  const m = local.match(/(\d{1,2}):(\d{2})/);
  const clock = m ? to12h(+m[1], m[2]) : `${hour}:00`;

  if (hour >= 0 && hour <= 4) {
    return [claim({
      id: 'loc.time',
      text: `It's *${clock}* where you are. You should be asleep. We won't tell anyone, but your device just did.`,
      confidence: 'certain', act: 1, weight: 6,
      evidence: ['env.localTime', 'env.hour'],
      how: `Your clock is set locally and your browser reports it freely. Right now it reads ${clock}. Time-of-day is one of the quietest things a site learns about you, and one of the most telling.`,
    })];
  }
  if (hour === 5 || hour === 6) {
    return [claim({
      id: 'loc.time',
      text: `It's *${clock}* where you are, either you're up early, or you never went to bed.`,
      confidence: 'certain', act: 1, weight: 5,
      evidence: ['env.localTime', 'env.hour'],
      how: `Your browser reports your exact local time (${clock}). We didn't ask; it just tells any page that loads.`,
    })];
  }
  return [];
};

/** Cloudflare colo + TCP RTT → a network-only location fix. (Cloudflare deploy only.) */
export const coloTriangulation: Inference = (s) => {
  const colo = str(s, 'edge.colo');
  const city = colo ? COLO[colo] : undefined;
  if (!colo || !city) return [];
  const rtt = s['edge.tcpRtt']?.value;
  const rttStr = typeof rtt === 'number' ? `, about *${rtt} ms* away` : '';
  return [claim({
    id: 'loc.colo',
    text: `At the network level, you reached us through *${city}*${rttStr}. That's a location fix your IP can't fake, it's measured, not claimed.`,
    confidence: 'likely', act: 1, weight: 4,
    evidence: ['edge.colo', 'edge.tcpRtt'],
    how: `You connected through the ${colo} datacenter, and the round-trip time bounds how far you physically are from it. A VPN can move your apparent IP, but it can't make packets travel faster than light, so this corroborates (or contradicts) where you say you are.`,
  })];
};

// Common Cloudflare edge locations (IATA code → city).
const COLO: Record<string, string> = {
  FRA: 'Frankfurt', LHR: 'London', CDG: 'Paris', AMS: 'Amsterdam', MAD: 'Madrid',
  MXP: 'Milan', ARN: 'Stockholm', WAW: 'Warsaw', VIE: 'Vienna', ZRH: 'Zurich',
  DUB: 'Dublin', EWR: 'Newark', IAD: 'Ashburn', ORD: 'Chicago', DFW: 'Dallas',
  LAX: 'Los Angeles', SJC: 'San Jose', SEA: 'Seattle', ATL: 'Atlanta', MIA: 'Miami',
  YYZ: 'Toronto', GRU: 'São Paulo', SCL: 'Santiago', NRT: 'Tokyo', KIX: 'Osaka',
  ICN: 'Seoul', SIN: 'Singapore', HKG: 'Hong Kong', BOM: 'Mumbai', DEL: 'Delhi',
  MAA: 'Chennai', BLR: 'Bengaluru', SYD: 'Sydney', MEL: 'Melbourne', JNB: 'Johannesburg',
  DXB: 'Dubai', TLV: 'Tel Aviv', IST: 'Istanbul', CPT: 'Cape Town',
};

function to12h(h: number, min: string): string {
  const ampm = h >= 12 ? 'p.m.' : 'a.m.';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${min} ${ampm}`;
}

/** TLS/HTTP fingerprint captured during the handshake, before any JS. */
export const handshake: Inference = (s) => {
  const tls = str(s, 'edge.tlsVersion');
  const cipher = str(s, 'edge.tlsCipher');
  const proto = str(s, 'edge.httpProtocol');
  if (!tls && !proto) return [];
  const bits = [tls, proto].filter(Boolean).join(' over ');
  return [claim({
    id: 'loc.handshake',
    text: `We fingerprinted your connection *during the handshake*, ${bits}${cipher ? `, ${cipher}` : ''}, before your browser had run a single line of our code.`,
    confidence: 'certain', act: 1, weight: 6,
    evidence: ['edge.tlsVersion', 'edge.tlsCipher', 'edge.httpProtocol', 'edge.tlsHelloLength'],
    how: `The TLS negotiation that secures this page also identifies your browser: the cipher list, the protocol version, the ClientHello size. That happens at the very start of the connection. By the time you "arrived," you were already described.`,
  })];
};

// --- helpers ---------------------------------------------------------------

function cleanOrg(org: string): string {
  // Registry org fields often carry a postal address ("Airtel Ltd.,224, Okhla
  // industrial Area..."). Keep the leading name-ish segments, drop the address.
  const parts = org.split(',').map((p) => p.trim()).filter(Boolean);
  const kept: string[] = [];
  for (const p of parts) {
    if (/\d{2,}/.test(p) || /\b(road|street|area|phase|sector|floor|block|po box|district)\b/i.test(p)) break;
    kept.push(p);
    if (kept.join(' ').length > 40) break;
  }
  return (kept.join(', ') || parts[0] || org)
    .replace(/,?\s*(inc|llc|ltd|gmbh|s\.a\.|co\.|corp)\.?$/i, '').trim();
}

/** Geo APIs sometimes return junk placeholders instead of a real ISP name. */
function isPlaceholderOrg(org: string): boolean {
  return /^(internet service provider|isp|unknown|n\/?a|none|null|private|reserved|-)$/i.test(org.trim());
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
