import type { Probe, Signal } from '../types';
import { hash } from '../runner';

const sig = (id: string, label: string, value: unknown, extra: Partial<Signal> = {}): Signal => ({
  id, label, value, ...extra,
});

/** CPU architecture via the IEEE-754 NaN sign-bit trick: Inf - Inf produces a NaN
 *  whose sign bit is set by the CPU's FPU, and x86 vs ARM disagree on the default. */
export const cpuArchProbe: Probe = {
  id: 'cpuArch',
  title: 'CPU architecture',
  tier: 0,
  async run() {
    try {
      const f = new Float32Array(1);
      const u8 = new Uint8Array(f.buffer);
      f[0] = Infinity;
      f[0] = f[0] - f[0]; // Inf - Inf = NaN; the sign bit is CPU/FPU dependent
      const signByte = u8[3];
      // Verified empirically: x86/x86-64 default NaN is 0xFFC00000 (sign bit SET,
      // top byte 255); ARM's is 0x7FC00000 (sign bit clear, top byte 127).
      // Anything else we refuse to guess from.
      const archGuess = signByte === 255 ? 'x86-family' : signByte === 127 ? 'ARM-family' : 'unknown';

      return [
        sig('deep.nanArch', 'NaN sign byte', signByte, { entropy: 1 }),
        sig('deep.archGuess', 'CPU architecture guess', archGuess, {
          display: archGuess, entropy: 1,
        }),
      ];
    } catch (err) {
      return [sig('deep.nanArch', 'NaN sign byte', null, {
        error: err instanceof Error ? err.message : String(err),
      })];
    }
  },
};

/** Floating-point/libm fingerprint: extreme inputs to transcendental Math functions
 *  expose last-bit differences between JS engines and CPU libm implementations. */
export const mathProbe: Probe = {
  id: 'math',
  title: 'Math fingerprint',
  tier: 0,
  async run() {
    try {
      const results: Record<string, number> = {
        acos: Math.acos(0.123),
        acosh: Math.acosh(1e308),
        asin: Math.asin(0.123),
        asinh: Math.asinh(1e308),
        atan: Math.atan(2),
        atanh: Math.atanh(0.5),
        cbrt: Math.cbrt(100),
        cos: Math.cos(1e13),
        cosh: Math.cosh(100),
        exp: Math.exp(1),
        expm1: Math.expm1(1),
        log1p: Math.log1p(10),
        sin: Math.sin(1e13),
        sinh: Math.sinh(1),
        tan: Math.tan(1e300),
        tanh: Math.tanh(0.5),
        pow: Math.pow(Math.PI, -100),
      };

      const mathHash = hash(JSON.stringify(results));
      const sampleKeys: Array<keyof typeof results> = ['sin', 'tan', 'expm1'];
      const mathSample = sampleKeys.map((k) => `${k}=${results[k]}`).join(', ');

      return [
        sig('deep.mathHash', 'Math fingerprint hash', mathHash, { entropy: 3 }),
        sig('deep.mathSample', 'Math sample values', results, { display: mathSample }),
      ];
    } catch (err) {
      return [sig('deep.mathHash', 'Math fingerprint hash', null, {
        error: err instanceof Error ? err.message : String(err),
      })];
    }
  },
};

/** Payment/vendor capability probing: Apple Pay availability and Private Click
 *  Measurement reveal a real card on file and Safari's ad-attribution API, while
 *  vendor-only globals unmask the true embedding browser behind a shared engine. */
export const applePayProbe: Probe = {
  id: 'applePay',
  title: 'Payment & vendor capabilities',
  tier: 1,
  async run() {
    const out: Signal[] = [];

    // ApplePaySession.canMakePayments() distinguishes "no API" (not Safari/not
    // Apple Pay capable) from "no card" (API present, nothing provisioned) from
    // "available" (a real card is set up in Wallet), a strong device signal.
    try {
      const w = window as unknown as { ApplePaySession?: { canMakePayments: () => boolean } };
      if (!w.ApplePaySession) {
        out.push(sig('deep.applePay', 'Apple Pay', 'no-api'));
      } else {
        const can = w.ApplePaySession.canMakePayments();
        out.push(sig('deep.applePay', 'Apple Pay', can ? 'available' : 'no-card', { entropy: 1.2 }));
      }
    } catch (err) {
      out.push(sig('deep.applePay', 'Apple Pay', 'error', {
        error: err instanceof Error ? err.message : String(err),
      }));
    }

    // Private Click Measurement: the attributionSourceId property only exists on
    // <a> elements in WebKit builds shipping Apple's ad-attribution API.
    try {
      const a = document.createElement('a') as unknown as { attributionSourceId?: unknown };
      out.push(sig('deep.privateClickMeasurement', 'Private Click Measurement', a.attributionSourceId !== undefined));
    } catch (err) {
      out.push(sig('deep.privateClickMeasurement', 'Private Click Measurement', null, {
        error: err instanceof Error ? err.message : String(err),
      }));
    }

    // Vendor-only globals: browsers that re-skin a shared engine (all iOS
    // browsers are WebKit; many "new" browsers are Chromium) still inject their
    // own JS globals, which unmasks the real vendor even when UA is spoofed.
    try {
      const w = window as unknown as Record<string, unknown>;
      const n = navigator as unknown as { userAgentData?: unknown };
      const vendorChecks: Array<[string, unknown]> = [
        ['chrome-ios', w.__gCrWeb],
        ['yandex', w.__ybro],
        ['puffin', w.puffinDevice],
        ['samsung-internet', w.samsungAr],
        ['uc-browser', w.UCShellJava],
      ];
      const matched = vendorChecks.find(([, v]) => v !== undefined);
      out.push(sig('deep.vendorFlavor', 'Vendor flavor', matched ? matched[0] : 'standard', { entropy: 1.5 }));
      out.push(sig('deep.uaFlavor', 'UA hint style', n.userAgentData ? 'ua-ch' : 'legacy-ua'));
    } catch (err) {
      out.push(sig('deep.vendorFlavor', 'Vendor flavor', null, {
        error: err instanceof Error ? err.message : String(err),
      }));
    }

    return out;
  },
};

/** MathML layout fingerprint: exotic MathML (nested pre/post-scripts, blackboard-
 *  bold unicode) renders with font/hinting/metrics that vary by OS and engine,
 *  and almost no anti-fingerprinting tool intercepts the MathML layout path. */
export const mathmlProbe: Probe = {
  id: 'mathml',
  title: 'MathML rendering',
  tier: 1,
  async run() {
    let container: HTMLDivElement | null = null;
    try {
      container = document.createElement('div');
      container.style.cssText = 'position:absolute; visibility:hidden; left:-9999px; top:-9999px; font-size:37px;';
      container.innerHTML = `
        <math>
          <mmultiscripts>
            <mi>X</mi><mn>1</mn><mn>2</mn>
            <mprescripts/><mn>3</mn><mn>4</mn>
          </mmultiscripts>
        </math>
        <math>
          <mrow>
            <mi>&#x2102;</mi><mi>&#x1D504;</mi><mi>&#x1D505;</mi><mi>&#x211D;</mi><mi>&#x211A;</mi>
            <msubsup><mi>A</mi><mn>1</mn><mn>2</mn></msubsup>
          </mrow>
        </math>
      `;
      document.body.appendChild(container);

      const mathEls = container.querySelectorAll('math');
      const rects = Array.from(mathEls).map((el) => {
        const r = el.getBoundingClientRect();
        return { w: r.width, h: r.height };
      });

      const cs = getComputedStyle(container);
      const geometry = {
        rects,
        fontKerning: cs.fontKerning,
        fontFeatureSettings: cs.fontFeatureSettings,
      };

      const mathmlHash = hash(JSON.stringify(geometry));

      return [
        sig('deep.mathmlHash', 'MathML rendering hash', mathmlHash, {
          display: rects.map((r) => `${r.w.toFixed(2)}x${r.h.toFixed(2)}`).join(', '),
          entropy: 3,
        }),
      ];
    } catch (err) {
      return [sig('deep.mathmlHash', 'MathML rendering hash', null, {
        error: err instanceof Error ? err.message : String(err),
      })];
    } finally {
      container?.remove();
    }
  },
};
