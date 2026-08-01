import assert from "node:assert/strict";
import test from "node:test";

import {
  closeFixtureServer,
  startFixtureServer,
} from "../scripts/real-browser-e2e/fixture.mjs";

test("fixture server exposes the health endpoint used by native Playwright e2e", async (t) => {
  const fixture = await startFixtureServer("health-test");
  t.after(() => closeFixtureServer(fixture.server));

  const health = await fetch(`${fixture.baseUrl}/healthz`);
  assert.equal(health.status, 200);
  const payload = await health.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.taskName, "health-test");
  assert.equal(payload.fixture, "ego-browser-real-e2e");
  assert.equal(typeof payload.now, "number");
});
