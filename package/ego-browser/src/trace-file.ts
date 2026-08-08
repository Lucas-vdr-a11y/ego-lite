import { appendFileSync } from "node:fs";

import { resolvePath } from "./env.js";

const DIAGNOSTIC_BUILD = process.env.EGO_BROWSER_DIAGNOSTIC_BUILD === "1";

/**
 * Opt-in out-of-band trace file for post-mortem diagnosis.
 *
 * The host batches a script's stdout until the script finishes, and it runs concurrent
 * scripts inside one shared OS process. A script that dies abnormally therefore delivers
 * nothing at all — including a script killed by an *unrelated* script aborting the shared
 * process, which surfaces to every one of them as "NodeRuntime disconnected" with no
 * output. Writing synchronously to a file bypasses that transport: bytes are on disk
 * before the next statement runs, so they survive an abort and are readable while the run
 * is still in flight.
 *
 * Available only in an explicit diagnostic build and then enabled by
 * `EGO_BROWSER_TRACE_FILE`. Release builds compile this branch and its filesystem writer
 * out of the shipped bundle, so an accidentally inherited environment variable cannot
 * enable tracing for users. The host does not inherit the invoking shell's environment,
 * so diagnostic hosted runs set the path in a `.env` file read by `loadEnv()`.
 *
 * A run that logged a `run start` record with no matching `run end` is one that died
 * without reaching its own teardown, which is the signal this file exists to capture.
 */

let target: string | null = null;
let runId = "";

/**
 * Resolve the configured trace target and record a run-start marker. Re-initialises all
 * module state, so a second call starts a fresh logical run.
 */
export function startTrace(env: NodeJS.ProcessEnv = process.env): void {
  target = null;
  runId = "";
  if (!DIAGNOSTIC_BUILD) return;
  const configured = env.EGO_BROWSER_TRACE_FILE;
  target = configured ? resolvePath(configured) : null;
  runId = Math.random().toString(36).slice(2, 8);
  if (!target) return;
  writeRecord("run start");
  // Only hook teardown when tracing is on, so the default path registers no listeners.
  process.on("exit", () => writeRecord("run end"));
}

/** Mirror one already-formatted console.log chunk into the trace file. */
export function traceOutput(chunk: string): void {
  if (!DIAGNOSTIC_BUILD) return;
  if (!target) return;
  writeRecord(chunk);
}

/** The resolved trace path, or null when tracing is disabled. Exposed for tests. */
export function traceTarget(): string | null {
  return target;
}

/** Whether this artifact was explicitly built with diagnostic tracing support. */
export function diagnosticTraceBuild(): boolean {
  return DIAGNOSTIC_BUILD;
}

function writeRecord(body: string): void {
  if (!target) return;
  const stamp = `${new Date().toISOString()} pid=${process.pid} run=${runId}`;
  const lines = body.replace(/\n$/, "").split("\n");
  try {
    appendFileSync(target, lines.map((line) => `${stamp} ${line}\n`).join(""));
  } catch {
    // A trace target that cannot be written (bad path, full disk, revoked permission)
    // must not take the run down with it.
  }
}
