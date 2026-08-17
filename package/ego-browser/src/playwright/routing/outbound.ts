import type { FrameTreeBarriers } from "./frame-tree-barrier.js";
import type { NativeCommandChannel } from "./native-commands.js";
import type { PendingCommands } from "./pending-commands.js";
import { type PendingWork, trackOperation } from "./pending-work.js";
import {
  isReplayableSessionCommand,
  rewriteOutgoingProtocolParams,
  storageCookieCommand,
} from "./protocol.js";
import type { SessionTables } from "./session-tables.js";
import {
  attachTaskSpaceTarget,
  type TargetLifecycleContext,
} from "./target-lifecycle.js";
import type { EgoCdpRuntime } from "./types.js";

export type OutboundContext = {
  readonly runtime: EgoCdpRuntime;
  readonly tables: SessionTables;
  readonly native: NativeCommandChannel;
  readonly work: PendingWork;
  readonly barriers: FrameTreeBarriers;
  readonly pendingIds: PendingCommands;
  readonly targets: TargetLifecycleContext;
  allocateMessageId: () => number;
  emit: (message: any) => void;
  endOperation: () => void;
  flushDeferredEvents: () => void;
};

/**
 * The client's commands, on their way to native.
 *
 * {@link forwardToNative} is the ordinary path every command that native can
 * answer for itself takes: translate the ids, remember the command as pending,
 * send. The rest of this module holds the commands native cannot answer as
 * asked — the ones the transport has to satisfy out of its own state.
 */

/**
 * Translates a client command into native's ids and forwards it, recording what
 * the reply will need to be translated back.
 *
 * Mid-navigation this is also where a command's fate is decided: interception
 * traffic crosses early to the replacement session, session-state commands are
 * held for replay after the swap, and everything else keeps operating on the
 * old document — stock browser semantics for a pending navigation.
 */
export function forwardToNative(context: OutboundContext, message: any) {
  const clientSessionId =
    typeof message.sessionId === "string" ? message.sessionId : undefined;
  const route = clientSessionId
    ? context.tables.routesByClientSession.get(clientSessionId)
    : undefined;
  const passthrough = clientSessionId
    ? context.tables.passthroughSessions.get(clientSessionId)
    : undefined;
  let transitionSessionId: string | undefined;
  if (route && (route.state === "navigating" || route.state === "rebinding")) {
    if (
      route.transition &&
      typeof message.method === "string" &&
      message.method.startsWith("Fetch.")
    ) {
      // Interception responses must reach the in-flight replacement session
      // now: its paused document request is what the commit is waiting on.
      transitionSessionId = route.transition.nativeSessionId;
    } else if (
      isReplayableSessionCommand(message.method) ||
      route.nativeSessionDetached
    ) {
      // Replayable commands mutate session domain state, and the replacement
      // session took its replay snapshot when the transition started — a
      // mid-transition command must be held and re-processed after the swap
      // or the new session would silently miss it. Everything is held once
      // the old native session is detached: forwarding would only fail with
      // "Session not found".
      (route.heldMessages ??= []).push(message);
      return;
    }
    // Everything else keeps operating on the old document through the still
    // attached native session, matching stock browser semantics during a
    // pending navigation. If the navigation later commits and destroys the
    // context, in-flight commands fail with context-destroyed-style errors
    // exactly as stock Playwright surfaces them.
  }
  const attachTargetId =
    message.method === "Target.attachToTarget" &&
    typeof message.params?.targetId === "string"
      ? message.params.targetId
      : undefined;
  const attachRoute = attachTargetId
    ? context.tables.routesByClientTarget.get(attachTargetId) ||
      context.tables.routesByNativeTarget.get(attachTargetId)
    : undefined;
  const attachedTarget = attachRoute
    ? {
        clientTargetId: attachRoute.clientTargetId,
        nativeTargetId: attachRoute.nativeTargetId,
      }
    : undefined;
  const detachedSessionId =
    message.method === "Target.detachFromTarget" &&
    typeof message.params?.sessionId === "string" &&
    context.tables.passthroughSessions.has(message.params.sessionId)
      ? message.params.sessionId
      : undefined;
  const detachedPassthrough = detachedSessionId
    ? context.tables.passthroughSessions.get(detachedSessionId)
    : undefined;
  if (route && isReplayableSessionCommand(message.method)) {
    const params = message.params || {};
    const replayKey = `${message.method}:${JSON.stringify(params)}`;
    // Delete before set so a repeated command moves to the end of the replay
    // order; toggle sequences (enable → disable → enable) then replay to the
    // client's final state instead of the first-seen order.
    route.replayCommands.delete(replayKey);
    route.replayCommands.set(replayKey, { method: message.method, params });
  }
  if (passthrough && isReplayableSessionCommand(message.method)) {
    const params = message.params || {};
    const replayKey = `${message.method}:${JSON.stringify(params)}`;
    passthrough.replayCommands.delete(replayKey);
    passthrough.replayCommands.set(replayKey, {
      method: message.method,
      params,
    });
  }
  const nativeId = context.allocateMessageId();
  context.pendingIds.set(nativeId, {
    clientId: message.id,
    method: message.method,
    clientSessionId,
    nativeSessionId:
      transitionSessionId ??
      route?.nativeSessionId ??
      passthrough?.nativeSessionId ??
      detachedPassthrough?.nativeSessionId,
    attachedTarget,
    detachedSessionId,
  });
  context.work.update();
  try {
    const nativeMessage: any = route
      ? {
          ...message,
          id: nativeId,
          sessionId: transitionSessionId ?? route.nativeSessionId,
          params: rewriteOutgoingProtocolParams(message.params || {}, route),
        }
      : passthrough
        ? { ...message, id: nativeId, sessionId: passthrough.nativeSessionId }
        : { ...message, id: nativeId };
    if (attachedTarget) {
      nativeMessage.params = {
        ...(nativeMessage.params || {}),
        targetId: attachedTarget.nativeTargetId,
      };
    }
    if (detachedSessionId && detachedPassthrough) {
      nativeMessage.params = {
        ...(nativeMessage.params || {}),
        sessionId: detachedPassthrough.nativeSessionId,
      };
    }
    const result = context.runtime.sendCDPMessage(
      JSON.stringify(nativeMessage),
    );
    void Promise.resolve(result).catch((error) => {
      if (!context.pendingIds.delete(nativeId)) return;
      context.barriers.failFor(
        message.method,
        clientSessionId,
        (error as Error)?.message || String(error),
      );
      context.work.update();
      context.emit({
        id: message.id,
        error: {
          code: -32_000,
          message: (error as Error)?.message || String(error),
        },
        ...(clientSessionId ? { sessionId: clientSessionId } : {}),
      });
    });
  } catch (error) {
    context.pendingIds.delete(nativeId);
    context.barriers.failFor(
      message.method,
      clientSessionId,
      (error as Error)?.message || String(error),
    );
    context.work.update();
    throw error;
  }
}

/**
 * Answers Target.createTarget by asking the app for a real tab, then attaching
 * it, so the client gets a target id it can immediately attach to.
 */
export function createClientTarget(context: OutboundContext, message: any) {
  const url =
    typeof message.params?.url === "string"
      ? message.params.url
      : "about:blank";
  trackOperation(context, "Target.createTarget", () =>
    Promise.resolve()
      .then(() => context.runtime.createTab!(url))
      .then(async (created: any) => {
        const targetId = created?.targetId || created?.result?.targetId;
        if (created?.error || typeof targetId !== "string") {
          throw new Error(
            created?.error || "ego.createTab did not return a targetId",
          );
        }
        context.tables.targetIds?.add(targetId);
        context.flushDeferredEvents();
        if (
          context.tables.targetIds &&
          !context.tables.sessionsByTarget.has(targetId)
        ) {
          await attachTaskSpaceTarget(context.targets, targetId);
        }
        context.emit({ id: message.id, result: { targetId } });
      })
      .catch((error) => {
        context.emit({
          id: message.id,
          error: {
            code: -32_000,
            message: error?.message || String(error),
          },
        });
      }),
  );
}

/**
 * Answers the client's root Target.setAutoAttach itself.
 *
 * Native's auto-attach is browser-wide, which would hand a scoped transport
 * every target in the browser. Auto-attach is turned off natively and the
 * TaskSpace's own targets are attached one by one instead — the client sees
 * exactly its scope, announced as if native had auto-attached it.
 */
export function replaceRootAutoAttach(context: OutboundContext, message: any) {
  trackOperation(context, "Target.setAutoAttach replacement", () =>
    (async () => {
      await context.native.command("Target.setAutoAttach", {
        autoAttach: false,
        waitForDebuggerOnStart: false,
        flatten: true,
      });
      if (message.params?.autoAttach) {
        for (const targetId of context.tables.targetIds || []) {
          if (!context.tables.sessionsByTarget.has(targetId)) {
            await attachTaskSpaceTarget(context.targets, targetId);
          }
        }
      }
      context.emit({ id: message.id, result: {} });
    })().catch((error) => {
      context.emit({
        id: message.id,
        error: { code: -32_000, message: error?.message || String(error) },
      });
    }),
  );
}

/**
 * Answers a browser-scoped cookie command through a page's session, since
 * native exposes the cookie jar per session rather than browser-wide.
 */
export function routeStorageCookieCommand(
  context: OutboundContext,
  message: any,
) {
  // Cookies are browser-global; prefer a route whose native session is
  // usable right now over one that is mid-navigation or mid-rebind.
  const routes = [...context.tables.routesByClientSession.values()];
  const route =
    routes.find((candidate) => candidate.state === "attached") ??
    routes.find((candidate) => candidate.state !== "closed");
  if (!route) {
    context.emit({
      id: message.id,
      error: {
        code: -32_000,
        message: `${message.method} requires an attached TaskSpace page`,
      },
    });
    return;
  }
  const nativeMethod = storageCookieCommand(message.method)!;
  const params =
    message.method === "Storage.setCookies"
      ? { cookies: message.params?.cookies || [] }
      : {};
  void context.native
    .command(nativeMethod, params, route.nativeSessionId)
    .then((result) => context.emit({ id: message.id, result }))
    .catch((error) => {
      context.emit({
        id: message.id,
        error: { code: -32_000, message: error?.message || String(error) },
      });
    });
}
