import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("pre-commit branch freshness tracks main", async () => {
  const config = await readFile(
    new URL("../../../lefthook.yml", import.meta.url),
    "utf8",
  );
  const freshnessCheck = config.match(
    /    branch-up-to-date:[\s\S]*?(?=\n    [\w-]+:|\s*$)/,
  )?.[0];

  assert.ok(freshnessCheck, "branch-up-to-date hook exists");
  assert.match(freshnessCheck, /git fetch --quiet origin main/);
  assert.match(freshnessCheck, /origin\/main/);
  assert.doesNotMatch(freshnessCheck, /origin\/dev/);
});
