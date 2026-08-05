import type { Probe, Signal } from '../types';
import { hash } from '../runner';

const sig = (id: string, label: string, value: unknown, extra: Partial<Signal> = {}): Signal => ({
  id, label, value, ...extra,
});

const STUN_SERVERS = ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'];
const GATHER_TIMEOUT_MS = 3000;

// IPv4 and IPv6 literal matcher, good enough for ICE candidate/SDP parsing.
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;
const IPV6_RE = /\b(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{0,4}\b/i;
// mDNS names Chrome substitutes for the real local IP when local-IP
// protection is on, e.g. "8f3d1a2b-....local".
const MDNS_RE = /\b[0-9a-f-]+\.local\b/i;

function isPrivateOrLinkLocal(ip: string): boolean {
  if (/^10\./.test(ip)) return true;
  if (/^192\.168\./.test(ip)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (/^169\.254\./.test(ip)) return true;
  if (/^fe80:/i.test(ip)) return true;
  return false;
}

interface ParsedCandidate {
  ip: string | null;
  mdns: boolean;
  type: string | null;
}

function parseCandidate(candidateStr: string): ParsedCandidate {
  const mdnsMatch = candidateStr.match(MDNS_RE);
  if (mdnsMatch) return { ip: mdnsMatch[0], mdns: true, type: parseType(candidateStr) };

  const v4 = candidateStr.match(IPV4_RE);
  const v6 = !v4 ? candidateStr.match(IPV6_RE) : null;
  const ip = v4?.[0] ?? v6?.[0] ?? null;
  return { ip, mdns: false, type: parseType(candidateStr) };
}

function parseType(candidateStr: string): string | null {
  const m = candidateStr.match(/\styp\s+(\w+)/);
  return m ? m[1] : null;
}

/**
 * The classic "WebRTC leaks your real IP behind a VPN" demo. ICE candidate
 * gathering talks directly to STUN servers over UDP, a path most VPN clients
 * and even some proxy setups never intercept, so it can surface the LAN IP
 * and/or the public IP the VPN was supposed to be hiding.
 */
export const webrtcProbe: Probe = {
  id: 'webrtc',
  title: 'WebRTC leak',
  tier: 2,
  async run(ctx) {
    if (!ctx.consented) {
      return [sig('webrtc.blocked', 'WebRTC probe', true, { error: 'no consent' })];
    }

    const out: Signal[] = [];
    const RTCPC = (globalThis as typeof globalThis & {
      RTCPeerConnection?: typeof RTCPeerConnection;
    }).RTCPeerConnection;

    if (!RTCPC) {
      out.push(sig('webrtc.blocked', 'WebRTC available', true, { error: 'RTCPeerConnection unavailable' }));
      out.push(sig('webrtc.localIPs', 'Local IPs leaked', [], { entropy: 6 }));
      out.push(sig('webrtc.publicIP', 'Public IP leaked', null, { entropy: 8 }));
      out.push(sig('webrtc.mdnsProtected', 'mDNS local-IP protection', false));
      out.push(sig('webrtc.candidateTypes', 'ICE candidate types seen', []));
      out.push(sig('webrtc.sdpHash', 'SDP codec fingerprint', null));
      out.push(sig('webrtc.leaks', 'Any real IP leaked', false));
      return out;
    }

    let pc: RTCPeerConnection | null = null;

    try {
      pc = new RTCPC({ iceServers: [{ urls: STUN_SERVERS }] });

      // A data channel isn't used for anything, it just gives ICE something
      // to gather candidates for, without it Chrome may skip gathering
      // entirely for an otherwise empty offer.
      pc.createDataChannel('probe');

      const candidateStrings: string[] = [];
      const gatherDone = new Promise<void>((resolve) => {
        const finish = () => resolve();
        const onAbort = () => finish();
        ctx.signal.addEventListener('abort', onAbort, { once: true });
        const timeoutId = setTimeout(finish, GATHER_TIMEOUT_MS);

        pc!.onicecandidate = (ev) => {
          if (!ev.candidate) {
            clearTimeout(timeoutId);
            ctx.signal.removeEventListener('abort', onAbort);
            finish();
            return;
          }
          candidateStrings.push(ev.candidate.candidate);
        };
        pc!.onicegatheringstatechange = () => {
          if (pc!.iceGatheringState === 'complete') {
            clearTimeout(timeoutId);
            ctx.signal.removeEventListener('abort', onAbort);
            finish();
          }
        };
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await gatherDone;

      const sdp = pc.localDescription?.sdp ?? '';

      // Merge candidates collected via the event with anything visible in the
      // final SDP (belt and braces, some browsers only surface everything
      // in localDescription once gathering is "complete").
      const sdpCandidateLines = sdp.split('\n').filter((l) => l.startsWith('a=candidate'));
      const allCandidateStrings = [...new Set([...candidateStrings, ...sdpCandidateLines])];

      const parsed = allCandidateStrings.map(parseCandidate);

      const localIPs = [...new Set(
        parsed.filter((p) => p.ip && !p.mdns && isPrivateOrLinkLocal(p.ip)).map((p) => p.ip as string),
      )];
      const publicIPs = [...new Set(
        parsed.filter((p) => p.ip && !p.mdns && !isPrivateOrLinkLocal(p.ip)).map((p) => p.ip as string),
      )];
      const mdnsProtected = parsed.some((p) => p.mdns);
      const candidateTypes = [...new Set(parsed.map((p) => p.type).filter((t): t is string => t !== null))];

      const publicIP = publicIPs[0] ?? null;

      out.push(sig('webrtc.localIPs', 'Local IPs leaked', localIPs, {
        display: localIPs.length ? localIPs.join(', ') : 'none (mDNS-protected or none found)',
        entropy: 6,
      }));
      out.push(sig('webrtc.publicIP', 'Public IP leaked', publicIP, {
        display: publicIP ?? 'not leaked',
        entropy: 8,
      }));
      out.push(sig('webrtc.mdnsProtected', 'mDNS local-IP protection', mdnsProtected));
      out.push(sig('webrtc.candidateTypes', 'ICE candidate types seen', candidateTypes, {
        display: candidateTypes.join(', ') || 'none',
      }));

      // Codec/extension fingerprint: independent of IP, derived purely from
      // what the offer negotiates (extmap ids, rtpmap/fmtp codec lines).
      const fingerprintLines = sdp
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.startsWith('a=extmap:') || l.startsWith('a=rtpmap:') || l.startsWith('a=fmtp:'))
        .sort();
      const sdpHash = fingerprintLines.length ? hash(fingerprintLines.join('\n')) : null;
      out.push(sig('webrtc.sdpHash', 'SDP codec fingerprint', sdpHash, { entropy: 4 }));

      out.push(sig('webrtc.blocked', 'WebRTC available', allCandidateStrings.length === 0));
      out.push(sig('webrtc.leaks', 'Any real IP leaked', localIPs.length > 0 || publicIPs.length > 0));
    } catch (e) {
      out.push(sig('webrtc.blocked', 'WebRTC available', true, { error: String(e) }));
      out.push(sig('webrtc.localIPs', 'Local IPs leaked', [], { entropy: 6 }));
      out.push(sig('webrtc.publicIP', 'Public IP leaked', null, { entropy: 8 }));
      out.push(sig('webrtc.mdnsProtected', 'mDNS local-IP protection', false));
      out.push(sig('webrtc.candidateTypes', 'ICE candidate types seen', []));
      out.push(sig('webrtc.sdpHash', 'SDP codec fingerprint', null));
      out.push(sig('webrtc.leaks', 'Any real IP leaked', false));
    } finally {
      pc?.close();
    }

    return out;
  },
};
