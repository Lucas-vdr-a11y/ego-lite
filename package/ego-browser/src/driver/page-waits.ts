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
  visible?: boolean;
};

export type PageWaitForLoadStateOptions = {
  timeout?: number;
  idleMs?: number;
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
): Promise<true> {
  if (typeof selector !== "string" || selector.length === 0) {
    throw new TypeError(
      "page.waitForSelector selector must be a non-empty string",
    );
  }
  const timeoutMs = options.timeout ?? 10_000;
  assertPositiveMilliseconds(timeoutMs);
  if (options.visible !== undefined && typeof options.visible !== "boolean") {
    throw new TypeError("page.waitForSelector visible must be a boolean");
  }

  const deadline = services.now() + timeoutMs;
  while (services.now() <= deadline) {
    let resolved: { objectId: string; sessionId: string } | undefined;
    try {
      resolved = await resolveElementObjectId(
        cdpAdapter(services),
        sessionId,
        refMap,
        selector,
      );
      if (!options.visible) return true;
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
      if (response?.result?.value) return true;
    } catch (error) {
      if (
        !(error instanceof ElementResolutionError) ||
        error.kind !== "transient"
      ) {
        throw error;
      }
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

/** Wait for document load or network idle inside one Page session. */
export async function waitForLoadStateInPage(
  services: PageWaitServices,
  sessionId: string,
  state: "load" | "networkidle",
  options: PageWaitForLoadStateOptions = {},
): Promise<void> {
  if (state !== "load" && state !== "networkidle") {
    throw new TypeError(
      'page.waitForLoadState supports only "load" and "networkidle"',
    );
  }
  const timeoutMs = options.timeout ?? 10_000;
  assertPositiveMilliseconds(timeoutMs);
  if (state === "load") {
    await waitForDocumentLoad(services, sessionId, timeoutMs);
    return;
  }
  const idleMs = options.idleMs ?? 500;
  assertPositiveMilliseconds(idleMs, "idleMs");
  await waitForNetworkIdle(services, sessionId, timeoutMs, idleMs);
}

async function waitForDocumentLoad(
  services: PageWaitServices,
  sessionId: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = services.now() + timeoutMs;
  while (services.now() <= deadline) {
    const remaining = Math.max(1, deadline - services.now());
    const response = await services.cdp(
      "Runtime.evaluate",
      { expression: "document.readyState", returnByValue: true },
      sessionId,
      Math.min(1_000, remaining),
    );
    if (response?.result?.value === "complete") return;
    if (remaining <= 1) break;
    await services.sleep(Math.min(100, remaining));
  }
  throw new Error(`page.waitForLoadState(load) timed out after ${timeoutMs}ms`);
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

function assertPositiveMilliseconds(value: number, name = "timeout"): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive number of milliseconds`);
  }
}
