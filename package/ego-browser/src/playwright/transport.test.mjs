import test from "node:test";
import assert from "node:assert/strict";

const transport = await import("../../dist/src/playwright/transport.js").catch(
  () => ({}),
);

test("Playwright transport leases are exposed from the transport module", () => {
  assert.equal(typeof transport.createEgoPlaywrightTransport, "function");
});
