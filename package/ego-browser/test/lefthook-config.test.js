import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repoFile = (path) =>
  readFile(new URL(`../../../${path}`, import.meta.url), "utf8");

test("pre-commit branch freshness tracks main", async () => {
  const config = await repoFile("lefthook.yml");
  const freshnessCheck = config.match(
    /    branch-up-to-date:[\s\S]*?(?=\n    [\w-]+:|\s*$)/,
  )?.[0];

  assert.ok(freshnessCheck, "branch-up-to-date hook exists");
  assert.match(freshnessCheck, /git fetch --quiet origin main/);
  assert.match(freshnessCheck, /origin\/main/);
  assert.doesNotMatch(freshnessCheck, /origin\/dev/);
});

test("repository workflow routes sprint branches into main", async () => {
  const [sourcePolicy, ci, pullRequestTemplate, contributing, agents] =
    await Promise.all([
      repoFile(".github/workflows/main-pr-source.yml"),
      repoFile(".github/workflows/ci.yml"),
      repoFile(".github/pull_request_template.md"),
      repoFile("CONTRIBUTING.md"),
      repoFile("AGENTS.md"),
    ]);

  assert.match(sourcePolicy, /HEAD_REF: \$\{\{ github\.head_ref \}\}/);
  assert.match(sourcePolicy, /sprint-\?\*/);
  assert.doesNotMatch(sourcePolicy, /require-dev|dev branch/i);

  assert.match(ci, /- "sprint-\*"/);
  assert.doesNotMatch(ci, /^\s+- dev$/m);

  assert.match(pullRequestTemplate, /sprint-\*/);
  assert.doesNotMatch(
    pullRequestTemplate,
    /only `dev`|`dev` for normal changes/,
  );
  assert.match(contributing, /sprint-\*/);
  assert.doesNotMatch(contributing, /merge features into `dev`/);
  assert.match(agents, /sprint-\*/);
});
