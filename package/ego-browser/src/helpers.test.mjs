import test from "node:test";
import assert from "node:assert/strict";

import * as helperExports from "../dist/src/helpers.js";
import { PUBLIC_API_DOCS } from "../dist/src/format.js";
import { setOverrides } from "../dist/src/state.js";
import {
  clearPreferredTarget,
  drainBrowserEvents,
  invalidateSession,
} from "../dist/src/browser-runtime.js";
import { runWithTarget } from "../dist/src/target-context.js";
import {
  claimTaskSpace,
  completeTaskSpace,
  handOffTaskSpace,
  initializePageFacade,
  newTaskSpace,
  helperContext,
  listTaskSpaces,
  useOrCreateTaskSpace,
  switchTaskSpace,
  waitForAgentControl,
} from "../dist/src/helpers.js";

function withEgo(ego, fn) {
  const previous = globalThis.ego;
  globalThis.ego = ego;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (previous === undefined) {
        delete globalThis.ego;
      } else {
        globalThis.ego = previous;
      }
    });
}

function callablePaths(value, prefix, depth = 3) {
  const paths = [];
  for (const [key, child] of Object.entries(value)) {
    const path = `${prefix}.${key}`;
    if (typeof child === "function") {
      paths.push(path);
    } else if (child && typeof child === "object" && depth > 0) {
      paths.push(...callablePaths(child, path, depth - 1));
    }
  }
  return paths;
}

async function waitForCdpCall(calls, method) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (calls.some((call) => call.method === method)) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`timed out waiting for CDP call: ${method}`);
}

test("listTaskSpaces normalizes the current taskSpaces binding shape", async () => {
  await withEgo(
    {
      async listTaskSpaces() {
        return {
          taskSpaces: [
            {
              taskId: "checkout-flow",
              id: 7,
              name: "Checkout flow",
              createdBy: "agent",
              ownership: "agent",
              recentTabTitles: ["Checkout", "Cart"],
            },
          ],
        };
      },
    },
    async () => {
      assert.deepEqual(await listTaskSpaces(), [
        {
          taskId: "checkout-flow",
          id: 7,
          name: "Checkout flow",
          createdBy: "agent",
          ownership: "agent",
          recentTabTitles: ["Checkout", "Cart"],
        },
      ]);
    },
  );
});

test("listTaskSpaces rejects legacy taskIds results", async () => {
  await withEgo(
    {
      async listTaskSpaces() {
        return { taskIds: ["checkout-flow", "research-session"] };
      },
    },
    async () => {
      await assert.rejects(
        () => listTaskSpaces(),
        /listTaskSpaces expected \{ taskSpaces: \[\.\.\.\] \}/,
      );
    },
  );
});

test("listTaskSpaces throws on binding error objects", async () => {
  await withEgo(
    {
      async listTaskSpaces() {
        return { error: "The task is under user control" };
      },
    },
    async () => {
      await assert.rejects(
        () => listTaskSpaces(),
        /listTaskSpaces: The task is under user control/,
      );
    },
  );
});

test("egoBrowser owns the canonical TaskSpace surface", () => {
  const context = helperContext();

  assert.deepEqual(Object.keys(context.egoBrowser).sort(), [
    "claimTaskSpace",
    "closeTaskSpace",
    "completeTaskSpace",
    "handOffTaskSpace",
    "listTaskSpaces",
    "newTaskSpace",
    "switchTaskSpace",
    "takeOverTaskSpace",
    "useOrCreateTaskSpace",
    "waitForAgentControlTaskSpace",
  ]);
  assert.equal(context.taskSpaces, undefined);
  assert.equal(context.egoBrowser.newPage, undefined);
  assert.equal(context.egoBrowser.newContext, undefined);
  assert.equal(context.egoBrowser.contexts, undefined);
  assert.equal(context.egoBrowser.close, undefined);
});

test("egoBrowser useOrCreateTaskSpace returns a bound TaskSpace", async () => {
  const task = {
    taskId: "checkout-flow",
    id: 17,
    name: "Checkout flow",
    ownership: "agent",
  };

  await withEgo(
    {
      async listTaskSpaces() {
        return { taskSpaces: [task] };
      },
      async useTaskSpace() {
        return {};
      },
    },
    async () => {
      const space = await helperContext().egoBrowser.useOrCreateTaskSpace(
        task.id,
      );
      assert.equal(space.id, task.id);
      assert.equal(typeof space.tabs.current, "function");
    },
  );
});

test("egoBrowser claimTaskSpace returns a bound TaskSpace", async () => {
  const task = {
    taskId: "checkout-flow",
    id: 18,
    name: "Checkout flow",
    ownership: "user",
  };

  await withEgo(
    {
      async listTaskSpaces() {
        return { taskSpaces: [task] };
      },
      async claimTaskSpace(id, name) {
        return { ...task, id, name, ownership: "agent" };
      },
      async useTaskSpace() {
        return {};
      },
    },
    async () => {
      const space = await helperContext().egoBrowser.claimTaskSpace(task.id);
      assert.equal(space.ownership, "agent");
      assert.equal(typeof space.tabs.current, "function");
    },
  );
});

test("egoBrowser handOffTaskSpace preserves the handoff result", async () => {
  const task = {
    taskId: "checkout-flow",
    id: 19,
    name: "Checkout flow",
    ownership: "agent",
  };

  await withEgo(
    {
      async listTaskSpaces() {
        return { taskSpaces: [task] };
      },
      async useTaskSpace() {
        return {};
      },
      async handOffTaskSpace() {
        return {};
      },
    },
    async () => {
      assert.deepEqual(
        await helperContext().egoBrowser.handOffTaskSpace(task.id),
        { done: true },
      );
    },
  );
});

test("egoBrowser takeOverTaskSpace restores control", async () => {
  const calls = [];
  const task = {
    taskId: "checkout-flow",
    id: 20,
    name: "Checkout flow",
    ownership: "agentDelegatedToUser",
  };

  await withEgo(
    {
      async listTaskSpaces() {
        return { taskSpaces: [task] };
      },
      async useTaskSpace(id) {
        calls.push(["useTaskSpace", id]);
        return {};
      },
      async takeOverTaskSpace() {
        calls.push(["takeOverTaskSpace"]);
        return {};
      },
    },
    async () => {
      assert.equal(
        await helperContext().egoBrowser.takeOverTaskSpace(task.id),
        undefined,
      );
    },
  );

  assert.deepEqual(calls, [["useTaskSpace", task.id], ["takeOverTaskSpace"]]);
});

test("egoBrowser lists lightweight TaskSpace information without switching", async () => {
  const calls = [];
  const task = {
    taskId: "inspect-products",
    id: 7,
    name: "Inspect products",
    ownership: "agent",
    recentTabTitles: ["Products"],
  };

  await withEgo(
    {
      async listTaskSpaces() {
        calls.push(["listTaskSpaces"]);
        return { taskSpaces: [task] };
      },
      async useTaskSpace(id) {
        calls.push(["useTaskSpace", id]);
        return {};
      },
    },
    async () => {
      assert.deepEqual(await helperContext().egoBrowser.listTaskSpaces(), [
        task,
      ]);
    },
  );

  assert.deepEqual(calls, [["listTaskSpaces"]]);
});

test("egoBrowser returns TaskSpace and target-bound Tab objects", async () => {
  const calls = [];
  const task = {
    taskId: "inspect-products",
    id: 7,
    name: "Inspect products",
    createdBy: "agent",
    ownership: "agent",
  };
  await withEgo(
    {
      async createTaskSpace(name) {
        calls.push(["createTaskSpace", name]);
        return task;
      },
      async listTaskSpaces() {
        calls.push(["listTaskSpaces"]);
        return { taskSpaces: [task] };
      },
      async useTaskSpace(id) {
        calls.push(["useTaskSpace", id]);
        return {};
      },
      async listTabs() {
        calls.push(["listTabs"]);
        return {
          tabs: [
            {
              targetId: "target-products",
              active: true,
              title: "Products",
              url: "https://example.com/products",
            },
          ],
        };
      },
    },
    async () => {
      const space =
        await helperContext().egoBrowser.newTaskSpace("inspect-products");
      assert.equal(space.id, 7);
      assert.equal(space.name, "Inspect products");
      assert.equal(typeof space.tabs.list, "function");

      const [tab] = await space.tabs.list();
      assert.equal(tab.targetId, "target-products");
      assert.equal(tab.page.targetId, "target-products");
      assert.equal(
        tab.page.url(),
        "https://example.com/products",
        "a target-bound Page exposes Playwright's synchronous url() read",
      );
      assert.equal(typeof tab.page.locator, "function");
      assert.equal(typeof tab.activate, "function");
      assert.equal(typeof tab.close, "function");
      assert.deepEqual(Object.keys(tab).sort(), [
        "targetId",
        "title",
        "type",
        "url",
      ]);
    },
  );

  assert.deepEqual(calls, [
    ["createTaskSpace", "inspect-products"],
    ["useTaskSpace", 7],
    ["listTabs"],
  ]);
});

test("a TaskSpace Tab Page reselects its space before target operations", async () => {
  const spaces = [
    {
      taskId: "products",
      id: 7,
      name: "Products",
      ownership: "agent",
    },
    {
      taskId: "other",
      id: 8,
      name: "Other",
      ownership: "agent",
    },
  ];
  const calls = [];
  let currentTaskSpaceId = 7;
  const runtime = {
    async listTaskSpaces() {
      return { taskSpaces: spaces };
    },
    async useTaskSpace(id) {
      calls.push(["useTaskSpace", id]);
      currentTaskSpaceId = id;
      return {};
    },
    async listTabs() {
      calls.push(["listTabs", currentTaskSpaceId]);
      return {
        tabs: [
          currentTaskSpaceId === 7
            ? {
                targetId: "target-products",
                active: true,
                title: "Products",
                url: "https://example.com/products",
              }
            : {
                targetId: "target-other",
                active: true,
                title: "Other",
                url: "https://example.com/other",
              },
        ],
      };
    },
    sendCDPMessage(payload) {
      const call = JSON.parse(payload);
      calls.push(call);
      const result =
        call.method === "Target.attachToTarget"
          ? { sessionId: "session-products" }
          : call.method === "Runtime.evaluate"
            ? {
                result: {
                  value: JSON.stringify({
                    url: "https://example.com/products",
                    title: "Products",
                    w: 800,
                    h: 600,
                    sx: 0,
                    sy: 0,
                    pw: 800,
                    ph: 600,
                  }),
                },
              }
            : {};
      queueMicrotask(() =>
        runtime.onCDPMessage(JSON.stringify({ id: call.id, result })),
      );
    },
  };

  try {
    await withEgo(runtime, async () => {
      invalidateSession();
      const context = helperContext();
      const products = await context.egoBrowser.switchTaskSpace(7);
      const tab = await products.tabs.current();
      await context.egoBrowser.switchTaskSpace(8);

      assert.equal(await tab.page.title(), "Products");
      assert.deepEqual(
        calls.findLast((call) => call[0] === "useTaskSpace"),
        ["useTaskSpace", 7],
      );
    });
  } finally {
    invalidateSession();
    clearPreferredTarget();
  }
});

test("a TaskSpace Tab Page snapshots its bound target without explicit activation", async () => {
  const spaces = [
    { taskId: "products", id: 7, name: "Products", ownership: "agent" },
    { taskId: "other", id: 8, name: "Other", ownership: "agent" },
  ];
  const calls = [];
  let currentTaskSpaceId = 7;
  let activeTargetId = "target-products";
  const runtime = {
    async listTaskSpaces() {
      return { taskSpaces: spaces };
    },
    async useTaskSpace(id) {
      calls.push(["useTaskSpace", id]);
      currentTaskSpaceId = id;
      activeTargetId = id === 7 ? "target-products" : "target-other";
      return {};
    },
    async listTabs() {
      const targetId =
        currentTaskSpaceId === 7 ? "target-products" : "target-other";
      return {
        tabs: [
          {
            targetId,
            active: targetId === activeTargetId,
            title: currentTaskSpaceId === 7 ? "Products" : "Other",
            url:
              currentTaskSpaceId === 7
                ? "https://example.com/products"
                : "https://example.com/other",
          },
        ],
      };
    },
    async snapshot(options) {
      calls.push(["snapshot", currentTaskSpaceId, activeTargetId, options]);
      return {
        content: `${currentTaskSpaceId}:${activeTargetId}`,
        refs: [],
      };
    },
    sendCDPMessage(payload) {
      const call = JSON.parse(payload);
      calls.push(call);
      if (call.method === "Target.activateTarget") {
        activeTargetId = call.params.targetId;
      }
      queueMicrotask(() =>
        runtime.onCDPMessage(JSON.stringify({ id: call.id, result: {} })),
      );
    },
  };

  try {
    await withEgo(runtime, async () => {
      invalidateSession();
      clearPreferredTarget();
      const context = helperContext();
      const products = await context.egoBrowser.switchTaskSpace(7);
      const tab = await products.tabs.current();
      await context.egoBrowser.switchTaskSpace(8);

      assert.equal(await tab.page.snapshot(), "7:target-products");
      await context.egoBrowser.switchTaskSpace(8);
      assert.deepEqual(await tab.page.snapshotRaw(), {
        content: "7:target-products",
        refs: [],
      });
      assert.deepEqual(
        calls.filter((call) => call[0] === "snapshot").map((call) => call[1]),
        [7, 7],
      );
    });
  } finally {
    invalidateSession();
    clearPreferredTarget();
  }
});

test("target-bound Page snapshots serialize native tab activation", async () => {
  const task = {
    taskId: "products",
    id: 7,
    name: "Products",
    ownership: "agent",
  };
  let activeTargetId = "target-a";
  const runtime = {
    async listTaskSpaces() {
      return { taskSpaces: [task] };
    },
    async useTaskSpace() {
      return {};
    },
    async listTabs() {
      return {
        tabs: [
          {
            targetId: "target-a",
            active: activeTargetId === "target-a",
            title: "A",
            url: "https://example.com/a",
          },
          {
            targetId: "target-b",
            active: activeTargetId === "target-b",
            title: "B",
            url: "https://example.com/b",
          },
        ],
      };
    },
    async snapshot() {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { content: activeTargetId, refs: [] };
    },
    sendCDPMessage(payload) {
      const call = JSON.parse(payload);
      if (call.method === "Target.activateTarget") {
        activeTargetId = call.params.targetId;
      }
      queueMicrotask(() =>
        runtime.onCDPMessage(JSON.stringify({ id: call.id, result: {} })),
      );
    },
  };

  try {
    await withEgo(runtime, async () => {
      invalidateSession();
      clearPreferredTarget();
      const space = await helperContext().egoBrowser.switchTaskSpace(7);
      const [first, second] = await space.tabs.list();

      assert.deepEqual(
        await Promise.all([first.page.snapshot(), second.page.snapshot()]),
        ["target-a", "target-b"],
      );
    });
  } finally {
    invalidateSession();
    clearPreferredTarget();
  }
});

test("target-bound Page keeps snapshot refs scoped to its target", async () => {
  const task = {
    taskId: "products",
    id: 7,
    name: "Products",
    ownership: "agent",
  };
  let activeTargetId = "target-a";
  const resolvedBackendNodeIds = [];
  const runtime = {
    async listTaskSpaces() {
      return { taskSpaces: [task] };
    },
    async useTaskSpace() {
      return {};
    },
    async listTabs() {
      return {
        tabs: [
          {
            targetId: "target-a",
            active: activeTargetId === "target-a",
            title: "A",
            url: "https://example.com/a",
          },
          {
            targetId: "target-b",
            active: activeTargetId === "target-b",
            title: "B",
            url: "https://example.com/b",
          },
        ],
      };
    },
    async snapshot() {
      const backendNodeId = activeTargetId === "target-a" ? 101 : 202;
      return {
        content: `${activeTargetId} @${backendNodeId}`,
        refs: [{ backendNodeId, role: "button", name: activeTargetId }],
      };
    },
  };
  const restore = setOverrides({
    cdpOverride(method, params) {
      if (method === "Target.activateTarget") {
        activeTargetId = params.targetId;
        return {};
      }
      if (method === "DOM.resolveNode") {
        resolvedBackendNodeIds.push(params.backendNodeId);
        return { object: { objectId: `node-${params.backendNodeId}` } };
      }
      return {};
    },
  });

  try {
    await withEgo(runtime, async () => {
      const space = await helperContext().egoBrowser.switchTaskSpace(7);
      const [first, second] = await space.tabs.list();

      await first.page.snapshot();
      await second.page.snapshot();

      assert.equal(await first.page.locator("@101").count(), 1);
      assert.equal(await second.page.locator("@202").count(), 1);
      assert.deepEqual(resolvedBackendNodeIds, [101, 202]);
    });
  } finally {
    restore();
  }
});

test("target-bound Page snapshot maps a missing target to the closed error", async () => {
  const task = {
    taskId: "products",
    id: 7,
    name: "Products",
    ownership: "agent",
  };
  let targetOpen = true;
  await withEgo(
    {
      async listTaskSpaces() {
        return { taskSpaces: [task] };
      },
      async useTaskSpace() {
        return {};
      },
      async listTabs() {
        return {
          tabs: targetOpen
            ? [
                {
                  targetId: "target-products",
                  active: true,
                  title: "Products",
                  url: "https://example.com/products",
                },
              ]
            : [],
        };
      },
      async snapshot() {
        return { content: "Products", refs: [] };
      },
    },
    async () => {
      const space = await helperContext().egoBrowser.switchTaskSpace(7);
      const tab = await space.tabs.current();
      targetOpen = false;

      await assert.rejects(
        () => tab.page.snapshot(),
        /Target page, context or browser has been closed.*target-products/,
      );
    },
  );
});

test("a popup opened from a TaskSpace Tab Page inherits its space binding", async () => {
  const spaces = [
    { taskId: "products", id: 7, name: "Products", ownership: "agent" },
    { taskId: "other", id: 8, name: "Other", ownership: "agent" },
  ];
  const calls = [];
  let currentTaskSpaceId = 7;
  const runtime = {
    async listTaskSpaces() {
      return { taskSpaces: spaces };
    },
    async useTaskSpace(id) {
      calls.push(["useTaskSpace", id]);
      currentTaskSpaceId = id;
      return {};
    },
    async listTabs() {
      return {
        tabs:
          currentTaskSpaceId === 7
            ? [
                {
                  targetId: "target-products",
                  active: true,
                  title: "Products",
                  url: "https://example.com/products",
                },
                {
                  targetId: "target-popup",
                  active: false,
                  title: "Popup",
                  url: "https://example.com/popup",
                },
              ]
            : [
                {
                  targetId: "target-other",
                  active: true,
                  title: "Other",
                  url: "https://example.com/other",
                },
              ],
      };
    },
    sendCDPMessage(payload) {
      const call = JSON.parse(payload);
      calls.push(call);
      const result =
        call.method === "Target.attachToTarget"
          ? { sessionId: `session-${call.params.targetId}` }
          : call.method === "Runtime.evaluate"
            ? {
                result: {
                  value: JSON.stringify({
                    url: "https://example.com/popup",
                    title: "Popup",
                    w: 800,
                    h: 600,
                    sx: 0,
                    sy: 0,
                    pw: 800,
                    ph: 600,
                  }),
                },
              }
            : {};
      queueMicrotask(() =>
        runtime.onCDPMessage(JSON.stringify({ id: call.id, result })),
      );
    },
  };

  try {
    await withEgo(runtime, async () => {
      invalidateSession();
      clearPreferredTarget();
      drainBrowserEvents();
      const context = helperContext();
      const products = await context.egoBrowser.switchTaskSpace(7);
      const tab = await products.tabs.current();
      const popupPromise = tab.page.waitForEvent("popup", { timeout: 1000 });
      await waitForCdpCall(calls, "Target.setDiscoverTargets");
      runtime.onCDPMessage(
        JSON.stringify({
          method: "Target.targetCreated",
          params: {
            targetInfo: {
              targetId: "target-popup",
              type: "page",
              openerId: "target-products",
              url: "https://example.com/popup",
            },
          },
        }),
      );
      const popup = await popupPromise;
      await context.egoBrowser.switchTaskSpace(8);

      assert.equal(await popup.title(), "Popup");
      assert.deepEqual(
        calls.findLast((call) => call[0] === "useTaskSpace"),
        ["useTaskSpace", 7],
      );
    });
  } finally {
    invalidateSession();
    clearPreferredTarget();
    drainBrowserEvents();
  }
});

test("egoBrowser complete preserves a TaskSpace and close destroys it", async () => {
  const calls = [];
  const task = {
    taskId: "inspect-products",
    id: 7,
    name: "Inspect products",
    ownership: "agent",
  };
  await withEgo(
    {
      async listTaskSpaces() {
        calls.push(["listTaskSpaces"]);
        return { taskSpaces: [task] };
      },
      async useTaskSpace(id) {
        calls.push(["useTaskSpace", id]);
        return {};
      },
      async completeTaskSpace() {
        calls.push(["completeTaskSpace"]);
        return {};
      },
      async closeTaskSpace() {
        calls.push(["closeTaskSpace"]);
        return {};
      },
    },
    async () => {
      const context = helperContext();
      assert.equal(
        await context.egoBrowser.completeTaskSpace(task.id),
        undefined,
      );
      assert.equal(await context.egoBrowser.closeTaskSpace(task.id), undefined);
    },
  );

  assert.deepEqual(calls, [
    ["listTaskSpaces"],
    ["useTaskSpace", 7],
    ["completeTaskSpace"],
    ["listTaskSpaces"],
    ["useTaskSpace", 7],
    ["closeTaskSpace"],
  ]);
});

test("egoBrowser complete throws when the TaskSpace cannot be completed", async () => {
  const task = {
    taskId: "user-space",
    id: 7,
    name: "User space",
    ownership: "user",
  };
  await withEgo(
    {
      async listTaskSpaces() {
        return { taskSpaces: [task] };
      },
    },
    async () => {
      await assert.rejects(
        () => helperContext().egoBrowser.completeTaskSpace(task.id),
        /egoBrowser\.completeTaskSpace did not complete TaskSpace 7: user-owned/,
      );
    },
  );
});

test("helper surface exposes Playwright-style object facades", () => {
  const context = helperContext();
  assert.equal(typeof context.page, "object");
  assert.equal(typeof context.page.goto, "function");
  assert.equal(typeof context.page.locator, "function");
  assert.equal(typeof context.page.getByText, "function");
  assert.equal(typeof context.page.getByLabel, "function");
  assert.equal(typeof context.page.getByPlaceholder, "function");
  assert.equal(typeof context.page.getByAltText, "function");
  assert.equal(typeof context.page.getByTitle, "function");
  assert.equal(typeof context.page.getByTestId, "function");
  assert.equal(typeof context.page.waitForLoadState, "function");
  assert.equal(typeof context.page.waitForURL, "function");
  assert.equal(typeof context.page.waitForRequest, "function");
  assert.equal(typeof context.page.waitForResponse, "function");
  assert.equal(typeof context.page.close, "function");
  assert.equal(typeof context.page.bringToFront, "function");
  assert.equal(typeof context.page.isClosed, "function");
  assert.equal(typeof context.page.opener, "function");
  assert.equal(typeof context.page.on, "function");
  assert.equal(typeof context.page.once, "function");
  assert.equal(typeof context.page.off, "function");
  assert.equal(typeof context.page.removeAllListeners, "function");
  assert.equal(typeof context.page.route, "function");
  assert.equal(typeof context.page.unroute, "function");
  assert.equal(typeof context.page.unrouteAll, "function");
  assert.equal(typeof context.page.routeFromHAR, "function");
  assert.equal(typeof context.page.routeWebSocket, "function");
  assert.equal(typeof context.page.setExtraHTTPHeaders, "function");
  assert.equal(typeof context.page.addInitScript, "function");
  assert.equal(typeof context.page.exposeFunction, "function");
  assert.equal(typeof context.page.exposeBinding, "function");
  assert.equal(typeof context.page.frames, "function");
  assert.equal(typeof context.page.frame, "function");
  assert.equal(typeof context.page.mainFrame, "function");
  assert.equal(typeof context.page.setViewportSize, "function");
  assert.equal(typeof context.page.viewportSize, "function");
  assert.equal(typeof context.page.emulateMedia, "function");
  assert.equal(typeof context.page.requestGC, "function");
  assert.equal(typeof context.page.clock, "object");
  assert.equal(typeof context.page.clock.install, "function");
  assert.equal(typeof context.page.clock.fastForward, "function");
  assert.equal(typeof context.page.evaluateHandle, "function");
  assert.equal(typeof context.page.addScriptTag, "function");
  assert.equal(typeof context.page.addStyleTag, "function");
  assert.equal(typeof context.page.screencast, "object");
  assert.equal(typeof context.page.screencast.start, "function");
  assert.equal(typeof context.page.screencast.stop, "function");
  assert.equal(typeof context.page.keyboard.press, "function");
  assert.equal(typeof context.page.keyboard.down, "function");
  assert.equal(typeof context.page.keyboard.up, "function");
  assert.equal(typeof context.page.keyboard.type, "function");
  assert.equal(typeof context.page.mouse.click, "function");
  assert.equal(typeof context.page.mouse.move, "function");
  assert.equal(typeof context.page.mouse.down, "function");
  assert.equal(typeof context.page.mouse.up, "function");
  const locator = context.page.locator("#target");
  assert.equal(typeof locator.click, "function");
  assert.equal(typeof locator.fill, "function");
  assert.equal(typeof locator.press, "function");
  assert.equal(typeof locator.locator, "function");
  assert.equal(typeof locator.getByRole, "function");
  assert.equal(typeof locator.getByText, "function");
  assert.equal(typeof locator.getByLabel, "function");
  assert.equal(typeof locator.getByPlaceholder, "function");
  assert.equal(typeof locator.getByAltText, "function");
  assert.equal(typeof locator.getByTitle, "function");
  assert.equal(typeof locator.getByTestId, "function");
  assert.equal(typeof locator.filter, "function");
  assert.equal(typeof locator.and, "function");
  assert.equal(typeof locator.or, "function");
  assert.equal(typeof locator.clear, "function");
  assert.equal(typeof locator.blur, "function");
  assert.equal(typeof locator.innerHTML, "function");
  assert.equal(typeof locator.isVisible, "function");
  assert.equal(typeof locator.isHidden, "function");
  assert.equal(typeof locator.isEnabled, "function");
  assert.equal(typeof locator.isDisabled, "function");
  assert.equal(typeof locator.isEditable, "function");
  assert.equal(typeof locator.boundingBox, "function");
  assert.equal(typeof locator.screenshot, "function");
  assert.equal(typeof locator.first, "function");
  assert.equal(typeof locator.nth, "function");
  assert.equal(typeof locator.last, "function");
  assert.equal(typeof locator.nth(1).click, "function");
  assert.equal(typeof locator.evaluate, "function");
  assert.equal(typeof locator.evaluateAll, "function");
  assert.equal(typeof locator.evaluateHandle, "function");
  assert.equal(typeof locator.page, "function");
  assert.equal(locator.page(), context.page);
  assert.equal(typeof locator.extractAll, "undefined");
  assert.equal(typeof context.page.getByText("Allow").click, "function");
  assert.equal(typeof context.page.getByLabel("Email").fill, "function");
  assert.equal(
    context.page.getByTestId("submit").selector,
    'loc=testid:exact:"submit"',
  );
  const roleRegexSelector = context.page.getByRole("button", {
    name: /New York \(JFK\)/i,
  }).selector;
  assert.match(roleRegexSelector, /^loc=role:button\[name=/);
  assert.deepEqual(
    JSON.parse(roleRegexSelector.match(/\[name=([\s\S]+)\]$/)[1]),
    {
      regex: "New York \\(JFK\\)",
      flags: "i",
    },
  );
  assert.deepEqual(
    JSON.parse(
      decodeURIComponent(
        locator.getByText("Save").selector.slice("internal:scope:".length),
      ),
    ),
    { base: "#target", child: 'loc=text:"Save"' },
  );
  assert.deepEqual(
    JSON.parse(
      decodeURIComponent(
        locator
          .filter({ hasText: /Ready/i })
          .selector.slice("internal:filter:".length),
      ),
    ),
    { base: "#target", hasText: { regex: "Ready", flags: "i" } },
  );
  const scopedRole = JSON.parse(
    decodeURIComponent(
      locator
        .getByRole("button", { name: /Save/i })
        .selector.slice("internal:scope:".length),
    ),
  );
  assert.equal(scopedRole.base, "#target");
  assert.deepEqual(
    JSON.parse(scopedRole.child.match(/\[name=([\s\S]+)\]$/)[1]),
    {
      regex: "Save",
      flags: "i",
    },
  );
  const checkedRole = context.page.getByRole("checkbox", {
    name: "Updates",
    exact: true,
    checked: true,
    disabled: false,
    includeHidden: true,
  }).selector;
  assert.deepEqual(
    JSON.parse(decodeURIComponent(checkedRole.slice("internal:role:".length))),
    {
      role: "checkbox",
      name: { text: "Updates", exact: true },
      checked: true,
      disabled: false,
      includeHidden: true,
    },
  );
  const intersection = locator.and(context.page.locator(".enabled")).selector;
  assert.deepEqual(
    JSON.parse(decodeURIComponent(intersection.slice("internal:and:".length))),
    { left: "#target", right: ".enabled" },
  );
  const union = locator.or(context.page.getByText("Fallback")).selector;
  assert.deepEqual(
    JSON.parse(decodeURIComponent(union.slice("internal:or:".length))),
    { left: "#target", right: 'loc=text:"Fallback"' },
  );
  assert.equal(typeof context.page.setDefaultTimeout, "function");
  assert.equal(typeof context.page.setDefaultNavigationTimeout, "function");
  assert.equal(typeof context.page.waitForEvent, "function");
  const listener = () => {};
  assert.equal(context.page.on("console", listener), context.page);
  assert.equal(context.page.off("console", listener), context.page);
  assert.equal(context.page.once("console", listener), context.page);
  assert.equal(context.page.removeAllListeners("console"), context.page);
  assert.deepEqual(Object.keys(context.tabs).sort(), [
    "activate",
    "close",
    "current",
    "evaluate",
    "list",
    "open",
    "openOrReuse",
  ]);
  assert.equal(typeof context.tabs.open, "function");
  assert.equal(typeof context.tabs.openOrReuse, "function");
  assert.equal(typeof context.tabs.close, "function");
  assert.equal(typeof context.tabs.evaluate, "function");
  assert.equal(typeof context.browser, "undefined");
  assert.equal(typeof context.egoBrowser.useOrCreateTaskSpace, "function");
  assert.equal(typeof context.egoBrowser.claimTaskSpace, "function");
  assert.equal(typeof context.site.runTool, "function");
  assert.equal(typeof context.fetch.server, "function");
  assert.equal(typeof context.fetch.browser, "function");
  assert.equal(typeof context.cdp, "function");
  assert.equal(typeof context.help, "function");
  assert.match(context.help("fetch"), /timeout uses milliseconds/);
  assert.match(
    context.help("egoBrowser"),
    /interval and timeout use milliseconds/,
  );
  assert.equal(typeof helperExports.focus, "function");
  assert.equal(typeof helperExports.waitForRequest, "function");
  assert.equal(typeof helperExports.waitForResponse, "function");
  assert.equal(typeof context.focus, "undefined");
  assert.equal(typeof context.click, "undefined");
  assert.equal(typeof context.fill, "undefined");
  assert.equal(typeof context.goto, "undefined");
  assert.equal(typeof context.evaluate, "undefined");
  assert.equal("newTab" in helperExports, false);
  assert.equal("newTab" in context, false);
  assert.equal("ensureRealTab" in helperExports, false);
  assert.equal("iframeTarget" in helperExports, false);
  assert.equal("elementEval" in helperExports, false);
  assert.equal("elementEval" in context, false);
});

test("tabs.evaluate rejects targets outside the current task space before CDP attach", async () => {
  let cdpCalled = false;
  await withEgo(
    {
      async listTabs() {
        return {
          tabs: [
            {
              targetId: "target-current",
              active: true,
              title: "Current",
              url: "https://example.com/current",
            },
          ],
        };
      },
    },
    async () => {
      const restore = setOverrides({
        cdpOverride() {
          cdpCalled = true;
          throw new Error("CDP must not run for a foreign tab target");
        },
      });
      try {
        await assert.rejects(
          () =>
            helperContext().tabs.evaluate(
              { targetId: "target-from-another-task-space" },
              "document.title",
            ),
          /tabs\.evaluate target not found.*target-from-another-task-space.*target-current/,
        );
      } finally {
        restore();
      }
    },
  );
  assert.equal(cdpCalled, false);
});

test("page.waitForEvent('popup') returns the complete Page facade", async () => {
  const calls = [];
  let activeTargetId = "target-main";
  await withEgo(
    {
      async listTabs() {
        return {
          tabs: [
            {
              targetId: "target-main",
              active: activeTargetId === "target-main",
              title: "Main",
              url: "https://example.com/",
            },
            {
              targetId: "target-popup",
              active: activeTargetId === "target-popup",
              title: "Popup",
              url: "https://example.com/popup",
            },
          ],
        };
      },
      async snapshot() {
        return {
          content: `snapshot:${activeTargetId}`,
          refs: [],
        };
      },
      sendCDPMessage(payload) {
        const call = JSON.parse(payload);
        calls.push(call);
        if (call.method === "Target.activateTarget") {
          activeTargetId = call.params.targetId;
        }
        setTimeout(() => {
          const result =
            call.method === "Target.attachToTarget"
              ? { sessionId: `session-${call.params.targetId}` }
              : {};
          globalThis.ego.onCDPMessage(JSON.stringify({ id: call.id, result }));
        }, 0);
      },
    },
    async () => {
      invalidateSession();
      clearPreferredTarget();
      drainBrowserEvents();
      const popupPromise = helperContext().page.waitForEvent("popup", {
        timeout: 1000,
      });
      await waitForCdpCall(calls, "Target.setDiscoverTargets");
      globalThis.ego.onCDPMessage(
        JSON.stringify({
          method: "Target.targetCreated",
          params: {
            targetInfo: {
              targetId: "target-popup",
              type: "page",
              openerId: "target-main",
              title: "Popup",
              url: "https://example.com/popup",
            },
          },
        }),
      );

      const popup = await popupPromise;
      assert.equal(popup.targetId, "target-popup");
      assert.equal(typeof popup.locator, "function");
      assert.equal(typeof popup.getByRole, "function");
      assert.equal(typeof popup.frameLocator, "function");
      assert.equal(typeof popup.evaluate, "function");
      assert.equal(typeof popup.waitForLoadState, "function");
      assert.equal(typeof popup.keyboard.press, "function");
      assert.equal(typeof popup.mouse.click, "function");
      assert.equal(typeof popup.bringToFront, "function");
      assert.equal(await popup.snapshot(), "snapshot:target-popup");
      assert.deepEqual(await popup.snapshotRaw(), {
        content: "snapshot:target-popup",
        refs: [],
      });
      assert.throws(
        () => popup.drainEvents(),
        /page\.drainEvents is available only on the active global page/,
      );
    },
  );
  invalidateSession();
  clearPreferredTarget();
  drainBrowserEvents();
});

test("target-bound Page owns its close, activation, closed, and opener lifecycle", async () => {
  const calls = [];
  const task = {
    taskId: "popup-lifecycle",
    id: 17,
    name: "Popup lifecycle",
    ownership: "agent",
  };
  await withEgo(
    {
      async listTaskSpaces() {
        return { taskSpaces: [task] };
      },
      async useTaskSpace() {
        return {};
      },
      async listTabs() {
        return {
          tabs: [
            {
              targetId: "target-popup",
              active: true,
              title: "Popup",
              url: "https://example.com/popup",
            },
          ],
        };
      },
    },
    async () => {
      const restore = setOverrides({
        cdpOverride(method, params) {
          calls.push({ method, params });
          if (method === "Target.getTargetInfo") {
            return {
              targetInfo: {
                targetId: "target-popup",
                openerId: "target-main",
              },
            };
          }
          return {};
        },
      });
      try {
        const space = await helperContext().egoBrowser.switchTaskSpace(17);
        const tab = await space.tabs.current();
        const page = tab.page;

        assert.equal(page.isClosed(), false);
        await page.bringToFront();
        assert.ok(
          calls.some(
            ({ method, params }) =>
              method === "Target.activateTarget" &&
              params.targetId === "target-popup",
          ),
        );
        const opener = await page.opener();
        assert.equal(opener.targetId, "target-main");

        await page.close();
        assert.equal(page.isClosed(), true);
        assert.ok(
          calls.some(
            ({ method, params }) =>
              method === "Target.closeTarget" &&
              params.targetId === "target-popup",
          ),
        );
      } finally {
        restore();
      }
    },
  );
});

test("page on, once, off, and removeAllListeners manage persistent events", async () => {
  const calls = [];
  await withEgo(
    {
      async listTabs() {
        return {
          tabs: [
            {
              targetId: "target-main",
              active: true,
              title: "Main",
              url: "https://example.com/",
            },
          ],
        };
      },
      sendCDPMessage(payload) {
        const call = JSON.parse(payload);
        calls.push(call);
        setTimeout(() => {
          const result =
            call.method === "Target.attachToTarget"
              ? { sessionId: "session-main" }
              : {};
          globalThis.ego.onCDPMessage(JSON.stringify({ id: call.id, result }));
        }, 0);
      },
    },
    async () => {
      invalidateSession();
      drainBrowserEvents();
      const page = helperContext().page;
      const persistent = [];
      const single = [];
      const persistentListener = (message) => persistent.push(message.text());
      const removedListener = () => persistent.push("removed");

      page.on("console", persistentListener);
      page.once("console", (message) => single.push(message.text()));
      page.on("console", removedListener);
      page.off("console", removedListener);
      await waitForCdpCall(calls, "Runtime.enable");

      globalThis.ego.onCDPMessage(
        JSON.stringify({
          method: "Runtime.consoleAPICalled",
          sessionId: "session-main",
          params: { type: "log", args: [{ type: "string", value: "one" }] },
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 5));
      globalThis.ego.onCDPMessage(
        JSON.stringify({
          method: "Runtime.consoleAPICalled",
          sessionId: "session-main",
          params: { type: "log", args: [{ type: "string", value: "two" }] },
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 5));

      assert.deepEqual(persistent, ["one", "two"]);
      assert.deepEqual(single, ["one"]);
      assert.equal(page.removeAllListeners("console"), page);
    },
  );
  invalidateSession();
  drainBrowserEvents();
});

test("page network and preload APIs configure the target session", async () => {
  const calls = [];
  const restore = setOverrides({
    sessionId: "session-page",
    sessionTargetId: "target-page",
    sessionAt: Date.now(),
    cdpOverride(method, params, sessionId) {
      calls.push({ method, params, sessionId });
      return {};
    },
  });
  try {
    const page = helperContext().page;
    await page.setExtraHTTPHeaders({ Authorization: "Bearer token" });
    await page.addInitScript((seed) => {
      globalThis.__seed = seed;
    }, 7);
    const routeHandler = async (route) => route.continue();
    await page.route("**/api/**", routeHandler, { times: 1 });
    await page.unroute("**/api/**", routeHandler);
    await page.routeWebSocket("**/socket", () => {});
    await page.exposeFunction("sum", (left, right) => left + right);
    await page.exposeBinding("sourceUrl", (source) => source.page.url());

    assert.deepEqual(
      calls.find(({ method }) => method === "Network.setExtraHTTPHeaders")
        ?.params,
      { headers: { Authorization: "Bearer token" } },
    );
    assert.ok(
      calls.findIndex(({ method }) => method === "Network.enable") <
        calls.findIndex(
          ({ method }) => method === "Network.setExtraHTTPHeaders",
        ),
      "Network must be enabled before extra headers are configured",
    );
    assert.match(
      calls.find(
        ({ method }) => method === "Page.addScriptToEvaluateOnNewDocument",
      )?.params.source,
      /__seed/,
    );
    assert.ok(calls.some(({ method }) => method === "Fetch.enable"));
    assert.ok(calls.some(({ method }) => method === "Fetch.disable"));
    assert.ok(
      calls.filter(({ method }) => method === "Runtime.addBinding").length >= 3,
    );
  } finally {
    restore();
  }
});

test("page.route handles matching Fetch requests with Playwright route facades", async () => {
  const calls = [];
  await withEgo(
    {
      async listTabs() {
        return {
          tabs: [
            {
              targetId: "target-route",
              active: true,
              title: "Route",
              url: "https://example.com/",
            },
          ],
        };
      },
      sendCDPMessage(payload) {
        const call = JSON.parse(payload);
        calls.push(call);
        setTimeout(() => {
          const result =
            call.method === "Target.attachToTarget"
              ? { sessionId: "session-route" }
              : {};
          globalThis.ego.onCDPMessage(JSON.stringify({ id: call.id, result }));
        }, 0);
      },
    },
    async () => {
      invalidateSession();
      drainBrowserEvents();
      const page = helperContext().page;
      await page.route("**/api/**", async (route, request) => {
        assert.equal(request.url(), "https://example.com/api/products");
        assert.equal(route.request(), request);
        await route.fulfill({ status: 201, json: { ok: true } });
      });
      await waitForCdpCall(calls, "Fetch.enable");
      globalThis.ego.onCDPMessage(
        JSON.stringify({
          method: "Fetch.requestPaused",
          sessionId: "session-route",
          params: {
            requestId: "fetch-1",
            networkId: "network-1",
            resourceType: "XHR",
            request: {
              url: "https://example.com/api/products",
              method: "POST",
              headers: { "content-type": "application/json" },
              postData: "{}",
            },
          },
        }),
      );
      await waitForCdpCall(calls, "Fetch.fulfillRequest");
      const fulfill = calls.find(
        ({ method }) => method === "Fetch.fulfillRequest",
      );
      assert.equal(fulfill.params.responseCode, 201);
      assert.deepEqual(
        JSON.parse(Buffer.from(fulfill.params.body, "base64").toString()),
        { ok: true },
      );
      await page.unrouteAll({ behavior: "wait" });
    },
  );
  invalidateSession();
  drainBrowserEvents();
});

test("page frame, viewport, media, GC, and clock APIs use target-scoped CDP", async () => {
  const calls = [];
  const restore = setOverrides({
    sessionId: "session-environment",
    sessionTargetId: "target-page",
    sessionAt: Date.now(),
    cdpOverride(method, params, sessionId) {
      calls.push({ method, params, sessionId });
      if (method === "Page.getFrameTree") {
        return {
          frameTree: {
            frame: {
              id: "frame-main",
              url: "https://example.com/",
              name: "",
            },
            childFrames: [
              {
                frame: {
                  id: "frame-child",
                  parentId: "frame-main",
                  url: "https://example.com/checkout",
                  name: "checkout",
                },
              },
            ],
          },
        };
      }
      if (method === "Runtime.evaluate") {
        return { result: { value: { width: 1024, height: 768 } } };
      }
      return {};
    },
  });
  try {
    const page = helperContext().page;
    await initializePageFacade(page);
    const main = page.mainFrame();
    const checkout = page.frame({ name: "checkout" });
    const frames = page.frames();
    assert.equal(main.url(), "https://example.com/");
    assert.equal(checkout.name(), "checkout");
    assert.equal(
      checkout.parentFrame(),
      main,
      "Frame identity is stable across Page frame queries",
    );
    assert.deepEqual(
      frames.map((frame) => frame.url()),
      ["https://example.com/", "https://example.com/checkout"],
    );

    await page.setViewportSize({ width: 1024, height: 768 });
    assert.deepEqual(page.viewportSize(), {
      width: 1024,
      height: 768,
    });
    await page.emulateMedia({
      media: "print",
      colorScheme: "dark",
      reducedMotion: "reduce",
    });
    await page.requestGC();

    await page.clock.install({ time: 1_700_000_000_000 });
    await page.clock.fastForward(1000);
    await page.clock.pauseAt(1_700_000_002_000);
    await page.clock.resume();

    assert.ok(
      calls.some(
        ({ method }) => method === "Emulation.setDeviceMetricsOverride",
      ),
    );
    assert.ok(
      calls.some(({ method }) => method === "HeapProfiler.collectGarbage"),
    );
    assert.ok(
      calls.some(
        ({ method, params }) =>
          method === "Emulation.setEmulatedMedia" && params.media === "print",
      ),
    );
    assert.ok(
      calls.some(
        ({ method, params }) =>
          method === "Runtime.evaluate" &&
          String(params.expression).includes("__egoClock"),
      ),
    );
  } finally {
    restore();
  }
});

test("page and locator handle APIs retain target-scoped remote objects", async () => {
  const calls = [];
  let nextObject = 0;
  const restore = setOverrides({
    sessionId: "session-handles",
    sessionTargetId: "target-handles",
    sessionAt: Date.now(),
    cdpOverride(method, params, sessionId) {
      calls.push({ method, params, sessionId });
      if (method === "Runtime.evaluate" && params.returnByValue === false) {
        nextObject += 1;
        return {
          result: {
            type: "object",
            subtype: params.expression.includes("createElement")
              ? "node"
              : undefined,
            objectId: `object-${nextObject}`,
          },
        };
      }
      if (
        method === "Runtime.callFunctionOn" &&
        params.returnByValue === false
      ) {
        nextObject += 1;
        return {
          result: { type: "object", objectId: `object-${nextObject}` },
        };
      }
      if (method === "Runtime.callFunctionOn") {
        return { result: { value: { retained: true } } };
      }
      if (method === "Runtime.releaseObject") return {};
      return {};
    },
  });
  try {
    const page = helperContext().page;
    const pageHandle = await page.evaluateHandle(() => ({ answer: 42 }));
    assert.deepEqual(await pageHandle.jsonValue(), { retained: true });

    const locatorHandle = await page
      .locator("#target")
      .evaluateHandle((element) => ({ text: element.textContent }));
    assert.deepEqual(await locatorHandle.jsonValue(), { retained: true });

    const script = await page.addScriptTag({ content: "window.ready = true" });
    const style = await page.addStyleTag({ content: "body { color: red }" });
    assert.equal(script.asElement(), script);
    assert.equal(style.asElement(), style);
    assert.ok(
      calls.some(
        ({ method, params }) =>
          method === "Runtime.evaluate" &&
          String(params.expression).includes('createElement("script")'),
      ),
    );
    assert.ok(
      calls.some(
        ({ method, params }) =>
          method === "Runtime.evaluate" &&
          String(params.expression).includes('createElement("style")'),
      ),
    );

    await Promise.all([
      pageHandle.dispose(),
      locatorHandle.dispose(),
      script.dispose(),
      style.dispose(),
    ]);
  } finally {
    restore();
  }
});

test("popup Page stays bound to its target when another tab is active", async () => {
  const calls = [];
  const tabs = [
    {
      targetId: "target-main",
      active: true,
      title: "Main",
      url: "https://example.com/",
    },
    {
      targetId: "target-popup",
      active: false,
      title: "Popup",
      url: "https://example.com/popup",
    },
  ];
  try {
    await withEgo(
      {
        async listTabs() {
          return { tabs };
        },
        sendCDPMessage(payload) {
          const call = JSON.parse(payload);
          calls.push(call);
          setTimeout(() => {
            let result = {};
            if (call.method === "Target.attachToTarget") {
              result = { sessionId: `session-${call.params.targetId}` };
            } else if (call.method === "Runtime.evaluate") {
              result =
                call.params.returnByValue === false
                  ? { result: { type: "object", objectId: "popup-handle" } }
                  : { result: { value: call.sessionId } };
            } else if (call.method === "Runtime.callFunctionOn") {
              result = { result: { value: call.sessionId } };
            }
            globalThis.ego.onCDPMessage(
              JSON.stringify({ id: call.id, result }),
            );
          }, 0);
        },
      },
      async () => {
        invalidateSession();
        clearPreferredTarget();
        drainBrowserEvents();
        const popupPromise = helperContext().page.waitForEvent("popup", {
          timeout: 1000,
        });
        await waitForCdpCall(calls, "Target.setDiscoverTargets");
        globalThis.ego.onCDPMessage(
          JSON.stringify({
            method: "Target.targetCreated",
            params: {
              targetInfo: {
                targetId: "target-popup",
                type: "page",
                openerId: "target-main",
                url: "https://example.com/popup",
              },
            },
          }),
        );

        const popup = await popupPromise;
        assert.equal(
          await popup.evaluate("location.href"),
          "session-target-popup",
        );
        assert.equal(
          await popup.evaluate("document.title"),
          "session-target-popup",
        );
        assert.equal(
          calls.filter(
            (call) =>
              call.method === "Target.attachToTarget" &&
              call.params.targetId === "target-popup",
          ).length,
          1,
          "a target-bound Page keeps one stable CDP session",
        );
        assert.equal(
          calls.some(
            (call) =>
              call.method === "Target.detachFromTarget" &&
              call.params.sessionId === "session-target-popup",
          ),
          false,
          "the Page session remains usable by returned handles and event facades",
        );
        assert.equal(
          await popup
            .locator("#target")
            .evaluateAll((elements) => elements.length),
          "session-target-popup",
        );
        await popup.keyboard.insertText("hello");
        assert.equal(
          calls.findLast((call) => call.method === "Input.insertText")
            ?.sessionId,
          "session-target-popup",
        );
        const handle = await popup.waitForFunction(
          "({ ready: true })",
          undefined,
          {
            timeout: 1000,
            polling: 1,
          },
        );
        assert.equal(
          await handle.jsonValue(),
          "session-target-popup",
          "a handle returned by the popup remains bound to its Page session",
        );
        await handle.dispose();
        assert.equal(
          calls.findLast((call) => call.method === "Runtime.releaseObject")
            ?.sessionId,
          "session-target-popup",
        );
        assert.equal(
          tabs.find((tab) => tab.active)?.targetId,
          "target-main",
          "bound evaluation must not activate the popup",
        );
      },
    );
  } finally {
    invalidateSession();
    clearPreferredTarget();
    drainBrowserEvents();
  }
});

test("target-bound Page maps a lost target to the Playwright-style closed error", async () => {
  try {
    await withEgo(
      {
        async listTabs() {
          return {
            tabs: [
              {
                targetId: "target-popup",
                active: false,
                title: "Popup",
                url: "https://example.com/popup",
              },
            ],
          };
        },
        sendCDPMessage(payload) {
          const call = JSON.parse(payload);
          setTimeout(() => {
            if (call.method === "Runtime.evaluate") {
              globalThis.ego.onCDPMessage(
                JSON.stringify({
                  id: call.id,
                  error: { message: "Target closed" },
                }),
              );
              return;
            }
            const result =
              call.method === "Target.attachToTarget"
                ? { sessionId: "session-target-popup" }
                : {};
            globalThis.ego.onCDPMessage(
              JSON.stringify({ id: call.id, result }),
            );
          }, 0);
        },
      },
      async () => {
        invalidateSession();
        clearPreferredTarget();
        await assert.rejects(
          () =>
            runWithTarget("target-popup", () =>
              helperContext().page.evaluate("location.href"),
            ),
          /Target page, context or browser has been closed/,
        );
      },
    );
  } finally {
    invalidateSession();
    clearPreferredTarget();
    drainBrowserEvents();
  }
});

test("all text-based getBy locators preserve regular expressions", () => {
  const context = helperContext();
  const locators = [
    context.page.getByText(/ready\s+now/i),
    context.page.getByLabel(/email|user/i),
    context.page.getByPlaceholder(/^search/),
    context.page.getByAltText(/controller$/i),
    context.page.getByTitle(/details/i),
    context.page.getByTestId(/^product-\d+$/),
    context.page.locator(".card").getByText(/buy/i),
    context.page.frameLocator("#catalog").getByText(/frame item/i),
  ];

  for (const locator of locators) {
    const decoded = decodeURIComponent(locator.selector);
    assert.match(decoded, /:regex:/);
    assert.doesNotMatch(decoded, /"\/.*\/[a-z]*"/i);
  }
});

test("locator factories accept Playwright has and text filter options", () => {
  const context = helperContext();
  const child = context.page.locator(".card", {
    hasText: /ready/i,
    hasNotText: "Archived",
    has: context.page.getByText("Buy"),
    hasNot: context.page.locator(".disabled"),
  });
  const nested = context.page.locator("#catalog").locator(".item", {
    hasText: "Available",
  });
  const framed = context.page.frameLocator("#frame").locator(".item", {
    hasNotText: /sold/i,
  });

  assert.match(child.selector, /^internal:filter:/);
  assert.match(nested.selector, /^internal:filter:/);
  assert.match(framed.selector, /^internal:filter:/);

  const nestedFilter = JSON.parse(
    decodeURIComponent(nested.selector.slice("internal:filter:".length)),
  );
  assert.match(nestedFilter.base, /^internal:scope:/);
  assert.deepEqual(nestedFilter.hasText, {
    text: "Available",
    exact: false,
  });
});

test("locator implementation state is accessible but not publicly enumerable", () => {
  const context = helperContext();
  const locator = context.page.locator(".item");
  const frameLocator = context.page.frameLocator("#frame");

  assert.equal(locator.selector, ".item");
  assert.deepEqual(locator.frameChain, []);
  assert.ok(locator.target);
  assert.ok(!Object.keys(locator).includes("selector"));
  assert.ok(!Object.keys(locator).includes("frameChain"));
  assert.ok(!Object.keys(locator).includes("target"));

  assert.equal(frameLocator.selector, "#frame");
  assert.deepEqual(frameLocator.frameChain, ["#frame"]);
  assert.ok(!Object.keys(frameLocator).includes("selector"));
  assert.ok(!Object.keys(frameLocator).includes("frameChain"));
});

test("page.frameLocator creates nested frame-scoped locators", () => {
  const context = helperContext();

  assert.equal(typeof context.page.frameLocator, "function");
  const outer = context.page.frameLocator("iframe#outer");
  assert.equal(typeof outer.frameLocator, "function");
  assert.equal(typeof outer.getByRole, "function");

  const inner = outer.frameLocator("iframe#inner");
  const button = inner.getByRole("button", { name: "Save" });
  assert.equal(typeof button.click, "function");
  assert.match(button.selector, /^loc=role:button/);
  assert.deepEqual(button.frameChain, ["iframe#outer", "iframe#inner"]);
  assert.deepEqual(outer.first().frameChain, ["internal:nth=0;iframe#outer"]);
  assert.deepEqual(outer.nth(2).frameChain, ["internal:nth=2;iframe#outer"]);
  assert.deepEqual(outer.last().frameChain, ["internal:last;iframe#outer"]);
  assert.throws(() => outer.nth(-1), /non-negative integer/);
});

test("locator.all returns one nth locator for each current match", async () => {
  const restore = setOverrides({
    cdpOverride(method, params) {
      assert.equal(method, "Runtime.evaluate");
      assert.match(params.expression, /elements\.length/);
      return { result: { value: 3 } };
    },
  });
  try {
    const locators = await helperContext().page.locator(".item").all();
    assert.deepEqual(
      locators.map((item) => item.selector),
      ["internal:nth=0;.item", "internal:nth=1;.item", "internal:nth=2;.item"],
    );
  } finally {
    restore();
  }
});

test("locator and frameLocator convert between frame scopes", () => {
  const page = helperContext().page;

  const content = page.locator("iframe#checkout").contentFrame();
  assert.deepEqual(content.frameChain, ["iframe#checkout"]);

  const nested = page.locator(".shell").frameLocator("iframe.child");
  assert.match(nested.selector, /^internal:scope:/);
  assert.deepEqual(nested.frameChain, [nested.selector]);

  const owner = page
    .frameLocator("iframe#outer")
    .frameLocator("iframe#inner")
    .owner();
  assert.equal(owner.selector, "iframe#inner");
  assert.deepEqual(owner.frameChain, ["iframe#outer"]);
});

test("locator.selectText selects the resolved element contents", async () => {
  const calls = [];
  const restore = setOverrides({
    cdpOverride(method, params) {
      calls.push({ method, params });
      if (method === "Runtime.evaluate") {
        return { result: { objectId: "selectable" } };
      }
      if (method === "Runtime.callFunctionOn") {
        return params.functionDeclaration.includes("selectNodeContents")
          ? { result: { value: undefined } }
          : {
              result: {
                value: {
                  attached: true,
                  visible: true,
                  enabled: true,
                  editable: false,
                  receivesEvents: true,
                  rect: { x: 0, y: 0, width: 100, height: 20 },
                },
              },
            };
      }
      if (method === "Runtime.releaseObject") return {};
      throw new Error(`unexpected CDP method: ${method}`);
    },
  });
  try {
    await helperContext().page.locator("#copy-me").selectText();
  } finally {
    restore();
  }
  assert.match(
    calls.find(
      (call) =>
        call.method === "Runtime.callFunctionOn" &&
        call.params.functionDeclaration.includes("selectNodeContents"),
    ).params.functionDeclaration,
    /selectNodeContents/,
  );
});

test("frame-scoped locator composition rejects locators from another frame", () => {
  const page = helperContext().page;
  const left = page.frameLocator("#left-frame").locator(".item");
  const right = page.frameLocator("#right-frame").locator(".item");

  for (const compose of [
    () => left.and(right),
    () => left.or(right),
    () => left.locator(right),
    () => left.filter({ has: right }),
    () => left.filter({ hasNot: right }),
    () => page.locator(".item", { has: right }),
    () =>
      page.frameLocator("#left-frame").locator(".item", {
        has: right,
      }),
  ]) {
    assert.throws(compose, /same frame/);
  }
});

test("frame-scoped locator resolves inside the child execution context", async () => {
  const calls = [];
  const restore = setOverrides({
    sessionId: "main-session",
    sessionTargetId: "tab-1",
    sessionAt: Date.now(),
    cdpOverride: async (method, params, sessionId) => {
      calls.push({ method, params, sessionId });
      if (method === "Runtime.evaluate") {
        if (params.contextId === 101) {
          assert.match(params.expression, /#inside/);
          return { result: { objectId: "inside-object" } };
        }
        if (params.expression.includes("#frame")) {
          return { result: { objectId: "frame-owner" } };
        }
        throw new Error("expected frame owner resolution first");
      }
      if (
        method === "Runtime.callFunctionOn" &&
        params.objectId === "frame-owner"
      ) {
        return {
          result: {
            value: { x: 100, y: 50, width: 400, height: 300 },
          },
        };
      }
      if (method === "DOM.describeNode") {
        return { node: { frameId: "frame-1" } };
      }
      if (method === "Page.createIsolatedWorld") {
        assert.equal(params.frameId, "frame-1");
        return { executionContextId: 101 };
      }
      if (
        method === "Runtime.callFunctionOn" &&
        params.objectId === "inside-object"
      ) {
        return { result: { value: "Inside frame" } };
      }
      if (method === "Runtime.releaseObject") return {};
      throw new Error(`unexpected CDP method: ${method}`);
    },
  });
  try {
    const text = await helperContext()
      .page.frameLocator("#frame")
      .locator("#inside")
      .innerText();

    assert.equal(text, "Inside frame");
    assert.ok(
      calls.some(
        (call) =>
          call.method === "Runtime.evaluate" && call.params.contextId === 101,
      ),
    );
  } finally {
    restore();
  }
});

test("frame-scoped locator re-resolves after its execution context is destroyed", async () => {
  let frameWorlds = 0;
  let now = 0;
  const restore = setOverrides({
    sessionId: "main-session",
    sessionTargetId: "tab-1",
    sessionAt: Date.now(),
    defaultTimeout: 500,
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    cdpOverride: async (method, params) => {
      if (method === "Runtime.evaluate" && params.contextId === 101) {
        throw new Error("Execution context was destroyed.");
      }
      if (method === "Runtime.evaluate" && params.contextId === 102) {
        return { result: { objectId: "inside-object" } };
      }
      if (method === "Runtime.evaluate") {
        return { result: { objectId: "frame-owner" } };
      }
      if (
        method === "Runtime.callFunctionOn" &&
        params.objectId === "frame-owner"
      ) {
        return {
          result: {
            value: { x: 100, y: 50, width: 400, height: 300 },
          },
        };
      }
      if (method === "DOM.describeNode") {
        return { node: { frameId: "navigating-frame" } };
      }
      if (method === "Page.createIsolatedWorld") {
        frameWorlds += 1;
        return { executionContextId: frameWorlds === 1 ? 101 : 102 };
      }
      if (
        method === "Runtime.callFunctionOn" &&
        params.objectId === "inside-object"
      ) {
        return { result: { value: "After navigation" } };
      }
      if (method === "Runtime.releaseObject") return {};
      throw new Error(`Unexpected CDP method: ${method}`);
    },
  });
  try {
    assert.equal(
      await helperContext()
        .page.frameLocator("#frame")
        .locator("#inside")
        .innerText(),
      "After navigation",
    );
    assert.equal(frameWorlds, 2);
  } finally {
    restore();
  }
});

test("help documents every public callable by its facade path", () => {
  const context = helperContext();
  const publicPaths = [
    ...callablePaths(context.page, "page"),
    ...callablePaths(context.tabs, "tabs"),
    ...callablePaths(context.egoBrowser, "egoBrowser"),
    ...callablePaths(context.site, "site"),
    ...callablePaths(context.fetch, "fetch"),
    ...callablePaths(context.page.locator("#help-audit"), "locator"),
    ...callablePaths(context.page.frameLocator("#help-frame"), "frameLocator"),
    "cdp",
    "help",
  ].sort();
  assert.deepEqual(
    Object.keys(PUBLIC_API_DOCS).sort(),
    publicPaths,
    "public help docs and the callable facade surface must stay in exact sync",
  );

  for (const path of publicPaths) {
    const text = context.help(path);
    assert.doesNotMatch(
      text,
      /Unknown helper/,
      `expected help for public callable ${path}`,
    );
    assert.match(
      text,
      new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + String.raw`\(`),
      `expected the public facade signature for ${path} in:\n${text}`,
    );
  }
});

test("help supports facade namespaces and disambiguates nested methods", () => {
  const context = helperContext();

  const mouse = context.help("page.mouse");
  assert.match(mouse, /page\.mouse\.move\(/);
  assert.match(mouse, /page\.mouse\.down\(/);
  assert.match(mouse, /page\.mouse\.up\(/);
  assert.match(mouse, /page\.mouse\.drag\(/);

  assert.match(context.help("mouse"), /page\.mouse\.move\(/);
  assert.match(context.help("page"), /page\.goto\(/);
  assert.match(context.help("locator"), /locator\.fill\(/);
  assert.match(context.help(), /\bcdp\b/);
  assert.match(context.help(), /help\(name\?\)/);
  assert.match(context.help("page.keyboard.down"), /Dispatch a keydown event/);
  assert.match(context.help("page.mouse.down"), /Press a mouse button/);
  assert.match(
    context.help("page.screenshot"),
    /page\.screenshot\(options\?\) => Promise<Buffer>/,
  );
  assert.match(
    context.help("page.saveScreenshot"),
    /page\.saveScreenshot\(options\?\) => Promise<string>/,
  );
  assert.match(context.help("down"), /Ambiguous helper name/);
  assert.match(context.help("down"), /page\.keyboard\.down/);
  assert.match(context.help("down"), /page\.mouse\.down/);
  assert.match(context.help("page.mouse.missing"), /help\('page\.mouse'\)/);
  assert.match(
    context.help("switchTaskSpace"),
    /egoBrowser\.switchTaskSpace\(nameOrId\)/,
  );
  assert.match(
    context.help("egoBrowser.listTaskSpaces"),
    /egoBrowser\.listTaskSpaces\(\) => Promise<TaskSpaceInfo\[\]>/,
  );
  assert.match(
    context.help("egoBrowser.useOrCreateTaskSpace"),
    /egoBrowser\.useOrCreateTaskSpace\(nameOrId\) => Promise<TaskSpace>/,
  );
  assert.match(
    context.help("egoBrowser.claimTaskSpace"),
    /egoBrowser\.claimTaskSpace\(nameOrId\) => Promise<TaskSpace>/,
  );
  assert.match(
    context.help("egoBrowser.completeTaskSpace"),
    /egoBrowser\.completeTaskSpace\(nameOrId\) => Promise<void>/,
  );
  assert.match(
    context.help("egoBrowser.closeTaskSpace"),
    /egoBrowser\.closeTaskSpace\(nameOrId\) => Promise<void>/,
  );
});

test("page.url reads the current URL synchronously", async () => {
  const restore = setOverrides({
    cdpOverride: async (method) => {
      assert.equal(method, "Runtime.evaluate");
      return {
        result: {
          value: JSON.stringify({
            url: "https://example.com/current",
            title: "Current",
            w: 800,
            h: 600,
            sx: 0,
            sy: 0,
            pw: 800,
            ph: 600,
          }),
        },
      };
    },
  });
  try {
    const page = helperContext().page;
    await page.info();
    assert.equal(page.url(), "https://example.com/current");
  } finally {
    restore();
  }
});

test("switchTaskSpace selects a matching task space", async () => {
  const calls = [];
  await withEgo(
    {
      async listTaskSpaces() {
        return {
          taskSpaces: [
            {
              taskId: "checkout-flow",
              id: 7,
              name: "Checkout flow",
              ownership: "agent",
            },
          ],
        };
      },
      useTaskSpace(taskId) {
        calls.push(["useTaskSpace", taskId]);
        return taskId;
      },
    },
    async () => {
      assert.deepEqual(await switchTaskSpace(7), {
        taskId: "checkout-flow",
        id: 7,
        name: "Checkout flow",
        ownership: "agent",
      });
    },
  );
  assert.deepEqual(calls, [["useTaskSpace", 7]]);
});

test("switchTaskSpace rejects non-agent-owned task spaces", async () => {
  await withEgo(
    {
      async listTaskSpaces() {
        return {
          taskSpaces: [
            {
              taskId: "checkout-flow",
              id: 7,
              name: "checkout-flow",
              ownership: "user",
            },
          ],
        };
      },
      useTaskSpace() {},
    },
    async () => {
      await assert.rejects(
        () => switchTaskSpace("checkout-flow"),
        /switchTaskSpace requires an agent-owned task space/,
      );
    },
  );
});

test("switchTaskSpace awaits useTaskSpace binding errors", async () => {
  await withEgo(
    {
      async listTaskSpaces() {
        return {
          taskSpaces: [
            {
              taskId: "checkout-flow",
              id: 7,
              name: "checkout-flow",
              ownership: "agent",
            },
          ],
        };
      },
      async useTaskSpace() {
        return { error: "Task space not selected" };
      },
    },
    async () => {
      await assert.rejects(
        () => switchTaskSpace("checkout-flow"),
        /switchTaskSpace: Task space not selected/,
      );
    },
  );
});

test("newTaskSpace creates and selects an agent task space", async () => {
  const calls = [];
  await withEgo(
    {
      async createTaskSpace(name) {
        calls.push(["createTaskSpace", name]);
        return { taskId: name, id: 7, name, ownership: "agent" };
      },
      useTaskSpace(taskId) {
        calls.push(["useTaskSpace", taskId]);
        return taskId;
      },
    },
    async () => {
      assert.deepEqual(await newTaskSpace("checkout-flow"), {
        taskId: "checkout-flow",
        id: 7,
        name: "checkout-flow",
        ownership: "agent",
      });
    },
  );
  assert.deepEqual(calls, [
    ["createTaskSpace", "checkout-flow"],
    ["useTaskSpace", 7],
  ]);
});

test("newTaskSpace rejects results without a numeric id", async () => {
  const calls = [];
  await withEgo(
    {
      async createTaskSpace(name) {
        calls.push(["createTaskSpace", name]);
        return { taskId: name, id: name, name };
      },
      async listTaskSpaces() {
        calls.push(["listTaskSpaces"]);
        return {
          taskSpaces: [
            {
              taskId: "checkout-flow",
              id: 7,
              name: "checkout-flow",
              ownership: "agent",
            },
          ],
        };
      },
      useTaskSpace(id) {
        calls.push(["useTaskSpace", id]);
      },
    },
    async () => {
      await assert.rejects(
        () => newTaskSpace("checkout-flow"),
        /newTaskSpace requires a numeric task space id/,
      );
    },
  );
  assert.deepEqual(calls, [["createTaskSpace", "checkout-flow"]]);
});

test("newTaskSpace throws on binding error objects", async () => {
  await withEgo(
    {
      async createTaskSpace() {
        return { error: "Task space already exists: checkout-flow" };
      },
      useTaskSpace() {},
    },
    async () => {
      await assert.rejects(
        () => newTaskSpace("checkout-flow"),
        /newTaskSpace: Task space already exists: checkout-flow/,
      );
    },
  );
});

test("useOrCreateTaskSpace reuses existing agent-owned spaces", async () => {
  const calls = [];
  await withEgo(
    {
      async listTaskSpaces() {
        calls.push(["listTaskSpaces"]);
        return {
          taskSpaces: [
            {
              taskId: "checkout-flow",
              id: 7,
              name: "checkout-flow",
              ownership: "agent",
            },
          ],
        };
      },
      useTaskSpace(taskId) {
        calls.push(["useTaskSpace", taskId]);
        return taskId;
      },
      async createTaskSpace(name) {
        calls.push(["createTaskSpace", name]);
        return { taskId: name, id: 8, name, ownership: "agent" };
      },
      async claimTaskSpace(id, name) {
        calls.push(["claimTaskSpace", id, name]);
        return { taskId: name, id, name, ownership: "agent" };
      },
    },
    async () => {
      assert.deepEqual(await useOrCreateTaskSpace("checkout-flow"), {
        taskId: "checkout-flow",
        id: 7,
        name: "checkout-flow",
        ownership: "agent",
      });
    },
  );
  assert.deepEqual(calls, [["listTaskSpaces"], ["useTaskSpace", 7]]);
});

test("useOrCreateTaskSpace selects user-owned spaces without claiming and surfaces the owned user-control guidance", async () => {
  const calls = [];
  await withEgo(
    {
      async listTaskSpaces() {
        calls.push(["listTaskSpaces"]);
        return {
          taskSpaces: [
            {
              taskId: "checkout-flow",
              id: 7,
              name: "checkout-flow",
              ownership: "user",
            },
          ],
        };
      },
      async claimTaskSpace(id, name) {
        calls.push(["claimTaskSpace", id, name]);
        return { taskId: name, id, name, ownership: "agent" };
      },
      useTaskSpace(taskId) {
        calls.push(["useTaskSpace", taskId]);
        // Native attaches the stable code; resolveEgoError overrides the live
        // text with ego-browser's owned EGO_TASK_SPACE_USER_IN_CONTROL guidance.
        return {
          error: "The task is under user control",
          error_code: "EGO_TASK_SPACE_USER_IN_CONTROL",
        };
      },
    },
    async () => {
      await assert.rejects(
        () => useOrCreateTaskSpace("checkout-flow"),
        /useOrCreateTaskSpace: The user has taken control of this task space/,
      );
    },
  );
  assert.deepEqual(calls, [["listTaskSpaces"], ["useTaskSpace", 7]]);
});

test("claimTaskSpace claims and selects an existing user-owned space", async () => {
  const calls = [];
  await withEgo(
    {
      async listTaskSpaces() {
        calls.push(["listTaskSpaces"]);
        return {
          taskSpaces: [
            {
              taskId: "checkout-flow",
              id: 7,
              name: "checkout-flow",
              ownership: "user",
            },
          ],
        };
      },
      async claimTaskSpace(id, name) {
        calls.push(["claimTaskSpace", id, name]);
        return { taskId: name, id, name, ownership: "agent" };
      },
      useTaskSpace(taskId) {
        calls.push(["useTaskSpace", taskId]);
        return taskId;
      },
    },
    async () => {
      assert.deepEqual(await claimTaskSpace("checkout-flow"), {
        taskId: "checkout-flow",
        id: 7,
        name: "checkout-flow",
        ownership: "agent",
      });
    },
  );
  assert.deepEqual(calls, [
    ["listTaskSpaces"],
    ["claimTaskSpace", 7, "checkout-flow"],
    ["useTaskSpace", 7],
  ]);
});

test("claimTaskSpace throws on an unknown task space", async () => {
  const calls = [];
  await withEgo(
    {
      async listTaskSpaces() {
        calls.push(["listTaskSpaces"]);
        return { taskSpaces: [] };
      },
      async claimTaskSpace(id, name) {
        calls.push(["claimTaskSpace", id, name]);
        return { taskId: name, id, name, ownership: "agent" };
      },
    },
    async () => {
      await assert.rejects(
        () => claimTaskSpace("checkout-flow"),
        /task space not found: checkout-flow/,
      );
    },
  );
  assert.deepEqual(calls, [["listTaskSpaces"]]);
});

test("useOrCreateTaskSpace creates missing spaces", async () => {
  const calls = [];
  await withEgo(
    {
      async listTaskSpaces() {
        calls.push(["listTaskSpaces"]);
        return { taskSpaces: [] };
      },
      async createTaskSpace(name) {
        calls.push(["createTaskSpace", name]);
        return { taskId: name, id: 7, name, ownership: "agent" };
      },
      useTaskSpace(taskId) {
        calls.push(["useTaskSpace", taskId]);
        return taskId;
      },
    },
    async () => {
      assert.deepEqual(await useOrCreateTaskSpace("checkout-flow"), {
        taskId: "checkout-flow",
        id: 7,
        name: "checkout-flow",
        ownership: "agent",
      });
    },
  );
  assert.deepEqual(calls, [
    ["listTaskSpaces"],
    ["createTaskSpace", "checkout-flow"],
    ["useTaskSpace", 7],
  ]);
});

test("useOrCreateTaskSpace resolves string names before numeric id strings", async () => {
  const calls = [];
  await withEgo(
    {
      async listTaskSpaces() {
        calls.push(["listTaskSpaces"]);
        return {
          taskSpaces: [
            {
              taskId: "plain-seven",
              id: 7,
              name: "plain-seven",
              ownership: "agent",
            },
            { taskId: "7", id: 8, name: "7", ownership: "agent" },
          ],
        };
      },
      useTaskSpace(id) {
        calls.push(["useTaskSpace", id]);
        return id;
      },
    },
    async () => {
      assert.deepEqual(await useOrCreateTaskSpace("7"), {
        taskId: "7",
        id: 8,
        name: "7",
        ownership: "agent",
      });
    },
  );
  assert.deepEqual(calls, [["listTaskSpaces"], ["useTaskSpace", 8]]);
});

test("useOrCreateTaskSpace resolves numeric strings by id when name is absent", async () => {
  const calls = [];
  await withEgo(
    {
      async listTaskSpaces() {
        calls.push(["listTaskSpaces"]);
        return {
          taskSpaces: [
            {
              taskId: "checkout-flow",
              id: 7,
              name: "checkout-flow",
              ownership: "agent",
            },
          ],
        };
      },
      useTaskSpace(id) {
        calls.push(["useTaskSpace", id]);
        return id;
      },
    },
    async () => {
      assert.deepEqual(await useOrCreateTaskSpace("7"), {
        taskId: "checkout-flow",
        id: 7,
        name: "checkout-flow",
        ownership: "agent",
      });
    },
  );
  assert.deepEqual(calls, [["listTaskSpaces"], ["useTaskSpace", 7]]);
});

test("useOrCreateTaskSpace rejects missing numeric ids instead of creating", async () => {
  const calls = [];
  await withEgo(
    {
      async listTaskSpaces() {
        calls.push(["listTaskSpaces"]);
        return { taskSpaces: [] };
      },
      async createTaskSpace(name) {
        calls.push(["createTaskSpace", name]);
        return {
          taskId: String(name),
          id: 7,
          name: String(name),
          ownership: "agent",
        };
      },
    },
    async () => {
      await assert.rejects(
        () => useOrCreateTaskSpace(7),
        /task space not found: 7/,
      );
    },
  );
  assert.deepEqual(calls, [["listTaskSpaces"]]);
});

test("completeTaskSpace selects by numeric id before completing", async () => {
  const calls = [];
  await withEgo(
    {
      async listTaskSpaces() {
        calls.push(["listTaskSpaces"]);
        return {
          taskSpaces: [
            {
              taskId: "checkout-flow",
              id: 7,
              name: "checkout-flow",
              ownership: "agent",
            },
          ],
        };
      },
      useTaskSpace(id) {
        calls.push(["useTaskSpace", id]);
        return id;
      },
      async completeTaskSpace() {
        calls.push(["completeTaskSpace"]);
        return "7 task space completed.";
      },
    },
    async () => {
      await completeTaskSpace("checkout-flow", { keep: true });
    },
  );
  assert.deepEqual(calls, [
    ["listTaskSpaces"],
    ["useTaskSpace", 7],
    ["completeTaskSpace"],
  ]);
});

test("completeTaskSpace waits for async useTaskSpace before completing", async () => {
  const calls = [];
  await withEgo(
    {
      async listTaskSpaces() {
        calls.push(["listTaskSpaces"]);
        return {
          taskSpaces: [
            {
              taskId: "checkout-flow",
              id: 7,
              name: "checkout-flow",
              ownership: "agent",
            },
          ],
        };
      },
      async useTaskSpace(id) {
        calls.push(["useTaskSpace:start", id]);
        await new Promise((resolve) => setTimeout(resolve, 0));
        calls.push(["useTaskSpace:end", id]);
      },
      async completeTaskSpace() {
        calls.push(["completeTaskSpace"]);
        return "7 task space completed.";
      },
    },
    async () => {
      await completeTaskSpace("checkout-flow", { keep: true });
    },
  );
  assert.deepEqual(calls, [
    ["listTaskSpaces"],
    ["useTaskSpace:start", 7],
    ["useTaskSpace:end", 7],
    ["completeTaskSpace"],
  ]);
});

test("completeTaskSpace claims user-owned spaces before closing", async () => {
  const calls = [];
  await withEgo(
    {
      async listTaskSpaces() {
        calls.push(["listTaskSpaces"]);
        return {
          taskSpaces: [
            {
              taskId: "checkout-flow",
              id: 7,
              name: "checkout-flow",
              ownership: "user",
            },
          ],
        };
      },
      async claimTaskSpace(id, name) {
        calls.push(["claimTaskSpace", id, name]);
        return { taskId: name, id, name, ownership: "agent" };
      },
      async useTaskSpace(id) {
        calls.push(["useTaskSpace", id]);
        return id;
      },
      async closeTaskSpace() {
        calls.push(["closeTaskSpace"]);
        return "7 task space closed.";
      },
    },
    async () => {
      const result = await completeTaskSpace("checkout-flow", { keep: false });
      assert.deepEqual(result, { done: true });
    },
  );
  assert.deepEqual(calls, [
    ["listTaskSpaces"],
    ["claimTaskSpace", 7, "checkout-flow"],
    ["useTaskSpace", 7],
    ["closeTaskSpace"],
  ]);
});

test("completeTaskSpace keep true skips user-owned spaces and reports it", async () => {
  const calls = [];
  await withEgo(
    {
      async listTaskSpaces() {
        calls.push(["listTaskSpaces"]);
        return {
          taskSpaces: [
            {
              taskId: "checkout-flow",
              id: 7,
              name: "checkout-flow",
              ownership: "user",
            },
          ],
        };
      },
      async completeTaskSpace() {
        calls.push(["completeTaskSpace"]);
      },
    },
    async () => {
      const result = await completeTaskSpace("checkout-flow", { keep: true });
      assert.deepEqual(result, { done: false, skipped: "user-owned" });
    },
  );
  assert.deepEqual(calls, [["listTaskSpaces"]]);
});

test("handOffTaskSpace skips user-owned spaces and reports it", async () => {
  const calls = [];
  await withEgo(
    {
      async listTaskSpaces() {
        calls.push(["listTaskSpaces"]);
        return {
          taskSpaces: [
            {
              taskId: "checkout-flow",
              id: 7,
              name: "checkout-flow",
              ownership: "user",
            },
          ],
        };
      },
      async handOffTaskSpace() {
        calls.push(["handOffTaskSpace"]);
      },
    },
    async () => {
      const result = await handOffTaskSpace("checkout-flow");
      assert.deepEqual(result, { done: false, skipped: "user-owned" });
    },
  );
  assert.deepEqual(calls, [["listTaskSpaces"]]);
});

test("handOffTaskSpace reports done for agent-owned spaces", async () => {
  const calls = [];
  await withEgo(
    {
      async listTaskSpaces() {
        calls.push(["listTaskSpaces"]);
        return {
          taskSpaces: [
            {
              taskId: "checkout-flow",
              id: 7,
              name: "checkout-flow",
              ownership: "agent",
            },
          ],
        };
      },
      async useTaskSpace(id) {
        calls.push(["useTaskSpace", id]);
        return id;
      },
      async handOffTaskSpace() {
        calls.push(["handOffTaskSpace"]);
      },
    },
    async () => {
      const result = await handOffTaskSpace("checkout-flow");
      assert.deepEqual(result, { done: true });
    },
  );
  assert.deepEqual(calls, [
    ["listTaskSpaces"],
    ["useTaskSpace", 7],
    ["handOffTaskSpace"],
  ]);
});

test("useOrCreateTaskSpace rejects unknown ownership", async () => {
  await withEgo(
    {
      async listTaskSpaces() {
        return {
          taskSpaces: [
            {
              taskId: "checkout-flow",
              id: 7,
              name: "checkout-flow",
              ownership: "shared",
            },
          ],
        };
      },
    },
    async () => {
      await assert.rejects(
        () => useOrCreateTaskSpace("checkout-flow"),
        /ownership "shared"/,
      );
    },
  );
});

// The probe in waitForAgentControl keys on ego.snapshot()'s rejection carrying
// error_code === EGO_TASK_SPACE_USER_IN_CONTROL (the documented contract), not on
// message wording. These tests pin that contract so a runtime that stops setting
// the code surfaces as a failing test rather than a silent regression.
function taskSpaceEgo(snapshot) {
  return {
    async listTaskSpaces() {
      return {
        taskSpaces: [{ taskId: "t", id: 1, name: "t", ownership: "agent" }],
      };
    },
    async useTaskSpace() {
      return 1;
    },
    snapshot,
  };
}

test("waitForAgentControl retries while snapshot reports user control", async () => {
  const sleepCalls = [];
  const restore = helperExports.__testing.setOverrides({
    sleep: (milliseconds) => {
      sleepCalls.push(milliseconds);
      return Promise.resolve();
    },
  });
  let calls = 0;
  try {
    await withEgo(
      taskSpaceEgo(async () => {
        calls += 1;
        if (calls < 3) {
          throw Object.assign(new Error("anything at all"), {
            error_code: "EGO_TASK_SPACE_USER_IN_CONTROL",
          });
        }
        return { content: "" };
      }),
      async () => {
        await helperContext().egoBrowser.waitForAgentControlTaskSpace("t", {
          interval: 25,
          timeout: 5_000,
        });
      },
    );
  } finally {
    restore();
  }
  assert.equal(calls, 3);
  assert.deepEqual(sleepCalls, [25, 25]);
});

test("waitForAgentControl reports timeout in milliseconds", async () => {
  await withEgo(
    taskSpaceEgo(async () => {
      throw Object.assign(new Error("user controls the task space"), {
        error_code: "EGO_TASK_SPACE_USER_IN_CONTROL",
      });
    }),
    async () => {
      await assert.rejects(
        () => waitForAgentControl("t", { interval: 0, timeout: 0 }),
        /timed out after 0ms/,
      );
    },
  );
});

test("waitForAgentControl propagates non-user-control snapshot errors", async () => {
  await withEgo(
    taskSpaceEgo(async () => {
      throw Object.assign(new Error("snapshot failed"), {
        error_code: "EGO_SNAPSHOT_FAILED",
      });
    }),
    async () => {
      await assert.rejects(
        () => waitForAgentControl("t", { interval: 0, timeout: 5_000 }),
        /snapshot failed/,
      );
    },
  );
});
