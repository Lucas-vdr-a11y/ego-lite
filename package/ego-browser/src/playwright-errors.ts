/**
 * Error raised when a Playwright-style operation exceeds its configured timeout.
 */
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

export function operationTimeout(
  apiName: string,
  timeout: number,
  detail?: string,
) {
  return new TimeoutError(
    `${apiName} timed out after ${timeout}ms${detail ? `: ${detail}` : ""}`,
  );
}

export function normalizeTimeout(apiName: string, timeout: unknown) {
  const value = Number(timeout);
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${apiName} timeout must be a non-negative number`);
  }
  return value;
}

const LOAD_STATES = [
  "load",
  "domcontentloaded",
  "networkidle",
  "commit",
] as const;

export function normalizeWaitUntil(
  apiName: string,
  waitUntil: unknown,
): (typeof LOAD_STATES)[number] {
  const value = waitUntil ?? "load";
  if (!LOAD_STATES.includes(value as (typeof LOAD_STATES)[number])) {
    throw new TypeError(
      `${apiName} waitUntil must be one of ${LOAD_STATES.map((state) => JSON.stringify(state)).join(", ")}`,
    );
  }
  return value as (typeof LOAD_STATES)[number];
}

export function timeoutDeadline(timeout: number, now: number) {
  return timeout === 0 ? Number.POSITIVE_INFINITY : now + timeout;
}

/**
 * Convert a shared deadline back into a child-operation timeout.
 * Zero remains reserved for an explicitly disabled timeout.
 */
export function remainingTimeout(deadline: number, now: number) {
  return deadline === Number.POSITIVE_INFINITY
    ? 0
    : Math.max(1, deadline - now);
}
