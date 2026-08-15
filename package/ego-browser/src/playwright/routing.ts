import {
  allocateCdpMessageId,
  subscribeEgoCdpTransport,
} from "../browser-runtime.js";
import { resolveEgoError } from "../ego-errors.js";
import { highlightAgentMouse } from "./mouse-highlight.js";

export type EgoCdpRuntime = {
  sendCDPMessage: (payload: string) => unknown;
  animationHighlightMouseToPosition?: (x: number, y: number) => unknown;
  createTab?: (url?: string) => Promise<unknown> | unknown;
  listTabs?: () => Promise<{
    tabs?: Array<{ targetId?: string; active?: boolean; url?: string }>;
    targetInfos?: Array<{ targetId?: string; active?: boolean; url?: string }>;
  }>;
  onCDPMessage?: (payload: string) => void;
  onSendCDPMessageError?: (message: unknown, errorCode?: string) => void;
};

export type TransportOptions = {
  allocateMessageId?: () => number;
  navigationCommitTimeoutMs?: number;
  onPendingWorkChange?: (count: number) => void;
  targetIds?: Iterable<string>;
};

type ReplayCommand = {
  method: string;
  params: Record<string, unknown>;
};

type PassthroughSession = {
  clientTargetId: string;
  nativeTargetId: string;
};

type FrameTreeBarrier = {
  heldAutoAttach: any[];
};

// On reconnect, Chromium keeps existing OOPIF targets but Page.getFrameTree
// omits them. Let Playwright consume the local frame tree before native
// auto-attach enumerates those targets, then restore any missing frame node
// immediately before forwarding its Target.attachedToTarget event.

// While a navigation replacement waits for its commit, interception traffic
// must keep flowing: a replayed Fetch.enable pauses the replacement's document
// request, and only the client can continue it. The bridge exposes the
// replacement session's Fetch events to the client (and routes the client's
// Fetch commands back) before the route itself is swapped. Network events are
// NOT bridged: they stay deferred until commit like every other event, so the
// commit-time synthesis keeps seeing them in arrival order.
type NavigationTransition = {
  nativeSessionId: string;
  nativeTargetId: string;
  clientFrameId: string;
  // networkIds whose Network.requestWillBeSent the bridge has synthesized:
  // while interception holds the document request paused, Chromium withholds
  // the request's real Network.requestWillBeSent, so the bridge announces it
  // from the pause payload. The real event arrives once the pause resolves
  // (deferred until the swap) and is dropped there, and the commit-time
  // navigation-response synthesis consults this set so the request is never
  // announced twice.
  announcedRequests: Set<string>;
};

type PageRoute = {
  clientTargetId: string;
  nativeTargetId: string;
  clientSessionId: string;
  nativeSessionId: string;
  clientMainFrameId?: string;
  nativeMainFrameId?: string;
  // The route's current committed main-frame URL: seeded from the attach-time
  // targetInfo, updated on every observed main-frame Page.frameNavigated, and
  // set to the committed URL when a navigation replacement swaps the route.
  // While it is blank ("", about:blank, chrome://newtab) a client navigation
  // runs natively in place instead of through the tab-replacement flow.
  currentMainFrameUrl?: string;
  generation: number;
  state: "attached" | "navigating" | "rebinding" | "closed";
  replayCommands: Map<string, ReplayCommand>;
  heldMessages?: any[];
  // Set while the route's current native session cannot receive commands: it
  // was internally detached (same-target navigation replacement) or its native
  // detach started a rebind. Forwarding would only fail with "Session not
  // found", so send() holds everything until the transition settles.
  nativeSessionDetached?: boolean;
  // A newer client Page.navigate supersedes an older one (stock browser
  // semantics). Each client navigation bumps the epoch; a queued navigation
  // that starts with a stale epoch answers "superseded" without doing any
  // native work, and abortNavigation cancels the one already in flight.
  navigationEpoch: number;
  abortNavigation?: (reason: string) => void;
  pendingTransition?: Promise<void>;
  transition?: NavigationTransition;
  passiveNavigation?: {
    key: string;
    generation: number;
    nativeFrameId: string;
    loaderId?: string;
    lifecycleNames: Set<string>;
    frameStopped: boolean;
    requestId?: string;
    requestFinished: boolean;
  };
};

// A function boundary defeats control-flow narrowing: callers that assigned a
// specific state earlier in the flow can still observe a concurrent close.
function routeClosed(route: PageRoute): boolean {
  return route.state === "closed";
}

// What the agent reads when a native send fails: every Playwright page operation
// funnels through this transport, so this is the wording for the whole
// task.page.* surface. Resolve it through ego-errors rather than pasting the
// native text in — for EGO_TASK_SPACE_USER_IN_CONTROL that text is a
// user_action_reason key (or, on this channel, a bare static sentence), neither of
// which tells the agent what to do. The stable code stays in front of the message
// for diagnosis; it is the only place a code can ride along, since this failure
// leaves as a CDP error object with no room for error_code.
function nativeSendErrorText(message: unknown, errorCode?: string): string {
  if (typeof message !== "string" && !errorCode)
    return "native CDP send failed";
  const resolved = resolveEgoError({
    ...(typeof message === "string" ? { error: message } : {}),
    ...(errorCode ? { error_code: errorCode } : {}),
  });
  return resolved.code && resolved.code !== resolved.message
    ? `${resolved.code}: ${resolved.message}`
    : resolved.message;
}

export class EgoCdpTransport {
  onmessage?: (message: any) => void;
  onclose?: (reason?: string) => void;
  closed = false;

  readonly #runtime: EgoCdpRuntime;
  readonly #allocateMessageId: () => number;
  readonly #navigationCommitTimeoutMs: number;
  readonly #onPendingWorkChange: (count: number) => void;
  readonly #pendingIds = new Map<
    number,
    {
      clientId: unknown;
      method: unknown;
      clientSessionId?: string;
      nativeSessionId?: string;
      attachedTarget?: PassthroughSession;
      detachedSessionId?: string;
    }
  >();
  readonly #internalRequests = new Map<
    number,
    {
      resolve: (result: any) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  readonly #targetIds?: Set<string>;
  readonly #sessionsByTarget = new Map<string, string>();
  readonly #targetsBySession = new Map<string, string>();
  readonly #routesByClientSession = new Map<string, PageRoute>();
  readonly #routesByNativeSession = new Map<string, PageRoute>();
  readonly #routesByClientTarget = new Map<string, PageRoute>();
  readonly #routesByNativeTarget = new Map<string, PageRoute>();
  readonly #passthroughSessions = new Map<string, PassthroughSession>();
  readonly #deferredEvents: any[] = [];
  readonly #manuallyAttachingTargets = new Set<string>();
  readonly #internallyDetachedSessions = new Set<string>();
  readonly #internallyClosedTargets = new Set<string>();
  readonly #retiredNativeSessions = new Set<string>();
  readonly #frameTreeBarriers = new Map<string, FrameTreeBarrier>();
  readonly #knownFrameIds = new Set<string>();
  readonly #nativeParentSessions = new Map<string, string>();
  readonly #unsubscribe: () => void;
  #closePromise?: Promise<void>;
  #closing = false;
  #connecting = true;
  #discoveringOpenedTargets = false;
  readonly #popupDiscoveryQueue: Array<{
    openerTargetId?: string;
    expectedUrl?: string;
  }> = [];
  #popupDiscoveryDeadline = 0;
  #activeOperations = 0;
  #lastPendingWork = 0;

  constructor(runtime: EgoCdpRuntime, options: TransportOptions = {}) {
    this.#runtime = runtime;
    this.#allocateMessageId = options.allocateMessageId || allocateCdpMessageId;
    this.#navigationCommitTimeoutMs =
      options.navigationCommitTimeoutMs ?? 30_000;
    if (
      !Number.isFinite(this.#navigationCommitTimeoutMs) ||
      this.#navigationCommitTimeoutMs <= 0
    ) {
      throw new TypeError("navigationCommitTimeoutMs must be positive");
    }
    this.#onPendingWorkChange =
      options.onPendingWorkChange || createNodeKeepAlive();
    if (options.targetIds) this.#targetIds = new Set(options.targetIds);
    this.#unsubscribe = subscribeEgoCdpTransport(runtime, {
      message: (payload) => this.#dispatch(payload),
      error: (message, errorCode) =>
        this.#handleNativeSendError(message, errorCode),
    });
    this.#updatePendingWork();
  }

  send(message: any) {
    if (this.closed) throw new Error("Ego CDP transport is closed");
    highlightAgentMouse(this.#runtime, message);
    const compatibilityResult = playwrightCompatibilityResult(message.method);
    if (compatibilityResult !== undefined) {
      this.#emit({
        id: message.id,
        result: compatibilityResult,
        ...(typeof message.sessionId === "string"
          ? { sessionId: message.sessionId }
          : {}),
      });
      return;
    }
    if (
      message.sessionId === undefined &&
      storageCookieCommand(message.method)
    ) {
      this.#routeStorageCookieCommand(message);
      return;
    }
    if (
      message.method === "Target.setAutoAttach" &&
      message.sessionId === undefined &&
      this.#targetIds
    ) {
      this.#replaceRootAutoAttach(message);
      return;
    }
    if (this.#holdAutoAttachUntilFrameTree(message)) return;
    if (
      message.method === "Target.createTarget" &&
      typeof this.#runtime.createTab === "function"
    ) {
      const url =
        typeof message.params?.url === "string"
          ? message.params.url
          : "about:blank";
      this.#activeOperations += 1;
      this.#updatePendingWork();
      void Promise.resolve()
        .then(() => this.#runtime.createTab!(url))
        .then(async (created: any) => {
          const targetId = created?.targetId || created?.result?.targetId;
          if (created?.error || typeof targetId !== "string") {
            throw new Error(
              created?.error || "ego.createTab did not return a targetId",
            );
          }
          this.#targetIds?.add(targetId);
          this.#flushDeferredEvents();
          if (this.#targetIds && !this.#sessionsByTarget.has(targetId)) {
            await this.#attachTaskSpaceTarget(targetId);
          }
          this.#emit({ id: message.id, result: { targetId } });
        })
        .catch((error) => {
          this.#emit({
            id: message.id,
            error: {
              code: -32_000,
              message: error?.message || String(error),
            },
          });
        })
        .finally(() => this.#endOperation());
      return;
    }
    if (message.method === "Target.closeTarget") {
      this.#closeTaskSpaceTarget(message);
      return;
    }
    if (
      message.method === "Page.navigate" &&
      typeof message.sessionId === "string" &&
      typeof this.#runtime.createTab === "function"
    ) {
      const route = this.#routesByClientSession.get(message.sessionId);
      // Only main-frame navigations need the TaskSpace tab-replacement flow;
      // subframe navigations commit natively on the existing target.
      const navigateFrameId = message.params?.frameId;
      const mainFrameId = route
        ? (route.clientMainFrameId ?? route.clientTargetId)
        : undefined;
      if (
        route &&
        (typeof navigateFrameId !== "string" || navigateFrameId === mainFrameId)
      ) {
        // A blank page needs no replacement tab: the route's session already
        // has the client's enables armed, so a native Page.navigate on it is
        // fully interceptable and all real events flow through the normal
        // delivery path. Skipping createTab here also avoids the app-level
        // race where a createTab issued while another fresh tab's
        // initialization is still in flight returns a tab whose CDP
        // passthrough never answers. The route stays "attached" throughout —
        // no holds, no synthetic events — and a newer client navigation is
        // superseded natively by Chromium, so the epoch is not bumped and no
        // in-flight replacement is aborted for this path.
        if (
          route.state === "attached" &&
          isBlankPageUrl(route.currentMainFrameUrl)
        ) {
          this.#runInPlaceNavigation(message, route);
          return;
        }
        // A newer navigation supersedes the pending one (stock browser
        // semantics): abort the in-flight transition so this one starts as
        // soon as its cleanup finishes. The chaining stays — it is the
        // ordering guarantee that lets cleanup complete first.
        route.navigationEpoch += 1;
        const epoch = route.navigationEpoch;
        route.abortNavigation?.(
          "navigation was superseded by a newer navigation",
        );
        const run = () => this.#runNavigationReplacement(message, route, epoch);
        const previous = route.pendingTransition ?? Promise.resolve();
        route.pendingTransition = previous.then(run, run);
        return;
      }
    }
    const clientSessionId =
      typeof message.sessionId === "string" ? message.sessionId : undefined;
    const route = clientSessionId
      ? this.#routesByClientSession.get(clientSessionId)
      : undefined;
    let transitionSessionId: string | undefined;
    if (
      route &&
      (route.state === "navigating" || route.state === "rebinding")
    ) {
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
      ? this.#routesByClientTarget.get(attachTargetId) ||
        this.#routesByNativeTarget.get(attachTargetId)
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
      this.#passthroughSessions.has(message.params.sessionId)
        ? message.params.sessionId
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
    const nativeId = this.#allocateMessageId();
    this.#pendingIds.set(nativeId, {
      clientId: message.id,
      method: message.method,
      clientSessionId,
      nativeSessionId: transitionSessionId ?? route?.nativeSessionId,
      attachedTarget,
      detachedSessionId,
    });
    this.#updatePendingWork();
    try {
      const nativeMessage: any = route
        ? {
            ...message,
            id: nativeId,
            sessionId: transitionSessionId ?? route.nativeSessionId,
            params: rewriteOutgoingProtocolParams(message.params || {}, route),
          }
        : { ...message, id: nativeId };
      if (attachedTarget) {
        nativeMessage.params = {
          ...(nativeMessage.params || {}),
          targetId: attachedTarget.nativeTargetId,
        };
      }
      const result = this.#runtime.sendCDPMessage(
        JSON.stringify(nativeMessage),
      );
      void Promise.resolve(result).catch((error) => {
        if (!this.#pendingIds.delete(nativeId)) return;
        this.#failFrameTreeBarrier(
          message.method,
          clientSessionId,
          (error as Error)?.message || String(error),
        );
        this.#updatePendingWork();
        this.#emit({
          id: message.id,
          error: {
            code: -32_000,
            message: (error as Error)?.message || String(error),
          },
          ...(clientSessionId ? { sessionId: clientSessionId } : {}),
        });
      });
    } catch (error) {
      this.#pendingIds.delete(nativeId);
      this.#failFrameTreeBarrier(
        message.method,
        clientSessionId,
        (error as Error)?.message || String(error),
      );
      this.#updatePendingWork();
      throw error;
    }
  }

  close(reason?: string) {
    if (this.closed) return;
    this.closed = true;
    this.#unsubscribe();
    for (const pending of this.#internalRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason || "Ego CDP transport closed"));
    }
    this.#internalRequests.clear();
    this.#pendingIds.clear();
    for (const route of this.#routesByClientSession.values()) {
      route.state = "closed";
      route.abortNavigation?.(reason || "Ego CDP transport closed");
    }
    this.#routesByClientSession.clear();
    this.#routesByNativeSession.clear();
    this.#routesByClientTarget.clear();
    this.#routesByNativeTarget.clear();
    this.#passthroughSessions.clear();
    this.#sessionsByTarget.clear();
    this.#targetsBySession.clear();
    this.#deferredEvents.length = 0;
    this.#manuallyAttachingTargets.clear();
    this.#internallyDetachedSessions.clear();
    this.#internallyClosedTargets.clear();
    this.#retiredNativeSessions.clear();
    this.#frameTreeBarriers.clear();
    this.#knownFrameIds.clear();
    this.#nativeParentSessions.clear();
    this.#updatePendingWork();
    const onclose = this.onclose;
    this.onmessage = undefined;
    this.onclose = undefined;
    if (onclose) setImmediate(() => onclose(reason));
  }

  releaseConnectionKeepAlive() {
    if (!this.#connecting) return;
    this.#connecting = false;
    this.#updatePendingWork();
  }

  // Native send errors are task-level (the callback carries no request id and
  // once the task space is inactive every in-flight send fails alike), so all
  // in-flight requests are rejected. The transport stays open: the condition
  // is transient (e.g. the user took control) and commands succeed again after
  // the task space is handed back.
  #handleNativeSendError(message: unknown, errorCode?: string) {
    if (this.closed) return;
    const description = nativeSendErrorText(message, errorCode);
    for (const pending of this.#internalRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(description));
    }
    this.#internalRequests.clear();
    const pendingEntries = [...this.#pendingIds.values()];
    this.#pendingIds.clear();
    for (const pending of pendingEntries) {
      this.#failFrameTreeBarrier(
        pending.method,
        pending.clientSessionId,
        description,
      );
      this.#emit({
        id: pending.clientId,
        error: { code: -32_000, message: description },
        ...(pending.clientSessionId
          ? { sessionId: pending.clientSessionId }
          : {}),
      });
    }
    this.#updatePendingWork();
  }

  #endOperation() {
    this.#activeOperations -= 1;
    if (this.#activeOperations === 0) this.#deferredEvents.length = 0;
    this.#updatePendingWork();
  }

  #flushHeldMessages(route: PageRoute) {
    const held = route.heldMessages?.splice(0) ?? [];
    for (const message of held) {
      if (this.closed) return;
      try {
        this.send(message);
      } catch (error) {
        // send() rethrows a synchronous native failure without replying, and a
        // held command has no other caller to report to — answer it here or
        // the client request hangs forever.
        if (message.id !== undefined) {
          this.#emit({
            id: message.id,
            error: {
              code: -32_000,
              message: (error as Error)?.message || String(error),
            },
            ...(typeof message.sessionId === "string"
              ? { sessionId: message.sessionId }
              : {}),
          });
        }
      }
    }
  }

  closeAndWait() {
    if (!this.#closePromise) {
      this.#closing = true;
      this.#closePromise = this.#closeAndWaitOnce();
    }
    return this.#closePromise;
  }

  async #closeAndWaitOnce() {
    if (!this.closed && this.#targetIds) {
      const childFirstSessionIds = [
        ...new Set([
          ...this.#targetsBySession.keys(),
          ...this.#passthroughSessions.keys(),
        ]),
      ].reverse();
      for (const sessionId of childFirstSessionIds) {
        this.#internallyDetachedSessions.add(sessionId);
      }
      const autoAttachParams = {
        autoAttach: false,
        waitForDebuggerOnStart: false,
        flatten: true,
      };
      for (const sessionId of childFirstSessionIds) {
        await this.#sendNativeCommand(
          "Target.setAutoAttach",
          autoAttachParams,
          sessionId,
          500,
        ).catch(() => undefined);
      }
      await this.#sendNativeCommand(
        "Target.setAutoAttach",
        autoAttachParams,
        undefined,
        500,
      ).catch(() => undefined);
      for (const sessionId of childFirstSessionIds) {
        await this.#sendNativeCommand(
          "Target.detachFromTarget",
          { sessionId },
          this.#nativeParentSessions.get(sessionId),
          500,
        ).catch(() => undefined);
      }
    }
    this.close();
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  #dispatch(payload: string) {
    if (this.closed) return;
    let message;
    try {
      message = JSON.parse(payload);
    } catch {
      return;
    }
    if (Object.hasOwn(message, "id")) {
      const internal = this.#internalRequests.get(message.id);
      if (internal) {
        clearTimeout(internal.timer);
        this.#internalRequests.delete(message.id);
        this.#updatePendingWork();
        if (message.error) {
          internal.reject(new Error(message.error.message || "CDP error"));
        } else {
          internal.resolve(message.result);
        }
        return;
      }
      const pending = this.#pendingIds.get(message.id);
      if (!pending) return;
      this.#pendingIds.delete(message.id);
      this.#updatePendingWork();
      if (
        pending.detachedSessionId &&
        message.error &&
        /closed|detached/i.test(message.error.message || "")
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
        this.#passthroughSessions.set(
          attachedSessionId,
          pending.attachedTarget,
        );
      }
      if (!message.error && pending.detachedSessionId) {
        this.#passthroughSessions.delete(pending.detachedSessionId);
      }
      const restoredFrames = this.#prepareFrameTreeResponse(pending, message);
      this.#filterResponse(pending.method, message);
      this.#emit(message);
      for (const event of restoredFrames) this.#deliverEvent(event);
      this.#releaseFrameTreeBarrier(pending, message);
      return;
    }
    if (this.#discardAttachmentWhileClosing(message)) return;
    if (this.#isRetiredSessionEvent(message)) return;
    if (this.#isInternalTargetCloseEvent(message)) {
      // The tombstone has served its purpose once the close event arrives.
      this.#internallyClosedTargets.delete(message.params.targetId);
      return;
    }
    if (this.#rebindDetachedRoute(message)) return;
    if (
      message.method === "Target.detachedFromTarget" &&
      typeof message.params?.sessionId === "string"
    ) {
      // A detached session emits no further events; drop its tombstone so the
      // retired set does not grow for the lifetime of the transport.
      this.#retiredNativeSessions.delete(message.params.sessionId);
    }
    if (this.#deliverPassthroughDetach(message)) return;
    if (this.#bridgeTransitionEvent(message)) return;
    if (!this.#acceptEvent(message)) {
      if (
        this.#activeOperations > 0 &&
        !this.#isManualAttachEvent(message) &&
        !this.#isInternalDetachEvent(message) &&
        this.#deferredEvents.length < 10_000
      ) {
        this.#deferredEvents.push(message);
      } else if (this.#isInternalDetachEvent(message)) {
        this.#internallyDetachedSessions.delete(message.params.sessionId);
      }
      return;
    }
    const nativeSessionId =
      typeof message.sessionId === "string" ? message.sessionId : undefined;
    this.#observeKnownFrameEvent(message);
    const restoredFrames = this.#restoreFrameBeforeOopifAttach(message);
    this.#recordNativeParentSession(message);
    const route =
      typeof message.sessionId === "string"
        ? this.#routesByNativeSession.get(message.sessionId)
        : undefined;
    const openerTargetId =
      route?.clientTargetId ||
      (nativeSessionId
        ? this.#targetsBySession.get(nativeSessionId)
        : undefined);
    if (route) {
      this.#observeRouteEvent(message, route);
      message.sessionId = route.clientSessionId;
      rewriteIncomingProtocolMessage(message, route);
    }
    for (const event of restoredFrames) {
      if (route) {
        event.sessionId = route.clientSessionId;
        rewriteIncomingProtocolMessage(event, route);
      }
      this.#deliverEvent(event);
    }
    this.#deliverEvent(message);
    if (message.method === "Page.windowOpen") {
      this.#discoverOpenedTargets(openerTargetId, message.params?.url);
    }
  }

  // Deliver Fetch events from an in-flight replacement session to the client
  // while the navigation waits for commit. Interception cannot wait for the
  // route swap: the paused document request is what commit is waiting on.
  // Only the Fetch domain crosses early — Fetch traffic on the replacement
  // session begins with our own post-transition replay, so the stream cannot
  // straddle the deferred queue and arrive out of order.
  #bridgeTransitionEvent(message: any) {
    const sessionId = message.sessionId;
    const method = message.method;
    if (typeof sessionId !== "string" || typeof method !== "string") {
      return false;
    }
    if (!method.startsWith("Fetch.")) return false;
    let route: PageRoute | undefined;
    for (const candidate of this.#routesByClientSession.values()) {
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
      this.#emit({
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
    this.#deliverEvent(message);
    return true;
  }

  #rebindDetachedRoute(message: any) {
    if (
      message.method !== "Target.detachedFromTarget" ||
      typeof this.#runtime.listTabs !== "function"
    ) {
      return false;
    }
    const nativeSessionId = message.params?.sessionId;
    if (
      typeof nativeSessionId !== "string" ||
      this.#internallyDetachedSessions.has(nativeSessionId)
    ) {
      return false;
    }
    const route = this.#routesByNativeSession.get(nativeSessionId);
    if (!route || route.state !== "attached") return false;

    this.#rejectPendingSessionCommands(nativeSessionId, route.clientSessionId);
    route.state = "rebinding";
    // The native session is already gone (its detach started this rebind);
    // nothing can be forwarded to it until the replacement is in place.
    route.nativeSessionDetached = true;
    this.#retiredNativeSessions.add(nativeSessionId);
    this.#activeOperations += 1;
    this.#updatePendingWork();
    void (async () => {
      try {
        const listed = await this.#runtime.listTabs!();
        const tabs = listed?.tabs || listed?.targetInfos || [];
        if (!tabs.some((tab) => tab.targetId === route.nativeTargetId)) {
          this.#deliverDetachedRoute(route);
          return;
        }

        const nativeTargetId = route.nativeTargetId;
        const nativeMainFrameId = route.nativeMainFrameId;
        const { sessionId: replacementSessionId } =
          await this.#attachNativeTarget(nativeTargetId);
        this.#replaceNativeRoute(
          route,
          nativeTargetId,
          replacementSessionId,
          nativeMainFrameId,
        );
        for (const command of route.replayCommands.values()) {
          if (command.method === "Runtime.runIfWaitingForDebugger") continue;
          this.#sendNativeFireAndForget(
            command.method,
            rewriteOutgoingProtocolParams(command.params, route),
            replacementSessionId,
          );
        }
        this.#sendNativeFireAndForget(
          "Runtime.runIfWaitingForDebugger",
          {},
          replacementSessionId,
        );
        route.state = "attached";
        this.#emit({
          method: "Runtime.executionContextsCleared",
          params: {},
          sessionId: route.clientSessionId,
        });
        this.#flushDeferredEvents();
      } catch {
        this.#deliverDetachedRoute(route);
      }
    })().finally(() => {
      route.nativeSessionDetached = false;
      this.#endOperation();
      this.#flushHeldMessages(route);
    });
    return true;
  }

  #rejectPendingSessionCommands(
    nativeSessionId: string,
    clientSessionId: string,
  ) {
    let changed = false;
    for (const [nativeId, pending] of this.#pendingIds) {
      if (pending.nativeSessionId !== nativeSessionId) continue;
      this.#pendingIds.delete(nativeId);
      changed = true;
      this.#emit({
        id: pending.clientId,
        error: {
          code: -32_000,
          message: "native CDP session detached during the command",
        },
        sessionId: pending.clientSessionId || clientSessionId,
      });
    }
    if (changed) this.#updatePendingWork();
  }

  #deliverDetachedRoute(route: PageRoute) {
    const clientSessionId = route.clientSessionId;
    const clientTargetId = route.clientTargetId;
    this.#removeRoute(route);
    this.#targetIds?.delete(clientTargetId);
    // After a navigation replacement the native id differs from the client
    // id; drop both so the dead tab cannot linger in the task-space set.
    this.#targetIds?.delete(route.nativeTargetId);
    this.#deliverEvent({
      method: "Target.detachedFromTarget",
      params: {
        sessionId: clientSessionId,
        targetId: clientTargetId,
      },
    });
  }

  #deliverPassthroughDetach(message: any) {
    if (message.method !== "Target.detachedFromTarget") return false;
    const sessionId = message.params?.sessionId;
    if (typeof sessionId !== "string") return false;
    const session = this.#passthroughSessions.get(sessionId);
    if (!session) return false;
    this.#passthroughSessions.delete(sessionId);
    if (this.#internallyDetachedSessions.has(sessionId)) {
      this.#internallyDetachedSessions.delete(sessionId);
      return true;
    }
    if (
      [...this.#pendingIds.values()].some(
        (pending) => pending.detachedSessionId === sessionId,
      )
    ) {
      return true;
    }
    const params = { ...(message.params || {}) };
    if (params.targetId === session.nativeTargetId) {
      params.targetId = session.clientTargetId;
    }
    this.#emit({ ...message, params });
    return true;
  }

  #observeRouteEvent(message: any, route: PageRoute) {
    if (message.method === "Page.frameNavigated") {
      const frame = message.params?.frame;
      if (frame?.parentId === undefined && typeof frame?.id === "string") {
        if (typeof frame.url === "string") {
          route.currentMainFrameUrl = frame.url;
        }
        if (route.state !== "attached") return;
        route.nativeMainFrameId = frame.id;
        route.clientMainFrameId ||= frame.id;
        const key = `${frame.id}\0${frame.loaderId || ""}\0${frame.url || ""}`;
        if (route.passiveNavigation?.key === key) return;
        route.passiveNavigation = {
          key,
          generation: route.generation,
          nativeFrameId: frame.id,
          loaderId:
            typeof frame.loaderId === "string" ? frame.loaderId : undefined,
          lifecycleNames: new Set(),
          frameStopped: false,
          requestId:
            typeof frame.loaderId === "string" ? frame.loaderId : undefined,
          requestFinished: false,
        };
        this.#completePassiveNavigation(route, frame, key);
      }
      return;
    }

    const navigation = route.passiveNavigation;
    if (!navigation) return;
    if (message.method === "Page.lifecycleEvent") {
      const frameId = message.params?.frameId;
      const loaderId = message.params?.loaderId;
      if (
        frameId === navigation.nativeFrameId &&
        (typeof loaderId !== "string" || loaderId === navigation.loaderId) &&
        typeof message.params?.name === "string"
      ) {
        navigation.lifecycleNames.add(message.params.name);
      }
    } else if (
      message.method === "Page.frameStoppedLoading" &&
      message.params?.frameId === navigation.nativeFrameId
    ) {
      navigation.frameStopped = true;
    } else if (
      (message.method === "Network.loadingFinished" ||
        message.method === "Network.loadingFailed") &&
      message.params?.requestId === navigation.requestId
    ) {
      navigation.requestFinished = true;
    }
  }

  #completePassiveNavigation(route: PageRoute, frame: any, key: string) {
    this.#activeOperations += 1;
    this.#updatePendingWork();
    void (async () => {
      const deadline = Date.now() + 8_000;
      do {
        if (
          this.closed ||
          route.state !== "attached" ||
          route.generation !== route.passiveNavigation?.generation ||
          route.passiveNavigation.key !== key
        ) {
          return;
        }
        const readyState = await this.#sendNativeCommand(
          "Runtime.evaluate",
          {
            expression: "document.readyState",
            returnByValue: true,
          },
          route.nativeSessionId,
          1_000,
        ).catch(() => undefined);
        const readyStateValue = readyState?.result?.value;
        const navigation = route.passiveNavigation;
        if (!navigation || navigation.key !== key) return;
        const frameId = route.clientMainFrameId || frame.id;
        const lifecycle = (name: string) => {
          if (navigation.lifecycleNames.has(name)) return;
          navigation.lifecycleNames.add(name);
          this.#emit({
            method: "Page.lifecycleEvent",
            params: {
              frameId,
              loaderId: frame.loaderId || "",
              name,
              timestamp: Date.now() / 1_000,
            },
            sessionId: route.clientSessionId,
          });
        };
        if (
          readyStateValue === "interactive" ||
          readyStateValue === "complete"
        ) {
          lifecycle("DOMContentLoaded");
        }
        if (readyStateValue === "complete") {
          lifecycle("load");
          if (!navigation.frameStopped) {
            navigation.frameStopped = true;
            this.#emit({
              method: "Page.frameStoppedLoading",
              params: { frameId },
              sessionId: route.clientSessionId,
            });
          }
          if (navigation.requestId && !navigation.requestFinished) {
            navigation.requestFinished = true;
            this.#emit({
              method: "Network.loadingFinished",
              params: {
                requestId: navigation.requestId,
                timestamp: Date.now() / 1_000,
                encodedDataLength: 0,
              },
              sessionId: route.clientSessionId,
            });
          }
          return;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
      } while (Date.now() < deadline);
    })().finally(() => this.#endOperation());
  }

  #deliverEvent(message: any) {
    if (message.method === "Target.attachedToTarget") {
      const targetId = message.params?.targetInfo?.targetId;
      const sessionId = message.params?.sessionId;
      if (typeof targetId === "string" && typeof sessionId === "string") {
        const previousSession = this.#sessionsByTarget.get(targetId);
        if (previousSession) this.#targetsBySession.delete(previousSession);
        this.#sessionsByTarget.set(targetId, sessionId);
        this.#targetsBySession.set(sessionId, targetId);
      }
    } else if (message.method === "Target.detachedFromTarget") {
      const sessionId = message.params?.sessionId;
      const targetId =
        message.params?.targetId ||
        (typeof sessionId === "string"
          ? this.#targetsBySession.get(sessionId)
          : undefined);
      if (typeof targetId === "string" && !message.params?.targetId) {
        message.params = { ...(message.params || {}), targetId };
      }
      if (typeof targetId === "string") this.#sessionsByTarget.delete(targetId);
      if (typeof sessionId === "string") {
        this.#targetsBySession.delete(sessionId);
        this.#nativeParentSessions.delete(sessionId);
      }
    } else if (message.method === "Target.targetDestroyed") {
      const targetId = message.params?.targetId;
      if (typeof targetId === "string") this.#targetIds?.delete(targetId);
    }
    this.#emit(message);
  }

  #flushDeferredEvents() {
    const events = this.#deferredEvents.splice(0);
    for (const message of events) {
      if (!this.#acceptEvent(message)) {
        this.#deferredEvents.push(message);
        continue;
      }
      this.#observeKnownFrameEvent(message);
      const restoredFrames = this.#restoreFrameBeforeOopifAttach(message);
      this.#recordNativeParentSession(message);
      const route =
        typeof message.sessionId === "string"
          ? this.#routesByNativeSession.get(message.sessionId)
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
        this.#deliverEvent(event);
      }
      this.#deliverEvent(message);
    }
  }

  #acceptEvent(message: any) {
    if (!this.#targetIds) return true;
    if (message.method === "Target.attachedToTarget") {
      const targetInfo = message.params?.targetInfo;
      if (this.#manuallyAttachingTargets.has(targetInfo?.targetId)) {
        return false;
      }
      if (this.#routesByNativeTarget.has(targetInfo?.targetId)) return false;
      if (
        this.#sessionsByTarget.get(targetInfo?.targetId) ===
        message.params?.sessionId
      ) {
        return false;
      }
      if (
        targetInfo?.type === "iframe" &&
        typeof message.sessionId === "string" &&
        (this.#routesByNativeSession.has(message.sessionId) ||
          this.#targetsBySession.has(message.sessionId))
      ) {
        return true;
      }
      this.#admitTargetFromOpener(targetInfo);
      return this.#targetIds.has(targetInfo?.targetId);
    }
    if (message.method === "Target.detachedFromTarget") {
      const targetId = message.params?.targetId;
      const sessionId = message.params?.sessionId;
      if (
        typeof sessionId === "string" &&
        this.#internallyDetachedSessions.has(sessionId)
      ) {
        return false;
      }
      return (
        this.#sessionsByTarget.get(targetId) === sessionId ||
        this.#targetsBySession.has(sessionId)
      );
    }
    if (
      message.method === "Target.targetCreated" ||
      message.method === "Target.targetInfoChanged"
    ) {
      const targetInfo = message.params?.targetInfo;
      this.#admitTargetFromOpener(targetInfo);
      return (
        this.#targetIds.has(targetInfo?.targetId) ||
        this.#routesByNativeTarget.has(targetInfo?.targetId)
      );
    }
    if (message.method === "Target.targetDestroyed") {
      return (
        this.#targetIds.has(message.params?.targetId) ||
        this.#routesByNativeTarget.has(message.params?.targetId)
      );
    }
    if (typeof message.sessionId === "string") {
      return (
        this.#targetsBySession.has(message.sessionId) ||
        this.#passthroughSessions.has(message.sessionId)
      );
    }
    return true;
  }

  #isManualAttachEvent(message: any) {
    return (
      message.method === "Target.attachedToTarget" &&
      this.#manuallyAttachingTargets.has(message.params?.targetInfo?.targetId)
    );
  }

  #isInternalDetachEvent(message: any) {
    return (
      message.method === "Target.detachedFromTarget" &&
      this.#internallyDetachedSessions.has(message.params?.sessionId)
    );
  }

  #isInternalTargetCloseEvent(message: any) {
    return (
      message.method === "Target.targetDestroyed" &&
      this.#internallyClosedTargets.has(message.params?.targetId)
    );
  }

  #isRetiredSessionEvent(message: any) {
    return (
      typeof message.sessionId === "string" &&
      this.#retiredNativeSessions.has(message.sessionId)
    );
  }

  #admitTargetFromOpener(targetInfo: any) {
    const targetId = targetInfo?.targetId;
    const openerId = targetInfo?.openerId;
    if (
      typeof targetId === "string" &&
      typeof openerId === "string" &&
      this.#targetIds?.has(openerId)
    ) {
      this.#targetIds.add(targetId);
    }
  }

  #holdAutoAttachUntilFrameTree(message: any) {
    const sessionId =
      typeof message.sessionId === "string" ? message.sessionId : undefined;
    if (!sessionId) return false;
    if (
      message.method === "Page.getFrameTree" &&
      (this.#routesByClientSession.has(sessionId) ||
        this.#targetsBySession.has(sessionId))
    ) {
      if (!this.#frameTreeBarriers.has(sessionId)) {
        this.#frameTreeBarriers.set(sessionId, { heldAutoAttach: [] });
      }
      return false;
    }
    const barrier = this.#frameTreeBarriers.get(sessionId);
    if (
      message.method !== "Target.setAutoAttach" ||
      !message.params?.autoAttach ||
      !barrier
    ) {
      return false;
    }
    barrier.heldAutoAttach.push(message);
    this.#updatePendingWork();
    return true;
  }

  #prepareFrameTreeResponse(pending: any, message: any) {
    const sessionId = pending.clientSessionId;
    if (
      pending.method !== "Page.getFrameTree" ||
      typeof sessionId !== "string" ||
      !this.#frameTreeBarriers.has(sessionId) ||
      message.error ||
      !message.result?.frameTree?.frame
    ) {
      return [];
    }
    const frameTree = message.result.frameTree;
    const restored: any[] = [];
    const mainSession = this.#routesByClientSession.has(sessionId);
    const visit = (tree: any, restore: boolean) => {
      const frame = tree?.frame;
      if (!frame || typeof frame.id !== "string") return;
      const known = this.#knownFrameIds.has(frame.id);
      this.#knownFrameIds.add(frame.id);
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

  #releaseFrameTreeBarrier(pending: any, message: any) {
    const sessionId = pending.clientSessionId;
    if (
      pending.method !== "Page.getFrameTree" ||
      typeof sessionId !== "string"
    ) {
      return;
    }
    const barrier = this.#frameTreeBarriers.get(sessionId);
    if (!barrier) return;
    if (message.error) {
      this.#failFrameTreeBarrier(
        pending.method,
        sessionId,
        message.error.message || "Page.getFrameTree failed",
      );
      return;
    }
    setImmediate(() => {
      if (this.#frameTreeBarriers.get(sessionId) !== barrier) return;
      this.#frameTreeBarriers.delete(sessionId);
      const held = barrier.heldAutoAttach.splice(0);
      this.#updatePendingWork();
      if (this.closed || this.#closing) return;
      for (const heldMessage of held) this.send(heldMessage);
    });
  }

  #failFrameTreeBarrier(
    method: unknown,
    sessionId: string | undefined,
    description: string,
  ) {
    if (method !== "Page.getFrameTree" || !sessionId) return;
    const barrier = this.#frameTreeBarriers.get(sessionId);
    if (!barrier) return;
    this.#frameTreeBarriers.delete(sessionId);
    for (const held of barrier.heldAutoAttach) {
      this.#emit({
        id: held.id,
        error: { code: -32_000, message: description },
        sessionId,
      });
    }
    this.#updatePendingWork();
  }

  #observeKnownFrameEvent(message: any) {
    if (message.method === "Page.frameAttached") {
      if (typeof message.params?.frameId === "string") {
        this.#knownFrameIds.add(message.params.frameId);
      }
    } else if (message.method === "Page.frameNavigated") {
      if (typeof message.params?.frame?.id === "string") {
        this.#knownFrameIds.add(message.params.frame.id);
      }
    } else if (
      message.method === "Page.frameDetached" &&
      message.params?.reason !== "swap" &&
      typeof message.params?.frameId === "string"
    ) {
      this.#knownFrameIds.delete(message.params.frameId);
    }
  }

  #restoreFrameBeforeOopifAttach(message: any) {
    const targetInfo = message.params?.targetInfo;
    const targetId = targetInfo?.targetId;
    const parentFrameId = targetInfo?.parentFrameId;
    if (
      message.method !== "Target.attachedToTarget" ||
      targetInfo?.type !== "iframe" ||
      typeof message.sessionId !== "string" ||
      typeof targetId !== "string" ||
      typeof parentFrameId !== "string" ||
      this.#knownFrameIds.has(targetId) ||
      !this.#knownFrameIds.has(parentFrameId)
    ) {
      return [];
    }
    this.#knownFrameIds.add(targetId);
    const frame = {
      id: targetId,
      parentId: parentFrameId,
      loaderId: targetId,
      name: "",
      url: typeof targetInfo.url === "string" ? targetInfo.url : "",
    };
    return [
      {
        method: "Page.frameAttached",
        sessionId: message.sessionId,
        params: { frameId: targetId, parentFrameId },
      },
      {
        method: "Page.frameNavigated",
        sessionId: message.sessionId,
        params: { frame },
      },
    ];
  }

  #recordNativeParentSession(message: any) {
    if (
      message.method === "Target.attachedToTarget" &&
      typeof message.params?.sessionId === "string" &&
      typeof message.sessionId === "string"
    ) {
      this.#nativeParentSessions.set(
        message.params.sessionId,
        message.sessionId,
      );
    }
  }

  #discardAttachmentWhileClosing(message: any) {
    if (!this.#closing || message.method !== "Target.attachedToTarget") {
      return false;
    }
    const outerSessionId = message.sessionId;
    const targetId = message.params?.targetInfo?.targetId;
    const owned =
      typeof outerSessionId === "string"
        ? this.#routesByNativeSession.has(outerSessionId) ||
          this.#targetsBySession.has(outerSessionId) ||
          this.#passthroughSessions.has(outerSessionId)
        : typeof targetId === "string" &&
          (this.#targetIds?.has(targetId) ||
            this.#routesByNativeTarget.has(targetId));
    if (!owned) return false;
    const sessionId = message.params?.sessionId;
    if (typeof sessionId !== "string") return true;
    this.#internallyDetachedSessions.add(sessionId);
    this.#sendNativeFireAndForget(
      "Runtime.runIfWaitingForDebugger",
      {},
      sessionId,
    );
    this.#sendNativeFireAndForget(
      "Target.detachFromTarget",
      { sessionId },
      typeof message.sessionId === "string" ? message.sessionId : undefined,
    );
    return true;
  }

  #filterResponse(method: unknown, message: any) {
    if (
      method !== "Target.getTargets" ||
      !this.#targetIds ||
      !Array.isArray(message.result?.targetInfos)
    ) {
      return;
    }
    message.result.targetInfos = message.result.targetInfos.filter(
      (targetInfo: any) => this.#targetIds!.has(targetInfo?.targetId),
    );
  }

  #replaceRootAutoAttach(message: any) {
    this.#activeOperations += 1;
    this.#updatePendingWork();
    void (async () => {
      await this.#sendNativeCommand("Target.setAutoAttach", {
        autoAttach: false,
        waitForDebuggerOnStart: false,
        flatten: true,
      });
      if (message.params?.autoAttach) {
        for (const targetId of this.#targetIds || []) {
          if (!this.#sessionsByTarget.has(targetId)) {
            await this.#attachTaskSpaceTarget(targetId);
          }
        }
      }
      this.#emit({ id: message.id, result: {} });
    })()
      .catch((error) => {
        this.#emit({
          id: message.id,
          error: { code: -32_000, message: error?.message || String(error) },
        });
      })
      .finally(() => this.#endOperation());
  }

  #discoverOpenedTargets(openerTargetId?: string, expectedUrl?: string) {
    if (!this.#targetIds || typeof this.#runtime.listTabs !== "function") {
      return;
    }
    // Every windowOpen queues its own discovery entry; a single scan loop
    // serves the whole queue so concurrently opened popups are all attached.
    this.#popupDiscoveryQueue.push({ openerTargetId, expectedUrl });
    this.#popupDiscoveryDeadline = Date.now() + 2_000;
    if (this.#discoveringOpenedTargets) return;
    this.#discoveringOpenedTargets = true;
    this.#activeOperations += 1;
    this.#updatePendingWork();
    void (async () => {
      // Consecutive polls each unclaimed tab has reported the same URL, used
      // to tell committed navigations from in-flight ones (loop-local: the
      // scan loop is single-flight per transport).
      const urlStability = new Map<string, { url: unknown; polls: number }>();
      do {
        const listed = await this.#runtime.listTabs!();
        const tabs = listed?.tabs || listed?.targetInfos || [];
        const deadlineImminent =
          this.#popupDiscoveryDeadline - Date.now() < 300;
        for (const tab of tabs) {
          const targetId = tab.targetId;
          if (
            typeof targetId !== "string" ||
            this.#targetIds!.has(targetId) ||
            // A tab that already backs a route is never a popup candidate,
            // regardless of any drift in the task-space target set.
            this.#routesByNativeTarget.has(targetId)
          ) {
            continue;
          }
          const queue = this.#popupDiscoveryQueue;
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
          this.#targetIds!.add(targetId);
          await this.#attachTaskSpaceTarget(targetId, entry.openerTargetId);
        }
        if (this.#popupDiscoveryQueue.length === 0) return;
        await new Promise<void>((resolve) => setTimeout(resolve, 20));
      } while (!this.closed && Date.now() < this.#popupDiscoveryDeadline);
      this.#popupDiscoveryQueue.length = 0;
    })()
      .catch(() => undefined)
      .finally(() => {
        this.#discoveringOpenedTargets = false;
        this.#endOperation();
      });
  }

  async #attachTaskSpaceTarget(targetId: string, openerId?: string) {
    const { sessionId, targetInfo } = await this.#attachNativeTarget(targetId);
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
    this.#registerRoute(route);
    this.#deliverEvent({
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
    this.#flushDeferredEvents();
    return route;
  }

  async #attachNativeTarget(targetId: string) {
    this.#manuallyAttachingTargets.add(targetId);
    try {
      const targetInfoResult = await this.#sendNativeCommand(
        "Target.getTargetInfo",
        { targetId },
      );
      const result = await this.#sendNativeCommand("Target.attachToTarget", {
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
      this.#manuallyAttachingTargets.delete(targetId);
    }
  }

  #registerRoute(route: PageRoute) {
    this.#routesByClientSession.set(route.clientSessionId, route);
    this.#routesByNativeSession.set(route.nativeSessionId, route);
    this.#routesByClientTarget.set(route.clientTargetId, route);
    this.#routesByNativeTarget.set(route.nativeTargetId, route);
    this.#sessionsByTarget.set(route.nativeTargetId, route.nativeSessionId);
    this.#targetsBySession.set(route.nativeSessionId, route.nativeTargetId);
  }

  #removeRoute(route: PageRoute) {
    route.state = "closed";
    // A navigation in flight for this route must not complete its swap — the
    // page is gone. Aborting rejects the transition's pending awaits; its
    // catch path then cleans up the replacement tab instead of re-registering
    // the removed route.
    route.abortNavigation?.("the page has been closed");
    this.#routesByClientSession.delete(route.clientSessionId);
    this.#routesByNativeSession.delete(route.nativeSessionId);
    this.#routesByClientTarget.delete(route.clientTargetId);
    this.#routesByNativeTarget.delete(route.nativeTargetId);
    this.#sessionsByTarget.delete(route.nativeTargetId);
    this.#targetsBySession.delete(route.nativeSessionId);
  }

  #replaceNativeRoute(
    route: PageRoute,
    nativeTargetId: string,
    nativeSessionId: string,
    nativeMainFrameId?: string,
  ) {
    this.#routesByNativeSession.delete(route.nativeSessionId);
    this.#routesByNativeTarget.delete(route.nativeTargetId);
    this.#sessionsByTarget.delete(route.nativeTargetId);
    this.#targetsBySession.delete(route.nativeSessionId);
    // The task-space target set must follow the swap: the replacement tab is
    // ours now, and the retired tab must not linger as an admission ticket.
    // Without this, popup discovery mistakes the route's own new tab for an
    // unclaimed popup.
    this.#targetIds?.delete(route.nativeTargetId);
    route.nativeTargetId = nativeTargetId;
    route.nativeSessionId = nativeSessionId;
    route.nativeMainFrameId = nativeMainFrameId;
    route.generation += 1;
    this.#targetIds?.add(nativeTargetId);
    this.#routesByNativeSession.set(nativeSessionId, route);
    this.#routesByNativeTarget.set(nativeTargetId, route);
    this.#sessionsByTarget.set(nativeTargetId, nativeSessionId);
    this.#targetsBySession.set(nativeSessionId, nativeTargetId);
  }

  // Navigate the route's existing tab natively. Only reached while the
  // current page is blank (see send()): the tab keeps its target and session,
  // so the response is simply relayed to the client with the frame id mapped
  // back, and errorText / isDownload get the same client-visible semantics as
  // the replacement flow.
  #runInPlaceNavigation(message: any, route: PageRoute) {
    const url = message.params?.url;
    if (typeof url !== "string") {
      this.#emit({
        id: message.id,
        error: { code: -32_000, message: "Page.navigate requires a url" },
        sessionId: route.clientSessionId,
      });
      return;
    }
    void this.#sendNativeCommand(
      "Page.navigate",
      rewriteOutgoingProtocolParams(message.params || {}, route),
      route.nativeSessionId,
      this.#navigationCommitTimeoutMs,
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
        this.#emit({
          id: message.id,
          result: rewritten,
          sessionId: route.clientSessionId,
        });
      })
      .catch((error) => {
        const description = (error as Error)?.message || String(error);
        this.#emit({
          id: message.id,
          error: {
            code: -32_000,
            message: description.includes("timed out")
              ? `navigation did not commit within ${this.#navigationCommitTimeoutMs}ms (requested ${JSON.stringify(url)})`
              : description,
          },
          sessionId: route.clientSessionId,
        });
      });
  }

  async #runNavigationReplacement(
    message: any,
    route: PageRoute,
    epoch: number,
  ) {
    const clientFrameId = message.params?.frameId;
    const url = message.params?.url;
    if (typeof clientFrameId !== "string" || typeof url !== "string") {
      this.#emit({
        id: message.id,
        error: {
          code: -32_000,
          message: "Page.navigate requires frameId and url",
        },
        sessionId: route.clientSessionId,
      });
      return;
    }
    if (this.closed || route.state === "closed") {
      this.#emit({
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
      this.#emit({
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
    this.#activeOperations += 1;
    this.#updatePendingWork();
    const previousNativeTargetId = route.nativeTargetId;
    const previousNativeSessionId = route.nativeSessionId;
    this.#retiredNativeSessions.add(previousNativeSessionId);
    let replacementTargetId: string | undefined;
    let replacementSessionId: string | undefined;
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
      const created: any = await this.#runtime.createTab!("about:blank");
      const newTargetId = created?.targetId || created?.result?.targetId;
      if (created?.error || typeof newTargetId !== "string") {
        throw new Error(
          created?.error ||
            "ego.createTab did not return a replacement targetId",
        );
      }
      replacementTargetId = newTargetId;

      route.state = "rebinding";
      if (newTargetId === previousNativeTargetId) {
        // The reused tab's old session is detached before the replacement
        // attach; from here until the transition settles no command can be
        // forwarded to it, so send() must hold everything.
        route.nativeSessionDetached = true;
        this.#internallyDetachedSessions.add(route.nativeSessionId);
        await this.#sendNativeCommand("Target.detachFromTarget", {
          sessionId: route.nativeSessionId,
        }).catch(() => undefined);
      }
      const { sessionId: newSessionId } =
        await this.#attachNativeTarget(newTargetId);
      replacementSessionId = newSessionId;
      route.transition = {
        nativeSessionId: newSessionId,
        nativeTargetId: newTargetId,
        clientFrameId,
        announcedRequests: new Set(),
      };
      for (const command of route.replayCommands.values()) {
        if (
          command.method === "Runtime.runIfWaitingForDebugger" ||
          Object.hasOwn(command.params, "frameId")
        ) {
          continue;
        }
        this.#sendNativeFireAndForget(
          command.method,
          command.params,
          newSessionId,
        );
      }
      this.#sendNativeFireAndForget(
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
          this.#sendNativeCommand(
            "Page.navigate",
            { url },
            newSessionId,
            this.#navigationCommitTimeoutMs,
          ),
        );
      } catch (error) {
        const message = (error as Error)?.message || String(error);
        if (message.includes("timed out")) {
          throw new Error(
            `navigation did not commit within ${this.#navigationCommitTimeoutMs}ms (requested ${JSON.stringify(url)})`,
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
        this.#waitForNavigationCommit(
          newSessionId,
          url,
          typeof navigateResult?.loaderId === "string"
            ? navigateResult.loaderId
            : undefined,
          this.#navigationCommitTimeoutMs,
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
      this.#replaceNativeRoute(
        route,
        newTargetId,
        newSessionId,
        replacementFrameId,
      );
      // The old document's execution contexts are gone only once the
      // replacement target has committed; announcing it earlier would brick
      // the page when the navigation fails.
      this.#emit({
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
        for (let index = this.#deferredEvents.length - 1; index >= 0; index--) {
          const event = this.#deferredEvents[index];
          if (
            event.sessionId === newSessionId &&
            event.method === "Network.requestWillBeSent" &&
            typeof event.params?.requestId === "string" &&
            transition.announcedRequests.has(event.params.requestId) &&
            !event.params.redirectResponse
          ) {
            this.#deferredEvents.splice(index, 1);
          }
        }
      }
      // With Page enabled before the navigation starts, the real committed
      // Page.frameNavigated is usually sitting in the deferred queue; the
      // synthetic one below is only the fallback for when it is not.
      const realFrameNavigated = this.#deferredEvents.some(
        (event) =>
          event.sessionId === newSessionId &&
          event.method === "Page.frameNavigated" &&
          event.params?.frame?.parentId === undefined &&
          event.params?.frame?.loaderId === frame.loaderId,
      );
      const requestFinished = this.#emitNavigationResponse(
        route,
        url,
        frame,
        documentState,
        transition,
      );
      this.#flushDeferredEvents();

      if (newTargetId !== previousNativeTargetId) {
        this.#sendNativeFireAndForget("Target.closeTarget", {
          targetId: previousNativeTargetId,
        });
      }
      this.#emit({
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
        this.#emit({
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
        this.#sendNativeFireAndForget(
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
        loaderId:
          typeof frame.loaderId === "string" ? frame.loaderId : undefined,
        lifecycleNames: new Set(),
        frameStopped: false,
        requestId:
          typeof frame.loaderId === "string" ? frame.loaderId : undefined,
        requestFinished,
      };
      this.#completePassiveNavigation(route, frame, navigationKey);
    })()
      .catch((error) => {
        route.transition = undefined;
        if (
          route.state !== "closed" &&
          route.nativeSessionId === previousNativeSessionId
        ) {
          this.#retiredNativeSessions.delete(previousNativeSessionId);
        }
        // The replacement tab never became the route's target; close it so a
        // failed navigation does not leak a stray tab into the TaskSpace.
        if (
          replacementTargetId !== undefined &&
          replacementTargetId !== previousNativeTargetId &&
          route.nativeTargetId !== replacementTargetId
        ) {
          this.#internallyClosedTargets.add(replacementTargetId);
          if (replacementSessionId !== undefined) {
            this.#internallyDetachedSessions.add(replacementSessionId);
            this.#retiredNativeSessions.add(replacementSessionId);
          }
          this.#sendNativeFireAndForget("Target.closeTarget", {
            targetId: replacementTargetId,
          });
        }
        // A closed route stays closed — restoring "attached" here would
        // resurrect a page the client already closed.
        if (route.state !== "closed") route.state = "attached";
        this.#emit({
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
        this.#endOperation();
        this.#flushHeldMessages(route);
      });
  }

  #emitNavigationResponse(
    route: PageRoute,
    requestedUrl: string,
    frame: any,
    documentState: any,
    transition?: NavigationTransition,
  ) {
    if (typeof frame.loaderId !== "string") return true;
    // The document request may have been announced to the client already —
    // deferred and about to flush, or synthesized by the transition bridge
    // when interception paused it — in which case announcing it again here
    // would hand Playwright a duplicate.
    const deferredRequest =
      transition?.announcedRequests.has(frame.loaderId) === true ||
      this.#deferredEvents.some(
        (message) =>
          message.sessionId === route.nativeSessionId &&
          message.method === "Network.requestWillBeSent" &&
          message.params?.requestId === frame.loaderId,
      );
    const deferredResponse = this.#deferredEvents.some(
      (message) =>
        message.sessionId === route.nativeSessionId &&
        message.method === "Network.responseReceived" &&
        message.params?.requestId === frame.loaderId,
    );
    const deferredFinished = this.#deferredEvents.some(
      (message) =>
        message.sessionId === route.nativeSessionId &&
        (message.method === "Network.loadingFinished" ||
          message.method === "Network.loadingFailed") &&
        message.params?.requestId === frame.loaderId,
    );
    const timestamp = Date.now() / 1_000;
    const finalUrl =
      typeof documentState?.url === "string"
        ? documentState.url
        : frame.url || requestedUrl;
    const status =
      typeof documentState?.responseStatus === "number" &&
      documentState.responseStatus > 0
        ? documentState.responseStatus
        : 200;
    if (!deferredRequest) {
      this.#emit({
        method: "Network.requestWillBeSent",
        params: {
          requestId: frame.loaderId,
          loaderId: frame.loaderId,
          documentURL: finalUrl,
          request: {
            url: finalUrl,
            method: "GET",
            headers: {},
          },
          timestamp,
          wallTime: timestamp,
          initiator: { type: "other" },
          type: "Document",
          frameId: route.clientMainFrameId,
          hasUserGesture: false,
        },
        sessionId: route.clientSessionId,
      });
    }
    if (!deferredResponse) {
      this.#emit({
        method: "Network.responseReceived",
        params: {
          requestId: frame.loaderId,
          loaderId: frame.loaderId,
          timestamp,
          type: "Document",
          response: {
            url: finalUrl,
            status,
            statusText: status === 200 ? "OK" : "",
            headers: {},
            mimeType: documentState?.contentType || "text/html",
            connectionReused: false,
            connectionId: 0,
            encodedDataLength: 0,
            securityState: "unknown",
          },
          hasExtraInfo: false,
          frameId: route.clientMainFrameId,
        },
        sessionId: route.clientSessionId,
      });
    }
    return deferredFinished;
  }

  #routeStorageCookieCommand(message: any) {
    // Cookies are browser-global; prefer a route whose native session is
    // usable right now over one that is mid-navigation or mid-rebind.
    const routes = [...this.#routesByClientSession.values()];
    const route =
      routes.find((candidate) => candidate.state === "attached") ??
      routes.find((candidate) => candidate.state !== "closed");
    if (!route) {
      this.#emit({
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
    void this.#sendNativeCommand(nativeMethod, params, route.nativeSessionId)
      .then((result) => this.#emit({ id: message.id, result }))
      .catch((error) => {
        this.#emit({
          id: message.id,
          error: { code: -32_000, message: error?.message || String(error) },
        });
      });
  }

  // Page.navigate has already committed natively when this runs; it only
  // waits for the frame tree to reflect that commit. The navigate response's
  // loaderId is the authoritative marker. A frame still on its initial blank
  // state ("" or about:blank) is never mistaken for the committed page — the
  // replacement tab (new or reused) starts on about:blank — but any other
  // document is accepted: after a successful navigate response a non-blank
  // frame is the committed document or its successor (e.g. an instant
  // client-side redirect that already replaced the expected loader).
  async #waitForNavigationCommit(
    sessionId: string,
    requestedUrl: string,
    expectedLoaderId: string | undefined,
    timeoutMs: number,
    throwIfAborted?: () => void,
  ) {
    const deadline = Date.now() + timeoutMs;
    let lastFrame: any;
    do {
      if (this.closed) throw new Error("Ego CDP transport is closed");
      throwIfAborted?.();
      const frameTree = await this.#sendNativeCommand(
        "Page.getFrameTree",
        {},
        sessionId,
        1_000,
      ).catch(() => undefined);
      const frame = frameTree?.frameTree?.frame;
      if (frame) lastFrame = frame;
      const frameUrl = typeof frame?.url === "string" ? frame.url : "";
      const committed =
        frame !== undefined &&
        ((expectedLoaderId !== undefined &&
          frame.loaderId === expectedLoaderId) ||
          frameUrl === requestedUrl ||
          (frameUrl !== "" && frameUrl !== "about:blank"));
      if (committed) {
        const documentResult = await this.#sendNativeCommand(
          "Runtime.evaluate",
          {
            expression:
              "(() => { const entry = performance.getEntriesByType('navigation')[0]; return { url: location.href, readyState: document.readyState, contentType: document.contentType, responseStatus: entry?.responseStatus }; })()",
            returnByValue: true,
          },
          sessionId,
          1_000,
        ).catch(() => undefined);
        const value = documentResult?.result?.value;
        return {
          frame,
          documentState: value && typeof value === "object" ? value : undefined,
        };
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    } while (Date.now() < deadline);
    const observedUrl =
      typeof lastFrame?.url === "string" && lastFrame.url.trim()
        ? lastFrame.url
        : undefined;
    throw new Error(
      `navigation did not commit within ${timeoutMs}ms (requested ${JSON.stringify(requestedUrl)}, last observed ${JSON.stringify(observedUrl || "unavailable")})`,
    );
  }

  #closeTaskSpaceTarget(message: any) {
    const clientTargetId = message.params?.targetId;
    const route =
      typeof clientTargetId === "string"
        ? this.#routesByClientTarget.get(clientTargetId)
        : undefined;
    const nativeTargetId = route?.nativeTargetId || clientTargetId;
    const nativeSessionId =
      route?.nativeSessionId ||
      (typeof nativeTargetId === "string"
        ? this.#sessionsByTarget.get(nativeTargetId)
        : undefined);
    const clientSessionId = route?.clientSessionId || nativeSessionId;
    const complete = () => {
      if (route) this.#removeRoute(route);
      if (typeof nativeTargetId === "string") {
        this.#sessionsByTarget.delete(nativeTargetId);
        // After a navigation replacement the native id differs from the
        // client id; drop both from the task-space set.
        this.#targetIds?.delete(nativeTargetId);
      }
      if (nativeSessionId) this.#targetsBySession.delete(nativeSessionId);
      if (typeof clientTargetId === "string") {
        this.#targetIds?.delete(clientTargetId);
      }

      this.#emit({ id: message.id, result: { success: true } });
      if (typeof clientTargetId === "string" && clientSessionId) {
        this.#emit({
          method: "Target.detachedFromTarget",
          params: {
            sessionId: clientSessionId,
            targetId: clientTargetId,
          },
        });
      }
    };

    if (typeof nativeTargetId === "string") {
      this.#internallyClosedTargets.add(nativeTargetId);
      if (nativeSessionId) {
        this.#internallyDetachedSessions.add(nativeSessionId);
        this.#retiredNativeSessions.add(nativeSessionId);
      }
      this.#sendNativeFireAndForget("Target.closeTarget", {
        targetId: nativeTargetId,
      });
    }
    if (
      typeof nativeTargetId !== "string" ||
      typeof this.#runtime.listTabs !== "function"
    ) {
      complete();
      return;
    }

    this.#activeOperations += 1;
    this.#updatePendingWork();
    void this.#waitForTargetClosed(nativeTargetId).finally(() => {
      complete();
      this.#endOperation();
    });
  }

  async #waitForTargetClosed(targetId: string, timeoutMs = 1_000) {
    if (typeof this.#runtime.listTabs !== "function") return;
    const deadline = Date.now() + timeoutMs;
    do {
      try {
        const listed = await this.#runtime.listTabs();
        const tabs = listed?.tabs || listed?.targetInfos || [];
        if (!tabs.some((tab) => tab?.targetId === targetId)) return;
      } catch {
        return;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    } while (Date.now() < deadline);
  }

  #sendNativeFireAndForget(
    method: string,
    params: Record<string, unknown>,
    sessionId?: string,
  ) {
    const id = this.#allocateMessageId();
    try {
      void Promise.resolve(
        this.#runtime.sendCDPMessage(
          JSON.stringify({
            id,
            method,
            params,
            ...(sessionId ? { sessionId } : {}),
          }),
        ),
      ).catch(() => undefined);
    } catch {
      // Cleanup and resume commands are best-effort compatibility traffic.
    }
  }

  #sendNativeCommand(
    method: string,
    params: Record<string, unknown>,
    sessionId?: string,
    timeoutMs = 10_000,
  ) {
    const id = this.#allocateMessageId();
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#internalRequests.delete(id);
        this.#updatePendingWork();
        reject(new Error(`native CDP command timed out: ${method}`));
      }, timeoutMs);
      this.#internalRequests.set(id, { resolve, reject, timer });
      this.#updatePendingWork();
      try {
        const result = this.#runtime.sendCDPMessage(
          JSON.stringify({
            id,
            method,
            params,
            ...(sessionId ? { sessionId } : {}),
          }),
        );
        void Promise.resolve(result).catch((error) => {
          const pending = this.#internalRequests.get(id);
          if (!pending) return;
          clearTimeout(pending.timer);
          this.#internalRequests.delete(id);
          this.#updatePendingWork();
          pending.reject(
            error instanceof Error ? error : new Error(String(error)),
          );
        });
      } catch (error) {
        clearTimeout(timer);
        this.#internalRequests.delete(id);
        this.#updatePendingWork();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  #emit(message: any) {
    setImmediate(() => {
      if (!this.closed) this.onmessage?.(message);
    });
  }

  #updatePendingWork() {
    const count = this.closed
      ? 0
      : Number(this.#connecting) +
        this.#pendingIds.size +
        this.#internalRequests.size +
        [...this.#frameTreeBarriers.values()].reduce(
          (total, barrier) => total + barrier.heldAutoAttach.length,
          0,
        ) +
        this.#activeOperations;
    if (count === this.#lastPendingWork) return;
    this.#lastPendingWork = count;
    this.#onPendingWorkChange(count);
  }
}

function createNodeKeepAlive() {
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

export function createEgoCdpTransport(
  runtime: EgoCdpRuntime,
  options: TransportOptions = {},
) {
  return new EgoCdpTransport(runtime, options);
}

function rewriteOutgoingProtocolParams(
  params: Record<string, unknown>,
  route: PageRoute,
) {
  if (
    !route.clientMainFrameId ||
    !route.nativeMainFrameId ||
    params.frameId !== route.clientMainFrameId
  ) {
    return params;
  }
  return { ...params, frameId: route.nativeMainFrameId };
}

function rewriteIncomingProtocolMessage(message: any, route: PageRoute) {
  const params = message.params;
  if (!params || typeof params !== "object") return;
  const replaceFrameId = (object: any, name: string) => {
    if (
      route.clientMainFrameId &&
      route.nativeMainFrameId &&
      object?.[name] === route.nativeMainFrameId
    ) {
      object[name] = route.clientMainFrameId;
    }
  };
  replaceFrameId(params, "frameId");
  replaceFrameId(params, "parentFrameId");
  replaceFrameId(params.frame, "id");
  replaceFrameId(params.frame, "parentId");
  replaceFrameId(params.context?.auxData, "frameId");
}

// The blank states a route's tab can sit on before its first real document:
// a fresh tab ("" or about:blank) or the task space's initial chrome://newtab.
// Navigating away from any of them works natively in place.
function isBlankPageUrl(url: string | undefined): boolean {
  return (
    url === "" ||
    url === "about:blank" ||
    (typeof url === "string" && url.startsWith("chrome://newtab"))
  );
}

function isReplayableSessionCommand(method: unknown): method is string {
  return (
    typeof method === "string" &&
    [
      "Emulation.setDeviceMetricsOverride",
      "Emulation.setEmulatedMedia",
      "Emulation.setFocusEmulationEnabled",
      "Emulation.setGeolocationOverride",
      "Emulation.setLocaleOverride",
      "Emulation.setScriptExecutionDisabled",
      "Emulation.setTimezoneOverride",
      "Emulation.setTouchEmulationEnabled",
      "Emulation.setUserAgentOverride",
      "Fetch.disable",
      "Fetch.enable",
      "Log.enable",
      "Network.enable",
      "Network.emulateNetworkConditions",
      "Network.setCacheDisabled",
      "Network.setExtraHTTPHeaders",
      "Network.setUserAgentOverride",
      "Page.addScriptToEvaluateOnNewDocument",
      "Page.createIsolatedWorld",
      "Page.enable",
      "Page.setBypassCSP",
      "Page.setInterceptFileChooserDialog",
      "Page.setLifecycleEventsEnabled",
      "Runtime.addBinding",
      "Runtime.enable",
      "Runtime.runIfWaitingForDebugger",
      "Security.setIgnoreCertificateErrors",
      "Target.setAutoAttach",
    ].includes(method)
  );
}

function storageCookieCommand(method: unknown) {
  if (method === "Storage.getCookies") return "Network.getAllCookies";
  if (method === "Storage.setCookies") return "Network.setCookies";
  if (method === "Storage.clearCookies") return "Network.clearBrowserCookies";
  return undefined;
}

export function playwrightCompatibilityResult(method: unknown) {
  if (method === "Browser.setDownloadBehavior") return {};
  if (method === "Browser.getVersion") {
    const platform =
      process.platform === "darwin"
        ? "Macintosh; Intel Mac OS X 10_15_7"
        : process.platform === "win32"
          ? "Windows NT 10.0; Win64; x64"
          : "X11; Linux x86_64";
    return {
      protocolVersion: "1.3",
      product: "Chrome/0.0.0.0",
      revision: "@ego-lite",
      userAgent: `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/0.0.0.0 Safari/537.36`,
      jsVersion: process.versions.v8,
    };
  }
  return undefined;
}
