import test from "node:test";
import assert from "node:assert/strict";

import { helperContext, initializePageFacade } from "../dist/src/helpers.js";
import {
  browserEvaluationSerializerSource,
  serializeEvaluationArgument,
} from "../dist/src/evaluation-serializer.js";
import { createElementHandle, createJSHandle } from "../dist/src/js-handle.js";
import { waitForFunction } from "../dist/src/driver/waits.js";
import { setOverrides } from "../dist/src/state.js";

test("evaluation serialization follows Playwright for functions and custom toJSON values", () => {
  assert.deepEqual(serializeEvaluationArgument(() => {}).value, {
    v: "undefined",
  });

  const serializer = (0, eval)(browserEvaluationSerializerSource());
  class CustomValue {
    toJSON() {
      return { answer: 42 };
    }
  }
  assert.deepEqual(serializer.parse(serializer.serialize(new CustomValue())), {
    answer: 42,
  });
  assert.deepEqual(serializer.parse(serializer.serialize({ toJSON() {} })), {
    toJSON: {},
  });
});

test("page.evaluate accepts nested JSHandles and Playwright serializable values", async () => {
  const calls = [];
  const restore = setOverrides({
    sessionId: "session-evaluate",
    sessionTargetId: "target-evaluate",
    sessionAt: Date.now(),
    cdpOverride(method, params, sessionId) {
      calls.push({ method, params, sessionId });
      if (method === "Runtime.evaluate") {
        return {
          result: { type: "object", objectId: "evaluation-global" },
        };
      }
      if (method === "Runtime.callFunctionOn") {
        return {
          result: {
            value: {
              o: [
                { k: "date", v: { d: "2026-08-01T00:00:00.000Z" } },
                { k: "regexp", v: { r: { p: "ego.+", f: "gi" } } },
                { k: "bigint", v: { bi: "9007199254740993" } },
                { k: "nan", v: { v: "NaN" } },
                { k: "negativeZero", v: { v: "-0" } },
                { k: "typed", v: { ta: { b: "BwAJAA==", k: "ui16" } } },
                {
                  k: "cyclic",
                  v: {
                    o: [{ k: "self", v: { ref: 2 } }],
                    id: 2,
                  },
                },
              ],
              id: 1,
            },
          },
        };
      }
      if (method === "Runtime.releaseObject") return {};
      return {};
    },
  });
  const handle = createJSHandle(
    { type: "object", objectId: "argument-handle" },
    "session-evaluate",
  );
  const cyclic = {};
  cyclic.self = cyclic;

  try {
    const result = await helperContext().page.evaluate((value) => value, {
      handle,
      date: new Date("2026-08-01T00:00:00.000Z"),
      regexp: /ego.+/gi,
      bigint: 9007199254740993n,
      nan: Number.NaN,
      negativeZero: -0,
      typed: new Uint16Array([7, 9]),
      cyclic,
    });

    assert.equal(result.date.toISOString(), "2026-08-01T00:00:00.000Z");
    assert.equal(result.regexp.source, "ego.+");
    assert.equal(result.regexp.flags, "gi");
    assert.equal(result.bigint, 9007199254740993n);
    assert.ok(Number.isNaN(result.nan));
    assert.ok(Object.is(result.negativeZero, -0));
    assert.deepEqual([...result.typed], [7, 9]);
    assert.equal(result.cyclic.self, result.cyclic);

    const evaluationCall = calls.find(
      ({ method, params }) =>
        method === "Runtime.callFunctionOn" &&
        params.arguments?.some(
          (argument) => argument.objectId === "argument-handle",
        ),
    );
    assert.ok(evaluationCall, "expected JSHandle to be passed by objectId");
  } finally {
    await handle.dispose();
    restore();
  }
});

test("page.evaluate rejects disposed and foreign-context JSHandles", async () => {
  const restore = setOverrides({
    sessionId: "session-current",
    sessionTargetId: "target-current",
    sessionAt: Date.now(),
    cdpOverride(method) {
      if (method === "Runtime.evaluate") {
        return { result: { type: "object", objectId: "evaluation-global" } };
      }
      if (method === "Runtime.callFunctionOn") {
        return { result: { value: { v: "undefined" } } };
      }
      return {};
    },
  });
  const disposed = createJSHandle(
    { type: "object", objectId: "disposed-handle" },
    "session-current",
  );
  const foreign = createJSHandle(
    { type: "object", objectId: "foreign-handle" },
    "session-foreign",
  );

  try {
    await disposed.dispose();
    await assert.rejects(
      () => helperContext().page.evaluate((value) => value, disposed),
      /JSHandle is disposed!$/,
    );
    await assert.rejects(
      () => helperContext().page.evaluate((value) => value, foreign),
      /JSHandles can be evaluated only in the context they were created!$/,
    );
  } finally {
    await foreign.dispose();
    restore();
  }
});

test("page.evaluateHandle accepts JSHandle arguments and jsonValue preserves structured values", async () => {
  const calls = [];
  const restore = setOverrides({
    sessionId: "session-handle-evaluate",
    sessionTargetId: "target-handle-evaluate",
    sessionAt: Date.now(),
    cdpOverride(method, params, sessionId) {
      calls.push({ method, params, sessionId });
      if (method === "Runtime.evaluate") {
        return { result: { type: "object", objectId: "evaluation-global" } };
      }
      if (method === "Runtime.callFunctionOn" && !params.returnByValue) {
        return { result: { type: "object", objectId: "result-handle" } };
      }
      if (method === "Runtime.callFunctionOn") {
        return {
          result: {
            value: {
              o: [
                { k: "date", v: { d: "2026-08-01T01:02:03.000Z" } },
                { k: "bigint", v: { bi: "42" } },
                {
                  k: "cyclic",
                  v: { o: [{ k: "self", v: { ref: 2 } }], id: 2 },
                },
              ],
              id: 1,
            },
          },
        };
      }
      return {};
    },
  });
  const argumentHandle = createJSHandle(
    { type: "object", objectId: "argument-handle" },
    "session-handle-evaluate",
  );

  try {
    const resultHandle = await helperContext().page.evaluateHandle(
      ({ handle, bigint }) => ({
        handle,
        bigint,
        date: new Date(),
        cyclic: {},
      }),
      { handle: argumentHandle, bigint: 42n },
    );
    const value = await resultHandle.jsonValue();

    assert.equal(value.date.toISOString(), "2026-08-01T01:02:03.000Z");
    assert.equal(value.bigint, 42n);
    assert.equal(value.cyclic.self, value.cyclic);
    assert.ok(
      calls.some(
        ({ method, params }) =>
          method === "Runtime.callFunctionOn" &&
          !params.returnByValue &&
          params.arguments?.some(
            (argument) => argument.objectId === "argument-handle",
          ),
      ),
      "expected page.evaluateHandle to pass JSHandle by objectId",
    );

    await resultHandle.dispose();
  } finally {
    await argumentHandle.dispose();
    restore();
  }
});

function locatorEvaluationHarness() {
  const calls = [];
  const restore = setOverrides({
    sessionId: "session-locator-evaluate",
    sessionTargetId: "target-locator-evaluate",
    sessionAt: Date.now(),
    cdpOverride(method, params, sessionId) {
      calls.push({ method, params, sessionId });
      if (method === "Accessibility.queryAXTree") return { nodes: [] };
      if (method === "Runtime.evaluate" && !params.returnByValue) {
        return {
          result: {
            type: "object",
            objectId: String(params.expression).includes("querySelectorAll")
              ? "element-array"
              : "locator-element",
          },
        };
      }
      if (method === "Runtime.evaluate") return { result: { value: true } };
      if (method === "Runtime.callFunctionOn" && !params.returnByValue) {
        return { result: { type: "object", objectId: "locator-result" } };
      }
      if (method === "Runtime.callFunctionOn") {
        return { result: { value: true } };
      }
      return {};
    },
  });
  const handle = createJSHandle(
    { type: "object", objectId: "locator-argument" },
    "session-locator-evaluate",
  );
  return {
    calls,
    restore,
    handle,
    locator: helperContext().page.locator("#target"),
  };
}

test("locator.evaluate passes nested JSHandles by objectId", async () => {
  const { calls, restore, handle, locator } = locatorEvaluationHarness();
  try {
    assert.equal(
      await locator.evaluate((element, arg) => element === arg.handle, {
        handle,
      }),
      true,
    );
    assert.ok(
      calls.some(
        ({ method, params }) =>
          method === "Runtime.callFunctionOn" &&
          params.arguments?.some(
            (argument) => argument.objectId === "locator-argument",
          ),
      ),
    );
  } finally {
    await handle.dispose();
    restore();
  }
});

test("locator.evaluateAll passes nested JSHandles by objectId", async () => {
  const { calls, restore, handle, locator } = locatorEvaluationHarness();
  try {
    assert.equal(
      await locator.evaluateAll((elements, arg) => elements[0] === arg.handle, {
        handle,
      }),
      true,
    );
    assert.ok(
      calls.some(
        ({ method, params }) =>
          method === "Runtime.callFunctionOn" &&
          params.arguments?.some(
            (argument) => argument.objectId === "locator-argument",
          ),
      ),
    );
  } finally {
    await handle.dispose();
    restore();
  }
});

test("locator.evaluateHandle passes nested JSHandles by objectId", async () => {
  const { calls, restore, handle, locator } = locatorEvaluationHarness();
  try {
    const result = await locator.evaluateHandle(
      (element, arg) => ({ same: element === arg.handle }),
      { handle },
    );
    assert.ok(
      calls.some(
        ({ method, params }) =>
          method === "Runtime.callFunctionOn" &&
          !params.returnByValue &&
          params.arguments?.some(
            (argument) => argument.objectId === "locator-argument",
          ),
      ),
    );
    await result.dispose();
  } finally {
    await handle.dispose();
    restore();
  }
});

test("page.waitForFunction passes nested JSHandles by objectId", async () => {
  const calls = [];
  const restore = setOverrides({
    sessionId: "session-wait-function",
    sessionTargetId: "target-wait-function",
    sessionAt: Date.now(),
    cdpOverride(method, params, sessionId) {
      calls.push({ method, params, sessionId });
      if (method === "Runtime.evaluate") {
        return { result: { type: "object", objectId: "evaluation-global" } };
      }
      if (method === "Runtime.callFunctionOn") {
        return { result: { type: "boolean", value: true } };
      }
      return {};
    },
  });
  const argumentHandle = createJSHandle(
    { type: "object", objectId: "wait-argument" },
    "session-wait-function",
  );

  try {
    const result = await waitForFunction(
      (arg) => arg.handle && arg.bigint === 42n,
      { handle: argumentHandle, bigint: 42n },
      { timeout: 100 },
    );
    assert.equal(await result.jsonValue(), true);
    assert.ok(
      calls.some(
        ({ method, params }) =>
          method === "Runtime.callFunctionOn" &&
          params.arguments?.some(
            (argument) => argument.objectId === "wait-argument",
          ),
      ),
    );
    await result.dispose();
  } finally {
    await argumentHandle.dispose();
    restore();
  }
});

test("ElementHandle.evaluate passes nested JSHandles by objectId", async () => {
  const calls = [];
  const restore = setOverrides({
    sessionId: "session-element-handle",
    sessionTargetId: "target-element-handle",
    sessionAt: Date.now(),
    cdpOverride(method, params, sessionId) {
      calls.push({ method, params, sessionId });
      if (method === "Runtime.callFunctionOn") {
        return { result: { value: true } };
      }
      return {};
    },
  });
  const element = createElementHandle(
    { type: "object", subtype: "node", objectId: "element-handle" },
    "session-element-handle",
  );
  const argumentHandle = createJSHandle(
    { type: "object", objectId: "element-argument" },
    "session-element-handle",
  );

  try {
    assert.equal(
      await element.evaluate((node, arg) => node === arg.handle, {
        handle: argumentHandle,
      }),
      true,
    );
    assert.ok(
      calls.some(
        ({ method, params }) =>
          method === "Runtime.callFunctionOn" &&
          params.objectId === "element-handle" &&
          params.arguments?.some(
            (argument) => argument.objectId === "element-argument",
          ),
      ),
    );
  } finally {
    await Promise.all([element.dispose(), argumentHandle.dispose()]);
    restore();
  }
});

test("main Frame evaluate shares page context and accepts page JSHandles", async () => {
  const calls = [];
  const restore = setOverrides({
    sessionId: "session-frame-evaluate",
    sessionTargetId: "target-frame-evaluate",
    sessionAt: Date.now(),
    cdpOverride(method, params, sessionId) {
      calls.push({ method, params, sessionId });
      if (method === "Page.getFrameTree") {
        return {
          frameTree: {
            frame: {
              id: "main-frame",
              name: "",
              url: "https://example.com/",
            },
          },
        };
      }
      if (method === "Runtime.evaluate") {
        return { result: { type: "object", objectId: "evaluation-global" } };
      }
      if (method === "Runtime.callFunctionOn") {
        const expression = params.arguments?.[2]?.value || "";
        if (String(expression).includes("JSON.stringify")) {
          return {
            result: {
              value: JSON.stringify({
                url: "https://example.com/",
                title: "Example",
                w: 1000,
                h: 800,
                sx: 0,
                sy: 0,
                pw: 1000,
                ph: 800,
              }),
            },
          };
        }
        return { result: { value: true } };
      }
      return {};
    },
  });
  const argumentHandle = createJSHandle(
    { type: "object", objectId: "frame-argument" },
    "session-frame-evaluate",
  );

  try {
    const page = helperContext().page;
    await initializePageFacade(page);
    const frame = page.mainFrame();
    assert.ok(frame);
    assert.equal(
      await frame.evaluate((arg) => Boolean(arg.handle) && arg.bigint === 7n, {
        handle: argumentHandle,
        bigint: 7n,
      }),
      true,
    );
    assert.ok(
      calls.some(
        ({ method, params }) =>
          method === "Runtime.callFunctionOn" &&
          params.arguments?.some(
            (argument) => argument.objectId === "frame-argument",
          ),
      ),
    );
  } finally {
    await argumentHandle.dispose();
    restore();
  }
});
