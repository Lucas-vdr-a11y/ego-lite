import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

import * as sdk from "../dist/src/index.js";
import {
  connectPlaywrightTaskSpace,
  disconnectPlaywrightTaskSpace,
  setPlaywrightTaskSpaceConnector,
} from "../dist/src/playwright/taskspace.js";

const { installEgoSdk } = sdk;

test("the embedded SDK prints the egoBrowser facade with its public methods", () => {
  const moduleUrl = new URL("../dist/src/index.js", import.meta.url).href;
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `await import(${JSON.stringify(moduleUrl)}); console.log(egoBrowser);`,
    ],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /helper: \[Function: egoBrowserHelper\]/);
  assert.match(result.stdout, /listProfile: \[AsyncFunction/);
  assert.match(result.stdout, /newTaskSpace: \[AsyncFunction/);
  assert.notEqual(result.stdout.trim(), "{}");
});

test("disposeEgoSdk closes the active Playwright connection for SDK hosts", async () => {
  assert.equal(typeof sdk.disposeEgoSdk, "function");
  assert.equal(typeof sdk.enablePlaywrightTaskSpaces, "function");
  let closed = false;
  const restore = setPlaywrightTaskSpaceConnector(async () => ({
    page: {},
    context: {},
    async close() {
      closed = true;
    },
  }));

  try {
    await connectPlaywrightTaskSpace({ id: 7 });
    await sdk.disposeEgoSdk();
    assert.equal(closed, true);
  } finally {
    await disconnectPlaywrightTaskSpace();
    restore();
  }
});

test("installEgoSdk exposes TaskSpace control without legacy page or tabs globals", () => {
  const originalLog = console.log;
  const target = {};
  try {
    installEgoSdk(target, { cliLog() {} });
    assert.equal(typeof target.egoBrowser, "object");
    assert.equal(typeof target.egoBrowser.listProfile, "function");
    assert.equal(typeof target.egoBrowser.newTaskSpace, "function");
    assert.equal(typeof target.fetch, "function");
    assert.equal(typeof target.fetch.server, "function");
    assert.equal(typeof target.fetch.browser, "function");
    assert.equal(target.page, undefined);
    assert.equal(target.tabs, undefined);
  } finally {
    console.log = originalLog;
  }
});

test("installed SDK globals survive cleanup in a reused Node runtime", () => {
  const originalLog = console.log;
  const target = {};
  try {
    installEgoSdk(target, { cliLog() {} });
    const egoBrowser = target.egoBrowser;

    for (const name of ["egoBrowser", "site", "fetch", "cdp"]) {
      assert.equal(Reflect.deleteProperty(target, name), false, name);
      target[name] = undefined;
      assert.notEqual(target[name], undefined, name);
    }
    assert.equal(target.egoBrowser, egoBrowser);
  } finally {
    console.log = originalLog;
  }
});

test("installEgoSdk keeps asynchronous helpers behind an explicit readiness gate", async () => {
  const originalLog = console.log;
  const target = {};
  let releaseReady;
  const ready = new Promise((resolve) => {
    releaseReady = resolve;
  });
  let started = false;
  try {
    installEgoSdk(target, {
      cliLog() {},
      ready,
      context: {
        service: {
          async run() {
            started = true;
            return "done";
          },
        },
      },
    });
    const result = target.service.run();
    assert.equal(started, false);
    releaseReady();
    assert.equal(await result, "done");
    assert.equal(started, true);
  } finally {
    console.log = originalLog;
  }
});
test("installEgoSdk keeps custom facades off the native ego object", () => {
  const originalLog = console.log;
  const target = { ego: {} };
  try {
    installEgoSdk(target, { cliLog() {} });
    assert.equal(target.ego.helpers, undefined);
    assert.equal(target.ego.learnings, undefined);
    assert.equal(typeof target.site.runTool, "function");
  } finally {
    console.log = originalLog;
  }
});

test("installEgoSdk keeps egoBrowser.helper synchronous", () => {
  const originalLog = console.log;
  const target = {};
  try {
    installEgoSdk(target, { cliLog() {} });
    const output = target.egoBrowser.helper("egoBrowser.listTaskSpace");

    assert.equal(typeof output, "string");
    assert.match(output, /egoBrowser\.listTaskSpace\(\)/);
  } finally {
    console.log = originalLog;
  }
});

test("installEgoSdk keeps native ego bridge methods off the top-level API", () => {
  const originalLog = console.log;
  const nativeMethods = {
    listTabs() {},
    createTab() {},
    snapshot() {},
    sendCDPMessage() {},
  };
  const target = { ego: { ...nativeMethods } };
  try {
    installEgoSdk(target, { cliLog() {} });

    assert.equal(target.page, undefined);
    assert.equal(target.tabs, undefined);
    for (const name of Object.keys(nativeMethods)) {
      assert.equal(
        typeof target[name],
        "undefined",
        `${name} must remain available only through globalThis.ego`,
      );
      assert.equal(typeof target.ego[name], "function");
    }
  } finally {
    console.log = originalLog;
  }
});

test("installEgoSdk keeps raw task-space bridge methods behind stale-skill guards", () => {
  const originalLog = console.log;
  const target = {
    ego: {
      async listTaskSpaces() {
        return [];
      },
    },
  };
  try {
    installEgoSdk(target, { cliLog() {} });
    assert.throws(
      () => target.listTaskSpaces(),
      (error) => {
        assert.equal(error.name, "EgoBrowserSkillStaleError");
        assert.match(error.message, /egoBrowser\.listTaskSpace\(\)/);
        return true;
      },
    );
  } finally {
    console.log = originalLog;
  }
});
