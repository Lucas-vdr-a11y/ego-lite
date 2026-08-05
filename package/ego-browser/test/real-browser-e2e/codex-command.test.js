import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createCodexCommandTools } from "./codex-command.mjs";

test("exec_command yields a session_id that write_stdin polls until exit_code", async () => {
  const tools = createCodexCommandTools();
  let result = await tools.exec_command({
    cmd: process.execPath,
    args: ["-e", "setTimeout(() => process.stdout.write('finished'), 80)"],
    echo: false,
    input: " ",
    yield_time_ms: 10,
  });

  assert.equal(result.exit_code, undefined);
  assert.match(result.session_id, /^[0-9a-f-]+$/i);
  const sessionId = result.session_id;
  while (result.session_id) {
    assert.equal(result.session_id, sessionId);
    result = await tools.write_stdin({
      session_id: result.session_id,
      yield_time_ms: 20,
    });
  }

  assert.equal(result.exit_code, 0);
  assert.equal(result.output, "finished");
});

test("commands sharing a TaskSpace resource run in submission order", async (t) => {
  const testDir = await mkdtemp(join(tmpdir(), "ego-codex-queue-"));
  const logPath = join(testDir, "order.log");
  t.after(() => rm(testDir, { recursive: true, force: true }));
  const tools = createCodexCommandTools();

  const first = await tools.exec_command({
    cmd: process.execPath,
    args: [
      "-e",
      stdinScript(`
        const fs = require("node:fs");
        fs.appendFileSync(${JSON.stringify(logPath)}, "first-start\\n");
        setTimeout(() => {
          fs.appendFileSync(${JSON.stringify(logPath)}, "first-end\\n");
        }, 80);
      `),
    ],
    echo: false,
    input: " ",
    resource_keys: ["taskspace:622"],
    yield_time_ms: 5,
  });
  const second = await tools.exec_command({
    cmd: process.execPath,
    args: [
      "-e",
      stdinScript(`
        require("node:fs").appendFileSync(
          ${JSON.stringify(logPath)},
          "second\\n",
        );
      `),
    ],
    echo: false,
    input: " ",
    resource_keys: ["taskspace:622"],
    yield_time_ms: 5,
  });

  await Promise.all([drain(tools, first), drain(tools, second)]);
  assert.deepEqual((await readFile(logPath, "utf8")).trim().split("\n"), [
    "first-start",
    "first-end",
    "second",
  ]);
});

test("commands for different TaskSpace resources can run concurrently", async (t) => {
  const testDir = await mkdtemp(join(tmpdir(), "ego-codex-parallel-"));
  const markerPath = join(testDir, "second-started");
  t.after(() => rm(testDir, { recursive: true, force: true }));
  const tools = createCodexCommandTools();

  const first = await tools.exec_command({
    cmd: process.execPath,
    args: [
      "-e",
      stdinScript(`
        const fs = require("node:fs");
        const deadline = Date.now() + 500;
        const timer = setInterval(() => {
          if (fs.existsSync(${JSON.stringify(markerPath)})) {
            clearInterval(timer);
            process.exit(0);
          } else if (Date.now() >= deadline) {
            clearInterval(timer);
            process.exit(2);
          }
        }, 10);
      `),
    ],
    echo: false,
    input: " ",
    resource_keys: ["taskspace:622"],
    yield_time_ms: 5,
  });
  const second = await tools.exec_command({
    cmd: process.execPath,
    args: [
      "-e",
      stdinScript(`
        require("node:fs").writeFileSync(
          ${JSON.stringify(markerPath)},
          "ready",
        );
      `),
    ],
    echo: false,
    input: " ",
    resource_keys: ["taskspace:623"],
    yield_time_ms: 5,
  });

  const [firstResult, secondResult] = await Promise.all([
    drain(tools, first),
    drain(tools, second),
  ]);
  assert.equal(firstResult.exit_code, 0);
  assert.equal(secondResult.exit_code, 0);
});

test("expected timeouts suppress raw NodeRuntime disconnect diagnostics", async () => {
  const tools = createCodexCommandTools();
  const initial = await tools.exec_command({
    cmd: process.execPath,
    args: [
      "-e",
      stdinScript(`
        process.stdout.write(
          "NodeRuntime disconnected\\n" +
          "NodeRuntime disconnected\\n" +
          "ego's nodejs process exited with code 1.\\n",
        );
        setInterval(() => {}, 1_000);
      `),
    ],
    echo: false,
    input: " ",
    timeout_ms: 50,
    yield_time_ms: 5,
  });

  const result = await drain(tools, initial);
  assert.equal(result.timed_out, true);
  assert.doesNotMatch(result.output, /NodeRuntime disconnected/);
  assert.doesNotMatch(result.output, /nodejs process exited with code/);
});

test("unexpected NodeRuntime disconnects produce one normalized message", async () => {
  const tools = createCodexCommandTools();
  const initial = await tools.exec_command({
    cmd: process.execPath,
    args: [
      "-e",
      stdinScript(`
        process.stdout.write(
          "NodeRuntime disconnected\\n" +
          "NodeRuntime disconnected\\n" +
          "ego's nodejs process exited with code 1.\\n",
        );
        process.exitCode = 1;
      `),
    ],
    echo: false,
    input: " ",
    yield_time_ms: 5,
  });

  const result = await drain(tools, initial);
  assert.equal(result.exit_code, 1);
  assert.equal(
    result.output,
    "ego-browser command disconnected unexpectedly.\n",
  );
});

test("disconnect normalization handles diagnostics split across output chunks", async () => {
  const tools = createCodexCommandTools();
  const initial = await tools.exec_command({
    cmd: process.execPath,
    args: [
      "-e",
      stdinScript(`
        process.stdout.write("NodeRuntime dis");
        setTimeout(() => {
          process.stdout.write("connected\\n");
          process.exitCode = 1;
        }, 30);
      `),
    ],
    echo: false,
    input: " ",
    yield_time_ms: 5,
  });

  const result = await drain(tools, initial);
  assert.equal(
    result.output,
    "ego-browser command disconnected unexpectedly.\n",
  );
});

async function drain(tools, initialResult) {
  let result = initialResult;
  let output = result.output || "";
  while (result.session_id) {
    result = await tools.write_stdin({
      session_id: result.session_id,
      yield_time_ms: 20,
    });
    output += result.output || "";
  }
  return { ...result, output };
}

function stdinScript(body) {
  return `
    process.stdin.resume();
    process.stdin.once("end", () => {
      ${body}
    });
  `;
}
