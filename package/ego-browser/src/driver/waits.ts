import { state } from "../state.js";
import { cdp, evaluateWithArguments, runtimeValue } from "../cdp-eval.js";
import { resolveHandle, releaseHandle } from "./element-ops.js";
import { ElementResolutionError } from "../element-resolver.js";
import type { LocatorTarget } from "../frame-context.js";
import { isEgoHardStopError } from "../ego-errors.js";
import { waitForDocumentLoad } from "./load.js";
import { drainEvents } from "./observe.js";
import {
  ensureSession,
  isBrowserRuntime,
  waitForBrowserEvent,
} from "../browser-runtime.js";
import { createJSHandle, remotePrimitiveValue } from "../js-handle.js";
import {
  normalizeTimeout,
  normalizeWaitUntil,
  operationTimeout,
  remainingTimeout,
  timeoutDeadline,
} from "../playwright-errors.js";
import {
  createRequestFacade,
  createResponseFacade,
  responseLifecycleInfo,
} from "../network-facades.js";
import { acquireNetworkEvents } from "../network-events.js";
import { createNetworkLifecycleMonitor } from "../network-lifecycle.js";
import { currentTargetContext } from "../target-context.js";

type WaitForSelectorOptions = {
  timeout?: number;
  state?: "visible" | "attached" | "hidden" | "detached";
};

type WaitForFunctionOptions = {
  timeout?: number;
  polling?: number | "raf";
};

type WaitForURLOptions = {
  timeout?: number;
  waitUntil?: LoadState | "commit";
};

type WaitForLoadStateOptions = {
  timeout?: number;
  idleMs?: number;
};

type WaitForNetworkOptions = {
  timeout?: number;
};

type LoadState = "load" | "domcontentloaded" | "networkidle";

/**
 * Sleep for a fixed number of milliseconds.
 * @param {number} [ms=1000] Milliseconds to wait.
 * @returns {Promise<void>}
 */
export async function waitForTimeout(ms = 1000) {
  await state.sleep(ms);
}

/**
 * Poll a page function or expression until it returns a truthy value.
 * @param {string|Function} pageFunction Browser-side expression or function.
 * @param {unknown} [arg] Optional function argument.
 * @param {{timeout?: number, polling?: number|"raf"}} [options] timeout in milliseconds; polling is a positive interval or "raf".
 * @returns {Promise<object>} JSHandle for the first truthy return value.
 */
export async function waitForFunction(
  pageFunction,
  arg: unknown = undefined,
  options: WaitForFunctionOptions = {},
) {
  const timeout = normalizeTimeout(
    "page.waitForFunction",
    options.timeout ?? state.defaultTimeout,
  );
  const polling =
    options.polling === "raf" || options.polling === undefined
      ? 16
      : Number(options.polling);
  if (!Number.isFinite(polling) || polling <= 0) {
    throw new TypeError(
      'page.waitForFunction polling must be "raf" or a positive number',
    );
  }
  const deadline = timeoutDeadline(timeout, state.now());
  const isFunction = typeof pageFunction === "function";
  if (!isFunction && typeof pageFunction !== "string") {
    throw new TypeError(
      `waitForFunction expects a string expression or function, got ${pageFunction === null ? "null" : typeof pageFunction}`,
    );
  }
  const expression = String(pageFunction);
  const sessionId = isBrowserRuntime()
    ? await ensureSession()
    : state.sessionId || undefined;
  while (state.now() < deadline) {
    const remoteObject = await evaluateWithArguments(
      expression,
      isFunction,
      arg,
      {
        apiName: "page.waitForFunction",
        sessionId,
        returnHandle: true,
        objectGroup: "ego-browser-wait-for-function",
      },
    );
    const value = remoteObject.objectId
      ? true
      : remotePrimitiveValue(remoteObject);
    if (value) {
      return createJSHandle(remoteObject, sessionId);
    }
    await state.sleep(polling);
  }
  throw operationTimeout("page.waitForFunction", timeout);
}

/**
 * Wait for the current page URL to match a string, glob, RegExp, or predicate.
 * @param {string|RegExp|Function} url URL matcher. Predicate functions receive a URL object. Strings with * are treated as globs; other strings are exact.
 * @param {{timeout?: number, waitUntil?: "load"|"domcontentloaded"|"networkidle"|"commit"}} [options]
 *   `waitUntil` defaults to `"load"`.
 * @returns {Promise<void>}
 */
export async function waitForURL(url, options: WaitForURLOptions = {}) {
  const waitUntil = normalizeWaitUntil("page.waitForURL", options.waitUntil);
  const timeout = normalizeTimeout(
    "page.waitForURL",
    options.timeout ?? state.defaultTimeout,
  );
  const deadline = timeoutDeadline(timeout, state.now());
  while (state.now() < deadline) {
    const current = runtimeValue(
      await cdp("Runtime.evaluate", {
        expression: "location.href",
        returnByValue: true,
        awaitPromise: false,
      }),
      "location.href",
    );
    if (urlMatches(current, url)) {
      // waitForDocumentLoad treats about:blank as an uncommitted transient,
      // so skip document-load states for a matched blank page. Explicit
      // networkidle still needs to observe its idle window.
      if (
        waitUntil !== "commit" &&
        !(current === "about:blank" && waitUntil !== "networkidle")
      ) {
        const remaining = remainingTimeout(deadline, state.now());
        const reached = await waitForLoadStateCore(waitUntil, {
          timeout: remaining,
        });
        if (!reached) throw operationTimeout("page.waitForURL", timeout);
      }
      return;
    }
    await state.sleep(100);
  }
  throw operationTimeout("page.waitForURL", timeout);
}

/**
 * Wait for a network request whose URL or request facade matches.
 * @param {string|RegExp|Function} urlOrPredicate Exact URL, RegExp, or synchronous/async request predicate.
 * @param {{timeout?: number}} [options] timeout in milliseconds; 0 disables timeout.
 * @returns {Promise<object>} Playwright-style request facade.
 */
export async function waitForRequest(
  urlOrPredicate,
  options: WaitForNetworkOptions = {},
) {
  return waitForNetworkMatch("request", urlOrPredicate, options);
}

/**
 * Wait for a network response whose URL or response facade matches.
 * @param {string|RegExp|Function} urlOrPredicate Exact URL, RegExp, or synchronous/async response predicate.
 * @param {{timeout?: number}} [options] timeout in milliseconds; 0 disables timeout.
 * @returns {Promise<object>} Playwright-style response facade.
 */
export async function waitForResponse(
  urlOrPredicate,
  options: WaitForNetworkOptions = {},
) {
  return waitForNetworkMatch("response", urlOrPredicate, options);
}

/**
 * Wait for a page load state. `"networkidle"` waits until network traffic goes
 * idle; `"domcontentloaded"` until the DOM is interactive; otherwise until
 * document.readyState is complete.
 * @param {"load"|"domcontentloaded"|"networkidle"|{timeout?: number, idleMs?: number}} [loadState="load"] Load state to wait for, or options for the default "load" state.
 * @param {{timeout?: number, idleMs?: number}} [options] timeout in milliseconds; idleMs only applies to "networkidle".
 * @returns {Promise<void>}
 */
export async function waitForLoadState(
  loadState: LoadState | WaitForLoadStateOptions = "load",
  options: WaitForLoadStateOptions = {},
) {
  const [stateName, effectiveOptions] = normalizeLoadStateArgs(
    loadState,
    options,
  );
  if (!["load", "domcontentloaded", "networkidle"].includes(stateName)) {
    throw new TypeError(`unsupported load state: ${JSON.stringify(stateName)}`);
  }
  const reached = await waitForLoadStateCore(stateName, effectiveOptions);
  if (!reached) {
    throw operationTimeout(
      "page.waitForLoadState",
      effectiveOptions.timeout ?? state.defaultTimeout,
    );
  }
}

async function waitForLoadStateCore(
  stateName: LoadState,
  options: WaitForLoadStateOptions,
) {
  if (stateName === "networkidle") {
    return waitForNetworkIdle(options);
  }
  return waitForDocumentLoad({
    timeout: options.timeout,
    until: stateName === "domcontentloaded" ? "domcontentloaded" : "load",
  });
}

function normalizeLoadStateArgs(
  loadState: LoadState | WaitForLoadStateOptions,
  options: WaitForLoadStateOptions,
): [LoadState, WaitForLoadStateOptions] {
  if (loadState && typeof loadState === "object") {
    return ["load", loadState];
  }
  return [(loadState || "load") as LoadState, options];
}

function urlMatches(current, matcher) {
  if (matcher instanceof RegExp) {
    matcher.lastIndex = 0;
    return matcher.test(current);
  }
  if (typeof matcher === "function") {
    return Boolean(matcher(new URL(current)));
  }
  if (typeof matcher !== "string") {
    throw new TypeError(
      `waitForURL expects a string, RegExp, or function matcher, got ${matcher === null ? "null" : typeof matcher}`,
    );
  }
  if (matcher.includes("*")) {
    return globToRegExp(matcher).test(current);
  }
  return current === matcher;
}

function globToRegExp(glob) {
  let source = "^";
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];
    if (char === "*") {
      if (glob[i + 1] === "*") {
        source += ".*";
        i += 1;
      } else {
        source += "[^/]*";
      }
    } else {
      source += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  return new RegExp(`${source}$`);
}

async function waitForNetworkMatch(
  kind: "request" | "response",
  matcher,
  options: WaitForNetworkOptions,
) {
  const timeout = networkTimeout(options);
  const networkEvents = acquireNetworkEvents(networkSession(), timeout);
  const monitor = createNetworkLifecycleMonitor(networkEvents);
  const abortController = new AbortController();
  let matched: any;
  let retained = false;
  let timedOut = false;
  const eventPromise = waitForBrowserEvent(
    async (event) => {
      const expectedSessionId = await networkEvents.sessionId;
      if (
        expectedSessionId &&
        event?.sessionId &&
        event.sessionId !== expectedSessionId
      ) {
        return false;
      }
      matched = await processNetworkEvent(kind, matcher, event, monitor);
      return Boolean(matched);
    },
    browserEventTimeout(timeout),
    abortController.signal,
  );
  // The event waiter is registered before Network.enable completes so an
  // immediate request cannot race setup. Handle its rejection while setup is
  // pending; the original promise remains awaitable below.
  void eventPromise.catch(() => {});
  try {
    await Promise.all([networkEvents.ready, eventPromise]);
    await monitor.retain(
      matched.request,
      kind === "response" ? matched.facade : undefined,
    );
    retained = true;
    return matched.facade;
  } catch (error) {
    if (/page\.waitForEvent timed out/i.test(error?.message || "")) {
      timedOut = true;
      throw operationTimeout(
        `page.waitFor${kind === "request" ? "Request" : "Response"}`,
        timeout,
      );
    }
    throw error;
  } finally {
    abortController.abort();
    await eventPromise.catch(() => {});
    if (!retained) {
      const release = monitor.release();
      if (timedOut) {
        // A hung Network.enable belongs to transport cleanup, not the public
        // wait budget. It remains guarded by the same CDP timeout while the
        // caller receives the requested TimeoutError immediately.
        void release.catch(() => {});
      } else {
        await release;
      }
    }
  }
}

async function processNetworkEvent(kind, matcher, event, monitor) {
  const method = event?.method;
  const params = event?.params || {};
  if (method === "Network.requestWillBeSent") {
    const request = monitor.requestForEvent(event);
    if (kind === "response" && params.redirectResponse) {
      const previousRequest = request?.redirectedFrom;
      const response = createResponseFacade({
        requestId: params.requestId,
        response: params.redirectResponse,
        request: previousRequest,
        sessionId: event?.sessionId,
        finished: true,
      });
      if (await networkMatches(response, matcher, kind)) {
        return {
          facade: response,
          request: request || responseLifecycleInfo(response)?.request,
        };
      }
    }
    if (kind === "request") {
      const facade = createRequestFacade(request);
      if (await networkMatches(facade, matcher, kind)) {
        return { facade, request };
      }
    }
    return null;
  }
  if (kind === "response" && method === "Network.responseReceived") {
    const request = monitor.requestForEvent(event);
    const response = createResponseFacade({
      requestId: params.requestId,
      response: params.response || {},
      request,
      sessionId: event?.sessionId,
    });
    if (await networkMatches(response, matcher, kind)) {
      return {
        facade: response,
        request: request || responseLifecycleInfo(response)?.request,
      };
    }
  }
  return null;
}

async function networkMatches(facade, matcher, kind) {
  if (typeof matcher === "string") {
    return facade.url() === matcher;
  }
  if (matcher instanceof RegExp) {
    matcher.lastIndex = 0;
    return matcher.test(facade.url());
  }
  if (typeof matcher === "function") {
    return Boolean(await matcher(facade));
  }
  throw new TypeError(
    `page.waitFor${kind === "request" ? "Request" : "Response"} expects a string, RegExp, or function matcher, got ${matcher === null ? "null" : typeof matcher}`,
  );
}

function networkTimeout(options: WaitForNetworkOptions) {
  const timeout = normalizeTimeout(
    "network wait",
    options.timeout ?? state.defaultTimeout,
  );
  return timeout;
}

function browserEventTimeout(timeout) {
  return Math.min(timeout, 2147483647);
}

/**
 * Wait until an element exists, optionally requiring visibility.
 * @param {string} selector CSS selector / @ref / loc= / xpath= to poll.
 * @param {{timeout?: number, state?: "visible"|"attached"|"hidden"|"detached"}} [options] timeout in milliseconds; state defaults to "visible".
 * @returns {Promise<true|null>} True for attached/visible, null for hidden/detached.
 */
export async function waitForSelector(
  selector: string | LocatorTarget,
  options: WaitForSelectorOptions = {},
) {
  const timeout = normalizeTimeout(
    "page.waitForSelector",
    options.timeout ?? state.defaultTimeout,
  );
  const targetState = options.state ?? "visible";
  if (!["visible", "attached", "hidden", "detached"].includes(targetState)) {
    throw new TypeError(
      `unsupported waitForSelector state: ${JSON.stringify(targetState)}`,
    );
  }
  const requireVisible = targetState === "visible" || targetState === "hidden";
  const waitForAbsence = targetState === "hidden" || targetState === "detached";
  const deadline = timeoutDeadline(timeout, state.now());
  const visibilityFn =
    "function(){const r=this.getBoundingClientRect();if(typeof this.checkVisibility==='function')return r.width>0&&r.height>0&&this.checkVisibility({checkOpacity:false,checkVisibilityCSS:true});const s=getComputedStyle(this);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';}";
  while (state.now() < deadline) {
    let handle;
    try {
      handle = await resolveHandle(selector);
    } catch (err) {
      if (err instanceof ElementResolutionError && err.kind === "transient") {
        if (waitForAbsence) return null;
        await state.sleep(300);
        continue; // not found / not ready yet — keep polling.
      }
      throw err; // permanent (bad selector / ambiguous) or unknown error — fail loud.
    }
    try {
      if (!requireVisible) return true;
      const response = await cdp(
        "Runtime.callFunctionOn",
        {
          functionDeclaration: visibilityFn,
          objectId: handle.objectId,
          returnByValue: true,
          awaitPromise: false,
        },
        handle.sessionId,
      );
      const visible =
        handle.frameVisible !== false && Boolean(response.result?.value);
      if (targetState === "visible" && visible) return true;
      if (targetState === "hidden" && !visible) return null;
    } catch (error) {
      if (isEgoHardStopError(error)) throw error;
      // visibility check failed (element raced away); treat as not-ready, keep polling.
    } finally {
      await releaseHandle(handle.objectId, handle.sessionId);
    }
    await state.sleep(300);
  }
  throw operationTimeout("page.waitForSelector", timeout);
}

/**
 * Wait until network events are idle. Module-private; reachable through
 * waitForLoadState("networkidle").
 * Enables the CDP Network domain for the duration of the wait so that network
 * events are actually delivered (previously nothing enabled the domain, so this
 * could report "idle" without ever observing traffic). If the caller had
 * already enabled the domain, it is left enabled on return. Best-effort: if
 * the runtime does not deliver Network events, an idle window of idleMs still
 * resolves true.
 * @param {{timeout?: number, idleMs?: number}} [options] timeout & idleMs in milliseconds.
 * @returns {Promise<boolean>} True when idle before timeout.
 */
async function waitForNetworkIdle(options: WaitForLoadStateOptions = {}) {
  const timeout = normalizeTimeout(
    "page.waitForLoadState",
    options.timeout ?? state.defaultTimeout,
  );
  const idleMs = options.idleMs ?? 500;
  const deadline = timeoutDeadline(timeout, state.now());
  let lastActivity = state.now();
  const inflight = new Set();
  const networkEvents = acquireNetworkEvents(networkSession(), timeout);
  try {
    await networkEvents.ready;
    const expectedSessionId = await networkEvents.sessionId;
    while (state.now() < deadline) {
      for (const event of await drainEvents()) {
        if (
          expectedSessionId &&
          event?.sessionId &&
          event.sessionId !== expectedSessionId
        ) {
          continue;
        }
        const method = event.method || "";
        const params = event.params || {};
        if (method === "Network.requestWillBeSent") {
          inflight.add(params.requestId);
          lastActivity = state.now();
        } else if (
          method === "Network.loadingFinished" ||
          method === "Network.loadingFailed"
        ) {
          inflight.delete(params.requestId);
          lastActivity = state.now();
        } else if (method.startsWith("Network.")) {
          lastActivity = state.now();
        }
      }
      if (inflight.size === 0 && state.now() - lastActivity >= idleMs) {
        return true;
      }
      await state.sleep(100);
    }
    return false;
  } finally {
    await networkEvents.release();
  }
}

function networkSession() {
  if (!isBrowserRuntime()) return state.sessionId || undefined;
  return currentTargetContext()?.sessionId || ensureSession();
}
