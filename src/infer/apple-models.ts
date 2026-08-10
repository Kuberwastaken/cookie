/**
 * Physical render resolution -> Apple model. Keyed "WxH@dpr" on the RENDER
 * resolution (CSS points × devicePixelRatio), which is exactly what Safari
 * reports and what any page can read with zero permission.
 *
 * Deliberately Mac/iPad only. iPhones are left out on purpose: several models
 * share one panel, so the honest answer is a long "14 Pro / 15 / 15 Pro / 16"
 * list that reads as clutter, and Display Zoom shifts the reported size enough
 * to collide families anyway — so an iPhone just gets called "an iPhone". This
 * table also must only be consulted for an Apple user-agent (see deviceModel);
 * a non-Apple device whose screen happens to match a key would otherwise be
 * mislabeled, and plenty of Android panels land on these numbers.
 *
 * The earlier version lived in device.ts and was looked up with *logical* pixels
 * against *physical* keys, so it never matched anything. This resolver multiplies
 * by dpr first, which is the fix.
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

  // --- iPads (render resolution = CSS points × dpr) ---
  '1640x2360@2': 'an iPad (10th gen) or iPad Air',
  '1668x2388@2': 'an iPad Pro (11-inch)',
  '2048x2732@2': 'an iPad Pro (12.9-inch)',
};

/** Resolve a model from logical screen pixels + devicePixelRatio, trying both
 *  orientations. Returns the label (already carrying its "a"/"an") or null.
 *  Callers MUST gate this on an Apple user-agent — the map has no such guard. */
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
