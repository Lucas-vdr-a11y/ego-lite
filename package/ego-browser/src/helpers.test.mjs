import test from "node:test";
import assert from "node:assert/strict";

import * as helperExports from "../dist/src/helpers.js";
import {
  claimTaskSpace,
  completeTaskSpace,
  handOffTaskSpace,
  newTaskSpace,
  helperContext,
  listTaskSpaces,
  taskSpace,
  useOrCreateTaskSpace,
  switchTaskSpace,
  waitForAgentControl,
} from "../dist/src/helpers.js";

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

test("taskspace helper surface exposes public helpers including claimTaskSpace", () => {
  const context = helperContext();
  assert.equal(typeof context.taskSpace, "function");
  assert.equal(typeof context.listTaskSpaces, "function");
  assert.equal(typeof context.switchTaskSpace, "function");
  assert.equal(typeof context.newTaskSpace, "function");
  assert.equal(typeof context.useOrCreateTaskSpace, "function");
  assert.equal(typeof context.claimTaskSpace, "function");
  assert.equal(typeof helperExports.openOrReuseTab, "function");
  assert.equal(typeof context.openOrReuseTab, "function");
  assert.equal(typeof helperExports.closeTab, "function");
  assert.equal(typeof context.closeTab, "function");
  assert.equal("newTab" in helperExports, false);
  assert.equal("newTab" in context, false);
  assert.equal("elementEval" in helperExports, false);
  assert.equal("elementEval" in context, false);
});

test("taskSpace returns the new object model for a resolved space", async () => {
  await withEgo(
    {
      async listTaskSpaces() {
        return {
          taskSpaces: [
            {
              taskId: "research",
              id: 7,
              name: "Research",
              ownership: "agent",
            },
          ],
        };
      },
      async useTaskSpace() {},
    },
    async () => {
      const task = await taskSpace("research");
      assert.equal(task.id, 7);
      assert.equal(task.name, "Research");
      assert.equal(task.ownership, "agent");
      assert.equal(typeof task.newPage, "function");
      assert.equal(typeof task.page, "function");
      assert.equal(typeof task.listPages, "function");
    },
  );
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
  const restore = helperExports.__testing.setOverrides({
    sleep: () => Promise.resolve(),
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
        await waitForAgentControl("t", { interval: 0, timeout: 5 });
      },
    );
  } finally {
    restore();
  }
  assert.equal(calls, 3);
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
        () => waitForAgentControl("t", { interval: 0, timeout: 5 }),
        /snapshot failed/,
      );
    },
  );
});
