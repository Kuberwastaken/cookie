import type { Claim, Inference, SignalMap } from '../types';

const claim = (c: Omit<Claim, 'confidence'> & Partial<Pick<Claim, 'confidence'>>): Claim => ({
  confidence: 'likely', ...c,
});

function humanList(items: string[]): string {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

interface OpenPort { port: number; service: string; ms: number; }

/** The headline of the invasive act: services running on your own machine. */
export const localServices: Inference = (s) => {
  const ports = (s['localnet.openPorts']?.value as OpenPort[] | undefined) ?? [];
  if (s['localnet.blocked']?.value === true || !ports.length) return [];
  const out: Claim[] = [];

  // Call out the juiciest finds by name first.
  const named: Record<number, { text: string; weight: number }> = {
    11434: { text: `You're running *Ollama*, you run local AI models on this machine.`, weight: 10 },
    1234: { text: `*LM Studio* is running, you run local language models.`, weight: 9 },
    7860: { text: `You've got a *Stable Diffusion* web UI running locally.`, weight: 9 },
    2375: { text: `*Docker* is running on your machine.`, weight: 7 },
    8888: { text: `You have a *Jupyter* notebook server running.`, weight: 8 },
    5432: { text: `There's a *PostgreSQL* database running on your machine.`, weight: 7 },
    3306: { text: `You've got a *MySQL* database running locally.`, weight: 7 },
    6379: { text: `*Redis* is running on localhost.`, weight: 7 },
    27017: { text: `A *MongoDB* server is running on your machine.`, weight: 7 },
    32400: { text: `You run a *Plex* media server.`, weight: 8 },
    8096: { text: `You run a *Jellyfin* media server.`, weight: 8 },
  };

  const highlights = ports.filter((p) => named[p.port]).slice(0, 4);
  for (const p of highlights) {
    out.push(claim({
      id: `net.${p.port}`,
      text: named[p.port].text,
      confidence: 'likely', act: 6, weight: named[p.port].weight,
      evidence: ['localnet.openPorts', 'localnet.method'],
      how: `Your browser can't read localhost responses, but it can *time* the connection. Port ${p.port} accepted a TCP connection in a way a closed port never would (${Math.round(p.ms)}ms vs the instant refusal of a dead port). That's ${p.service}, running on your computer, detected from a public website.`,
    }));
  }

  // A dev-server sweep as a group, if we found the usual suspects.
  const devPorts = ports.filter((p) => [3000, 5173, 8080, 8000, 5000, 4200, 3001].includes(p.port));
  if (devPorts.length >= 2 && !highlights.length) {
    out.push(claim({
      id: 'net.dev',
      text: `You're a *developer*, you have local dev servers running on ${devPorts.map((p) => p.port).join(', ')} right now.`,
      confidence: 'likely', act: 6, weight: 7,
      evidence: ['localnet.openPorts'],
      how: `Those are the default ports for React, Vite, Django, Flask and friends. A website just portscanned your loopback interface by timing connections, and found your work.`,
    }));
  }

  return out;
};

/** Installed desktop apps via protocol-handler probing. */
export const installedApps: Inference = (s) => {
  const apps = (s['apps.installed']?.value as string[] | undefined) ?? [];
  if (!apps.length) return [];
  return [claim({
    id: 'apps.list',
    text: `You have ${humanList(apps)} installed.`,
    confidence: 'guess', act: 6, weight: 6,
    evidence: ['apps.installed', 'apps.probed'],
    how: `Each of these apps registered a URL scheme with your OS (slack://, discord://, and so on). We quietly tested whether your browser would hand each one off to an installed app, and these responded.`,
  })];
};

/** Browser extensions and the ad blocker. */
export const extensions: Inference = (s) => {
  const detected = (s['ext.detected']?.value as Array<{ name: string; id: string }> | undefined) ?? [];
  const out: Claim[] = [];

  if (detected.length) {
    const names = detected.map((d) => d.name);
    const spicy = names.find((n) => /metamask|wallet|lastpass|bitwarden|1password/i.test(n));
    out.push(claim({
      id: 'ext.list',
      text: spicy
        ? `You've got *${spicy}* installed${names.length > 1 ? `, plus ${names.length - 1} other extension${names.length > 2 ? 's' : ''}` : ''}.`
        : `You have these browser extensions: ${humanList(names)}.`,
      confidence: 'likely', act: 6, weight: spicy ? 8 : 5,
      evidence: ['ext.detected'],
      how: `Extensions ship files marked "web-accessible." We tried to load one known file from each of a list of popular extensions; the ones that loaded are installed. ${spicy ? 'A crypto wallet or password manager is an especially loud thing to leak.' : ''}`,
    }));
  }

  if (s['ext.adblock']?.value === true) {
    const name = s['ext.adblockName']?.value as string | undefined;
    out.push(claim({
      id: 'ext.adblock',
      text: name && name !== 'unknown'
        ? `You're blocking ads with *${name}*.`
        : `You're running an *ad blocker*.`,
      confidence: 'certain', act: 6, weight: 4,
      evidence: ['ext.adblock', 'ext.adblockName'],
      how: `We placed a decoy element with the class names ad blockers hunt for. It vanished, so something is filtering your page. ${name && name !== 'unknown' ? `The signature matches ${name}.` : ''}`,
    }));
  }

  return out;
};
