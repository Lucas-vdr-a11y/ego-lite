import test from "node:test";
import assert from "node:assert/strict";

import { installEgoSdk } from "../dist/src/index.js";
import { resetSink } from "../dist/src/output-sink.js";

test("installEgoSdk keeps page.locator chainable while wrapping locator methods", () => {
  const originalLog = console.log;
  const target = {
    browser: { listTabs() {} },
    click() {},
    taskSpaces: { useOrCreate() {} },
    useOrCreateTaskSpace() {},
  };
  try {
    installEgoSdk(target, { cliLog() {} });
    assert.equal(typeof target.click, "undefined");
    assert.equal(typeof target.browser, "undefined");
    assert.deepEqual(Object.keys(target.egoBrowser).sort(), [
      "claimTaskSpace",
      "closeTaskSpace",
      "completeTaskSpace",
      "handOffTaskSpace",
      "listTaskSpaces",
      "newTaskSpace",
      "switchTaskSpace",
      "takeOverTaskSpace",
      "useOrCreateTaskSpace",
      "waitForAgentControlTaskSpace",
    ]);
    assert.equal(target.taskSpaces, undefined);
    assert.equal(target.egoBrowser.newPage, undefined);
    assert.equal(target.egoBrowser.newContext, undefined);
    assert.equal(target.egoBrowser.contexts, undefined);
    assert.equal(target.egoBrowser.close, undefined);
    assert.equal(typeof target.tabs.openOrReuse, "function");
    assert.equal(typeof target.useOrCreateTaskSpace, "function");
    assert.equal(
      Object.prototype.propertyIsEnumerable.call(
        target,
        "useOrCreateTaskSpace",
      ),
      false,
    );
    assert.throws(
      () => target.useOrCreateTaskSpace("checkout-flow"),
      (error) => {
        assert.equal(error.name, "EgoBrowserSkillStaleError");
        assert.match(error.message, /^\[ego-browser:skill-stale\]/);
        assert.match(error.message, /useOrCreateTaskSpace/);
        assert.match(error.message, /egoBrowser\.useOrCreateTaskSpace/);
        return true;
      },
    );
    assert.equal(typeof target.page.locator, "function");
    assert.equal(typeof target.page.getByText("Allow").click, "function");
    assert.equal(typeof target.page.getByLabel("Email").fill, "function");
    assert.equal(
      typeof target.page.getByPlaceholder("Search").fill,
      "function",
    );
    assert.equal(typeof target.page.getByAltText("Logo").click, "function");
    assert.equal(typeof target.page.getByTitle("More").click, "function");
    const frameLocator = target.page.frameLocator("#checkout-frame");
    assert.equal(frameLocator && typeof frameLocator, "object");
    assert.deepEqual(frameLocator.frameChain, ["#checkout-frame"]);
    assert.ok(!Object.keys(frameLocator).includes("frameChain"));
    assert.equal(typeof frameLocator.locator("#card-number").fill, "function");
    const framedField = frameLocator.locator("#card-number");
    assert.deepEqual(framedField.target.frameChain, ["#checkout-frame"]);
    assert.ok(!Object.keys(framedField).includes("target"));
    assert.equal(
      typeof framedField.and(frameLocator.locator("[required]")).fill,
      "function",
    );
    assert.equal(
      typeof framedField.or(frameLocator.locator("#saved-card")).click,
      "function",
    );
    assert.equal(
      typeof frameLocator
        .frameLocator("#nested-frame")
        .getByRole("button", { name: "Pay" }).click,
      "function",
    );
    assert.equal(typeof frameLocator.owner().getAttribute, "function");
    const locator = target.page.locator("#target");
    assert.equal(locator && typeof locator, "object");
    assert.equal(typeof locator.click, "function");
    assert.equal(typeof locator.evaluateAll, "function");
    assert.equal(typeof locator.extractAll, "undefined");
    assert.equal(typeof locator.nth(1).click, "function");
    assert.equal(typeof locator.first().click, "function");
    assert.equal(typeof locator.last().click, "function");
    assert.equal(typeof locator.getByText("Save").click, "function");
    assert.equal(
      typeof locator.getByRole("button", { name: "Save" }).click,
      "function",
    );
    assert.equal(typeof locator.locator(".child").fill, "function");
    assert.equal(typeof locator.contentFrame().getByRole, "function");
    assert.equal(typeof locator.filter({ hasText: "Ready" }).click, "function");
    assert.equal(
      typeof target.page.getByText("Row").filter({ hasText: "Ready" }).nth(0)
        .click,
      "function",
    );
  } finally {
    resetSink();
    console.log = originalLog;
  }
});

test("installEgoSdk preserves synchronous Page emitter and locator ownership contracts", () => {
  const originalLog = console.log;
  const sourcePage = {
    isClosed: () => false,
  };
  const sourceLocator = { page: () => sourcePage };
  sourcePage.locator = () => sourceLocator;
  sourcePage.on = () => sourcePage;
  sourcePage.once = () => sourcePage;
  sourcePage.off = () => sourcePage;
  sourcePage.removeAllListeners = () => sourcePage;
  const target = {};
  try {
    installEgoSdk(target, {
      cliLog() {},
      context: { page: sourcePage },
    });
    const listener = () => {};
    assert.equal(target.page.isClosed(), false);
    assert.equal(target.page.on("console", listener), target.page);
    assert.equal(target.page.once("console", listener), target.page);
    assert.equal(target.page.off("console", listener), target.page);
    assert.equal(target.page.removeAllListeners("console"), target.page);
    assert.equal(target.page.locator("body").page(), target.page);
  } finally {
    console.log = originalLog;
  }
});

test("installEgoSdk preserves Page identity for lifecycle events", async () => {
  const originalLog = console.log;
  const sourcePage = {};
  sourcePage.waitForEvent = async () => sourcePage;
  const target = {};
  try {
    installEgoSdk(target, {
      cliLog() {},
      context: { page: sourcePage },
    });
    assert.equal(await target.page.waitForEvent("load"), target.page);
  } finally {
    console.log = originalLog;
  }
});

test("installEgoSdk maps callback Page references to the public facade", async () => {
  const originalLog = console.log;
  let eventListener;
  let bindingCallback;
  const sourcePage = {
    on(_eventName, listener) {
      eventListener = listener;
      return sourcePage;
    },
    off(_eventName, listener) {
      assert.equal(listener, eventListener);
      return sourcePage;
    },
    async exposeBinding(_name, callback) {
      bindingCallback = callback;
    },
  };
  const target = {};
  try {
    installEgoSdk(target, {
      cliLog() {},
      context: { page: sourcePage },
    });
    let eventPage;
    const listener = (receivedPage) => {
      eventPage = receivedPage;
    };
    target.page.on("load", listener);
    eventListener(sourcePage);
    assert.equal(eventPage, target.page);
    target.page.off("load", listener);

    let bindingPage;
    await target.page.exposeBinding("bound", (source) => {
      bindingPage = source.page;
    });
    await bindingCallback({ page: sourcePage, frame: null, context: null });
    assert.equal(bindingPage, target.page);
  } finally {
    console.log = originalLog;
  }
});

test("installEgoSdk maps synchronous Frame ownership to the public Page", () => {
  const originalLog = console.log;
  const sourcePage = {};
  const sourceFrame = {
    name: () => "main",
    page: () => sourcePage,
    parentFrame: () => null,
    childFrames: () => [],
  };
  Object.defineProperty(sourceFrame, "_id", { value: "frame-main" });
  sourcePage.mainFrame = () => sourceFrame;
  sourcePage.frames = () => [sourceFrame];
  const target = {};
  try {
    installEgoSdk(target, {
      cliLog() {},
      context: { page: sourcePage },
    });
    const main = target.page.mainFrame();
    assert.equal(main.page(), target.page);
    assert.equal(target.page.frames()[0], main);
    assert.equal(main.name(), "main");
  } finally {
    console.log = originalLog;
  }
});

test("installEgoSdk preserves the synchronous page.url contract", () => {
  const originalLog = console.log;
  const target = {};
  try {
    installEgoSdk(target, {
      cliLog() {},
      context: {
        page: {
          url: () => "https://example.com/current",
        },
      },
    });
    assert.equal(target.page.url(), "https://example.com/current");
  } finally {
    console.log = originalLog;
  }
});

test("installEgoSdk starts page.waitForEvent synchronously when already ready", async () => {
  const originalLog = console.log;
  const target = {};
  let started = false;
  try {
    installEgoSdk(target, {
      cliLog() {},
      context: {
        page: {
          waitForEvent: async () => {
            started = true;
            return "event";
          },
        },
      },
    });
    const event = target.page.waitForEvent("console");
    assert.equal(
      started,
      true,
      "event registration starts before the caller's next action",
    );
    assert.equal(await event, "event");
  } finally {
    console.log = originalLog;
  }
});

test("installEgoSdk keeps page.waitForEvent behind an explicit readiness gate", async () => {
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
        page: {
          waitForEvent: async () => {
            started = true;
            return "event";
          },
        },
      },
    });
    const event = target.page.waitForEvent("console");
    assert.equal(
      started,
      false,
      "an explicit host readiness signal is honored",
    );
    releaseReady();
    assert.equal(await event, "event");
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

    assert.equal(typeof target.tabs, "object");
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
