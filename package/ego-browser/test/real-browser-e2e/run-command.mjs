import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

const commandSessions = new Map();
const resourceTails = new Map();

export function runCommand(command, args, options = {}) {
  const { sessionId } = startCommand(command, args, options);
  return waitCommandSession(sessionId);
}

export function startCommand(command, args, options = {}) {
  const resourceKeys = [...new Set(options.resourceKeys || [])];
  if (resourceKeys.length > 0 && !options.input) {
    throw new Error("queued commands require piped input");
  }
  const sessionId = randomUUID();
  let resolveResult;
  let rejectResult;
  const result = new Promise((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  const state = {
    args,
    command,
    forceKillTimer: undefined,
    options,
    result,
    resourceReservation: reserveResources(resourceKeys, sessionId),
    settled: false,
    stderr: "",
    stderrOffset: 0,
    stdout: "",
    stdoutOffset: 0,
    timer: undefined,
  };
  commandSessions.set(sessionId, state);

  const echo = options.echo !== false;
  const child = spawn(command, args, {
    cwd: options.cwd ?? process.cwd(),
    detached: process.platform !== "win32",
    env: process.env,
    stdio: options.input ? ["pipe", "pipe", "pipe"] : "inherit",
  });
  state.child = child;

  if (options.timeoutMs) {
    state.timer = setTimeout(
      () => cancelCommandSession(sessionId, { timedOut: true }),
      options.timeoutMs,
    );
  }

  child.on("error", (error) => {
    if (!settle(state)) return;
    if (error.code === "ENOENT" && command === "ego-browser") {
      rejectResult(
        new Error(
          "ego-browser command not found; install/open ego lite before running real browser e2e",
        ),
      );
      return;
    }
    rejectResult(error);
  });
  child.stdout?.on("data", (chunk) => {
    state.stdout += chunk;
    if (echo) process.stdout.write(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    state.stderr += chunk;
    if (echo) process.stderr.write(chunk);
  });
  child.stdin?.on("error", (error) => {
    if (
      error?.code === "EPIPE" &&
      (state.cancelled || state.timedOut || state.settled)
    ) {
      return;
    }
    if (!settle(state)) return;
    killProcessGroup(child, "SIGKILL");
    rejectResult(error);
  });
  child.on("close", (code, signal) => {
    if (!settle(state)) return;
    if (state.timedOut) {
      const error = commandError(
        state,
        `${command} ${args.join(" ")} timed out after ${options.timeoutMs}ms`,
        code,
        signal,
      );
      error.timedOut = true;
      rejectResult(error);
      return;
    }
    if (state.cancelled) {
      const error = commandError(
        state,
        `${command} ${args.join(" ")} was cancelled`,
        code,
        signal,
      );
      error.cancelled = true;
      rejectResult(error);
      return;
    }
    if (
      /unknown option.*sdk-path|unrecognized option.*sdk-path/i.test(
        state.stdout + state.stderr,
      )
    ) {
      const error = new Error(
        `ego-browser nodejs --sdk-path is not supported; cannot verify SDK path ${options.egoBrowserSdkPath || "configured SDK path"}`,
      );
      error.stdout = state.stdout;
      error.stderr = state.stderr;
      rejectResult(error);
      return;
    }
    if (code === 0) {
      if (
        /ego's nodejs process exited with code\s+[1-9]\d*/.test(
          state.stdout + state.stderr,
        )
      ) {
        const error = new Error(
          "ego-browser nodejs reported an inner failure while exiting 0",
        );
        error.stdout = state.stdout;
        error.stderr = state.stderr;
        rejectResult(error);
        return;
      }
      resolveResult({
        stdout: state.stdout,
        stderr: state.stderr,
        exitCode: code,
        signal,
      });
      return;
    }
    rejectResult(
      commandError(
        state,
        `${command} ${args.join(" ")} exited with code ${code}`,
        code,
        signal,
      ),
    );
  });
  state.resourceReservation.ready.then(() => {
    if (
      !state.settled &&
      !state.cancelled &&
      !state.timedOut &&
      options.input
    ) {
      child.stdin.end(options.input);
    }
  });

  return { sessionId };
}

export async function waitCommandSession(sessionId) {
  const state = commandSessions.get(sessionId);
  if (!state) throw new Error(`unknown command session: ${sessionId}`);
  try {
    return await state.result;
  } finally {
    commandSessions.delete(sessionId);
  }
}

export async function pollCommandSession(sessionId, yieldTimeMs) {
  const state = commandSessions.get(sessionId);
  if (!state) throw new Error(`unknown command session: ${sessionId}`);
  const completion = state.result.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  let timer;
  const outcome = state.settled
    ? await completion
    : await Promise.race([
        completion,
        new Promise((resolve) => {
          timer = setTimeout(() => resolve({ running: true }), yieldTimeMs);
        }),
      ]);
  if (timer) clearTimeout(timer);
  const output = takeSessionOutput(state);
  if (outcome.running) return { running: true, output };
  commandSessions.delete(sessionId);
  return { ...outcome, running: false, output };
}

export function cancelCommandSession(sessionId, options = {}) {
  const state = commandSessions.get(sessionId);
  if (!state || state.settled || state.cancelled || state.timedOut)
    return false;
  if (options.timedOut) state.timedOut = true;
  else state.cancelled = true;
  state.options.onCancel?.(sessionId);
  killProcessGroup(state.child, "SIGINT");
  state.forceKillTimer = setTimeout(
    () => killProcessGroup(state.child, "SIGKILL"),
    state.options.timeoutGraceMs ?? 1000,
  );
  return true;
}

function settle(state) {
  if (state.settled) return false;
  state.settled = true;
  if (state.timer) clearTimeout(state.timer);
  if (state.forceKillTimer) clearTimeout(state.forceKillTimer);
  state.resourceReservation.release();
  return true;
}

function reserveResources(resourceKeys, sessionId) {
  const predecessors = resourceKeys
    .map((key) => resourceTails.get(key)?.done)
    .filter(Boolean);
  let resolveDone;
  const reservation = {
    done: new Promise((resolve) => {
      resolveDone = resolve;
    }),
    resourceKeys,
    sessionId,
  };
  for (const key of resourceKeys) resourceTails.set(key, reservation);
  let released = false;
  return {
    ready: Promise.all(predecessors),
    release() {
      if (released) return;
      released = true;
      resolveDone();
      for (const key of resourceKeys) {
        if (resourceTails.get(key) === reservation) resourceTails.delete(key);
      }
    },
  };
}

function takeSessionOutput(state) {
  const stdout = state.stdout.slice(state.stdoutOffset);
  const stderr = state.stderr.slice(state.stderrOffset);
  state.stdoutOffset = state.stdout.length;
  state.stderrOffset = state.stderr.length;
  return stdout + stderr;
}

function commandError(state, message, exitCode, signal) {
  const error = new Error(message);
  error.stdout = state.stdout;
  error.stderr = state.stderr;
  error.exitCode = exitCode;
  error.signal = signal;
  return error;
}

function killProcessGroup(child, signal) {
  if (process.platform !== "win32" && child.pid) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch (error) {
      if (error?.code === "ESRCH") return;
    }
  }
  child.kill(signal);
}
