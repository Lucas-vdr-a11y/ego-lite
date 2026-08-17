// The transport shares one NodeService with every other concurrently running
// agent script. browser-runtime.ts explains the consequence: a throw that
// escapes into the host aborts that whole process, so every peer script dies
// with "NodeRuntime disconnected" and loses output it had already printed.
//
// guardNativeCallback covered only the two native entry points. The transport
// has three more surfaces with the same blast radius, all of which run *after*
// the call that created them has returned:
//   - #emit's setImmediate, which hands the message to the client's dispatch
//   - close()'s setImmediate, which calls the client's onclose
//   - every detached chain ending `.finally(() => this.#endOperation())`, where
//     a throw rejects the chain after its own `.catch` and reaches no one
//
// Each test below runs in its own child process, because the failure under test
// is "the process is gone" — an in-process assertion cannot survive to report
// it. The first two tests are controls: they establish that this runtime really
// does die from an uncaught timer throw and from an unhandled rejection, so the
// transport tests that follow are measuring something real.

import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROUTING_URL = new URL("../../dist/src/playwright/routing.js", import.meta.url)
  .href;
const HARNESS_URL = new URL("./fake-native-harness.mjs", import.meta.url).href;

let scratch;

async function runChild(body) {
  scratch ??= await mkdtemp(join(tmpdir(), "ego-abort-guard-"));
  const file = join(scratch, `probe-${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(
    file,
    `const routing = await import(process.env.EGO_ROUTING_URL);\n` +
      `const harness = await import(process.env.EGO_HARNESS_URL);\n` +
      `const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));\n` +
      `${body}\n`,
  );
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [file],
      {
        env: {
          ...process.env,
          EGO_ROUTING_URL: ROUTING_URL,
          EGO_HARNESS_URL: HARNESS_URL,
        },
        timeout: 20_000,
      },
      (error, stdout, stderr) => {
        resolve({ code: error?.code ?? 0, stdout, stderr });
      },
    );
  });
}

// Boilerplate for a live transport over the fake native backend.
const OPEN_TRANSPORT = `
  const fake = new harness.FakeNativeBrowser();
  fake.addTab("tab-main", "https://main.test/");
  const options = { targetIds: ["tab-main"] };
  const transport = routing.createEgoCdpTransport(fake.runtime, options);
  transport.releaseConnectionKeepAlive();
`;

const AUTO_ATTACH = `
  transport.send({
    id: 1,
    method: "Target.setAutoAttach",
    params: { autoAttach: true, waitForDebuggerOnStart: true, flatten: true },
  });
`;

test("control: an uncaught throw from a timer callback ends this runtime", async () => {
  const { code, stdout } = await runChild(`
    setImmediate(() => {
      throw new Error("EGO_PROBE_control_timer");
    });
    await wait(300);
    console.log("SURVIVED");
  `);

  assert.notEqual(
    code,
    0,
    "an uncaught exception in a timer callback must kill the process — if this " +
      "passes with 0 the other tests here prove nothing",
  );
  assert.equal(stdout.includes("SURVIVED"), false, "and nothing after it runs");
});

test("control: a rejection nothing handles ends this runtime", async () => {
  const { code, stdout } = await runChild(`
    void Promise.reject(new Error("EGO_PROBE_control_rejection"));
    await wait(300);
    console.log("SURVIVED");
  `);

  assert.notEqual(code, 0, "an unhandled rejection must kill the process");
  assert.equal(stdout.includes("SURVIVED"), false);
});

test("a throwing client onmessage no longer takes the shared process down with it", async () => {
  const { code, stdout, stderr } = await runChild(`
    ${OPEN_TRANSPORT}
    let delivered = 0;
    transport.onmessage = () => {
      delivered += 1;
      throw new Error("EGO_PROBE_onmessage");
    };
    ${AUTO_ATTACH}
    await wait(400);
    console.log("DELIVERED=" + delivered);
    console.log("SURVIVED");
  `);

  const delivered = Number(/DELIVERED=(\d+)/.exec(stdout)?.[1] ?? 0);
  assert.ok(
    delivered > 0,
    `the throwing onmessage must actually have been called, or nothing was ` +
      `tested (stdout=${JSON.stringify(stdout)} stderr=${JSON.stringify(stderr)})`,
  );
  assert.equal(code, 0, `the process survived (stderr=${stderr})`);
  assert.ok(stdout.includes("SURVIVED"), "and kept running past the throw");
  assert.match(
    stderr,
    /onmessage\([^)]*\) failed:/,
    "and stderr names the surface, so the next run is diagnosable rather than silent",
  );
});

test("a throwing client onclose no longer takes the shared process down with it", async () => {
  const { code, stdout, stderr } = await runChild(`
    ${OPEN_TRANSPORT}
    transport.onmessage = () => {};
    ${AUTO_ATTACH}
    await wait(200);
    transport.onclose = () => {
      throw new Error("EGO_PROBE_onclose");
    };
    await transport.closeAndWait();
    await wait(200);
    console.log("SURVIVED");
  `);

  assert.equal(code, 0, `the process survived (stderr=${stderr})`);
  assert.ok(stdout.includes("SURVIVED"));
  assert.match(stderr, /onclose failed:/);
});

// #endOperation() runs from the `.finally` of seven detached chains and ends
// with #updatePendingWork(), which calls the caller's onPendingWorkChange. A
// throw from there rejects the chain after its `.catch` — the exact shape that
// has no handler without the terminal catchGuarded link.
test("a throw out of a detached chain's finally is reported instead of aborting the process", async () => {
  const { code, stdout, stderr } = await runChild(`
    const fake = new harness.FakeNativeBrowser();
    fake.addTab("tab-main", "https://main.test/");
    let armed = false;
    let raised = 0;
    const transport = routing.createEgoCdpTransport(fake.runtime, {
      targetIds: ["tab-main"],
      onPendingWorkChange: () => {
        if (!armed) return;
        raised += 1;
        throw new Error("EGO_PROBE_finally");
      },
    });
    transport.releaseConnectionKeepAlive();
    transport.onmessage = () => {};
    ${AUTO_ATTACH}
    await wait(200);
    // Owns an operation, so its completion runs #endOperation() from a
    // detached .finally().
    transport.send({
      id: 900,
      method: "Target.createTarget",
      params: { url: "https://second.test/" },
    });
    armed = true;
    await wait(600);
    console.log("RAISED=" + raised);
    console.log("SURVIVED");
  `);

  const raised = Number(/RAISED=(\d+)/.exec(stdout)?.[1] ?? 0);
  assert.ok(
    raised > 0,
    `the injected throw must actually have fired (stdout=${JSON.stringify(stdout)} ` +
      `stderr=${JSON.stringify(stderr)})`,
  );
  assert.equal(code, 0, `the process survived (stderr=${stderr})`);
  assert.ok(stdout.includes("SURVIVED"));
  assert.match(
    stderr,
    /Target\.createTarget failed: Error: EGO_PROBE_finally/,
    "the detached chain's terminal catch reports the throw its .finally raised",
  );
  // This child outlives its 600ms wait: the transport's own native-command
  // timeout fires later and calls #updatePendingWork() from a timer callback,
  // which is the same hazard one frame further out.
  assert.match(
    stderr,
    /native command timeout \([^)]*\) failed: Error: EGO_PROBE_finally/,
    "and the native-command timeout timer contains it too, rather than exiting " +
      "the process from inside setTimeout",
  );
});
