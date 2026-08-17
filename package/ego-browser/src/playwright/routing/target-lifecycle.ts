import type { NativeCommandChannel } from "./native-commands.js";
import { type PendingWork, trackOperation } from "./pending-work.js";
import type { FrameRegistry } from "./frame-registry.js";
import type { FrameTreeBarriers } from "./frame-tree-barrier.js";
import { rewriteOutgoingProtocolParams } from "./protocol.js";
import type { SessionTables } from "./session-tables.js";
import type { EgoCdpRuntime, PageRoute } from "./types.js";

export type TargetLifecycleContext = {
  readonly runtime: EgoCdpRuntime;
  readonly tables: SessionTables;
  readonly native: NativeCommandChannel;
  readonly work: PendingWork;
  readonly barriers: FrameTreeBarriers;
  readonly frames: FrameRegistry;
  emit: (message: any) => void;
  endOperation: () => void;
  deliverEvent: (message: any) => void;
  flushDeferredEvents: () => void;
};

/**
 * A target's life from the client's point of view: attaching one into scope,
 * re-pointing a route at a replacement tab, and closing one down.
 *
 * These are the only writers of the route topology besides navigation, and each
 * pairs a table mutation with the event the client needs to see it — which is
 * why they live together rather than inline in the send path.
 */

/**
 * Brings a native target into scope as a page route and tells the client about
 * it, as if native had auto-attached it.
 */
export async function attachTaskSpaceTarget(
  context: TargetLifecycleContext,
  targetId: string,
  openerId?: string,
) {
  const { sessionId, targetInfo } = await attachNativeTarget(context, targetId);
  const route: PageRoute = {
    clientTargetId: targetId,
    nativeTargetId: targetId,
    clientSessionId: sessionId,
    nativeSessionId: sessionId,
    currentMainFrameUrl:
      typeof targetInfo.url === "string" ? targetInfo.url : "",
    generation: 0,
    navigationEpoch: 0,
    state: "attached",
    replayCommands: new Map(),
  };
  context.tables.registerRoute(route);
  context.deliverEvent({
    method: "Target.attachedToTarget",
    params: {
      sessionId,
      targetInfo: {
        ...targetInfo,
        targetId,
        type: targetInfo.type || "page",
        title: targetInfo.title || "",
        url: targetInfo.url || "",
        attached: true,
        ...(openerId ? { openerId } : {}),
        canAccessOpener: targetInfo.canAccessOpener ?? openerId !== undefined,
      },
      waitingForDebugger: false,
    },
  });
  context.flushDeferredEvents();
  return route;
}

/**
 * Attaches to a native target on the transport's own behalf. The tombstone is
 * held for the whole call so the resulting Target.attachedToTarget is
 * recognized as self-inflicted and never reaches the client.
 */
export async function attachNativeTarget(
  context: TargetLifecycleContext,
  targetId: string,
) {
  context.tables.manuallyAttachingTargets.add(targetId);
  try {
    const targetInfoResult = await context.native.command(
      "Target.getTargetInfo",
      { targetId },
    );
    const result = await context.native.command("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    const sessionId = result?.sessionId;
    if (typeof sessionId !== "string") {
      throw new Error(
        `Target.attachToTarget did not return a session for ${targetId}`,
      );
    }
    const targetInfo = targetInfoResult?.targetInfo || {};
    return { sessionId, targetInfo };
  } finally {
    context.tables.manuallyAttachingTargets.delete(targetId);
  }
}

export function removeRoute(context: TargetLifecycleContext, route: PageRoute) {
  route.state = "closed";
  // A navigation in flight for this route must not complete its swap — the
  // page is gone. Aborting rejects the transition's pending awaits; its
  // catch path then cleans up the replacement tab instead of re-registering
  // the removed route.
  route.abortNavigation?.("the page has been closed");
  context.tables.unregisterRoute(route);
  context.barriers.drop(route.clientSessionId, "the page has been closed");
  context.frames.forgetTarget(route.clientTargetId);
}

export function replaceNativeRoute(
  context: TargetLifecycleContext,
  route: PageRoute,
  nativeTargetId: string,
  nativeSessionId: string,
  nativeMainFrameId?: string,
) {
  context.tables.detachNativeSide(route);
  // The task-space target set must follow the swap: the replacement tab is
  // ours now, and the retired tab must not linger as an admission ticket.
  // Without this, popup discovery mistakes the route's own new tab for an
  // unclaimed popup.
  context.tables.targetIds?.delete(route.nativeTargetId);
  route.nativeTargetId = nativeTargetId;
  route.nativeSessionId = nativeSessionId;
  route.nativeMainFrameId = nativeMainFrameId;
  route.generation += 1;
  context.tables.targetIds?.add(nativeTargetId);
  context.tables.bindNativeSide(route);
}

// A failed navigation on a reused tab leaves the route pointing at a session
// its own replacement flow detached. The tab and its document are untouched,
// so the page is still there — only the client's CDP session for it is gone.
// Adopting the replacement is the same sequence #rebindDetachedRoute uses
// when native drops a session on us: bind, re-arm the client's enables on the
// new session, then tell the client its execution contexts are stale so it
// waits for the ones Runtime.enable is about to announce.
export function adoptReplacementSessionAfterFailure(
  context: TargetLifecycleContext,
  route: PageRoute,
  nativeTargetId: string,
  replacementSessionId: string,
) {
  replaceNativeRoute(
    context,
    route,
    nativeTargetId,
    replacementSessionId,
    route.nativeMainFrameId,
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
  context.emit({
    method: "Runtime.executionContextsCleared",
    params: {},
    sessionId: route.clientSessionId,
  });
}

/**
 * Answers the client's Target.closeTarget. Native's own close is best-effort
 * and asynchronous, so the tables are torn down and the client answered only
 * once the tab is confirmed gone (or the confirmation window expires).
 */
export function closeTaskSpaceTarget(
  context: TargetLifecycleContext,
  message: any,
) {
  const { tables } = context;
  const clientTargetId = message.params?.targetId;
  const route =
    typeof clientTargetId === "string"
      ? tables.routesByClientTarget.get(clientTargetId)
      : undefined;
  const nativeTargetId = route?.nativeTargetId || clientTargetId;
  const nativeSessionId =
    route?.nativeSessionId ||
    (typeof nativeTargetId === "string"
      ? tables.sessionsByTarget.get(nativeTargetId)
      : undefined);
  const clientSessionId = route?.clientSessionId || nativeSessionId;
  const complete = () => {
    if (route) removeRoute(context, route);
    if (typeof nativeTargetId === "string") {
      tables.sessionsByTarget.delete(nativeTargetId);
      // After a navigation replacement the native id differs from the
      // client id; drop both from the task-space set.
      tables.targetIds?.delete(nativeTargetId);
    }
    if (nativeSessionId) tables.targetsBySession.delete(nativeSessionId);
    if (typeof clientTargetId === "string") {
      tables.targetIds?.delete(clientTargetId);
    }

    context.emit({ id: message.id, result: { success: true } });
    if (typeof clientTargetId === "string" && clientSessionId) {
      context.emit({
        method: "Target.detachedFromTarget",
        params: {
          sessionId: clientSessionId,
          targetId: clientTargetId,
        },
      });
    }
  };

  if (typeof nativeTargetId === "string") {
    tables.internallyClosedTargets.add(nativeTargetId);
    if (nativeSessionId) {
      tables.internallyDetachedSessions.add(nativeSessionId);
      tables.retiredNativeSessions.add(nativeSessionId);
    }
    context.native.fireAndForget("Target.closeTarget", {
      targetId: nativeTargetId,
    });
  }
  if (
    typeof nativeTargetId !== "string" ||
    typeof context.runtime.listTabs !== "function"
  ) {
    complete();
    return;
  }

  trackOperation(
    context,
    "Target.closeTarget confirmation",
    () => waitForTargetClosed(context, nativeTargetId),
    { beforeEnd: complete },
  );
}

async function waitForTargetClosed(
  context: TargetLifecycleContext,
  targetId: string,
  timeoutMs = 1_000,
) {
  if (typeof context.runtime.listTabs !== "function") return;
  const deadline = Date.now() + timeoutMs;
  do {
    try {
      const listed = await context.runtime.listTabs();
      const tabs = listed?.tabs || listed?.targetInfos || [];
      if (!tabs.some((tab) => tab?.targetId === targetId)) return;
    } catch {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  } while (Date.now() < deadline);
}
