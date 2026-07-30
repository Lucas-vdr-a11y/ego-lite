import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";

import {
  browserCdp,
  invalidateSession,
  pendingDialog,
} from "../../dist/src/browser-runtime.js";
import {
  iframeTarget,
  listTabs,
  newTab,
  openOrReuseTab,
  pageInfo,
  closeTab,
  switchTab,
} from "../../dist/src/driver/nav.js";
import { TimeoutError } from "../../dist/src/playwright-errors.js";
import { setOverrides, state } from "../../dist/src/state.js";

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

function withCdpRuntime(fn) {
  const previous = globalThis.ego;
  const sent = [];
  const runtime = {
    async listTabs() {
      return {
        tabs: [
          {
            targetId: "target-1",
            active: true,
            title: "Example",
            url: "https://example.com/",
          },
        ],
      };
    },
    sendCDPMessage(payload) {
      const request = JSON.parse(payload);
      sent.push(request);
      let result = {};
      if (request.method === "Target.attachToTarget") {
        result = { sessionId: "session-1" };
      } else if (request.method === "Runtime.evaluate") {
        result = {
          result: {
            value: JSON.stringify({
              url: "https://example.com/",
              title: "Example",
              w: 800,
              h: 600,
              sx: 0,
              sy: 0,
              pw: 800,
              ph: 1200,
            }),
          },
        };
      }
      queueMicrotask(() =>
        runtime.onCDPMessage(JSON.stringify({ id: request.id, result })),
      );
    },
    emit(method, params) {
      runtime.onCDPMessage(
        JSON.stringify({ sessionId: "session-1", method, params }),
      );
    },
  };
  globalThis.ego = runtime;
  invalidateSession();
  return Promise.resolve()
    .then(() => fn({ runtime, sent }))
    .finally(() => {
      invalidateSession();
      if (previous === undefined) {
        delete globalThis.ego;
      } else {
        globalThis.ego = previous;
      }
    });
}

function withOpenOrReuseLoadScenario(options, fn) {
  const existing = options.existing === true;
  const readyStates = options.readyStates || ["complete"];
  const calls = [];
  const sleeps = [];
  let readyStateIndex = 0;
  let now = 0;
  const tab = {
    targetId: existing ? "target-existing" : "target-new",
    active: existing,
    title: existing ? "Existing" : "",
    url: "https://example.com/target",
  };

  return withEgo(
    {
      async listTabs() {
        return { tabs: existing ? [tab] : [] };
      },
      async createTab() {
        return { targetId: tab.targetId };
      },
    },
    async () => {
      const restore = setOverrides({
        cdpOverride(method, params, sessionId, timeoutMs) {
          calls.push({ method, params, sessionId, timeoutMs });
          if (method === "Target.activateTarget") {
            return { success: true };
          }
          if (options.loadError && method === "Page.getFrameTree") {
            throw options.loadError;
          }
          if (method === "Page.getFrameTree") {
            return {
              frameTree: {
                frame: { url: tab.url },
              },
            };
          }
          if (method === "Runtime.evaluate") {
            const readyState =
              readyStates[Math.min(readyStateIndex, readyStates.length - 1)];
            readyStateIndex += 1;
            return { result: { value: readyState } };
          }
          throw new Error(`unexpected CDP method: ${method}`);
        },
        defaultTimeout: options.defaultTimeout ?? 30_000,
        defaultNavigationTimeout:
          options.defaultNavigationTimeout === undefined
            ? null
            : options.defaultNavigationTimeout,
        now: () => now,
        sleep: async (ms) => {
          sleeps.push(ms);
          now += ms;
        },
      });
      try {
        return await fn({ calls, sleeps, tab });
      } finally {
        restore();
      }
    },
  );
}

function withIframeTargetScenario({ tabs, targetInfos }, fn) {
  return withEgo(
    {
      async listTabs() {
        return { tabs };
      },
    },
    async () => {
      const restore = setOverrides({
        cdpOverride(method) {
          assert.equal(method, "Target.getTargets");
          return { targetInfos };
        },
      });
      try {
        return await fn();
      } finally {
        restore();
      }
    },
  );
}

test("listTabs throws on ego binding error objects", async () => {
  await withEgo(
    {
      async listTabs() {
        return { error: "The task is under user control" };
      },
    },
    async () => {
      await assert.rejects(
        () => listTabs(),
        /listTabs: The task is under user control/,
      );
    },
  );
});

test("newTab throws on ego binding error objects", async () => {
  await withEgo(
    {
      async createTab() {
        return { error: "The task is under user control" };
      },
    },
    async () => {
      await assert.rejects(
        () => newTab("https://example.com/"),
        /newTab: The task is under user control/,
      );
    },
  );
});

test("newTab throws when the binding returns no targetId", async () => {
  await withEgo(
    {
      async createTab() {
        return {};
      },
    },
    async () => {
      await assert.rejects(
        () => newTab("https://example.com/"),
        /newTab returned no targetId/,
      );
    },
  );
});

test("openOrReuseTab settles a newly opened tab in milliseconds, not seconds", async () => {
  // Regression: the new-tab branch used to sleep(settle * 1000), so settle:500
  // (documented as 500ms) blocked for 500 seconds while the reuse branch
  // already treated it as milliseconds.
  const sleeps = [];
  await withEgo(
    {
      async listTabs() {
        return { tabs: [] }; // no match → open a new tab
      },
      async createTab() {
        return { targetId: "target-new" };
      },
    },
    async () => {
      const restore = setOverrides({
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      });
      try {
        const opened = await openOrReuseTab("https://example.com/fresh", {
          wait: false,
          settle: 500,
        });
        assert.equal(opened.reused, false);
        assert.equal(opened.targetId, "target-new");
      } finally {
        restore();
      }
    },
  );

  assert.deepEqual(sleeps, [500]);
});

test("openOrReuseTab rejects when a newly opened tab misses an explicit load timeout", async () => {
  await withOpenOrReuseLoadScenario(
    { readyStates: ["loading"] },
    async ({ sleeps }) => {
      await assert.rejects(
        () =>
          openOrReuseTab("https://example.com/target", {
            timeout: 23,
            settle: 77,
          }),
        (error) => {
          assert.ok(error instanceof TimeoutError);
          assert.equal(error.name, "TimeoutError");
          assert.equal(
            error.message,
            "browser.openOrReuseTab timed out after 23ms",
          );
          return true;
        },
      );
      assert.deepEqual(
        sleeps,
        [300],
        "settle must not run after the load timeout",
      );
    },
  );
});

test("openOrReuseTab rejects when a reused tab misses the default navigation timeout", async () => {
  await withOpenOrReuseLoadScenario(
    {
      existing: true,
      readyStates: ["interactive"],
      defaultNavigationTimeout: 17,
      defaultTimeout: 91,
    },
    async () => {
      await assert.rejects(
        () =>
          openOrReuseTab("https://example.com/target", {
            wait: true,
          }),
        (error) => {
          assert.ok(error instanceof TimeoutError);
          assert.equal(
            error.message,
            "browser.openOrReuseTab timed out after 17ms",
          );
          return true;
        },
      );
    },
  );
});

test("openOrReuseTab falls back to the default action timeout when no navigation timeout exists", async () => {
  await withOpenOrReuseLoadScenario(
    {
      readyStates: ["loading"],
      defaultNavigationTimeout: null,
      defaultTimeout: 19,
    },
    async () => {
      await assert.rejects(
        () => openOrReuseTab("https://example.com/target"),
        (error) => {
          assert.ok(error instanceof TimeoutError);
          assert.equal(
            error.message,
            "browser.openOrReuseTab timed out after 19ms",
          );
          return true;
        },
      );
    },
  );
});

test("openOrReuseTab returns normally when requested document loads complete", async (t) => {
  for (const scenario of [
    {
      name: "new tab with its default wait",
      options: {},
      existing: false,
      reused: false,
    },
    {
      name: "reused tab with wait enabled",
      options: { wait: true },
      existing: true,
      reused: true,
    },
  ]) {
    await t.test(scenario.name, async () => {
      await withOpenOrReuseLoadScenario(
        { existing: scenario.existing, readyStates: ["complete"] },
        async ({ calls, tab }) => {
          const opened = await openOrReuseTab(
            "https://example.com/target",
            scenario.options,
          );
          assert.equal(opened.targetId, tab.targetId);
          assert.equal(opened.reused, scenario.reused);
          assert.equal(
            calls.filter((call) => call.method === "Runtime.evaluate").length,
            1,
          );
        },
      );
    });
  }
});

test("openOrReuseTab skips document loading when waiting is disabled", async (t) => {
  for (const scenario of [
    {
      name: "new tab with wait false",
      options: { wait: false, timeout: -1 },
      existing: false,
    },
    {
      name: "reused tab without explicit wait",
      options: { timeout: -1 },
      existing: true,
    },
  ]) {
    await t.test(scenario.name, async () => {
      await withOpenOrReuseLoadScenario(
        { existing: scenario.existing },
        async ({ calls }) => {
          await openOrReuseTab("https://example.com/target", scenario.options);
          assert.equal(
            calls.some(
              (call) =>
                call.method === "Page.getFrameTree" ||
                call.method === "Runtime.evaluate",
            ),
            false,
          );
        },
      );
    });
  }
});

test("openOrReuseTab treats timeout zero as an unlimited load wait", async () => {
  await withOpenOrReuseLoadScenario(
    { readyStates: ["loading", "complete"] },
    async ({ sleeps }) => {
      const opened = await openOrReuseTab("https://example.com/target", {
        timeout: 0,
      });
      assert.equal(opened.reused, false);
      assert.deepEqual(sleeps, [300]);
    },
  );
});

test("openOrReuseTab preserves task-space hard stops while loading", async (t) => {
  for (const existing of [false, true]) {
    await t.test(existing ? "reused tab" : "new tab", async () => {
      const hardStop = Object.assign(
        new Error("user controls the task space"),
        {
          error_code: "EGO_TASK_SPACE_USER_IN_CONTROL",
        },
      );
      await withOpenOrReuseLoadScenario(
        { existing, loadError: hardStop },
        async () => {
          await assert.rejects(
            () =>
              openOrReuseTab("https://example.com/target", {
                wait: true,
              }),
            (error) => error === hardStop,
          );
        },
      );
    });
  }
});

test("openOrReuseTab rejects invalid timeouts only when it waits for loading", async (t) => {
  for (const existing of [false, true]) {
    await t.test(existing ? "reused tab" : "new tab", async () => {
      await withOpenOrReuseLoadScenario({ existing }, async () => {
        await assert.rejects(
          () =>
            openOrReuseTab("https://example.com/target", {
              wait: existing ? true : undefined,
              timeout: -1,
            }),
          (error) => {
            assert.ok(error instanceof TypeError);
            assert.match(
              error.message,
              /timeout must be a non-negative number/,
            );
            return true;
          },
        );
      });
    });
  }
});

test("iframeTarget ignores matching iframe targets outside the current tab", async () => {
  await withIframeTargetScenario(
    {
      tabs: [
        {
          targetId: "target-current",
          active: true,
          title: "Current",
          url: "https://current.example/",
        },
        {
          targetId: "target-inactive",
          active: false,
          title: "Inactive",
          url: "https://inactive.example/",
        },
      ],
      targetInfos: [
        {
          targetId: "iframe-hidden",
          type: "iframe",
          url: "https://hidden.example/frame.html",
          parentId: "target-hidden",
          browserContextId: "shared-context",
        },
        {
          targetId: "iframe-inactive",
          type: "iframe",
          url: "https://inactive.example/frame.html",
          parentId: "target-inactive",
          browserContextId: "shared-context",
        },
        {
          targetId: "iframe-current",
          type: "iframe",
          url: "https://current.example/frame.html",
          parentId: "target-current",
          browserContextId: "shared-context",
        },
      ],
    },
    async () => {
      assert.equal(await iframeTarget("/frame.html"), "iframe-current");
    },
  );
});

test("iframeTarget follows nested iframe target ancestry to the current tab", async () => {
  await withIframeTargetScenario(
    {
      tabs: [
        {
          targetId: "target-current",
          active: true,
          title: "Current",
          url: "https://current.example/",
        },
      ],
      targetInfos: [
        {
          targetId: "iframe-parent",
          type: "iframe",
          url: "https://frames.example/outer.html",
          parentId: "target-current",
        },
        {
          targetId: "iframe-nested",
          type: "iframe",
          url: "https://frames.example/frame.html",
          parentId: "iframe-parent",
        },
      ],
    },
    async () => {
      assert.equal(await iframeTarget("/frame.html"), "iframe-nested");
    },
  );
});

test("iframeTarget returns null when only another tab has a matching target", async () => {
  await withIframeTargetScenario(
    {
      tabs: [
        {
          targetId: "target-current",
          active: true,
          title: "Current",
          url: "https://current.example/",
        },
      ],
      targetInfos: [
        {
          targetId: "iframe-other",
          type: "iframe",
          url: "https://other.example/frame.html",
          parentId: "target-other",
        },
      ],
    },
    async () => {
      assert.equal(await iframeTarget("/frame.html"), null);
    },
  );
});

test("iframeTarget rejects ambiguous matches under the current tab", async () => {
  await withIframeTargetScenario(
    {
      tabs: [
        {
          targetId: "target-current",
          active: true,
          title: "Current",
          url: "https://current.example/",
        },
      ],
      targetInfos: [
        {
          targetId: "iframe-first",
          type: "iframe",
          url: "https://frames.example/frame.html?slot=first",
          parentId: "target-current",
        },
        {
          targetId: "iframe-second",
          type: "iframe",
          url: "https://frames.example/frame.html?slot=second",
          parentId: "target-current",
        },
      ],
    },
    async () => {
      await assert.rejects(
        () => iframeTarget("/frame.html"),
        /iframeTarget matched 2 iframe targets under current tab target-current/,
      );
    },
  );
});

test("iframeTarget propagates task-space errors before target discovery", async () => {
  let cdpCalled = false;
  await withEgo(
    {
      async listTabs() {
        return {
          error: "The task is under user control",
          error_code: "EGO_TASK_SPACE_USER_IN_CONTROL",
        };
      },
    },
    async () => {
      const restore = setOverrides({
        cdpOverride() {
          cdpCalled = true;
          return { targetInfos: [] };
        },
      });
      try {
        await assert.rejects(
          () => iframeTarget("/frame.html"),
          (error) => {
            assert.equal(error.error_code, "EGO_TASK_SPACE_USER_IN_CONTROL");
            return true;
          },
        );
      } finally {
        restore();
      }
    },
  );
  assert.equal(cdpCalled, false);
});

test("switchTab refreshes the target list before activating it", async () => {
  const calls = [];
  await withEgo(
    {
      async listTabs() {
        return {
          tabs: [
            {
              targetId: "target-1",
              active: true,
              title: "Home",
              url: "https://example.com/",
            },
            {
              targetId: "target-2",
              active: false,
              title: "Docs",
              url: "https://example.com/docs",
            },
          ],
        };
      },
    },
    async () => {
      const restore = setOverrides({
        cdpOverride(method, params, sessionId) {
          calls.push({ method, params, sessionId });
          return { success: true };
        },
      });
      try {
        assert.equal(await switchTab({ targetId: "target-2" }), "target-2");
      } finally {
        restore();
      }
    },
  );

  assert.deepEqual(calls, [
    {
      method: "Target.activateTarget",
      params: { targetId: "target-2" },
      sessionId: undefined,
    },
  ]);
});

test("switchTab rejects a stale target with the refreshed tab list", async () => {
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
          return {};
        },
      });
      try {
        await assert.rejects(
          () => switchTab("target-stale"),
          (error) => {
            assert.match(error.message, /switchTab target not found/);
            assert.match(error.message, /target-stale/);
            assert.match(error.message, /target-current/);
            assert.match(error.message, /https:\/\/example\.com\/current/);
            return true;
          },
        );
      } finally {
        restore();
      }
    },
  );
  assert.equal(cdpCalled, false);
});

test("switchTab rejects tab objects without targetId at the boundary", async () => {
  await assert.rejects(
    () => switchTab({ id: "target-2" }),
    /switchTab requires a targetId.*received.*id/,
  );
});

test("closeTab closes an explicit current target and returns its id", async () => {
  const calls = [];
  await withEgo(
    {
      async listTabs() {
        return {
          tabs: [
            {
              targetId: "target-2",
              active: true,
              title: "Example",
              url: "https://example.com/",
            },
          ],
        };
      },
    },
    async () => {
      const restore = setOverrides({
        cdpOverride(method, params, sessionId) {
          calls.push({ method, params, sessionId });
          return { success: true };
        },
      });
      try {
        assert.equal(await closeTab("target-2"), "target-2");
      } finally {
        restore();
      }
    },
  );

  assert.deepEqual(calls, [
    {
      method: "Target.closeTarget",
      params: { targetId: "target-2" },
      sessionId: undefined,
    },
  ]);
});

test("closeTab rejects a stale explicit target before CDP dispatch", async () => {
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
          return {};
        },
      });
      try {
        await assert.rejects(
          () => closeTab("target-stale"),
          /closeTab target not found.*target-stale.*target-current/,
        );
      } finally {
        restore();
      }
    },
  );
  assert.equal(cdpCalled, false);
});

test("closeTab waits for a closed target to disappear from listTabs", async () => {
  let listCount = 0;
  let now = 0;
  const sleeps = [];
  await withEgo(
    {
      async listTabs() {
        listCount += 1;
        const scratchStillListed = listCount < 3;
        return {
          tabs: [
            {
              targetId: "target-current",
              active: !scratchStillListed,
              title: "Current",
              url: "https://example.com/current",
            },
            ...(scratchStillListed
              ? [
                  {
                    targetId: "target-scratch",
                    active: true,
                    title: "Scratch",
                    url: "https://example.com/scratch",
                  },
                ]
              : []),
          ],
        };
      },
    },
    async () => {
      const restore = setOverrides({
        cdpOverride: async () => ({ success: true }),
        now: () => now,
        sleep: async (ms) => {
          sleeps.push(ms);
          now += ms;
        },
      });
      try {
        assert.equal(await closeTab("target-scratch"), "target-scratch");
        assert.deepEqual(sleeps, [50]);
      } finally {
        restore();
      }
    },
  );
});

test("closeTab closes the current tab and invalidates matching session state", async () => {
  const calls = [];
  await withEgo(
    {
      async listTabs() {
        return {
          tabs: [
            {
              targetId: "target-1",
              active: true,
              title: "Example",
              url: "https://example.com/",
            },
          ],
        };
      },
    },
    async () => {
      const restore = setOverrides({
        cdpOverride(method, params, sessionId) {
          calls.push({ method, params, sessionId });
          return { success: true };
        },
        sessionId: "session-1",
        sessionTargetId: "target-1",
        sessionAt: Date.now(),
        preferredTargetId: "target-1",
      });
      try {
        assert.equal(await closeTab(), "target-1");
        assert.equal(state.sessionId, null);
        assert.equal(state.sessionTargetId, null);
        assert.equal(state.preferredTargetId, null);
      } finally {
        restore();
      }
    },
  );

  assert.deepEqual(calls, [
    {
      method: "Target.closeTarget",
      params: { targetId: "target-1" },
      sessionId: undefined,
    },
  ]);
});

test("browser runtime enables Page events and tracks pending native dialogs", async () => {
  await withCdpRuntime(async ({ runtime, sent }) => {
    await browserCdp("Runtime.evaluate", { expression: "document.title" });

    assert.deepEqual(
      sent.map((request) => request.method),
      ["Target.attachToTarget", "Page.enable", "Runtime.evaluate"],
    );
    assert.equal(sent[1].sessionId, "session-1");

    runtime.emit("Page.javascriptDialogOpening", {
      type: "alert",
      message: "Confirm action",
      url: "https://example.com/",
    });
    assert.deepEqual(pendingDialog(), {
      type: "alert",
      message: "Confirm action",
      url: "https://example.com/",
    });

    runtime.emit("Page.javascriptDialogClosed", { result: true });
    assert.equal(pendingDialog(), null);
  });
});

test("pageInfo returns pending dialog without evaluating frozen page JavaScript", async () => {
  await withCdpRuntime(async ({ runtime, sent }) => {
    await browserCdp("Runtime.evaluate", { expression: "document.title" });
    sent.length = 0;

    runtime.emit("Page.javascriptDialogOpening", {
      type: "confirm",
      message: "Leave page?",
      url: "https://example.com/",
    });

    assert.deepEqual(await pageInfo(), {
      dialog: {
        type: "confirm",
        message: "Leave page?",
        url: "https://example.com/",
      },
    });
    assert.equal(
      sent.some((request) => request.method === "Runtime.evaluate"),
      false,
    );
  });
});

test("pageInfo tolerates a transient document without documentElement", async () => {
  const restore = setOverrides({
    cdpOverride: async (method, params) => {
      assert.equal(method, "Runtime.evaluate");
      const value = runInNewContext(params.expression, {
        document: {
          documentElement: null,
          title: "Loading",
        },
        innerHeight: 600,
        innerWidth: 800,
        location: { href: "https://example.com/loading" },
        scrollX: 0,
        scrollY: 0,
      });
      return { result: { value } };
    },
  });
  try {
    assert.deepEqual(await pageInfo(), {
      url: "https://example.com/loading",
      title: "Loading",
      w: 800,
      h: 600,
      sx: 0,
      sy: 0,
      pw: 800,
      ph: 600,
    });
  } finally {
    restore();
  }
});
