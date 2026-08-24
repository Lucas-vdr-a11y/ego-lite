import { evaluate } from "../cdp-eval.js";
import {
  solveTurnstile,
  getCfClearance,
  clickTurnstile,
} from "./cloudflare.js";
import { solveRecaptcha } from "./recaptcha.js";

export type CaptchaKind =
  | "cloudflare-turnstile"
  | "cloudflare-iuam"
  | "recaptcha-v2"
  | "recaptcha-v3"
  | "recaptcha-enterprise"
  | "unknown";

export type CaptchaOptions = {
  url?: string;
  sitekey?: string;
  kind?: CaptchaKind;
  action?: string;
  enterprise?: boolean;
  warmup?: boolean;
  humanize?: boolean;
  timeoutMs?: number;
};

/**
 * Detect which challenge (if any) is present on the current page, by probing
 * the DOM for Turnstile fields, Cloudflare challenge iframes, and grecaptcha.
 */
export async function detectChallenge(): Promise<CaptchaKind> {
  try {
    const has = await evaluate(`(() => {
      const q = (s) => document.querySelectorAll(s).length > 0;
      const flags = {
        ts: q('input[name="ts-response"]') || q('input[name="cf-turnstile-response"]'),
        cf: q('iframe[src*="challenges.cloudflare.com"]'),
        g: typeof window.grecaptcha !== 'undefined',
        geo: typeof window.grecaptcha && typeof window.grecaptcha.enterprise !== 'undefined',
      };
      return { flags };
    })()`);
    const f = has?.flags || {};
    if (f.ts) return "cloudflare-turnstile";
    if (f.cf) return "cloudflare-iuam";
    if (f.geo) return "recaptcha-enterprise";
    if (f.g) return "recaptcha-v3";
    return "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Solve whichever challenge is present (or the explicitly requested `kind`).
 * Routes Cloudflare Turnstile/IUAM to the CDP solver and reCAPTCHA to the
 * humanized token harvester.
 */
export async function solveCaptcha(options: CaptchaOptions = {}): Promise<{
  kind: CaptchaKind;
  token?: string;
  tokens?: string[];
  clearance?: { name: string; value: string; domain: string } | null;
}> {
  const kind: CaptchaKind = options.kind ?? (await detectChallenge());

  if (options.url) {
    const { goto } = await import("../driver/nav.js");
    await goto(options.url, {
      waitUntil: "domcontentloaded",
      timeout: Math.min(options.timeoutMs ?? 30000, 20000),
    });
  }

  switch (kind) {
    case "cloudflare-turnstile": {
      const { token, tokens } = await solveTurnstile(options);
      let clearance: {
        name: string;
        value: string;
        domain: string;
      } | null = null;
      try {
        clearance = await getCfClearance();
      } catch {
        // ignore
      }
      return { kind, token, tokens, clearance };
    }
    case "cloudflare-iuam": {
      // Managed challenge: click the continue / wait it out, then read the
      // cf_clearance pass cookie.
      try {
        await clickTurnstile();
      } catch {
        // ignore
      }
      const { token, tokens } = await solveTurnstile(options);
      const clearance = await getCfClearance();
      return { kind, token, tokens, clearance };
    }
    case "recaptcha-enterprise":
    case "recaptcha-v3":
    case "recaptcha-v2": {
      if (!options.sitekey) {
        throw new Error("solveCaptcha: reCAPTCHA requires a sitekey");
      }
      const token = await solveRecaptcha({
        sitekey: options.sitekey,
        action: options.action ?? "submit",
        enterprise: options.enterprise ?? kind === "recaptcha-enterprise",
        warmup: options.warmup,
        humanize: options.humanize,
        timeoutMs: options.timeoutMs,
      });
      return { kind, token };
    }
    default:
      throw new Error(
        `solveCaptcha: no supported challenge detected (${kind})`,
      );
  }
}

export {
  solveTurnstile,
  getCfClearance,
  clickTurnstile,
  findTurnstileClickTargets,
} from "./cloudflare.js";
export type { TurnstileOptions } from "./cloudflare.js";
export {
  solveRecaptcha,
  warmup,
  injectGrecaptcha,
  executeGrecaptcha,
  WARMUP_SEQUENCES,
} from "./recaptcha.js";
export type { RecaptchaOptions } from "./recaptcha.js";
export {
  naturalScroll,
  safeClick,
  cursorEntry,
  humanizePage,
  preRead,
  typeHumanized,
} from "./humanize.js";
export {
  parseTurnstileTokens,
  extractReloadToken,
  isReloadUrl,
} from "./parse.js";
