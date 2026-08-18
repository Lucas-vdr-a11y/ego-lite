import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NativeOperationGate } from "../dist/src/native-gate.js";
import { PageLedgerStore } from "../dist/src/page-ledger.js";
import { createTaskSpaceHandle } from "../dist/src/page-model.js";

async function withFixture(fn) {
  const rootDir = await mkdtemp(join(tmpdir(), "ego-page-model-test-"));
  try {
    return await fn(createFixture(rootDir));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
}

function createFixture(rootDir) {
  const calls = [];
  const tabs = new Map();
  let nextTarget = 1;
  let selectedSpace = null;
  let activeTarget = null;
  async function ensureTargetSession(targetId) {
    assert(tabs.has(targetId), `unknown target ${targetId}`);
    calls.push(["ensureSession", targetId]);
    return `session:${targetId}`;
  }
  const gate = new NativeOperationGate({
    async selectSpace(spaceId) {
      selectedSpace = spaceId;
      calls.push(["selectSpace", spaceId]);
    },
    ensureSession: ensureTargetSession,
  });
  const services = {
    gate,
    async createTab(url) {
      assert.equal(selectedSpace, 7);
      const targetId = `target-${nextTarget++}`;
      tabs.set(targetId, { targetId, url, title: url, active: true });
      activeTarget = targetId;
      calls.push(["createTab", url, targetId]);
      return targetId;
    },
    async listTabs() {
      assert.equal(selectedSpace, 7);
      return [...tabs.values()].map((tab) => ({
        ...tab,
        active: tab.targetId === activeTarget,
      }));
    },
    async cdp(method, params, sessionId) {
      calls.push(["cdp", method, params, sessionId]);
      if (method === "Page.navigate") {
        const targetId = sessionId.slice("session:".length);
        tabs.get(targetId).url = params.url;
        tabs.get(targetId).title = params.url;
        return { frameId: "frame-1" };
      }
      if (method === "Runtime.evaluate") {
        return { result: { type: "string", value: "complete" } };
      }
      if (method === "Target.activateTarget") {
        activeTarget = params.targetId;
        return { success: true };
      }
      if (method === "Target.closeTarget") {
        tabs.delete(params.targetId);
        if (activeTarget === params.targetId) activeTarget = null;
        return { success: true };
      }
      throw new Error(`unexpected CDP method ${method}`);
    },
    async snapshot() {
      const tab = tabs.get(activeTarget);
      return { content: `snapshot:${tab?.url}`, refs: [] };
    },
    ensureSession: ensureTargetSession,
    invalidateSession(targetId) {
      calls.push(["invalidateSession", targetId]);
    },
    setPreferredTarget(targetId) {
      calls.push(["setPreferredTarget", targetId]);
    },
    now: () => Date.now(),
    sleep: async () => {},
  };
  return {
    activeTarget: () => activeTarget,
    calls,
    gate,
    rootDir,
    services,
    tabs,
  };
}

function taskForRound(fixture, roundId, overrides = {}) {
  return createTaskSpaceHandle(
    { id: 7, name: "research", ownership: "agent" },
    {
      ledger: new PageLedgerStore({ rootDir: fixture.rootDir, roundId }),
      ...fixture.services,
      ...overrides,
    },
  );
}

test("a page label restores in a new round and goto reuses its target", async () => {
  await withFixture(async (fixture) => {
    const firstRound = taskForRound(fixture, "round-a");
    const created = await firstRound.newPage("https://example.test/first");

    assert.equal(created.label, "p1");
    assert.equal(created.spaceId, 7);
    assert.equal(created.targetId, "target-1");
    assert.equal(created.openedBy, "agent");
    assert.equal(fixture.tabs.size, 1);

    const secondRound = taskForRound(fixture, "round-b");
    const restored = secondRound.page("p1");
    await restored.goto("https://example.test/second");

    assert.equal(restored.targetId, "target-1");
    assert.equal(fixture.tabs.size, 1, "goto must not create a second tab");
    assert.equal(
      fixture.tabs.get("target-1").url,
      "https://example.test/second",
    );
    assert.equal(
      await restored.snapshot(),
      "snapshot:https://example.test/second",
    );
  });
});

test("snapshot activates the addressed page, not whichever tab was current", async () => {
  await withFixture(async (fixture) => {
    const task = taskForRound(fixture, "round-a");
    const first = await task.newPage("https://example.test/first");
    await task.newPage("https://example.test/second");

    assert.equal(fixture.activeTarget(), "target-2");
    assert.equal(await first.snapshot(), "snapshot:https://example.test/first");
    assert.equal(fixture.activeTarget(), "target-1");
  });
});

test("close leaves an anchor tab and the next page gets a new label", async () => {
  await withFixture(async (fixture) => {
    const task = taskForRound(fixture, "round-a");
    const first = await task.newPage("https://example.test/first");

    await first.close();
    assert.equal(fixture.tabs.has("target-1"), false);
    assert.equal(
      fixture.tabs.size,
      1,
      "the task space must retain an anchor tab",
    );
    await assert.rejects(
      () => task.page("p1").goto("https://example.test/closed"),
      /page p1 was closed/,
    );

    const second = await task.newPage("https://example.test/second");
    assert.equal(second.label, "p2");
    assert.equal(second.targetId, "target-3");
  });
});

test("a ledger failure closes the newly created uncommitted tab", async () => {
  await withFixture(async (fixture) => {
    const task = createTaskSpaceHandle(
      { id: 7, name: "research", ownership: "agent" },
      {
        ...fixture.services,
        ledger: {
          async reconcile() {
            return { pages: {} };
          },
          async addPage() {
            throw new Error("ledger unavailable");
          },
        },
      },
    );

    await assert.rejects(
      () => task.newPage("https://example.test/uncommitted"),
      /ledger unavailable/,
    );
    assert.equal(fixture.tabs.size, 0);
    assert(
      fixture.calls.some(
        ([kind, method]) => kind === "cdp" && method === "Target.closeTarget",
      ),
    );
  });
});

test("listPages combines managed labels with live browser information", async () => {
  await withFixture(async (fixture) => {
    const task = taskForRound(fixture, "round-a");
    const managed = await task.newPage("https://example.test/managed");
    fixture.tabs.set("target-user", {
      targetId: "target-user",
      url: "https://example.test/user",
      title: "User page",
      active: false,
    });

    const pages = await task.listPages();
    const managedItem = pages.find((item) => item.label === "p1");
    const unknownItem = pages.find((item) => item.targetId === "target-user");

    assert.equal(managedItem.page.label, "p1");
    assert.equal(managedItem.page.targetId, managed.targetId);
    assert.equal(managedItem.title, "https://example.test/managed");
    assert.equal(managedItem.openedBy, "agent");
    assert.equal(unknownItem.label, undefined);
    assert.equal(unknownItem.page, undefined);
    assert.equal(unknownItem.title, "User page");
    assert.equal(unknownItem.openedBy, "unknown");
  });
});

test("listPages retires a managed label when its browser tab disappeared", async () => {
  await withFixture(async (fixture) => {
    const task = taskForRound(fixture, "round-a");
    const page = await task.newPage("https://example.test/managed");
    fixture.tabs.delete(page.targetId);

    assert.deepEqual(await task.listPages(), []);
    await assert.rejects(
      () => task.page("p1").snapshot(),
      /page p1 was closed/,
    );
  });
});

test("newPage rejects before creating a tab when the managed budget is full", async () => {
  await withFixture(async (fixture) => {
    const task = taskForRound(fixture, "round-a", { pageBudget: 2 });
    const first = await task.newPage("https://example.test/first");
    await task.newPage("https://example.test/second");

    await assert.rejects(
      () => task.newPage("https://example.test/third"),
      (error) => {
        assert.match(
          error.message,
          /Page budget reached \(2\/2\) in space "research"/,
        );
        assert.match(error.message, /p1\s+"https:\/\/example\.test\/first"/);
        assert.match(
          error.message,
          /Close: await task\.page\('p1'\)\.close\(\)/,
        );
        assert.match(
          error.message,
          /Reuse: await task\.page\('p1'\)\.goto\(url\)/,
        );
        return true;
      },
    );
    assert.equal(
      fixture.tabs.size,
      2,
      "budget rejection must happen before createTab",
    );

    await first.close();
    const replacement = await task.newPage("https://example.test/third");
    assert.equal(replacement.label, "p3");
    assert.equal(fixture.tabs.size, 2);
  });
});

test("a tab closed outside the runtime frees budget on the next newPage", async () => {
  await withFixture(async (fixture) => {
    const task = taskForRound(fixture, "round-a", { pageBudget: 2 });
    const first = await task.newPage("https://example.test/first");
    await task.newPage("https://example.test/second");
    fixture.tabs.delete(first.targetId);

    const replacement = await task.newPage("https://example.test/third");

    assert.equal(replacement.label, "p3");
    assert.equal(fixture.tabs.size, 2);
    await assert.rejects(
      () => task.page("p1").snapshot(),
      /page p1 was closed/,
    );
  });
});

test("newPage never closes a managed page when native returns its target again", async () => {
  await withFixture(async (fixture) => {
    const firstTask = taskForRound(fixture, "round-a");
    const first = await firstTask.newPage("https://example.test/first");
    const closeCallsBefore = fixture.calls.filter(
      ([kind, method]) => kind === "cdp" && method === "Target.closeTarget",
    ).length;
    const secondTask = taskForRound(fixture, "round-a", {
      async createTab() {
        return first.targetId;
      },
    });

    await assert.rejects(
      () => secondTask.newPage("https://example.test/second"),
      /did not create a distinct tab.*already page p1/,
    );

    assert.equal(fixture.tabs.has(first.targetId), true);
    assert.equal(
      fixture.calls.filter(
        ([kind, method]) => kind === "cdp" && method === "Target.closeTarget",
      ).length,
      closeCallsBefore,
    );
  });
});
