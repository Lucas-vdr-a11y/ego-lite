import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
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

test("a live process exclusively owns a TaskSpace lease and a dead owner is recoverable", async () => {
  const lockRoot = await mkdtemp(join(tmpdir(), "ego-browser-lease-test-"));
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
        import { acquireTaskSpaceLease } from ${JSON.stringify(modulePath)};
        await acquireTaskSpaceLease(622, { lockRoot: ${JSON.stringify(lockRoot)} });
        process.stdout.write("ready\\n");
        setInterval(() => {}, 1000);
      `,
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );

  try {
    await waitForLine(child.stdout, "ready");

    await assert.rejects(
      () => acquireTaskSpaceLease(622, { lockRoot }),
      /TaskSpace 622 is already controlled by another ego-browser process/,
    );

    child.kill("SIGKILL");
    await new Promise((resolve) => child.once("close", resolve));

    await assert.doesNotReject(() => acquireTaskSpaceLease(622, { lockRoot }));
  } finally {
    child.kill("SIGKILL");
    releaseTaskSpaceLease();
    await rm(lockRoot, { recursive: true, force: true });
  }
});

test("a dead worker lease is recoverable while the shared host process stays alive", async () => {
  const lockRoot = await mkdtemp(
    join(tmpdir(), "ego-browser-worker-lease-test-"),
  );
  const id = 2_147_483_002;
  const worker = new Worker(
    `
      const { parentPort } = require("node:worker_threads");
      (async () => {
        const { acquireTaskSpaceLease } = await import(${JSON.stringify(modulePath)});
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

    await assert.rejects(
      async () => acquireTaskSpaceLease(id, { lockRoot }),
      /already controlled by another ego-browser process/,
    );

    await worker.terminate();
    await new Promise((resolve) => setTimeout(resolve, 150));

    await assert.doesNotReject(async () =>
      acquireTaskSpaceLease(id, { lockRoot }),
    );
  } finally {
    await worker.terminate();
    releaseTaskSpaceLease();
    await rm(lockRoot, { recursive: true, force: true });
  }
});

test("a live but busy worker does not lose its TaskSpace lease", async () => {
  const lockRoot = await mkdtemp(
    join(tmpdir(), "ego-browser-busy-lease-test-"),
  );
  const id = 2_147_483_003;
  const worker = new Worker(
    `
      const { parentPort } = require("node:worker_threads");
      (async () => {
        const { acquireTaskSpaceLease } = await import(${JSON.stringify(modulePath)});
        await acquireTaskSpaceLease(${id}, { lockRoot: ${JSON.stringify(lockRoot)} });
        parentPort.postMessage("ready");
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10_000);
        setInterval(() => {}, 1_000);
      })().catch((error) => {
        parentPort.postMessage({ error: error?.stack || String(error) });
      });
    `,
    { eval: true },
  );

  try {
    assert.equal(await waitForWorkerMessage(worker), "ready");
    await assert.rejects(
      () => acquireTaskSpaceLease(id, { lockRoot }),
      /already controlled by another ego-browser process/,
    );
  } finally {
    await worker.terminate();
    releaseTaskSpaceLease();
    await rm(lockRoot, { recursive: true, force: true });
  }
});

test("a live isolated worker keeps its lease without cross-worker messaging", async () => {
  const lockRoot = await mkdtemp(
    join(tmpdir(), "ego-browser-isolated-lease-test-"),
  );
  const id = 2_147_483_004;
  const worker = new Worker(
    `
      const { parentPort } = require("node:worker_threads");
      (async () => {
        const { acquireTaskSpaceLease } = await import(${JSON.stringify(modulePath)});
        await acquireTaskSpaceLease(${id}, { lockRoot: ${JSON.stringify(lockRoot)} });
        process.removeAllListeners("workerMessage");
        parentPort.postMessage("ready");
        setInterval(() => {}, 1_000);
      })().catch((error) => {
        parentPort.postMessage({ error: error?.stack || String(error) });
      });
    `,
    { eval: true },
  );

  try {
    assert.equal(await waitForWorkerMessage(worker), "ready");
    await assert.rejects(
      () => acquireTaskSpaceLease(id, { lockRoot }),
      /already controlled by another ego-browser process/,
    );
  } finally {
    await worker.terminate();
    releaseTaskSpaceLease();
    await rm(lockRoot, { recursive: true, force: true });
  }
});

test("a live pre-heartbeat lease is not reclaimed during an SDK upgrade", async () => {
  const lockRoot = await mkdtemp(
    join(tmpdir(), "ego-browser-legacy-lease-test-"),
  );
  const id = 2_147_483_005;
  const leasePath = join(lockRoot, String(id));
  await mkdir(leasePath);
  await writeFile(
    join(leasePath, "owner.json"),
    JSON.stringify({ pid: process.pid, threadId: 0, token: "legacy-owner" }),
  );
  const old = new Date(Date.now() - 60_000);
  await utimes(leasePath, old, old);

  try {
    await assert.rejects(
      () => acquireTaskSpaceLease(id, { lockRoot }),
      /already controlled by another ego-browser process/,
    );
  } finally {
    releaseTaskSpaceLease();
    await rm(lockRoot, { recursive: true, force: true });
  }
});

test("switchTaskSpace rejects a concurrent process before native selection", async () => {
  const id = 2_147_483_001;
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
        import { acquireTaskSpaceLease } from ${JSON.stringify(modulePath)};
        await acquireTaskSpaceLease(${id});
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

    await assert.rejects(
      () => switchTaskSpace(id),
      /already controlled by another ego-browser process/,
    );
    assert.equal(nativeSelections, 0);
  } finally {
    globalThis.ego = previousEgo;
    child.kill("SIGKILL");
    await new Promise((resolve) => child.once("close", resolve));
    await acquireTaskSpaceLease(id);
    releaseTaskSpaceLease(id);
  }
});

test("a failed Playwright reconnect releases the selected TaskSpace lease", async () => {
  const id = 2_147_483_006;
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
      await acquireTaskSpaceLease(${id});
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
  const id = 2_147_483_007;
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
      await acquireTaskSpaceLease(${id});
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
