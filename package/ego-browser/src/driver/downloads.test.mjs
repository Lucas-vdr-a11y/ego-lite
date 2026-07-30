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
