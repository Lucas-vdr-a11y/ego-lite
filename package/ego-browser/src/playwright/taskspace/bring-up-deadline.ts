/**
 * One deadline for the whole TaskSpace bring-up.
 *
 * Bring-up is a sequence of awaits, two of which have no bound of their own, so
 * a stall anywhere in it has to be turned into an error that names the step it
 * stalled in.
 */

// A bring-up step that never settles used to be invisible: newTaskSpace() just
// did not return, the agent script was hard-killed at its command budget, and
// every line it had already printed died with the process — no stack, no step
// name, nothing to act on. The whole sequence is normally a few hundred
// milliseconds, and two of its steps have no deadline of their own:
// prepareSession calls page.evaluate(), which waits for an execution context
// forever, and locatePlaywrightPage's expiry fallback calls context.newPage().
// One shared deadline turns that silence into an error naming the step.
//
// The number has to clear the *caller's* budget, not just be generous: an error
// raised after the agent script is already dead is no better than the hang it
// replaced. Callers on a tighter budget than this should pass bringUpTimeoutMs.
export const BRING_UP_TIMEOUT_MS = 15_000;
// The teardown on the failure path needs its own bound, or a second hang there
// swallows the diagnosis the first one just produced.
export const BRING_UP_TEARDOWN_TIMEOUT_MS = 5_000;

export async function withDeadline<T>(
  label: string,
  work: Promise<T>,
  expiresAt: number,
  timeoutMs: number,
  disposeLate?: (value: T) => unknown,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  try {
    // Promise.race observes both inputs, so a rejection arriving after the
    // timeout won is still handled — an unhandled one would end the whole
    // shared NodeService, not just this TaskSpace.
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        // Deliberately not unref'd: a stalled bring-up may be the only thing
        // left on the loop, and an unref'd timer would never fire to rescue it.
        // It is cleared below either way, and lives at most timeoutMs.
        timer = setTimeout(
          () => {
            timedOut = true;
            reject(
              new Error(
                `TaskSpace bring-up stalled in ${label}: no result within ${timeoutMs}ms`,
              ),
            );
          },
          Math.max(0, expiresAt - Date.now()),
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    // Losing the race does not cancel the work — a slow step can still succeed
    // and hand back something that owns a resource (a transport lease, a
    // browser connection). Nothing upstream ever saw that value, so this is its
    // only chance to be released; without it a timed-out bring-up leaks the very
    // connection it failed to use.
    if (timedOut && disposeLate) {
      void work.then(
        (value) => {
          try {
            return disposeLate(value);
          } catch {
            return undefined;
          }
        },
        () => undefined,
      );
    }
  }
}

// One budget for the whole bring-up, so a slow-but-progressing sequence cannot
// spend the deadline once per step and still outlast the caller.
export function bringUpBudget(timeoutMs: number) {
  const expiresAt = Date.now() + timeoutMs;
  return <T>(
    label: string,
    work: Promise<T>,
    disposeLate?: (value: T) => unknown,
  ) => withDeadline(label, work, expiresAt, timeoutMs, disposeLate);
}
