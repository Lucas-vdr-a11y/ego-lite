import test from "node:test";
import assert from "node:assert/strict";

import { runMain } from "../dist/src/run.js";
import { __testing } from "../dist/src/helpers.js";
import { disconnectPlaywrightTaskSpace } from "../dist/src/playwright/taskspace.js";

const restoreDefaultPlaywrightConnector =
  __testing.setPlaywrightTaskSpaceConnector(async () => ({
    page: {},
    context: {},
    close: async () => {},
  }));

test.after(async () => {
  await disconnectPlaywrightTaskSpace();
  restoreDefaultPlaywrightConnector();
});

class FakeEgo {
  constructor(taskSpaces = []) {
    this.taskSpaces = taskSpaces.map((space) => ({ ...space }));
    this.calls = [];
    this.selectedId = null;
    this.nextId =
      Math.max(
        0,
        ...this.taskSpaces.map((space) =>
          typeof space.id === "number" ? space.id : 0,
        ),
      ) + 1;
  }

  async listTaskSpaces() {
    this.calls.push(["listTaskSpaces"]);
    return { taskSpaces: this.taskSpaces.map((space) => ({ ...space })) };
  }

  useTaskSpace(id) {
    if (typeof id !== "number") {
      throw new TypeError("useTaskSpace requires numeric id");
    }
    this.calls.push(["useTaskSpace", id]);
    const space = this.taskSpaces.find((candidate) => candidate.id === id);
    if (space && space.ownership === "user") {
      return {
        error: "The task is under user control",
        error_code: "EGO_TASK_SPACE_USER_IN_CONTROL",
      };
    }
    this.selectedId = id;
    return id;
  }

  async createTaskSpace(name) {
    this.calls.push(["createTaskSpace", name]);
    if (
      this.taskSpaces.some(
        (space) => space.taskId === name || space.name === name,
      )
    ) {
      return { error: `Task space already exists: ${name}` };
    }
    const created = {
      taskId: name,
      id: this.nextId++,
      name,
      createdBy: "agent",
      ownership: "agent",
      recentTabTitles: [],
      tabs: {},
    };
    this.taskSpaces.push(created);
    return { ...created };
  }

  async claimTaskSpace(id, name) {
    if (typeof id !== "number") {
      throw new TypeError("claimTaskSpace requires numeric id");
    }
    this.calls.push(["claimTaskSpace", id, name]);
    const space = this.taskSpaces.find((candidate) => candidate.id === id);
    if (!space || space.ownership !== "user") {
      return { error: `Task space not found: ${id}` };
    }
    if (name !== undefined) {
      space.name = name;
      space.taskId = name;
    }
    space.createdBy = "agent";
    space.ownership = "agent";
    return { ...space };
  }
}

async function runTaskspaceScript(ego, code) {
  const previous = globalThis.ego;
  globalThis.ego = ego;
  const stdout = captureStream();
  const stderr = captureStream();
  try {
    const exitCode = await runMain({
      argv: [],
      stdinText: code,
      stdout,
      stderr,
      services: { printUpdateBanner() {} },
    });
    return { exitCode, stdout: stdout.text(), stderr: stderr.text() };
  } finally {
    if (previous === undefined) {
      delete globalThis.ego;
    } else {
      globalThis.ego = previous;
    }
  }
}

function captureStream() {
  const chunks = [];
  return {
    write(chunk) {
      chunks.push(String(chunk));
    },
    text() {
      return chunks.join("");
    },
  };
}

function firstJsonLine(output) {
  return JSON.parse(output.trim().split(/\r?\n/)[0]);
}

test("the CLI disposes its Playwright TaskSpace connection after the script", async () => {
  const ego = new FakeEgo();
  const calls = [];
  const restore = __testing.setPlaywrightTaskSpaceConnector(async (space) => ({
    page: { taskSpaceId: space.id },
    context: { taskSpaceId: space.id },
    async close() {
      calls.push(["close", space.id]);
    },
  }));

  try {
    const result = await runTaskspaceScript(
      ego,
      `await egoBrowser.newTaskSpace("playwright-cleanup")`,
    );

    assert.equal(result.exitCode, 0);
    assert.deepEqual(calls, [["close", 1]]);
  } finally {
    await disconnectPlaywrightTaskSpace();
    restore();
  }
});

test("taskspace e2e creates and selects a missing task space", async () => {
  const ego = new FakeEgo();
  const result = await runTaskspaceScript(
    ego,
    `
    const task = await egoBrowser.useOrCreateTaskSpace("checkout-flow");
    console.log(JSON.stringify({ task, selected: ego.selectedId }));
  `,
  );

  assert.equal(result.exitCode, 0);
  assert.deepEqual(firstJsonLine(result.stdout), {
    task: {
      taskId: "checkout-flow",
      id: 1,
      name: "checkout-flow",
      createdBy: "agent",
      ownership: "agent",
      recentTabTitles: [],
    },
    selected: 1,
  });
  assert.deepEqual(ego.calls, [
    ["listTaskSpaces"],
    ["createTaskSpace", "checkout-flow"],
    ["useTaskSpace", 1],
  ]);
});

test("taskspace e2e reuses an existing agent-owned task space", async () => {
  const ego = new FakeEgo([
    {
      taskId: "checkout-flow",
      id: 7,
      name: "Checkout flow",
      createdBy: "agent",
      ownership: "agent",
    },
  ]);
  const result = await runTaskspaceScript(
    ego,
    `
    const task = await egoBrowser.useOrCreateTaskSpace(7);
    console.log(JSON.stringify({ task, selected: ego.selectedId }));
  `,
  );

  assert.equal(result.exitCode, 0);
  assert.deepEqual(firstJsonLine(result.stdout), {
    task: {
      taskId: "checkout-flow",
      id: 7,
      name: "Checkout flow",
      createdBy: "agent",
      ownership: "agent",
    },
    selected: 7,
  });
  assert.deepEqual(ego.calls, [["listTaskSpaces"], ["useTaskSpace", 7]]);
});

test("taskspace e2e claims and selects an existing user-owned task space", async () => {
  const ego = new FakeEgo([
    {
      taskId: "checkout-flow",
      id: 7,
      name: "checkout-flow",
      createdBy: "user",
      ownership: "user",
    },
  ]);
  const result = await runTaskspaceScript(
    ego,
    `
    const task = await egoBrowser.claimTaskSpace("checkout-flow");
    console.log(JSON.stringify({ task, selected: ego.selectedId }));
  `,
  );

  assert.equal(result.exitCode, 0);
  assert.deepEqual(firstJsonLine(result.stdout), {
    task: {
      taskId: "checkout-flow",
      id: 7,
      name: "checkout-flow",
      createdBy: "agent",
      ownership: "agent",
    },
    selected: 7,
  });
  assert.deepEqual(ego.calls, [
    ["listTaskSpaces"],
    ["claimTaskSpace", 7, "checkout-flow"],
    ["useTaskSpace", 7],
  ]);
});

test("taskspace e2e useOrCreateTaskSpace selects user-owned spaces without claiming and surfaces the owned user-control guidance", async () => {
  const ego = new FakeEgo([
    {
      taskId: "checkout-flow",
      id: 7,
      name: "checkout-flow",
      createdBy: "user",
      ownership: "user",
    },
  ]);

  // Native rejects with error_code EGO_TASK_SPACE_USER_IN_CONTROL, so the agent
  // sees ego-browser's owned guidance block, not the raw native text.
  await assert.rejects(
    () =>
      runTaskspaceScript(
        ego,
        `await egoBrowser.useOrCreateTaskSpace("checkout-flow")`,
      ),
    /has taken control of this task space/,
  );
  assert.deepEqual(ego.calls, [["listTaskSpaces"], ["useTaskSpace", 7]]);
});

test("taskspace e2e exposes only the egoBrowser TaskSpace facade", async () => {
  const ego = new FakeEgo();
  const result = await runTaskspaceScript(
    ego,
    `
    console.log(JSON.stringify({
      taskSpacesType: typeof taskSpaces,
      newType: typeof egoBrowser.newTaskSpace,
      switchType: typeof egoBrowser.switchTaskSpace,
      claimType: typeof egoBrowser.claimTaskSpace,
      legacyNewGuardType: typeof newTaskSpace,
      legacyNewGuardEnumerable: Object.prototype.propertyIsEnumerable.call(
        globalThis,
        "newTaskSpace"
      ),
      rawClaimType: typeof ego.claimTaskSpace
    }));
  `,
  );

  assert.equal(result.exitCode, 0);
  assert.deepEqual(firstJsonLine(result.stdout), {
    taskSpacesType: "undefined",
    newType: "function",
    switchType: "function",
    claimType: "function",
    legacyNewGuardType: "function",
    legacyNewGuardEnumerable: false,
    rawClaimType: "function",
  });
});

test("cli e2e exposes egoBrowser.helper while hiding the former global help", async () => {
  const ego = new FakeEgo();
  const result = await runTaskspaceScript(
    ego,
    `
    console.log(JSON.stringify({
      helpType: typeof help,
      helperType: typeof egoBrowser.helper,
      helperResultType: typeof egoBrowser.helper("egoBrowser.listTaskSpace"),
      listType: typeof egoBrowser.listTaskSpace,
      legacyListType: typeof egoBrowser.listTaskSpaces,
      newTabType: typeof newTab,
      pageType: typeof page,
      oldClickType: typeof click,
      helperContextType: typeof helperContext,
      loadAgentHelpersType: typeof loadAgentHelpers
    }));
  `,
  );

  assert.equal(result.exitCode, 0);
  assert.deepEqual(firstJsonLine(result.stdout), {
    helpType: "undefined",
    helperType: "function",
    helperResultType: "string",
    listType: "function",
    legacyListType: "undefined",
    newTabType: "undefined",
    pageType: "undefined",
    oldClickType: "undefined",
    helperContextType: "undefined",
    loadAgentHelpersType: "undefined",
  });
});

test("taskspace e2e rejects explicit use of a user-owned task space", async () => {
  const ego = new FakeEgo([
    {
      taskId: "checkout-flow",
      id: 7,
      name: "checkout-flow",
      createdBy: "user",
      ownership: "user",
    },
  ]);

  await assert.rejects(
    () =>
      runTaskspaceScript(
        ego,
        `await egoBrowser.switchTaskSpace("checkout-flow")`,
      ),
    /switchTaskSpace requires an agent-owned task space/,
  );
  assert.deepEqual(ego.calls, [["listTaskSpaces"]]);
});

test("taskspace e2e rejects unknown task space ownership", async () => {
  const ego = new FakeEgo([
    {
      taskId: "checkout-flow",
      id: 7,
      name: "checkout-flow",
      ownership: "shared",
    },
  ]);

  await assert.rejects(
    () =>
      runTaskspaceScript(
        ego,
        `await egoBrowser.useOrCreateTaskSpace("checkout-flow")`,
      ),
    /ownership "shared"/,
  );
  assert.deepEqual(ego.calls, [["listTaskSpaces"]]);
});

test("taskspace e2e surfaces newTaskSpace binding errors", async () => {
  const ego = new FakeEgo([
    {
      taskId: "checkout-flow",
      id: 7,
      name: "checkout-flow",
      ownership: "agent",
    },
  ]);

  await assert.rejects(
    () =>
      runTaskspaceScript(ego, `await egoBrowser.newTaskSpace("checkout-flow")`),
    /newTaskSpace: Task space already exists: checkout-flow/,
  );
  assert.deepEqual(ego.calls, [["createTaskSpace", "checkout-flow"]]);
});
