import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  cancelCommandSession,
  runCommand,
  startCommand,
  waitCommandSession,
} from "./run-command.mjs";

test("a command session is awaited through its id until an exit code is available", async () => {
  const { sessionId } = startCommand(
    process.execPath,
    ["-e", "process.stdout.write('session-finished')"],
    { echo: false, input: " " },
  );

  assert.match(sessionId, /^[0-9a-f-]+$/i);
  const result = await waitCommandSession(sessionId);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "session-finished");
});

test("cancellation targets one command session without interrupting another", async () => {
  let cancelledSessionId;
  const cancelled = startCommand(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)"],
    {
      echo: false,
      input: " ",
      onCancel: (sessionId) => {
        cancelledSessionId = sessionId;
      },
    },
  );
  const unaffected = startCommand(
    process.execPath,
    ["-e", "process.stdout.write('unaffected')"],
    { echo: false, input: " " },
  );

  assert.notEqual(cancelled.sessionId, unaffected.sessionId);
  assert.equal(cancelCommandSession(cancelled.sessionId), true);
  assert.equal(cancelledSessionId, cancelled.sessionId);
  await assert.rejects(
    waitCommandSession(cancelled.sessionId),
    (error) => error.cancelled === true,
  );
  assert.deepEqual(await waitCommandSession(unaffected.sessionId), {
    stdout: "unaffected",
    stderr: "",
    exitCode: 0,
    signal: null,
  });
});

test("runCommand kills the spawned process group before reporting a timeout", async (t) => {
  if (process.platform === "win32") {
    t.skip("POSIX process groups are not available on Windows");
    return;
  }

  const testDir = await mkdtemp(join(tmpdir(), "ego-run-command-"));
  const markerPath = join(testDir, "grandchild-survived");
  t.after(() => rm(testDir, { recursive: true, force: true }));

  const grandchildSource = `
    setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(markerPath)}, "alive"), 250);
    setTimeout(() => {}, 500);
  `;
  const childSource = `
    require("node:child_process").spawn(
      process.execPath,
      ["-e", ${JSON.stringify(grandchildSource)}],
      { stdio: "ignore" },
    );
    setInterval(() => {}, 1000);
  `;

  await assert.rejects(
    runCommand(process.execPath, ["-e", childSource], {
      echo: false,
      timeoutMs: 50,
    }),
    /timed out after 50ms/,
  );

  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(
    existsSync(markerPath),
    false,
    "a timed-out command must not leave its grandchild running",
  );
});
