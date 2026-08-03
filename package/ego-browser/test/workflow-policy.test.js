import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const workflowUrl = (name) =>
  new URL(`../../../.github/workflows/${name}`, import.meta.url);

const readWorkflow = (name) =>
  readFileSync(fileURLToPath(workflowUrl(name)), "utf8");

test("CI is the single branch verification workflow", () => {
  const workflow = readWorkflow("ci.yml");

  assert.match(workflow, /^name: CI$/m);
  assert.match(workflow, /^\s+pull_request:\s*$/m);
  assert.match(workflow, /branches:\s*\n\s+- "sprint-\*"\s*\n\s+- main/);
  assert.doesNotMatch(workflow, /^\s+tags:\s*$/m);
  assert.match(workflow, /^\s{2}verify:\s*$/m);
  assert.doesNotMatch(workflow, /^\s{2}release:\s*$/m);
  assert.match(workflow, /actions\/checkout@v7/);
  assert.match(workflow, /actions\/setup-node@v7/);
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /prettier --check/);
  assert.match(
    workflow,
    /npm audit --registry=https:\/\/registry\.npmjs\.org --audit-level=moderate/,
  );
  assert.match(workflow, /npm test/);
  assert.match(workflow, /npm run validate:site-skills/);
  assert.doesNotMatch(workflow, /npm run typecheck/);
});

test("release runs only for supported v-prefixed tags", () => {
  const url = workflowUrl("release.yml");
  assert.equal(existsSync(url), true, "release workflow must exist");

  const workflow = readWorkflow("release.yml");
  assert.match(workflow, /^name: Release$/m);
  assert.match(workflow, /tags:\s*\n\s+- "v\*\.\*\.\*"/);
  assert.doesNotMatch(workflow, /^\s+branches:\s*$/m);
  assert.doesNotMatch(workflow, /^\s+pull_request:\s*$/m);
  assert.match(workflow, /actions\/checkout@v7/);
  assert.match(workflow, /actions\/setup-node@v7/);
  assert.match(
    workflow,
    /npm ci[\s\S]*npm test[\s\S]*npm run validate:site-skills[\s\S]*Package release payload/,
  );
  assert.match(workflow, /\^v\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\$/);
  assert.match(
    workflow,
    /\^v\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+-beta\\\.\[0-9\]\+\$/,
  );
  assert.match(
    workflow,
    /else\s+echo "Unsupported release ref: \$ref_name"\s+exit 1/,
  );
  assert.doesNotMatch(workflow, /supported="false"/);
});

test("retired automation workflows stay removed", () => {
  for (const name of [
    "quality-gates.yml",
    "publish-ego-browser-skill.yml",
    "purge-camo-cache.yml",
  ]) {
    assert.equal(
      existsSync(workflowUrl(name)),
      false,
      `${name} must not exist`,
    );
  }
});
