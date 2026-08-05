# Signal ID contract

Every probe emits `Signal` objects (see `src/types.ts`). Inference modules read them
by **exact id**. Both sides are written independently, so this file is the contract.
If a probe cannot measure something it simply omits the signal (or emits it with
`error` set) — inference must tolerate every id being absent.

## Already implemented (`src/probes/core.ts`)

| id | meaning |
|---|---|
| `platform.ua` | User-Agent string |
| `platform.platform` | `navigator.platform` |
| `platform.languages` | `navigator.languages` array |
| `platform.arch` / `platform.bitness` | UA-CH architecture / bitness |
| `platform.model` | UA-CH device model (Android) |
| `platform.osVersion` | UA-CH platform version |
| `platform.browserVersions` | UA-CH full version list |
| `platform.uadPlatform` | UA-CH platform name |
| `platform.mobile` | UA-CH mobile boolean |
| `platform.webdriver` | `navigator.webdriver` |
| `platform.dnt` / `platform.gpc` | Do Not Track / Global Privacy Control |
| `platform.pdfViewer` | `navigator.pdfViewerEnabled` |
| `display.resolution` | `[width, height]` |
| `display.available` | `[availWidth, availHeight]` |
| `display.pixelRatio` | `devicePixelRatio` |
| `display.colorDepth`, `display.viewport`, `display.orientation` | |
| `display.chromeHeight` / `display.chromeWidth` | screen minus avail — OS chrome size |
| `display.refreshHz` | measured refresh rate |
| `hw.cores` | `hardwareConcurrency` |
| `hw.memory` | `deviceMemory` (GB, bucketed) |
| `hw.touchPoints`, `hw.pointerCoarse`, `hw.hover` | |
| `hw.netType`, `hw.downlink`, `hw.rtt`, `hw.saveData` | Network Information API |
| `hw.cameras`, `hw.microphones`, `hw.speakers` | device counts (no permission) |
| `hw.deviceLabels` | whether labels were readable |
| `hw.batteryLevel`, `hw.charging` | Chrome only |
| `env.timezone`, `env.tzOffset`, `env.locale` | |
| `env.calendar`, `env.numbering`, `env.currency`, `env.localTime` | |
| `env.colorScheme`, `env.reducedMotion`, `env.reducedTransparency` | |
| `env.contrast`, `env.forcedColors`, `env.invertedColors` | |
| `env.monochrome`, `env.dynamicRange`, `env.colorGamut` | |
| `codecs.support` | map of codec → canPlayType result |
| `codecs.widevine`, `codecs.hash` | |
| `voices.count`, `voices.langs`, `voices.hash`, `voices.local` | speech synthesis voices |

## To be implemented

### `src/probes/render.ts`
| id | meaning |
|---|---|
| `gpu.vendor` | WebGL `UNMASKED_VENDOR_WEBGL` |
| `gpu.renderer` | WebGL `UNMASKED_RENDERER_WEBGL` — the raw string |
| `gpu.workerRenderer` | same value read inside a Worker (spoof cross-check) |
| `gpu.rendererMismatch` | boolean: main thread and worker disagree |
| `gpu.webgpuVendor`, `gpu.webgpuArch`, `gpu.webgpuDesc` | `GPUAdapterInfo` fields |
| `gpu.params` | selected WebGL parameter map (max texture size etc.) |
| `gpu.extensions` | supported WebGL extension list |
| `canvas.hash` | 2D canvas render hash |
| `canvas.emojiHash` | emoji-only render hash (OS version signal) |
| `canvas.textMetrics` | `TextMetrics` for a reference string |
| `audio.hash` | OfflineAudioContext oscillator+compressor hash |
| `audio.sampleRate` | |
| `domrect.hash` | `getBoundingClientRect` geometry hash |

### `src/probes/fonts.ts`
| id | meaning |
|---|---|
| `fonts.list` | array of detected font names |
| `fonts.count` | how many detected |
| `fonts.hash` | stable hash of the list |
| `fonts.impliedOS` | `'windows' \| 'macos' \| 'linux' \| 'android' \| 'unknown'` |
| `fonts.impliedOSVersion` | e.g. `'Windows 11'` when a version-specific font is present |
| `fonts.software` | array of `{ name, fonts, confidence }` inferred installed software |

### `src/probes/lies.ts`
| id | meaning |
|---|---|
| `lies.records` | array of `{ api, reason }` tamper findings |
| `lies.count` | total |
| `lies.tamperedApis` | array of API names that failed native checks |
| `lies.clientLitter` | window globals present that a clean nested iframe lacks |
| `lies.timerCoarsened` | timer precision is rounded (Firefox RFP / Tor) |
| `lies.brave` | Brave detected |
| `lies.braveMode` | `'standard' \| 'aggressive'` if determinable |
| `lies.pluginInconsistency` | plugins/mimeTypes cross-check failed |
| `lies.uaPlatformMismatch` | UA-claimed platform disagrees with feature-implied platform |
| `lies.featurePlatform` | platform implied by the JS feature matrix |
| `lies.jsEngine` | `'v8' \| 'spidermonkey' \| 'javascriptcore'` from error-message text |

### `src/probes/localnet.ts` — TIER 2
| id | meaning |
|---|---|
| `localnet.openPorts` | array of `{ port, service, ms }` that responded as reachable |
| `localnet.scanned` | how many ports were probed |
| `localnet.method` | which timing method was used |
| `localnet.blocked` | true if the browser appears to gate the probe entirely |

### `src/probes/apps.ts` — TIER 2
| id | meaning |
|---|---|
| `apps.installed` | array of app names detected via protocol handlers |
| `apps.probed` | array of schemes attempted |
| `apps.reliable` | boolean — false where the browser throttles probing |

### `src/probes/extensions.ts` — TIER 2
| id | meaning |
|---|---|
| `ext.detected` | array of `{ name, id }` |
| `ext.adblock` | ad blocker present |
| `ext.adblockName` | which one, when determinable |

### `src/probes/incognito.ts`
| id | meaning |
|---|---|
| `incognito.private` | boolean |
| `incognito.method` | which heuristic decided it |
| `incognito.quota` | `navigator.storage.estimate()` quota |

### `src/probes/automation.ts`
| id | meaning |
|---|---|
| `bot.headless` | boolean |
| `bot.score` | 0..1 |
| `bot.reasons` | array of strings |
| `bot.vm` | virtual machine detected (from GPU renderer) |

### `src/probes/behavior.ts` — streams over time
| id | meaning |
|---|---|
| `behavior.pointer` | `'mouse' \| 'trackpad' \| 'touch' \| 'none'` |
| `behavior.dwellMs` | time on page so far |
| `behavior.scrollDepth` | 0..1 |
| `behavior.moveEntropy` | jitter measure of pointer path |
| `behavior.idle` | whether the user has been idle |

### Edge-injected (`edge.*`, set by `src/main.ts` from `/api/context`)
`edge.ip`, `edge.city`, `edge.region`, `edge.country`, `edge.postalCode`,
`edge.latitude`, `edge.longitude`, `edge.timezone`, `edge.asn`, `edge.asOrg`,
`edge.colo`, `edge.tlsVersion`, `edge.tlsCipher`, `edge.tlsHelloLength`,
`edge.httpProtocol`, `edge.acceptLanguage`, `edge.headerOrder`, `edge.clientHints`,
`edge.tcpRtt`

## Claim conventions

- Second person, present tense, plain English. No jargon in `text`.
- Wrap the single most surprising noun phrase in `*asterisks*` for highlight.
- `act` picks the section (see `src/ui/dossier.ts` `ACTS`).
- `weight` 0–10; higher lands later within the act and gets a longer beat.
- `how` explains the technique in one or two sentences, for the drawer.
- Never assert a `certain` claim from a `guess`-grade signal.
