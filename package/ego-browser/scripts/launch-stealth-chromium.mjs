#!/usr/bin/env node
/**
 * launch-stealth-chromium.mjs
 *
 * Spawns a real Chromium/Chrome with the same anti-detection launch profile
 * that ego-browser's `stealth.enable()` mirrors at the CDP layer. ego-browser
 * is a CDP *client* — it attaches to an already-running browser. The biggest
 * single automation tell (navigator.webdriver + the AutomationControlled blink
 * feature) is best killed at launch time with flags, which is what this does.
 *
 * After launch, point ego-browser at the same browser (or reuse its CDP
 * endpoint) and call `stealth.enable()` from your script to finish the
 * fingerprint persona (User-Agent parity, timezone, canvas/webgl/audio spoof).
 *
 * Usage:
 *   node scripts/launch-stealth-chromium.mjs \
 *     --persona win11-chrome126 \
 *     --proxy http://user:pass@host:port \
 *     --port 9222 \
 *     --user-data-dir ./stealth-profile \
 *     --url https://example.com
 *
 * Env overrides: EGO_STEALTH_PERSONA, EGO_STEALTH_PROXY, EGO_STEALTH_PORT,
 *                EGO_STEALTH_CHROME (explicit binary path).
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Compact mirror of src/stealth/personas.ts — only the launch-relevant fields.
const PERSONAS = {
  "win11-chrome126": {
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    lang: "en-US",
    window: "1920,1080",
  },
  "win10-chrome125": {
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    lang: "en-US",
    window: "1536,864",
  },
  "mac-sonoma-chrome124": {
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    lang: "en-US",
    window: "1440,900",
  },
  "mac-ventura-chrome123": {
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    lang: "en-US",
    window: "1280,800",
  },
  "linux-ubuntu-chrome122": {
    ua: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    lang: "en-US",
    window: "1536,864",
  },
  "win11-chrome120": {
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    lang: "en-GB",
    window: "2560,1440",
  },
};

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq !== -1) {
      out[a.slice(2, eq)] = a.slice(eq + 1);
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
      out[a.slice(2)] = argv[++i];
    } else {
      out[a.slice(2)] = true;
    }
  }
  return out;
}

function findChrome() {
  if (
    process.env.EGO_STEALTH_CHROME &&
    existsSync(process.env.EGO_STEALTH_CHROME)
  ) {
    return process.env.EGO_STEALTH_CHROME;
  }
  const candidates = [
    process.env.EGO_STEALTH_CHROME,
    process.env.CHROME_BIN,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ].filter(Boolean);
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return "chromium";
}

const args = parseArgs(process.argv.slice(2));
const personaId =
  args.persona || process.env.EGO_STEALTH_PERSONA || "win11-chrome126";
const persona = PERSONAS[personaId] || PERSONAS["win11-chrome126"];
const port = args.port || process.env.EGO_STEALTH_PORT || "9222";
const proxy = args.proxy || process.env.EGO_STEALTH_PROXY || null;
const userDataDir =
  args["user-data-dir"] || resolve(process.cwd(), "stealth-profile");
const url = args.url || "about:blank";

const chrome = findChrome();
const launchArgs = [
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${userDataDir}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-blink-features=AutomationControlled",
  "--disable-infobars",
  "--disable-dev-shm-usage",
  "--disable-features=Translate,BackForwardCache,OptimizationHints",
  "--disable-background-networking",
  `--window-size=${persona.window}`,
  `--user-agent=${persona.ua}`,
  `--lang=${persona.lang}`,
  "--password-store=basic",
  "--use-gl=swiftshader",
  url,
];

if (proxy) {
  launchArgs.push(`--proxy-server=${proxy}`);
  // Treat proxy as a "system" proxy so Chrome routes all traffic through it
  // and does not leak the local IP via WebRTC/direct connections.
  launchArgs.push("--proxy-bypass-list=<-loopback>");
}

console.error(`[stealth] persona   : ${personaId}`);
console.error(`[stealth] chrome    : ${chrome}`);
console.error(`[stealth] debug port: ${port}`);
console.error(
  `[stealth] proxy     : ${proxy ? proxy.replace(/\/\/.*@/, "//***@") : "none"}`,
);
console.error(`[stealth] profile   : ${userDataDir}`);
console.error(
  `[stealth] attach with: EGO_BROWSER_CDP=http://127.0.0.1:${port}  (or point ego-browser at this browser)`,
);
console.error(`[stealth] DevTools  : http://127.0.0.1:${port}/json/version`);

const child = spawn(chrome, launchArgs, { stdio: "inherit", env: process.env });
child.on("exit", (code) => process.exit(code ?? 0));
