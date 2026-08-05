import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import * as bundlePlugin from "../scripts/playwright-core-bundle-plugin.mjs";

test("the minified Playwright server keeps protocol error names stable", async () => {
  assert.equal(typeof bundlePlugin.patchPlaywrightServerErrors, "function");
  const source = await readFile(
    new URL(
      "../node_modules/playwright-core/lib/server/errors.js",
      import.meta.url,
    ),
    "utf8",
  );
  const patched = bundlePlugin.patchPlaywrightServerErrors(
    source,
    "server/errors.js",
  );

  assert.match(patched, /this\.name = "TimeoutError"/);
  assert.match(patched, /this\.name = "TargetClosedError"/);
});
