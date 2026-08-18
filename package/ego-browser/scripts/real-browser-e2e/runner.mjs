import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { e2eCases } from "./cases/index.mjs";
import { egoSource } from "./ego-source.mjs";
import { closeFixtureServer, startFixtureServer } from "./fixture.mjs";
import { runCommand } from "./run-command.mjs";

const runnerDir = dirname(fileURLToPath(import.meta.url));
const packageDir = join(runnerDir, "..", "..");
const egoBrowserSdkPath = join(packageDir, "dist", "out", "index.js");
const egoBrowserArgs = ["nodejs", "--sdk-path", egoBrowserSdkPath];

export async function runRealBrowserE2e() {
  const keepTaskSpace =
    process.env.EGO_BROWSER_REAL_E2E_KEEP === "1" ||
    process.env.EGO_BROWSER_REAL_E2E_KEEP === "true";
  const onlyCases = new Set(
    (process.env.EGO_BROWSER_REAL_E2E_ONLY || "")
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean),
  );

  let server;
  let tempDir;
  let passed = false;
  const context = {};
  const caseResults = [];

  function recordResult(name, status, durationMs, assertionCount, message) {
    caseResults.push({ name, status, durationMs, assertionCount, message });
  }

  async function runEgoCase(name, body, timeoutMs = 45000) {
    console.log(`-- ${name}`);
    const source = egoSource(body, {
      ...context,
      keepTaskSpace: keepTaskSpace && passed,
    });
    const startedAt = Date.now();
    try {
      const { stdout } = await runCommand("ego-browser", egoBrowserArgs, {
        cwd: packageDir,
        egoBrowserSdkPath,
        env: {
          EGO_BROWSER_STATE_DIR: join(tempDir, "runtime-state"),
        },
        input: source,
        timeoutMs,
      });
      const durationMs = Date.now() - startedAt;
      const assertions = await readCaseAssertionCount(tempDir, stdout);
      recordResult(name, "pass", durationMs, assertions);
      console.log(
        `-- ${name} passed (${formatDuration(durationMs)}, ${assertions} assertions)`,
      );
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const message = error?.message || String(error);
      const assertions = await readCaseAssertionCount(tempDir, error?.stdout);
      recordResult(name, "fail", durationMs, assertions, message);
      console.error(
        `[FAIL] ${name} (${formatDuration(durationMs)}): ${message}`,
      );
    }
  }

  async function runExpectedTerminationCase(
    name,
    body,
    markerName,
    timeoutMs = 45000,
  ) {
    console.log(`-- ${name}`);
    const source = egoSource(body, {
      ...context,
      keepTaskSpace: keepTaskSpace && passed,
    });
    const startedAt = Date.now();
    let commandError;
    try {
      await runCommand("ego-browser", egoBrowserArgs, {
        cwd: packageDir,
        egoBrowserSdkPath,
        env: {
          EGO_BROWSER_STATE_DIR: join(tempDir, "runtime-state"),
        },
        input: source,
        timeoutMs,
      });
    } catch (error) {
      commandError = error;
    }

    const durationMs = Date.now() - startedAt;
    try {
      if (!commandError) {
        throw new Error("the browser script completed instead of terminating");
      }
      // The marker is written only after newPage() has returned. Its presence
      // distinguishes the intended hard stop from an unrelated startup error.
      await stat(join(tempDir, markerName));
      recordResult(name, "pass", durationMs, 1);
      console.log(
        `-- ${name} passed (${formatDuration(durationMs)}, expected termination)`,
      );
    } catch (error) {
      const message = error?.message || String(error);
      recordResult(name, "fail", durationMs, 0, message);
      console.error(
        `[FAIL] ${name} (${formatDuration(durationMs)}): ${message}`,
      );
    }
  }

  async function maybeRunTestCase(testCase) {
    if (onlyCases.size > 0 && !onlyCases.has(testCase.name)) {
      console.log(`-- ${testCase.name} (skipped)`);
      recordResult(testCase.name, "skip", 0, 0);
      return;
    }
    if (testCase.expectedTermination) {
      await runExpectedTerminationCase(
        testCase.name,
        testCase.body(),
        testCase.markerName,
        testCase.timeoutMs,
      );
      return;
    }
    await runEgoCase(testCase.name, testCase.body(), testCase.timeoutMs);
  }

  async function cleanupTaskSpace() {
    const beforeFails = caseResults.filter((r) => r.status === "fail").length;
    await runEgoCase(
      "cleanup",
      `
        try {
          const result = await completeTaskSpace(taskName, { keep: keepTaskSpace });
          cliLog(JSON.stringify({ cleanup: result }));
        } catch (error) {
          if (!String(error?.message || error).includes("task space not found")) {
            throw error;
          }
        }
      `,
      20000,
    );
    // Remove cleanup result and any failures it produced
    const cleanupResults = caseResults.filter((r) => r.name === "cleanup");
    for (const r of cleanupResults) {
      caseResults.splice(caseResults.indexOf(r), 1);
    }
  }

  const totalStartedAt = Date.now();

  try {
    console.log("== build ==");
    await runCommand("npm", ["run", "build"], { cwd: packageDir });
    await stat(egoBrowserSdkPath);

    tempDir = await mkdtemp(join(tmpdir(), "ego-browser-real-e2e-"));
    const artifactDir = join(tempDir, "artifacts");
    const uploadPath = join(tempDir, "fixture-upload.txt");
    const uploadPathTwo = join(tempDir, "fixture-upload-two.txt");
    const explicitScreenshotPath = join(artifactDir, "explicit-shot.png");
    const environmentScreenshotPath = join(artifactDir, "environment-shot.png");
    const metadataPath = join(tempDir, "metadata.json");
    const taskName = `ego-lite real browser e2e ${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`;

    Object.assign(context, {
      artifactDir,
      explicitScreenshotPath,
      environmentScreenshotPath,
      metadataPath,
      taskName,
      tempDir,
      uploadPath,
      uploadPathTwo,
    });

    await mkdir(artifactDir, { recursive: true });
    await writeFile(uploadPath, "ego-browser upload fixture\n", "utf8");
    await writeFile(uploadPathTwo, "second upload fixture\n", "utf8");

    const fixture = await startFixtureServer(taskName);
    server = fixture.server;
    Object.assign(context, { baseUrl: fixture.baseUrl });
    await initializeE2eEnvironment(context, tempDir);

    console.log("== E2E (real browser helpers) ==");
    console.log(`fixture: ${context.baseUrl}`);
    console.log(`task: ${taskName}`);
    console.log(`sdk: ${egoBrowserSdkPath}`);

    for (const testCase of e2eCases) await maybeRunTestCase(testCase);

    passed = caseResults.every((r) => r.status !== "fail");
    printSummary(caseResults, Date.now() - totalStartedAt);

    if (!passed) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = error?.code === "ENOENT" ? 127 : 1;
  } finally {
    if (context.taskName) {
      await cleanupTaskSpace().catch((error) => {
        console.error(`[cleanup] ${error?.message || error}`);
      });
    }
    if (server) {
      await closeFixtureServer(server);
    }
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}

async function initializeE2eEnvironment(context, tempDir) {
  const {
    artifactDir,
    baseUrl,
    metadataPath,
    taskName,
    uploadPath,
    uploadPathTwo,
  } = context;
  const healthUrl = `${baseUrl}/healthz`;
  const response = await fetch(healthUrl, {
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    throw new Error(`fixture health check failed: HTTP ${response.status}`);
  }
  const health = await response.json();
  if (health.taskName !== taskName || health.ok !== true) {
    throw new Error(
      `fixture health payload mismatch: ${JSON.stringify(health)}`,
    );
  }
  await stat(uploadPath);
  await stat(uploadPathTwo);
  await stat(artifactDir);
  await writeFile(
    metadataPath,
    JSON.stringify(
      {
        baseUrl,
        taskName,
        tempDir,
        artifactDir,
        startedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf8",
  );
}

async function readCaseAssertionCount(tempDir, stdout) {
  const resultPath = join(tempDir, "case-result.json");
  try {
    const raw = await readFile(resultPath, "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed.assertions === "number") return parsed.assertions;
  } catch {
    // file not written or not valid JSON — fall back to stdout
  }
  return extractAssertionCount(stdout);
}

function extractAssertionCount(stdout) {
  if (!stdout) return 0;
  // Find the last JSON line with "assertions" from cliLog output
  const lines = stdout.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.startsWith("{") && line.includes("assertions")) {
      try {
        const parsed = JSON.parse(line);
        if (typeof parsed.assertions === "number") return parsed.assertions;
      } catch {
        // not valid JSON, keep looking
      }
    }
  }
  return 0;
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function printSummary(results, totalMs) {
  const total = results.length;
  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const skipped = results.filter((r) => r.status === "skip").length;
  const totalAssertions = results.reduce((sum, r) => sum + r.assertionCount, 0);

  console.log("");
  console.log("== E2E Summary ==");
  console.log(
    `  Passed:   ${passed}/${total}${total > 0 ? `  (${Math.round((passed / total) * 100)}%)` : ""}`,
  );
  if (failed > 0) console.log(`  Failed:   ${failed}/${total}`);
  if (skipped > 0) console.log(`  Skipped:  ${skipped}/${total}`);
  console.log(`  Total time: ${formatDuration(totalMs)}`);
  console.log(`  Assertions: ${totalAssertions}`);
  console.log("");

  // Per-case detail table
  const nameWidth = Math.max(...results.map((r) => r.name.length), 4);
  console.log("  Cases:");
  for (const result of results) {
    const statusLabel =
      result.status === "pass"
        ? "PASS"
        : result.status === "fail"
          ? "FAIL"
          : "SKIP";
    const timing =
      result.status === "skip"
        ? "       "
        : formatDuration(result.durationMs).padStart(7);
    const assertions =
      result.status === "skip"
        ? "  -"
        : `  ${result.assertionCount} assertions`;
    console.log(
      `    ${result.name.padEnd(nameWidth)}  ${timing}  ${assertions}  ${statusLabel}`,
    );
  }

  // Failure details
  const failedResults = results.filter((r) => r.status === "fail");
  if (failedResults.length > 0) {
    console.log("");
    console.log("  Failures:");
    for (const result of failedResults) {
      console.log(`    - ${result.name}: ${result.message}`);
    }
  }

  console.log("");
}
