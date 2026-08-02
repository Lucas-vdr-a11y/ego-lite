import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const lockfile = JSON.parse(
  readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"),
);
const npmrcUrl = new URL("../.npmrc", import.meta.url);

test("project npm config uses the official npm registry", () => {
  assert.equal(existsSync(npmrcUrl), true);
  const npmrc = readFileSync(npmrcUrl, "utf8");

  assert.match(npmrc, /^registry=https:\/\/registry\.npmjs\.org\/$/m);
  assert.doesNotMatch(npmrc, /codeartifact|citrolabs-npm/);
});

test("package lock resolves external packages from the official npm registry", () => {
  const unexpectedRegistries = Object.entries(lockfile.packages)
    .filter(([, metadata]) => metadata?.resolved?.startsWith("http"))
    .filter(([, metadata]) => {
      return new URL(metadata.resolved).host !== "registry.npmjs.org";
    })
    .map(([packagePath, metadata]) => ({
      packagePath,
      resolved: metadata.resolved,
    }));

  assert.deepEqual(unexpectedRegistries, []);
});
