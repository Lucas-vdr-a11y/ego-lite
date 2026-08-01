import test from "node:test";
import assert from "node:assert/strict";

import { formatCliLogValue } from "../dist/src/format.js";

test("formatCliLogValue renders current helper documentation in object output", () => {
  const formatted = formatCliLogValue({
    helpers: {
      egoBrowser: {
        newTaskSpace() {},
      },
      site: {
        runTool: async function runSiteTool() {},
      },
    },
  });

  const parsed = JSON.parse(formatted);
  assert.equal(
    parsed.helpers.egoBrowser.newTaskSpace.signature,
    "egoBrowser.newTaskSpace(name) => Promise<TaskSpace>",
  );
  assert.match(
    parsed.helpers.egoBrowser.newTaskSpace.description,
    /native Playwright Page and BrowserContext/,
  );
  assert.equal(parsed.helpers.site.runTool.name, "runTool");
  assert.equal(
    parsed.helpers.site.runTool.signature,
    "site.runTool(siteId, toolName, args?) => Promise<tool result>",
  );
});
test("formatCliLogValue documents egoBrowser structured action results", () => {
  const formatted = formatCliLogValue({
    helpers: {
      egoBrowser: {
        completeTaskSpace() {},
        closeTaskSpace() {},
        handOffTaskSpace() {},
      },
    },
  });

  const parsed = JSON.parse(formatted);
  assert.equal(
    parsed.helpers.egoBrowser.completeTaskSpace.signature,
    "egoBrowser.completeTaskSpace(nameOrId) => Promise<TaskSpaceActionResult>",
  );
  assert.equal(
    parsed.helpers.egoBrowser.closeTaskSpace.signature,
    "egoBrowser.closeTaskSpace(nameOrId) => Promise<TaskSpaceActionResult>",
  );
  assert.equal(
    parsed.helpers.egoBrowser.handOffTaskSpace.signature,
    "egoBrowser.handOffTaskSpace(nameOrId?) => Promise<TaskSpaceActionResult>",
  );
  assert.match(
    parsed.helpers.egoBrowser.completeTaskSpace.example,
    /console\.log\(await egoBrowser\.completeTaskSpace/,
  );
  assert.match(
    parsed.helpers.egoBrowser.closeTaskSpace.example,
    /console\.log\(await egoBrowser\.closeTaskSpace/,
  );
  assert.match(
    parsed.helpers.egoBrowser.handOffTaskSpace.example,
    /console\.log\(await egoBrowser\.handOffTaskSpace/,
  );
});

test("formatCliLogValue documents ego.learnings as the site facade alias", () => {
  const formatted = formatCliLogValue({
    learnings: {
      runTool: async function runSiteTool() {},
    },
  });

  const parsed = JSON.parse(formatted);
  assert.equal(parsed.learnings.runTool.kind, "function");
  assert.equal(
    parsed.learnings.runTool.signature,
    "learnings.runTool(siteId, toolName, args?) => Promise<tool result>",
  );
  assert.match(parsed.learnings.runTool.example, /learnings\.learnContext/);
  assert.match(parsed.learnings.runTool.example, /learnings\.runTool/);
});

test("formatCliLogValue documents all public time options in milliseconds", () => {
  const formatted = formatCliLogValue({
    helpers: {
      egoBrowser: { waitForAgentControlTaskSpace() {} },
      fetch: {
        server() {},
        browser() {},
      },
    },
  });

  const parsed = JSON.parse(formatted);
  assert.match(
    parsed.helpers.egoBrowser.waitForAgentControlTaskSpace.params[1]
      .description,
    /milliseconds/,
  );
  assert.match(
    parsed.helpers.fetch.server.params[1].description,
    /milliseconds/,
  );
  assert.match(
    parsed.helpers.fetch.browser.params[1].description,
    /milliseconds/,
  );
  assert.doesNotMatch(formatted, /timeout seconds|options in seconds/i);
});

test("formatCliLogValue handles nested bigint and circular references", () => {
  const value = { id: 1n, child: {} };
  value.child.self = value;

  const formatted = formatCliLogValue(value);

  const parsed = JSON.parse(formatted);
  assert.equal(parsed.id, "1n");
  assert.equal(parsed.child.self, "[Circular]");
});

test("formatCliLogValue documents unsupported permission CDP methods", () => {
  const formatted = formatCliLogValue({ cdp() {} });

  const parsed = JSON.parse(formatted);
  assert.match(parsed.cdp.description, /Browser\.grantPermissions/);
  assert.match(parsed.cdp.description, /Browser\.setPermission/);
  assert.match(parsed.cdp.description, /not exposed/);
});
