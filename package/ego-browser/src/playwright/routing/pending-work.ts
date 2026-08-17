import { catchGuarded } from "../../browser-runtime.js";

// The Node event loop must stay alive while the transport still owes the client
// an answer: nothing else holds a handle, so a quiet moment between a command
// and its native reply would let the process exit mid-task.
export function createNodeKeepAlive() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (pendingWork: number) => {
    if (pendingWork > 0 && !timer) {
      timer = setTimeout(() => {}, 2_147_483_647);
    } else if (pendingWork === 0 && timer) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
}

export type PendingWorkOptions = {
  onChange: (count: number) => void;
  // Everything outside this tracker that also counts as work in flight:
  // forwarded commands awaiting a native reply, the transport's own internal
  // commands, and messages a frame-tree barrier is holding. The tracker owns no
  // copy of those numbers — it is an aggregate view, and reading them on demand
  // is what keeps the view from drifting out of sync with the real tables.
  contributors: () => number;
  isClosed: () => boolean;
};

/**
 * How many things the transport still owes somebody, published to the keep-alive
 * so the process neither exits mid-command nor lingers after the last one.
 */
export class PendingWork {
  readonly #onChange: (count: number) => void;
  readonly #contributors: () => number;
  readonly #isClosed: () => boolean;
  #operations = 0;
  #connecting = true;
  #lastPublished = 0;

  constructor(options: PendingWorkOptions) {
    this.#onChange = options.onChange;
    this.#contributors = options.contributors;
    this.#isClosed = options.isClosed;
  }

  get operations() {
    return this.#operations;
  }

  beginOperation() {
    this.#operations += 1;
    this.update();
  }

  /**
   * Drops one operation and reports whether that was the last one. The caller
   * decides what an idle transport means — the deferred-event queue is only
   * safe to discard once nothing is in flight — so this deliberately does not
   * publish yet; call {@link update} after that decision.
   */
  endOperation() {
    this.#operations -= 1;
    return this.#operations === 0;
  }

  releaseConnectionKeepAlive() {
    if (!this.#connecting) return false;
    this.#connecting = false;
    this.update();
    return true;
  }

  update() {
    const count = this.#isClosed()
      ? 0
      : Number(this.#connecting) + this.#contributors() + this.#operations;
    if (count === this.#lastPublished) return;
    this.#lastPublished = count;
    this.#onChange(count);
  }
}

export type OperationHost = {
  readonly work: PendingWork;
  // The transport's own endOperation, not PendingWork's: it also replays the
  // deferred-event queue once nothing is left in flight.
  endOperation: () => void;
};

/**
 * Runs one detached background operation, with the three things every one of
 * them has to get right.
 *
 * The counter keeps Node alive until the operation settles. The cleanup runs
 * whichever way it settled. And the guard sits at the very end of the chain,
 * *after* the cleanup — a throw inside a `.finally` rejects the chain past its
 * own `.catch`, so a guard attached any earlier would let it escape into a timer
 * callback and end the shared NodeService.
 *
 * `beforeEnd` runs while the operation still counts as in flight; `afterEnd`
 * runs once it no longer does, which is also when a now-idle transport has
 * already replayed and discarded its deferred events. Sites that care about
 * that boundary — re-entering the send path, say — belong in `afterEnd`.
 *
 * Not for an operation whose promise a caller still needs: `runNavigationReplacement`
 * hands its chain back so the next navigation can queue behind it, and owns its
 * own counter and guard for that reason.
 */
export function trackOperation(
  host: OperationHost,
  label: string,
  body: () => Promise<unknown>,
  cleanup: { beforeEnd?: () => void; afterEnd?: () => void } = {},
) {
  host.work.beginOperation();
  void body()
    .finally(() => {
      cleanup.beforeEnd?.();
      host.endOperation();
      cleanup.afterEnd?.();
    })
    .catch(catchGuarded(label));
}
