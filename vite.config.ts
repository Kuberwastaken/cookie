import { defineConfig, type Plugin } from 'vite';

/**
 * In production /api/context is a Cloudflare Pages Function with access to
 * `request.cf`. Vite's dev server has none of that, so this stands in with
 * whatever the raw Node request exposes — enough to develop the UI against.
 */
function devEdgeContext(): Plugin {
  return {
    name: 'dev-edge-context',
    configureServer(server) {
      server.middlewares.use('/api/context', (req, res) => {
        const h = req.headers as Record<string, string | undefined>;
        const clientHints: Record<string, string> = {};
        for (const [k, v] of Object.entries(h)) {
          if ((k.startsWith('sec-ch-') || k === 'device-memory' || k === 'rtt' || k === 'downlink') && v) {
            clientHints[k] = v;
          }
        }
        res.setHeader('content-type', 'application/json');
        res.setHeader('cache-control', 'no-store');
        res.end(
          JSON.stringify({
            ip: req.socket.remoteAddress,
            userAgent: h['user-agent'],
            acceptLanguage: h['accept-language'],
            accept: h['accept'],
            acceptEncoding: h['accept-encoding'],
            dnt: h['dnt'],
            secGpc: h['sec-gpc'],
            referer: h['referer'],
            httpProtocol: `HTTP/${req.httpVersion}`,
            clientHints,
            headerOrder: Object.keys(h),
            __dev: true,
          }),
        );
      });
    },
  };
}

export default defineConfig({
  // Relative base so the build works under a project-pages subpath
  // (username.github.io/cookie/) as well as at a domain root.
  base: './',
  plugins: [devEdgeContext()],
  server: { host: '0.0.0.0', port: 5173 },
  build: {
    target: 'es2022',
    // One file, no code-splitting: the whole point is that this is small and
    // everything runs before you can react to it.
    rollupOptions: { output: { manualChunks: undefined } },
  },
});
