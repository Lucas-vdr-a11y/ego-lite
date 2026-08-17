import { guardNativeCallback } from "../../browser-runtime.js";

type InternalRequest = {
  resolve: (result: any) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export type NativeCommandChannelOptions = {
  allocateMessageId: () => number;
  send: (payload: string) => unknown;
  // Called whenever the in-flight count changes, so the transport's pending-work
  // aggregate can republish. The channel never reads the aggregate itself.
  onPendingChange: () => void;
};

/**
 * The transport's own CDP commands to native — the ones it issues on its own
 * behalf, never on a client id. Every one gets an id from the shared allocator
 * so it can never collide with a forwarded client command, and every id in
 * flight counts as pending work.
 */
export class NativeCommandChannel {
  readonly #allocateMessageId: () => number;
  readonly #send: (payload: string) => unknown;
  readonly #onPendingChange: () => void;
  readonly #inFlight = new Map<number, InternalRequest>();

  constructor(options: NativeCommandChannelOptions) {
    this.#allocateMessageId = options.allocateMessageId;
    this.#send = options.send;
    this.#onPendingChange = options.onPendingChange;
  }

  get size() {
    return this.#inFlight.size;
  }

  /**
   * Answers a native reply if it belongs to this channel, reporting whether it
   * was consumed — an id the channel does not own is a forwarded client command
   * and stays the caller's to route.
   */
  settle(message: any): boolean {
    const request = this.#inFlight.get(message.id);
    if (!request) return false;
    clearTimeout(request.timer);
    this.#inFlight.delete(message.id);
    this.#onPendingChange();
    if (message.error) {
      request.reject(new Error(message.error.message || "CDP error"));
    } else {
      request.resolve(message.result);
    }
    return true;
  }

  rejectAll(description: string) {
    for (const request of this.#inFlight.values()) {
      clearTimeout(request.timer);
      request.reject(new Error(description));
    }
    this.#inFlight.clear();
  }

  fireAndForget(
    method: string,
    params: Record<string, unknown>,
    sessionId?: string,
  ) {
    const id = this.#allocateMessageId();
    try {
      void Promise.resolve(
        this.#send(
          JSON.stringify({
            id,
            method,
            params,
            ...(sessionId ? { sessionId } : {}),
          }),
        ),
      ).catch(() => undefined);
    } catch {
      // Cleanup and resume commands are best-effort compatibility traffic.
    }
  }

  command(
    method: string,
    params: Record<string, unknown>,
    sessionId?: string,
    timeoutMs = 10_000,
  ) {
    const id = this.#allocateMessageId();
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#inFlight.delete(id);
        // The guard is what lets this read in the obvious order: a throwing
        // pending-work observer is contained here, so it can neither strand the
        // rejection below nor escape a timer callback, where an uncaught
        // exception ends the whole shared NodeService.
        guardNativeCallback(`native command timeout (${method})`, () =>
          this.#onPendingChange(),
        );
        reject(new Error(`native CDP command timed out: ${method}`));
      }, timeoutMs);
      this.#inFlight.set(id, { resolve, reject, timer });
      this.#onPendingChange();
      try {
        const result = this.#send(
          JSON.stringify({
            id,
            method,
            params,
            ...(sessionId ? { sessionId } : {}),
          }),
        );
        void Promise.resolve(result).catch((error) => {
          const pending = this.#inFlight.get(id);
          if (!pending) return;
          clearTimeout(pending.timer);
          this.#inFlight.delete(id);
          this.#onPendingChange();
          pending.reject(
            error instanceof Error ? error : new Error(String(error)),
          );
        });
      } catch (error) {
        clearTimeout(timer);
        this.#inFlight.delete(id);
        this.#onPendingChange();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
}
