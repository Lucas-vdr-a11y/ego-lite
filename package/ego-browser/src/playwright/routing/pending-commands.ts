import type { PendingCommand } from "./types.js";

export type PendingCommandsOptions = {
  emit: (message: any) => void;
  // A pending command counts as pending work; the aggregate republishes when
  // the table changes size.
  onPendingChange: () => void;
  // Rejecting a Page.getFrameTree must also drop the barrier it was holding.
  failBarrier: (
    method: unknown,
    sessionId: string | undefined,
    description: string,
  ) => void;
};

/**
 * The commands the client forwarded to native and is still waiting on.
 *
 * Keyed by the native id the transport allocated for each, since that is what
 * comes back in the reply; the entry carries whatever the response path needs
 * to translate the reply back into the client's world — its own id and session,
 * and the target or session the command was about.
 *
 * Every exit from this table is an answer to the client. A command that is
 * dropped without one strands a Playwright promise forever, so the rejection
 * helpers here are the only way entries leave other than a native reply.
 */
export class PendingCommands {
  readonly #pending = new Map<number, PendingCommand>();
  readonly #options: PendingCommandsOptions;

  constructor(options: PendingCommandsOptions) {
    this.#options = options;
  }

  get size() {
    return this.#pending.size;
  }

  set(nativeId: number, pending: PendingCommand) {
    this.#pending.set(nativeId, pending);
  }

  get(nativeId: number) {
    return this.#pending.get(nativeId);
  }

  /** Reports whether the entry was still there, as `Map.delete` does. */
  delete(nativeId: number) {
    return this.#pending.delete(nativeId);
  }

  values() {
    return this.#pending.values();
  }

  clear() {
    this.#pending.clear();
  }

  /** The entries as of now, for a caller that answers them all and clears. */
  drain() {
    const entries = [...this.#pending.values()];
    this.#pending.clear();
    return entries;
  }

  rejectMatching(
    matches: (pending: PendingCommand) => boolean,
    clientSessionId: string,
    description: string,
  ) {
    let changed = false;
    for (const [nativeId, pending] of this.#pending) {
      if (!matches(pending)) continue;
      this.#pending.delete(nativeId);
      changed = true;
      this.#options.failBarrier(
        pending.method,
        pending.clientSessionId || clientSessionId,
        description,
      );
      this.#options.emit({
        id: pending.clientId,
        error: {
          code: -32_000,
          message: description,
        },
        sessionId: pending.clientSessionId || clientSessionId,
      });
    }
    if (changed) this.#options.onPendingChange();
  }

  rejectSessionCommands(nativeSessionId: string, clientSessionId: string) {
    this.rejectMatching(
      (pending) => pending.nativeSessionId === nativeSessionId,
      clientSessionId,
      "native CDP session detached during the command",
    );
  }
}
