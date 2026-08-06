import type { Claim, Inference, SignalMap } from '../types';

const claim = (c: Omit<Claim, 'confidence'> & Partial<Pick<Claim, 'confidence'>>): Claim => ({
  confidence: 'likely', ...c,
});

const num = (s: SignalMap, id: string): number | undefined => {
  const v = s[id]?.value;
  return typeof v === 'number' ? v : undefined;
};

/** "You asked not to be tracked. We saw it. We ignored it.", act 4. */
export const trackingHypocrisy: Inference = (s) => {
  const dnt = s['platform.dnt']?.value;
  const gpc = s['platform.gpc']?.value === true;
  const on = dnt === '1' || dnt === 'yes' || dnt === true || gpc;
  if (!on) return [];
  const which = gpc && dnt === '1' ? 'Do Not Track and Global Privacy Control' : gpc ? 'Global Privacy Control' : 'Do Not Track';
  return [claim({
    id: 'ses.dnt',
    text: `You've switched on *${which}*, you're actively asking sites not to track you. We saw the request. We ignored it. So does nearly everyone.`,
    confidence: 'certain', act: 4, weight: 5,
    evidence: ['platform.dnt', 'platform.gpc'],
    how: `Your browser sends a header on every request asking not to be tracked. It's honoured by almost no one because it was never legally binding (GPC has some force under California law; DNT has essentially none). The signal arrives; the site decides whether to care. Most don't.`,
  })];
};

/** Battery state → "you're not plugged in.", act 3. */
export const batteryState: Inference = (s) => {
  const level = num(s, 'hw.batteryLevel');
  const charging = s['hw.charging']?.value;
  if (level == null) return [];
  // A desktop with NO battery reports exactly level 1.0 + charging:true, which
  // is indistinguishable from a plugged-in laptop at full charge. Saying "your
  // battery is at 100%" to someone with no battery is the tell we avoid, so we
  // only speak when there's something a battery-less machine can't produce.
  if (level >= 1 && charging !== false) return [];
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

/**
 * The one honest piece of good news, a rare "this got better" beat. Login
 * detection genuinely died around 2020 (SameSite cookies), so we say so rather
 * than fake a "you're logged into X" moment that would be all false positives.
 */
export const loginDetectionDead: Inference = () => {
  return [{
    id: 'ses.logindead',
    text: `Ten years ago I could have listed every site you're logged into right now, Gmail, GitHub, your bank. Browsers finally *killed that trick* around 2020. It's the one thing on this page that actually got better.`,
    confidence: 'certain', act: 4, weight: 2,
    evidence: [],
    how: `The attack loaded a login-only image from each site and watched whether it loaded. It worked because your session cookie rode along on that cross-site request. Then browsers made cookies "SameSite=Lax" by default, so they no longer do, and the endpoints that leaked got locked down. We checked in 2026: it's dead across the board. Enjoy this rare win.`,
  }];
};

/** DevTools open + free disk, the developer-audience "gotcha.", act 6. */
export const sessionMeta: Inference = (s) => {
  const out: Claim[] = [];

  if (s['incognito.private']?.value === true) {
    out.push(claim({
      id: 'ses.incognito',
      text: `You're *probably in a private window*. You thought that would change what we can see. It changed *nothing*. Cute.`,
      confidence: 'guess', act: 6, weight: 7,
      evidence: ['incognito.private', 'incognito.method'],
      how: `Private mode only stops your own browser writing history and cookies to disk. It doesn't touch your IP, your GPU, your fonts, your screen, or a single thing on this page, all of which worked exactly the same. Safari private windows switch off the Origin Private File System, and yours is off, which is the tell. We say "probably" because a genuinely full disk raises the same error.`,
    }));
  } else if (s['incognito.attempted']?.value === false) {
    out.push(claim({
      id: 'ses.incognitoUnknown',
      text: `A private window wouldn't have changed *any* of this, incidentally. Every reading above works exactly the same in one.`,
      confidence: 'certain', act: 6, weight: 2,
      evidence: ['incognito.attempted'],
      how: `Private mode only stops your own browser writing history and cookies to disk. It doesn't touch your IP, GPU, fonts, screen or timezone. We're not claiming you're in one, on your browser we deliberately don't guess: Chrome closed the storage-quota gap that used to give it away, and the timing benchmark that replaced it misfires on ordinary machines with fast storage, while Firefox's remaining tell can't be told apart from strict tracking protection in a normal window.`,
    }));
  }


  // Note: we deliberately do NOT claim "free disk space" here. storage.estimate()
  // returns a quota the browser scales and heavily buckets, so it's a poor proxy
  // for real free space (often off by tens of GB). We keep it only as raw signal.

  return out;
};
