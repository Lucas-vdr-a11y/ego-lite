import type { PendingCommand } from "./types.js";
import type { SessionTables } from "./session-tables.js";

export type EventAdmissionContext = {
  readonly tables: SessionTables;
  // Dropping a barrier answers whatever Target.setAutoAttach it held.
  dropBarrier: (sessionId: string, description: string) => void;
  rejectPendingCommands: (
    predicate: (pending: PendingCommand) => boolean,
    sessionId: string,
    description: string,
  ) => void;
};

/**
 * Whether the client is entitled to see a native event at all.
 *
 * A TaskSpace-scoped transport shows the client only the targets in its scope,
 * and never the attaches, detaches, and closes the transport performed on its
 * own behalf. Both filters read the same tables — see {@link SessionTables} for
 * why the tombstone sets exist.
 */
export function acceptEvent(context: EventAdmissionContext, message: any) {
  const tables = context.tables;
  if (!tables.targetIds) return true;
  if (message.method === "Target.attachedToTarget") {
    const targetInfo = message.params?.targetInfo;
    if (tables.manuallyAttachingTargets.has(targetInfo?.targetId)) {
      return false;
    }
    if (tables.routesByNativeTarget.has(targetInfo?.targetId)) return false;
    if (
      tables.sessionsByTarget.get(targetInfo?.targetId) ===
      message.params?.sessionId
    ) {
      return false;
    }
    if (
      targetInfo?.type === "iframe" &&
      typeof message.sessionId === "string" &&
      (tables.routesByNativeSession.has(message.sessionId) ||
        tables.targetsBySession.has(message.sessionId))
    ) {
      return true;
    }
    tables.admitTargetFromOpener(targetInfo);
    return tables.targetIds.has(targetInfo?.targetId);
  }
  if (message.method === "Target.detachedFromTarget") {
    const targetId = message.params?.targetId;
    const sessionId = message.params?.sessionId;
    if (
      typeof sessionId === "string" &&
      tables.internallyDetachedSessions.has(sessionId)
    ) {
      return false;
    }
    return (
      tables.sessionsByTarget.get(targetId) === sessionId ||
      tables.targetsBySession.has(sessionId)
    );
  }
  if (
    message.method === "Target.targetCreated" ||
    message.method === "Target.targetInfoChanged"
  ) {
    const targetInfo = message.params?.targetInfo;
    tables.admitTargetFromOpener(targetInfo);
    return (
      tables.targetIds.has(targetInfo?.targetId) ||
      tables.routesByNativeTarget.has(targetInfo?.targetId)
    );
  }
  if (message.method === "Target.targetDestroyed") {
    return (
      tables.targetIds.has(message.params?.targetId) ||
      tables.routesByNativeTarget.has(message.params?.targetId)
    );
  }
  if (typeof message.sessionId === "string") {
    return (
      tables.targetsBySession.has(message.sessionId) ||
      tables.passthroughClientSessionsByNative.has(message.sessionId)
    );
  }
  return true;
}

export function isManualAttachEvent(tables: SessionTables, message: any) {
  return (
    message.method === "Target.attachedToTarget" &&
    tables.manuallyAttachingTargets.has(message.params?.targetInfo?.targetId)
  );
}

export function isInternalDetachEvent(tables: SessionTables, message: any) {
  return (
    message.method === "Target.detachedFromTarget" &&
    tables.internallyDetachedSessions.has(message.params?.sessionId)
  );
}

export function isInternalTargetCloseEvent(
  tables: SessionTables,
  message: any,
) {
  return (
    message.method === "Target.targetDestroyed" &&
    tables.internallyClosedTargets.has(message.params?.targetId)
  );
}

export function isRetiredSessionEvent(tables: SessionTables, message: any) {
  return (
    typeof message.sessionId === "string" &&
    tables.retiredNativeSessions.has(message.sessionId)
  );
}

// A retired session's own events are noise, but a detach arriving on it still
// reports news the transport must act on: the child session named in params
// is gone. Closing a page retires that page's native session, and its OOPIF
// children detach afterwards on exactly that session — so without this the
// whole subtree is never reclaimed. Nothing is forwarded: Playwright disposed
// those child sessions itself when it disposed the parent frame session, so a
// detach for them would name a session it no longer knows.
export function reapDetachedChildSession(
  context: EventAdmissionContext,
  message: any,
) {
  const tables = context.tables;
  if (message.method !== "Target.detachedFromTarget") return;
  const sessionId = message.params?.sessionId;
  if (typeof sessionId !== "string") return;
  const targetId =
    typeof message.params?.targetId === "string"
      ? message.params.targetId
      : tables.targetsBySession.get(sessionId);
  // Only drop the target mapping if it still names this session; a rebind may
  // already have pointed the target at a live replacement.
  if (
    typeof targetId === "string" &&
    tables.sessionsByTarget.get(targetId) === sessionId
  ) {
    tables.sessionsByTarget.delete(targetId);
  }
  tables.targetsBySession.delete(sessionId);
  tables.nativeParentSessions.delete(sessionId);
  tables.retiredNativeSessions.delete(sessionId);
  tables.internallyDetachedSessions.delete(sessionId);
  const passthroughClientSession =
    tables.passthroughClientSessionsByNative.get(sessionId);
  if (passthroughClientSession) {
    tables.passthroughSessions.delete(passthroughClientSession);
    tables.passthroughClientSessionsByNative.delete(sessionId);
  }
  const description = "the session detached with its page";
  context.dropBarrier(sessionId, description);
  // Commands still in flight on that session can never be answered natively.
  context.rejectPendingCommands(
    (pending) =>
      pending.nativeSessionId === sessionId ||
      (!pending.nativeSessionId && pending.clientSessionId === sessionId),
    sessionId,
    description,
  );
}
