import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { egoSource } from "./ego-source.mjs";
import { closeFixtureServer, startFixtureServer } from "./fixture.mjs";
import { runCommand } from "./run-command.mjs";
import { e2eCases } from "./suites/index.mjs";
import {
  createNodeBridgeSmokeSource,
  nodeBridgeSmokeAssertionCount,
  parseNodeBridgeSmoke,
  validateNodeBridgeProbe,
} from "./suites/runtime/node-bridge-smoke.mjs";

const runnerDir = dirname(fileURLToPath(import.meta.url));
const packageDir = join(runnerDir, "..", "..");
const egoBrowserSdkPath = join(packageDir, "dist", "out", "index.js");
const xmlParserUrl = import.meta.resolve("fast-xml-parser");
const egoBrowserArgs = ["nodejs", "--sdk-path", egoBrowserSdkPath];
const execFileAsync = promisify(execFile);
const verboseCaseOutput =
  process.env.EGO_BROWSER_REAL_E2E_VERBOSE_CASE_OUTPUT === "1" ||
  process.env.EGO_BROWSER_REAL_E2E_VERBOSE_CASE_OUTPUT === "true";

export function createCaseContext(context, keepTaskSpace) {
  return { ...context, keepTaskSpace };
}

export function shouldRunE2eCase(testCase, onlyCases) {
  return onlyCases.size > 0
    ? onlyCases.has(testCase.name)
    : testCase.optIn !== true;
}

export function browserProcessChanged(before, after) {
  if (!before || !after || before.length === 0) return false;
  return before.join(",") !== after.join(",");
}

export function missingCaseResultMessage(error) {
  return (
    "ego lite browser crashed, restarted, or disconnected before " +
    `case-result.json was written (${error?.message || error})`
  );
}

export function suitePassed(results) {
  return results.every((result) => result.status !== "fail");
}

export function groupE2eCasesByKind(testCases) {
  const groups = { platform: [], runtime: [], scenario: [] };
  for (const testCase of testCases) {
    if (
      testCase?.kind !== "platform" &&
      testCase?.kind !== "runtime" &&
      testCase?.kind !== "scenario"
    ) {
      throw new TypeError(
        `real-browser e2e case ${JSON.stringify(testCase?.name)} requires an explicit kind`,
      );
    }
    groups[testCase.kind].push(testCase);
  }
  return groups;
}

export function e2eCaseRounds(testCase) {
  if (Array.isArray(testCase?.rounds)) {
    if (
      testCase.rounds.length === 0 ||
      testCase.rounds.some((round) => typeof round !== "function")
    ) {
      throw new TypeError(
        "real-browser e2e rounds must be non-empty functions",
      );
    }
    return testCase.rounds;
  }
  if (typeof testCase?.body !== "function") {
    throw new TypeError("real-browser e2e case requires body() or rounds[]");
  }
  return [testCase.body];
}

export function taskSpaceCleanupBody(taskName) {
  return `
    const cleanupTaskSpacePrefix = ${JSON.stringify(taskName)};
    const listedTaskSpaces = await egoBrowser.listTaskSpaces();
    const cleanupNames = listedTaskSpaces
      .filter(
        (space) =>
          space.name === cleanupTaskSpacePrefix ||
          space.name.startsWith(cleanupTaskSpacePrefix + " "),
      )
      .map((space) => space.name);
    for (const cleanupName of cleanupNames) {
      try {
        const result = keepTaskSpace
          ? await egoBrowser.completeTaskSpace(cleanupName)
          : await egoBrowser.closeTaskSpace(cleanupName);
        const userOwnedSkip =
          keepTaskSpace && result?.done === false && result?.skipped === "user-owned";
        if (result?.done !== true && !userOwnedSkip) {
          throw new Error("task space cleanup did not complete: " + cleanupName);
        }
      } catch (error) {
        if (!String(error?.message || error).includes("task space not found")) {
          throw error;
        }
      }
    }
    if (!keepTaskSpace) {
      const cleanupDeadline = Date.now() + 5_000;
      let leaked = [];
      do {
        const remaining = await egoBrowser.listTaskSpaces();
        leaked = remaining.filter(
          (space) =>
            space.name === cleanupTaskSpacePrefix ||
            space.name.startsWith(cleanupTaskSpacePrefix + " "),
        );
        if (leaked.length === 0) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      } while (Date.now() < cleanupDeadline);
      if (leaked.length > 0) {
        throw new Error(
          "task space cleanup leaked: " +
            leaked.map((space) => space.name).join(", "),
        );
      }
    }
    console.log(JSON.stringify({ cleanup: true, taskSpaces: cleanupNames }));
  `;
}

export async function waitForNodeRoundToSettle(delayMs = 300) {
  if (delayMs <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

export function partitionE2eCases(testCases, laneCount) {
  if (!Number.isInteger(laneCount) || laneCount < 1) {
    throw new TypeError("laneCount must be a positive integer");
  }
  const lanes = Array.from({ length: laneCount }, () => []);
  testCases.forEach((testCase, index) => {
    const explicitLane = Number.isInteger(testCase?.parallelLane)
      ? testCase.parallelLane
      : undefined;
    lanes[(explicitLane ?? index) % laneCount].push(testCase);
  });
  return lanes;
}

export function parallelTaskSpaceNames(taskName, laneCount) {
  return Array.from(
    { length: laneCount },
    (_, index) => `${taskName} web lane ${index + 1}`,
  );
}

export function webLaneTimeoutMs(testCases) {
  return testCases.reduce(
    (total, testCase) => total + (testCase.timeoutMs ?? 60_000),
    30_000,
  );
}

export function webLaneBody(testCases, reportPath) {
  const executions = testCases
    .map(
      (testCase) => `
        await runWebLaneCase(${JSON.stringify(testCase.name)}, async () => {
          ${testCase.body()}
        });
      `,
    )
    .join("\n");
  return `
    const webLaneResults = [];
    async function runWebLaneCase(name, run) {
      const startedAt = Date.now();
      const assertionsBefore = __assertionCount;
      try {
        await run();
        webLaneResults.push({
          name,
          status: "pass",
          durationMs: Date.now() - startedAt,
          assertions: __assertionCount - assertionsBefore,
        });
      } catch (error) {
        webLaneResults.push({
          name,
          status: "fail",
          durationMs: Date.now() - startedAt,
          assertions: __assertionCount - assertionsBefore,
          message: error?.message || String(error),
        });
      }
      await writeFile(${JSON.stringify(reportPath)}, JSON.stringify(webLaneResults));
    }
    ${executions}
    await writeFile(${JSON.stringify(reportPath)}, JSON.stringify(webLaneResults));
  `;
}

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
  const availableCaseNames = [
    "nodejs bridge smoke",
    ...e2eCases.map((testCase) => testCase.name),
  ];
  const unknownOnlyCases = [...onlyCases].filter(
    (name) => !availableCaseNames.includes(name),
  );
  if (unknownOnlyCases.length > 0) {
    console.error(
      `Unknown EGO_BROWSER_REAL_E2E_ONLY case(s): ${unknownOnlyCases.join(", ")}`,
    );
    console.error(`Available cases: ${availableCaseNames.join(", ")}`);
    process.exitCode = 2;
    return;
  }

  let server;
  let tempDir;
  let summaryPrinted = false;
  const context = {};
  const caseResults = [];
  let nextCaseResultId = 0;

  function recordResult(name, status, durationMs, assertionCount, message) {
    caseResults.push({ name, status, durationMs, assertionCount, message });
  }

  async function runNodeBridgeSmoke(timeoutMs = 15000) {
    const name = "nodejs bridge smoke";
    console.log(`-- ${name}`);
    const startedAt = Date.now();
    const marker = `EGO_NODEJS_BRIDGE_SMOKE_${Date.now()}`;
    // The output channel is the overridden console.log. typeof console.log is always
    // "function" (it is a Node built-in), so it cannot prove the SDK wired its sink.
    // The marker round-trip proves console.log output reaches stdout. The read-only
    // listTaskSpaces call verifies asynchronous SDK readiness and host IPC without
    // creating browser state; native Playwright is exercised by the platform suite.
    const source = createNodeBridgeSmokeSource(marker);
    try {
      const { stdout, stderr } = await runCommand(
        "ego-browser",
        egoBrowserArgs,
        {
          cwd: packageDir,
          egoBrowserSdkPath,
          echo: verboseCaseOutput,
          input: source,
          timeoutMs,
        },
      );
      const probe = parseNodeBridgeSmoke(`${stdout}\n${stderr}`, marker);
      const validation = validateNodeBridgeProbe(probe);
      if (!validation.ok) {
        throw new Error(
          `nodejs bridge smoke failed checks (${validation.failures.join(", ")}): ${JSON.stringify(probe)}`,
        );
      }
      const durationMs = Date.now() - startedAt;
      const assertionCount = nodeBridgeSmokeAssertionCount();
      recordResult(name, "pass", durationMs, assertionCount);
      console.log(
        `-- ${name} passed (${formatDuration(durationMs)}, ${assertionCount} assertions)`,
      );
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const message = error?.message || String(error);
      recordResult(name, "fail", durationMs, 0, message);
      console.error(
        `[FAIL] ${name} (${formatDuration(durationMs)}): ${message}`,
      );
    }
  }

  async function maybeRunNodeBridgeSmoke() {
    await runNodeBridgeSmoke();
  }

  async function runEgoCase(name, body, timeoutMs = 45000, options = {}) {
    const visible = options.visible !== false;
    if (visible) console.log(`-- ${name}`);
    const resultPath = join(tempDir, `case-result-${nextCaseResultId++}.json`);
    const source = egoSource(
      body,
      createCaseContext(
        {
          ...context,
          ...options.context,
          caseResultPath: resultPath,
        },
        keepTaskSpace,
      ),
    );
    const startedAt = Date.now();
    const processBefore = await egoLiteProcessIds();
    let commandStdout = "";
    let processAfter = null;
    await rm(resultPath, { force: true });
    try {
      const { stdout } = await runCommand("ego-browser", egoBrowserArgs, {
        cwd: packageDir,
        egoBrowserSdkPath,
        echo: verboseCaseOutput,
        input: source,
        timeoutMs,
      });
      commandStdout = stdout;
      const durationMs = Date.now() - startedAt;
      const caseResult = await readCaseResult(resultPath, stdout);
      if (!caseResult.ok) {
        const error = new Error(caseResult.error);
        error.stdout = stdout;
        throw error;
      }
      if (options.crashGraceMs > 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, options.crashGraceMs),
        );
      }
      processAfter = await egoLiteProcessIds();
      if (browserProcessChanged(processBefore, processAfter)) {
        const error = new Error(
          browserDisconnectedMessage(name, processBefore, processAfter),
        );
        error.browserDisconnected = true;
        error.stdout = stdout;
        throw error;
      }
      const assertions = caseResult.assertions;
      const result = {
        name,
        status: "pass",
        durationMs,
        assertionCount: assertions,
      };
      if (options.record !== false) {
        recordResult(name, "pass", durationMs, assertions);
      }
      if (visible) {
        console.log(
          `-- ${name} passed (${formatDuration(durationMs)}, ${assertions} assertions)`,
        );
      }
      return result;
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      processAfter ??= await egoLiteProcessIds();
      const disconnected =
        error?.browserDisconnected ||
        browserProcessChanged(processBefore, processAfter);
      const caseResult = await readCaseResult(
        resultPath,
        error?.stdout || commandStdout,
      );
      const message = disconnected
        ? browserDisconnectedMessage(name, processBefore, processAfter)
        : !caseResult.ok
          ? caseResult.error
          : error?.message || String(error);
      const assertions = caseResult.assertions;
      const result = {
        name,
        status: "fail",
        durationMs,
        assertionCount: assertions,
        message,
      };
      if (options.record !== false) {
        recordResult(name, "fail", durationMs, assertions, message);
      }
      if (visible) {
        console.error(
          `[FAIL] ${name} (${formatDuration(durationMs)}): ${message}`,
        );
      } else {
        console.error(`[${name}] ${message}`);
      }
      return result;
    }
  }

  async function maybeRunEgoCase(testCase, timeoutMs = 45000, options = {}) {
    if (!shouldRunE2eCase(testCase, onlyCases)) {
      console.log(`-- ${testCase.name} (skipped)`);
      recordResult(testCase.name, "skip", 0, 0);
      return;
    }
    const rounds = e2eCaseRounds(testCase);
    const caseTimeoutMs = testCase.timeoutMs ?? timeoutMs;
    if (rounds.length === 1) {
      try {
        await runEgoCase(testCase.name, rounds[0](), caseTimeoutMs, {
          crashGraceMs: testCase.crashGraceMs,
          context: options.context,
        });
      } finally {
        await waitForNodeRoundToSettle();
      }
      return;
    }

    console.log(`-- ${testCase.name}`);
    const startedAt = Date.now();
    let assertionCount = 0;
    let failedRound;
    for (let index = 0; index < rounds.length; index += 1) {
      const result = await runEgoCase(
        `${testCase.name} round ${index + 1}/${rounds.length}`,
        rounds[index](),
        caseTimeoutMs,
        {
          visible: false,
          record: false,
          crashGraceMs: testCase.crashGraceMs,
          context: options.context,
        },
      );
      assertionCount += result.assertionCount;
      await waitForNodeRoundToSettle();
      if (result.status === "fail") {
        failedRound = { index, result };
        break;
      }
    }
    const durationMs = Date.now() - startedAt;
    if (failedRound) {
      const message = `round ${failedRound.index + 1}/${rounds.length}: ${failedRound.result.message}`;
      recordResult(testCase.name, "fail", durationMs, assertionCount, message);
      console.error(
        `[FAIL] ${testCase.name} (${formatDuration(durationMs)}): ${message}`,
      );
    } else {
      recordResult(testCase.name, "pass", durationMs, assertionCount);
      console.log(
        `-- ${testCase.name} passed (${formatDuration(durationMs)}, ${assertionCount} assertions)`,
      );
    }
  }

  async function runWebCasesInParallel(testCases, taskSpaceNames) {
    const runnableCases = [];
    for (const testCase of testCases) {
      if (shouldRunE2eCase(testCase, onlyCases)) {
        runnableCases.push(testCase);
      } else {
        console.log(`-- ${testCase.name} (skipped)`);
        recordResult(testCase.name, "skip", 0, 0);
      }
    }
    const lanes = partitionE2eCases(runnableCases, taskSpaceNames.length);
    await Promise.all(
      lanes.map(async (lane, index) => {
        if (lane.length === 0) return;
        const laneName = `web lane ${index + 1}`;
        const laneReportPath = join(
          tempDir,
          `${laneName.replaceAll(" ", "-")}.json`,
        );
        await rm(laneReportPath, { force: true });
        console.log(
          `-- ${laneName}: ${lane.map((testCase) => testCase.name).join(", ")}`,
        );
        const laneResult = await runEgoCase(
          laneName,
          webLaneBody(lane, laneReportPath),
          webLaneTimeoutMs(lane),
          {
            visible: false,
            record: false,
            context: { taskName: taskSpaceNames[index] },
          },
        );
        if (laneResult.status === "fail") {
          let completedResults = [];
          try {
            completedResults = JSON.parse(
              await readFile(laneReportPath, "utf8"),
            );
          } catch {
            // The lane exited before its first page completed.
          }
          const completedByName = new Map(
            completedResults.map((result) => [result.name, result]),
          );
          for (const testCase of lane) {
            const completed = completedByName.get(testCase.name);
            if (completed) {
              recordResult(
                completed.name,
                completed.status,
                completed.durationMs,
                completed.assertions,
                completed.message,
              );
              const output = `-- ${completed.name} ${completed.status === "pass" ? "passed" : "failed"} (${formatDuration(completed.durationMs)}, ${completed.assertions} assertions)`;
              if (completed.status === "pass") console.log(output);
              else console.error(`[FAIL] ${output}: ${completed.message}`);
            } else {
              recordResult(
                testCase.name,
                "fail",
                laneResult.durationMs,
                0,
                laneResult.message,
              );
              console.error(`[FAIL] ${testCase.name}: ${laneResult.message}`);
            }
          }
          await waitForNodeRoundToSettle();
          return;
        }
        let laneCaseResults;
        try {
          laneCaseResults = JSON.parse(await readFile(laneReportPath, "utf8"));
        } catch (error) {
          laneCaseResults = lane.map((testCase) => ({
            name: testCase.name,
            status: "fail",
            durationMs: laneResult.durationMs,
            assertions: 0,
            message: `web lane result was not written: ${error?.message || error}`,
          }));
        }
        for (const result of laneCaseResults) {
          recordResult(
            result.name,
            result.status,
            result.durationMs,
            result.assertions,
            result.message,
          );
          const output = `-- ${result.name} ${result.status === "pass" ? "passed" : "failed"} (${formatDuration(result.durationMs)}, ${result.assertions} assertions)`;
          if (result.status === "pass") console.log(output);
          else console.error(`[FAIL] ${output}: ${result.message}`);
        }
        await waitForNodeRoundToSettle();
      }),
    );
  }

  async function cleanupTaskSpaces() {
    await runEgoCase(
      "task-space cleanup",
      taskSpaceCleanupBody(context.taskName),
      20000,
      { visible: false, crashGraceMs: 300 },
    );
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
    const ffmpegPath = await resolveExecutable(
      process.env.EGO_BROWSER_FFMPEG_PATH || "ffmpeg",
    );
    const ffprobePath = await resolveExecutable(
      process.env.EGO_BROWSER_FFPROBE_PATH || "ffprobe",
    );
    const taskName = `ego-lite real browser e2e ${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`;
    const webTaskSpaceNames = parallelTaskSpaceNames(taskName, 2);

    Object.assign(context, {
      artifactDir,
      explicitScreenshotPath,
      environmentScreenshotPath,
      ffmpegPath,
      ffprobePath,
      metadataPath,
      xmlParserUrl,
      taskName,
      tempDir,
      uploadPath,
      uploadPathTwo,
      webTaskSpaceNames,
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

    await maybeRunNodeBridgeSmoke();
    if (
      caseResults.some(
        (r) => r.name === "nodejs bridge smoke" && r.status === "fail",
      )
    ) {
      context.skipCleanup = true;
      printSummary(caseResults, Date.now() - totalStartedAt);
      summaryPrinted = true;
      process.exitCode = 1;
      return;
    }

    const groupedCases = groupE2eCasesByKind(e2eCases);
    const firstScenarioIndex = e2eCases.findIndex(
      (testCase) => testCase.kind === "scenario",
    );
    const serialBeforeScenarios = e2eCases.filter(
      (testCase, index) =>
        testCase.kind !== "scenario" && index < firstScenarioIndex,
    );
    const serialAfterScenarios = e2eCases.filter(
      (testCase, index) =>
        testCase.kind !== "scenario" && index > firstScenarioIndex,
    );
    for (const testCase of serialBeforeScenarios) {
      await maybeRunEgoCase(testCase);
    }
    await runWebCasesInParallel(groupedCases.scenario, webTaskSpaceNames);
    for (const testCase of serialAfterScenarios) {
      await maybeRunEgoCase(testCase);
    }
  } catch (error) {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = error?.code === "ENOENT" ? 127 : 1;
  } finally {
    if (context.taskName && !context.skipCleanup) {
      await cleanupTaskSpaces().catch((error) => {
        const message = error?.message || String(error);
        recordResult("task-space cleanup", "fail", 0, 0, message);
        console.error(`[task-space cleanup] ${message}`);
      });
    }
    if (server) {
      await closeFixtureServer(server);
    }
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
    if (!summaryPrinted && caseResults.length > 0) {
      printSummary(caseResults, Date.now() - totalStartedAt);
      if (!suitePassed(caseResults)) process.exitCode = 1;
    }
  }
}

async function egoLiteProcessIds() {
  if (process.platform !== "darwin") return null;
  try {
    const { stdout } = await execFileAsync("/usr/bin/pgrep", [
      "-x",
      "ego lite",
    ]);
    return stdout
      .split(/\s+/)
      .map((value) => value.trim())
      .filter(Boolean)
      .sort();
  } catch (error) {
    return error?.code === 1 ? [] : null;
  }
}

function browserDisconnectedMessage(name, before, after) {
  return (
    `ego lite browser crashed, restarted, or disconnected during ${name}; ` +
    `process changed from ${formatProcessIds(before)} to ${formatProcessIds(after)}`
  );
}

function formatProcessIds(processIds) {
  if (processIds === null) return "unavailable";
  if (processIds.length === 0) return "not running";
  return processIds.join(",");
}

async function resolveExecutable(command) {
  if (isAbsolute(command) || command.includes("/")) {
    await access(command, fsConstants.X_OK);
    return command;
  }
  for (const directory of String(process.env.PATH || "").split(delimiter)) {
    if (!directory) continue;
    const candidate = join(directory, command);
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Continue searching PATH.
    }
  }
  return command;
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

async function readCaseAssertionCount(resultPath, stdout) {
  return (await readCaseResult(resultPath, stdout)).assertions;
}

async function readCaseResult(resultPath, stdout) {
  try {
    const raw = await readFile(resultPath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      ok: parsed.ok === true,
      assertions: typeof parsed.assertions === "number" ? parsed.assertions : 0,
      error: parsed.error || "case-result.json reported failure",
    };
  } catch (error) {
    return {
      ok: false,
      assertions: extractAssertionCount(stdout),
      error: missingCaseResultMessage(error),
    };
  }
}

function extractAssertionCount(stdout) {
  if (!stdout) return 0;
  // Find the last JSON line with "assertions" from console.log output
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
  const resultOrder = new Map(
    [
      "nodejs bridge smoke",
      ...e2eCases.map((testCase) => testCase.name),
      "task-space cleanup",
    ].map((name, index) => [name, index]),
  );
  results = [...results].sort(
    (left, right) =>
      (resultOrder.get(left.name) ?? Number.MAX_SAFE_INTEGER) -
      (resultOrder.get(right.name) ?? Number.MAX_SAFE_INTEGER),
  );
  const total = results.length;
  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const skipped = results.filter((r) => r.status === "skip").length;
  const executed = passed + failed;
  const totalAssertions = results.reduce((sum, r) => sum + r.assertionCount, 0);

  console.log("");
  console.log("== E2E Summary ==");
  console.log(
    `  Passed:   ${passed}/${executed}${executed > 0 ? `  (${Math.round((passed / executed) * 100)}%)` : ""}`,
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
