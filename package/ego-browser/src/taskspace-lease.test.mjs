import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { Worker } from "node:worker_threads";
import test from "node:test";

import {
  acquireTaskSpaceLease,
  releaseTaskSpaceLease,
} from "../dist/src/taskspace-lease.js";
import {
  __testing,
  helperContext,
  switchTaskSpace,
} from "../dist/src/helpers.js";

const modulePath = fileURLToPath(
  new URL("../dist/src/taskspace-lease.js", import.meta.url),
);

function readOwnerFile(lockRoot, id) {
  return JSON.parse(readFileSync(join(lockRoot, String(id), "owner.json")));
}

test("an acquire takes over a live holder in another process and notifies it", async () => {
  const lockRoot = await mkdtemp(join(tmpdir(), "ego-browser-lease-test-"));
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
        import { acquireTaskSpaceLease, onTaskSpaceLeaseLost } from ${JSON.stringify(modulePath)};
        onTaskSpaceLeaseLost(({ id }) => {
          process.stdout.write("lost:" + id + "\\n");
          process.exit(43);
        });
        await acquireTaskSpaceLease(622, {
          heartbeatIntervalMs: 25,
          lockRoot: ${JSON.stringify(lockRoot)},
          staleAfterMs: 200,
        });
        process.stdout.write("ready\\n");
        setInterval(() => {}, 1000);
      `,
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );

  try {
    await waitForLine(child.stdout, "ready");
    const lostNotice = waitForLine(child.stdout, "lost:622");

    assert.equal(await acquireTaskSpaceLease(622, { lockRoot }), true);
    const owner = readOwnerFile(lockRoot, 622);
    assert.equal(owner.takenOverFrom?.pid, child.pid);

    await lostNotice;
    const code = await new Promise((resolve) => child.once("close", resolve));
    assert.equal(code, 43);
  } finally {
    child.kill("SIGKILL");
    releaseTaskSpaceLease();
    await rm(lockRoot, { recursive: true, force: true });
  }
});

test("an acquire takes over a worker holder inside the shared host process", async () => {
  const lockRoot = await mkdtemp(
    join(tmpdir(), "ego-browser-worker-lease-test-"),
  );
  const id = 2_147_483_002;
  const worker = new Worker(
    `
      const { parentPort } = require("node:worker_threads");
      (async () => {
        const { acquireTaskSpaceLease, onTaskSpaceLeaseLost } = await import(${JSON.stringify(modulePath)});
        onTaskSpaceLeaseLost((lost) => parentPort.postMessage({ lost: lost.id }));
        await acquireTaskSpaceLease(${id}, {
          heartbeatIntervalMs: 20,
          lockRoot: ${JSON.stringify(lockRoot)},
          staleAfterMs: 100,
        });
        process.removeAllListeners("exit");
        parentPort.postMessage({ pid: process.pid });
        setInterval(() => {}, 1_000);
      })().catch((error) => {
        parentPort.postMessage({ error: error?.stack || String(error) });
      });
    `,
    { eval: true },
  );

  try {
    const ready = await waitForWorkerMessage(worker);
    if (ready.error) throw new Error(ready.error);
    assert.equal(ready.pid, process.pid);

    assert.equal(await acquireTaskSpaceLease(id, { lockRoot }), true);
    assert.equal(readOwnerFile(lockRoot, id).takenOverFrom?.pid, process.pid);

    const lost = await waitForWorkerMessage(worker);
    assert.equal(lost.lost, id);
  } finally {
    await worker.terminate();
    releaseTaskSpaceLease();
    await rm(lockRoot, { recursive: true, force: true });
  }
});

test("a busy holder is taken over and notified once it unblocks", async () => {
  const lockRoot = await mkdtemp(
    join(tmpdir(), "ego-browser-busy-lease-test-"),
  );
  const id = 2_147_483_003;
  const worker = new Worker(
    `
      const { parentPort } = require("node:worker_threads");
      (async () => {
        const { acquireTaskSpaceLease, onTaskSpaceLeaseLost } = await import(${JSON.stringify(modulePath)});
        onTaskSpaceLeaseLost((lost) => parentPort.postMessage({ lost: lost.id }));
        await acquireTaskSpaceLease(${id}, {
          heartbeatIntervalMs: 20,
          lockRoot: ${JSON.stringify(lockRoot)},
          staleAfterMs: 100,
        });
        parentPort.postMessage("ready");
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
        setInterval(() => {}, 1_000);
      })().catch((error) => {
        parentPort.postMessage({ error: error?.stack || String(error) });
      });
    `,
    { eval: true },
  );

  try {
    assert.equal(await waitForWorkerMessage(worker), "ready");
    assert.equal(await acquireTaskSpaceLease(id, { lockRoot }), true);
    const lost = await waitForWorkerMessage(worker);
    assert.equal(lost.lost, id);
  } finally {
    await worker.terminate();
    releaseTaskSpaceLease();
    await rm(lockRoot, { recursive: true, force: true });
  }
});

test("re-acquiring the TaskSpace already held by this session is a no-op", async () => {
  const lockRoot = await mkdtemp(
    join(tmpdir(), "ego-browser-reacquire-lease-test-"),
  );
  const id = 2_147_483_004;

  try {
    assert.equal(await acquireTaskSpaceLease(id, { lockRoot }), true);
    const owner = readOwnerFile(lockRoot, id);
    assert.equal(await acquireTaskSpaceLease(id, { lockRoot }), false);
    assert.equal(readOwnerFile(lockRoot, id).token, owner.token);
  } finally {
    releaseTaskSpaceLease();
    await rm(lockRoot, { recursive: true, force: true });
  }
});

test("an abandoned incomplete lease directory is reclaimed without an audit trail", async () => {
  const lockRoot = await mkdtemp(
    join(tmpdir(), "ego-browser-incomplete-lease-test-"),
  );
  const id = 2_147_483_005;
  const leasePath = join(lockRoot, String(id));
  await mkdir(leasePath);
  // Backdate the directory past any grace window: this is a crashed acquire's
  // leftover, not an acquire that is still publishing its owner file.
  const past = new Date(Date.now() - 60_000);
  await utimes(leasePath, past, past);

  try {
    const started = Date.now();
    assert.equal(await acquireTaskSpaceLease(id, { lockRoot }), true);
    assert.ok(
      Date.now() - started < 2_000,
      "an abandoned incomplete directory is reclaimed promptly",
    );
    assert.equal(readOwnerFile(lockRoot, id).takenOverFrom, undefined);
  } finally {
    releaseTaskSpaceLease();
    await rm(lockRoot, { recursive: true, force: true });
  }
});

test("an acquire caught between mkdir and publish is taken over, not destroyed", async () => {
  const lockRoot = await mkdtemp(
    join(tmpdir(), "ego-browser-inflight-lease-test-"),
  );
  const id = 2_147_483_009;
  const leasePath = join(lockRoot, String(id));
  // Another session's acquire has created the directory but not yet written
  // owner.json — the window between mkdirSync and the owner publish.
  await mkdir(leasePath);
  const publishDelayMs = 150;
  const publisher = setTimeout(() => {
    writeFile(
      join(leasePath, "owner.json"),
      JSON.stringify({
        heartbeatIntervalMs: 25,
        pid: process.pid,
        staleAfterMs: 3_000,
        threadId: 0,
        token: "publisher-token",
      }),
    ).catch(() => {});
    writeFile(join(leasePath, "heartbeat-publisher-token"), "").catch(() => {});
  }, publishDelayMs);

  try {
    const started = Date.now();
    assert.equal(
      await acquireTaskSpaceLease(id, {
        lockRoot,
        heartbeatIntervalMs: 25,
        staleAfterMs: 3_000,
      }),
      true,
    );
    assert.ok(
      Date.now() - started >= publishDelayMs - 50,
      "the contender waits for the in-flight publish instead of racing it",
    );
    assert.equal(
      readOwnerFile(lockRoot, id).takenOverFrom?.token,
      "publisher-token",
      "the settled owner is taken over with an audit trail, not silently destroyed",
    );
  } finally {
    clearTimeout(publisher);
    releaseTaskSpaceLease();
    await rm(lockRoot, { recursive: true, force: true });
  }
});

test("a fresh incomplete lease directory is reclaimed only after the grace window", async () => {
  const lockRoot = await mkdtemp(
    join(tmpdir(), "ego-browser-grace-lease-test-"),
  );
  const id = 2_147_483_010;
  await mkdir(join(lockRoot, String(id)));

  try {
    const started = Date.now();
    assert.equal(
      await acquireTaskSpaceLease(id, {
        lockRoot,
        heartbeatIntervalMs: 25,
        staleAfterMs: 200,
      }),
      true,
    );
    const elapsed = Date.now() - started;
    assert.ok(
      elapsed >= 150,
      `a fresh incomplete directory gets the grace window (elapsed ${elapsed}ms)`,
    );
    assert.equal(readOwnerFile(lockRoot, id).takenOverFrom, undefined);
  } finally {
    releaseTaskSpaceLease();
    await rm(lockRoot, { recursive: true, force: true });
  }
});

test("a legacy pre-heartbeat lease is taken over with an audit trail", async () => {
  const lockRoot = await mkdtemp(
    join(tmpdir(), "ego-browser-legacy-lease-test-"),
  );
  const id = 2_147_483_006;
  const leasePath = join(lockRoot, String(id));
  await mkdir(leasePath);
  await writeFile(
    join(leasePath, "owner.json"),
    JSON.stringify({ pid: process.pid, threadId: 0, token: "legacy-owner" }),
  );

  try {
    assert.equal(await acquireTaskSpaceLease(id, { lockRoot }), true);
    assert.equal(
      readOwnerFile(lockRoot, id).takenOverFrom?.token,
      "legacy-owner",
    );
  } finally {
    releaseTaskSpaceLease();
    await rm(lockRoot, { recursive: true, force: true });
  }
});

test("switchTaskSpace takes over a concurrent session before native selection", async () => {
  const id = 2_147_483_001;
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
        import { acquireTaskSpaceLease, onTaskSpaceLeaseLost } from ${JSON.stringify(modulePath)};
        onTaskSpaceLeaseLost(() => process.exit(43));
        await acquireTaskSpaceLease(${id}, { heartbeatIntervalMs: 25, staleAfterMs: 200 });
        process.stdout.write("ready\\n");
        setInterval(() => {}, 1000);
      `,
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  const previousEgo = globalThis.ego;
  let nativeSelections = 0;

  try {
    await waitForLine(child.stdout, "ready");
    globalThis.ego = {
      async listTaskSpaces() {
        return {
          taskSpaces: [
            {
              taskId: "lease-test",
              id,
              name: "lease-test",
              ownership: "agent",
            },
          ],
        };
      },
      async useTaskSpace() {
        nativeSelections += 1;
      },
    };

    await switchTaskSpace(id);
    assert.equal(nativeSelections, 1);

    const code = await new Promise((resolve) => child.once("close", resolve));
    assert.equal(code, 43);
  } finally {
    globalThis.ego = previousEgo;
    child.kill("SIGKILL");
    releaseTaskSpaceLease(id);
  }
});

test("a failed Playwright reconnect releases the selected TaskSpace lease", async () => {
  const id = 2_147_483_007;
  const previousEgo = globalThis.ego;
  const restoreConnector = __testing.setPlaywrightTaskSpaceConnector(
    async () => {
      throw new Error("Playwright reconnect failed");
    },
  );

  try {
    globalThis.ego = {
      async listTaskSpaces() {
        return {
          taskSpaces: [
            {
              taskId: "reconnect-failure",
              id,
              name: "reconnect-failure",
              ownership: "agent",
            },
          ],
        };
      },
      async useTaskSpace() {},
    };

    await assert.rejects(
      () => helperContext().egoBrowser.switchTaskSpace(id),
      /Playwright reconnect failed/,
    );

    const child = await runChild(`
      import { acquireTaskSpaceLease, releaseTaskSpaceLease } from ${JSON.stringify(modulePath)};
      import { readFileSync } from "node:fs";
      import { tmpdir } from "node:os";
      import { join } from "node:path";
      await acquireTaskSpaceLease(${id});
      const root = join(tmpdir(), "ego-browser-taskspace-leases-" + process.getuid());
      const owner = JSON.parse(readFileSync(join(root, "${id}", "owner.json")));
      if (owner.takenOverFrom) {
        console.error("lease was not released: " + JSON.stringify(owner.takenOverFrom));
        process.exit(7);
      }
      releaseTaskSpaceLease(${id});
    `);
    assert.equal(child.code, 0, child.stderr);
  } finally {
    restoreConnector();
    globalThis.ego = previousEgo;
    releaseTaskSpaceLease(id);
  }
});

test("a failed same-TaskSpace reselection releases the previous lease", async () => {
  const id = 2_147_483_008;
  const previousEgo = globalThis.ego;
  let selectionCount = 0;
  const restoreConnector = __testing.setPlaywrightTaskSpaceConnector(
    async () => ({ page: {}, context: {}, async close() {} }),
  );

  try {
    globalThis.ego = {
      async listTaskSpaces() {
        return {
          taskSpaces: [
            {
              taskId: "reselection-failure",
              id,
              name: "reselection-failure",
              ownership: "agent",
            },
          ],
        };
      },
      async useTaskSpace() {
        selectionCount += 1;
        return selectionCount === 1
          ? {}
          : { error: "TaskSpace reselection failed" };
      },
    };

    const context = helperContext();
    await context.egoBrowser.switchTaskSpace(id);
    await assert.rejects(
      () => context.egoBrowser.switchTaskSpace(id),
      /TaskSpace reselection failed/,
    );

    const child = await runChild(`
      import { acquireTaskSpaceLease, releaseTaskSpaceLease } from ${JSON.stringify(modulePath)};
      import { readFileSync } from "node:fs";
      import { tmpdir } from "node:os";
      import { join } from "node:path";
      await acquireTaskSpaceLease(${id});
      const root = join(tmpdir(), "ego-browser-taskspace-leases-" + process.getuid());
      const owner = JSON.parse(readFileSync(join(root, "${id}", "owner.json")));
      if (owner.takenOverFrom) {
        console.error("lease was not released: " + JSON.stringify(owner.takenOverFrom));
        process.exit(7);
      }
      releaseTaskSpaceLease(${id});
    `);
    assert.equal(child.code, 0, child.stderr);
  } finally {
    restoreConnector();
    globalThis.ego = previousEgo;
    releaseTaskSpaceLease(id);
  }
});

function waitForLine(stream, expected) {
  return new Promise((resolve, reject) => {
    let output = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      output += chunk;
      if (output.split("\n").includes(expected)) resolve();
    });
    stream.on("error", reject);
  });
}

function waitForWorkerMessage(worker) {
  return new Promise((resolve, reject) => {
    worker.once("message", resolve);
    worker.once("error", reject);
  });
}

function runChild(source) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--input-type=module", "-e", source],
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stderr }));
  });
}
