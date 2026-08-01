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

test("the Ego Playwright transport supplies the stateless Browser commands required during connection", async () => {
  assert.equal(typeof egoTransport.createEgoCdpTransport, "function");

  const sent = [];
  const runtime = {
    sendCDPMessage(payload) {
      sent.push(JSON.parse(payload));
    },
  };
  const transport = egoTransport.createEgoCdpTransport(runtime);
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
      frameId: "client-frame",
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
        frameId: "client-frame",
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
        message.params.frame.id === "client-frame",
    ),
  );
  assert.ok(
    received.some(
      (message) =>
        message.method === "Page.lifecycleEvent" &&
        message.params.name === "load" &&
        message.params.frameId === "client-frame",
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

test("the Ego Playwright transport completes Page.navigate when the replacement document commits", async () => {
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
                ? "https://example.test/slow"
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
                  : "client-frame",
              loaderId:
                request.sessionId === "replacement-session"
                  ? "replacement-loader"
                  : "client-loader",
              url:
                request.sessionId === "replacement-session"
                  ? "https://example.test/slow"
                  : "about:blank",
            },
          },
        };
      } else if (request.method === "Runtime.evaluate") {
        result = { result: { type: "string", value: "loading" } };
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
      frameId: "client-frame",
      url: "https://example.test/slow",
    },
    sessionId: "client-session",
  });
  const deadline = Date.now() + 150;
  while (
    !received.some((message) => message.id === 36) &&
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
        frameId: "client-frame",
        loaderId: "replacement-loader",
      },
      sessionId: "client-session",
    },
  );
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
      frameId: "client-frame",
      url: "https://example.test/after",
    },
    sessionId: "client-session",
  });
  for (let index = 0; index < 10; index += 1) await waitForImmediate();

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
