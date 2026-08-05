import type { Claim, Inference, SignalMap } from '../types';
import { deviceModel, gpuTier, displayInference, peripherals } from './device';
import { geolocation, vpnContradiction, handshake } from './location';
import { softwareFromFonts, osFromFonts, languagePacks, codecInference } from './software';
import { localServices, installedApps, extensions } from './invasive';
import { lieDetection, automation } from './identity';
import { webrtcClaims, permissionClaims, deepClaims } from './network';

/** Every stateless inference. Stateful ones (return visit, verdict, behavioural,
 *  ad-profile) are called directly by main.ts because they need extra context
 *  or run at a specific point in the narrative. */
const INFERENCES: Inference[] = [
  // act 1 — location
  geolocation, handshake,
  // act 2 — software/OS/CPU
  osFromFonts, deepClaims,
  // act 3 — device
  deviceModel, gpuTier, displayInference, peripherals, codecInference,
  // act 4 — contradictions
  vpnContradiction, lieDetection, automation,
  // act 5 — installed software
  softwareFromFonts, languagePacks,
  // act 6 — invasive (network/permissions/local)
  localServices, installedApps, extensions, webrtcClaims, permissionClaims,
];

/** Run every inference and return claims sorted into reveal order. */
export function inferAll(signals: SignalMap): Claim[] {
  const claims: Claim[] = [];
  for (const infer of INFERENCES) {
    try { claims.push(...infer(signals)); } catch { /* one bad inference shouldn't sink the page */ }
  }
  return sortClaims(claims);
}

/** Reveal order: by act, then by ascending weight so the hardest hit lands last. */
export function sortClaims(claims: Claim[]): Claim[] {
  return claims.sort((a, b) => (a.act - b.act) || (a.weight - b.weight));
}

export { returnVisit, verdict } from './identity';
export { behavioralClaims, typingClaims, personalityTheatre } from './profile';
export { buildBidRequest, pixelCookies } from './adprofile';
