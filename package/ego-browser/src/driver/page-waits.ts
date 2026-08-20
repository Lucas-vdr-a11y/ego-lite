import {
  ElementResolutionError,
  resolveElementObjectId,
} from "../element-resolver.js";
import { type RefMap } from "../ref-map.js";

type PageWaitServices = {
  cdp(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
    timeoutMs?: number,
  ): Promise<any>;
  drainEvents(sessionId: string): any[];
  isNetworkDomainEnabled(sessionId: string): boolean;
  now(): number;
  sleep(ms: number): Promise<void>;
};

export type PageWaitForSelectorOptions = {
  timeout?: number;
  state?: "attached" | "detached" | "visible" | "hidden";
};

export type PageWaitForLoadStateOptions = {
  timeout?: number;
  idleMs?: number;
};

export type PageGotoWaitUntil =
  | "commit"
  | "domcontentloaded"
  | "load"
  | "networkidle";

export type PageNavigationOptions = {
  timeoutMs: number;
  waitUntil: PageGotoWaitUntil;
  referer?: string;
};

export type PageWaitForURLOptions = {
  timeout?: number;
};

const VISIBILITY_FUNCTION =
  "function(){if(typeof this.checkVisibility==='function')return this.checkVisibility({checkOpacity:true,checkVisibilityCSS:true});const s=getComputedStyle(this);const r=this.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&s.opacity!=='0'&&r.width>0&&r.height>0;}";

/** Wait for a selector inside one explicit Page session. */
export async function waitForSelectorInPage(
  services: PageWaitServices,
  sessionId: string,
  refMap: RefMap,
  selector: string,
  options: PageWaitForSelectorOptions = {},
  iframeSessions = new Map<string, string>(),
): Promise<true> {
  if (typeof selector !== "string" || selector.length === 0) {
    throw new TypeError(
      "page.waitForSelector selector must be a non-empty string",
    );
  }
  const timeoutMs = options.timeout ?? 10_000;
  const state = options.state ?? "visible";

  const deadline = services.now() + timeoutMs;
  while (services.now() <= deadline) {
    let resolved: { objectId: string; sessionId: string } | undefined;
    try {
      resolved = await resolveElementObjectId(
        cdpAdapter(services),
        sessionId,
        refMap,
        selector,
        iframeSessions,
      );
      if (state === "attached") return true;
      if (state !== "detached") {
        const response = await services.cdp(
          "Runtime.callFunctionOn",
          {
            functionDeclaration: VISIBILITY_FUNCTION,
            objectId: resolved.objectId,
            returnByValue: true,
            awaitPromise: false,
          },
          resolved.sessionId,
        );
        const visible = response?.result?.value === true;
        if (state === "visible" ? visible : !visible) return true;
      }
    } catch (error) {
      if (
        !(error instanceof ElementResolutionError) ||
        error.kind !== "transient"
      ) {
        throw error;
      }
      if (state === "detached" || state === "hidden") return true;
    } finally {
      if (resolved?.objectId) {
        await services
          .cdp(
            "Runtime.releaseObject",
            { objectId: resolved.objectId },
            resolved.sessionId,
          )
          .catch(() => {});
      }
    }
    const remaining = deadline - services.now();
    if (remaining <= 0) break;
    await services.sleep(Math.min(100, remaining));
  }
  throw new Error(
    `page.waitForSelector timed out after ${timeoutMs}ms: ${selector}`,
  );
}

/** Wait until one Page reaches an exact URL or matches a regular expression. */
export async function waitForURLInPage(
  services: PageWaitServices,
  sessionId: string,
  expected: string | RegExp,
  options: PageWaitForURLOptions = {},
): Promise<void> {
  if (
    !(
      (typeof expected === "string" && expected.length > 0) ||
      expected instanceof RegExp
    )
  ) {
    throw new TypeError(
      "page.waitForURL expected URL must be a non-empty string or RegExp",
    );
  }
  const timeoutMs = options.timeout ?? 10_000;
  const pattern =
    expected instanceof RegExp
      ? new RegExp(expected.source, expected.flags)
      : undefined;
  const deadline = services.now() + timeoutMs;
  let lastUrl = "";
  while (services.now() <= deadline) {
    const remaining = Math.max(1, deadline - services.now());
    let response;
    try {
      response = await services.cdp(
        "Runtime.evaluate",
        { expression: "location.href", returnByValue: true },
        sessionId,
        Math.min(1_000, remaining),
      );
    } catch (error) {
      if (isRuntimeEvaluateTimeout(error)) {
        if (services.now() >= deadline) break;
      } else if (!isTransientNavigationContextError(error)) {
        throw error;
      }
    }
    if (typeof response?.result?.value === "string") {
      lastUrl = response.result.value;
      if (typeof expected === "string") {
        if (lastUrl === expected) return;
      } else {
        pattern!.lastIndex = 0;
        if (pattern!.test(lastUrl)) return;
      }
    }
    const waitMs = deadline - services.now();
    if (waitMs <= 0) break;
    await services.sleep(Math.min(100, waitMs));
  }
  const expectation =
    typeof expected === "string"
      ? JSON.stringify(expected)
      : expected.toString();
  throw new Error(
    `page.waitForURL timed out after ${timeoutMs}ms: expected ${expectation}; last URL was ${JSON.stringify(lastUrl)}`,
  );
}

/** Navigate one Page and wait for the selected state of this navigation. */
export async function navigateInPage(
  services: PageWaitServices,
  sessionId: string,
  url: string,
  options: PageNavigationOptions,
): Promise<void> {
  const { timeoutMs, waitUntil, referer } = options;
  const deadline = services.now() + timeoutMs;
  const ownsNetworkDomain =
    waitUntil === "networkidle" && !services.isNetworkDomainEnabled(sessionId);
  let enabledNetworkDomain = false;
  try {
    // Network tracking must start before Page.navigate or the initial document
    // requests can be missed by a network-idle wait.
    if (ownsNetworkDomain) {
      await services.cdp(
        "Network.enable",
        {},
        sessionId,
        navigationTimeRemaining(services, deadline, timeoutMs, waitUntil),
      );
      enabledNetworkDomain = true;
    }
    const response = await services.cdp(
      "Page.navigate",
      {
        url,
        ...(referer === undefined ? {} : { referrer: referer }),
      },
      sessionId,
      navigationTimeRemaining(services, deadline, timeoutMs, waitUntil),
    );
    const navigation = response?.result || response || {};
    if (navigation.errorText) {
      throw new Error(`page.goto failed: ${navigation.errorText}`);
    }
    if (navigation.isDownload === true) {
      throw new Error("page.goto failed: navigation started a download");
    }

    await waitForNavigationCommit(
      services,
      sessionId,
      navigation,
      deadline,
      timeoutMs,
      waitUntil,
    );
    if (waitUntil === "commit") return;

    await waitForLoadStateInPage(services, sessionId, waitUntil, {
      timeout: navigationTimeRemaining(
        services,
        deadline,
        timeoutMs,
        waitUntil,
      ),
    });
  } catch (error) {
    if (services.now() >= deadline || isLoadStateTimeout(error)) {
      throw navigationTimeout(timeoutMs, waitUntil);
    }
    throw error;
  } finally {
    if (enabledNetworkDomain) {
      await services.cdp("Network.disable", {}, sessionId).catch(() => {});
    }
  }
}

async function waitForNavigationCommit(
  services: PageWaitServices,
  sessionId: string,
  navigation: { frameId?: string; loaderId?: string },
  deadline: number,
  timeoutMs: number,
  waitUntil: PageGotoWaitUntil,
): Promise<void> {
  // CDP omits loaderId for a same-document navigation. Page.navigate has
  // already committed that URL change, and the existing document has already
  // passed its DOMContentLoaded and load boundaries.
  if (!navigation.loaderId) return;

  while (services.now() <= deadline) {
    const remaining = navigationTimeRemaining(
      services,
      deadline,
      timeoutMs,
      waitUntil,
    );
    try {
      const response = await services.cdp(
        "Page.getFrameTree",
        {},
        sessionId,
        Math.min(1_000, remaining),
      );
      const frame =
        response?.result?.frameTree?.frame || response?.frameTree?.frame;
      if (
        frame?.loaderId === navigation.loaderId &&
        (!navigation.frameId || frame?.id === navigation.frameId)
      ) {
        return;
      }
    } catch (error) {
      if (!isCdpTimeout(error, "Page.getFrameTree")) throw error;
    }
    const waitMs = deadline - services.now();
    if (waitMs <= 0) break;
    await services.sleep(Math.min(50, waitMs));
  }
  throw navigationTimeout(timeoutMs, waitUntil);
}

function navigationTimeRemaining(
  services: PageWaitServices,
  deadline: number,
  timeoutMs: number,
  waitUntil: PageGotoWaitUntil,
): number {
  const remaining = deadline - services.now();
  if (remaining <= 0) throw navigationTimeout(timeoutMs, waitUntil);
  return remaining;
}

function navigationTimeout(
  timeoutMs: number,
  waitUntil: PageGotoWaitUntil,
): Error {
  return new Error(
    `page.goto timed out after ${timeoutMs}ms waiting for ${waitUntil}`,
  );
}

function isLoadStateTimeout(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.startsWith("page.waitForLoadState(") &&
    error.message.includes(" timed out")
  );
}

/** Wait for document load or network idle inside one Page session. */
export async function waitForLoadStateInPage(
  services: PageWaitServices,
  sessionId: string,
  state: "domcontentloaded" | "load" | "networkidle",
  options: PageWaitForLoadStateOptions = {},
): Promise<void> {
  if (
    state !== "domcontentloaded" &&
    state !== "load" &&
    state !== "networkidle"
  ) {
    throw new TypeError(
      'page.waitForLoadState supports only "domcontentloaded", "load", and "networkidle"',
    );
  }
  const timeoutMs = options.timeout ?? 10_000;
  if (state !== "networkidle") {
    await waitForDocumentReadyState(services, sessionId, state, timeoutMs);
    return;
  }
  const idleMs = options.idleMs ?? 500;
  await waitForNetworkIdle(services, sessionId, timeoutMs, idleMs);
}

async function waitForDocumentReadyState(
  services: PageWaitServices,
  sessionId: string,
  state: "domcontentloaded" | "load",
  timeoutMs: number,
): Promise<void> {
  const expression =
    state === "domcontentloaded"
      ? `(() => {
          const navigation = performance.getEntriesByType("navigation")[0];
          const modernEnd = Number(navigation?.domContentLoadedEventEnd || 0);
          const legacyEnd = Number(performance.timing?.domContentLoadedEventEnd || 0);
          return {
            readyState: document.readyState,
            domContentLoaded:
              document.readyState === "complete" || modernEnd > 0 || legacyEnd > 0,
          };
        })()`
      : "document.readyState";
  const deadline = services.now() + timeoutMs;
  while (services.now() <= deadline) {
    const remaining = Math.max(1, deadline - services.now());
    let response;
    try {
      response = await services.cdp(
        "Runtime.evaluate",
        { expression, returnByValue: true },
        sessionId,
        Math.min(1_000, remaining),
      );
    } catch (error) {
      // A document swap can briefly invalidate the execution context. Retry
      // those transitions and individual probe timeouts within the Page-level
      // wait budget instead of leaking a CDP implementation detail.
      if (
        !isRuntimeEvaluateTimeout(error) &&
        !isTransientNavigationContextError(error)
      ) {
        throw error;
      }
      if (services.now() >= deadline) break;
    }
    const value = response?.result?.value;
    if (state === "load" && value === "complete") return;
    if (state === "domcontentloaded" && value?.domContentLoaded === true)
      return;
    if (remaining <= 1) break;
    await services.sleep(Math.min(100, remaining));
  }
  throw new Error(
    `page.waitForLoadState(${state}) timed out after ${timeoutMs}ms`,
  );
}

function isRuntimeEvaluateTimeout(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("CDP request timed out: Runtime.evaluate")
  );
}

function isCdpTimeout(error: unknown, method: string): boolean {
  return (
    error instanceof Error &&
    error.message.includes(`CDP request timed out: ${method}`)
  );
}

function isTransientNavigationContextError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes("Execution context was destroyed") ||
    error.message.includes("Cannot find context with specified id") ||
    error.message.includes("Inspected target navigated")
  );
}

async function waitForNetworkIdle(
  services: PageWaitServices,
  sessionId: string,
  timeoutMs: number,
  idleMs: number,
): Promise<void> {
  const ownsNetworkDomain = !services.isNetworkDomainEnabled(sessionId);
  const deadline = services.now() + timeoutMs;
  let lastActivityAt = services.now();
  const inflight = new Set<string>();
  await services.cdp("Network.enable", {}, sessionId);
  try {
    while (services.now() <= deadline) {
      for (const event of services.drainEvents(sessionId)) {
        const method = event?.method || "";
        const requestId = event?.params?.requestId;
        if (method === "Network.requestWillBeSent" && requestId) {
          inflight.add(requestId);
          lastActivityAt = services.now();
        } else if (
          (method === "Network.loadingFinished" ||
            method === "Network.loadingFailed") &&
          requestId
        ) {
          inflight.delete(requestId);
          lastActivityAt = services.now();
        } else if (method.startsWith("Network.")) {
          lastActivityAt = services.now();
        }
      }
      if (inflight.size === 0 && services.now() - lastActivityAt >= idleMs) {
        return;
      }
      const remaining = deadline - services.now();
      if (remaining <= 0) break;
      await services.sleep(Math.min(50, remaining));
    }
    throw new Error(
      `page.waitForLoadState(networkidle) timed out after ${timeoutMs}ms`,
    );
  } finally {
    if (ownsNetworkDomain) {
      await services.cdp("Network.disable", {}, sessionId).catch(() => {});
    }
  }
}

function cdpAdapter(services: PageWaitServices) {
  return {
    sendRaw(method, params, sessionId) {
      return services.cdp(method, params, sessionId);
    },
  };
}
