import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { egoSource } from "./ego-source.mjs";
import { TEST_CASES } from "./site/test-cases.mjs";
import { e2eCases } from "./suites/index.mjs";
import { taskSpaceControlCase } from "./suites/platform/taskspace-control.mjs";
import { scenarioCases } from "./suites/scenarios/index.mjs";
import * as runner from "./runner.mjs";

const expectedWebTestRoutes = TEST_CASES.map((testCase) => testCase.route);

test("real-browser e2e preserves an explicitly requested task space", () => {
  assert.equal(typeof runner.createCaseContext, "function");
  assert.equal(
    runner.createCaseContext({ taskName: "checkout" }, true).keepTaskSpace,
    true,
  );
});

test("real-browser e2e runs opt-in cases only when explicitly selected", () => {
  assert.equal(typeof runner.shouldRunE2eCase, "function");
  const optInCase = { name: "native close regression", optIn: true };
  assert.equal(runner.shouldRunE2eCase(optInCase, new Set()), false);
  assert.equal(
    runner.shouldRunE2eCase(optInCase, new Set(["native close regression"])),
    true,
  );
});

test("real-browser e2e lets each embedded Node round settle before starting the next case", async () => {
  assert.equal(typeof runner.waitForNodeRoundToSettle, "function");
  const startedAt = Date.now();
  await runner.waitForNodeRoundToSettle(10);
  assert.ok(Date.now() - startedAt >= 5);
});

test("real-browser e2e partitions scenario cases across two independent TaskSpaces", () => {
  const cases = ["a", "b", "c", "d", "e"];
  assert.deepEqual(runner.partitionE2eCases(cases, 2), [
    ["a", "c", "e"],
    ["b", "d"],
  ]);
  assert.deepEqual(
    runner.partitionE2eCases(
      [
        { name: "left", parallelLane: 0 },
        { name: "right", parallelLane: 1 },
        { name: "left-again", parallelLane: 0 },
      ],
      2,
    ),
    [
      [
        { name: "left", parallelLane: 0 },
        { name: "left-again", parallelLane: 0 },
      ],
      [{ name: "right", parallelLane: 1 }],
    ],
  );
  assert.deepEqual(runner.parallelTaskSpaceNames("suite", 2), [
    "suite web lane 1",
    "suite web lane 2",
  ]);
});

test("real-browser e2e classifies platform and scenario cases explicitly", () => {
  assert.equal(typeof runner.groupE2eCasesByKind, "function");
  const platform = { name: "platform", kind: "platform" };
  const scenario = { name: "scenario", kind: "scenario" };
  const runtime = { name: "runtime", kind: "runtime" };

  assert.deepEqual(runner.groupE2eCasesByKind([scenario, runtime, platform]), {
    platform: [platform],
    runtime: [runtime],
    scenario: [scenario],
  });
  assert.throws(
    () => runner.groupE2eCasesByKind([{ name: "unclassified" }]),
    /explicit kind/,
  );
  assert(
    e2eCases.every((testCase) => testCase.kind),
    "every case has a kind",
  );
});

test("real-browser e2e exposes multi-round cases as separate Node executions", () => {
  assert.equal(typeof runner.e2eCaseRounds, "function");
  const single = () => "single";
  const first = () => "first";
  const second = () => "second";

  assert.deepEqual(runner.e2eCaseRounds({ body: single }), [single]);
  assert.deepEqual(runner.e2eCaseRounds({ rounds: [first, second] }), [
    first,
    second,
  ]);

  const crossRound = e2eCases.find(
    (testCase) => testCase.name === "TaskSpace cross-round persistence",
  );
  assert.ok(crossRound);
  assert.equal(crossRound.kind, "platform");
  assert.equal(crossRound.rounds.length, 2);
});

test("real-browser cleanup discovers every TaskSpace created under the run prefix", () => {
  assert.equal(typeof runner.taskSpaceCleanupBody, "function");
  const source = runner.taskSpaceCleanupBody("suite-run");
  assert.match(source, /space\.name === cleanupTaskSpacePrefix/);
  assert.match(
    source,
    /space\.name\.startsWith\(cleanupTaskSpacePrefix \+ " "\)/,
  );
  assert.match(source, /egoBrowser\.listTaskSpace\(\)/);
  assert.match(source, /task space cleanup leaked/);
});

test("parallel real-browser cases write isolated result files", () => {
  const source = egoSource("console.log('case')", {
    caseResultPath: "/tmp/e2e-results/case-7.json",
    xmlParserUrl: "file:///tmp/deps/fast-xml-parser/fxp.js",
  });
  assert.match(source, /caseResultPath = "\/tmp\/e2e-results\/case-7\.json"/);
  assert.match(
    source,
    /xmlParserUrl = "file:\/\/\/tmp\/deps\/fast-xml-parser\/fxp\.js"/,
  );
  assert.doesNotMatch(source, /join\(tempDir, "case-result\.json"\)/);

  const laneSource = runner.webLaneBody(
    [{ name: "web test: one", body: () => "assert(true, 'one')" }],
    "/tmp/e2e-results/lane-1.json",
  );
  assert.match(laneSource, /runWebLaneCase\("web test: one"/);
  assert.match(laneSource, /lane-1\.json/);
});

test("TaskSpace context lifecycle runs before existing real-browser cases", () => {
  assert.equal(e2eCases[0]?.name, "TaskSpace context lifecycle");
});

test("real-browser e2e maps every dedicated test-site route to one native Playwright case", () => {
  const webCases = e2eCases.filter((testCase) => testCase.kind === "scenario");

  assert.deepEqual(
    webCases.map((testCase) => testCase.route),
    expectedWebTestRoutes,
  );
  for (const testCase of webCases) {
    const source = testCase.body();
    assert.match(source, /task\.page/);
    assert.match(source, new RegExp(JSON.stringify(testCase.route)));
    assert.doesNotMatch(source, /task\.tabs|openOrReuse/);
  }
});

test("every web journey records start, completion, and failure in lifecycle order", () => {
  for (const testCase of scenarioCases) {
    const source = testCase.body();
    const start = source.indexOf('getByTestId("start-test").click()');
    const scenarioOperation = source.indexOf("/* scenario operations */");
    const finish = source.indexOf('getByTestId("finish-test").click()');
    const failure = source.indexOf("failButton.click()");

    assert(start >= 0, `${testCase.name} starts from its scenario control`);
    assert(
      scenarioOperation > start,
      `${testCase.name} performs scenario operations only after starting`,
    );
    assert(
      finish > scenarioOperation,
      `${testCase.name} records completion only after its assertions pass`,
    );
    assert(
      failure > finish,
      `${testCase.name} records failure from its exception path`,
    );
    assert.match(source, /catch \(error\)[\s\S]*throw error/);
  }
});

test("TaskSpace context lifecycle covers isolation and stale Playwright handles", () => {
  const lifecycleCase = e2eCases.find(
    (testCase) => testCase.name === "TaskSpace context lifecycle",
  );

  assert.ok(lifecycleCase);
  const source = lifecycleCase.body();
  assert.match(source, /const lifecycleSpaceCount = 3/);
  assert.match(source, /context\.newPage/);
  assert.match(source, /switchTaskSpace/);
  assert.match(source, /assertDisconnected/);
  assert.match(source, /every\(\(url\) => url\.includes/);
  assert.match(source, /closeTaskSpace/);
});

test("Profile e2e covers implicit default, explicit selection, and invalid ids", () => {
  const profileCase = e2eCases.find(
    (testCase) => testCase.name === "TaskSpace profile selection",
  );

  assert.ok(profileCase);
  assert.equal(profileCase.kind, "platform");
  const source = profileCase.body();
  assert.match(source, /await egoBrowser\.listProfile\(\)/);
  assert.match(source, /newTaskSpace\(defaultName\)/);
  assert.match(source, /newTaskSpace\(explicitName, selectedProfile\.id\)/);
  assert.match(source, /EGO_PROFILE_NOT_FOUND/);
  assert.match(source, /egoBrowser\.closeTaskSpace\(defaultTask\.id\)/);
  assert.match(source, /egoBrowser\.closeTaskSpace\(explicitTask\.id\)/);
});

test("platform e2e covers ownership preservation, ARIA refs, and network routing", () => {
  const ownership = e2eCases.find(
    (testCase) => testCase.name === "TaskSpace ownership lifecycle",
  );
  const aria = e2eCases.find(
    (testCase) => testCase.name === "Playwright ARIA snapshot refs",
  );
  const routing = e2eCases.find(
    (testCase) => testCase.name === "Playwright network routing",
  );

  assert.ok(ownership);
  assert.match(
    ownership.body(),
    /egoBrowser\.completeTaskSpace\(scratch\.id\)/,
  );
  assert.match(ownership.body(), /ownership, "user"/);
  assert.match(ownership.body(), /egoBrowser\.claimTaskSpace\(scratch\.id\)/);
  assert.match(ownership.body(), /ownership, "agent"/);

  assert.ok(aria);
  assert.match(
    aria.body(),
    /locator\("body"\)\.ariaSnapshot\(\{ ref: true \}\)/,
  );
  assert.match(aria.body(), /localScope\.ariaSnapshot\(\{ ref: true \}\)/);
  assert.match(aria.body(), /aria-ref=/);

  assert.ok(routing);
  assert.match(routing.body(), /page\.route\(/);
  assert.match(routing.body(), /route\.fulfill\(/);
  assert.match(routing.body(), /page\.unroute\(/);
});

test("task-space keep mode does not create a destructively closed scratch space", () => {
  const source = taskSpaceControlCase();
  assert.match(
    source,
    /if \(!keepTaskSpace\) \{[\s\S]*egoBrowser\.newTaskSpace\(taskName \+ " scratch"\)[\s\S]*egoBrowser\.closeTaskSpace\(scratch\.id\)[\s\S]*\}/,
  );
});

test("web lane timeout covers the aggregate budget of every scenario", () => {
  assert.equal(runner.webLaneTimeoutMs([{}, { timeoutMs: 75_000 }]), 165_000);
});

test("task-space e2e verifies structured egoBrowser action results", () => {
  const source = taskSpaceControlCase();

  assert.match(source, /assertEqual\(closed\.done, true/);
  assert.match(source, /assertEqual\(handOffResult\.done, true/);
  assert.match(source, /assertEqual\(takeOverResult\.done, true/);
  assert.match(source, /assertEqual\(waitResult\.done, true/);
  assert.match(source, /ownership, "agentDelegatedToUser"/);
  assert.match(source, /waitFinished, false/);
  assert.match(source, /same-space reuse keeps the existing Page open/);
  assert.match(source, /failed TaskSpace selection preserves the current Page/);
});

test("agent-facing sources do not publish the removed browser tab namespace", () => {
  const sources = [
    readFileSync(
      new URL("../../../../skills/ego-browser/SKILL.md", import.meta.url),
      "utf8",
    ),
    readFileSync(new URL("../../README.md", import.meta.url), "utf8"),
    readFileSync(new URL("./preamble.mjs", import.meta.url), "utf8"),
    readFileSync(
      new URL(
        "../../../../skills/ego-browser/learnings/google/notes/overview.md",
        import.meta.url,
      ),
      "utf8",
    ),
    readFileSync(
      new URL(
        "../../../../skills/ego-browser/learnings/google/tools/search-extract.js",
        import.meta.url,
      ),
      "utf8",
    ),
    readFileSync(
      new URL(
        "../../../../skills/ego-browser/learnings/x-com/tools/search-users.js",
        import.meta.url,
      ),
      "utf8",
    ),
    ...e2eCases.flatMap((testCase) =>
      runner.e2eCaseRounds(testCase).map((round) => round()),
    ),
  ];
  const removedBrowserTabApi =
    /\b(?:ctx\.)?browser\.(?:listTabs|currentTab|switchTab|openOrReuseTab|closeTab|ensureRealTab|iframeTarget|evaluateInTab)\b/;

  for (const source of sources) {
    assert.doesNotMatch(source, removedBrowserTabApi);
  }
});

test("real-browser e2e does not mutate the shared user cookie jar", () => {
  const sources = e2eCases.flatMap((testCase) =>
    runner.e2eCaseRounds(testCase).map((round) => round()),
  );
  for (const source of sources) {
    assert.doesNotMatch(source, /\.addCookies\(|\.clearCookies\(/);
  }
});

test("real-browser e2e covers the current TaskSpace video capability", () => {
  const videoCase = e2eCases.find(
    (testCase) => testCase.name === "TaskSpace video capability",
  );

  assert.ok(videoCase);
  assert.notEqual(videoCase.optIn, true);
  const source = videoCase.body();
  assert.match(source, /task\.page\.video\(\)/);
  assert.match(source, /assertEqual\([\s\S]*null/);
  assert.match(source, /task\.page\.screencast/);
  assert.match(source, /task\.page\.goto/);
});

test("native task-space close regression remains a dedicated opt-in e2e", () => {
  const regression = e2eCases.find(
    (testCase) => testCase.name === "native task space close regression",
  );
  assert.ok(regression);
  assert.equal(regression.optIn, true);
  const source = regression.body();
  assert.match(source, /window\.open/);
  assert.match(source, /scratch\.page\.waitForEvent\("dialog"/);
  assert.match(source, /assertEqual\(closeResult\.done, true/);
  assert.match(source, /restoredOriginal\.page\.goto/);
});

test("real-browser e2e exercises native Playwright by default", () => {
  const playwrightCase = e2eCases.find(
    (testCase) => testCase.name === "native Playwright TaskSpace",
  );
  assert.ok(playwrightCase);
  assert.notEqual(playwrightCase.optIn, true);
  const source = playwrightCase.body();
  assert.match(source, /task\.page\.goto/);
  assert.match(source, /task\.context\.newPage/);
  assert.doesNotMatch(source, /task\.tabs|openOrReuse/);
  assert.doesNotMatch(source, /scenario-test-controls|start-test|fail-test/);
});

test("test-site progress reporting is isolated from the Playwright platform case", () => {
  const progressCase = e2eCases.find(
    (testCase) => testCase.name === "test-site scenario progress",
  );
  assert.ok(progressCase);
  assert.equal(progressCase.kind, "runtime");
  const source = progressCase.body();
  assert.match(source, /scenario-test-controls/);
  assert.match(source, /start-test/);
  assert.match(source, /fail-test/);
  assert.match(source, /finish-test/);
  assert.match(source, /task\.context\.newPage/);
  assert.match(source, /observerPage/);
  assert.match(source, /totalScenarios/);
});

test("canvas e2e exercises destructive and restorative review actions", () => {
  const canvasCase = scenarioCases.find(
    (testCase) => testCase.name === "web test: canvas",
  );
  assert.ok(canvasCase);
  const source = canvasCase.body();
  assert.match(source, /await eraser\.click\(\)/);
  assert.match(source, /Restore saved review/);
  assert.match(source, /Clear markup/);
  assert.match(source, /eraser-mask/);
});

test("download e2e verifies the browser-produced artifact", () => {
  const downloadCase = scenarioCases.find(
    (testCase) => testCase.name === "web test: downloads",
  );
  assert.ok(downloadCase);
  const source = downloadCase.body();
  assert.match(source, /Page\.setDownloadBehavior/);
  assert.match(source, /ego-browser-sample\.txt/);
  assert.match(source, /readFile/);
});

test("review workflow e2e covers role guards and invalid transitions", () => {
  const reviewCase = scenarioCases.find(
    (testCase) => testCase.name === "web test: review-workflow",
  );
  assert.ok(reviewCase);
  const source = reviewCase.body();
  assert.match(source, /Describe the finding before adding it/);
  assert.match(source, /Finding severity/);
  assert.match(source, /author cannot approve/);
  assert.match(source, /cannot approve while findings are open/);
});

test("collaborative document e2e covers concurrent editing and peer departure", () => {
  const collaborationCase = scenarioCases.find(
    (testCase) => testCase.name === "web test: collaborative-docs",
  );
  assert.ok(collaborationCase);
  const source = collaborationCase.body();
  assert.match(source, /Promise\.all/);
  assert.match(source, /1 online/);
  assert.match(source, /Cancel/);
  assert.match(source, /Undo document change/);
  assert.match(source, /primary tab receives the saved version/);
});

test("keyboard e2e creates editor selections through user input", () => {
  const keyboardCase = scenarioCases.find(
    (testCase) => testCase.name === "web test: keyboard",
  );
  assert.ok(keyboardCase);
  const source = keyboardCase.body();
  assert.doesNotMatch(source, /createRange|selectNodeContents/);
  assert.match(source, /Italic applied/);
  assert.match(source, /Bulleted list applied/);
  assert.match(source, /Save draft/);
});

test("forms e2e covers validation boundaries instead of only empty values", () => {
  const formsCase = scenarioCases.find(
    (testCase) => testCase.name === "web test: forms",
  );
  assert.ok(formsCase);
  const source = formsCase.body();
  assert.match(source, /19-character/);
  assert.match(source, /Choose a target date to continue/);
  assert.match(source, /invalid stakeholder email/);
});

test("upload e2e covers mixed accepted and rejected selections", () => {
  const uploadCase = scenarioCases.find(
    (testCase) => testCase.name === "web test: uploads",
  );
  assert.ok(uploadCase);
  const source = uploadCase.body();
  assert.match(source, /mixed selection/);
  assert.match(source, /data-file-state="ready"/);
  assert.match(source, /Remove unsupported files/);
});

test("spreadsheet e2e covers required text and durable reset", () => {
  const spreadsheetCase = scenarioCases.find(
    (testCase) => testCase.name === "web test: spreadsheet",
  );
  assert.ok(spreadsheetCase);
  const source = spreadsheetCase.body();
  assert.match(source, /Work item is required/);
  assert.match(source, /reset survives a full page reload/);
});

test("rich text e2e covers validation, history, and destructive cancellation", () => {
  const richTextCase = scenarioCases.find(
    (testCase) => testCase.name === "web test: rich-text",
  );
  assert.ok(richTextCase);
  const source = richTextCase.body();
  assert.match(source, /Article body is required/);
  assert.match(source, /Cancel/);
  assert.match(source, /Undo/);
  assert.match(source, /Redo/);
  assert.match(source, /Blockquote/);
});

test("drag and drop e2e covers cancelled and reverse movement", () => {
  const dragCase = scenarioCases.find(
    (testCase) => testCase.name === "web test: drag-drop",
  );
  assert.ok(dragCase);
  const source = dragCase.body();
  assert.match(source, /invalid drop/);
  assert.match(source, /Drag keyboard order audit/);
  assert.match(source, /reverse drag/);
});

test("navigation e2e follows the scenario link back to the fixture index", () => {
  const navigationCase = scenarioCases.find(
    (testCase) => testCase.name === "web test: navigation",
  );
  assert.ok(navigationCase);
  const source = navigationCase.body();
  assert.match(source, /← All fixtures/);
  assert.match(source, /Test routes/);
});

test("native task-space close regression has a dedicated npm entry point", () => {
  const packageJson = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
  );
  assert.match(
    packageJson.scripts["e2e:native-close"],
    /EGO_BROWSER_REAL_E2E_ONLY=.*native task space close regression/,
  );
});

test("real-browser e2e detects a crashed or restarted ego lite process", () => {
  assert.equal(typeof runner.browserProcessChanged, "function");
  assert.equal(runner.browserProcessChanged(["123"], ["123"]), false);
  assert.equal(runner.browserProcessChanged(["123"], []), true);
  assert.equal(runner.browserProcessChanged(["123"], ["456"]), true);
  assert.equal(
    runner.browserProcessChanged([], ["456"]),
    false,
    "starting ego lite for the first time is not a restart",
  );
  assert.equal(runner.browserProcessChanged(null, ["456"]), false);
});

test("missing case results report a browser crash or disconnection", () => {
  assert.equal(typeof runner.missingCaseResultMessage, "function");
  assert.match(
    runner.missingCaseResultMessage(new Error("ENOENT")),
    /browser crashed, restarted, or disconnected/i,
  );
});

test("native close regression waits through the known asynchronous crash window", () => {
  const regression = e2eCases.find(
    (testCase) => testCase.name === "native task space close regression",
  );
  assert.ok(regression);
  assert.equal(regression.crashGraceMs, 300);
});

test("a cleanup crash makes the final e2e result fail", () => {
  assert.equal(typeof runner.suitePassed, "function");
  assert.equal(
    runner.suitePassed([
      { name: "browser case", status: "pass" },
      { name: "task-space cleanup", status: "fail" },
    ]),
    false,
  );
});
