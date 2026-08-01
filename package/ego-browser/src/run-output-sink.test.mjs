import test from "node:test";
import assert from "node:assert/strict";

import { runMain } from "../dist/src/run.js";

// A minimal native ego whose only method reports a hard stop, the same shape the real
// bindings return when the user holds (or has not handed over) the task space. The
// `listTaskSpaces` helper lifts it through assertNoEgoError -> buildEgoError, which is
// where the sink is told a hard stop occurred.
function hardStopEgo(error_code) {
  return {
    calls: 0,
    async listTaskSpaces() {
      this.calls += 1;
      return {
        error: "native wording that should never reach the agent",
        error_code,
      };
    },
  };
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

async function runScript(code, ego) {
  const previous = globalThis.ego;
  if (ego === undefined) {
    delete globalThis.ego;
  } else {
    globalThis.ego = ego;
  }
  const stdout = captureStream();
  const stderr = captureStream();
  let exitCode = null;
  let error = null;
  try {
    exitCode = await runMain({
      argv: [],
      stdinText: code,
      stdout,
      stderr,
      services: { printUpdateBanner() {} },
    });
  } catch (err) {
    error = err;
  } finally {
    if (previous === undefined) {
      delete globalThis.ego;
    } else {
      globalThis.ego = previous;
    }
  }
  return { exitCode, error, stdout: stdout.text(), stderr: stderr.text() };
}

test("a clean run flushes buffered console.log output in order", async () => {
  const result = await runScript(`console.log("one"); console.log("two");`);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "one\ntwo\n");
});

test("a swallowed user-control hard stop discards all output and prints the guidance once", async () => {
  const ego = hardStopEgo("EGO_TASK_SPACE_USER_IN_CONTROL");
  const result = await runScript(
    `
      for (const site of ["a", "b", "c"]) {
        console.log("visiting " + site);
        try {
          await egoBrowser.listTaskSpaces();
          console.log("ok " + site);
        } catch (e) {
          console.log("failed " + site + ": " + e.message);
        }
      }
      console.log("summary: done");
    `,
    ego,
  );

  assert.equal(result.exitCode, 0);
  // Only the owned guidance survives — none of the script's own logging.
  assert.match(result.stdout, /taken control of this task space/);
  assert.match(result.stdout, /egoBrowser\.takeOverTaskSpace\(\)/);
  assert.doesNotMatch(result.stdout, /visiting|failed|ok |summary/);
  // Printed exactly once, even though every loop iteration re-reported the hard stop.
  assert.equal(
    result.stdout.match(/egoBrowser\.takeOverTaskSpace\(\)/g).length,
    1,
  );
  assert.ok(ego.calls >= 3, "every iteration should have hit the hard stop");
});

test("an inactive / unassigned task space is also a hard stop", async () => {
  const ego = hardStopEgo("EGO_TASK_SPACE_INACTIVE");
  const result = await runScript(
    `
      try {
        await egoBrowser.listTaskSpaces();
      } catch (e) {
        console.log("swallowed: " + e.message);
      }
      console.log("more business output");
    `,
    ego,
  );

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /no longer assigned to the agent/);
  assert.match(result.stdout, /egoBrowser\.claimTaskSpace\(id\)/);
  assert.doesNotMatch(result.stdout, /swallowed|business/);
});

test("an uncaught hard stop discards output without double-printing the message", async () => {
  const ego = hardStopEgo("EGO_TASK_SPACE_USER_IN_CONTROL");
  const result = await runScript(
    `
      console.log("before");
      await egoBrowser.listTaskSpaces();
      console.log("after");
    `,
    ego,
  );

  // The thrown Error already surfaces the message (the host prints it), so the sink
  // discards the buffer and stays silent rather than printing the guidance a second time.
  assert.ok(result.error, "expected runMain to reject");
  assert.match(result.error.message, /taken control of this task space/);
  assert.equal(result.stdout, "");
});

test("an ordinary uncaught error still flushes the output logged before it", async () => {
  const result = await runScript(`
    console.log("partial result");
    throw new Error("boom");
  `);

  assert.ok(result.error, "expected runMain to reject");
  assert.equal(result.error.message, "boom");
  assert.equal(result.stdout, "partial result\n");
});

test("an uncaught browser-global ReferenceError points to task.page.evaluate", async () => {
  const result = await runScript(`CSS.escape("price");`);

  assert.ok(result.error, "expected runMain to reject");
  assert.match(result.error.message, /CSS is not defined/);
  assert.match(result.error.message, /task\.page\.evaluate\(\)/);
  assert.match(result.error.stack, /task\.page\.evaluate\(\)/);
  assert.equal(result.stdout, "");
});

test("an uncaught legacy task-space helper reports a stale skill instead of a ReferenceError", async () => {
  const result = await runScript(`
    await useOrCreateTaskSpace("checkout-flow");
  `);

  assert.ok(result.error, "expected runMain to reject");
  assert.equal(result.error.name, "EgoBrowserSkillStaleError");
  assert.match(result.error.message, /^\[ego-browser:skill-stale\]/);
  assert.match(result.error.message, /useOrCreateTaskSpace/);
  assert.match(result.error.message, /egoBrowser\.useOrCreateTaskSpace/);
  assert.doesNotMatch(result.error.message, /is not defined/);
  assert.equal(result.stdout, "");
});

test("a swallowed legacy task-space helper collapses output to one stale-skill message", async () => {
  const result = await runScript(`
    console.log("before");
    try {
      await useOrCreateTaskSpace("checkout-flow");
    } catch (error) {
      console.log("swallowed: " + error.message);
    }
    console.log("after");
  `);

  assert.equal(result.exitCode, 0);
  assert.equal(result.error, null);
  assert.match(result.stdout, /^\[ego-browser:skill-stale\]/);
  assert.match(result.stdout, /egoBrowser\.useOrCreateTaskSpace/);
  assert.doesNotMatch(result.stdout, /before|swallowed|after/);
  assert.equal(result.stdout.match(/\[ego-browser:skill-stale\]/g)?.length, 1);
});
