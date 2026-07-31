import test from "node:test";
import assert from "node:assert/strict";

import * as helperExports from "../dist/src/helpers.js";
import { PUBLIC_API_DOCS } from "../dist/src/format.js";
import { setOverrides } from "../dist/src/state.js";
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

test("helper surface exposes Playwright-style object facades", () => {
  const context = helperContext();
  assert.equal(typeof context.page, "object");
  assert.equal(typeof context.page.goto, "function");
  assert.equal(typeof context.page.locator, "function");
  assert.equal(typeof context.page.getByText, "function");
  assert.equal(typeof context.page.getByLabel, "function");
  assert.equal(typeof context.page.getByPlaceholder, "function");
  assert.equal(typeof context.page.getByAltText, "function");
  assert.equal(typeof context.page.getByTitle, "function");
  assert.equal(typeof context.page.getByTestId, "function");
  assert.equal(typeof context.page.waitForLoadState, "function");
  assert.equal(typeof context.page.waitForURL, "function");
  assert.equal(typeof context.page.waitForRequest, "function");
  assert.equal(typeof context.page.waitForResponse, "function");
  assert.equal(typeof context.page.screencast, "object");
  assert.equal(typeof context.page.screencast.start, "function");
  assert.equal(typeof context.page.screencast.stop, "function");
  assert.equal(typeof context.page.keyboard.press, "function");
  assert.equal(typeof context.page.keyboard.down, "function");
  assert.equal(typeof context.page.keyboard.up, "function");
  assert.equal(typeof context.page.keyboard.type, "function");
  assert.equal(typeof context.page.mouse.click, "function");
  assert.equal(typeof context.page.mouse.move, "function");
  assert.equal(typeof context.page.mouse.down, "function");
  assert.equal(typeof context.page.mouse.up, "function");
  const locator = context.page.locator("#target");
  assert.equal(typeof locator.click, "function");
  assert.equal(typeof locator.fill, "function");
  assert.equal(typeof locator.press, "function");
  assert.equal(typeof locator.locator, "function");
  assert.equal(typeof locator.getByRole, "function");
  assert.equal(typeof locator.getByText, "function");
  assert.equal(typeof locator.getByLabel, "function");
  assert.equal(typeof locator.getByPlaceholder, "function");
  assert.equal(typeof locator.getByAltText, "function");
  assert.equal(typeof locator.getByTitle, "function");
  assert.equal(typeof locator.getByTestId, "function");
  assert.equal(typeof locator.filter, "function");
  assert.equal(typeof locator.and, "function");
  assert.equal(typeof locator.or, "function");
  assert.equal(typeof locator.clear, "function");
  assert.equal(typeof locator.blur, "function");
  assert.equal(typeof locator.innerHTML, "function");
  assert.equal(typeof locator.isVisible, "function");
  assert.equal(typeof locator.isHidden, "function");
  assert.equal(typeof locator.isEnabled, "function");
  assert.equal(typeof locator.isDisabled, "function");
  assert.equal(typeof locator.isEditable, "function");
  assert.equal(typeof locator.boundingBox, "function");
  assert.equal(typeof locator.screenshot, "function");
  assert.equal(typeof locator.first, "function");
  assert.equal(typeof locator.nth, "function");
  assert.equal(typeof locator.last, "function");
  assert.equal(typeof locator.nth(1).click, "function");
  assert.equal(typeof locator.evaluate, "function");
  assert.equal(typeof locator.evaluateAll, "function");
  assert.equal(typeof locator.extractAll, "undefined");
  assert.equal(typeof context.page.getByText("Allow").click, "function");
  assert.equal(typeof context.page.getByLabel("Email").fill, "function");
  assert.equal(
    context.page.getByTestId("submit").selector,
    'loc=testid:exact:"submit"',
  );
  const roleRegexSelector = context.page.getByRole("button", {
    name: /New York \(JFK\)/i,
  }).selector;
  assert.match(roleRegexSelector, /^loc=role:button\[name=/);
  assert.deepEqual(
    JSON.parse(roleRegexSelector.match(/\[name=([\s\S]+)\]$/)[1]),
    {
      regex: "New York \\(JFK\\)",
      flags: "i",
    },
  );
  assert.deepEqual(
    JSON.parse(
      decodeURIComponent(
        locator.getByText("Save").selector.slice("internal:scope:".length),
      ),
    ),
    { base: "#target", child: 'loc=text:"Save"' },
  );
  assert.deepEqual(
    JSON.parse(
      decodeURIComponent(
        locator
          .filter({ hasText: /Ready/i })
          .selector.slice("internal:filter:".length),
      ),
    ),
    { base: "#target", hasText: { regex: "Ready", flags: "i" } },
  );
  const scopedRole = JSON.parse(
    decodeURIComponent(
      locator
        .getByRole("button", { name: /Save/i })
        .selector.slice("internal:scope:".length),
    ),
  );
  assert.equal(scopedRole.base, "#target");
  assert.deepEqual(
    JSON.parse(scopedRole.child.match(/\[name=([\s\S]+)\]$/)[1]),
    {
      regex: "Save",
      flags: "i",
    },
  );
  const checkedRole = context.page.getByRole("checkbox", {
    name: "Updates",
    exact: true,
    checked: true,
    disabled: false,
    includeHidden: true,
  }).selector;
  assert.deepEqual(
    JSON.parse(decodeURIComponent(checkedRole.slice("internal:role:".length))),
    {
      role: "checkbox",
      name: { text: "Updates", exact: true },
      checked: true,
      disabled: false,
      includeHidden: true,
    },
  );
  const intersection = locator.and(context.page.locator(".enabled")).selector;
  assert.deepEqual(
    JSON.parse(decodeURIComponent(intersection.slice("internal:and:".length))),
    { left: "#target", right: ".enabled" },
  );
  const union = locator.or(context.page.getByText("Fallback")).selector;
  assert.deepEqual(
    JSON.parse(decodeURIComponent(union.slice("internal:or:".length))),
    { left: "#target", right: 'loc=text:"Fallback"' },
  );
  assert.equal(typeof context.page.setDefaultTimeout, "function");
  assert.equal(typeof context.page.setDefaultNavigationTimeout, "function");
  assert.equal(typeof context.page.waitForEvent, "function");
  assert.deepEqual(Object.keys(context.tabs).sort(), [
    "activate",
    "close",
    "current",
    "evaluate",
    "list",
    "openOrReuse",
  ]);
  assert.equal(typeof context.tabs.openOrReuse, "function");
  assert.equal(typeof context.tabs.close, "function");
  assert.equal(typeof context.tabs.evaluate, "function");
  assert.equal(typeof context.browser, "undefined");
  assert.equal(typeof context.taskSpaces.useOrCreate, "function");
  assert.equal(typeof context.taskSpaces.claim, "function");
  assert.equal(typeof context.site.runTool, "function");
  assert.equal(typeof context.fetch.server, "function");
  assert.equal(typeof context.fetch.browser, "function");
  assert.equal(typeof context.cdp, "function");
  assert.equal(typeof context.help, "function");
  assert.match(context.help("fetch"), /timeout uses milliseconds/);
  assert.match(
    context.help("taskSpaces"),
    /interval and timeout use milliseconds/,
  );
  assert.equal(typeof helperExports.focus, "function");
  assert.equal(typeof helperExports.waitForRequest, "function");
  assert.equal(typeof helperExports.waitForResponse, "function");
  assert.equal(typeof context.focus, "undefined");
  assert.equal(typeof context.click, "undefined");
  assert.equal(typeof context.fill, "undefined");
  assert.equal(typeof context.goto, "undefined");
  assert.equal(typeof context.evaluate, "undefined");
  assert.equal("newTab" in helperExports, false);
  assert.equal("newTab" in context, false);
  assert.equal("elementEval" in helperExports, false);
  assert.equal("elementEval" in context, false);
});

test("all text-based getBy locators preserve regular expressions", () => {
  const context = helperContext();
  const locators = [
    context.page.getByText(/ready\s+now/i),
    context.page.getByLabel(/email|user/i),
    context.page.getByPlaceholder(/^search/),
    context.page.getByAltText(/controller$/i),
    context.page.getByTitle(/details/i),
    context.page.getByTestId(/^product-\d+$/),
    context.page.locator(".card").getByText(/buy/i),
    context.page.frameLocator("#catalog").getByText(/frame item/i),
  ];

  for (const locator of locators) {
    const decoded = decodeURIComponent(locator.selector);
    assert.match(decoded, /:regex:/);
    assert.doesNotMatch(decoded, /"\/.*\/[a-z]*"/i);
  }
});

test("locator factories accept Playwright has and text filter options", () => {
  const context = helperContext();
  const child = context.page.locator(".card", {
    hasText: /ready/i,
    hasNotText: "Archived",
    has: context.page.getByText("Buy"),
    hasNot: context.page.locator(".disabled"),
  });
  const nested = context.page.locator("#catalog").locator(".item", {
    hasText: "Available",
  });
  const framed = context.page.frameLocator("#frame").locator(".item", {
    hasNotText: /sold/i,
  });

  assert.match(child.selector, /^internal:filter:/);
  assert.match(nested.selector, /^internal:filter:/);
  assert.match(framed.selector, /^internal:filter:/);

  const nestedFilter = JSON.parse(
    decodeURIComponent(nested.selector.slice("internal:filter:".length)),
  );
  assert.match(nestedFilter.base, /^internal:scope:/);
  assert.deepEqual(nestedFilter.hasText, {
    text: "Available",
    exact: false,
  });
});

test("locator implementation state is accessible but not publicly enumerable", () => {
  const context = helperContext();
  const locator = context.page.locator(".item");
  const frameLocator = context.page.frameLocator("#frame");

  assert.equal(locator.selector, ".item");
  assert.deepEqual(locator.frameChain, []);
  assert.ok(locator.target);
  assert.ok(!Object.keys(locator).includes("selector"));
  assert.ok(!Object.keys(locator).includes("frameChain"));
  assert.ok(!Object.keys(locator).includes("target"));

  assert.equal(frameLocator.selector, "#frame");
  assert.deepEqual(frameLocator.frameChain, ["#frame"]);
  assert.ok(!Object.keys(frameLocator).includes("selector"));
  assert.ok(!Object.keys(frameLocator).includes("frameChain"));
});

test("page.frameLocator creates nested frame-scoped locators", () => {
  const context = helperContext();

  assert.equal(typeof context.page.frameLocator, "function");
  const outer = context.page.frameLocator("iframe#outer");
  assert.equal(typeof outer.frameLocator, "function");
  assert.equal(typeof outer.getByRole, "function");

  const inner = outer.frameLocator("iframe#inner");
  const button = inner.getByRole("button", { name: "Save" });
  assert.equal(typeof button.click, "function");
  assert.match(button.selector, /^loc=role:button/);
  assert.deepEqual(button.frameChain, ["iframe#outer", "iframe#inner"]);
  assert.deepEqual(outer.first().frameChain, ["internal:nth=0;iframe#outer"]);
  assert.deepEqual(outer.nth(2).frameChain, ["internal:nth=2;iframe#outer"]);
  assert.deepEqual(outer.last().frameChain, ["internal:last;iframe#outer"]);
  assert.throws(() => outer.nth(-1), /non-negative integer/);
});

test("frame-scoped locator composition rejects locators from another frame", () => {
  const page = helperContext().page;
  const left = page.frameLocator("#left-frame").locator(".item");
  const right = page.frameLocator("#right-frame").locator(".item");

  for (const compose of [
    () => left.and(right),
    () => left.or(right),
    () => left.locator(right),
    () => left.filter({ has: right }),
    () => left.filter({ hasNot: right }),
    () => page.locator(".item", { has: right }),
    () =>
      page.frameLocator("#left-frame").locator(".item", {
        has: right,
      }),
  ]) {
    assert.throws(compose, /same frame/);
  }
});

test("frame-scoped locator resolves inside the child execution context", async () => {
  const calls = [];
  const restore = setOverrides({
    sessionId: "main-session",
    sessionTargetId: "tab-1",
    sessionAt: Date.now(),
    cdpOverride: async (method, params, sessionId) => {
      calls.push({ method, params, sessionId });
      if (method === "Runtime.evaluate") {
        if (params.contextId === 101) {
          assert.match(params.expression, /#inside/);
          return { result: { objectId: "inside-object" } };
        }
        if (params.expression.includes("#frame")) {
          return { result: { objectId: "frame-owner" } };
        }
        throw new Error("expected frame owner resolution first");
      }
      if (
        method === "Runtime.callFunctionOn" &&
        params.objectId === "frame-owner"
      ) {
        return {
          result: {
            value: { x: 100, y: 50, width: 400, height: 300 },
          },
        };
      }
      if (method === "DOM.describeNode") {
        return { node: { frameId: "frame-1" } };
      }
      if (method === "Page.createIsolatedWorld") {
        assert.equal(params.frameId, "frame-1");
        return { executionContextId: 101 };
      }
      if (
        method === "Runtime.callFunctionOn" &&
        params.objectId === "inside-object"
      ) {
        return { result: { value: "Inside frame" } };
      }
      if (method === "Runtime.releaseObject") return {};
      throw new Error(`unexpected CDP method: ${method}`);
    },
  });
  try {
    const text = await helperContext()
      .page.frameLocator("#frame")
      .locator("#inside")
      .innerText();

    assert.equal(text, "Inside frame");
    assert.ok(
      calls.some(
        (call) =>
          call.method === "Runtime.evaluate" && call.params.contextId === 101,
      ),
    );
  } finally {
    restore();
  }
});

test("frame-scoped locator re-resolves after its execution context is destroyed", async () => {
  let frameWorlds = 0;
  let now = 0;
  const restore = setOverrides({
    sessionId: "main-session",
    sessionTargetId: "tab-1",
    sessionAt: Date.now(),
    defaultTimeout: 500,
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    cdpOverride: async (method, params) => {
      if (method === "Runtime.evaluate" && params.contextId === 101) {
        throw new Error("Execution context was destroyed.");
      }
      if (method === "Runtime.evaluate" && params.contextId === 102) {
        return { result: { objectId: "inside-object" } };
      }
      if (method === "Runtime.evaluate") {
        return { result: { objectId: "frame-owner" } };
      }
      if (
        method === "Runtime.callFunctionOn" &&
        params.objectId === "frame-owner"
      ) {
        return {
          result: {
            value: { x: 100, y: 50, width: 400, height: 300 },
          },
        };
      }
      if (method === "DOM.describeNode") {
        return { node: { frameId: "navigating-frame" } };
      }
      if (method === "Page.createIsolatedWorld") {
        frameWorlds += 1;
        return { executionContextId: frameWorlds === 1 ? 101 : 102 };
      }
      if (
        method === "Runtime.callFunctionOn" &&
        params.objectId === "inside-object"
      ) {
        return { result: { value: "After navigation" } };
      }
      if (method === "Runtime.releaseObject") return {};
      throw new Error(`Unexpected CDP method: ${method}`);
    },
  });
  try {
    assert.equal(
      await helperContext()
        .page.frameLocator("#frame")
        .locator("#inside")
        .innerText(),
      "After navigation",
    );
    assert.equal(frameWorlds, 2);
  } finally {
    restore();
  }
});

test("help documents every public callable by its facade path", () => {
  const context = helperContext();
  const publicPaths = [
    ...callablePaths(context.page, "page"),
    ...callablePaths(context.tabs, "tabs"),
    ...callablePaths(context.taskSpaces, "taskSpaces"),
    ...callablePaths(context.site, "site"),
    ...callablePaths(context.fetch, "fetch"),
    ...callablePaths(context.page.locator("#help-audit"), "locator"),
    ...callablePaths(context.page.frameLocator("#help-frame"), "frameLocator"),
    "cdp",
    "help",
  ].sort();
  assert.deepEqual(
    Object.keys(PUBLIC_API_DOCS).sort(),
    publicPaths,
    "public help docs and the callable facade surface must stay in exact sync",
  );

  for (const path of publicPaths) {
    const text = context.help(path);
    assert.doesNotMatch(
      text,
      /Unknown helper/,
      `expected help for public callable ${path}`,
    );
    assert.match(
      text,
      new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + String.raw`\(`),
      `expected the public facade signature for ${path} in:\n${text}`,
    );
  }
});

test("help supports facade namespaces and disambiguates nested methods", () => {
  const context = helperContext();

  const mouse = context.help("page.mouse");
  assert.match(mouse, /page\.mouse\.move\(/);
  assert.match(mouse, /page\.mouse\.down\(/);
  assert.match(mouse, /page\.mouse\.up\(/);
  assert.match(mouse, /page\.mouse\.drag\(/);

  assert.match(context.help("mouse"), /page\.mouse\.move\(/);
  assert.match(context.help("page"), /page\.goto\(/);
  assert.match(context.help("locator"), /locator\.fill\(/);
  assert.match(context.help("taskSpaces"), /taskSpaces\.switch\(/);
  assert.match(context.help(), /\bcdp\b/);
  assert.match(context.help(), /help\(name\?\)/);
  assert.match(context.help("page.keyboard.down"), /Dispatch a keydown event/);
  assert.match(context.help("page.mouse.down"), /Press a mouse button/);
  assert.match(
    context.help("page.screenshot"),
    /page\.screenshot\(options\?\) => Promise<Buffer>/,
  );
  assert.match(
    context.help("page.saveScreenshot"),
    /page\.saveScreenshot\(options\?\) => Promise<string>/,
  );
  assert.match(
    context.help("taskSpaces.switch"),
    /taskSpaces\.switch\(nameOrId\)/,
  );
  assert.match(context.help("down"), /Ambiguous helper name/);
  assert.match(context.help("down"), /page\.keyboard\.down/);
  assert.match(context.help("down"), /page\.mouse\.down/);
  assert.match(context.help("page.mouse.missing"), /help\('page\.mouse'\)/);
  assert.match(
    context.help("switchTaskSpace"),
    /Unknown helper: switchTaskSpace/,
  );
});

test("page.url reads the current URL asynchronously", async () => {
  const restore = setOverrides({
    cdpOverride: async (method) => {
      assert.equal(method, "Runtime.evaluate");
      return {
        result: {
          value: JSON.stringify({
            url: "https://example.com/current",
            title: "Current",
            w: 800,
            h: 600,
            sx: 0,
            sy: 0,
            pw: 800,
            ph: 600,
          }),
        },
      };
    },
  });
  try {
    const value = helperContext().page.url();
    assert.equal(typeof value.then, "function");
    assert.equal(await value, "https://example.com/current");
  } finally {
    restore();
  }
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
        await waitForAgentControl("t", { interval: 25, timeout: 5_000 });
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
