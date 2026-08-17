import { guardNativeCallback } from "../../browser-runtime.js";
import type { FrameTreeBarrier, PendingCommand } from "./types.js";

export type FrameTreeBarriersOptions = {
  timeoutMs: number;
  // Whether a session is one whose Page.getFrameTree deserves a barrier at all:
  // a page route's session, or a TaskSpace target's session.
  isPageSession: (sessionId: string) => boolean;
  emit: (message: any) => void;
  // A held message counts as pending work; the aggregate republishes on change.
  onHeldChange: () => void;
  // Re-enters the transport's send path for a released Target.setAutoAttach.
  replay: (message: any) => void;
  canReplay: () => boolean;
  // The barrier's timeout must also answer the Page.getFrameTree it guarded,
  // which lives in the transport's forwarded-command table.
  rejectPendingCommands: (
    predicate: (pending: PendingCommand) => boolean,
    sessionId: string,
    description: string,
  ) => void;
};

/**
 * Holds a session's Target.setAutoAttach until its Page.getFrameTree is
 * answered.
 *
 * Playwright awaits both in one Promise.all, so ordering matters and a barrier
 * that outlives its Page.getFrameTree hangs page initialization forever: every
 * path that drops the command must answer what the barrier holds.
 */
export class FrameTreeBarriers {
  readonly #barriers = new Map<string, FrameTreeBarrier>();
  readonly #options: FrameTreeBarriersOptions;

  constructor(options: FrameTreeBarriersOptions) {
    this.#options = options;
  }

  has(sessionId: string) {
    return this.#barriers.has(sessionId);
  }

  heldCount() {
    let held = 0;
    for (const barrier of this.#barriers.values()) {
      held += barrier.heldAutoAttach.length;
    }
    return held;
  }

  clear() {
    for (const sessionId of [...this.#barriers.keys()]) {
      this.#forget(sessionId);
    }
  }

  /**
   * The only way a barrier leaves the map. Clearing the timer and forgetting the
   * barrier are one step, so no path can drop a barrier and leave its deadline
   * armed to fire against whatever takes its place.
   *
   * Returns the barrier that was there, or undefined if none was — which is what
   * makes every caller idempotent.
   */
  #forget(sessionId: string) {
    const barrier = this.#barriers.get(sessionId);
    if (!barrier) return undefined;
    clearTimeout(barrier.timer);
    this.#barriers.delete(sessionId);
    return barrier;
  }

  /**
   * Opens a barrier on a session's Page.getFrameTree and holds any
   * Target.setAutoAttach that follows, reporting whether the message was
   * consumed. Everything else passes through untouched.
   */
  intercept(message: any): boolean {
    const sessionId =
      typeof message.sessionId === "string" ? message.sessionId : undefined;
    if (!sessionId) return false;
    if (
      message.method === "Page.getFrameTree" &&
      this.#options.isPageSession(sessionId)
    ) {
      if (!this.#barriers.has(sessionId)) {
        const barrier: FrameTreeBarrier = {
          heldAutoAttach: [],
          // The callback closes over `barrier` itself, which is why it can only
          // be written here: the identity check is what stops a timer that
          // outlived its own barrier from dropping the successor sharing this
          // session id.
          timer: setTimeout(() => {
            guardNativeCallback("frame-tree barrier timeout", () => {
              if (this.#barriers.get(sessionId) !== barrier) return;
              const description = `Page.getFrameTree went unanswered for ${this.#options.timeoutMs}ms`;
              this.drop(sessionId, description);
              this.#options.rejectPendingCommands(
                (pending) =>
                  pending.method === "Page.getFrameTree" &&
                  pending.clientSessionId === sessionId,
                sessionId,
                description,
              );
            });
          }, this.#options.timeoutMs),
        };
        barrier.timer.unref?.();
        this.#barriers.set(sessionId, barrier);
      }
      return false;
    }
    const barrier = this.#barriers.get(sessionId);
    if (
      message.method !== "Target.setAutoAttach" ||
      !message.params?.autoAttach ||
      !barrier
    ) {
      return false;
    }
    barrier.heldAutoAttach.push(message);
    this.#options.onHeldChange();
    return true;
  }

  release(
    pending: Pick<PendingCommand, "method" | "clientSessionId">,
    message: any,
  ) {
    const sessionId = pending.clientSessionId;
    if (
      pending.method !== "Page.getFrameTree" ||
      typeof sessionId !== "string"
    ) {
      return;
    }
    const barrier = this.#barriers.get(sessionId);
    if (!barrier) return;
    if (message.error) {
      this.failFor(
        pending.method,
        sessionId,
        message.error.message || "Page.getFrameTree failed",
      );
      return;
    }
    // Replay re-enters the whole routing path, and the client's own dispatch
    // runs underneath it — a throw anywhere in here is an uncaught exception in
    // a timer callback. One unreleased barrier is recoverable; aborting every
    // concurrent agent script is not.
    setImmediate(() => {
      guardNativeCallback("frame-tree barrier release", () => {
        if (this.#barriers.get(sessionId) !== barrier) return;
        this.#forget(sessionId);
        const held = barrier.heldAutoAttach.splice(0);
        this.#options.onHeldChange();
        if (!this.#options.canReplay()) return;
        for (const heldMessage of held) {
          guardNativeCallback("held Target.setAutoAttach replay", () =>
            this.#options.replay(heldMessage),
          );
        }
      });
    });
  }

  failFor(method: unknown, sessionId: string | undefined, description: string) {
    if (method !== "Page.getFrameTree" || !sessionId) return;
    this.drop(sessionId, description);
  }

  drop(sessionId: string, description: string) {
    const barrier = this.#forget(sessionId);
    if (!barrier) return;
    for (const held of barrier.heldAutoAttach) {
      this.#options.emit({
        id: held.id,
        error: { code: -32_000, message: description },
        sessionId,
      });
    }
    this.#options.onHeldChange();
  }
}
