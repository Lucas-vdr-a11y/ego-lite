import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { egoSource } from "./ego-source.mjs";
import { TEST_CASES } from "./site/test-cases.mjs";
import { e2eCases } from "./suites/index.mjs";
import { taskSpaceControlCase } from "./suites/platform/taskspace-control.mjs";
import { scenarioCases } from "./suites/scenarios/index.mjs";
import { visualPathScenarioCase } from "./suites/scenarios/visual-path.mjs";
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

test("node bridge smoke checks both the bundled and worktree SDK startup paths", () => {
  assert.equal(typeof runner.nodeBridgeSmokeConfigurations, "function");
  assert.deepEqual(runner.nodeBridgeSmokeConfigurations("/tmp/sdk.js"), [
    {
      name: "bundled nodejs bridge smoke",
      args: ["nodejs"],
    },
    {
      name: "worktree nodejs bridge smoke",
      args: ["nodejs", "--sdk-path", "/tmp/sdk.js"],
      egoBrowserSdkPath: "/tmp/sdk.js",
    },
  ]);
});

test("real-browser e2e serializes scenario cases in one TaskSpace lane", () => {
  const cases = ["a", "b", "c", "d", "e"];
  assert.equal(runner.WEB_LANE_COUNT, 1);
  assert.deepEqual(runner.partitionE2eCases(cases, runner.WEB_LANE_COUNT), [
    cases,
  ]);
  assert.deepEqual(
    runner.parallelTaskSpaceNames("suite", runner.WEB_LANE_COUNT),
    ["suite web lane 1"],
  );
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

test("SDK global lifecycle runs before TaskSpace browser cases", () => {
  assert.equal(e2eCases[0]?.name, "SDK global lifecycle");
  assert.equal(e2eCases[1]?.name, "TaskSpace context lifecycle");
});

test("SDK global lifecycle protects cached-runtime facade installation", () => {
  const lifecycle = e2eCases.find(
    (testCase) => testCase.name === "SDK global lifecycle",
  );

  assert.ok(lifecycle);
  assert.equal(lifecycle.kind, "runtime");
  const source = lifecycle.body();
  assert.match(source, /Reflect\.deleteProperty\(globalThis, "egoBrowser"\)/);
  assert.match(source, /globalThis\.egoBrowser = undefined/);
  assert.match(source, /egoBrowser\.site\.discover/);
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
    const start = source.indexOf("const startSnapshot");
    const scenarioOperation = source.indexOf("/* scenario operations */");
    const finish = source.indexOf('getByTestId("finish-test")');
    const failure = source.indexOf('observedAction(page, failButton, "click")');

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
  assert.match(routing.body(), /route\.continue\(/);
  assert.match(routing.body(), /route\.abort\(/);
  assert.match(routing.body(), /waitForEvent\("requestfailed"/);
  assert.match(routing.body(), /page\.unroute\(/);
});

test("frames e2e validates nested frame snapshots and the external map", () => {
  const frames = e2eCases.find(
    (testCase) => testCase.name === "web test: frames",
  );
  const source = frames?.body() || "";

  assert.ok(frames);
  assert.match(source, /ariaSnapshot\(\{ ref: true \}\)/);
  assert.match(source, /aria-ref=/);
  assert.match(source, /contentFrame\(\)/);
  assert.match(
    source,
    /assertIncludes\(hostSnapshot\.content, 'heading "Embedded checkout"'/,
  );
  assert.match(
    source,
    /assertIncludes\(checkoutSnapshot\.content, 'heading "Confirm payment details"'/,
  );
  assert.match(
    source,
    /assertIncludes\(mapFrameUrl, "https:\/\/www\.openstreetmap\.org\/export\/embed\.html\?"/,
  );
  assert.match(source, /nestedMapFrame\.parentFrame\(\)\.url\(\)/);
  assert.doesNotMatch(
    source,
    /getBy(?:Role|Label)\([^\n]+\)\.(?:click|fill|check)\(/,
  );
});

test("every scenario observes page state before a mutating browser action", () => {
  const directLocatorAction =
    /\.(?:click|dblclick|fill|check|uncheck|press|selectOption|setInputFiles|dragTo|hover|focus|tap)\(/;
  const directInputAction =
    /\.(?:keyboard|mouse)\.(?:press|insertText|type|move|down|up|wheel)\(/;

  for (const testCase of scenarioCases) {
    const source = testCase.body();
    const operations = source.slice(
      source.indexOf("/* scenario operations */"),
    );
    assert.doesNotMatch(operations, directLocatorAction, testCase.name);
    assert.doesNotMatch(operations, directInputAction, testCase.name);
  }
});

test("the visual-path journey takes every coordinate from screenshot pixels", () => {
  const source = visualPathScenarioCase.body();
  const operations = source.slice(source.indexOf("/* scenario operations */"));

  assert.match(operations, /locateSwatch\(/);
  assert.match(operations, /toCssPoint\(/);
  // Reading a result back through a test id is fine; asking the layout where a
  // target sits is not, because that turns this into another semantic case.
  assert.doesNotMatch(
    operations,
    /boundingBox\(|getBoundingClientRect\(|scrollIntoView/,
  );
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
  assert.match(source, /same-space selection closes the previous Page/);
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

test("TaskSpace process contention covers a live takeover and recovery", () => {
  const contention = e2eCases.find(
    (testCase) => testCase.name === "TaskSpace process contention",
  );

  assert.ok(contention);
  assert.notEqual(contention.optIn, true);
  assert.equal(contention.processContention, true);
  assert.equal(contention.holderTimeoutMs, 10_000);
  assert.equal(contention.rounds.length, 4);

  const [setup, holder, contender, recovery] = contention.rounds.map((round) =>
    round(),
  );
  assert.match(setup, /newTaskSpace/);
  assert.match(setup, /process-contention-ready\.json/);
  assert.match(holder, /switchTaskSpace/);
  assert.match(holder, /process-contention-holder-ready\.json/);
  assert.match(holder, /new Promise\(\(\) => \{\}\)/);
  // The keep-alive interval is load-bearing: a bare unsettled top-level await
  // exits the process (code 13) and releases the lease before the contender.
  assert.match(holder, /setInterval/);
  assert.doesNotMatch(holder, /setTimeout/);
  assert.match(contender, /switchTaskSpace/);
  assert.doesNotMatch(contender, /already controlled/);
  assert.match(contender, /takeover completes promptly/);
  // The audit assert is what separates a real takeover from a free acquire
  // of an already-released lease.
  assert.match(contender, /takenOverFrom/);
  assert.match(recovery, /switchTaskSpace/);
  assert.match(recovery, /remains addressable after the takeover/);
  assert.match(recovery, /accepts new page operations/);
});

test("TaskSpace process contention follows the Codex exec_command session protocol", () => {
  const source = readFileSync(new URL("./runner.mjs", import.meta.url), "utf8");

  assert.match(source, /createCodexCommandTools/);
  assert.match(source, /codexTools\.exec_command/);
  assert.match(source, /holderResult\.session_id/);
  assert.match(source, /rounds\[2\]\(\)/);
  assert.match(source, /TaskSpace process contender/);
  assert.match(source, /codexTools\.write_stdin/);
  assert.match(source, /holderResult\.exit_code/);
  assert.doesNotMatch(source, /holderCancelPath/);
  assert.doesNotMatch(source, /onCancel:\s*\(sessionId\)/);
  assert.doesNotMatch(source, /queueProbeResult/);
  assert.match(source, /waitForNodeRoundToSettle\(1_000\)/);
  assert.match(source, /NodeRuntime disconnected.*holderOutput/s);
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
  assert.match(source, /chrome:\/\/bookmarks\//);
  assert.match(source, /internalPage\.close\(\)/);
  assert.match(source, /internalPage\.isClosed\(\)/);
  assert.match(source, /task\.page\.waitForEvent\("popup"/);
  assert.match(source, /await popup\.close\(\)/);
  assert.doesNotMatch(source, /task\.tabs|openOrReuse/);
  assert.doesNotMatch(source, /scenario-test-controls|start-test|fail-test/);
});

test("real-browser e2e verifies native Playwright CDPSession behavior", () => {
  const cdpSessionCase = e2eCases.find(
    (testCase) => testCase.name === "Playwright CDP session",
  );

  assert.ok(cdpSessionCase);
  assert.equal(cdpSessionCase.kind, "platform");
  assert.notEqual(cdpSessionCase.optIn, true);
  const source = cdpSessionCase.body();
  assert.match(source, /task\.context\.newCDPSession\(page\)/);
  assert.match(source, /session\.send\("Runtime\.evaluate"/);
  assert.match(source, /session\.on\(eventName/);
  assert.match(source, /"Runtime\.bindingCalled"/);
  assert.match(source, /"Network\.responseReceived"/);
  assert.match(source, /session\.detach\(\)/);
  assert.match(source, /secondarySession/);
  assert.match(source, /Promise\.all/);
  assert.match(
    source,
    /detaching the second CDP session preserves the primary session/,
  );
  assert.match(source, /detached CDP session rejects later commands/);
  assert.match(source, /remappedSession/);
  assert.doesNotMatch(source, /\bcdp\(/);
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
  assert.match(source, /observedAction\(page, eraser, "click"\)/);
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
  const operations = source.slice(source.indexOf("/* scenario operations */"));
  assert.match(source, /Promise\.all/);
  assert.match(
    source,
    /observedAction\(page, primaryEditor, "press", "Home"\)/,
  );
  assert.match(
    source,
    /observedAction\(collaboratorPage, collaboratorEditor, "press", "End"\)/,
  );
  assert.match(source, /observedKeyboard\(page, primaryEditor, "insertText"/);
  assert.match(
    source,
    /observedKeyboard\(collaboratorPage, collaboratorEditor, "insertText"/,
  );
  assert.doesNotMatch(operations, /keyboard\.type/);
  assert.match(source, /finally/);
  assert.match(source, /observedClosePage\(collaboratorPage/);
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

test("network e2e waits for rendered response state", () => {
  const networkCase = scenarioCases.find(
    (testCase) => testCase.name === "web test: network",
  );
  assert.ok(networkCase);
  const source = networkCase.body();
  assert.match(
    source,
    /networkStatus\.filter\(\{ hasText: \/\^503\$\/ \}\)\.waitFor\(\)/,
  );
  assert.match(
    source,
    /networkStatus\.filter\(\{ hasText: \/\^200\$\/ \}\)\.waitFor\(\)/,
  );
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
  assert.match(source, /rich-text-word-count.*0 words/s);
  assert.match(source, /Cancel/);
  assert.match(source, /Undo/);
  assert.match(source, /Redo/);
  assert.match(source, /Blockquote/);
  assert.match(
    source,
    /observedAction\(page, editor, "press", "ControlOrMeta\+A"\)/,
  );
  assert.match(source, /observedAction\(page, editor, "press", "Backspace"\)/);
  assert.match(source, /observedKeyboard\(page, editor, "insertText"/);
  assert.match(source, /Underline/);
  assert.match(source, /Align center/);
  assert.match(source, /Text color/);
  assert.match(source, /Blue/);
  assert.match(source, /Link URL/);
  assert.match(source, /Italic/);
  assert.match(source, /Strike/);
  assert.match(source, /Heading 3/);
  assert.match(source, /Code block/);
  assert.match(source, /Numbered list/);
  assert.match(source, /Clear formatting/);
  assert.doesNotMatch(source, /editor\.fill\(/);
});

test("rich text fixture uses Quill Snow with an accessible extended toolbar", () => {
  const clientSource = readFileSync(
    new URL("./site/src/scenarios/rich-text/client.js", import.meta.url),
    "utf8",
  );
  const viewSource = readFileSync(
    new URL("./site/src/scenarios/rich-text/view.jsx", import.meta.url),
    "utf8",
  );

  assert.match(clientSource, /import Quill from ["']quill["']/);
  assert.match(clientSource, /theme:\s*["']snow["']/);
  assert.match(clientSource, /getSemanticHTML\(\)/);
  assert.match(clientSource, /Link URL/);
  assert.match(clientSource, /Apply link/);
  assert.doesNotMatch(clientSource, /@tiptap/);
  for (const label of [
    "Underline",
    "Insert link",
    "Align center",
    "Code block",
    "Clear formatting",
  ]) {
    assert.match(viewSource, new RegExp(`aria-label=["']${label}["']`));
  }
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
  assert.match(source, /delayed-document\?delay=9000/);
  assert.match(source, /former eight-second transport limit/);
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

test("TaskSpace process contention has a dedicated npm entry point", () => {
  const packageJson = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
  );
  assert.match(
    packageJson.scripts["e2e:process-contention"],
    /EGO_BROWSER_REAL_E2E_ONLY=.*TaskSpace process contention/,
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
