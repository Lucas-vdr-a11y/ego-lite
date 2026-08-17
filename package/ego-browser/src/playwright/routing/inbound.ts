import {
  acceptEvent,
  isInternalDetachEvent,
  isInternalTargetCloseEvent,
  isManualAttachEvent,
  isRetiredSessionEvent,
  reapDetachedChildSession,
  type EventAdmissionContext,
} from "./event-admission.js";
import {
  deliverDetachedRoute,
  deliverEvent,
  deliverPassthroughDetach,
  flushDeferredEvents,
  type EventDeliveryContext,
} from "./event-delivery.js";
import type { FrameRegistry } from "./frame-registry.js";
import type { FrameTreeBarriers } from "./frame-tree-barrier.js";
import type { NativeCommandChannel } from "./native-commands.js";
import {
  observeRouteEvent,
  type PassiveNavigationContext,
} from "./passive-navigation.js";
import type { PendingCommands } from "./pending-commands.js";
import { type PendingWork, trackOperation } from "./pending-work.js";
import type { PopupDiscovery } from "./popup-discovery.js";
import {
  rewriteIncomingProtocolMessage,
  rewriteOutgoingProtocolParams,
} from "./protocol.js";
import type { SessionTables } from "./session-tables.js";
import {
  attachNativeTarget,
  replaceNativeRoute,
  type TargetLifecycleContext,
} from "./target-lifecycle.js";
import type { EgoCdpRuntime, PageRoute } from "./types.js";

export type InboundContext = {
  readonly runtime: EgoCdpRuntime;
  readonly tables: SessionTables;
  readonly native: NativeCommandChannel;
  readonly work: PendingWork;
  readonly barriers: FrameTreeBarriers;
  readonly frames: FrameRegistry;
  readonly pendingIds: PendingCommands;
  readonly popups: PopupDiscovery;
  readonly deferredEvents: any[];
  readonly admission: EventAdmissionContext;
  readonly delivery: EventDeliveryContext;
  readonly passive: PassiveNavigationContext;
  readonly targets: TargetLifecycleContext;
  isClosed: () => boolean;
  isClosing: () => boolean;
  emit: (message: any) => void;
  endOperation: () => void;
  flushHeldMessages: (route: PageRoute) => void;
};

/**
 * Everything native sends, on its way to the client.
 *
 * {@link dispatchNativeMessage} is the single entry point, and it forks once:
 * a message with an `id` is a reply to a command the client forwarded, and its
 * whole job is translating that reply back into the client's ids; a message
 * without one is an event, which must first survive a gauntlet of "is this the
 * client's business at all" checks — self-inflicted work, retired sessions,
 * out-of-scope targets — before it can be delivered or parked.
 */

export function dispatchNativeMessage(
  context: InboundContext,
  payload: string,
) {
  if (context.isClosed()) return;
  let message;
  try {
    message = JSON.parse(payload);
  } catch {
    return;
  }
  if (Object.hasOwn(message, "id")) {
    if (context.native.settle(message)) return;
    const pending = context.pendingIds.get(message.id);
    if (!pending) return;
    context.pendingIds.delete(message.id);
    context.work.update();
    if (
      pending.detachedSessionId &&
      message.error &&
      /closed|detached|no session with given id|session with given id not found/i.test(
        message.error.message || "",
      )
    ) {
      delete message.error;
      message.result = {};
    }
    message.id = pending.clientId;
    if (pending.clientSessionId) {
      message.sessionId = pending.clientSessionId;
    }
    const attachedSessionId = message.result?.sessionId;
    if (
      !message.error &&
      pending.attachedTarget &&
      typeof attachedSessionId === "string"
    ) {
      context.tables.passthroughSessions.set(attachedSessionId, {
        ...pending.attachedTarget,
        nativeSessionId: attachedSessionId,
        replayCommands: new Map(),
      });
      context.tables.passthroughClientSessionsByNative.set(
        attachedSessionId,
        attachedSessionId,
      );
    }
    if (!message.error && pending.detachedSessionId) {
      const detached = context.tables.passthroughSessions.get(
        pending.detachedSessionId,
      );
      if (detached) {
        context.tables.passthroughClientSessionsByNative.delete(
          detached.nativeSessionId,
        );
      }
      context.tables.passthroughSessions.delete(pending.detachedSessionId);
    }
    const restoredFrames = prepareFrameTreeResponse(context, pending, message);
    filterResponse(context, pending.method, message);
    context.emit(message);
    for (const event of restoredFrames) deliverEvent(context.delivery, event);
    context.barriers.release(pending, message);
    return;
  }
  if (discardAttachmentWhileClosing(context, message)) return;
  if (isRetiredSessionEvent(context.tables, message)) {
    reapDetachedChildSession(context.admission, message);
    return;
  }
  if (isInternalTargetCloseEvent(context.tables, message)) {
    // The tombstone has served its purpose once the close event arrives.
    context.tables.internallyClosedTargets.delete(message.params.targetId);
    return;
  }
  if (rebindDetachedRoute(context, message)) return;
  if (
    message.method === "Target.detachedFromTarget" &&
    typeof message.params?.sessionId === "string"
  ) {
    // A detached session emits no further events; drop its tombstone so the
    // retired set does not grow for the lifetime of the transport.
    context.tables.retiredNativeSessions.delete(message.params.sessionId);
  }
  if (deliverPassthroughDetach(context.delivery, message)) return;
  if (bridgeTransitionEvent(context, message)) return;
  if (!acceptEvent(context.admission, message)) {
    if (
      context.work.operations > 0 &&
      !isManualAttachEvent(context.tables, message) &&
      !isInternalDetachEvent(context.tables, message) &&
      context.deferredEvents.length < 10_000
    ) {
      context.deferredEvents.push(message);
    } else if (isInternalDetachEvent(context.tables, message)) {
      context.tables.internallyDetachedSessions.delete(
        message.params.sessionId,
      );
    }
    return;
  }
  const nativeSessionId =
    typeof message.sessionId === "string" ? message.sessionId : undefined;
  context.frames.observeEvent(message);
  const restoredFrames = context.frames.restoreFrameBeforeOopifAttach(message);
  context.tables.recordNativeParentSession(message);
  const route =
    typeof message.sessionId === "string"
      ? context.tables.routesByNativeSession.get(message.sessionId)
      : undefined;
  const passthroughClientSession = nativeSessionId
    ? context.tables.passthroughClientSessionsByNative.get(nativeSessionId)
    : undefined;
  const openerTargetId =
    route?.clientTargetId ||
    (nativeSessionId
      ? context.tables.targetsBySession.get(nativeSessionId)
      : undefined);
  if (route) {
    observeRouteEvent(context.passive, message, route);
    message.sessionId = route.clientSessionId;
    rewriteIncomingProtocolMessage(message, route);
  } else if (passthroughClientSession) {
    message.sessionId = passthroughClientSession;
  }
  for (const event of restoredFrames) {
    if (route) {
      event.sessionId = route.clientSessionId;
      rewriteIncomingProtocolMessage(event, route);
    }
    deliverEvent(context.delivery, event);
  }
  deliverEvent(context.delivery, message);
  if (message.method === "Page.windowOpen") {
    context.popups.discover(openerTargetId, message.params?.url);
  }
}

// Deliver Fetch events from an in-flight replacement session to the client
// while the navigation waits for commit. Interception cannot wait for the
// route swap: the paused document request is what commit is waiting on.
// Only the Fetch domain crosses early — Fetch traffic on the replacement
// session begins with our own post-transition replay, so the stream cannot
// straddle the deferred queue and arrive out of order.
function bridgeTransitionEvent(context: InboundContext, message: any) {
  const sessionId = message.sessionId;
  const method = message.method;
  if (typeof sessionId !== "string" || typeof method !== "string") {
    return false;
  }
  if (!method.startsWith("Fetch.")) return false;
  let route: PageRoute | undefined;
  for (const candidate of context.tables.routesByClientSession.values()) {
    if (
      candidate.transition?.nativeSessionId === sessionId &&
      candidate.state !== "closed"
    ) {
      route = candidate;
      break;
    }
  }
  if (!route) return false;
  const transition = route.transition!;
  const clientFrameId =
    message.params?.frameId === transition.nativeTargetId
      ? transition.clientFrameId
      : message.params?.frameId;
  const networkId = message.params?.networkId;
  if (
    method === "Fetch.requestPaused" &&
    typeof networkId === "string" &&
    !transition.announcedRequests.has(networkId)
  ) {
    // Chromium withholds the request's Network.requestWillBeSent until the
    // pause is resolved — yet Playwright dispatches interception only for
    // paused requests it can pair with one. Announce the request from the
    // pause's own payload; the real event arrives after the client resolves
    // the pause and is dropped at the swap so it is not delivered twice.
    transition.announcedRequests.add(networkId);
    const timestamp = Date.now() / 1_000;
    const isDocument = message.params?.resourceType === "Document";
    context.emit({
      method: "Network.requestWillBeSent",
      params: {
        requestId: networkId,
        ...(isDocument ? { loaderId: networkId } : {}),
        documentURL: message.params?.request?.url,
        request: message.params?.request,
        timestamp,
        wallTime: timestamp,
        initiator: { type: "other" },
        type: message.params?.resourceType,
        ...(clientFrameId !== undefined ? { frameId: clientFrameId } : {}),
        hasUserGesture: false,
      },
      sessionId: route.clientSessionId,
    });
  }
  // The replacement's main frame id equals its target id (native invariant);
  // the client knows that frame by the id it navigated.
  if (message.params?.frameId === transition.nativeTargetId) {
    message.params.frameId = transition.clientFrameId;
  }
  message.sessionId = route.clientSessionId;
  deliverEvent(context.delivery, message);
  return true;
}

function rebindDetachedRoute(context: InboundContext, message: any) {
  if (
    message.method !== "Target.detachedFromTarget" ||
    typeof context.runtime.listTabs !== "function"
  ) {
    return false;
  }
  const nativeSessionId = message.params?.sessionId;
  if (
    typeof nativeSessionId !== "string" ||
    context.tables.internallyDetachedSessions.has(nativeSessionId)
  ) {
    return false;
  }
  const route = context.tables.routesByNativeSession.get(nativeSessionId);
  if (!route || route.state !== "attached") return false;

  context.pendingIds.rejectSessionCommands(
    nativeSessionId,
    route.clientSessionId,
  );
  route.state = "rebinding";
  // The native session is already gone (its detach started this rebind);
  // nothing can be forwarded to it until the replacement is in place.
  route.nativeSessionDetached = true;
  context.tables.retiredNativeSessions.add(nativeSessionId);
  trackOperation(
    context,
    "detached-route rebind",
    async () => {
      try {
        const listed = await context.runtime.listTabs!();
        const tabs = listed?.tabs || listed?.targetInfos || [];
        if (!tabs.some((tab) => tab.targetId === route.nativeTargetId)) {
          deliverDetachedRoute(context.delivery, route);
          return;
        }

        const nativeTargetId = route.nativeTargetId;
        const nativeMainFrameId = route.nativeMainFrameId;
        const { sessionId: replacementSessionId } = await attachNativeTarget(
          context.targets,
          nativeTargetId,
        );
        replaceNativeRoute(
          context.targets,
          route,
          nativeTargetId,
          replacementSessionId,
          nativeMainFrameId,
        );
        for (const command of route.replayCommands.values()) {
          if (command.method === "Runtime.runIfWaitingForDebugger") continue;
          context.native.fireAndForget(
            command.method,
            rewriteOutgoingProtocolParams(command.params, route),
            replacementSessionId,
          );
        }
        context.native.fireAndForget(
          "Runtime.runIfWaitingForDebugger",
          {},
          replacementSessionId,
        );
        route.state = "attached";
        context.emit({
          method: "Runtime.executionContextsCleared",
          params: {},
          sessionId: route.clientSessionId,
        });
        flushDeferredEvents(context.delivery);
      } catch {
        deliverDetachedRoute(context.delivery, route);
      }
    },
    {
      // Forwarding has to be open again before the held messages go out, and
      // they have to wait until this rebind no longer counts as work in flight
      // — a flush from inside the operation would be re-deferred by the very
      // queue it is trying to drain.
      beforeEnd: () => {
        route.nativeSessionDetached = false;
      },
      afterEnd: () => context.flushHeldMessages(route),
    },
  );
  return true;
}

function prepareFrameTreeResponse(
  context: InboundContext,
  pending: any,
  message: any,
) {
  const sessionId = pending.clientSessionId;
  if (
    pending.method !== "Page.getFrameTree" ||
    typeof sessionId !== "string" ||
    !context.barriers.has(sessionId) ||
    message.error ||
    !message.result?.frameTree?.frame
  ) {
    return [];
  }
  const frameTree = message.result.frameTree;
  const restored: any[] = [];
  const mainSession = context.tables.routesByClientSession.has(sessionId);
  const visit = (tree: any, restore: boolean) => {
    const frame = tree?.frame;
    if (!frame || typeof frame.id !== "string") return;
    const known = context.frames.has(frame.id);
    context.frames.remember(frame.id, sessionId);
    if (restore && !known) {
      restored.push({
        method: "Page.frameAttached",
        sessionId,
        params: {
          frameId: frame.id,
          parentFrameId: frame.parentId,
        },
      });
      restored.push({
        method: "Page.frameNavigated",
        sessionId,
        params: { frame },
      });
    }
    for (const child of tree.childFrames || []) {
      if (child?.frame && !child.frame.parentId) {
        child.frame = { ...child.frame, parentId: frame.id };
      }
      visit(child, !mainSession);
    }
  };
  visit(frameTree, false);
  return restored;
}

function discardAttachmentWhileClosing(context: InboundContext, message: any) {
  if (!context.isClosing() || message.method !== "Target.attachedToTarget") {
    return false;
  }
  const outerSessionId = message.sessionId;
  const targetId = message.params?.targetInfo?.targetId;
  const owned =
    typeof outerSessionId === "string"
      ? context.tables.routesByNativeSession.has(outerSessionId) ||
        context.tables.targetsBySession.has(outerSessionId) ||
        context.tables.passthroughClientSessionsByNative.has(outerSessionId)
      : typeof targetId === "string" &&
        (context.tables.targetIds?.has(targetId) ||
          context.tables.routesByNativeTarget.has(targetId));
  if (!owned) return false;
  const sessionId = message.params?.sessionId;
  if (typeof sessionId !== "string") return true;
  context.tables.internallyDetachedSessions.add(sessionId);
  context.native.fireAndForget(
    "Runtime.runIfWaitingForDebugger",
    {},
    sessionId,
  );
  context.native.fireAndForget(
    "Target.detachFromTarget",
    { sessionId },
    typeof message.sessionId === "string" ? message.sessionId : undefined,
  );
  return true;
}

function filterResponse(
  context: InboundContext,
  method: unknown,
  message: any,
) {
  if (
    method !== "Target.getTargets" ||
    !context.tables.targetIds ||
    !Array.isArray(message.result?.targetInfos)
  ) {
    return;
  }
  message.result.targetInfos = message.result.targetInfos.filter(
    (targetInfo: any) => context.tables.targetIds!.has(targetInfo?.targetId),
  );
}
