import test from "node:test";
import assert from "node:assert/strict";

import * as sdk from "../dist/src/index.js";
import { resetSink } from "../dist/src/output-sink.js";
import {
  connectPlaywrightTaskSpace,
  disconnectPlaywrightTaskSpace,
  setPlaywrightTaskSpaceConnector,
} from "../dist/src/playwright/taskspace.js";

const { installEgoSdk } = sdk;

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
    assert.equal(typeof target.egoBrowser.newTaskSpace, "function");
    assert.equal(target.page, undefined);
    assert.equal(target.tabs, undefined);
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
test("installEgoSdk exposes the site facade under ego.learnings", () => {
  const originalLog = console.log;
  const target = { ego: {} };
  try {
    installEgoSdk(target, { cliLog() {} });
    assert.equal(target.ego.learnings, target.ego.helpers.site);
    assert.equal(typeof target.ego.learnings.skills, "function");
    assert.equal(typeof target.ego.learnings.skillsForUrl, "function");
    assert.equal(typeof target.ego.learnings.runTool, "function");
    assert.equal(typeof target.ego.learnings.runBrowserTool, "function");
    assert.equal(typeof target.ego.learnings.learnContext, "function");
    assert.equal(target.ego.helpers.useOrCreateTaskSpace, undefined);
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
        assert.match(error.message, /egoBrowser\.listTaskSpaces\(\)/);
        return true;
      },
    );
  } finally {
    resetSink();
    console.log = originalLog;
  }
});
