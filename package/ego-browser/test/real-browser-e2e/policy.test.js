import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { egoSource } from "./ego-source.mjs";
import { e2eCases } from "./cases/index.mjs";
import { taskSpaceCase } from "./cases/task-space.mjs";
import * as runner from "./runner.mjs";

const expectedWebTestRoutes = [
  "/tests/clicks",
  "/tests/hover",
  "/tests/drag-drop",
  "/tests/canvas",
  "/tests/forms",
  "/tests/keyboard",
  "/tests/uploads",
  "/tests/scroll",
  "/tests/navigation",
  "/tests/dialogs",
  "/tests/downloads",
  "/tests/frames",
  "/tests/network",
];

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

test("real-browser e2e accepts direct CDP transport when the host has no endpoint", () => {
  assert.equal(typeof runner.nodeBridgeSupportsPlaywright, "function");
  assert.equal(
    runner.nodeBridgeSupportsPlaywright({
      egoType: "object",
      hasSendCDPMessage: "function",
      hasGetCDPEndpoint: "undefined",
      processVersion: "v24.18.0",
      helperCount: 5,
    }),
    true,
  );
});

test("real-browser e2e lets each embedded Node round settle before starting the next case", async () => {
  assert.equal(typeof runner.waitForNodeRoundToSettle, "function");
  const startedAt = Date.now();
  await runner.waitForNodeRoundToSettle(10);
  assert.ok(Date.now() - startedAt >= 5);
});

test("real-browser e2e partitions website cases across two independent TaskSpaces", () => {
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

test("parallel real-browser cases write isolated result files", () => {
  const source = egoSource("console.log('case')", {
    caseResultPath: "/tmp/e2e-results/case-7.json",
  });
  assert.match(source, /caseResultPath = "\/tmp\/e2e-results\/case-7\.json"/);
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
  const webCases = e2eCases.filter((testCase) =>
    testCase.name.startsWith("web test: "),
  );

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

test("task-space keep mode does not create a destructively closed scratch space", () => {
  const source = taskSpaceCase();
  assert.match(
    source,
    /if \(!keepTaskSpace\) \{[\s\S]*egoBrowser\.newTaskSpace\(taskName \+ " scratch"\)[\s\S]*egoBrowser\.closeTaskSpace\(scratch\.id\)[\s\S]*\}/,
  );
});

test("task-space e2e verifies structured egoBrowser action results", () => {
  const source = taskSpaceCase();

  assert.match(source, /assertEqual\(closed\.done, true/);
  assert.match(source, /assertEqual\(handOffResult\.done, true/);
  assert.match(source, /assertEqual\(takeOverResult\.done, true/);
  assert.match(source, /assertEqual\(waitResult\.done, true/);
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
    ...e2eCases.map((testCase) => testCase.body()),
  ];
  const removedBrowserTabApi =
    /\b(?:ctx\.)?browser\.(?:listTabs|currentTab|switchTab|openOrReuseTab|closeTab|ensureRealTab|iframeTarget|evaluateInTab)\b/;

  for (const source of sources) {
    assert.doesNotMatch(source, removedBrowserTabApi);
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
  assert.match(source, /scratch\.context\.newPage\(\)/);
  assert.match(source, /scratch\.page\.waitForEvent\("dialog"/);
  assert.match(source, /egoBrowser\.closeTaskSpace\(scratch\.id\)/);
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
