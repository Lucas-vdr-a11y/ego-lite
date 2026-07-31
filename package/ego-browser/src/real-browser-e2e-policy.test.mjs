import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import * as runner from "../scripts/real-browser-e2e/runner.mjs";
import { pageEventCases } from "../scripts/real-browser-e2e/cases/page-events.mjs";
import { taskSpaceCase } from "../scripts/real-browser-e2e/cases/task-space.mjs";
import { e2eCases } from "../scripts/real-browser-e2e/cases/index.mjs";

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

test("task-space keep mode does not create a destructively closed scratch space", () => {
  const source = taskSpaceCase();
  assert.match(
    source,
    /if \(!keepTaskSpace\) \{[\s\S]*taskSpaces\.new\(taskName \+ " scratch"\)[\s\S]*keep: false[\s\S]*\}/,
  );
});

test("popup event e2e closes the popup it creates", () => {
  const popupCase = pageEventCases.find(
    (testCase) => testCase.name === "page popup event helper",
  );
  assert.ok(popupCase);
  assert.match(
    popupCase.body(),
    /finally \{[\s\S]*tabs\.close\(popup\.targetId\)[\s\S]*tabs\.activate\(originalTab\)/,
  );
});

test("agent-facing sources do not publish the removed browser tab namespace", () => {
  const sources = [
    readFileSync(
      new URL("../../../skills/ego-browser/SKILL.md", import.meta.url),
      "utf8",
    ),
    readFileSync(new URL("../README.md", import.meta.url), "utf8"),
    readFileSync(
      new URL("../scripts/real-browser-e2e/preamble.mjs", import.meta.url),
      "utf8",
    ),
    readFileSync(
      new URL(
        "../../../skills/ego-browser/learnings/google/notes/overview.md",
        import.meta.url,
      ),
      "utf8",
    ),
    readFileSync(
      new URL(
        "../../../skills/ego-browser/learnings/google/tools/search-extract.js",
        import.meta.url,
      ),
      "utf8",
    ),
    readFileSync(
      new URL(
        "../../../skills/ego-browser/learnings/x-com/tools/search-users.js",
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

test("skill uses the tabs facade without documenting the removed Browser API", () => {
  const skill = readFileSync(
    new URL("../../../skills/ego-browser/SKILL.md", import.meta.url),
    "utf8",
  );
  const quickStart = skill.match(/## 2\. Quick start([\s\S]*?)## 3\./)?.[1];

  assert.ok(quickStart);
  assert.match(
    quickStart,
    /await tabs\.openOrReuse\('https:\/\/example\.com', \{ wait: true, timeout: 20000 \}\)/,
  );
  assert.match(quickStart, /console\.log\(await page\.snapshot\(\)\)/);
  assert.doesNotMatch(quickStart, /getByRole|innerText|page\.url/);
  assert.doesNotMatch(skill, /Playwright `Browser`/);
  assert.doesNotMatch(skill, /`Browser\.(?:grantPermissions|setPermission)`/);
});

test("native task-space close regression remains a dedicated opt-in e2e", () => {
  const regression = e2eCases.find(
    (testCase) => testCase.name === "native task space close regression",
  );
  assert.ok(regression);
  assert.equal(regression.optIn, true);
  const source = regression.body();
  assert.match(source, /page\.waitForEvent\("popup"/);
  assert.match(source, /page\.waitForEvent\("dialog"/);
  assert.match(
    source,
    /taskSpaces\.complete\(scratch\.id, \{ keep: false \}\)/,
  );
});

test("native task-space close regression has a dedicated npm entry point", () => {
  const packageJson = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
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
