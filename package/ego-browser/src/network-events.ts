import { cdp } from "./cdp-eval.js";
import { isEgoHardStopError } from "./ego-errors.js";
import { state } from "./state.js";

type SessionNetworkState = {
  users: number;
  ownDomain: boolean;
  enableInFlight: Promise<void> | null;
};

const DEFAULT_SESSION = Symbol("default-network-session");
const sessionStates = new Map<string | symbol, SessionNetworkState>();

export type NetworkEventLease = {
  ready: Promise<void>;
  sessionId: Promise<string | undefined>;
  release: () => Promise<void>;
};

/**
 * Keep CDP Network events enabled while a consumer correlates requests.
 * The last consumer disables the domain only when this module enabled it.
 */
export function acquireNetworkEvents(
  sessionId: string | Promise<string> | undefined = undefined,
  timeoutMs: number | undefined = undefined,
): NetworkEventLease {
  const acquisition = Promise.resolve(sessionId).then((resolvedSessionId) => {
    const key = resolvedSessionId || DEFAULT_SESSION;
    let sessionState = sessionStates.get(key);
    if (!sessionState) {
      sessionState = {
        users: 0,
        ownDomain: false,
        enableInFlight: null,
      };
      sessionStates.set(key, sessionState);
    }
    if (
      sessionState.users === 0 &&
      !sessionState.enableInFlight &&
      !isDomainEnabled(resolvedSessionId)
    ) {
      sessionState.enableInFlight = cdp(
        "Network.enable",
        {},
        resolvedSessionId,
        timeoutMs,
      )
        .then(() => {
          sessionState.ownDomain = true;
        })
        .catch((error) => {
          if (
            isEgoHardStopError(error) ||
            !isUnsupportedNetworkDomainError(error)
          ) {
            throw error;
          }
          // Consumers retain their normal timeout behavior when a bridge
          // does not expose the Network domain.
        })
        .finally(() => {
          sessionState.enableInFlight = null;
        });
    }
    sessionState.users += 1;
    return {
      key,
      sessionId: resolvedSessionId,
      sessionState,
      ready: sessionState.enableInFlight || Promise.resolve(),
    };
  });
  let released = false;
  const ready = acquisition.then(({ ready }) => ready);
  const resolvedSessionId = acquisition.then(
    ({ sessionId: acquiredSessionId }) => acquiredSessionId,
  );
  // A consumer may only need one half of the lease. Mark both derived promises
  // as observed so a shared acquisition failure is reported by the promise the
  // consumer actually awaits instead of also becoming an unhandled rejection.
  void ready.catch(() => {});
  void resolvedSessionId.catch(() => {});
  return {
    ready,
    sessionId: resolvedSessionId,
    release: async () => {
      if (released) return;
      released = true;
      const acquired = await acquisition.catch(() => null);
      if (!acquired) return;
      const { key, sessionId: resolvedSessionId, sessionState } = acquired;
      sessionState.users = Math.max(0, sessionState.users - 1);
      if (sessionState.users > 0) return;
      if (sessionState.enableInFlight) {
        await sessionState.enableInFlight;
      }
      // Another consumer may have acquired the same session while enable was
      // in flight. In that case it now owns the shared lease lifetime.
      if (sessionState.users > 0) return;
      if (sessionState.ownDomain) {
        sessionState.ownDomain = false;
        await cdp("Network.disable", {}, resolvedSessionId).catch(() => {
          // Best-effort cleanup; the next consumer can enable it again.
        });
      }
      sessionStates.delete(key);
    },
  };
}

function isDomainEnabled(sessionId: string | undefined) {
  return (
    state.networkDomainEnabled &&
    (sessionId === undefined || sessionId === state.sessionId)
  );
}

function isUnsupportedNetworkDomainError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /Network\.enable.*(?:wasn't found|not found|unsupported|not supported)|Method not found/i.test(
    message,
  );
}
