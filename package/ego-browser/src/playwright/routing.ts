import {
  allocateCdpMessageId,
  subscribeEgoCdpTransport,
} from "../browser-runtime.js";

export type EgoCdpRuntime = {
  sendCDPMessage: (payload: string) => unknown;
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
  onPendingWorkChange?: (count: number) => void;
  targetIds?: Iterable<string>;
};

type ReplayCommand = {
  method: string;
  params: Record<string, unknown>;
};

type PageRoute = {
  clientTargetId: string;
  nativeTargetId: string;
  clientSessionId: string;
  nativeSessionId: string;
  clientMainFrameId?: string;
  nativeMainFrameId?: string;
  generation: number;
  state: "attached" | "navigating" | "rebinding" | "closed";
  replayCommands: Map<string, ReplayCommand>;
  passiveNavigation?: {
    key: string;
    generation: number;
    nativeFrameId: string;
    loaderId?: string;
    lifecycleNames: Set<string>;
    frameStopped: boolean;
  };
};

export class EgoCdpTransport {
  onmessage?: (message: any) => void;
  onclose?: (reason?: string) => void;
  closed = false;

  readonly #runtime: EgoCdpRuntime;
  readonly #allocateMessageId: () => number;
  readonly #onPendingWorkChange: (count: number) => void;
  readonly #pendingIds = new Map<
    number,
    {
      clientId: unknown;
      method: unknown;
      clientSessionId?: string;
      nativeSessionId?: string;
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
  readonly #deferredEvents: any[] = [];
  readonly #manuallyAttachingTargets = new Set<string>();
  readonly #internallyDetachedSessions = new Set<string>();
  readonly #retiredNativeSessions = new Set<string>();
  readonly #unsubscribe: () => void;
  #connecting = true;
  #discoveringOpenedTargets = false;
  #activeOperations = 0;
  #lastPendingWork = 0;

  constructor(runtime: EgoCdpRuntime, options: TransportOptions = {}) {
    this.#runtime = runtime;
    this.#allocateMessageId = options.allocateMessageId || allocateCdpMessageId;
    this.#onPendingWorkChange =
      options.onPendingWorkChange || createNodeKeepAlive();
    if (options.targetIds) this.#targetIds = new Set(options.targetIds);
    this.#unsubscribe = subscribeEgoCdpTransport(runtime, {
      message: (payload) => this.#dispatch(payload),
      error: (message, errorCode) => {
        this.close(
          [errorCode, message].filter(Boolean).join(": ") ||
            "native CDP send failed",
        );
      },
    });
    this.#updatePendingWork();
  }

  send(message: any) {
    if (this.closed) throw new Error("Ego CDP transport is closed");
    const compatibilityResult = playwrightCompatibilityResult(message.method);
    if (compatibilityResult !== undefined) {
      this.#emit({ id: message.id, result: compatibilityResult });
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
        .finally(() => {
          this.#activeOperations -= 1;
          if (this.#activeOperations === 0) this.#deferredEvents.length = 0;
          this.#updatePendingWork();
        });
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
      if (route) {
        this.#replaceTaskSpaceTargetForNavigation(message, route);
        return;
      }
    }
    const clientSessionId =
      typeof message.sessionId === "string" ? message.sessionId : undefined;
    const route = clientSessionId
      ? this.#routesByClientSession.get(clientSessionId)
      : undefined;
    if (route && isReplayableSessionCommand(message.method)) {
      const params = message.params || {};
      route.replayCommands.set(`${message.method}:${JSON.stringify(params)}`, {
        method: message.method,
        params,
      });
    }
    const nativeId = this.#allocateMessageId();
    this.#pendingIds.set(nativeId, {
      clientId: message.id,
      method: message.method,
      clientSessionId,
      nativeSessionId: route?.nativeSessionId,
    });
    this.#updatePendingWork();
    try {
      const nativeMessage = route
        ? {
            ...message,
            id: nativeId,
            sessionId: route.nativeSessionId,
            params: rewriteOutgoingProtocolParams(message.params || {}, route),
          }
        : { ...message, id: nativeId };
      const result = this.#runtime.sendCDPMessage(
        JSON.stringify(nativeMessage),
      );
      void Promise.resolve(result).catch((error) => {
        this.#pendingIds.delete(nativeId);
        this.#updatePendingWork();
        this.close((error as Error)?.message || String(error));
      });
    } catch (error) {
      this.#pendingIds.delete(nativeId);
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
    }
    this.#routesByClientSession.clear();
    this.#routesByNativeSession.clear();
    this.#routesByClientTarget.clear();
    this.#routesByNativeTarget.clear();
    this.#sessionsByTarget.clear();
    this.#targetsBySession.clear();
    this.#deferredEvents.length = 0;
    this.#manuallyAttachingTargets.clear();
    this.#internallyDetachedSessions.clear();
    this.#retiredNativeSessions.clear();
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

  async closeAndWait() {
    if (!this.closed && this.#targetIds) {
      const sessionIds = [...this.#targetsBySession.keys()];
      await this.#sendNativeCommand(
        "Target.setAutoAttach",
        {
          autoAttach: false,
          waitForDebuggerOnStart: false,
          flatten: true,
        },
        undefined,
        500,
      ).catch(() => undefined);
      for (const sessionId of sessionIds) {
        this.#internallyDetachedSessions.add(sessionId);
        await this.#sendNativeCommand(
          "Target.detachFromTarget",
          { sessionId },
          undefined,
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
      message.id = pending.clientId;
      if (pending.clientSessionId) {
        message.sessionId = pending.clientSessionId;
      }
      this.#filterResponse(pending.method, message);
      this.#emit(message);
      return;
    }
    if (this.#isRetiredSessionEvent(message)) return;
    if (this.#rebindDetachedRoute(message)) return;
    if (!this.#acceptEvent(message)) {
      if (
        this.#activeOperations > 0 &&
        !this.#isManualAttachEvent(message) &&
        !this.#isInternalDetachEvent(message) &&
        this.#deferredEvents.length < 10_000
      ) {
        this.#deferredEvents.push(message);
      }
      return;
    }
    const nativeSessionId =
      typeof message.sessionId === "string" ? message.sessionId : undefined;
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
    this.#deliverEvent(message);
    if (message.method === "Page.windowOpen") {
      this.#discoverOpenedTargets(openerTargetId, message.params?.url);
    }
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
      this.#activeOperations -= 1;
      this.#updatePendingWork();
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
    this.#deliverEvent({
      method: "Target.detachedFromTarget",
      params: {
        sessionId: clientSessionId,
        targetId: clientTargetId,
      },
    });
  }

  #observeRouteEvent(message: any, route: PageRoute) {
    if (message.method === "Page.frameNavigated") {
      const frame = message.params?.frame;
      if (
        frame?.parentId === undefined &&
        typeof frame?.id === "string" &&
        route.state === "attached"
      ) {
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
          return;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
      } while (Date.now() < deadline);
    })().finally(() => {
      this.#activeOperations -= 1;
      this.#updatePendingWork();
    });
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
      const targetId = message.params?.targetId;
      const sessionId = message.params?.sessionId;
      if (typeof targetId === "string") this.#sessionsByTarget.delete(targetId);
      if (typeof sessionId === "string")
        this.#targetsBySession.delete(sessionId);
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
      const route =
        typeof message.sessionId === "string"
          ? this.#routesByNativeSession.get(message.sessionId)
          : undefined;
      if (route) {
        message.sessionId = route.clientSessionId;
        rewriteIncomingProtocolMessage(message, route);
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
      return this.#targetsBySession.has(message.sessionId);
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
      .finally(() => {
        this.#activeOperations -= 1;
        if (this.#activeOperations === 0) this.#deferredEvents.length = 0;
        this.#updatePendingWork();
      });
  }

  #discoverOpenedTargets(openerTargetId?: string, expectedUrl?: string) {
    if (
      !this.#targetIds ||
      typeof this.#runtime.listTabs !== "function" ||
      this.#discoveringOpenedTargets
    ) {
      return;
    }
    this.#discoveringOpenedTargets = true;
    this.#activeOperations += 1;
    this.#updatePendingWork();
    void (async () => {
      const deadline = Date.now() + 2_000;
      do {
        const listed = await this.#runtime.listTabs!();
        const tabs = listed?.tabs || listed?.targetInfos || [];
        const openedTargetIds = tabs
          .filter(
            (tab) => typeof expectedUrl !== "string" || tab.url === expectedUrl,
          )
          .map((tab) => tab.targetId)
          .filter(
            (targetId): targetId is string =>
              typeof targetId === "string" && !this.#targetIds!.has(targetId),
          );
        if (openedTargetIds.length > 0) {
          for (const targetId of openedTargetIds) {
            this.#targetIds.add(targetId);
            await this.#attachTaskSpaceTarget(targetId, openerTargetId);
          }
          return;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 20));
      } while (!this.closed && Date.now() < deadline);
    })()
      .catch(() => undefined)
      .finally(() => {
        this.#discoveringOpenedTargets = false;
        this.#activeOperations -= 1;
        this.#updatePendingWork();
      });
  }

  async #attachTaskSpaceTarget(targetId: string, openerId?: string) {
    const { sessionId, targetInfo } = await this.#attachNativeTarget(targetId);
    const route: PageRoute = {
      clientTargetId: targetId,
      nativeTargetId: targetId,
      clientSessionId: sessionId,
      nativeSessionId: sessionId,
      generation: 0,
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
    route.nativeTargetId = nativeTargetId;
    route.nativeSessionId = nativeSessionId;
    route.nativeMainFrameId = nativeMainFrameId;
    route.generation += 1;
    this.#routesByNativeSession.set(nativeSessionId, route);
    this.#routesByNativeTarget.set(nativeTargetId, route);
    this.#sessionsByTarget.set(nativeTargetId, nativeSessionId);
    this.#targetsBySession.set(nativeSessionId, nativeTargetId);
  }

  #replaceTaskSpaceTargetForNavigation(message: any, route: PageRoute) {
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

    route.state = "navigating";
    this.#activeOperations += 1;
    this.#updatePendingWork();
    const previousNativeTargetId = route.nativeTargetId;
    const previousNativeSessionId = route.nativeSessionId;
    this.#retiredNativeSessions.add(previousNativeSessionId);
    this.#emit({
      method: "Runtime.executionContextsCleared",
      params: {},
      sessionId: route.clientSessionId,
    });

    void (async () => {
      const previousFrameTree = await this.#sendNativeCommand(
        "Page.getFrameTree",
        {},
        route.nativeSessionId,
        1_000,
      ).catch(() => undefined);
      const previousFrame = previousFrameTree?.frameTree?.frame;
      const created: any = await this.#runtime.createTab!(url);
      const replacementTargetId =
        created?.targetId || created?.result?.targetId;
      if (created?.error || typeof replacementTargetId !== "string") {
        throw new Error(
          created?.error ||
            "ego.createTab did not return a replacement targetId",
        );
      }

      route.state = "rebinding";
      if (replacementTargetId === previousNativeTargetId) {
        this.#internallyDetachedSessions.add(route.nativeSessionId);
        await this.#sendNativeCommand("Target.detachFromTarget", {
          sessionId: route.nativeSessionId,
        }).catch(() => undefined);
      }
      const { sessionId: replacementSessionId } =
        await this.#attachNativeTarget(replacementTargetId);
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
          replacementSessionId,
        );
      }
      this.#sendNativeFireAndForget(
        "Runtime.runIfWaitingForDebugger",
        {},
        replacementSessionId,
      );
      const frame = await this.#waitForNavigationCommit(
        replacementSessionId,
        url,
        previousFrame,
      );
      const replacementFrameId =
        typeof frame.id === "string" ? frame.id : replacementTargetId;
      route.clientMainFrameId = clientFrameId;
      this.#replaceNativeRoute(
        route,
        replacementTargetId,
        replacementSessionId,
        replacementFrameId,
      );
      this.#flushDeferredEvents();

      if (replacementTargetId !== previousNativeTargetId) {
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

      for (const command of route.replayCommands.values()) {
        if (!Object.hasOwn(command.params, "frameId")) continue;
        this.#sendNativeFireAndForget(
          command.method,
          rewriteOutgoingProtocolParams(command.params, route),
          replacementSessionId,
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
      };
      this.#completePassiveNavigation(route, frame, navigationKey);
    })()
      .catch((error) => {
        if (route.nativeSessionId === previousNativeSessionId) {
          this.#retiredNativeSessions.delete(previousNativeSessionId);
        }
        route.state = "attached";
        this.#emit({
          id: message.id,
          error: { code: -32_000, message: error?.message || String(error) },
          sessionId: route.clientSessionId,
        });
      })
      .finally(() => {
        this.#activeOperations -= 1;
        this.#updatePendingWork();
      });
  }

  async #waitForNavigationCommit(
    sessionId: string,
    requestedUrl: string,
    previousFrame?: { loaderId?: string; url?: string },
    timeoutMs = 8_000,
  ) {
    const deadline = Date.now() + timeoutMs;
    const stableForMs = 50;
    let lastFrame: any;
    let commitCandidateKey: string | undefined;
    let commitCandidateSince = 0;
    do {
      if (this.closed) throw new Error("Ego CDP transport is closed");
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
        frameUrl === requestedUrl ||
        (frameUrl !== "" &&
          frameUrl !== "about:blank" &&
          (frameUrl !== previousFrame?.url ||
            frame?.loaderId !== previousFrame?.loaderId));
      if (committed) {
        const candidateKey = `${frame.loaderId || ""}\0${frameUrl}`;
        if (candidateKey !== commitCandidateKey) {
          commitCandidateKey = candidateKey;
          commitCandidateSince = Date.now();
        } else if (Date.now() - commitCandidateSince >= stableForMs) {
          return frame;
        }
      } else {
        commitCandidateKey = undefined;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    } while (Date.now() < deadline);
    throw new Error(
      `navigation did not commit: ${lastFrame?.url || requestedUrl}`,
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
      typeof nativeTargetId === "string"
        ? this.#sessionsByTarget.get(nativeTargetId)
        : undefined;
    const clientSessionId = route?.clientSessionId || nativeSessionId;
    const complete = () => {
      if (route) this.#removeRoute(route);
      if (typeof nativeTargetId === "string") {
        this.#sessionsByTarget.delete(nativeTargetId);
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
      this.#activeOperations -= 1;
      this.#updatePendingWork();
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

function isReplayableSessionCommand(method: unknown): method is string {
  return (
    typeof method === "string" &&
    [
      "Emulation.setFocusEmulationEnabled",
      "Log.enable",
      "Network.enable",
      "Network.setCacheDisabled",
      "Network.setExtraHTTPHeaders",
      "Page.addScriptToEvaluateOnNewDocument",
      "Page.createIsolatedWorld",
      "Page.enable",
      "Page.setBypassCSP",
      "Page.setInterceptFileChooserDialog",
      "Page.setLifecycleEventsEnabled",
      "Runtime.addBinding",
      "Runtime.enable",
      "Runtime.runIfWaitingForDebugger",
      "Target.setAutoAttach",
    ].includes(method)
  );
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
