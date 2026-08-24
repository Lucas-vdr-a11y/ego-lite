# Stealth / Anti-Detection (ego-browser fork)

ego-browser is a **CDP client**: it attaches to an already-running Chromium and
drives it. That means anti-detection is delivered in two complementary layers:

1. **Launch profile** — kill the biggest tell (`navigator.webdriver` +
   `AutomationControlled`) with browser flags *before* any page loads.
2. **Runtime persona** — apply a consistent fingerprint (User-Agent + Client
   Hints, timezone, locale, canvas/webgl/audio spoof, plugins, screen) through
   `Page.addScriptToEvaluateOnNewDocument`, which runs before site scripts.

Both layers are wired together in this fork, porting the strategy used by
[vibheksoni/stealth-browser-mcp](https://github.com/vibheksoni/stealth-browser-mcp)
(nodriver + CDP) into ego-browser's TypeScript CDP harness.

## Quick start

```js
// inside an ego-browser script (page/locator/etc. are pre-imported)
await stealth.enable({ persona: "win11-chrome126" });
await page.goto("https://example.com");
// ... normal automation; the page sees a consistent Windows/Chrome fingerprint
```

Disable when done:

```js
await stealth.disable();
```

The CLI also supports `ego-browser --stealth` before a heredoc, which enables a
random (or `EGO_STEALTH_PERSONA`-selected) persona before the script runs.

## API

`stealth` is exposed on the agent context (same surface as `page`, `browser`,
`fetch`, `cdp`).

| Call | Effect |
| ------ | -------- |
| `stealth.enable({ persona?, random?, currentTabOnly? })` | Apply a persona + inject the spoof payload into the current target and all future page targets. Returns the active persona. |
| `stealth.disable()` | Remove the injected payload and restore the default User-Agent / timezone. |
| `stealth.applyToAllTabs()` | Re-inject the active persona into every already-open `http(s)` page target. |
| `stealth.persona()` | Returns the currently active persona object (or `null`). |
| `stealth.personas()` | Lists available persona `{ id, label }` summaries. |
| `stealth.rotate()` | Tear down the active persona and enable a fresh random one — use when a challenge beat your previous fingerprint. |

`persona` accepts an id (`"win11-chrome126"`), a substring match
(`"mac"`, `"ubuntu"`), or a numeric index. Omit it (or pass `random: true`)
to pick one at random. The env var `EGO_STEALTH_PERSONA` selects a default.

## Personas

Each persona is **internally consistent** — the User-Agent, `sec-ch-ua` Client
Hints brands, `platform`, IANA `timezone`, `accept-language`, screen geometry,
WebGL vendor/renderer, and font list all describe the same real machine. A
mismatched tuple (e.g. a macOS UA with a Windows timezone) is itself a
fingerprint that screams automation.

| id | machine |
| ---- | --------- |
| `win11-chrome126` | Windows 11, Chrome 126, NVIDIA RTX 3060 |
| `win10-chrome125` | Windows 10, Chrome 125, Intel UHD 630 |
| `linux-ubuntu-chrome122` | Ubuntu 22.04, Chrome 122, NVIDIA GTX 1650 |
| `mac-sonoma-chrome124` | macOS Sonoma, Chrome 124, Apple M2 |
| `mac-ventura-chrome123` | macOS Ventura, Chrome 123, Intel Iris |
| `win11-chrome120` | Windows 11, Chrome 120, AMD RX 6600 |

## What the injected payload spoofs

Registered with `Page.addScriptToEvaluateOnNewDocument`, so it runs in the page
main world **before** reCAPTCHA / hCaptcha / Cloudflare / DataDome bootstrap
scripts:

- `navigator.webdriver` → `false` (the single biggest CDP tell)
- `navigator.platform` / `userAgent` / `appVersion` / `vendor`
- `navigator.languages` / `language`
- `navigator.userAgentData` (Client Hints parity with `getHighEntropyValues`)
- `navigator.hardwareConcurrency` / `deviceMemory`
- `navigator.connection` → stable, plausible 4g/wifi (no `saveData`)
- `navigator.permissions.query` → never throws / never rejects
- `navigator.plugins` / `mimeTypes` → non-empty, consistent, **iterable** fake set
- `navigator.maxTouchPoints` / `doNotTrack` / `onLine` → desktop-Chrome values
- `screen.orientation` / `storage.estimate` / `mediaDevices.enumerateDevices` → aligned to the persona (these are themselves fingerprint surface)
- `window.chrome` → full `runtime` / `app` / `loadTimes` / `csi` object
- `screen.*` / `devicePixelRatio` / `outerWidth` / `outerHeight`
- **Canvas 2D** → deterministic LSB noise on `getImageData` / `toDataURL` / `toBlob`
- **WebGL** → spoofed `VENDOR`/`RENDERER` + `WEBGL_debug_renderer_info` unmasked strings
- **Audio** → sub-threshold white noise in `AudioBuffer.getChannelData`

## Humanized pointer movement

The pointer driver (`src/driver/pointer.ts`) now moves the mouse along a cubic
bezier with randomized control points and per-step jitter instead of a single
straight `mouseMoved`. Bot defenses that model pointer trajectories key off the
perfectly linear path a raw CDP move produces. Set `EGO_BROWSER_NO_HUMANIZE=1`
to fall back to the old straight-line dispatch.

## Launch flags (the other half)

ego-browser attaches to a browser you launch. Use the helper to spawn one with
the matching launch profile:

```bash
node scripts/launch-stealth-chromium.mjs \
  --persona win11-chrome126 \
  --proxy http://user:pass@host:port \
  --port 9222 \
  --user-data-dir ./stealth-profile
```

Key flags it sets:

- `--disable-blink-features=AutomationControlled` — suppresses `webdriver` and
  several automation artifacts at the source.
- `--user-agent=...` / `--lang=...` / `--window-size=...` — match the persona.
- `--no-first-run --no-default-browser-check --disable-infobars` — remove
  "controlled by automation" and first-run noise.
- `--proxy-server=...` + `--proxy-bypass-list=<-loopback>` — route all traffic
  (including WebRTC) through the proxy so the local IP never leaks.
- `--webrtc-ip-handling-policy=disable_non_proxied_udp` (+ `--force-...`) —
  no ICE candidate can use a non-proxied path; `RTCPeerConnection` stays native.
- `--host-resolver-rules=MAP * ~NOTFOUND,EXCLUDE localhost` — force DNS through
  the proxy so the real resolver/IP never leaks via system DNS.

## Proxy + geo consistency

A residential/ISP proxy is the highest-leverage upgrade: a clean IP with a low
fraud score passes far more challenges than any fingerprint tweak on a
datacenter IP. Match the persona `timezone` to the proxy geo (the personas
already encode a sensible default per region). Results vary by site, region,
browser version, and detector version — this is a toolkit, not a guarantee.
