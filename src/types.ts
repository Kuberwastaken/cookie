/**
 * Core contract. Every probe produces Signals; every inference turns Signals
 * into Claims. The UI only ever renders Claims (with Signals as the "how?" drawer).
 */

/** A single raw measurement taken from the browser or injected by the edge. */
export interface Signal {
  /** stable dotted id, e.g. "gpu.renderer" */
  id: string;
  /** human label for the nerd table, e.g. "GPU renderer" */
  label: string;
  /** the raw measured value */
  value: unknown;
  /** pretty one-line rendering; falls back to String(value) */
  display?: string;
  /** estimated bits of identifying entropy this signal carries */
  entropy?: number;
  /** wall-clock ms the measurement took */
  ms?: number;
  /** set when the probe failed or the API was unavailable */
  error?: string;
}

export type SignalMap = Record<string, Signal>;

export interface ProbeContext {
  /** signals already gathered (probes run in dependency order within a tier) */
  signals: SignalMap;
  /** true once the user has explicitly opted into the invasive tier */
  consented: boolean;
  /** abort in-flight work if the user navigates away */
  signal: AbortSignal;
}

export interface Probe {
  id: string;
  title: string;
  /**
   * Tier 0 runs immediately on load (passive, zero permission, zero side effect).
   * Tier 1 runs immediately but is slower (canvas/audio/font rasterisation).
   * Tier 2 is INVASIVE, port scans, protocol probes, extension enumeration.
   * Tier 2 never runs without `consented`.
   */
  tier: 0 | 1 | 2;
  run(ctx: ProbeContext): Promise<Signal[]>;
}

export type Confidence = 'certain' | 'likely' | 'guess';

/**
 * A claim is one line of the dossier: a plain-English, second-person assertion
 * derived from one or more signals. This is the only thing the user reads.
 */
export interface Claim {
  id: string;
  /** the line itself, e.g. "You're on a 14-inch MacBook Pro." */
  text: string;
  confidence: Confidence;
  /** narrative act, 1..8, controls reveal order */
  act: number;
  /** shock ranking within the act; higher lands later and harder */
  weight: number;
  /** signal ids backing this claim */
  evidence: string[];
  /** what technique produced it, shown in the "how?" drawer */
  how: string;
}

export type Inference = (s: SignalMap) => Claim[];

/** Server-injected context from the Cloudflare edge (request.cf + headers). */
export interface EdgeContext {
  ip?: string;
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
  userAgent?: string;
  acceptLanguage?: string;
  clientHints?: Record<string, string>;
  headerOrder?: string[];
}
