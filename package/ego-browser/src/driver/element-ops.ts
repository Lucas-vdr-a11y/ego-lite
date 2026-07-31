import { cdp, runtimeValue } from "../cdp-eval.js";
import {
  ariaRefScope,
  isAriaRefSelector,
  parseAriaRef,
} from "../aria-ref-map.js";
import { currentAriaRefMap } from "../aria-ref-state.js";
import { currentRefMap, ensureRefMapForRef } from "../ref-state.js";
import {
  ElementResolutionError,
  resolveElementObjectId,
  selectorResolutionError,
} from "../element-resolver.js";
import {
  isFrameLifecycleError,
  isLocatorTarget,
  resolveFrameContext,
  type FrameOwnerContext,
  type LocatorTarget,
} from "../frame-context.js";
import { queryAllExpression } from "../locator-query.js";

export type ResolvedElementHandle = {
  objectId: string;
  sessionId?: string;
  inputSessionId?: string;
  probeExecutionContextId?: number;
  frameOffset?: { x: number; y: number };
  frameScale?: { x: number; y: number };
  frameVisible?: false;
  frameOwners?: FrameOwnerContext[];
  frameId?: string;
};

/**
 * Resolve any selector form to a CDP Runtime objectId handle.
 * Accepts @ref / ref=N, loc=css:/loc=role:/loc=href:, xpath=, and raw CSS —
 * the same surface as the pointer/observe helpers, via the unified resolver.
 * Refreshes the RefMap on demand when the input is a ref and the map is empty.
 * @param {string} selectorOrRef Selector or ref string.
 * @returns {Promise<{objectId: string, sessionId?: string}>}
 */
export async function resolveHandle(
  selectorOrRef: string | LocatorTarget,
  options: {
    scrollFrames?: boolean;
    trackFrameOwners?: boolean;
    cdpTimeoutMs?: number;
  } = {},
): Promise<ResolvedElementHandle> {
  const ariaRefSelector = isLocatorTarget(selectorOrRef)
    ? selectorOrRef.selector
    : selectorOrRef;
  const ariaRef = parseAriaRef(ariaRefSelector);
  if (!ariaRef && isAriaRefSelector(ariaRefSelector)) {
    throw new ElementResolutionError(
      "Invalid aria-ref selector, should be of form s<number>e<number>",
      "permanent",
    );
  }
  if (ariaRef) {
    return resolveAriaRefHandle(selectorOrRef, ariaRef, options.cdpTimeoutMs);
  }
  if (isLocatorTarget(selectorOrRef) && selectorOrRef.frameChain.length > 0) {
    return resolveFrameScopedHandle(selectorOrRef, options);
  }
  const selector = isLocatorTarget(selectorOrRef)
    ? selectorOrRef.selector
    : selectorOrRef;
  await ensureRefMapForRef(selector);
  return resolveElementObjectId(
    {
      sendRaw: (method, params, sessionId) =>
        cdp(method, params, sessionId, options.cdpTimeoutMs),
    },
    undefined,
    currentRefMap(),
    selector,
  );
}

async function resolveAriaRefHandle(
  target: string | LocatorTarget,
  ref: NonNullable<ReturnType<typeof parseAriaRef>>,
  cdpTimeoutMs?: number,
): Promise<ResolvedElementHandle> {
  const map = currentAriaRefMap();
  const scope = ariaRefScope(target);
  const generation = map.generation(scope);
  if (generation !== ref.generation) {
    throw new ElementResolutionError(
      `Stale aria-ref, expected s${String(generation)}e{number}, got ${ref.selector}`,
      "permanent",
    );
  }
  const entry = map.get(scope, ref.generation, ref.elementId);
  if (!entry) {
    throw new ElementResolutionError(
      `Element not found for aria-ref=${ref.selector}`,
      "transient",
    );
  }
  let resolved;
  try {
    resolved = await cdp(
      "DOM.resolveNode",
      {
        backendNodeId: entry.backendNodeId,
        objectGroup: "ego-browser",
      },
      entry.sessionId,
      cdpTimeoutMs,
    );
  } catch (error) {
    if (!/No node|Could not find node/i.test(error?.message || "")) {
      throw error;
    }
    throw new ElementResolutionError(
      `Element not found for aria-ref=${ref.selector}`,
      "transient",
    );
  }
  const objectId = resolved.object?.objectId;
  if (!objectId) {
    throw new ElementResolutionError(
      `Element not found for aria-ref=${ref.selector}`,
      "transient",
    );
  }
  const connected = await cdp(
    "Runtime.callFunctionOn",
    {
      functionDeclaration: "function(){ return this.isConnected === true; }",
      objectId,
      returnByValue: true,
      awaitPromise: false,
    },
    entry.sessionId,
    cdpTimeoutMs,
  );
  if (!connected.result?.value) {
    await releaseHandle(objectId, entry.sessionId, cdpTimeoutMs);
    throw new ElementResolutionError(
      `Element not found for aria-ref=${ref.selector}`,
      "transient",
    );
  }
  return {
    objectId,
    sessionId: entry.sessionId,
    inputSessionId: entry.inputSessionId,
    frameOffset: entry.frameOffset,
    frameScale: entry.frameScale,
    frameVisible: entry.frameVisible,
    frameOwners: entry.frameOwners,
    frameId: entry.frameId,
  };
}

async function resolveFrameScopedHandle(
  target: LocatorTarget,
  options: {
    scrollFrames?: boolean;
    trackFrameOwners?: boolean;
    cdpTimeoutMs?: number;
  },
) {
  if (/^(?:@|ref=)?\d+$/.test(target.selector.trim())) {
    throw new ElementResolutionError(
      "Snapshot refs cannot be scoped through frameLocator",
      "permanent",
    );
  }
  const context = await resolveFrameContext(target.frameChain, {
    scrollIntoView: options.scrollFrames,
    trackFrameOwners: options.trackFrameOwners,
    cdpTimeoutMs: options.cdpTimeoutMs,
  });
  const matchError = JSON.stringify(
    `Locator ${String(target.selector)} matched `,
  );
  const expression = `(() => {
    const elements = ${queryAllExpression(target.selector)};
    if (elements.length > 1) throw new Error(${matchError} + elements.length + " elements");
    return elements[0] || null;
  })()`;
  let result;
  try {
    result = await cdp(
      "Runtime.evaluate",
      {
        expression,
        contextId: context.executionContextId,
        returnByValue: false,
        awaitPromise: false,
        objectGroup: "ego-browser",
      },
      context.sessionId,
      options.cdpTimeoutMs,
    );
  } catch (error) {
    if (!isFrameLifecycleError(error)) throw error;
    const message =
      error instanceof Error ? error.message : String(error ?? "");
    throw new ElementResolutionError(
      `Frame changed while resolving ${target.selector}: ${message}`,
      "transient",
    );
  }
  if (result.exceptionDetails) {
    throw selectorResolutionError(target.selector, result);
  }
  const objectId = result.result?.objectId;
  if (!objectId) {
    throw new ElementResolutionError(
      `Element not found: ${target.selector}`,
      "transient",
    );
  }
  return {
    objectId,
    sessionId: context.sessionId,
    inputSessionId: context.inputSessionId,
    probeExecutionContextId: context.executionContextId,
    frameOffset: context.offset,
    frameScale: context.scale,
    frameVisible: context.frameVisible,
    frameOwners: context.frameOwners,
    frameId: context.frameId,
  };
}

/**
 * Release a Runtime objectId handle. Best-effort: swallows "already gone"
 * errors (stale handle, lost session, destroyed context).
 * @param {string} objectId Runtime remote object id to release.
 * @param {string} [sessionId] Session that owns the handle.
 * @returns {Promise<void>}
 */
export async function releaseHandle(objectId, sessionId, cdpTimeoutMs?) {
  if (!objectId) return;
  try {
    await cdp("Runtime.releaseObject", { objectId }, sessionId, cdpTimeoutMs);
  } catch {
    // Handle/session already invalid; releasing is best-effort.
  }
}

/**
 * Resolve a handle, run fn(handle), then release the handle — even if fn throws.
 * @param {string} selectorOrRef Selector or ref string.
 * @param {(handle: {objectId: string, sessionId?: string}) => Promise<any>} fn Callback bound to the resolved handle.
 * @returns {Promise<any>} Whatever fn returns.
 */
export async function withHandle(selectorOrRef, fn) {
  const handle = await resolveHandle(selectorOrRef);
  try {
    return await fn(handle);
  } finally {
    await releaseHandle(handle.objectId, handle.sessionId);
  }
}

/**
 * Resolve an element and call a function on it via Runtime.callFunctionOn,
 * with the element bound as `this`. The resolved handle is released afterward;
 * the returned objectId is already freed and must not be reused.
 * @param {string} selectorOrRef Selector or ref string.
 * @param {string} functionDeclaration Function source whose `this` is the element.
 * @param {Array<unknown>} [args=[]] Arguments passed by value.
 * @returns {Promise<{result: any, objectId: string, sessionId?: string}>}
 */
export async function resolveAndCall(
  selectorOrRef,
  functionDeclaration,
  args = [],
) {
  return withHandle(selectorOrRef, async (handle) => {
    const { objectId, sessionId } = handle;
    const result = await cdp(
      "Runtime.callFunctionOn",
      {
        functionDeclaration,
        objectId,
        arguments: args.map((value) => ({ value })),
        returnByValue: true,
        awaitPromise: false,
      },
      sessionId,
    );
    if (result.exceptionDetails || result.result?.subtype === "error") {
      runtimeValue(result, functionDeclaration);
    }
    return { result, ...handle };
  });
}
