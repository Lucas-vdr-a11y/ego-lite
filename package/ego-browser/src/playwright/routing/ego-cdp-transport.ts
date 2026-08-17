import {
  allocateCdpMessageId,
  catchGuarded,
  guardNativeCallback,
  subscribeEgoCdpTransport,
} from "../../browser-runtime.js";
import { highlightAgentMouse } from "../mouse-highlight.js";
import {
  runInPlaceNavigation,
  runNavigationReplacement,
  type NavigationContext,
} from "./navigation.js";
import {
  completePassiveNavigation,
  observeRouteEvent,
  type PassiveNavigationContext,
} from "./passive-navigation.js";
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
import { dispatchNativeMessage, type InboundContext } from "./inbound.js";
import {
  createClientTarget,
  forwardToNative,
  replaceRootAutoAttach,
  routeStorageCookieCommand,
  type OutboundContext,
} from "./outbound.js";
import { PendingCommands } from "./pending-commands.js";
import { PopupDiscovery } from "./popup-discovery.js";
import {
  adoptReplacementSessionAfterFailure,
  attachNativeTarget,
  attachTaskSpaceTarget,
  closeTaskSpaceTarget,
  removeRoute,
  replaceNativeRoute,
  type TargetLifecycleContext,
} from "./target-lifecycle.js";
import { SessionTables } from "./session-tables.js";
import { FrameRegistry } from "./frame-registry.js";
import { FrameTreeBarriers } from "./frame-tree-barrier.js";
import { NativeCommandChannel } from "./native-commands.js";
import { createNodeKeepAlive, PendingWork } from "./pending-work.js";
import {
  isBlankPageUrl,
  isReplayableSessionCommand,
  nativeSendErrorText,
  playwrightCompatibilityResult,
  rewriteIncomingProtocolMessage,
  rewriteOutgoingProtocolParams,
  storageCookieCommand,
} from "./protocol.js";
import {
  routeClosed,
  type EgoCdpRuntime,
  type NavigationTransition,
  type PageRoute,
  type PassthroughSession,
  type PendingCommand,
  type TransportOptions,
} from "./types.js";

// A barrier only ends when its Page.getFrameTree is answered. Native accepting
// the command and then never replying is not covered by the error paths, and a
// client-forwarded command carries no deadline of its own, so the barrier needs
// one: past it, page initialization is never going to complete and failing is
// strictly better than hanging.
const FRAME_TREE_BARRIER_TIMEOUT_MS = 10_000;
// On reconnect, Chromium keeps existing OOPIF targets but Page.getFrameTree
// omits them. Let Playwright consume the local frame tree before native
// auto-attach enumerates those targets, then restore any missing frame node
// immediately before forwarding its Target.attachedToTarget event.

export class EgoCdpTransport {
  onmessage?: (message: any) => void;
  onclose?: (reason?: string) => void;
  closed = false;

  readonly #runtime: EgoCdpRuntime;
  readonly #allocateMessageId: () => number;
  readonly #navigationCommitTimeoutMs: number;
  readonly #frameTreeBarrierTimeoutMs: number;
  readonly #work: PendingWork;
  readonly #native: NativeCommandChannel;
  readonly #pendingIds: PendingCommands;
  readonly #tables: SessionTables;
  readonly #barriers: FrameTreeBarriers;
  readonly #frames: FrameRegistry;
  readonly #deferredEvents: any[] = [];
  readonly #admission: EventAdmissionContext;
  readonly #popups: PopupDiscovery;
  readonly #targets: TargetLifecycleContext;
  readonly #delivery: EventDeliveryContext;
  readonly #inbound: InboundContext;
  readonly #outbound: OutboundContext;
  readonly #navigation: NavigationContext;
  readonly #passive: PassiveNavigationContext;
  readonly #unsubscribe: () => void;
  #closePromise?: Promise<void>;
  #closing = false;

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
    this.#frameTreeBarrierTimeoutMs =
      options.frameTreeBarrierTimeoutMs ?? FRAME_TREE_BARRIER_TIMEOUT_MS;
    if (
      !Number.isFinite(this.#frameTreeBarrierTimeoutMs) ||
      this.#frameTreeBarrierTimeoutMs <= 0
    ) {
      throw new TypeError("frameTreeBarrierTimeoutMs must be positive");
    }
    this.#tables = new SessionTables({ targetIds: options.targetIds });
    this.#pendingIds = new PendingCommands({
      emit: (message) => this.#emit(message),
      onPendingChange: () => this.#work.update(),
      failBarrier: (method, sessionId, description) =>
        this.#barriers.failFor(method, sessionId, description),
    });
    this.#barriers = new FrameTreeBarriers({
      timeoutMs: this.#frameTreeBarrierTimeoutMs,
      isPageSession: (sessionId) =>
        this.#tables.routesByClientSession.has(sessionId) ||
        this.#tables.targetsBySession.has(sessionId),
      emit: (message) => this.#emit(message),
      onHeldChange: () => this.#work.update(),
      replay: (message) => this.send(message),
      canReplay: () => !this.closed && !this.#closing,
      rejectPendingCommands: (predicate, sessionId, description) =>
        this.#pendingIds.rejectMatching(predicate, sessionId, description),
    });
    this.#frames = new FrameRegistry({
      ownerOf: (sessionId) => this.#tables.pageTargetForSession(sessionId),
    });
    this.#native = new NativeCommandChannel({
      allocateMessageId: this.#allocateMessageId,
      send: (payload) => this.#runtime.sendCDPMessage(payload),
      onPendingChange: () => this.#work.update(),
    });
    this.#work = new PendingWork({
      onChange: options.onPendingWorkChange || createNodeKeepAlive(),
      contributors: () =>
        this.#pendingIds.size + this.#native.size + this.#barriers.heldCount(),
      isClosed: () => this.closed,
    });
    this.#admission = {
      tables: this.#tables,
      dropBarrier: (sessionId, description) =>
        this.#barriers.drop(sessionId, description),
      rejectPendingCommands: (predicate, sessionId, description) =>
        this.#pendingIds.rejectMatching(predicate, sessionId, description),
    };
    this.#delivery = {
      tables: this.#tables,
      frames: this.#frames,
      pendingIds: this.#pendingIds,
      deferredEvents: this.#deferredEvents,
      admission: this.#admission,
      emit: (message) => this.#emit(message),
      removeRoute: (route) => removeRoute(this.#targets, route),
    };
    this.#targets = {
      runtime,
      tables: this.#tables,
      native: this.#native,
      work: this.#work,
      barriers: this.#barriers,
      frames: this.#frames,
      emit: (message) => this.#emit(message),
      endOperation: () => this.#endOperation(),
      deliverEvent: (message) => deliverEvent(this.#delivery, message),
      flushDeferredEvents: () => flushDeferredEvents(this.#delivery),
    };
    this.#popups = new PopupDiscovery({
      runtime,
      tables: this.#tables,
      work: this.#work,
      isClosed: () => this.closed,
      endOperation: () => this.#endOperation(),
      attachTaskSpaceTarget: (targetId, openerId) =>
        attachTaskSpaceTarget(this.#targets, targetId, openerId),
    });
    this.#passive = {
      native: this.#native,
      work: this.#work,
      isClosed: () => this.closed,
      emit: (outgoing) => this.#emit(outgoing),
      endOperation: () => this.#endOperation(),
    };
    this.#navigation = {
      runtime,
      tables: this.#tables,
      native: this.#native,
      work: this.#work,
      navigationCommitTimeoutMs: this.#navigationCommitTimeoutMs,
      deferredEvents: this.#deferredEvents,
      isClosed: () => this.closed,
      emit: (outgoing) => this.#emit(outgoing),
      endOperation: () => this.#endOperation(),
      flushDeferredEvents: () => flushDeferredEvents(this.#delivery),
      flushHeldMessages: (route) => this.#flushHeldMessages(route),
      attachNativeTarget: (targetId) =>
        attachNativeTarget(this.#targets, targetId),
      replaceNativeRoute: (route, targetId, sessionId, mainFrameId) =>
        replaceNativeRoute(
          this.#targets,
          route,
          targetId,
          sessionId,
          mainFrameId,
        ),
      adoptReplacementSessionAfterFailure: (route, targetId, sessionId) =>
        adoptReplacementSessionAfterFailure(
          this.#targets,
          route,
          targetId,
          sessionId,
        ),
      completePassiveNavigation: (route, frame, key) =>
        completePassiveNavigation(this.#passive, route, frame, key),
    };
    this.#outbound = {
      runtime,
      tables: this.#tables,
      native: this.#native,
      work: this.#work,
      barriers: this.#barriers,
      pendingIds: this.#pendingIds,
      targets: this.#targets,
      allocateMessageId: this.#allocateMessageId,
      emit: (outgoing) => this.#emit(outgoing),
      endOperation: () => this.#endOperation(),
      flushDeferredEvents: () => flushDeferredEvents(this.#delivery),
    };
    this.#inbound = {
      runtime,
      tables: this.#tables,
      native: this.#native,
      work: this.#work,
      barriers: this.#barriers,
      frames: this.#frames,
      pendingIds: this.#pendingIds,
      popups: this.#popups,
      deferredEvents: this.#deferredEvents,
      admission: this.#admission,
      delivery: this.#delivery,
      passive: this.#passive,
      targets: this.#targets,
      isClosed: () => this.closed,
      isClosing: () => this.#closing,
      emit: (outgoing) => this.#emit(outgoing),
      endOperation: () => this.#endOperation(),
      flushHeldMessages: (route) => this.#flushHeldMessages(route),
    };
    this.#unsubscribe = subscribeEgoCdpTransport(runtime, {
      message: (payload) => dispatchNativeMessage(this.#inbound, payload),
      error: (message, errorCode) =>
        this.#handleNativeSendError(message, errorCode),
    });
    this.#work.update();
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
      routeStorageCookieCommand(this.#outbound, message);
      return;
    }
    if (
      message.method === "Target.setAutoAttach" &&
      message.sessionId === undefined &&
      this.#tables.targetIds
    ) {
      replaceRootAutoAttach(this.#outbound, message);
      return;
    }
    if (this.#barriers.intercept(message)) return;
    if (
      message.method === "Target.createTarget" &&
      typeof this.#runtime.createTab === "function"
    ) {
      createClientTarget(this.#outbound, message);
      return;
    }
    if (message.method === "Target.closeTarget") {
      closeTaskSpaceTarget(this.#targets, message);
      return;
    }
    if (
      message.method === "Page.navigate" &&
      typeof message.sessionId === "string" &&
      typeof this.#runtime.createTab === "function"
    ) {
      const route = this.#tables.routesByClientSession.get(message.sessionId);
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
          runInPlaceNavigation(this.#navigation, message, route);
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
        const run = () =>
          runNavigationReplacement(this.#navigation, message, route, epoch);
        const previous = route.pendingTransition ?? Promise.resolve();
        // Both handlers are `run`, so a *newer* navigation absorbs whatever
        // this one did. When none arrives, nothing observes this promise —
        // and #runNavigationReplacement awaits a chain whose `.finally` can
        // throw, which would abort the shared process instead of this page.
        route.pendingTransition = previous
          .then(run, run)
          .catch(catchGuarded("navigation replacement"));
        return;
      }
    }
    forwardToNative(this.#outbound, message);
  }
  close(reason?: string) {
    if (this.closed) return;
    this.closed = true;
    this.#unsubscribe();
    this.#native.rejectAll(reason || "Ego CDP transport closed");
    this.#pendingIds.clear();
    for (const route of this.#tables.routesByClientSession.values()) {
      route.state = "closed";
      route.abortNavigation?.(reason || "Ego CDP transport closed");
    }
    this.#tables.clear();
    this.#deferredEvents.length = 0;
    this.#barriers.clear();
    this.#frames.clear();
    this.#work.update();
    const onclose = this.onclose;
    this.onmessage = undefined;
    this.onclose = undefined;
    if (onclose) {
      setImmediate(() => guardNativeCallback("onclose", () => onclose(reason)));
    }
  }

  releaseConnectionKeepAlive() {
    this.#work.releaseConnectionKeepAlive();
  }

  // Native send errors are task-level (the callback carries no request id and
  // once the task space is inactive every in-flight send fails alike), so all
  // in-flight requests are rejected. The transport stays open: the condition
  // is transient (e.g. the user took control) and commands succeed again after
  // the task space is handed back.
  #handleNativeSendError(message: unknown, errorCode?: string) {
    if (this.closed) return;
    const description = nativeSendErrorText(message, errorCode);
    this.#native.rejectAll(description);
    const pendingEntries = this.#pendingIds.drain();
    for (const pending of pendingEntries) {
      this.#barriers.failFor(
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
    this.#work.update();
  }

  // An event is deferred because it was unroutable *at arrival*; the operation
  // that deferred it is usually what makes it routable (an attach registers the
  // session it names). Discarding the queue outright therefore drops events
  // that became deliverable while the operation ran — a lost
  // Runtime.executionContextCreated strands Frame._utilityContext() forever,
  // and a lost Target.attachedToTarget leaves an OOPIF paused. Replay first and
  // only then discard what is still unroutable, so the queue stays bounded.
  #endOperation() {
    if (this.#work.endOperation()) {
      // Replaying delivers events to the client, so this inherits every throw
      // #emit can produce — and #endOperation itself runs from detached
      // `.finally` blocks, where a throw is fatal to the shared process.
      guardNativeCallback("deferred-event replay", () =>
        flushDeferredEvents(this.#delivery),
      );
      // A replayed event can start a new operation (a main-frame
      // Page.frameNavigated begins a passive navigation); that operation owns
      // the remaining queue, so only clear it when none did.
      if (this.#work.operations === 0) this.#deferredEvents.length = 0;
    }
    this.#work.update();
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
    if (!this.closed && this.#tables.targetIds) {
      const childFirstSessionIds = [
        ...new Set([
          ...this.#tables.targetsBySession.keys(),
          ...[...this.#tables.passthroughSessions.values()].map(
            (session) => session.nativeSessionId,
          ),
        ]),
      ].reverse();
      for (const sessionId of childFirstSessionIds) {
        this.#tables.internallyDetachedSessions.add(sessionId);
      }
      const autoAttachParams = {
        autoAttach: false,
        waitForDebuggerOnStart: false,
        flatten: true,
      };
      for (const sessionId of childFirstSessionIds) {
        await this.#native
          .command("Target.setAutoAttach", autoAttachParams, sessionId, 500)
          .catch(() => undefined);
      }
      await this.#native
        .command("Target.setAutoAttach", autoAttachParams, undefined, 500)
        .catch(() => undefined);
      for (const sessionId of childFirstSessionIds) {
        await this.#native
          .command(
            "Target.detachFromTarget",
            { sessionId },
            this.#tables.nativeParentSessions.get(sessionId),
            500,
          )
          .catch(() => undefined);
      }
    }
    this.close();
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  #emit(message: any) {
    setImmediate(() => {
      if (this.closed) return;
      // onmessage is the client's whole protocol dispatch (Playwright parses
      // the message and runs its event handlers inline). A throw in there is
      // an uncaught exception in a timer callback, which ends the shared
      // NodeService — see guardNativeCallback.
      guardNativeCallback(
        `onmessage(${message?.method || `#${message?.id}`})`,
        () => this.onmessage?.(message),
      );
    });
  }
}

export function createEgoCdpTransport(
  runtime: EgoCdpRuntime,
  options: TransportOptions = {},
) {
  return new EgoCdpTransport(runtime, options);
}
