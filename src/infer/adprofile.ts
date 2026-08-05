import type { SignalMap } from '../types';

/**
 * The ad-profile "receipt." We build the actual OpenRTB 2.6 bid-request object
 * that describes this visitor, the literal JSON that gets auctioned to dozens
 * of bidders on every ad-supported page, populated from their REAL data. The
 * one honest fiction is `user.data[].segment`: we're not a data buyer, so we
 * can't show real audience segments, and we label that placeholder plainly.
 */
export function buildBidRequest(s: SignalMap): Record<string, unknown> {
  const val = (id: string) => s[id]?.value;
  const str = (id: string) => (typeof val(id) === 'string' ? (val(id) as string) : undefined);
  const res = val('display.resolution') as [number, number] | undefined;

  const ua = str('platform.ua') ?? navigatorUA();
  const lang = (val('platform.languages') as string[] | undefined)?.[0]?.split('-')[0]
    ?? str('env.locale')?.split('-')[0] ?? 'en';

  const deviceType = val('platform.mobile') === true || val('hw.pointerCoarse') === true ? 1 : 2;

  return {
    id: 'auction-' + (str('id.fingerprint') ?? 'xxxxxxxx'),
    at: 2,
    tmax: 120,
    imp: [{ id: '1', banner: { w: 300, h: 250 }, bidfloor: 0.5, bidfloorcur: 'USD', secure: 1 }],
    site: {
      domain: location.hostname,
      page: location.href,
      publisher: { domain: location.hostname },
    },
    device: {
      ua,
      // Prefer the edge-observed IP; fall back to the one WebRTC leaked, if any.
      ip: str('edge.ip') ?? str('webrtc.publicIP') ?? '<your public IP>',
      geo: {
        lat: numOr(str('edge.latitude'), 0),
        lon: numOr(str('edge.longitude'), 0),
        type: 2, // 2 = IP-derived
        country: str('edge.country') ?? undefined,
        region: str('edge.region') ?? undefined,
        city: str('edge.city') ?? undefined,
        zip: str('edge.postalCode') ?? undefined,
      },
      devicetype: deviceType,
      make: guessMake(ua),
      model: str('platform.model') || undefined,
      os: guessOS(s, ua),
      osv: str('platform.osVersion') || undefined,
      h: res?.[1],
      w: res?.[0],
      pxratio: val('display.pixelRatio'),
      js: 1,
      language: lang,
      connectiontype: connType(str('hw.netType')),
      dnt: val('platform.dnt') ? 1 : 0,
      lmt: 0,
    },
    user: {
      id: '<exchange-assigned ID from an ID-sync cookie>',
      buyeruid: '<buyer-specific ID>',
      data: [{
        id: '<data-provider>',
        name: 'a-data-broker.example',
        segment: [
          { id: 'PLACEHOLDER', name: 'in-market:...  (real audience segments attach here, we are not a data buyer, so we cannot show yours)' },
        ],
      }],
    },
    regs: { ext: { gdpr: inEU(str('edge.country')) ? 1 : 0 } },
  };
}

/** Plain-English decode of the first-party analytics cookies, if any exist. */
export function pixelCookies(): Array<{ name: string; value: string; means: string }> {
  const out: Array<{ name: string; value: string; means: string }> = [];
  const cookies = document.cookie ? document.cookie.split(';').map((c) => c.trim()) : [];
  for (const c of cookies) {
    const [name, ...rest] = c.split('=');
    const value = rest.join('=');
    if (name === '_ga' || name.startsWith('_ga_')) {
      out.push({ name, value, means: 'Google Analytics client ID, stitches your sessions together across visits.' });
    } else if (name === '_fbp') {
      out.push({ name, value, means: 'Meta Pixel browser ID, sent to Facebook with every tracked event.' });
    } else if (name === '_fbc') {
      out.push({ name, value, means: 'Meta click ID, links this browser to an ad you clicked.' });
    }
  }
  return out;
}

// --- helpers ---------------------------------------------------------------

function navigatorUA(): string { try { return navigator.userAgent; } catch { return ''; } }
function numOr(v: string | undefined, d: number): number { const n = v ? parseFloat(v) : NaN; return Number.isFinite(n) ? n : d; }

function guessMake(ua: string): string {
  if (/iPhone|iPad|Macintosh/.test(ua)) return 'Apple';
  if (/Android/.test(ua)) return 'Google';
  if (/Windows/.test(ua)) return 'PC';
  return 'Generic';
}

function guessOS(s: SignalMap, ua: string): string {
  const fromFonts = s['fonts.impliedOS']?.value as string | undefined;
  if (fromFonts && fromFonts !== 'unknown') return fromFonts;
  if (/iPhone|iPad/.test(ua)) return 'iOS';
  if (/Macintosh/.test(ua)) return 'macOS';
  if (/Android/.test(ua)) return 'Android';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Linux/.test(ua)) return 'Linux';
  return 'unknown';
}

function connType(t: string | undefined): number | undefined {
  if (!t) return undefined;
  if (t === 'wifi') return 2;
  if (t === '4g') return 4;
  if (t === '3g') return 3;
  return undefined;
}

const EU = new Set(['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE','IS','LI','NO','GB']);
function inEU(country: string | undefined): boolean { return !!country && EU.has(country); }
