/**
 * Cloudflare Pages Function. Everything here is free-tier: `request.cf` carries
 * geo, ASN and TLS metadata on every request at no cost and with no external API.
 *
 * Nothing is logged, stored, or forwarded. This handler is stateless by design.
 */

interface CfProperties {
  country?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  latitude?: string;
  longitude?: string;
  timezone?: string;
  asn?: number;
  asOrganization?: string;
  colo?: string;
  httpProtocol?: string;
  tlsVersion?: string;
  tlsCipher?: string;
  tlsClientHelloLength?: string;
  clientTcpRtt?: number;
}

const CLIENT_HINT_HEADERS = [
  'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform', 'sec-ch-ua-platform-version',
  'sec-ch-ua-arch', 'sec-ch-ua-bitness', 'sec-ch-ua-model', 'sec-ch-ua-full-version-list',
  'sec-ch-ua-wow64', 'sec-ch-prefers-color-scheme', 'sec-ch-prefers-reduced-motion',
  'device-memory', 'downlink', 'ect', 'rtt', 'save-data',
];

export const onRequestGet: PagesFunction = async ({ request }) => {
  const cf = ((request as unknown as { cf?: CfProperties }).cf ?? {}) as CfProperties;
  const h = request.headers;

  const clientHints: Record<string, string> = {};
  for (const name of CLIENT_HINT_HEADERS) {
    const v = h.get(name);
    if (v) clientHints[name] = v;
  }

  const body = {
    ip: h.get('cf-connecting-ip') ?? undefined,
    country: cf.country,
    city: cf.city,
    region: cf.region,
    postalCode: cf.postalCode,
    latitude: cf.latitude,
    longitude: cf.longitude,
    timezone: cf.timezone,
    asn: cf.asn,
    asOrganization: cf.asOrganization,
    colo: cf.colo,
    clientTcpRtt: cf.clientTcpRtt,
    httpProtocol: cf.httpProtocol ?? request.headers.get('x-forwarded-proto') ?? undefined,
    tlsVersion: cf.tlsVersion,
    tlsCipher: cf.tlsCipher,
    tlsClientHelloLength: cf.tlsClientHelloLength,
    userAgent: h.get('user-agent') ?? undefined,
    acceptLanguage: h.get('accept-language') ?? undefined,
    accept: h.get('accept') ?? undefined,
    acceptEncoding: h.get('accept-encoding') ?? undefined,
    dnt: h.get('dnt') ?? undefined,
    secGpc: h.get('sec-gpc') ?? undefined,
    referer: h.get('referer') ?? undefined,
    clientHints,
    // Header ORDER is itself a fingerprint — browsers emit a characteristic
    // sequence, and most spoofing tools get it wrong.
    headerOrder: [...h.keys()],
  };

  return new Response(JSON.stringify(body), {
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    },
  });
};
