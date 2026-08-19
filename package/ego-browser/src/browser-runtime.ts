import { state } from "./state.js";
import { assertNoEgoError, buildEgoError } from "./ego-errors.js";

const RESPONSE_TIMEOUT_MS = 15000;
const SESSION_TTL_MS = 2000;
// Upper bound for buffered CDP events. The runtime can be long-lived (installEgoSdk
// inside the browser); without a cap, undrained events grow without bound.
const MAX_BUFFERED_EVENTS = 10000;
const SESSION_LOST =
  /Session (?:with given id )?not found|Target closed|No session/i;
const BROWSER_LEVEL = (method) =>
  method.startsWith("Target.") || method.startsWith("Browser.");
let nextMessageId = 1;
const pending = new Map();
const browserEvents = [];
const targetStates = new Map();
const sessionTargets = new Map();
let defaultTargetId = null;

function targetState(targetId) {
  let target = targetStates.get(targetId);
  if (!target) {
    target = {
      targetId,
      sessionId: null,
      sessionAt: 0,
      sessionInflight: null,
      events: [],
      pageEventsEnabled: false,
      networkDomainEnabled: false,
      pendingDialog: null,
    };
    targetStates.set(targetId, target);
  }
  return target;
}

function registerSession(targetId, sessionId) {
  const target = targetState(targetId);
  if (target.sessionId === sessionId) {
    target.sessionAt = Date.now();
    sessionTargets.set(sessionId, targetId);
    return target;
  }
  if (target.sessionId && target.sessionId !== sessionId) {
    sessionTargets.delete(target.sessionId);
  }
  target.sessionId = sessionId;
  target.sessionAt = Date.now();
  target.pageEventsEnabled = false;
  target.networkDomainEnabled = false;
  target.pendingDialog = null;
  sessionTargets.set(sessionId, targetId);
  return target;
}

function clearTargetSession(targetId, { remove = false } = {}) {
  const target = targetStates.get(targetId);
  if (!target) return;
  if (target.sessionId) {
    sessionTargets.delete(target.sessionId);
  }
  if (remove) {
    targetStates.delete(targetId);
    if (defaultTargetId === targetId) defaultTargetId = null;
    return;
  }
  target.sessionId = null;
  target.sessionAt = 0;
  target.sessionInflight = null;
  target.events.length = 0;
  target.pageEventsEnabled = false;
  target.networkDomainEnabled = false;
  target.pendingDialog = null;
}

function capEvents(events) {
  if (events.length > MAX_BUFFERED_EVENTS) {
    events.splice(0, events.length - MAX_BUFFERED_EVENTS);
  }
}

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
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP request timed out: ${method}`));
    }, timeoutMs);
    pending.set(id, {
      resolve: (response) => {
        clearTimeout(timer);
        resolve(response);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    try {
      runtime.sendCDPMessage(payload);
    } catch (error) {
      clearTimeout(timer);
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
    return state.cdpOverride(method, params, sessionId);
  }
  const explicit = sessionId !== undefined;
  let effective = sessionId;
  if (!explicit && !BROWSER_LEVEL(method)) {
    effective = await ensureSession();
  }
  try {
    const response = await rawCdp(method, params, effective, timeoutMs);
    recordCommandState(method, params, effective, response);
    return response;
  } catch (error) {
    const lost = SESSION_LOST.test(error?.message || "");
    if (lost && !explicit && !BROWSER_LEVEL(method)) {
      const lostTargetId = effective
        ? sessionTargets.get(effective)
        : defaultTargetId;
      if (lostTargetId) clearTargetSession(lostTargetId);
      const fresh = await ensureSession(lostTargetId);
      const response = await rawCdp(method, params, fresh, timeoutMs);
      recordCommandState(method, params, fresh, response);
      return response;
    }
    throw error;
  }
}

function recordCommandState(method, params, sessionId, response) {
  if (method === "Target.attachToTarget") {
    const attachedSessionId = response.result?.sessionId || response.sessionId;
    if (params?.targetId && attachedSessionId) {
      registerSession(params.targetId, attachedSessionId);
    }
    return;
  }
  if (method === "Target.detachFromTarget" && params?.sessionId) {
    const targetId = sessionTargets.get(params.sessionId);
    if (targetId) clearTargetSession(targetId);
    return;
  }
  if (!sessionId) return;
  const targetId = sessionTargets.get(sessionId);
  if (!targetId) return;
  const target = targetStates.get(targetId);
  if (!target) return;
  if (method === "Network.enable") target.networkDomainEnabled = true;
  if (method === "Network.disable") target.networkDomainEnabled = false;
}

export async function ensureSession(requestedTargetId = undefined) {
  const cachedTargetId =
    requestedTargetId || state.preferredTargetId || defaultTargetId;
  const cached = cachedTargetId ? targetStates.get(cachedTargetId) : undefined;
  if (cached?.sessionId && Date.now() - cached.sessionAt < SESSION_TTL_MS) {
    return cached.sessionId;
  }

  let targetId = requestedTargetId;
  if (!targetId) {
    const result = assertNoEgoError(await browserEgo().listTabs());
    const tabs = result?.tabs || result?.targetInfos || [];
    const preferred = state.preferredTargetId
      ? tabs.find((tab) => tab.targetId === state.preferredTargetId)
      : null;
    const active =
      preferred || tabs.find((tab) => tab.active) || tabs[tabs.length - 1];
    if (!active) {
      throw new Error("no active tab to attach session");
    }
    targetId = active.targetId;
  }

  defaultTargetId = targetId;
  const target = targetState(targetId);
  if (target.sessionInflight) {
    return target.sessionInflight;
  }
  target.sessionInflight = (async () => {
    try {
      if (!target.sessionId) {
        const attached = await rawCdp(
          "Target.attachToTarget",
          { targetId, flatten: true },
          undefined,
        );
        const sessionId = attached.result?.sessionId || attached.sessionId;
        if (!sessionId) {
          throw new Error("Target.attachToTarget returned no sessionId");
        }
        registerSession(targetId, sessionId);
      }
      await enablePageEvents(target.sessionId);
      target.sessionAt = Date.now();
      return target.sessionId;
    } finally {
      target.sessionInflight = null;
    }
  })();
  return target.sessionInflight;
}

export function invalidateSession(targetId = undefined) {
  if (targetId) {
    clearTargetSession(targetId, { remove: true });
    return;
  }
  for (const knownTargetId of [...targetStates.keys()]) {
    clearTargetSession(knownTargetId, { remove: true });
  }
  browserEvents.length = 0;
  defaultTargetId = null;
}

export function setPreferredTarget(targetId) {
  state.preferredTargetId = targetId || null;
}

export function clearPreferredTarget() {
  state.preferredTargetId = null;
}

export function drainBrowserEvents(sessionId = undefined) {
  const targetId = sessionId
    ? sessionTargets.get(sessionId)
    : state.preferredTargetId || defaultTargetId;
  const target = targetId ? targetStates.get(targetId) : undefined;
  const out = browserEvents.splice(0, browserEvents.length);
  if (target) out.push(...target.events.splice(0, target.events.length));
  return out;
}

/** Drain only events routed to one Page session. */
export function drainPageEvents(sessionId) {
  const targetId = sessionId ? sessionTargets.get(sessionId) : undefined;
  const target = targetId ? targetStates.get(targetId) : undefined;
  return target ? target.events.splice(0, target.events.length) : [];
}

export function pendingDialog(sessionId) {
  const targetId = sessionId
    ? sessionTargets.get(sessionId)
    : state.preferredTargetId || defaultTargetId;
  const dialog = targetId ? targetStates.get(targetId)?.pendingDialog : null;
  return dialog ? { ...dialog } : null;
}

export function isNetworkDomainEnabled(sessionId) {
  const targetId = sessionId ? sessionTargets.get(sessionId) : undefined;
  return targetId
    ? Boolean(targetStates.get(targetId)?.networkDomainEnabled)
    : false;
}

async function enablePageEvents(sessionId) {
  const targetId = sessionId ? sessionTargets.get(sessionId) : undefined;
  const target = targetId ? targetStates.get(targetId) : undefined;
  if (!target || target.pageEventsEnabled) {
    return;
  }
  try {
    await rawCdp("Page.enable", {}, sessionId);
    target.pageEventsEnabled = true;
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
    const targetId =
      (sessionId ? sessionTargets.get(sessionId) : undefined) ||
      data.params?.targetId ||
      data.params?.targetInfo?.targetId;
    if (targetId) {
      clearTargetSession(targetId, {
        remove: data.method === "Target.targetDestroyed",
      });
    }
  } else if (data.method === "Target.attachedToTarget") {
    const sessionId = data.params?.sessionId;
    const targetId = data.params?.targetInfo?.targetId;
    if (sessionId && targetId) registerSession(targetId, sessionId);
  }
  const sessionId = data.sessionId;
  const targetId = sessionId ? sessionTargets.get(sessionId) : undefined;
  const target = targetId ? targetStates.get(targetId) : undefined;
  if (data.method === "Page.javascriptDialogOpening") {
    if (target) target.pendingDialog = data.params || {};
  } else if (data.method === "Page.javascriptDialogClosed") {
    if (target) target.pendingDialog = null;
  }
  const events = target ? target.events : browserEvents;
  events.push(data);
  capEvents(events);
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
