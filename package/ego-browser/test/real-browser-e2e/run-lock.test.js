import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  acquireE2eLock,
  E2E_LOCK_BUSY_EXIT_CODE,
  formatLockConflict,
  isHolderAlive,
  parseLockHolder,
  serializeLockHolder,
} from "./run-lock.mjs";

const deadPid = () => {
  const error = new Error("no such process");
  error.code = "ESRCH";
  throw error;
};
const everyPidAlive = () => undefined;

async function withLockDir(body) {
  const dir = await mkdtemp(join(tmpdir(), "ego-e2e-lock-test-"));
  try {
    return await body(join(dir, ".e2e.lock"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("a second run is refused while the first holds the lock", async () => {
  await withLockDir(async (lockPath) => {
    const first = await acquireE2eLock(lockPath, { pid: 4242 });
    assert.equal(first.ok, true);

    const second = await acquireE2eLock(lockPath, {
      pid: 9999,
      kill: (pid) => (pid === 4242 ? undefined : deadPid()),
    });
    assert.equal(second.ok, false);
    assert.match(
      second.message,
      /already running \(PID 4242, started \d\d:\d\d:\d\d\)/,
    );
    assert.equal(E2E_LOCK_BUSY_EXIT_CODE, 2);
  });
});

test("a lock left by a dead run is reclaimed instead of wedging the suite", async () => {
  await withLockDir(async (lockPath) => {
    await writeFile(
      lockPath,
      serializeLockHolder({
        pid: 4242,
        host: hostname(),
        startedAt: new Date(0).toISOString(),
      }),
    );

    const result = await acquireE2eLock(lockPath, {
      pid: 9999,
      kill: deadPid,
    });
    assert.equal(result.ok, true);
    const holder = parseLockHolder(await readFile(lockPath, "utf8"));
    assert.equal(holder.pid, 9999);
  });
});

test("a truncated lock file is reclaimed rather than read as a live holder", async () => {
  await withLockDir(async (lockPath) => {
    await writeFile(lockPath, "{ this is not json");
    const result = await acquireE2eLock(lockPath, { pid: 9999 });
    assert.equal(result.ok, true);
    assert.equal(parseLockHolder(await readFile(lockPath, "utf8")).pid, 9999);
  });
});

test("release removes the lock so the next run can start", async () => {
  await withLockDir(async (lockPath) => {
    const first = await acquireE2eLock(lockPath, { pid: 4242 });
    await first.release();

    // Every pid reports alive here, so only real removal can let this through.
    const second = await acquireE2eLock(lockPath, {
      pid: 9999,
      kill: everyPidAlive,
    });
    assert.equal(second.ok, true);
  });
});

test("release does not delete a lock another run has already taken over", async () => {
  await withLockDir(async (lockPath) => {
    const first = await acquireE2eLock(lockPath, { pid: 4242 });
    const second = await acquireE2eLock(lockPath, {
      pid: 9999,
      kill: deadPid,
    });
    assert.equal(second.ok, true);

    // A late release from the dead run must not strip the new owner's lock.
    await first.release();
    const holder = parseLockHolder(await readFile(lockPath, "utf8"));
    assert.equal(holder.pid, 9999);
  });
});

test("a lock recorded by another machine is not honoured", async () => {
  await withLockDir(async (lockPath) => {
    await writeFile(
      lockPath,
      serializeLockHolder({
        pid: 4242,
        host: "some-other-build-agent",
        startedAt: new Date().toISOString(),
      }),
    );
    const result = await acquireE2eLock(lockPath, {
      pid: 9999,
      host: "this-machine",
      kill: everyPidAlive,
    });
    assert.equal(result.ok, true);
  });
});

test("a holder owned by another user still counts as running", () => {
  const alive = isHolderAlive(4242, () => {
    const error = new Error("operation not permitted");
    error.code = "EPERM";
    throw error;
  });
  assert.equal(alive, true);
});

test("the conflict message names the shared browser as the reason", () => {
  const message = formatLockConflict(
    { pid: 321, startedAt: "2026-08-16T07:43:53.000Z" },
    "/repo/.e2e.lock",
  );
  assert.match(message, /PID 321/);
  assert.match(message, /one shared ego lite browser/);
  assert.match(message, /\/repo\/\.e2e\.lock/);
});
