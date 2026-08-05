import type { Probe, Signal } from '../types';

const sig = (id: string, label: string, value: unknown, extra: Partial<Signal> = {}): Signal => ({
  id, label, value, ...extra,
});

/**
 * Permission-state probing. navigator.permissions.query() returns
 * 'granted' | 'denied' | 'prompt' WITHOUT ever showing a prompt, so a site can
 * silently learn that you've already granted camera, mic, or location access
 * (to this origin) before you touch anything. Most people assume a site can't
 * know that until it asks. It can.
 */
const PERMISSIONS = [
  'geolocation', 'notifications', 'camera', 'microphone', 'clipboard-read',
  'clipboard-write', 'local-fonts', 'window-management', 'storage-access',
  'persistent-storage', 'push', 'midi', 'accelerometer', 'gyroscope',
  'magnetometer', 'ambient-light-sensor', 'payment-handler', 'display-capture',
  'screen-wake-lock', 'bluetooth', 'speaker-selection', 'background-sync',
];

/**
 * Capability matrix: the mere PRESENCE of these powerful APIs fingerprints the
 * browser/platform, and, via each API's get*(), lets a site re-list devices
 * you've ALREADY paired to it, silently, with no fresh prompt.
 */
const CAPABILITIES: Array<{ id: string; label: string; test: () => boolean }> = [
  { id: 'hid', label: 'WebHID', test: () => 'hid' in navigator },
  { id: 'usb', label: 'WebUSB', test: () => 'usb' in navigator },
  { id: 'serial', label: 'Web Serial', test: () => 'serial' in navigator },
  { id: 'bluetooth', label: 'Web Bluetooth', test: () => 'bluetooth' in navigator },
  { id: 'midi', label: 'WebMIDI', test: () => 'requestMIDIAccess' in navigator },
  { id: 'gpu', label: 'WebGPU', test: () => 'gpu' in navigator },
  { id: 'idle', label: 'Idle Detection', test: () => 'IdleDetector' in window },
  { id: 'pressure', label: 'Compute Pressure', test: () => 'PressureObserver' in window },
  { id: 'battery', label: 'Battery Status', test: () => 'getBattery' in navigator },
  { id: 'wakeLock', label: 'Screen Wake Lock', test: () => 'wakeLock' in navigator },
  { id: 'eyeDropper', label: 'EyeDropper', test: () => 'EyeDropper' in window },
  { id: 'barcode', label: 'Barcode Detector', test: () => 'BarcodeDetector' in window },
  { id: 'contacts', label: 'Contacts Picker', test: () => 'contacts' in navigator },
  { id: 'ndef', label: 'Web NFC', test: () => 'NDEFReader' in window },
  { id: 'relatedApps', label: 'getInstalledRelatedApps', test: () => 'getInstalledRelatedApps' in navigator },
];

export const permissionProbe: Probe = {
  id: 'perm',
  title: 'Permissions & capabilities',
  tier: 2,
  async run(ctx) {
    if (!ctx.consented) return [sig('perm.blocked', 'Permission probe', true, { error: 'no consent' })];
    const out: Signal[] = [];
    const perms = navigator.permissions;

    // Query every permission silently. Majority of a couple reads to smooth
    // transient states; any prompt never actually appears.
    if (perms?.query) {
      const states: Record<string, string> = {};
      await Promise.all(PERMISSIONS.map(async (name) => {
        try {
          const status = await perms.query({ name: name as PermissionName });
          states[name] = status.state;
        } catch { /* unsupported name on this browser, skip silently */ }
      }));
      const granted = Object.entries(states).filter(([, s]) => s === 'granted').map(([n]) => n);
      const denied = Object.entries(states).filter(([, s]) => s === 'denied').map(([n]) => n);
      out.push(sig('perm.states', 'Permission states', states, {
        display: Object.entries(states).map(([n, s]) => `${n}:${s}`).join(', '), entropy: 3,
      }));
      out.push(sig('perm.granted', 'Already granted to this site', granted, {
        display: granted.join(', ') || 'none', entropy: granted.length ? 2 : 0,
      }));
      out.push(sig('perm.denied', 'Explicitly blocked', denied, { display: denied.join(', ') || 'none' }));
    }

    // Capability matrix.
    const caps: Record<string, boolean> = {};
    for (const c of CAPABILITIES) {
      try { caps[c.id] = c.test(); } catch { caps[c.id] = false; }
    }
    out.push(sig('perm.capabilities', 'Powerful APIs available', caps, {
      display: Object.entries(caps).filter(([, v]) => v).map(([k]) => k).join(', '), entropy: 2,
    }));

    // Silent re-enumeration of devices already paired to THIS origin, no prompt.
    const pairedDevices: string[] = [];
    try {
      const hid = (navigator as Navigator & { hid?: { getDevices(): Promise<Array<{ productName?: string }>> } }).hid;
      if (hid?.getDevices) {
        const devs = await hid.getDevices();
        for (const d of devs) if (d.productName) pairedDevices.push(`HID: ${d.productName}`);
      }
    } catch { /* ignore */ }
    try {
      const usb = (navigator as Navigator & { usb?: { getDevices(): Promise<Array<{ productName?: string; manufacturerName?: string }>> } }).usb;
      if (usb?.getDevices) {
        const devs = await usb.getDevices();
        for (const d of devs) pairedDevices.push(`USB: ${d.productName || d.manufacturerName || 'unknown device'}`);
      }
    } catch { /* ignore */ }
    try {
      const serial = (navigator as Navigator & { serial?: { getPorts(): Promise<unknown[]> } }).serial;
      if (serial?.getPorts) {
        const ports = await serial.getPorts();
        if (ports.length) pairedDevices.push(`Serial: ${ports.length} port(s)`);
      }
    } catch { /* ignore */ }
    out.push(sig('perm.pairedDevices', 'Devices already paired to this site', pairedDevices, {
      display: pairedDevices.join(', ') || 'none', entropy: pairedDevices.length ? 4 : 0,
    }));

    return out;
  },
};
