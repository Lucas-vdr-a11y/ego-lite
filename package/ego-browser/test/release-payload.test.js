import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, cp, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parse } from "acorn";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const releaseDir = join(packageRoot, "dist", "out");

test("release entry contains no JavaScript comments", async () => {
  const source = await readFile(join(releaseDir, "index.js"), "utf8");
  const comments = [];

  parse(source, {
    allowHashBang: true,
    ecmaVersion: "latest",
    onComment: comments,
    sourceType: "module",
  });

  const javascriptComments = comments.filter(
    (comment) => comment.start !== 0 || comment.value !== "/usr/bin/env node",
  );

  assert.equal(
    javascriptComments.length,
    0,
    `unexpected comment: ${javascriptComments[0]?.value.trim().slice(0, 80)}`,
  );
});

test("release payload is a standalone JavaScript bundle", async (t) => {
  const tempDir = await mkdtemp(join(tmpdir(), "ego-release-payload-"));
  const isolatedReleaseDir = join(tempDir, "out");
  t.after(() => rm(tempDir, { recursive: true, force: true }));

  await cp(releaseDir, isolatedReleaseDir, { recursive: true });

  await assert.rejects(
    access(join(isolatedReleaseDir, "node_modules")),
    (error) => error.code === "ENOENT",
  );

  const standaloneDir = await realpath(isolatedReleaseDir);
  const result = spawnSync(
    process.execPath,
    [join(standaloneDir, "index.js")],
    {
      encoding: "utf8",
      input: 'console.log("standalone-bundle-ready")\n',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "standalone-bundle-ready");
});

test("release payload keeps stringified Playwright page functions self-contained", async () => {
  const source = await readFile(join(releaseDir, "index.js"), "utf8");
  const marker = "document.createTreeWalker";
  const markerIndexes = [];
  let offset = 0;
  while ((offset = source.indexOf(marker, offset)) >= 0) {
    markerIndexes.push(offset);
    offset += marker.length;
  }

  assert(markerIndexes.length > 0, "the bundle includes Playwright page code");
  for (const markerIndex of markerIndexes) {
    const prefix = source.slice(Math.max(0, markerIndex - 160), markerIndex);
    assert.doesNotMatch(
      prefix,
      /=[$A-Z_a-z][$\w]*\(\([^)]*\)=>\{/,
      "a function serialized into the page must not reference esbuild's keep-name helper",
    );
  }
});

test("release payload preserves bundled Playwright license notices", async () => {
  const notices = await readFile(
    join(releaseDir, "THIRD_PARTY_LICENSES.txt"),
    "utf8",
  );

  assert.match(notices, /playwright-core LICENSE/);
  assert.match(notices, /Apache License/);
  assert.match(notices, /playwright-core NOTICE/);
  assert.match(notices, /playwright-core ThirdPartyNotices\.txt/);
});
