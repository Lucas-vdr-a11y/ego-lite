import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  clearPreferredTarget,
  drainBrowserEvents,
  ensureSession,
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
      if (options.deferMethod === parsed.method) {
        return;
      }
      setTimeout(() => {
        if (options.errorMethod === parsed.method) {
          globalThis.ego?.onCDPMessage?.(
            JSON.stringify({
              id: parsed.id,
              error: { message: `CDP request timed out: ${parsed.method}` },
            }),
          );
          return;
        }
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
            ? { sessionId: "sess-1" }
            : options.resultByMethod?.[parsed.method] || {};
        globalThis.ego?.onCDPMessage?.(
          JSON.stringify({ id: parsed.id, result }),
        );
      }, options.delayByMethod?.[parsed.method] || 0);
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

async function downloadDirectories() {
  const prefix = `ego-browser-downloads-${process.pid}-`;
  return new Set(
    (await readdir(tmpdir())).filter((name) => name.startsWith(prefix)),
  );
}

test("waitForEvent rejects unsupported events before browser setup", async () => {
  const calls = installAutoEgo();
  try {
    await assert.rejects(
      waitForEvent("websocket", { timeout: 20 }),
      /supports "console".*"requestfailed".*got "websocket"/,
    );
    assert.equal(calls.length, 0);
  } finally {
    cleanup();
  }
});

test("waitForEvent resolves load with the current Page facade", async () => {
  installAutoEgo();
  const currentPage = { marker: "current-page" };
  try {
    const promise = waitForEvent(
      "load",
      { timeout: 1000 },
      { page: currentPage },
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    fireEvent("Page.loadEventFired", { timestamp: 1 });
    assert.equal(await promise, currentPage);
  } finally {
    cleanup();
  }
});

test("waitForEvent resolves domcontentloaded with the current Page facade", async () => {
  installAutoEgo();
  const currentPage = { marker: "current-page" };
  try {
    const promise = waitForEvent(
      "domcontentloaded",
      { timeout: 1000 },
      { page: currentPage },
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    fireEvent("Page.domContentEventFired", { timestamp: 1 });
    assert.equal(await promise, currentPage);
  } finally {
    cleanup();
  }
});

test("waitForEvent resolves close for the current target", async () => {
  installAutoEgo();
  const currentPage = { marker: "current-page" };
  try {
    const promise = waitForEvent(
      "close",
      { timeout: 1000 },
      { page: currentPage },
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    fireEvent("Target.targetDestroyed", { targetId: "tab-other" }, undefined);
    fireEvent("Target.targetDestroyed", { targetId: "tab-1" }, undefined);
    assert.equal(await promise, currentPage);
  } finally {
    cleanup();
  }
});

test("waitForEvent('request') returns the matching Request facade", async () => {
  installAutoEgo();
  try {
    const promise = waitForEvent("request", {
      timeout: 1000,
      predicate: (request) => request.url().endsWith("/wanted"),
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    fireEvent("Network.requestWillBeSent", {
      requestId: "request-event",
      request: {
        url: "https://example.com/wanted",
        method: "POST",
        headers: {},
      },
      type: "Fetch",
    });
    const request = await promise;
    assert.equal(request.method(), "POST");
    fireEvent("Network.loadingFinished", { requestId: "request-event" });
  } finally {
    cleanup();
  }
});

test("waitForEvent('response') preserves the body after Network cleanup", async () => {
  const calls = installAutoEgo({
    resultByMethod: {
      "Network.getResponseBody": {
        body: "response event body",
        base64Encoded: false,
      },
    },
  });
  try {
    const promise = waitForEvent("response", { timeout: 1000 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    fireEvent("Network.requestWillBeSent", {
      requestId: "response-event",
      request: { url: "https://example.com/data", method: "GET", headers: {} },
      type: "Fetch",
    });
    fireEvent("Network.responseReceived", {
      requestId: "response-event",
      type: "Fetch",
      response: {
        url: "https://example.com/data",
        status: 200,
        statusText: "OK",
        headers: {},
      },
    });
    const response = await promise;
    fireEvent("Network.loadingFinished", { requestId: "response-event" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(calls.some((call) => call.method === "Network.disable"));
    assert.equal(await response.text(), "response event body");
  } finally {
    cleanup();
  }
});

test("waitForEvent('requestfinished') returns the completed Request", async () => {
  installAutoEgo();
  try {
    const promise = waitForEvent("requestfinished", { timeout: 1000 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    fireEvent("Network.requestWillBeSent", {
      requestId: "finished-event",
      request: {
        url: "https://example.com/finished",
        method: "GET",
        headers: {},
      },
      type: "Fetch",
    });
    fireEvent("Network.loadingFinished", { requestId: "finished-event" });
    const request = await promise;
    assert.equal(request.url(), "https://example.com/finished");
    assert.equal(request.failure(), null);
  } finally {
    cleanup();
  }
});

test("waitForEvent validates options, predicate, and signal types", async () => {
  const calls = installAutoEgo();
  try {
    await assert.rejects(
      waitForEvent("console", null),
      /options must be an object or predicate function/,
    );
    await assert.rejects(
      waitForEvent("console", { predicate: "yes" }),
      /predicate must be a function/,
    );
    await assert.rejects(
      waitForEvent("console", { signal: {} }),
      /signal must be an AbortSignal/,
    );
    assert.equal(calls.length, 0);
  } finally {
    cleanup();
  }
});

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
    fireEvent("Page.downloadProgress", {
      guid: "download-without-progress",
      state: "inProgress",
    });
    assert.equal(await download.path(), finalPath);
    assert.equal(await download.failure(), null);
    const savedPath = join(downloadDir, "saved", "copy.txt");
    await download.saveAs(savedPath);
    assert.equal(await readFile(savedPath, "utf8"), "complete");
    let streamed = "";
    for await (const chunk of await download.createReadStream()) {
      streamed += chunk.toString("utf8");
    }
    assert.equal(streamed, "complete");
    await download.delete();
    await assert.rejects(access(finalPath), { code: "ENOENT" });
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

test("waitForEvent('download') applies its predicate to each candidate", async () => {
  installAutoEgo();
  try {
    const promise = waitForEvent("download", {
      timeout: 1000,
      predicate: async (download) =>
        download.suggestedFilename() === "wanted.txt",
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    fireEvent("Page.downloadWillBegin", {
      guid: "ignored-download",
      suggestedFilename: "ignored.txt",
    });
    fireEvent("Page.downloadProgress", {
      guid: "ignored-download",
      state: "completed",
    });
    fireEvent("Page.downloadWillBegin", {
      guid: "wanted-download",
      suggestedFilename: "wanted.txt",
    });
    fireEvent("Page.downloadProgress", {
      guid: "wanted-download",
      state: "completed",
    });
    assert.equal((await promise).suggestedFilename(), "wanted.txt");
  } finally {
    cleanup();
  }
});

test("waitForEvent('download') ignores Page events from another session", async () => {
  installAutoEgo();
  try {
    const promise = waitForEvent("download", { timeout: 1000 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    fireEvent(
      "Page.downloadWillBegin",
      {
        guid: "other-download",
        suggestedFilename: "other.txt",
      },
      "sess-other",
    );
    const early = await Promise.race([
      promise.then(() => "resolved"),
      new Promise((resolve) => setTimeout(() => resolve("pending"), 20)),
    ]);
    assert.equal(early, "pending");

    fireEvent("Page.downloadWillBegin", {
      guid: "current-download",
      suggestedFilename: "current.txt",
    });
    fireEvent("Page.downloadProgress", {
      guid: "current-download",
      state: "completed",
    });
    assert.equal((await promise).suggestedFilename(), "current.txt");
  } finally {
    cleanup();
  }
});

test("waitForEvent('download') ignores Browser events from another page frame", async () => {
  const calls = installAutoEgo({
    resultByMethod: {
      "Page.getFrameTree": {
        frameTree: { frame: { id: "frame-current" } },
      },
    },
  });
  try {
    const promise = waitForEvent("download", { timeout: 1000 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    fireEvent(
      "Browser.downloadWillBegin",
      {
        frameId: "frame-other",
        guid: "other-download",
        suggestedFilename: "other.txt",
      },
      undefined,
    );
    const early = await Promise.race([
      promise.then(() => "resolved"),
      new Promise((resolve) => setTimeout(() => resolve("pending"), 20)),
    ]);
    assert.equal(early, "pending");

    fireEvent(
      "Browser.downloadWillBegin",
      {
        frameId: "frame-current",
        guid: "current-download",
        suggestedFilename: "current.txt",
      },
      undefined,
    );
    fireEvent(
      "Browser.downloadProgress",
      {
        guid: "current-download",
        state: "completed",
      },
      undefined,
    );
    assert.equal((await promise).suggestedFilename(), "current.txt");
    assert.equal(
      calls.filter((call) => call.method === "Page.getFrameTree").length,
      1,
      "the current frame id is queried lazily and reused",
    );
  } finally {
    cleanup();
  }
});

test("Browser download events remain usable when frame lookup is unavailable", async () => {
  installAutoEgo({ errorMethod: "Page.getFrameTree" });
  try {
    const promise = waitForEvent("download", { timeout: 1000 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    fireEvent(
      "Browser.downloadWillBegin",
      {
        frameId: "frame-unknown",
        guid: "compatible-download",
        suggestedFilename: "compatible.txt",
      },
      undefined,
    );
    fireEvent(
      "Browser.downloadProgress",
      {
        guid: "compatible-download",
        state: "completed",
      },
      undefined,
    );
    assert.equal((await promise).suggestedFilename(), "compatible.txt");
  } finally {
    cleanup();
  }
});

test("waitForEvent('download') removes its temporary directory on timeout", async () => {
  const before = await downloadDirectories();
  installAutoEgo();
  try {
    await assert.rejects(
      waitForEvent("download", { timeout: 20 }),
      /timed out after 20ms/,
    );
    const after = await downloadDirectories();
    assert.deepEqual(after, before);
  } finally {
    cleanup();
    const after = await downloadDirectories();
    await Promise.all(
      [...after]
        .filter((name) => !before.has(name))
        .map((name) =>
          rm(join(tmpdir(), name), { recursive: true, force: true }),
        ),
    );
  }
});

test("waitForEvent('download') can be aborted after setup", async () => {
  installAutoEgo();
  const controller = new AbortController();
  try {
    const promise = waitForEvent("download", {
      signal: controller.signal,
      timeout: 50,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort(new Error("download wait canceled"));
    await assert.rejects(promise, /download wait canceled/);
  } finally {
    cleanup();
  }
});

test("waitForEvent('download') propagates predicate failures and cleans up", async () => {
  const before = await downloadDirectories();
  installAutoEgo();
  try {
    const promise = waitForEvent("download", {
      timeout: 1000,
      predicate: () => {
        throw new Error("download predicate failed");
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    fireEvent("Page.downloadWillBegin", {
      guid: "predicate-error",
      suggestedFilename: "error.txt",
    });
    await assert.rejects(promise, /download predicate failed/);
    assert.deepEqual(await downloadDirectories(), before);
  } finally {
    cleanup();
    const after = await downloadDirectories();
    await Promise.all(
      [...after]
        .filter((name) => !before.has(name))
        .map((name) =>
          rm(join(tmpdir(), name), { recursive: true, force: true }),
        ),
    );
  }
});

test("download without a guid uses its fallback name and terminal progress", async () => {
  installAutoEgo();
  try {
    const promise = waitForEvent("download", { timeout: 1000 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    fireEvent("Browser.downloadWillBegin", {});
    fireEvent("Browser.downloadProgress", { state: "completed" }, undefined);
    const download = await promise;
    assert.equal(download.suggestedFilename(), "download");
    assert.equal(await download.failure(), null);
    await download.cancel();
  } finally {
    cleanup();
  }
});

test("download.cancel falls back to the page domain", async () => {
  const calls = installAutoEgo({ errorMethod: "Browser.cancelDownload" });
  try {
    const promise = waitForEvent("download", { timeout: 1000 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    fireEvent("Page.downloadWillBegin", {
      guid: "cancel-fallback",
      suggestedFilename: "cancel.txt",
    });
    const download = await promise;
    await download.cancel();
    assert.ok(calls.some((call) => call.method === "Browser.cancelDownload"));
    assert.ok(calls.some((call) => call.method === "Page.cancelDownload"));
    fireEvent("Page.downloadProgress", {
      guid: "cancel-fallback",
      state: "canceled",
    });
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

test("waitForEvent timeout includes delayed session and event setup", async () => {
  installAutoEgo({
    delayByMethod: { "Target.attachToTarget": 30 },
    deferMethod: "Runtime.enable",
  });
  const startedAt = Date.now();
  try {
    const promise = waitForEvent("console", { timeout: 40 });
    await new Promise((resolve) => setTimeout(resolve, 5));
    fireEvent("Runtime.consoleAPICalled", {
      args: [{ type: "string", value: "early" }],
    });
    await assert.rejects(promise, /timed out after 40ms/);
    assert.ok(
      Date.now() - startedAt < 60,
      "the setup does not receive a fresh timeout after session attachment",
    );
  } finally {
    cleanup();
  }
});

test("waitForEvent('popup') returns a switchable popup facade", async () => {
  const calls = installAutoEgo();
  try {
    const promise = waitForEvent("popup", { timeout: 1000 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    fireEvent(
      "Target.targetCreated",
      {
        targetInfo: {
          targetId: "popup-1",
          openerId: "tab-1",
          type: "page",
          title: "Product",
          url: "https://example.com/product",
        },
      },
      undefined,
    );
    const popup = await promise;
    assert.equal(popup.targetId, "popup-1");
    assert.equal(await popup.url(), "https://example.com/product");
    assert.equal(await popup.title(), "Product");
    assert.ok(
      calls.some((call) => call.method === "Target.setDiscoverTargets"),
      "enables target discovery before waiting",
    );
  } finally {
    cleanup();
  }
});

test("waitForEvent('popup') ignores non-pages and other openers", async () => {
  installAutoEgo();
  try {
    const promise = waitForEvent("popup", { timeout: 1000 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    fireEvent(
      "Target.targetCreated",
      {
        targetInfo: {
          targetId: "worker-1",
          openerId: "tab-1",
          type: "worker",
        },
      },
      undefined,
    );
    fireEvent(
      "Target.targetCreated",
      {
        targetInfo: {
          targetId: "other-popup",
          openerId: "tab-other",
          type: "page",
        },
      },
      undefined,
    );
    fireEvent(
      "Target.targetCreated",
      {
        targetInfo: {
          targetId: "current-popup",
          openerId: "tab-1",
          type: "page",
        },
      },
      undefined,
    );
    assert.equal((await promise).targetId, "current-popup");
  } finally {
    cleanup();
  }
});

test("waitForEvent('popup') keeps waiting when its predicate rejects a popup", async () => {
  installAutoEgo();
  try {
    const promise = waitForEvent("popup", {
      timeout: 1000,
      predicate: (popup) => popup.targetId === "wanted-popup",
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    fireEvent(
      "Target.targetCreated",
      {
        targetInfo: {
          targetId: "ignored-popup",
          openerId: "tab-1",
          type: "page",
        },
      },
      undefined,
    );
    fireEvent(
      "Target.targetCreated",
      {
        targetInfo: {
          targetId: "wanted-popup",
          openerId: "tab-1",
          type: "page",
        },
      },
      undefined,
    );
    assert.equal((await promise).targetId, "wanted-popup");
  } finally {
    cleanup();
  }
});

test("waitForEvent('dialog') returns a dialog facade that can accept", async () => {
  const calls = installAutoEgo();
  try {
    const promise = waitForEvent("dialog", { timeout: 1000 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    fireEvent("Page.javascriptDialogOpening", {
      type: "prompt",
      message: "Name?",
      defaultPrompt: "Ada",
    });
    const dialog = await promise;
    assert.equal(dialog.type(), "prompt");
    assert.equal(dialog.message(), "Name?");
    assert.equal(dialog.defaultValue(), "Ada");
    await dialog.accept("Grace");
    assert.ok(
      calls.some(
        (call) =>
          call.method === "Page.handleJavaScriptDialog" &&
          call.sessionId === "sess-1" &&
          call.params.accept === true &&
          call.params.promptText === "Grace",
      ),
    );
  } finally {
    cleanup();
  }
});

test("waitForEvent ignores matching events from another session", async () => {
  installAutoEgo();
  try {
    const promise = waitForEvent("dialog", { timeout: 1000 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    fireEvent(
      "Page.javascriptDialogOpening",
      { type: "alert", message: "Wrong tab" },
      "sess-other",
    );
    const early = await Promise.race([
      promise.then(() => "resolved"),
      new Promise((resolve) => setTimeout(() => resolve("pending"), 20)),
    ]);
    assert.equal(early, "pending");

    fireEvent("Page.javascriptDialogOpening", {
      type: "alert",
      message: "Current tab",
    });
    const dialog = await promise;
    assert.equal(dialog.message(), "Current tab");
  } finally {
    cleanup();
  }
});

test("dialog predicates receive facades and dismiss uses the captured session", async () => {
  const calls = installAutoEgo();
  try {
    const promise = waitForEvent("dialog", {
      timeout: 1000,
      predicate: async (dialog) => dialog.type() === "confirm",
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    fireEvent("Page.javascriptDialogOpening", {
      type: "alert",
      message: "ignore",
    });
    fireEvent("Page.javascriptDialogOpening", {
      type: "confirm",
      message: "continue?",
    });
    const dialog = await promise;
    assert.equal(dialog.message(), "continue?");
    await dialog.dismiss();
    assert.ok(
      calls.some(
        (call) =>
          call.method === "Page.handleJavaScriptDialog" &&
          call.sessionId === "sess-1" &&
          call.params.accept === false,
      ),
    );
  } finally {
    cleanup();
  }
});

test("waitForEvent('filechooser') sets files on the opened input", async () => {
  const calls = installAutoEgo();
  try {
    const promise = waitForEvent("filechooser", { timeout: 1000 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    fireEvent("Page.fileChooserOpened", {
      backendNodeId: 42,
      mode: "selectMultiple",
    });
    const chooser = await promise;
    assert.equal(chooser.isMultiple(), true);
    assert.ok(
      calls.some(
        (call) =>
          call.method === "Page.setInterceptFileChooserDialog" &&
          call.params.enabled === false,
      ),
      "restores native file chooser behavior after interception",
    );
    await chooser.setFiles(["/tmp/first.png", "/tmp/second.png"]);
    assert.ok(
      calls.some(
        (call) =>
          call.method === "DOM.setFileInputFiles" &&
          call.sessionId === "sess-1" &&
          call.params.backendNodeId === 42 &&
          call.params.files.join(",") === "/tmp/first.png,/tmp/second.png",
      ),
    );
  } finally {
    cleanup();
  }
});

test("filechooser interception starts synchronously when a session is cached", async () => {
  const calls = installAutoEgo();
  try {
    await ensureSession();
    const promise = waitForEvent("filechooser", { timeout: 1000 });
    const enabledSynchronously = calls.some(
      (call) =>
        call.method === "Page.setInterceptFileChooserDialog" &&
        call.params.enabled === true,
    );
    fireEvent("Page.fileChooserOpened", {
      backendNodeId: 43,
      mode: "selectSingle",
    });
    assert.equal((await promise).isMultiple(), false);
    assert.ok(
      enabledSynchronously,
      "interception is requested before the caller can click the input",
    );
  } finally {
    cleanup();
  }
});

test("filechooser predicates can skip an opening without dropping interception", async () => {
  const calls = installAutoEgo();
  try {
    const promise = waitForEvent("filechooser", {
      timeout: 1000,
      predicate: (chooser) => chooser.isMultiple(),
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    fireEvent("Page.fileChooserOpened", {
      backendNodeId: 44,
      mode: "selectSingle",
    });
    assert.equal(
      calls.filter(
        (call) =>
          call.method === "Page.setInterceptFileChooserDialog" &&
          call.params.enabled === false,
      ).length,
      0,
    );
    fireEvent("Page.fileChooserOpened", {
      backendNodeId: 45,
      mode: "selectMultiple",
    });
    assert.equal((await promise).isMultiple(), true);
  } finally {
    cleanup();
  }
});

test("waitForEvent('filechooser') restores interception after timeout", async () => {
  const calls = installAutoEgo();
  try {
    await assert.rejects(
      waitForEvent("filechooser", { timeout: 20 }),
      /timed out after 20ms/,
    );
    assert.ok(
      calls.some(
        (call) =>
          call.method === "Page.setInterceptFileChooserDialog" &&
          call.params.enabled === false,
      ),
      "disables interception when no chooser event arrives",
    );
  } finally {
    cleanup();
  }
});

test("concurrent filechooser waits keep interception until the last waiter settles", async () => {
  const calls = installAutoEgo();
  try {
    const first = waitForEvent("filechooser", { timeout: 25 });
    const second = waitForEvent("filechooser", { timeout: 100 });
    await assert.rejects(first, /timed out after 25ms/);
    const disabledWhileSecondWaits = calls.filter(
      (call) =>
        call.method === "Page.setInterceptFileChooserDialog" &&
        call.params.enabled === false,
    ).length;

    fireEvent("Page.fileChooserOpened", {
      backendNodeId: 44,
      mode: "selectSingle",
    });
    assert.equal((await second).isMultiple(), false);
    assert.equal(
      disabledWhileSecondWaits,
      0,
      "one timeout must not disable interception for another waiter",
    );
    assert.equal(
      calls.filter(
        (call) =>
          call.method === "Page.setInterceptFileChooserDialog" &&
          call.params.enabled === false,
      ).length,
      1,
      "the last waiter restores interception exactly once",
    );
  } finally {
    cleanup();
  }
});

test("filechooser validates payloads and accepts a single path", async () => {
  const calls = installAutoEgo();
  try {
    const promise = waitForEvent("filechooser", { timeout: 1000 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    fireEvent("Page.fileChooserOpened", {
      backendNodeId: 45,
      mode: "selectSingle",
    });
    const chooser = await promise;
    await assert.rejects(
      chooser.setFiles(["/tmp/valid.txt", { name: "invalid" }]),
      /expects file paths/,
    );
    await chooser.setFiles("/tmp/only.txt");
    assert.ok(
      calls.some(
        (call) =>
          call.method === "DOM.setFileInputFiles" &&
          call.params.files.length === 1 &&
          call.params.files[0] === "/tmp/only.txt",
      ),
    );
  } finally {
    cleanup();
  }
});

test("aborting a filechooser wait restores interception", async () => {
  const calls = installAutoEgo();
  const controller = new AbortController();
  try {
    const promise = waitForEvent("filechooser", {
      signal: controller.signal,
      timeout: 1000,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();
    await assert.rejects(promise, /aborted/);
    assert.ok(
      calls.some(
        (call) =>
          call.method === "Page.setInterceptFileChooserDialog" &&
          call.params.enabled === false,
      ),
    );
  } finally {
    cleanup();
  }
});

test("aborting during filechooser setup disables interception after setup completes", async () => {
  const calls = installAutoEgo({
    deferMethod: "Page.setInterceptFileChooserDialog",
  });
  const controller = new AbortController();
  try {
    await ensureSession();
    const promise = waitForEvent("filechooser", {
      signal: controller.signal,
      timeout: 1000,
    });
    const enable = calls.find(
      (call) =>
        call.method === "Page.setInterceptFileChooserDialog" &&
        call.params.enabled === true,
    );
    assert.ok(enable, "interception setup starts immediately");
    controller.abort(new Error("stop chooser setup"));
    await assert.rejects(promise, /stop chooser setup/);

    globalThis.ego.onCDPMessage(JSON.stringify({ id: enable.id, result: {} }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const disable = calls.find(
      (call) =>
        call.method === "Page.setInterceptFileChooserDialog" &&
        call.params.enabled === false,
    );
    assert.ok(disable, "late setup completion is followed by cleanup");
    globalThis.ego.onCDPMessage(JSON.stringify({ id: disable.id, result: {} }));
  } finally {
    cleanup();
  }
});

test("waitForEvent maps event-domain setup timeouts to TimeoutError", async () => {
  installAutoEgo({ errorMethod: "Runtime.enable" });
  try {
    await assert.rejects(
      waitForEvent("pageerror", { timeout: 20 }),
      (error) =>
        error?.name === "TimeoutError" &&
        /page\.waitForEvent\("pageerror"\) timed out after 20ms/.test(
          error.message,
        ),
    );
  } finally {
    cleanup();
  }
});

test("waitForEvent('pageerror') returns an Error from Runtime.exceptionThrown", async () => {
  installAutoEgo();
  try {
    const promise = waitForEvent("pageerror", { timeout: 1000 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    fireEvent("Runtime.exceptionThrown", {
      exceptionDetails: {
        text: "Uncaught",
        exception: {
          className: "TypeError",
          description: "TypeError: broken page\n    at app.js:4:2",
        },
      },
    });
    const error = await promise;
    assert.ok(error instanceof Error);
    assert.equal(error.name, "TypeError");
    assert.equal(error.message, "broken page");
    assert.match(error.stack, /app\.js:4:2/);
  } finally {
    cleanup();
  }
});

test("waitForEvent('pageerror') converts thrown primitive values", async () => {
  installAutoEgo();
  try {
    const promise = waitForEvent("pageerror", { timeout: 1000 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    fireEvent("Runtime.exceptionThrown", {
      exceptionDetails: {
        text: "Uncaught",
        exception: { type: "string", value: "primitive failure" },
      },
    });
    const error = await promise;
    assert.equal(error.name, "Error");
    assert.equal(error.message, "primitive failure");
    assert.equal(error.stack, "primitive failure");
  } finally {
    cleanup();
  }
});

test("waitForEvent('console') returns a ConsoleMessage facade", async () => {
  installAutoEgo();
  try {
    const promise = waitForEvent("console", { timeout: 1000 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    fireEvent("Runtime.consoleAPICalled", {
      type: "warning",
      args: [
        { type: "string", value: "stock" },
        { type: "number", value: 4 },
      ],
      stackTrace: {
        callFrames: [
          {
            url: "https://example.com/app.js",
            lineNumber: 9,
            columnNumber: 3,
          },
        ],
      },
    });
    const message = await promise;
    assert.equal(message.type(), "warning");
    assert.equal(message.text(), "stock 4");
    assert.deepEqual(message.location(), {
      url: "https://example.com/app.js",
      lineNumber: 9,
      columnNumber: 3,
    });
    assert.deepEqual(
      await Promise.all(message.args().map((handle) => handle.jsonValue())),
      ["stock", 4],
    );
  } finally {
    cleanup();
  }
});

test("waitForEvent accepts a predicate function and skips earlier events", async () => {
  installAutoEgo();
  try {
    const promise = waitForEvent(
      "console",
      (message) => message.text() === "wanted",
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    fireEvent("Runtime.consoleAPICalled", {
      type: "log",
      args: [{ type: "string", value: "noise" }],
    });
    fireEvent("Runtime.consoleAPICalled", {
      type: "log",
      args: [{ type: "string", value: "wanted" }],
    });
    assert.equal((await promise).text(), "wanted");
  } finally {
    cleanup();
  }
});

test("console messages serialize special values and default their location", async () => {
  installAutoEgo();
  try {
    const promise = waitForEvent("console", { timeout: 1000 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    fireEvent("Runtime.consoleAPICalled", {
      args: [
        { type: "undefined" },
        { type: "object", subtype: "null", value: null },
        { type: "bigint", unserializableValue: "12n" },
        { type: "object", description: "Object" },
      ],
    });
    const message = await promise;
    assert.equal(message.type(), "log");
    assert.equal(message.text(), "undefined null 12n Object");
    assert.deepEqual(message.location(), {
      url: "",
      lineNumber: 0,
      columnNumber: 0,
    });
  } finally {
    cleanup();
  }
});

test("concurrent event predicates resolve independently in event order", async () => {
  installAutoEgo();
  try {
    const first = waitForEvent("console", {
      timeout: 1000,
      predicate: async (message) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return message.text() === "first";
      },
    });
    const second = waitForEvent(
      "console",
      (message) => message.text() === "second",
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    fireEvent("Runtime.consoleAPICalled", {
      args: [{ type: "string", value: "first" }],
    });
    fireEvent("Runtime.consoleAPICalled", {
      args: [{ type: "string", value: "second" }],
    });
    assert.equal((await first).text(), "first");
    assert.equal((await second).text(), "second");
  } finally {
    cleanup();
  }
});

test("waitForEvent rejects immediately when its signal is already aborted", async () => {
  const calls = installAutoEgo();
  const controller = new AbortController();
  controller.abort(new Error("stop waiting"));
  try {
    await assert.rejects(
      waitForEvent("console", {
        signal: controller.signal,
        timeout: 20,
      }),
      /stop waiting/,
    );
    assert.equal(calls.length, 0, "does not attach or enable domains");
  } finally {
    cleanup();
  }
});

test("waitForEvent aborts while an asynchronous predicate is still pending", async () => {
  installAutoEgo();
  const controller = new AbortController();
  try {
    const promise = waitForEvent("console", {
      signal: controller.signal,
      timeout: 1000,
      predicate: async () => new Promise(() => {}),
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    fireEvent("Runtime.consoleAPICalled", {
      args: [{ type: "string", value: "blocked predicate" }],
    });
    controller.abort(new Error("cancel pending predicate"));
    await assert.rejects(promise, /cancel pending predicate/);
  } finally {
    cleanup();
  }
});

test("waitForEvent uses the Playwright-style error when the page closes", async () => {
  installAutoEgo();
  try {
    const promise = waitForEvent("console", { timeout: 100 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    fireEvent("Target.targetDestroyed", { targetId: "tab-1" }, undefined);
    await assert.rejects(
      promise,
      /Target page, context or browser has been closed/,
    );
  } finally {
    cleanup();
  }
});

test("waitForEvent ignores another page closing but rejects a current-page crash", async () => {
  installAutoEgo();
  try {
    const promise = waitForEvent("console", { timeout: 1000 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    fireEvent("Target.targetDestroyed", { targetId: "tab-other" }, undefined);
    fireEvent("Inspector.targetCrashed", {}, "sess-1");
    await assert.rejects(promise, /page crashed/i);
  } finally {
    cleanup();
  }
});

test("waitForEvent ignores a foreign detach and rejects when its own session detaches", async () => {
  installAutoEgo();
  try {
    const promise = waitForEvent("console", { timeout: 1000 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    fireEvent(
      "Target.detachedFromTarget",
      { sessionId: "sess-other", targetId: "tab-other" },
      undefined,
    );
    fireEvent(
      "Target.detachedFromTarget",
      { sessionId: "sess-1", targetId: "tab-1" },
      undefined,
    );
    await assert.rejects(
      promise,
      /Target page, context or browser has been closed/,
    );
  } finally {
    cleanup();
  }
});

test("waitForEvent('requestfailed') returns the failed Request facade", async () => {
  installAutoEgo();
  try {
    const promise = waitForEvent("requestfailed", { timeout: 1000 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    fireEvent("Network.requestWillBeSent", {
      requestId: "request-1",
      request: {
        url: "https://example.com/api/products",
        method: "GET",
        headers: { Accept: "application/json" },
      },
      type: "Fetch",
    });
    fireEvent("Network.loadingFailed", {
      requestId: "request-1",
      errorText: "net::ERR_CONNECTION_RESET",
    });
    const request = await promise;
    assert.equal(request.url(), "https://example.com/api/products");
    assert.equal(request.method(), "GET");
    assert.deepEqual(request.failure(), {
      errorText: "net::ERR_CONNECTION_RESET",
    });
  } finally {
    cleanup();
  }
});

test("requestfailed enables Network synchronously when a session is cached", async () => {
  const calls = installAutoEgo();
  try {
    await ensureSession();
    const promise = waitForEvent("requestfailed", { timeout: 1000 });
    const enabledSynchronously = calls.some(
      (call) => call.method === "Network.enable",
    );
    fireEvent("Network.requestWillBeSent", {
      requestId: "immediate",
      request: {
        url: "https://example.com/immediate",
        method: "GET",
      },
      type: "Fetch",
    });
    fireEvent("Network.loadingFailed", {
      requestId: "immediate",
      errorText: "net::ERR_FAILED",
    });
    assert.equal((await promise).url(), "https://example.com/immediate");
    assert.ok(
      enabledSynchronously,
      "Network.enable is sent before the caller can trigger the request",
    );
  } finally {
    cleanup();
  }
});

test("requestfailed supports async predicates and skips orphan failures", async () => {
  installAutoEgo();
  try {
    const promise = waitForEvent("requestfailed", {
      timeout: 1000,
      predicate: async (request) => request.url().endsWith("/wanted"),
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    fireEvent("Network.loadingFailed", {
      requestId: "orphan",
      errorText: "net::ERR_FAILED",
    });
    fireEvent("Network.requestWillBeSent", {
      requestId: "ignored",
      request: { url: "https://example.com/ignored", method: "GET" },
      type: "Fetch",
    });
    fireEvent("Network.loadingFailed", {
      requestId: "ignored",
      errorText: "net::ERR_ABORTED",
    });
    fireEvent("Network.requestWillBeSent", {
      requestId: "wanted",
      request: { url: "https://example.com/wanted", method: "POST" },
      type: "Fetch",
    });
    fireEvent("Network.loadingFailed", {
      requestId: "wanted",
      errorText: "net::ERR_CONNECTION_RESET",
    });
    const request = await promise;
    assert.equal(request.url(), "https://example.com/wanted");
    assert.equal(request.method(), "POST");
  } finally {
    cleanup();
  }
});

test("requestfailed ignores failures from another page session", async () => {
  installAutoEgo();
  try {
    const promise = waitForEvent("requestfailed", { timeout: 1000 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    fireEvent(
      "Network.requestWillBeSent",
      {
        requestId: "foreign",
        request: { url: "https://example.com/foreign", method: "GET" },
        type: "Fetch",
      },
      "sess-other",
    );
    fireEvent(
      "Network.loadingFailed",
      {
        requestId: "foreign",
        errorText: "net::ERR_FAILED",
      },
      "sess-other",
    );
    fireEvent("Network.requestWillBeSent", {
      requestId: "current",
      request: { url: "https://example.com/current", method: "GET" },
      type: "Fetch",
    });
    fireEvent("Network.loadingFailed", {
      requestId: "current",
      errorText: "net::ERR_FAILED",
    });
    assert.equal((await promise).url(), "https://example.com/current");
  } finally {
    cleanup();
  }
});

test("requestfailed propagates predicate errors and releases its Network lease", async () => {
  const calls = installAutoEgo();
  try {
    const promise = waitForEvent("requestfailed", {
      timeout: 1000,
      predicate: () => {
        throw new Error("request predicate failed");
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    fireEvent("Network.requestWillBeSent", {
      requestId: "predicate-error",
      request: { url: "https://example.com/error", method: "GET" },
      type: "Fetch",
    });
    fireEvent("Network.loadingFailed", {
      requestId: "predicate-error",
      errorText: "net::ERR_FAILED",
    });
    await assert.rejects(promise, /request predicate failed/);
    assert.ok(
      calls.some((call) => call.method === "Network.disable"),
      "the failed wait releases the Network domain",
    );
  } finally {
    cleanup();
  }
});
