import { readFile } from "node:fs/promises";

import { ensureSession, subscribeBrowserEvent } from "./browser-runtime.js";
import { cdp } from "./cdp-eval.js";
import { createRequestFacade, createRequestInfo } from "./network-facades.js";
import { state } from "./state.js";

type UrlMatcher = string | RegExp | ((url: URL) => boolean);
type RouteEntry = {
  matcher: UrlMatcher;
  handler: (route: any, request: any) => any;
  remaining: number;
};

export function createPageNetworkController(page, scripts) {
  const routes: RouteEntry[] = [];
  const inFlight = new Set<Promise<void>>();
  let fetchSessionId: string | undefined;
  let removeFetchListener: (() => void) | undefined;
  const webSocketRoutes: Array<{ matcher: UrlMatcher; handler: Function }> = [];
  const webSockets = new Map<
    string,
    {
      sessionId?: string;
      pageMessage?: Function;
      serverMessage?: Function;
    }
  >();
  let webSocketBinding: string | undefined;

  const currentSession = async () =>
    state.cdpOverride ? state.sessionId || undefined : await ensureSession();

  const ensureFetch = async () => {
    const sessionId = await currentSession();
    if (fetchSessionId === sessionId && removeFetchListener) return;
    removeFetchListener?.();
    fetchSessionId = sessionId;
    await cdp(
      "Fetch.enable",
      { patterns: [{ urlPattern: "*", requestStage: "Request" }] },
      sessionId,
    );
    removeFetchListener = subscribeBrowserEvent(
      "Fetch.requestPaused",
      sessionId,
      (event) => {
        const task = dispatchPaused(event).finally(() => inFlight.delete(task));
        inFlight.add(task);
        void task.catch(() => {});
      },
    );
  };

  const disableFetch = async () => {
    removeFetchListener?.();
    removeFetchListener = undefined;
    const sessionId = fetchSessionId;
    fetchSessionId = undefined;
    if (sessionId !== undefined || state.cdpOverride) {
      await cdp("Fetch.disable", {}, sessionId).catch(() => {});
    }
  };

  const dispatchPaused = async (event, beforeIndex = routes.length) => {
    const params = event.params || {};
    const url = params.request?.url || "";
    for (
      let index = Math.min(beforeIndex, routes.length) - 1;
      index >= 0;
      index -= 1
    ) {
      const entry = routes[index];
      if (!(await urlMatches(url, entry.matcher))) continue;
      if (entry.remaining !== Number.POSITIVE_INFINITY) {
        entry.remaining -= 1;
        if (entry.remaining <= 0) routes.splice(index, 1);
      }
      const requestInfo = createRequestInfo(
        {
          requestId: params.networkId || params.requestId,
          request: params.request,
          type: params.resourceType,
        },
        event.sessionId,
      );
      const request = createRequestFacade(requestInfo);
      let handled = false;
      const route = {
        request: () => request,
        abort: async (errorCode = "failed") => {
          handled = true;
          await cdp(
            "Fetch.failRequest",
            {
              requestId: params.requestId,
              errorReason: fetchErrorReason(errorCode),
            },
            event.sessionId,
          );
        },
        continue: async (overrides: any = {}) => {
          handled = true;
          await continueRequest(params.requestId, overrides, event.sessionId);
        },
        fallback: async (overrides: any = {}) => {
          handled = true;
          if (Object.keys(overrides).length) {
            params.request = applyRequestOverrides(params.request, overrides);
          }
          await dispatchPaused({ ...event, params }, index);
        },
        fulfill: async (options: any = {}) => {
          handled = true;
          await fulfillRequest(params.requestId, options, event.sessionId);
        },
      };
      await entry.handler(route, request);
      if (!handled) {
        throw new Error(
          `page.route handler for ${url} did not call continue(), fallback(), fulfill(), or abort()`,
        );
      }
      return;
    }
    await continueRequest(params.requestId, {}, event.sessionId);
  };

  const route = async (matcher, handler, options: any = {}) => {
    validateMatcher(matcher, "page.route");
    if (typeof handler !== "function") {
      throw new TypeError("page.route handler must be a function");
    }
    const times = options.times ?? Number.POSITIVE_INFINITY;
    if (
      times !== Number.POSITIVE_INFINITY &&
      (!Number.isInteger(times) || times <= 0)
    ) {
      throw new TypeError("page.route times must be a positive integer");
    }
    routes.push({ matcher, handler, remaining: times });
    await ensureFetch();
  };

  const unroute = async (matcher, handler = undefined) => {
    for (let index = routes.length - 1; index >= 0; index -= 1) {
      const entry = routes[index];
      if (!sameMatcher(entry.matcher, matcher)) continue;
      if (handler !== undefined && entry.handler !== handler) continue;
      routes.splice(index, 1);
    }
    if (routes.length === 0) await disableFetch();
  };

  const unrouteAll = async (options: any = {}) => {
    routes.length = 0;
    if (options.behavior === "wait") {
      await Promise.allSettled([...inFlight]);
    }
    await disableFetch();
  };

  const routeFromHAR = async (path, options: any = {}) => {
    if (options.update) {
      throw new Error(
        "page.routeFromHAR update mode requires BrowserContext.close() and is not supported",
      );
    }
    const har = JSON.parse(await readFile(String(path), "utf8"));
    const entries = Array.isArray(har.log?.entries) ? har.log.entries : [];
    const matcher = options.url || (() => true);
    await route(matcher, async (routeValue, request) => {
      const entry = entries.find(
        (candidate) =>
          candidate.request?.url === request.url() &&
          String(candidate.request?.method || "GET").toUpperCase() ===
            request.method().toUpperCase(),
      );
      if (!entry) {
        if (options.notFound === "fallback") await routeValue.fallback();
        else await routeValue.abort("failed");
        return;
      }
      const content = entry.response?.content || {};
      await routeValue.fulfill({
        status: entry.response?.status || 200,
        headers: Object.fromEntries(
          (entry.response?.headers || []).map(({ name, value }) => [
            name,
            value,
          ]),
        ),
        body:
          content.encoding === "base64"
            ? Buffer.from(content.text || "", "base64")
            : content.text || "",
      });
    });
  };

  const routeWebSocket = async (matcher, handler) => {
    validateMatcher(matcher, "page.routeWebSocket");
    if (typeof handler !== "function") {
      throw new TypeError("page.routeWebSocket handler must be a function");
    }
    webSocketRoutes.push({ matcher, handler });
    if (!webSocketBinding) {
      webSocketBinding = await scripts.installRawBinding(
        async (payload, event) => {
          const socket = webSockets.get(payload.id);
          if (payload.kind === "open") {
            const matched = await lastMatchingRoute(
              webSocketRoutes,
              payload.url,
            );
            if (!matched) {
              await evaluateWebSocket(event.sessionId, "connect", payload.id);
              return;
            }
            const state = { sessionId: event.sessionId };
            webSockets.set(payload.id, state);
            const routeValue = createWebSocketRoute(
              payload,
              state,
              event.sessionId,
              evaluateWebSocket,
            );
            await matched.handler(routeValue);
            await evaluateWebSocket(event.sessionId, "open", payload.id);
            return;
          }
          if (!socket) return;
          if (payload.kind === "page-message") {
            if (socket.pageMessage) await socket.pageMessage(payload.data);
            else
              await evaluateWebSocket(
                event.sessionId,
                "send-server",
                payload.id,
                payload.data,
              );
          } else if (payload.kind === "server-message") {
            if (socket.serverMessage) await socket.serverMessage(payload.data);
            else
              await evaluateWebSocket(
                event.sessionId,
                "receive",
                payload.id,
                payload.data,
              );
          } else if (payload.kind === "close") {
            webSockets.delete(payload.id);
          }
        },
      );
      const source = webSocketBootstrap(webSocketBinding);
      await cdp("Page.addScriptToEvaluateOnNewDocument", { source });
      await cdp("Runtime.evaluate", {
        expression: source,
        returnByValue: true,
        awaitPromise: false,
      });
    }
  };

  return {
    route,
    unroute,
    unrouteAll,
    routeFromHAR,
    routeWebSocket,
  };
}

async function continueRequest(requestId, overrides, sessionId) {
  await cdp(
    "Fetch.continueRequest",
    {
      requestId,
      ...(overrides.url === undefined ? {} : { url: String(overrides.url) }),
      ...(overrides.method === undefined
        ? {}
        : { method: String(overrides.method) }),
      ...(overrides.postData === undefined
        ? {}
        : {
            postData: Buffer.from(String(overrides.postData)).toString(
              "base64",
            ),
          }),
      ...(overrides.headers === undefined
        ? {}
        : { headers: headerEntries(overrides.headers) }),
    },
    sessionId,
  );
}

async function fulfillRequest(requestId, options, sessionId) {
  const headers = { ...(options.headers || {}) };
  let body = options.body;
  if (options.json !== undefined) {
    body = JSON.stringify(options.json);
    if (
      !Object.keys(headers).some(
        (name) => name.toLowerCase() === "content-type",
      )
    ) {
      headers["content-type"] = "application/json";
    }
  }
  await cdp(
    "Fetch.fulfillRequest",
    {
      requestId,
      responseCode: Number(options.status ?? 200),
      responsePhrase: options.statusText,
      responseHeaders: headerEntries(headers),
      body: Buffer.isBuffer(body)
        ? body.toString("base64")
        : Buffer.from(String(body ?? "")).toString("base64"),
    },
    sessionId,
  );
}

function headerEntries(headers = {}) {
  return Object.entries(headers).map(([name, value]) => ({
    name: String(name),
    value: String(value),
  }));
}

function applyRequestOverrides(request, overrides) {
  return {
    ...request,
    ...(overrides.url === undefined ? {} : { url: String(overrides.url) }),
    ...(overrides.method === undefined
      ? {}
      : { method: String(overrides.method) }),
    ...(overrides.postData === undefined
      ? {}
      : { postData: String(overrides.postData) }),
    ...(overrides.headers === undefined ? {} : { headers: overrides.headers }),
  };
}

function fetchErrorReason(errorCode) {
  const normalized = String(errorCode)
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  const reasons = {
    failed: "Failed",
    aborted: "Aborted",
    timedout: "TimedOut",
    accessdenied: "AccessDenied",
    connectionclosed: "ConnectionClosed",
    connectionreset: "ConnectionReset",
    connectionrefused: "ConnectionRefused",
    connectionaborted: "ConnectionAborted",
    connectionfailed: "ConnectionFailed",
    namenotresolved: "NameNotResolved",
    internetdisconnected: "InternetDisconnected",
    addressunreachable: "AddressUnreachable",
    blockedbyclient: "BlockedByClient",
    blockedbyresponse: "BlockedByResponse",
  };
  return reasons[normalized] || "Failed";
}

function validateMatcher(matcher, apiName) {
  if (
    typeof matcher !== "string" &&
    !(matcher instanceof RegExp) &&
    typeof matcher !== "function"
  ) {
    throw new TypeError(
      `${apiName} expects a string, RegExp, or URL predicate`,
    );
  }
}

async function urlMatches(value, matcher: UrlMatcher) {
  if (typeof matcher === "function")
    return Boolean(await matcher(new URL(value)));
  if (matcher instanceof RegExp) {
    matcher.lastIndex = 0;
    return matcher.test(value);
  }
  return globToRegExp(matcher).test(value);
}

function sameMatcher(left, right) {
  return (
    left === right ||
    (left instanceof RegExp &&
      right instanceof RegExp &&
      left.source === right.source &&
      left.flags === right.flags)
  );
}

function globToRegExp(glob) {
  let source = "^";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === "*" && glob[index + 1] === "*") {
      source += ".*";
      index += 1;
    } else if (char === "*") source += "[^/]*";
    else if (char === "?") source += ".";
    else source += char.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
  }
  return new RegExp(`${source}$`);
}

async function lastMatchingRoute(routes, url) {
  for (let index = routes.length - 1; index >= 0; index -= 1) {
    if (await urlMatches(url, routes[index].matcher)) return routes[index];
  }
  return null;
}

function createWebSocketRoute(payload, socket, sessionId, evaluate) {
  return {
    url: () => payload.url,
    onMessage: (handler) => {
      socket.pageMessage = handler;
    },
    send: (message) => evaluate(sessionId, "receive", payload.id, message),
    close: (options: any = {}) =>
      evaluate(sessionId, "close", payload.id, {
        code: options.code,
        reason: options.reason,
      }),
    connectToServer: async () => {
      await evaluate(sessionId, "connect", payload.id);
      return {
        onMessage: (handler) => {
          socket.serverMessage = handler;
        },
        send: (message) =>
          evaluate(sessionId, "send-server", payload.id, message),
        close: (options: any = {}) =>
          evaluate(sessionId, "close", payload.id, {
            code: options.code,
            reason: options.reason,
          }),
      };
    },
  };
}

async function evaluateWebSocket(sessionId, command, id, value = undefined) {
  await cdp(
    "Runtime.evaluate",
    {
      expression: `globalThis.__egoWebSockets?.[${JSON.stringify(command)}]?.(${JSON.stringify(id)}, ${JSON.stringify(value)})`,
      returnByValue: true,
      awaitPromise: false,
    },
    sessionId,
  );
}

function webSocketBootstrap(bindingName) {
  return `(() => {
    if (globalThis.__egoWebSockets) return;
    const NativeWebSocket = globalThis.WebSocket;
    const binding = globalThis[${JSON.stringify(bindingName)}];
    if (typeof NativeWebSocket !== "function" || typeof binding !== "function") return;
    const sockets = new Map();
    let nextId = 1;
    class RoutedWebSocket extends EventTarget {
      static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
      constructor(url, protocols) {
        super();
        this.url = new URL(String(url), location.href).href;
        this.protocol = ""; this.extensions = ""; this.binaryType = "blob";
        this.bufferedAmount = 0; this.readyState = 0;
        this.__id = String(nextId++); this.__protocols = protocols;
        sockets.set(this.__id, { page: this, native: null });
        binding(JSON.stringify({ kind: "open", id: this.__id, url: this.url, protocols }));
      }
      send(data) { binding(JSON.stringify({ kind: "page-message", id: this.__id, data })); }
      close(code, reason) { this.readyState = 2; binding(JSON.stringify({ kind: "close", id: this.__id, code, reason })); }
      get CONNECTING(){return 0} get OPEN(){return 1} get CLOSING(){return 2} get CLOSED(){return 3}
    }
    const dispatch = (socket, type, init) => {
      const event = type === "message" ? new MessageEvent(type, init) : new Event(type);
      socket.dispatchEvent(event);
      const handler = socket["on" + type];
      if (typeof handler === "function") handler.call(socket, event);
    };
    globalThis.__egoWebSockets = {
      open(id) { const entry = sockets.get(id); if (!entry) return; entry.page.readyState = 1; dispatch(entry.page, "open"); },
      receive(id, data) { const entry = sockets.get(id); if (entry) dispatch(entry.page, "message", { data }); },
      close(id, options) { const entry = sockets.get(id); if (!entry) return; entry.native?.close(options?.code, options?.reason); entry.page.readyState = 3; dispatch(entry.page, "close"); sockets.delete(id); },
      connect(id) { const entry = sockets.get(id); if (!entry || entry.native) return; const native = new NativeWebSocket(entry.page.url, entry.page.__protocols); entry.native = native; native.onopen = () => this.open(id); native.onmessage = event => binding(JSON.stringify({ kind: "server-message", id, data: event.data })); native.onclose = () => this.close(id); native.onerror = () => dispatch(entry.page, "error"); },
      "send-server"(id, data) { sockets.get(id)?.native?.send(data); },
    };
    globalThis.WebSocket = RoutedWebSocket;
  })()`;
}
