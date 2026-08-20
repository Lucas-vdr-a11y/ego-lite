import test from "node:test";
import assert from "node:assert/strict";

import {
  browserCdp,
  drainBrowserEvents,
  drainPageEvents,
  ensureFrameSessions,
  invalidateSession,
  prepareFileChooser,
  subscribeBrowserEvents,
} from "../dist/src/browser-runtime.js";

test("frame sessions follow one Page target and are invalidated with it", async () => {
  const previous = globalThis.ego;
  const attachCounts = new Map();
  const runtime = {
    sendCDPMessage(payload) {
      const request = JSON.parse(payload);
      let result = {};
      if (request.method === "Target.getTargets") {
        result = {
          targetInfos: [
            { targetId: "page-main", type: "page" },
            {
              targetId: "frame-child",
              type: "iframe",
              parentId: "page-main",
            },
            {
              targetId: "frame-grandchild",
              type: "iframe",
              parentId: "frame-child",
            },
            {
              targetId: "foreign-frame",
              type: "iframe",
              parentId: "foreign-page",
            },
          ],
        };
      } else if (request.method === "Page.getFrameTree") {
        result = {
          frameTree: {
            frame: { id: "page-main" },
            childFrames: [{ frame: { id: "same-process-frame" } }],
          },
        };
      } else if (request.method === "Target.attachToTarget") {
        const targetId = request.params.targetId;
        attachCounts.set(targetId, (attachCounts.get(targetId) || 0) + 1);
        result = { sessionId: `session:${targetId}` };
      }
      queueMicrotask(() => {
        runtime.onCDPMessage(JSON.stringify({ id: request.id, result }));
      });
    },
  };
  globalThis.ego = runtime;

  try {
    const first = await ensureFrameSessions("page-main");
    assert.deepEqual(
      [...first],
      [
        ["same-process-frame", "session:page-main"],
        ["frame-child", "session:frame-child"],
        ["frame-grandchild", "session:frame-grandchild"],
      ],
    );
    assert.equal(attachCounts.has("foreign-frame"), false);

    invalidateSession("page-main");
    const second = await ensureFrameSessions("page-main");
    assert.deepEqual([...second], [...first]);
    assert.equal(attachCounts.get("frame-child"), 2);
    assert.equal(attachCounts.get("frame-grandchild"), 2);
  } finally {
    invalidateSession();
    if (previous === undefined) delete globalThis.ego;
    else globalThis.ego = previous;
  }
});

// Gap A: ensureSession() calls the raw listTabs binding to attach a session.
// When the task is blocked it returns { error, error_code }; the result must
// surface the ego-browser-owned wording for the code (not the native error
// message) and carry error_code, instead of throwing the bare native error message.
test("browserCdp surfaces the owned message and error_code when ensureSession is blocked", async () => {
  globalThis.ego = {
    async listTabs() {
      return {
        error: "Task space 10 is not assigned to an agent.",
        error_code: "EGO_TASK_SPACE_INACTIVE",
      };
    },
  };
  try {
    await assert.rejects(
      () => browserCdp("Runtime.evaluate", {}, undefined, 1000),
      (err) => {
        assert.equal(err.error_code, "EGO_TASK_SPACE_INACTIVE");
        // Owned guidance block, not the native "Task space 10 ..." text.
        assert.match(err.message, /claimTaskSpace\(spaceId\)/);
        assert.doesNotMatch(err.message, /\b10\b/);
        return true;
      },
    );
  } finally {
    delete globalThis.ego;
  }
});

// Gap B: a raw CDP send that fails locally is reported through
// ego.onSendCDPMessageError, not as a CDP response. Without wiring the request
// would hang until the 15s timeout; wired, it rejects immediately with the
// owned message and error_code.
test("browserCdp rejects the in-flight request via onSendCDPMessageError", async () => {
  globalThis.ego = {
    sendCDPMessage() {
      // The binding delivers the failure asynchronously through the event loop.
      queueMicrotask(() =>
        globalThis.ego.onSendCDPMessageError(
          "native reconstructed text",
          "EGO_TASK_SPACE_INACTIVE",
        ),
      );
    },
  };
  try {
    await assert.rejects(
      // Browser-level method skips ensureSession; short timeout bounds a regression.
      () => browserCdp("Browser.getVersion", {}, undefined, 1000),
      (err) => {
        assert.equal(err.error_code, "EGO_TASK_SPACE_INACTIVE");
        // Owned guidance block, not the native reconstructed text.
        assert.match(err.message, /claimTaskSpace\(spaceId\)/);
        assert.doesNotMatch(err.message, /native reconstructed text/);
        return true;
      },
    );
  } finally {
    delete globalThis.ego;
  }
});

test("a non-user-control CDP failure does not run the permission probe", async () => {
  const previous = globalThis.ego;
  let probes = 0;
  const runtime = {
    async setAgentTaskState() {
      probes += 1;
      return undefined;
    },
    sendCDPMessage() {
      queueMicrotask(() => {
        runtime.onSendCDPMessageError(
          "The task space is inactive.",
          "EGO_TASK_SPACE_INACTIVE",
        );
      });
    },
  };
  globalThis.ego = runtime;

  try {
    await assert.rejects(
      () => browserCdp("Browser.getVersion", {}, undefined, 1000),
      (error) => {
        assert.equal(error.error_code, "EGO_TASK_SPACE_INACTIVE");
        assert.match(error.message, /no longer assigned to the agent/);
        return true;
      },
    );
    assert.equal(probes, 0);
  } finally {
    invalidateSession();
    if (previous === undefined) delete globalThis.ego;
    else globalThis.ego = previous;
  }
});

test("a user-control CDP failure probes the native permission reason before rejecting", async () => {
  const previous = globalThis.ego;
  let probes = 0;
  const runtime = {
    async setAgentTaskState() {
      probes += 1;
      return {
        error: "microphone",
        error_code: "EGO_TASK_SPACE_USER_IN_CONTROL",
      };
    },
    sendCDPMessage() {
      queueMicrotask(() => {
        runtime.onSendCDPMessageError(
          "The task is under user control.",
          "EGO_TASK_SPACE_USER_IN_CONTROL",
        );
      });
    },
  };
  globalThis.ego = runtime;

  try {
    await assert.rejects(
      () => browserCdp("Browser.getVersion", {}, undefined, 1000),
      (error) => {
        assert.equal(error.error_code, "EGO_TASK_SPACE_USER_IN_CONTROL");
        assert.match(error.message, /microphone access/);
        return true;
      },
    );
    assert.equal(probes, 1);
  } finally {
    invalidateSession();
    if (previous === undefined) delete globalThis.ego;
    else globalThis.ego = previous;
  }
});

test("concurrent user-control CDP failures share one permission probe", async () => {
  const previous = globalThis.ego;
  let probes = 0;
  let finishProbe;
  const runtime = {
    setAgentTaskState() {
      probes += 1;
      return new Promise((resolve) => {
        finishProbe = resolve;
      });
    },
    sendCDPMessage() {
      queueMicrotask(() => {
        runtime.onSendCDPMessageError(
          "The task is under user control.",
          "EGO_TASK_SPACE_USER_IN_CONTROL",
        );
      });
    },
  };
  globalThis.ego = runtime;

  try {
    const requests = [
      browserCdp("Browser.getVersion", {}, undefined, 1000),
      browserCdp("Browser.getBrowserCommandLine", {}, undefined, 1000),
    ];
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(probes, 1);
    finishProbe({
      error: "camera",
      error_code: "EGO_TASK_SPACE_USER_IN_CONTROL",
    });
    const results = await Promise.allSettled(requests);
    assert.deepEqual(
      results.map((result) => result.status),
      ["rejected", "rejected"],
    );
    for (const result of results) {
      assert.match(result.reason.message, /camera access/);
    }
  } finally {
    invalidateSession();
    if (previous === undefined) delete globalThis.ego;
    else globalThis.ego = previous;
  }
});

test("a failed permission probe falls back to generic user-control guidance", async () => {
  const previous = globalThis.ego;
  const runtime = {
    async setAgentTaskState() {
      throw new Error("probe transport failed");
    },
    sendCDPMessage() {
      queueMicrotask(() => {
        runtime.onSendCDPMessageError(
          "The task is under user control.",
          "EGO_TASK_SPACE_USER_IN_CONTROL",
        );
      });
    },
  };
  globalThis.ego = runtime;

  try {
    await assert.rejects(
      () => browserCdp("Browser.getVersion", {}, undefined, 1000),
      (error) => {
        assert.match(error.message, /The user has taken control/);
        assert.doesNotMatch(error.message, /probe transport failed/);
        return true;
      },
    );
  } finally {
    invalidateSession();
    if (previous === undefined) delete globalThis.ego;
    else globalThis.ego = previous;
  }
});

test("a recovered probe allows a later takeover to be detected", async () => {
  const previous = globalThis.ego;
  let probes = 0;
  const runtime = {
    async setAgentTaskState() {
      probes += 1;
      if (probes === 1) return undefined;
      return {
        error: "location",
        error_code: "EGO_TASK_SPACE_USER_IN_CONTROL",
      };
    },
    sendCDPMessage() {
      queueMicrotask(() => {
        runtime.onSendCDPMessageError(
          "The task is under user control.",
          "EGO_TASK_SPACE_USER_IN_CONTROL",
        );
      });
    },
  };
  globalThis.ego = runtime;

  try {
    await assert.rejects(
      () => browserCdp("Browser.getVersion", {}, undefined, 1000),
      /The task is under user control/,
    );
    await assert.rejects(
      () => browserCdp("Browser.getVersion", {}, undefined, 1000),
      /location access/,
    );
    assert.equal(probes, 2);
  } finally {
    invalidateSession();
    if (previous === undefined) delete globalThis.ego;
    else globalThis.ego = previous;
  }
});

test("CDP events are drained only by the target session that received them", async () => {
  const previous = globalThis.ego;
  let nextSession = 1;
  const runtime = {
    sendCDPMessage(payload) {
      const request = JSON.parse(payload);
      const result =
        request.method === "Target.attachToTarget"
          ? { sessionId: `session-${nextSession++}` }
          : {};
      queueMicrotask(() => {
        runtime.onCDPMessage(JSON.stringify({ id: request.id, result }));
      });
    },
    emit(sessionId, method, params = {}) {
      runtime.onCDPMessage(JSON.stringify({ sessionId, method, params }));
    },
  };
  globalThis.ego = runtime;

  try {
    const attachedA = await browserCdp("Target.attachToTarget", {
      targetId: "target-a",
      flatten: true,
    });
    const attachedB = await browserCdp("Target.attachToTarget", {
      targetId: "target-b",
      flatten: true,
    });
    const sessionA = attachedA.result.sessionId;
    const sessionB = attachedB.result.sessionId;

    runtime.emit(sessionA, "Network.requestWillBeSent", {
      requestId: "request-a",
    });

    assert.deepEqual(
      drainBrowserEvents(sessionB),
      [],
      "target B must not consume target A events",
    );
    assert.deepEqual(
      drainBrowserEvents(sessionA).map((event) => event.params.requestId),
      ["request-a"],
      "target A retains its own event queue",
    );
  } finally {
    if (previous === undefined) {
      delete globalThis.ego;
    } else {
      globalThis.ego = previous;
    }
  }
});

test("a JavaScript dialog interrupts the blocked Page input command", async () => {
  const previous = globalThis.ego;
  let sessionId;
  let pendingDisableRequestId;
  const runtime = {
    sendCDPMessage(payload) {
      const request = JSON.parse(payload);
      if (request.method === "Target.attachToTarget") {
        sessionId = "session-dialog";
        queueMicrotask(() => {
          runtime.onCDPMessage(
            JSON.stringify({ id: request.id, result: { sessionId } }),
          );
        });
        return;
      }
      if (request.method === "Page.enable") {
        queueMicrotask(() => {
          runtime.onCDPMessage(JSON.stringify({ id: request.id, result: {} }));
        });
        return;
      }
      if (request.method === "Page.setInterceptFileChooserDialog") {
        if (request.params.enabled) {
          queueMicrotask(() => {
            runtime.onCDPMessage(
              JSON.stringify({ id: request.id, result: {} }),
            );
          });
        } else {
          pendingDisableRequestId = request.id;
        }
        return;
      }
      if (request.method === "Input.dispatchMouseEvent") {
        // Chromium keeps this request pending until the modal dialog closes.
        queueMicrotask(() => {
          runtime.onCDPMessage(
            JSON.stringify({
              sessionId,
              method: "Page.javascriptDialogOpening",
              params: {
                type: "alert",
                message: "Confirm action",
                url: "https://example.test/dialog",
              },
            }),
          );
        });
      }
    },
  };
  globalThis.ego = runtime;

  try {
    const attached = await browserCdp("Target.attachToTarget", {
      targetId: "target-dialog",
      flatten: true,
    });
    await browserCdp("Page.enable", {}, attached.result.sessionId);
    const fileChooser = prepareFileChooser(attached.result.sessionId, {
      timeoutMs: 1_000,
      cancel: true,
    });
    await fileChooser.ready;

    await assert.rejects(
      () =>
        browserCdp(
          "Input.dispatchMouseEvent",
          { type: "mouseReleased", x: 10, y: 10 },
          attached.result.sessionId,
          100,
        ),
      (error) => {
        assert.equal(error.code, "EGO_PAGE_DIALOG_OPENED");
        assert.deepEqual(error.dialog, {
          type: "alert",
          message: "Confirm action",
          url: "https://example.test/dialog",
        });
        return true;
      },
    );

    await assert.rejects(
      () =>
        browserCdp(
          "Runtime.releaseObject",
          { objectId: "element-1" },
          attached.result.sessionId,
          100,
        ),
      (error) => {
        assert.equal(error.code, "EGO_PAGE_DIALOG_OPENED");
        assert.equal(error.method, "Runtime.releaseObject");
        return true;
      },
    );

    const disposeStartedAt = Date.now();
    setTimeout(() => {
      runtime.onCDPMessage?.(
        JSON.stringify({ id: pendingDisableRequestId, result: {} }),
      );
    }, 60);
    await fileChooser.dispose();
    assert(
      Date.now() - disposeStartedAt < 40,
      "dialog handling must not wait for file chooser cleanup",
    );
  } finally {
    invalidateSession();
    if (previous === undefined) {
      delete globalThis.ego;
    } else {
      globalThis.ego = previous;
    }
  }
});

test("page event drains exclude unscoped browser events", async () => {
  const previous = globalThis.ego;
  const runtime = {
    sendCDPMessage(payload) {
      const request = JSON.parse(payload);
      const result =
        request.method === "Target.attachToTarget"
          ? { sessionId: "session-page" }
          : {};
      queueMicrotask(() => {
        runtime.onCDPMessage(JSON.stringify({ id: request.id, result }));
      });
    },
    emit(event) {
      runtime.onCDPMessage(JSON.stringify(event));
    },
  };
  globalThis.ego = runtime;

  try {
    const attached = await browserCdp("Target.attachToTarget", {
      targetId: "target-page",
      flatten: true,
    });
    const sessionId = attached.result.sessionId;
    runtime.emit({ method: "Target.targetCreated", params: { targetId: "x" } });
    runtime.emit({
      sessionId,
      method: "Runtime.consoleAPICalled",
      params: { value: "page" },
    });

    assert.deepEqual(
      drainPageEvents(sessionId).map((event) => event.method),
      ["Runtime.consoleAPICalled"],
    );
    assert.deepEqual(
      drainBrowserEvents(sessionId).map((event) => event.method),
      ["Target.targetCreated"],
      "legacy drain still exposes unscoped browser events",
    );
  } finally {
    if (previous === undefined) delete globalThis.ego;
    else globalThis.ego = previous;
  }
});

test("browser event subscribers are isolated and can unsubscribe", async () => {
  const previous = globalThis.ego;
  const originalConsoleError = console.error;
  const received = [];
  const reported = [];
  const runtime = {
    sendCDPMessage(payload) {
      const request = JSON.parse(payload);
      queueMicrotask(() => {
        runtime.onCDPMessage(JSON.stringify({ id: request.id, result: {} }));
      });
    },
    emit(event) {
      runtime.onCDPMessage(JSON.stringify(event));
    },
  };
  globalThis.ego = runtime;
  console.error = (...args) => reported.push(args);

  const unsubscribeThrowing = subscribeBrowserEvents(() => {
    throw new Error("subscriber failed");
  });
  const unsubscribe = subscribeBrowserEvents((event) => received.push(event));
  try {
    await browserCdp("Target.setDiscoverTargets", { discover: true });
    runtime.emit({
      method: "Target.targetCreated",
      params: { targetInfo: { targetId: "popup-1", type: "page" } },
    });
    unsubscribe();
    runtime.emit({
      method: "Target.targetCreated",
      params: { targetInfo: { targetId: "popup-2", type: "page" } },
    });

    assert.deepEqual(
      received.map((event) => event.params.targetInfo.targetId),
      ["popup-1"],
    );
    assert.equal(reported.length, 2, "each throwing callback is contained");
  } finally {
    unsubscribe();
    unsubscribeThrowing();
    console.error = originalConsoleError;
    if (previous === undefined) delete globalThis.ego;
    else globalThis.ego = previous;
  }
});

test("a native CDP callback contains internal handler failures", async () => {
  const previous = globalThis.ego;
  const originalConsoleError = console.error;
  const reported = [];
  const runtime = {
    sendCDPMessage(payload) {
      const request = JSON.parse(payload);
      const result =
        request.method === "Target.attachToTarget"
          ? { sessionId: "session-callback-guard" }
          : {};
      queueMicrotask(() => {
        runtime.onCDPMessage(JSON.stringify({ id: request.id, result }));
      });
    },
  };
  globalThis.ego = runtime;
  console.error = (...args) => reported.push(args);
  let interception;

  try {
    const attached = await browserCdp("Target.attachToTarget", {
      targetId: "target-callback-guard",
      flatten: true,
    });
    const sessionId = attached.result.sessionId;
    interception = prepareFileChooser(sessionId, {
      timeoutMs: 1_000,
      cancel: false,
    });
    await interception.ready;
    interception.resolve = () => {
      throw new Error("file chooser handler failed");
    };

    assert.doesNotThrow(() => {
      runtime.onCDPMessage(
        JSON.stringify({
          sessionId,
          method: "Page.fileChooserOpened",
          params: { backendNodeId: 42, mode: "selectSingle" },
        }),
      );
    });
    assert.equal(reported.length, 1);
    assert.match(String(reported[0][0]), /onCDPMessage/);

    const response = await browserCdp(
      "Runtime.evaluate",
      { expression: "1" },
      sessionId,
      1_000,
    );
    assert.deepEqual(response.result, {});
  } finally {
    console.error = originalConsoleError;
    await interception?.dispose();
    invalidateSession();
    if (previous === undefined) delete globalThis.ego;
    else globalThis.ego = previous;
  }
});

test("runtime callbacks can be released without deleting a foreign replacement", async () => {
  const previous = globalThis.ego;
  const runtimeModule = await import("../dist/src/browser-runtime.js");
  const runtime = {
    sendCDPMessage(payload) {
      const request = JSON.parse(payload);
      queueMicrotask(() => {
        runtime.onCDPMessage(
          JSON.stringify({ id: request.id, result: { ok: true } }),
        );
      });
    },
  };
  globalThis.ego = runtime;

  try {
    assert.equal(
      typeof runtimeModule.releaseRuntimeCallbacks,
      "function",
      "the SDK lifecycle needs an explicit callback release hook",
    );
    await browserCdp("Target.getTargets", {}, undefined, 1_000);
    assert.equal(typeof runtime.onCDPMessage, "function");
    assert.equal(typeof runtime.onSendCDPMessageError, "function");

    runtimeModule.releaseRuntimeCallbacks(runtime);
    assert.equal(runtime.onCDPMessage, undefined);
    assert.equal(runtime.onSendCDPMessageError, undefined);

    await browserCdp("Target.getTargets", {}, undefined, 1_000);
    const foreignMessage = () => {};
    const foreignError = () => {};
    runtime.onCDPMessage = foreignMessage;
    runtime.onSendCDPMessageError = foreignError;
    runtimeModule.releaseRuntimeCallbacks(runtime);
    assert.equal(runtime.onCDPMessage, foreignMessage);
    assert.equal(runtime.onSendCDPMessageError, foreignError);
  } finally {
    invalidateSession();
    if (previous === undefined) delete globalThis.ego;
    else globalThis.ego = previous;
  }
});

test("file chooser interception suppresses the native picker and returns its input", async () => {
  const previous = globalThis.ego;
  const calls = [];
  const runtime = {
    sendCDPMessage(payload) {
      const request = JSON.parse(payload);
      calls.push(request);
      const result =
        request.method === "Target.attachToTarget"
          ? { sessionId: "session-upload" }
          : {};
      queueMicrotask(() => {
        runtime.onCDPMessage(JSON.stringify({ id: request.id, result }));
      });
    },
    emit(event) {
      runtime.onCDPMessage(JSON.stringify(event));
    },
  };
  globalThis.ego = runtime;

  try {
    const attached = await browserCdp("Target.attachToTarget", {
      targetId: "target-upload",
      flatten: true,
    });
    const sessionId = attached.result.sessionId;
    const interception = prepareFileChooser(sessionId, {
      timeoutMs: 1_000,
      cancel: true,
    });
    await interception.ready;

    runtime.emit({
      sessionId,
      method: "Page.fileChooserOpened",
      params: {
        backendNodeId: 42,
        frameId: "frame-upload",
        mode: "selectMultiple",
      },
    });
    assert.equal((await interception.event).backendNodeId, 42);
    await interception.dispose();

    assert(
      calls.some(
        (call) =>
          call.method === "Page.setInterceptFileChooserDialog" &&
          call.params.enabled === true,
      ),
    );
    assert(
      calls.some(
        (call) =>
          call.method === "DOM.setFileInputFiles" &&
          call.params.backendNodeId === 42 &&
          call.params.files.length === 0,
      ),
      "the safety interceptor cancels the chooser with an empty file list",
    );
    assert(
      calls.some(
        (call) =>
          call.method === "Page.setInterceptFileChooserDialog" &&
          call.params.enabled === false,
      ),
    );
  } finally {
    if (previous === undefined) delete globalThis.ego;
    else globalThis.ego = previous;
  }
});
