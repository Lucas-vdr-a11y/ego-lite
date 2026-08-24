/**
 * Pure parsing helpers for captcha token harvesting. Kept dependency-free so
 * they are trivially unit-testable.
 *
 * reCAPTCHA v3 posts execute results to `/recaptcha/(api2|enterprise)/reload`;
 * the response body carries the token as `"rresp","<token>"`. Scraping that
 * response is a robust passive fallback when the active `grecaptcha.execute`
 * call fails (port of AmitHaina/Recaptcha-Solver-V3's `_capture`).
 */

const RELOAD_RE = /\/recaptcha\/(api2|enterprise)\/reload/;
const TOKEN_RE = /"rresp","(.*?)"/;

/** True when a response URL is a reCAPTCHA reload response carrying a token. */
export function isReloadUrl(url: string): boolean {
 return RELOAD_RE.test(url || "");
}

/** Extract the `"rresp","<token>"` value from a reCAPTCHA reload body. */
export function extractReloadToken(body: string): string | null {
 if (typeof body !== "string") return null;
 const m = TOKEN_RE.exec(body);
 return m ? m[1] : null;
}

/**
 * Normalize a turnstile wait expression result into an array of token strings.
 * Accepts: an array, a JSON-array string, or a single token string.
 */
export function parseTurnstileTokens(value: unknown): string[] {
 if (Array.isArray(value)) {
  return value.filter(
   (v): v is string => typeof v === "string" && v.length > 0,
  );
 }
 if (typeof value === "string" && value.length > 0) {
  const trimmed = value.trim();
  try {
   const parsed = JSON.parse(trimmed);
   if (Array.isArray(parsed)) {
    return parsed.filter(
     (v): v is string => typeof v === "string" && v.length > 0,
    );
   }
  } catch {
   // not JSON — treat as a single raw token
  }
  return [trimmed];
 }
 return [];
}
