import test from "node:test";
import assert from "node:assert/strict";

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

test("click triggers probe fallback when CDP click is not trusted", async () => {
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
          return { result: { value: { seen: false, fallback: true } } };
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
  assert.match(
    evaluateExpressions[1],
    /dispatchEvent/,
    "finish expression contains fallback mouse events",
  );
  assert.match(
    evaluateExpressions[1],
    /MouseEvent/,
    "finish expression dispatches MouseEvent in fallback",
  );
});

test("right-click fallback preserves the button and modifier semantics", async () => {
  const originalEgo = globalThis.ego;
  globalThis.ego = { sendCDPMessage: () => {} };
  const probeExpressions = [];
  const restore = setOverrides({
    cdpOverride(method, params) {
      if (
        method === "Runtime.evaluate" &&
        params.expression?.includes("__egoBrowserInputProbes")
      ) {
        probeExpressions.push(params.expression);
        return probeExpressions.length === 1
          ? { result: { value: true } }
          : { result: { value: { seen: false, fallback: true } } };
      }
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
  assert.match(probeExpressions[1], /new MouseEvent\("contextmenu"/);
  assert.match(probeExpressions[1], /button: 2/);
  assert.match(probeExpressions[1], /altKey":true/);
  assert.match(probeExpressions[1], /shiftKey":true/);
  assert.doesNotMatch(probeExpressions[1], /new MouseEvent\("click"/);
});

test("click absorbs CDP timeout when probe fallback succeeds", async () => {
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
          // Fallback succeeded
          return { result: { value: { seen: false, fallback: true } } };
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
    // Should NOT throw — timeout is absorbed because fallback succeeded
    await click("#target");
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
