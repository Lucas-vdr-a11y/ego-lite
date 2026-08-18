import { formatCliLogValue } from "./format.js";

/**
 * Output sink for the agent-facing heredoc runtime.
 *
 * `cliLog` is the only channel an agent reads. A single user takeover turns that
 * channel into noise: while the user holds control, every browser command re-reports
 * the same hard-stop error, so a script that loops over work and swallows each error
 * (try/catch, `.catch()`) prints the same guidance on every iteration, buried under
 * its own business logging and success rows.
 *
 * To collapse that to one clean line we buffer cliLog output instead of writing it
 * straight through. When a hard-stop error is born (see `buildEgoError`) we record its
 * owned message once. At the end of the run we either:
 *   - a hard stop occurred -> discard the whole buffer and emit the owned message once
 *   - otherwise            -> flush the buffered output verbatim
 *
 * Buffering is the price of discarding pre-stop output: bytes already written cannot be
 * recalled, so nothing may be written until we know the run did not hard-stop. Each
 * heredoc runs in its own short-lived process, so this module state is per-run and needs
 * no cross-round reset; `resetSink()` exists only so in-process tests can reuse the run.
 */

type WritableLike = { write(chunk: string): unknown };

export type RoundConsole = Pick<Console, "log" | "info" | "warn" | "error">;

let buffer: string[] = [];
let hardStopMessage: string | null = null;
let flushed = false;
let lifecycleHooked = false;

/** Buffer one already-formatted cliLog chunk (the trailing newline is included). */
export function bufferOutput(chunk: string): void {
  buffer.push(chunk);
}

/** Create the console object injected into one agent round. */
export function createRoundConsole(
  writeLine: (line: string) => void = bufferOutput,
): RoundConsole {
  const append = (prefix: string, args: unknown[]) => {
    const body = args.map(formatCliLogValue).join(" ");
    writeLine(`${prefix}${body}\n`);
  };
  return Object.freeze({
    log: (...args: unknown[]) => append("", args),
    info: (...args: unknown[]) => append("", args),
    warn: (...args: unknown[]) => append("[warn] ", args),
    error: (...args: unknown[]) => append("[error] ", args),
  });
}

/**
 * Record the owned message of the first hard-stop error seen this run. Later hard stops
 * — the same error re-reported on each loop iteration — are ignored so the agent sees
 * the guidance exactly once.
 */
export function markHardStop(message: string): void {
  if (hardStopMessage === null) {
    hardStopMessage = message;
  }
}

/**
 * Emit the run's output exactly once.
 *
 * `thrown` separates a completed script from one ending on an uncaught error. On a clean
 * finish we are the only writer, so a hard stop must print its message here. On an
 * uncaught error the propagating Error already surfaces the message (the host prints it),
 * so we stay silent and only drop the buffer. Non-hard-stop output is flushed either way,
 * so an ordinary failure still shows what the script logged before it threw.
 */
export function flushSink(stream: WritableLike, thrown: boolean): void {
  if (flushed) return;
  flushed = true;
  if (hardStopMessage !== null) {
    // Drop every buffered line — business logs, success rows, and the repeated error
    // echoes — so the owned guidance is all that remains.
    if (!thrown) {
      stream.write(
        hardStopMessage.endsWith("\n")
          ? hardStopMessage
          : `${hardStopMessage}\n`,
      );
    }
  } else {
    for (const chunk of buffer) stream.write(chunk);
  }
  buffer = [];
}

/** Clear sink state. Real runs get a fresh process; this is only for in-process tests. */
export function resetSink(): void {
  buffer = [];
  hardStopMessage = null;
  flushed = false;
}

/**
 * Flush on process teardown for the SDK path, where the host runs each heredoc directly
 * and never calls the CLI `execute()` wrapper, so lifecycle events are our only hook.
 *
 * A clean finish drains the event loop and reaches `beforeExit`; an uncaught async
 * rejection skips `beforeExit` but still reaches `exit` (`thrown: true`, so a hard stop
 * stays silent and lets the propagating Error surface the message). The stream still
 * accepts writes in both events, so the same `stream` serves both. Registered once.
 */
export function installLifecycleFlush(stream: WritableLike): void {
  if (lifecycleHooked) return;
  lifecycleHooked = true;
  process.on("beforeExit", () => flushSink(stream, false));
  process.on("exit", () => flushSink(stream, true));
}
