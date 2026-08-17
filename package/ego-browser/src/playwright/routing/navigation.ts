import {
  emitNavigationResponse,
  waitForNavigationCommit,
} from "./navigation-commit.js";
import {
  rewriteIncomingProtocolMessage,
  rewriteOutgoingProtocolParams,
} from "./protocol.js";
import type { NativeCommandChannel } from "./native-commands.js";
import type { PendingWork } from "./pending-work.js";
import type { SessionTables } from "./session-tables.js";
import {
  routeClosed,
  type EgoCdpRuntime,
  type NavigationTransition,
  type PageRoute,
  type PassthroughSession,
} from "./types.js";

/**
 * Everything a navigation needs from the transport around it. Navigation is the
 * one flow that touches nearly every table, so the coupling is stated here
 * rather than left implicit in a shared class body.
 */
export type NavigationContext = {
  readonly runtime: EgoCdpRuntime;
  readonly tables: SessionTables;
  readonly native: NativeCommandChannel;
  readonly work: PendingWork;
  readonly navigationCommitTimeoutMs: number;
  // The transport's live deferral queue. A replacement swap reads it to see
  // which events native already sent for the committed document, and drops the
  // ones the transition bridge announced to the client itself.
  readonly deferredEvents: any[];
  isClosed: () => boolean;
  emit: (message: any) => void;
  endOperation: () => void;
  flushDeferredEvents: () => void;
  flushHeldMessages: (route: PageRoute) => void;
  attachNativeTarget: (targetId: string) => Promise<{ sessionId: string }>;
  replaceNativeRoute: (
    route: PageRoute,
    nativeTargetId: string,
    nativeSessionId: string,
    nativeMainFrameId?: string,
  ) => void;
  adoptReplacementSessionAfterFailure: (
    route: PageRoute,
    nativeTargetId: string,
    replacementSessionId: string,
  ) => void;
  completePassiveNavigation: (
    route: PageRoute,
    frame: any,
    key: string,
  ) => void;
};

// A blank route navigates natively in place: its session already has the
// client's enables armed, so the document request is interceptable and every
// real event flows through the normal delivery path.
export function runInPlaceNavigation(
  context: NavigationContext,
  message: any,
  route: PageRoute,
) {
  const url = message.params?.url;
  if (typeof url !== "string") {
    context.emit({
      id: message.id,
      error: { code: -32_000, message: "Page.navigate requires a url" },
      sessionId: route.clientSessionId,
    });
    return;
  }
  void context.native
    .command(
      "Page.navigate",
      rewriteOutgoingProtocolParams(message.params || {}, route),
      route.nativeSessionId,
      context.navigationCommitTimeoutMs,
    )
    .then((result) => {
      if (typeof result?.errorText === "string" && result.errorText !== "") {
        throw new Error(result.errorText);
      }
      if (result?.isDownload === true) {
        // A download never commits a document; failing here mirrors
        // Playwright's own abort for download navigations.
        throw new Error("net::ERR_ABORTED; maybe frame was detached?");
      }
      const rewritten = { ...(result || {}) };
      rewriteIncomingProtocolMessage({ params: rewritten }, route);
      context.emit({
        id: message.id,
        result: rewritten,
        sessionId: route.clientSessionId,
      });
    })
    .catch((error) => {
      const description = (error as Error)?.message || String(error);
      context.emit({
        id: message.id,
        error: {
          code: -32_000,
          message: description.includes("timed out")
            ? `navigation did not commit within ${context.navigationCommitTimeoutMs}ms (requested ${JSON.stringify(url)})`
            : description,
        },
        sessionId: route.clientSessionId,
      });
    });
}

export async function runNavigationReplacement(
  context: NavigationContext,
  message: any,
  route: PageRoute,
  epoch: number,
) {
  const clientFrameId = message.params?.frameId;
  const url = message.params?.url;
  if (typeof clientFrameId !== "string" || typeof url !== "string") {
    context.emit({
      id: message.id,
      error: {
        code: -32_000,
        message: "Page.navigate requires frameId and url",
      },
      sessionId: route.clientSessionId,
    });
    return;
  }
  if (context.isClosed() || route.state === "closed") {
    context.emit({
      id: message.id,
      error: {
        code: -32_000,
        message: "Cannot navigate: the page has been closed",
      },
      sessionId: route.clientSessionId,
    });
    return;
  }
  if (epoch !== route.navigationEpoch) {
    // A newer navigation arrived while this one was still queued; it never
    // started, so there is nothing to clean up — just answer the caller.
    context.emit({
      id: message.id,
      error: {
        code: -32_000,
        message: "navigation was superseded by a newer navigation",
      },
      sessionId: route.clientSessionId,
    });
    return;
  }

  route.state = "navigating";
  context.work.beginOperation();
  const previousNativeTargetId = route.nativeTargetId;
  const previousNativeSessionId = route.nativeSessionId;
  context.tables.retiredNativeSessions.add(previousNativeSessionId);
  let replacementTargetId: string | undefined;
  let replacementSessionId: string | undefined;
  const replacementPassthroughSessions: Array<{
    clientSessionId: string;
    session: PassthroughSession;
    previousNativeSessionId: string;
    replacementNativeSessionId: string;
  }> = [];
  // CDP has no cancel message, so an abort can only reject our own awaits:
  // the long waits below race against this promise, and the in-flight
  // native command is left to settle on its own (already marked handled).
  let abortReason: string | undefined;
  let rejectAbort!: (error: Error) => void;
  const abortPromise = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  void abortPromise.catch(() => undefined);
  const abort = (reason: string) => {
    if (abortReason !== undefined) return;
    abortReason = reason;
    rejectAbort(new Error(reason));
  };
  route.abortNavigation = abort;
  const raceAbort = <T>(work: Promise<T>): Promise<T> => {
    void work.catch(() => undefined);
    return Promise.race([work, abortPromise]);
  };

  await (async () => {
    // The replacement tab is created blank on purpose: the enable commands
    // replayed below must exist on the session before the document request
    // starts, otherwise the request is structurally un-interceptable (a
    // navigation begun by createTab(url) is already in flight by the time
    // Fetch.enable reaches the new session).
    const created: any = await context.runtime.createTab!("about:blank");
    const newTargetId = created?.targetId || created?.result?.targetId;
    if (created?.error || typeof newTargetId !== "string") {
      throw new Error(
        created?.error || "ego.createTab did not return a replacement targetId",
      );
    }
    replacementTargetId = newTargetId;

    route.state = "rebinding";
    if (newTargetId === previousNativeTargetId) {
      // The reused tab's old session is detached before the replacement
      // attach; from here until the transition settles no command can be
      // forwarded to it, so send() must hold everything.
      route.nativeSessionDetached = true;
      context.tables.internallyDetachedSessions.add(route.nativeSessionId);
      await context.native
        .command("Target.detachFromTarget", {
          sessionId: route.nativeSessionId,
        })
        .catch(() => undefined);
    }
    const { sessionId: newSessionId } =
      await context.attachNativeTarget(newTargetId);
    replacementSessionId = newSessionId;
    route.transition = {
      nativeSessionId: newSessionId,
      nativeTargetId: newTargetId,
      clientFrameId,
      announcedRequests: new Set(),
    };
    for (const [clientSessionId, session] of context.tables
      .passthroughSessions) {
      if (session.nativeTargetId !== previousNativeTargetId) continue;
      // A reused tab detaches only the route's own session above, so this
      // one is still attached and still usable: its session-level state
      // lives on the session, not the document. Attaching a replacement
      // would strand the original, which nothing else ever detaches.
      if (newTargetId === previousNativeTargetId) continue;
      const previousNativeSessionId = session.nativeSessionId;
      const { sessionId: replacementNativeSessionId } =
        await context.attachNativeTarget(newTargetId);
      for (const command of session.replayCommands.values()) {
        if (
          command.method === "Runtime.runIfWaitingForDebugger" ||
          Object.hasOwn(command.params, "frameId")
        ) {
          continue;
        }
        await context.native.command(
          command.method,
          command.params,
          replacementNativeSessionId,
        );
      }
      replacementPassthroughSessions.push({
        clientSessionId,
        session,
        previousNativeSessionId,
        replacementNativeSessionId,
      });
    }
    for (const command of route.replayCommands.values()) {
      if (
        command.method === "Runtime.runIfWaitingForDebugger" ||
        Object.hasOwn(command.params, "frameId")
      ) {
        continue;
      }
      context.native.fireAndForget(
        command.method,
        command.params,
        newSessionId,
      );
    }
    context.native.fireAndForget(
      "Runtime.runIfWaitingForDebugger",
      {},
      newSessionId,
    );
    // An abort during the setup awaits above means the navigation is
    // already doomed; do not dispatch it natively at all.
    if (abortReason !== undefined) throw new Error(abortReason);
    // Only now start the real navigation, natively on the armed session.
    // Page.navigate responds when the navigation commits (or fails), which
    // can hinge on the client: a replayed Fetch.enable pauses the document
    // request, and the transition bridge above keeps interception traffic
    // flowing so the client can resume it while this await is pending.
    let navigateResult: any;
    try {
      navigateResult = await raceAbort(
        context.native.command(
          "Page.navigate",
          { url },
          newSessionId,
          context.navigationCommitTimeoutMs,
        ),
      );
    } catch (error) {
      const message = (error as Error)?.message || String(error);
      if (message.includes("timed out")) {
        throw new Error(
          `navigation did not commit within ${context.navigationCommitTimeoutMs}ms (requested ${JSON.stringify(url)})`,
        );
      }
      throw error;
    }
    if (
      typeof navigateResult?.errorText === "string" &&
      navigateResult.errorText !== ""
    ) {
      throw new Error(navigateResult.errorText);
    }
    if (navigateResult?.isDownload === true) {
      // A download never commits a document; failing here mirrors
      // Playwright's own abort for download navigations so goto rejects
      // promptly instead of burning the whole commit timeout.
      throw new Error("net::ERR_ABORTED; maybe frame was detached?");
    }
    const { frame, documentState } = await raceAbort(
      waitForNavigationCommit(
        context,
        newSessionId,
        url,
        typeof navigateResult?.loaderId === "string"
          ? navigateResult.loaderId
          : undefined,
        context.navigationCommitTimeoutMs,
        // The race already rejects the transition; this stops the poll loop
        // itself so an aborted commit wait does not keep probing natively.
        () => {
          if (abortReason !== undefined) throw new Error(abortReason);
        },
      ),
    );
    // Read through a function boundary: the "rebinding" assignment above
    // narrows route.state, but the awaited commit wait may have closed the
    // route.
    if (routeClosed(route)) {
      // The page was closed while the commit confirmation was in flight;
      // the route is already removed from the tables, so the swap below
      // must not resurrect it.
      throw new Error("the page has been closed");
    }
    const replacementFrameId =
      typeof frame.id === "string" ? frame.id : newTargetId;
    // From here on the swapped route handles the session's events itself;
    // this block runs synchronously, so there is no delivery gap.
    const transition = route.transition;
    route.transition = undefined;
    route.clientMainFrameId = clientFrameId;
    route.currentMainFrameUrl =
      typeof documentState?.url === "string"
        ? documentState.url
        : typeof frame.url === "string" && frame.url !== ""
          ? frame.url
          : url;
    context.replaceNativeRoute(
      route,
      newTargetId,
      newSessionId,
      replacementFrameId,
    );
    for (const replacement of replacementPassthroughSessions) {
      context.tables.passthroughClientSessionsByNative.delete(
        replacement.previousNativeSessionId,
      );
      context.tables.retiredNativeSessions.add(
        replacement.previousNativeSessionId,
      );
      replacement.session.nativeTargetId = newTargetId;
      replacement.session.nativeSessionId =
        replacement.replacementNativeSessionId;
      context.tables.passthroughClientSessionsByNative.set(
        replacement.replacementNativeSessionId,
        replacement.clientSessionId,
      );
    }
    // The old document's execution contexts are gone only once the
    // replacement target has committed; announcing it earlier would brick
    // the page when the navigation fails.
    context.emit({
      method: "Runtime.executionContextsCleared",
      params: {},
      sessionId: route.clientSessionId,
    });
    if (transition) {
      // The transition bridge already announced paused requests to the
      // client from their pause payloads; the real Network.requestWillBeSent
      // for those requests arrived afterwards (deferred until this swap) and
      // must not reach the client a second time. Redirect hops (they carry
      // redirectResponse) are new information and pass through.
      for (let index = context.deferredEvents.length - 1; index >= 0; index--) {
        const event = context.deferredEvents[index];
        if (
          event.sessionId === newSessionId &&
          event.method === "Network.requestWillBeSent" &&
          typeof event.params?.requestId === "string" &&
          transition.announcedRequests.has(event.params.requestId) &&
          !event.params.redirectResponse
        ) {
          context.deferredEvents.splice(index, 1);
        }
      }
    }
    // With Page enabled before the navigation starts, the real committed
    // Page.frameNavigated is usually sitting in the deferred queue; the
    // synthetic one below is only the fallback for when it is not.
    const realFrameNavigated = context.deferredEvents.some(
      (event) =>
        event.sessionId === newSessionId &&
        event.method === "Page.frameNavigated" &&
        event.params?.frame?.parentId === undefined &&
        event.params?.frame?.loaderId === frame.loaderId,
    );
    const requestFinished = emitNavigationResponse(
      context,
      route,
      url,
      frame,
      documentState,
      transition,
    );
    context.flushDeferredEvents();

    if (newTargetId !== previousNativeTargetId) {
      context.native.fireAndForget("Target.closeTarget", {
        targetId: previousNativeTargetId,
      });
    }
    context.emit({
      id: message.id,
      result: {
        frameId: clientFrameId,
        ...(typeof frame.loaderId === "string"
          ? { loaderId: frame.loaderId }
          : {}),
      },
      sessionId: route.clientSessionId,
    });
    if (!realFrameNavigated) {
      context.emit({
        method: "Page.frameNavigated",
        params: {
          frame: {
            ...frame,
            id: clientFrameId,
            name: frame.name || "",
            url,
          },
        },
        sessionId: route.clientSessionId,
      });
    }

    for (const command of route.replayCommands.values()) {
      if (!Object.hasOwn(command.params, "frameId")) continue;
      context.native.fireAndForget(
        command.method,
        rewriteOutgoingProtocolParams(command.params, route),
        newSessionId,
      );
    }

    route.state = "attached";
    const navigationKey = `${frame.id}\0${frame.loaderId || ""}\0${frame.url || ""}`;
    route.passiveNavigation = {
      key: navigationKey,
      generation: route.generation,
      nativeFrameId: frame.id,
      loaderId: typeof frame.loaderId === "string" ? frame.loaderId : undefined,
      lifecycleNames: new Set(),
      frameStopped: false,
      requestId:
        typeof frame.loaderId === "string" ? frame.loaderId : undefined,
      requestFinished,
    };
    context.completePassiveNavigation(route, frame, navigationKey);
  })()
    .catch((error) => {
      route.transition = undefined;
      for (const replacement of replacementPassthroughSessions) {
        if (
          replacement.session.nativeSessionId ===
          replacement.replacementNativeSessionId
        ) {
          continue;
        }
        context.tables.internallyDetachedSessions.add(
          replacement.replacementNativeSessionId,
        );
        context.native.fireAndForget("Target.detachFromTarget", {
          sessionId: replacement.replacementNativeSessionId,
        });
      }
      // Rolling back to the previous session is only possible when that
      // session still exists. The same-target branch above detached it before
      // attaching its replacement, so there is nothing to roll back to: the
      // route must adopt the replacement session or every later command on
      // this page answers "Session with given id not found" — one failed
      // navigation would brick the page instead of failing the navigation.
      const strandedOnDetachedSession =
        route.state !== "closed" &&
        route.nativeSessionId === previousNativeSessionId &&
        replacementTargetId === previousNativeTargetId &&
        replacementSessionId !== undefined;
      if (strandedOnDetachedSession) {
        context.adoptReplacementSessionAfterFailure(
          route,
          previousNativeTargetId,
          replacementSessionId!,
        );
      } else if (
        route.state !== "closed" &&
        route.nativeSessionId === previousNativeSessionId
      ) {
        context.tables.retiredNativeSessions.delete(previousNativeSessionId);
      }
      // The replacement tab never became the route's target; close it so a
      // failed navigation does not leak a stray tab into the TaskSpace.
      if (
        replacementTargetId !== undefined &&
        replacementTargetId !== previousNativeTargetId &&
        route.nativeTargetId !== replacementTargetId
      ) {
        context.tables.internallyClosedTargets.add(replacementTargetId);
        if (replacementSessionId !== undefined) {
          context.tables.internallyDetachedSessions.add(replacementSessionId);
          context.tables.retiredNativeSessions.add(replacementSessionId);
        }
        context.native.fireAndForget("Target.closeTarget", {
          targetId: replacementTargetId,
        });
      }
      // A closed route stays closed — restoring "attached" here would
      // resurrect a page the client already closed.
      if (route.state !== "closed") route.state = "attached";
      context.emit({
        id: message.id,
        error: { code: -32_000, message: error?.message || String(error) },
        sessionId: route.clientSessionId,
      });
    })
    .finally(() => {
      // Settled either way: on success the route now points at the usable
      // replacement session; on failure of the same-target branch the route
      // is restored to "attached", where the flag is never consulted.
      // Dropping the abort hook here keeps a stale abort from ever firing
      // after its transition settled (the next navigation installs its own
      // hook only after this settles, via the pendingTransition chain).
      if (route.abortNavigation === abort) route.abortNavigation = undefined;
      route.nativeSessionDetached = false;
      context.endOperation();
      context.flushHeldMessages(route);
    });
}
