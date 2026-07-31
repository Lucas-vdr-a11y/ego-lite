import test from "node:test";
import assert from "node:assert/strict";

import { setOverrides, state } from "../../dist/src/state.js";
import { cdp } from "../../dist/src/cdp-eval.js";
import {
  clearPreferredTarget,
  drainBrowserEvents,
  invalidateSession,
} from "../../dist/src/browser-runtime.js";
import {
  waitForFunction,
  waitForLoadState,
  waitForRequest,
  waitForResponse,
  waitForSelector,
  waitForURL,
} from "../../dist/src/driver/waits.js";

function installAutoEgo(resultFor = () => ({})) {
  const calls = [];
  globalThis.ego = {
    async listTabs() {
      return { tabs: [{ targetId: "tab-1", active: true }] };
    },
    sendCDPMessage(payload) {
      const parsed = JSON.parse(payload);
      calls.push(parsed);
      setTimeout(() => {
        if (!globalThis.ego?.onCDPMessage) return;
        const outcome =
          parsed.method === "Target.attachToTarget"
            ? { sessionId: `auto-sess-${parsed.id}` }
            : resultFor(parsed);
        const message =
          outcome && Object.prototype.hasOwnProperty.call(outcome, "error")
            ? { id: parsed.id, error: outcome.error }
            : { id: parsed.id, result: outcome || {} };
        globalThis.ego.onCDPMessage(JSON.stringify(message));
      }, 0);
    },
  };
  return calls;
}

function fireEvent(method, params = {}, sessionId = undefined) {
  globalThis.ego.onCDPMessage(
    JSON.stringify({
      method,
      params,
      ...(sessionId ? { sessionId } : {}),
    }),
  );
}

function cleanupBrowserRuntime() {
  delete globalThis.ego;
  invalidateSession();
  clearPreferredTarget();
  drainBrowserEvents();
  state.networkDomainEnabled = false;
}

test("waitForFunction polls until a page function returns a truthy value", async () => {
  let t = 0;
  const values = [false, "ready"];
  const sleeps = [];
  const expressions = [];
  const restore = setOverrides({
    cdpOverride: async (method, params) => {
      assert.equal(method, "Runtime.evaluate");
      expressions.push(params.expression);
      return { result: { value: values.shift() } };
    },
    now: () => t,
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
  });
  try {
    const result = await waitForFunction(
      (expected) => window.status === expected,
      "done",
      { timeout: 500, polling: 50 },
    );
    assert.equal(await result.jsonValue(), "ready");
    await result.dispose();
  } finally {
    restore();
  }
  assert.deepEqual(sleeps, [50]);
  assert.match(expressions[0], /window\.status === expected/);
  assert.match(expressions[0], /\("done"\)$/);
});

test("waitForURL supports Playwright-style glob strings", async () => {
  let t = 0;
  const urls = ["https://example.com/start", "https://example.com/path/target"];
  const sleeps = [];
  const restore = setOverrides({
    cdpOverride: async (method, params) => {
      assert.equal(method, "Runtime.evaluate");
      assert.equal(params.expression, "location.href");
      return { result: { value: urls.shift() || urls.at(-1) } };
    },
    now: () => t,
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
  });
  try {
    assert.equal(
      await waitForURL("**/target", {
        timeout: 500,
        waitUntil: "commit",
      }),
      undefined,
    );
  } finally {
    restore();
  }
  assert.deepEqual(sleeps, [100]);
});

test("waitForURL resets stateful regular expressions between polls", async () => {
  let current = "https://example.com/pending";
  let now = 0;
  const matcher = /example\.com\/ready/g;
  matcher.lastIndex = matcher.source.length;
  const restore = setOverrides({
    now: () => now,
    sleep: async (ms) => {
      now += ms;
      current = "https://example.com/ready";
    },
    cdpOverride(method) {
      if (method === "Runtime.evaluate") {
        return { result: { value: current } };
      }
      return {};
    },
  });
  try {
    await waitForURL(matcher, { timeout: 1000, waitUntil: "commit" });
  } finally {
    restore();
  }
});

test("waitForURL predicates receive URL objects and wait for load by default", async () => {
  const calls = [];
  let observedUrl;
  const restore = setOverrides({
    cdpOverride: async (method, params) => {
      calls.push({ method, params });
      if (method === "Page.getFrameTree") {
        return {
          frameTree: {
            frame: { url: "https://example.com/target" },
          },
        };
      }
      if (method === "Runtime.evaluate") {
        if (params.expression === "location.href") {
          return {
            result: { value: "https://example.com/target" },
          };
        }
        if (params.expression === "document.readyState") {
          return { result: { value: "complete" } };
        }
      }
      throw new Error(`unexpected CDP call: ${method}`);
    },
  });
  try {
    assert.equal(
      await waitForURL((url) => {
        observedUrl = url;
        return url.pathname === "/target";
      }),
      undefined,
    );
  } finally {
    restore();
  }

  assert(observedUrl instanceof URL);
  assert.equal(observedUrl.href, "https://example.com/target");
  assert.ok(
    calls.some(
      ({ method, params }) =>
        method === "Runtime.evaluate" &&
        params.expression === "document.readyState",
    ),
    "default waitForURL waits for the load state after the URL matches",
  );
});

test("waitForURL waitUntil commit returns without waiting for load", async () => {
  const calls = [];
  const restore = setOverrides({
    cdpOverride: async (method, params) => {
      calls.push({ method, params });
      return { result: { value: "https://example.com/target" } };
    },
  });
  try {
    assert.equal(
      await waitForURL("https://example.com/target", {
        waitUntil: "commit",
      }),
      undefined,
    );
  } finally {
    restore();
  }

  assert.equal(
    calls.some(({ method }) => method === "Page.getFrameTree"),
    false,
  );
});

test("waitForURL resolves a matched about:blank without waiting for load", async () => {
  const calls = [];
  const restore = setOverrides({
    cdpOverride: async (method, params) => {
      calls.push({ method, params });
      return { result: { value: "about:blank" } };
    },
  });
  try {
    assert.equal(await waitForURL("about:blank"), undefined);
  } finally {
    restore();
  }

  assert.equal(
    calls.some(({ method }) => method === "Page.getFrameTree"),
    false,
  );
});

test("waitForURL preserves networkidle for a matched about:blank", async () => {
  const methods = [];
  let t = 0;
  const restore = setOverrides({
    cdpOverride: async (method, params) => {
      methods.push(method);
      if (
        method === "Runtime.evaluate" &&
        params.expression === "location.href"
      ) {
        return { result: { value: "about:blank" } };
      }
      return {};
    },
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
  });
  try {
    assert.equal(
      await waitForURL("about:blank", {
        timeout: 5000,
        waitUntil: "networkidle",
      }),
      undefined,
    );
  } finally {
    restore();
  }

  assert.ok(methods.includes("Network.enable"));
  assert.ok(methods.includes("Network.disable"));
  assert.ok(t >= 500, "networkidle observes its default idle window");
});

test("waitForRequest matches exact URL and returns a request facade", async () => {
  const calls = installAutoEgo();
  try {
    const promise = waitForRequest("https://example.com/api/search", {
      timeout: 1000,
    });
    setTimeout(() => {
      fireEvent("Network.requestWillBeSent", {
        requestId: "req-1",
        type: "XHR",
        request: {
          url: "https://example.com/api/search",
          method: "POST",
          headers: { "Content-Type": "application/json" },
          postData: '{"q":"test"}',
        },
      });
      fireEvent("Network.loadingFinished", { requestId: "req-1" });
    }, 20);
    const request = await promise;
    assert.equal(request.url(), "https://example.com/api/search");
    assert.equal(request.method(), "POST");
    assert.equal(request.headers()["content-type"], "application/json");
    assert.deepEqual(await request.allHeaders(), {
      "content-type": "application/json",
    });
    assert.equal(await request.headerValue("Content-Type"), "application/json");
    assert.equal(request.postData(), '{"q":"test"}');
    assert.equal(request.postDataBuffer().toString(), '{"q":"test"}');
    assert.deepEqual(request.postDataJSON(), { q: "test" });
    assert.equal(request.resourceType(), "xhr");
    assert.equal(request.isNavigationRequest(), false);
    assert.equal(request.redirectedFrom(), null);
    assert.equal(request.redirectedTo(), null);
    assert.equal(request.failure(), null);
  } finally {
    cleanupBrowserRuntime();
  }
  assert.ok(calls.some((call) => call.method === "Network.enable"));
  assert.ok(calls.some((call) => call.method === "Network.disable"));
});

test("waitForRequest keeps redirect and failure state live after matching", async () => {
  const calls = installAutoEgo();
  try {
    const promise = waitForRequest("https://example.com/start", {
      timeout: 1000,
    });
    setTimeout(() => {
      fireEvent("Network.requestWillBeSent", {
        requestId: "req-live",
        type: "Document",
        request: {
          url: "https://example.com/start",
          method: "GET",
          headers: {},
        },
      });
    }, 20);
    const request = await promise;
    assert.equal(request.redirectedTo(), null);
    assert.equal(
      calls.filter((call) => call.method === "Network.disable").length,
      0,
      "the Network lease remains active while the request is in flight",
    );

    fireEvent("Network.requestWillBeSent", {
      requestId: "req-live",
      type: "Document",
      redirectResponse: {
        url: "https://example.com/start",
        status: 302,
        headers: { location: "/final" },
      },
      request: {
        url: "https://example.com/final",
        method: "GET",
        headers: {},
      },
    });
    const redirected = request.redirectedTo();
    assert.equal(redirected.url(), "https://example.com/final");

    fireEvent("Network.loadingFailed", {
      requestId: "req-live",
      errorText: "net::ERR_CONNECTION_RESET",
    });
    assert.deepEqual(redirected.failure(), {
      errorText: "net::ERR_CONNECTION_RESET",
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(
      calls.filter((call) => call.method === "Network.disable").length,
      1,
    );
  } finally {
    cleanupBrowserRuntime();
  }
});

test("waitForResponse matches regex and exposes response body helpers", async () => {
  installAutoEgo((call) => {
    if (call.method === "Network.getResponseBody") {
      return { body: '{"ok":true}', base64Encoded: false };
    }
    return {};
  });
  try {
    const promise = waitForResponse(/\/api\/items$/, { timeout: 1000 });
    setTimeout(() => {
      fireEvent("Network.requestWillBeSent", {
        requestId: "req-2",
        type: "Fetch",
        request: {
          url: "https://example.com/api/items",
          method: "GET",
          headers: { Accept: "application/json" },
        },
      });
      fireEvent("Network.responseReceived", {
        requestId: "req-2",
        type: "Fetch",
        response: {
          url: "https://example.com/api/items",
          status: 200,
          statusText: "OK",
          headers: { "Content-Type": "application/json" },
          remoteIPAddress: "127.0.0.1",
          remotePort: 443,
          fromServiceWorker: true,
          securityDetails: { protocol: "TLS 1.3" },
        },
      });
      fireEvent("Network.loadingFinished", { requestId: "req-2" });
    }, 20);
    const response = await promise;
    assert.equal(response.url(), "https://example.com/api/items");
    assert.equal(response.status(), 200);
    assert.equal(response.statusText(), "OK");
    assert.equal(response.ok(), true);
    assert.equal(response.headers()["content-type"], "application/json");
    assert.deepEqual(await response.allHeaders(), {
      "content-type": "application/json",
    });
    assert.equal(
      await response.headerValue("CONTENT-TYPE"),
      "application/json",
    );
    assert.deepEqual(await response.headerValues("content-type"), [
      "application/json",
    ]);
    assert.equal(response.fromServiceWorker(), true);
    const serverAddr = response.serverAddr();
    const securityDetails = response.securityDetails();
    assert.ok(serverAddr instanceof Promise);
    assert.ok(securityDetails instanceof Promise);
    assert.deepEqual(await serverAddr, {
      ipAddress: "127.0.0.1",
      port: 443,
    });
    assert.deepEqual(await securityDetails, { protocol: "TLS 1.3" });
    assert.equal(await response.finished(), null);
    assert.equal(response.request().method(), "GET");
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(await response.text(), '{"ok":true}');
  } finally {
    cleanupBrowserRuntime();
  }
});

test("Response body remains readable after the owned Network domain is released", async () => {
  let networkEnabled = false;
  const calls = installAutoEgo((call) => {
    if (call.method === "Network.enable") {
      networkEnabled = true;
      return {};
    }
    if (call.method === "Network.disable") {
      networkEnabled = false;
      return {};
    }
    if (call.method === "Network.getResponseBody") {
      return networkEnabled
        ? { body: "delayed body", base64Encoded: false }
        : { error: { message: "No resource with given identifier found" } };
    }
    return {};
  });
  try {
    const promise = waitForResponse("https://example.com/api/delayed-body", {
      timeout: 1000,
    });
    setTimeout(() => {
      fireEvent("Network.requestWillBeSent", {
        requestId: "req-delayed-body",
        type: "Fetch",
        request: {
          url: "https://example.com/api/delayed-body",
          method: "GET",
          headers: {},
        },
      });
      fireEvent("Network.responseReceived", {
        requestId: "req-delayed-body",
        type: "Fetch",
        response: {
          url: "https://example.com/api/delayed-body",
          status: 200,
          statusText: "OK",
          headers: {},
        },
      });
      fireEvent("Network.loadingFinished", {
        requestId: "req-delayed-body",
      });
    }, 20);

    const response = await promise;
    assert.ok(
      calls.some((call) => call.method === "Network.disable"),
      "the wait releases its owned Network domain",
    );
    assert.equal(await response.text(), "delayed body");
  } finally {
    cleanupBrowserRuntime();
  }
});

test("waitForResponse retains Network events until a slow response finishes", async () => {
  const calls = installAutoEgo();
  try {
    const promise = waitForResponse("https://example.com/api/slow", {
      timeout: 1000,
    });
    setTimeout(() => {
      fireEvent("Network.requestWillBeSent", {
        requestId: "req-slow",
        type: "Fetch",
        request: {
          url: "https://example.com/api/slow",
          method: "GET",
          headers: {},
        },
      });
      fireEvent("Network.responseReceived", {
        requestId: "req-slow",
        type: "Fetch",
        response: {
          url: "https://example.com/api/slow",
          status: 200,
          statusText: "OK",
          headers: {},
        },
      });
    }, 20);
    const response = await promise;
    assert.equal(
      calls.filter((call) => call.method === "Network.disable").length,
      0,
      "response headers do not end Network tracking",
    );
    const finished = response.finished();
    fireEvent("Network.loadingFinished", { requestId: "req-slow" });
    assert.equal(await finished, null);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(
      calls.filter((call) => call.method === "Network.disable").length,
      1,
    );
  } finally {
    cleanupBrowserRuntime();
  }
});

test("Response.finished is not bounded by the response matching timeout", async () => {
  installAutoEgo();
  try {
    const promise = waitForResponse("https://example.com/api/stream", {
      timeout: 25,
    });
    setTimeout(() => {
      fireEvent("Network.requestWillBeSent", {
        requestId: "req-stream",
        type: "Fetch",
        request: {
          url: "https://example.com/api/stream",
          method: "GET",
          headers: {},
        },
      });
      fireEvent("Network.responseReceived", {
        requestId: "req-stream",
        type: "Fetch",
        response: {
          url: "https://example.com/api/stream",
          status: 200,
          statusText: "OK",
          headers: {},
        },
      });
    }, 5);
    const response = await promise;
    const outcome = response.finished().then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    await new Promise((resolve) => setTimeout(resolve, 40));
    fireEvent("Network.loadingFinished", { requestId: "req-stream" });
    const result = await outcome;
    assert.equal(result.error, undefined);
    assert.equal(result.value, null);
  } finally {
    cleanupBrowserRuntime();
  }
});

test("waitForResponse supports synchronous response predicates", async () => {
  installAutoEgo();
  try {
    const promise = waitForResponse(
      (response) =>
        response.url().includes("/api/create") &&
        response.status() === 201 &&
        response.request().method() === "POST",
      { timeout: 1000 },
    );
    setTimeout(() => {
      fireEvent("Network.requestWillBeSent", {
        requestId: "req-3",
        type: "XHR",
        request: {
          url: "https://example.com/api/create",
          method: "POST",
          headers: {},
        },
      });
      fireEvent("Network.responseReceived", {
        requestId: "req-3",
        type: "XHR",
        response: {
          url: "https://example.com/api/create",
          status: 201,
          statusText: "Created",
          headers: {},
        },
      });
      fireEvent("Network.loadingFinished", { requestId: "req-3" });
    }, 20);
    const response = await promise;
    assert.equal(response.status(), 201);
  } finally {
    cleanupBrowserRuntime();
  }
});

test("waitForResponse ignores matching events from another CDP session", async () => {
  installAutoEgo();
  try {
    const promise = waitForResponse("https://example.com/api/session", {
      timeout: 1000,
    });
    setTimeout(() => {
      const currentSessionId = state.sessionId;
      fireEvent(
        "Network.responseReceived",
        {
          requestId: "req-other-session",
          type: "Fetch",
          response: {
            url: "https://example.com/api/session",
            status: 418,
            statusText: "Other session",
            headers: {},
          },
        },
        "session-other",
      );
      fireEvent(
        "Network.responseReceived",
        {
          requestId: "req-current-session",
          type: "Fetch",
          response: {
            url: "https://example.com/api/session",
            status: 201,
            statusText: "Current session",
            headers: {},
          },
        },
        currentSessionId,
      );
      fireEvent(
        "Network.loadingFinished",
        { requestId: "req-current-session" },
        currentSessionId,
      );
    }, 20);
    const response = await promise;
    assert.equal(response.status(), 201);
  } finally {
    cleanupBrowserRuntime();
  }
});

test("waitForRequest rejects on timeout", async () => {
  installAutoEgo();
  try {
    await assert.rejects(
      () => waitForRequest(/never-matches/, { timeout: 20 }),
      /page\.waitForRequest timed out after 20ms/,
    );
  } finally {
    cleanupBrowserRuntime();
  }
});

test("waitForResponse rejects on timeout", async () => {
  installAutoEgo();
  try {
    await assert.rejects(
      () => waitForResponse(/never-matches/, { timeout: 20 }),
      /page\.waitForResponse timed out after 20ms/,
    );
  } finally {
    cleanupBrowserRuntime();
  }
});

test("network wait timeout also bounds Network.enable setup", async () => {
  globalThis.ego = {
    async listTabs() {
      return { tabs: [{ targetId: "tab-1", active: true }] };
    },
    sendCDPMessage(payload) {
      const parsed = JSON.parse(payload);
      if (parsed.method === "Network.enable") return;
      setTimeout(() => {
        const result =
          parsed.method === "Target.attachToTarget"
            ? { sessionId: "setup-timeout-session" }
            : {};
        globalThis.ego?.onCDPMessage?.(
          JSON.stringify({ id: parsed.id, result }),
        );
      }, 0);
    },
  };
  try {
    const startedAt = Date.now();
    await assert.rejects(
      () => waitForRequest(/never-matches/, { timeout: 20 }),
      /page\.waitForRequest timed out after 20ms/,
    );
    assert.ok(
      Date.now() - startedAt < 250,
      "Network.enable cannot extend the public wait timeout",
    );
  } finally {
    cleanupBrowserRuntime();
  }
});

test("waitForRequest surfaces session setup failures without waiting for its timeout", async () => {
  globalThis.ego = {
    async listTabs() {
      throw new Error("session unavailable");
    },
    sendCDPMessage() {
      throw new Error("unexpected CDP send");
    },
  };
  const waiting = waitForRequest(/never-matches/, { timeout: 500 });
  const outcome = await Promise.race([
    waiting.then(
      () => ({ value: "resolved" }),
      (error) => ({ error }),
    ),
    new Promise((resolve) =>
      setTimeout(() => resolve({ value: "still pending" }), 50),
    ),
  ]);
  try {
    assert.match(outcome.error?.message || "", /session unavailable/);
  } finally {
    await waiting.catch(() => {});
    cleanupBrowserRuntime();
  }
});

test("waitForRequest supports async predicates and disables owned Network domain", async () => {
  const calls = installAutoEgo();
  try {
    const promise = waitForRequest(
      async (request) => {
        await Promise.resolve();
        return request.url().endsWith("/api/async");
      },
      { timeout: 1000 },
    );
    setTimeout(() => {
      fireEvent("Network.requestWillBeSent", {
        requestId: "req-async",
        type: "XHR",
        request: {
          url: "https://example.com/api/async",
          method: "GET",
          headers: {},
        },
      });
      fireEvent("Network.loadingFinished", { requestId: "req-async" });
    }, 20);
    const request = await promise;
    assert.equal(request.url(), "https://example.com/api/async");
  } finally {
    cleanupBrowserRuntime();
  }
  assert.ok(calls.some((call) => call.method === "Network.enable"));
  assert.ok(calls.some((call) => call.method === "Network.disable"));
});

test("waitForResponse matches redirect responses from requestWillBeSent", async () => {
  installAutoEgo();
  try {
    const promise = waitForResponse(
      (response) =>
        response.url() === "https://example.com/old" &&
        response.status() === 302 &&
        response.request().method() === "GET",
      { timeout: 1000 },
    );
    setTimeout(() => {
      fireEvent("Network.requestWillBeSent", {
        requestId: "req-redirect",
        type: "Document",
        request: {
          url: "https://example.com/old",
          method: "GET",
          headers: {},
        },
      });
      fireEvent("Network.requestWillBeSent", {
        requestId: "req-redirect",
        type: "Document",
        redirectResponse: {
          url: "https://example.com/old",
          status: 302,
          statusText: "Found",
          headers: { location: "https://example.com/new" },
        },
        request: {
          url: "https://example.com/new",
          method: "GET",
          headers: {},
        },
      });
      fireEvent("Network.loadingFinished", { requestId: "req-redirect" });
    }, 20);
    const response = await promise;
    assert.equal(response.url(), "https://example.com/old");
    assert.equal(response.status(), 302);
    assert.equal(response.headers().location, "https://example.com/new");
    assert.equal(response.request().url(), "https://example.com/old");
  } finally {
    cleanupBrowserRuntime();
  }
});

test("response body waits for loadingFinished when initially unavailable", async () => {
  let bodyAttempts = 0;
  installAutoEgo((call) => {
    if (call.method === "Network.getResponseBody") {
      bodyAttempts += 1;
      if (bodyAttempts === 1) {
        setTimeout(() => {
          fireEvent("Network.loadingFinished", { requestId: "req-body" });
        }, 20);
        return {
          error: { message: "No resource with given identifier found" },
        };
      }
      return { body: "done", base64Encoded: false };
    }
    return {};
  });
  try {
    const promise = waitForResponse("https://example.com/api/body", {
      timeout: 1000,
    });
    setTimeout(() => {
      fireEvent("Network.requestWillBeSent", {
        requestId: "req-body",
        type: "Fetch",
        request: {
          url: "https://example.com/api/body",
          method: "GET",
          headers: {},
        },
      });
      fireEvent("Network.responseReceived", {
        requestId: "req-body",
        type: "Fetch",
        response: {
          url: "https://example.com/api/body",
          status: 200,
          statusText: "OK",
          headers: {},
        },
      });
    }, 20);
    const response = await promise;
    assert.equal(await response.text(), "done");
    assert.equal(bodyAttempts, 2);
  } finally {
    cleanupBrowserRuntime();
  }
});

test("response body does not retry unrelated CDP failures", async () => {
  let bodyAttempts = 0;
  installAutoEgo((call) => {
    if (call.method === "Network.getResponseBody") {
      bodyAttempts += 1;
      return { error: { message: "response body access denied" } };
    }
    return {};
  });
  try {
    const promise = waitForResponse("https://example.com/api/denied", {
      timeout: 1000,
    });
    setTimeout(() => {
      fireEvent("Network.requestWillBeSent", {
        requestId: "req-denied",
        type: "Fetch",
        request: {
          url: "https://example.com/api/denied",
          method: "GET",
          headers: {},
        },
      });
      fireEvent("Network.responseReceived", {
        requestId: "req-denied",
        type: "Fetch",
        response: {
          url: "https://example.com/api/denied",
          status: 200,
          statusText: "OK",
          headers: {},
        },
      });
      fireEvent("Network.loadingFinished", { requestId: "req-denied" });
    }, 20);
    const response = await promise;
    await assert.rejects(() => response.body(), /response body access denied/);
    assert.equal(bodyAttempts, 1);
  } finally {
    cleanupBrowserRuntime();
  }
});

test("Response.body is not bounded by the response matching timeout", async () => {
  let bodyAttempts = 0;
  installAutoEgo((call) => {
    if (call.method === "Network.getResponseBody") {
      bodyAttempts += 1;
      if (bodyAttempts === 1) {
        return {
          error: { message: "No resource with given identifier found" },
        };
      }
      return { body: "stream complete", base64Encoded: false };
    }
    return {};
  });
  try {
    const promise = waitForResponse("https://example.com/api/body-stream", {
      timeout: 25,
    });
    setTimeout(() => {
      fireEvent("Network.responseReceived", {
        requestId: "req-body-stream",
        type: "Fetch",
        response: {
          url: "https://example.com/api/body-stream",
          status: 200,
          statusText: "OK",
          headers: {},
        },
      });
    }, 5);
    const response = await promise;
    const bodyPromise = response.text();
    await new Promise((resolve) => setTimeout(resolve, 40));
    fireEvent("Network.loadingFinished", { requestId: "req-body-stream" });
    assert.equal(await bodyPromise, "stream complete");
    assert.equal(bodyAttempts, 2);
  } finally {
    cleanupBrowserRuntime();
  }
});

test("waitForRequest supports synchronous request predicates", async () => {
  installAutoEgo();
  try {
    const promise = waitForRequest(
      (request) =>
        request.url().endsWith("/api/filter") &&
        request.method() === "PUT" &&
        request.headers()["content-type"] === "application/json" &&
        request.postData() === '{"ok":true}',
      { timeout: 1000 },
    );
    setTimeout(() => {
      fireEvent("Network.requestWillBeSent", {
        requestId: "req-predicate",
        type: "XHR",
        request: {
          url: "https://example.com/api/filter",
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          postData: '{"ok":true}',
        },
      });
      fireEvent("Network.loadingFinished", { requestId: "req-predicate" });
    }, 20);
    const request = await promise;
    assert.equal(request.method(), "PUT");
  } finally {
    cleanupBrowserRuntime();
  }
});

test("waitForResponse rejects invalid matchers and disables owned Network domain", async () => {
  const calls = installAutoEgo();
  try {
    const promise = waitForResponse(null, { timeout: 1000 });
    setTimeout(() => {
      fireEvent("Network.requestWillBeSent", {
        requestId: "req-invalid",
        type: "XHR",
        request: {
          url: "https://example.com/api/invalid",
          method: "GET",
          headers: {},
        },
      });
      fireEvent("Network.responseReceived", {
        requestId: "req-invalid",
        type: "XHR",
        response: {
          url: "https://example.com/api/invalid",
          status: 200,
          statusText: "OK",
          headers: {},
        },
      });
    }, 20);
    await assert.rejects(
      () => promise,
      /page\.waitForResponse expects a string, RegExp, or function matcher, got null/,
    );
  } finally {
    cleanupBrowserRuntime();
  }
  assert.ok(calls.some((call) => call.method === "Network.enable"));
  assert.ok(calls.some((call) => call.method === "Network.disable"));
});

test("waitForRequest leaves a caller-enabled Network domain enabled", async () => {
  const calls = installAutoEgo();
  try {
    await cdp("Network.enable");
    calls.length = 0;
    const promise = waitForRequest("https://example.com/api/owned", {
      timeout: 1000,
    });
    setTimeout(() => {
      fireEvent("Network.requestWillBeSent", {
        requestId: "req-owned",
        type: "XHR",
        request: {
          url: "https://example.com/api/owned",
          method: "GET",
          headers: {},
        },
      });
      fireEvent("Network.loadingFinished", { requestId: "req-owned" });
    }, 20);
    const request = await promise;
    assert.equal(request.url(), "https://example.com/api/owned");
  } finally {
    cleanupBrowserRuntime();
  }
  assert.ok(!calls.some((call) => call.method === "Network.disable"));
});

test("concurrent network waits share the Network domain until all complete", async () => {
  const calls = installAutoEgo();
  try {
    const requestPromise = waitForRequest("https://example.com/api/first", {
      timeout: 1000,
    });
    const responsePromise = waitForResponse("https://example.com/api/second", {
      timeout: 1000,
    });
    setTimeout(() => {
      fireEvent("Network.requestWillBeSent", {
        requestId: "req-first",
        type: "XHR",
        request: {
          url: "https://example.com/api/first",
          method: "GET",
          headers: {},
        },
      });
      fireEvent("Network.loadingFinished", { requestId: "req-first" });
    }, 20);
    const request = await requestPromise;
    assert.equal(request.url(), "https://example.com/api/first");
    assert.equal(
      calls.filter((call) => call.method === "Network.disable").length,
      0,
      "first completed wait must not disable while another wait is pending",
    );
    fireEvent("Network.requestWillBeSent", {
      requestId: "req-second",
      type: "XHR",
      request: {
        url: "https://example.com/api/second",
        method: "GET",
        headers: {},
      },
    });
    fireEvent("Network.responseReceived", {
      requestId: "req-second",
      type: "XHR",
      response: {
        url: "https://example.com/api/second",
        status: 200,
        statusText: "OK",
        headers: {},
      },
    });
    fireEvent("Network.loadingFinished", { requestId: "req-second" });
    const response = await responsePromise;
    assert.equal(response.url(), "https://example.com/api/second");
    await new Promise((resolve) => setTimeout(resolve, 20));
  } finally {
    cleanupBrowserRuntime();
  }
  assert.equal(
    calls.filter((call) => call.method === "Network.enable").length,
    1,
  );
  assert.equal(
    calls.filter((call) => call.method === "Network.disable").length,
    1,
  );
});

test("response body decodes base64 payloads", async () => {
  const encoded = Buffer.from("hello").toString("base64");
  installAutoEgo((call) => {
    if (call.method === "Network.getResponseBody") {
      return { body: encoded, base64Encoded: true };
    }
    return {};
  });
  try {
    const promise = waitForResponse("https://example.com/api/base64", {
      timeout: 1000,
    });
    setTimeout(() => {
      fireEvent("Network.requestWillBeSent", {
        requestId: "req-base64",
        type: "Fetch",
        request: {
          url: "https://example.com/api/base64",
          method: "GET",
          headers: {},
        },
      });
      fireEvent("Network.responseReceived", {
        requestId: "req-base64",
        type: "Fetch",
        response: {
          url: "https://example.com/api/base64",
          status: 200,
          statusText: "OK",
          headers: {},
        },
      });
      fireEvent("Network.loadingFinished", { requestId: "req-base64" });
    }, 20);
    const response = await promise;
    assert.equal((await response.body()).toString("utf8"), "hello");
    assert.equal(await response.text(), "hello");
  } finally {
    cleanupBrowserRuntime();
  }
});

test("response ok is false for non-2xx statuses", async () => {
  installAutoEgo();
  try {
    const promise = waitForResponse("https://example.com/api/fail", {
      timeout: 1000,
    });
    setTimeout(() => {
      fireEvent("Network.requestWillBeSent", {
        requestId: "req-fail",
        type: "XHR",
        request: {
          url: "https://example.com/api/fail",
          method: "GET",
          headers: {},
        },
      });
      fireEvent("Network.responseReceived", {
        requestId: "req-fail",
        type: "XHR",
        response: {
          url: "https://example.com/api/fail",
          status: 500,
          statusText: "Internal Server Error",
          headers: {},
        },
      });
      fireEvent("Network.loadingFinished", { requestId: "req-fail" });
    }, 20);
    const response = await promise;
    assert.equal(response.status(), 500);
    assert.equal(response.ok(), false);
  } finally {
    cleanupBrowserRuntime();
  }
});

test("waitForRequest timeout 0 disables the timeout", async () => {
  installAutoEgo();
  try {
    const promise = waitForRequest("https://example.com/api/no-timeout", {
      timeout: 0,
    });
    setTimeout(() => {
      fireEvent("Network.requestWillBeSent", {
        requestId: "req-no-timeout",
        type: "XHR",
        request: {
          url: "https://example.com/api/no-timeout",
          method: "GET",
          headers: {},
        },
      });
      fireEvent("Network.loadingFinished", { requestId: "req-no-timeout" });
    }, 20);
    const request = await promise;
    assert.equal(request.url(), "https://example.com/api/no-timeout");
  } finally {
    cleanupBrowserRuntime();
  }
});

test("waitForLoadState accepts Playwright-style options as the first argument", async () => {
  let t = 0;
  const readyStates = ["loading", "loading"];
  const sleeps = [];
  const restore = setOverrides({
    cdpOverride: async (method, params) => {
      if (method === "Runtime.evaluate") {
        if (params.expression === "document.readyState") {
          return { result: { value: readyStates.shift() || "loading" } };
        }
        return { result: { value: true } };
      }
      return {};
    },
    now: () => t,
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
  });
  try {
    await assert.rejects(
      () => waitForLoadState({ timeout: 500 }),
      (error) => {
        assert.equal(error.name, "TimeoutError");
        assert.match(
          error.message,
          /page\.waitForLoadState timed out after 500ms/,
        );
        return true;
      },
    );
  } finally {
    restore();
  }
  assert.deepEqual(sleeps, [300, 300]);
});

test("waitForLoadState does not retry after a frame-tree hard stop", async () => {
  const hardStop = Object.assign(new Error("user controls the task space"), {
    error_code: "EGO_TASK_SPACE_USER_IN_CONTROL",
  });
  const calls = [];
  const restore = setOverrides({
    cdpOverride: async (method) => {
      calls.push(method);
      if (method === "Page.getFrameTree") throw hardStop;
      throw new Error(`unexpected retry through ${method}`);
    },
  });
  try {
    await assert.rejects(
      () => waitForLoadState("load", { timeout: 100 }),
      (error) => error === hardStop,
    );
  } finally {
    restore();
  }
  assert.deepEqual(calls, ["Page.getFrameTree"]);
});

test("waitForLoadState enables the Network domain and disables it afterwards", async () => {
  // Regression: nothing used to enable the Network domain, so the helper could
  // report "idle" without ever being able to observe traffic.
  const methods = [];
  let t = 0;
  const restore = setOverrides({
    cdpOverride: async (method) => {
      methods.push(method);
      return {};
    },
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
  });
  try {
    const result = await waitForLoadState("networkidle", { timeout: 5000 });
    assert.equal(result, undefined, "no traffic for idleMs resolves");
  } finally {
    restore();
  }
  assert.equal(
    methods[0],
    "Network.enable",
    "must enable Network before observing",
  );
  assert.equal(
    methods.at(-1),
    "Network.disable",
    "must disable Network when done",
  );
});

test("waitForLoadState leaves a caller-enabled Network domain enabled", async () => {
  const methods = [];
  let t = 0;
  const restore = setOverrides({
    cdpOverride: async (method) => {
      methods.push(method);
      return {};
    },
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
  });
  try {
    await cdp("Network.enable"); // the caller owns the domain
    methods.length = 0;
    const result = await waitForLoadState("networkidle", { timeout: 5000 });
    assert.equal(result, undefined);
  } finally {
    restore();
  }
  assert.ok(
    !methods.includes("Network.disable"),
    "must not tear down a Network domain the caller enabled",
  );
});

test("waitForLoadState survives a bridge that rejects Network.enable", async () => {
  let t = 0;
  const restore = setOverrides({
    cdpOverride: async (method) => {
      if (method === "Network.enable" || method === "Network.disable") {
        throw new Error("'Network.enable' wasn't found");
      }
      return {};
    },
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
  });
  try {
    const result = await waitForLoadState("networkidle", { timeout: 5000 });
    assert.equal(result, undefined, "falls back to passive observation");
  } finally {
    restore();
  }
});

test("waitForFunction does not infer options from the second argument", async () => {
  let expression;
  const restore = setOverrides({
    cdpOverride: async (method, params) => {
      assert.equal(method, "Runtime.evaluate");
      expression = params.expression;
      return { result: { value: true } };
    },
  });
  try {
    const handle = await waitForFunction((arg) => arg.timeout === 123, {
      timeout: 123,
    });
    assert.equal(await handle.jsonValue(), true);
  } finally {
    restore();
  }
  assert.match(expression, /\{"timeout":123\}/);
});

test("waitForFunction throws TimeoutError on timeout", async () => {
  let now = 0;
  const restore = setOverrides({
    cdpOverride: async () => ({ result: { value: false } }),
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  });
  try {
    await assert.rejects(
      () =>
        waitForFunction(() => false, undefined, {
          timeout: 100,
          polling: 25,
        }),
      (error) => {
        assert.equal(error.name, "TimeoutError");
        assert.match(
          error.message,
          /page\.waitForFunction timed out after 100ms/,
        );
        return true;
      },
    );
  } finally {
    restore();
  }
});

test("waitForURL throws TimeoutError on timeout", async () => {
  let now = 0;
  const restore = setOverrides({
    cdpOverride: async () => ({
      result: { value: "https://example.com/current" },
    }),
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  });
  try {
    await assert.rejects(
      () => waitForURL("https://example.com/expected", { timeout: 100 }),
      (error) => {
        assert.equal(error.name, "TimeoutError");
        assert.match(error.message, /page\.waitForURL timed out after 100ms/);
        return true;
      },
    );
  } finally {
    restore();
  }
});

test("waitForURL rejects an unsupported waitUntil value", async () => {
  const restore = setOverrides({
    cdpOverride: async () => {
      throw new Error("waitForURL should validate options before reading URL");
    },
  });
  try {
    await assert.rejects(
      () =>
        waitForURL("https://example.com/expected", {
          timeout: 100,
          waitUntil: "ready",
        }),
      /page\.waitForURL waitUntil must be one of/,
    );
  } finally {
    restore();
  }
});

test("waitForSelector supports hidden and detached states", async () => {
  const calls = [];
  const restore = setOverrides({
    cdpOverride: async (method, params) => {
      calls.push({ method, params });
      if (method === "Runtime.evaluate") {
        if (params.expression.includes("#detached")) {
          return { result: {} };
        }
        return { result: { objectId: "node-hidden" } };
      }
      if (method === "Runtime.callFunctionOn") {
        return { result: { value: false } };
      }
      return {};
    },
  });
  try {
    assert.equal(
      await waitForSelector("#hidden", { state: "hidden", timeout: 100 }),
      null,
    );
    assert.equal(
      await waitForSelector("#detached", {
        state: "detached",
        timeout: 100,
      }),
      null,
    );
  } finally {
    restore();
  }
  assert.ok(
    calls.some(({ method }) => method === "Runtime.releaseObject"),
    "hidden-state probes release their resolved handle",
  );
});

test("waitForSelector waits until the frame owner becomes visible", async () => {
  let frameProbes = 0;
  let now = 0;
  const restore = setOverrides({
    sessionId: "main-session",
    sessionTargetId: "tab-1",
    sessionAt: Date.now(),
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    cdpOverride(method, params) {
      if (method === "Runtime.evaluate") {
        return {
          result: {
            objectId:
              params.contextId === 101 ? "inside-object" : "frame-owner",
          },
        };
      }
      if (
        method === "Runtime.callFunctionOn" &&
        params.objectId === "frame-owner"
      ) {
        frameProbes += 1;
        return {
          result: {
            value: {
              x: 100,
              y: 50,
              width: frameProbes === 1 ? 0 : 400,
              height: frameProbes === 1 ? 0 : 300,
              visible: frameProbes > 1,
              receivesEvents: frameProbes > 1,
              scaleX: 1,
              scaleY: 1,
            },
          },
        };
      }
      if (method === "DOM.describeNode") {
        return { node: { frameId: "delayed-visible-frame" } };
      }
      if (method === "Page.createIsolatedWorld") {
        return { executionContextId: 101 };
      }
      if (
        method === "Runtime.callFunctionOn" &&
        params.objectId === "inside-object"
      ) {
        return { result: { value: true } };
      }
      if (method === "Runtime.releaseObject") return {};
      throw new Error(`Unexpected CDP method: ${method}`);
    },
  });
  try {
    assert.equal(
      await waitForSelector(
        {
          selector: "#inside",
          frameChain: ["iframe#delayed-visible"],
        },
        { state: "visible", timeout: 700 },
      ),
      true,
    );
    assert.equal(frameProbes, 2);
  } finally {
    restore();
  }
});

test("waitForSelector does not retry a task-space hard stop", async () => {
  const hardStop = Object.assign(new Error("user controls the task space"), {
    error_code: "EGO_TASK_SPACE_USER_IN_CONTROL",
  });
  const calls = [];
  const restore = setOverrides({
    cdpOverride: async (method, params) => {
      calls.push(method);
      if (
        method === "Runtime.evaluate" &&
        params.objectGroup === "ego-browser"
      ) {
        return { result: { objectId: "node-hard-stop" } };
      }
      if (method === "Runtime.callFunctionOn") throw hardStop;
      return {};
    },
  });
  try {
    await assert.rejects(
      () => waitForSelector("#blocked", { timeout: 100 }),
      (error) => error === hardStop,
    );
  } finally {
    restore();
  }
  assert.equal(
    calls.filter((method) => method === "Runtime.callFunctionOn").length,
    1,
  );
});

test("waitForSelector throws TimeoutError instead of returning false", async () => {
  let now = 0;
  const restore = setOverrides({
    cdpOverride: async () => ({ result: {} }),
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  });
  try {
    await assert.rejects(
      () => waitForSelector("#missing", { timeout: 100 }),
      (error) => {
        assert.equal(error.name, "TimeoutError");
        assert.match(
          error.message,
          /page\.waitForSelector timed out after 100ms/,
        );
        return true;
      },
    );
  } finally {
    restore();
  }
});
