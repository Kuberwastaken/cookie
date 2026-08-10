/**
 * Physical render resolution -> Apple model family. Keyed "WxH@dpr" on the
 * RENDER resolution (CSS points × devicePixelRatio), which is exactly what
 * Safari reports and what any page can read with zero permission.
 *
 * Two honest caveats baked into how this is used:
 *  - Several models ship the same panel, so a value names the *family*, not one
 *    SKU. That's the ceiling for this signal, and we say "likely", never "certain".
 *  - iPhone Display Zoom (and Mac display scaling) changes the reported logical
 *    size, so a zoomed device can collide with another family's key. Most people
 *    run the default, so we accept the occasional miss rather than guess wider.
 *
 * The earlier version of this map lived in device.ts and was looked up with
 * *logical* pixels against *physical* keys, so it never matched anything — the
 * "you're on an iPhone 15" line had never once fired. This resolver multiplies
 * by dpr first, which is the whole fix.
 */
export const APPLE_MODELS: Record<string, string> = {
  // --- Macs (native panel resolution; only matches at native/default 2× scaling) ---
  '2560x1664@2': 'a MacBook Air (13-inch, M-series)',
  '2880x1864@2': 'a MacBook Air (15-inch, M-series)',
  '2560x1600@2': 'a 13-inch MacBook Pro or Air',
  '3024x1964@2': 'a MacBook Pro (14-inch)',
  '3456x2234@2': 'a MacBook Pro (16-inch)',
  '4480x2520@2': 'an iMac (24-inch, M-series)',
  '5120x2880@2': 'a 27-inch 5K display (iMac or Studio Display)',

  // --- iPhones (render resolution = CSS points × dpr) ---
  '640x1136@2': 'an iPhone SE (1st gen), or an even older one',
  '750x1334@2': 'an iPhone SE (2nd or 3rd gen), or a 6/7/8',
  '828x1792@2': 'an iPhone XR or 11',
  '1080x1920@3': 'an iPhone 6, 7 or 8 Plus',
  '1125x2436@3': 'an iPhone X, XS or 11 Pro',
  '1242x2688@3': 'an iPhone XS Max or 11 Pro Max',
  '1080x2340@3': 'an iPhone 12 mini or 13 mini',
  '1170x2532@3': 'an iPhone 12, 13 or 14 (or a 12/13 Pro)',
  '1284x2778@3': 'an iPhone 12 Pro Max, 13 Pro Max or 14 Plus',
  '1179x2556@3': 'an iPhone 14 Pro, 15, 15 Pro or 16',
  '1290x2796@3': 'an iPhone 14 Pro Max, 15 Plus, 15 Pro Max or 16 Plus',
  '1206x2622@3': 'an iPhone 16 Pro',
  '1320x2868@3': 'an iPhone 16 Pro Max',

  // --- iPads (render resolution) ---
  '1640x2360@2': 'an iPad (10th gen) or iPad Air',
  '1668x2388@2': 'an iPad Pro (11-inch)',
  '2048x2732@2': 'an iPad Pro (12.9-inch)',
};

/** Resolve a model family from logical screen pixels + devicePixelRatio, trying
 *  both orientations. Returns the label (already carrying its "a"/"an") or null. */
export function resolveAppleModel(
  res: [number, number] | undefined,
  dpr: number | undefined,
): string | null {
  if (!res || !dpr) return null;
  const [w, h] = res;
  const d = Math.round(dpr);
  const pw = Math.round(w * dpr);
  const ph = Math.round(h * dpr);
  return APPLE_MODELS[`${pw}x${ph}@${d}`] ?? APPLE_MODELS[`${ph}x${pw}@${d}`] ?? null;
}
