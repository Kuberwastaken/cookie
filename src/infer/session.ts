import type { Claim, Inference, SignalMap } from '../types';

const claim = (c: Omit<Claim, 'confidence'> & Partial<Pick<Claim, 'confidence'>>): Claim => ({
  confidence: 'likely', ...c,
});

const num = (s: SignalMap, id: string): number | undefined => {
  const v = s[id]?.value;
  return typeof v === 'number' ? v : undefined;
};

/** "You asked not to be tracked. We saw it. We ignored it." — act 4. */
export const trackingHypocrisy: Inference = (s) => {
  const dnt = s['platform.dnt']?.value;
  const gpc = s['platform.gpc']?.value === true;
  const on = dnt === '1' || dnt === 'yes' || dnt === true || gpc;
  if (!on) return [];
  const which = gpc && dnt === '1' ? 'Do Not Track and Global Privacy Control' : gpc ? 'Global Privacy Control' : 'Do Not Track';
  return [claim({
    id: 'ses.dnt',
    text: `You've switched on *${which}* — you're actively asking sites not to track you. We saw the request. We ignored it. So does nearly everyone.`,
    confidence: 'certain', act: 4, weight: 5,
    evidence: ['platform.dnt', 'platform.gpc'],
    how: `Your browser sends a header on every request asking not to be tracked. It's honoured by almost no one because it was never legally binding (GPC has some force under California law; DNT has essentially none). The signal arrives; the site decides whether to care. Most don't.`,
  })];
};

/** Battery state → "you're not plugged in." — act 3. */
export const batteryState: Inference = (s) => {
  const level = num(s, 'hw.batteryLevel');
  const charging = s['hw.charging']?.value;
  if (level == null) return [];
  const pct = Math.round(level * 100);
  return [claim({
    id: 'ses.battery',
    text: charging === false
      ? `Your battery is at *${pct}%* and you're *not plugged in* right now.`
      : `Your battery is at *${pct}%*.`,
    confidence: 'certain', act: 3, weight: 3,
    evidence: ['hw.batteryLevel', 'hw.charging'],
    how: `The Battery Status API hands your exact charge level and whether you're plugged in to any site, no permission. Firefox and Safari removed it specifically because it's this good a fingerprint; Chrome still ships it.`,
  })];
};

/** DevTools open + free disk — the developer-audience "gotcha." — act 6. */
export const sessionMeta: Inference = (s) => {
  const out: Claim[] = [];

  if (s['meta.devtools']?.value === true) {
    out.push(claim({
      id: 'ses.devtools',
      text: `Your *developer tools are open* right now. (We see you inspecting us.)`,
      confidence: 'guess', act: 6, weight: 6,
      evidence: ['meta.devtools'],
      how: `Two tells: an open panel shrinks the page's viewport well below the window size, and the console only runs an object's getter when it's actually rendering it — we logged a tripwire object and the getter fired. Both are heuristics, so if you've got them open and we missed it, or you don't and we called it — that's the noise in this one.`,
    }));
  }

  // Note: we deliberately do NOT claim "free disk space" here. storage.estimate()
  // returns a quota the browser scales and heavily buckets, so it's a poor proxy
  // for real free space (often off by tens of GB). We keep it only as raw signal.

  return out;
};
