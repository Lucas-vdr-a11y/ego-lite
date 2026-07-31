import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  browserCdp,
  invalidateSession,
} from "../../dist/src/browser-runtime.js";
import {
  drainEvents,
  saveScreenshot,
  screenshot,
} from "../../dist/src/driver/observe.js";
import { setOverrides } from "../../dist/src/state.js";
import {
  createTargetContext,
  runWithTarget,
} from "../../dist/src/target-context.js";

function withCdpRuntime(fn) {
  const previous = globalThis.ego;
  const sent = [];
  const runtime = {
    async listTabs() {
      return {
        tabs: [
          {
            targetId: "target-1",
            active: true,
            title: "Example",
            url: "https://example.com/",
          },
          {
            targetId: "target-popup",
            active: false,
            title: "Popup",
            url: "https://example.com/popup",
          },
        ],
      };
    },
    sendCDPMessage(payload) {
      const request = JSON.parse(payload);
      sent.push(request);
      let result = {};
      if (request.method === "Target.attachToTarget") {
        result = {
          sessionId:
            request.params.targetId === "target-popup"
              ? "session-popup"
              : "session-1",
        };
      } else if (request.method === "Page.captureScreenshot") {
        result = { data: Buffer.from("png").toString("base64") };
      } else if (request.method === "Runtime.evaluate") {
        result = { result: { value: "1" } };
      }
      queueMicrotask(() =>
        runtime.onCDPMessage(JSON.stringify({ id: request.id, result })),
      );
    },
    emit(method, params, sessionId = "session-1") {
      runtime.onCDPMessage(JSON.stringify({ sessionId, method, params }));
    },
  };
  globalThis.ego = runtime;
  invalidateSession();
  return Promise.resolve()
    .then(() => fn({ runtime, sent }))
    .finally(() => {
      invalidateSession();
      if (previous === undefined) {
        delete globalThis.ego;
      } else {
        globalThis.ego = previous;
      }
    });
}

test("screenshot skips page metric JavaScript while a native dialog is pending", async () => {
  const writes = [];
  const restore = setOverrides({
    async writeFile(path, data) {
      writes.push({ path, data });
    },
  });
  try {
    await withCdpRuntime(async ({ runtime, sent }) => {
      await browserCdp("Runtime.evaluate", { expression: "document.title" });
      runtime.emit("Page.javascriptDialogOpening", {
        type: "alert",
        message: "Blocked",
        url: "https://example.com/",
      });
      sent.length = 0;

      await screenshot({ path: "/tmp/ego-browser-dialog-shot.png" });

      assert.equal(
        sent.some((request) => request.method === "Runtime.evaluate"),
        false,
      );
      const shot = sent.find(
        (request) => request.method === "Page.captureScreenshot",
      );
      assert.deepEqual(shot.params, {
        format: "png",
        captureBeyondViewport: false,
      });
    });
  } finally {
    restore();
  }

  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, "/tmp/ego-browser-dialog-shot.png");
});

test("target-bound screenshot checks dialogs on the bound Page session", async () => {
  await withCdpRuntime(async ({ runtime, sent }) => {
    const targetContext = createTargetContext("target-popup");
    await runWithTarget(targetContext, () =>
      browserCdp("Runtime.evaluate", { expression: "document.title" }),
    );
    runtime.emit(
      "Page.javascriptDialogOpening",
      {
        type: "alert",
        message: "Popup blocked",
        url: "https://example.com/popup",
      },
      "session-popup",
    );
    sent.length = 0;

    await runWithTarget(targetContext, () => screenshot());

    assert.equal(
      sent.some((request) => request.method === "Runtime.evaluate"),
      false,
    );
    assert.equal(
      sent.find((request) => request.method === "Page.captureScreenshot")
        ?.sessionId,
      "session-popup",
    );
  });
});

test("screenshot creates a missing parent directory", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "ego-browser-observe-"));
  const path = join(tempDir, "nested", "shot.png");
  try {
    const buffer = await withCdpRuntime(() => screenshot({ path, raw: true }));
    assert.ok(Buffer.isBuffer(buffer));
    assert.equal(buffer.toString(), "png");
    assert.equal((await readFile(path)).toString(), "png");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("saveScreenshot keeps the path-oriented ego-browser extension", async () => {
  const firstPath = await withCdpRuntime(() =>
    saveScreenshot({ raw: true, type: "webp" }),
  );
  const secondPath = await withCdpRuntime(() =>
    saveScreenshot({ raw: true, type: "webp" }),
  );
  assert.match(firstPath, /\.webp$/);
  assert.notEqual(firstPath, secondPath);
  assert.equal((await readFile(firstPath)).toString(), "png");
  await rm(firstPath, { force: true });
  await rm(secondPath, { force: true });
});

test("screenshot forwards common CDP format and quality options", async () => {
  await withCdpRuntime(async ({ sent }) => {
    const buffer = await screenshot({
      raw: true,
      type: "jpeg",
      quality: 82,
    });
    assert.ok(Buffer.isBuffer(buffer));
    const capture = sent.find(
      (request) => request.method === "Page.captureScreenshot",
    );
    assert.equal(capture.params.format, "jpeg");
    assert.equal(capture.params.quality, 82);
  });
});

test("viewport screenshot clips from the current scroll position", async () => {
  const calls = [];
  const restore = setOverrides({
    cdpOverride(method, params) {
      calls.push({ method, params });
      if (method === "Runtime.evaluate") {
        if (params.expression === "window.devicePixelRatio") {
          return { result: { value: 2 } };
        }
        return {
          result: {
            value: JSON.stringify({
              url: "https://example.com/scrolled",
              title: "Scrolled",
              w: 800,
              h: 600,
              sx: 17,
              sy: 625,
              pw: 1200,
              ph: 2400,
            }),
          },
        };
      }
      if (method === "Page.captureScreenshot") {
        return { data: Buffer.from("png").toString("base64") };
      }
      return {};
    },
  });
  try {
    await screenshot();
  } finally {
    restore();
  }

  const capture = calls.find(
    (request) => request.method === "Page.captureScreenshot",
  );
  assert.deepEqual(capture.params, {
    format: "png",
    captureBeyondViewport: false,
    clip: {
      x: 17,
      y: 625,
      width: 800,
      height: 600,
      scale: 0.5,
    },
  });
});

test("drainEvents returns the current event array synchronously", () => {
  assert.ok(Array.isArray(drainEvents()));
});
