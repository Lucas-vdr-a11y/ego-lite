import { cdp, evaluate } from "../cdp-eval.js";
import { click, hover } from "../driver/pointer.js";
import { pageInfo } from "../driver/nav.js";
import { parseTurnstileTokens } from "./parse.js";

export type TurnstileOptions = {
  sitekey?: string;
  action?: string;
  cdata?: string;
  autoClick?: boolean;
  clickIntervalMs?: number;
  maxAttempts?: number;
  timeoutMs?: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A prompt-resolving expression that reads the current Turnstile token(s).
 * Returns an array of token strings (or `null` when none are ready yet). It
 * never blocks indefinitely, so Node can poll it cheaply.
 * Ported from B00H0O/cloudflare-solver's `solve_turnstile` wait promise.
 */
function turnstileProbeExpression(): string {
  return `(() => {
    const inputs = document.querySelectorAll('input[name="ts-response"]');
    const vals = [];
    for (const el of inputs) {
      const v = el && el.value;
      if (v && v.length > 10) vals.push(v);
    }
    if (vals.length) return vals;
    if (window.__tsTokenPromise && typeof window.__tsTokenPromise.then === 'function') {
      return window.__tsTokenPromise.then((v) => Array.isArray(v) ? v : [v]);
    }
    return null;
  })()`;
}

/**
 * Locate the Turnstile checkbox coordinates in the page, mirroring
 * cloudflare-solver's `find_turnstile_click_targets`. Returns a list of
 * `{x, y}` viewport points, primary (the widget) first.
 */
export async function findTurnstileClickTargets(): Promise<
  Array<{ x: number; y: number }>
> {
  const expression = `(() => {
    const coords = [];
    const pushRect = (r) => {
      if (!r || r.width <= 0 || r.height <= 0) return;
      coords.push({ x: r.x + 30, y: r.y + r.height / 2 });
    };
    const els = document.querySelectorAll('[name="cf-turnstile-response"]');
    if (els.length) {
      els.forEach((e) => { const p = e.parentElement; if (p) pushRect(p.getBoundingClientRect()); });
    } else {
      let found = false;
      document.querySelectorAll('div').forEach((item) => {
        try {
          const r = item.getBoundingClientRect();
          if (!found && r.width > 290 && r.width <= 310) { pushRect(r); found = true; }
        } catch (e) {}
      });
      if (!found) {
        document.querySelectorAll('iframe[src*="challenges.cloudflare.com"]').forEach((item) => {
          try { pushRect(item.getBoundingClientRect()); } catch (e) {}
        });
      }
    }
    return coords;
  })()`;
  try {
    const coords = await evaluate(expression);
    if (Array.isArray(coords)) {
      return coords.filter(
        (c) => c && typeof c.x === "number" && typeof c.y === "number",
      );
    }
  } catch {
    // fall through
  }
  return [];
}

/**
 * Click the Turnstile checkbox with a curved entry sweep (humanized) rather
 * than a teleport. Returns true if a target was found and clicked.
 */
export async function clickTurnstile(): Promise<boolean> {
  const targets = await findTurnstileClickTargets();
  if (targets.length === 0) return false;
  const [primary] = targets;
  await hover([primary.x, primary.y]);
  await click([primary.x, primary.y]);
  return true;
}

/**
 * Solve a Cloudflare Turnstile challenge on the current page and return the
 * token(s). Auto-clicks the checkbox (the widget usually needs one real
 * gesture to wake up) and polls `ts-response` inputs / `__tsTokenPromise`
 * until they carry a value.
 */
export async function solveTurnstile(
  options: TurnstileOptions = {},
): Promise<{ token?: string; tokens: string[] }> {
  const timeoutMs = options.timeoutMs ?? 30000;
  const autoClick = options.autoClick ?? true;
  const clickIntervalMs = options.clickIntervalMs ?? 1000;
  const maxAttempts = options.maxAttempts ?? 20;
  const deadline = Date.now() + timeoutMs;
  const probe = turnstileProbeExpression();

  const readTokens = async (): Promise<string[]> => {
    try {
      return parseTurnstileTokens(await evaluate(probe));
    } catch {
      return [];
    }
  };

  // Initial click probe, as in cloudflare-solver.
  let clicked = autoClick ? await clickTurnstile() : false;
  let attempts = 0;

  while (Date.now() < deadline) {
    const tokens = await readTokens();
    if (tokens.length > 0) {
      return { token: tokens[0], tokens };
    }
    if (autoClick && clicked && attempts < maxAttempts) {
      // Click again until the widget starts responding; stop once the target
      // disappears (already solved — just keep polling).
      const next = await clickTurnstile();
      attempts += 1;
      if (!next) clicked = false;
    }
    await sleep(clickIntervalMs);
  }

  const final = await readTokens();
  if (final.length > 0) {
    return { token: final[0], tokens: final };
  }
  throw new Error("turnstile solve timed out: no token appeared");
}

/**
 * Read the `cf_clearance` cookie for the current document (Cloudflare's
 * pass-cookie for IUAM / managed challenges). httpOnly, so it cannot be read
 * from `document.cookie` — this goes through the CDP cookie store.
 */
export async function getCfClearance(): Promise<{
  name: string;
  value: string;
  domain: string;
  expires?: number;
} | null> {
  let urls: string[] = [];
  try {
    const info = await pageInfo();
    if (info.url) urls = [info.url];
  } catch {
    // ignore
  }
  const res = await cdp("Network.getCookies", urls.length ? { urls } : {});
  const cookies = res?.cookies || [];
  const match = cookies.find((c: any) => c.name === "cf_clearance");
  return match
    ? {
        name: match.name,
        value: match.value,
        domain: match.domain,
        expires: match.expires,
      }
    : null;
}
