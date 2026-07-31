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
import { cdp, evaluate, evaluateInTarget } from "../cdp-eval.js";
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
import { currentTargetId } from "../target-context.js";
import { waitForDocumentLoad } from "./load.js";

export const INTERNAL_URL_PREFIXES = [
  "chrome://",
  "chrome-untrusted://",
  "devtools://",
  "chrome-extension://",
  "about:",
];

export type TabInfo = {
  targetId: string;
  title: string;
  url: string;
  type: "page";
};

type ListedTab = TabInfo & {
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

type OpenTabOptions = Omit<OpenOrReuseTabOptions, "match">;

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
  const currentUrl = currentTargetId()
    ? String(await evaluate("location.href"))
    : (await currentTab()).url;
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
    isImmediateNavigationUrl(currentUrl),
  );
}

/**
 * Navigate to the previous session-history entry.
 * @param {{waitUntil?: "load"|"domcontentloaded"|"networkidle"|"commit", timeout?: number}} [options]
 * @returns {Promise<object|null>} Main-document Response facade, or null when no previous entry exists.
 */
export async function goBack(options: GotoOptions = {}) {
  return historyNavigation(-1, options, "page.goBack");
}

/**
 * Navigate to the next session-history entry.
 * @param {{waitUntil?: "load"|"domcontentloaded"|"networkidle"|"commit", timeout?: number}} [options]
 * @returns {Promise<object|null>} Main-document Response facade, or null when no next entry exists.
 */
export async function goForward(options: GotoOptions = {}) {
  return historyNavigation(1, options, "page.goForward");
}

async function historyNavigation(delta, options: GotoOptions, apiName) {
  const timeout = navigationTimeout(options.timeout);
  const deadline = timeoutDeadline(timeout, state.now());
  const history = await cdp(
    "Page.getNavigationHistory",
    {},
    undefined,
    remaining(deadline),
  );
  const entry = history.entries?.[Number(history.currentIndex) + delta];
  if (!entry) return null;
  return navigateAndTrack(
    (commandTimeout) =>
      cdp(
        "Page.navigateToHistoryEntry",
        { entryId: entry.id },
        undefined,
        commandTimeout,
      ),
    { ...options, timeout: remaining(deadline) },
    apiName,
    undefined,
    false,
    true,
  );
}

/**
 * Return the full serialized HTML contents of the current document.
 * @returns {Promise<string>}
 */
export async function content() {
  return String(
    await evaluate(`(() => {
      const doctype = document.doctype;
      let prefix = "";
      if (doctype) {
        prefix = "<!DOCTYPE " + doctype.name;
        if (doctype.publicId) prefix += ' PUBLIC "' + doctype.publicId + '"';
        if (doctype.systemId) prefix += (doctype.publicId ? ' "' : ' SYSTEM "') + doctype.systemId + '"';
        prefix += ">";
      }
      return prefix + (document.documentElement?.outerHTML || "");
    })()`),
  );
}

/**
 * Replace the current main-frame document contents.
 * @param {string} html Document markup.
 * @param {{waitUntil?: "load"|"domcontentloaded"|"networkidle"|"commit", timeout?: number}} [options]
 * @returns {Promise<void>}
 */
export async function setContent(html: string, options: GotoOptions = {}) {
  const waitUntil = normalizeWaitUntil("page.setContent", options.waitUntil);
  const timeout = navigationTimeout(options.timeout);
  const deadline = timeoutDeadline(timeout, state.now());
  const sessionId = await ensureSession();
  const frameId = await currentMainFrameId(sessionId, remaining(deadline));
  if (!frameId)
    throw new Error("page.setContent could not resolve the main frame");
  const networkEvents =
    waitUntil === "networkidle"
      ? acquireNetworkEvents(sessionId, remaining(deadline))
      : undefined;
  const tracker =
    waitUntil === "networkidle"
      ? createNavigationTracker(sessionId, undefined, frameId)
      : undefined;
  try {
    if (networkEvents) await networkEvents.ready;
    tracker?.start();
    await cdp(
      "Page.setDocumentContent",
      { frameId, html },
      sessionId,
      remaining(deadline),
    );
    if (waitUntil === "commit") return;
    if (waitUntil === "networkidle") {
      await tracker?.waitForNetworkIdle(
        remaining(deadline),
        timeout,
        "page.setContent",
      );
      return;
    }
    const loaded = await waitForDocumentLoad({
      timeout: remaining(deadline),
      until: waitUntil === "domcontentloaded" ? "domcontentloaded" : "load",
      requireCommitted: false,
    });
    if (!loaded) throw operationTimeout("page.setContent", timeout);
  } finally {
    tracker?.dispose();
    await networkEvents?.release();
  }
}

async function navigateAndTrack(
  invoke,
  options: GotoOptions,
  apiName,
  expectedUrl?,
  skipDocumentLifecycle = false,
  allowNoResponseAfterCommit = false,
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
        /CDP request timed out: Page\.(?:navigate|reload|navigateToHistoryEntry)/.test(
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
      : await tracker.waitForResponse(
          remaining(deadline),
          timeout,
          apiName,
          allowNoResponseAfterCommit,
        );
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
  let committed = false;

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
  const onFrameNavigated = (event) => {
    const frameId = event?.params?.frame?.id || event?.params?.frameId;
    if (mainFrameId && frameId && frameId !== mainFrameId) return;
    committed = true;
  };
  const unsubscribe = [
    subscribeBrowserEvent("Network.requestWillBeSent", sessionId, onRequest),
    subscribeBrowserEvent("Network.responseReceived", sessionId, onResponse),
    subscribeBrowserEvent("Network.loadingFailed", sessionId, onFailure),
    subscribeBrowserEvent("Network.loadingFinished", sessionId, onFinished),
    subscribeBrowserEvent("Page.frameNavigated", sessionId, onFrameNavigated),
    subscribeBrowserEvent(
      "Page.navigatedWithinDocument",
      sessionId,
      onFrameNavigated,
    ),
  ];
  return {
    start() {
      started = true;
    },
    setNavigationResult(result) {
      navigationResult = result || {};
    },
    async waitForResponse(
      available,
      originalTimeout,
      apiName,
      allowNoResponseAfterCommit = false,
    ) {
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
        if (allowNoResponseAfterCommit && committed) return null;
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
    const sessionId = await ensureSession();
    const dialog = pendingDialog(sessionId);
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
 * @returns {Promise<Array<{targetId:string,title:string,url:string,type:"page"}>>}
 */
export async function listTabs(
  options: ListTabsOptions = {},
): Promise<TabInfo[]> {
  return (await listedTabs(options)).map(toTabInfo);
}

async function listedTabs(options: ListTabsOptions = {}): Promise<ListedTab[]> {
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
      type: "page" as const,
      active: Boolean(tab.active),
      index: tab.index,
    }));
}

function toTabInfo(tab: ListedTab): TabInfo {
  return {
    targetId: tab.targetId,
    url: tab.url,
    title: tab.title,
    type: "page",
  };
}

/**
 * Return the currently attached tab.
 * @returns {Promise<{targetId:string,url:string,title:string,type:"page"}>}
 */
export async function currentTab() {
  const tabs = await listedTabs();
  const active = tabs.find((tab) => tab.active) || tabs[0];
  if (!active) {
    throw new Error("no active browser tab");
  }
  return toTabInfo(active);
}

/**
 * Activate an existing tab target.
 * @param {string|{targetId:string}} target Target id or tab-like object.
 * @returns {Promise<{targetId:string,url:string,title:string,type:"page"}>} Activated tab.
 */
export async function switchTab(target: string | { targetId: string }) {
  const targetId = targetIdFrom(target, "tabs.activate");
  const tabs = await listedTabs();
  const tab = currentTargetFrom(tabs, targetId, "tabs.activate");
  await activateTarget(targetId);
  return toTabInfo(tab);
}

async function activateTarget(targetId: string) {
  await cdp("Target.activateTarget", { targetId });
  invalidateSession();
  setPreferredTarget(targetId);
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
 * Always open a new tab.
 * @param {string} [url="about:blank"] URL to open.
 * @param {{wait?:boolean,timeout?:number,settle?:number}} [options]
 * @returns {Promise<{targetId:string,url:string,title:string,type:"page"}>}
 */
export async function openTab(
  url = "about:blank",
  options: OpenTabOptions = {},
) {
  return openNewTab(url, options, "tabs.open");
}

async function openNewTab(
  url: string,
  options: OpenTabOptions,
  operation: "tabs.open" | "tabs.openOrReuse",
) {
  const targetId = await newTab(url);
  await activateTarget(targetId);
  await waitForActivatedTab(options, operation);
  const refreshed = (await listedTabs()).find(
    (tab) => tab.targetId === targetId,
  );
  return refreshed
    ? toTabInfo(refreshed)
    : { targetId, url, title: "", type: "page" as const };
}

/**
 * Reuse an existing matching tab or open a new one.
 * @param {string} url URL to find or open.
 * @param {{match?: "exact"|"origin"|"origin+path"|"includes", wait?: boolean, timeout?: number, settle?: number}} [options]
 * @returns {Promise<{targetId:string,url:string,title:string,type:"page"}>}
 */
export async function openOrReuseTab(
  url: string,
  options: OpenOrReuseTabOptions = {},
) {
  const tabs = await listedTabs({ includeChrome: false });
  const match = options.match || "exact";
  const existing = tabs.find((tab) => tabMatchesUrl(tab.url, url, match));
  if (existing) {
    await switchTab(existing.targetId);
    await waitForActivatedTab(options, "tabs.openOrReuse");
    const refreshed = (await listedTabs({ includeChrome: false })).find(
      (tab) => tab.targetId === existing.targetId,
    );
    return toTabInfo(refreshed || existing);
  }
  return openNewTab(url, options, "tabs.openOrReuse");
}

async function waitForActivatedTab(
  options: OpenTabOptions,
  operation: "tabs.open" | "tabs.openOrReuse",
) {
  if (options.wait !== false) {
    const timeout = options.timeout ?? navigationTimeout(undefined);
    const loaded = await waitForDocumentLoad({ timeout });
    if (!loaded) {
      throw operationTimeout(operation, timeout);
    }
  }
  const settle = Number(options.settle ?? 0);
  if (settle > 0) {
    await state.sleep(settle);
  }
}

/**
 * Close a browser tab by target id, tab object, or the current tab when omitted.
 * @param {string|{targetId:string}} [target] Target id or tab-like object. Defaults to the current tab.
 * @returns {Promise<string>} Closed target id.
 */
export async function closeTab(target: TabTarget | undefined = undefined) {
  const tabs = await listedTabs();
  const targetId =
    target === undefined
      ? (tabs.find((tab) => tab.active) || tabs[0])?.targetId
      : targetIdFrom(target, "tabs.close");
  if (!targetId) throw new Error("tabs.close requires a targetId");
  currentTargetFrom(tabs, targetId, "tabs.close");
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
 * Evaluate JavaScript in a tab from the current task space without activating it.
 * @param {string|{targetId:string}} target Target id or tab-like object.
 * @param {string|Function} pageFunction Browser-side expression or function.
 * @param {unknown} [arg] Optional serializable function argument.
 * @returns {Promise<any>}
 */
export async function evaluateTab(
  target: TabTarget,
  pageFunction,
  arg = undefined,
) {
  const targetId = targetIdFrom(target, "tabs.evaluate");
  const tabs = await listedTabs();
  currentTargetFrom(tabs, targetId, "tabs.evaluate");
  return evaluateInTarget(targetId, pageFunction, arg);
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
 * Find an iframe target under the current tab whose URL contains a substring.
 * @param {string} urlSubstring URL substring to match.
 * @returns {Promise<string|null>} Unique matching iframe target id, if any.
 */
export async function iframeTarget(urlSubstring) {
  const current = await currentTab();
  const targets = (await cdp("Target.getTargets")).targetInfos || [];
  const targetsById = new Map(
    targets.map((target) => [target.targetId, target]),
  );
  const matches = targets.filter(
    (target) =>
      target.type === "iframe" &&
      (target.url || "").includes(urlSubstring) &&
      targetDescendsFrom(target, current.targetId, targetsById),
  );
  if (matches.length > 1) {
    throw new Error(
      `iframeTarget matched ${matches.length} iframe targets under current tab ${current.targetId} for ${JSON.stringify(urlSubstring)}: ${matches
        .map((target) => `${target.targetId} (${target.url || ""})`)
        .join(", ")}`,
    );
  }
  return matches[0]?.targetId || null;
}

function targetDescendsFrom(target, ancestorTargetId, targetsById) {
  const visited = new Set([target.targetId]);
  let parentId = target.parentId;
  while (parentId) {
    if (parentId === ancestorTargetId) return true;
    if (visited.has(parentId)) return false;
    visited.add(parentId);
    parentId = targetsById.get(parentId)?.parentId;
  }
  return false;
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
  tabs: ListedTab[],
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
      `Refresh tabs.list() and select a current targetId. ` +
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
        `tabs.close timed out waiting for target to close: ${JSON.stringify(targetId)}`,
      );
    }
    await state.sleep(50);
  }
}
