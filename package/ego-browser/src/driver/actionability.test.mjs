import test from "node:test";
import assert from "node:assert/strict";

import { waitForActionableElement } from "../../dist/src/driver/actionability.js";
import { setOverrides } from "../../dist/src/state.js";

test("waitForActionableElement waits for stability and returns a relative point", async () => {
  let now = 0;
  let probes = 0;
  const sleeps = [];
  const restore = setOverrides({
    defaultTimeout: 500,
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
    cdpOverride: async (method) => {
      if (method === "Runtime.evaluate") {
        return { result: { objectId: "node-1" } };
      }
      if (method === "Runtime.callFunctionOn") {
        probes += 1;
        return {
          result: {
            value: {
              attached: true,
              visible: true,
              enabled: true,
              editable: true,
              receivesEvents: true,
              rect: { x: 10, y: 20, width: 100, height: 40 },
            },
          },
        };
      }
      return {};
    },
  });
  try {
    const result = await waitForActionableElement("#submit", {
      timeout: 500,
      visible: true,
      stable: true,
      receivesEvents: true,
      enabled: true,
      position: { x: 5, y: 7 },
    });
    assert.deepEqual(result, {
      x: 15,
      y: 27,
      sessionId: undefined,
    });
  } finally {
    restore();
  }

  assert.ok(probes >= 2, "stability requires two matching layout samples");
  assert.ok(sleeps.includes(50));
});

test("frame-scoped actionability returns top-level viewport coordinates", async () => {
  const restore = setOverrides({
    sessionId: "main-session",
    sessionTargetId: "tab-1",
    sessionAt: Date.now(),
    cdpOverride: async (method, params) => {
      if (method === "Runtime.evaluate") {
        return {
          result: {
            objectId:
              params.contextId === 101 ? "button-object" : "frame-owner",
          },
        };
      }
      if (
        method === "Runtime.callFunctionOn" &&
        params.objectId === "frame-owner"
      ) {
        assert.deepEqual(params.arguments, [{ value: true }]);
        return {
          result: {
            value: { x: 100, y: 50, width: 400, height: 300 },
          },
        };
      }
      if (method === "DOM.describeNode") {
        return { node: { frameId: "frame-1" } };
      }
      if (method === "Page.createIsolatedWorld") {
        return { executionContextId: 101 };
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
      return {};
    },
  });
  try {
    const point = await waitForActionableElement(
      { selector: "#button", frameChain: ["#frame"] },
      { visible: true },
    );
    assert.deepEqual(point, {
      x: 170,
      y: 100,
      sessionId: "main-session",
      probeSessionId: "main-session",
      probeExecutionContextId: 101,
      probeX: 70,
      probeY: 50,
    });
  } finally {
    restore();
  }
});

test("out-of-process frame actionability dispatches through the top-level session", async () => {
  const restore = setOverrides({
    sessionId: "main-session",
    sessionTargetId: "tab-1",
    sessionAt: Date.now(),
    cdpOverride: async (method, params, sessionId) => {
      if (method === "Runtime.evaluate") {
        return {
          result: {
            objectId:
              sessionId === "oopif-session" ? "button-object" : "frame-owner",
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
        return { node: { frameId: "oopif-action-frame" } };
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
              targetId: "oopif-action-frame",
              type: "iframe",
              url: "https://cross-origin.example/action",
            },
          ],
        };
      }
      if (method === "Target.attachToTarget") {
        return { sessionId: "oopif-session" };
      }
      if (
        method === "Page.createIsolatedWorld" &&
        sessionId === "oopif-session"
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
      if (method === "Runtime.releaseObject") return {};
      throw new Error(`Unexpected CDP method: ${method}`);
    },
  });
  try {
    const point = await waitForActionableElement(
      { selector: "#button", frameChain: ["#frame"] },
      { visible: true },
    );
    assert.deepEqual(point, {
      x: 170,
      y: 100,
      sessionId: "main-session",
      probeSessionId: "oopif-session",
      probeExecutionContextId: 303,
      probeX: 70,
      probeY: 50,
    });
  } finally {
    restore();
  }
});

test("frame-scoped actionability waits for a hidden frame owner to become visible", async () => {
  let frameProbes = 0;
  let now = 0;
  const restore = setOverrides({
    sessionId: "main-session",
    sessionTargetId: "tab-1",
    sessionAt: Date.now(),
    defaultTimeout: 500,
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    cdpOverride: async (method, params) => {
      if (
        method === "Runtime.evaluate" &&
        params.expression.includes("framePoint")
      ) {
        return { result: { value: frameProbes > 1 } };
      }
      if (method === "Runtime.evaluate") {
        return {
          result: {
            objectId:
              params.contextId === 101 ? "button-object" : "frame-owner",
          },
        };
      }
      if (
        method === "Runtime.callFunctionOn" &&
        params.objectId === "frame-owner"
      ) {
        frameProbes += 1;
        return {
          result: {
            value: {
              x: 100,
              y: 50,
              width: frameProbes === 1 ? 0 : 400,
              height: frameProbes === 1 ? 0 : 300,
              visible: frameProbes > 1,
              receivesEvents: frameProbes > 1,
              scaleX: 1,
              scaleY: 1,
            },
          },
        };
      }
      if (method === "DOM.describeNode") {
        return { node: { frameId: "frame-1" } };
      }
      if (method === "Page.createIsolatedWorld") {
        return { executionContextId: 101 };
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
      if (method === "Runtime.releaseObject") return {};
      throw new Error(`Unexpected CDP method: ${method}`);
    },
  });
  try {
    const point = await waitForActionableElement(
      { selector: "#button", frameChain: ["#frame"] },
      { visible: true },
    );
    assert.equal(frameProbes, 2);
    assert.deepEqual({ x: point.x, y: point.y }, { x: 170, y: 100 });
  } finally {
    restore();
  }
});

test("frame-scoped actionability waits for an obscured frame owner", async () => {
  let frameProbes = 0;
  let now = 0;
  const restore = setOverrides({
    sessionId: "main-session",
    sessionTargetId: "tab-1",
    sessionAt: Date.now(),
    defaultTimeout: 500,
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    cdpOverride: async (method, params) => {
      if (
        method === "Runtime.evaluate" &&
        params.expression.includes("framePoint")
      ) {
        return { result: { value: frameProbes > 1 } };
      }
      if (method === "Runtime.evaluate") {
        return {
          result: {
            objectId:
              params.contextId === 101 ? "button-object" : "frame-owner",
          },
        };
      }
      if (
        method === "Runtime.callFunctionOn" &&
        params.objectId === "frame-owner"
      ) {
        frameProbes += 1;
        return {
          result: {
            value: {
              x: 100,
              y: 50,
              width: 400,
              height: 300,
              visible: true,
              receivesEvents: frameProbes > 1,
              scaleX: 1,
              scaleY: 1,
            },
          },
        };
      }
      if (method === "DOM.describeNode") {
        return { node: { frameId: "frame-1" } };
      }
      if (method === "Page.createIsolatedWorld") {
        return { executionContextId: 101 };
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
      if (method === "Runtime.releaseObject") return {};
      throw new Error(`Unexpected CDP method: ${method}`);
    },
  });
  try {
    await waitForActionableElement(
      { selector: "#button", frameChain: ["#frame"] },
      { receivesEvents: true },
    );
    assert.equal(frameProbes, 2);
  } finally {
    restore();
  }
});

test("frame-scoped actionability retries the parent target-point probe after navigation", async () => {
  let parentHitProbes = 0;
  let now = 0;
  const restore = setOverrides({
    sessionId: "main-session",
    sessionTargetId: "tab-1",
    sessionAt: Date.now(),
    defaultTimeout: 500,
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    cdpOverride: async (method, params) => {
      if (
        method === "Runtime.evaluate" &&
        params.expression.includes("framePoint")
      ) {
        parentHitProbes += 1;
        if (parentHitProbes === 1) {
          throw new Error("Execution context was destroyed.");
        }
        return { result: { value: true } };
      }
      if (method === "Runtime.evaluate") {
        return {
          result: {
            objectId:
              params.contextId === 101 ? "button-object" : "frame-owner",
          },
        };
      }
      if (
        method === "Runtime.callFunctionOn" &&
        params.objectId === "frame-owner"
      ) {
        return {
          result: {
            value: {
              x: 100,
              y: 50,
              width: 400,
              height: 300,
              visible: true,
              receivesEvents: true,
              scaleX: 1,
              scaleY: 1,
            },
          },
        };
      }
      if (method === "DOM.describeNode") {
        return { node: { frameId: "frame-1" } };
      }
      if (method === "Page.createIsolatedWorld") {
        return { executionContextId: 101 };
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
      if (method === "Runtime.releaseObject") return {};
      throw new Error(`Unexpected CDP method: ${method}`);
    },
  });
  try {
    await waitForActionableElement(
      { selector: "#button", frameChain: ["#frame"] },
      { receivesEvents: true },
    );
    assert.equal(parentHitProbes, 2);
  } finally {
    restore();
  }
});

test("frame-scoped actionability refreshes owner geometry after child scrolling", async () => {
  let now = 0;
  let ownerMeasurements = 0;
  const restore = setOverrides({
    sessionId: "main-session",
    sessionTargetId: "tab-1",
    sessionAt: Date.now(),
    defaultTimeout: 200,
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    cdpOverride: async (method, params) => {
      if (
        method === "Runtime.evaluate" &&
        params.expression.includes("framePoint")
      ) {
        return { result: { value: true } };
      }
      if (method === "Runtime.evaluate") {
        return {
          result: {
            objectId:
              params.contextId === 101 ? "button-object" : "frame-owner",
          },
        };
      }
      if (
        method === "Runtime.callFunctionOn" &&
        params.objectId === "frame-owner"
      ) {
        ownerMeasurements += 1;
        return {
          result: {
            value: {
              x: 100,
              y: ownerMeasurements === 1 ? 50 : 120,
              width: 400,
              height: 300,
              visible: true,
              receivesEvents: false,
              scaleX: 1,
              scaleY: 1,
            },
          },
        };
      }
      if (method === "DOM.describeNode") {
        return { node: { frameId: "frame-1" } };
      }
      if (method === "Page.createIsolatedWorld") {
        return { executionContextId: 101 };
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
      if (method === "Runtime.releaseObject") return {};
      throw new Error(`Unexpected CDP method: ${method}`);
    },
  });
  try {
    const point = await waitForActionableElement(
      { selector: "#button", frameChain: ["#frame"] },
      { receivesEvents: true, timeout: 200 },
    );
    assert.ok(ownerMeasurements >= 2);
    assert.deepEqual({ x: point.x, y: point.y }, { x: 170, y: 170 });
  } finally {
    restore();
  }
});

test("frame-scoped stability includes movement of the frame owner", async () => {
  let frameProbes = 0;
  let now = 0;
  const restore = setOverrides({
    sessionId: "main-session",
    sessionTargetId: "tab-1",
    sessionAt: Date.now(),
    defaultTimeout: 500,
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    cdpOverride: async (method, params) => {
      if (method === "Runtime.evaluate") {
        return {
          result: {
            objectId:
              params.contextId === 101 ? "button-object" : "frame-owner",
          },
        };
      }
      if (
        method === "Runtime.callFunctionOn" &&
        params.objectId === "frame-owner"
      ) {
        frameProbes += 1;
        return {
          result: {
            value: {
              x: frameProbes === 1 ? 100 : 110,
              y: 50,
              width: 400,
              height: 300,
              visible: true,
              receivesEvents: true,
              scaleX: 1,
              scaleY: 1,
            },
          },
        };
      }
      if (method === "DOM.describeNode") {
        return { node: { frameId: "frame-1" } };
      }
      if (method === "Page.createIsolatedWorld") {
        return { executionContextId: 101 };
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
      if (method === "Runtime.releaseObject") return {};
      throw new Error(`Unexpected CDP method: ${method}`);
    },
  });
  try {
    const point = await waitForActionableElement(
      { selector: "#button", frameChain: ["#frame"] },
      { stable: true },
    );
    assert.equal(frameProbes, 3);
    assert.deepEqual({ x: point.x, y: point.y }, { x: 180, y: 100 });
  } finally {
    restore();
  }
});

test("frame-scoped actionability applies the frame scale to viewport coordinates", async () => {
  const restore = setOverrides({
    sessionId: "main-session",
    sessionTargetId: "tab-1",
    sessionAt: Date.now(),
    cdpOverride: async (method, params) => {
      if (method === "Runtime.evaluate") {
        return {
          result: {
            objectId:
              params.contextId === 101 ? "button-object" : "frame-owner",
          },
        };
      }
      if (
        method === "Runtime.callFunctionOn" &&
        params.objectId === "frame-owner"
      ) {
        return {
          result: {
            value: {
              x: 100,
              y: 50,
              width: 800,
              height: 450,
              visible: true,
              receivesEvents: true,
              scaleX: 2,
              scaleY: 1.5,
            },
          },
        };
      }
      if (method === "DOM.describeNode") {
        return { node: { frameId: "scaled-frame" } };
      }
      if (method === "Page.createIsolatedWorld") {
        return { executionContextId: 101 };
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
      if (method === "Runtime.releaseObject") return {};
      throw new Error(`Unexpected CDP method: ${method}`);
    },
  });
  try {
    const point = await waitForActionableElement(
      { selector: "#button", frameChain: ["#scaled-frame"] },
      { visible: true },
    );
    assert.deepEqual({ x: point.x, y: point.y }, { x: 240, y: 125 });
  } finally {
    restore();
  }
});

test("frame-scoped actionability times out while the frame owner stays hidden", async () => {
  let now = 0;
  const restore = setOverrides({
    sessionId: "main-session",
    sessionTargetId: "tab-1",
    sessionAt: Date.now(),
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    cdpOverride: async (method, params) => {
      if (method === "Runtime.evaluate") {
        return {
          result: {
            objectId:
              params.contextId === 101 ? "button-object" : "frame-owner",
          },
        };
      }
      if (
        method === "Runtime.callFunctionOn" &&
        params.objectId === "frame-owner"
      ) {
        return {
          result: {
            value: {
              x: 0,
              y: 0,
              width: 0,
              height: 0,
              visible: false,
              receivesEvents: false,
              scaleX: 1,
              scaleY: 1,
            },
          },
        };
      }
      if (method === "DOM.describeNode") {
        return { node: { frameId: "hidden-frame" } };
      }
      if (method === "Page.createIsolatedWorld") {
        return { executionContextId: 101 };
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
      if (method === "Runtime.releaseObject") return {};
      throw new Error(`Unexpected CDP method: ${method}`);
    },
  });
  try {
    await assert.rejects(
      () =>
        waitForActionableElement(
          { selector: "#button", frameChain: ["#hidden-frame"] },
          { visible: true, timeout: 100 },
        ),
      (error) => {
        assert.equal(error.name, "TimeoutError");
        assert.match(error.message, /frame owner is not visible/);
        return true;
      },
    );
  } finally {
    restore();
  }
});

test("waitForActionableElement throws TimeoutError for an obscured target", async () => {
  let now = 0;
  const restore = setOverrides({
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    cdpOverride: async (method) => {
      if (method === "Runtime.evaluate") {
        return { result: { objectId: "node-1" } };
      }
      if (method === "Runtime.callFunctionOn") {
        return {
          result: {
            value: {
              attached: true,
              visible: true,
              enabled: true,
              editable: true,
              receivesEvents: false,
              rect: { x: 0, y: 0, width: 100, height: 40 },
            },
          },
        };
      }
      return {};
    },
  });
  try {
    await assert.rejects(
      () =>
        waitForActionableElement("#submit", {
          timeout: 100,
          visible: true,
          receivesEvents: true,
        }),
      (error) => {
        assert.equal(error.name, "TimeoutError");
        assert.match(error.message, /locator action timed out after 100ms/);
        assert.match(error.message, /element does not receive pointer events/);
        return true;
      },
    );
  } finally {
    restore();
  }
});

test("waitForActionableElement re-resolves when the node detaches during a probe", async () => {
  let now = 0;
  let probes = 0;
  const restore = setOverrides({
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    cdpOverride: async (method) => {
      if (method === "Runtime.evaluate") {
        return { result: { objectId: `node-${probes + 1}` } };
      }
      if (method === "Runtime.callFunctionOn") {
        probes += 1;
        if (probes === 1) {
          throw new Error("Could not find object with given id");
        }
        return {
          result: {
            value: {
              attached: true,
              visible: true,
              enabled: true,
              editable: true,
              receivesEvents: true,
              rect: { x: 1, y: 2, width: 10, height: 10 },
            },
          },
        };
      }
      return {};
    },
  });
  try {
    assert.deepEqual(
      await waitForActionableElement("#moving", {
        timeout: 500,
        visible: true,
      }),
      { x: 6, y: 7, sessionId: undefined },
    );
  } finally {
    restore();
  }
  assert.equal(probes, 2);
});
