import test from "node:test";
import assert from "node:assert/strict";

import { invalidateSession } from "../../dist/src/browser-runtime.js";
import { helperContext } from "../../dist/src/helpers.js";
import { setOverrides } from "../../dist/src/state.js";
import {
  click,
  down,
  drag,
  hover,
  move,
  up,
  wheel,
} from "../../dist/src/driver/pointer.js";

function visibleAndFocused(value) {
  return (method, params) => {
    if (
      method === "Runtime.evaluate" &&
      params.expression.includes("visibilityState")
    ) {
      return { result: { value } };
    }
    return {};
  };
}

test("click resolves selector offsets without the public elementEval helper", async () => {
  const calls = [];
  const restore = setOverrides({
    cdpOverride(method, params, sessionId) {
      calls.push({ method, params, sessionId });
      if (
        method === "Runtime.evaluate" &&
        params.objectGroup === "ego-browser"
      ) {
        return { result: { objectId: "object-1" } };
      }
      if (method === "Runtime.evaluate") {
        return { result: { value: { x: 125, y: 225 } } };
      }
      if (method === "Runtime.callFunctionOn") {
        return {
          result: {
            value: {
              attached: true,
              visible: true,
              enabled: true,
              editable: true,
              receivesEvents: true,
              rect: { x: 100, y: 200, width: 50, height: 50 },
            },
          },
        };
      }
      return {};
    },
  });
  try {
    await click({ selector: "#target", x: 12, y: 8 });
  } finally {
    restore();
  }

  const callFunction = calls.find(
    (call) =>
      call.method === "Runtime.callFunctionOn" &&
      call.params.functionDeclaration.includes("getBoundingClientRect"),
  );
  assert.ok(callFunction, "resolves the selector-relative bounding rect");
  assert.equal(callFunction.params.objectId, "object-1");
  assert.match(
    callFunction.params.functionDeclaration,
    /getBoundingClientRect/,
  );

  assert.ok(
    calls.some(
      (call) =>
        call.method === "Runtime.releaseObject" &&
        call.params.objectId === "object-1",
    ),
  );

  const mouseEvents = calls.filter(
    (call) => call.method === "Input.dispatchMouseEvent",
  );
  assert.deepEqual(
    mouseEvents.map((call) => ({
      type: call.params.type,
      x: call.params.x,
      y: call.params.y,
      button: call.params.button,
      buttons: call.params.buttons,
    })),
    [
      { type: "mouseMoved", x: 112, y: 208, button: "none", buttons: 0 },
      { type: "mousePressed", x: 112, y: 208, button: "left", buttons: 1 },
      { type: "mouseReleased", x: 112, y: 208, button: "left", buttons: 0 },
    ],
  );
});

test("click scrolls a selector into view before resolving its click point", async () => {
  const calls = [];
  const restore = setOverrides({
    cdpOverride(method, params) {
      calls.push({ method, params });
      if (
        method === "Runtime.evaluate" &&
        params.objectGroup === "ego-browser"
      ) {
        return { result: { objectId: "object-1" } };
      }
      if (method === "Runtime.evaluate") {
        return { result: { value: { x: 100, y: 200 } } };
      }
      if (method === "Runtime.callFunctionOn") {
        return {
          result: {
            value: {
              attached: true,
              visible: true,
              enabled: true,
              editable: true,
              receivesEvents: true,
              rect: { x: 100, y: 200, width: 50, height: 50 },
            },
          },
        };
      }
      return {};
    },
  });
  try {
    await click("#target");
  } finally {
    restore();
  }

  const scrollIndex = calls.findIndex(
    (call) =>
      call.method === "Runtime.callFunctionOn" &&
      call.params.functionDeclaration.includes("scrollIntoView"),
  );
  const dispatchIndex = calls.findIndex(
    (call) => call.method === "Input.dispatchMouseEvent",
  );
  assert.ok(scrollIndex >= 0, "scrolls the target into the viewport");
  assert.ok(scrollIndex < dispatchIndex, "scrolls before mouse dispatch");
});

test("click focuses an unfocused page before trusted input dispatch", async () => {
  const originalEgo = globalThis.ego;
  globalThis.ego = {
    async listTabs() {
      return { tabs: [{ targetId: "tab-1", active: true }] };
    },
    sendCDPMessage() {},
  };
  const calls = [];
  let probeCalls = 0;
  const restore = setOverrides({
    cdpOverride(method, params, sessionId) {
      calls.push({ method, params, sessionId });
      if (
        method === "Runtime.evaluate" &&
        params.expression ===
          "document.visibilityState === 'visible' && document.hasFocus()"
      ) {
        return { result: { value: false } };
      }
      if (
        method === "Runtime.evaluate" &&
        params.expression?.includes("__egoBrowserInputProbes")
      ) {
        probeCalls += 1;
        return { result: { value: true } };
      }
      return {};
    },
  });
  try {
    await click([10, 20]);
  } finally {
    restore();
    if (originalEgo === undefined) delete globalThis.ego;
    else globalThis.ego = originalEgo;
  }

  assert.equal(probeCalls, 2);
  const focusIndex = calls.findIndex(
    (call) => call.method === "Page.bringToFront",
  );
  const inputIndex = calls.findIndex(
    (call) => call.method === "Input.dispatchMouseEvent",
  );
  assert.ok(focusIndex >= 0);
  assert.ok(focusIndex < inputIndex);
});

test("locator click waits for a navigation triggered by the click", async () => {
  const previousEgo = globalThis.ego;
  const loadStates = [];
  const loadSleeps = [];
  let readyState = "loading";
  let currentUrl = "https://example.com/start";
  let probeCalls = 0;
  const sessionId = "pointer-navigation-session";
  const runtime = {
    async listTabs() {
      return {
        tabs: [
          {
            targetId: "pointer-navigation-target",
            active: true,
            url: currentUrl,
          },
        ],
      };
    },
    sendCDPMessage(payload) {
      const request = JSON.parse(payload);
      let result = {};
      if (request.method === "Target.attachToTarget") {
        result = { sessionId };
      } else if (request.method === "Page.getFrameTree") {
        result = {
          frameTree: { frame: { id: "main-frame", url: currentUrl } },
        };
      } else if (request.method === "Runtime.evaluate") {
        if (request.params.objectGroup === "ego-browser") {
          result = { result: { objectId: "link-object" } };
        } else if (
          request.params.expression?.includes("__egoBrowserInputProbes")
        ) {
          probeCalls += 1;
          result = { result: { value: true } };
        } else if (request.params.expression === "document.readyState") {
          loadStates.push(readyState);
          result = { result: { value: readyState } };
        }
      } else if (request.method === "Runtime.callFunctionOn") {
        result = {
          result: {
            value: {
              attached: true,
              visible: true,
              enabled: true,
              editable: true,
              receivesEvents: true,
              rect: { x: 50, y: 60, width: 100, height: 40 },
            },
          },
        };
      }
      queueMicrotask(() =>
        runtime.onCDPMessage(JSON.stringify({ id: request.id, result })),
      );
      if (
        request.method === "Input.dispatchMouseEvent" &&
        request.params.type === "mouseReleased"
      ) {
        queueMicrotask(() => {
          currentUrl = "https://example.com/next";
          runtime.onCDPMessage(
            JSON.stringify({
              sessionId,
              method: "Page.frameNavigated",
              params: {
                frame: { id: "main-frame", url: currentUrl },
              },
            }),
          );
        });
      }
    },
  };
  globalThis.ego = runtime;
  invalidateSession();
  const restore = setOverrides({
    cdpOverride: null,
    sleep: async (ms) => {
      if (ms === 300) {
        loadSleeps.push(ms);
        readyState = "complete";
      }
    },
  });
  try {
    const locator = helperContext().page.locator("#target");
    await locator.click({
      timeout: 1000,
    });
    assert.deepEqual(loadStates, ["loading", "complete"]);
    assert.deepEqual(loadSleeps, [300]);

    loadStates.length = 0;
    loadSleeps.length = 0;
    readyState = "loading";
    await locator.click({ noWaitAfter: true, timeout: 1000 });
    assert.deepEqual(loadStates, []);
    assert.deepEqual(loadSleeps, []);
  } finally {
    invalidateSession();
    restore();
    if (previousEgo === undefined) delete globalThis.ego;
    else globalThis.ego = previousEgo;
  }
});

test("drag moves to the source before pressing the mouse button", async () => {
  const calls = [];
  const restore = setOverrides({
    cdpOverride(method, params) {
      calls.push({ method, params });
      return {};
    },
  });
  try {
    await drag([
      [10, 20],
      [30, 40],
    ]);
  } finally {
    restore();
  }

  const mouseEvents = calls.filter(
    (call) => call.method === "Input.dispatchMouseEvent",
  );
  assert.deepEqual(
    mouseEvents.slice(0, 3).map((call) => ({
      type: call.params.type,
      x: call.params.x,
      y: call.params.y,
      buttons: call.params.buttons,
    })),
    [
      { type: "mouseMoved", x: 10, y: 20, buttons: 0 },
      { type: "mousePressed", x: 10, y: 20, buttons: 1 },
      { type: "mouseMoved", x: 30, y: 40, buttons: 1 },
    ],
  );
});

test("drag preserves an explicit session carried by resolved points", async () => {
  const calls = [];
  const restore = setOverrides({
    cdpOverride(method, params, sessionId) {
      calls.push({ method, params, sessionId });
      return {};
    },
  });
  try {
    await drag([
      { x: 10, y: 20, sessionId: "frame-session" },
      { x: 30, y: 40, sessionId: "frame-session" },
    ]);
  } finally {
    restore();
  }

  const mouseEvents = calls.filter(
    (call) => call.method === "Input.dispatchMouseEvent",
  );
  assert.ok(mouseEvents.length >= 4);
  assert.deepEqual(
    mouseEvents.map((call) => call.sessionId),
    Array(mouseEvents.length).fill("frame-session"),
  );
});

test("drag resolves selector targets to their actionable centers", async () => {
  const calls = [];
  let nextObject = 0;
  const restore = setOverrides({
    cdpOverride(method, params) {
      calls.push({ method, params });
      if (
        method === "Runtime.evaluate" &&
        params.objectGroup === "ego-browser"
      ) {
        nextObject += 1;
        return { result: { objectId: `node-${nextObject}` } };
      }
      if (method === "Runtime.callFunctionOn") {
        const source =
          params.objectId === "node-1" || params.objectId === "node-2";
        return {
          result: {
            value: {
              attached: true,
              visible: true,
              enabled: true,
              editable: true,
              receivesEvents: true,
              rect: source
                ? { x: 10, y: 20, width: 20, height: 20 }
                : { x: 100, y: 200, width: 40, height: 20 },
            },
          },
        };
      }
      return {};
    },
  });
  try {
    await drag(["#source", "#target"]);
  } finally {
    restore();
  }

  const mouseEvents = calls.filter(
    (call) => call.method === "Input.dispatchMouseEvent",
  );
  assert.deepEqual(
    mouseEvents
      .slice(0, 3)
      .map((call) => [call.params.type, call.params.x, call.params.y]),
    [
      ["mouseMoved", 20, 30],
      ["mousePressed", 20, 30],
      ["mouseMoved", 120, 210],
    ],
  );
});

test("wheel defaults to scrolling down (positive deltaY) via CDP when visible and focused", async () => {
  // CDP negates wheel deltas internally, so the DOM convention (positive = down)
  // applies end to end — matching Playwright's mouse.wheel(deltaX, deltaY).
  const calls = [];
  const probe = visibleAndFocused(true);
  const restore = setOverrides({
    cdpOverride(method, params) {
      calls.push({ method, params });
      return probe(method, params);
    },
  });
  try {
    await wheel();
  } finally {
    restore();
  }
  const dispatch = calls.find((c) => c.method === "Input.dispatchMouseEvent");
  assert.ok(dispatch, "dispatches a CDP wheel event");
  assert.deepEqual(dispatch.params, {
    type: "mouseWheel",
    x: 0,
    y: 0,
    deltaX: 0,
    deltaY: 300,
  });
});

test("down and up use the current mouse position", async () => {
  const calls = [];
  const restore = setOverrides({
    cdpOverride(method, params, sessionId) {
      calls.push({ method, params, sessionId });
      return {};
    },
  });
  try {
    await hover([23, 45]);
    await down();
    await up();
  } finally {
    restore();
  }

  const mouseEvents = calls.filter(
    (call) => call.method === "Input.dispatchMouseEvent",
  );
  assert.deepEqual(
    mouseEvents.map((call) => ({
      type: call.params.type,
      x: call.params.x,
      y: call.params.y,
      button: call.params.button,
      buttons: call.params.buttons,
    })),
    [
      { type: "mouseMoved", x: 23, y: 45, button: undefined, buttons: 0 },
      { type: "mousePressed", x: 23, y: 45, button: "left", buttons: 1 },
      { type: "mouseReleased", x: 23, y: 45, button: "left", buttons: 0 },
    ],
  );
});

test("move interpolates steps and preserves the pressed mouse button", async () => {
  const calls = [];
  const restore = setOverrides({
    cdpOverride(method, params, sessionId) {
      calls.push({ method, params, sessionId });
      return {};
    },
  });
  try {
    await move(10, 20);
    await down();
    await move(30, 40, { steps: 2 });
    await up();
  } finally {
    restore();
  }

  const mouseEvents = calls.filter(
    (call) => call.method === "Input.dispatchMouseEvent",
  );
  assert.deepEqual(
    mouseEvents.map((call) => ({
      type: call.params.type,
      x: call.params.x,
      y: call.params.y,
      button: call.params.button,
      buttons: call.params.buttons,
    })),
    [
      { type: "mouseMoved", x: 10, y: 20, button: undefined, buttons: 0 },
      { type: "mousePressed", x: 10, y: 20, button: "left", buttons: 1 },
      { type: "mouseMoved", x: 20, y: 30, button: "left", buttons: 1 },
      { type: "mouseMoved", x: 30, y: 40, button: "left", buttons: 1 },
      { type: "mouseReleased", x: 30, y: 40, button: "left", buttons: 0 },
    ],
  );
});

test("move accepts a CDP timeout only when the pressed move reached the page", async () => {
  const originalEgo = globalThis.ego;
  globalThis.ego = { sendCDPMessage: () => {} };
  let probeChecks = 0;
  const restore = setOverrides({
    cdpOverride(method, params) {
      if (
        method === "Runtime.evaluate" &&
        params.expression.includes("const probe = { events: [] }")
      ) {
        return { result: { value: true } };
      }
      if (
        method === "Runtime.evaluate" &&
        params.expression.includes("probe?.events.some")
      ) {
        probeChecks += 1;
        return { result: { value: true } };
      }
      if (
        method === "Input.dispatchMouseEvent" &&
        params.type === "mouseMoved"
      ) {
        throw new Error("CDP request timed out: Input.dispatchMouseEvent");
      }
      return {};
    },
  });
  try {
    await down();
    await move(51, 61);
    await up();
  } finally {
    restore();
    if (originalEgo === undefined) delete globalThis.ego;
    else globalThis.ego = originalEgo;
  }

  assert.equal(probeChecks, 1);
});

test("move retries the final coordinate when a timed-out path did not reach it", async () => {
  const originalEgo = globalThis.ego;
  globalThis.ego = { sendCDPMessage: () => {} };
  let moved = 0;
  let probeChecks = 0;
  const restore = setOverrides({
    cdpOverride(method, params) {
      if (
        method === "Runtime.evaluate" &&
        params.expression.includes("const probe = { events: [] }")
      ) {
        return { result: { value: true } };
      }
      if (
        method === "Runtime.evaluate" &&
        params.expression.includes("probe?.events.some")
      ) {
        probeChecks += 1;
        return { result: { value: false } };
      }
      if (
        method === "Input.dispatchMouseEvent" &&
        params.type === "mouseMoved"
      ) {
        moved += 1;
        if (moved === 1) {
          throw new Error("CDP request timed out: Input.dispatchMouseEvent");
        }
      }
      return {};
    },
  });
  try {
    await down();
    await move(91, 101, { steps: 2 });
    await up();
  } finally {
    restore();
    if (originalEgo === undefined) delete globalThis.ego;
    else globalThis.ego = originalEgo;
  }

  assert.equal(probeChecks, 1);
  assert.equal(moved, 3, "two path events plus one final-coordinate retry");
});

test("move preserves a CDP timeout when no pressed move event was observed", async () => {
  const originalEgo = globalThis.ego;
  globalThis.ego = { sendCDPMessage: () => {} };
  const restore = setOverrides({
    cdpOverride(method, params) {
      if (
        method === "Runtime.evaluate" &&
        params.expression.includes("const probe = { events: [] }")
      ) {
        return { result: { value: true } };
      }
      if (
        method === "Runtime.evaluate" &&
        params.expression.includes("probe?.events.some")
      ) {
        return { result: { value: false } };
      }
      if (
        method === "Input.dispatchMouseEvent" &&
        params.type === "mouseMoved"
      ) {
        throw new Error("CDP request timed out: Input.dispatchMouseEvent");
      }
      return {};
    },
  });
  try {
    await down();
    await assert.rejects(
      () => move(71, 81),
      /CDP request timed out: Input\.dispatchMouseEvent/,
    );
    await up();
  } finally {
    restore();
    if (originalEgo === undefined) delete globalThis.ego;
    else globalThis.ego = originalEgo;
  }
});

test("wheel forwards deltaX/deltaY and the viewport point to CDP", async () => {
  const calls = [];
  const probe = visibleAndFocused(true);
  const restore = setOverrides({
    cdpOverride(method, params) {
      calls.push({ method, params });
      return probe(method, params);
    },
  });
  try {
    await wheel(10, 450, { x: 50, y: 60 });
  } finally {
    restore();
  }
  const dispatch = calls.find((c) => c.method === "Input.dispatchMouseEvent");
  assert.deepEqual(dispatch.params, {
    type: "mouseWheel",
    x: 50,
    y: 60,
    deltaX: 10,
    deltaY: 450,
  });
});

test("wheel dispatches a synthetic WheelEvent when the page is not visible/focused", async () => {
  const calls = [];
  const probe = visibleAndFocused(false);
  const restore = setOverrides({
    cdpOverride(method, params) {
      calls.push({ method, params });
      return probe(method, params);
    },
  });
  try {
    await wheel(0, 350, { x: 5, y: 7 });
  } finally {
    restore();
  }
  assert.ok(
    !calls.some((c) => c.method === "Input.dispatchMouseEvent"),
    "no CDP wheel dispatch on a backgrounded/unfocused tab",
  );
  const synthetic = calls.find(
    (c) =>
      c.method === "Runtime.evaluate" &&
      c.params.expression.includes("WheelEvent"),
  );
  assert.ok(synthetic, "dispatches a synthetic WheelEvent in the page");
  assert.match(synthetic.params.expression, /elementFromPoint\(5, 7\)/);
  assert.match(synthetic.params.expression, /deltaY: 350/);
});

test("wheel propagates user-control errors from the CDP dispatch", async () => {
  const probe = visibleAndFocused(true);
  const restore = setOverrides({
    cdpOverride(method, params) {
      if (method === "Input.dispatchMouseEvent") {
        throw new Error("user is controlling this task space");
      }
      return probe(method, params);
    },
  });
  try {
    await assert.rejects(() => wheel(), /user is controlling/);
  } finally {
    restore();
  }
});

test("wheel rejects non-numeric deltas before dispatching", async () => {
  // Regression: only the x/y viewport point was validated; a bad deltaX/deltaY
  // flowed straight to CDP (string) or became a null no-op on the synthetic path.
  await assert.rejects(() => wheel("bad"), /invalid mouse offset/);
  await assert.rejects(() => wheel(0, "bad"), /invalid mouse offset/);
});

test("click trusts successful CDP dispatch without synthesizing a fallback", async () => {
  const originalEgo = globalThis.ego;
  globalThis.ego = { sendCDPMessage: () => {} };
  let probeEvaluateCount = 0;
  const evaluateExpressions = [];
  const restore = setOverrides({
    cdpOverride(method, params, sessionId) {
      if (method === "Runtime.evaluate") {
        // Probe calls contain __egoBrowserInputProbes; element resolution does not
        if (params.expression?.includes("__egoBrowserInputProbes")) {
          probeEvaluateCount++;
          evaluateExpressions.push(params.expression);
          if (probeEvaluateCount === 1) {
            // installClickProbe — elementFromPoint returns truthy
            return { result: { value: true } };
          }
          // finishClickProbe — simulate CDP click was NOT seen
          return { result: { value: false } };
        }
        if (params.objectGroup === "ego-browser") {
          return { result: { objectId: "object-1" } };
        }
        // Element resolution (buildSelectorCenterJs) — return center point
        return { result: { value: { x: 100, y: 200 } } };
      }
      if (method === "Runtime.callFunctionOn") {
        return {
          result: {
            value: {
              attached: true,
              visible: true,
              enabled: true,
              editable: true,
              receivesEvents: true,
              rect: { x: 75, y: 175, width: 50, height: 50 },
            },
          },
        };
      }
      // Input.dispatchMouseEvent calls proceed normally
      return {};
    },
  });
  try {
    await click("#target");
  } finally {
    restore();
    if (originalEgo === undefined) delete globalThis.ego;
    else globalThis.ego = originalEgo;
  }

  // 2 probe Runtime.evaluate calls: install + finish (element resolution excluded)
  assert.equal(
    probeEvaluateCount,
    2,
    "Runtime.evaluate called for install and finish probes",
  );
  assert.match(
    evaluateExpressions[0],
    /__egoBrowserInputProbes/,
    "install expression sets up click probe",
  );
  assert.doesNotMatch(evaluateExpressions[1], /dispatchEvent/);
});

test("frame click retries trusted input through an OOPIF session", async () => {
  const originalEgo = globalThis.ego;
  globalThis.ego = { sendCDPMessage: () => {} };
  const probeCalls = [];
  const inputCalls = [];
  const restore = setOverrides({
    sessionId: "main-session",
    sessionTargetId: "tab-1",
    sessionAt: Date.now(),
    cdpOverride(method, params, sessionId) {
      if (
        method === "Runtime.evaluate" &&
        params.expression ===
          "document.visibilityState === 'visible' && document.hasFocus()"
      ) {
        return { result: { value: true } };
      }
      if (
        method === "Runtime.evaluate" &&
        params.expression?.includes("framePoint")
      ) {
        return { result: { value: true } };
      }
      if (
        method === "Runtime.evaluate" &&
        params.expression?.includes("__egoBrowserInputProbes")
      ) {
        probeCalls.push({ params, sessionId });
        if (probeCalls.length === 1 || probeCalls.length === 3) {
          return { result: { value: true } };
        }
        return { result: { value: probeCalls.length === 4 } };
      }
      if (method === "Runtime.evaluate") {
        return {
          result: {
            objectId:
              sessionId === "frame-session" ? "button-object" : "frame-owner",
          },
        };
      }
      if (
        method === "Runtime.callFunctionOn" &&
        params.objectId === "frame-owner"
      ) {
        return {
          result: {
            value: { x: 100, y: 50, width: 400, height: 300 },
          },
        };
      }
      if (method === "DOM.describeNode") {
        return { node: { frameId: "pointer-oopif-frame" } };
      }
      if (
        method === "Page.createIsolatedWorld" &&
        sessionId === "main-session"
      ) {
        throw new Error("No frame for given id found");
      }
      if (method === "Target.getTargets") {
        return {
          targetInfos: [
            {
              targetId: "pointer-oopif-frame",
              type: "iframe",
              url: "https://cross-origin.example/pointer",
            },
          ],
        };
      }
      if (method === "Target.attachToTarget") {
        return { sessionId: "frame-session" };
      }
      if (
        method === "Page.createIsolatedWorld" &&
        sessionId === "frame-session"
      ) {
        return { executionContextId: 303 };
      }
      if (
        method === "Runtime.callFunctionOn" &&
        params.objectId === "button-object"
      ) {
        return {
          result: {
            value: {
              attached: true,
              visible: true,
              enabled: true,
              editable: false,
              receivesEvents: true,
              rect: { x: 20, y: 30, width: 100, height: 40 },
            },
          },
        };
      }
      if (method === "Input.dispatchMouseEvent") {
        inputCalls.push({ params, sessionId });
        return {};
      }
      if (method === "Runtime.releaseObject") return {};
      throw new Error(`Unexpected CDP method: ${method}`);
    },
  });
  try {
    await click({
      selector: "#button",
      frameChain: ["iframe#payment"],
    });
  } finally {
    restore();
    if (originalEgo === undefined) delete globalThis.ego;
    else globalThis.ego = originalEgo;
  }

  assert.deepEqual(
    inputCalls.map((call) => call.sessionId),
    [
      undefined,
      undefined,
      undefined,
      "frame-session",
      "frame-session",
      "frame-session",
    ],
  );
  assert.equal(probeCalls.length, 4);
  assert.ok(
    probeCalls.every((call) => call.sessionId === "frame-session"),
    "click probes run in the child document",
  );
  assert.ok(
    probeCalls.every((call) => call.params.contextId === 303),
    "click probes use the child execution context",
  );
  assert.match(probeCalls[0].params.expression, /elementFromPoint\(70, 50\)/);
  assert.match(probeCalls[3].params.expression, /return probe\.seen/);
  assert.doesNotMatch(probeCalls[3].params.expression, /dispatchEvent/);
  assert.deepEqual(
    inputCalls.slice(3).map((call) => [call.params.x, call.params.y]),
    [
      [70, 50],
      [70, 50],
      [70, 50],
    ],
  );
});

test("cross-frame drag does not synthesize fallback events in one child context", async () => {
  const originalEgo = globalThis.ego;
  globalThis.ego = { sendCDPMessage() {} };
  const probeCalls = [];
  const restore = setOverrides({
    cdpOverride(method, params, sessionId) {
      if (
        method === "Runtime.evaluate" &&
        params.expression?.includes("__egoBrowserInputProbes")
      ) {
        probeCalls.push({ params, sessionId });
        return probeCalls.length === 1
          ? { result: { value: true } }
          : { result: { value: { completed: false, fallback: true } } };
      }
      if (method === "Input.dispatchMouseEvent") {
        throw new Error("CDP request timed out: Input.dispatchMouseEvent");
      }
      return {};
    },
  });
  try {
    await assert.rejects(
      () =>
        drag([
          {
            x: 110,
            y: 60,
            sessionId: "main-session",
            probeSessionId: "main-session",
            probeExecutionContextId: 101,
            probeX: 10,
            probeY: 10,
          },
          {
            x: 320,
            y: 170,
            sessionId: "main-session",
            probeSessionId: "main-session",
            probeExecutionContextId: 202,
            probeX: 20,
            probeY: 20,
          },
        ]),
      /CDP request timed out: Input\.dispatchMouseEvent/,
    );
  } finally {
    restore();
    if (originalEgo === undefined) delete globalThis.ego;
    else globalThis.ego = originalEgo;
  }

  assert.equal(
    probeCalls.length,
    0,
    "one document must not synthesize both sides of a cross-frame drag",
  );
});

test("right-click preserves trusted button and modifier semantics", async () => {
  const originalEgo = globalThis.ego;
  globalThis.ego = { sendCDPMessage: () => {} };
  const probeExpressions = [];
  const inputCalls = [];
  const restore = setOverrides({
    cdpOverride(method, params) {
      if (
        method === "Runtime.evaluate" &&
        params.expression?.includes("__egoBrowserInputProbes")
      ) {
        probeExpressions.push(params.expression);
        return probeExpressions.length === 1
          ? { result: { value: true } }
          : { result: { value: true } };
      }
      if (method === "Input.dispatchMouseEvent") inputCalls.push(params);
      return {};
    },
  });
  try {
    await click([10, 20], {
      button: "right",
      modifiers: ["Alt", "Shift"],
    });
  } finally {
    restore();
    if (originalEgo === undefined) delete globalThis.ego;
    else globalThis.ego = originalEgo;
  }

  assert.match(probeExpressions[0], /addEventListener\("contextmenu"/);
  assert.match(probeExpressions[1], /removeEventListener\("contextmenu"/);
  assert.doesNotMatch(probeExpressions[1], /dispatchEvent/);
  const pressed = inputCalls.find((call) => call.type === "mousePressed");
  assert.equal(pressed.button, "right");
  assert.equal(pressed.modifiers, 9);
});

test("click gives input dispatches the remaining Playwright operation budget", async () => {
  const dispatchTimeouts = [];
  const restore = setOverrides({
    cdpOverride(method, params, sessionId, timeoutMs) {
      if (
        method === "Runtime.evaluate" &&
        params.expression ===
          "document.visibilityState === 'visible' && document.hasFocus()"
      ) {
        return { result: { value: true } };
      }
      if (method === "Input.dispatchMouseEvent") {
        dispatchTimeouts.push(timeoutMs);
      }
      return {};
    },
  });
  try {
    await click([10, 20], { timeout: 30_000 });
  } finally {
    restore();
  }

  assert.equal(dispatchTimeouts.length, 3);
  assert.ok(dispatchTimeouts[0] <= 30_000);
  assert.ok(dispatchTimeouts[1] <= dispatchTimeouts[0]);
  assert.ok(dispatchTimeouts[2] <= dispatchTimeouts[1]);
  assert.ok(dispatchTimeouts.every((timeout) => timeout > 29_000));
});

test("click preserves timeout zero for unlimited input dispatches", async () => {
  const dispatchTimeouts = [];
  const restore = setOverrides({
    cdpOverride(method, params, sessionId, timeoutMs) {
      if (
        method === "Runtime.evaluate" &&
        params.expression ===
          "document.visibilityState === 'visible' && document.hasFocus()"
      ) {
        return { result: { value: true } };
      }
      if (method === "Input.dispatchMouseEvent") {
        dispatchTimeouts.push(timeoutMs);
      }
      return {};
    },
  });
  try {
    await click([10, 20], { timeout: 0 });
  } finally {
    restore();
  }

  assert.deepEqual(dispatchTimeouts, [0, 0, 0]);
});

test("click input dispatch respects a shorter operation deadline", async () => {
  const dispatchTimeouts = [];
  const restore = setOverrides({
    now: () => 1000,
    cdpOverride(method, params, sessionId, timeoutMs) {
      if (
        method === "Runtime.evaluate" &&
        params.expression ===
          "document.visibilityState === 'visible' && document.hasFocus()"
      ) {
        return { result: { value: true } };
      }
      if (method === "Input.dispatchMouseEvent") {
        dispatchTimeouts.push(timeoutMs);
      }
      return {};
    },
  });
  try {
    await click([10, 20], { timeout: 400 });
  } finally {
    restore();
  }

  assert.deepEqual(dispatchTimeouts, [400, 400, 400]);
});

test("click preserves a CDP timeout when no trusted event was observed", async () => {
  const originalEgo = globalThis.ego;
  globalThis.ego = { sendCDPMessage: () => {} };
  let probeEvaluateCount = 0;
  const restore = setOverrides({
    cdpOverride(method, params, sessionId) {
      if (method === "Runtime.evaluate") {
        // Probe calls contain __egoBrowserInputProbes; element resolution does not
        if (params.expression?.includes("__egoBrowserInputProbes")) {
          probeEvaluateCount++;
          if (probeEvaluateCount === 1) {
            return { result: { value: true } };
          }
          return { result: { value: false } };
        }
        if (params.objectGroup === "ego-browser") {
          return { result: { objectId: "object-1" } };
        }
        // Element resolution (buildSelectorCenterJs) — return center point
        return { result: { value: { x: 100, y: 200 } } };
      }
      if (method === "Runtime.callFunctionOn") {
        return {
          result: {
            value: {
              attached: true,
              visible: true,
              enabled: true,
              editable: true,
              receivesEvents: true,
              rect: { x: 75, y: 175, width: 50, height: 50 },
            },
          },
        };
      }
      if (method === "Input.dispatchMouseEvent") {
        // Simulate CDP timeout — the browser couldn't dispatch the event
        throw new Error("CDP request timed out: Input.dispatchMouseEvent");
      }
      return {};
    },
  });
  try {
    await assert.rejects(
      () => click("#target"),
      /CDP request timed out: Input\.dispatchMouseEvent/,
    );
  } finally {
    restore();
    if (originalEgo === undefined) delete globalThis.ego;
    else globalThis.ego = originalEgo;
  }

  assert.ok(
    probeEvaluateCount >= 2,
    "probe install and finish were called despite CDP timeout",
  );
});
