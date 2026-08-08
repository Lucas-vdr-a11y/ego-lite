// Integration tests driving a real playwright-core client through the Ego CDP
// transport against the scripted fake native backend. These lock in the
// Playwright-side behavior assumptions the transport must satisfy.
import test from "node:test";
import assert from "node:assert/strict";

import { chromium } from "#playwright-runtime";

import { FakeNativeBrowser, waitForCondition } from "./fake-native-harness.mjs";

const playwrightTaskSpace =
  await import("../../dist/src/playwright/taskspace.js");
const playwrightTransport =
  await import("../../dist/src/playwright/transport.js");

async function connectFakeTaskSpace({
  startUrl = "https://start.test/",
  childFrameUrl,
  harnessOptions,
  transportOptions = {},
} = {}) {
  const fake = new FakeNativeBrowser(harnessOptions);
  fake.addTab("tab-start", startUrl, { childFrameUrl });
  const connector = playwrightTaskSpace.createPlaywrightTaskSpaceConnector({
    runtime: () => fake.runtime,
    transport: (runtime) =>
      playwrightTransport.createEgoPlaywrightTransport(
        runtime,
        transportOptions,
      ),
    connectOverCDP: (connectToken) => chromium.connectOverCDP(connectToken),
  });
  const session = await connector({ id: 1 });
  await waitForCondition(() => session.page.url() === startUrl, 3_000);
  return { fake, session };
}

test("a subframe goto navigates natively instead of replacing the TaskSpace tab", async () => {
  const { fake, session } = await connectFakeTaskSpace({
    childFrameUrl: "https://child.test/inner",
  });
  try {
    const { page } = session;
    await waitForCondition(() => page.frames().length === 2, 3_000);
    const child = page
      .frames()
      .find((frame) => frame.url() === "https://child.test/inner");
    assert.ok(child, "child frame is visible to Playwright");

    await child.goto("https://child.test/next", { timeout: 5_000 });

    assert.deepEqual(
      fake.createdUrls,
      [],
      "subframe navigation must not create a replacement tab",
    );
    assert.deepEqual(
      [...fake.tabs.keys()],
      ["tab-start"],
      "the TaskSpace tab set is unchanged",
    );
    const nativeNavigate = fake.log.filter(
      (request) => request.method === "Page.navigate",
    );
    assert.equal(nativeNavigate.length, 1, "navigation reached native CDP");
    assert.equal(nativeNavigate[0].params.frameId, "tab-start-child");
    assert.equal(child.url(), "https://child.test/next");
    assert.equal(
      page.url(),
      "https://start.test/",
      "the main frame stays on its document",
    );
  } finally {
    await session.close().catch(() => {});
  }
});

test("request interception and viewport emulation survive a TaskSpace navigation", async () => {
  const { fake, session } = await connectFakeTaskSpace({});
  try {
    const { page } = session;
    await page.route("**/*", (route) => route.continue());
    await page.setViewportSize({ width: 555, height: 444 });

    await page.goto("https://start.test/second", {
      waitUntil: "load",
      timeout: 10_000,
    });
    await waitForCondition(() => fake.sessions.size === 1, 2_000);

    const replacementSession = [...fake.sessions.keys()].at(-1);
    const onReplacement = (method) =>
      fake.log.filter(
        (request) =>
          request.sessionId === replacementSession && request.method === method,
      ).length;
    assert.ok(
      onReplacement("Fetch.enable") >= 1,
      "Fetch.enable is replayed so page.route keeps intercepting",
    );
    assert.ok(
      onReplacement("Emulation.setDeviceMetricsOverride") >= 1,
      "the viewport override is replayed onto the replacement target",
    );
  } finally {
    await session.close().catch(() => {});
  }
});

test("page.route intercepts the document request of a TaskSpace navigation", async () => {
  const { fake, session } = await connectFakeTaskSpace({
    harnessOptions: { interceptNavigations: true },
    transportOptions: { navigationCommitTimeoutMs: 2_000 },
  });
  try {
    const { page } = session;
    const routedUrls = [];
    await page.route("**/*", (route) => {
      routedUrls.push(route.request().url());
      return route.continue();
    });

    await page.goto("https://start.test/second", {
      waitUntil: "commit",
      timeout: 8_000,
    });

    assert.ok(
      routedUrls.includes("https://start.test/second"),
      `the route handler must see the document request, saw: ${JSON.stringify(routedUrls)}`,
    );
    assert.equal(page.url(), "https://start.test/second");
    assert.equal(
      fake.continuedRequests.length,
      1,
      "the paused document request was continued through the route handler",
    );
  } finally {
    await session.close().catch(() => {});
  }
});

test("a failed navigation cleans up the replacement tab and leaves the page usable", async () => {
  const { fake, session } = await connectFakeTaskSpace({
    transportOptions: { navigationCommitTimeoutMs: 500 },
  });
  try {
    const { page } = session;
    const originalCreateTab = fake.runtime.createTab;
    let replacementTargetId;
    fake.runtime.createTab = async (url) => {
      const created = await originalCreateTab(url);
      replacementTargetId = created.targetId;
      fake.frameUrlOverride.set(created.targetId, "about:blank");
      return created;
    };

    await assert.rejects(
      page.goto("https://start.test/second", {
        waitUntil: "load",
        timeout: 6_000,
      }),
      /did not commit/,
    );
    await waitForCondition(
      () => fake.closedTargets.includes(replacementTargetId),
      2_000,
    );
    assert.ok(
      fake.closedTargets.includes(replacementTargetId),
      "the replacement tab is closed after the navigation fails",
    );
    assert.deepEqual(
      [...fake.tabs.keys()],
      ["tab-start"],
      "only the original tab stays open",
    );

    const evaluated = await Promise.race([
      page.evaluate(() => "still-alive"),
      new Promise((_resolve, reject) =>
        setTimeout(() => reject(new Error("evaluate hung")), 4_000),
      ),
    ]);
    assert.equal(
      evaluated,
      "fake-result",
      "the page still evaluates after the failed navigation",
    );
  } finally {
    await session.close().catch(() => {});
  }
});

test("concurrent navigations settle on a single native tab", async () => {
  const { fake, session } = await connectFakeTaskSpace({});
  try {
    const { page } = session;
    const originalCreateTab = fake.runtime.createTab;
    fake.runtime.createTab = async (url) => {
      await new Promise((resolve) => setTimeout(resolve, 120));
      return originalCreateTab(url);
    };

    await Promise.allSettled([
      page.goto("https://start.test/nav-a", {
        waitUntil: "commit",
        timeout: 8_000,
      }),
      page.goto("https://start.test/nav-b", {
        waitUntil: "commit",
        timeout: 8_000,
      }),
    ]);
    await waitForCondition(() => fake.tabs.size === 1, 3_000);

    assert.equal(
      fake.tabs.size,
      1,
      "exactly one native tab remains after concurrent navigations",
    );
    assert.equal(
      fake.sessions.size,
      1,
      "no orphaned native sessions are left attached",
    );
  } finally {
    await session.close().catch(() => {});
  }
});

test("closing the page during a pending navigation fails goto and leaks no tab", async () => {
  const { fake, session } = await connectFakeTaskSpace({
    transportOptions: { navigationCommitTimeoutMs: 10_000 },
  });
  try {
    const { page } = session;
    const originalCreateTab = fake.runtime.createTab;
    let replacementTargetId;
    fake.runtime.createTab = async (url) => {
      const created = await originalCreateTab(url);
      replacementTargetId = created.targetId;
      fake.frameUrlOverride.set(created.targetId, "about:blank");
      return created;
    };

    const gotoPromise = page.goto("https://start.test/second", {
      waitUntil: "commit",
      timeout: 8_000,
    });
    gotoPromise.catch(() => {});
    await waitForCondition(() => replacementTargetId !== undefined, 5_000);

    await page.close({ runBeforeUnload: false });
    fake.frameUrlOverride.delete(replacementTargetId);

    await assert.rejects(gotoPromise, (error) => {
      assert.match(String(error?.message || error), /closed/i);
      return true;
    });

    await waitForCondition(() => fake.tabs.size === 0, 3_000);
    assert.equal(
      fake.tabs.size,
      0,
      `no native tab may survive the close, saw: ${JSON.stringify([...fake.tabs.keys()])}`,
    );
    assert.ok(
      fake.closedTargets.includes(replacementTargetId),
      "the replacement tab is closed, not leaked",
    );
  } finally {
    await session.close().catch(() => {});
  }
});

test("an init script issued during navigation reaches the replacement target", async () => {
  const { fake, session } = await connectFakeTaskSpace({});
  try {
    const { page } = session;
    const originalCreateTab = fake.runtime.createTab;
    let replacementTargetId;
    fake.runtime.createTab = async (url) => {
      const created = await originalCreateTab(url);
      replacementTargetId = created.targetId;
      fake.frameUrlOverride.set(created.targetId, "about:blank");
      return created;
    };

    const gotoPromise = page.goto("https://start.test/second", {
      waitUntil: "commit",
      timeout: 10_000,
    });
    await waitForCondition(() => replacementTargetId !== undefined, 5_000);

    const initScriptPromise = page.addInitScript(
      "window.__probe_marker__ = 42;",
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    fake.frameUrlOverride.delete(replacementTargetId);

    await gotoPromise;
    await initScriptPromise;
    await waitForCondition(() => fake.sessions.size === 1, 2_000);

    const replacementSession = [...fake.sessions.entries()].find(
      ([, targetId]) => targetId === replacementTargetId,
    )?.[0];
    const markerOn = (sessionId) =>
      fake.log.filter(
        (request) =>
          request.sessionId === sessionId &&
          request.method === "Page.addScriptToEvaluateOnNewDocument" &&
          String(request.params?.source || "").includes("__probe_marker__"),
      ).length;
    assert.ok(
      markerOn(replacementSession) >= 1,
      "the init script reaches the replacement target",
    );
  } finally {
    await session.close().catch(() => {});
  }
});
