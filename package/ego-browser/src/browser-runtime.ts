import { state } from "./state.js";
import {
  buildEgoError,
  invokeEgo,
  isEgoUserControlError,
} from "./ego-errors.js";

const RESPONSE_TIMEOUT_MS = 15000;
const SESSION_TTL_MS = 2000;
// Upper bound for buffered CDP events. The runtime can be long-lived (installEgoSdk
// inside the browser); without a cap, undrained events grow without bound.
const MAX_BUFFERED_EVENTS = 10000;
const SESSION_LOST =
  /Session (?:with given id )?not found|Target closed|No session/i;
const BROWSER_LEVEL = (method) =>
  method.startsWith("Target.") || method.startsWith("Browser.");
const DIALOG_BLOCKED_METHOD = (method) =>
  method.startsWith("Input.") ||
  method.startsWith("Runtime.") ||
  method === "DOM.setFileInputFiles" ||
  method === "Page.navigate";
let nextMessageId = 1;
const pending = new Map();
const browserEvents = [];
const browserEventSubscribers = new Set<(event: any) => void>();
const targetStates = new Map();
const sessionTargets = new Map();
const childTargets = new Map<string, Set<string>>();
const parentTargets = new Map<string, string>();
let defaultTargetId = null;
let userControlProbeState: "idle" | "probing" | "stopped" = "idle";
let userControlStopError: (Error & { error_code?: string }) | null = null;
let userControlProbeGeneration = 0;
type EgoCdpCallbackRuntime = {
  onCDPMessage?: (payload: string) => void;
  onSendCDPMessageError?: (message: unknown, errorCode?: string) => void;
};
let callbackRuntime: EgoCdpCallbackRuntime | undefined;

/**
 * Signals that a modal JavaScript dialog prevented a CDP command from
 * completing. The dialog remains open; Page-level code decides whether to
 * expose it in an action receipt or surface this error to the caller.
 */
export class PageDialogOpenedError extends Error {
  readonly code = "EGO_PAGE_DIALOG_OPENED";
  readonly method: string;
  readonly sessionId: string;
  readonly dialog: Record<string, unknown>;

  constructor(
    method: string,
    sessionId: string,
    dialog: Record<string, unknown>,
  ) {
    super(
      `a JavaScript dialog opened while ${method} was running; handle the dialog before continuing`,
    );
    this.name = "PageDialogOpenedError";
    this.method = method;
    this.sessionId = sessionId;
    this.dialog = { ...dialog };
  }
}

export function isPageDialogOpenedError(
  error: unknown,
): error is PageDialogOpenedError {
  return (
    error instanceof PageDialogOpenedError ||
    (Boolean(error) &&
      typeof error === "object" &&
      (error as { code?: unknown }).code === "EGO_PAGE_DIALOG_OPENED")
  );
}

export type FileChooserOpenedEvent = {
  backendNodeId: number;
  frameId?: string;
  mode?: "selectSingle" | "selectMultiple";
};

export type FileChooserInterception = {
  ready: Promise<void>;
  event: Promise<FileChooserOpenedEvent>;
  peek(): FileChooserOpenedEvent | undefined;
  dispose(reason?: Error): Promise<void>;
};

function targetState(targetId) {
  let target = targetStates.get(targetId);
  if (!target) {
    target = {
      sessionId: null,
      sessionAt: 0,
      sessionInflight: null,
      events: [],
      pageEventsEnabled: false,
      networkDomainEnabled: false,
      pendingDialog: null,
      fileChooserInterception: null,
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
    return;
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
}

function registerTargetParent(targetId: string, parentTargetId: string) {
  const previousParent = parentTargets.get(targetId);
  if (previousParent === parentTargetId) return;
  if (previousParent) {
    const previousChildren = childTargets.get(previousParent);
    previousChildren?.delete(targetId);
    if (previousChildren?.size === 0) childTargets.delete(previousParent);
  }
  parentTargets.set(targetId, parentTargetId);
  let children = childTargets.get(parentTargetId);
  if (!children) {
    children = new Set();
    childTargets.set(parentTargetId, children);
  }
  children.add(targetId);
}

function unregisterTargetParent(targetId: string) {
  const parentTargetId = parentTargets.get(targetId);
  if (!parentTargetId) return;
  parentTargets.delete(targetId);
  const siblings = childTargets.get(parentTargetId);
  siblings?.delete(targetId);
  if (siblings?.size === 0) childTargets.delete(parentTargetId);
}

function clearTargetSession(targetId, { remove = false } = {}) {
  const target = targetStates.get(targetId);
  if (!target) return;
  rejectFileChooserInterception(
    target,
    new Error("file chooser session was detached"),
  );
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
  target.fileChooserInterception = null;
}

function clearTargetSessionTree(targetId: string, { remove = false } = {}) {
  for (const childTargetId of [...(childTargets.get(targetId) || [])]) {
    clearTargetSessionTree(childTargetId, { remove: true });
  }
  clearTargetSession(targetId, { remove });
  if (remove) {
    childTargets.delete(targetId);
    unregisterTargetParent(targetId);
  }
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

/** Keep exceptions from crossing the native-to-JavaScript callback boundary. */
function guardNativeCallback(label: string, callback: () => void): void {
  try {
    callback();
  } catch (error) {
    try {
      console.error(`[ego-browser] ${label} failed:`, error);
    } catch {
      // Error reporting must not re-enter the native callback failure.
    }
  }
}

function dispatchCdpMessage(payload: string): void {
  guardNativeCallback("onCDPMessage", () => handleMessage(payload));
}

function dispatchCdpSendError(message: unknown, errorCode?: string): void {
  guardNativeCallback("onSendCDPMessageError", () =>
    handleSendError(message, errorCode),
  );
}

function bindRuntimeCallbacks(runtime: EgoCdpCallbackRuntime): void {
  if (callbackRuntime && callbackRuntime !== runtime) {
    releaseRuntimeCallbacks(callbackRuntime);
  }
  runtime.onCDPMessage = dispatchCdpMessage;
  runtime.onSendCDPMessageError = dispatchCdpSendError;
  callbackRuntime = runtime;
}

/** Release only callbacks installed by this runtime, preserving foreign owners. */
export function releaseRuntimeCallbacks(
  runtime: EgoCdpCallbackRuntime | undefined = callbackRuntime,
): void {
  if (!runtime) return;
  if (runtime.onCDPMessage === dispatchCdpMessage) {
    runtime.onCDPMessage = undefined;
  }
  if (runtime.onSendCDPMessageError === dispatchCdpSendError) {
    runtime.onSendCDPMessageError = undefined;
  }
  if (callbackRuntime === runtime) callbackRuntime = undefined;
}

/** Stop all runtime work before an embedded Node context is discarded. */
export function disposeBrowserRuntime(
  runtime: EgoCdpCallbackRuntime | undefined = callbackRuntime,
): void {
  releaseRuntimeCallbacks(runtime);
  rejectAllPending(new Error("ego-browser runtime was disposed"));
  browserEventSubscribers.clear();
  invalidateSession();
}

/** Subscribe to Target/Browser events without consuming the legacy event queue. */
export function subscribeBrowserEvents(
  listener: (event: any) => void,
): () => void {
  if (typeof listener !== "function") {
    throw new TypeError("browser event listener must be a function");
  }
  browserEventSubscribers.add(listener);
  return () => browserEventSubscribers.delete(listener);
}

function rawCdp(
  method,
  params: any = {},
  sessionId = undefined,
  timeoutMs = RESPONSE_TIMEOUT_MS,
) {
  const runtime = browserEgo();
  bindRuntimeCallbacks(runtime);
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
      method,
      sessionId,
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
      reject(buildEgoError(error));
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
  // Include the effective timeout so tests can verify timing contracts without
  // waiting for a real CDP deadline.
  if (state.cdpOverride) {
    return state.cdpOverride(method, params, sessionId, timeoutMs);
  }
  const explicit = sessionId !== undefined;
  let effective = sessionId;
  if (!explicit && !BROWSER_LEVEL(method)) {
    effective = await ensureSession();
  }
  const dialog = effective ? pendingDialog(effective) : null;
  if (dialog && DIALOG_BLOCKED_METHOD(method)) {
    throw new PageDialogOpenedError(method, effective, dialog);
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
    const result: any = await invokeEgo("listTabs", () =>
      browserEgo().listTabs(),
    );
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

/**
 * Attach sessions for every live OOPIF that belongs to one top-level Page.
 * TargetInfo.parentId provides the ownership edge, so unrelated iframe targets
 * in the same task space are never searched by this Page.
 */
export async function ensureFrameSessions(pageTargetId: string) {
  if (typeof pageTargetId !== "string" || pageTargetId.length === 0) {
    throw new TypeError("ensureFrameSessions requires a non-empty targetId");
  }
  const pageSessionId = await ensureSession(pageTargetId);
  const [response, frameTreeResponse] = await Promise.all([
    browserCdp("Target.getTargets"),
    browserCdp("Page.getFrameTree", {}, pageSessionId),
  ]);
  const targetInfos =
    response?.result?.targetInfos || response?.targetInfos || [];
  const byParent = new Map<string, any[]>();
  for (const info of targetInfos) {
    if (
      info?.type !== "iframe" ||
      typeof info.targetId !== "string" ||
      typeof info.parentId !== "string"
    ) {
      continue;
    }
    const children = byParent.get(info.parentId) || [];
    children.push(info);
    byParent.set(info.parentId, children);
  }

  const descendants: any[] = [];
  const visit = (parentTargetId: string) => {
    for (const info of byParent.get(parentTargetId) || []) {
      descendants.push(info);
      visit(info.targetId);
    }
  };
  visit(pageTargetId);

  const liveTargetIds = new Set(
    descendants.map((info) => info.targetId as string),
  );
  const knownDescendants: string[] = [];
  const collectKnownDescendants = (parentTargetId: string) => {
    for (const childTargetId of childTargets.get(parentTargetId) || []) {
      knownDescendants.push(childTargetId);
      collectKnownDescendants(childTargetId);
    }
  };
  collectKnownDescendants(pageTargetId);
  for (const knownTargetId of knownDescendants.reverse()) {
    if (!liveTargetIds.has(knownTargetId)) {
      clearTargetSessionTree(knownTargetId, { remove: true });
    }
  }

  const sessions = new Map<string, string>();
  const frameTree =
    frameTreeResponse?.result?.frameTree || frameTreeResponse?.frameTree;
  const collectSameProcessFrames = (tree: any, isRoot = false) => {
    const frameId = tree?.frame?.id;
    if (!isRoot && typeof frameId === "string") {
      sessions.set(frameId, pageSessionId);
    }
    for (const child of tree?.childFrames || []) {
      collectSameProcessFrames(child);
    }
  };
  if (frameTree) collectSameProcessFrames(frameTree, true);
  for (const info of descendants) {
    registerTargetParent(info.targetId, info.parentId);
    sessions.set(info.targetId, await ensureSession(info.targetId));
  }
  return sessions;
}

export function invalidateSession(targetId = undefined) {
  if (targetId) {
    clearTargetSessionTree(targetId, { remove: true });
    return;
  }
  for (const knownTargetId of [...targetStates.keys()]) {
    clearTargetSession(knownTargetId, { remove: true });
  }
  browserEvents.length = 0;
  childTargets.clear();
  parentTargets.clear();
  defaultTargetId = null;
  resetUserControlProbe();
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

/**
 * Suppress the operating-system file picker and observe the next chooser in
 * one Page session. The caller owns the short-lived interception and must
 * dispose it after setting files or completing an input action.
 */
export function prepareFileChooser(
  sessionId: string,
  { timeoutMs, cancel }: { timeoutMs: number; cancel: boolean },
): FileChooserInterception {
  const targetId = sessionTargets.get(sessionId);
  const target = targetId ? targetStates.get(targetId) : undefined;
  if (!target) {
    throw new Error("cannot intercept a file chooser without a Page session");
  }
  if (target.fileChooserInterception) {
    throw new Error("this Page is already waiting for a file chooser");
  }

  let observed: FileChooserOpenedEvent | undefined;
  let resolveEvent!: (event: FileChooserOpenedEvent) => void;
  let rejectEvent!: (error: Error) => void;
  const event = new Promise<FileChooserOpenedEvent>((resolve, reject) => {
    resolveEvent = resolve;
    rejectEvent = reject;
  });
  // A safety interceptor normally consumes peek() instead of awaiting event.
  // Attach a rejection observer so disposal never creates an unhandled promise.
  void event.catch(() => {});

  const interception: any = {
    cancelPromise: undefined,
    event,
    reject: rejectEvent,
    resolve(value: FileChooserOpenedEvent) {
      if (observed) return;
      observed = value;
      clearTimeout(interception.timer);
      resolveEvent(value);
      if (cancel) {
        // An empty file list completes the intercepted chooser without opening
        // the native picker or changing the input's current selection.
        interception.cancelPromise = rawCdp(
          "DOM.setFileInputFiles",
          { files: [], backendNodeId: value.backendNodeId },
          sessionId,
        ).catch(() => {});
      }
    },
    peek() {
      return observed;
    },
    async dispose(reason?: Error) {
      if (target.fileChooserInterception !== interception) return;
      target.fileChooserInterception = null;
      clearTimeout(interception.timer);
      if (!observed && reason) rejectEvent(reason);
      await interception.ready.catch(() => {});
      await interception.cancelPromise;
      const disable = rawCdp(
        "Page.setInterceptFileChooserDialog",
        { enabled: false },
        sessionId,
      ).catch(() => {});
      if (target.pendingDialog) {
        // Chromium can hold this housekeeping response until the modal dialog
        // closes. Send it now, but do not keep the triggering action's gate
        // occupied; Page.handleJavaScriptDialog must be able to run next.
        void disable;
        return;
      }
      await disable;
    },
  };
  target.fileChooserInterception = interception;
  interception.ready = rawCdp(
    "Page.setInterceptFileChooserDialog",
    { enabled: true },
    sessionId,
  )
    .then(() => {
      interception.timer = setTimeout(() => {
        const error: any = new Error(
          `page.waitForFileChooser timed out after ${timeoutMs}ms`,
        );
        error.code = "EGO_FILE_CHOOSER_TIMEOUT";
        if (target.fileChooserInterception === interception) {
          target.fileChooserInterception = null;
          rejectEvent(error);
          void rawCdp(
            "Page.setInterceptFileChooserDialog",
            { enabled: false },
            sessionId,
          ).catch(() => {});
        }
      }, timeoutMs);
    })
    .catch((error) => {
      if (target.fileChooserInterception === interception) {
        target.fileChooserInterception = null;
      }
      rejectEvent(error);
      throw error;
    });
  return interception;
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

// Local send failures for ego.sendCDPMessage() arrive here instead of as a CDP
// response. The callback carries no request id, so task-level failures reject
// every pending request. User-control failures first probe the native task state:
// the CDP callback does not carry the permission reason, while ordinary native
// calls may do so on newer Ego Lite builds.
function handleSendError(message, error_code) {
  if (pending.size === 0) return;

  if (error_code !== "EGO_TASK_SPACE_USER_IN_CONTROL") {
    rejectAllPending(buildEgoError({ error: message, error_code }));
    return;
  }
  if (userControlProbeState === "stopped" && userControlStopError) {
    rejectAllPending(userControlStopError);
    return;
  }
  if (userControlProbeState === "probing") return;

  userControlProbeState = "probing";
  const generation = ++userControlProbeGeneration;
  void probeUserControlReason(message, error_code, generation);
}

async function probeUserControlReason(
  message: string,
  error_code: string,
  generation: number,
): Promise<void> {
  const fallback = { error: message, error_code };
  const runtime = browserEgo();
  if (typeof runtime.setAgentTaskState !== "function") {
    stopForUserControl(fallback, generation);
    return;
  }

  try {
    const result = await runtime.setAgentTaskState("Waiting for the user");
    if (generation !== userControlProbeGeneration) return;
    if (isEgoUserControlError(result)) {
      stopForUserControl(result, generation);
      return;
    }
    if (result && typeof result === "object" && "error" in result) {
      stopForUserControl(fallback, generation);
      return;
    }

    // Control came back between the failed send and the probe. The original
    // command still failed, but it must not create a new global hard stop.
    userControlProbeState = "idle";
    userControlStopError = null;
    rejectAllPending(nativeSendError(message, error_code));
  } catch (error) {
    if (generation !== userControlProbeGeneration) return;
    stopForUserControl(
      isEgoUserControlError(error) ? error : fallback,
      generation,
    );
  }
}

function stopForUserControl(errorLike: unknown, generation: number): void {
  if (generation !== userControlProbeGeneration) return;
  userControlStopError = buildEgoError(errorLike);
  userControlProbeState = "stopped";
  rejectAllPending(userControlStopError);
}

function rejectAllPending(error: Error): void {
  const entries = [...pending.values()];
  pending.clear();
  for (const entry of entries) entry.reject(error);
}

function nativeSendError(
  message: string,
  error_code: string,
): Error & { error_code?: string } {
  const error: Error & { error_code?: string } = new Error(
    message || error_code || "CDP send failed",
  );
  if (error_code) error.error_code = error_code;
  return error;
}

function resetUserControlProbe(): void {
  userControlProbeGeneration += 1;
  userControlProbeState = "idle";
  userControlStopError = null;
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
    if (userControlProbeState === "stopped") {
      // A successful command proves control has returned. Re-arm detection so a
      // later, separate takeover can run its own reason probe.
      resetUserControlProbe();
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
      clearTargetSessionTree(targetId, {
        remove: data.method === "Target.targetDestroyed",
      });
    }
  } else if (data.method === "Target.attachedToTarget") {
    const sessionId = data.params?.sessionId;
    const targetId = data.params?.targetInfo?.targetId;
    const parentTargetId = data.params?.targetInfo?.parentId;
    if (targetId && parentTargetId) {
      registerTargetParent(targetId, parentTargetId);
    }
    if (sessionId && targetId) registerSession(targetId, sessionId);
  }
  const sessionId = data.sessionId;
  const targetId = sessionId ? sessionTargets.get(sessionId) : undefined;
  const target = targetId ? targetStates.get(targetId) : undefined;
  if (data.method === "Page.javascriptDialogOpening") {
    if (target) {
      target.pendingDialog = data.params || {};
      rejectCommandsBlockedByDialog(
        sessionId,
        target.pendingDialog as Record<string, unknown>,
      );
    }
  } else if (data.method === "Page.javascriptDialogClosed") {
    if (target) target.pendingDialog = null;
  } else if (data.method === "Page.fileChooserOpened") {
    target?.fileChooserInterception?.resolve(data.params || {});
  }
  if (typeof data.method === "string" && BROWSER_LEVEL(data.method)) {
    for (const listener of [...browserEventSubscribers]) {
      guardNativeCallback("browser event subscriber", () => listener(data));
    }
  }
  const events = target ? target.events : browserEvents;
  events.push(data);
  capEvents(events);
}

function rejectCommandsBlockedByDialog(
  sessionId: string | undefined,
  dialog: Record<string, unknown>,
) {
  if (!sessionId) return;
  for (const [id, entry] of pending) {
    if (entry.sessionId !== sessionId || !DIALOG_BLOCKED_METHOD(entry.method)) {
      continue;
    }
    pending.delete(id);
    entry.reject(new PageDialogOpenedError(entry.method, sessionId, dialog));
  }
}

function rejectFileChooserInterception(target, error: Error) {
  const interception = target.fileChooserInterception;
  if (!interception) return;
  target.fileChooserInterception = null;
  clearTimeout(interception.timer);
  interception.reject(error);
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
    refMap.addWithFrame(
      String(ref.refId ?? ref.backendNodeId),
      ref.backendNodeId,
      ref.role,
      ref.name,
      undefined,
      ref.frameId,
    );
  }
}
