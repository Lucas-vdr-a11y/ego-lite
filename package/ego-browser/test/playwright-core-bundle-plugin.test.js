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

test("the bundled injected script preserves missing native HTML semantics", async () => {
  assert.equal(typeof bundlePlugin.patchInjectedScriptSource, "function");
  const source = await readFile(
    new URL(
      "../node_modules/playwright-core/lib/generated/injectedScriptSource.js",
      import.meta.url,
    ),
    "utf8",
  );
  const patched = bundlePlugin.patchInjectedScriptSource(
    source,
    "generated/injectedScriptSource.js",
  );

  assert.match(patched, /\["col", "colgroup"\]\.includes/);
  assert.match(patched, /\["row", "rowgroup"\]\.includes/);
  assert.match(patched, /"SEARCH": \(\) => "search"/);
  assert.match(patched, /"DIR": \(\) => "list"/);
  assert.match(patched, /"GEOLOCATION": \(\) => "button"/);
  assert.match(
    patched,
    /return \["STYLE", "SCRIPT", "TEMPLATE"\]\.includes\(elementSafeTagName\(element\)\)/,
  );
  assert.match(
    patched,
    /\["FRAME", "IFRAME"\]\.includes\(element\.nodeName\)[\s\S]*getElementAccessibleName\(element, false\)/,
  );
  assert.match(
    patched,
    /if \(!childAriaNode && element === rootElement && !\["BODY", "HTML"\]\.includes\(element\.nodeName\)\)/,
  );
  assert.match(
    patched,
    /childAriaNode = \{ role: "generic", name: normalizeWhiteSpace\(getElementAccessibleName\(element, false\) \|\| ""\)/,
  );
  assert.match(
    patched,
    /activeModal && !element\.contains\(activeModal\) && !activeModal\.contains\(element\)/,
  );
  assert.match(
    patched,
    /\["BUTTON", "METER", "PROGRESS"\]\.includes\(tagName\)/,
  );
});
