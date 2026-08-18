import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  PageLedgerConflictError,
  PageLedgerStore,
} from "../dist/src/page-ledger.js";

async function withTempLedger(fn) {
  const rootDir = await mkdtemp(join(tmpdir(), "ego-page-ledger-test-"));
  try {
    return await fn(rootDir);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
}

test("page labels survive a new process and are never reused", async () => {
  await withTempLedger(async (rootDir) => {
    const firstRound = new PageLedgerStore({ rootDir, roundId: "round-a" });
    const first = await firstRound.addPage(7, "target-a");

    assert.equal(first.label, "p1");
    assert.equal(first.targetId, "target-a");

    const secondRound = new PageLedgerStore({ rootDir, roundId: "round-b" });
    assert.deepEqual(await secondRound.getPage(7, "p1"), first);

    await secondRound.closePage(7, "p1");
    await assert.rejects(
      () => secondRound.getPage(7, "p1"),
      /page p1 was closed/,
    );

    const next = await secondRound.addPage(7, "target-b");
    assert.equal(next.label, "p2");
  });
});

test("custom labels share the permanent used-label namespace", async () => {
  await withTempLedger(async (rootDir) => {
    const store = new PageLedgerStore({ rootDir, roundId: "round-a" });
    const page = await store.addPage(2, "target-login", { as: "login" });

    assert.equal(page.label, "login");
    await store.closePage(2, "login");
    await assert.rejects(
      () => store.addPage(2, "target-new", { as: "login" }),
      /page label already used: login/,
    );
  });
});

test("writes use a complete atomic ledger document", async () => {
  await withTempLedger(async (rootDir) => {
    const store = new PageLedgerStore({
      rootDir,
      roundId: "round-a",
      now: () => 1234,
    });
    await store.addPage(5, "target-a");

    const parsed = JSON.parse(
      await readFile(join(rootDir, "space-5.json"), "utf8"),
    );
    assert.deepEqual(parsed, {
      spaceId: 5,
      version: 1,
      writerRound: "round-a",
      nextLabel: 2,
      usedLabels: ["p1"],
      pages: {
        p1: {
          targetId: "target-a",
          openedBy: "agent",
          openedAt: 1234,
          lastUsedAt: 1234,
        },
      },
      touchedAt: 1234,
    });
  });
});

test("a stale round detects another writer instead of overwriting it", async () => {
  await withTempLedger(async (rootDir) => {
    const stale = new PageLedgerStore({ rootDir, roundId: "round-stale" });
    const winner = new PageLedgerStore({ rootDir, roundId: "round-winner" });

    await stale.read(9);
    await winner.addPage(9, "target-winner");

    await assert.rejects(
      () => stale.addPage(9, "target-stale"),
      (error) => {
        assert(error instanceof PageLedgerConflictError);
        assert.equal(error.spaceId, 9);
        assert.equal(error.expectedVersion, 0);
        assert.equal(error.actualVersion, 1);
        return true;
      },
    );

    const verifier = new PageLedgerStore({ rootDir, roundId: "round-c" });
    assert.equal((await verifier.getPage(9, "p1")).targetId, "target-winner");
  });
});

test("different spaces update independently", async () => {
  await withTempLedger(async (rootDir) => {
    const first = new PageLedgerStore({ rootDir, roundId: "round-a" });
    const second = new PageLedgerStore({ rootDir, roundId: "round-b" });

    const [pageA, pageB] = await Promise.all([
      first.addPage(1, "target-a"),
      second.addPage(2, "target-b"),
    ]);

    assert.equal(pageA.label, "p1");
    assert.equal(pageB.label, "p1");
  });
});

test("reconciliation removes missing targets but permanently retires their labels", async () => {
  await withTempLedger(async (rootDir) => {
    const store = new PageLedgerStore({ rootDir, roundId: "round-a" });
    await store.addPage(4, "target-live");
    await store.addPage(4, "target-closed");

    const reconciled = await store.reconcile(4, ["target-live"]);

    assert.deepEqual(Object.keys(reconciled.pages), ["p1"]);
    assert.deepEqual(reconciled.usedLabels, ["p1", "p2"]);
    await assert.rejects(() => store.getPage(4, "p2"), /page p2 was closed/);
    const next = await store.addPage(4, "target-next");
    assert.equal(next.label, "p3");
  });
});

test("reconciliation does not write a new version when every target is live", async () => {
  await withTempLedger(async (rootDir) => {
    const store = new PageLedgerStore({ rootDir, roundId: "round-a" });
    await store.addPage(6, "target-live");
    const before = await store.read(6);

    const after = await store.reconcile(6, ["target-live", "target-unknown"]);

    assert.equal(after.version, before.version);
    assert.deepEqual(after.pages, before.pages);
  });
});
