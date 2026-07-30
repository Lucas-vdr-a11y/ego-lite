import test from "node:test";
import assert from "node:assert/strict";

import {
  frameOwnersReceiveEvents,
  resolveFrameContext,
} from "../dist/src/frame-context.js";
import { drainBrowserEvents } from "../dist/src/browser-runtime.js";
import { ElementResolutionError } from "../dist/src/element-resolver.js";
import { setOverrides } from "../dist/src/state.js";

test("resolveFrameContext walks nested frames and accumulates offsets", async () => {
  const calls = [];
  const restore = setOverrides({
    sessionId: "main-session",
    sessionTargetId: "tab-1",
    sessionAt: Date.now(),
    cdpOverride(method, params, sessionId) {
      calls.push({ method, params, sessionId });
      if (method === "Runtime.evaluate") {
        if (params.contextId === 101) {
          assert.match(params.expression, /iframe#inner/);
          return { result: { objectId: "inner-owner" } };
        }
        assert.match(params.expression, /iframe#outer/);
        return { result: { objectId: "outer-owner" } };
      }
      if (method === "Runtime.callFunctionOn") {
        return {
          result: {
            value:
              params.objectId === "outer-owner"
                ? { x: 100, y: 50, width: 500, height: 400 }
                : { x: 10, y: 20, width: 300, height: 200 },
          },
        };
      }
      if (method === "DOM.describeNode") {
        return {
          node: {
            frameId:
              params.objectId === "outer-owner" ? "outer-frame" : "inner-frame",
          },
        };
      }
      if (method === "Page.createIsolatedWorld") {
        return {
          executionContextId: params.frameId === "outer-frame" ? 101 : 202,
        };
      }
      if (method === "Runtime.releaseObject") return {};
      throw new Error(`Unexpected CDP method: ${method}`);
    },
  });
  try {
    assert.deepEqual(
      await resolveFrameContext(["iframe#outer", "iframe#inner"]),
      {
        sessionId: "main-session",
        executionContextId: 202,
        frameId: "inner-frame",
        offset: { x: 110, y: 70 },
      },
    );
  } finally {
    restore();
  }

  assert.equal(
    calls.filter((call) => call.method === "Runtime.releaseObject").length,
    2,
  );
});

test("resolveFrameContext composes scale across nested frames", async () => {
  const restore = setOverrides({
    sessionId: "main-session",
    sessionTargetId: "tab-1",
    sessionAt: Date.now(),
    cdpOverride(method, params) {
      if (method === "Runtime.evaluate") {
        return {
          result: {
            objectId: params.contextId === 101 ? "inner-owner" : "outer-owner",
          },
        };
      }
      if (method === "Runtime.callFunctionOn") {
        return {
          result: {
            value:
              params.objectId === "outer-owner"
                ? {
                    x: 100,
                    y: 50,
                    width: 800,
                    height: 600,
                    scaleX: 2,
                    scaleY: 2,
                  }
                : {
                    x: 10,
                    y: 20,
                    width: 450,
                    height: 100,
                    scaleX: 1.5,
                    scaleY: 0.5,
                  },
          },
        };
      }
      if (method === "DOM.describeNode") {
        return {
          node: {
            frameId:
              params.objectId === "outer-owner"
                ? "outer-scaled-frame"
                : "inner-scaled-frame",
          },
        };
      }
      if (method === "Page.createIsolatedWorld") {
        return {
          executionContextId:
            params.frameId === "outer-scaled-frame" ? 101 : 202,
        };
      }
      if (method === "Runtime.releaseObject") return {};
      throw new Error(`Unexpected CDP method: ${method}`);
    },
  });
  try {
    assert.deepEqual(
      await resolveFrameContext(["iframe#outer", "iframe#inner"]),
      {
        sessionId: "main-session",
        executionContextId: 202,
        frameId: "inner-scaled-frame",
        offset: { x: 120, y: 90 },
        scale: { x: 3, y: 1 },
      },
    );
  } finally {
    restore();
  }
});

test("frameOwnersReceiveEvents maps the target point through nested frame scales", async () => {
  const calls = [];
  const restore = setOverrides({
    cdpOverride(method, params, sessionId) {
      calls.push({ method, params, sessionId });
      return { result: { value: true } };
    },
  });
  try {
    assert.equal(
      await frameOwnersReceiveEvents(
        [
          {
            selector: "iframe#outer",
            sessionId: "main-session",
            x: 100,
            y: 50,
            scaleX: 2,
            scaleY: 2,
          },
          {
            selector: "iframe#inner",
            sessionId: "main-session",
            executionContextId: 101,
            x: 10,
            y: 20,
            scaleX: 1.5,
            scaleY: 0.5,
          },
        ],
        { x: 20, y: 30 },
      ),
      true,
    );
  } finally {
    restore();
  }

  assert.equal(calls.length, 2);
  assert.match(calls[0].params.expression, /"x":180,"y":120/);
  assert.equal(calls[0].params.contextId, undefined);
  assert.match(calls[1].params.expression, /"x":40,"y":35/);
  assert.equal(calls[1].params.contextId, 101);
});

test("frameOwnersReceiveEvents rejects an invalid owner selector as permanent", async () => {
  const restore = setOverrides({
    cdpOverride() {
      return {
        exceptionDetails: {
          exception: {
            description:
              "SyntaxError: Failed to execute 'querySelectorAll': not a valid selector",
          },
        },
      };
    },
  });
  try {
    await assert.rejects(
      () =>
        frameOwnersReceiveEvents(
          [
            {
              selector: "iframe[",
              sessionId: "main-session",
              x: 0,
              y: 0,
              scaleX: 1,
              scaleY: 1,
            },
          ],
          { x: 10, y: 20 },
        ),
      (error) => {
        assert.ok(error instanceof ElementResolutionError);
        assert.equal(error.kind, "permanent");
        return true;
      },
    );
  } finally {
    restore();
  }
});

test("resolveFrameContext classifies an ambiguous frame selector as permanent", async () => {
  const restore = setOverrides({
    sessionId: "main-session",
    sessionTargetId: "tab-1",
    sessionAt: Date.now(),
    cdpOverride(method) {
      if (method === "Runtime.evaluate") {
        return {
          exceptionDetails: {
            exception: {
              description: "Frame locator iframe matched 2 elements",
            },
          },
        };
      }
      throw new Error(`Unexpected CDP method: ${method}`);
    },
  });
  try {
    await assert.rejects(
      () => resolveFrameContext(["iframe"]),
      (error) => {
        assert.ok(error instanceof ElementResolutionError);
        assert.equal(error.kind, "permanent");
        assert.match(error.message, /matched 2 elements/);
        return true;
      },
    );
  } finally {
    restore();
  }
});

test("resolveFrameContext treats owner context destruction as transient", async () => {
  const restore = setOverrides({
    sessionId: "main-session",
    sessionTargetId: "tab-1",
    sessionAt: Date.now(),
    cdpOverride(method) {
      if (method === "Runtime.evaluate") {
        throw new Error("Execution context was destroyed.");
      }
      throw new Error(`Unexpected CDP method: ${method}`);
    },
  });
  try {
    await assert.rejects(
      () => resolveFrameContext(["iframe#navigating"]),
      (error) => {
        assert.ok(error instanceof ElementResolutionError);
        assert.equal(error.kind, "transient");
        assert.match(error.message, /changed while resolving/);
        return true;
      },
    );
  } finally {
    restore();
  }
});

test("resolveFrameContext treats a missing frame object as transient", async () => {
  const restore = setOverrides({
    sessionId: "main-session",
    sessionTargetId: "tab-1",
    sessionAt: Date.now(),
    cdpOverride(method) {
      if (method === "Runtime.evaluate") return { result: {} };
      throw new Error(`Unexpected CDP method: ${method}`);
    },
  });
  try {
    await assert.rejects(
      () => resolveFrameContext(["iframe#delayed"]),
      (error) => {
        assert.ok(error instanceof ElementResolutionError);
        assert.equal(error.kind, "transient");
        assert.match(error.message, /matched 0 elements/);
        return true;
      },
    );
  } finally {
    restore();
  }
});

test("resolveFrameContext treats a missing frameId as transient", async () => {
  let released = false;
  const restore = setOverrides({
    sessionId: "main-session",
    sessionTargetId: "tab-1",
    sessionAt: Date.now(),
    cdpOverride(method) {
      if (method === "Runtime.evaluate") {
        return { result: { objectId: "frame-owner" } };
      }
      if (method === "Runtime.callFunctionOn") {
        return {
          result: {
            value: { x: 0, y: 0, width: 300, height: 200 },
          },
        };
      }
      if (method === "DOM.describeNode") return { node: {} };
      if (method === "Runtime.releaseObject") {
        released = true;
        return {};
      }
      throw new Error(`Unexpected CDP method: ${method}`);
    },
  });
  try {
    await assert.rejects(
      () => resolveFrameContext(["iframe#loading"]),
      (error) => {
        assert.ok(error instanceof ElementResolutionError);
        assert.equal(error.kind, "transient");
        assert.match(error.message, /has no frameId/);
        return true;
      },
    );
    assert.equal(released, true);
  } finally {
    restore();
  }
});

test("resolveFrameContext treats a missing execution context as transient", async () => {
  let released = false;
  const restore = setOverrides({
    sessionId: "main-session",
    sessionTargetId: "tab-1",
    sessionAt: Date.now(),
    cdpOverride(method) {
      if (method === "Runtime.evaluate") {
        return { result: { objectId: "frame-owner" } };
      }
      if (method === "Runtime.callFunctionOn") {
        return {
          result: {
            value: { x: 0, y: 0, width: 300, height: 200 },
          },
        };
      }
      if (method === "DOM.describeNode") {
        return { node: { frameId: "loading-frame" } };
      }
      if (method === "Page.createIsolatedWorld") return {};
      if (method === "Runtime.releaseObject") {
        released = true;
        throw new Error("object already released");
      }
      throw new Error(`Unexpected CDP method: ${method}`);
    },
  });
  try {
    await assert.rejects(
      () => resolveFrameContext(["iframe#loading"]),
      (error) => {
        assert.ok(error instanceof ElementResolutionError);
        assert.equal(error.kind, "transient");
        assert.match(error.message, /has no execution context/);
        return true;
      },
    );
    assert.equal(released, true);
  } finally {
    restore();
  }
});

test("resolveFrameContext classifies a non-frame owner as permanent", async () => {
  const restore = setOverrides({
    sessionId: "main-session",
    sessionTargetId: "tab-1",
    sessionAt: Date.now(),
    cdpOverride(method) {
      if (method === "Runtime.evaluate") {
        return {
          exceptionDetails: {
            exception: {
              description:
                "Frame locator #content resolved to a non-frame element",
            },
          },
        };
      }
      throw new Error(`Unexpected CDP method: ${method}`);
    },
  });
  try {
    await assert.rejects(
      () => resolveFrameContext(["#content"]),
      (error) => {
        assert.ok(error instanceof ElementResolutionError);
        assert.equal(error.kind, "permanent");
        assert.match(error.message, /non-frame element/);
        return true;
      },
    );
  } finally {
    restore();
  }
});

test("resolveFrameContext classifies an invalid frame selector as permanent", async () => {
  const restore = setOverrides({
    sessionId: "main-session",
    sessionTargetId: "tab-1",
    sessionAt: Date.now(),
    cdpOverride(method) {
      if (method === "Runtime.evaluate") {
        return {
          exceptionDetails: {
            exception: {
              description:
                "SyntaxError: Failed to execute 'querySelectorAll' on 'Document': 'iframe[' is not a valid selector.",
            },
          },
        };
      }
      throw new Error(`Unexpected CDP method: ${method}`);
    },
  });
  try {
    await assert.rejects(
      () => resolveFrameContext(["iframe["]),
      (error) => {
        assert.ok(error instanceof ElementResolutionError);
        assert.equal(error.kind, "permanent");
        assert.match(error.message, /valid selector/);
        return true;
      },
    );
  } finally {
    restore();
  }
});

test("resolveFrameContext attaches to an out-of-process iframe target", async () => {
  const calls = [];
  const restore = setOverrides({
    sessionId: "main-session",
    sessionTargetId: "tab-1",
    sessionAt: Date.now(),
    cdpOverride(method, params, sessionId) {
      calls.push({ method, params, sessionId });
      if (method === "Runtime.evaluate") {
        return { result: { objectId: "frame-owner" } };
      }
      if (method === "Runtime.callFunctionOn") {
        return {
          result: {
            value: { x: 100, y: 50, width: 500, height: 400 },
          },
        };
      }
      if (method === "DOM.describeNode") {
        return { node: { frameId: "oopif-frame" } };
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
              targetId: "oopif-frame",
              type: "iframe",
              url: "https://cross-origin.example/frame",
            },
          ],
        };
      }
      if (method === "Target.attachToTarget") {
        assert.deepEqual(params, {
          targetId: "oopif-frame",
          flatten: true,
        });
        return { sessionId: "oopif-session" };
      }
      if (
        method === "Page.createIsolatedWorld" &&
        sessionId === "oopif-session"
      ) {
        return { executionContextId: 303 };
      }
      if (method === "Runtime.releaseObject") return {};
      throw new Error(`Unexpected CDP method: ${method}`);
    },
  });
  try {
    assert.deepEqual(await resolveFrameContext(["iframe#payment"]), {
      sessionId: "oopif-session",
      executionContextId: 303,
      frameId: "oopif-frame",
      offset: { x: 100, y: 50 },
      inputSessionId: "main-session",
    });
  } finally {
    restore();
  }

  assert.equal(
    calls.find((call) => call.method === "Target.getTargets")?.sessionId,
    undefined,
  );
});

test("resolveFrameContext deduplicates concurrent attachment to one out-of-process iframe", async () => {
  let attachCalls = 0;
  const restore = setOverrides({
    sessionId: "main-session",
    sessionTargetId: "tab-1",
    sessionAt: Date.now(),
    async cdpOverride(method, params, sessionId) {
      if (method === "Runtime.evaluate") {
        return { result: { objectId: "frame-owner" } };
      }
      if (method === "Runtime.callFunctionOn") {
        return {
          result: {
            value: { x: 100, y: 50, width: 500, height: 400 },
          },
        };
      }
      if (method === "DOM.describeNode") {
        return { node: { frameId: "concurrent-oopif-frame" } };
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
              targetId: "concurrent-oopif-frame",
              type: "iframe",
              url: "https://cross-origin.example/concurrent",
            },
          ],
        };
      }
      if (method === "Target.attachToTarget") {
        attachCalls += 1;
        await new Promise((resolve) => setImmediate(resolve));
        return { sessionId: "concurrent-oopif-session" };
      }
      if (
        method === "Page.createIsolatedWorld" &&
        sessionId === "concurrent-oopif-session"
      ) {
        return { executionContextId: 404 };
      }
      if (method === "Runtime.releaseObject") return {};
      throw new Error(`Unexpected CDP method: ${method}`);
    },
  });
  try {
    const contexts = await Promise.all([
      resolveFrameContext(["iframe#concurrent-payment"]),
      resolveFrameContext(["iframe#concurrent-payment"]),
    ]);
    assert.equal(attachCalls, 1);
    assert.deepEqual(
      contexts.map((context) => context.sessionId),
      ["concurrent-oopif-session", "concurrent-oopif-session"],
    );
  } finally {
    restore();
  }
});

test("resolveFrameContext reattaches after a cached out-of-process session is lost", async () => {
  let attachCalls = 0;
  let staleWorldCalls = 0;
  const restore = setOverrides({
    sessionId: "main-session",
    sessionTargetId: "tab-1",
    sessionAt: Date.now(),
    cdpOverride(method, params, sessionId) {
      if (method === "Runtime.evaluate") {
        return { result: { objectId: "frame-owner" } };
      }
      if (method === "Runtime.callFunctionOn") {
        return {
          result: {
            value: { x: 100, y: 50, width: 500, height: 400 },
          },
        };
      }
      if (method === "DOM.describeNode") {
        return { node: { frameId: "recovering-oopif-frame" } };
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
              targetId: "recovering-oopif-frame",
              type: "iframe",
              url: "https://cross-origin.example/recovering",
            },
          ],
        };
      }
      if (method === "Target.attachToTarget") {
        attachCalls += 1;
        return {
          sessionId:
            attachCalls === 1 ? "stale-oopif-session" : "fresh-oopif-session",
        };
      }
      if (
        method === "Page.createIsolatedWorld" &&
        sessionId === "stale-oopif-session"
      ) {
        staleWorldCalls += 1;
        if (staleWorldCalls > 1) {
          throw new Error("Session with given id not found");
        }
      }
      if (method === "Page.createIsolatedWorld") {
        return {
          executionContextId: sessionId === "stale-oopif-session" ? 501 : 502,
        };
      }
      if (method === "Runtime.releaseObject") return {};
      throw new Error(`Unexpected CDP method: ${method}`);
    },
  });
  try {
    assert.equal(
      (await resolveFrameContext(["iframe#recovering"])).sessionId,
      "stale-oopif-session",
    );
    assert.equal(
      (await resolveFrameContext(["iframe#recovering"])).sessionId,
      "fresh-oopif-session",
    );
    assert.equal(attachCalls, 2);
  } finally {
    restore();
  }
});

test("resolveFrameContext invalidates cached sessions from iframe lifecycle events", async () => {
  const originalEgo = globalThis.ego;
  let attachCalls = 0;
  globalThis.ego = {
    sendCDPMessage(payload) {
      const request = JSON.parse(payload);
      queueMicrotask(() => {
        if (!globalThis.ego?.onCDPMessage) return;
        if (
          request.method === "Page.createIsolatedWorld" &&
          request.sessionId === "main-session"
        ) {
          globalThis.ego.onCDPMessage(
            JSON.stringify({
              id: request.id,
              error: { message: "No frame for given id found" },
            }),
          );
          return;
        }
        let result = {};
        if (request.method === "Runtime.evaluate") {
          result = { result: { objectId: "frame-owner" } };
        } else if (request.method === "Runtime.callFunctionOn") {
          result = {
            result: {
              value: { x: 100, y: 50, width: 500, height: 400 },
            },
          };
        } else if (request.method === "DOM.describeNode") {
          result = { node: { frameId: "destroyed-oopif-frame" } };
        } else if (request.method === "Target.getTargets") {
          result = {
            targetInfos: [
              {
                targetId: "destroyed-oopif-frame",
                type: "iframe",
                url: "https://cross-origin.example/destroyed",
              },
            ],
          };
        } else if (request.method === "Target.attachToTarget") {
          attachCalls += 1;
          result = { sessionId: `destroyed-oopif-session-${attachCalls}` };
        } else if (request.method === "Page.createIsolatedWorld") {
          result = { executionContextId: 600 + attachCalls };
        }
        globalThis.ego.onCDPMessage(JSON.stringify({ id: request.id, result }));
      });
    },
  };
  const restore = setOverrides({
    cdpOverride: null,
    sessionId: "main-session",
    sessionTargetId: "tab-1",
    sessionAt: Date.now(),
  });
  try {
    assert.equal(
      (await resolveFrameContext(["iframe#destroyed"])).sessionId,
      "destroyed-oopif-session-1",
    );
    globalThis.ego.onCDPMessage(
      JSON.stringify({
        method: "Target.detachedFromTarget",
        params: { sessionId: "destroyed-oopif-session-1" },
      }),
    );
    assert.equal(
      (await resolveFrameContext(["iframe#destroyed"])).sessionId,
      "destroyed-oopif-session-2",
    );
    globalThis.ego.onCDPMessage(
      JSON.stringify({
        method: "Target.targetDestroyed",
        params: { targetId: "destroyed-oopif-frame" },
      }),
    );
    assert.equal(
      (await resolveFrameContext(["iframe#destroyed"])).sessionId,
      "destroyed-oopif-session-3",
    );
    assert.equal(attachCalls, 3);
  } finally {
    drainBrowserEvents();
    restore();
    if (originalEgo === undefined) delete globalThis.ego;
    else globalThis.ego = originalEgo;
  }
});
