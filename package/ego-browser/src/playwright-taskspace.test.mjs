import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";

import * as playwrightTaskSpace from "../dist/src/playwright-taskspace.js";
import { browserCdp } from "../dist/src/browser-runtime.js";

test("the Playwright connector returns the active Page without probing another CDP session", async () => {
  assert.equal(
    typeof playwrightTaskSpace.createPlaywrightTaskSpaceConnector,
    "function",
  );

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

test("the Playwright connector closes a leased endpoint before awaiting Browser shutdown", async () => {
  const calls = [];
  const page = {};
  const connector = playwrightTaskSpace.createPlaywrightTaskSpaceConnector({
    runtime: () => ({
      async listTabs() {
        return { tabs: [{ targetId: "target-1", active: true }] };
      },
    }),
    endpoint: async () => ({
      endpoint: "ws://local-bridge",
      async close() {
        calls.push("endpoint.close");
      },
    }),
    connectOverCDP: async () => ({
      contexts() {
        return [
          {
            pages() {
              return [page];
            },
          },
        ];
      },
      async close() {
        calls.push("browser.close");
      },
    }),
  });

  const session = await connector({ id: 1 });
  await session.close();

  assert.deepEqual(calls, ["endpoint.close", "browser.close"]);
});

test("the native endpoint falls back to a local bridge for a command-only CDP runtime", async () => {
  const runtime = { sendCDPMessage() {} };
  let endpoint;
  try {
    endpoint = await playwrightTaskSpace.resolveNativeCdpEndpoint(runtime, {
      id: 7,
    });
    if (process.platform === "win32") {
      assert.match(endpoint.endpoint, /^ws:\/\/127\.0\.0\.1:\d+\//);
    } else {
      assert.match(endpoint.endpoint, /^ws\+unix:\/\/\/.+\.sock:\//);
    }
    assert.equal(typeof endpoint.close, "function");
  } finally {
    await endpoint?.close();
  }
});

test("the local CDP connector unreferences only sockets created for its endpoint", () => {
  const calls = [];
  const existingSocket = {
    constructor: { name: "Socket" },
    unref() {
      calls.push("existing");
    },
  };
  const localSocket = {
    constructor: { name: "Socket" },
    unref() {
      calls.push("local");
    },
  };
  const localServer = {
    constructor: { name: "Server" },
    unref() {
      calls.push("server");
    },
  };

  playwrightTaskSpace.unrefNewLocalCdpHandles(
    "ws+unix:///tmp/ego.sock:/devtools/browser/token",
    new Set([existingSocket]),
    [existingSocket, localSocket, localServer],
  );
  playwrightTaskSpace.unrefNewLocalCdpHandles(
    "wss://remote.example/devtools/browser/token",
    new Set(),
    [
      {
        constructor: { name: "Socket" },
        unref() {
          calls.push("remote");
        },
      },
    ],
  );

  assert.deepEqual(calls, ["local"]);
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

test("the local CDP bridge round-trips requests without leaking its message ids", async () => {
  const nativeRequests = [];
  const runtime = {
    sendCDPMessage(payload) {
      const request = JSON.parse(payload);
      nativeRequests.push(request);
      queueMicrotask(() => {
        runtime.onCDPMessage(
          JSON.stringify({
            id: request.id,
            result: { product: "ego-lite", method: request.method },
          }),
        );
      });
    },
  };
  let bridge;
  let socket;
  try {
    bridge = await playwrightTaskSpace.createLocalCdpBridge(runtime);
    const { ws: WebSocket } = await import("playwright-core/lib/utilsBundle");
    socket = new WebSocket(bridge.endpoint);
    await once(socket, "open");

    const responsePromise = once(socket, "message");
    socket.send(
      JSON.stringify({ id: 17, method: "Target.getTargets", params: {} }),
    );
    const [rawResponse] = await responsePromise;

    assert.deepEqual(JSON.parse(rawResponse.toString()), {
      id: 17,
      result: { product: "ego-lite", method: "Target.getTargets" },
    });
    assert.notEqual(nativeRequests[0].id, 17);
    assert.equal(nativeRequests[0].method, "Target.getTargets");
  } finally {
    socket?.terminate();
    await bridge?.close();
  }
});

test("the local CDP bridge supplies the Browser commands required by Playwright", async () => {
  const nativeRequests = [];
  const runtime = {
    sendCDPMessage(payload) {
      nativeRequests.push(JSON.parse(payload));
      throw new Error("unexpected native Browser command");
    },
  };
  let bridge;
  let socket;
  try {
    bridge = await playwrightTaskSpace.createLocalCdpBridge(runtime);
    const { ws: WebSocket } = await import("playwright-core/lib/utilsBundle");
    socket = new WebSocket(bridge.endpoint);
    await once(socket, "open");

    const versionPromise = once(socket, "message");
    socket.send(
      JSON.stringify({ id: 31, method: "Browser.getVersion", params: {} }),
    );
    const [rawVersion] = await versionPromise;
    const version = JSON.parse(rawVersion.toString());
    assert.equal(version.id, 31);
    assert.equal(version.result.protocolVersion, "1.3");
    assert.match(version.result.product, /^Chrome\//);
    assert.doesNotMatch(version.result.userAgent, /Headless/);

    const downloadPromise = once(socket, "message");
    socket.send(
      JSON.stringify({
        id: 32,
        method: "Browser.setDownloadBehavior",
        params: { behavior: "allowAndName", downloadPath: "/tmp/downloads" },
      }),
    );
    const [rawDownload] = await downloadPromise;
    assert.deepEqual(JSON.parse(rawDownload.toString()), {
      id: 32,
      result: {},
    });
    assert.deepEqual(nativeRequests, []);
  } finally {
    socket?.terminate();
    await bridge?.close();
  }
});

test("the local CDP bridge completes Page.navigate from the native navigation event", async () => {
  const runtime = {
    async listTabs() {
      return { tabs: [{ targetId: "task-target", active: true }] };
    },
    sendCDPMessage(payload) {
      const request = JSON.parse(payload);
      if (request.method !== "Page.navigate") return;
      queueMicrotask(() => {
        runtime.onCDPMessage(
          JSON.stringify({
            method: "Page.frameStartedNavigating",
            params: {
              frameId: "task-frame",
              loaderId: "native-loader",
              url: request.params.url,
              navigationType: "differentDocument",
            },
            sessionId: "task-session",
          }),
        );
      });
    },
  };
  let bridge;
  let socket;
  try {
    bridge = await playwrightTaskSpace.createLocalCdpBridge(runtime);
    const { ws: WebSocket } = await import("playwright-core/lib/utilsBundle");
    socket = new WebSocket(bridge.endpoint);
    await once(socket, "open");
    const attachedPromise = once(socket, "message");
    runtime.onCDPMessage(
      JSON.stringify({
        method: "Target.attachedToTarget",
        params: {
          sessionId: "task-session",
          targetInfo: { targetId: "task-target", type: "page" },
        },
      }),
    );
    await attachedPromise;

    const messages = [];
    socket.on("message", (message) => {
      messages.push(JSON.parse(message.toString()));
    });
    socket.send(
      JSON.stringify({
        id: 35,
        method: "Page.navigate",
        params: { frameId: "task-frame", url: "https://example.test/" },
        sessionId: "task-session",
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.deepEqual(messages, [
      {
        method: "Runtime.executionContextsCleared",
        params: {},
        sessionId: "task-session",
      },
      {
        id: 35,
        result: { frameId: "task-frame", loaderId: "native-loader" },
        sessionId: "task-session",
      },
      {
        method: "Page.frameNavigated",
        params: {
          frame: {
            id: "task-frame",
            loaderId: "native-loader",
            name: "",
            url: "https://example.test/",
          },
        },
        sessionId: "task-session",
      },
      {
        method: "Page.frameStartedNavigating",
        params: {
          frameId: "task-frame",
          loaderId: "native-loader",
          url: "https://example.test/",
          navigationType: "differentDocument",
        },
        sessionId: "task-session",
      },
    ]);
  } finally {
    socket?.terminate();
    await bridge?.close();
  }
});

test("the local CDP bridge keeps the Playwright session stable across a renderer swap", async () => {
  const nativeRequests = [];
  let attachCount = 0;
  let navigated = false;
  const runtime = {
    async listTabs() {
      return {
        tabs: [
          {
            targetId: "task-target",
            active: true,
            url: navigated
              ? "https://example.test/after"
              : "chrome://new-tab-page/",
          },
        ],
      };
    },
    sendCDPMessage(payload) {
      const request = JSON.parse(payload);
      nativeRequests.push(request);
      queueMicrotask(() => {
        if (request.method === "Page.navigate") {
          navigated = true;
          runtime.onCDPMessage(
            JSON.stringify({
              method: "Page.frameStartedNavigating",
              params: {
                frameId: "task-frame",
                loaderId: "new-loader",
                url: request.params.url,
                navigationType: "differentDocument",
              },
              sessionId: request.sessionId,
            }),
          );
          return;
        }

        let result = {};
        if (request.method === "Target.getTargetInfo") {
          result = {
            targetInfo: {
              targetId: "task-target",
              type: "page",
              title: "Task tab",
              url: navigated
                ? "https://example.test/after"
                : "chrome://new-tab-page/",
              attached: true,
              canAccessOpener: false,
              browserContextId: "context-1",
            },
          };
        } else if (request.method === "Target.attachToTarget") {
          attachCount += 1;
          result = {
            sessionId:
              attachCount === 1 ? "playwright-session" : "renderer-session",
          };
        } else if (request.method === "Runtime.evaluate") {
          result = {
            result: {
              type: "string",
              value:
                request.params.expression === "document.readyState"
                  ? "complete"
                  : "evaluated-on-current-renderer",
            },
          };
        }
        runtime.onCDPMessage(
          JSON.stringify({
            id: request.id,
            result,
            ...(request.sessionId ? { sessionId: request.sessionId } : {}),
          }),
        );
        if (
          request.method === "Runtime.enable" &&
          request.sessionId === "renderer-session"
        ) {
          runtime.onCDPMessage(
            JSON.stringify({
              method: "Runtime.executionContextCreated",
              params: {
                context: {
                  id: 77,
                  origin: "https://example.test",
                  name: "",
                  auxData: {
                    frameId: "task-frame",
                    isDefault: true,
                    type: "default",
                  },
                },
              },
              sessionId: "renderer-session",
            }),
          );
        }
      });
    },
  };
  let bridge;
  let socket;
  try {
    bridge = await playwrightTaskSpace.createLocalCdpBridge(runtime);
    const { ws: WebSocket } = await import("playwright-core/lib/utilsBundle");
    socket = new WebSocket(bridge.endpoint);
    await once(socket, "open");
    const messages = [];
    socket.on("message", (message) => {
      messages.push(JSON.parse(message.toString()));
    });
    const waitForMessage = async (predicate) => {
      const deadline = Date.now() + 500;
      while (Date.now() < deadline) {
        const found = messages.find(predicate);
        if (found) return found;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      assert.fail(
        `timed out waiting for bridge message: ${JSON.stringify(messages)}`,
      );
    };

    socket.send(
      JSON.stringify({
        id: 51,
        method: "Target.setAutoAttach",
        params: {
          autoAttach: true,
          waitForDebuggerOnStart: true,
          flatten: true,
        },
      }),
    );
    await waitForMessage((message) => message.id === 51);
    socket.send(
      JSON.stringify({
        id: 52,
        method: "Runtime.enable",
        params: {},
        sessionId: "playwright-session",
      }),
    );
    await waitForMessage((message) => message.id === 52);

    socket.send(
      JSON.stringify({
        id: 53,
        method: "Page.navigate",
        params: {
          frameId: "task-frame",
          url: "https://example.test/after",
        },
        sessionId: "playwright-session",
      }),
    );
    await waitForMessage(
      (message) => message.method === "Runtime.executionContextCreated",
    );

    socket.send(
      JSON.stringify({
        id: 54,
        method: "Runtime.evaluate",
        params: { expression: "42" },
        sessionId: "playwright-session",
      }),
    );
    const evaluation = await waitForMessage((message) => message.id === 54);

    assert.equal(attachCount, 2);
    assert.equal(
      nativeRequests.find((request) => request.sessionId === "renderer-session")
        .method,
      "Runtime.runIfWaitingForDebugger",
    );
    assert.equal(
      nativeRequests.find(
        (request) =>
          request.method === "Runtime.evaluate" &&
          request.params.expression === "42",
      ).sessionId,
      "renderer-session",
    );
    assert.equal(evaluation.sessionId, "playwright-session");
    assert.equal(
      evaluation.result.result.value,
      "evaluated-on-current-renderer",
    );
    assert.ok(
      messages.some(
        (message) =>
          message.method === "Runtime.executionContextCreated" &&
          message.sessionId === "playwright-session",
      ),
    );
  } finally {
    socket?.terminate();
    await bridge?.close();
  }
});

test("the local CDP bridge replaces a navigated native tab behind the stable Playwright Page", async () => {
  const nativeRequests = [];
  const createdUrls = [];
  let attachCount = 0;
  const runtime = {
    async listTabs() {
      return {
        tabs: [
          {
            targetId: "original-target",
            active: true,
            url: "chrome://new-tab-page/",
          },
        ],
      };
    },
    async createTab(url) {
      createdUrls.push(url);
      runtime.onCDPMessage(
        JSON.stringify({
          method: "Runtime.executionContextCreated",
          params: {
            context: {
              id: 87,
              origin: "chrome://new-tab-page",
              name: "",
              auxData: {
                frameId: "playwright-frame",
                isDefault: true,
                type: "default",
              },
            },
          },
          sessionId: "playwright-session",
        }),
      );
      return { targetId: "replacement-target" };
    },
    sendCDPMessage(payload) {
      const request = JSON.parse(payload);
      nativeRequests.push(request);
      queueMicrotask(() => {
        let result = {};
        if (request.method === "Target.getTargetInfo") {
          const targetId = request.params.targetId;
          result = {
            targetInfo: {
              targetId,
              type: "page",
              title: targetId === "replacement-target" ? "After" : "Before",
              url:
                targetId === "replacement-target"
                  ? "https://example.test/after"
                  : "chrome://new-tab-page/",
              attached: true,
              canAccessOpener: false,
              browserContextId: "context-1",
            },
          };
        } else if (request.method === "Target.attachToTarget") {
          attachCount += 1;
          result = {
            sessionId:
              attachCount === 1 ? "playwright-session" : "replacement-session",
          };
        } else if (request.method === "Page.getFrameTree") {
          result = {
            frameTree: {
              frame: {
                id: "replacement-frame",
                loaderId: "replacement-loader",
                url: "https://example.test/after",
                name: "",
              },
            },
          };
        } else if (request.method === "Runtime.evaluate") {
          result = {
            result: { type: "string", value: "complete" },
          };
        }
        runtime.onCDPMessage(
          JSON.stringify({
            id: request.id,
            result,
            ...(request.sessionId ? { sessionId: request.sessionId } : {}),
          }),
        );
        if (
          request.method === "Runtime.enable" &&
          request.sessionId === "replacement-session"
        ) {
          runtime.onCDPMessage(
            JSON.stringify({
              method: "Runtime.executionContextCreated",
              params: {
                context: {
                  id: 88,
                  origin: "https://example.test",
                  name: "",
                  auxData: {
                    frameId: "replacement-frame",
                    isDefault: true,
                    type: "default",
                  },
                },
              },
              sessionId: "replacement-session",
            }),
          );
        }
      });
    },
  };
  let bridge;
  let socket;
  try {
    bridge = await playwrightTaskSpace.createLocalCdpBridge(runtime);
    const { ws: WebSocket } = await import("playwright-core/lib/utilsBundle");
    socket = new WebSocket(bridge.endpoint);
    await once(socket, "open");
    const messages = [];
    socket.on("message", (message) => {
      messages.push(JSON.parse(message.toString()));
    });
    const waitForMessage = async (predicate) => {
      const deadline = Date.now() + 500;
      while (Date.now() < deadline) {
        const found = messages.find(predicate);
        if (found) return found;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      assert.fail(
        `timed out waiting for bridge message: ${JSON.stringify(messages)}`,
      );
    };

    socket.send(
      JSON.stringify({
        id: 61,
        method: "Target.setAutoAttach",
        params: {
          autoAttach: true,
          waitForDebuggerOnStart: true,
          flatten: true,
        },
      }),
    );
    await waitForMessage((message) => message.id === 61);
    socket.send(
      JSON.stringify({
        id: 62,
        method: "Runtime.enable",
        params: {},
        sessionId: "playwright-session",
      }),
    );
    await waitForMessage((message) => message.id === 62);
    socket.send(
      JSON.stringify({
        id: 63,
        method: "Page.navigate",
        params: {
          frameId: "playwright-frame",
          url: "https://example.test/after",
        },
        sessionId: "playwright-session",
      }),
    );

    const navigation = await waitForMessage((message) => message.id === 63);
    const executionContext = await waitForMessage(
      (message) => message.method === "Runtime.executionContextCreated",
    );

    assert.deepEqual(createdUrls, ["https://example.test/after"]);
    assert.equal(
      nativeRequests.some((request) => request.method === "Page.navigate"),
      false,
    );
    assert.deepEqual(navigation, {
      id: 63,
      result: {
        frameId: "playwright-frame",
        loaderId: "replacement-loader",
      },
      sessionId: "playwright-session",
    });
    assert.equal(executionContext.sessionId, "playwright-session");
    assert.equal(
      executionContext.params.context.origin,
      "https://example.test",
    );
    assert.equal(
      executionContext.params.context.auxData.frameId,
      "playwright-frame",
    );
    assert.ok(
      nativeRequests.some(
        (request) =>
          request.method === "Target.closeTarget" &&
          request.params.targetId === "original-target",
      ),
    );
    assert.ok(
      nativeRequests.findIndex(
        (request) =>
          request.method === "Target.closeTarget" &&
          request.params.targetId === "original-target",
      ) <
        nativeRequests.findIndex(
          (request) =>
            request.method === "Runtime.enable" &&
            request.sessionId === "replacement-session",
        ),
      "the old native tab closes before replacement session replay",
    );

    socket.send(
      JSON.stringify({
        id: 64,
        method: "Target.closeTarget",
        params: { targetId: "original-target" },
      }),
    );
    const closeResponse = await waitForMessage((message) => message.id === 64);
    const detached = await waitForMessage(
      (message) => message.method === "Target.detachedFromTarget",
    );
    assert.deepEqual(closeResponse, { id: 64, result: { success: true } });
    assert.deepEqual(detached, {
      method: "Target.detachedFromTarget",
      params: {
        sessionId: "playwright-session",
        targetId: "original-target",
      },
    });
    assert.ok(
      nativeRequests.some(
        (request) =>
          request.method === "Target.closeTarget" &&
          request.params.targetId === "replacement-target",
      ),
    );
  } finally {
    socket?.terminate();
    await bridge?.close();
  }
});

test("the local CDP bridge forwards native CDP events", async () => {
  const runtime = { sendCDPMessage() {} };
  let bridge;
  let socket;
  try {
    bridge = await playwrightTaskSpace.createLocalCdpBridge(runtime);
    const { ws: WebSocket } = await import("playwright-core/lib/utilsBundle");
    socket = new WebSocket(bridge.endpoint);
    await once(socket, "open");

    const eventPromise = once(socket, "message");
    runtime.onCDPMessage(
      JSON.stringify({
        method: "Target.targetCreated",
        params: { targetInfo: { targetId: "target-7" } },
      }),
    );
    const [rawEvent] = await eventPromise;

    assert.deepEqual(JSON.parse(rawEvent.toString()), {
      method: "Target.targetCreated",
      params: { targetInfo: { targetId: "target-7" } },
    });
  } finally {
    socket?.terminate();
    await bridge?.close();
  }
});

test("the local CDP bridge exposes only targets from the selected TaskSpace", async () => {
  const runtime = {
    async listTabs() {
      return { tabs: [{ targetId: "task-target", active: true }] };
    },
    sendCDPMessage() {},
  };
  let bridge;
  let socket;
  try {
    bridge = await playwrightTaskSpace.createLocalCdpBridge(runtime);
    const { ws: WebSocket } = await import("playwright-core/lib/utilsBundle");
    socket = new WebSocket(bridge.endpoint);
    await once(socket, "open");

    const messages = [];
    const received = new Promise((resolve) => {
      socket.on("message", (message) => {
        messages.push(JSON.parse(message.toString()));
        if (messages.length === 1) resolve();
      });
    });
    runtime.onCDPMessage(
      JSON.stringify({
        method: "Target.attachedToTarget",
        params: {
          sessionId: "user-session",
          targetInfo: { targetId: "user-target", type: "page" },
        },
      }),
    );
    runtime.onCDPMessage(
      JSON.stringify({
        method: "Network.requestWillBeSent",
        sessionId: "user-session",
        params: { requestId: "private-request" },
      }),
    );
    runtime.onCDPMessage(
      JSON.stringify({
        method: "Target.attachedToTarget",
        params: {
          sessionId: "task-session",
          targetInfo: { targetId: "task-target", type: "page" },
        },
      }),
    );
    await received;

    assert.deepEqual(messages, [
      {
        method: "Target.attachedToTarget",
        params: {
          sessionId: "task-session",
          targetInfo: { targetId: "task-target", type: "page" },
        },
      },
    ]);
  } finally {
    socket?.terminate();
    await bridge?.close();
  }
});

test("the local CDP bridge replaces root auto-attach with TaskSpace-scoped manual attach", async () => {
  const nativeRequests = [];
  const runtime = {
    async listTabs() {
      return {
        tabs: [
          {
            targetId: "task-target",
            active: true,
            title: "Task tab",
            url: "https://example.test/",
          },
        ],
      };
    },
    sendCDPMessage(payload) {
      const request = JSON.parse(payload);
      nativeRequests.push(request);
      queueMicrotask(() => {
        const result =
          request.method === "Target.attachToTarget"
            ? { sessionId: "manual-session" }
            : request.method === "Target.getTargetInfo"
              ? {
                  targetInfo: {
                    targetId: "task-target",
                    type: "page",
                    title: "Task tab",
                    url: "https://example.test/",
                    attached: true,
                    canAccessOpener: false,
                    browserContextId: "context-1",
                  },
                }
              : {};
        runtime.onCDPMessage(JSON.stringify({ id: request.id, result }));
      });
    },
  };
  let bridge;
  let socket;
  try {
    bridge = await playwrightTaskSpace.createLocalCdpBridge(runtime);
    const { ws: WebSocket } = await import("playwright-core/lib/utilsBundle");
    socket = new WebSocket(bridge.endpoint);
    await once(socket, "open");

    const messages = [];
    const received = new Promise((resolve) => {
      socket.on("message", (message) => {
        messages.push(JSON.parse(message.toString()));
        if (messages.length === 2) resolve();
      });
    });
    socket.send(
      JSON.stringify({
        id: 51,
        method: "Target.setAutoAttach",
        params: {
          autoAttach: true,
          waitForDebuggerOnStart: true,
          flatten: true,
        },
      }),
    );
    await Promise.race([
      received,
      new Promise((resolve) => setTimeout(resolve, 30)),
    ]);

    assert.deepEqual(
      nativeRequests.map((request) => ({
        method: request.method,
        params: request.params,
      })),
      [
        {
          method: "Target.setAutoAttach",
          params: {
            autoAttach: false,
            waitForDebuggerOnStart: false,
            flatten: true,
          },
        },
        {
          method: "Target.getTargetInfo",
          params: { targetId: "task-target" },
        },
        {
          method: "Target.attachToTarget",
          params: { targetId: "task-target", flatten: true },
        },
      ],
    );
    assert.deepEqual(messages, [
      {
        method: "Target.attachedToTarget",
        params: {
          sessionId: "manual-session",
          targetInfo: {
            targetId: "task-target",
            type: "page",
            title: "Task tab",
            url: "https://example.test/",
            attached: true,
            canAccessOpener: false,
            browserContextId: "context-1",
          },
          waitingForDebugger: false,
        },
      },
      { id: 51, result: {} },
    ]);
  } finally {
    socket?.terminate();
    await bridge?.close();
  }
});

test("the local CDP bridge admits tabs created by its Playwright connection", async () => {
  const calls = [];
  const runtime = {
    async listTabs() {
      return { tabs: [{ targetId: "primary-target", active: true }] };
    },
    async createTab(url) {
      calls.push(`createTab:${url}`);
      return { targetId: "created-target" };
    },
    sendCDPMessage(payload) {
      const request = JSON.parse(payload);
      calls.push(request.method);
      queueMicrotask(() => {
        if (request.method === "Target.getTargetInfo") {
          runtime.onCDPMessage(
            JSON.stringify({
              method: "Target.attachedToTarget",
              params: {
                sessionId: "host-session",
                targetInfo: {
                  targetId: "created-target",
                  type: "page",
                  browserContextId: "context-1",
                },
              },
            }),
          );
        }
        const result =
          request.method === "Target.getTargetInfo"
            ? {
                targetInfo: {
                  targetId: "created-target",
                  type: "page",
                  title: "",
                  url: "about:blank",
                  attached: true,
                  canAccessOpener: false,
                  browserContextId: "context-1",
                },
              }
            : request.method === "Target.attachToTarget"
              ? { sessionId: "created-session" }
              : { error: { code: -32_000, message: "not allowed" } };
        runtime.onCDPMessage(JSON.stringify({ id: request.id, result }));
      });
    },
  };
  let bridge;
  let socket;
  try {
    bridge = await playwrightTaskSpace.createLocalCdpBridge(runtime);
    const { ws: WebSocket } = await import("playwright-core/lib/utilsBundle");
    socket = new WebSocket(bridge.endpoint);
    await once(socket, "open");

    const messages = [];
    const received = new Promise((resolve) => {
      socket.on("message", (message) => {
        messages.push(JSON.parse(message.toString()));
        if (messages.length === 2) resolve();
      });
    });
    socket.send(
      JSON.stringify({
        id: 42,
        method: "Target.createTarget",
        params: { url: "about:blank" },
      }),
    );
    await Promise.race([
      received,
      new Promise((resolve) => setTimeout(resolve, 30)),
    ]);

    assert.deepEqual(messages, [
      {
        method: "Target.attachedToTarget",
        params: {
          sessionId: "created-session",
          targetInfo: {
            targetId: "created-target",
            type: "page",
            title: "",
            url: "about:blank",
            attached: true,
            canAccessOpener: false,
            browserContextId: "context-1",
          },
          waitingForDebugger: false,
        },
      },
      { id: 42, result: { targetId: "created-target" } },
    ]);
    assert.deepEqual(calls, [
      "createTab:about:blank",
      "Target.getTargetInfo",
      "Target.attachToTarget",
    ]);
  } finally {
    socket?.terminate();
    await bridge?.close();
  }
});

test("the local bridge and the raw cdp helper keep their responses isolated", async () => {
  const previous = globalThis.ego;
  const runtime = {
    sendCDPMessage(payload) {
      const request = JSON.parse(payload);
      queueMicrotask(() => {
        runtime.onCDPMessage(
          JSON.stringify({
            id: request.id,
            result: { method: request.method },
          }),
        );
      });
    },
  };
  globalThis.ego = runtime;
  let bridge;
  let socket;
  try {
    bridge = await playwrightTaskSpace.createLocalCdpBridge(runtime);
    const { ws: WebSocket } = await import("playwright-core/lib/utilsBundle");
    socket = new WebSocket(bridge.endpoint);
    await once(socket, "open");

    const leakedMessages = [];
    socket.on("message", (message) => leakedMessages.push(message.toString()));
    const rawResult = await browserCdp(
      "Browser.getVersion",
      {},
      undefined,
      1_000,
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(rawResult.result.method, "Browser.getVersion");
    assert.deepEqual(leakedMessages, []);

    const responsePromise = once(socket, "message");
    socket.send(
      JSON.stringify({ id: 23, method: "Target.getTargets", params: {} }),
    );
    const [response] = await responsePromise;
    assert.deepEqual(JSON.parse(response.toString()), {
      id: 23,
      result: { method: "Target.getTargets" },
    });
  } finally {
    socket?.terminate();
    await bridge?.close();
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
