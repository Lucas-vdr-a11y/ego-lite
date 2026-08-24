import { evaluate } from "../cdp-eval.js";
import { click, hover, wheel } from "../driver/pointer.js";

/**
 * Humanized behavioral helpers, ported from AmitHaina/Recaptcha-Solver-V3.
 * These run through the real CDP input pipeline (trusted events) rather than
 * dispatching synthetic DOM events (isTrusted=false is a detection red flag).
 */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randInt(min: number, max: number): number {
  return Math.floor(rand(min, max + 1));
}

/**
 * Scroll a short distance with realistic deceleration, occasionally overshooting
 * and correcting (the way people do), via the native wheel pipeline.
 */
export async function naturalScroll(
  direction: 1 | -1 = 1,
  opts: { min?: number; max?: number } = {},
): Promise<void> {
  if ((globalThis as any).ego?.sendCDPMessage === undefined) {
    // No live CDP runtime (e.g. unit test): do nothing.
    return;
  }
  const total = randInt(opts.min ?? 300, opts.max ?? 600) * direction;
  let velocity = rand(80, 150);
  let scrolled = 0;
  while (Math.abs(scrolled) < Math.abs(total)) {
    const chunk = Math.floor(velocity) * direction;
    if (Math.abs(chunk) < 5) {
      await wheel(0, total - scrolled);
      break;
    }
    await wheel(0, chunk);
    scrolled += chunk;
    velocity *= rand(0.85, 0.92);
    await sleep(randInt(15, 35));
  }
  if (Math.random() < 0.3) {
    await wheel(0, -randInt(30, 80));
    await sleep(randInt(200, 400));
  }
}

/**
 * Click empty space near the viewport centre for a genuine user gesture
 * (transient activation) without navigating away or submitting a form.
 */
export async function safeClick(): Promise<boolean> {
  if ((globalThis as any).ego?.sendCDPMessage === undefined) {
    return false;
  }
  let size: { w: number; h: number } = { w: 1280, h: 720 };
  try {
    size = await evaluate("({ w: window.innerWidth, h: window.innerHeight })");
  } catch {
    // fall back to defaults
  }
  const x = Math.floor(size.w / 2 + rand(-100, 100));
  const y = Math.floor(size.h / 2 + rand(-50, 50));
  try {
    const safe = await evaluate(`(() => {
      const el = document.elementFromPoint(${Math.max(0, x)}, ${Math.max(0, y)});
      if (!el) return true;
      return !el.closest('a,button,input,textarea,select,label,summary,[onclick],[role="button"],[role="link"]');
    })()`);
    if (safe) {
      await click([x, y]);
      return true;
    }
  } catch {
    // best-effort
  }
  return false;
}

/**
 * A short gentle scroll then a safe click — a lightweight "warmup" gesture to
 * make the page feel lived-in before a reCAPTCHA execute.
 */
export async function humanizePage(): Promise<void> {
  await sleep(randInt(200, 600));
  await naturalScroll(1);
  await sleep(randInt(100, 250));
  await safeClick();
}

/**
 * Curved cursor sweep into the viewport from the corner (entry movement),
 * mirroring how a real cursor enters rather than teleporting to centre.
 */
export async function cursorEntry(): Promise<void> {
  if ((globalThis as any).ego?.sendCDPMessage === undefined) return;
  let size: { w: number; h: number } = { w: 1280, h: 720 };
  try {
    size = await evaluate("({ w: window.innerWidth, h: window.innerHeight })");
  } catch {
    // defaults
  }
  const entryX = Math.floor(size.w / 3 + rand(0, size.w / 6));
  const entryY = Math.floor(size.h / 4 + rand(0, size.h / 4));
  await hover([entryX, entryY]);
  await sleep(randInt(100, 250));
}
