import test from "node:test";
import assert from "node:assert/strict";

import { formatCliLogValue } from "../dist/src/format.js";

test("formatCliLogValue renders documented function properties in object output", () => {
  const formatted = formatCliLogValue({
    helpers: {
      page: {
        waitForRequest() {},
        waitForResponse() {},
      },
      tabs: {
        openOrReuse() {},
      },
      site: {
        runTool: async function runSiteTool() {},
      },
    },
  });

  const parsed = JSON.parse(formatted);
  assert.equal(parsed.helpers.tabs.openOrReuse.kind, "function");
  assert.equal(
    parsed.helpers.tabs.openOrReuse.signature,
    "tabs.openOrReuse(url, options?) => Promise<object>",
  );
  assert.equal(
    parsed.helpers.page.waitForRequest.signature,
    "page.waitForRequest(urlOrPredicate, options?) => Promise<Request>",
  );
  assert.equal(
    parsed.helpers.page.waitForResponse.signature,
    "page.waitForResponse(urlOrPredicate, options?) => Promise<Response>",
  );
  assert.equal(parsed.helpers.site.runTool.name, "runTool");
  assert.equal(
    parsed.helpers.site.runTool.signature,
    "site.runTool(siteId, toolName, args?) => Promise<tool result>",
  );
  assert.equal(parsed.helpers.site.runTool.params[0].name, "siteId");
});

test("formatCliLogValue documents page.url as asynchronous", () => {
  const formatted = formatCliLogValue({
    helpers: { page: { url() {} } },
  });

  const parsed = JSON.parse(formatted);
  assert.equal(
    parsed.helpers.page.url.signature,
    "page.url() => Promise<string>",
  );
  assert.match(parsed.helpers.page.url.example, /await page\.url\(\)/);
});

test("formatCliLogValue documents Playwright 1.52 locator matcher options", () => {
  const formatted = formatCliLogValue({
    helpers: {
      page: {
        locator() {},
        getByText() {},
      },
    },
    locator: {
      locator() {},
      getByTestId() {},
    },
  });

  const parsed = JSON.parse(formatted);
  assert.match(
    parsed.helpers.page.locator.signature,
    /page\.locator\(selector, options\?\)/,
  );
  assert.match(parsed.helpers.page.locator.params[1].type, /hasNotText/);
  assert.equal(parsed.helpers.page.getByText.params[0].type, "string | RegExp");
  assert.match(
    parsed.locator.locator.signature,
    /locator\.locator\(selectorOrLocator, options\?\)/,
  );
  assert.match(
    parsed.locator.getByTestId.signature,
    /getByTestId\(testId: string \| RegExp\)/,
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

test("formatCliLogValue documents the waitForURL matcher and default", () => {
  const formatted = formatCliLogValue({
    helpers: { page: { waitForURL() {} } },
  });

  const parsed = JSON.parse(formatted);
  assert.equal(
    parsed.helpers.page.waitForURL.signature,
    "page.waitForURL(url, options?) => Promise<void>",
  );
  assert.match(
    parsed.helpers.page.waitForURL.description,
    /predicate receiving a URL object.*load by default/,
  );
});

test("formatCliLogValue documents all public time options in milliseconds", () => {
  const formatted = formatCliLogValue({
    helpers: {
      taskSpaces: { waitForAgentControl() {} },
      fetch: {
        server() {},
        browser() {},
      },
    },
  });

  const parsed = JSON.parse(formatted);
  assert.match(
    parsed.helpers.taskSpaces.waitForAgentControl.params[1].description,
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

test("formatCliLogValue keeps facade signatures and returned subsets current", () => {
  const formatted = formatCliLogValue({
    helpers: {
      page: {
        evaluate() {},
        waitForEvent() {},
        waitForFunction() {},
      },
      taskSpaces: {
        takeOver() {},
        waitForAgentControl() {},
      },
    },
  });

  const parsed = JSON.parse(formatted);
  assert.doesNotMatch(parsed.helpers.page.evaluate.description, /extractAll/);
  assert.match(
    parsed.helpers.page.waitForEvent.signature,
    /"console".*"dialog".*"download".*"filechooser".*"pageerror".*"popup".*"requestfailed"/,
  );
  assert.match(
    parsed.helpers.page.waitForEvent.returns,
    /ConsoleMessage.*Dialog.*Download.*FileChooser.*Error.*Popup.*Request/,
  );
  assert.match(
    parsed.helpers.page.waitForEvent.returns,
    /does not require tabs\.list\(\)/,
  );
  assert.match(
    parsed.helpers.page.waitForEvent.example,
    /await popup\.bringToFront\(\)/,
  );
  assert.match(
    parsed.helpers.page.waitForFunction.returns,
    /jsonValue\(\).*dispose\(\)/,
  );
  assert.equal(
    parsed.helpers.taskSpaces.takeOver.signature,
    "taskSpaces.takeOver(nameOrId?) => Promise<void>",
  );
  assert.equal(
    parsed.helpers.taskSpaces.waitForAgentControl.signature,
    "taskSpaces.waitForAgentControl(nameOrId, options?) => Promise<void>",
  );
  assert.equal(
    parsed.helpers.taskSpaces.waitForAgentControl.params[0].required,
    true,
  );
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
