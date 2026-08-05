import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate as waitForImmediate } from "node:timers/promises";

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
      if (request.method === "Page.navigate") return;

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
                : "chrome://newtab/",
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
              url: beforeReplacementCommit
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

  assert.deepEqual(createdUrls, ["https://example.test/after"]);
  assert.equal(
    sent.some((request) => request.method === "Page.navigate"),
    false,
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
            url:
              request.params.targetId === "replacement-target"
                ? "https://example.test/after"
                : "about:blank",
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
            url:
              request.params.targetId === "replacement-target"
                ? "https://example.test/redirect-target"
                : "about:blank",
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

async function createTaskSpaceTransportHarness({ tabs }) {
  const { FakeNativeBrowser } = await import("./fake-native-harness.mjs");
  const fake = new FakeNativeBrowser();
  for (const [targetId, url] of tabs) fake.addTab(targetId, url);
  const received = [];
  const pendingWork = [];
  const transport = egoTransport.createEgoCdpTransport(fake.runtime, {
    targetIds: tabs.map(([targetId]) => targetId),
    onPendingWorkChange: (count) => pendingWork.push(count),
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
