// Two recovery paths that leave the page permanently unusable rather than
// merely failing the operation that hit them. Both were found by review of the
// deferred-replay work and are reproduced here before being fixed.
//
// 1. A same-target navigation replacement detaches the route's session before
//    attaching its replacement (routing.ts, the `newTargetId ===
//    previousNativeTargetId` branch). When the navigation then fails, the
//    rollback restores the route to the *old* session id — which no longer
//    exists. Every later command on that page answers "Session with given id
//    not found", so a single failed goto bricks the page.
//
// 2. #flushDeferredEvents makes one pass over the queue. An event whose
//    enabling event is *also* in the queue behind it is re-parked and never
//    reconsidered, then discarded when the operation ends. A nested OOPIF is
//    exactly that shape: the child's executionContextCreated arrives before the
//    child attach, which itself waits on the parent attach.

import test from "node:test";
import assert from "node:assert/strict";

import {
  FakeNativeBrowser,
  waitForCondition,
} from "./fake-native-harness.mjs";

const routing = await import("../../dist/src/playwright/routing.js");

// Brings a transport up over the fake native backend and returns the ids the
// client itself learned, exactly as a real client would: from the attach event.
async function openClientRoute(tabs = [["tab-main", "https://main.test/"]]) {
  const fake = new FakeNativeBrowser();
  for (const [targetId, url] of tabs) fake.addTab(targetId, url);
  const received = [];
  const pendingWork = { latest: 0 };
  const transport = routing.createEgoCdpTransport(fake.runtime, {
    targetIds: tabs.map(([targetId]) => targetId),
    onPendingWorkChange: (count) => (pendingWork.latest = count),
  });
  transport.releaseConnectionKeepAlive();
  transport.onmessage = (message) => received.push(message);
  transport.send({
    id: 1,
    method: "Target.setAutoAttach",
    params: { autoAttach: true, waitForDebuggerOnStart: true, flatten: true },
  });
  assert.ok(
    await waitForCondition(() =>
      received.some((message) => message.method === "Target.attachedToTarget"),
    ),
    "the client must receive its page attach before the test can drive it",
  );
  const attach = received.find(
    (message) => message.method === "Target.attachedToTarget",
  );
  return {
    fake,
    transport,
    received,
    pendingWork,
    clientSessionId: attach.params.sessionId,
    clientTargetId: attach.params.targetInfo.targetId,
  };
}

const reply = (received, id) => received.find((message) => message.id === id);

test("a failed same-target navigation leaves the page usable", async () => {
  const { fake, transport, received, clientSessionId, clientTargetId } =
    await openClientRoute();
  const originalNativeSessionId = [...fake.sessions.keys()][0];

  // Native reuses the very tab the route already owns — the branch that
  // detaches the route's session before attaching the replacement.
  fake.runtime.createTab = async () => ({ targetId: "tab-main" });
  fake.navigationErrors.set(
    "https://fail.test/",
    "net::ERR_NAME_NOT_RESOLVED",
  );

  transport.send({
    id: 50,
    method: "Page.navigate",
    params: { frameId: clientTargetId, url: "https://fail.test/" },
    sessionId: clientSessionId,
  });
  assert.ok(
    await waitForCondition(() => reply(received, 50) !== undefined, 6_000),
    "the failed navigation must be answered",
  );
  assert.match(
    reply(received, 50).error?.message || "",
    /net::ERR_NAME_NOT_RESOLVED/,
    "failing the navigation itself is correct and expected",
  );

  // The page must still work. This is what a client does next: any command on
  // the session it was given.
  received.length = 0;
  fake.log.length = 0;
  transport.send({
    id: 60,
    method: "Runtime.evaluate",
    params: { expression: "1+1" },
    sessionId: clientSessionId,
  });
  assert.ok(
    await waitForCondition(() => reply(received, 60) !== undefined, 4_000),
    "the probe command must be answered at all",
  );

  const forwarded = fake.log.find(
    (entry) => entry.method === "Runtime.evaluate",
  );
  const diagnosis = {
    detachedOldSession: fake.detachedSessions.includes(originalNativeSessionId),
    liveSessions: [...fake.sessions.keys()],
    evaluationNativeSession: forwarded?.sessionId,
    evaluationError: reply(received, 60).error?.message,
  };
  assert.equal(
    reply(received, 60).error,
    undefined,
    `a failed navigation must not brick the page: ${JSON.stringify(diagnosis)}`,
  );
  assert.ok(
    diagnosis.liveSessions.includes(diagnosis.evaluationNativeSession),
    `the route must point at a session native still has: ${JSON.stringify(diagnosis)}`,
  );

  await transport.closeAndWait();
});

// Pins document.readyState so the passive navigation's poll loop holds an
// operation open for exactly as long as the test wants.
function pinReadyState(fake, initial = "loading") {
  const state = { value: initial };
  const original = fake.handle.bind(fake);
  fake.handle = (request) => {
    if (
      request.method === "Runtime.evaluate" &&
      String(request.params?.expression) === "document.readyState"
    ) {
      fake.log.push(request);
      return fake.reply(request, {
        result: { type: "string", value: state.value },
      });
    }
    return original(request);
  };
  return state;
}

async function holdOperationViaPassiveNavigation(fake, nativeSession) {
  fake.emit({
    method: "Page.frameNavigated",
    params: {
      frame: {
        id: "tab-main",
        loaderId: "loader-passive",
        url: "https://main.test/step-2",
        name: "",
      },
    },
    sessionId: nativeSession,
  });
  assert.ok(
    await waitForCondition(() =>
      fake.log.some(
        (entry) =>
          entry.method === "Runtime.evaluate" &&
          String(entry.params?.expression) === "document.readyState",
      ),
    ),
    "the passive navigation poll loop must be running",
  );
}

function emitIframeAttach(fake, sessionId, targetId, parentSessionId) {
  fake.sessions.set(sessionId, "tab-main");
  fake.emit({
    method: "Target.attachedToTarget",
    params: {
      sessionId,
      targetInfo: {
        targetId,
        type: "iframe",
        title: "",
        url: `https://${targetId}.test/`,
        attached: true,
      },
      waitingForDebugger: true,
    },
    sessionId: parentSessionId,
  });
}

const attachedTarget = (received, targetId) =>
  received.some(
    (message) =>
      message.method === "Target.attachedToTarget" &&
      message.params?.targetInfo?.targetId === targetId,
  );

test("a deferred event whose enabling event is also deferred still reaches the client", async () => {
  const { fake, transport, received, pendingWork } = await openClientRoute();
  const nativeSession = [...fake.sessions.keys()][0];
  const readyState = pinReadyState(fake, "loading");

  await holdOperationViaPassiveNavigation(fake, nativeSession);

  // Queued in arrival order. Each is unroutable when it lands, and the event
  // that makes it routable is behind it in the very same queue.
  fake.emit({
    method: "Runtime.executionContextCreated",
    params: {
      context: {
        id: 4_242,
        origin: "https://oopif-child.test",
        name: "__playwright_utility_world__",
        auxData: { isDefault: false, type: "isolated", frameId: "oopif-child" },
      },
    },
    sessionId: "sess-child",
  });
  emitIframeAttach(fake, "sess-child", "oopif-child", "sess-parent");
  emitIframeAttach(fake, "sess-parent", "oopif-parent", nativeSession);

  assert.ok(
    await waitForCondition(() => attachedTarget(received, "oopif-parent")),
    "the outer OOPIF attach is routable on arrival and reaches the client",
  );

  // Release the operation, which is what replays the queue.
  readyState.value = "complete";
  const drained = await waitForCondition(() => pendingWork.latest === 0, 6_000);

  const diagnosis = {
    pending: pendingWork.latest,
    parentAttach: attachedTarget(received, "oopif-parent"),
    childAttach: attachedTarget(received, "oopif-child"),
    childContext: received.some(
      (message) =>
        message.method === "Runtime.executionContextCreated" &&
        message.params?.context?.name === "__playwright_utility_world__",
    ),
  };
  assert.ok(drained, `the held operation must finish: ${JSON.stringify(diagnosis)}`);
  assert.ok(
    diagnosis.childAttach,
    `the nested OOPIF attach must be replayed: ${JSON.stringify(diagnosis)}`,
  );
  assert.ok(
    diagnosis.childContext,
    `and so must the event it enables — one replay pass leaves it parked behind ` +
      `the attach that unblocks it, and #endOperation then discards it, which ` +
      `strands Frame._utilityContext() forever: ${JSON.stringify(diagnosis)}`,
  );

  await transport.closeAndWait();
});
