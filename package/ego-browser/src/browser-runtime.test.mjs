import test from "node:test";
import assert from "node:assert/strict";

import {
  browserCdp,
  drainBrowserEvents,
  drainPageEvents,
  invalidateSession,
  prepareFileChooser,
} from "../dist/src/browser-runtime.js";

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
      runtime.onCDPMessage(
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
