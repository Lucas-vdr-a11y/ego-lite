import { pollCommandSession, startCommand } from "./run-command.mjs";

export function createCodexCommandTools() {
  const outputStates = new Map();
  return {
    async exec_command(options) {
      const { sessionId } = startCommand(options.cmd, options.args || [], {
        cwd: options.cwd,
        echo: false,
        egoBrowserSdkPath: options.egoBrowserSdkPath,
        input: options.input,
        onCancel: options.onCancel,
        resourceKeys: options.resource_keys,
        timeoutGraceMs: options.timeout_grace_ms,
        timeoutMs: options.timeout_ms,
      });
      outputStates.set(sessionId, createOutputState(options.echo));
      return poll(sessionId, options.yield_time_ms, outputStates);
    },
    async write_stdin(options) {
      if (options.chars) {
        throw new Error("Codex command simulation only supports polling");
      }
      return poll(options.session_id, options.yield_time_ms, outputStates);
    },
  };
}

async function poll(sessionId, yieldTimeMs = 10_000, outputStates) {
  const result = await pollCommandSession(sessionId, yieldTimeMs);
  if (result.running) {
    return {
      output: filterOutput(outputStates, sessionId, result.output),
      session_id: sessionId,
    };
  }
  if (result.error) {
    return {
      output: filterOutput(
        outputStates,
        sessionId,
        result.output,
        result.error,
      ),
      exit_code:
        result.error.exitCode ??
        (result.error.timedOut ? 124 : result.error.cancelled ? 130 : 1),
      signal: result.error.signal,
      timed_out: result.error.timedOut === true,
      cancelled: result.error.cancelled === true,
    };
  }
  return {
    output: filterOutput(outputStates, sessionId, result.output, null),
    exit_code: result.value.exitCode,
    signal: result.value.signal,
  };
}

function createOutputState(echo) {
  return {
    echo: echo === true,
    remainder: "",
    sawDisconnect: false,
    suppressNextBlank: false,
  };
}

function filterOutput(outputStates, sessionId, chunk, completion) {
  const state = outputStates.get(sessionId) || createOutputState(false);
  const final = completion !== undefined;
  const text = state.remainder + chunk;
  let completeText = text;
  if (final) {
    state.remainder = "";
  } else {
    const lastNewline = text.lastIndexOf("\n");
    if (lastNewline === -1) {
      state.remainder = text;
      completeText = "";
    } else {
      state.remainder = text.slice(lastNewline + 1);
      completeText = text.slice(0, lastNewline + 1);
    }
  }
  const lines = completeText.match(/[^\n]*\n|[^\n]+$/g) || [];

  let output = "";
  for (const line of lines) {
    const value = line.trim();
    if (value === "NodeRuntime disconnected") {
      state.sawDisconnect = true;
      state.suppressNextBlank = true;
      continue;
    }
    if (/^ego's nodejs process exited with code \d+\.$/.test(value)) {
      state.suppressNextBlank = true;
      continue;
    }
    if (!value && state.suppressNextBlank) continue;
    state.suppressNextBlank = false;
    output += line;
  }

  if (
    final &&
    completion &&
    state.sawDisconnect &&
    completion.timedOut !== true &&
    completion.cancelled !== true
  ) {
    output += "ego-browser command disconnected unexpectedly.\n";
  }
  if (state.echo && output) process.stdout.write(output);
  if (final) outputStates.delete(sessionId);
  else outputStates.set(sessionId, state);
  return output;
}
