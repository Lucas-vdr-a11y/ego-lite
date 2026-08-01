import { AsyncLocalStorage } from "node:async_hooks";

import { AriaRefMap } from "./aria-ref-map.js";
import { RefMap } from "./ref-map.js";

export type TargetContext = {
  targetId: string;
  beforeOperation?: () => Promise<void>;
  openerId?: string;
  closed: boolean;
  ariaRefMap: AriaRefMap;
  refMap: RefMap;
  snapshotForRefRefresh?: () => Promise<unknown>;
  sessionId?: string;
  sessionPromise?: Promise<string>;
  dispose?: () => Promise<void> | void;
};

const targetStorage = new AsyncLocalStorage<TargetContext>();

export function currentTargetContext() {
  return targetStorage.getStore();
}

export function currentTargetId() {
  return currentTargetContext()?.targetId;
}

// Page facades retain this context so their CDP session also remains valid for
// returned handles and event facades. A string passed to runWithTarget instead
// creates an operation-scoped context that is detached when the call finishes.
export function createTargetContext(
  targetId: string,
  beforeOperation?: () => Promise<void>,
  openerId?: string,
): TargetContext {
  return {
    targetId,
    beforeOperation,
    openerId,
    closed: false,
    ariaRefMap: new AriaRefMap(),
    refMap: new RefMap(),
  };
}

export function runWithTarget<T>(
  target: string | TargetContext,
  operation: () => T,
): T {
  const ownsContext = typeof target === "string";
  const context = ownsContext ? createTargetContext(target) : target;
  const current = currentTargetContext();
  if (current?.targetId === context.targetId) {
    return operation();
  }
  const result = targetStorage.run(context, operation);
  if (!ownsContext) return result;
  if (result && typeof (result as any).then === "function") {
    return Promise.resolve(result).finally(() =>
      disposeTargetContext(context),
    ) as T;
  }
  void disposeTargetContext(context);
  return result;
}

async function disposeTargetContext(context: TargetContext) {
  const dispose = context.dispose;
  context.dispose = undefined;
  if (dispose) await Promise.resolve(dispose()).catch(() => {});
}
