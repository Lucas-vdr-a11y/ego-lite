import test from "node:test";
import assert from "node:assert/strict";

import { HARD_STOP_EXIT_CODE, runMain } from "../dist/src/run.js";

const USER_CONTROL_MESSAGE =
  "The user has taken control of this task space, so browser commands are paused.";
const INACTIVE_MESSAGE =
  "Task space 8 is not assigned to an agent. Claim this task space before sending commands.";

async function runScript(code, { ego } = {}) {
  const previous = globalThis.ego;
  if (ego === undefined) {
    delete globalThis.ego;
  } else {
    globalThis.ego = ego;
  }
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

function userControlErrorExpression(message = USER_CONTROL_MESSAGE) {
  return `Object.assign(new Error(${JSON.stringify(message)}), { error_code: "EGO_TASK_SPACE_USER_IN_CONTROL" })`;
}

function inactiveErrorExpression(message = INACTIVE_MESSAGE) {
  return `Object.assign(new Error(${JSON.stringify(message)}), { error_code: "EGO_TASK_SPACE_INACTIVE" })`;
}

test("ordinary errors can still be handled by user catch blocks", async () => {
  const result = await runScript(`
    try {
      throw new Error("plain page failure");
    } catch (error) {
      cliLog("caught: " + error.message);
    }
  `);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "caught: plain page failure\n");
  assert.equal(result.stderr, "");
});

test("hard-stop errors pass through user catch blocks", async () => {
  const result = await runScript(`
    try {
      throw ${userControlErrorExpression()};
    } catch (error) {
      cliLog("swallowed: " + error.message);
    }
  `);

  assert.equal(result.exitCode, HARD_STOP_EXIT_CODE);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, new RegExp(USER_CONTROL_MESSAGE));
});

test("hard-stop errors without user catch blocks are reported by the runner", async () => {
  const result = await runScript(`
    throw ${userControlErrorExpression()};
  `);

  assert.equal(result.exitCode, HARD_STOP_EXIT_CODE);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, new RegExp(USER_CONTROL_MESSAGE));
});

test("inactive task-space errors are hard stops with a permission-boundary message", async () => {
  const result = await runScript(`
    try {
      throw ${inactiveErrorExpression()};
    } catch (error) {
      cliLog("swallowed: " + error.message);
    }
  `);

  assert.equal(result.exitCode, HARD_STOP_EXIT_CODE);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Task space 8 is not assigned to this agent/);
  assert.match(result.stderr, /hard permission boundary/);
  assert.match(
    result.stderr,
    /must not claim, inspect, modify, close, organize, or otherwise operate/,
  );
  assert.match(result.stderr, /Do not infer consent from prior instructions/);
  assert.match(result.stderr, /await useOrCreateTaskSpace\(8\)/);
});

test("hard-stop errors pass through catch blocks without bindings", async () => {
  const result = await runScript(`
    try {
      throw ${userControlErrorExpression()};
    } catch {
      cliLog("swallowed");
    }
  `);

  assert.equal(result.exitCode, HARD_STOP_EXIT_CODE);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, new RegExp(USER_CONTROL_MESSAGE));
});

test("hard-stop passthrough avoids user names that resemble internal helpers", async () => {
  const result = await runScript(`
    try {
      throw ${userControlErrorExpression()};
    } catch (__egoBrowserRethrowHardStop) {
      const __egoBrowserCaughtError0 = "user local";
      cliLog("swallowed: " + __egoBrowserRethrowHardStop.message + __egoBrowserCaughtError0);
    }
  `);

  assert.equal(result.exitCode, HARD_STOP_EXIT_CODE);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, new RegExp(USER_CONTROL_MESSAGE));
});

test("hard-stop errors pass through destructuring catch bindings", async () => {
  const result = await runScript(`
    try {
      throw ${userControlErrorExpression()};
    } catch ({ message }) {
      cliLog("swallowed: " + message);
    }
  `);

  assert.equal(result.exitCode, HARD_STOP_EXIT_CODE);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, new RegExp(USER_CONTROL_MESSAGE));
});

test("ordinary errors still support destructuring catch bindings", async () => {
  const result = await runScript(`
    try {
      throw new Error("plain page failure");
    } catch ({ message }) {
      cliLog("caught: " + message);
    }
  `);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "caught: plain page failure\n");
  assert.equal(result.stderr, "");
});

test("ordinary destructuring catch bindings remain assignable", async () => {
  const result = await runScript(`
    try {
      throw new Error("plain page failure");
    } catch ({ message }) {
      message = message.toUpperCase();
      cliLog("caught: " + message);
    }
  `);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "caught: PLAIN PAGE FAILURE\n");
  assert.equal(result.stderr, "");
});

test("hard-stop errors pass through promise catch callbacks", async () => {
  const result = await runScript(`
    await Promise.reject(${userControlErrorExpression()}).catch(() => {
      cliLog("swallowed");
    });
    cliLog("after");
  `);

  assert.equal(result.exitCode, HARD_STOP_EXIT_CODE);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, new RegExp(USER_CONTROL_MESSAGE));
});

test("ordinary errors can still be handled by promise catch callbacks", async () => {
  const result = await runScript(`
    const value = await Promise.reject(new Error("plain page failure")).catch((error) => {
      cliLog("caught: " + error.message);
      return "handled";
    });
    cliLog("value: " + value);
  `);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "caught: plain page failure\nvalue: handled\n");
  assert.equal(result.stderr, "");
});

test("ordinary promise catch destructuring bindings remain assignable", async () => {
  const result = await runScript(`
    await Promise.reject(new Error("plain page failure")).catch(({ message }) => {
      message = message.toUpperCase();
      cliLog("caught: " + message);
    });
  `);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "caught: PLAIN PAGE FAILURE\n");
  assert.equal(result.stderr, "");
});

test("promise catch expression bodies preserve return values", async () => {
  const result = await runScript(`
    const value = await Promise.reject(new Error("plain page failure")).catch(error => error.message);
    cliLog(value);
  `);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "plain page failure\n");
  assert.equal(result.stderr, "");
});

test("hard-stop errors pass through named promise catch handlers", async () => {
  const result = await runScript(`
    const handleError = (error) => {
      cliLog("swallowed: " + error.message);
    };
    await Promise.reject(${userControlErrorExpression()}).catch(handleError);
  `);

  assert.equal(result.exitCode, HARD_STOP_EXIT_CODE);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, new RegExp(USER_CONTROL_MESSAGE));
});

test("ordinary errors can still be handled by named promise catch handlers", async () => {
  const result = await runScript(`
    const handleError = (error) => error.message;
    const value = await Promise.reject(new Error("plain page failure")).catch(handleError);
    cliLog(value);
  `);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "plain page failure\n");
  assert.equal(result.stderr, "");
});

test("ego user-control errors from helpers cannot be swallowed as per-item failures", async () => {
  const ego = {
    async listTabs() {
      return {
        error: USER_CONTROL_MESSAGE,
        error_code: "EGO_TASK_SPACE_USER_IN_CONTROL",
      };
    },
  };
  const result = await runScript(
    `
      try {
        await openOrReuseTab("https://example.com");
      } catch (error) {
        cliLog(JSON.stringify({ error: error.message }));
      }
    `,
    { ego },
  );

  assert.equal(result.exitCode, HARD_STOP_EXIT_CODE);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /listTabs: The user has taken control/);
});

test("ego inactive errors from helpers cannot be swallowed as per-item failures", async () => {
  const ego = {
    async listTabs() {
      return {
        error: INACTIVE_MESSAGE,
        error_code: "EGO_TASK_SPACE_INACTIVE",
      };
    },
  };
  const result = await runScript(
    `
      try {
        await openOrReuseTab("https://example.com");
      } catch (error) {
        cliLog(JSON.stringify({ error: error.message }));
      }
    `,
    { ego },
  );

  assert.equal(result.exitCode, HARD_STOP_EXIT_CODE);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Task space 8 is not assigned to this agent/);
  assert.match(result.stderr, /await useOrCreateTaskSpace\(8\)/);
});

test("ego inactive errors from implicit session setup preserve error_code", async () => {
  const ego = {
    async listTabs() {
      return {
        error: INACTIVE_MESSAGE,
        error_code: "EGO_TASK_SPACE_INACTIVE",
      };
    },
  };
  const result = await runScript(
    `
      try {
        await pageInfo();
      } catch (error) {
        cliLog(JSON.stringify({ error: error.message }));
      }
    `,
    { ego },
  );

  assert.equal(result.exitCode, HARD_STOP_EXIT_CODE);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Task space 8 is not assigned to this agent/);
  assert.match(result.stderr, /await useOrCreateTaskSpace\(8\)/);
});
