import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { help, formatHelp } from "../dist/src/help-runtime.js";

test("help(name) returns current ego-browser API documentation", () => {
  const doc = help({ cdp() {} }, "cdp");
  assert.equal(typeof doc, "object");
  assert.equal(doc.name, "cdp");
  assert.match(doc.description, /Chrome DevTools Protocol/);
});

test("help() lists namespaces present in the current context", () => {
  const list = help({ egoBrowser: {}, site: {}, cdp() {} });
  assert.ok(Array.isArray(list));
  assert.ok(list.some((entry) => String(entry).startsWith("egoBrowser:")));
  assert.ok(list.some((entry) => String(entry).startsWith("site:")));
  assert.ok(list.some((entry) => entry?.name === "cdp"));
});

test("help(unknown) reports the unknown helper", () => {
  assert.equal(
    help({}, "definitelyNotAHelper"),
    "Unknown helper: definitelyNotAHelper",
  );
});

test("formatHelp renders a current public signature", () => {
  const doc = help({ cdp() {} }, "cdp");
  const text = formatHelp(doc);
  assert.match(text, /cdp\(method, params\?, sessionId\?, timeoutMs\?\)/);
});

test("help works when the shipped bundle runs as an eval module", () => {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const bundle = readFileSync(join(root, "dist", "out", "index.js"), "utf-8");
  const probe = [
    'console.log(globalThis.help("cdp"))',
    'console.log(globalThis.help("site"))',
    'console.log(globalThis.help("egoBrowser.switchTaskSpace"))',
  ].join(";\n");
  const result = spawnSync(process.execPath, ["--input-type=module"], {
    input: `${bundle}\n${probe}\n`,
    encoding: "utf-8",
    timeout: 30_000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /Unknown helper/);
  assert.match(
    result.stdout,
    /cdp\(method, params\?, sessionId\?, timeoutMs\?\)/,
  );
  assert.match(result.stdout, /site\.runTool/);
  assert.match(result.stdout, /egoBrowser\.switchTaskSpace/);
});
