import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  closeFixtureServer,
  startFixtureServer,
} from "../scripts/real-browser-e2e/fixture.mjs";
import { TEST_CASES } from "../test-site/test-cases.mjs";

const { createTestSiteApp } = await import("../test-site/dist/server.mjs");

const interactiveRoutes = [
  "clicks",
  "hover",
  "drag-drop",
  "canvas",
  "forms",
  "keyboard",
  "uploads",
  "scroll",
  "dialogs",
  "network",
];

test("Hono test site exposes a Vite development command", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../test-site/package.json", import.meta.url)),
  );

  assert.equal(packageJson.scripts.dev, "vite");
});

test("Hono test site exposes the health endpoint used by native Playwright e2e", async () => {
  const health = await createTestSiteApp("health-test").request("/healthz");
  assert.equal(health.status, 200);
  const payload = await health.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.taskName, "health-test");
  assert.equal(payload.fixture, "ego-browser-hono-test-site");
  assert.equal(typeof payload.now, "number");
});

test("Hono test site links and renders every dedicated browser scenario", async () => {
  const app = createTestSiteApp("routes-test");
  const home = await app.request("/");
  assert.equal(home.status, 200);
  const homeHtml = await home.text();

  for (const testCase of TEST_CASES) {
    assert.match(homeHtml, new RegExp(`href=["']${testCase.route}["']`));
    const response = await app.request(testCase.route);
    assert.equal(response.status, 200, testCase.route);
    const html = await response.text();
    assert.match(html, new RegExp(`<h1>${testCase.title}</h1>`));
    assert.match(html, new RegExp(`data-test-route=["']${testCase.route}["']`));
  }
});

test("interactive fixtures load served ES modules instead of inline scripts", async (t) => {
  const fixture = await startFixtureServer("module-test");
  t.after(() => closeFixtureServer(fixture.server));

  for (const slug of interactiveRoutes) {
    const response = await fetch(`${fixture.baseUrl}/tests/${slug}`);
    assert.equal(response.status, 200, slug);
    const html = await response.text();
    const modulePath = `/assets/${slug}.js`;

    assert.match(
      html,
      new RegExp(
        `<script[^>]+type=["']module["'][^>]+src=["']${modulePath}["'][^>]*></script>`,
      ),
      slug,
    );
    assert.doesNotMatch(html, /addEventListener\s*\(/, slug);

    const moduleResponse = await fetch(`${fixture.baseUrl}${modulePath}`);
    assert.equal(moduleResponse.status, 200, modulePath);
    assert.match(
      moduleResponse.headers.get("content-type") || "",
      /javascript/,
      modulePath,
    );
    assert.match(await moduleResponse.text(), /addEventListener/, modulePath);
  }
});
