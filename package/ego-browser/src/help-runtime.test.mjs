import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { help, formatHelp } from "../dist/src/help-runtime.js";

// Regression test for GitHub issue #84: fallback implementation docs are
// embedded at build time because the shipped .pak resource has no readable
// source path. Public facade-path docs are static and share their source of
// truth with structured CLI output.

test("help(name) returns the embedded doc instead of an empty result", () => {
  const doc = help({ click: () => {} }, "click");
  assert.equal(typeof doc, "object");
  assert.equal(doc.name, "click");
  assert.ok(
    doc.description && doc.description.length > 0,
    `expected a non-empty description, got: ${JSON.stringify(doc)}`,
  );
});

test("help() lists the helpers present in the context", () => {
  const list = help({ click: () => {}, waitFor: () => {} });
  assert.ok(Array.isArray(list));
  assert.ok(list.length > 0, "expected embedded docs to be non-empty");
  assert.ok(list.some((d) => d.name === "click"));
});

test("help(unknown) reports the unknown helper", () => {
  assert.equal(
    help({}, "definitelyNotAHelper"),
    "Unknown helper: definitelyNotAHelper",
  );
});

test("formatHelp renders the signature for an embedded doc", () => {
  const doc = help({ click: () => {} }, "click");
  const text = formatHelp(doc);
  assert.ok(text.includes("click("), `expected signature in:\n${text}`);
});

test("help works when the shipped bundle runs as an eval module", () => {
  // The app executes the SDK from an in-memory string, so its import.meta.url
  // ("file:///...[eval1]") is not a readable file — the exact condition that
  // broke the old self-introspection. Feed the real dist/out bundle to node
  // the same way and query help through the installed global, like an agent
  // script (a separate eval module sharing only globals) would. The file://
  // imports above cannot catch a regression of this class.
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const bundle = readFileSync(join(root, "dist", "out", "index.js"), "utf-8");
  // globalThis, not a bare identifier: appended source shares the bundle's
  // module scope, where the raw help(helpers, ...names) export would shadow
  // the installed global wrapper.
  const probe = [
    'console.log(globalThis.help("click"))',
    'console.log(globalThis.help("page.mouse.move"))',
    'console.log(globalThis.help("egoBrowser.switchTaskSpace"))',
  ].join(";\n");
  const result = spawnSync(process.execPath, ["--input-type=module"], {
    input: `${bundle}\n${probe}\n`,
    encoding: "utf-8",
    timeout: 30_000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(
    !result.stdout.includes("Unknown helper"),
    `docs map was empty under eval loading:\n${result.stdout}`,
  );
  assert.ok(
    result.stdout.includes("Ambiguous helper name") &&
      result.stdout.includes("locator.click") &&
      result.stdout.includes("page.mouse.click"),
    `expected ambiguous bare-name guidance in:\n${result.stdout}`,
  );
  assert.ok(
    result.stdout.includes("page.mouse.move("),
    `expected facade-path mouse help in:\n${result.stdout}`,
  );
  assert.ok(
    result.stdout.includes("egoBrowser.switchTaskSpace("),
    `expected facade-path task-space help in:\n${result.stdout}`,
  );
});
