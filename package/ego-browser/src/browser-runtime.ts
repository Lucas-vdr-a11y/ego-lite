import { state } from "./state.js";
import { assertNoEgoError, buildEgoError } from "./ego-errors.js";
import { currentTargetContext } from "./target-context.js";
import { targetClosedError } from "./playwright-errors.js";

const RESPONSE_TIMEOUT_MS = 15000;
const SESSION_TTL_MS = 2000;
const KEEP_ALIVE_INTERVAL_MS = 2147483647;
// Upper bound for buffered CDP events. The runtime can be long-lived (installEgoSdk
// inside the browser); without a cap, undrained events grow without bound.
const MAX_BUFFERED_EVENTS = 10000;
const SESSION_LOST =
  /Session (?:with given id )?not found|Target closed|No session|No target with given id found/i;
const BROWSER_LEVEL = (method) =>
  method.startsWith("Target.") || method.startsWith("Browser.");
type BrowserEventSubscriber = {
  method: string;
  sessionId?: string;
  listener: (event: any) => void;
};
let nextMessageId = 1;
const pending = new Map();
const events = [];
const eventWaiters = [];
const eventSubscribers = new Set<BrowserEventSubscriber>();
const pageEnabledSessions = new Set();
const pendingDialogs = new Map();
const networkCompletions = new Map();
export function isBrowserRuntime() {
  return Boolean(
    globalThis.ego && typeof globalThis.ego.sendCDPMessage === "function",
  );
}

export function browserEgo() {
  if (!globalThis.ego) {
    throw new Error("browser runtime is not available");
  }
  return globalThis.ego;
}

function rawCdp(
  method,
  params: any = {},
  sessionId = undefined,
  timeoutMs = RESPONSE_TIMEOUT_MS,
) {
  const runtime = browserEgo();
  runtime.onCDPMessage = handleMessage;
  runtime.onSendCDPMessageError = handleSendError;
  const id = nextMessageId++;
  const payload = JSON.stringify({
    id,
    method,
    params,
    ...(sessionId ? { sessionId } : {}),
  });
  return new Promise<any>((resolve, reject) => {
    const cancelTimer =
      timeoutMs === 0
        ? keepProcessAlive()
        : timeoutCancellation(timeoutMs, () => {
            pending.delete(id);
            reject(new Error(`CDP request timed out: ${method}`));
          });
    pending.set(id, {
      resolve: (response) => {
        cancelTimer();
        resolve(response);
      },
      reject: (error) => {
        cancelTimer();
        reject(error);
      },
    });
    try {
      runtime.sendCDPMessage(payload);
    } catch (error) {
      cancelTimer();
      pending.delete(id);
      reject(error);
    }
  });
}

export async function browserCdp(
  method,
  params: any = {},
  sessionId = undefined,
  timeoutMs = RESPONSE_TIMEOUT_MS,
) {
  // Test mock: cdpOverride bypasses everything including session injection.
  if (state.cdpOverride) {
    return state.cdpOverride(method, params, sessionId, timeoutMs);
  }
  const explicit = sessionId !== undefined;
  let effective = sessionId;
  if (!explicit && !BROWSER_LEVEL(method)) {
    effective = await ensureSession();
  }
  try {
    return await rawCdp(method, params, effective, timeoutMs);
  } catch (error) {
    const lost = SESSION_LOST.test(error?.message || "");
    const targetContext = currentTargetContext();
    const contextualSession =
      targetContext && (!explicit || effective === targetContext.sessionId);
    if (lost && contextualSession && !BROWSER_LEVEL(method)) {
      clearTargetContextSession(targetContext);
      const fresh = await ensureSession();
      try {
        return await rawCdp(method, params, fresh, timeoutMs);
      } catch (retryError) {
        if (SESSION_LOST.test(retryError?.message || "")) {
          clearTargetContextSession(targetContext);
          throw targetClosedError(targetContext.targetId);
        }
        throw retryError;
      }
    }
    if (lost && !explicit && !BROWSER_LEVEL(method)) {
      invalidateSession();
      const fresh = await ensureSession();
      return rawCdp(method, params, fresh, timeoutMs);
    }
    throw error;
  }
}

function clearTargetContextSession(targetContext) {
  const sessionId = targetContext.sessionId;
  if (sessionId) {
    pageEnabledSessions.delete(sessionId);
    pendingDialogs.delete(sessionId);
  }
  targetContext.sessionId = undefined;
  targetContext.sessionPromise = undefined;
  targetContext.dispose = undefined;
}

export async function ensureSession() {
  const targetContext = currentTargetContext();
  if (targetContext) {
    return ensureTargetSession(targetContext);
  }
  if (state.sessionId && Date.now() - state.sessionAt < SESSION_TTL_MS) {
    return state.sessionId;
  }
  if (state.sessionInflight) {
    return state.sessionInflight;
  }
  state.sessionInflight = (async () => {
    try {
      const result = assertNoEgoError(await browserEgo().listTabs());
      const tabs = result?.tabs || result?.targetInfos || [];
      const preferred = state.preferredTargetId
        ? tabs.find((t) => t.targetId === state.preferredTargetId)
        : null;
      const active =
        preferred || tabs.find((t) => t.active) || tabs[tabs.length - 1];
      if (!active) {
        throw new Error("no active tab to attach session");
      }
      const targetId = active.targetId;
      if (targetId !== state.sessionTargetId) {
        // CDP domains are scoped to a target session. Discard all cached
        // session-local state before attaching to a different tab.
        invalidateSession();
      }
      if (!state.sessionId) {
        const attached = await rawCdp(
          "Target.attachToTarget",
          { targetId, flatten: true },
          undefined,
        );
        state.sessionId = attached.result?.sessionId || attached.sessionId;
        state.sessionTargetId = targetId;
      }
      await enablePageEvents(state.sessionId);
      state.sessionAt = Date.now();
      return state.sessionId;
    } finally {
      state.sessionInflight = null;
    }
  })();
  return state.sessionInflight;
}

async function ensureTargetSession(targetContext) {
  if (targetContext.sessionId) return targetContext.sessionId;
  if (targetContext.sessionPromise) return targetContext.sessionPromise;
  targetContext.sessionPromise = (async () => {
    const result = assertNoEgoError(await browserEgo().listTabs());
    const tabs = result?.tabs || result?.targetInfos || [];
    if (!tabs.some((tab) => tab.targetId === targetContext.targetId)) {
      throw targetClosedError(targetContext.targetId);
    }
    let attached;
    try {
      attached = await rawCdp("Target.attachToTarget", {
        targetId: targetContext.targetId,
        flatten: true,
      });
    } catch (error) {
      if (SESSION_LOST.test(error?.message || "")) {
        throw targetClosedError(targetContext.targetId);
      }
      throw error;
    }
    const sessionId = attached.result?.sessionId || attached.sessionId;
    if (!sessionId) throw targetClosedError(targetContext.targetId);
    targetContext.sessionId = sessionId;
    targetContext.dispose = async () => {
      targetContext.sessionId = undefined;
      pageEnabledSessions.delete(sessionId);
      pendingDialogs.delete(sessionId);
      await rawCdp("Target.detachFromTarget", { sessionId }).catch(() => {});
    };
    await enablePageEvents(sessionId);
    return sessionId;
  })().finally(() => {
    targetContext.sessionPromise = undefined;
  });
  return targetContext.sessionPromise;
}

export function invalidateSession() {
  if (state.sessionId) {
    pageEnabledSessions.delete(state.sessionId);
    pendingDialogs.delete(state.sessionId);
  }
  state.sessionId = null;
  state.sessionTargetId = null;
  state.sessionAt = 0;
  state.networkDomainEnabled = false;
}

export function setPreferredTarget(targetId) {
  state.preferredTargetId = targetId || null;
}

export function clearPreferredTarget() {
  state.preferredTargetId = null;
}

export function drainBrowserEvents() {
  const out = events.splice(0, events.length);
  return out;
}

export function waitForBrowserEvent(
  predicate,
  timeoutMs = state.defaultTimeout,
  signal: AbortSignal | undefined = undefined,
) {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      const reason = signal?.reason;
      rejectEventWaiter(
        waiter,
        reason instanceof Error
          ? reason
          : new Error("Browser event wait was aborted"),
      );
    };
    const waiter: any = {
      predicate,
      resolve,
      reject,
      processing: Promise.resolve(),
      cancelTimer: () => {},
      cleanup: () => signal?.removeEventListener("abort", onAbort),
    };
    if (signal?.aborted) {
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new Error("Browser event wait was aborted"),
      );
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    waiter.cancelTimer =
      timeoutMs === 0
        ? keepProcessAlive()
        : timeoutCancellation(timeoutMs, () => {
            rejectEventWaiter(waiter, new Error("page.waitForEvent timed out"));
          });
    eventWaiters.push(waiter);
  });
}

export function subscribeBrowserEvent(
  method: string,
  sessionId: string | undefined,
  listener: (event: any) => void,
) {
  const subscriber = { method, sessionId, listener };
  eventSubscribers.add(subscriber);
  return () => eventSubscribers.delete(subscriber);
}

export function pendingDialog(sessionId = state.sessionId) {
  if (sessionId && pendingDialogs.has(sessionId)) {
    return { ...pendingDialogs.get(sessionId) };
  }
  return null;
}

export function networkCompletion(requestId, sessionId = undefined) {
  return networkCompletions.get(networkCompletionKey(requestId, sessionId));
}

async function enablePageEvents(sessionId) {
  if (!sessionId || pageEnabledSessions.has(sessionId)) {
    return;
  }
  try {
    await rawCdp("Page.enable", {}, sessionId);
    pageEnabledSessions.add(sessionId);
  } catch {
    // Dialog tracking is best-effort. Do not make all helpers fail on targets
    // that reject Page.enable, such as unusual internal pages.
  }
}

// Local send failures for ego.sendCDPMessage() arrive here (task inactive,
// user-controlled, not selected/claimed, host gone) instead of as a CDP
// response, so the matching request would otherwise sit until the 15s timeout.
// The callback carries no request id; these failures are task-level (every
// in-flight send fails the same way), so reject all pending requests, routing
// the stable code through buildEgoError to use the ego-browser-owned wording.
function handleSendError(message, error_code) {
  if (pending.size === 0) return;
  const error = buildEgoError({ error: message, error_code });
  const entries = [...pending.values()];
  pending.clear();
  for (const entry of entries) entry.reject(error);
}

function handleMessage(message) {
  let data;
  try {
    data = JSON.parse(message);
  } catch {
    return;
  }
  if (Object.hasOwn(data, "id")) {
    const entry = pending.get(data.id);
    if (!entry) {
      return;
    }
    pending.delete(data.id);
    if (data.error) {
      entry.reject(new Error(data.error.message || data.error));
      return;
    }
    entry.resolve(data);
    return;
  }
  if (
    data.method === "Target.detachedFromTarget" ||
    data.method === "Target.targetDestroyed"
  ) {
    const sessionId = data.params?.sessionId || data.sessionId;
    if (sessionId) {
      pageEnabledSessions.delete(sessionId);
      pendingDialogs.delete(sessionId);
    }
    const targetId = data.params?.targetId || data.params?.targetInfo?.targetId;
    if (targetId && targetId === state.sessionTargetId) {
      invalidateSession();
    }
  }
  if (data.method === "Network.requestWillBeSent") {
    networkCompletions.delete(
      networkCompletionKey(data.params?.requestId, data.sessionId),
    );
  } else if (
    data.method === "Network.loadingFinished" ||
    data.method === "Network.loadingFailed"
  ) {
    networkCompletions.set(
      networkCompletionKey(data.params?.requestId, data.sessionId),
      data.method === "Network.loadingFailed"
        ? {
            errorText: data.params?.errorText || "Request failed",
          }
        : { errorText: null },
    );
    if (networkCompletions.size > 1000) {
      const oldest = networkCompletions.keys().next().value;
      networkCompletions.delete(oldest);
    }
  }
  if (data.method === "Page.javascriptDialogOpening") {
    const sessionId = data.sessionId || state.sessionId;
    if (sessionId) {
      pendingDialogs.set(sessionId, data.params || {});
    }
  } else if (data.method === "Page.javascriptDialogClosed") {
    const sessionId = data.sessionId || state.sessionId;
    if (sessionId) {
      pendingDialogs.delete(sessionId);
    }
  }
  let deliveredToSubscriber = false;
  for (const subscriber of eventSubscribers) {
    if (subscriber.method !== data.method) continue;
    if (subscriber.sessionId && subscriber.sessionId !== data.sessionId) {
      continue;
    }
    deliveredToSubscriber = true;
    try {
      subscriber.listener(data);
    } catch (error) {
      console.error("Browser event subscriber failed:", error);
    }
  }
  if (!(deliveredToSubscriber && data.method === "Page.screencastFrame")) {
    events.push(data);
    if (events.length > MAX_BUFFERED_EVENTS) {
      events.splice(0, events.length - MAX_BUFFERED_EVENTS);
    }
  }
  for (const waiter of [...eventWaiters]) {
    waiter.processing = waiter.processing
      .then(async () => {
        if (!eventWaiters.includes(waiter)) return;
        if (await waiter.predicate(data)) resolveEventWaiter(waiter, data);
      })
      .catch((error) => rejectEventWaiter(waiter, error));
  }
}

function networkCompletionKey(requestId, sessionId) {
  return `${sessionId || ""}:${requestId || ""}`;
}

function resolveEventWaiter(waiter, data) {
  const index = eventWaiters.indexOf(waiter);
  if (index < 0) return;
  waiter.cancelTimer?.();
  eventWaiters.splice(index, 1);
  waiter.cleanup?.();
  waiter.resolve(data);
}

function rejectEventWaiter(waiter, error) {
  const index = eventWaiters.indexOf(waiter);
  if (index < 0) return;
  waiter.cancelTimer?.();
  eventWaiters.splice(index, 1);
  waiter.cleanup?.();
  waiter.reject(error);
}

function timeoutCancellation(timeoutMs: number, onTimeout: () => void) {
  const timer = setTimeout(onTimeout, timeoutMs);
  return () => clearTimeout(timer);
}

function keepProcessAlive() {
  // Native bridge callbacks do not hold Node's event loop open. A disabled
  // timeout still needs one inert handle so a top-level await can receive a
  // future CDP response or event instead of exiting with code 13.
  const timer = setInterval(() => {}, KEEP_ALIVE_INTERVAL_MS);
  return () => clearInterval(timer);
}

export function browserSnapshotRefsToRefMap(refMap, refs = []) {
  refMap.clear();
  for (const ref of refs) {
    if (!ref || typeof ref !== "object") {
      continue;
    }
    if (ref.backendNodeId === undefined || ref.backendNodeId === null) {
      continue;
    }
    refMap.add(
      String(ref.backendNodeId),
      ref.backendNodeId,
      ref.role,
      ref.name,
      undefined,
    );
  }
}
