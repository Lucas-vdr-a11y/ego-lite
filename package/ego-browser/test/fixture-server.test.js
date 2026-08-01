import assert from "node:assert/strict";
import test from "node:test";

import {
  closeFixtureServer,
  startFixtureServer,
} from "../scripts/real-browser-e2e/fixture.mjs";
import { TEST_CASES } from "../test-site/test-cases.mjs";

test("Hono test site exposes the health endpoint used by native Playwright e2e", async (t) => {
  const fixture = await startFixtureServer("health-test");
  t.after(() => closeFixtureServer(fixture.server));

  const health = await fetch(`${fixture.baseUrl}/healthz`);
  assert.equal(health.status, 200);
  const payload = await health.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.taskName, "health-test");
  assert.equal(payload.fixture, "ego-browser-hono-test-site");
  assert.equal(typeof payload.now, "number");
});

test("Hono test site links and renders every dedicated browser scenario", async (t) => {
  const fixture = await startFixtureServer("routes-test");
  t.after(() => closeFixtureServer(fixture.server));

  const home = await fetch(fixture.baseUrl);
  assert.equal(home.status, 200);
  const homeHtml = await home.text();

  for (const testCase of TEST_CASES) {
    assert.match(homeHtml, new RegExp(`href=["']${testCase.route}["']`));
    const response = await fetch(`${fixture.baseUrl}${testCase.route}`);
    assert.equal(response.status, 200, testCase.route);
    const html = await response.text();
    assert.match(html, new RegExp(`<h1>${testCase.title}</h1>`));
    assert.match(html, new RegExp(`data-test-route=["']${testCase.route}["']`));
  }
});
