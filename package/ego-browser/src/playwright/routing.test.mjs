import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate as waitForImmediate } from "node:timers/promises";

import { waitForCondition } from "./fake-native-harness.mjs";

const routing = await import("../../dist/src/playwright/routing.js").catch(
  () => ({}),
);
const transport = await import("../../dist/src/playwright/transport.js").catch(
  () => ({}),
);
const egoTransport = { ...routing, ...transport };
const playwrightTaskSpace =
  await import("../../dist/src/playwright/taskspace.js");

test("the Ego Playwright transport adapts the callback CDP binding without synchronous re-entry", async () => {
  assert.equal(typeof egoTransport.createEgoCdpTransport, "function");

  const sent = [];
  const runtime = {
    sendCDPMessage(payload) {
      const request = JSON.parse(payload);
      sent.push(request);
      runtime.onCDPMessage(
        JSON.stringify({ id: request.id, result: { targetInfos: [] } }),
      );
    },
  };
  const transport = egoTransport.createEgoCdpTransport(runtime, {
    allocateMessageId: () => 1_000_000_001,
  });
  const received = [];
  transport.onmessage = (message) => received.push(message);

  transport.send({
    id: 7,
    method: "Target.getTargets",
    params: {},
  });

  assert.equal(sent[0].id, 1_000_000_001);
  assert.deepEqual(received, []);
  await waitForImmediate();
  assert.deepEqual(received, [{ id: 7, result: { targetInfos: [] } }]);
  transport.close();
});

test("the Ego Playwright transport keeps Node alive until Playwright connects", () => {
  const pendingWork = [];
  const transport = egoTransport.createEgoCdpTransport(
    { sendCDPMessage() {} },
    {
      onPendingWorkChange(count) {
        pendingWork.push(count);
      },
    },
  );

  assert.deepEqual(pendingWork, [1]);
  assert.equal(typeof transport.releaseConnectionKeepAlive, "function");
  transport.releaseConnectionKeepAlive();
  assert.deepEqual(pendingWork, [1, 0]);
  transport.close();
  assert.deepEqual(pendingWork, [1, 0]);
});

test("the Ego transport releases its connection keepalive after Playwright connects", async () => {
  class FakeWebSocketTransport {
    static async connect() {
      throw new Error("the registered Ego transport must be intercepted");
    }
  }
  const pendingWork = [];
  const lease = await egoTransport.createEgoPlaywrightTransport(
    { sendCDPMessage() {} },
    {
      WebSocketTransport: FakeWebSocketTransport,
      onPendingWorkChange(count) {
        pendingWork.push(count);
      },
    },
  );

  await FakeWebSocketTransport.connect(undefined, lease.connectToken);
  assert.deepEqual(pendingWork, [1]);
  assert.equal(typeof lease.connected, "function");
  lease.connected();
  assert.deepEqual(pendingWork, [1, 0]);
  await lease.close();
});

test("the Ego Playwright transport keeps Node alive while a native CDP response is pending", async () => {
  assert.equal(typeof egoTransport.createEgoCdpTransport, "function");

  const pendingWork = [];
  const runtime = {
    sendCDPMessage() {},
  };
  const transport = egoTransport.createEgoCdpTransport(runtime, {
    allocateMessageId: () => 1_000_000_005,
    onPendingWorkChange(count) {
      pendingWork.push(count);
    },
  });
  transport.releaseConnectionKeepAlive();

  transport.send({ id: 8, method: "Target.getTargets", params: {} });
  assert.deepEqual(pendingWork, [1, 0, 1]);

  runtime.onCDPMessage(
    JSON.stringify({ id: 1_000_000_005, result: { targetInfos: [] } }),
  );
  assert.deepEqual(pendingWork, [1, 0, 1, 0]);

  transport.close();
  assert.deepEqual(pendingWork, [1, 0, 1, 0]);
});

test("the Ego Playwright transport forwards events and ignores another CDP client's responses", async () => {
  assert.equal(typeof egoTransport.createEgoCdpTransport, "function");

  const runtime = {
    sendCDPMessage() {},
  };
  const transport = egoTransport.createEgoCdpTransport(runtime, {
    allocateMessageId: () => 1_000_000_002,
  });
  const received = [];
  transport.onmessage = (message) => received.push(message);

  runtime.onCDPMessage(JSON.stringify({ id: 42, result: { foreign: true } }));
  runtime.onCDPMessage(
    JSON.stringify({
      method: "Target.targetCreated",
      params: { targetInfo: { targetId: "target-1" } },
    }),
  );

  await waitForImmediate();
  assert.deepEqual(received, [
    {
      method: "Target.targetCreated",
      params: { targetInfo: { targetId: "target-1" } },
    },
  ]);
  transport.close();
});

test("the direct Playwright transport exposes only targets from the selected TaskSpace", async () => {
  class FakeWebSocketTransport {
    static async connect() {
      throw new Error("the registered Ego transport must be intercepted");
    }
  }
  const runtime = {
    async listTabs() {
      return { tabs: [{ targetId: "selected-target" }] };
    },
    sendCDPMessage() {},
  };
  const lease = await egoTransport.createEgoPlaywrightTransport(runtime, {
    WebSocketTransport: FakeWebSocketTransport,
    allocateMessageId: () => 1_000_000_006,
  });
  const transport = await FakeWebSocketTransport.connect(
    undefined,
    lease.connectToken,
  );
  const received = [];
  transport.onmessage = (message) => received.push(message);

  transport.send({ id: 21, method: "Target.getTargets", params: {} });
  runtime.onCDPMessage(
    JSON.stringify({
      id: 1_000_000_006,
      result: {
        targetInfos: [
          { targetId: "selected-target", type: "page" },
          { targetId: "foreign-target", type: "page" },
        ],
      },
    }),
  );
  runtime.onCDPMessage(
    JSON.stringify({
      method: "Target.attachedToTarget",
      params: {
        sessionId: "foreign-session",
        targetInfo: { targetId: "foreign-target", type: "page" },
      },
    }),
  );
  runtime.onCDPMessage(
    JSON.stringify({
      method: "Page.frameNavigated",
      sessionId: "foreign-session",
      params: { frame: { id: "foreign-frame" } },
    }),
  );
  runtime.onCDPMessage(
    JSON.stringify({
      method: "Target.attachedToTarget",
      params: {
        sessionId: "selected-session",
        targetInfo: { targetId: "selected-target", type: "page" },
      },
    }),
  );
  runtime.onCDPMessage(
    JSON.stringify({
      method: "Page.frameNavigated",
      sessionId: "selected-session",
      params: { frame: { id: "selected-frame" } },
    }),
  );

  await waitForImmediate();
  assert.deepEqual(received, [
    {
      id: 21,
      result: {
        targetInfos: [{ targetId: "selected-target", type: "page" }],
      },
    },
    {
      method: "Target.attachedToTarget",
      params: {
        sessionId: "selected-session",
        targetInfo: { targetId: "selected-target", type: "page" },
      },
    },
    {
      method: "Page.frameNavigated",
      sessionId: "selected-session",
      params: { frame: { id: "selected-frame" } },
    },
  ]);
  await lease.close();
});

test("the direct Playwright transport forwards only OOPIF descendants of the selected TaskSpace page session", async () => {
  const runtime = {
    sendCDPMessage() {},
  };
  const transport = egoTransport.createEgoCdpTransport(runtime, {
    targetIds: ["selected-target"],
  });
  const received = [];
  transport.onmessage = (message) => received.push(message);

  runtime.onCDPMessage(
    JSON.stringify({
      method: "Target.attachedToTarget",
      params: {
        sessionId: "selected-session",
        targetInfo: { targetId: "selected-target", type: "page" },
      },
    }),
  );
  runtime.onCDPMessage(
    JSON.stringify({
      method: "Target.attachedToTarget",
      sessionId: "foreign-session",
      params: {
        sessionId: "foreign-oopif-session",
        targetInfo: { targetId: "foreign-oopif", type: "iframe" },
        waitingForDebugger: false,
      },
    }),
  );
  runtime.onCDPMessage(
    JSON.stringify({
      method: "Target.attachedToTarget",
      sessionId: "selected-session",
      params: {
        sessionId: "oopif-session",
        targetInfo: { targetId: "oopif-frame", type: "iframe" },
        waitingForDebugger: false,
      },
    }),
  );
  runtime.onCDPMessage(
    JSON.stringify({
      method: "Page.frameNavigated",
      sessionId: "oopif-session",
      params: {
        frame: {
          id: "oopif-frame",
          parentId: "selected-frame",
          url: "https://frame.example.test/",
        },
      },
    }),
  );
  runtime.onCDPMessage(
    JSON.stringify({
      method: "Target.attachedToTarget",
      sessionId: "oopif-session",
      params: {
        sessionId: "nested-oopif-session",
        targetInfo: { targetId: "nested-oopif-frame", type: "iframe" },
        waitingForDebugger: false,
      },
    }),
  );
  runtime.onCDPMessage(
    JSON.stringify({
      method: "Page.frameNavigated",
      sessionId: "nested-oopif-session",
      params: {
        frame: {
          id: "nested-oopif-frame",
          parentId: "oopif-frame",
          url: "https://nested.example.test/",
        },
      },
    }),
  );

  await waitForImmediate();
  assert.deepEqual(received, [
    {
      method: "Target.attachedToTarget",
      params: {
        sessionId: "selected-session",
        targetInfo: { targetId: "selected-target", type: "page" },
      },
    },
    {
      method: "Target.attachedToTarget",
      sessionId: "selected-session",
      params: {
        sessionId: "oopif-session",
        targetInfo: { targetId: "oopif-frame", type: "iframe" },
        waitingForDebugger: false,
      },
    },
    {
      method: "Page.frameNavigated",
      sessionId: "oopif-session",
      params: {
        frame: {
          id: "oopif-frame",
          parentId: "selected-frame",
          url: "https://frame.example.test/",
        },
      },
    },
    {
      method: "Target.attachedToTarget",
      sessionId: "oopif-session",
      params: {
        sessionId: "nested-oopif-session",
        targetInfo: { targetId: "nested-oopif-frame", type: "iframe" },
        waitingForDebugger: false,
      },
    },
    {
      method: "Page.frameNavigated",
      sessionId: "nested-oopif-session",
      params: {
        frame: {
          id: "nested-oopif-frame",
          parentId: "oopif-frame",
          url: "https://nested.example.test/",
        },
      },
    },
  ]);
  transport.close();
});

test("the direct Playwright transport completes root auto-attach with missing TaskSpace targets", async () => {
  let nextNativeId = 1_000_000_100;
  const sent = [];
  const runtime = {
    sendCDPMessage(payload) {
      const request = JSON.parse(payload);
      sent.push(request);
      const result =
        request.method === "Target.getTargetInfo"
          ? {
              targetInfo: {
                targetId: "selected-target",
                type: "page",
                title: "Selected",
                url: "about:blank",
              },
            }
          : request.method === "Target.attachToTarget"
            ? { sessionId: "selected-session" }
            : {};
      queueMicrotask(() => {
        runtime.onCDPMessage(JSON.stringify({ id: request.id, result }));
      });
    },
  };
  const transport = egoTransport.createEgoCdpTransport(runtime, {
    allocateMessageId: () => nextNativeId++,
    targetIds: ["selected-target"],
  });
  const received = [];
  transport.onmessage = (message) => received.push(message);

  transport.send({
    id: 22,
    method: "Target.setAutoAttach",
    params: {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
    },
  });
  for (let index = 0; index < 6; index += 1) await waitForImmediate();

  assert.deepEqual(
    sent.map(({ method, params }) => ({ method, params })),
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
        params: { targetId: "selected-target" },
      },
      {
        method: "Target.attachToTarget",
        params: { targetId: "selected-target", flatten: true },
      },
    ],
  );
  assert.deepEqual(received, [
    {
      method: "Target.attachedToTarget",
      params: {
        sessionId: "selected-session",
        targetInfo: {
          targetId: "selected-target",
          type: "page",
          title: "Selected",
          url: "about:blank",
          attached: true,
          canAccessOpener: false,
        },
        waitingForDebugger: false,
      },
    },
    { id: 22, result: {} },
  ]);
  transport.close();
});

test("the direct Playwright transport disables global auto-attach and manually attaches selected targets", async () => {
  class FakeWebSocketTransport {
    static async connect() {
      throw new Error("the registered Ego transport must be intercepted");
    }
  }
  let nextNativeId = 1_000_000_150;
  const sent = [];
  const runtime = {
    async listTabs() {
      return { tabs: [{ targetId: "active-target", active: true }] };
    },
    sendCDPMessage(payload) {
      const request = JSON.parse(payload);
      sent.push(request);
      queueMicrotask(() => {
        let result = {};
        if (request.method === "Target.getTargetInfo") {
          result = {
            targetInfo: {
              targetId: "active-target",
              type: "page",
              title: "Selected",
              url: "about:blank",
            },
          };
        } else if (request.method === "Target.attachToTarget") {
          result = { sessionId: "active-session" };
        }
        runtime.onCDPMessage(JSON.stringify({ id: request.id, result }));
      });
    },
  };
  const lease = await egoTransport.createEgoPlaywrightTransport(runtime, {
    WebSocketTransport: FakeWebSocketTransport,
    allocateMessageId: () => nextNativeId++,
  });
  const transport = await FakeWebSocketTransport.connect(
    undefined,
    lease.connectToken,
  );
  const received = [];
  transport.onmessage = (message) => received.push(message);

  transport.send({
    id: 23,
    method: "Target.setAutoAttach",
    params: {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  await waitForImmediate();

  assert.deepEqual(
    sent.map(({ method }) => method),
    ["Target.setAutoAttach", "Target.getTargetInfo", "Target.attachToTarget"],
  );
  assert.deepEqual(sent[0].params, {
    autoAttach: false,
    waitForDebuggerOnStart: false,
    flatten: true,
  });
  assert.deepEqual(received, [
    {
      method: "Target.attachedToTarget",
      params: {
        sessionId: "active-session",
        targetInfo: {
          targetId: "active-target",
          type: "page",
          title: "Selected",
          url: "about:blank",
          attached: true,
          canAccessOpener: false,
        },
        waitingForDebugger: false,
      },
    },
    { id: 23, result: {} },
  ]);
  await lease.close();
});

test("the Ego Playwright transport supplies Browser metadata and accepts unsupported download behavior", async () => {
  assert.equal(typeof egoTransport.createEgoCdpTransport, "function");

  const sent = [];
  const runtime = {
    sendCDPMessage(payload) {
      sent.push(JSON.parse(payload));
    },
  };
  const transport = egoTransport.createEgoCdpTransport(runtime, {
    allocateMessageId: () => 1_000_000_012,
  });
  const received = [];
  transport.onmessage = (message) => received.push(message);

  transport.send({ id: 11, method: "Browser.getVersion", params: {} });
  transport.send({
    id: 12,
    method: "Browser.setDownloadBehavior",
    params: { behavior: "allow", downloadPath: "/tmp/downloads" },
  });

  assert.deepEqual(sent, []);
  await waitForImmediate();
  assert.equal(received[0].id, 11);
  assert.equal(received[0].result.protocolVersion, "1.3");
  assert.match(received[0].result.product, /^Chrome\//);
  assert.deepEqual(received[1], { id: 12, result: {} });
  transport.close();
});

test("the Ego Playwright transport preserves browser CDPSession ids on compatibility responses", async () => {
  const transport = egoTransport.createEgoCdpTransport({
    sendCDPMessage() {
      throw new Error("compatibility commands must not reach native CDP");
    },
  });
  const received = [];
  transport.onmessage = (message) => received.push(message);

  transport.send({
    id: 13,
    method: "Browser.getVersion",
    params: {},
    sessionId: "browser-session",
  });

  await waitForImmediate();
  assert.equal(received.length, 1);
  assert.equal(received[0].id, 13);
  assert.equal(received[0].sessionId, "browser-session");
  assert.equal(received[0].result.protocolVersion, "1.3");
  transport.close();
});

test("the Ego Playwright transport creates a TaskSpace tab for Target.createTarget", async () => {
  assert.equal(typeof egoTransport.createEgoCdpTransport, "function");

  const createdUrls = [];
  const runtime = {
    async createTab(url) {
      createdUrls.push(url);
      return { targetId: "created-target" };
    },
    sendCDPMessage() {
      throw new Error("Target.createTarget must not reach native CDP");
    },
  };
  const transport = egoTransport.createEgoCdpTransport(runtime);
  const received = [];
  const response = new Promise((resolve) => {
    transport.onmessage = (message) => {
      received.push(message);
      resolve(message);
    };
  });

  transport.send({
    id: 13,
    method: "Target.createTarget",
    params: { url: "https://example.test/new" },
  });

  await response;
  assert.deepEqual(createdUrls, ["https://example.test/new"]);
  assert.deepEqual(received, [
    { id: 13, result: { targetId: "created-target" } },
  ]);
  transport.close();
});

test("the Ego Playwright transport preserves new-target events that arrive before createTab resolves", async () => {
  let finishCreate;
  const runtime = {
    createTab() {
      return new Promise((resolve) => {
        finishCreate = resolve;
      });
    },
    sendCDPMessage() {},
  };
  const transport = egoTransport.createEgoCdpTransport(runtime, {
    targetIds: ["existing-target"],
  });
  const received = [];
  transport.onmessage = (message) => received.push(message);

  transport.send({
    id: 17,
    method: "Target.createTarget",
    params: { url: "about:blank" },
  });
  await Promise.resolve();
  runtime.onCDPMessage(
    JSON.stringify({
      method: "Target.attachedToTarget",
      params: {
        sessionId: "created-session",
        targetInfo: { targetId: "created-target", type: "page" },
      },
    }),
  );
  runtime.onCDPMessage(
    JSON.stringify({
      method: "Page.frameNavigated",
      sessionId: "created-session",
      params: { frame: { id: "created-frame" } },
    }),
  );
  finishCreate({ targetId: "created-target" });
  await waitForImmediate();
  await waitForImmediate();

  assert.deepEqual(received, [
    {
      method: "Target.attachedToTarget",
      params: {
        sessionId: "created-session",
        targetInfo: { targetId: "created-target", type: "page" },
      },
    },
    {
      method: "Page.frameNavigated",
      sessionId: "created-session",
      params: { frame: { id: "created-frame" } },
    },
    { id: 17, result: { targetId: "created-target" } },
  ]);
  transport.close();
});

test("the Ego Playwright transport manually attaches a created tab when root auto-attach is disabled", async () => {
  let nextNativeId = 1_000_000_200;
  const sent = [];
  const runtime = {
    async createTab() {
      return { targetId: "created-target" };
    },
    sendCDPMessage(payload) {
      const request = JSON.parse(payload);
      sent.push(request);
      const result =
        request.method === "Target.getTargetInfo"
          ? {
              targetInfo: {
                targetId: "created-target",
                type: "page",
                title: "",
                url: "about:blank",
              },
            }
          : { sessionId: "created-session" };
      queueMicrotask(() => {
        runtime.onCDPMessage(JSON.stringify({ id: request.id, result }));
      });
    },
  };
  const transport = egoTransport.createEgoCdpTransport(runtime, {
    targetIds: ["existing-target"],
    allocateMessageId: () => nextNativeId++,
  });
  const received = [];
  transport.onmessage = (message) => received.push(message);

  transport.send({
    id: 18,
    method: "Target.createTarget",
    params: { url: "about:blank" },
  });
  for (let index = 0; index < 6; index += 1) await waitForImmediate();

  assert.deepEqual(
    sent.map(({ method }) => method),
    ["Target.getTargetInfo", "Target.attachToTarget"],
  );
  assert.deepEqual(received, [
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
        },
        waitingForDebugger: false,
      },
    },
    { id: 18, result: { targetId: "created-target" } },
  ]);
  transport.close();
});

test("the Ego Playwright transport discovers and attaches a page opened by the selected tab", async () => {
  let nextNativeId = 1_000_000_220;
  let tabs = [{ targetId: "selected-target" }];
  const sent = [];
  const runtime = {
    async listTabs() {
      return { tabs };
    },
    sendCDPMessage(payload) {
      const request = JSON.parse(payload);
      sent.push(request);
      const targetId = request.params?.targetId;
      const result =
        request.method === "Target.getTargetInfo"
          ? {
              targetInfo: {
                targetId,
                type: "page",
                title: targetId === "popup-target" ? "Popup" : "Selected",
                url: "about:blank",
              },
            }
          : request.method === "Target.attachToTarget"
            ? { sessionId: `${targetId}-session` }
            : {};
      queueMicrotask(() => {
        runtime.onCDPMessage(JSON.stringify({ id: request.id, result }));
      });
    },
  };
  const transport = egoTransport.createEgoCdpTransport(runtime, {
    targetIds: ["selected-target"],
    allocateMessageId: () => nextNativeId++,
  });
  const received = [];
  transport.onmessage = (message) => received.push(message);

  runtime.onCDPMessage(
    JSON.stringify({
      method: "Target.attachedToTarget",
      params: {
        sessionId: "selected-target-session",
        targetInfo: { targetId: "selected-target", type: "page" },
      },
    }),
  );
  await waitForImmediate();
  tabs = [
    { targetId: "selected-target" },
    { targetId: "popup-target", url: "https://example.test/popup" },
  ];
  runtime.onCDPMessage(
    JSON.stringify({
      method: "Page.windowOpen",
      sessionId: "selected-target-session",
      params: { url: "https://example.test/popup", windowName: "" },
    }),
  );
  for (let index = 0; index < 8; index += 1) await waitForImmediate();

  assert.deepEqual(
    sent.map(({ method }) => method),
    ["Target.getTargetInfo", "Target.attachToTarget"],
  );
  assert.equal(
    received.some(
      (message) =>
        message.method === "Target.attachedToTarget" &&
        message.params.targetInfo.targetId === "popup-target" &&
        message.params.targetInfo.openerId === "selected-target",
    ),
    true,
  );
  transport.close();
});

test("the Ego Playwright transport keeps the Playwright Page identity while replacing a navigated native target", async () => {
  let nextNativeId = 1_000_000_250;
  let replacementFrameTreeCalls = 0;
  const pendingWork = [];
  const sent = [];
  const createdUrls = [];
  const runtime = {
    async createTab(url) {
      createdUrls.push(url);
      return { targetId: "replacement-target" };
    },
    sendCDPMessage(payload) {
      const request = JSON.parse(payload);
      sent.push(request);

      let result = {};
      if (request.method === "Page.navigate") {
        result = {
          frameId: "replacement-frame",
          loaderId: "replacement-loader",
        };
      } else if (request.method === "Target.getTargetInfo") {
        const targetId = request.params.targetId;
        result = {
          targetInfo: {
            targetId,
            type: "page",
            title: targetId === "replacement-target" ? "After" : "Before",
            // A non-blank starting page: navigations from a blank page take
            // the in-place path and never reach the replacement flow.
            url:
              targetId === "replacement-target"
                ? "https://example.test/after"
                : "https://example.test/before",
          },
        };
      } else if (request.method === "Target.attachToTarget") {
        result = {
          sessionId:
            request.params.targetId === "replacement-target"
              ? "replacement-session"
              : "client-session",
        };
      } else if (request.method === "Page.getFrameTree") {
        // The frame tree lags the native commit: it first reports the initial
        // blank document, then a transient pre-reflection state whose loader
        // does not yet match the navigate response; neither may be mistaken
        // for the committed navigation.
        const replacementFrameTreeCall =
          request.sessionId === "replacement-session"
            ? replacementFrameTreeCalls++
            : -1;
        const beforeReplacementCommit = replacementFrameTreeCall === 0;
        const transientReplacementCommit = replacementFrameTreeCall === 1;
        result = {
          frameTree: {
            frame: {
              id: beforeReplacementCommit
                ? "initial-frame"
                : "replacement-frame",
              loaderId: beforeReplacementCommit
                ? "initial-loader"
                : transientReplacementCommit
                  ? "transient-loader"
                  : "replacement-loader",
              name: "",
              url:
                beforeReplacementCommit || transientReplacementCommit
                  ? "about:blank"
                  : "https://example.test/after",
            },
          },
        };
      } else if (request.method === "Runtime.evaluate") {
        result = {
          result: {
            type: "object",
            value:
              request.params.expression === "document.readyState"
                ? "complete"
                : "replacement-result",
          },
        };
      }
      if (
        request.sessionId === "replacement-session" &&
        (request.method === "Page.enable" ||
          request.method === "Runtime.enable")
      ) {
        return;
      }
      queueMicrotask(() => {
        runtime.onCDPMessage(
          JSON.stringify({
            id: request.id,
            result,
            ...(request.sessionId ? { sessionId: request.sessionId } : {}),
          }),
        );
      });
    },
  };
  const transport = egoTransport.createEgoCdpTransport(runtime, {
    targetIds: ["client-target"],
    allocateMessageId: () => nextNativeId++,
    onPendingWorkChange(count) {
      pendingWork.push(count);
    },
  });
  transport.releaseConnectionKeepAlive();
  const received = [];
  transport.onmessage = (message) => received.push(message);

  transport.send({
    id: 30,
    method: "Target.setAutoAttach",
    params: {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
    },
  });
  for (let index = 0; index < 6; index += 1) await waitForImmediate();
  transport.send({
    id: 31,
    method: "Page.enable",
    params: {},
    sessionId: "client-session",
  });
  transport.send({
    id: 32,
    method: "Runtime.enable",
    params: {},
    sessionId: "client-session",
  });
  await waitForImmediate();
  received.length = 0;

  transport.send({
    id: 33,
    method: "Page.navigate",
    params: {
      frameId: "client-target",
      url: "https://example.test/after",
    },
    sessionId: "client-session",
  });
  const navigationDeadline = Date.now() + 500;
  while (
    !received.some((message) => message.id === 33) &&
    Date.now() < navigationDeadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  assert.deepEqual(createdUrls, ["about:blank"]);
  const nativeNavigate = sent.find(
    (request) => request.method === "Page.navigate",
  );
  assert.equal(nativeNavigate?.sessionId, "replacement-session");
  assert.equal(nativeNavigate?.params.url, "https://example.test/after");
  const replacementFetchEnableIndex = sent.findIndex(
    (request) =>
      request.method === "Runtime.enable" &&
      request.sessionId === "replacement-session",
  );
  assert.ok(
    replacementFetchEnableIndex !== -1 &&
      replacementFetchEnableIndex < sent.indexOf(nativeNavigate),
    "enable commands are replayed before the native navigation starts",
  );
  assert.ok(
    sent.some(
      (request) =>
        request.method === "Target.closeTarget" &&
        request.params.targetId === "client-target",
    ),
  );
  assert.deepEqual(
    received.find((message) => message.id === 33),
    {
      id: 33,
      result: {
        frameId: "client-target",
        loaderId: "replacement-loader",
      },
      sessionId: "client-session",
    },
  );
  assert.ok(
    received.some(
      (message) =>
        message.method === "Page.frameNavigated" &&
        message.sessionId === "client-session" &&
        message.params.frame.id === "client-target",
    ),
  );
  assert.ok(
    received.some(
      (message) =>
        message.method === "Page.lifecycleEvent" &&
        message.params.name === "load" &&
        message.params.frameId === "client-target",
    ),
  );
  const replacementRuntimeEnableIndex = sent.findIndex(
    (request) =>
      request.method === "Runtime.enable" &&
      request.sessionId === "replacement-session",
  );
  const replacementReadyStateIndex = sent.findIndex(
    (request) =>
      request.method === "Runtime.evaluate" &&
      request.params.expression === "document.readyState" &&
      request.sessionId === "replacement-session",
  );
  assert.ok(replacementRuntimeEnableIndex !== -1);
  assert.ok(replacementRuntimeEnableIndex < replacementReadyStateIndex);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(pendingWork.at(-1), 0);

  received.length = 0;
  transport.send({
    id: 34,
    method: "Runtime.evaluate",
    params: { expression: "location.href", returnByValue: true },
    sessionId: "client-session",
  });
  await waitForImmediate();
  await waitForImmediate();
  assert.equal(sent.at(-1).sessionId, "replacement-session");
  assert.equal(received.at(-1).sessionId, "client-session");
  transport.close();
});

async function createNavigatedCdpSessionTransport({
  detachError = false,
} = {}) {
  let nextNativeId = 1_000_000_450;
  let replacementAttachCount = 0;
  const sent = [];
  const runtime = {
    async createTab() {
      return { targetId: "replacement-target" };
    },
    sendCDPMessage(payload) {
      const request = JSON.parse(payload);
      sent.push(request);
      let result = {};
      if (request.method === "Target.getTargetInfo") {
        result = {
          targetInfo: {
            targetId: request.params.targetId,
            type: "page",
            title: "Selected",
            // A non-blank starting page: navigations from a blank page take
            // the in-place path and never reach the replacement flow.
            url:
              request.params.targetId === "replacement-target"
                ? "https://example.test/after"
                : "https://example.test/before",
          },
        };
      } else if (request.method === "Target.attachToTarget") {
        if (request.params.targetId === "replacement-target") {
          replacementAttachCount += 1;
          result = {
            sessionId:
              replacementAttachCount === 1
                ? "replacement-session"
                : "playwright-cdp-session",
          };
        } else {
          result = { sessionId: "client-session" };
        }
      } else if (request.method === "Page.getFrameTree") {
        result = {
          frameTree: {
            frame: {
              id:
                request.sessionId === "replacement-session"
                  ? "replacement-frame"
                  : "client-target",
              loaderId:
                request.sessionId === "replacement-session"
                  ? "replacement-loader"
                  : "client-loader",
              name: "",
              url:
                request.sessionId === "replacement-session"
                  ? "https://example.test/after"
                  : "about:blank",
            },
          },
        };
      } else if (request.method === "Runtime.evaluate") {
        result = {
          result: {
            type: "string",
            value:
              request.params.expression === "document.readyState"
                ? "complete"
                : "cdp-command-result",
          },
        };
      } else if (request.method === "Network.getAllCookies") {
        result = {
          cookies: [
            {
              name: "session",
              value: "selected-task-space",
              domain: "example.test",
              path: "/",
              expires: -1,
              size: 30,
              httpOnly: true,
              secure: true,
              session: true,
              sameSite: "Lax",
              priority: "Medium",
              sameParty: false,
              sourceScheme: "Secure",
              sourcePort: 443,
            },
          ],
        };
      }
      if (request.method === "Target.detachFromTarget") {
        queueMicrotask(() => {
          runtime.onCDPMessage(
            JSON.stringify({
              method: "Target.detachedFromTarget",
              params: {
                sessionId: request.params.sessionId,
                targetId: "replacement-target",
              },
            }),
          );
        });
      }
      queueMicrotask(() => {
        runtime.onCDPMessage(
          JSON.stringify({
            id: request.id,
            ...(detachError && request.method === "Target.detachFromTarget"
              ? {
                  error: {
                    code: -32_000,
                    message: "Target page, context or browser has been closed",
                  },
                }
              : { result }),
            ...(request.sessionId ? { sessionId: request.sessionId } : {}),
          }),
        );
      });
    },
  };
  const transport = egoTransport.createEgoCdpTransport(runtime, {
    targetIds: ["client-target"],
    allocateMessageId: () => nextNativeId++,
  });
  const received = [];
  transport.onmessage = (message) => received.push(message);

  transport.send({
    id: 50,
    method: "Target.setAutoAttach",
    params: {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
    },
  });
  for (let index = 0; index < 6; index += 1) await waitForImmediate();
  transport.send({
    id: 51,
    method: "Page.navigate",
    params: {
      frameId: "client-target",
      url: "https://example.test/after",
    },
    sessionId: "client-session",
  });
  const navigationDeadline = Date.now() + 500;
  while (
    !received.some((message) => message.id === 51) &&
    Date.now() < navigationDeadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(received.some((message) => message.id === 51));
  sent.length = 0;
  received.length = 0;
  return { received, runtime, sent, transport };
}

async function attachPlaywrightCdpSession(harness) {
  harness.transport.send({
    id: 52,
    method: "Target.attachToTarget",
    params: { targetId: "client-target", flatten: true },
  });
  for (let index = 0; index < 3; index += 1) await waitForImmediate();
  return harness.received.find((message) => message.id === 52);
}

test("the Ego Playwright transport maps CDPSession commands and events to the navigated target", async () => {
  const harness = await createNavigatedCdpSessionTransport();
  const attachResponse = await attachPlaywrightCdpSession(harness);

  assert.equal(
    harness.sent.find(
      (request) =>
        request.method === "Target.attachToTarget" &&
        request.id >= 1_000_000_450,
    )?.params.targetId,
    "replacement-target",
  );
  assert.equal(attachResponse?.result?.sessionId, "playwright-cdp-session");

  harness.transport.send({
    id: 53,
    method: "Runtime.evaluate",
    params: { expression: "document.title", returnByValue: true },
    sessionId: "playwright-cdp-session",
  });
  for (let index = 0; index < 2; index += 1) await waitForImmediate();
  assert.equal(harness.sent.at(-1).sessionId, "playwright-cdp-session");
  assert.deepEqual(
    harness.received.find((message) => message.id === 53),
    {
      id: 53,
      result: {
        result: { type: "string", value: "cdp-command-result" },
      },
      sessionId: "playwright-cdp-session",
    },
  );

  harness.runtime.onCDPMessage(
    JSON.stringify({
      method: "Runtime.bindingCalled",
      params: { name: "probe", payload: "event-payload" },
      sessionId: "playwright-cdp-session",
    }),
  );
  harness.runtime.onCDPMessage(
    JSON.stringify({
      method: "Runtime.bindingCalled",
      params: { name: "foreign", payload: "hidden" },
      sessionId: "foreign-session",
    }),
  );
  await waitForImmediate();
  assert.deepEqual(
    harness.received.find(
      (message) =>
        message.method === "Runtime.bindingCalled" &&
        message.params.name === "probe",
    ),
    {
      method: "Runtime.bindingCalled",
      params: { name: "probe", payload: "event-payload" },
      sessionId: "playwright-cdp-session",
    },
  );
  assert.equal(
    harness.received.some((message) => message.params?.payload === "hidden"),
    false,
  );
  harness.transport.close();
});

test("detaching a Playwright CDPSession preserves the primary page route", async () => {
  const harness = await createNavigatedCdpSessionTransport({
    detachError: true,
  });
  await attachPlaywrightCdpSession(harness);
  harness.received.length = 0;
  harness.sent.length = 0;

  harness.transport.send({
    id: 54,
    method: "Target.detachFromTarget",
    params: { sessionId: "playwright-cdp-session" },
  });
  for (let index = 0; index < 3; index += 1) await waitForImmediate();
  assert.equal(
    harness.received.some(
      (message) => message.method === "Target.detachedFromTarget",
    ),
    false,
    "an explicit detach completes from its command response without racing a detach event",
  );
  assert.deepEqual(
    harness.received.find((message) => message.id === 54),
    {
      id: 54,
      result: {},
    },
  );

  harness.transport.send({
    id: 55,
    method: "Runtime.evaluate",
    params: { expression: "location.href", returnByValue: true },
    sessionId: "client-session",
  });
  for (let index = 0; index < 2; index += 1) await waitForImmediate();
  assert.equal(harness.sent.at(-1).sessionId, "replacement-session");
  assert.equal(
    harness.received.find((message) => message.id === 55)?.sessionId,
    "client-session",
  );
  harness.transport.close();
});

test("browser-level Storage cookie commands use the selected TaskSpace session", async () => {
  const harness = await createNavigatedCdpSessionTransport();
  harness.sent.length = 0;
  harness.received.length = 0;

  harness.transport.send({ id: 56, method: "Storage.getCookies", params: {} });
  for (let index = 0; index < 3; index += 1) await waitForImmediate();

  assert.equal(harness.sent[0].method, "Network.getAllCookies");
  assert.equal(harness.sent[0].sessionId, "replacement-session");
  assert.equal(
    harness.received.find((message) => message.id === 56)?.result.cookies[0]
      .value,
    "selected-task-space",
  );
  harness.transport.send({
    id: 57,
    method: "Storage.setCookies",
    params: {
      cookies: [
        {
          name: "session",
          value: "updated",
          domain: "example.test",
          path: "/",
        },
      ],
    },
  });
  harness.transport.send({
    id: 58,
    method: "Storage.clearCookies",
    params: {},
  });
  for (let index = 0; index < 3; index += 1) await waitForImmediate();
  assert.equal(harness.sent[1].method, "Network.setCookies");
  assert.equal(harness.sent[1].sessionId, "replacement-session");
  assert.equal(harness.sent[1].params.cookies[0].value, "updated");
  assert.equal(harness.sent[2].method, "Network.clearBrowserCookies");
  assert.equal(harness.sent[2].sessionId, "replacement-session");
  harness.transport.close();
});

test("closing the Playwright transport detaches its additional CDPSessions", async () => {
  const harness = await createNavigatedCdpSessionTransport();
  await attachPlaywrightCdpSession(harness);
  harness.sent.length = 0;

  await harness.transport.closeAndWait();

  assert.deepEqual(
    harness.sent
      .filter((request) => request.method === "Target.detachFromTarget")
      .map((request) => request.params.sessionId)
      .sort(),
    ["playwright-cdp-session", "replacement-session"],
  );
  assert.equal(harness.transport.closed, true);
});

test("the Ego Playwright transport reports the committed redirect URL for Page.navigate", async () => {
  let nextNativeId = 1_000_000_325;
  const runtime = {
    async createTab() {
      return { targetId: "replacement-target" };
    },
    sendCDPMessage(payload) {
      const request = JSON.parse(payload);
      let result = {};
      if (request.method === "Target.getTargetInfo") {
        result = {
          targetInfo: {
            targetId: request.params.targetId,
            type: "page",
            // A non-blank starting page: navigations from a blank page take
            // the in-place path and never reach the replacement flow.
            url:
              request.params.targetId === "replacement-target"
                ? "https://example.test/redirect-target"
                : "https://example.test/before",
          },
        };
      } else if (request.method === "Target.attachToTarget") {
        result = {
          sessionId:
            request.params.targetId === "replacement-target"
              ? "replacement-session"
              : "client-session",
        };
      } else if (request.method === "Page.getFrameTree") {
        result = {
          frameTree: {
            frame: {
              id:
                request.sessionId === "replacement-session"
                  ? "replacement-frame"
                  : "client-target",
              loaderId:
                request.sessionId === "replacement-session"
                  ? "replacement-loader"
                  : "client-loader",
              url:
                request.sessionId === "replacement-session"
                  ? "https://example.test/redirect-target"
                  : "about:blank",
            },
          },
        };
      } else if (request.method === "Runtime.evaluate") {
        result = {
          result: {
            type:
              request.params.expression === "document.readyState"
                ? "string"
                : "object",
            value:
              request.params.expression === "document.readyState"
                ? "complete"
                : {
                    url: "https://example.test/redirect-target",
                    readyState: "complete",
                    contentType: "text/html",
                    responseStatus: 200,
                  },
          },
        };
      }
      queueMicrotask(() => {
        runtime.onCDPMessage(
          JSON.stringify({
            id: request.id,
            result,
            ...(request.sessionId ? { sessionId: request.sessionId } : {}),
          }),
        );
      });
    },
  };
  const transport = egoTransport.createEgoCdpTransport(runtime, {
    targetIds: ["client-target"],
    allocateMessageId: () => nextNativeId++,
  });
  const received = [];
  transport.onmessage = (message) => received.push(message);

  transport.send({
    id: 35,
    method: "Target.setAutoAttach",
    params: { autoAttach: true, flatten: true },
  });
  for (let index = 0; index < 6; index += 1) await waitForImmediate();
  received.length = 0;

  transport.send({
    id: 36,
    method: "Page.navigate",
    params: {
      frameId: "client-target",
      url: "https://example.test/redirect",
    },
    sessionId: "client-session",
  });
  const deadline = Date.now() + 150;
  while (
    !received.some(
      (message) =>
        message.method === "Page.lifecycleEvent" &&
        message.params?.name === "load",
    ) &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  transport.close();

  assert.deepEqual(
    received.find((message) => message.id === 36),
    {
      id: 36,
      result: {
        frameId: "client-target",
        loaderId: "replacement-loader",
      },
      sessionId: "client-session",
    },
  );
  const requestIndex = received.findIndex(
    (message) => message.method === "Network.requestWillBeSent",
  );
  const responseIndex = received.findIndex(
    (message) => message.method === "Network.responseReceived",
  );
  const frameIndex = received.findIndex(
    (message) => message.method === "Page.frameNavigated",
  );
  const finishedIndex = received.findIndex(
    (message) => message.method === "Network.loadingFinished",
  );
  assert.ok(requestIndex !== -1 && requestIndex < frameIndex);
  assert.ok(responseIndex !== -1 && responseIndex < frameIndex);
  assert.ok(finishedIndex > frameIndex);
  assert.equal(
    received[requestIndex].params.request.url,
    "https://example.test/redirect-target",
  );
  assert.equal(
    received[responseIndex].params.response.url,
    "https://example.test/redirect-target",
  );
  assert.equal(received[responseIndex].params.response.status, 200);
});

test("the Ego Playwright transport completes passive same-target navigations for Playwright", async () => {
  let nextNativeId = 1_000_000_350;
  const sent = [];
  const runtime = {
    sendCDPMessage(payload) {
      const request = JSON.parse(payload);
      sent.push(request);
      let result = {};
      if (request.method === "Target.getTargetInfo") {
        result = {
          targetInfo: {
            targetId: "selected-target",
            type: "page",
            title: "Before",
            url: "https://example.test/before",
          },
        };
      } else if (request.method === "Target.attachToTarget") {
        result = { sessionId: "selected-session" };
      } else if (request.method === "Runtime.evaluate") {
        result = { result: { type: "string", value: "complete" } };
      }
      queueMicrotask(() => {
        runtime.onCDPMessage(
          JSON.stringify({
            id: request.id,
            result,
            ...(request.sessionId ? { sessionId: request.sessionId } : {}),
          }),
        );
      });
    },
  };
  const transport = egoTransport.createEgoCdpTransport(runtime, {
    targetIds: ["selected-target"],
    allocateMessageId: () => nextNativeId++,
  });
  const received = [];
  transport.onmessage = (message) => received.push(message);

  transport.send({
    id: 40,
    method: "Target.setAutoAttach",
    params: {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
    },
  });
  for (let index = 0; index < 6; index += 1) await waitForImmediate();
  received.length = 0;
  sent.length = 0;

  runtime.onCDPMessage(
    JSON.stringify({
      method: "Page.frameNavigated",
      sessionId: "selected-session",
      params: {
        frame: {
          id: "selected-frame",
          loaderId: "passive-loader",
          name: "",
          url: "https://example.test/after",
        },
      },
    }),
  );
  const lifecycleDeadline = Date.now() + 500;
  while (
    !received.some(
      (message) =>
        message.method === "Page.lifecycleEvent" &&
        message.params?.name === "load",
    ) &&
    Date.now() < lifecycleDeadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  assert.ok(
    sent.some(
      (request) =>
        request.method === "Runtime.evaluate" &&
        request.sessionId === "selected-session" &&
        request.params.expression === "document.readyState",
    ),
  );
  assert.deepEqual(
    received
      .filter((message) => message.method === "Page.lifecycleEvent")
      .map((message) => message.params.name),
    ["DOMContentLoaded", "load"],
  );
  assert.ok(
    received.some((message) => message.method === "Page.frameStoppedLoading"),
  );
  transport.close();
});

test("the Ego Playwright transport reports DOMContentLoaded before a passive navigation completes", async () => {
  let nextNativeId = 1_000_000_360;
  const runtime = {
    sendCDPMessage(payload) {
      const request = JSON.parse(payload);
      let result = {};
      if (request.method === "Target.getTargetInfo") {
        result = {
          targetInfo: {
            targetId: "selected-target",
            type: "page",
            url: "https://example.test/before",
          },
        };
      } else if (request.method === "Target.attachToTarget") {
        result = { sessionId: "selected-session" };
      } else if (request.method === "Runtime.evaluate") {
        result = { result: { type: "string", value: "interactive" } };
      }
      queueMicrotask(() => {
        runtime.onCDPMessage(
          JSON.stringify({
            id: request.id,
            result,
            ...(request.sessionId ? { sessionId: request.sessionId } : {}),
          }),
        );
      });
    },
  };
  const transport = egoTransport.createEgoCdpTransport(runtime, {
    targetIds: ["selected-target"],
    allocateMessageId: () => nextNativeId++,
  });
  const received = [];
  transport.onmessage = (message) => received.push(message);

  transport.send({
    id: 42,
    method: "Target.setAutoAttach",
    params: { autoAttach: true, flatten: true },
  });
  for (let index = 0; index < 6; index += 1) await waitForImmediate();
  received.length = 0;

  runtime.onCDPMessage(
    JSON.stringify({
      method: "Page.frameNavigated",
      sessionId: "selected-session",
      params: {
        frame: {
          id: "selected-frame",
          loaderId: "interactive-loader",
          url: "https://example.test/interactive",
        },
      },
    }),
  );
  const deadline = Date.now() + 150;
  while (
    !received.some(
      (message) =>
        message.method === "Page.lifecycleEvent" &&
        message.params?.name === "DOMContentLoaded",
    ) &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  transport.close();

  assert.deepEqual(
    received
      .filter((message) => message.method === "Page.lifecycleEvent")
      .map((message) => message.params.name),
    ["DOMContentLoaded"],
  );
  assert.equal(
    received.some((message) => message.method === "Page.frameStoppedLoading"),
    false,
  );
});

test("the Ego Playwright transport suppresses a delayed duplicate native attachment", async () => {
  let nextNativeId = 1_000_000_370;
  const runtime = {
    sendCDPMessage(payload) {
      const request = JSON.parse(payload);
      let result = {};
      if (request.method === "Target.getTargetInfo") {
        result = {
          targetInfo: {
            targetId: "selected-target",
            type: "page",
            title: "Selected",
            url: "https://example.test/",
          },
        };
      } else if (request.method === "Target.attachToTarget") {
        result = { sessionId: "selected-session" };
      }
      queueMicrotask(() => {
        runtime.onCDPMessage(JSON.stringify({ id: request.id, result }));
      });
    },
  };
  const transport = egoTransport.createEgoCdpTransport(runtime, {
    targetIds: ["selected-target"],
    allocateMessageId: () => nextNativeId++,
  });
  const received = [];
  transport.onmessage = (message) => received.push(message);

  transport.send({
    id: 41,
    method: "Target.setAutoAttach",
    params: {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
    },
  });
  for (let index = 0; index < 6; index += 1) await waitForImmediate();

  runtime.onCDPMessage(
    JSON.stringify({
      method: "Target.attachedToTarget",
      params: {
        sessionId: "late-native-session",
        targetInfo: {
          targetId: "selected-target",
          type: "page",
          title: "Selected",
          url: "https://example.test/",
        },
        waitingForDebugger: false,
      },
    }),
  );
  await waitForImmediate();

  assert.deepEqual(
    received
      .filter((message) => message.method === "Target.attachedToTarget")
      .map((message) => message.params.sessionId),
    ["selected-session"],
  );
  transport.close();
});

test("the Ego Playwright transport rebinds a live target after its native session detaches", async () => {
  let nextNativeId = 1_000_000_390;
  let attachCount = 0;
  const sent = [];
  const runtime = {
    async listTabs() {
      return { tabs: [{ targetId: "selected-target" }] };
    },
    sendCDPMessage(payload) {
      const request = JSON.parse(payload);
      sent.push(request);
      let result = {};
      if (request.method === "Target.getTargetInfo") {
        result = {
          targetInfo: {
            targetId: "selected-target",
            type: "page",
            title: "Selected",
            url: "https://example.test/after",
          },
        };
      } else if (request.method === "Target.attachToTarget") {
        attachCount += 1;
        result = {
          sessionId: attachCount === 1 ? "initial-session" : "rebound-session",
        };
      } else if (request.method === "Runtime.evaluate") {
        result = { result: { type: "string", value: "rebound-result" } };
      }
      if (
        request.method === "Runtime.evaluate" &&
        request.sessionId === "initial-session" &&
        request.params.expression === "stalledCall()"
      ) {
        return;
      }
      queueMicrotask(() => {
        runtime.onCDPMessage(
          JSON.stringify({
            id: request.id,
            result,
            ...(request.sessionId ? { sessionId: request.sessionId } : {}),
          }),
        );
      });
    },
  };
  const transport = egoTransport.createEgoCdpTransport(runtime, {
    targetIds: ["selected-target"],
    allocateMessageId: () => nextNativeId++,
  });
  const received = [];
  transport.onmessage = (message) => received.push(message);

  transport.send({
    id: 42,
    method: "Target.setAutoAttach",
    params: {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
    },
  });
  for (let index = 0; index < 6; index += 1) await waitForImmediate();
  transport.send({
    id: 43,
    method: "Page.enable",
    params: {},
    sessionId: "initial-session",
  });
  await waitForImmediate();
  received.length = 0;
  sent.length = 0;

  transport.send({
    id: 45,
    method: "Runtime.evaluate",
    params: { expression: "stalledCall()", returnByValue: true },
    sessionId: "initial-session",
  });

  runtime.onCDPMessage(
    JSON.stringify({
      method: "Target.detachedFromTarget",
      params: {
        sessionId: "initial-session",
        targetId: "selected-target",
      },
    }),
  );
  const rebindDeadline = Date.now() + 500;
  while (attachCount < 2 && Date.now() < rebindDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  assert.equal(attachCount, 2);
  assert.equal(
    received.some((message) => message.method === "Target.detachedFromTarget"),
    false,
  );
  assert.ok(
    sent.some(
      (request) =>
        request.method === "Page.enable" &&
        request.sessionId === "rebound-session",
    ),
  );
  assert.match(
    received.find((message) => message.id === 45)?.error?.message || "",
    /session detached/i,
  );

  transport.send({
    id: 44,
    method: "Runtime.evaluate",
    params: { expression: "location.href", returnByValue: true },
    sessionId: "initial-session",
  });
  for (let index = 0; index < 3; index += 1) await waitForImmediate();
  assert.ok(
    sent.some(
      (request) =>
        request.method === "Runtime.evaluate" &&
        request.sessionId === "rebound-session",
    ),
  );
  assert.deepEqual(
    received.find((message) => message.id === 44),
    {
      id: 44,
      result: {
        result: { type: "string", value: "rebound-result" },
      },
      sessionId: "initial-session",
    },
  );
  transport.close();
});

test("the Ego Playwright transport does not close a target reused by createTab navigation", async () => {
  let nextNativeId = 1_000_000_280;
  let attachCount = 0;
  const sent = [];
  const runtime = {
    async createTab() {
      return { targetId: "reused-target" };
    },
    sendCDPMessage(payload) {
      const request = JSON.parse(payload);
      sent.push(request);
      let result = {};
      if (request.method === "Target.getTargetInfo") {
        result = {
          targetInfo: {
            targetId: "reused-target",
            type: "page",
            url: "https://example.test/after",
          },
        };
      } else if (request.method === "Target.attachToTarget") {
        attachCount += 1;
        result = {
          sessionId:
            attachCount === 1 ? "client-session" : "replacement-session",
        };
      } else if (request.method === "Page.getFrameTree") {
        result = {
          frameTree: {
            frame: {
              id: "replacement-frame",
              loaderId: "replacement-loader",
              url: "https://example.test/after",
            },
          },
        };
      } else if (request.method === "Runtime.evaluate") {
        result = { result: { type: "string", value: "complete" } };
      }
      if (request.method === "Target.detachFromTarget") {
        queueMicrotask(() => {
          runtime.onCDPMessage(
            JSON.stringify({
              method: "Runtime.executionContextsCleared",
              params: {},
              sessionId: request.params.sessionId,
            }),
          );
          runtime.onCDPMessage(
            JSON.stringify({
              method: "Target.detachedFromTarget",
              params: {
                sessionId: request.params.sessionId,
                targetId: "reused-target",
              },
            }),
          );
        });
      }
      queueMicrotask(() => {
        runtime.onCDPMessage(JSON.stringify({ id: request.id, result }));
      });
    },
  };
  const transport = egoTransport.createEgoCdpTransport(runtime, {
    targetIds: ["reused-target"],
    allocateMessageId: () => nextNativeId++,
  });
  const received = [];
  transport.onmessage = (message) => received.push(message);

  transport.send({
    id: 40,
    method: "Target.setAutoAttach",
    params: { autoAttach: true, flatten: true },
  });
  for (let index = 0; index < 6; index += 1) await waitForImmediate();
  transport.send({
    id: 41,
    method: "Page.navigate",
    params: {
      frameId: "reused-target",
      url: "https://example.test/after",
    },
    sessionId: "client-session",
  });
  const navigationDeadline = Date.now() + 1_000;
  while (
    !received.some((message) => message.id === 41) &&
    Date.now() < navigationDeadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  assert.equal(
    sent.some((request) => request.method === "Target.closeTarget"),
    false,
  );
  assert.equal(
    received.some((message) => message.method === "Target.detachedFromTarget"),
    false,
  );
  assert.equal(
    received.filter(
      (message) => message.method === "Runtime.executionContextsCleared",
    ).length,
    1,
  );
  transport.close();
});

test("the Ego Playwright transport reports synchronous createTab failures and releases pending work", async () => {
  const pendingWork = [];
  const runtime = {
    createTab() {
      throw new Error("createTab failed");
    },
    sendCDPMessage() {},
  };
  const transport = egoTransport.createEgoCdpTransport(runtime, {
    onPendingWorkChange(count) {
      pendingWork.push(count);
    },
  });
  transport.releaseConnectionKeepAlive();
  const response = new Promise((resolve) => {
    transport.onmessage = resolve;
  });

  assert.doesNotThrow(() => {
    transport.send({
      id: 16,
      method: "Target.createTarget",
      params: { url: "about:blank" },
    });
  });

  assert.deepEqual(await response, {
    id: 16,
    error: { code: -32_000, message: "createTab failed" },
  });
  assert.deepEqual(pendingWork, [1, 0, 1, 0]);
  transport.close();
  assert.deepEqual(pendingWork, [1, 0, 1, 0]);
});

test("the Ego Playwright transport confirms native tab removal before completing Page.close", async () => {
  let listCalls = 0;
  const runtime = {
    async listTabs() {
      listCalls += 1;
      return listCalls < 3
        ? { tabs: [{ targetId: "closing-target" }] }
        : { tabs: [] };
    },
    sendCDPMessage() {},
  };
  const transport = egoTransport.createEgoCdpTransport(runtime, {
    targetIds: ["closing-target"],
  });
  const received = [];
  transport.onmessage = (message) => received.push(message);

  transport.send({
    id: 44,
    method: "Target.closeTarget",
    params: { targetId: "closing-target" },
  });
  await waitForImmediate();
  assert.equal(
    received.some((message) => message.id === 44),
    false,
  );

  const deadline = Date.now() + 500;
  while (
    !received.some((message) => message.id === 44) &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(listCalls >= 3);
  assert.deepEqual(
    received.find((message) => message.id === 44),
    {
      id: 44,
      result: { success: true },
    },
  );
  transport.close();
});

test("Page.close replies before native close events reach Playwright", async () => {
  let listCalls = 0;
  const runtime = {
    async listTabs() {
      listCalls += 1;
      return listCalls < 2
        ? { tabs: [{ targetId: "closing-target" }] }
        : { tabs: [] };
    },
    sendCDPMessage(payload) {
      const request = JSON.parse(payload);
      if (request.method !== "Target.closeTarget") return;
      queueMicrotask(() => {
        runtime.onCDPMessage(
          JSON.stringify({
            method: "Inspector.detached",
            params: { reason: "Render process gone." },
            sessionId: "closing-session",
          }),
        );
        runtime.onCDPMessage(
          JSON.stringify({
            method: "Target.detachedFromTarget",
            params: {
              sessionId: "closing-session",
              targetId: "closing-target",
            },
          }),
        );
        runtime.onCDPMessage(
          JSON.stringify({
            method: "Target.targetDestroyed",
            params: { targetId: "closing-target" },
          }),
        );
      });
    },
  };
  const transport = egoTransport.createEgoCdpTransport(runtime, {
    targetIds: ["closing-target"],
  });
  const received = [];
  transport.onmessage = (message) => received.push(message);

  runtime.onCDPMessage(
    JSON.stringify({
      method: "Target.attachedToTarget",
      params: {
        sessionId: "closing-session",
        targetInfo: { targetId: "closing-target", type: "page" },
        waitingForDebugger: false,
      },
    }),
  );
  await waitForImmediate();
  received.length = 0;

  transport.send({
    id: 45,
    method: "Target.closeTarget",
    params: { targetId: "closing-target" },
  });

  const deadline = Date.now() + 500;
  while (
    !received.some((message) => message.id === 45) &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  assert.deepEqual(received, [
    { id: 45, result: { success: true } },
    {
      method: "Target.detachedFromTarget",
      params: {
        sessionId: "closing-session",
        targetId: "closing-target",
      },
    },
  ]);
  transport.close();
});

test("the Ego Playwright transport acknowledges Target.closeTarget without waiting for its unsupported response", async () => {
  assert.equal(typeof egoTransport.createEgoCdpTransport, "function");

  const sent = [];
  const runtime = {
    sendCDPMessage(payload) {
      sent.push(JSON.parse(payload));
    },
  };
  const transport = egoTransport.createEgoCdpTransport(runtime, {
    allocateMessageId: () => 1_000_000_004,
  });
  const response = new Promise((resolve) => {
    transport.onmessage = resolve;
  });

  transport.send({
    id: 14,
    method: "Target.closeTarget",
    params: { targetId: "target-to-close" },
  });

  assert.deepEqual(sent, [
    {
      id: 1_000_000_004,
      method: "Target.closeTarget",
      params: { targetId: "target-to-close" },
    },
  ]);
  assert.deepEqual(await response, { id: 14, result: { success: true } });
  transport.close();
});

test("the Ego Playwright transport completes Page.close from the observed target session", async () => {
  assert.equal(typeof egoTransport.createEgoCdpTransport, "function");

  const runtime = {
    sendCDPMessage() {},
  };
  const transport = egoTransport.createEgoCdpTransport(runtime);
  const received = [];
  transport.onmessage = (message) => received.push(message);

  runtime.onCDPMessage(
    JSON.stringify({
      method: "Target.attachedToTarget",
      params: {
        sessionId: "session-to-close",
        targetInfo: { targetId: "target-to-close", type: "page" },
        waitingForDebugger: false,
      },
    }),
  );
  await waitForImmediate();
  received.length = 0;

  transport.send({
    id: 15,
    method: "Target.closeTarget",
    params: { targetId: "target-to-close" },
  });
  await waitForImmediate();

  assert.deepEqual(received, [
    { id: 15, result: { success: true } },
    {
      method: "Target.detachedFromTarget",
      params: {
        sessionId: "session-to-close",
        targetId: "target-to-close",
      },
    },
  ]);
  transport.close();
});

test("the Playwright transport hook intercepts only its registered Ego transport", async () => {
  assert.equal(typeof egoTransport.createEgoPlaywrightTransport, "function");

  const nativeConnections = [];
  class FakeWebSocketTransport {
    static async connect(_progress, endpoint) {
      nativeConnections.push(endpoint);
      return { endpoint };
    }
  }
  const runtime = {
    sendCDPMessage() {},
  };
  const lease = await egoTransport.createEgoPlaywrightTransport(runtime, {
    WebSocketTransport: FakeWebSocketTransport,
    allocateMessageId: () => 1_000_000_003,
  });

  const direct = await FakeWebSocketTransport.connect(
    undefined,
    lease.connectToken,
  );
  const native = await FakeWebSocketTransport.connect(
    undefined,
    "ws://127.0.0.1:9222/devtools/browser/native",
  );

  assert.match(lease.connectToken, /^ws\+ego:\/\/transport\//);
  assert.equal(direct.constructor.name, "EgoCdpTransport");
  assert.equal(typeof direct.closeAndWait, "function");
  assert.deepEqual(nativeConnections, [
    "ws://127.0.0.1:9222/devtools/browser/native",
  ]);
  assert.deepEqual(native, {
    endpoint: "ws://127.0.0.1:9222/devtools/browser/native",
  });

  await lease.close();
  assert.equal(direct.closed, true);
  await direct.closeAndWait();
});

test("the direct Playwright transport disables auto-attach and detaches sessions before closing", async () => {
  let nextNativeId = 1_000_000_300;
  const sent = [];
  const runtime = {
    sendCDPMessage(payload) {
      const request = JSON.parse(payload);
      sent.push(request);
      queueMicrotask(() => {
        runtime.onCDPMessage(JSON.stringify({ id: request.id, result: {} }));
      });
    },
  };
  const transport = egoTransport.createEgoCdpTransport(runtime, {
    targetIds: ["selected-target"],
    allocateMessageId: () => nextNativeId++,
  });
  runtime.onCDPMessage(
    JSON.stringify({
      method: "Target.attachedToTarget",
      params: {
        sessionId: "selected-session",
        targetInfo: { targetId: "selected-target", type: "page" },
      },
    }),
  );
  await waitForImmediate();

  await transport.closeAndWait();

  assert.deepEqual(
    sent.map(({ method, params }) => ({ method, params })),
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
        method: "Target.detachFromTarget",
        params: { sessionId: "selected-session" },
      },
    ],
  );
  assert.equal(transport.closed, true);
});

test("the direct Playwright transport does not rebind its intentional close detach", async () => {
  let nextNativeId = 1_000_000_410;
  let attachCount = 0;
  const runtime = {
    async listTabs() {
      return { tabs: [{ targetId: "selected-target" }] };
    },
    sendCDPMessage(payload) {
      const request = JSON.parse(payload);
      let result = {};
      if (request.method === "Target.getTargetInfo") {
        result = {
          targetInfo: {
            targetId: "selected-target",
            type: "page",
            url: "https://example.test/",
          },
        };
      } else if (request.method === "Target.attachToTarget") {
        attachCount += 1;
        result = { sessionId: `selected-session-${attachCount}` };
      } else if (request.method === "Target.detachFromTarget") {
        queueMicrotask(() => {
          runtime.onCDPMessage(
            JSON.stringify({
              method: "Target.detachedFromTarget",
              params: {
                targetId: "selected-target",
                sessionId: request.params.sessionId,
              },
            }),
          );
        });
      }
      queueMicrotask(() => {
        runtime.onCDPMessage(JSON.stringify({ id: request.id, result }));
      });
    },
  };
  const transport = egoTransport.createEgoCdpTransport(runtime, {
    targetIds: ["selected-target"],
    allocateMessageId: () => nextNativeId++,
  });

  transport.send({
    id: 46,
    method: "Target.setAutoAttach",
    params: {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
    },
  });
  for (let index = 0; index < 6; index += 1) await waitForImmediate();
  await transport.closeAndWait();

  assert.equal(attachCount, 1);
  assert.equal(transport.closed, true);
});

test("the TaskSpace uses the direct Ego transport", async () => {
  let lease;
  try {
    lease = await playwrightTaskSpace.createNativePlaywrightTransport({
      sendCDPMessage() {},
      async listTabs() {
        return { tabs: [] };
      },
    });
    assert.match(lease.connectToken, /^ws\+ego:\/\/transport\//);
  } finally {
    await lease?.close?.();
  }
});

test("the TaskSpace Playwright transport does not fall back to getCDPEndpoint", async () => {
  let endpointCalls = 0;

  await assert.rejects(
    playwrightTaskSpace.createNativePlaywrightTransport({
      async getCDPEndpoint() {
        endpointCalls += 1;
        return "ws://127.0.0.1:9222/devtools/browser/legacy";
      },
    }),
    /requires ego\.sendCDPMessage/,
  );

  assert.equal(endpointCalls, 0);
});

test("the removed local CDP bridge is no longer exported", () => {
  assert.equal(playwrightTaskSpace.createLocalCdpBridge, undefined);
});

async function createTaskSpaceTransportHarness({
  tabs,
  harnessOptions,
  transportOptions,
}) {
  const { FakeNativeBrowser } = await import("./fake-native-harness.mjs");
  const fake = new FakeNativeBrowser(harnessOptions);
  for (const [targetId, url] of tabs) fake.addTab(targetId, url);
  const received = [];
  const pendingWork = [];
  const transport = egoTransport.createEgoCdpTransport(fake.runtime, {
    targetIds: tabs.map(([targetId]) => targetId),
    onPendingWorkChange: (count) => pendingWork.push(count),
    ...transportOptions,
  });
  transport.releaseConnectionKeepAlive();
  transport.onmessage = (message) => received.push(message);
  transport.send({
    id: 1,
    method: "Target.setAutoAttach",
    params: { autoAttach: true, waitForDebuggerOnStart: true, flatten: true },
  });
  const settled = Date.now() + 2_000;
  while (fake.sessions.size < tabs.length && Date.now() < settled) {
    await waitForImmediate();
  }
  return { fake, transport, received, pendingWork };
}

function gateListTabs(fake) {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const originalListTabs = fake.runtime.listTabs;
  fake.runtime.listTabs = async () => {
    await gate;
    return originalListTabs();
  };
  return () => release();
}

async function waitForMessage(received, predicate, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = received.find(predicate);
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return received.find(predicate);
}

test("commands sent during a session rebind are delivered after the route rebinds", async () => {
  const harness = await createTaskSpaceTransportHarness({
    tabs: [["tab-main", "https://main.test/"]],
  });
  const { fake, transport, received } = harness;
  const oldSession = [...fake.sessions.keys()][0];
  const releaseListTabs = gateListTabs(fake);

  fake.sessions.delete(oldSession);
  fake.emit({
    method: "Target.detachedFromTarget",
    params: { sessionId: oldSession, targetId: "tab-main" },
  });
  await new Promise((resolve) => setTimeout(resolve, 100));

  transport.send({
    id: 70,
    method: "Runtime.evaluate",
    params: { expression: "1 + 1" },
    sessionId: oldSession,
  });
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(
    received.find((message) => message.id === 70),
    undefined,
    "the command is held while the route rebinds instead of failing",
  );

  releaseListTabs();
  const reply = await waitForMessage(received, (message) => message.id === 70);
  assert.ok(reply, "the held command completes after the rebind");
  assert.equal(reply.error, undefined);
  assert.equal(reply.sessionId, oldSession);
  await transport.closeAndWait();
});

test("browser-level cookie commands prefer an attached route", async () => {
  const harness = await createTaskSpaceTransportHarness({
    tabs: [
      ["tab-a", "https://a.test/"],
      ["tab-b", "https://b.test/"],
    ],
  });
  const { fake, transport, received } = harness;
  const sessionA = [...fake.sessions.entries()].find(
    ([, targetId]) => targetId === "tab-a",
  )[0];
  const releaseListTabs = gateListTabs(fake);

  fake.sessions.delete(sessionA);
  fake.emit({
    method: "Target.detachedFromTarget",
    params: { sessionId: sessionA, targetId: "tab-a" },
  });
  await new Promise((resolve) => setTimeout(resolve, 100));

  transport.send({ id: 77, method: "Storage.getCookies", params: {} });
  const reply = await waitForMessage(received, (message) => message.id === 77);
  assert.ok(reply, "the cookie command completes");
  assert.equal(
    reply.error,
    undefined,
    "the cookie command uses a healthy route instead of the rebinding one",
  );
  assert.deepEqual(reply.result, { cookies: [] });
  releaseListTabs();
  await new Promise((resolve) => setTimeout(resolve, 100));
  await transport.closeAndWait();
});

test("a native send error rejects in-flight commands without closing the transport", async () => {
  const harness = await createTaskSpaceTransportHarness({
    tabs: [["tab-main", "https://main.test/"]],
  });
  const { fake, transport, received } = harness;
  const mainSession = [...fake.sessions.keys()][0];

  const originalSend = fake.runtime.sendCDPMessage;
  fake.runtime.sendCDPMessage = () => {};
  transport.send({
    id: 91,
    method: "Runtime.evaluate",
    params: { expression: "1" },
    sessionId: mainSession,
  });
  await waitForImmediate();
  fake.runtime.onSendCDPMessageError?.(
    "Task space is not assigned to an agent.",
    "EGO_TASK_SPACE_INACTIVE",
  );

  const failed = await waitForMessage(received, (message) => message.id === 91);
  assert.ok(failed, "the in-flight command is rejected");
  assert.match(failed.error?.message || "", /EGO_TASK_SPACE_INACTIVE/);
  assert.equal(
    transport.closed,
    false,
    "a task-level send error must not tear down the whole transport",
  );

  fake.runtime.sendCDPMessage = originalSend;
  transport.send({ id: 92, method: "Target.getTargets", params: {} });
  const recovered = await waitForMessage(
    received,
    (message) => message.id === 92,
  );
  assert.ok(recovered, "the transport keeps working after the send error");
  assert.equal(recovered.error, undefined);
  await transport.closeAndWait();
});

// Every task.page.* operation funnels through this transport, so a native send
// error is what the agent reads for the whole Playwright surface. It must carry the
// resolved wording, not the raw native text (a user_action_reason key, or the static
// sentence this channel still sends).
test("a native send error surfaces the resolved user-control wording", async () => {
  const harness = await createTaskSpaceTransportHarness({
    tabs: [["tab-main", "https://main.test/"]],
  });
  const { fake, transport, received } = harness;
  const mainSession = [...fake.sessions.keys()][0];

  fake.runtime.sendCDPMessage = () => {};
  transport.send({
    id: 93,
    method: "Runtime.evaluate",
    params: { expression: "1" },
    sessionId: mainSession,
  });
  await waitForImmediate();
  fake.runtime.onSendCDPMessageError?.(
    "The task is under user control.",
    "EGO_TASK_SPACE_USER_IN_CONTROL",
  );

  const failed = await waitForMessage(received, (message) => message.id === 93);
  const failureText = failed.error?.message || "";
  assert.match(failureText, /^EGO_TASK_SPACE_USER_IN_CONTROL: /);
  assert.match(failureText, /egoBrowser\.takeOverTaskSpace\(\)/);
  assert.doesNotMatch(failureText, /The task is under user control\./);
  await transport.closeAndWait();
});

test("popups opened concurrently with different URLs are both attached", async () => {
  const harness = await createTaskSpaceTransportHarness({
    tabs: [["tab-main", "https://main.test/"]],
  });
  const { fake, transport, received } = harness;
  const mainSession = [...fake.sessions.keys()][0];
  const releaseListTabs = gateListTabs(fake);

  fake.addTab("tab-popup-a", "https://popup.test/a");
  fake.addTab("tab-popup-b", "https://popup.test/b");
  fake.emit({
    method: "Page.windowOpen",
    params: { url: "https://popup.test/a", windowName: "a" },
    sessionId: mainSession,
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  fake.emit({
    method: "Page.windowOpen",
    params: { url: "https://popup.test/b", windowName: "b" },
    sessionId: mainSession,
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  releaseListTabs();

  const attachedA = await waitForMessage(
    received,
    (message) =>
      message.method === "Target.attachedToTarget" &&
      message.params?.targetInfo?.targetId === "tab-popup-a",
  );
  const attachedB = await waitForMessage(
    received,
    (message) =>
      message.method === "Target.attachedToTarget" &&
      message.params?.targetInfo?.targetId === "tab-popup-b",
  );
  assert.ok(attachedA, "the first popup is attached");
  assert.ok(attachedB, "the second popup is attached as well");
  await transport.closeAndWait();
});

test("a popup whose tab URL changed before discovery is still attached", async () => {
  const harness = await createTaskSpaceTransportHarness({
    tabs: [["tab-main", "https://main.test/"]],
  });
  const { fake, transport, received } = harness;
  const mainSession = [...fake.sessions.keys()][0];

  // The native tab already shows the post-redirect URL, so it can never
  // equal the windowOpen URL.
  fake.addTab("tab-popup-moved", "https://popup.test/final");
  fake.emit({
    method: "Page.windowOpen",
    params: { url: "https://popup.test/r", windowName: "" },
    sessionId: mainSession,
  });

  const attached = await waitForMessage(
    received,
    (message) =>
      message.method === "Target.attachedToTarget" &&
      message.params?.targetInfo?.targetId === "tab-popup-moved",
  );
  assert.ok(attached, "the redirected popup is attached");
  assert.equal(attached.params.targetInfo.openerId, "tab-main");
  await transport.closeAndWait();
});

test("an exact URL match is preferred over queue order when adopting a popup", async () => {
  const harness = await createTaskSpaceTransportHarness({
    tabs: [
      ["tab-a", "https://a.test/"],
      ["tab-b", "https://b.test/"],
    ],
  });
  const { fake, transport, received } = harness;
  const sessionA = [...fake.sessions].find(
    ([, targetId]) => targetId === "tab-a",
  )[0];
  const sessionB = [...fake.sessions].find(
    ([, targetId]) => targetId === "tab-b",
  )[0];
  const releaseListTabs = gateListTabs(fake);

  // The older queued entry does not match the tab URL; the newer one does.
  fake.emit({
    method: "Page.windowOpen",
    params: { url: "https://popup.test/r", windowName: "" },
    sessionId: sessionA,
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  fake.emit({
    method: "Page.windowOpen",
    params: { url: "https://popup.test/exact", windowName: "" },
    sessionId: sessionB,
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  fake.addTab("tab-popup", "https://popup.test/exact");
  releaseListTabs();

  const attached = await waitForMessage(
    received,
    (message) =>
      message.method === "Target.attachedToTarget" &&
      message.params?.targetInfo?.targetId === "tab-popup",
  );
  assert.ok(attached, "the popup is attached");
  assert.equal(
    attached.params.targetInfo.openerId,
    "tab-b",
    "the exact URL match wins over the older queued entry",
  );
  await transport.closeAndWait();
});

test("concurrent popups both attach when one URL changed before discovery", async () => {
  const harness = await createTaskSpaceTransportHarness({
    tabs: [["tab-main", "https://main.test/"]],
  });
  const { fake, transport, received } = harness;
  const mainSession = [...fake.sessions.keys()][0];
  const releaseListTabs = gateListTabs(fake);

  fake.addTab("tab-popup-exact", "https://popup.test/exact");
  fake.addTab("tab-popup-moved", "https://popup.test/final");
  fake.emit({
    method: "Page.windowOpen",
    params: { url: "https://popup.test/exact", windowName: "exact" },
    sessionId: mainSession,
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  fake.emit({
    method: "Page.windowOpen",
    params: { url: "https://popup.test/r", windowName: "moved" },
    sessionId: mainSession,
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  releaseListTabs();

  const attachedExact = await waitForMessage(
    received,
    (message) =>
      message.method === "Target.attachedToTarget" &&
      message.params?.targetInfo?.targetId === "tab-popup-exact",
  );
  const attachedMoved = await waitForMessage(
    received,
    (message) =>
      message.method === "Target.attachedToTarget" &&
      message.params?.targetInfo?.targetId === "tab-popup-moved",
  );
  assert.ok(attachedExact, "the exact-match popup is attached");
  assert.ok(attachedMoved, "the redirected popup is attached as well");
  assert.equal(attachedExact.params.targetInfo.openerId, "tab-main");
  assert.equal(attachedMoved.params.targetInfo.openerId, "tab-main");
  await transport.closeAndWait();
});

test("a redirecting popup is adopted only after its URL settles", async () => {
  const harness = await createTaskSpaceTransportHarness({
    tabs: [["tab-main", "https://main.test/"]],
  });
  const { fake, transport, received } = harness;
  const mainSession = [...fake.sessions.keys()][0];

  // Mirror the native timeline: the tab first appears with an empty URL and
  // only commits to the final URL a few polls later.
  fake.addTab("tab-popup-late", "");
  const startedAt = Date.now();
  fake.emit({
    method: "Page.windowOpen",
    params: { url: "https://popup.test/r", windowName: "" },
    sessionId: mainSession,
  });
  await new Promise((resolve) => setTimeout(resolve, 150));
  fake.tabs.get("tab-popup-late").url = "https://popup.test/final";

  const attached = await waitForMessage(
    received,
    (message) =>
      message.method === "Target.attachedToTarget" &&
      message.params?.targetInfo?.targetId === "tab-popup-late",
  );
  assert.ok(attached, "the popup is attached after its URL settles");
  assert.equal(
    attached.params.targetInfo.url,
    "https://popup.test/final",
    "adoption waits for the committed URL instead of racing the navigation",
  );
  assert.ok(
    Date.now() - startedAt < 1_500,
    "a settled URL is adopted well before the deadline phase",
  );
  await transport.closeAndWait();
});

test("a popup that never navigates is adopted in the deadline phase", async () => {
  const harness = await createTaskSpaceTransportHarness({
    tabs: [["tab-main", "https://main.test/"]],
  });
  const { fake, transport, received } = harness;
  const mainSession = [...fake.sessions.keys()][0];

  // A bare window.open() popup: the tab URL stays empty forever, so only the
  // end-of-deadline adoption can claim it.
  fake.addTab("tab-popup-blank", "");
  const startedAt = Date.now();
  fake.emit({
    method: "Page.windowOpen",
    params: { url: "https://popup.test/never", windowName: "" },
    sessionId: mainSession,
  });

  const attached = await waitForMessage(
    received,
    (message) =>
      message.method === "Target.attachedToTarget" &&
      message.params?.targetInfo?.targetId === "tab-popup-blank",
  );
  assert.ok(attached, "the blank popup is still attached");
  assert.equal(attached.params.targetInfo.openerId, "tab-main");
  assert.ok(
    Date.now() - startedAt >= 1_000,
    "an empty URL is never adopted eagerly",
  );
  await transport.closeAndWait();
});

test("a popup after a TaskSpace navigation replacement adopts the popup tab, not the opener", async () => {
  const harness = await createTaskSpaceTransportHarness({
    tabs: [["tab-main", "https://main.test/"]],
  });
  const { fake, transport, received } = harness;
  const mainSession = [...fake.sessions.keys()][0];

  // A TaskSpace navigation replacement rebinds the route onto a brand new
  // native tab (the fake's createTab always mints a fresh targetId).
  transport.send({
    id: 60,
    method: "Page.navigate",
    params: { frameId: "tab-main", url: "https://main.test/next" },
    sessionId: mainSession,
  });
  await waitForMessage(received, (message) => message.id === 60, 5_000);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const replacementSession = [...fake.sessions.keys()].at(-1);
  const replacementTargetId = fake.sessions.get(replacementSession);
  assert.notEqual(replacementTargetId, "tab-main");
  const attachesBefore = fake.log.filter(
    (request) =>
      request.method === "Target.attachToTarget" &&
      request.params?.targetId === replacementTargetId,
  ).length;

  // Redirect case: the popup tab's URL never matches the windowOpen URL, so
  // adoption must go through the fallback path — which used to grab the
  // route's own replacement tab because #targetIds had lost track of it.
  fake.addTab("tab-popup-after-nav", "https://popup.test/final");
  fake.emit({
    method: "Page.windowOpen",
    params: { url: "https://popup.test/r", windowName: "" },
    sessionId: replacementSession,
  });

  const attached = await waitForMessage(
    received,
    (message) =>
      message.method === "Target.attachedToTarget" &&
      message.params?.targetInfo?.targetId === "tab-popup-after-nav",
  );
  assert.ok(attached, "the popup tab is adopted");
  assert.equal(attached.params.targetInfo.openerId, "tab-main");
  const attachesAfter = fake.log.filter(
    (request) =>
      request.method === "Target.attachToTarget" &&
      request.params?.targetId === replacementTargetId,
  ).length;
  assert.equal(
    attachesAfter,
    attachesBefore,
    "the route's native target must not be attached a second time",
  );
  assert.ok(
    !received.some(
      (message) =>
        message.method === "Target.attachedToTarget" &&
        message.params?.targetInfo?.targetId === replacementTargetId,
    ),
    "no ghost page is announced for the route's own native target",
  );
  await transport.closeAndWait();
});

test("replayed toggle commands preserve the client's final state", async () => {
  const harness = await createTaskSpaceTransportHarness({
    tabs: [["tab-main", "https://main.test/"]],
  });
  const { fake, transport, received } = harness;
  const mainSession = [...fake.sessions.keys()][0];

  const toggles = [
    { id: 50, cacheDisabled: true },
    { id: 51, cacheDisabled: false },
    { id: 52, cacheDisabled: true },
  ];
  for (const toggle of toggles) {
    transport.send({
      id: toggle.id,
      method: "Network.setCacheDisabled",
      params: { cacheDisabled: toggle.cacheDisabled },
      sessionId: mainSession,
    });
  }
  await waitForMessage(received, (message) => message.id === 52);

  transport.send({
    id: 53,
    method: "Page.navigate",
    params: { frameId: "tab-main", url: "https://main.test/next" },
    sessionId: mainSession,
  });
  await waitForMessage(received, (message) => message.id === 53, 5_000);
  await new Promise((resolve) => setTimeout(resolve, 100));

  const replacementSession = [...fake.sessions.keys()].at(-1);
  assert.notEqual(replacementSession, mainSession);
  const replayed = fake.log.filter(
    (request) =>
      request.sessionId === replacementSession &&
      request.method === "Network.setCacheDisabled",
  );
  assert.ok(replayed.length >= 1, "the toggle command is replayed");
  assert.equal(
    replayed.at(-1).params.cacheDisabled,
    true,
    "the replayed toggle ends on the client's final state",
  );
  await transport.closeAndWait();
});

test("a document request paused by replayed interception reaches the client before commit", async () => {
  const harness = await createTaskSpaceTransportHarness({
    tabs: [["tab-main", "https://main.test/"]],
    harnessOptions: { interceptNavigations: true },
    transportOptions: { navigationCommitTimeoutMs: 1_500 },
  });
  const { fake, transport, received } = harness;
  const mainSession = [...fake.sessions.keys()][0];

  transport.send({
    id: 80,
    method: "Fetch.enable",
    params: {
      patterns: [{ urlPattern: "*", requestStage: "Request" }],
      handleAuthRequests: true,
    },
    sessionId: mainSession,
  });
  await waitForMessage(received, (message) => message.id === 80);

  transport.send({
    id: 81,
    method: "Page.navigate",
    params: { frameId: "tab-main", url: "https://main.test/second" },
    sessionId: mainSession,
  });

  const paused = await waitForMessage(
    received,
    (message) => message.method === "Fetch.requestPaused",
  );
  assert.ok(
    paused,
    "the replacement target's paused document request must reach the client " +
      "while the navigation waits for commit",
  );
  assert.equal(paused.sessionId, mainSession);
  assert.equal(
    paused.params.frameId,
    "tab-main",
    "the paused request reports the client's main frame id",
  );
  assert.equal(typeof paused.params.networkId, "string");
  assert.ok(
    received.some(
      (message) =>
        message.method === "Network.requestWillBeSent" &&
        message.params?.requestId === paused.params.networkId &&
        message.sessionId === mainSession,
    ),
    "the paired requestWillBeSent reaches the client so interception can dispatch",
  );

  transport.send({
    id: 82,
    method: "Fetch.continueRequest",
    params: { requestId: paused.params.requestId },
    sessionId: mainSession,
  });

  const navigated = await waitForMessage(
    received,
    (message) => message.id === 81,
    5_000,
  );
  assert.ok(navigated, "the navigation settles once the request is continued");
  assert.equal(
    navigated.error,
    undefined,
    `the navigation must commit, got: ${JSON.stringify(navigated?.error)}`,
  );
  assert.equal(navigated.result.frameId, "tab-main");
  assert.deepEqual(fake.continuedRequests, [paused.params.requestId]);
  await transport.closeAndWait();
});

test("a client Fetch.fulfillRequest mocks the document of a TaskSpace navigation", async () => {
  const harness = await createTaskSpaceTransportHarness({
    tabs: [["tab-main", "https://main.test/"]],
    harnessOptions: { interceptNavigations: true },
    transportOptions: { navigationCommitTimeoutMs: 2_000 },
  });
  const { fake, transport, received } = harness;
  const mainSession = [...fake.sessions.keys()][0];

  transport.send({
    id: 83,
    method: "Fetch.enable",
    params: { patterns: [{ urlPattern: "*", requestStage: "Request" }] },
    sessionId: mainSession,
  });
  await waitForMessage(received, (message) => message.id === 83);

  transport.send({
    id: 84,
    method: "Page.navigate",
    params: { frameId: "tab-main", url: "https://main.test/mocked" },
    sessionId: mainSession,
  });

  const paused = await waitForMessage(
    received,
    (message) => message.method === "Fetch.requestPaused",
  );
  assert.ok(paused, "the document request pauses after the native navigate");
  assert.equal(
    received.some((message) => message.id === 84),
    false,
    "the pause is bridged to the client before the navigation resolves",
  );

  transport.send({
    id: 85,
    method: "Fetch.fulfillRequest",
    params: {
      requestId: paused.params.requestId,
      responseCode: 200,
      body: Buffer.from("<html>mocked</html>").toString("base64"),
    },
    sessionId: mainSession,
  });

  const navigated = await waitForMessage(
    received,
    (message) => message.id === 84,
    5_000,
  );
  assert.ok(navigated, "the navigation settles once the request is fulfilled");
  assert.equal(
    navigated.error,
    undefined,
    `the navigation must commit, got: ${JSON.stringify(navigated?.error)}`,
  );
  assert.equal(navigated.result.frameId, "tab-main");
  assert.deepEqual(fake.continuedRequests, [paused.params.requestId]);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const documentAnnouncements = received.filter(
    (message) =>
      message.method === "Network.requestWillBeSent" &&
      message.params?.requestId === paused.params.networkId,
  );
  assert.equal(
    documentAnnouncements.length,
    1,
    "the bridged announcement and the real deferred event must not both reach the client",
  );
  assert.equal(
    received.filter(
      (message) =>
        message.method === "Network.responseReceived" &&
        message.params?.requestId === paused.params.networkId,
    ).length,
    1,
    "the real document response reaches the client exactly once",
  );
  await transport.closeAndWait();
});

test("a native Page.navigate errorText fails the client navigation and closes the replacement tab", async () => {
  const harness = await createTaskSpaceTransportHarness({
    tabs: [["tab-main", "https://main.test/"]],
  });
  const { fake, transport, received } = harness;
  const mainSession = [...fake.sessions.keys()][0];
  fake.navigationErrors.set(
    "https://nowhere.invalid/",
    "net::ERR_NAME_NOT_RESOLVED",
  );

  transport.send({
    id: 86,
    method: "Page.navigate",
    params: { frameId: "tab-main", url: "https://nowhere.invalid/" },
    sessionId: mainSession,
  });
  const failed = await waitForMessage(received, (message) => message.id === 86);
  assert.ok(failed, "the client navigation settles");
  assert.match(failed.error?.message || "", /net::ERR_NAME_NOT_RESOLVED/);

  const closeDeadline = Date.now() + 2_000;
  while (fake.closedTargets.length === 0 && Date.now() < closeDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(fake.closedTargets.length, 1, "the replacement tab is closed");
  assert.deepEqual(
    [...fake.tabs.keys()],
    ["tab-main"],
    "only the original tab remains",
  );

  transport.send({
    id: 87,
    method: "Runtime.evaluate",
    params: { expression: "1 + 1", returnByValue: true },
    sessionId: mainSession,
  });
  const evaluated = await waitForMessage(
    received,
    (message) => message.id === 87,
  );
  assert.ok(evaluated, "the page still answers commands");
  assert.equal(evaluated.error, undefined);
  await transport.closeAndWait();
});

test("a download navigation fails the client Page.navigate promptly", async () => {
  const harness = await createTaskSpaceTransportHarness({
    tabs: [["tab-main", "https://main.test/"]],
    transportOptions: { navigationCommitTimeoutMs: 10_000 },
  });
  const { fake, transport, received } = harness;
  const mainSession = [...fake.sessions.keys()][0];
  fake.downloadUrls.add("https://main.test/report.xlsx");

  const startedAt = Date.now();
  transport.send({
    id: 88,
    method: "Page.navigate",
    params: { frameId: "tab-main", url: "https://main.test/report.xlsx" },
    sessionId: mainSession,
  });
  const failed = await waitForMessage(received, (message) => message.id === 88);
  assert.ok(failed, "the client navigation settles");
  assert.match(
    failed.error?.message || "",
    /net::ERR_ABORTED; maybe frame was detached\?/,
  );
  assert.ok(
    Date.now() - startedAt < 5_000,
    "a download must fail well before the commit timeout",
  );

  const closeDeadline = Date.now() + 2_000;
  while (fake.closedTargets.length === 0 && Date.now() < closeDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.deepEqual(
    [...fake.tabs.keys()],
    ["tab-main"],
    "the replacement tab does not leak after the failed download navigation",
  );
  await transport.closeAndWait();
});

test("a held command whose replay throws synchronously still gets an error reply", async () => {
  const harness = await createTaskSpaceTransportHarness({
    tabs: [["tab-main", "https://main.test/"]],
  });
  const { fake, transport, received } = harness;
  const oldSession = [...fake.sessions.keys()][0];
  const releaseListTabs = gateListTabs(fake);

  fake.sessions.delete(oldSession);
  fake.emit({
    method: "Target.detachedFromTarget",
    params: { sessionId: oldSession, targetId: "tab-main" },
  });
  await new Promise((resolve) => setTimeout(resolve, 100));

  transport.send({
    id: 85,
    method: "DOM.getDocument",
    params: {},
    sessionId: oldSession,
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(
    received.find((message) => message.id === 85),
    undefined,
    "the command is held while the route rebinds",
  );

  const originalSend = fake.runtime.sendCDPMessage;
  fake.runtime.sendCDPMessage = (payload) => {
    if (JSON.parse(payload).method === "DOM.getDocument") {
      throw new Error("native send failed synchronously");
    }
    return originalSend(payload);
  };
  releaseListTabs();

  const reply = await waitForMessage(received, (message) => message.id === 85);
  assert.ok(
    reply,
    "the held command must be answered even when its replay throws",
  );
  assert.match(reply.error?.message || "", /native send failed synchronously/);
  assert.equal(reply.sessionId, oldSession);

  fake.runtime.sendCDPMessage = originalSend;
  await transport.closeAndWait();
});

test("commands during a pending navigation are answered from the old session", async () => {
  const harness = await createTaskSpaceTransportHarness({
    tabs: [["tab-main", "https://main.test/"]],
    harnessOptions: { interceptNavigations: true },
    transportOptions: { navigationCommitTimeoutMs: 5_000 },
  });
  const { fake, transport, received } = harness;
  const mainSession = [...fake.sessions.keys()][0];

  transport.send({
    id: 90,
    method: "Fetch.enable",
    params: { patterns: [{ urlPattern: "*", requestStage: "Request" }] },
    sessionId: mainSession,
  });
  await waitForMessage(received, (message) => message.id === 90);

  transport.send({
    id: 91,
    method: "Page.navigate",
    params: { frameId: "tab-main", url: "https://main.test/next" },
    sessionId: mainSession,
  });
  const paused = await waitForMessage(
    received,
    (message) => message.method === "Fetch.requestPaused",
  );
  assert.ok(paused, "the gated document request holds the navigation open");

  transport.send({
    id: 92,
    method: "Runtime.evaluate",
    params: { expression: "1 + 1", returnByValue: true },
    sessionId: mainSession,
  });
  const evaluated = await waitForMessage(
    received,
    (message) => message.id === 92,
    1_000,
  );
  assert.ok(
    evaluated,
    "the command is answered while the navigation is still pending",
  );
  assert.equal(evaluated.error, undefined);
  assert.equal(
    received.some((message) => message.id === 91),
    false,
    "the navigation has not committed when the command is answered",
  );
  const evaluateRequest = fake.log.find(
    (request) =>
      request.method === "Runtime.evaluate" &&
      request.params?.expression === "1 + 1",
  );
  assert.equal(
    evaluateRequest?.sessionId,
    mainSession,
    "the command is served by the old native session",
  );

  transport.send({
    id: 93,
    method: "Fetch.continueRequest",
    params: { requestId: paused.params.requestId },
    sessionId: mainSession,
  });
  const navigated = await waitForMessage(
    received,
    (message) => message.id === 91,
    5_000,
  );
  assert.ok(navigated, "the navigation settles once the gate opens");
  assert.equal(
    navigated.error,
    undefined,
    `the navigation must commit, got: ${JSON.stringify(navigated?.error)}`,
  );

  const replacementSession = [...fake.sessions.keys()].at(-1);
  assert.notEqual(replacementSession, mainSession);
  transport.send({
    id: 94,
    method: "Runtime.evaluate",
    params: { expression: "2 + 2", returnByValue: true },
    sessionId: mainSession,
  });
  await waitForMessage(received, (message) => message.id === 94);
  const postSwapRequest = fake.log.find(
    (request) =>
      request.method === "Runtime.evaluate" &&
      request.params?.expression === "2 + 2",
  );
  assert.equal(
    postSwapRequest?.sessionId,
    replacementSession,
    "post-swap commands go to the replacement session",
  );
  await transport.closeAndWait();
});

test("replayable commands during a pending navigation are held and replayed to the replacement session", async () => {
  const harness = await createTaskSpaceTransportHarness({
    tabs: [["tab-main", "https://main.test/"]],
    harnessOptions: { interceptNavigations: true },
    transportOptions: { navigationCommitTimeoutMs: 5_000 },
  });
  const { fake, transport, received } = harness;
  const mainSession = [...fake.sessions.keys()][0];

  transport.send({
    id: 95,
    method: "Fetch.enable",
    params: { patterns: [{ urlPattern: "*", requestStage: "Request" }] },
    sessionId: mainSession,
  });
  await waitForMessage(received, (message) => message.id === 95);

  transport.send({
    id: 96,
    method: "Page.navigate",
    params: { frameId: "tab-main", url: "https://main.test/next" },
    sessionId: mainSession,
  });
  const paused = await waitForMessage(
    received,
    (message) => message.method === "Fetch.requestPaused",
  );
  assert.ok(paused, "the gated document request holds the navigation open");

  transport.send({
    id: 97,
    method: "Network.setExtraHTTPHeaders",
    params: { headers: { "x-mid-transition": "1" } },
    sessionId: mainSession,
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(
    received.find((message) => message.id === 97),
    undefined,
    "the replayable command is held while the transition is pending",
  );
  assert.equal(
    fake.log.some(
      (request) => request.method === "Network.setExtraHTTPHeaders",
    ),
    false,
    "the held command reaches no native session before the swap",
  );

  transport.send({
    id: 98,
    method: "Fetch.continueRequest",
    params: { requestId: paused.params.requestId },
    sessionId: mainSession,
  });
  await waitForMessage(received, (message) => message.id === 96, 5_000);
  const reply = await waitForMessage(received, (message) => message.id === 97);
  assert.ok(reply, "the held command completes after the swap");
  assert.equal(reply.error, undefined);
  const replacementSession = [...fake.sessions.keys()].at(-1);
  assert.notEqual(replacementSession, mainSession);
  const delivered = fake.log.find(
    (request) => request.method === "Network.setExtraHTTPHeaders",
  );
  assert.equal(
    delivered?.sessionId,
    replacementSession,
    "the replayed command reaches the replacement session",
  );
  await transport.closeAndWait();
});

test("commands during a same-target navigation replacement are held until the swap", async () => {
  const harness = await createTaskSpaceTransportHarness({
    tabs: [["tab-main", "https://main.test/"]],
    transportOptions: { navigationCommitTimeoutMs: 5_000 },
  });
  const { fake, transport, received } = harness;
  const mainSession = [...fake.sessions.keys()][0];

  // Model the native tab-reuse branch: createTab hands back the existing
  // target (navigated to the blank staging page) instead of a fresh one.
  fake.runtime.createTab = async (url) => {
    fake.createdUrls.push(url);
    const tab = fake.tabs.get("tab-main");
    tab.url = url;
    tab.frames[0].url = url;
    return { targetId: "tab-main" };
  };
  // Gate the commit: the frame keeps reporting the blank staging URL until
  // the override is cleared, so the transition stays pending.
  fake.frameUrlOverride.set("tab-main", "about:blank");

  transport.send({
    id: 100,
    method: "Page.navigate",
    params: { frameId: "tab-main", url: "https://main.test/next" },
    sessionId: mainSession,
  });
  const detachDeadline = Date.now() + 2_000;
  while (
    !fake.detachedSessions.includes(mainSession) &&
    Date.now() < detachDeadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(
    fake.detachedSessions.includes(mainSession),
    "the reused tab's old session is detached for the replacement attach",
  );

  transport.send({
    id: 101,
    method: "Runtime.evaluate",
    params: { expression: "1 + 1", returnByValue: true },
    sessionId: mainSession,
  });
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(
    received.find((message) => message.id === 101),
    undefined,
    "the command is held: the old session is already detached",
  );
  assert.equal(
    fake.log.some(
      (request) =>
        request.method === "Runtime.evaluate" &&
        request.params?.expression === "1 + 1",
    ),
    false,
    "the held command is never sent to the detached session",
  );

  fake.frameUrlOverride.delete("tab-main");
  const navigated = await waitForMessage(
    received,
    (message) => message.id === 100,
    5_000,
  );
  assert.ok(navigated, "the navigation settles once the commit gate opens");
  assert.equal(
    navigated.error,
    undefined,
    `the navigation must commit, got: ${JSON.stringify(navigated?.error)}`,
  );
  const evaluated = await waitForMessage(
    received,
    (message) => message.id === 101,
  );
  assert.ok(evaluated, "the held command completes after the swap");
  assert.equal(evaluated.error, undefined);
  const replacementSession = [...fake.sessions.keys()].at(-1);
  assert.notEqual(replacementSession, mainSession);
  const delivered = fake.log.find(
    (request) =>
      request.method === "Runtime.evaluate" &&
      request.params?.expression === "1 + 1",
  );
  assert.equal(
    delivered?.sessionId,
    replacementSession,
    "the held command is answered by the replacement session",
  );
  await transport.closeAndWait();
});

test("a new client navigation supersedes the pending one instead of queuing behind it", async () => {
  const harness = await createTaskSpaceTransportHarness({
    tabs: [["tab-main", "https://main.test/"]],
    harnessOptions: { interceptNavigations: true },
    transportOptions: { navigationCommitTimeoutMs: 10_000 },
  });
  const { fake, transport, received } = harness;
  const mainSession = [...fake.sessions.keys()][0];

  transport.send({
    id: 110,
    method: "Fetch.enable",
    params: { patterns: [{ urlPattern: "*", requestStage: "Request" }] },
    sessionId: mainSession,
  });
  await waitForMessage(received, (message) => message.id === 110);

  // Navigation A is gated: its paused document request is never continued,
  // modeling a hung server that would otherwise burn the full commit budget.
  transport.send({
    id: 111,
    method: "Page.navigate",
    params: { frameId: "tab-main", url: "https://main.test/hung" },
    sessionId: mainSession,
  });
  const pausedA = await waitForMessage(
    received,
    (message) => message.method === "Fetch.requestPaused",
  );
  assert.ok(pausedA, "navigation A is gated on its paused document request");

  const startedAt = Date.now();
  transport.send({
    id: 112,
    method: "Page.navigate",
    params: { frameId: "tab-main", url: "https://main.test/recovery" },
    sessionId: mainSession,
  });
  const superseded = await waitForMessage(
    received,
    (message) => message.id === 111,
  );
  assert.match(
    superseded.error?.message || "",
    /superseded by a newer navigation/,
    "the aborted navigation's client message must not dangle",
  );

  const pausedB = await waitForMessage(
    received,
    (message) =>
      message.method === "Fetch.requestPaused" &&
      message.params.requestId !== pausedA.params.requestId,
  );
  assert.ok(pausedB, "navigation B starts its own document request");
  transport.send({
    id: 113,
    method: "Fetch.continueRequest",
    params: { requestId: pausedB.params.requestId },
    sessionId: mainSession,
  });
  const navigated = await waitForMessage(
    received,
    (message) => message.id === 112,
    5_000,
  );
  assert.ok(navigated, "navigation B settles");
  assert.equal(
    navigated.error,
    undefined,
    `navigation B must commit, got: ${JSON.stringify(navigated?.error)}`,
  );
  assert.ok(
    Date.now() - startedAt < 5_000,
    "navigation B must commit far below the pending navigation's commit budget",
  );
  assert.ok(
    fake.closedTargets.includes("tab-1"),
    "the superseded navigation's replacement tab is closed",
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(
    received.filter((message) => message.id === 111).length,
    1,
    "the superseded navigation gets exactly one response",
  );
  await transport.closeAndWait();
});

test("rapid successive navigations supersede each other and the final one wins", async () => {
  const harness = await createTaskSpaceTransportHarness({
    tabs: [["tab-main", "https://main.test/"]],
    harnessOptions: { interceptNavigations: true },
    transportOptions: { navigationCommitTimeoutMs: 10_000 },
  });
  const { fake, transport, received } = harness;
  const mainSession = [...fake.sessions.keys()][0];

  transport.send({
    id: 115,
    method: "Fetch.enable",
    params: { patterns: [{ urlPattern: "*", requestStage: "Request" }] },
    sessionId: mainSession,
  });
  await waitForMessage(received, (message) => message.id === 115);

  transport.send({
    id: 116,
    method: "Page.navigate",
    params: { frameId: "tab-main", url: "https://main.test/a" },
    sessionId: mainSession,
  });
  await waitForMessage(
    received,
    (message) => message.method === "Fetch.requestPaused",
  );
  // B supersedes the in-flight A; C supersedes the still-queued B.
  transport.send({
    id: 117,
    method: "Page.navigate",
    params: { frameId: "tab-main", url: "https://main.test/b" },
    sessionId: mainSession,
  });
  transport.send({
    id: 118,
    method: "Page.navigate",
    params: { frameId: "tab-main", url: "https://main.test/c" },
    sessionId: mainSession,
  });

  const abortedA = await waitForMessage(
    received,
    (message) => message.id === 116,
  );
  assert.match(abortedA.error?.message || "", /superseded by a newer/);
  const abortedB = await waitForMessage(
    received,
    (message) => message.id === 117,
  );
  assert.match(abortedB.error?.message || "", /superseded by a newer/);

  const pausedC = await waitForMessage(
    received,
    (message) =>
      message.method === "Fetch.requestPaused" &&
      message.params.request?.url === "https://main.test/c",
  );
  assert.ok(pausedC, "the final navigation starts its own document request");
  transport.send({
    id: 119,
    method: "Fetch.continueRequest",
    params: { requestId: pausedC.params.requestId },
    sessionId: mainSession,
  });
  const navigated = await waitForMessage(
    received,
    (message) => message.id === 118,
    5_000,
  );
  assert.ok(navigated, "the final navigation settles");
  assert.equal(
    navigated.error,
    undefined,
    `the final navigation must commit, got: ${JSON.stringify(navigated?.error)}`,
  );

  // A's replacement was the first tab the fake minted; B never started, so it
  // created none; C's replacement (the second minted tab) is the only tab
  // left after the swap closed the original.
  assert.ok(
    fake.closedTargets.includes("tab-1"),
    "the aborted navigation's replacement tab is closed",
  );
  assert.ok(
    fake.closedTargets.includes("tab-main"),
    "the original tab is closed by the final swap",
  );
  assert.deepEqual(
    [...fake.tabs.keys()],
    ["tab-2"],
    "no replacement tab leaks from the aborted navigations",
  );
  assert.equal(fake.tabs.get("tab-2").url, "https://main.test/c");
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(
    received.filter((message) => message.id === 116).length,
    1,
    "navigation A gets exactly one response",
  );
  assert.equal(
    received.filter((message) => message.id === 117).length,
    1,
    "navigation B gets exactly one response",
  );
  await transport.closeAndWait();
});

test("a navigation stuck confirming its commit is superseded without waiting out the poll", async () => {
  const harness = await createTaskSpaceTransportHarness({
    tabs: [["tab-main", "https://main.test/"]],
    transportOptions: { navigationCommitTimeoutMs: 10_000 },
  });
  const { fake, transport, received } = harness;
  const mainSession = [...fake.sessions.keys()][0];

  // Gate only navigation A's replacement tab: its frame keeps reporting the
  // blank staging URL, so A hangs in commit confirmation even though the
  // native Page.navigate itself already succeeded.
  const originalCreateTab = fake.runtime.createTab;
  let gatedTargetId;
  fake.runtime.createTab = async (url) => {
    fake.runtime.createTab = originalCreateTab;
    const created = await originalCreateTab(url);
    gatedTargetId = created.targetId;
    fake.frameUrlOverride.set(created.targetId, "about:blank");
    return created;
  };

  transport.send({
    id: 120,
    method: "Page.navigate",
    params: { frameId: "tab-main", url: "https://main.test/stuck" },
    sessionId: mainSession,
  });
  // Page.getFrameTree traffic is the commit-confirmation poll: nothing else
  // in this harness flow issues it, so its appearance proves A is polling.
  const pollDeadline = Date.now() + 2_000;
  while (
    !fake.log.some((request) => request.method === "Page.getFrameTree") &&
    Date.now() < pollDeadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(
    fake.log.some((request) => request.method === "Page.getFrameTree"),
    "navigation A reaches its commit-confirmation poll",
  );

  const startedAt = Date.now();
  transport.send({
    id: 121,
    method: "Page.navigate",
    params: { frameId: "tab-main", url: "https://main.test/recovery" },
    sessionId: mainSession,
  });
  const superseded = await waitForMessage(
    received,
    (message) => message.id === 120,
  );
  assert.match(
    superseded.error?.message || "",
    /superseded by a newer navigation/,
    "the poll-gated navigation resolves with the superseded error",
  );
  const navigated = await waitForMessage(
    received,
    (message) => message.id === 121,
    5_000,
  );
  assert.ok(navigated, "the superseding navigation settles");
  assert.equal(
    navigated.error,
    undefined,
    `the superseding navigation must commit, got: ${JSON.stringify(navigated?.error)}`,
  );
  assert.ok(
    Date.now() - startedAt < 5_000,
    "the superseding navigation must not wait out the aborted commit poll",
  );
  assert.ok(
    fake.closedTargets.includes(gatedTargetId),
    "the aborted navigation's replacement tab is closed",
  );
  await transport.closeAndWait();
});

test("closing the page while its navigation awaits commit fails the navigation and leaks no tab", async () => {
  const harness = await createTaskSpaceTransportHarness({
    tabs: [["tab-main", "https://main.test/"]],
    transportOptions: { navigationCommitTimeoutMs: 10_000 },
  });
  const { fake, transport, received } = harness;
  const mainSession = [...fake.sessions.keys()][0];

  // Gate the replacement tab in commit confirmation: its frame keeps
  // reporting the blank staging URL, so the navigation sits in its poll
  // while the close arrives.
  const originalCreateTab = fake.runtime.createTab;
  let replacementTargetId;
  fake.runtime.createTab = async (url) => {
    fake.runtime.createTab = originalCreateTab;
    const created = await originalCreateTab(url);
    replacementTargetId = created.targetId;
    fake.frameUrlOverride.set(created.targetId, "about:blank");
    return created;
  };

  transport.send({
    id: 150,
    method: "Page.navigate",
    params: { frameId: "tab-main", url: "https://main.test/late" },
    sessionId: mainSession,
  });
  const pollDeadline = Date.now() + 2_000;
  while (
    !fake.log.some((request) => request.method === "Page.getFrameTree") &&
    Date.now() < pollDeadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(
    fake.log.some((request) => request.method === "Page.getFrameTree"),
    "the navigation reaches its commit-confirmation poll",
  );

  // What page.close() sends: close the client target mid-navigation.
  transport.send({
    id: 151,
    method: "Target.closeTarget",
    params: { targetId: "tab-main" },
  });
  const closed = await waitForMessage(
    received,
    (message) => message.id === 151,
  );
  assert.equal(closed?.result?.success, true, "the close itself succeeds");
  const ghostStart = received.length;

  // Release the commit gate only after the close settled: nothing observed
  // from here on may resurrect the removed route.
  fake.frameUrlOverride.delete(replacementTargetId);

  const navigated = await waitForMessage(
    received,
    (message) => message.id === 150,
    5_000,
  );
  assert.ok(navigated, "the pending navigation settles");
  assert.ok(
    navigated.error,
    `the navigation must fail once its page was closed, got: ${JSON.stringify(navigated?.result)}`,
  );

  // The replacement tab never became a live route target; it must be closed
  // natively instead of lingering in the task space.
  await waitForCondition(
    () => fake.closedTargets.includes(replacementTargetId),
    2_000,
  );
  assert.ok(
    fake.closedTargets.includes(replacementTargetId),
    "the replacement tab is closed, not leaked",
  );
  assert.equal(fake.tabs.size, 0, "no native tab survives the close");

  // The closed client session must stay silent: no navigation events may be
  // emitted for a page the client already closed.
  await new Promise((resolve) => setTimeout(resolve, 200));
  const ghostEvents = received
    .slice(ghostStart)
    .filter(
      (message) =>
        message.sessionId === mainSession &&
        (message.method === "Page.frameNavigated" ||
          message.method === "Page.lifecycleEvent" ||
          message.method === "Network.requestWillBeSent"),
    );
  assert.deepEqual(
    ghostEvents,
    [],
    "no events reach the closed client session",
  );
  await transport.closeAndWait();
});

async function assertInPlaceNavigation(initialUrl) {
  const harness = await createTaskSpaceTransportHarness({
    tabs: [["tab-main", initialUrl]],
  });
  const { fake, transport, received } = harness;
  const mainSession = [...fake.sessions.keys()][0];

  transport.send({
    id: 130,
    method: "Page.navigate",
    params: { frameId: "tab-main", url: "https://main.test/landing" },
    sessionId: mainSession,
  });
  const navigated = await waitForMessage(
    received,
    (message) => message.id === 130,
  );
  assert.ok(navigated, "the client navigation settles");
  assert.equal(
    navigated.error,
    undefined,
    `the navigation must commit, got: ${JSON.stringify(navigated?.error)}`,
  );
  assert.equal(navigated.result.frameId, "tab-main");
  assert.equal(typeof navigated.result.loaderId, "string");
  assert.equal(navigated.sessionId, mainSession);

  assert.deepEqual(fake.createdUrls, [], "no replacement tab is created");
  assert.deepEqual(fake.closedTargets, [], "no tab is closed");
  const nativeNavigate = fake.log.find(
    (request) => request.method === "Page.navigate",
  );
  assert.equal(
    nativeNavigate?.sessionId,
    mainSession,
    "the native navigate runs on the route's existing session",
  );
  assert.equal(nativeNavigate?.params.url, "https://main.test/landing");
  assert.deepEqual(
    [...fake.tabs.keys()],
    ["tab-main"],
    "the route keeps its native target",
  );
  assert.equal(fake.tabs.get("tab-main").url, "https://main.test/landing");
  assert.equal(
    fake.log.filter((request) => request.method === "Target.attachToTarget")
      .length,
    1,
    "no replacement session is attached",
  );
  const frameNavigated = await waitForMessage(
    received,
    (message) =>
      message.method === "Page.frameNavigated" &&
      message.params?.frame?.url === "https://main.test/landing",
  );
  assert.ok(frameNavigated, "the real frameNavigated reaches the client");
  assert.equal(frameNavigated.sessionId, mainSession);
  await transport.closeAndWait();
}

test("a navigation from a blank page navigates in place", async () => {
  await assertInPlaceNavigation("about:blank");
});

test("an in-place navigation from chrome://newtab", async () => {
  await assertInPlaceNavigation("chrome://newtab/");
});

test("in-place navigation propagates errorText", async () => {
  const harness = await createTaskSpaceTransportHarness({
    tabs: [["tab-main", "about:blank"]],
  });
  const { fake, transport, received } = harness;
  const mainSession = [...fake.sessions.keys()][0];
  fake.navigationErrors.set(
    "https://nowhere.invalid/",
    "net::ERR_NAME_NOT_RESOLVED",
  );

  transport.send({
    id: 132,
    method: "Page.navigate",
    params: { frameId: "tab-main", url: "https://nowhere.invalid/" },
    sessionId: mainSession,
  });
  const failed = await waitForMessage(
    received,
    (message) => message.id === 132,
  );
  assert.ok(failed, "the client navigation settles");
  assert.match(failed.error?.message || "", /net::ERR_NAME_NOT_RESOLVED/);
  assert.deepEqual(fake.createdUrls, [], "no replacement tab is created");
  assert.equal(fake.tabs.get("tab-main").url, "about:blank");

  transport.send({
    id: 133,
    method: "Runtime.evaluate",
    params: { expression: "1 + 1", returnByValue: true },
    sessionId: mainSession,
  });
  const evaluated = await waitForMessage(
    received,
    (message) => message.id === 133,
  );
  assert.ok(evaluated, "the page still answers commands");
  assert.equal(evaluated.error, undefined);
  await transport.closeAndWait();
});

test("in-place navigation reports a download as an aborted navigation", async () => {
  const harness = await createTaskSpaceTransportHarness({
    tabs: [["tab-main", "about:blank"]],
    transportOptions: { navigationCommitTimeoutMs: 10_000 },
  });
  const { fake, transport, received } = harness;
  const mainSession = [...fake.sessions.keys()][0];
  fake.downloadUrls.add("https://main.test/report.xlsx");

  const startedAt = Date.now();
  transport.send({
    id: 134,
    method: "Page.navigate",
    params: { frameId: "tab-main", url: "https://main.test/report.xlsx" },
    sessionId: mainSession,
  });
  const failed = await waitForMessage(
    received,
    (message) => message.id === 134,
  );
  assert.ok(failed, "the client navigation settles");
  assert.match(
    failed.error?.message || "",
    /net::ERR_ABORTED; maybe frame was detached\?/,
  );
  assert.ok(
    Date.now() - startedAt < 5_000,
    "a download must fail well before the commit timeout",
  );
  assert.deepEqual(fake.createdUrls, [], "no replacement tab is created");
  await transport.closeAndWait();
});

test("commands during an in-place navigation are not held", async () => {
  const harness = await createTaskSpaceTransportHarness({
    tabs: [["tab-main", "about:blank"]],
    harnessOptions: { interceptNavigations: true },
    transportOptions: { navigationCommitTimeoutMs: 5_000 },
  });
  const { fake, transport, received } = harness;
  const mainSession = [...fake.sessions.keys()][0];

  transport.send({
    id: 135,
    method: "Fetch.enable",
    params: { patterns: [{ urlPattern: "*", requestStage: "Request" }] },
    sessionId: mainSession,
  });
  await waitForMessage(received, (message) => message.id === 135);

  transport.send({
    id: 136,
    method: "Page.navigate",
    params: { frameId: "tab-main", url: "https://main.test/gated" },
    sessionId: mainSession,
  });
  const paused = await waitForMessage(
    received,
    (message) => message.method === "Fetch.requestPaused",
  );
  assert.ok(paused, "the gated document request holds the navigation open");
  assert.equal(paused.sessionId, mainSession);

  transport.send({
    id: 137,
    method: "Runtime.evaluate",
    params: { expression: "1 + 1", returnByValue: true },
    sessionId: mainSession,
  });
  const evaluated = await waitForMessage(
    received,
    (message) => message.id === 137,
    1_000,
  );
  assert.ok(
    evaluated,
    "the command is answered while the in-place navigation is pending",
  );
  assert.equal(evaluated.error, undefined);
  assert.equal(
    received.some((message) => message.id === 136),
    false,
    "the navigation has not committed when the command is answered",
  );
  const evaluateRequest = fake.log.find(
    (request) =>
      request.method === "Runtime.evaluate" &&
      request.params?.expression === "1 + 1",
  );
  assert.equal(
    evaluateRequest?.sessionId,
    mainSession,
    "the command is served by the route's own session",
  );

  transport.send({
    id: 138,
    method: "Fetch.continueRequest",
    params: { requestId: paused.params.requestId },
    sessionId: mainSession,
  });
  const navigated = await waitForMessage(
    received,
    (message) => message.id === 136,
    5_000,
  );
  assert.ok(navigated, "the navigation settles once the gate opens");
  assert.equal(
    navigated.error,
    undefined,
    `the navigation must commit, got: ${JSON.stringify(navigated?.error)}`,
  );
  assert.equal(navigated.result.frameId, "tab-main");
  assert.deepEqual(fake.createdUrls, [], "no replacement tab is created");
  await transport.closeAndWait();
});
