import test from "node:test";
import assert from "node:assert/strict";

import {
  browserCdp,
  drainBrowserEvents,
  drainPageEvents,
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
