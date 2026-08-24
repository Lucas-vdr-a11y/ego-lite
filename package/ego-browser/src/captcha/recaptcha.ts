import { cdp, evaluate } from "../cdp-eval.js";
import { browserCdp, subscribeBrowserEvent } from "../browser-runtime.js";
import { goto } from "../driver/nav.js";
import { extractReloadToken, isReloadUrl } from "./parse.js";
import {
  cursorEntry,
  humanizePage,
  naturalScroll,
  preRead,
  safeClick,
} from "./humanize.js";

export type RecaptchaOptions = {
  sitekey: string;
  action?: string;
  enterprise?: boolean;
  url?: string;
  warmup?: boolean;
  humanize?: boolean;
  capturePassive?: boolean;
  timeoutMs?: number;
};

export type WarmupOptions = {
  sequences?: Array<[string, string[]]>;
  enabled?: boolean;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}

// Ported from AmitHaina/Recaptcha-Solver-V3: a short, plausible browsing
// history before the protected target builds trust for reCAPTCHA v3's
// behavioral scoring. Each entry is (domain, [paths]).
export const WARMUP_SEQUENCES: Array<[string, string[]]> = [
  ["google.com", ["", "search?q=weather"]],
  ["youtube.com", [""]],
  ["google.com", ["", "search?q=news"]],
  ["google.com", ["", "search?q=translate"]],
];

/**
 * Visit a short sequence of everyday sites in the current tab before the
 * target. Heavy resources (images/media/fonts) are skipped so warmup settles
 * fast; the target navigation is never routed so its fingerprint is untouched.
 */
export async function warmup(opts: WarmupOptions = {}): Promise<void> {
  if (opts.enabled === false) return;
  const seq = opts.sequences
    ? opts.sequences
    : [WARMUP_SEQUENCES[Math.floor(Math.random() * WARMUP_SEQUENCES.length)]];
  try {
    // Cheap resource tilt via request interception is not available here, so
    // keep warmup to a couple of quick, mostly-text navigations.
    for (const [domain, paths] of seq) {
      for (const path of paths) {
        try {
          await goto(`https://www.${domain}/${path}`, {
            waitUntil: "commit",
            timeout: 15000,
          });
          await sleep(randInt(1200, 2500));
          await naturalScroll(1, { min: 150, max: 350 });
        } catch {
          // keep going
        }
      }
    }
  } catch {
    // best-effort
  }
}

function apiOf(enterprise: boolean): string {
  return enterprise ? "grecaptcha.enterprise" : "grecaptcha";
}

function recaptchaSrc(enterprise: boolean, sitekey: string): string {
  return enterprise
    ? `https://www.google.com/recaptcha/enterprise.js?render=${sitekey}`
    : `https://www.google.com/recaptcha/api.js?render=${sitekey}`;
}

/** Inject the reCAPTCHA script if `grecaptcha` is not already present. */
export async function injectGrecaptcha(
  sitekey: string,
  enterprise = false,
): Promise<void> {
  const api = apiOf(enterprise);
  const src = recaptchaSrc(enterprise, sitekey);
  await evaluate(`new Promise((resolve, reject) => {
    const get = () => ${api}.split('.').reduce((o, k) => (o == null ? o : o[k]), window);
    if (get()) return resolve();
    const s = document.createElement('script');
    s.src = ${JSON.stringify(src)};
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('inject failed: ' + ${JSON.stringify(src)}));
    document.head.appendChild(s);
  })`);
}

/** Execute reCAPTCHA v3 and await the token. */
export async function executeGrecaptcha(
  sitekey: string,
  action: string,
  enterprise = false,
  timeoutMs = 20000,
): Promise<string> {
  const api = apiOf(enterprise);
  const script = `new Promise((resolve, reject) => {
    const g = ${`window.${api}`};
    if (!g) { reject(new Error('grecaptcha not loaded')); return; }
    g.ready(() => {
      g.execute(${JSON.stringify(sitekey)}, { action: ${JSON.stringify(action)} })
        .then(resolve).catch(reject);
    });
  })`;
  // The SDK cdp wrapper has a per-command timeout; wrap our own as well.
  const result = await Promise.race([
    evaluate(script),
    sleep(timeoutMs).then(() => {
      throw new Error("grecaptcha.execute timed out");
    }),
  ]);
  return typeof result === "string" ? result : String(result);
}

/**
 * Solve reCAPTCHA v3 (or Enterprise) on the current page (or after navigating
 * to `url`). Returns the token.
 *
 * Strategy (ported from Recaptcha-Solver-V3):
 *  1. optional warmup history + humanized cursor entry,
 *  2. a genuine click for transient activation right before execute,
 *  3. `grecaptcha.execute(sitekey, { action })`,
 *  4. a passive fallback that scrapes the token from the `/reload` response
 *     the page itself produces (works even when the active execute is blocked).
 */
export async function solveRecaptcha(
  options: RecaptchaOptions,
): Promise<string> {
  const sitekey = options.sitekey;
  const action = options.action ?? "submit";
  const enterprise = options.enterprise ?? false;
  const humanize = options.humanize ?? true;
  const capturePassive = options.capturePassive ?? true;
  const timeoutMs = options.timeoutMs ?? 30000;

  // Optional warmup history before the target.
  if (options.warmup !== false) {
    await warmup();
  }

  if (options.url) {
    await goto(options.url, {
      waitUntil: "domcontentloaded",
      timeout: Math.min(timeoutMs, 20000),
    });
  }

  let captured: string | null = null;
  let unsubscribe: (() => void) | null = null;

  if (capturePassive) {
    try {
      await cdp("Network.enable");
    } catch {
      // ignore
    }
    unsubscribe = subscribeBrowserEvent(
      "Network.responseReceived",
      undefined,
      async (event: any) => {
        if (captured) return;
        const respUrl: string = event?.params?.response?.url || "";
        if (!isReloadUrl(respUrl)) return;
        const requestId: string | undefined = event?.params?.requestId;
        if (!requestId) return;
        try {
          const body = await browserCdp(
            "Network.getResponseBody",
            { requestId },
            event.sessionId,
          );
          const text = body?.body ?? (body as any)?.result?.body ?? "";
          const token = extractReloadToken(text);
          if (token) captured = token;
        } catch {
          // base64 or missing body; try again on next reload
        }
      },
    );
  }

  try {
    // Humanized entry movement, a genuine "read the page" dwell, then a safe
    // click for a real user gesture. The dwell matters: an instant solve is a
    // bot cadence; preRead randomizes 2-6s of scroll/pause first.
    if (humanize) {
      await preRead();
      await cursorEntry();
      await humanizePage();
      await sleep(randInt(300, 700));
      await safeClick();
      await sleep(randInt(300, 600));
    }

    await injectGrecaptcha(sitekey, enterprise);
    let token: string | null = null;
    try {
      token = await executeGrecaptcha(sitekey, action, enterprise, timeoutMs);
    } catch {
      token = null;
    }
    if (token) return token;
    if (captured) return captured;

    // Give the passive capture a couple more beats before giving up.
    await sleep(1500);
    if (captured) return captured;

    throw new Error("failed to obtain reCAPTCHA token");
  } finally {
    if (unsubscribe) unsubscribe();
  }
}
