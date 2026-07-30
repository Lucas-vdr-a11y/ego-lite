import test from "node:test";
import assert from "node:assert/strict";

import { setOverrides } from "../dist/src/state.js";

test("serverFetch interprets timeout as milliseconds", async () => {
  const originalFetch = globalThis.fetch;
  const originalAbortTimeout = AbortSignal.timeout;
  let receivedTimeout;

  globalThis.fetch = async (_url, options) => ({
    ok: true,
    text: async () => {
      assert.ok(options.signal, "server fetch forwards an abort signal");
      return "ok";
    },
  });
  AbortSignal.timeout = (timeout) => {
    receivedTimeout = timeout;
    return new AbortController().signal;
  };

  try {
    const { serverFetch } = await import(
      `../dist/src/http.js?server-timeout-ms=${Date.now()}`
    );
    assert.equal(
      await serverFetch("https://example.test", { timeout: 1234 }),
      "ok",
    );
    assert.equal(receivedTimeout, 1234);
  } finally {
    globalThis.fetch = originalFetch;
    AbortSignal.timeout = originalAbortTimeout;
  }
});

test("browserFetch interprets timeout as milliseconds", async () => {
  let expression;
  const restore = setOverrides({
    cdpOverride: async (method, params) => {
      if (method === "Runtime.evaluate") {
        expression = params.expression;
        return { result: { type: "string", value: "ok" } };
      }
      return {};
    },
  });

  try {
    const { browserFetch } = await import("../dist/src/http.js");
    assert.equal(await browserFetch("/api/data", { timeout: 1234 }), "ok");
  } finally {
    restore();
  }

  assert.match(expression, /"timeout":1234/);
  assert.match(
    expression,
    /setTimeout\(\(\) => controller\.abort\(\), timeout\)/,
  );
});
