import type { Probe, Signal } from '../types';
import { hash } from '../runner';

const sig = (id: string, label: string, value: unknown, extra: Partial<Signal> = {}): Signal => ({
  id, label, value, ...extra,
});

type GLish = WebGLRenderingContext | WebGL2RenderingContext;

/** Read the WebGL renderer string inside a fresh Worker, via a blob URL so no
 * separate script file is needed. Most spoofing extensions patch the main
 * thread's WebGL prototype and forget the Worker has its own, comparing the
 * two is CreepJS's strongest anti-spoof check. */
function readRendererInWorker(): Promise<string | null> {
  return new Promise((resolve) => {
    const src = `
      self.onmessage = function () {
        try {
          if (typeof OffscreenCanvas === 'undefined') { postMessage(null); return; }
          var canvas = new OffscreenCanvas(64, 64);
          var gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
          if (!gl) { postMessage(null); return; }
          var dbg = gl.getExtension('WEBGL_debug_renderer_info');
          var renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
          postMessage(renderer || null);
        } catch (e) {
          postMessage(null);
        }
      };
    `;
    let worker: Worker | null = null;
    let url: string | null = null;
    const cleanup = () => {
      worker?.terminate();
      if (url) URL.revokeObjectURL(url);
    };
    try {
      const blob = new Blob([src], { type: 'application/javascript' });
      url = URL.createObjectURL(blob);
      worker = new Worker(url);
      const timer = setTimeout(() => { cleanup(); resolve(null); }, 1500);
      worker.onmessage = (ev: MessageEvent) => { clearTimeout(timer); cleanup(); resolve(ev.data ?? null); };
      worker.onerror = () => { clearTimeout(timer); cleanup(); resolve(null); };
      worker.postMessage('go');
    } catch {
      resolve(null);
    }
  });
}

/** WebGL vendor/renderer, a worker cross-check for spoofing, WebGPU adapter info,
 * and a grab-bag of GL parameters that vary by driver and hardware tier. */
export const gpuProbe: Probe = {
  id: 'gpu',
  title: 'GPU',
  tier: 0,
  async run() {
    const out: Signal[] = [];

    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl2') || canvas.getContext('webgl')) as GLish | null;

    if (!gl) {
      out.push(sig('gpu.vendor', 'GPU vendor', null, { error: 'WebGL unavailable' }));
      return out;
    }

    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const vendor = dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
    const renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);

    out.push(
      sig('gpu.vendor', 'GPU vendor', vendor ?? null),
      sig('gpu.renderer', 'GPU renderer', renderer ?? null, { entropy: 7 }),
    );

    const params: Record<string, unknown> = {};
    try {
      params.MAX_TEXTURE_SIZE = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      params.MAX_VIEWPORT_DIMS = Array.from(gl.getParameter(gl.MAX_VIEWPORT_DIMS) as ArrayLike<number>);
      params.MAX_RENDERBUFFER_SIZE = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);
      params.ALIASED_LINE_WIDTH_RANGE = Array.from(gl.getParameter(gl.ALIASED_LINE_WIDTH_RANGE) as ArrayLike<number>);
      params.SHADING_LANGUAGE_VERSION = gl.getParameter(gl.SHADING_LANGUAGE_VERSION);
      params.VERSION = gl.getParameter(gl.VERSION);
    } catch { /* some param unsupported on this driver */ }
    out.push(sig('gpu.params', 'WebGL parameters', params));

    const extensions = gl.getSupportedExtensions() ?? [];
    out.push(sig('gpu.extensions', 'WebGL extensions', extensions, {
      display: `${extensions.length} extensions`,
    }));

    const workerRenderer = await readRendererInWorker();
    out.push(sig('gpu.workerRenderer', 'GPU renderer (worker)', workerRenderer));
    if (workerRenderer != null) {
      out.push(sig('gpu.rendererMismatch', 'Renderer mismatch (main vs worker)', workerRenderer !== renderer));
    }

    // WebGPU is a second, independently-implemented path to the same vendor info,
    // no ambient lib.webgpu types are configured, so this stays loosely typed.
    const gpuNav = navigator as Navigator & { gpu?: { requestAdapter: (...a: unknown[]) => Promise<unknown> } };
    if (gpuNav.gpu) {
      try {
        const adapter = (await gpuNav.gpu.requestAdapter()) as {
          info?: { vendor?: string; architecture?: string; description?: string };
          requestAdapterInfo?: () => Promise<{ vendor?: string; architecture?: string; description?: string }>;
        } | null;
        const info = adapter?.info ?? (adapter?.requestAdapterInfo ? await adapter.requestAdapterInfo() : null);
        if (info) {
          out.push(
            sig('gpu.webgpuVendor', 'WebGPU vendor', info.vendor ?? null),
            sig('gpu.webgpuArch', 'WebGPU architecture', info.architecture ?? null),
            sig('gpu.webgpuDesc', 'WebGPU description', info.description ?? null),
          );
        }
      } catch { /* adapter request denied or unsupported */ }
    }

    return out;
  },
};

/** 2D canvas fingerprint: a mixed-font/emoji text render plus shapes, and a
 * second emoji-only render whose glyph shapes shift with OS point releases. */
export const canvasProbe: Probe = {
  id: 'canvas',
  title: 'Canvas',
  tier: 1,
  async run() {
    const out: Signal[] = [];

    try {
      const c = document.createElement('canvas');
      c.width = 280;
      c.height = 60;
      const ctx = c.getContext('2d')!;
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#f60';
      ctx.fillRect(0, 0, 100, 30);
      ctx.fillStyle = '#069';
      ctx.font = '16px "Arial"';
      ctx.fillText('nocookies 🕵️ CW#$%^&*() 1.0', 4, 20);
      ctx.font = 'italic 12px "Times New Roman"';
      ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
      ctx.fillText('the quick brown fox', 4, 45);
      const grad = ctx.createLinearGradient(0, 0, 280, 0);
      grad.addColorStop(0, 'magenta');
      grad.addColorStop(1, 'cyan');
      ctx.strokeStyle = grad;
      ctx.beginPath();
      ctx.arc(220, 30, 20, 0, Math.PI * 2);
      ctx.stroke();

      out.push(sig('canvas.hash', 'Canvas fingerprint', hash(c.toDataURL()), { entropy: 6 }));

      const ref = 'The quick brown Æøå fox jumps 0123456789';
      const m = ctx.measureText(ref);
      out.push(sig('canvas.textMetrics', 'Text metrics', {
        width: m.width,
        actualBoundingBoxAscent: m.actualBoundingBoxAscent,
        actualBoundingBoxDescent: m.actualBoundingBoxDescent,
        fontBoundingBoxAscent: m.fontBoundingBoxAscent,
        fontBoundingBoxDescent: m.fontBoundingBoxDescent,
      }));
    } catch (err) {
      out.push(sig('canvas.hash', 'Canvas fingerprint', null, {
        error: err instanceof Error ? err.message : String(err),
      }));
    }

    try {
      const c2 = document.createElement('canvas');
      c2.width = 200;
      c2.height = 50;
      const ctx2 = c2.getContext('2d')!;
      ctx2.textBaseline = 'alphabetic';
      ctx2.font = '24px sans-serif';
      ctx2.fillText('🎨🌍👨‍👩‍👧‍👦🏳️‍🌈', 0, 32);
      out.push(sig('canvas.emojiHash', 'Emoji render fingerprint', hash(c2.toDataURL()), { entropy: 3 }));
    } catch (err) {
      out.push(sig('canvas.emojiHash', 'Emoji render fingerprint', null, {
        error: err instanceof Error ? err.message : String(err),
      }));
    }

    return out;
  },
};

/** OfflineAudioContext oscillator → compressor fingerprint, the analogue-modelled
 * DSP path differs subtly by OS audio stack, well below audible thresholds. */
export const audioProbe: Probe = {
  id: 'audio',
  title: 'Audio',
  tier: 1,
  async run() {
    const out: Signal[] = [];

    try {
      const Ctx = (window as unknown as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext
        ?? (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
      if (!Ctx) throw new Error('OfflineAudioContext unavailable');

      const ctx = new Ctx(1, 44100, 44100);
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = 10000;

      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -50;
      compressor.knee.value = 40;
      compressor.ratio.value = 12;
      compressor.attack.value = 0;
      compressor.release.value = 0.25;

      osc.connect(compressor);
      compressor.connect(ctx.destination);
      osc.start(0);

      const rendered = await Promise.race([
        ctx.startRendering(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 1000)),
      ]);
      if (!rendered) throw new Error('render timed out');

      const data = rendered.getChannelData(0);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += Math.abs(data[i]);

      out.push(
        sig('audio.hash', 'Audio fingerprint', hash(sum.toString()), { entropy: 5 }),
        sig('audio.sampleRate', 'Audio sample rate', ctx.sampleRate),
      );
    } catch (err) {
      out.push(sig('audio.hash', 'Audio fingerprint', null, {
        error: err instanceof Error ? err.message : String(err),
      }));
    }

    return out;
  },
};

/** Sub-pixel layout geometry: getBoundingClientRect on transformed elements and
 * a Range, hashed together, font metrics and rasteriser rounding leak here. */
export const domRectProbe: Probe = {
  id: 'domrect',
  title: 'DOM geometry',
  tier: 1,
  async run() {
    const out: Signal[] = [];

    try {
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed; left:-9999px; top:-9999px; visibility:hidden;';
      document.body.appendChild(host);

      const specs = [
        'width:33.33px; height:17.7px; transform: rotate(0.3deg) translateX(0.15px);',
        'width:100.1px; height:50.05px; transform: skew(0.2deg, 0.1deg);',
        'width:12.34px; height:56.78px; font-size:13.37px; letter-spacing:0.05px;',
      ];

      const rects: Array<Record<string, number>> = [];
      for (const style of specs) {
        const el = document.createElement('div');
        el.textContent = 'AaBbYyZz';
        el.style.cssText = style;
        host.appendChild(el);
        const r = el.getBoundingClientRect();
        rects.push({ x: r.x, y: r.y, width: r.width, height: r.height, top: r.top, left: r.left });
      }

      const range = document.createRange();
      range.selectNodeContents(host);
      const rangeRect = range.getBoundingClientRect();
      rects.push({
        x: rangeRect.x, y: rangeRect.y, width: rangeRect.width, height: rangeRect.height,
        top: rangeRect.top, left: rangeRect.left,
      });

      document.body.removeChild(host);

      out.push(sig('domrect.hash', 'DOM geometry fingerprint', hash(JSON.stringify(rects))));
    } catch (err) {
      out.push(sig('domrect.hash', 'DOM geometry fingerprint', null, {
        error: err instanceof Error ? err.message : String(err),
      }));
    }

    return out;
  },
};
