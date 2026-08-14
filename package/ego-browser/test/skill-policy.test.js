import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const MAX_SKILL_BODY_LINES = 250;
const MAX_SKILL_BODY_WORDS = 3500;

const skill = readFileSync(
  new URL("../../../skills/ego-browser/SKILL.md", import.meta.url),
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
  assert.match(quickStart, /task\.page\.locator\('body'\)\.ariaSnapshot\(\)/);
  assert.doesNotMatch(quickStart, /task\.tabs|openOrReuse/);
  assert.doesNotMatch(skill, /Playwright `Browser`/);
  assert.doesNotMatch(skill, /`Browser\.(?:grantPermissions|setPermission)`/);
});

test("skill leaves the outer Bash timeout to the caller", () => {
  assert.doesNotMatch(skill, /outer timeout/i);
  assert.doesNotMatch(skill, /longest single in-script timeout/);
  assert.doesNotMatch(skill, /Playwright's 30-second default/);
  assert.match(
    skill,
    /All public time parameters and options use milliseconds/,
  );
});

test("skill keeps compatibility fetch and cdp helpers out of primary guidance", () => {
  const apiCategories = skill.match(
    /Scripts receive two categories of preloaded APIs:([\s\S]*?)\n\nThe native Playwright surface/,
  )?.[1];
  const egoBrowserApis = skill.match(
    /## 4\. ego-browser-specific APIs([\s\S]*?)(?=\n## )/,
  )?.[1];

  assert.ok(apiCategories);
  assert.match(apiCategories, /`egoBrowser` and `site`/);
  assert.doesNotMatch(apiCategories, /`fetch`|`cdp`/);
  assert.ok(egoBrowserApis);
  assert.doesNotMatch(egoBrowserApis, /\*\*`(?:fetch|cdp)`\*\*/);
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

test("skill makes the full-page snapshot the primary observation surface", () => {
  const snapshots = skill.match(
    /### 3\.2 Generate snapshots proactively([\s\S]*?)(?=\n### )/,
  )?.[1];

  assert.ok(snapshots);
  assert.match(snapshots, /primary observation surface/);
  // The default surface carries no references; refs are a scoped second step.
  assert.match(snapshots, /locator\('body'\)\.ariaSnapshot\(\)/);
  assert.match(snapshots, /A plain snapshot carries no references/);
  assert.match(snapshots, /ariaSnapshot\(\{ ref: true \}\)/);
  assert.match(snapshots, /proactively/);
  assert.doesNotMatch(snapshots, /smallest sufficient scope/);
  assert.doesNotMatch(snapshots, /only when the next decision requires/);
  assert.match(snapshots, /aria-ref=/);
  assert.doesNotMatch(skill, /egoBrowser\.snapshot/);
});

test("skill documents concise user-visible state for pointer actions", () => {
  const egoBrowserApis = skill.match(
    /## 4\. ego-browser-specific APIs([\s\S]*?)(?=\n## )/,
  )?.[1];

  assert.ok(egoBrowserApis);
  assert.match(
    egoBrowserApis,
    /await egoBrowser\.showTaskState\('open account settings'\)/,
  );
  assert.match(egoBrowserApis, /3-6 words/);
  assert.match(
    egoBrowserApis,
    /clicking, double-clicking, hovering, dragging, or scrolling/,
  );
  assert.match(egoBrowserApis, /call it once/);
});

test("profile reference limits Profile selection to explicit user requirements", () => {
  const profilerUrl = new URL(
    "../../../skills/ego-browser/references/profiler.md",
    import.meta.url,
  );
  assert.equal(existsSync(profilerUrl), true);
  const profiler = readFileSync(profilerUrl, "utf8");

  assert.match(profiler, /direct, declarative requirement/);
  assert.match(profiler, /explicitly requires a specific browser Profile/);
  assert.match(profiler, /newTaskSpace\(shortGoalName\)/);
  assert.match(profiler, /await egoBrowser\.listProfile\(\)/);
  assert.match(profiler, /newTaskSpace\(shortGoalName, profile\.id\)/);
  assert.match(profiler, /Do not infer/);
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
