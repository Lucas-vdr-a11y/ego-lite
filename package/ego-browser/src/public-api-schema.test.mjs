import test from "node:test";
import assert from "node:assert/strict";

import {
  PUBLIC_API_SCHEMA,
  publicApiMarkdown,
  validatePublicApiOptions,
} from "../dist/src/public-api-schema.js";

test("the public API schema contains the v2 entry points and object methods", () => {
  const names = new Set(PUBLIC_API_SCHEMA.map((entry) => entry.name));
  for (const name of [
    "profiles",
    "taskSpace",
    "claimTaskSpace",
    "takeOverTaskSpace",
    "TaskSpace.spaceId",
    "TaskSpace.userPage",
    "TaskSpace.pages",
    "TaskSpace.tabs",
    "TaskSpace.openPage",
    "Page.snapshot",
    "Page.targetId",
    "Page.waitForURL",
    "Page.waitForTimeout",
    "Page.keyboard.press",
  ]) {
    assert(names.has(name), `missing public API schema entry: ${name}`);
  }
  assert.equal(names.has("TaskSpace.listPages"), false);
});

test("schema-driven option validation rejects unknown and invalid fields", () => {
  validatePublicApiOptions("taskSpace", { profileId: "Profile 2" });
  validatePublicApiOptions("Page.click", {
    button: "left",
    clickCount: 2,
    delay: 0,
  });

  assert.throws(
    () => validatePublicApiOptions("taskSpace", { profileId: "" }),
    /taskSpace profileId must be a non-empty string/,
  );
  assert.throws(
    () => validatePublicApiOptions("Page.click", { trial: true }),
    /unknown option: trial/,
  );
  assert.throws(
    () => validatePublicApiOptions("Page.goto", { timeout: 0 }),
    /timeout must be a positive number of milliseconds/,
  );
  assert.throws(
    () => validatePublicApiOptions("Page.click", { button: "primary" }),
    /button must be one of left, middle, right/,
  );
});

test("the generated reference contains signatures and option descriptions", () => {
  const markdown = publicApiMarkdown();
  assert.match(markdown, /`await profiles\(\)`/);
  assert.match(markdown, /`await taskSpace\(nameOrId, \{ profileId\? \}\)`/);
  assert.match(
    markdown,
    /`await task\.openPage\(url, \{ as\?, timeout\? \}\)`/,
  );
  assert.match(markdown, /`as` — Permanent Page label\.<br>`timeout`/);
  assert.match(markdown, /Open and durably label a new Page/);
});
