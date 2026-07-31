import test from "node:test";
import assert from "node:assert/strict";

import {
  clearPreferredTarget,
  drainBrowserEvents,
  invalidateSession,
} from "../../dist/src/browser-runtime.js";
import { goto, reload } from "../../dist/src/driver/nav.js";
import { setOverrides } from "../../dist/src/state.js";
import { runWithTarget } from "../../dist/src/target-context.js";

function installNavigationEgo(options = {}) {
  let sessionId = "session-1";
  const calls = [];
  globalThis.ego = {
    async listTabs() {
      return {
        tabs: [
          {
            targetId: "tab-1",
            active: true,
            url: options.currentUrl || "https://example.test/start",
          },
          ...(options.targetTab
            ? [
                {
                  targetId: options.targetTab.targetId,
                  active: false,
                  url: options.targetTab.url,
                },
              ]
            : []),
        ],
      };
    },
    sendCDPMessage(payload) {
      const call = JSON.parse(payload);
      calls.push(call);
      setTimeout(() => {
        if (call.method === "Target.attachToTarget") {
          sessionId = "session-1";
          respond(call, { sessionId });
          return;
        }
        if (call.method === "Page.navigate") {
          const finishNavigationCommand = () => {
            respond(
              call,
              options.navigateResult || {
                frameId: "frame-1",
                loaderId: "loader-1",
              },
            );
            if (
              options.emitNetwork === false ||
              options.navigateResult?.errorText
            ) {
              return;
            }
            emit("Network.requestWillBeSent", {
              requestId: "request-1",
              frameId: "frame-1",
              loaderId: "loader-1",
              type: "Document",
              request: {
                url: call.params.url,
                method: "GET",
                headers: {},
              },
            });
            emit("Network.responseReceived", {
              requestId: "request-1",
              frameId: "frame-1",
              loaderId: "loader-1",
              type: "Document",
              response: {
                url: call.params.url,
                status: 200,
                statusText: "OK",
                headers: { "content-type": "text/html" },
              },
            });
            if (!options.deferCompletion) {
              emit("Network.loadingFinished", { requestId: "request-1" });
            }
          };
          if (options.navigateCommandDelayMs) {
            setTimeout(finishNavigationCommand, options.navigateCommandDelayMs);
          } else {
            finishNavigationCommand();
          }
          return;
        }
        if (call.method === "Page.reload") {
          respond(call, {});
          if (options.emitReloadNetwork === false) return;
          const emitReloadNetwork = () => {
            if (options.emitSubframeBeforeReload) {
              emit("Network.requestWillBeSent", {
                requestId: "subframe-request",
                frameId: "frame-child",
                loaderId: "loader-child",
                type: "Document",
                request: {
                  url: "https://example.test/iframe",
                  method: "GET",
                  headers: {},
                },
              });
              emit("Network.responseReceived", {
                requestId: "subframe-request",
                frameId: "frame-child",
                loaderId: "loader-child",
                type: "Document",
                response: {
                  url: "https://example.test/iframe",
                  status: 418,
                  statusText: "I'm a teapot",
                  headers: {},
                },
              });
            }
            emit("Network.requestWillBeSent", {
              requestId: "request-2",
              frameId: "frame-1",
              loaderId: "loader-2",
              type: "Document",
              request: {
                url: "https://example.test/reloaded",
                method: "GET",
                headers: {},
              },
            });
            emit("Network.responseReceived", {
              requestId: "request-2",
              frameId: "frame-1",
              loaderId: "loader-2",
              type: "Document",
              response: {
                url: "https://example.test/reloaded",
                status: 204,
                statusText: "No Content",
                headers: {},
              },
            });
            if (!options.deferCompletion) {
              emit("Network.loadingFinished", { requestId: "request-2" });
            }
          };
          if (options.reloadNetworkDelayMs) {
            setTimeout(emitReloadNetwork, options.reloadNetworkDelayMs);
          } else {
            emitReloadNetwork();
          }
          return;
        }
        if (call.method === "Page.getFrameTree") {
          respond(call, {
            frameTree: {
              frame: { id: "frame-1", url: "https://example.test/ready" },
            },
          });
          return;
        }
        if (call.method === "Runtime.evaluate") {
          respond(call, {
            result: {
              type: "string",
              value: call.params.expression.includes("location.href")
                ? options.targetPageUrl || options.currentUrl
                : "complete",
            },
          });
          return;
        }
        respond(call, {});
      }, 0);
    },
  };

  function respond(call, result) {
    globalThis.ego?.onCDPMessage?.(JSON.stringify({ id: call.id, result }));
  }

  function emit(method, params) {
    globalThis.ego?.onCDPMessage?.(
      JSON.stringify({ method, params, sessionId }),
    );
  }
  return { calls, emit };
}

function cleanup() {
  delete globalThis.ego;
  invalidateSession();
  clearPreferredTarget();
  drainBrowserEvents();
}

test("goto returns the correlated main-document response facade", async () => {
  installNavigationEgo();
  try {
    const response = await goto("https://example.test/target", {
      timeout: 1000,
    });
    assert.equal(response.url(), "https://example.test/target");
    assert.equal(response.status(), 200);
    assert.equal(response.request().isNavigationRequest(), true);
    assert.equal(await response.headerValue("content-type"), "text/html");
  } finally {
    cleanup();
  }
});

test("goto commit response stays subscribed until loading finishes", async () => {
  const { calls, emit } = installNavigationEgo({ deferCompletion: true });
  try {
    const response = await goto("https://example.test/streaming", {
      timeout: 1000,
      waitUntil: "commit",
    });
    assert.equal(
      calls.filter((call) => call.method === "Network.disable").length,
      0,
      "commit preserves the Network lease for Response.finished",
    );
    const finished = response.finished();
    emit("Network.loadingFinished", { requestId: "request-1" });
    assert.equal(await finished, null);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(
      calls.filter((call) => call.method === "Network.disable").length,
      1,
    );
  } finally {
    cleanup();
  }
});

test("reload correlates the next document loader and returns its response", async () => {
  installNavigationEgo();
  try {
    const response = await reload({ timeout: 1000 });
    assert.equal(response.url(), "https://example.test/reloaded");
    assert.equal(response.status(), 204);
  } finally {
    cleanup();
  }
});

test("reload waits when the command response arrives before Network events", async () => {
  installNavigationEgo({ reloadNetworkDelayMs: 20 });
  try {
    const response = await reload({ timeout: 1000 });
    assert.equal(response.url(), "https://example.test/reloaded");
    assert.equal(response.status(), 204);
  } finally {
    cleanup();
  }
});

test("reload ignores a subframe document response before the main frame", async () => {
  installNavigationEgo({ emitSubframeBeforeReload: true });
  try {
    const response = await reload({ timeout: 1000 });
    assert.equal(response.url(), "https://example.test/reloaded");
    assert.equal(response.status(), 204);
  } finally {
    cleanup();
  }
});

test("reload returns null for a page without a network response", async () => {
  installNavigationEgo({
    currentUrl: "about:blank",
    emitReloadNetwork: false,
  });
  try {
    const response = await reload({ timeout: 100 });
    assert.equal(response, null);
  } finally {
    cleanup();
  }
});

test("target-bound reload uses the bound page URL instead of the active tab URL", async () => {
  installNavigationEgo({
    currentUrl: "about:blank",
    targetTab: {
      targetId: "tab-popup",
      url: "https://example.test/popup",
    },
    targetPageUrl: "https://example.test/popup",
  });
  try {
    const response = await runWithTarget("tab-popup", () =>
      reload({ timeout: 1000 }),
    );
    assert.equal(response.url(), "https://example.test/reloaded");
    assert.equal(response.status(), 204);
  } finally {
    cleanup();
  }
});

test("goto timeout also bounds the Page.navigate command", async () => {
  installNavigationEgo({
    navigateCommandDelayMs: 150,
    emitNetwork: false,
  });
  try {
    const outcome = await Promise.race([
      goto("https://example.test/slow-command", {
        timeout: 30,
        waitUntil: "commit",
      }).then(
        () => "resolved",
        (error) => error.name,
      ),
      new Promise((resolve) => setTimeout(() => resolve("still-pending"), 100)),
    ]);
    // Let the delayed fake response clear any implementation-level CDP timer
    // before the harness is removed.
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(outcome, "TimeoutError");
  } finally {
    cleanup();
  }
});

test("goto throws navigation errors returned by Page.navigate", async () => {
  installNavigationEgo({
    navigateResult: {
      frameId: "frame-1",
      errorText: "net::ERR_NAME_NOT_RESOLVED",
    },
  });
  try {
    await assert.rejects(
      () => goto("https://missing.invalid", { timeout: 1000 }),
      /Navigation failed: net::ERR_NAME_NOT_RESOLVED/,
    );
  } finally {
    cleanup();
  }
});

test("goto rejects an unsupported waitUntil value instead of treating it as load", async () => {
  const { calls } = installNavigationEgo();
  try {
    await assert.rejects(
      () =>
        goto("https://example.test/target", {
          timeout: 1000,
          waitUntil: "ready",
        }),
      /page\.goto waitUntil must be one of/,
    );
    assert.equal(
      calls.some((call) => call.method === "Page.navigate"),
      false,
      "invalid options are rejected before navigation starts",
    );
  } finally {
    cleanup();
  }
});

test("goto does not swallow a task-space hard stop during frame discovery", async () => {
  installNavigationEgo();
  const hardStop = Object.assign(new Error("user controls the task space"), {
    error_code: "EGO_TASK_SPACE_USER_IN_CONTROL",
  });
  const restore = setOverrides({
    cdpOverride(method) {
      if (method === "Page.getFrameTree") throw hardStop;
      return {};
    },
  });
  try {
    await assert.rejects(
      () =>
        goto("https://example.test/target", {
          timeout: 20,
          waitUntil: "commit",
        }),
      (error) => error === hardStop,
    );
  } finally {
    restore();
    cleanup();
  }
});

test("goto throws TimeoutError when no document response arrives", async () => {
  installNavigationEgo({ emitNetwork: false });
  try {
    await assert.rejects(
      () => goto("https://example.test/timeout", { timeout: 30 }),
      (error) => {
        assert.equal(error.name, "TimeoutError");
        assert.match(error.message, /page\.goto timed out after 30ms/);
        return true;
      },
    );
  } finally {
    cleanup();
  }
});
