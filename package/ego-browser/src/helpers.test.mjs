import test from "node:test";
import assert from "node:assert/strict";

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
  claimTaskSpace,
  completeTaskSpace,
  handOffTaskSpace,
  newTaskSpace,
  helperContext,
  listTaskSpaces,
  useOrCreateTaskSpace,
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
    "snapshot",
    "switchTaskSpace",
    "takeOverTaskSpace",
    "useOrCreateTaskSpace",
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

test("egoBrowser useOrCreateTaskSpace returns a bound TaskSpace", async () => {
  const task = {
    taskId: "checkout-flow",
    id: 17,
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
    },
    async () => {
      const space = await helperContext().egoBrowser.useOrCreateTaskSpace(
        task.id,
      );
      assert.equal(space.id, task.id);
      assert.equal(typeof space.page, "object");
      assert.equal(typeof space.context, "object");
      assert.equal(space.tabs, undefined);
    },
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
        return { taskSpaces: [task] };
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
  ]);
});

test("egoBrowser terminal actions close the active Playwright connection", async () => {
  const calls = [];
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
          return task;
        },
        async listTaskSpaces() {
          return { taskSpaces: [task] };
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
    ["createTaskSpace", "checkout-flow"],
    ["useTaskSpace", 7],
  ]);
});

test("newTaskSpace creates a task space with the selected profile id", async () => {
  const calls = [];
  await withEgo(
    {
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
    ["createTaskSpace", "checkout-flow", "Profile 2"],
    ["useTaskSpace", 7],
  ]);
});

test("egoBrowser.newTaskSpace forwards the selected profile id", async () => {
  const calls = [];
  await withEgo(
    {
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
  assert.deepEqual(calls, [["createTaskSpace", "checkout-flow", "Profile 2"]]);
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
      },
    },
    async () => {
      await assert.rejects(
        () => newTaskSpace("checkout-flow"),
        /newTaskSpace requires a numeric task space id/,
      );
    },
  );
  assert.deepEqual(calls, [["createTaskSpace", "checkout-flow"]]);
});

test("newTaskSpace throws on binding error objects", async () => {
  await withEgo(
    {
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

test("useOrCreateTaskSpace reuses existing agent-owned spaces", async () => {
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
      useTaskSpace(taskId) {
        calls.push(["useTaskSpace", taskId]);
        return taskId;
      },
      async createTaskSpace(name) {
        calls.push(["createTaskSpace", name]);
        return { taskId: name, id: 8, name, ownership: "agent" };
      },
      async claimTaskSpace(id, name) {
        calls.push(["claimTaskSpace", id, name]);
        return { taskId: name, id, name, ownership: "agent" };
      },
    },
    async () => {
      assert.deepEqual(await useOrCreateTaskSpace("checkout-flow"), {
        taskId: "checkout-flow",
        id: 7,
        name: "checkout-flow",
        ownership: "agent",
      });
    },
  );
  assert.deepEqual(calls, [["listTaskSpaces"], ["useTaskSpace", 7]]);
});

test("useOrCreateTaskSpace selects user-owned spaces without claiming and surfaces the owned user-control guidance", async () => {
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
        // Native attaches the stable code; resolveEgoError overrides the live
        // text with ego-browser's owned EGO_TASK_SPACE_USER_IN_CONTROL guidance.
        return {
          error: "The task is under user control",
          error_code: "EGO_TASK_SPACE_USER_IN_CONTROL",
        };
      },
    },
    async () => {
      await assert.rejects(
        () => useOrCreateTaskSpace("checkout-flow"),
        /useOrCreateTaskSpace: The user has taken control of this task space/,
      );
    },
  );
  assert.deepEqual(calls, [["listTaskSpaces"], ["useTaskSpace", 7]]);
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

test("useOrCreateTaskSpace creates missing spaces", async () => {
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
      assert.deepEqual(await useOrCreateTaskSpace("checkout-flow"), {
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

test("useOrCreateTaskSpace resolves string names before numeric id strings", async () => {
  const calls = [];
  await withEgo(
    {
      async listTaskSpaces() {
        calls.push(["listTaskSpaces"]);
        return {
          taskSpaces: [
            {
              taskId: "plain-seven",
              id: 7,
              name: "plain-seven",
              ownership: "agent",
            },
            { taskId: "7", id: 8, name: "7", ownership: "agent" },
          ],
        };
      },
      useTaskSpace(id) {
        calls.push(["useTaskSpace", id]);
        return id;
      },
    },
    async () => {
      assert.deepEqual(await useOrCreateTaskSpace("7"), {
        taskId: "7",
        id: 8,
        name: "7",
        ownership: "agent",
      });
    },
  );
  assert.deepEqual(calls, [["listTaskSpaces"], ["useTaskSpace", 8]]);
});

test("useOrCreateTaskSpace resolves numeric strings by id when name is absent", async () => {
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
    },
    async () => {
      assert.deepEqual(await useOrCreateTaskSpace("7"), {
        taskId: "checkout-flow",
        id: 7,
        name: "checkout-flow",
        ownership: "agent",
      });
    },
  );
  assert.deepEqual(calls, [["listTaskSpaces"], ["useTaskSpace", 7]]);
});

test("useOrCreateTaskSpace rejects missing numeric ids instead of creating", async () => {
  const calls = [];
  await withEgo(
    {
      async listTaskSpaces() {
        calls.push(["listTaskSpaces"]);
        return { taskSpaces: [] };
      },
      async createTaskSpace(name) {
        calls.push(["createTaskSpace", name]);
        return {
          taskId: String(name),
          id: 7,
          name: String(name),
          ownership: "agent",
        };
      },
    },
    async () => {
      await assert.rejects(
        () => useOrCreateTaskSpace(7),
        /task space not found: 7/,
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
      async useTaskSpace(id) {
        calls.push(["useTaskSpace", id]);
        return id;
      },
      async closeTaskSpace() {
        calls.push(["closeTaskSpace"]);
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

test("useOrCreateTaskSpace rejects unknown ownership", async () => {
  await withEgo(
    {
      async listTaskSpaces() {
        return {
          taskSpaces: [
            {
              taskId: "checkout-flow",
              id: 7,
              name: "checkout-flow",
              ownership: "shared",
            },
          ],
        };
      },
    },
    async () => {
      await assert.rejects(
        () => useOrCreateTaskSpace("checkout-flow"),
        /ownership "shared"/,
      );
    },
  );
});

// The probe in waitForAgentControl keys on ego.snapshot()'s rejection carrying
// error_code === EGO_TASK_SPACE_USER_IN_CONTROL (the documented contract), not on
// message wording. These tests pin that contract so a runtime that stops setting
// the code surfaces as a failing test rather than a silent regression.
function taskSpaceEgo(snapshot) {
  return {
    async listTaskSpaces() {
      return {
        taskSpaces: [{ taskId: "t", id: 1, name: "t", ownership: "agent" }],
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
