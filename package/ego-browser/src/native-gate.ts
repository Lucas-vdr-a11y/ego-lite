import { browserEgo, ensureSession } from "./browser-runtime.js";
import { assertNoEgoError } from "./ego-errors.js";

type SpaceScope = {
  spaceId: number;
};

export type PageExecutionContext = SpaceScope & {
  targetId: string;
  sessionId: string;
};

type NativeGateServices = {
  selectSpace(spaceId: number): unknown | Promise<unknown>;
  ensureSession(targetId: string): Promise<string>;
};

type PageTarget = {
  spaceId: number;
  targetId: string;
};

/**
 * Serializes native operations that rely on Ego Lite's process-wide selected
 * task space. The queue covers the entire async operation, so another caller
 * cannot change the selected space while a request is still in flight.
 */
export class NativeOperationGate {
  readonly #services: NativeGateServices;
  #tail: Promise<void> = Promise.resolve();

  constructor(services: NativeGateServices) {
    if (!services || typeof services.selectSpace !== "function") {
      throw new TypeError("NativeOperationGate requires selectSpace");
    }
    if (typeof services.ensureSession !== "function") {
      throw new TypeError("NativeOperationGate requires ensureSession");
    }
    this.#services = services;
  }

  withSpace<T>(
    spaceId: number,
    operation: (scope: SpaceScope) => T | Promise<T>,
  ): Promise<T> {
    assertSpaceId(spaceId);
    if (typeof operation !== "function") {
      throw new TypeError("withSpace requires an operation function");
    }

    const run = async () => {
      await this.#services.selectSpace(spaceId);
      return operation({ spaceId });
    };
    const result = this.#tail.then(run);
    // A failed operation must reject its own caller without poisoning the FIFO
    // queue for every operation submitted after it.
    this.#tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  withPage<T>(
    page: PageTarget,
    operation: (context: PageExecutionContext) => T | Promise<T>,
  ): Promise<T> {
    if (!page || typeof page !== "object") {
      throw new TypeError("withPage requires a page target");
    }
    assertSpaceId(page.spaceId);
    if (typeof page.targetId !== "string" || page.targetId.length === 0) {
      throw new TypeError("withPage requires a non-empty targetId");
    }
    if (typeof operation !== "function") {
      throw new TypeError("withPage requires an operation function");
    }

    return this.withSpace(page.spaceId, async () => {
      const sessionId = await this.#services.ensureSession(page.targetId);
      return operation({
        spaceId: page.spaceId,
        targetId: page.targetId,
        sessionId,
      });
    });
  }
}

function assertSpaceId(spaceId: number): void {
  if (!Number.isInteger(spaceId) || spaceId < 0) {
    throw new TypeError("spaceId must be a non-negative integer");
  }
}

const defaultGate = new NativeOperationGate({
  async selectSpace(spaceId) {
    const ego = browserEgo();
    if (typeof ego.useTaskSpace !== "function") {
      throw new Error("withSpace requires ego.useTaskSpace");
    }
    assertNoEgoError(await ego.useTaskSpace(spaceId), "withSpace");
  },
  ensureSession,
});

export function withSpace<T>(
  spaceId: number,
  operation: (scope: SpaceScope) => T | Promise<T>,
): Promise<T> {
  return defaultGate.withSpace(spaceId, operation);
}

export function withPage<T>(
  page: PageTarget,
  operation: (context: PageExecutionContext) => T | Promise<T>,
): Promise<T> {
  return defaultGate.withPage(page, operation);
}
