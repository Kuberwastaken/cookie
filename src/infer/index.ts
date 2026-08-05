import type { Claim, Inference, SignalMap } from '../types';
import { deviceModel, gpuTier, peripherals, multiMonitor } from './device';
import { geolocation, vpnContradiction, handshake, localTimeBeat, coloTriangulation } from './location';
import { softwareFromFonts, osFromFonts, languagePacks } from './software';
import { localServices, extensions } from './invasive';
import { lieDetection, automation } from './identity';
import { webrtcClaims, permissionClaims, deepClaims } from './network';
import { trackingHypocrisy, batteryState, sessionMeta } from './session';

/** Every stateless inference. Stateful ones (return visit, verdict, behavioural,
 *  ad-profile) are called directly by main.ts because they need extra context
 *  or run at a specific point in the narrative. */
const INFERENCES: Inference[] = [
  // (act 0, the referrer + device hook now live in the cinematic intro)
  // act 1, location
  geolocation, coloTriangulation, localTimeBeat, handshake,
  // act 2, software/OS/CPU
  osFromFonts, deepClaims,
  // act 3, device (refresh + codec claims removed: the intro already brags them)
  deviceModel, gpuTier, multiMonitor, peripherals, batteryState,
  // act 4, contradictions
  vpnContradiction, lieDetection, automation, trackingHypocrisy,
  // act 5, installed software
  softwareFromFonts, languagePacks,
  // act 6, invasive (network/permissions/local/session).
  // installedApps is intentionally omitted: scheme-flooding app detection is too
  // unreliable in 2026 (false positives), and a wrong "you have X installed"
  // would discredit the rest. The probe still runs; we just don't claim from it.
  localServices, extensions, webrtcClaims, permissionClaims, sessionMeta,
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
export { behavioralClaims, typingClaims, personalityTheatre, repeatTyping } from './profile';
export { buildBidRequest, pixelCookies } from './adprofile';
export { rarityFunnel } from './rarity';
