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

// The benchmark's recurring failure was a task-space bring-up that produced no
// output at all: newTaskSpace() never returned, the agent script was hard-killed
// at its command budget, and everything it had already printed was lost with the
// process. prepareSession is the step that can do this — it calls
// page.evaluate(), and Playwright waits for an execution context with no
// deadline of its own, so a lost Runtime.executionContextCreated strands it
// forever. A bring-up deadline cannot make the context arrive; it makes the
// failure sayable.
test("a bring-up step that never settles fails with the step named instead of hanging", async () => {
  const calls = [];
  const page = { targetId: "target-1" };
  let released;
  const stalled = new Promise((resolve) => (released = resolve));
  const connector = playwrightTaskSpace.createPlaywrightTaskSpaceConnector({
    bringUpTimeoutMs: 200,
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
    // Stands in for page.evaluate() waiting on an execution context that never
    // arrives: pending, never rejecting.
    prepareSession: () => stalled,
  });

  await assert.rejects(
    () => connector({ id: 7 }),
    /TaskSpace bring-up stalled in prepareSession: no result within 200ms/,
    "the caller learns which step stalled, rather than waiting for a hard kill " +
      "that discards the script's output",
  );
  assert.deepEqual(
    calls,
    ["browser.close"],
    "and the half-built session is torn down rather than leaked",
  );
  released();
});

test("the bring-up deadline is one budget for the whole sequence, not one per step", async () => {
  const page = { targetId: "target-1" };
  const connector = playwrightTaskSpace.createPlaywrightTaskSpaceConnector({
    bringUpTimeoutMs: 300,
    runtime: () => ({
      async listTabs() {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return { tabs: [{ targetId: page.targetId, active: true }] };
      },
    }),
    transport: async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return { connectToken: "ws+ego://transport/test" };
    },
    connectOverCDP: async () => ({
      contexts() {
        return [{ pages: () => [page] }];
      },
      async close() {},
    }),
  });

  // Two 200ms steps: each is inside a 300ms per-step limit, their sum is not.
  await assert.rejects(
    () => connector({ id: 7 }),
    /TaskSpace bring-up stalled in ego\.listTabs/,
    "a sequence that keeps making slow progress must still not outlast the budget",
  );
});

test("a bring-up well inside the deadline is untouched by it", async () => {
  const page = { targetId: "target-1" };
  const context = { pages: () => [page] };
  const prepared = [];
  const connector = playwrightTaskSpace.createPlaywrightTaskSpaceConnector({
    bringUpTimeoutMs: 5_000,
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
    prepareSession: async (session) => prepared.push(session.page),
  });

  const session = await connector({ id: 7 });

  assert.equal(session.page, page);
  assert.deepEqual(prepared, [page]);
  await session.close();
});

// Losing the deadline race does not cancel the step. Two of them hand back
// something that owns a live resource, and the assignments that would let the
// teardown find it sit *after* the await that just rejected — so a late success
// is invisible to closeSession() and the connection stays open for the life of
// the browser.
test("a transport lease that arrives after its deadline is closed, not leaked", async () => {
  let lateLeaseClosed = 0;
  let connectCalled = 0;
  let release;
  const late = new Promise((resolve) => (release = resolve));
  const connector = playwrightTaskSpace.createPlaywrightTaskSpaceConnector({
    bringUpTimeoutMs: 50,
    runtime: () => ({
      async listTabs() {
        return { tabs: [] };
      },
    }),
    transport: () => late,
    connectOverCDP: async () => {
      connectCalled += 1;
      return { contexts: () => [], async close() {} };
    },
  });

  const failure = await connector({ id: 7 }).catch((error) => error);
  release({
    connectToken: "ws+ego://transport/test",
    close: async () => {
      lateLeaseClosed += 1;
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.match(
    failure?.message || "",
    /TaskSpace bring-up stalled in transport setup: no result within 50ms/,
  );
  assert.equal(
    lateLeaseClosed,
    1,
    "the lease nobody upstream ever saw is released exactly once",
  );
  assert.equal(
    connectCalled,
    0,
    "and the abandoned bring-up does not carry on to the next step",
  );
});

test("a browser connection that arrives after its deadline is closed, not leaked", async () => {
  let lateBrowserClosed = 0;
  let leaseClosed = 0;
  let release;
  const late = new Promise((resolve) => (release = resolve));
  const connector = playwrightTaskSpace.createPlaywrightTaskSpaceConnector({
    bringUpTimeoutMs: 50,
    runtime: () => ({
      async listTabs() {
        return { tabs: [] };
      },
    }),
    transport: async () => ({
      connectToken: "ws+ego://transport/test",
      close: async () => {
        leaseClosed += 1;
      },
    }),
    connectOverCDP: () => late,
  });

  const failure = await connector({ id: 7 }).catch((error) => error);
  release({
    contexts: () => [],
    async close() {
      lateBrowserClosed += 1;
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.match(
    failure?.message || "",
    /TaskSpace bring-up stalled in connectOverCDP: no result within 50ms/,
  );
  assert.equal(
    lateBrowserClosed,
    1,
    "the CDP connection nobody upstream ever saw is closed",
  );
  assert.equal(
    leaseClosed,
    1,
    "and the transport lease recorded before it is torn down as usual",
  );
});
