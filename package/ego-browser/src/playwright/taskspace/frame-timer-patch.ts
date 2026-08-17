/**
 * Keeps Playwright's FrameThrottler from holding the Node event loop open.
 *
 * The throttler re-arms a 35ms or 200ms timer for as long as a page is attached,
 * so Node would never exit while a TaskSpace is connected. Unref'ing just those
 * timers lets the process end without touching Playwright's own bookkeeping.
 *
 * The patch is global, so it is reference-counted: it is installed by the first
 * connection and removed only when the last one lets go, and the restore is
 * skipped if something else replaced setTimeout in the meantime.
 */

let playwrightTimerPatchUsers = 0;
let originalSetTimeout: typeof globalThis.setTimeout | undefined;
let patchedSetTimeout: typeof globalThis.setTimeout | undefined;

export function isPlaywrightFrameThrottlerTimer(
  delay: unknown,
  stack: string | undefined,
) {
  return (
    (delay === 35 || delay === 200) &&
    typeof stack === "string" &&
    (stack.includes("FrameThrottler._tick") ||
      /\bat [\w$]{1,3}\._tick \(/.test(stack))
  );
}

export function installPlaywrightFrameTimerUnref() {
  playwrightTimerPatchUsers += 1;
  if (playwrightTimerPatchUsers === 1) {
    originalSetTimeout = globalThis.setTimeout;
    patchedSetTimeout = ((callback, delay, ...args) => {
      const timer = originalSetTimeout!(callback, delay, ...args);
      // Capture the stack only for candidate delays; unconditional capture
      // taxes every setTimeout in the process while the patch is installed.
      if (delay === 35 || delay === 200) {
        const stack = new Error().stack;
        if (isPlaywrightFrameThrottlerTimer(delay, stack)) timer.unref?.();
      }
      return timer;
    }) as typeof globalThis.setTimeout;
    globalThis.setTimeout = patchedSetTimeout;
  }
  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    playwrightTimerPatchUsers -= 1;
    if (
      playwrightTimerPatchUsers === 0 &&
      originalSetTimeout &&
      globalThis.setTimeout === patchedSetTimeout
    ) {
      globalThis.setTimeout = originalSetTimeout;
      originalSetTimeout = undefined;
      patchedSetTimeout = undefined;
    }
  };
}
