import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as helperExports from "../dist/src/helpers.js";
import { PUBLIC_API_DOCS } from "../dist/src/format.js";
import { setOverrides } from "../dist/src/state.js";
import {
  clearPreferredTarget,
  drainBrowserEvents,
  invalidateSession,
} from "../dist/src/browser-runtime.js";
import { runWithTarget } from "../dist/src/target-context.js";
import {
  connectPlaywrightTaskSpace,
  disconnectPlaywrightTaskSpace,
} from "../dist/src/playwright/taskspace.js";
import {
  claimTaskSpace,
  completeTaskSpace,
  handOffTaskSpace,
  newTaskSpace,
  helperContext,
  listTaskSpaces,
  switchTaskSpace,
  waitForAgentControl,
} from "../dist/src/helpers.js";

const restoreDefaultPlaywrightConnector =
  helperExports.__testing.setPlaywrightTaskSpaceConnector(async () => ({
    page: {},
    context: {},
    close: async () => {},
  }));

test.after(async () => {
  restoreDefaultPlaywrightConnector();
});

function withEgo(ego, fn) {
  const previous = globalThis.ego;
  globalThis.ego = ego;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (previous === undefined) {
        delete globalThis.ego;
      } else {
        globalThis.ego = previous;
      }
    });
}

function callablePaths(value, prefix, depth = 3) {
  const paths = [];
  for (const [key, child] of Object.entries(value)) {
    const path = `${prefix}.${key}`;
    if (typeof child === "function") {
      paths.push(path);
    } else if (child && typeof child === "object" && depth > 0) {
      paths.push(...callablePaths(child, path, depth - 1));
    }
  }
  return paths;
}

async function waitForCdpCall(calls, method) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (calls.some((call) => call.method === method)) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`timed out waiting for CDP call: ${method}`);
}

test("listTaskSpaces normalizes the current taskSpaces binding shape", async () => {
  await withEgo(
    {
      async listTaskSpaces() {
        return {
          taskSpaces: [
            {
              taskId: "checkout-flow",
              id: 7,
              name: "Checkout flow",
              createdBy: "agent",
              ownership: "agent",
              recentTabTitles: ["Checkout", "Cart"],
            },
          ],
        };
      },
    },
    async () => {
      assert.deepEqual(await listTaskSpaces(), [
        {
          taskId: "checkout-flow",
          id: 7,
          name: "Checkout flow",
          createdBy: "agent",
          ownership: "agent",
          recentTabTitles: ["Checkout", "Cart"],
        },
      ]);
    },
  );
});

test("listTaskSpaces rejects legacy taskIds results", async () => {
  await withEgo(
    {
      async listTaskSpaces() {
        return { taskIds: ["checkout-flow", "research-session"] };
      },
    },
    async () => {
      await assert.rejects(
        () => listTaskSpaces(),
        /listTaskSpaces expected \{ taskSpaces: \[\.\.\.\] \}/,
      );
    },
  );
});

test("listTaskSpaces throws on binding error objects", async () => {
  await withEgo(
    {
      async listTaskSpaces() {
        return { error: "The task is under user control" };
      },
    },
    async () => {
      await assert.rejects(
        () => listTaskSpaces(),
        /listTaskSpaces: The task is under user control/,
      );
    },
  );
});

test("listProfiles returns the profiles exposed by the native binding", async () => {
  await withEgo(
    {
      async listProfiles() {
        return {
          profiles: [
            { id: "Default", name: "Personal", isDefault: true },
            { id: "Profile 2", name: "Work", isDefault: false },
          ],
        };
      },
    },
    async () => {
      assert.equal(typeof helperExports.listProfiles, "function");
      assert.deepEqual(await helperExports.listProfiles(), [
        { id: "Default", name: "Personal", isDefault: true },
        { id: "Profile 2", name: "Work", isDefault: false },
      ]);
    },
  );
});

test("listProfiles rejects an invalid native result shape", async () => {
  await withEgo(
    {
      async listProfiles() {
        return { profileIds: ["Default"] };
      },
    },
    async () => {
      await assert.rejects(
        () => helperExports.listProfiles(),
        /listProfiles expected \{ profiles: \[\.\.\.\] \}/,
      );
    },
  );
});

test("egoBrowser owns the canonical TaskSpace surface", () => {
  const context = helperContext();

  assert.deepEqual(Object.keys(context.egoBrowser).sort(), [
    "claimTaskSpace",
    "closeTaskSpace",
    "completeTaskSpace",
    "handOffTaskSpace",
    "helper",
    "listProfile",
    "listTaskSpace",
    "newTaskSpace",
    "showTaskState",
    "site",
    "snapshot",
    "switchTaskSpace",
    "takeOverTaskSpace",
    "waitForAgentControlTaskSpace",
  ]);
  assert.equal(context.taskSpaces, undefined);
  assert.equal(context.egoBrowser.newPage, undefined);
  assert.equal(context.egoBrowser.newContext, undefined);
  assert.equal(context.egoBrowser.contexts, undefined);
  assert.equal(context.egoBrowser.close, undefined);
  assert.equal(context.egoBrowser.listProfiles, undefined);
  assert.equal(context.egoBrowser.listTaskSpaces, undefined);
  assert.equal(context.help, undefined);
});

test("useOrCreateTaskSpace is removed from the public helper surface", () => {
  const context = helperContext();

  assert.equal(context.egoBrowser.useOrCreateTaskSpace, undefined);
  assert.equal(helperExports.useOrCreateTaskSpace, undefined);
  assert.doesNotMatch(context.egoBrowser.helper(), /useOrCreateTaskSpace/);
});

test("egoBrowser.site is the canonical site-learning facade", () => {
  const context = helperContext();

  assert.equal(context.egoBrowser.site, context.site);
  assert.equal(typeof context.egoBrowser.site.discover, "function");
  assert.equal(typeof context.egoBrowser.site.learnContext, "function");
  assert.equal(typeof context.egoBrowser.site.runTool, "function");
  assert.equal(typeof context.egoBrowser.site.runBrowserTool, "function");
  assert.match(
    context.egoBrowser.helper("egoBrowser.site"),
    /egoBrowser\.site\.discover\(url\?\)/,
  );
});

test("egoBrowser.site exposes the approved Google Docs and Sheets presets", () => {
  const context = helperContext();

  assert.deepEqual(Object.keys(context.egoBrowser.site.google.docs).sort(), [
    "appendText",
    "open",
    "readText",
    "replaceAll",
    "setTitle",
  ]);
  assert.deepEqual(Object.keys(context.egoBrowser.site.google.sheets).sort(), [
    "appendRows",
    "getSheetNames",
    "open",
    "readRange",
    "writeRange",
  ]);
  assert.equal(context.egoBrowser.site, context.site);
});

test("egoBrowser.helper documents every approved Google Docs and Sheets preset", () => {
  const helper = helperContext().egoBrowser.helper;
  const docs = helper("egoBrowser.site.google.docs");
  const sheets = helper("egoBrowser.site.google.sheets");

  for (const signature of [
    "docs.open({ url })",
    "docs.readText()",
    "docs.setTitle({ title })",
    "docs.appendText({ text, separator? })",
    "docs.replaceAll({ find, replace, matchCase? })",
  ]) {
    assert.match(docs, new RegExp(signature.replace(/[.?{}()[\]]/g, "\\$&")));
  }
  for (const signature of [
    "sheets.open({ url })",
    "sheets.getSheetNames()",
    "sheets.readRange({ range })",
    "sheets.writeRange({ range, values })",
    "sheets.appendRows({ sheet, values })",
  ]) {
    assert.match(sheets, new RegExp(signature.replace(/[.?{}()[\]]/g, "\\$&")));
  }
  assert.match(
    helper("egoBrowser.site.google.sheets.writeRange"),
    /range dimensions must match values/i,
  );
});

test("egoBrowser.site exposes the approved Gmail, Notion, and Outlook presets", () => {
  const site = helperContext().egoBrowser.site;

  assert.deepEqual(Object.keys(site.google.gmail).sort(), [
    "createDraft",
    "listThreads",
    "openInbox",
    "readThread",
    "search",
  ]);
  assert.deepEqual(Object.keys(site.notion.pages).sort(), [
    "appendText",
    "create",
    "open",
    "read",
    "search",
    "setTitle",
  ]);
  assert.deepEqual(Object.keys(site.microsoft.outlook).sort(), [
    "createDraft",
    "listMessages",
    "openInbox",
    "readMessage",
    "search",
  ]);
  assert.equal(site.microsoft.word, undefined);
  assert.equal(site.microsoft.excel, undefined);
});

test("egoBrowser.helper documents every newly approved preset function", () => {
  const helper = helperContext().egoBrowser.helper;
  const namespaces = {
    "egoBrowser.site.google.gmail": [
      "gmail.openInbox()",
      "gmail.listThreads({ limit? })",
      "gmail.search({ query, limit? })",
      "gmail.readThread({ id })",
      "gmail.createDraft({ to, cc?, bcc?, subject, body })",
    ],
    "egoBrowser.site.notion.pages": [
      "pages.search({ query, limit? })",
      "pages.open({ url })",
      "pages.read()",
      "pages.create({ title, text?, parentUrl? })",
      "pages.setTitle({ title })",
      "pages.appendText({ text })",
    ],
    "egoBrowser.site.microsoft.outlook": [
      "outlook.openInbox()",
      "outlook.listMessages({ limit? })",
      "outlook.search({ query, limit? })",
      "outlook.readMessage({ id })",
      "outlook.createDraft({ to, cc?, bcc?, subject, body })",
    ],
  };

  for (const [namespace, signatures] of Object.entries(namespaces)) {
    const docs = helper(namespace);
    for (const signature of signatures) {
      assert.match(docs, new RegExp(signature.replace(/[.?{}()[\]]/g, "\\$&")));
    }
  }
  assert.match(
    helper("egoBrowser.site.google.gmail.createDraft"),
    /save.*draft|draft.*save/i,
  );
  assert.doesNotMatch(helper("egoBrowser.site.google.gmail"), /sendEmail/);
  assert.doesNotMatch(helper("egoBrowser.site.microsoft.outlook"), /sendEmail/);
});

test("site Node tools receive the active Playwright page and context", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "ego-site-context-"));
  const siteDir = join(workspace, "learnings", "example");
  await mkdir(join(siteDir, "tools"), { recursive: true });
  await writeFile(
    join(siteDir, "manifest.json"),
    JSON.stringify({
      id: "example",
      name: "Example",
      domains: ["example.com"],
      notes: [],
      nodeTools: {
        inspect_context: {
          description: "Inspect the active Playwright context.",
          path: "tools/inspect-context.js",
          callable: "inspectContext",
          args: {},
          returns: {
            type: "object",
            description: "Active page and context markers.",
          },
        },
      },
    }),
  );
  await writeFile(
    join(siteDir, "tools", "inspect-context.js"),
    "export async function inspectContext(ctx) { return { page: ctx.page?.marker, context: ctx.context?.marker }; }\n",
  );

  const restoreWorkspace = setOverrides({
    agentWorkspace: () => workspace,
  });
  const restoreConnector =
    helperExports.__testing.setPlaywrightTaskSpaceConnector(async () => ({
      page: { marker: "page" },
      context: { marker: "context" },
      close: async () => {},
    }));

  try {
    await connectPlaywrightTaskSpace({ id: 41 });
    assert.deepEqual(
      await helperContext().site.runTool("example", "inspect_context"),
      { page: "page", context: "context" },
    );
  } finally {
    await disconnectPlaywrightTaskSpace();
    restoreConnector();
    restoreWorkspace();
  }
});

test("egoBrowser.helper lists the egoBrowser facade by default", () => {
  const output = helperContext().egoBrowser.helper();

  assert.equal(typeof output, "string");
  assert.match(output, /^egoBrowser:/);
  assert.match(output, /egoBrowser\.helper\(name\?\)/);
  assert.match(output, /egoBrowser\.listProfile\(\)/);
  assert.match(output, /egoBrowser\.listTaskSpace\(\)/);
  assert.match(output, /egoBrowser\.showTaskState\(state\)/);
  assert.match(output, /egoBrowser\.snapshot\(options\?\)/);
  assert.doesNotMatch(output, /egoBrowser\.listTaskSpaces\(\)/);
});

test("egoBrowser.showTaskState delegates to the native ego bridge", async () => {
  const states = [];

  await withEgo(
    {
      async setAgentTaskState(state) {
        states.push(state);
        return "task state updated";
      },
    },
    async () => {
      assert.equal(
        await helperContext().egoBrowser.showTaskState("open account settings"),
        "task state updated",
      );
    },
  );

  assert.deepEqual(states, ["open account settings"]);
});

test("egoBrowser.showTaskState requires the native task-state bridge", async () => {
  await withEgo({}, async () => {
    await assert.rejects(
      () => helperContext().egoBrowser.showTaskState("open account settings"),
      /showTaskState requires ego\.setAgentTaskState/,
    );
  });
});

test("egoBrowser.snapshot delegates to the native snapshot bridge", async () => {
  const result = { content: "page structure", refs: [] };
  const calls = [];

  await withEgo(
    {
      async snapshot(...args) {
        calls.push(args);
        return result;
      },
    },
    async () => {
      assert.equal(await helperContext().egoBrowser.snapshot(), result);
    },
  );

  assert.deepEqual(calls, [[]]);
});

test("egoBrowser.snapshot passes native snapshot options unchanged", async () => {
  const options = {
    scope: "full_page",
    includeActionMarks: true,
    interactiveOnly: false,
    includeStableLocator: true,
    maxResultLength: 4000,
  };
  const calls = [];

  await withEgo(
    {
      async snapshot(...args) {
        calls.push(args);
        return { content: "page structure", refs: [] };
      },
    },
    async () => {
      await helperContext().egoBrowser.snapshot(options);
    },
  );

  assert.deepEqual(calls, [[options]]);
});

// ego.snapshot rejects rather than resolving { error, error_code }, so the failure
// skips assertNoEgoError entirely unless the helper normalizes it. Without that, a
// user-control rejection reaches the agent as the bare reason key "location".
test("egoBrowser.snapshot resolves the wording for a rejected user-control failure", async () => {
  await withEgo(
    {
      async snapshot() {
        throw Object.assign(new Error("location"), {
          error_code: "EGO_TASK_SPACE_USER_IN_CONTROL",
        });
      },
    },
    async () => {
      await assert.rejects(
        () => helperContext().egoBrowser.snapshot(),
        (err) => {
          assert.match(
            err.message,
            /^snapshot: A browser permission prompt for location/,
          );
          assert.equal(err.error_code, "EGO_TASK_SPACE_USER_IN_CONTROL");
          return true;
        },
      );
    },
  );
});

test("egoBrowser.snapshot requires the native snapshot bridge", async () => {
  await withEgo({}, async () => {
    await assert.rejects(
      () => helperContext().egoBrowser.snapshot(),
      /snapshot requires ego\.snapshot/,
    );
  });
});

test("egoBrowser.helper documents Profile discovery", () => {
  const output = helperContext().egoBrowser.helper("egoBrowser.listProfile");

  assert.match(
    output,
    /egoBrowser\.listProfile\(\) => Promise<ProfileInfo\[\]>/,
  );
  assert.match(output, /profile\.id/);
});

test("egoBrowser.helper returns documentation for an exact facade path", () => {
  const output = helperContext().egoBrowser.helper("egoBrowser.listTaskSpace");

  assert.match(output, /List lightweight information/);
  assert.match(
    output,
    /egoBrowser\.listTaskSpace\(\) => Promise<TaskSpaceInfo\[\]>/,
  );
});

test("egoBrowser.helper preserves detailed facade documentation", () => {
  const context = helperContext();
  const actionDoc = context.egoBrowser.helper("egoBrowser.completeTaskSpace");
  const waitDoc = context.egoBrowser.helper(
    "egoBrowser.waitForAgentControlTaskSpace",
  );
  const fetchDoc = context.egoBrowser.helper("fetch.server");
  const cdpDoc = context.egoBrowser.helper("cdp");

  assert.match(actionDoc, /Promise<TaskSpaceActionResult>/);
  assert.match(actionDoc, /egoBrowser\.completeTaskSpace/);
  assert.match(waitDoc, /milliseconds/);
  assert.match(fetchDoc, /milliseconds/);
  assert.match(cdpDoc, /Browser\.grantPermissions/);
  assert.match(cdpDoc, /Browser\.setPermission/);
  assert.match(cdpDoc, /not exposed/);
});

test("site.discover exposes the documented learning-pack discovery API", async () => {
  const context = helperContext();

  assert.equal(typeof context.site.discover, "function");
  assert.deepEqual(
    await context.site.discover("https://example.com/"),
    await context.site.skills("https://example.com/"),
  );
  assert.match(
    context.egoBrowser.helper("site.discover"),
    /site\.discover\(url\?\)/,
  );
});

test("egoBrowser TaskSpace exposes the Playwright Page and BrowserContext returned by the connector", async () => {
  const page = { marker: "playwright-page" };
  const browserContext = { marker: "playwright-context" };
  const task = {
    taskId: "inspect-products",
    id: 21,
    name: "Inspect products",
    ownership: "agent",
    tabs: { legacy: true },
  };

  assert.equal(
    typeof helperExports.__testing.setPlaywrightTaskSpaceConnector,
    "function",
  );
  const restore = helperExports.__testing.setPlaywrightTaskSpaceConnector(
    async (space) => {
      assert.equal(space.id, task.id);
      return { page, context: browserContext, close: async () => {} };
    },
  );

  try {
    await withEgo(
      {
        async listTaskSpaces() {
          return { taskSpaces: [] };
        },
        async createTaskSpace() {
          return task;
        },
        async useTaskSpace() {
          return {};
        },
      },
      async () => {
        const space =
          await helperContext().egoBrowser.newTaskSpace("inspect-products");

        assert.equal(space.page, page);
        assert.equal(space.context, browserContext);
        assert.equal(space.tabs, undefined);
        assert.equal(
          JSON.stringify(space),
          JSON.stringify({
            taskId: task.taskId,
            id: task.id,
            name: task.name,
            ownership: task.ownership,
          }),
        );
      },
    );
  } finally {
    restore();
  }
});

test("egoBrowser TaskSpace rejects a connector without a Playwright Page and BrowserContext", async () => {
  const restore = helperExports.__testing.setPlaywrightTaskSpaceConnector(
    async () => ({
      page: undefined,
      context: undefined,
      close: async () => {},
    }),
  );

  try {
    await withEgo(
      {
        async listTaskSpaces() {
          return { taskSpaces: [] };
        },
        async createTaskSpace() {
          return {
            taskId: "missing-playwright",
            id: 22,
            name: "Missing Playwright",
            ownership: "agent",
          };
        },
        async useTaskSpace() {
          return {};
        },
      },
      async () => {
        await assert.rejects(
          () => helperContext().egoBrowser.newTaskSpace("missing-playwright"),
          /Playwright TaskSpace connector did not return Page and BrowserContext/,
        );
      },
    );
  } finally {
    restore();
  }
});

test("egoBrowser claimTaskSpace returns a bound TaskSpace", async () => {
  const task = {
    taskId: "checkout-flow",
    id: 18,
    name: "Checkout flow",
    ownership: "user",
  };

  await withEgo(
    {
      async listTaskSpaces() {
        return { taskSpaces: [task] };
      },
      async claimTaskSpace(id, name) {
        return { ...task, id, name, ownership: "agent" };
      },
      async useTaskSpace() {
        return {};
      },
    },
    async () => {
      const space = await helperContext().egoBrowser.claimTaskSpace(task.id);
      assert.equal(space.ownership, "agent");
      assert.equal(typeof space.page, "object");
      assert.equal(typeof space.context, "object");
      assert.equal(space.tabs, undefined);
    },
  );
});

test("egoBrowser handOffTaskSpace preserves the handoff result", async () => {
  const task = {
    taskId: "checkout-flow",
    id: 19,
    name: "Checkout flow",
    ownership: "agent",
  };

  await withEgo(
    {
      async listTaskSpaces() {
        return { taskSpaces: [task] };
      },
      async useTaskSpace() {
        return {};
      },
      async handOffTaskSpace() {
        return {};
      },
    },
    async () => {
      assert.deepEqual(
        await helperContext().egoBrowser.handOffTaskSpace(task.id),
        { done: true },
      );
    },
  );
});

test("egoBrowser takeOverTaskSpace reports restored control", async () => {
  const calls = [];
  const task = {
    taskId: "checkout-flow",
    id: 20,
    name: "Checkout flow",
    ownership: "agentDelegatedToUser",
  };

  await withEgo(
    {
      async listTaskSpaces() {
        return { taskSpaces: [task] };
      },
      async useTaskSpace(id) {
        calls.push(["useTaskSpace", id]);
        return {};
      },
      async takeOverTaskSpace() {
        calls.push(["takeOverTaskSpace"]);
        return {};
      },
    },
    async () => {
      assert.deepEqual(
        await helperContext().egoBrowser.takeOverTaskSpace(task.id),
        { done: true },
      );
    },
  );

  assert.deepEqual(calls, [["useTaskSpace", task.id], ["takeOverTaskSpace"]]);
});

test("egoBrowser lists lightweight TaskSpace information without switching", async () => {
  const calls = [];
  const task = {
    taskId: "inspect-products",
    id: 7,
    name: "Inspect products",
    ownership: "agent",
    recentTabTitles: ["Products"],
  };

  await withEgo(
    {
      async listTaskSpaces() {
        calls.push(["listTaskSpaces"]);
        return { taskSpaces: [task] };
      },
      async useTaskSpace(id) {
        calls.push(["useTaskSpace", id]);
        return {};
      },
    },
    async () => {
      assert.deepEqual(await helperContext().egoBrowser.listTaskSpace(), [
        task,
      ]);
    },
  );

  assert.deepEqual(calls, [["listTaskSpaces"]]);
});

test("egoBrowser complete and close return structured success results", async () => {
  const calls = [];
  let closed = false;
  const task = {
    taskId: "inspect-products",
    id: 7,
    name: "Inspect products",
    ownership: "agent",
  };
  await withEgo(
    {
      async listTaskSpaces() {
        calls.push(["listTaskSpaces"]);
        return { taskSpaces: closed ? [] : [task] };
      },
      async useTaskSpace(id) {
        calls.push(["useTaskSpace", id]);
        return {};
      },
      async completeTaskSpace() {
        calls.push(["completeTaskSpace"]);
        return {};
      },
      async closeTaskSpace() {
        calls.push(["closeTaskSpace"]);
        closed = true;
        return {};
      },
    },
    async () => {
      const context = helperContext();
      assert.deepEqual(await context.egoBrowser.completeTaskSpace(task.id), {
        done: true,
      });
      assert.deepEqual(await context.egoBrowser.closeTaskSpace(task.id), {
        done: true,
      });
    },
  );

  assert.deepEqual(calls, [
    ["listTaskSpaces"],
    ["useTaskSpace", 7],
    ["completeTaskSpace"],
    ["listTaskSpaces"],
    ["useTaskSpace", 7],
    ["closeTaskSpace"],
    ["listTaskSpaces"],
  ]);
});

test("egoBrowser close waits until the TaskSpace is no longer listed", async () => {
  let closed = false;
  let listingsAfterClose = 0;
  const task = {
    taskId: "slow-teardown",
    id: 9,
    name: "Slow teardown",
    ownership: "agent",
  };
  await withEgo(
    {
      async listTaskSpaces() {
        if (!closed) return { taskSpaces: [task] };
        listingsAfterClose += 1;
        // The native side keeps listing the space for a few polls after the
        // close command resolves, as the real browser does.
        return { taskSpaces: listingsAfterClose < 3 ? [task] : [] };
      },
      async useTaskSpace() {
        return {};
      },
      async closeTaskSpace() {
        closed = true;
        return {};
      },
    },
    async () => {
      const context = helperContext();
      assert.deepEqual(await context.egoBrowser.closeTaskSpace(task.id), {
        done: true,
      });
    },
  );

  assert.equal(listingsAfterClose, 3);
});

test("egoBrowser terminal actions close the active Playwright connection", async () => {
  const calls = [];
  let created = false;
  const task = {
    taskId: "terminal-cleanup",
    id: 23,
    name: "Terminal cleanup",
    ownership: "agent",
  };
  const restore = helperExports.__testing.setPlaywrightTaskSpaceConnector(
    async () => ({
      page: {},
      context: {},
      async close() {
        calls.push("playwright.close");
      },
    }),
  );

  try {
    await withEgo(
      {
        async createTaskSpace() {
          created = true;
          return task;
        },
        async listTaskSpaces() {
          return { taskSpaces: created ? [task] : [] };
        },
        async useTaskSpace() {
          return {};
        },
        async completeTaskSpace() {
          calls.push("task.complete");
          return {};
        },
      },
      async () => {
        const context = helperContext();
        await context.egoBrowser.newTaskSpace(task.name);
        await context.egoBrowser.completeTaskSpace(task.id);
      },
    );
  } finally {
    restore();
  }

  assert.deepEqual(calls, ["playwright.close", "task.complete"]);
});

test("egoBrowser complete reports when a user-owned TaskSpace is skipped", async () => {
  const task = {
    taskId: "user-space",
    id: 7,
    name: "User space",
    ownership: "user",
  };
  await withEgo(
    {
      async listTaskSpaces() {
        return { taskSpaces: [task] };
      },
    },
    async () => {
      assert.deepEqual(
        await helperContext().egoBrowser.completeTaskSpace(task.id),
        { done: false, skipped: "user-owned" },
      );
    },
  );
});

test("helper surface exposes TaskSpace control without legacy page or tabs facades", () => {
  const context = helperContext();

  assert.equal(context.page, undefined);
  assert.equal(context.tabs, undefined);
  assert.equal(typeof context.egoBrowser.newTaskSpace, "function");
  assert.equal(typeof context.egoBrowser.switchTaskSpace, "function");
  assert.equal(typeof context.site.runTool, "function");
  assert.equal(typeof context.fetch.server, "function");
  assert.equal(typeof context.cdp, "function");
  assert.equal(typeof context.egoBrowser.helper, "function");
  assert.equal(context.help, undefined);
});

test("fetch remains callable while exposing the server and browser helpers", async () => {
  const context = helperContext();

  assert.equal(typeof context.fetch, "function");
  assert.equal(typeof context.fetch.server, "function");
  assert.equal(typeof context.fetch.browser, "function");
  const response = await context.fetch("data:text/plain,native-fetch");
  assert.equal(await response.text(), "native-fetch");
});
test("switchTaskSpace selects a matching task space", async () => {
  const calls = [];
  await withEgo(
    {
      async listTaskSpaces() {
        return {
          taskSpaces: [
            {
              taskId: "checkout-flow",
              id: 7,
              name: "Checkout flow",
              ownership: "agent",
            },
          ],
        };
      },
      useTaskSpace(taskId) {
        calls.push(["useTaskSpace", taskId]);
        return taskId;
      },
    },
    async () => {
      assert.deepEqual(await switchTaskSpace(7), {
        taskId: "checkout-flow",
        id: 7,
        name: "Checkout flow",
        ownership: "agent",
      });
    },
  );
  assert.deepEqual(calls, [["useTaskSpace", 7]]);
});

test("switchTaskSpace rejects non-agent-owned task spaces", async () => {
  await withEgo(
    {
      async listTaskSpaces() {
        return {
          taskSpaces: [
            {
              taskId: "checkout-flow",
              id: 7,
              name: "checkout-flow",
              ownership: "user",
            },
          ],
        };
      },
      useTaskSpace() {},
    },
    async () => {
      await assert.rejects(
        () => switchTaskSpace("checkout-flow"),
        /switchTaskSpace requires an agent-owned task space/,
      );
    },
  );
});

test("switchTaskSpace awaits useTaskSpace binding errors", async () => {
  await withEgo(
    {
      async listTaskSpaces() {
        return {
          taskSpaces: [
            {
              taskId: "checkout-flow",
              id: 7,
              name: "checkout-flow",
              ownership: "agent",
            },
          ],
        };
      },
      async useTaskSpace() {
        return { error: "Task space not selected" };
      },
    },
    async () => {
      await assert.rejects(
        () => switchTaskSpace("checkout-flow"),
        /switchTaskSpace: Task space not selected/,
      );
    },
  );
});

test("newTaskSpace creates and selects an agent task space", async () => {
  const calls = [];
  await withEgo(
    {
      async listTaskSpaces() {
        calls.push(["listTaskSpaces"]);
        return { taskSpaces: [] };
      },
      async createTaskSpace(name) {
        calls.push(["createTaskSpace", name]);
        return { taskId: name, id: 7, name, ownership: "agent" };
      },
      useTaskSpace(taskId) {
        calls.push(["useTaskSpace", taskId]);
        return taskId;
      },
    },
    async () => {
      assert.deepEqual(await newTaskSpace("checkout-flow"), {
        taskId: "checkout-flow",
        id: 7,
        name: "checkout-flow",
        ownership: "agent",
      });
    },
  );
  assert.deepEqual(calls, [
    ["listTaskSpaces"],
    ["createTaskSpace", "checkout-flow"],
    ["useTaskSpace", 7],
  ]);
});

test("newTaskSpace rejects an existing agent-owned name before native creation", async () => {
  const calls = [];
  await withEgo(
    {
      async listTaskSpaces() {
        calls.push(["listTaskSpaces"]);
        return {
          taskSpaces: [
            {
              taskId: "checkout-flow",
              id: 7,
              name: "checkout-flow",
              ownership: "agent",
            },
          ],
        };
      },
      async createTaskSpace(name) {
        calls.push(["createTaskSpace", name]);
        return { taskId: name, id: 8, name, ownership: "agent" };
      },
    },
    async () => {
      await assert.rejects(
        () => newTaskSpace("checkout-flow"),
        /TaskSpace 7 already uses this name.*switchTaskSpace\(7\)/,
      );
    },
  );
  assert.deepEqual(calls, [["listTaskSpaces"]]);
});

test("newTaskSpace rejects an existing user-owned name before native creation", async () => {
  const calls = [];
  await withEgo(
    {
      async listTaskSpaces() {
        calls.push(["listTaskSpaces"]);
        return {
          taskSpaces: [
            {
              taskId: "checkout-flow",
              id: 7,
              name: "checkout-flow",
              ownership: "user",
            },
          ],
        };
      },
      async createTaskSpace(name) {
        calls.push(["createTaskSpace", name]);
        return { taskId: name, id: 8, name, ownership: "agent" };
      },
    },
    async () => {
      await assert.rejects(
        () => newTaskSpace("checkout-flow"),
        /TaskSpace 7 already uses this name.*user-owned.*unique name.*closeTaskSpace\(7\)/,
      );
    },
  );
  assert.deepEqual(calls, [["listTaskSpaces"]]);
});

test("newTaskSpace creates a task space with the selected profile id", async () => {
  const calls = [];
  await withEgo(
    {
      async listTaskSpaces() {
        calls.push(["listTaskSpaces"]);
        return { taskSpaces: [] };
      },
      async createTaskSpace(name, profileId) {
        calls.push(["createTaskSpace", name, profileId]);
        return { taskId: name, id: 7, name, ownership: "agent" };
      },
      useTaskSpace(id) {
        calls.push(["useTaskSpace", id]);
        return id;
      },
    },
    async () => {
      await newTaskSpace("checkout-flow", "Profile 2");
    },
  );
  assert.deepEqual(calls, [
    ["listTaskSpaces"],
    ["createTaskSpace", "checkout-flow", "Profile 2"],
    ["useTaskSpace", 7],
  ]);
});

test("egoBrowser.newTaskSpace forwards the selected profile id", async () => {
  const calls = [];
  await withEgo(
    {
      async listTaskSpaces() {
        calls.push(["listTaskSpaces"]);
        return { taskSpaces: [] };
      },
      async createTaskSpace(name, profileId) {
        calls.push(["createTaskSpace", name, profileId]);
        return { taskId: name, id: 7, name, ownership: "agent" };
      },
      useTaskSpace() {},
    },
    async () => {
      await helperContext().egoBrowser.newTaskSpace(
        "checkout-flow",
        "Profile 2",
      );
    },
  );
  assert.deepEqual(calls, [
    ["listTaskSpaces"],
    ["createTaskSpace", "checkout-flow", "Profile 2"],
  ]);
});

test("newTaskSpace rejects results without a numeric id", async () => {
  const calls = [];
  await withEgo(
    {
      async createTaskSpace(name) {
        calls.push(["createTaskSpace", name]);
        return { taskId: name, id: name, name };
      },
      async listTaskSpaces() {
        calls.push(["listTaskSpaces"]);
        return { taskSpaces: [] };
      },
      useTaskSpace(id) {
        calls.push(["useTaskSpace", id]);
      },
    },
    async () => {
      await assert.rejects(
        () => newTaskSpace("checkout-flow"),
        /newTaskSpace requires a numeric task space id/,
      );
    },
  );
  assert.deepEqual(calls, [
    ["listTaskSpaces"],
    ["createTaskSpace", "checkout-flow"],
  ]);
});

test("newTaskSpace throws on binding error objects", async () => {
  await withEgo(
    {
      async listTaskSpaces() {
        return { taskSpaces: [] };
      },
      async createTaskSpace() {
        return { error: "Task space already exists: checkout-flow" };
      },
      useTaskSpace() {},
    },
    async () => {
      await assert.rejects(
        () => newTaskSpace("checkout-flow"),
        /newTaskSpace: Task space already exists: checkout-flow/,
      );
    },
  );
});

test("newTaskSpace preserves profile-not-found errors from the native binding", async () => {
  await withEgo(
    {
      async listTaskSpaces() {
        return { taskSpaces: [] };
      },
      async createTaskSpace() {
        return {
          error: "Profile not found",
          error_code: "EGO_PROFILE_NOT_FOUND",
        };
      },
      useTaskSpace() {},
    },
    async () => {
      await assert.rejects(
        () => newTaskSpace("checkout-flow", "missing-profile"),
        (error) => {
          assert.match(error.message, /newTaskSpace: Profile not found/);
          assert.equal(error.error_code, "EGO_PROFILE_NOT_FOUND");
          return true;
        },
      );
    },
  );
});

test("claimTaskSpace claims and selects an existing user-owned space", async () => {
  const calls = [];
  await withEgo(
    {
      async listTaskSpaces() {
        calls.push(["listTaskSpaces"]);
        return {
          taskSpaces: [
            {
              taskId: "checkout-flow",
              id: 7,
              name: "checkout-flow",
              ownership: "user",
            },
          ],
        };
      },
      async claimTaskSpace(id, name) {
        calls.push(["claimTaskSpace", id, name]);
        return { taskId: name, id, name, ownership: "agent" };
      },
      useTaskSpace(taskId) {
        calls.push(["useTaskSpace", taskId]);
        return taskId;
      },
    },
    async () => {
      assert.deepEqual(await claimTaskSpace("checkout-flow"), {
        taskId: "checkout-flow",
        id: 7,
        name: "checkout-flow",
        ownership: "agent",
      });
    },
  );
  assert.deepEqual(calls, [
    ["listTaskSpaces"],
    ["claimTaskSpace", 7, "checkout-flow"],
    ["useTaskSpace", 7],
  ]);
});

test("claimTaskSpace throws on an unknown task space", async () => {
  const calls = [];
  await withEgo(
    {
      async listTaskSpaces() {
        calls.push(["listTaskSpaces"]);
        return { taskSpaces: [] };
      },
      async claimTaskSpace(id, name) {
        calls.push(["claimTaskSpace", id, name]);
        return { taskId: name, id, name, ownership: "agent" };
      },
    },
    async () => {
      await assert.rejects(
        () => claimTaskSpace("checkout-flow"),
        /task space not found: checkout-flow/,
      );
    },
  );
  assert.deepEqual(calls, [["listTaskSpaces"]]);
});

test("completeTaskSpace selects by numeric id before completing", async () => {
  const calls = [];
  await withEgo(
    {
      async listTaskSpaces() {
        calls.push(["listTaskSpaces"]);
        return {
          taskSpaces: [
            {
              taskId: "checkout-flow",
              id: 7,
              name: "checkout-flow",
              ownership: "agent",
            },
          ],
        };
      },
      useTaskSpace(id) {
        calls.push(["useTaskSpace", id]);
        return id;
      },
      async completeTaskSpace() {
        calls.push(["completeTaskSpace"]);
        return "7 task space completed.";
      },
    },
    async () => {
      await completeTaskSpace("checkout-flow", { keep: true });
    },
  );
  assert.deepEqual(calls, [
    ["listTaskSpaces"],
    ["useTaskSpace", 7],
    ["completeTaskSpace"],
  ]);
});

test("completeTaskSpace waits for async useTaskSpace before completing", async () => {
  const calls = [];
  await withEgo(
    {
      async listTaskSpaces() {
        calls.push(["listTaskSpaces"]);
        return {
          taskSpaces: [
            {
              taskId: "checkout-flow",
              id: 7,
              name: "checkout-flow",
              ownership: "agent",
            },
          ],
        };
      },
      async useTaskSpace(id) {
        calls.push(["useTaskSpace:start", id]);
        await new Promise((resolve) => setTimeout(resolve, 0));
        calls.push(["useTaskSpace:end", id]);
      },
      async completeTaskSpace() {
        calls.push(["completeTaskSpace"]);
        return "7 task space completed.";
      },
    },
    async () => {
      await completeTaskSpace("checkout-flow", { keep: true });
    },
  );
  assert.deepEqual(calls, [
    ["listTaskSpaces"],
    ["useTaskSpace:start", 7],
    ["useTaskSpace:end", 7],
    ["completeTaskSpace"],
  ]);
});

test("completeTaskSpace claims user-owned spaces before closing", async () => {
  const calls = [];
  let closed = false;
  await withEgo(
    {
      async listTaskSpaces() {
        calls.push(["listTaskSpaces"]);
        return {
          taskSpaces: closed
            ? []
            : [
                {
                  taskId: "checkout-flow",
                  id: 7,
                  name: "checkout-flow",
                  ownership: "user",
                },
              ],
        };
      },
      async claimTaskSpace(id, name) {
        calls.push(["claimTaskSpace", id, name]);
        return { taskId: name, id, name, ownership: "agent" };
      },
      async useTaskSpace(id) {
        calls.push(["useTaskSpace", id]);
        return id;
      },
      async closeTaskSpace() {
        calls.push(["closeTaskSpace"]);
        closed = true;
        return "7 task space closed.";
      },
    },
    async () => {
      const result = await completeTaskSpace("checkout-flow", { keep: false });
      assert.deepEqual(result, { done: true });
    },
  );
  assert.deepEqual(calls, [
    ["listTaskSpaces"],
    ["claimTaskSpace", 7, "checkout-flow"],
    ["useTaskSpace", 7],
    ["closeTaskSpace"],
    ["listTaskSpaces"],
  ]);
});

test("completeTaskSpace keep true skips user-owned spaces and reports it", async () => {
  const calls = [];
  await withEgo(
    {
      async listTaskSpaces() {
        calls.push(["listTaskSpaces"]);
        return {
          taskSpaces: [
            {
              taskId: "checkout-flow",
              id: 7,
              name: "checkout-flow",
              ownership: "user",
            },
          ],
        };
      },
      async completeTaskSpace() {
        calls.push(["completeTaskSpace"]);
      },
    },
    async () => {
      const result = await completeTaskSpace("checkout-flow", { keep: true });
      assert.deepEqual(result, { done: false, skipped: "user-owned" });
    },
  );
  assert.deepEqual(calls, [["listTaskSpaces"]]);
});

test("handOffTaskSpace skips user-owned spaces and reports it", async () => {
  const calls = [];
  await withEgo(
    {
      async listTaskSpaces() {
        calls.push(["listTaskSpaces"]);
        return {
          taskSpaces: [
            {
              taskId: "checkout-flow",
              id: 7,
              name: "checkout-flow",
              ownership: "user",
            },
          ],
        };
      },
      async handOffTaskSpace() {
        calls.push(["handOffTaskSpace"]);
      },
    },
    async () => {
      const result = await handOffTaskSpace("checkout-flow");
      assert.deepEqual(result, { done: false, skipped: "user-owned" });
    },
  );
  assert.deepEqual(calls, [["listTaskSpaces"]]);
});

test("handOffTaskSpace reports done for agent-owned spaces", async () => {
  const calls = [];
  await withEgo(
    {
      async listTaskSpaces() {
        calls.push(["listTaskSpaces"]);
        return {
          taskSpaces: [
            {
              taskId: "checkout-flow",
              id: 7,
              name: "checkout-flow",
              ownership: "agent",
            },
          ],
        };
      },
      async useTaskSpace(id) {
        calls.push(["useTaskSpace", id]);
        return id;
      },
      async handOffTaskSpace() {
        calls.push(["handOffTaskSpace"]);
      },
    },
    async () => {
      const result = await handOffTaskSpace("checkout-flow");
      assert.deepEqual(result, { done: true });
    },
  );
  assert.deepEqual(calls, [
    ["listTaskSpaces"],
    ["useTaskSpace", 7],
    ["handOffTaskSpace"],
  ]);
});

// The probe in waitForAgentControl keys on ego.snapshot()'s rejection carrying
// error_code === EGO_TASK_SPACE_USER_IN_CONTROL (the documented contract), not on
// message wording. These tests pin that contract so a runtime that stops setting
// the code surfaces as a failing test rather than a silent regression.
function taskSpaceEgo(snapshot) {
  return {
    async listTaskSpaces() {
      return {
        taskSpaces: [
          {
            taskId: "t",
            id: 2_147_482_701,
            name: "t",
            ownership: "agent",
          },
        ],
      };
    },
    async useTaskSpace() {
      return 1;
    },
    snapshot,
  };
}

test("waitForAgentControl retries while snapshot reports user control", async () => {
  const sleepCalls = [];
  const restore = helperExports.__testing.setOverrides({
    sleep: (milliseconds) => {
      sleepCalls.push(milliseconds);
      return Promise.resolve();
    },
  });
  let calls = 0;
  try {
    await withEgo(
      taskSpaceEgo(async () => {
        calls += 1;
        if (calls < 3) {
          throw Object.assign(new Error("anything at all"), {
            error_code: "EGO_TASK_SPACE_USER_IN_CONTROL",
          });
        }
        return { content: "" };
      }),
      async () => {
        assert.deepEqual(
          await helperContext().egoBrowser.waitForAgentControlTaskSpace("t", {
            interval: 25,
            timeout: 5_000,
          }),
          { done: true },
        );
      },
    );
  } finally {
    restore();
  }
  assert.equal(calls, 3);
  assert.deepEqual(sleepCalls, [25, 25]);
});

test("waitForAgentControl reports timeout in milliseconds", async () => {
  await withEgo(
    taskSpaceEgo(async () => {
      throw Object.assign(new Error("user controls the task space"), {
        error_code: "EGO_TASK_SPACE_USER_IN_CONTROL",
      });
    }),
    async () => {
      await assert.rejects(
        () => waitForAgentControl("t", { interval: 0, timeout: 0 }),
        /timed out after 0ms/,
      );
    },
  );
});

test("waitForAgentControl propagates non-user-control snapshot errors", async () => {
  await withEgo(
    taskSpaceEgo(async () => {
      throw Object.assign(new Error("snapshot failed"), {
        error_code: "EGO_SNAPSHOT_FAILED",
      });
    }),
    async () => {
      await assert.rejects(
        () => waitForAgentControl("t", { interval: 0, timeout: 5_000 }),
        /snapshot failed/,
      );
    },
  );
});
