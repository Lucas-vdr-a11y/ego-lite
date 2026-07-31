import { createReadStream, mkdirSync } from "node:fs";
import { access, copyFile, mkdir, rm, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { cdp } from "../cdp-eval.js";
import { isEgoHardStopError } from "../ego-errors.js";
import {
  ensureSession,
  subscribeBrowserEvent,
  waitForBrowserEvent,
} from "../browser-runtime.js";
import { createJSHandle, remotePrimitiveValue } from "../js-handle.js";
import {
  createRequestFacade,
  createResponseFacade,
  responseLifecycleInfo,
  type RequestInfo,
} from "../network-facades.js";
import { acquireNetworkEvents } from "../network-events.js";
import { createNetworkLifecycleMonitor } from "../network-lifecycle.js";
import { state } from "../state.js";
import {
  normalizeTimeout,
  operationTimeout,
  targetClosedError,
} from "../playwright-errors.js";
import { currentTargetId } from "../target-context.js";
import { listTabs, switchTab } from "./nav.js";

type WaitForEventOptions = {
  timeout?: number;
  predicate?: (event: any) => boolean | Promise<boolean>;
  signal?: AbortSignal;
};

type WaitForEventDependencies = {
  createPopup?: (targetInfo: any) => any;
  page?: any;
};

type EventPredicate = NonNullable<WaitForEventOptions["predicate"]>;
type PageContext = {
  sessionId: string;
  targetId: string | null;
};
type FileChooserInterception = {
  users: number;
  enabled: boolean;
  ready: Promise<void>;
};

const PAGE_EVENTS = new Set([
  "console",
  "dialog",
  "download",
  "filechooser",
  "pageerror",
  "popup",
  "requestfailed",
  "request",
  "response",
  "requestfinished",
  "load",
  "domcontentloaded",
  "close",
]);
const fileChooserInterceptions = new Map<string, FileChooserInterception>();

type DownloadWillBegin = {
  method: "Page.downloadWillBegin" | "Browser.downloadWillBegin";
  params?: {
    frameId?: string;
    guid?: string;
    url?: string;
    suggestedFilename?: string;
  };
};

type DownloadProgress = {
  method: "Page.downloadProgress" | "Browser.downloadProgress";
  params?: {
    guid?: string;
    state?: string;
  };
};

/**
 * Wait for a Playwright-style page event.
 * @param {"console"|"dialog"|"download"|"filechooser"|"pageerror"|"popup"|"request"|"response"|"requestfailed"|"requestfinished"|"load"|"domcontentloaded"|"close"} eventName Event name.
 * @param {Function|{timeout?: number, predicate?: Function, signal?: AbortSignal}} [optionsOrPredicate] Predicate function or wait options.
 * @returns {Promise<object>} Event-specific Playwright-style facade.
 */
export async function waitForEvent(
  eventName,
  optionsOrPredicate:
    | WaitForEventOptions
    | ((event: any) => boolean | Promise<boolean>) = {},
  dependencies: WaitForEventDependencies = {},
) {
  if (!PAGE_EVENTS.has(eventName)) {
    throw new Error(
      `page.waitForEvent supports ${[...PAGE_EVENTS].map((name) => JSON.stringify(name)).join(", ")}, got ${JSON.stringify(eventName)}`,
    );
  }
  const options = normalizeWaitForEventOptions(optionsOrPredicate);
  if (options.signal?.aborted) {
    throw abortReason(options.signal);
  }
  const timeout = normalizeTimeout(
    `page.waitForEvent(${JSON.stringify(eventName)})`,
    options.timeout ?? state.defaultTimeout,
  );
  const predicate = options.predicate || (() => true);
  const operationName = `page.waitForEvent(${JSON.stringify(eventName)})`;
  const operationScope = createOperationScope(
    operationName,
    timeout,
    options.signal,
  );
  const operation = (async () => {
    switch (eventName) {
      case "console":
        return waitForConsole(timeout, predicate, operationScope.signal);
      case "dialog":
        return waitForDialog(timeout, predicate, operationScope.signal);
      case "download":
        return waitForDownload(timeout, predicate, operationScope.signal);
      case "filechooser":
        return waitForFileChooser(timeout, predicate, operationScope.signal);
      case "pageerror":
        return waitForPageError(timeout, predicate, operationScope.signal);
      case "popup":
        return waitForPopup(
          timeout,
          predicate,
          operationScope.signal,
          dependencies.createPopup,
        );
      case "requestfailed":
        return waitForFailedRequest(timeout, predicate, operationScope.signal);
      case "request":
      case "response":
      case "requestfinished":
        return waitForNetworkPageEvent(
          eventName,
          timeout,
          predicate,
          operationScope.signal,
        );
      case "load":
      case "domcontentloaded":
        return waitForLifecycleEvent(
          eventName,
          timeout,
          predicate,
          operationScope.signal,
          dependencies.page,
        );
      case "close":
        return waitForClose(
          timeout,
          predicate,
          operationScope.signal,
          dependencies.page,
        );
    }
  })();
  void operation.catch(() => {});
  try {
    return await operation;
  } catch (error) {
    if (error?.name === "TimeoutError") throw error;
    if (
      /page\.waitForEvent timed out|CDP request timed out:/i.test(
        error?.message || "",
      )
    ) {
      throw operationTimeout(
        `page.waitForEvent(${JSON.stringify(eventName)})`,
        timeout,
      );
    }
    throw error;
  } finally {
    operationScope.dispose();
  }
}

async function waitForLifecycleEvent(
  eventName: "load" | "domcontentloaded",
  timeout: number,
  predicate: EventPredicate,
  signal: AbortSignal,
  page,
) {
  const method =
    eventName === "load" ? "Page.loadEventFired" : "Page.domContentEventFired";
  return waitForPageValue(
    timeout,
    signal,
    ({ sessionId }) => cdp("Page.enable", {}, sessionId, timeout),
    (event, context) =>
      event?.method === method &&
      (!event?.sessionId || event.sessionId === context.sessionId)
        ? page
        : NO_EVENT,
    predicate,
  );
}

async function waitForClose(
  timeout: number,
  predicate: EventPredicate,
  signal: AbortSignal,
  page,
) {
  const contextPromise = currentPageContext();
  const abortScope = createAbortScope(signal);
  let matchedPage;
  const eventPromise = waitForBrowserEvent(
    async (event) => {
      const context = await contextPromise;
      const detachedSessionId = event?.params?.sessionId || event?.sessionId;
      const endedTargetId =
        event?.params?.targetId || event?.params?.targetInfo?.targetId;
      const closed =
        (event?.method === "Target.targetDestroyed" &&
          endedTargetId === context.targetId) ||
        (event?.method === "Target.detachedFromTarget" &&
          (detachedSessionId === context.sessionId ||
            endedTargetId === context.targetId));
      if (!closed || !(await predicate(page))) return false;
      matchedPage = page;
      return true;
    },
    browserEventTimeout(timeout),
    abortScope.signal,
  );
  void eventPromise.catch(() => {});
  try {
    await Promise.all([contextPromise, eventPromise]);
    return matchedPage;
  } finally {
    abortScope.dispose();
  }
}

async function waitForNetworkPageEvent(
  eventName: "request" | "response" | "requestfinished",
  timeout: number,
  predicate: EventPredicate,
  signal: AbortSignal,
) {
  const cachedContext = cachedPageContext();
  const contextPromise = cachedContext
    ? Promise.resolve(cachedContext)
    : currentPageContext();
  const networkEvents = acquireNetworkEvents(
    cachedContext?.sessionId ||
      contextPromise.then(({ sessionId }) => sessionId),
    timeout,
  );
  const monitor = createNetworkLifecycleMonitor(networkEvents);
  const abortScope = createAbortScope(signal);
  let matched;
  let retained = false;
  const eventPromise = waitForBrowserEvent(
    async (event) => {
      const context = await contextPromise;
      throwIfPageEnded(event, context);
      if (
        context.sessionId &&
        event?.sessionId &&
        event.sessionId !== context.sessionId
      ) {
        return false;
      }
      const candidate = networkEventCandidate(eventName, event, monitor);
      if (!candidate || !(await predicate(candidate.value))) return false;
      matched = candidate;
      return true;
    },
    browserEventTimeout(timeout),
    abortScope.signal,
  );
  void eventPromise.catch(() => {});
  try {
    await Promise.all([
      raceWithAbort(networkEvents.ready, abortScope.signal),
      eventPromise,
    ]);
    if (eventName !== "requestfinished") {
      await monitor.retain(
        matched.request,
        eventName === "response" ? matched.value : undefined,
      );
      retained = true;
    }
    return matched.value;
  } catch (error) {
    abortScope.abort(error);
    await eventPromise.catch(() => {});
    throw error;
  } finally {
    abortScope.dispose();
    if (!retained) await monitor.release();
  }
}

function networkEventCandidate(eventName, event, monitor) {
  const params = event?.params || {};
  if (
    eventName === "request" &&
    event?.method === "Network.requestWillBeSent"
  ) {
    const request = monitor.requestForEvent(event);
    return request ? { value: createRequestFacade(request), request } : null;
  }
  if (
    eventName === "requestfinished" &&
    event?.method === "Network.loadingFinished"
  ) {
    const request = monitor.requestForEvent(event);
    return request ? { value: createRequestFacade(request), request } : null;
  }
  if (eventName !== "response") return null;
  if (
    event?.method === "Network.requestWillBeSent" &&
    params.redirectResponse
  ) {
    const currentRequest = monitor.requestForEvent(event);
    const response = createResponseFacade({
      requestId: params.requestId,
      response: params.redirectResponse,
      request: currentRequest?.redirectedFrom,
      sessionId: event?.sessionId,
      finished: true,
    });
    const request =
      currentRequest?.redirectedFrom ||
      responseLifecycleInfo(response)?.request;
    return request ? { value: response, request } : null;
  }
  if (event?.method !== "Network.responseReceived") return null;
  const request = monitor.requestForEvent(event);
  const response = createResponseFacade({
    requestId: params.requestId,
    response: params.response,
    request,
    type: params.type,
    sessionId: event?.sessionId,
  });
  const matchedRequest = request || responseLifecycleInfo(response)?.request;
  return matchedRequest ? { value: response, request: matchedRequest } : null;
}

function normalizeWaitForEventOptions(
  optionsOrPredicate:
    | WaitForEventOptions
    | ((event: any) => boolean | Promise<boolean>),
): WaitForEventOptions {
  if (typeof optionsOrPredicate === "function") {
    return { predicate: optionsOrPredicate };
  }
  if (
    optionsOrPredicate === null ||
    typeof optionsOrPredicate !== "object" ||
    Array.isArray(optionsOrPredicate)
  ) {
    throw new TypeError(
      "page.waitForEvent options must be an object or predicate function",
    );
  }
  if (
    optionsOrPredicate.predicate !== undefined &&
    typeof optionsOrPredicate.predicate !== "function"
  ) {
    throw new TypeError("page.waitForEvent predicate must be a function");
  }
  if (
    optionsOrPredicate.signal !== undefined &&
    !isAbortSignal(optionsOrPredicate.signal)
  ) {
    throw new TypeError("page.waitForEvent signal must be an AbortSignal");
  }
  return optionsOrPredicate;
}

async function waitForPopup(
  timeout: number,
  predicate: EventPredicate,
  signal?: AbortSignal,
  createPopup: (targetInfo: any) => any = createPopupFacade,
) {
  return waitForPageValue(
    timeout,
    signal,
    ({ targetId }) =>
      cdp("Target.setDiscoverTargets", { discover: true }, undefined, timeout),
    (event, { targetId }) => {
      const targetInfo = event?.params?.targetInfo;
      if (
        event?.method !== "Target.targetCreated" ||
        targetInfo?.type !== "page" ||
        targetInfo?.openerId !== targetId
      ) {
        return NO_EVENT;
      }
      return createPopup(targetInfo);
    },
    predicate,
  );
}

function createPopupFacade(targetInfo) {
  const targetId = targetInfo.targetId;
  return {
    targetId,
    async url() {
      const current = (await listTabs()).find(
        (tab) => tab.targetId === targetId,
      );
      return current?.url || targetInfo.url || "";
    },
    async title() {
      const current = (await listTabs()).find(
        (tab) => tab.targetId === targetId,
      );
      return current?.title || targetInfo.title || "";
    },
    bringToFront: async () => switchTab(targetId),
  };
}

async function waitForDialog(
  timeout: number,
  predicate: EventPredicate,
  signal?: AbortSignal,
) {
  return waitForSessionValue(
    "Page.javascriptDialogOpening",
    timeout,
    undefined,
    (event, sessionId) => createDialogFacade(event.params || {}, sessionId),
    predicate,
    signal,
  );
}

function createDialogFacade(params, sessionId: string) {
  return {
    type: () => params.type || "",
    message: () => params.message || "",
    defaultValue: () => params.defaultPrompt || "",
    accept: async (promptText?: string) =>
      cdp(
        "Page.handleJavaScriptDialog",
        {
          accept: true,
          ...(promptText === undefined ? {} : { promptText }),
        },
        sessionId,
      ),
    dismiss: async () =>
      cdp("Page.handleJavaScriptDialog", { accept: false }, sessionId),
  };
}

async function waitForFileChooser(
  timeout: number,
  predicate: EventPredicate,
  signal?: AbortSignal,
) {
  let interceptionLease:
    | {
        ready: Promise<void>;
        release: () => Promise<void>;
      }
    | undefined;
  try {
    return await waitForSessionValue(
      "Page.fileChooserOpened",
      timeout,
      async (sessionId) => {
        interceptionLease = acquireFileChooserInterception(sessionId, timeout);
        await interceptionLease.ready;
      },
      (event, sessionId) =>
        createFileChooserFacade(event.params || {}, sessionId),
      predicate,
      signal,
    );
  } finally {
    await interceptionLease?.release();
  }
}

function acquireFileChooserInterception(sessionId: string, timeout: number) {
  let interception = fileChooserInterceptions.get(sessionId);
  if (!interception) {
    interception = {
      users: 0,
      enabled: false,
      ready: Promise.resolve(),
    };
    fileChooserInterceptions.set(sessionId, interception);
    interception.ready = cdp(
      "Page.setInterceptFileChooserDialog",
      { enabled: true },
      sessionId,
      timeout,
    ).then(() => {
      interception.enabled = true;
    });
    void interception.ready.catch(() => {});
  }
  interception.users += 1;
  let released = false;
  return {
    ready: interception.ready,
    release: async () => {
      if (released) return;
      released = true;
      interception.users = Math.max(0, interception.users - 1);
      if (interception.users > 0) return;
      const disable = async () => {
        await interception.ready.catch(() => {});
        if (
          interception.users > 0 ||
          fileChooserInterceptions.get(sessionId) !== interception
        ) {
          return;
        }
        fileChooserInterceptions.delete(sessionId);
        if (!interception.enabled) return;
        await cdp(
          "Page.setInterceptFileChooserDialog",
          { enabled: false },
          sessionId,
          timeout,
        ).catch(() => {
          // Cleanup is best-effort so it does not hide the event result or the
          // original wait failure.
        });
      };
      if (interception.enabled) {
        await disable();
      } else {
        void disable();
      }
    },
  };
}

function createFileChooserFacade(params, sessionId: string) {
  return {
    isMultiple: () => params.mode === "selectMultiple",
    setFiles: async (filesValue) => {
      const values = Array.isArray(filesValue) ? filesValue : [filesValue];
      if (!values.every((value) => typeof value === "string")) {
        throw new TypeError(
          "FileChooser.setFiles currently expects file paths",
        );
      }
      await cdp(
        "DOM.setFileInputFiles",
        {
          files: values,
          backendNodeId: params.backendNodeId,
        },
        sessionId,
      );
    },
  };
}

async function waitForPageError(
  timeout: number,
  predicate: EventPredicate,
  signal?: AbortSignal,
) {
  return waitForRuntimeEvent(
    "Runtime.exceptionThrown",
    timeout,
    (event) => createPageError(event),
    predicate,
    signal,
  );
}

function createPageError(event) {
  const details = event.params?.exceptionDetails || {};
  const description =
    details.exception?.description || details.exception?.value || details.text;
  const firstLine = String(description || "Uncaught exception").split("\n")[0];
  const match = /^([A-Za-z]*Error):\s*(.*)$/.exec(firstLine);
  const error = new Error(match ? match[2] : firstLine);
  if (match) error.name = match[1];
  if (description) error.stack = String(description);
  return error;
}

async function waitForConsole(
  timeout: number,
  predicate: EventPredicate,
  signal?: AbortSignal,
) {
  return waitForRuntimeEvent(
    "Runtime.consoleAPICalled",
    timeout,
    (event, sessionId) => createConsoleMessage(event, sessionId),
    predicate,
    signal,
  );
}

function createConsoleMessage(event, sessionId: string) {
  const params = event.params || {};
  const args = (params.args || []).map((remoteObject) =>
    createJSHandle(remoteObject, sessionId),
  );
  const frame = params.stackTrace?.callFrames?.[0] || {};
  return {
    type: () => params.type || "log",
    text: () => (params.args || []).map(consoleArgumentText).join(" "),
    args: () => [...args],
    location: () => ({
      url: frame.url || "",
      lineNumber: Number(frame.lineNumber || 0),
      columnNumber: Number(frame.columnNumber || 0),
    }),
  };
}

function consoleArgumentText(remoteObject) {
  if (Object.hasOwn(remoteObject || {}, "value")) {
    return String(remoteObject.value);
  }
  if (remoteObject?.unserializableValue) {
    return String(remoteObject.unserializableValue);
  }
  if (remoteObject?.description) {
    return String(remoteObject.description);
  }
  try {
    return String(remotePrimitiveValue(remoteObject));
  } catch {
    return "";
  }
}

async function waitForRuntimeEvent(
  method: string,
  timeout: number,
  createValue: (event: any, sessionId: string) => any,
  predicate: EventPredicate,
  signal?: AbortSignal,
) {
  return waitForSessionValue(
    method,
    timeout,
    (sessionId) => cdp("Runtime.enable", {}, sessionId, timeout),
    createValue,
    predicate,
    signal,
  );
}

async function waitForSessionValue(
  method: string,
  timeout: number,
  setup?: (sessionId: string) => Promise<any>,
  createValue: (event: any, sessionId: string) => any = (event) => event,
  predicate: EventPredicate = () => true,
  signal?: AbortSignal,
) {
  return waitForPageValue(
    timeout,
    signal,
    setup ? ({ sessionId }) => setup(sessionId) : undefined,
    (event, { sessionId }) => {
      if (
        event?.method !== method ||
        (event?.sessionId && event.sessionId !== sessionId)
      ) {
        return NO_EVENT;
      }
      return createValue(event, sessionId);
    },
    predicate,
  );
}

const NO_EVENT = Symbol("no-page-event");

async function waitForPageValue(
  timeout: number,
  signal: AbortSignal | undefined,
  setup: ((context: PageContext) => Promise<any>) | undefined,
  createValue: (event: any, context: PageContext) => any | typeof NO_EVENT,
  predicate: EventPredicate,
) {
  const cachedContext = cachedPageContext();
  const contextPromise = cachedContext
    ? Promise.resolve(cachedContext)
    : currentPageContext();
  const abortScope = createAbortScope(signal);
  let matchedValue;
  const eventPromise = waitForBrowserEvent(
    async (event) => {
      const context = await contextPromise;
      throwIfPageEnded(event, context);
      const value = createValue(event, context);
      if (value === NO_EVENT || !(await predicate(value))) return false;
      matchedValue = value;
      return true;
    },
    browserEventTimeout(timeout),
    abortScope.signal,
  );
  void eventPromise.catch(() => {});
  const setupPromise = !setup
    ? Promise.resolve()
    : raceWithAbort(
        cachedContext
          ? Promise.resolve(setup(cachedContext))
          : contextPromise.then((context) => setup(context)),
        abortScope.signal,
      );
  try {
    await Promise.all([contextPromise, setupPromise, eventPromise]);
    return matchedValue;
  } catch (error) {
    abortScope.abort(error);
    await eventPromise.catch(() => {});
    throw error;
  } finally {
    abortScope.dispose();
  }
}

function currentPageContext(): Promise<PageContext> {
  const boundTargetId = currentTargetId();
  return ensureSession().then((sessionId) => ({
    sessionId,
    targetId: boundTargetId || state.sessionTargetId,
  }));
}

function cachedPageContext(): PageContext | undefined {
  if (currentTargetId()) return undefined;
  if (!state.sessionId || !state.sessionTargetId) return undefined;
  return {
    sessionId: state.sessionId,
    targetId: state.sessionTargetId,
  };
}

function throwIfPageEnded(event, context: PageContext) {
  const detachedSessionId = event?.params?.sessionId || event?.sessionId;
  const endedTargetId =
    event?.params?.targetId || event?.params?.targetInfo?.targetId;
  if (
    (event?.method === "Target.targetDestroyed" &&
      endedTargetId === context.targetId) ||
    (event?.method === "Target.detachedFromTarget" &&
      (detachedSessionId === context.sessionId ||
        endedTargetId === context.targetId))
  ) {
    throw targetClosedError(context.targetId);
  }
  if (
    event?.method === "Inspector.targetCrashed" &&
    (!event?.sessionId || event.sessionId === context.sessionId)
  ) {
    throw new Error("page.waitForEvent failed because the page crashed");
  }
}

function createAbortScope(externalSignal?: AbortSignal) {
  const controller = new AbortController();
  const onAbort = () => controller.abort(abortReason(externalSignal));
  if (externalSignal) {
    if (externalSignal.aborted) {
      onAbort();
    } else {
      externalSignal.addEventListener("abort", onAbort, { once: true });
    }
  }
  return {
    signal: controller.signal,
    abort: (reason?: unknown) => {
      if (!controller.signal.aborted) controller.abort(reason);
    },
    dispose: () => externalSignal?.removeEventListener("abort", onAbort),
  };
}

function createOperationScope(
  operationName: string,
  timeout: number,
  externalSignal?: AbortSignal,
) {
  const controller = new AbortController();
  const cancel = (reason: Error) => {
    if (controller.signal.aborted) return;
    controller.abort(reason);
  };
  const onAbort = () => cancel(abortReason(externalSignal));
  externalSignal?.addEventListener("abort", onAbort, { once: true });
  const timer =
    timeout === 0
      ? undefined
      : setTimeout(
          () => cancel(operationTimeout(operationName, timeout)),
          timeout,
        );
  return {
    signal: controller.signal,
    dispose() {
      if (timer) clearTimeout(timer);
      externalSignal?.removeEventListener("abort", onAbort);
    },
  };
}

function raceWithAbort<T>(operation: Promise<T>, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}

function abortReason(signal?: AbortSignal) {
  return signal?.reason instanceof Error
    ? signal.reason
    : new Error("page.waitForEvent was aborted");
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as AbortSignal).aborted === "boolean" &&
    typeof (value as AbortSignal).addEventListener === "function" &&
    typeof (value as AbortSignal).removeEventListener === "function",
  );
}

async function waitForFailedRequest(
  timeout: number,
  predicate: EventPredicate,
  signal?: AbortSignal,
) {
  const cachedContext = cachedPageContext();
  const contextPromise = cachedContext
    ? Promise.resolve(cachedContext)
    : currentPageContext();
  const networkEvents = acquireNetworkEvents(
    cachedContext?.sessionId ||
      contextPromise.then(({ sessionId }) => sessionId),
    timeout,
  );
  const monitor = createNetworkLifecycleMonitor(networkEvents);
  const abortScope = createAbortScope(signal);
  let matchedRequest;
  const eventPromise = waitForBrowserEvent(
    async (event) => {
      const context = await contextPromise;
      throwIfPageEnded(event, context);
      if (
        context.sessionId &&
        event?.sessionId &&
        event.sessionId !== context.sessionId
      ) {
        return false;
      }
      if (event?.method !== "Network.loadingFailed") return false;
      const request = monitor.requestForEvent(event);
      if (!request) return false;
      const candidate = createRequestFacade(request);
      if (!(await predicate(candidate))) return false;
      matchedRequest = candidate;
      return true;
    },
    browserEventTimeout(timeout),
    abortScope.signal,
  );
  void eventPromise.catch(() => {});
  try {
    await Promise.all([
      raceWithAbort(networkEvents.ready, abortScope.signal),
      eventPromise,
    ]);
    return matchedRequest;
  } catch (error) {
    abortScope.abort(error);
    await eventPromise.catch(() => {});
    throw error;
  } finally {
    abortScope.dispose();
    await monitor.release();
  }
}

async function waitForDownload(
  timeout: number,
  predicate: EventPredicate,
  signal?: AbortSignal,
) {
  const downloadDir = join(
    tmpdir(),
    `ego-browser-downloads-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  mkdirSync(downloadDir, { recursive: true });
  const contextPromise = currentPageContext();
  const progressTracker = trackDownloadProgress();
  const abortScope = createAbortScope(signal);
  const behaviorPromise = raceWithAbort(
    setDownloadBehavior(downloadDir, timeout),
    abortScope.signal,
  );
  const candidates = new Set<any>();
  let mainFrameIdPromise: Promise<string | undefined> | undefined;
  let matchedCandidate;
  const willBeginPromise = waitForBrowserEvent(
    async (event) => {
      const context = await contextPromise;
      throwIfPageEnded(event, context);
      if (
        event?.method !== "Page.downloadWillBegin" &&
        event?.method !== "Browser.downloadWillBegin"
      ) {
        return false;
      }
      if (event?.sessionId && event.sessionId !== context.sessionId) {
        return false;
      }
      if (
        event.method === "Browser.downloadWillBegin" &&
        event.params?.frameId
      ) {
        mainFrameIdPromise ??= currentMainFrameId(context.sessionId, timeout);
        const mainFrameId = await mainFrameIdPromise;
        if (mainFrameId && event.params.frameId !== mainFrameId) {
          return false;
        }
      }
      const candidate = createDownloadCandidate(
        event,
        downloadDir,
        progressTracker,
      );
      candidates.add(candidate);
      try {
        if (!(await predicate(candidate.value))) {
          candidate.dispose();
          candidates.delete(candidate);
          return false;
        }
        matchedCandidate = candidate;
        candidate.retain();
        return true;
      } catch (error) {
        candidate.dispose();
        candidates.delete(candidate);
        throw error;
      }
    },
    browserEventTimeout(timeout),
    abortScope.signal,
  );
  void willBeginPromise.catch(() => {});
  try {
    await Promise.all([contextPromise, behaviorPromise, willBeginPromise]);
    return matchedCandidate.value;
  } catch (error) {
    abortScope.abort(error);
    await willBeginPromise.catch(() => {});
    progressTracker.dispose();
    await rm(downloadDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  } finally {
    abortScope.dispose();
    for (const candidate of candidates) {
      if (candidate !== matchedCandidate) candidate.dispose();
    }
  }
}

async function currentMainFrameId(sessionId: string, timeout: number) {
  try {
    const result = await cdp("Page.getFrameTree", {}, sessionId, timeout);
    return result.frameTree?.frame?.id || undefined;
  } catch (error) {
    if (isEgoHardStopError(error)) throw error;
    // Older bridges may not expose Page.getFrameTree. Keep download support
    // available there, while filtering by frame whenever Chromium provides it.
    return undefined;
  }
}

function createDownloadCandidate(
  willBegin: DownloadWillBegin,
  downloadDir: string,
  progressTracker: ReturnType<typeof trackDownloadProgress>,
) {
  const guid = willBegin.params?.guid;
  const progress = progressTracker.watch(guid);
  const suggestedFilename =
    willBegin.params?.suggestedFilename || guid || "download";
  const downloadedPath = join(downloadDir, suggestedFilename);
  let outcomePromise: Promise<DownloadProgress> | null = null;
  const downloadOutcome = () => {
    outcomePromise ??= waitForDownloadOutcome(
      progress.completion,
      downloadedPath,
      progressTracker.dispose,
    );
    return outcomePromise;
  };
  const completedPath = async () => {
    const progress = await downloadOutcome();
    if (progress.params?.state === "canceled") {
      throw new Error(`Download canceled: ${suggestedFilename}`);
    }
    return downloadedPath;
  };
  const value = {
    suggestedFilename: () => suggestedFilename,
    url: () => willBegin.params?.url || "",
    path: completedPath,
    saveAs: async (targetPath) => {
      const source = await completedPath();
      await mkdir(dirname(targetPath), { recursive: true });
      await copyFile(source, targetPath);
    },
    failure: async () => {
      const progress = await downloadOutcome();
      return progress.params?.state === "canceled"
        ? `Download canceled: ${suggestedFilename}`
        : null;
    },
    cancel: async () => {
      if (!guid) return;
      await cdp("Browser.cancelDownload", { guid }).catch(async () => {
        await cdp("Page.cancelDownload", { guid });
      });
    },
    delete: async () => {
      const source = await completedPath();
      await unlink(source).catch((error) => {
        if (error?.code !== "ENOENT") throw error;
      });
    },
    createReadStream: async () => createReadStream(await completedPath()),
  };
  return {
    value,
    retain() {
      void progress.completion.then(progressTracker.dispose);
    },
    dispose: progress.dispose,
  };
}

async function waitForDownloadOutcome(
  completion: Promise<DownloadProgress>,
  downloadedPath: string,
  dispose: () => void,
) {
  const progressOutcome = completion.then((progress) => ({
    kind: "progress" as const,
    progress,
  }));
  while (true) {
    const outcome = await Promise.race([
      progressOutcome,
      downloadedFileTick(downloadedPath),
    ]);
    if (outcome.kind === "progress") return outcome.progress;
    if (outcome.kind === "file") {
      // Some ego browser builds forward downloadWillBegin but not the final
      // progress event. Chromium exposes the final filename only after its
      // temporary download has completed, so file appearance is equivalent
      // completion evidence for path-oriented APIs.
      dispose();
      return {
        method: "Browser.downloadProgress",
        params: { state: "completed" },
      } satisfies DownloadProgress;
    }
  }
}

async function downloadedFileTick(downloadedPath: string) {
  try {
    await access(downloadedPath);
    return { kind: "file" as const };
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 25));
    return { kind: "pending" as const };
  }
}

function browserEventTimeout(timeout) {
  return Math.min(timeout, 2147483647);
}

function trackDownloadProgress() {
  const buffered: DownloadProgress[] = [];
  const watchers = new Set<any>();
  let disposed = false;
  const onProgress = (event: DownloadProgress) => {
    if (
      event?.params?.state !== "completed" &&
      event?.params?.state !== "canceled"
    ) {
      return;
    }
    buffered.push(event);
    if (buffered.length > 100) buffered.shift();
    for (const watcher of [...watchers]) {
      if (watcher.guid === event?.params?.guid) {
        watcher.finish(event);
      }
    }
  };
  const unsubscribe = [
    subscribeBrowserEvent("Page.downloadProgress", undefined, onProgress),
    subscribeBrowserEvent("Browser.downloadProgress", undefined, onProgress),
  ];
  return {
    watch(guid) {
      let settled = false;
      let resolveCompletion;
      const completion = new Promise<DownloadProgress>((resolve) => {
        resolveCompletion = resolve;
      });
      const watcher = {
        guid,
        finish(event) {
          if (settled) return;
          settled = true;
          watchers.delete(watcher);
          resolveCompletion(event);
        },
      };
      const match = buffered.find((event) => event?.params?.guid === guid);
      if (match) {
        watcher.finish(match);
      } else if (!disposed) {
        watchers.add(watcher);
      }
      return {
        completion,
        dispose() {
          if (settled) return;
          settled = true;
          watchers.delete(watcher);
        },
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const remove of unsubscribe) remove();
      for (const watcher of watchers) watcher.dispose?.();
      watchers.clear();
    },
  };
}

async function setDownloadBehavior(downloadDir, timeout) {
  try {
    await cdp(
      "Browser.setDownloadBehavior",
      {
        behavior: "allow",
        downloadPath: downloadDir,
        eventsEnabled: true,
      },
      undefined,
      timeout,
    );
  } catch (error) {
    if (
      !/Browser\.setDownloadBehavior.*wasn't found|wasn't found/i.test(
        error?.message || "",
      )
    ) {
      throw error;
    }
    await cdp(
      "Page.setDownloadBehavior",
      {
        behavior: "allow",
        downloadPath: downloadDir,
      },
      undefined,
      timeout,
    );
  }
}
