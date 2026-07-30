import test from "node:test";
import assert from "node:assert/strict";

import { acquireNetworkEvents } from "../dist/src/network-events.js";
import { setOverrides } from "../dist/src/state.js";

test("Network event leases are isolated by CDP session", async () => {
  const calls = [];
  const restore = setOverrides({
    sessionId: "session-a",
    networkDomainEnabled: false,
    cdpOverride(method, params, sessionId) {
      calls.push({ method, params, sessionId });
      return {};
    },
  });
  try {
    const first = acquireNetworkEvents("session-a");
    await first.ready;

    const second = acquireNetworkEvents("session-b");
    await second.ready;

    assert.deepEqual(
      calls
        .filter((call) => call.method === "Network.enable")
        .map((call) => call.sessionId),
      ["session-a", "session-b"],
    );

    await first.release();
    await second.release();
    assert.deepEqual(
      calls
        .filter((call) => call.method === "Network.disable")
        .map((call) => call.sessionId),
      ["session-a", "session-b"],
    );
  } finally {
    restore();
  }
});

test("Network event setup does not swallow task-space hard stops", async () => {
  const hardStop = Object.assign(new Error("user controls the task space"), {
    error_code: "EGO_TASK_SPACE_USER_IN_CONTROL",
  });
  const restore = setOverrides({
    sessionId: "session-hard-stop",
    networkDomainEnabled: false,
    cdpOverride(method) {
      if (method === "Network.enable") throw hardStop;
      return {};
    },
  });
  const lease = acquireNetworkEvents("session-hard-stop");
  try {
    await assert.rejects(
      () => lease.ready,
      (error) => error === hardStop,
    );
  } finally {
    await lease.release();
    restore();
  }
});

test("Network event setup propagates ordinary transport failures", async () => {
  const restore = setOverrides({
    sessionId: "session-failed",
    networkDomainEnabled: false,
    cdpOverride(method) {
      if (method === "Network.enable") {
        throw new Error("CDP transport disconnected");
      }
      return {};
    },
  });
  const lease = acquireNetworkEvents("session-failed");
  try {
    await assert.rejects(() => lease.ready, /CDP transport disconnected/);
  } finally {
    await lease.release();
    restore();
  }
});
