# Captcha solving (free, no API keys)

This fork adds a **captcha-solving module** to ego-browser that ports strategies
from two open, free, no-API-key projects:

- **[B00H0O/cloudflare-solver](https://github.com/B00H0O/cloudflare-solver)** —
  raw-CDP Cloudflare Turnstile + IUAM solving (`zero dependencies`).
- **[AmitHaina/Recaptcha-Solver-V3](https://github.com/AmitHaina/Recaptcha-Solver-V3)** —
  Playwright reCAPTCHA v3 token harvester with fingerprint rotation and
  humanized behavior.

The other repos in that topic (DeathByCaptcha / xsolve clients) are paid
API-key services, so they are deliberately **not** implemented here.

Everything runs in-process against the browser ego-browser already controls —
no external solver service, no paid API. It pairs with the `stealth` module in
this fork (personas + injected fingerprint + humanized pointer) to maximize the
"real user" signal before a token is even requested.

## API

`captcha` is exposed on the agent context (same surface as `stealth`, `page`,
`browser`, `cdp`).

| Call | Effect |
| ------ | -------- |
| `captcha.detect()` | Probe the current page and return the challenge kind (`cloudflare-turnstile`, `cloudflare-iuam`, `recaptcha-v3`, `recaptcha-enterprise`, or `unknown`). |
| `captcha.solve({ kind?, sitekey?, url?, action?,`…`})` | Auto-detect and solve whichever challenge is present. |
| `captcha.cloudflare({ sitekey?, autoClick?, timeoutMs? })` | Solve a Cloudflare Turnstile widget on the current page; returns `{ token?, tokens[] }`. |
| `captcha.recaptcha({ sitekey, action, enterprise?, url?, warmup?, humanize? })` | Harvest a reCAPTCHA v3 / Enterprise token. |
| `captcha.clearance()` | Read the `cf_clearance` pass-cookie (httpOnly — via CDP, not `document.cookie`). |
| `captcha.clickTurnstile()` | Click the Turnstile checkbox (humanized entry). |
| `captcha.warmup()` | Visit a short, plausible browsing history before the target. |
| `captcha.scroll(direction)` / `captcha.safeClick()` | Humanized scroll / safe transient-activation click. |
| `captcha.read()` | Dwell + scroll "read" the page before acting — a solve is never instant. |
| `captcha.type(text, { field })` | Humanized per-keystroke typing (variable latency, pauses). |

## Cloudflare Turnstile (from cloudflare-solver)

```js
await stealth.enable({ persona: "win11-chrome126" });
await page.goto("https://site-with-turnstile.example");
const { token, tokens } = await captcha.cloudflare({ autoClick: true });
console.log(token);            // the ts-response token
const clearance = await captcha.clearance();   // cf_clearance if present
```

Strategy:

- **Locate the widget** by `input[name="cf-turnstile-response"]` (primary), or a
  ~290–310px widget `div`, or the `iframe[src*="challenges.cloudflare.com"]`,
  and compute its centre via `getBoundingClientRect` (ported from
  `find_turnstile_click_targets`).
- **Auto-click** the checkbox (Turnstile needs a real gesture) with a humanized
  entry sweep, retrying on an interval up to `maxAttempts`.
- **Poll** `input[name="ts-response"]` values and `window.__tsTokenPromise`
  until they carry a token (ported from `solve_turnstile`'s wait promise).
- For IUAM / managed challenges, also read the **`cf_clearance`** cookie via CDP.

## reCAPTCHA v3 (from Recaptcha-Solver-V3)

```js
await stealth.enable();                       // random persona (fingerprint rotation)
const token = await captcha.recaptcha({
  url: "https://site.example/login",
  sitekey: "6Lc...",
  action: "submit",
  warmup: true,
  humanize: true,
});
```

Strategy:

- **Fingerprint rotation** — reuse this fork's persona pool (correlated UA,
  Client Hints, timezone, locale, GPU, screen). The base `stealth` payload
  already covers canvas/WebGL/audio noise, `window.chrome`, plugins, etc.
- **Warmup history** — a short visit to everyday sites (google/youtube) builds
  a plausible history before the target (`_warmup` port).
- **Humanized behavior** — bezier cursor entry sweep, decelerating scroll with
  overshoot correction, and a **safe real click** (avoiding links/buttons/form
  controls) to create genuine transient activation right before execute
  (`_humanize`, `_safe_click`, `_natural_scroll` ports).
- **Execute** — inject `api.js`/`enterprise.js` if `grecaptcha` is missing, then
  `grecaptcha.execute(sitekey, { action })`.
- **Passive fallback** — subscribe to `Network.responseReceived`, and when a
  `*/recaptcha/(api2|enterprise)/reload` response arrives, read its body via
  `Network.getResponseBody` and scrape the `"rresp","<token>"` value (`_capture`).

## Auto-solve

`captcha.solve()` detects the challenge and routes it:

```js
const result = await captcha.solve({ url: "https://example.com" });
// { kind, token?, tokens?, clearance? }
```

## Notes

- Results vary by site, region, browser version, and detector version. The
  strategy is *maximise the real-user signal*: pair with `stealth.enable()` and
  a clean residential/ISP proxy (timezone/profile aligned to the proxy geo) for
  the best pass rate.
- **Read before you solve.** `captcha.recaptcha()` already dwells 2–6s on the
  page; for manual targets call `captcha.read()` first. A solve fired the
  instant a page loads is a bot cadence.
- **Rotate, don't retry.** When a challenge beats you, call `stealth.rotate()`
  to drop the flagged fingerprint and pick a fresh proxy+persona tuple —
  retrying the same identity against the same detector just loses twice.
- These solve human-verifiable widgets by *driving the real widget in a real
  browser*, not by outsourcing to a paid captcha farm.
