import type { Browser, BrowserContext, Page } from "playwright-core";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { subscribeEgoCdpTransport } from "./browser-runtime.js";

export type PlaywrightTaskSpaceSession = {
  page: Page;
  context: BrowserContext;
  close: () => Promise<void>;
};

export type PlaywrightTaskSpaceConnector = (
  space: Record<string, unknown>,
) => Promise<PlaywrightTaskSpaceSession>;

const disconnectedConnector: PlaywrightTaskSpaceConnector = async () => {
  throw new Error("Playwright TaskSpace connector is not configured");
};

let connector = disconnectedConnector;
let activeSession: PlaywrightTaskSpaceSession | undefined;

export type EgoPlaywrightRuntime = {
  listTabs?: () => Promise<{
    tabs?: EgoTab[];
    targetInfos?: EgoTab[];
  }>;
  getCDPEndpoint?: (taskSpaceId?: string | number) => Promise<
    | string
    | {
        endpoint?: string;
        webSocketDebuggerUrl?: string;
      }
  >;
  createTab?: (
    url?: string,
  ) => Promise<
    | { targetId?: string; result?: { targetId?: string }; error?: unknown }
    | unknown
  >;
  sendCDPMessage?: (payload: string) => unknown;
  onCDPMessage?: (payload: string) => void;
  onSendCDPMessageError?: (message: unknown, errorCode?: string) => void;
};

type EgoTab = {
  targetId?: string;
  active?: boolean;
  type?: string;
  title?: string;
  url?: string;
};

export type PlaywrightConnectorDependencies = {
  runtime: () => EgoPlaywrightRuntime;
  endpoint: (
    runtime: EgoPlaywrightRuntime,
    space: Record<string, unknown>,
  ) => Promise<string | PlaywrightEndpointLease>;
  connectOverCDP: (endpoint: string) => Promise<Browser>;
};

export type PlaywrightEndpointLease = {
  endpoint: string;
  close?: () => Promise<void>;
};

let nextBridgeMessageId = 1_000_000_000;
let playwrightTimerPatchUsers = 0;
let originalSetTimeout: typeof globalThis.setTimeout | undefined;
let patchedSetTimeout: typeof globalThis.setTimeout | undefined;

export function createPlaywrightTaskSpaceConnector(
  dependencies: PlaywrightConnectorDependencies,
): PlaywrightTaskSpaceConnector {
  let browser: Browser | undefined;
  let browserEndpoint: string | undefined;
  let closeEndpoint: (() => Promise<void>) | undefined;

  const close = async () => {
    const currentBrowser = browser;
    const currentEndpointClose = closeEndpoint;
    browser = undefined;
    browserEndpoint = undefined;
    closeEndpoint = undefined;
    if (currentEndpointClose) {
      try {
        await currentEndpointClose();
      } finally {
        await currentBrowser?.close();
      }
    } else {
      await currentBrowser?.close();
    }
  };

  return async (space) => {
    const runtime = dependencies.runtime();
    if (!runtime || typeof runtime.listTabs !== "function") {
      throw new Error("Playwright TaskSpace requires ego.listTabs");
    }

    try {
      const resolved = await dependencies.endpoint(runtime, space);
      const endpoint =
        typeof resolved === "string" ? resolved : resolved.endpoint;
      if (browser && endpoint !== browserEndpoint) await close();
      if (!browser) {
        browserEndpoint = endpoint;
        closeEndpoint =
          typeof resolved === "string" ? undefined : resolved.close;
        browser = await dependencies.connectOverCDP(endpoint);
      } else if (typeof resolved !== "string") {
        await resolved.close?.();
      }
      const listed = await runtime.listTabs();
      const nativeTabs = listed.tabs || listed.targetInfos || [];
      const activeTab =
        nativeTabs.find((tab) => tab.active) || nativeTabs.at(-1);
      const located = await locatePlaywrightPage(
        browser,
        activeTab,
        nativeTabs,
      );
      return {
        page: located.page,
        context: located.context,
        close,
      };
    } catch (error) {
      await close();
      throw error;
    }
  };
}
export function createNativePlaywrightTaskSpaceConnector() {
  return createPlaywrightTaskSpaceConnector({
    runtime: () => (globalThis as any).ego,
    endpoint: (runtime, space) => resolveNativeCdpEndpoint(runtime, space),
    connectOverCDP: async (endpoint) => {
      const { chromium } = await import("playwright-core");
      const handlesBefore = new Set(activeProcessHandles());
      const restoreTimerPatch = isLocalCdpEndpoint(endpoint)
        ? installPlaywrightFrameTimerUnref()
        : () => {};
      try {
        const browser = await chromium.connectOverCDP(endpoint);
        unrefNewLocalCdpHandles(
          endpoint,
          handlesBefore,
          activeProcessHandles(),
        );
        browser.once("disconnected", restoreTimerPatch);
        return browser;
      } catch (error) {
        restoreTimerPatch();
        throw error;
      }
    },
  });
}

export function unrefNewLocalCdpHandles(
  endpoint: string,
  handlesBefore: Set<any>,
  handlesAfter: any[],
) {
  if (!isLocalCdpEndpoint(endpoint)) return;
  for (const handle of handlesAfter) {
    if (
      !handlesBefore.has(handle) &&
      handle?.constructor?.name === "Socket" &&
      typeof handle.unref === "function"
    ) {
      handle.unref();
    }
  }
}

function isLocalCdpEndpoint(endpoint: string) {
  return (
    endpoint.startsWith("ws+unix://") || endpoint.startsWith("ws://127.0.0.1:")
  );
}

export function isPlaywrightFrameThrottlerTimer(
  delay: unknown,
  stack: string | undefined,
) {
  return (
    (delay === 35 || delay === 200) &&
    typeof stack === "string" &&
    stack.includes("FrameThrottler._tick") &&
    stack.includes("playwright-core")
  );
}

function installPlaywrightFrameTimerUnref() {
  playwrightTimerPatchUsers += 1;
  if (playwrightTimerPatchUsers === 1) {
    originalSetTimeout = globalThis.setTimeout;
    patchedSetTimeout = ((callback, delay, ...args) => {
      const stack = new Error().stack;
      const timer = originalSetTimeout!(callback, delay, ...args);
      if (isPlaywrightFrameThrottlerTimer(delay, stack)) timer.unref?.();
      return timer;
    }) as typeof globalThis.setTimeout;
    globalThis.setTimeout = patchedSetTimeout;
  }
  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    playwrightTimerPatchUsers -= 1;
    if (
      playwrightTimerPatchUsers === 0 &&
      originalSetTimeout &&
      globalThis.setTimeout === patchedSetTimeout
    ) {
      globalThis.setTimeout = originalSetTimeout;
      originalSetTimeout = undefined;
      patchedSetTimeout = undefined;
    }
  };
}

function activeProcessHandles() {
  const getActiveHandles = (process as any)._getActiveHandles;
  return typeof getActiveHandles === "function"
    ? getActiveHandles.call(process)
    : [];
}

export async function resolveNativeCdpEndpoint(
  runtime: EgoPlaywrightRuntime,
  space: Record<string, unknown>,
) {
  const taskSpaceId =
    typeof space.id === "string" || typeof space.id === "number"
      ? space.id
      : typeof space.taskId === "string" || typeof space.taskId === "number"
        ? space.taskId
        : undefined;
  if (typeof runtime?.getCDPEndpoint === "function") {
    const result = await runtime.getCDPEndpoint(taskSpaceId);
    const endpoint =
      typeof result === "string"
        ? result
        : result?.endpoint || result?.webSocketDebuggerUrl;
    if (!endpoint) {
      throw new Error(
        "ego.getCDPEndpoint() did not return a browser-level CDP endpoint",
      );
    }
    return endpoint;
  }
  if (typeof runtime?.sendCDPMessage === "function") {
    return createLocalCdpBridge(runtime);
  }
  throw new Error(
    "Playwright TaskSpace requires ego.getCDPEndpoint() or ego.sendCDPMessage()",
  );
}

export async function createLocalCdpBridge(
  runtime: EgoPlaywrightRuntime,
): Promise<PlaywrightEndpointLease> {
  if (typeof runtime.sendCDPMessage !== "function") {
    throw new Error("local CDP bridge requires ego.sendCDPMessage");
  }
  const taskSpaceTabs = await selectedTaskSpaceTabs(runtime);
  const taskSpaceTargetIds = taskSpaceTabs
    ? new Set(
        taskSpaceTabs
          .map((tab) => tab.targetId)
          .filter(
            (targetId): targetId is string => typeof targetId === "string",
          ),
      )
    : undefined;
  const { wsServer: WebSocketServer } =
    await import("playwright-core/lib/utilsBundle");
  const path = `/devtools/browser/ego-${randomUUID()}`;
  const socketPath =
    process.platform === "win32"
      ? undefined
      : join(tmpdir(), `ego-pw-${process.pid}-${randomUUID()}.sock`);
  const httpServer = socketPath ? createServer() : undefined;
  const server = httpServer
    ? new WebSocketServer({ server: httpServer })
    : new WebSocketServer({ host: "127.0.0.1", port: 0 });
  const sockets = new Set<any>();
  const unsubscribers = new Map<any, () => void>();
  let closed = false;

  server.on("connection", (socket, request) => {
    if (request.url !== path || sockets.size > 0) {
      socket.close(1008, "invalid local CDP bridge connection");
      return;
    }
    sockets.add(socket);
    const pendingIds = new Map<
      number,
      {
        clientId: unknown;
        method: unknown;
        params?: Record<string, unknown>;
        sessionId?: unknown;
      }
    >();
    const pendingTargetCreations = new Set<number>();
    const internalRequests = new Map<
      number,
      {
        resolve: (result: any) => void;
        reject: (error: Error) => void;
        timer: NodeJS.Timeout;
      }
    >();
    const allowedTargetIds = taskSpaceTargetIds
      ? new Set(taskSpaceTargetIds)
      : undefined;
    const allowedSessionIds = new Set<string>();
    const blockedSessionIds = new Set<string>();
    const deferredTargetMessages = new Map<string, string[]>();
    const deferredSessionTargets = new Map<string, string>();
    const manualRootSessions = new Map<string, string>();
    const manualTargetSessions = new Map<string, string>();
    const manuallyAttachingTargets = new Set<string>();
    const clientToNativeSession = new Map<string, string>();
    const nativeToClientSession = new Map<string, string>();
    const retiredNativeSessions = new Set<string>();
    const clientSessionTargets = new Map<string, string>();
    const clientTargetToNativeTarget = new Map<string, string>();
    const nativeTargetToClientTarget = new Map<string, string>();
    const retiredNativeTargets = new Set<string>();
    const clientFrameToNativeFrame = new Map<string, string>();
    const nativeFrameToClientFrame = new Map<string, string>();
    const replayableSessionCommands = new Map<
      string,
      Map<string, { method: string; params: Record<string, unknown> }>
    >();
    const refreshingSessions = new Map<string, Promise<void>>();
    const synthesizedNavigations = new Set<string>();
    let replacingRootAutoAttach = false;

    const sendNativeCommand = (
      method: string,
      params: Record<string, unknown>,
      sessionId?: string,
    ) => {
      const id = nextBridgeMessageId++;
      return new Promise<any>((resolve, reject) => {
        const timer = setTimeout(() => {
          internalRequests.delete(id);
          reject(new Error(`native CDP command timed out: ${method}`));
        }, 10_000);
        internalRequests.set(id, { resolve, reject, timer });
        let result;
        try {
          result = runtime.sendCDPMessage!(
            JSON.stringify({
              id,
              method,
              params,
              ...(sessionId ? { sessionId } : {}),
            }),
          );
        } catch (error) {
          clearTimeout(timer);
          internalRequests.delete(id);
          reject(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        Promise.resolve(result).catch((error) => {
          clearTimeout(timer);
          internalRequests.delete(id);
          reject(error instanceof Error ? error : new Error(String(error)));
        });
      });
    };

    const sendNativeFireAndForget = (
      method: string,
      params: Record<string, unknown>,
      sessionId?: string,
    ) => {
      const id = nextBridgeMessageId++;
      try {
        void Promise.resolve(
          runtime.sendCDPMessage!(
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
    };

    const attachTaskSpaceTarget = async (tab: EgoTab) => {
      if (typeof tab.targetId !== "string") return;
      manuallyAttachingTargets.add(tab.targetId);
      try {
        const targetInfoResult = await sendNativeCommand(
          "Target.getTargetInfo",
          { targetId: tab.targetId },
        );
        const nativeTargetInfo = targetInfoResult?.targetInfo || {};
        const result = await sendNativeCommand("Target.attachToTarget", {
          targetId: tab.targetId,
          flatten: true,
        });
        const sessionId = result?.sessionId;
        if (typeof sessionId !== "string") {
          throw new Error(
            `Target.attachToTarget did not return a session for ${tab.targetId}`,
          );
        }
        manualRootSessions.set(sessionId, tab.targetId);
        manualTargetSessions.set(tab.targetId, sessionId);
        clientToNativeSession.set(sessionId, sessionId);
        nativeToClientSession.set(sessionId, sessionId);
        clientSessionTargets.set(sessionId, tab.targetId);
        clientTargetToNativeTarget.set(tab.targetId, tab.targetId);
        nativeTargetToClientTarget.set(tab.targetId, tab.targetId);
        blockedSessionIds.delete(sessionId);
        allowedSessionIds.add(sessionId);
        sendSocketJson(socket, {
          method: "Target.attachedToTarget",
          params: {
            sessionId,
            targetInfo: {
              ...nativeTargetInfo,
              targetId: tab.targetId,
              type: nativeTargetInfo.type || tab.type || "page",
              title: nativeTargetInfo.title || tab.title || "",
              url: nativeTargetInfo.url || tab.url || "",
              attached: true,
              canAccessOpener: nativeTargetInfo.canAccessOpener ?? false,
            },
            waitingForDebugger: false,
          },
        });
      } finally {
        manuallyAttachingTargets.delete(tab.targetId);
      }
    };

    const replaceRootAutoAttach = async (requestMessage) => {
      const clientId = requestMessage.id;
      try {
        replacingRootAutoAttach = true;
        await sendNativeCommand("Target.setAutoAttach", {
          autoAttach: false,
          waitForDebuggerOnStart: false,
          flatten: true,
        });
        if (requestMessage.params?.autoAttach) {
          for (const tab of taskSpaceTabs || []) {
            await attachTaskSpaceTarget(tab);
          }
        } else {
          for (const clientSessionId of manualRootSessions.keys()) {
            const nativeSessionId =
              clientToNativeSession.get(clientSessionId) || clientSessionId;
            await sendNativeCommand("Target.detachFromTarget", {
              sessionId: nativeSessionId,
            });
          }
          manualRootSessions.clear();
          manualTargetSessions.clear();
          clientToNativeSession.clear();
          nativeToClientSession.clear();
          clientSessionTargets.clear();
          clientTargetToNativeTarget.clear();
          nativeTargetToClientTarget.clear();
          clientFrameToNativeFrame.clear();
          nativeFrameToClientFrame.clear();
        }
        sendSocketJson(socket, { id: clientId, result: {} });
      } catch (error) {
        sendSocketJson(socket, {
          id: clientId,
          error: {
            code: -32_000,
            message: (error as Error)?.message || String(error),
          },
        });
      } finally {
        replacingRootAutoAttach = false;
      }
    };

    const refreshTaskSpaceSession = (
      clientSessionId: string,
      expectedUrl?: string,
    ) => {
      const existing = refreshingSessions.get(clientSessionId);
      if (existing) return existing;
      const refresh = (async () => {
        const targetId = manualRootSessions.get(clientSessionId);
        if (!targetId) return;

        if (typeof runtime.listTabs === "function" && expectedUrl) {
          const deadline = Date.now() + 400;
          while (Date.now() < deadline) {
            const listed = await runtime.listTabs();
            const tabs = listed?.tabs || listed?.targetInfos || [];
            const tab = tabs.find(
              (candidate) => candidate.targetId === targetId,
            );
            if (tab?.url === expectedUrl) break;
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 100));

        manuallyAttachingTargets.add(targetId);
        try {
          const previousNativeSessionId =
            clientToNativeSession.get(clientSessionId) || clientSessionId;
          nativeToClientSession.delete(previousNativeSessionId);
          retiredNativeSessions.add(previousNativeSessionId);
          await sendNativeCommand("Target.detachFromTarget", {
            sessionId: previousNativeSessionId,
          }).catch(() => undefined);

          const result = await sendNativeCommand("Target.attachToTarget", {
            targetId,
            flatten: true,
          });
          const nativeSessionId = result?.sessionId;
          if (typeof nativeSessionId !== "string") {
            throw new Error(
              `Target.attachToTarget did not return a replacement session for ${targetId}`,
            );
          }

          clientToNativeSession.set(clientSessionId, nativeSessionId);
          nativeToClientSession.set(nativeSessionId, clientSessionId);
          blockedSessionIds.delete(nativeSessionId);

          void sendNativeCommand(
            "Runtime.runIfWaitingForDebugger",
            {},
            nativeSessionId,
          ).catch(() => undefined);
          await new Promise((resolve) => setTimeout(resolve, 20));

          for (const command of (
            replayableSessionCommands.get(clientSessionId) || new Map()
          ).values()) {
            if (command.method === "Runtime.runIfWaitingForDebugger") continue;
            await sendNativeCommand(
              command.method,
              command.params,
              nativeSessionId,
            ).catch(() => undefined);
          }

          const frameTree = await sendNativeCommand(
            "Page.getFrameTree",
            {},
            nativeSessionId,
          ).catch(() => undefined);
          const frame = frameTree?.frameTree?.frame;
          const readyState = await sendNativeCommand(
            "Runtime.evaluate",
            {
              expression: "document.readyState",
              returnByValue: true,
            },
            nativeSessionId,
          ).catch(() => undefined);
          const readyStateValue = readyState?.result?.value;
          if (typeof frame?.id === "string") {
            const lifecycle = (name: string) =>
              sendSocketJson(socket, {
                method: "Page.lifecycleEvent",
                params: {
                  frameId: frame.id,
                  loaderId: frame.loaderId || "",
                  name,
                  timestamp: Date.now() / 1_000,
                },
                sessionId: clientSessionId,
              });
            if (
              readyStateValue === "interactive" ||
              readyStateValue === "complete"
            ) {
              lifecycle("DOMContentLoaded");
            }
            if (readyStateValue === "complete") lifecycle("load");
          }
        } finally {
          manuallyAttachingTargets.delete(targetId);
        }
      })().finally(() => refreshingSessions.delete(clientSessionId));
      refreshingSessions.set(clientSessionId, refresh);
      return refresh;
    };

    const createTaskSpaceTarget = async (requestMessage) => {
      const clientId = requestMessage.id;
      try {
        if (typeof runtime.createTab !== "function") {
          throw new Error("local Playwright bridge requires ego.createTab");
        }
        const url =
          typeof requestMessage.params?.url === "string"
            ? requestMessage.params.url
            : "about:blank";
        const created: any = await runtime.createTab(url);
        if (created?.error) throw new Error(String(created.error));
        const targetId = created?.targetId || created?.result?.targetId;
        if (typeof targetId !== "string") {
          throw new Error("ego.createTab did not return a targetId");
        }
        allowedTargetIds?.add(targetId);
        await attachTaskSpaceTarget({ targetId, url, type: "page" });
        sendSocketJson(socket, { id: clientId, result: { targetId } });
      } catch (error) {
        sendSocketJson(socket, {
          id: clientId,
          error: {
            code: -32_000,
            message: (error as Error)?.message || String(error),
          },
        });
      }
    };

    const closeTaskSpaceTarget = (requestMessage) => {
      const clientTargetId = requestMessage.params?.targetId;
      if (typeof clientTargetId !== "string") return false;
      const nativeTargetId = clientTargetToNativeTarget.get(clientTargetId);
      if (!nativeTargetId) return false;
      const clientSessionId = manualTargetSessions.get(nativeTargetId);
      if (!clientSessionId) return false;
      const nativeSessionId =
        clientToNativeSession.get(clientSessionId) || clientSessionId;

      retiredNativeTargets.add(nativeTargetId);
      retiredNativeSessions.add(nativeSessionId);
      nativeTargetToClientTarget.delete(nativeTargetId);
      nativeToClientSession.delete(nativeSessionId);
      clientTargetToNativeTarget.delete(clientTargetId);
      clientToNativeSession.delete(clientSessionId);
      clientSessionTargets.delete(clientSessionId);
      manualTargetSessions.delete(nativeTargetId);
      manualRootSessions.delete(clientSessionId);
      allowedTargetIds?.delete(clientTargetId);
      allowedSessionIds.delete(clientSessionId);

      sendNativeFireAndForget("Target.closeTarget", {
        targetId: nativeTargetId,
      });
      sendSocketJson(socket, {
        id: requestMessage.id,
        result: { success: true },
      });
      sendSocketJson(socket, {
        method: "Target.detachedFromTarget",
        params: {
          sessionId: clientSessionId,
          targetId: clientTargetId,
        },
      });
      return true;
    };

    const replaceTaskSpaceTargetForNavigation = async (requestMessage) => {
      const clientId = requestMessage.id;
      const clientSessionId = requestMessage.sessionId;
      const clientFrameId = requestMessage.params?.frameId;
      const url = requestMessage.params?.url;
      let responded = false;
      if (
        typeof clientSessionId !== "string" ||
        typeof clientFrameId !== "string" ||
        typeof url !== "string" ||
        typeof runtime.createTab !== "function"
      ) {
        return false;
      }
      const previousNativeTargetId = manualRootSessions.get(clientSessionId);
      const clientTargetId = clientSessionTargets.get(clientSessionId);
      if (!previousNativeTargetId || !clientTargetId) return false;
      const previousNativeSessionId =
        clientToNativeSession.get(clientSessionId) || clientSessionId;
      nativeToClientSession.delete(previousNativeSessionId);
      retiredNativeSessions.add(previousNativeSessionId);

      sendSocketJson(socket, {
        method: "Runtime.executionContextsCleared",
        params: {},
        sessionId: clientSessionId,
      });

      let replacementTargetId: string | undefined;
      try {
        const created: any = await runtime.createTab(url);
        if (created?.error) throw new Error(String(created.error));
        replacementTargetId = created?.targetId || created?.result?.targetId;
        if (typeof replacementTargetId !== "string") {
          throw new Error(
            "ego.createTab did not return a replacement targetId",
          );
        }

        manuallyAttachingTargets.add(replacementTargetId);
        const attached = await sendNativeCommand("Target.attachToTarget", {
          targetId: replacementTargetId,
          flatten: true,
        });
        const replacementSessionId = attached?.sessionId;
        if (typeof replacementSessionId !== "string") {
          throw new Error(
            `Target.attachToTarget did not return a session for ${replacementTargetId}`,
          );
        }

        clientToNativeSession.set(clientSessionId, replacementSessionId);
        nativeToClientSession.set(replacementSessionId, clientSessionId);
        blockedSessionIds.delete(replacementSessionId);

        retiredNativeTargets.add(previousNativeTargetId);
        nativeTargetToClientTarget.delete(previousNativeTargetId);
        clientTargetToNativeTarget.set(clientTargetId, replacementTargetId);
        nativeTargetToClientTarget.set(replacementTargetId, clientTargetId);
        manualRootSessions.set(clientSessionId, replacementTargetId);
        manualTargetSessions.delete(previousNativeTargetId);
        manualTargetSessions.set(replacementTargetId, clientSessionId);

        const frameTree = await sendNativeCommand(
          "Page.getFrameTree",
          {},
          replacementSessionId,
        );
        const frame = frameTree?.frameTree?.frame;
        const replacementFrameId =
          typeof frame?.id === "string" ? frame.id : replacementTargetId;
        clientFrameToNativeFrame.set(clientFrameId, replacementFrameId);
        nativeFrameToClientFrame.set(replacementFrameId, clientFrameId);
        sendNativeFireAndForget("Target.closeTarget", {
          targetId: previousNativeTargetId,
        });

        sendSocketJson(socket, {
          id: clientId,
          result: {
            frameId: clientFrameId,
            ...(typeof frame?.loaderId === "string"
              ? { loaderId: frame.loaderId }
              : {}),
          },
          sessionId: clientSessionId,
        });
        sendSocketJson(socket, {
          method: "Page.frameNavigated",
          params: {
            frame: {
              ...(frame || {}),
              id: clientFrameId,
              name: frame?.name || "",
              url,
            },
          },
          sessionId: clientSessionId,
        });
        responded = true;

        sendNativeFireAndForget(
          "Runtime.runIfWaitingForDebugger",
          {},
          replacementSessionId,
        );
        for (const command of (
          replayableSessionCommands.get(clientSessionId) || new Map()
        ).values()) {
          if (command.method === "Runtime.runIfWaitingForDebugger") continue;
          if (
            command.method === "Page.createIsolatedWorld" &&
            typeof command.params.frameId === "string" &&
            !clientFrameToNativeFrame.has(command.params.frameId)
          ) {
            continue;
          }
          await sendNativeCommand(
            command.method,
            rewriteOutgoingProtocolParams(
              command.params,
              clientFrameToNativeFrame,
              clientTargetToNativeTarget,
            ),
            replacementSessionId,
          ).catch(() => undefined);
        }

        const readyState = await sendNativeCommand(
          "Runtime.evaluate",
          {
            expression: "document.readyState",
            returnByValue: true,
          },
          replacementSessionId,
        ).catch(() => undefined);
        const readyStateValue = readyState?.result?.value;
        const lifecycle = (name: string) =>
          sendSocketJson(socket, {
            method: "Page.lifecycleEvent",
            params: {
              frameId: clientFrameId,
              loaderId: frame?.loaderId || "",
              name,
              timestamp: Date.now() / 1_000,
            },
            sessionId: clientSessionId,
          });
        if (
          readyStateValue === "interactive" ||
          readyStateValue === "complete"
        ) {
          lifecycle("DOMContentLoaded");
        }
        if (readyStateValue === "complete") lifecycle("load");
      } catch (error) {
        if (!responded) {
          sendSocketJson(socket, {
            id: clientId,
            error: {
              code: -32_000,
              message: (error as Error)?.message || String(error),
            },
            sessionId: clientSessionId,
          });
        }
      } finally {
        if (replacementTargetId) {
          manuallyAttachingTargets.delete(replacementTargetId);
        }
      }
      return true;
    };

    const deferTargetMessage = (targetId: string, payload: string) => {
      const messages = deferredTargetMessages.get(targetId) || [];
      messages.push(payload);
      deferredTargetMessages.set(targetId, messages);
    };
    const flushDeferredTarget = (targetId: string) => {
      const messages = deferredTargetMessages.get(targetId) || [];
      deferredTargetMessages.delete(targetId);
      for (const payload of messages) {
        const message = JSON.parse(payload);
        const sessionId = attachedSessionId(message);
        if (sessionId) {
          deferredSessionTargets.delete(sessionId);
          allowedSessionIds.add(sessionId);
        }
        sendSocketPayload(socket, payload);
      }
    };
    const discardDeferredTargets = () => {
      for (const sessionId of deferredSessionTargets.keys()) {
        blockedSessionIds.add(sessionId);
      }
      deferredSessionTargets.clear();
      deferredTargetMessages.clear();
    };

    const forwardEvent = (message, payload: string) => {
      if (message.method === "Page.frameNavigated") {
        const key = navigationKey(
          message.sessionId,
          message.params?.frame?.id,
          message.params?.frame?.loaderId,
        );
        if (key && synthesizedNavigations.delete(key)) return;
      }
      if (!allowedTargetIds) {
        sendSocketPayload(socket, payload);
        return;
      }

      const parentSessionId = message.sessionId;
      if (typeof parentSessionId === "string") {
        if (allowedSessionIds.has(parentSessionId)) {
          const childSessionId = attachedSessionId(message);
          if (childSessionId) allowedSessionIds.add(childSessionId);
          sendSocketPayload(socket, payload);
          return;
        }
        const deferredTargetId = deferredSessionTargets.get(parentSessionId);
        if (deferredTargetId) {
          deferTargetMessage(deferredTargetId, payload);
        }
        return;
      }

      if (message.method === "Target.attachedToTarget") {
        const targetId = message.params?.targetInfo?.targetId;
        const sessionId = attachedSessionId(message);
        if (typeof targetId !== "string" || typeof sessionId !== "string") {
          return;
        }
        if (replacingRootAutoAttach || manuallyAttachingTargets.has(targetId)) {
          blockedSessionIds.add(sessionId);
          return;
        }
        if (allowedTargetIds.has(targetId)) {
          allowedSessionIds.add(sessionId);
          sendSocketPayload(socket, payload);
        } else if (pendingTargetCreations.size > 0) {
          deferredSessionTargets.set(sessionId, targetId);
          deferTargetMessage(targetId, payload);
        } else {
          blockedSessionIds.add(sessionId);
        }
        return;
      }

      if (message.method === "Target.detachedFromTarget") {
        const sessionId = message.params?.sessionId;
        if (typeof sessionId !== "string") return;
        if (allowedSessionIds.delete(sessionId)) {
          const targetId = manualRootSessions.get(sessionId);
          if (targetId) manualTargetSessions.delete(targetId);
          manualRootSessions.delete(sessionId);
          sendSocketPayload(socket, payload);
        } else {
          blockedSessionIds.delete(sessionId);
        }
        return;
      }

      const targetId = targetIdFromEvent(message);
      if (targetId) {
        if (allowedTargetIds.has(targetId)) {
          sendSocketPayload(socket, payload);
          if (message.method === "Target.targetDestroyed") {
            allowedTargetIds.delete(targetId);
          }
        } else if (pendingTargetCreations.size > 0) {
          deferTargetMessage(targetId, payload);
        }
        return;
      }

      sendSocketPayload(socket, payload);
    };

    const completePendingNavigation = (message) => {
      let frameId;
      let loaderId;
      if (message.method === "Page.frameStartedNavigating") {
        frameId = message.params?.frameId;
        loaderId = message.params?.loaderId;
      } else if (message.method === "Page.navigatedWithinDocument") {
        frameId = message.params?.frameId;
      } else {
        return false;
      }
      if (typeof frameId !== "string") return false;

      for (const [nativeId, pending] of pendingIds) {
        if (
          pending.method !== "Page.navigate" ||
          pending.sessionId !== message.sessionId ||
          pending.params?.frameId !== frameId
        ) {
          continue;
        }
        pendingIds.delete(nativeId);
        if (
          message.method === "Page.frameStartedNavigating" &&
          typeof pending.sessionId === "string"
        ) {
          sendSocketJson(socket, {
            method: "Runtime.executionContextsCleared",
            params: {},
            sessionId: pending.sessionId,
          });
        }
        sendSocketJson(socket, {
          id: pending.clientId,
          result: {
            frameId,
            ...(typeof loaderId === "string" ? { loaderId } : {}),
          },
          ...(typeof pending.sessionId === "string"
            ? { sessionId: pending.sessionId }
            : {}),
        });
        if (
          message.method === "Page.frameStartedNavigating" &&
          typeof loaderId === "string" &&
          typeof message.params?.url === "string" &&
          typeof pending.sessionId === "string"
        ) {
          synthesizedNavigations.add(
            navigationKey(pending.sessionId, frameId, loaderId)!,
          );
          sendSocketJson(socket, {
            method: "Page.frameNavigated",
            params: {
              frame: {
                id: frameId,
                loaderId,
                name: "",
                url: message.params.url,
              },
            },
            sessionId: pending.sessionId,
          });
        }
        return true;
      }
      return false;
    };

    const unsubscribe = subscribeEgoCdpTransport(runtime, {
      message(payload) {
        let message;
        try {
          message = JSON.parse(payload);
        } catch {
          return;
        }
        if (Object.hasOwn(message, "id")) {
          const internal = internalRequests.get(message.id);
          if (internal) {
            internalRequests.delete(message.id);
            clearTimeout(internal.timer);
            if (message.error) {
              internal.reject(
                new Error(message.error.message || "native CDP error"),
              );
            } else {
              internal.resolve(message.result);
            }
            return;
          }
          if (!pendingIds.has(message.id)) return;
          const pending = pendingIds.get(message.id)!;
          pendingIds.delete(message.id);
          if (pending.method === "Target.createTarget") {
            pendingTargetCreations.delete(message.id);
          }
          message.id = pending.clientId;
          if (typeof pending.sessionId === "string") {
            message.sessionId = pending.sessionId;
          }
          sendSocketJson(socket, message);
          if (pending.method === "Target.createTarget") {
            const targetId = message.result?.targetId;
            if (allowedTargetIds && typeof targetId === "string") {
              allowedTargetIds.add(targetId);
              flushDeferredTarget(targetId);
            }
            if (pendingTargetCreations.size === 0) discardDeferredTargets();
          }
          return;
        }
        const rawTargetId = targetIdFromEvent(message);
        if (rawTargetId && retiredNativeTargets.has(rawTargetId)) {
          if (message.method === "Target.targetDestroyed") {
            retiredNativeTargets.delete(rawTargetId);
          }
          return;
        }
        const nativeSessionId = message.sessionId;
        if (
          typeof nativeSessionId === "string" &&
          retiredNativeSessions.has(nativeSessionId)
        ) {
          return;
        }
        if (typeof nativeSessionId === "string") {
          const clientSessionId = nativeToClientSession.get(nativeSessionId);
          if (clientSessionId) message.sessionId = clientSessionId;
        }
        if (message.method === "Target.detachedFromTarget") {
          const detachedNativeSessionId = message.params?.sessionId;
          if (
            typeof detachedNativeSessionId === "string" &&
            retiredNativeSessions.has(detachedNativeSessionId)
          ) {
            retiredNativeSessions.delete(detachedNativeSessionId);
            return;
          }
          const detachedClientSessionId =
            typeof detachedNativeSessionId === "string"
              ? nativeToClientSession.get(detachedNativeSessionId)
              : undefined;
          if (detachedClientSessionId) {
            message.params.sessionId = detachedClientSessionId;
          }
        }
        rewriteIncomingProtocolMessage(
          message,
          nativeFrameToClientFrame,
          nativeTargetToClientTarget,
        );
        const completedPendingNavigation = completePendingNavigation(message);
        forwardEvent(message, JSON.stringify(message));
        if (
          completedPendingNavigation &&
          message.method === "Page.frameStartedNavigating" &&
          typeof message.sessionId === "string"
        ) {
          void refreshTaskSpaceSession(
            message.sessionId,
            typeof message.params?.url === "string"
              ? message.params.url
              : undefined,
          );
        }
      },
      error(message, errorCode) {
        const nativeError = new Error(
          [errorCode, message].filter(Boolean).join(": ") ||
            "native CDP send failed",
        );
        for (const pending of internalRequests.values()) {
          clearTimeout(pending.timer);
          pending.reject(nativeError);
        }
        internalRequests.clear();
        const reason = [errorCode, message]
          .filter(Boolean)
          .join(": ")
          .slice(0, 120);
        socket.close(1011, reason || "native CDP send failed");
      },
    });
    unsubscribers.set(socket, unsubscribe);

    socket.on("message", (payload) => {
      let requestMessage;
      try {
        requestMessage = JSON.parse(payload.toString());
      } catch {
        socket.close(1003, "invalid CDP JSON");
        return;
      }
      if (!Object.hasOwn(requestMessage, "id")) {
        socket.close(1003, "CDP request id is required");
        return;
      }
      const clientId = requestMessage.id;
      if (
        requestMessage.method === "Target.setAutoAttach" &&
        requestMessage.sessionId === undefined
      ) {
        void replaceRootAutoAttach(requestMessage);
        return;
      }
      if (
        requestMessage.method === "Target.createTarget" &&
        requestMessage.sessionId === undefined
      ) {
        void createTaskSpaceTarget(requestMessage);
        return;
      }
      if (
        requestMessage.method === "Target.closeTarget" &&
        requestMessage.sessionId === undefined &&
        closeTaskSpaceTarget(requestMessage)
      ) {
        return;
      }
      if (
        requestMessage.method === "Page.navigate" &&
        typeof requestMessage.sessionId === "string" &&
        manualRootSessions.has(requestMessage.sessionId) &&
        typeof runtime.createTab === "function"
      ) {
        void replaceTaskSpaceTargetForNavigation(requestMessage);
        return;
      }
      const compatibilityResult = localCompatibilityResult(
        requestMessage.method,
      );
      if (compatibilityResult !== undefined) {
        sendSocketJson(socket, { id: clientId, result: compatibilityResult });
        return;
      }
      const clientSessionId =
        typeof requestMessage.sessionId === "string"
          ? requestMessage.sessionId
          : undefined;
      if (
        clientSessionId &&
        manualRootSessions.has(clientSessionId) &&
        isReplayableSessionCommand(requestMessage.method)
      ) {
        const commands =
          replayableSessionCommands.get(clientSessionId) || new Map();
        const params = requestMessage.params || {};
        commands.set(`${requestMessage.method}:${JSON.stringify(params)}`, {
          method: requestMessage.method,
          params,
        });
        replayableSessionCommands.set(clientSessionId, commands);
      }
      const nativeId = nextBridgeMessageId++;
      pendingIds.set(nativeId, {
        clientId,
        method: requestMessage.method,
        params: requestMessage.params,
        sessionId: clientSessionId,
      });
      if (requestMessage.method === "Target.createTarget") {
        pendingTargetCreations.add(nativeId);
      }
      if (clientSessionId) {
        requestMessage.sessionId =
          clientToNativeSession.get(clientSessionId) || clientSessionId;
      }
      requestMessage.params = rewriteOutgoingProtocolParams(
        requestMessage.params || {},
        clientFrameToNativeFrame,
        clientTargetToNativeTarget,
      );
      if (
        requestMessage.method === "Target.detachFromTarget" &&
        typeof requestMessage.params?.sessionId === "string"
      ) {
        requestMessage.params = {
          ...requestMessage.params,
          sessionId:
            clientToNativeSession.get(requestMessage.params.sessionId) ||
            requestMessage.params.sessionId,
        };
      }
      requestMessage.id = nativeId;
      let result;
      try {
        result = runtime.sendCDPMessage(JSON.stringify(requestMessage));
      } catch (error) {
        rejectBridgeRequest(socket, pendingIds, nativeId, clientId, error);
        return;
      }
      Promise.resolve(result).catch((error) => {
        rejectBridgeRequest(socket, pendingIds, nativeId, clientId, error);
      });
    });

    socket.once("close", () => {
      unsubscribe();
      unsubscribers.delete(socket);
      sockets.delete(socket);
      pendingIds.clear();
      pendingTargetCreations.clear();
      for (const pending of internalRequests.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error("local CDP bridge closed"));
      }
      internalRequests.clear();
      deferredTargetMessages.clear();
      deferredSessionTargets.clear();
      synthesizedNavigations.clear();
      clientToNativeSession.clear();
      nativeToClientSession.clear();
      retiredNativeSessions.clear();
      clientSessionTargets.clear();
      clientTargetToNativeTarget.clear();
      nativeTargetToClientTarget.clear();
      retiredNativeTargets.clear();
      clientFrameToNativeFrame.clear();
      nativeFrameToClientFrame.clear();
      replayableSessionCommands.clear();
      refreshingSessions.clear();
    });
  });

  if (httpServer) {
    httpServer.listen(socketPath);
    await once(httpServer, "listening");
    httpServer.unref();
  } else {
    await once(server, "listening");
    (server as any)._server?.unref?.();
  }

  const address = server.address();
  const endpoint = socketPath
    ? `ws+unix://${socketPath}:${path}`
    : address && typeof address !== "string"
      ? `ws://127.0.0.1:${address.port}${path}`
      : undefined;
  if (!endpoint) {
    await closeWebSocketServer(server);
    throw new Error("local CDP bridge did not bind a transport");
  }

  return {
    endpoint,
    close: async () => {
      if (closed) return;
      closed = true;
      for (const unsubscribe of unsubscribers.values()) unsubscribe();
      unsubscribers.clear();
      for (const socket of sockets) socket.terminate();
      sockets.clear();
      await closeWebSocketServer(server);
      if (httpServer) await closeHttpServer(httpServer);
      if (socketPath) await rm(socketPath, { force: true });
    },
  };
}

async function selectedTaskSpaceTabs(runtime: EgoPlaywrightRuntime) {
  if (typeof runtime.listTabs !== "function") return undefined;
  const listed = await runtime.listTabs();
  return listed?.tabs || listed?.targetInfos || [];
}

function attachedSessionId(message) {
  return message.method === "Target.attachedToTarget" &&
    typeof message.params?.sessionId === "string"
    ? message.params.sessionId
    : undefined;
}

function targetIdFromEvent(message) {
  if (
    message.method === "Target.targetCreated" ||
    message.method === "Target.targetInfoChanged"
  ) {
    return typeof message.params?.targetInfo?.targetId === "string"
      ? message.params.targetInfo.targetId
      : undefined;
  }
  if (message.method === "Target.targetDestroyed") {
    return typeof message.params?.targetId === "string"
      ? message.params.targetId
      : undefined;
  }
  return undefined;
}

function rewriteOutgoingProtocolParams(
  params: Record<string, unknown>,
  frameIds: Map<string, string>,
  targetIds: Map<string, string>,
) {
  let rewritten = params;
  const replace = (name: string, values: Map<string, string>) => {
    const value = rewritten[name];
    if (typeof value !== "string") return;
    const replacement = values.get(value);
    if (!replacement || replacement === value) return;
    if (rewritten === params) rewritten = { ...params };
    rewritten[name] = replacement;
  };
  replace("frameId", frameIds);
  replace("targetId", targetIds);
  return rewritten;
}

function rewriteIncomingProtocolMessage(
  message,
  frameIds: Map<string, string>,
  targetIds: Map<string, string>,
) {
  const params = message.params;
  if (!params || typeof params !== "object") return;
  const replace = (object, name: string, values: Map<string, string>) => {
    const value = object?.[name];
    if (typeof value !== "string") return;
    const replacement = values.get(value);
    if (replacement) object[name] = replacement;
  };
  replace(params, "frameId", frameIds);
  replace(params, "parentFrameId", frameIds);
  replace(params, "targetId", targetIds);
  replace(params.frame, "id", frameIds);
  replace(params.frame, "parentId", frameIds);
  replace(params.context?.auxData, "frameId", frameIds);
  replace(params.targetInfo, "targetId", targetIds);
  replace(params.targetInfo, "parentId", targetIds);
  replace(params.targetInfo, "parentFrameId", frameIds);
}

function navigationKey(sessionId, frameId, loaderId) {
  return typeof sessionId === "string" &&
    typeof frameId === "string" &&
    typeof loaderId === "string"
    ? `${sessionId}:${frameId}:${loaderId}`
    : undefined;
}

function isReplayableSessionCommand(method: unknown) {
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

function localCompatibilityResult(method: unknown) {
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
  if (method === "Browser.setDownloadBehavior") return {};
  return undefined;
}

function rejectBridgeRequest(
  socket,
  pendingIds: Map<number, unknown>,
  nativeId: number,
  clientId: unknown,
  error: unknown,
) {
  if (!pendingIds.delete(nativeId)) return;
  sendSocketJson(socket, {
    id: clientId,
    error: {
      code: -32_000,
      message: (error as any)?.message || String(error),
    },
  });
}

function sendSocketJson(socket, value: unknown) {
  sendSocketPayload(socket, JSON.stringify(value));
}

function sendSocketPayload(socket, payload: string) {
  if (socket.readyState !== 1) return;
  socket.send(payload);
}

async function closeWebSocketServer(server) {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}

async function closeHttpServer(server) {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}

async function locatePlaywrightPage(
  browser: Browser,
  activeTab?: EgoTab,
  nativeTabs: EgoTab[] = [],
) {
  const deadline = Date.now() + 2_000;

  while (true) {
    const contexts = browser.contexts();
    for (const context of contexts) {
      const pages = context.pages();
      if (activeTab?.url) {
        const matches = pages.filter(
          (page) =>
            typeof page.url === "function" && page.url() === activeTab.url,
        );
        if (matches.length > 0) {
          const activeIndex = nativeTabs.indexOf(activeTab);
          const occurrence = nativeTabs
            .slice(0, activeIndex + 1)
            .filter((tab) => tab.url === activeTab.url).length;
          return { page: matches[occurrence - 1] || matches.at(-1), context };
        }
      }
      if (pages.length === 1) return { page: pages[0], context };
      const activeIndex = nativeTabs.indexOf(activeTab);
      if (!activeTab?.url && activeIndex >= 0 && pages[activeIndex]) {
        return { page: pages[activeIndex], context };
      }
      if (!activeTab && pages.length > 0) {
        return { page: pages.at(-1), context };
      }
    }

    if (Date.now() >= deadline) {
      const activeIndex = nativeTabs.indexOf(activeTab);
      if (activeIndex >= 0) {
        for (const context of contexts) {
          const page = context.pages()[activeIndex];
          if (page) return { page, context };
        }
      }
      const context = contexts[0];
      if (!context) {
        throw new Error("Playwright CDP connection returned no BrowserContext");
      }
      if (typeof context.newPage !== "function") {
        throw new Error("Playwright BrowserContext cannot create a Page");
      }
      return { page: await context.newPage(), context };
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

export async function connectPlaywrightTaskSpace(
  space: Record<string, unknown>,
) {
  const previous = activeSession;
  const session = await connector(space);
  if (session.page === undefined || session.context === undefined) {
    await session.close();
    throw new Error(
      "Playwright TaskSpace connector did not return Page and BrowserContext",
    );
  }
  activeSession = session;
  if (previous && previous.close !== session.close) {
    await previous.close();
  }
  return session;
}

export async function disconnectPlaywrightTaskSpace() {
  const session = activeSession;
  activeSession = undefined;
  await session?.close();
}

export function setPlaywrightTaskSpaceConnector(
  next: PlaywrightTaskSpaceConnector,
) {
  const previous = connector;
  connector = next;
  return () => {
    connector = previous;
  };
}
