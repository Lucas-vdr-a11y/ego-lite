import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

function readPlaywrightSource(relativePath) {
  return readFile(
    new URL(`../node_modules/playwright-core/${relativePath}`, import.meta.url),
    "utf8",
  );
}

test("the pinned Playwright still derives the css screenshot scale from the BrowserContext deviceScaleFactor option", async () => {
  const source = await readPlaywrightSource("lib/server/chromium/crPage.js");

  assert.match(
    source,
    /this\._browserContext\._options\.deviceScaleFactor[\s\S]{0,120}clip\.scale\s*\/=\s*deviceScaleFactor/,
    "crPage.js no longer divides the screenshot clip scale by BrowserContext._options.deviceScaleFactor. src/playwright/device-scale.ts exists only to feed that read; re-verify how screenshot({ scale: 'css' }) computes its scale on the new playwright-core before upgrading past 1.52.0.",
  );
});

test("the pinned Playwright still skips the viewport override when the page has no emulated size", async () => {
  const source = await readPlaywrightSource("lib/server/chromium/crPage.js");

  assert.match(
    source,
    /const emulatedSize = this\._page\.emulatedSize\(\);\s*if \(emulatedSize === null\)\s*return;/,
    "crPage.js _updateViewport no longer returns early on a null emulatedSize. That early return is the only reason writing deviceScaleFactor into BrowserContext._options cannot reach Emulation.setDeviceMetricsOverride and resize the user's real browser window; re-verify src/playwright/device-scale.ts against the new _updateViewport before upgrading past 1.52.0.",
  );
});

test("the pinned Playwright still installs the toImpl bridge on the in-process client connection", async () => {
  const source = await readPlaywrightSource("lib/inProcessFactory.js");

  assert.match(
    source,
    /clientConnection\.toImpl = /,
    "inProcessFactory.js no longer assigns clientConnection.toImpl. src/playwright/device-scale.ts has no other route from the client BrowserContext to its server-side object; re-verify the in-process bridge (and that playwright-runtime.cjs still loads lib/inprocess.js) before upgrading past 1.52.0.",
  );
  assert.match(
    source,
    /_dispatchers\.get\(x\._guid\)\._object/,
    "inProcessFactory.js no longer resolves a client object to its server-side _object through the dispatcher _guid. Re-verify what toImpl returns before upgrading past 1.52.0.",
  );
});
