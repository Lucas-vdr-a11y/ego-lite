import type { EventAdmissionContext } from "./event-admission.js";
import { acceptEvent } from "./event-admission.js";
import type { FrameRegistry } from "./frame-registry.js";
import type { PendingCommands } from "./pending-commands.js";
import { rewriteIncomingProtocolMessage } from "./protocol.js";
import type { SessionTables } from "./session-tables.js";
import type { PageRoute } from "./types.js";

export type EventDeliveryContext = {
  readonly tables: SessionTables;
  readonly frames: FrameRegistry;
  readonly pendingIds: PendingCommands;
  // The parking lot for events that were unroutable when they arrived. Shared
  // with the navigation flows, which read it to tell a real commit from a
  // synthetic one.
  readonly deferredEvents: any[];
  readonly admission: EventAdmissionContext;
  emit: (message: any) => void;
  removeRoute: (route: PageRoute) => void;
};

/**
 * The last step before an event reaches the client, and the queue of events
 * that could not take that step yet.
 *
 * An event is delivered only once the transport's own view of the topology
 * agrees with what the event says — `deliverEvent` is where a target's session
 * mapping is updated from the very event announcing it, so that whatever the
 * client does in response resolves against the same tables.
 */

export function deliverEvent(context: EventDeliveryContext, message: any) {
  const { tables } = context;
  if (message.method === "Target.attachedToTarget") {
    const targetId = message.params?.targetInfo?.targetId;
    const sessionId = message.params?.sessionId;
    if (typeof targetId === "string" && typeof sessionId === "string") {
      const previousSession = tables.sessionsByTarget.get(targetId);
      if (previousSession) tables.targetsBySession.delete(previousSession);
      tables.sessionsByTarget.set(targetId, sessionId);
      tables.targetsBySession.set(sessionId, targetId);
    }
  } else if (message.method === "Target.detachedFromTarget") {
    const sessionId = message.params?.sessionId;
    const targetId =
      message.params?.targetId ||
      (typeof sessionId === "string"
        ? tables.targetsBySession.get(sessionId)
        : undefined);
    if (typeof targetId === "string" && !message.params?.targetId) {
      message.params = { ...(message.params || {}), targetId };
    }
    if (typeof targetId === "string") tables.sessionsByTarget.delete(targetId);
    if (typeof sessionId === "string") {
      tables.targetsBySession.delete(sessionId);
      tables.nativeParentSessions.delete(sessionId);
    }
  } else if (message.method === "Target.targetDestroyed") {
    const targetId = message.params?.targetId;
    if (typeof targetId === "string") {
      tables.targetIds?.delete(targetId);
      context.frames.forgetTarget(
        tables.routesByNativeTarget.get(targetId)?.clientTargetId || targetId,
      );
    }
  }
  context.emit(message);
}

export function flushDeferredEvents(context: EventDeliveryContext) {
  // A parked event's enabling event can sit *behind* it in this same queue: a
  // nested OOPIF's Runtime.executionContextCreated arrives before the attach
  // that registers its session, and that attach is itself parked behind its
  // parent's. One pass would re-park the context event after having already
  // walked past it, and #endOperation then discards it — stranding
  // Frame._utilityContext() forever. So keep passing while a pass delivers
  // something. Delivery only ever reaches #emit (a setImmediate), so no pass
  // can synchronously enqueue more work and the loop terminates: it either
  // shrinks the queue or stops.
  for (;;) {
    const delivered = flushDeferredEventsOnce(context);
    if (delivered === 0) return;
  }
}

function flushDeferredEventsOnce(context: EventDeliveryContext) {
  let delivered = 0;
  const events = context.deferredEvents.splice(0);
  for (const message of events) {
    if (!acceptEvent(context.admission, message)) {
      context.deferredEvents.push(message);
      continue;
    }
    delivered += 1;
    context.frames.observeEvent(message);
    const restoredFrames =
      context.frames.restoreFrameBeforeOopifAttach(message);
    context.tables.recordNativeParentSession(message);
    const route =
      typeof message.sessionId === "string"
        ? context.tables.routesByNativeSession.get(message.sessionId)
        : undefined;
    if (route) {
      message.sessionId = route.clientSessionId;
      rewriteIncomingProtocolMessage(message, route);
    }
    for (const event of restoredFrames) {
      if (route) {
        event.sessionId = route.clientSessionId;
        rewriteIncomingProtocolMessage(event, route);
      }
      deliverEvent(context, event);
    }
    deliverEvent(context, message);
  }
  return delivered;
}

/**
 * Tears down a route whose page is gone and tells the client its session
 * detached.
 */
export function deliverDetachedRoute(
  context: EventDeliveryContext,
  route: PageRoute,
) {
  const clientSessionId = route.clientSessionId;
  const clientTargetId = route.clientTargetId;
  context.removeRoute(route);
  context.tables.targetIds?.delete(clientTargetId);
  // After a navigation replacement the native id differs from the client
  // id; drop both so the dead tab cannot linger in the task-space set.
  context.tables.targetIds?.delete(route.nativeTargetId);
  deliverEvent(context, {
    method: "Target.detachedFromTarget",
    params: {
      sessionId: clientSessionId,
      targetId: clientTargetId,
    },
  });
}

/**
 * Forwards the detach of an OOPIF's passthrough session, reporting whether the
 * message belonged to one. A detach the transport asked for, and one the client
 * itself asked for and is still awaiting a reply to, are both consumed silently:
 * the client learns of them through its own command's response.
 */
export function deliverPassthroughDetach(
  context: EventDeliveryContext,
  message: any,
) {
  const { tables } = context;
  if (message.method !== "Target.detachedFromTarget") return false;
  const nativeSessionId = message.params?.sessionId;
  if (typeof nativeSessionId !== "string") return false;
  const clientSessionId =
    tables.passthroughClientSessionsByNative.get(nativeSessionId);
  if (!clientSessionId) return false;
  const session = tables.passthroughSessions.get(clientSessionId);
  if (!session) return false;
  tables.passthroughSessions.delete(clientSessionId);
  tables.passthroughClientSessionsByNative.delete(nativeSessionId);
  if (tables.internallyDetachedSessions.has(nativeSessionId)) {
    tables.internallyDetachedSessions.delete(nativeSessionId);
    return true;
  }
  if (
    [...context.pendingIds.values()].some(
      (pending) => pending.detachedSessionId === clientSessionId,
    )
  ) {
    return true;
  }
  const params = { ...(message.params || {}) };
  if (params.targetId === session.nativeTargetId) {
    params.targetId = session.clientTargetId;
  }
  params.sessionId = clientSessionId;
  context.emit({ ...message, params });
  return true;
}
