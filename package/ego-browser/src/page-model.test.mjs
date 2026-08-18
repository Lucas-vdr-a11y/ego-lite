import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NativeOperationGate } from "../dist/src/native-gate.js";
import { PageLedgerStore } from "../dist/src/page-ledger.js";
import { createTaskSpaceHandle } from "../dist/src/page-model.js";
import { PageRefRegistry } from "../dist/src/page-ref-registry.js";

async function withFixture(fn) {
  const rootDir = await mkdtemp(join(tmpdir(), "ego-page-model-test-"));
  try {
    return await fn(createFixture(rootDir));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
}

function createFixture(rootDir) {
  const calls = [];
  const tabs = new Map();
  let nextTarget = 1;
  let selectedSpace = null;
  let activeTarget = null;
  let popupOnNextClick = null;
  let timeoutNextMouseDispatch = false;
  let rejectNextClickPoint = false;

  function openPendingPopup() {
    if (!popupOnNextClick) return;
    const targetId = `target-${nextTarget++}`;
    tabs.set(targetId, {
      targetId,
      url: popupOnNextClick,
      title: "Popup",
      active: false,
    });
    popupOnNextClick = null;
  }
  async function ensureTargetSession(targetId) {
    assert(tabs.has(targetId), `unknown target ${targetId}`);
    calls.push(["ensureSession", targetId]);
    return `session:${targetId}`;
  }
  const gate = new NativeOperationGate({
    async selectSpace(spaceId) {
      selectedSpace = spaceId;
      calls.push(["selectSpace", spaceId]);
    },
    ensureSession: ensureTargetSession,
  });
  const services = {
    gate,
    pageRefs: new PageRefRegistry(),
    async createTab(url) {
      assert.equal(selectedSpace, 7);
      const targetId = `target-${nextTarget++}`;
      tabs.set(targetId, { targetId, url, title: url, active: true });
      activeTarget = targetId;
      calls.push(["createTab", url, targetId]);
      return targetId;
    },
    async listTabs() {
      assert.equal(selectedSpace, 7);
      return [...tabs.values()].map((tab) => ({
        ...tab,
        active: tab.targetId === activeTarget,
      }));
    },
    async cdp(method, params, sessionId, timeoutMs) {
      const call = ["cdp", method, params, sessionId];
      if (timeoutMs !== undefined) call.push(timeoutMs);
      calls.push(call);
      if (method === "Page.navigate") {
        const targetId = sessionId.slice("session:".length);
        tabs.get(targetId).url = params.url;
        tabs.get(targetId).title = params.url;
        return { frameId: "frame-1" };
      }
      if (method === "Runtime.evaluate") {
        const targetId = sessionId?.slice("session:".length);
        const tab = tabs.get(targetId);
        if (params.expression === "globalThis") {
          return {
            result: {
              type: "object",
              objectId: `global:${targetId}`,
            },
          };
        }
        if (params.expression === "location.href") {
          return { result: { type: "string", value: tab.url } };
        }
        if (params.expression === "document.title") {
          return { result: { type: "string", value: tab.title } };
        }
        if (params.expression.includes("performance.timeOrigin")) {
          return {
            result: {
              type: "object",
              value: {
                readyState: "complete",
                url: tab.url,
                timeOrigin: Date.now() + 1_000,
              },
            },
          };
        }
        if (params.expression.includes("innerWidth")) {
          return {
            result: {
              type: "object",
              value: {
                url: tab.url,
                title: tab.title,
                w: targetId === "target-1" ? 801 : 802,
                h: 600,
                sx: 0,
                sy: 0,
                pw: 1200,
                ph: 900,
              },
            },
          };
        }
        if (params.returnByValue === false) {
          return {
            result: {
              type: "object",
              objectId: `element:${targetId}`,
            },
          };
        }
        return { result: { type: "string", value: "complete" } };
      }
      if (method === "Runtime.callFunctionOn") {
        if (params.functionDeclaration.includes("window.scrollBy")) {
          return {
            result: {
              type: "object",
              value: {
                x: params.arguments?.[0]?.value?.deltaX ?? 0,
                y: params.arguments?.[0]?.value?.deltaY ?? 0,
              },
            },
          };
        }
        if (params.functionDeclaration.includes("window.fetch")) {
          return {
            result: {
              type: "object",
              value: {
                ok: false,
                status: 418,
                statusText: "I'm a Teapot",
                url: "https://example.test/api/teapot",
                headers: {
                  "content-type": "text/plain",
                  "x-fixture": "page-fetch",
                },
                body: "short and stout",
              },
            },
          };
        }
        if (params.functionDeclaration.includes("getBoundingClientRect")) {
          if (rejectNextClickPoint) {
            rejectNextClickPoint = false;
            return {
              result: {
                type: "object",
                value: { error: "element is not visible in the viewport" },
              },
            };
          }
          return {
            result: { type: "object", value: { x: 40, y: 60 } },
          };
        }
        if (params.functionDeclaration.includes("const probe = { seen")) {
          return { result: { type: "boolean", value: true } };
        }
        if (params.functionDeclaration.includes("target.dispatchEvent")) {
          openPendingPopup();
          return {
            result: {
              type: "object",
              value: { seen: false, fallback: true },
            },
          };
        }
        return {
          result: {
            type: "object",
            value: params.arguments?.[0]?.value ?? null,
          },
        };
      }
      if (method === "DOM.resolveNode") {
        const targetId = sessionId.slice("session:".length);
        return {
          object: {
            type: "object",
            objectId: `element:${targetId}:${params.backendNodeId}`,
          },
        };
      }
      if (method === "Runtime.releaseObject") return {};
      if (method === "Input.insertText") return {};
      if (method === "Input.dispatchKeyEvent") return {};
      if (method === "DOM.setFileInputFiles") return {};
      if (method === "Input.dispatchMouseEvent") {
        if (timeoutNextMouseDispatch) {
          timeoutNextMouseDispatch = false;
          throw new Error("CDP request timed out: Input.dispatchMouseEvent");
        }
        if (params.type === "mouseReleased") openPendingPopup();
        return {};
      }
      if (method === "Target.activateTarget") {
        activeTarget = params.targetId;
        return { success: true };
      }
      if (method === "Target.closeTarget") {
        tabs.delete(params.targetId);
        if (activeTarget === params.targetId) activeTarget = null;
        return { success: true };
      }
      throw new Error(`unexpected CDP method ${method}`);
    },
    async snapshot() {
      const tab = tabs.get(activeTarget);
      calls.push(["snapshot", activeTarget]);
      return {
        content: `snapshot:${tab?.url}`,
        refs: [
          {
            backendNodeId: 21,
            role: "button",
            name: "Run action",
          },
        ],
      };
    },
    async screenshot(path, options, sessionId) {
      calls.push(["screenshot", path, options, sessionId]);
      return path || "/tmp/generated-shot.png";
    },
    pendingDialog() {
      return null;
    },
    ensureSession: ensureTargetSession,
    invalidateSession(targetId) {
      calls.push(["invalidateSession", targetId]);
    },
    setPreferredTarget(targetId) {
      calls.push(["setPreferredTarget", targetId]);
    },
    now: () => Date.now(),
    sleep: async () => {},
  };
  return {
    activeTarget: () => activeTarget,
    calls,
    gate,
    rootDir,
    services,
    tabs,
    openPopupOnNextClick(url) {
      popupOnNextClick = url;
    },
    timeoutNextMouseDispatch() {
      timeoutNextMouseDispatch = true;
    },
    rejectNextClickPoint() {
      rejectNextClickPoint = true;
    },
  };
}

function taskForRound(fixture, roundId, overrides = {}) {
  return createTaskSpaceHandle(
    { id: 7, name: "research", ownership: "agent" },
    {
      ledger: new PageLedgerStore({ rootDir: fixture.rootDir, roundId }),
      ...fixture.services,
      ...overrides,
    },
  );
}

test("a page label restores in a new round and goto reuses its target", async () => {
  await withFixture(async (fixture) => {
    const firstRound = taskForRound(fixture, "round-a");
    const created = await firstRound.newPage("https://example.test/first");

    assert.equal(created.label, "p1");
    assert.equal(created.spaceId, 7);
    assert.equal(created.targetId, "target-1");
    assert.equal(created.openedBy, "agent");
    assert.equal(fixture.tabs.size, 1);

    const secondRound = taskForRound(fixture, "round-b");
    const restored = secondRound.page("p1");
    await restored.goto("https://example.test/second");

    assert.equal(restored.targetId, "target-1");
    assert.equal(fixture.tabs.size, 1, "goto must not create a second tab");
    assert.equal(
      fixture.tabs.get("target-1").url,
      "https://example.test/second",
    );
    assert.equal(
      await restored.snapshot(),
      "snapshot:https://example.test/second",
    );
  });
});

test("newPage waits for the document created by this call, not an already-complete placeholder", async () => {
  await withFixture(async (fixture) => {
    const requestedUrl = "https://example.test/created-document";
    const baseCreateTab = fixture.services.createTab;
    const baseCdp = fixture.services.cdp;
    let now = 10_000;
    let targetId;
    let sleepCount = 0;

    const task = taskForRound(fixture, "round-a", {
      async createTab(url) {
        targetId = await baseCreateTab(url);
        fixture.tabs.get(targetId).url = "chrome://newtab/";
        return targetId;
      },
      async cdp(method, params, sessionId, timeoutMs) {
        if (method === "Runtime.evaluate") {
          if (params.expression === "document.readyState") {
            return { result: { type: "string", value: "complete" } };
          }
          if (params.expression.includes("performance.timeOrigin")) {
            const tab = fixture.tabs.get(targetId);
            return {
              result: {
                type: "object",
                value: {
                  readyState: "complete",
                  url: tab.url,
                  timeOrigin: tab.url === requestedUrl ? now : now - 5_000,
                },
              },
            };
          }
        }
        return baseCdp(method, params, sessionId, timeoutMs);
      },
      now: () => now,
      async sleep(ms) {
        sleepCount += 1;
        now += ms;
        fixture.tabs.get(targetId).url = requestedUrl;
      },
    });

    const page = await task.newPage(requestedUrl);

    assert.equal(page.targetId, targetId);
    assert.equal(sleepCount, 1);
    assert.equal(fixture.tabs.get(targetId).url, requestedUrl);
  });
});

test("snapshot activates the addressed page, not whichever tab was current", async () => {
  await withFixture(async (fixture) => {
    const task = taskForRound(fixture, "round-a");
    const first = await task.newPage("https://example.test/first");
    await task.newPage("https://example.test/second");

    assert.equal(fixture.activeTarget(), "target-2");
    assert.equal(await first.snapshot(), "snapshot:https://example.test/first");
    assert.equal(fixture.activeTarget(), "target-1");
  });
});

test("metadata reads stay target-scoped while evaluate and screenshot activate their Page", async () => {
  await withFixture(async (fixture) => {
    const task = taskForRound(fixture, "round-a");
    const first = await task.newPage("https://example.test/first");
    await task.newPage("https://example.test/second");

    assert.equal(fixture.activeTarget(), "target-2");
    assert.equal(await first.url(), "https://example.test/first");
    assert.equal(await first.title(), "https://example.test/first");
    assert.deepEqual(await first.info(), {
      url: "https://example.test/first",
      title: "https://example.test/first",
      w: 801,
      h: 600,
      sx: 0,
      sy: 0,
      pw: 1200,
      ph: 900,
    });
    assert.equal(
      fixture.activeTarget(),
      "target-2",
      "metadata reads must not activate the addressed page",
    );
    assert.deepEqual(
      await first.evaluate((value) => value, { source: "first" }),
      { source: "first" },
    );
    assert.equal(
      fixture.activeTarget(),
      "target-1",
      "page.evaluate must activate the page whose JavaScript it runs",
    );
    assert.equal(
      await first.screenshot("/tmp/first.png", { full: true }),
      "/tmp/first.png",
    );
    assert.equal(
      fixture.activeTarget(),
      "target-1",
      "screenshot must activate the page before visual capture",
    );

    const pageCalls = fixture.calls.filter(
      ([kind, , , sessionId]) =>
        (kind === "cdp" || kind === "screenshot") &&
        sessionId === "session:target-1",
    );
    assert(pageCalls.length >= 5);
    assert(
      pageCalls.every(([, , , sessionId]) => sessionId === "session:target-1"),
    );
    const callFunction = pageCalls.find(
      ([kind, method]) => kind === "cdp" && method === "Runtime.callFunctionOn",
    );
    assert.deepEqual(callFunction[2].arguments, [
      { value: { source: "first" } },
    ]);
    assert.match(callFunction[2].functionDeclaration, /value.*=> value/);
  });
});

test("Page evaluate rejects ambiguous or non-serializable arguments", async () => {
  await withFixture(async (fixture) => {
    const task = taskForRound(fixture, "round-a");
    const page = await task.newPage("https://example.test/evaluate");
    const cyclic = {};
    cyclic.self = cyclic;

    await assert.rejects(
      () => page.evaluate("document.title", { ignored: true }),
      /string expression does not accept an argument/,
    );
    await assert.rejects(
      () => page.evaluate((value) => value, cyclic),
      /argument must be JSON-serializable/,
    );
    await assert.rejects(
      () => page.evaluate(42),
      /expects a function or string expression/,
    );
  });
});

test("Page evaluate preserves a large nested JSON argument", async () => {
  await withFixture(async (fixture) => {
    const task = taskForRound(fixture, "round-a");
    const page = await task.newPage("https://example.test/evaluate-complex");
    const argument = {
      marker: "复杂 input 😀 quotes: \" ' ` and a newline\n",
      config: {
        enabled: true,
        nullable: null,
        flags: [true, false, null],
        nested: { level: { value: "深层值" } },
      },
      rows: Array.from({ length: 128 }, (_, index) => ({
        id: index,
        label: `row-${index}-数据`,
        tags: [`tag-${index % 7}`, "共享", `quoted-\"${index}\"`],
        metrics: { value: index * 3, valid: index % 2 === 0 },
      })),
    };

    const result = await page.evaluate(async (input) => input, argument);

    assert.deepEqual(result, argument);
    assert.equal(fixture.activeTarget(), page.targetId);
  });
});

test("Page fetch activates its target and returns a structured non-2xx response", async () => {
  await withFixture(async (fixture) => {
    const task = taskForRound(fixture, "round-a");
    const first = await task.newPage("https://example.test/first");
    await task.newPage("https://example.test/second");

    const response = await first.fetch("/api/teapot", {
      method: "POST",
      headers: { "x-request": "page-fetch" },
      body: "payload",
      timeout: 250,
    });

    assert.deepEqual(response, {
      ok: false,
      status: 418,
      statusText: "I'm a Teapot",
      url: "https://example.test/api/teapot",
      headers: {
        "content-type": "text/plain",
        "x-fixture": "page-fetch",
      },
      body: "short and stout",
    });
    assert.equal(fixture.activeTarget(), first.targetId);
    const fetchCall = fixture.calls.find(
      ([kind, method, params]) =>
        kind === "cdp" &&
        method === "Runtime.callFunctionOn" &&
        params.functionDeclaration.includes("window.fetch"),
    );
    assert.deepEqual(fetchCall[2].arguments, [
      {
        value: {
          url: "/api/teapot",
          options: {
            method: "POST",
            headers: { "x-request": "page-fetch" },
            body: "payload",
          },
          timeoutMs: 250,
        },
      },
    ]);
    assert.equal(fetchCall[3], "session:target-1");
    assert.equal(fetchCall[4], 1_250);
  });
});

test("Page fetch validates its JSON options and millisecond timeout", async () => {
  await withFixture(async (fixture) => {
    const task = taskForRound(fixture, "round-a");
    const page = await task.newPage("https://example.test/fetch");
    const cyclic = {};
    cyclic.self = cyclic;

    await assert.rejects(
      () => page.fetch("/api/text", { timeout: 0 }),
      /positive number of milliseconds/,
    );
    await assert.rejects(
      () => page.fetch("/api/text", { signal: {} }),
      /does not accept options.signal/,
    );
    await assert.rejects(
      () => page.fetch("/api/text", cyclic),
      /options must be JSON-serializable/,
    );
  });
});

test("Page click stays target-scoped and adopts only tabs opened by the action", async () => {
  await withFixture(async (fixture) => {
    const task = taskForRound(fixture, "round-a", { pageBudget: 2 });
    const first = await task.newPage("https://example.test/first");
    await task.newPage("https://example.test/second");
    fixture.tabs.set("target-user", {
      targetId: "target-user",
      url: "https://example.test/user",
      title: "Existing user page",
      active: false,
    });
    fixture.openPopupOnNextClick("https://example.test/popup");
    fixture.timeoutNextMouseDispatch();

    const receipt = await first.click("#open-popup");

    assert.deepEqual(receipt, {
      popups: [{ label: "p3", targetId: "target-3" }],
    });
    const inventory = await task.listPages();
    assert.equal(
      inventory.find((item) => item.targetId === "target-user").label,
      undefined,
      "a tab that existed before the action must remain untracked",
    );
    assert.equal(
      inventory.find((item) => item.targetId === "target-3").label,
      "p3",
      "a popup opened by the action is managed even above the budget",
    );
    assert(
      fixture.calls.some(
        ([kind, method, , sessionId]) =>
          kind === "cdp" &&
          method === "Input.dispatchMouseEvent" &&
          sessionId === "session:target-1",
      ),
    );
    assert.equal(
      fixture.activeTarget(),
      "target-1",
      "click must leave its Page active",
    );
    await assert.rejects(
      () => task.newPage("https://example.test/blocked"),
      /Page budget reached \(3\/2\)/,
    );
  });
});

test("Page fill uses its target session and reports no popup when none opened", async () => {
  await withFixture(async (fixture) => {
    const task = taskForRound(fixture, "round-a");
    const first = await task.newPage("https://example.test/first");
    await task.newPage("https://example.test/second");

    assert.deepEqual(await first.fill("#text-input", "filled"), {});
    const insertText = fixture.calls.find(
      ([kind, method]) => kind === "cdp" && method === "Input.insertText",
    );
    assert.deepEqual(insertText, [
      "cdp",
      "Input.insertText",
      { text: "filled" },
      "session:target-1",
    ]);
    assert.equal(
      fixture.activeTarget(),
      "target-1",
      "fill must leave its Page active",
    );
  });
});

test("Page pointer methods dispatch through the addressed target session", async () => {
  await withFixture(async (fixture) => {
    const task = taskForRound(fixture, "round-a");
    const first = await task.newPage("https://example.test/first");
    await task.newPage("https://example.test/second");

    await first.dblclick("button.primary");
    await first.hover("button.primary");
    await first.dragAndDrop("#source", "#destination");

    const pointerCalls = fixture.calls.filter(
      ([kind, method]) =>
        kind === "cdp" && method === "Input.dispatchMouseEvent",
    );
    assert(pointerCalls.length >= 7);
    assert(
      pointerCalls.every((call) => call[3] === `session:${first.targetId}`),
      "all pointer events must use the addressed Page session",
    );
    assert(
      pointerCalls.some(
        ([, , params]) =>
          params.type === "mousePressed" && params.clickCount === 2,
      ),
      "dblclick must preserve the double-click count",
    );
    assert.equal(fixture.activeTarget(), first.targetId);
  });
});

test("Page mouse primitives preserve button state on one target", async () => {
  await withFixture(async (fixture) => {
    const task = taskForRound(fixture, "round-a");
    const first = await task.newPage("https://example.test/first");
    await task.newPage("https://example.test/second");

    await first.mouse.move(20, 30);
    await first.mouse.down();
    await first.mouse.move(40, 50);
    await first.mouse.up();
    await first.mouse.click(60, 70);
    await first.mouse.wheel(5, 120);

    const pointerCalls = fixture.calls.filter(
      ([kind, method]) =>
        kind === "cdp" && method === "Input.dispatchMouseEvent",
    );
    assert(pointerCalls.length >= 8);
    assert(
      pointerCalls.every((call) => call[3] === `session:${first.targetId}`),
    );
    assert(
      pointerCalls.some(
        ([, , params]) => params.type === "mouseMoved" && params.buttons === 1,
      ),
      "mouse.move must retain the pressed left button",
    );
    assert(
      pointerCalls.some(
        ([, , params]) =>
          params.type === "mouseWheel" &&
          params.deltaX === 5 &&
          params.deltaY === 120,
      ),
    );
    assert.equal(fixture.activeTarget(), first.targetId);
  });
});

test("Page scrollBy evaluates in the addressed page", async () => {
  await withFixture(async (fixture) => {
    const task = taskForRound(fixture, "round-a");
    const first = await task.newPage("https://example.test/first");
    await task.newPage("https://example.test/second");

    assert.deepEqual(await first.scrollBy(450), { x: 0, y: 450 });

    const scrollCall = fixture.calls.find(
      ([kind, method, params]) =>
        kind === "cdp" &&
        method === "Runtime.callFunctionOn" &&
        params.functionDeclaration.includes("window.scrollBy"),
    );
    assert.equal(scrollCall[3], `session:${first.targetId}`);
    assert.equal(fixture.activeTarget(), first.targetId);
  });
});

test("Page keyboard press and type use the addressed target session", async () => {
  await withFixture(async (fixture) => {
    const task = taskForRound(fixture, "round-a");
    const first = await task.newPage("https://example.test/first");
    await task.newPage("https://example.test/second");

    await first.keyboard.press("Meta+A");
    await first.keyboard.type("hello 世界");

    const keyCalls = fixture.calls.filter(
      ([kind, method]) =>
        kind === "cdp" &&
        (method === "Input.dispatchKeyEvent" || method === "Input.insertText"),
    );
    assert(keyCalls.length >= 3);
    assert(keyCalls.every((call) => call[3] === `session:${first.targetId}`));
    assert(
      keyCalls.some(
        ([, method, params]) =>
          method === "Input.dispatchKeyEvent" &&
          params.type === "keyDown" &&
          params.modifiers === 4 &&
          params.commands?.includes("selectAll"),
      ),
      "Meta+A must retain the native selectAll editing command",
    );
    assert(
      keyCalls.some(
        ([, method, params]) =>
          method === "Input.insertText" && params.text === "hello 世界",
      ),
    );
    assert.equal(fixture.activeTarget(), first.targetId);
  });
});

test("Page keyboard dispatch and file input resolve inside the addressed page", async () => {
  await withFixture(async (fixture) => {
    const task = taskForRound(fixture, "round-a");
    const first = await task.newPage("https://example.test/first");
    await task.newPage("https://example.test/second");

    await first.keyboard.dispatch("#editor", "Enter", "keydown");
    await first.setInputFiles("#upload", ["/tmp/one.txt", "/tmp/two.txt"]);

    const dispatchCall = fixture.calls.find(
      ([kind, method, params]) =>
        kind === "cdp" &&
        method === "Runtime.callFunctionOn" &&
        params.functionDeclaration.includes("KeyboardEvent"),
    );
    assert.equal(dispatchCall[3], `session:${first.targetId}`);
    const uploadCall = fixture.calls.find(
      ([kind, method]) => kind === "cdp" && method === "DOM.setFileInputFiles",
    );
    assert.deepEqual(uploadCall[2].files, ["/tmp/one.txt", "/tmp/two.txt"]);
    assert.equal(uploadCall[3], `session:${first.targetId}`);
    assert.equal(fixture.activeTarget(), first.targetId);
  });
});

test("Page actions resolve snapshot refs inside the addressed page", async () => {
  await withFixture(async (fixture) => {
    const task = taskForRound(fixture, "round-a");
    const first = await task.newPage("https://example.test/first");
    const second = await task.newPage("https://example.test/second");

    await first.snapshot();
    await second.snapshot();
    await first.click("@21");
    await second.fill("@21", "page-scoped");

    const firstResolveCall = fixture.calls.find(
      ([kind, method, params, sessionId]) =>
        kind === "cdp" &&
        method === "DOM.resolveNode" &&
        params.backendNodeId === 21 &&
        sessionId === "session:target-1",
    );
    const secondResolveCall = fixture.calls.find(
      ([kind, method, params, sessionId]) =>
        kind === "cdp" &&
        method === "DOM.resolveNode" &&
        params.backendNodeId === 21 &&
        sessionId === "session:target-2",
    );
    assert(
      firstResolveCall,
      "click must resolve through the first Page session",
    );
    assert(
      secondResolveCall,
      "fill must resolve through the second Page session",
    );
    assert.equal(fixture.activeTarget(), second.targetId);
  });
});

test("a new round refreshes the addressed Page before resolving a ref", async () => {
  await withFixture(async (fixture) => {
    const firstRound = taskForRound(fixture, "round-a");
    const created = await firstRound.newPage("https://example.test/first");
    await created.snapshot();
    const snapshotsBefore = fixture.calls.filter(
      ([kind]) => kind === "snapshot",
    ).length;

    const secondRound = taskForRound(fixture, "round-b", {
      pageRefs: new PageRefRegistry(),
    });
    await secondRound.page(created.label).click("@21");

    assert.equal(
      fixture.calls.filter(([kind]) => kind === "snapshot").length,
      snapshotsBefore + 1,
      "an empty per-round ref map must refresh the same Page",
    );
    assert.deepEqual(
      fixture.calls.filter(([kind]) => kind === "snapshot").at(-1),
      ["snapshot", created.targetId],
    );
  });
});

test("an unknown Page ref fails after one target-scoped refresh", async () => {
  await withFixture(async (fixture) => {
    const task = taskForRound(fixture, "round-a");
    const page = await task.newPage("https://example.test/first");

    await assert.rejects(() => page.click("@99"), /Unknown ref: 99/);
    assert.deepEqual(
      fixture.calls.filter(([kind]) => kind === "snapshot"),
      [["snapshot", page.targetId]],
    );
  });
});

test("Page click scrolls the element into view before computing its point", async () => {
  await withFixture(async (fixture) => {
    const task = taskForRound(fixture, "round-a");
    const page = await task.newPage("https://example.test/first");

    await page.click("#offscreen");

    const pointCall = fixture.calls.find(
      ([kind, method, params]) =>
        kind === "cdp" &&
        method === "Runtime.callFunctionOn" &&
        params.functionDeclaration.includes("getBoundingClientRect"),
    );
    assert.match(pointCall[2].functionDeclaration, /scrollIntoView/);
  });
});

test("Page click does not dispatch input when scrolling cannot make the element visible", async () => {
  await withFixture(async (fixture) => {
    const task = taskForRound(fixture, "round-a");
    const page = await task.newPage("https://example.test/first");
    fixture.rejectNextClickPoint();

    await assert.rejects(
      () => page.click("#hidden"),
      /element is not visible in the viewport/,
    );
    assert.equal(
      fixture.calls.some(
        ([kind, method]) =>
          kind === "cdp" && method === "Input.dispatchMouseEvent",
      ),
      false,
    );
  });
});

test("close leaves an anchor tab and the next page gets a new label", async () => {
  await withFixture(async (fixture) => {
    const task = taskForRound(fixture, "round-a");
    const first = await task.newPage("https://example.test/first");

    await first.close();
    assert.equal(fixture.tabs.has("target-1"), false);
    assert.equal(
      fixture.tabs.size,
      1,
      "the task space must retain an anchor tab",
    );
    await assert.rejects(
      () => task.page("p1").goto("https://example.test/closed"),
      /page p1 was closed/,
    );

    const second = await task.newPage("https://example.test/second");
    assert.equal(second.label, "p2");
    assert.equal(second.targetId, "target-3");
  });
});

test("a ledger failure closes the newly created uncommitted tab", async () => {
  await withFixture(async (fixture) => {
    const task = createTaskSpaceHandle(
      { id: 7, name: "research", ownership: "agent" },
      {
        ...fixture.services,
        ledger: {
          async reconcile() {
            return { pages: {} };
          },
          async addPage() {
            throw new Error("ledger unavailable");
          },
        },
      },
    );

    await assert.rejects(
      () => task.newPage("https://example.test/uncommitted"),
      /ledger unavailable/,
    );
    assert.equal(fixture.tabs.size, 0);
    assert(
      fixture.calls.some(
        ([kind, method]) => kind === "cdp" && method === "Target.closeTarget",
      ),
    );
  });
});

test("listPages combines managed labels with live browser information", async () => {
  await withFixture(async (fixture) => {
    const task = taskForRound(fixture, "round-a");
    const managed = await task.newPage("https://example.test/managed");
    fixture.tabs.set("target-user", {
      targetId: "target-user",
      url: "https://example.test/user",
      title: "User page",
      active: false,
    });

    const pages = await task.listPages();
    const managedItem = pages.find((item) => item.label === "p1");
    const unknownItem = pages.find((item) => item.targetId === "target-user");

    assert.equal(managedItem.page.label, "p1");
    assert.equal(managedItem.page.targetId, managed.targetId);
    assert.equal(managedItem.title, "https://example.test/managed");
    assert.equal(managedItem.openedBy, "agent");
    assert.equal(unknownItem.label, undefined);
    assert.equal(unknownItem.page.targetId, "target-user");
    assert.equal(unknownItem.page.spaceId, 7);
    assert.equal(unknownItem.page.openedBy, "unknown");
    assert.equal(unknownItem.page.snapshot, undefined);
    assert.equal(unknownItem.page.goto, undefined);
    assert.equal(unknownItem.page.close, undefined);
    assert.equal(unknownItem.title, "User page");
    assert.equal(unknownItem.openedBy, "unknown");
  });
});

test("adopt turns a live untracked page into a managed page", async () => {
  await withFixture(async (fixture) => {
    fixture.tabs.set("target-user", {
      targetId: "target-user",
      url: "https://example.test/user",
      title: "User page",
      active: true,
    });
    const task = taskForRound(fixture, "round-a");
    const [{ page: untracked }] = await task.listPages();

    const adopted = await task.adopt(untracked, { as: "notes" });

    assert.equal(adopted.label, "notes");
    assert.equal(adopted.targetId, "target-user");
    assert.equal(adopted.openedBy, "unknown");
    assert.equal(
      await adopted.snapshot(),
      "snapshot:https://example.test/user",
    );
    assert.deepEqual(
      (await task.listPages()).map(({ label, openedBy }) => ({
        label,
        openedBy,
      })),
      [{ label: "notes", openedBy: "unknown" }],
    );
  });
});

test("adopt rejects stale, cross-space, and already managed handles", async () => {
  await withFixture(async (fixture) => {
    fixture.tabs.set("target-user", {
      targetId: "target-user",
      url: "https://example.test/user",
      title: "User page",
      active: true,
    });
    const task = taskForRound(fixture, "round-a");
    const [{ page: untracked }] = await task.listPages();
    const otherTask = createTaskSpaceHandle(
      { id: 8, name: "other", ownership: "agent" },
      {
        ledger: new PageLedgerStore({
          rootDir: fixture.rootDir,
          roundId: "round-a",
        }),
        ...fixture.services,
      },
    );

    await assert.rejects(
      () => otherTask.adopt(untracked),
      /belongs to space 7, not space 8/,
    );

    const adopted = await task.adopt(untracked);
    await assert.rejects(
      () => task.adopt(untracked),
      /target target-user is already page p1/,
    );

    const inventory = await task.listPages();
    assert.equal(inventory[0].page.label, adopted.label);
    fixture.tabs.delete("target-user");
    const stale = untracked;
    await assert.rejects(
      () => task.adopt(stale),
      /untracked page target-user is no longer open/,
    );
  });
});

test("adopt applies the managed-page budget before changing the ledger", async () => {
  await withFixture(async (fixture) => {
    const task = taskForRound(fixture, "round-a", { pageBudget: 1 });
    await task.newPage("https://example.test/managed");
    fixture.tabs.set("target-user", {
      targetId: "target-user",
      url: "https://example.test/user",
      title: "User page",
      active: false,
    });
    const untracked = (await task.listPages()).find(
      (item) => item.targetId === "target-user",
    ).page;

    await assert.rejects(
      () => task.adopt(untracked),
      /Page budget reached \(1\/1\)/,
    );
    const after = await task.listPages();
    assert.equal(
      after.find((item) => item.targetId === "target-user").label,
      undefined,
    );
  });
});

test("release leaves an adopted page open and retires its label", async () => {
  await withFixture(async (fixture) => {
    fixture.tabs.set("target-user", {
      targetId: "target-user",
      url: "https://example.test/user",
      title: "User page",
      active: true,
    });
    const task = taskForRound(fixture, "round-a");
    const untracked = (await task.listPages())[0].page;
    const adopted = await task.adopt(untracked);

    const released = await task.release(adopted.label);

    assert.equal(released.targetId, "target-user");
    assert.equal(fixture.tabs.has("target-user"), true);
    assert.equal((await task.listPages())[0].label, undefined);
    await assert.rejects(() => adopted.snapshot(), /page p1 was released/);
    const adoptedAgain = await task.adopt(released);
    assert.equal(adoptedAgain.label, "p2");
  });
});

test("release refuses to orphan a page created by the agent", async () => {
  await withFixture(async (fixture) => {
    const task = taskForRound(fixture, "round-a");
    const created = await task.newPage("https://example.test/agent");

    await assert.rejects(
      () => task.release(created.label),
      /page p1 was created by the agent; close it instead/,
    );
    assert.equal(fixture.tabs.has(created.targetId), true);
    assert.equal((await task.listPages())[0].label, "p1");
  });
});

test("listPages retires a managed label when its browser tab disappeared", async () => {
  await withFixture(async (fixture) => {
    const task = taskForRound(fixture, "round-a");
    const page = await task.newPage("https://example.test/managed");
    fixture.tabs.delete(page.targetId);

    assert.deepEqual(await task.listPages(), []);
    await assert.rejects(
      () => task.page("p1").snapshot(),
      /page p1 was closed/,
    );
  });
});

test("newPage rejects before creating a tab when the managed budget is full", async () => {
  await withFixture(async (fixture) => {
    const task = taskForRound(fixture, "round-a", { pageBudget: 2 });
    const first = await task.newPage("https://example.test/first");
    await task.newPage("https://example.test/second");

    await assert.rejects(
      () => task.newPage("https://example.test/third"),
      (error) => {
        assert.match(
          error.message,
          /Page budget reached \(2\/2\) in space "research"/,
        );
        assert.match(error.message, /p1\s+"https:\/\/example\.test\/first"/);
        assert.match(
          error.message,
          /Close: await task\.page\('p1'\)\.close\(\)/,
        );
        assert.match(
          error.message,
          /Reuse: await task\.page\('p1'\)\.goto\(url\)/,
        );
        return true;
      },
    );
    assert.equal(
      fixture.tabs.size,
      2,
      "budget rejection must happen before createTab",
    );

    await first.close();
    const replacement = await task.newPage("https://example.test/third");
    assert.equal(replacement.label, "p3");
    assert.equal(fixture.tabs.size, 2);
  });
});

test("a tab closed outside the runtime frees budget on the next newPage", async () => {
  await withFixture(async (fixture) => {
    const task = taskForRound(fixture, "round-a", { pageBudget: 2 });
    const first = await task.newPage("https://example.test/first");
    await task.newPage("https://example.test/second");
    fixture.tabs.delete(first.targetId);

    const replacement = await task.newPage("https://example.test/third");

    assert.equal(replacement.label, "p3");
    assert.equal(fixture.tabs.size, 2);
    await assert.rejects(
      () => task.page("p1").snapshot(),
      /page p1 was closed/,
    );
  });
});

test("newPage never closes a managed page when native returns its target again", async () => {
  await withFixture(async (fixture) => {
    const firstTask = taskForRound(fixture, "round-a");
    const first = await firstTask.newPage("https://example.test/first");
    const closeCallsBefore = fixture.calls.filter(
      ([kind, method]) => kind === "cdp" && method === "Target.closeTarget",
    ).length;
    const secondTask = taskForRound(fixture, "round-a", {
      async createTab() {
        return first.targetId;
      },
    });

    await assert.rejects(
      () => secondTask.newPage("https://example.test/second"),
      /did not create a distinct tab.*already page p1/,
    );

    assert.equal(fixture.tabs.has(first.targetId), true);
    assert.equal(
      fixture.calls.filter(
        ([kind, method]) => kind === "cdp" && method === "Target.closeTarget",
      ).length,
      closeCallsBefore,
    );
  });
});
