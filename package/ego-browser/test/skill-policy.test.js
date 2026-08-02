import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const MAX_SKILL_BODY_LINES = 250;
const MAX_SKILL_BODY_WORDS = 3500;

const skill = readFileSync(
  new URL("../../../skills/ego-browser/SKILL.md", import.meta.url),
  "utf8",
);
const video = readFileSync(
  new URL("../../../skills/ego-browser/references/video.md", import.meta.url),
  "utf8",
);

test("skill uses the TaskSpace object model without documenting the removed Browser API", () => {
  const quickStart = skill.match(/## 2\. Quick start([\s\S]*?)## 3\./)?.[1];

  assert.ok(quickStart);
  assert.match(
    quickStart,
    /await egoBrowser\.newTaskSpace\('inspect example page'\)/,
  );
  assert.match(
    quickStart,
    /await task\.page\.goto\('https:\/\/example\.com', \{ waitUntil: 'load', timeout: 20000 \}\)/,
  );
  assert.match(quickStart, /task\.page\.(?:title|url)\(/);
  assert.doesNotMatch(quickStart, /task\.tabs|openOrReuse/);
  assert.doesNotMatch(skill, /Playwright `Browser`/);
  assert.doesNotMatch(skill, /`Browser\.(?:grantPermissions|setPermission)`/);
});

test("skill keeps outer Bash timeouts above aggregate in-script operation timeouts", () => {
  assert.match(
    skill,
    /longer than the sum of all sequential in-script locator, navigation, and event timeouts/,
  );
  assert.match(skill, /Playwright's 30-second default/);
  assert.match(skill, /shorter in-script timeout only for optional probes/);
  assert.match(skill, /do not shorten the outer Bash timeout/);
});

test("skill avoids mutating controls that already match the requested state", () => {
  const actAndVerify = skill.match(
    /### 3\.4 Act and verify([\s\S]*?)(?=\n## )/,
  )?.[1];

  assert.ok(actAndVerify);
  assert.match(actAndVerify, /final state/i);
  assert.match(actAndVerify, /already holds/i);
  assert.match(actAndVerify, /do not (?:repeat|change|mutate)/i);
});

test("skill routes video requests to current native TaskSpace guidance", () => {
  assert.match(
    skill,
    /\[Video recording support and current limitations\]\(references\/video\.md\)/,
  );
  assert.match(video, /`task\.page\.video\(\)` returns `null`/);
  assert.match(video, /There is currently no supported API/);
  assert.doesNotMatch(video, /await page\.screencast\.(?:start|stop)\(/);
  assert.match(video, /Do not call `task\.context\.browser\(\)\.newContext/);
});

test("skill body stays within line and word budgets", () => {
  const body = skill.replace(/^---\r?\n[\s\S]*?\r?\n---\s*/, "");
  const wordCount = body.trim().split(/\s+/).length;
  const lineCount = body.trimEnd().split(/\r?\n/).length;

  assert.ok(
    wordCount <= MAX_SKILL_BODY_WORDS,
    `SKILL body should stay at or below ${MAX_SKILL_BODY_WORDS} words; received ${wordCount}`,
  );
  assert.ok(
    lineCount <= MAX_SKILL_BODY_LINES,
    `SKILL body should stay at or below ${MAX_SKILL_BODY_LINES} lines; received ${lineCount}`,
  );
});
