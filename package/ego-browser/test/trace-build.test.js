import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const releaseBundlePath = join(packageRoot, "dist", "out", "index.js");
const diagnosticBundlePath = join(
  packageRoot,
  "dist",
  "out",
  "index.diagnostic.js",
);
const diagnosticBundle = existsSync(diagnosticBundlePath);
const bundlePath = diagnosticBundle ? diagnosticBundlePath : releaseBundlePath;
const bundleSource = readFileSync(bundlePath, "utf8");

function runBundleWithTraceTarget(target) {
  return spawnSync(process.execPath, [bundlePath], {
    cwd: packageRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      EGO_BROWSER_TRACE_FILE: target,
    },
    input: 'console.log("trace build probe")\n',
  });
}

test(
  "release bundle excludes tracing and ignores an accidental trace variable",
  { skip: diagnosticBundle },
  () => {
    assert.equal(existsSync(diagnosticBundlePath), false);
    assert.doesNotMatch(bundleSource, /EGO_BROWSER_DIAGNOSTIC_BUILD/);
    assert.doesNotMatch(bundleSource, /EGO_BROWSER_TRACE_FILE/);
    assert.doesNotMatch(bundleSource, /appendFileSync/);

    const directory = mkdtempSync(join(tmpdir(), "ego-release-trace-"));
    const target = join(directory, "trace.log");
    try {
      const result = runBundleWithTraceTarget(target);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /trace build probe/);
      assert.equal(existsSync(target), false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

test(
  "diagnostic bundle writes only when the trace variable is provided",
  { skip: !diagnosticBundle },
  () => {
    assert.equal(existsSync(releaseBundlePath), false);
    assert.match(bundleSource, /EGO_BROWSER_TRACE_FILE/);
    assert.match(bundleSource, /appendFileSync/);

    const directory = mkdtempSync(join(tmpdir(), "ego-diagnostic-trace-"));
    const target = join(directory, "trace.log");
    try {
      const result = runBundleWithTraceTarget(target);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /trace build probe/);
      assert.equal(existsSync(target), true);
      const trace = readFileSync(target, "utf8");
      assert.match(trace, /run start/);
      assert.match(trace, /trace build probe/);
      assert.match(trace, /run end/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

test("the diagnostic trace script restores the release bundle afterwards", () => {
  const script = JSON.parse(
    readFileSync(join(packageRoot, "package.json"), "utf8"),
  ).scripts["test:diagnostic-trace"];

  // A diagnostic build replaces dist/out and leaves no index.js, which `bin`
  // and the real-browser E2E runner both resolve. Rebuilding has to happen even
  // when the diagnostic tests fail, so it cannot hang off `&&`.
  assert.match(script, /npm run build:diagnostic/u);
  assert.match(script, /node --test/u);
  assert.match(script, /;\s*status=\$\?;/u);
  assert.match(script, /npm run build\b/u);
  assert.match(script, /exit \$status/u);
  assert.doesNotMatch(script, /node --test[^;]*&&\s*npm run build\b/u);
});
