import type { Probe, Signal } from '../types';

const sig = (id: string, label: string, value: unknown, extra: Partial<Signal> = {}): Signal => ({
  id, label, value, ...extra,
});

/**
 * Curated list of local services worth checking for. Port choice biases
 * heavily towards dev tooling and self-hosted apps, since that's who is
 * likely to be running something on localhost while browsing.
 */
const CANDIDATES: Array<{ port: number; service: string }> = [
  { port: 11434, service: 'Ollama' },
  { port: 1234, service: 'LM Studio' },
  { port: 8080, service: 'dev/proxy' },
  { port: 3000, service: 'Node/React dev' },
  { port: 5173, service: 'Vite' },
  { port: 8000, service: 'Python/Django' },
  { port: 5000, service: 'Flask' },
  { port: 3306, service: 'MySQL' },
  { port: 5432, service: 'Postgres' },
  { port: 6379, service: 'Redis' },
  { port: 27017, service: 'MongoDB' },
  { port: 9200, service: 'Elasticsearch' },
  { port: 2375, service: 'Docker' },
  { port: 8888, service: 'Jupyter' },
  { port: 7860, service: 'Gradio/A1111' },
  { port: 9000, service: 'Portainer/php-fpm' },
  { port: 4200, service: 'Angular' },
  { port: 5900, service: 'VNC' },
  { port: 631, service: 'CUPS printing' },
  { port: 8096, service: 'Jellyfin' },
  { port: 32400, service: 'Plex' },
  { port: 51413, service: 'Transmission' },
  { port: 9090, service: 'Prometheus' },
  { port: 3001, service: 'Grafana-ish' },
];

const CONCURRENCY = 6;
const FETCH_TIMEOUT_MS = 1200;
// A fetch that rejects faster than this is almost certainly a TCP RST from a
// closed port, not a real round trip. Anything meaningfully slower than the
// machine's own baseline suggests something actually accepted the connection.
const FAST_REJECT_MS = 150;

/**
 * Time a single no-cors fetch attempt. We never read the response body (the
 * browser wouldn't let us for a cross-origin localhost target anyway, and
 * Local Network Access prompts/blocks would fire first), we only care how
 * long the browser took to give up on, or open, the TCP connection.
 */
async function timeFetch(url: string, outerSignal: AbortSignal): Promise<{ ms: number; ok: boolean; timedOut: boolean }> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  outerSignal.addEventListener('abort', onAbort, { once: true });
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  const start = performance.now();
  try {
    await fetch(url, { mode: 'no-cors', signal: controller.signal, cache: 'no-store' });
    // no-cors resolves opaque on success too; either way something answered.
    return { ms: performance.now() - start, ok: true, timedOut: false };
  } catch {
    const ms = performance.now() - start;
    const timedOut = ms >= FETCH_TIMEOUT_MS - 50;
    return { ms, ok: false, timedOut };
  } finally {
    clearTimeout(timeoutId);
    outerSignal.removeEventListener('abort', onAbort);
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Headline technique: browsers block reading localhost *response bodies*
 * (CORS, and increasingly Local Network Access permission prompts), but they
 * cannot hide the underlying TCP handshake timing. A closed port RSTs almost
 * instantly (<~5-150ms depending on OS/stack); an open port either completes
 * the TCP handshake (then gets blocked at the HTTP/CORS layer) or the server
 * accepts and holds the connection, both of which take measurably longer or
 * run out the clock entirely. We calibrate against a random high port that
 * is essentially guaranteed to be closed, then flag candidates whose timing
 * is a significant multiple of that baseline as "open". This is heuristic
 * and will produce false positives (slow closed ports, firewalled-but-open
 * ports) and false negatives (services that bind but drop silently), it is
 * a demonstration of the class of attack, not a precise scanner.
 */
export const localNetProbe: Probe = {
  id: 'localnet',
  title: 'Local network',
  tier: 2,
  async run(ctx) {
    if (!ctx.consented) {
      return [sig('localnet.blocked', 'Local network scan', true, { error: 'no consent' })];
    }

    const out: Signal[] = [];

    try {
      // Calibration: a random ephemeral port almost certainly has nothing
      // listening, so its timing establishes this machine/browser's
      // "connection refused" baseline.
      const calibrationPort = 49152 + Math.floor(Math.random() * (65535 - 49152));
      const calibration = await timeFetch(`http://127.0.0.1:${calibrationPort}/`, ctx.signal);
      const baselineMs = calibration.ms;

      // If even the calibration port looks "open" (slow/timed out), the
      // browser is likely blocking all localhost fetches uniformly (e.g. via
      // a Local Network Access permission prompt that never resolves), which
      // makes the timing signal meaningless.
      const blocked = calibration.ok || calibration.timedOut || baselineMs > 800;

      out.push(sig('localnet.method', 'Detection method',
        'TCP connect timing via fetch(no-cors): closed ports reject fast (RST); open ports hang past the calibrated baseline before CORS blocks the read.',
        { display: `baseline ${Math.round(baselineMs)}ms on port ${calibrationPort}` }));

      if (blocked) {
        out.push(sig('localnet.blocked', 'Scan blocked', true,
          { display: 'browser refused/hung uniformly; timing signal unusable' }));
        out.push(sig('localnet.scanned', 'Ports scanned', 0));
        out.push(sig('localnet.openPorts', 'Open ports', []));
        return out;
      }

      const threshold = Math.max(baselineMs * 3, baselineMs + 40, FAST_REJECT_MS);

      const results = await mapWithConcurrency(CANDIDATES, CONCURRENCY, async (c) => {
        if (ctx.signal.aborted) return null;
        const r = await timeFetch(`http://127.0.0.1:${c.port}/`, ctx.signal);
        return { ...c, ...r };
      });

      const openPorts = results
        .filter((r): r is NonNullable<typeof r> => r !== null)
        .filter((r) => r.ok || r.timedOut || r.ms > threshold)
        .map((r) => ({ port: r.port, service: r.service, ms: Math.round(r.ms) }));

      out.push(sig('localnet.scanned', 'Ports scanned', CANDIDATES.length));
      out.push(sig('localnet.openPorts', 'Open ports (heuristic)', openPorts, {
        display: openPorts.length
          ? openPorts.map((p) => `${p.port} (${p.service})`).join(', ')
          : 'none detected',
        entropy: openPorts.length ? 3 : 0,
      }));
      out.push(sig('localnet.blocked', 'Scan blocked', false));
    } catch (e) {
      out.push(sig('localnet.blocked', 'Scan blocked', true, { error: String(e) }));
    }

    return out;
  },
};
