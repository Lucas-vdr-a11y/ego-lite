import test from "node:test";
import assert from "node:assert/strict";

import * as playwrightTaskSpace from "../../dist/src/playwright/taskspace.js";

test("the Playwright connector returns the active Page without probing another CDP session", async () => {
  const firstPage = { url: () => "https://example.test/first" };
  const activePage = { url: () => "https://example.test/active" };
  const calls = [];
  const context = {
    pages() {
      return [firstPage, activePage];
    },
    async newCDPSession() {
      throw new Error("must not attach another CDP session");
    },
  };
  const runtime = {
    async listTabs() {
      return {
        tabs: [
          {
            targetId: "target-first",
            active: false,
            url: "https://example.test/first",
          },
          {
            targetId: "target-active",
            active: true,
            url: "https://example.test/active",
          },
        ],
      };
    },
  };
  const connector = playwrightTaskSpace.createPlaywrightTaskSpaceConnector({
    runtime: () => runtime,
    transport: async () => ({ connectToken: "ws+ego://transport/test" }),
    connectOverCDP: async () => ({
      contexts() {
        return [context];
      },
      async close() {
        calls.push("browser.close");
      },
    }),
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
  };
  const connector = playwrightTaskSpace.createPlaywrightTaskSpaceConnector({
    runtime: () => ({
      async listTabs() {
        return { tabs: [{ targetId: page.targetId, active: true }] };
      },
    }),
    transport: async () => ({ connectToken: "ws+ego://transport/test" }),
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
    transport: async () => ({ connectToken: "ws+ego://transport/test" }),
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

test("the Playwright connector creates a fresh Browser connection for each selection", async () => {
  const firstPage = { targetId: "target-first" };
  const secondPage = { targetId: "target-second" };
  let activeTargetId = firstPage.targetId;
  let connectCalls = 0;
  let browserCloseCalls = 0;
  const context = {
    pages() {
      return [firstPage, secondPage];
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
    transport: async () => ({ connectToken: "ws+ego://transport/test" }),
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
  const second = await connector({ id: 1 });

  assert.equal(first.page, firstPage);
  assert.equal(second.page, secondPage);
  assert.equal(connectCalls, 2);
  assert.equal(browserCloseCalls, 1);
  await second.close();
  assert.equal(browserCloseCalls, 2);
});

test("closing a superseded session does not close the current one", async () => {
  const closes = [];
  let browserSeq = 0;
  const connector = playwrightTaskSpace.createPlaywrightTaskSpaceConnector({
    runtime: () => ({
      async listTabs() {
        return { tabs: [{ targetId: "target-1", active: true }] };
      },
    }),
    transport: async () => ({ connectToken: "ws+ego://transport/test" }),
    connectOverCDP: async () => {
      const id = ++browserSeq;
      return {
        contexts() {
          return [{ pages: () => [{ id }] }];
        },
        async close() {
          closes.push(`browser-${id}`);
        },
      };
    },
  });

  const first = await connector({ id: 1 });
  const second = await connector({ id: 1 });
  assert.deepEqual(closes, ["browser-1"]);

  await first.close();
  assert.deepEqual(
    closes,
    ["browser-1"],
    "a stale session close must not close the current session's browser",
  );

  await second.close();
  assert.deepEqual(closes, ["browser-1", "browser-2"]);
});

test("the Playwright connector recreates the transport when the same TaskSpace is selected again", async () => {
  let transportCalls = 0;
  let transportCloseCalls = 0;
  let connectCalls = 0;
  const page = {};
  const connector = playwrightTaskSpace.createPlaywrightTaskSpaceConnector({
    runtime: () => ({
      async listTabs() {
        return { tabs: [{ targetId: "target-1", active: true }] };
      },
    }),
    transport: async () => {
      transportCalls += 1;
      return {
        connectToken: `ws+ego://transport/${transportCalls}`,
        async close() {
          transportCloseCalls += 1;
        },
      };
    },
    connectOverCDP: async () => {
      connectCalls += 1;
      return {
        contexts() {
          return [{ pages: () => [page] }];
        },
        async close() {},
      };
    },
  });

  const first = await connector({ id: 7 });
  const second = await connector({ id: 7 });

  assert.equal(first.page, page);
  assert.equal(second.page, page);
  assert.equal(transportCalls, 2);
  assert.equal(connectCalls, 2);
  assert.equal(transportCloseCalls, 1);
  await second.close();
  assert.equal(transportCloseCalls, 2);
});

test("the Playwright connector reconnects when the TaskSpace changes", async () => {
  const calls = [];
  const connector = playwrightTaskSpace.createPlaywrightTaskSpaceConnector({
    runtime: () => ({
      async listTabs() {
        return { tabs: [] };
      },
    }),
    transport: async (_runtime, space) => ({
      connectToken: `ws+ego://transport/${space.id}`,
    }),
    connectOverCDP: async (connectToken) => {
      calls.push(`connect:${connectToken}`);
      const page = { connectToken };
      return {
        contexts() {
          return [{ pages: () => [page] }];
        },
        async close() {
          calls.push(`close:${connectToken}`);
        },
      };
    },
  });

  const first = await connector({ id: 1 });
  const second = await connector({ id: 2 });

  assert.equal(first.page.connectToken, "ws+ego://transport/1");
  assert.equal(second.page.connectToken, "ws+ego://transport/2");
  assert.deepEqual(calls, [
    "connect:ws+ego://transport/1",
    "close:ws+ego://transport/1",
    "connect:ws+ego://transport/2",
  ]);
  await second.close();
  assert.equal(calls.at(-1), "close:ws+ego://transport/2");
});

test("the Playwright connector closes a leased transport before Browser shutdown", async () => {
  const calls = [];
  const page = {};
  const connector = playwrightTaskSpace.createPlaywrightTaskSpaceConnector({
    runtime: () => ({
      async listTabs() {
        return { tabs: [{ targetId: "target-1", active: true }] };
      },
    }),
    transport: async () => ({
      connectToken: "ws+ego://transport/test",
      connected() {
        calls.push("transport.connected");
      },
      async close() {
        calls.push("transport.close");
      },
    }),
    connectOverCDP: async () => ({
      contexts() {
        return [{ pages: () => [page] }];
      },
      async close() {
        calls.push("browser.close");
      },
    }),
  });

  const session = await connector({ id: 1 });
  await session.close();

  assert.deepEqual(calls, [
    "transport.connected",
    "transport.close",
    "browser.close",
  ]);
});

test("only Playwright FrameThrottler timers are safe to unref", () => {
  const frameThrottlerStack = [
    "Error",
    "    at FrameThrottler._tick (/workspace/node_modules/playwright-core/lib/server/page.js:765:25)",
  ].join("\n");

  assert.equal(
    playwrightTaskSpace.isPlaywrightFrameThrottlerTimer(
      35,
      frameThrottlerStack,
    ),
    true,
  );
  assert.equal(
    playwrightTaskSpace.isPlaywrightFrameThrottlerTimer(
      200,
      frameThrottlerStack,
    ),
    true,
  );
  assert.equal(
    playwrightTaskSpace.isPlaywrightFrameThrottlerTimer(
      35,
      "Error\n    at FrameThrottler._tick (/release/index.js:1:12345)",
    ),
    true,
  );
  assert.equal(
    playwrightTaskSpace.isPlaywrightFrameThrottlerTimer(
      35,
      "Error\n    at Km._tick (/release/index.js:8473:12345)",
    ),
    true,
  );
  assert.equal(
    playwrightTaskSpace.isPlaywrightFrameThrottlerTimer(
      35,
      "Error\n    at userTimer (app.js:1:1)",
    ),
    false,
  );
  assert.equal(
    playwrightTaskSpace.isPlaywrightFrameThrottlerTimer(
      20_000,
      frameThrottlerStack,
    ),
    false,
  );
});

test("connecting another TaskSpace closes the previous Playwright session", async () => {
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

  assert.deepEqual(calls, ["connect:7", "close:7", "connect:8", "close:8"]);
});

test("preparing a different TaskSpace selection closes the current transport first", async () => {
  const calls = [];
  const restore = playwrightTaskSpace.setPlaywrightTaskSpaceConnector(
    async (space) => ({
      page: { taskSpaceId: space.id },
      context: { taskSpaceId: space.id },
      async close() {
        calls.push(`close:${space.id}`);
      },
    }),
  );

  try {
    await playwrightTaskSpace.connectPlaywrightTaskSpace({ id: 7 });
    await playwrightTaskSpace.disconnectPlaywrightTaskSpaceForSelection({
      id: 8,
    });
  } finally {
    restore();
    await playwrightTaskSpace.disconnectPlaywrightTaskSpace();
  }

  assert.deepEqual(calls, ["close:7"]);
});

test("preparing the same TaskSpace selection also closes the current transport", async () => {
  const calls = [];
  const restore = playwrightTaskSpace.setPlaywrightTaskSpaceConnector(
    async (space) => ({
      page: { taskSpaceId: space.id },
      context: { taskSpaceId: space.id },
      async close() {
        calls.push(`close:${space.id}`);
      },
    }),
  );

  try {
    await playwrightTaskSpace.connectPlaywrightTaskSpace({ id: 7 });
    await playwrightTaskSpace.disconnectPlaywrightTaskSpaceForSelection({
      id: 7,
    });
    assert.deepEqual(calls, ["close:7"]);
  } finally {
    restore();
    await playwrightTaskSpace.disconnectPlaywrightTaskSpace();
  }
});

test("the Playwright connector runs prepareSession once with the located Page and BrowserContext", async () => {
  const page = { targetId: "target-1" };
  const context = {
    pages() {
      return [page];
    },
  };
  const prepared = [];
  const connector = playwrightTaskSpace.createPlaywrightTaskSpaceConnector({
    runtime: () => ({
      async listTabs() {
        return { tabs: [{ targetId: page.targetId, active: true }] };
      },
    }),
    transport: async () => ({ connectToken: "ws+ego://transport/test" }),
    connectOverCDP: async () => ({
      contexts() {
        return [context];
      },
      async close() {},
    }),
    prepareSession: async (session) => {
      prepared.push(session);
    },
  });

  const session = await connector({ id: 7 });

  assert.equal(prepared.length, 1);
  assert.equal(prepared[0].page, page);
  assert.equal(prepared[0].context, context);
  assert.equal(prepared[0].page, session.page);
  assert.equal(prepared[0].context, session.context);
  assert.equal(typeof prepared[0].close, "function");
  await session.close();
});

test("a rejected prepareSession closes the Browser instead of leaking the connection", async () => {
  const calls = [];
  const page = { targetId: "target-1" };
  const connector = playwrightTaskSpace.createPlaywrightTaskSpaceConnector({
    runtime: () => ({
      async listTabs() {
        return { tabs: [{ targetId: page.targetId, active: true }] };
      },
    }),
    transport: async () => ({ connectToken: "ws+ego://transport/test" }),
    connectOverCDP: async () => ({
      contexts() {
        return [{ pages: () => [page] }];
      },
      async close() {
        calls.push("browser.close");
      },
    }),
    prepareSession: async () => {
      throw new Error("prepareSession failed");
    },
  });

  await assert.rejects(() => connector({ id: 7 }), /prepareSession failed/);
  assert.deepEqual(calls, ["browser.close"]);
});

test("the Playwright connector connects normally when no prepareSession hook is supplied", async () => {
  const calls = [];
  const page = { targetId: "target-1" };
  const context = {
    pages() {
      return [page];
    },
  };
  const connector = playwrightTaskSpace.createPlaywrightTaskSpaceConnector({
    runtime: () => ({
      async listTabs() {
        return { tabs: [{ targetId: page.targetId, active: true }] };
      },
    }),
    transport: async () => ({ connectToken: "ws+ego://transport/test" }),
    connectOverCDP: async () => ({
      contexts() {
        return [context];
      },
      async close() {
        calls.push("browser.close");
      },
    }),
  });

  const session = await connector({ id: 7 });

  assert.equal(session.page, page);
  assert.equal(session.context, context);
  await session.close();
  assert.deepEqual(calls, ["browser.close"]);
});
