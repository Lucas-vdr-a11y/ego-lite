import test from "node:test";
import assert from "node:assert/strict";

import * as playwrightTaskSpace from "../dist/src/playwright-taskspace.js";

test("the Playwright connector returns the native active Page and its BrowserContext", async () => {
  assert.equal(
    typeof playwrightTaskSpace.createPlaywrightTaskSpaceConnector,
    "function",
  );

  const firstPage = { targetId: "target-first" };
  const activePage = { targetId: "target-active" };
  const calls = [];
  const context = {
    pages() {
      return [firstPage, activePage];
    },
    async newCDPSession(page) {
      return {
        async send(method) {
          assert.equal(method, "Target.getTargetInfo");
          return { targetInfo: { targetId: page.targetId } };
        },
        async detach() {},
      };
    },
  };
  const browser = {
    contexts() {
      return [context];
    },
    async close() {
      calls.push("browser.close");
    },
  };
  const runtime = {
    async listTabs() {
      return {
        tabs: [
          { targetId: firstPage.targetId, active: false },
          { targetId: activePage.targetId, active: true },
        ],
      };
    },
  };
  const connector = playwrightTaskSpace.createPlaywrightTaskSpaceConnector({
    runtime: () => runtime,
    endpoint: async (currentRuntime) => {
      assert.equal(currentRuntime, runtime);
      return "ws://127.0.0.1:1234/devtools/browser/token";
    },
    connectOverCDP: async (endpoint) => {
      assert.equal(endpoint, "ws://127.0.0.1:1234/devtools/browser/token");
      return browser;
    },
  });

  const session = await connector({ id: 7 });

  assert.equal(session.page, activePage);
  assert.equal(session.context, context);
  await session.close();
  assert.deepEqual(calls, ["browser.close"]);
});

test("the Playwright connector waits for a newly created TaskSpace Page", async () => {
  const page = { targetId: "target-delayed" };
  let pagesCalls = 0;
  const context = {
    pages() {
      pagesCalls += 1;
      return pagesCalls === 1 ? [] : [page];
    },
    async newCDPSession(targetPage) {
      return {
        async send() {
          return { targetInfo: { targetId: targetPage.targetId } };
        },
        async detach() {},
      };
    },
  };
  const connector = playwrightTaskSpace.createPlaywrightTaskSpaceConnector({
    runtime: () => ({
      async listTabs() {
        return { tabs: [{ targetId: page.targetId, active: true }] };
      },
    }),
    endpoint: async () => "ws://127.0.0.1:1234/devtools/browser/token",
    connectOverCDP: async () => ({
      contexts() {
        return [context];
      },
      async close() {},
    }),
  });

  const session = await connector({ id: 7 });
  assert.equal(session.page, page);
  assert.ok(pagesCalls >= 2);
  await session.close();
});

test("the Playwright connector falls back to the last native target", async () => {
  const firstPage = { targetId: "target-first" };
  const lastPage = { targetId: "target-last" };
  const context = {
    pages() {
      return [firstPage, lastPage];
    },
    async newCDPSession(page) {
      return {
        async send() {
          return { targetInfo: { targetId: page.targetId } };
        },
        async detach() {},
      };
    },
  };
  const connector = playwrightTaskSpace.createPlaywrightTaskSpaceConnector({
    runtime: () => ({
      async listTabs() {
        return {
          targetInfos: [
            { targetId: firstPage.targetId },
            { targetId: lastPage.targetId },
          ],
        };
      },
    }),
    endpoint: async () => "ws://127.0.0.1:1234/devtools/browser/token",
    connectOverCDP: async () => ({
      contexts() {
        return [context];
      },
      async close() {},
    }),
  });

  const session = await connector({ id: 7 });
  assert.equal(session.page, lastPage);
  await session.close();
});

test("the Playwright connector reuses one Browser connection across TaskSpace selections", async () => {
  const firstPage = { targetId: "target-first" };
  const secondPage = { targetId: "target-second" };
  let activeTargetId = firstPage.targetId;
  let connectCalls = 0;
  let browserCloseCalls = 0;
  const context = {
    pages() {
      return [firstPage, secondPage];
    },
    async newCDPSession(page) {
      return {
        async send() {
          return { targetInfo: { targetId: page.targetId } };
        },
        async detach() {},
      };
    },
  };
  const connector = playwrightTaskSpace.createPlaywrightTaskSpaceConnector({
    runtime: () => ({
      async listTabs() {
        return {
          tabs: [
            {
              targetId: firstPage.targetId,
              active: activeTargetId === firstPage.targetId,
            },
            {
              targetId: secondPage.targetId,
              active: activeTargetId === secondPage.targetId,
            },
          ],
        };
      },
    }),
    endpoint: async () => "ws://127.0.0.1:1234/devtools/browser/token",
    connectOverCDP: async () => {
      connectCalls += 1;
      return {
        contexts() {
          return [context];
        },
        async close() {
          browserCloseCalls += 1;
        },
      };
    },
  });

  const first = await connector({ id: 1 });
  activeTargetId = secondPage.targetId;
  const second = await connector({ id: 2 });

  assert.equal(first.page, firstPage);
  assert.equal(second.page, secondPage);
  assert.equal(first.close, second.close);
  assert.equal(connectCalls, 1);
  await second.close();
  assert.equal(browserCloseCalls, 1);
});

test("the Playwright connector reconnects when the TaskSpace endpoint changes", async () => {
  const calls = [];
  const connector = playwrightTaskSpace.createPlaywrightTaskSpaceConnector({
    runtime: () => ({
      async listTabs() {
        return { tabs: [] };
      },
    }),
    endpoint: async (_runtime, space) => `ws://task-space/${space.id}`,
    connectOverCDP: async (endpoint) => {
      calls.push(`connect:${endpoint}`);
      const page = { endpoint };
      const context = {
        pages() {
          return [page];
        },
        async newCDPSession() {
          return {
            async send() {
              return { targetInfo: {} };
            },
            async detach() {},
          };
        },
      };
      return {
        contexts() {
          return [context];
        },
        async close() {
          calls.push(`close:${endpoint}`);
        },
      };
    },
  });

  const first = await connector({ id: 1 });
  const second = await connector({ id: 2 });

  assert.equal(first.page.endpoint, "ws://task-space/1");
  assert.equal(second.page.endpoint, "ws://task-space/2");
  assert.deepEqual(calls, [
    "connect:ws://task-space/1",
    "close:ws://task-space/1",
    "connect:ws://task-space/2",
  ]);
  await second.close();
  assert.equal(calls.at(-1), "close:ws://task-space/2");
});

test("the native connector rejects a command-only CDP runtime", async () => {
  const previous = globalThis.ego;
  globalThis.ego = {
    async listTabs() {
      return { tabs: [] };
    },
    sendCDPMessage() {},
  };

  try {
    const connector =
      playwrightTaskSpace.createNativePlaywrightTaskSpaceConnector();
    await assert.rejects(
      () => connector({ id: 7 }),
      /requires ego\.getCDPEndpoint\(\).*sendCDPMessage is not sufficient/,
    );
  } finally {
    if (previous === undefined) delete globalThis.ego;
    else globalThis.ego = previous;
  }
});

test("connecting another TaskSpace closes the previous Playwright session", async () => {
  assert.equal(
    typeof playwrightTaskSpace.disconnectPlaywrightTaskSpace,
    "function",
  );
  const calls = [];
  const restore = playwrightTaskSpace.setPlaywrightTaskSpaceConnector(
    async (space) => {
      calls.push(`connect:${space.id}`);
      return {
        page: { taskSpaceId: space.id },
        context: { taskSpaceId: space.id },
        async close() {
          calls.push(`close:${space.id}`);
        },
      };
    },
  );

  try {
    await playwrightTaskSpace.connectPlaywrightTaskSpace({ id: 7 });
    await playwrightTaskSpace.connectPlaywrightTaskSpace({ id: 8 });
    await playwrightTaskSpace.disconnectPlaywrightTaskSpace();
  } finally {
    restore();
  }

  assert.deepEqual(calls, ["connect:7", "connect:8", "close:7", "close:8"]);
});
