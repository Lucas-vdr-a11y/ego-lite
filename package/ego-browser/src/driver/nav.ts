import {
  browserEgo,
  clearPreferredTarget,
  ensureSession,
  invalidateSession,
  isBrowserRuntime,
  pendingDialog,
  setPreferredTarget,
  subscribeBrowserEvent,
} from "../browser-runtime.js";
import { cdp, evaluate } from "../cdp-eval.js";
import { assertNoEgoError, isEgoHardStopError } from "../ego-errors.js";
import {
  createRequestInfo,
  createResponseFacade,
  linkRedirect,
} from "../network-facades.js";
import {
  normalizeTimeout,
  normalizeWaitUntil,
  operationTimeout,
  remainingTimeout,
  timeoutDeadline,
} from "../playwright-errors.js";
import { acquireNetworkEvents } from "../network-events.js";
import { retainResponseLifecycle } from "../network-lifecycle.js";
import { state } from "../state.js";
import { waitForDocumentLoad } from "./load.js";

export const INTERNAL_URL_PREFIXES = [
  "chrome://",
  "chrome-untrusted://",
  "devtools://",
  "chrome-extension://",
  "about:",
];

type TabInfo = {
  targetId: string;
  title: string;
  url: string;
  active: boolean;
  index?: number;
};

type GotoOptions = {
  waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit";
  timeout?: number;
  settle?: number;
};

type ListTabsOptions = {
  includeChrome?: boolean;
};

type UrlMatchMode = "exact" | "origin" | "origin+path" | "includes";

type OpenOrReuseTabOptions = {
  match?: UrlMatchMode;
  wait?: boolean;
  timeout?: number;
  settle?: number;
};

type TabTarget = string | { targetId: string };

/**
 * Navigate the current tab to a URL and, by default, wait for it to load.
 * @param {string} url Absolute or browser-supported URL to load.
 * @param {{waitUntil?: "load"|"domcontentloaded"|"networkidle"|"commit", timeout?: number, settle?: number}} [options]
 *   `waitUntil: "commit"` returns once navigation is issued without waiting for the document to load.
 *   `timeout` and `settle` are in milliseconds.
 * @returns {Promise<object|null>} Main-document Response facade, or null for a navigation without a network response.
 */
export async function goto(url: string, options: GotoOptions = {}) {
  return navigateAndTrack(
    (commandTimeout) =>
      cdp("Page.navigate", { url }, undefined, commandTimeout),
    options,
    "page.goto",
    url,
  );
}

/**
 * Reload the current page and return the main-document response.
 * @param {{waitUntil?: "load"|"domcontentloaded"|"networkidle"|"commit", timeout?: number, ignoreCache?: boolean}} [options]
 * @returns {Promise<object|null>}
 */
export async function reload(
  options: GotoOptions & { ignoreCache?: boolean } = {},
) {
  const current = await currentTab();
  return navigateAndTrack(
    (commandTimeout) =>
      cdp(
        "Page.reload",
        { ignoreCache: Boolean(options.ignoreCache) },
        undefined,
        commandTimeout,
      ),
    options,
    "page.reload",
    undefined,
    isImmediateNavigationUrl(current.url),
  );
}

async function navigateAndTrack(
  invoke,
  options: GotoOptions,
  apiName,
  expectedUrl?,
  skipDocumentLifecycle = false,
) {
  const waitUntil = normalizeWaitUntil(apiName, options.waitUntil);
  const timeout = navigationTimeout(options.timeout);
  const deadline = timeoutDeadline(timeout, state.now());
  const sessionId = await ensureSession();
  const mainFrameId = await currentMainFrameId(sessionId, remaining(deadline));
  const networkEvents = acquireNetworkEvents(sessionId, remaining(deadline));
  let tracker;
  let retained = false;
  try {
    await networkEvents.ready;
    tracker = createNavigationTracker(sessionId, expectedUrl, mainFrameId);
    tracker.start();
    let navigation;
    try {
      navigation = await invoke(remaining(deadline));
    } catch (error) {
      if (
        /CDP request timed out: Page\.(?:navigate|reload)/.test(
          error?.message || "",
        )
      ) {
        throw operationTimeout(apiName, timeout);
      }
      throw error;
    }
    if (navigation?.errorText) {
      throw new Error(`Navigation failed: ${navigation.errorText}`);
    }
    tracker.setNavigationResult(navigation);

    const immediateNavigation =
      skipDocumentLifecycle ||
      Boolean(expectedUrl && isImmediateNavigationUrl(expectedUrl));
    const response = immediateNavigation
      ? null
      : await tracker.waitForResponse(remaining(deadline), timeout, apiName);
    if (
      waitUntil !== "commit" &&
      !navigation?.isDownload &&
      !immediateNavigation
    ) {
      if (waitUntil === "networkidle") {
        await tracker.waitForNetworkIdle(remaining(deadline), timeout, apiName);
      } else {
        const loaded = await waitForDocumentLoad({
          timeout: remaining(deadline),
          until: waitUntil === "domcontentloaded" ? "domcontentloaded" : "load",
        });
        if (!loaded) throw operationTimeout(apiName, timeout);
      }
    }
    const settle = Number(options.settle ?? 0);
    if (settle > 0) await state.sleep(settle);
    if (response) {
      await retainResponseLifecycle(response, networkEvents);
      retained = true;
    }
    return response;
  } finally {
    tracker?.dispose();
    if (!retained) await networkEvents.release();
  }
}

function createNavigationTracker(sessionId, expectedUrl?, mainFrameId?) {
  const requests = new Map();
  const requestsByLoader = new Map();
  const responses = new Map();
  const failures = new Map();
  const inflight = new Set();
  let lastActivity = state.now();
  let navigationResult: any = null;
  let started = false;
  let reloadLoaderId: string | null = null;

  const onRequest = (event) => {
    if (!started) return;
    const params = event.params || {};
    inflight.add(params.requestId);
    lastActivity = state.now();
    if (String(params.type || "").toLowerCase() !== "document") return;
    if (mainFrameId && params.frameId && params.frameId !== mainFrameId) {
      return;
    }
    const previous = requests.get(params.requestId);
    const request = createRequestInfo(params, event.sessionId);
    linkRedirect(previous, request);
    requests.set(params.requestId, request);
    if (params.loaderId) {
      requestsByLoader.set(params.loaderId, request);
    }
    if (
      !reloadLoaderId &&
      (!expectedUrl || urlsEquivalent(request.url, expectedUrl))
    ) {
      reloadLoaderId = params.loaderId || null;
    }
  };
  const onResponse = (event) => {
    if (
      !started ||
      String(event?.params?.type || "").toLowerCase() !== "document" ||
      (mainFrameId &&
        event?.params?.frameId &&
        event.params.frameId !== mainFrameId)
    )
      return;
    const params = event.params || {};
    responses.set(params.loaderId || "", {
      requestId: params.requestId,
      response: params.response || {},
      request: requests.get(params.requestId),
      sessionId: event.sessionId,
    });
  };
  const onFailure = (event) => {
    if (!started) return;
    inflight.delete(event?.params?.requestId);
    lastActivity = state.now();
    const request = requests.get(event?.params?.requestId);
    if (!request?.isNavigationRequest) return;
    request.failureText =
      event?.params?.errorText || "Navigation request failed";
    failures.set(event?.params?.requestId, request.failureText);
  };
  const onFinished = (event) => {
    if (!started) return;
    inflight.delete(event?.params?.requestId);
    lastActivity = state.now();
  };
  const unsubscribe = [
    subscribeBrowserEvent("Network.requestWillBeSent", sessionId, onRequest),
    subscribeBrowserEvent("Network.responseReceived", sessionId, onResponse),
    subscribeBrowserEvent("Network.loadingFailed", sessionId, onFailure),
    subscribeBrowserEvent("Network.loadingFinished", sessionId, onFinished),
  ];
  return {
    start() {
      started = true;
    },
    setNavigationResult(result) {
      navigationResult = result || {};
    },
    async waitForResponse(available, originalTimeout, apiName) {
      if (navigationResult?.isDownload) return null;
      // Page.navigate omits loaderId for same-document navigations. Page.reload
      // has no loaderId in its command result, so its loader must arrive later
      // through Network.requestWillBeSent.
      if (expectedUrl !== undefined && !navigationResult?.loaderId) return null;
      const localDeadline =
        available === 0 ? Number.POSITIVE_INFINITY : state.now() + available;
      while (state.now() < localDeadline) {
        const loaderId = navigationResult?.loaderId || reloadLoaderId;
        if (loaderId) {
          const info = responses.get(loaderId);
          if (info) return createResponseFacade(info);
          const request = requestsByLoader.get(loaderId) as any;
          if (request && failures.has(request.requestId)) {
            throw new Error(
              `Navigation failed: ${failures.get(request.requestId)}`,
            );
          }
        }
        await state.sleep(20);
      }
      throw operationTimeout(apiName, originalTimeout);
    },
    async waitForNetworkIdle(available, originalTimeout, apiName) {
      const localDeadline =
        available === 0 ? Number.POSITIVE_INFINITY : state.now() + available;
      while (state.now() < localDeadline) {
        if (inflight.size === 0 && state.now() - lastActivity >= 500) return;
        await state.sleep(50);
      }
      throw operationTimeout(apiName, originalTimeout);
    },
    dispose() {
      for (const remove of unsubscribe) remove();
    },
  };
}

async function currentMainFrameId(sessionId: string, timeout: number) {
  try {
    const result = await cdp("Page.getFrameTree", {}, sessionId, timeout);
    return result.frameTree?.frame?.id || undefined;
  } catch (error) {
    if (isEgoHardStopError(error)) throw error;
    // Navigation response correlation can still fall back to loader ids on
    // bridges that do not expose Page.getFrameTree.
    return undefined;
  }
}

function navigationTimeout(explicit) {
  const value =
    explicit ?? state.defaultNavigationTimeout ?? state.defaultTimeout;
  return normalizeTimeout("navigation", value);
}

function remaining(deadline) {
  return remainingTimeout(deadline, state.now());
}

function urlsEquivalent(left, right) {
  try {
    return new URL(left).href === new URL(right).href;
  } catch {
    return left === right;
  }
}

function isImmediateNavigationUrl(url) {
  return /^(about:|data:|javascript:)/i.test(String(url));
}

/**
 * Read basic state for the current page.
 * @returns {Promise<{url:string,title:string,w:number,h:number,sx:number,sy:number,pw:number,ph:number}|{dialog:object}>}
 */
export async function pageInfo() {
  if (isBrowserRuntime()) {
    await ensureSession();
    const dialog = pendingDialog();
    if (dialog) {
      return { dialog };
    }
  }
  const expression = `(() => {
    const root = document.documentElement;
    return JSON.stringify({
      url: location.href,
      title: document.title,
      w: innerWidth,
      h: innerHeight,
      sx: scrollX,
      sy: scrollY,
      pw: root?.scrollWidth ?? innerWidth,
      ph: root?.scrollHeight ?? innerHeight,
    });
  })()`;
  return JSON.parse(await evaluate(expression));
}

/**
 * List open page targets known to the browser.
 * @param {{includeChrome?: boolean}} [options]
 * @returns {Promise<Array<{targetId:string,title:string,url:string,active:boolean,index?:number}>>}
 */
export async function listTabs(
  options: ListTabsOptions = {},
): Promise<TabInfo[]> {
  const includeChrome = options.includeChrome ?? true;
  const result = assertNoEgoError(await browserEgo().listTabs(), "listTabs");
  const tabs = result.tabs || [];
  return tabs
    .filter(
      (tab) =>
        includeChrome ||
        !INTERNAL_URL_PREFIXES.some((prefix) =>
          (tab.url || "").startsWith(prefix),
        ),
    )
    .map((tab) => ({
      targetId: tab.targetId,
      title: tab.title || "",
      url: tab.url || "",
      active: Boolean(tab.active),
      index: tab.index,
    }));
}

/**
 * Return the currently attached tab.
 * @returns {Promise<{targetId:string,url:string,title:string}>}
 */
export async function currentTab() {
  const tabs = await listTabs();
  const active = tabs.find((tab) => tab.active) || tabs[0];
  if (!active) {
    throw new Error("no active browser tab");
  }
  return { targetId: active.targetId, url: active.url, title: active.title };
}

/**
 * Activate an existing tab target.
 * @param {string|{targetId:string}} target Target id or tab-like object.
 * @returns {Promise<string>} Target id.
 */
export async function switchTab(target: string | { targetId: string }) {
  const targetId = targetIdFrom(target, "switchTab");
  const tabs = await listTabs();
  currentTargetFrom(tabs, targetId, "switchTab");
  await cdp("Target.activateTarget", { targetId });
  invalidateSession();
  setPreferredTarget(targetId);
  return targetId;
}

/**
 * Open a new tab and optionally navigate it.
 * @param {string} [url="about:blank"] URL to open.
 * @returns {Promise<string>} New target id.
 */
export async function newTab(url = "about:blank") {
  const result = assertNoEgoError(await browserEgo().createTab(url), "newTab");
  if (!result.targetId) {
    throw new Error("newTab returned no targetId");
  }
  return result.targetId;
}

/**
 * Reuse an existing matching tab or open a new one.
 * @param {string} url URL to find or open.
 * @param {{match?: "exact"|"origin"|"origin+path"|"includes", wait?: boolean, timeout?: number, settle?: number}} [options]
 * @returns {Promise<{targetId:string,url:string,title:string,active:boolean,index?:number,reused:boolean}>}
 */
export async function openOrReuseTab(
  url: string,
  options: OpenOrReuseTabOptions = {},
) {
  const tabs = await listTabs({ includeChrome: false });
  const match = options.match || "exact";
  const existing = tabs.find((tab) => tabMatchesUrl(tab.url, url, match));
  if (existing) {
    await switchTab(existing.targetId);
    if (options.wait) {
      await waitForDocumentLoad({
        timeout: options.timeout ?? navigationTimeout(undefined),
      });
    }
    const settle = Number(options.settle ?? 0);
    if (settle > 0) {
      await state.sleep(settle);
    }
    return { ...existing, active: true, reused: true };
  }
  const targetId = await newTab(url);
  if (options.wait !== false) {
    await waitForDocumentLoad({
      timeout: options.timeout ?? navigationTimeout(undefined),
    });
  }
  const settle = Number(options.settle ?? 0);
  if (settle > 0) {
    await state.sleep(settle);
  }
  return { targetId, url, title: "", active: true, reused: false };
}

/**
 * Close a browser tab by target id, tab object, or the current tab when omitted.
 * @param {string|{targetId:string}} [target] Target id or tab-like object. Defaults to the current tab.
 * @returns {Promise<string>} Closed target id.
 */
export async function closeTab(target: TabTarget | undefined = undefined) {
  const tabs = await listTabs();
  const targetId =
    target === undefined
      ? (tabs.find((tab) => tab.active) || tabs[0])?.targetId
      : targetIdFrom(target, "closeTab");
  if (!targetId) throw new Error("closeTab requires a targetId");
  currentTargetFrom(tabs, targetId, "closeTab");
  await cdp("Target.closeTarget", { targetId });
  invalidateSession();
  if (state.preferredTargetId === targetId) {
    clearPreferredTarget();
  }
  if (tabs.length > 1) {
    await waitForClosedTarget(targetId);
  }
  return targetId;
}

/**
 * Ensure the active harness session points at a real, non-internal page tab.
 * @returns {Promise<{targetId:string,title:string,url:string}|null>}
 */
export async function ensureRealTab() {
  const tabs = await listTabs({ includeChrome: false });
  if (tabs.length === 0) {
    return null;
  }
  const current = await currentTab().catch(() => null);
  if (
    current?.url &&
    !INTERNAL_URL_PREFIXES.some((prefix) => current.url.startsWith(prefix))
  ) {
    return current;
  }
  await switchTab(tabs[0].targetId);
  return tabs[0];
}

/**
 * Find an iframe target whose URL contains a substring.
 * @param {string} urlSubstring URL substring to match.
 * @returns {Promise<string|null>} Matching iframe target id, if any.
 */
export async function iframeTarget(urlSubstring) {
  const targets = (await cdp("Target.getTargets")).targetInfos || [];
  return (
    targets.find(
      (target) =>
        target.type === "iframe" && (target.url || "").includes(urlSubstring),
    )?.targetId || null
  );
}

function tabMatchesUrl(tabUrl: string, wantedUrl: string, match: UrlMatchMode) {
  if (!tabUrl) {
    return false;
  }
  if (match === "includes") {
    return tabUrl.includes(wantedUrl);
  }
  let tab;
  let wanted;
  try {
    tab = new URL(tabUrl);
    wanted = new URL(wantedUrl);
  } catch {
    return tabUrl === wantedUrl;
  }
  if (match === "origin") {
    return tab.origin === wanted.origin;
  }
  if (match === "origin+path") {
    return (
      tab.origin === wanted.origin &&
      trimSlash(tab.pathname) === trimSlash(wanted.pathname)
    );
  }
  return tab.href === wanted.href;
}

function trimSlash(pathname: string) {
  return pathname.replace(/\/+$/, "") || "/";
}

function targetIdFrom(target: TabTarget, operation: string) {
  const targetId =
    typeof target === "string"
      ? target
      : target && typeof target === "object"
        ? target.targetId
        : undefined;
  if (typeof targetId !== "string" || !targetId) {
    throw new Error(
      `${operation} requires a targetId; received ${JSON.stringify(target)}`,
    );
  }
  return targetId;
}

function currentTargetFrom(
  tabs: TabInfo[],
  targetId: string,
  operation: string,
) {
  const tab = tabs.find((candidate) => candidate.targetId === targetId);
  if (tab) return tab;
  const available = tabs.map(({ targetId, title, url }) => ({
    targetId,
    title,
    url,
  }));
  throw new Error(
    `${operation} target not found: ${JSON.stringify(targetId)}. ` +
      `Refresh browser.listTabs() and select a current targetId. ` +
      `Available tabs: ${JSON.stringify(available)}`,
  );
}

async function waitForClosedTarget(targetId: string) {
  const deadline = state.now() + 2000;
  while (true) {
    const tabs = await listTabs();
    if (!tabs.some((tab) => tab.targetId === targetId)) return tabs;
    if (state.now() >= deadline) {
      throw new Error(
        `closeTab timed out waiting for target to close: ${JSON.stringify(targetId)}`,
      );
    }
    await state.sleep(50);
  }
}
