import test from "node:test";
import assert from "node:assert/strict";

import { waitForURLInPage } from "../../dist/src/driver/page-waits.js";

test("waitForURLInPage recovers from a transient execution-context change", async () => {
  let now = 0;
  let attempt = 0;
  const calls = [];
  const services = {
    async cdp(method, params, sessionId, timeoutMs) {
      calls.push([method, params, sessionId, timeoutMs]);
      attempt += 1;
      if (attempt === 1) {
        throw new Error("Execution context was destroyed");
      }
      return {
        result: {
          value:
            attempt === 2
              ? "https://example.test/loading"
              : "https://example.test/ready",
        },
      };
    },
    now: () => now,
    async sleep(ms) {
      now += ms;
    },
  };

  await waitForURLInPage(services, "session:page", /\/ready$/g, {
    timeout: 500,
  });

  assert.equal(attempt, 3);
  assert(
    calls.every(
      ([method, , sessionId, timeoutMs]) =>
        method === "Runtime.evaluate" &&
        sessionId === "session:page" &&
        timeoutMs > 0 &&
        timeoutMs <= 500,
    ),
  );
});
