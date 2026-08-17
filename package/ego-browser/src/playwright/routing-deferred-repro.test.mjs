// Repro rig for the transport hang seen in the benchmark run
// internal-regression-validation_pi_ego-browser_20260816T102420Z:
// 15/15 hard kills produced zero stdout, and 11/15 had nothing but
// egoBrowser.switchTaskSpace(...) before the first console.log.
//
// Mechanism under test: an event that #acceptEvent rejects is parked in
// #deferredEvents while #activeOperations > 0 (routing.ts #dispatch). When the
// operation ends, #endOperation() *discards* the queue instead of replaying it:
//
//   #endOperation() {
//     this.#activeOperations -= 1;
//     if (this.#activeOperations === 0) this.#deferredEvents.length = 0;
//   }
//
// #completePassiveNavigation holds an operation for up to 8s and ends with only
// #endOperation() -- it never calls #flushDeferredEvents(). So any event parked
// during a passive navigation is lost, even if it became deliverable meanwhile.

import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate as waitForImmediate } from "node:timers/promises";

import {
  FakeNativeBrowser,
  waitForCondition,
} from "./fake-native-harness.mjs";

const routing = await import("../../dist/src/playwright/routing.js");

async function createHarness(
  tabs = [["tab-main", "https://main.test/"]],
  transportOptions = {},
) {
  const fake = new FakeNativeBrowser();
  for (const [targetId, url] of tabs) fake.addTab(targetId, url);
  const received = [];
  const pendingWork = { latest: 0 };
  const transport = routing.createEgoCdpTransport(fake.runtime, {
    targetIds: tabs.map(([targetId]) => targetId),
    onPendingWorkChange: (count) => (pendingWork.latest = count),
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

// Pins document.readyState so #completePassiveNavigation's poll loop is held
// open for exactly as long as the test wants.
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

// Starts a passive navigation on the main route, which takes #activeOperations
// above zero for the life of the poll loop.
async function holdOperationViaPassiveNavigation(fake, received, nativeSession) {
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
  const started = await waitForCondition(() =>
    fake.log.some(
      (entry) =>
        entry.method === "Runtime.evaluate" &&
        String(entry.params?.expression) === "document.readyState",
    ),
  );
  assert.ok(started, "the passive navigation poll loop must be running");
}

// The OOPIF's own events reach the bridge before the bridge has registered its
// session -- #acceptEvent's session check (routing.ts:1284) rejects them, so
// they are parked rather than delivered.
function emitOopifContextBeforeAttach(fake, oopifSession) {
  fake.emit({
    method: "Runtime.executionContextCreated",
    params: {
      context: {
        id: 4_242,
        origin: "https://oopif.test",
        name: "__playwright_utility_world__",
        auxData: { isDefault: false, type: "isolated", frameId: "oopif-1" },
      },
    },
    sessionId: oopifSession,
  });
}

// The attach event itself is accepted (its parent session is known), which
// registers the OOPIF session -- from here on the parked event is deliverable.
function emitOopifAttach(fake, oopifSession, parentSession) {
  fake.sessions.set(oopifSession, "tab-main");
  fake.emit({
    method: "Target.attachedToTarget",
    params: {
      sessionId: oopifSession,
      targetInfo: {
        targetId: "oopif-1",
        type: "iframe",
        title: "",
        url: "https://oopif.test/",
        attached: true,
      },
      waitingForDebugger: true,
    },
    sessionId: parentSession,
  });
}

const sawUtilityContext = (received) =>
  received.some(
    (message) =>
      message.method === "Runtime.executionContextCreated" &&
      message.params?.context?.name === "__playwright_utility_world__",
  );

test("an event parked during a passive navigation is replayed once its session becomes known", async () => {
  const { fake, transport, received, pendingWork } = await createHarness();
  const nativeSession = [...fake.sessions.keys()][0];
  const readyState = pinReadyState(fake, "loading");

  await holdOperationViaPassiveNavigation(fake, received, nativeSession);

  // Parked: session unknown at arrival.
  emitOopifContextBeforeAttach(fake, "sess-oopif");
  // Accepted: registers sess-oopif, so the parked event is now deliverable.
  emitOopifAttach(fake, "sess-oopif", nativeSession);

  const attached = await waitForCondition(() =>
    received.some((message) => message.method === "Target.attachedToTarget"),
  );
  assert.ok(attached, "the OOPIF attach reaches the client");
  assert.equal(
    sawUtilityContext(received),
    false,
    "precondition: the parked context event has not been delivered yet",
  );

  // Let the passive navigation finish, which runs #endOperation().
  readyState.value = "complete";
  const drained = await waitForCondition(
    () => pendingWork.latest === 0,
    4_000,
  );

  assert.ok(
    sawUtilityContext(received),
    `the utility-world executionContextCreated must survive the operation it was parked behind, ` +
      `but #endOperation() discarded it (pendingWorkCount drained=${drained}). ` +
      `Playwright's Frame._utilityContext() awaits this event with no deadline, so page.title() ` +
      `and every locator that needs the utility world hang forever.`,
  );

  await transport.closeAndWait();
});

test("the same parked event is delivered when something triggers a flush", async () => {
  const { fake, transport, received } = await createHarness([
    ["tab-main", "https://main.test/"],
    ["tab-second", "https://second.test/"],
  ]);
  const nativeSession = [...fake.sessions.entries()].find(
    ([, targetId]) => targetId === "tab-main",
  )[0];
  pinReadyState(fake, "loading");

  await holdOperationViaPassiveNavigation(fake, received, nativeSession);

  emitOopifContextBeforeAttach(fake, "sess-oopif");
  emitOopifAttach(fake, "sess-oopif", nativeSession);

  await waitForCondition(() =>
    received.some((message) => message.method === "Target.attachedToTarget"),
  );
  assert.equal(
    sawUtilityContext(received),
    false,
    "precondition: still parked",
  );

  // Target.createTarget calls #flushDeferredEvents() (routing.ts:275) once the
  // new tab exists, so it replays the queue while the operation is still held.
  transport.send({
    id: 900,
    method: "Target.createTarget",
    params: { url: "https://third.test/" },
  });

  assert.ok(
    await waitForCondition(() => sawUtilityContext(received), 4_000),
    "a flush delivers the very same parked event, proving it was deliverable " +
      "and only the missing flush in #endOperation() loses it",
  );

  await transport.closeAndWait();
});

// Playwright's Page._initialize sends Page.getFrameTree and a session-scoped
// Target.setAutoAttach in one Promise.all. routing.ts:1487 documents the hazard:
// "a barrier that outlives its Page.getFrameTree hangs page initialization
// forever." Every path that *errors* the getFrameTree answers the barrier
// (#failFrameTreeBarrier at :469 :486 :555 :966 :1836). Nothing answers it when
// native accepts the command and then simply never replies -- client-forwarded
// commands in #pendingIds carry no timeout, unlike #sendNativeCommand's 10s.
test("a Page.getFrameTree that native never answers fails the barrier instead of hanging page initialization", async () => {
  const { fake, transport, received } = await createHarness(
    [["tab-main", "https://main.test/"]],
    { frameTreeBarrierTimeoutMs: 300 },
  );
  const clientSession = [...fake.sessions.keys()][0];

  const original = fake.handle.bind(fake);
  fake.handle = (request) => {
    if (request.method === "Page.getFrameTree") {
      fake.log.push(request); // accepted by native, then silently dropped
      return;
    }
    return original(request);
  };

  transport.send({
    id: 500,
    method: "Page.getFrameTree",
    params: {},
    sessionId: clientSession,
  });
  assert.ok(
    await waitForCondition(() =>
      fake.log.some((entry) => entry.method === "Page.getFrameTree"),
    ),
    "the command reaches native, which establishes the barrier",
  );

  transport.send({
    id: 501,
    method: "Target.setAutoAttach",
    params: { autoAttach: true, waitForDebuggerOnStart: true, flatten: true },
    sessionId: clientSession,
  });

  // Both halves of Playwright's Promise.all must settle, or Page._initialize
  // hangs with no error -- which is switchTaskSpace() never returning.
  assert.ok(
    await waitForCondition(
      () =>
        received.some((message) => message.id === 500) &&
        received.some((message) => message.id === 501),
      3_000,
    ),
    "the barrier timeout answers both the held Target.setAutoAttach and the " +
      "Page.getFrameTree it guarded",
  );

  for (const id of [500, 501]) {
    const answer = received.find((message) => message.id === id);
    assert.match(
      answer.error?.message || "",
      /Page\.getFrameTree went unanswered for 300ms/,
      `id ${id} is answered with a diagnosable error, not silence`,
    );
  }

  await transport.closeAndWait();
});

test("the barrier really is what holds Target.setAutoAttach, and answering Page.getFrameTree releases it", async () => {
  const { fake, transport, received } = await createHarness();
  const clientSession = [...fake.sessions.keys()][0];

  const original = fake.handle.bind(fake);
  let stashed;
  fake.handle = (request) => {
    if (request.method === "Page.getFrameTree" && !stashed) {
      stashed = request; // held, not dropped
      fake.log.push(request);
      return;
    }
    return original(request);
  };

  transport.send({
    id: 500,
    method: "Page.getFrameTree",
    params: {},
    sessionId: clientSession,
  });
  await waitForCondition(() =>
    fake.log.some((entry) => entry.method === "Page.getFrameTree"),
  );

  const autoAttachesBefore = fake.log.filter(
    (entry) => entry.method === "Target.setAutoAttach",
  ).length;
  transport.send({
    id: 501,
    method: "Target.setAutoAttach",
    params: { autoAttach: true, waitForDebuggerOnStart: true, flatten: true },
    sessionId: clientSession,
  });
  await new Promise((resolve) => setTimeout(resolve, 200));

  assert.equal(
    fake.log.filter((entry) => entry.method === "Target.setAutoAttach").length,
    autoAttachesBefore,
    "the barrier withholds Target.setAutoAttach from native entirely",
  );
  assert.equal(
    received.find((message) => message.id === 501),
    undefined,
    "and the client has no answer for it yet",
  );

  // Answer the getFrameTree; the barrier must release what it held.
  fake.handle = original;
  original(stashed);

  assert.ok(
    await waitForCondition(
      () =>
        received.some((message) => message.id === 500) &&
        received.some((message) => message.id === 501),
      3_000,
    ),
    "answering Page.getFrameTree releases the barrier and both commands complete",
  );

  await transport.closeAndWait();
});
