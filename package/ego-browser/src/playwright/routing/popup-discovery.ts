import { type PendingWork, trackOperation } from "./pending-work.js";
import type { SessionTables } from "./session-tables.js";
import type { EgoCdpRuntime } from "./types.js";

export type PopupDiscoveryOptions = {
  readonly runtime: EgoCdpRuntime;
  readonly tables: SessionTables;
  readonly work: PendingWork;
  isClosed: () => boolean;
  endOperation: () => void;
  attachTaskSpaceTarget: (
    targetId: string,
    openerId?: string,
  ) => Promise<unknown>;
};

/**
 * Finds the tabs a page opened for itself and brings them into scope.
 *
 * Native reports no target for a `window.open()` in a TaskSpace-scoped
 * transport — the new tab is simply outside the scope, so the client would
 * never learn the popup exists. The only signal is the opener's own
 * `Page.windowOpen`, so discovery polls the tab list and pairs each unclaimed
 * tab with a queued open.
 *
 * The scan is single-flight per transport: every `window.open()` queues its own
 * entry and one loop serves the whole queue, so concurrently opened popups are
 * all attached rather than racing each other's scans.
 */
export class PopupDiscovery {
  readonly #options: PopupDiscoveryOptions;
  readonly #queue: Array<{ openerTargetId?: string; expectedUrl?: string }> =
    [];
  #deadline = 0;
  #running = false;

  constructor(options: PopupDiscoveryOptions) {
    this.#options = options;
  }

  discover(openerTargetId?: string, expectedUrl?: string) {
    const { runtime, tables } = this.#options;
    if (!tables.targetIds || typeof runtime.listTabs !== "function") {
      return;
    }
    // Every windowOpen queues its own discovery entry; a single scan loop
    // serves the whole queue so concurrently opened popups are all attached.
    this.#queue.push({ openerTargetId, expectedUrl });
    this.#deadline = Date.now() + 2_000;
    if (this.#running) return;
    this.#running = true;
    trackOperation(
      this.#options,
      "popup discovery",
      () =>
        (async () => {
          // Consecutive polls each unclaimed tab has reported the same URL, used
          // to tell committed navigations from in-flight ones (loop-local: the
          // scan loop is single-flight per transport).
          const urlStability = new Map<
            string,
            { url: unknown; polls: number }
          >();
          do {
            const listed = await runtime.listTabs!();
            const tabs = listed?.tabs || listed?.targetInfos || [];
            const deadlineImminent = this.#deadline - Date.now() < 300;
            for (const tab of tabs) {
              const targetId = tab.targetId;
              if (
                typeof targetId !== "string" ||
                tables.targetIds!.has(targetId) ||
                // A tab that already backs a route is never a popup candidate,
                // regardless of any drift in the task-space target set.
                tables.routesByNativeTarget.has(targetId)
              ) {
                continue;
              }
              const queue = this.#queue;
              if (queue.length === 0) break;
              const seen = urlStability.get(targetId);
              const polls = seen && seen.url === tab.url ? seen.polls + 1 : 1;
              urlStability.set(targetId, { url: tab.url, polls });
              let index = queue.findIndex(
                (entry) =>
                  typeof entry.expectedUrl === "string" &&
                  entry.expectedUrl === tab.url,
              );
              // A popup's URL can change before discovery (server redirect, or a
              // scripted location assignment after window.open()), so an exact
              // URL miss must not leave a queued entry unspent while an unclaimed
              // tab exists. Fall back to the oldest entry, but only once the
              // tab's URL has settled — attaching mid-navigation races the
              // client's page init against the commit and can leave the page
              // stuck on a stale URL — or once the deadline is imminent, so
              // popups that never navigate (bare window.open()) are not lost.
              // Concurrent redirecting popups may then pair with the wrong
              // opener, which is still better than losing the popup.
              if (index === -1) {
                const settled =
                  typeof tab.url === "string" && tab.url !== "" && polls >= 3;
                if (!settled && !deadlineImminent) continue;
                index = 0;
              }
              const [entry] = queue.splice(index, 1);
              tables.targetIds!.add(targetId);
              await this.#options.attachTaskSpaceTarget(
                targetId,
                entry.openerTargetId,
              );
            }
            if (this.#queue.length === 0) return;
            await new Promise<void>((resolve) => setTimeout(resolve, 20));
          } while (!this.#options.isClosed() && Date.now() < this.#deadline);
          this.#queue.length = 0;
        })().catch(() => undefined),
      {
        // Released before the operation stops counting, so the next windowOpen
        // starts a fresh scan rather than queueing onto a loop that has already
        // walked past its queue.
        beforeEnd: () => {
          this.#running = false;
        },
      },
    );
  }
}
