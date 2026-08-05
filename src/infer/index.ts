import type { Claim, Inference, SignalMap } from '../types';
import { deviceModel, gpuTier, displayInference, peripherals } from './device';
import { geolocation, vpnContradiction, handshake } from './location';
import { softwareFromFonts, osFromFonts, languagePacks, codecInference } from './software';
import { localServices, installedApps, extensions } from './invasive';
import { lieDetection, automation } from './identity';

/** Every stateless inference. Stateful ones (return visit, verdict) are called
 *  directly by main.ts because they need the Visit record and run last. */
const INFERENCES: Inference[] = [
  // act 1 — location
  geolocation, handshake,
  // act 2 — software/OS
  osFromFonts,
  // act 3 — device
  deviceModel, gpuTier, displayInference, peripherals, codecInference,
  // act 4 — contradictions
  vpnContradiction, lieDetection, automation,
  // act 5 — installed software
  softwareFromFonts, languagePacks,
  // act 6 — invasive
  localServices, installedApps, extensions,
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
