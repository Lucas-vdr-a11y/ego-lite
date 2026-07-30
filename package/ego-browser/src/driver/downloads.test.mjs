import test from "node:test";
import assert from "node:assert/strict";
import { readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  clearPreferredTarget,
  drainBrowserEvents,
  invalidateSession,
} from "../../dist/src/browser-runtime.js";
import { waitForEvent } from "../../dist/src/driver/downloads.js";

function installAutoEgo(options = {}) {
  const calls = [];
  globalThis.ego = {
    async listTabs() {
      return { tabs: [{ targetId: "tab-1", active: true }] };
    },
    sendCDPMessage(payload) {
      const parsed = JSON.parse(payload);
      calls.push(parsed);
      if (
        options.deferDownloadBehavior &&
        parsed.method === "Browser.setDownloadBehavior"
      ) {
        return;
      }
      setTimeout(() => {
        if (
          options.browserSetDownloadBehaviorError &&
          parsed.method === "Browser.setDownloadBehavior"
        ) {
          globalThis.ego?.onCDPMessage?.(
            JSON.stringify({
              id: parsed.id,
              error: { message: "'Browser.setDownloadBehavior' wasn't found" },
            }),
          );
          return;
        }
        const result =
          parsed.method === "Target.attachToTarget"
            ? { sessionId: `sess-${parsed.id}` }
            : {};
        globalThis.ego?.onCDPMessage?.(
          JSON.stringify({ id: parsed.id, result }),
        );
      }, 0);
    },
  };
  return calls;
}

function fireEvent(method, params = {}, sessionId = "sess-1") {
  globalThis.ego.onCDPMessage(JSON.stringify({ method, params, sessionId }));
}

function cleanup() {
  delete globalThis.ego;
  invalidateSession();
  clearPreferredTarget();
  drainBrowserEvents();
}

test("waitForEvent('download') returns a Playwright-style download facade", async () => {
  const calls = installAutoEgo();
  try {
    const promise = waitForEvent("download", { timeout: 1000 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    fireEvent("Page.downloadWillBegin", {
      guid: "download-1",
      url: "https://example.com/file.png",
      suggestedFilename: "file.png",
    });
    fireEvent("Page.downloadProgress", {
      guid: "download-1",
      state: "completed",
    });
    const download = await promise;
    assert.equal(download.suggestedFilename(), "file.png");
    assert.equal(download.url(), "https://example.com/file.png");
    assert.match(await download.path(), /file\.png$/);
    assert.ok(
      calls.some((call) => call.method === "Browser.setDownloadBehavior"),
      "enables browser download behavior",
    );
  } finally {
    cleanup();
  }
});

test("waitForEvent('download') resolves at start and exposes cancellation through the facade", async () => {
  installAutoEgo();
  try {
    const promise = waitForEvent("download", { timeout: 1000 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    fireEvent("Page.downloadWillBegin", {
      guid: "download-1",
      suggestedFilename: "file.png",
    });
    fireEvent("Page.downloadProgress", {
      guid: "download-1",
      state: "canceled",
    });
    const download = await promise;
    assert.equal(await download.failure(), "Download canceled: file.png");
    await assert.rejects(() => download.path(), /Download canceled: file\.png/);
  } finally {
    cleanup();
  }
});

test("download.path resolves from Chromium's final file when progress is not forwarded", async () => {
  const prefix = `ego-browser-downloads-${process.pid}-`;
  const before = new Set(
    (await readdir(tmpdir())).filter((name) => name.startsWith(prefix)),
  );
  installAutoEgo();
  let downloadDir;
  try {
    const promise = waitForEvent("download", { timeout: 1000 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    fireEvent("Page.downloadWillBegin", {
      guid: "download-without-progress",
      suggestedFilename: "completed.txt",
    });
    const download = await promise;
    const created = (await readdir(tmpdir())).filter(
      (name) => name.startsWith(prefix) && !before.has(name),
    );
    assert.equal(created.length, 1);
    downloadDir = join(tmpdir(), created[0]);
    const finalPath = join(downloadDir, "completed.txt");
    await writeFile(finalPath, "complete");
    assert.equal(await download.path(), finalPath);
    assert.equal(await download.failure(), null);
  } finally {
    cleanup();
    if (downloadDir) await rm(downloadDir, { recursive: true, force: true });
  }
});

test("waitForEvent('download') falls back to Page.setDownloadBehavior", async () => {
  const calls = installAutoEgo({ browserSetDownloadBehaviorError: true });
  try {
    const promise = waitForEvent("download", { timeout: 1000 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    fireEvent("Page.downloadWillBegin", {
      guid: "download-1",
      suggestedFilename: "file.png",
    });
    fireEvent("Page.downloadProgress", {
      guid: "download-1",
      state: "completed",
    });
    await promise;
    assert.ok(
      calls.some((call) => call.method === "Page.setDownloadBehavior"),
      "uses page-level download behavior when browser-level command is missing",
    );
  } finally {
    cleanup();
  }
});

test("waitForEvent('download') treats timeout 0 as no timeout", async () => {
  installAutoEgo();
  try {
    const promise = waitForEvent("download", { timeout: 0 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    fireEvent("Page.downloadWillBegin", {
      guid: "download-no-timeout",
      suggestedFilename: "later.txt",
    });
    fireEvent("Page.downloadProgress", {
      guid: "download-no-timeout",
      state: "completed",
    });
    const download = await promise;
    assert.equal(download.suggestedFilename(), "later.txt");
  } finally {
    cleanup();
  }
});

test("waitForEvent timeout is not delayed by download setup", async () => {
  const calls = installAutoEgo({ deferDownloadBehavior: true });
  try {
    const outcome = waitForEvent("download", { timeout: 20 }).then(
      () => "resolved",
      (error) => error,
    );
    const result = await Promise.race([
      outcome,
      new Promise((resolve) => setTimeout(() => resolve("still-pending"), 80)),
    ]);
    assert.notEqual(result, "still-pending");
    assert.match(result.message, /timed out after 20ms/);

    // Resolve the intentionally deferred transport request so the raw CDP
    // guard does not keep this test process alive.
    const behavior = calls.find(
      (call) => call.method === "Browser.setDownloadBehavior",
    );
    globalThis.ego.onCDPMessage(
      JSON.stringify({ id: behavior.id, result: {} }),
    );
  } finally {
    cleanup();
  }
});
