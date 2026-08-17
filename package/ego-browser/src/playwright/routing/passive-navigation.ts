import type { NativeCommandChannel } from "./native-commands.js";
import { type PendingWork, trackOperation } from "./pending-work.js";
import type { PageRoute } from "./types.js";

export type PassiveNavigationContext = {
  readonly native: NativeCommandChannel;
  readonly work: PendingWork;
  isClosed: () => boolean;
  emit: (message: any) => void;
  endOperation: () => void;
};

/**
 * Tracks the lifecycle of a navigation the client did not ask for — a
 * link click, a redirect, a history move. Native reports the commit, but the
 * follow-up lifecycle events are not guaranteed to arrive, so what does arrive
 * is recorded here and {@link completePassiveNavigation} fills in the rest.
 */
export function observeRouteEvent(
  context: PassiveNavigationContext,
  message: any,
  route: PageRoute,
) {
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
      completePassiveNavigation(context, route, frame, key);
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

/**
 * Backfills the lifecycle events Playwright waits for, by polling
 * document.readyState until the document is complete. Every emission is guarded
 * by the navigation key and the route's generation: a newer navigation, a
 * rebind, or a close makes this one irrelevant and it stops without emitting.
 */
export function completePassiveNavigation(
  context: PassiveNavigationContext,
  route: PageRoute,
  frame: any,
  key: string,
) {
  trackOperation(context, "passive navigation", async () => {
    const deadline = Date.now() + 8_000;
    do {
      if (
        context.isClosed() ||
        route.state !== "attached" ||
        route.generation !== route.passiveNavigation?.generation ||
        route.passiveNavigation.key !== key
      ) {
        return;
      }
      const readyState = await context.native
        .command(
          "Runtime.evaluate",
          {
            expression: "document.readyState",
            returnByValue: true,
          },
          route.nativeSessionId,
          1_000,
        )
        .catch(() => undefined);
      const readyStateValue = readyState?.result?.value;
      const navigation = route.passiveNavigation;
      if (!navigation || navigation.key !== key) return;
      const frameId = route.clientMainFrameId || frame.id;
      const lifecycle = (name: string) => {
        if (navigation.lifecycleNames.has(name)) return;
        navigation.lifecycleNames.add(name);
        context.emit({
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
      if (readyStateValue === "interactive" || readyStateValue === "complete") {
        lifecycle("DOMContentLoaded");
      }
      if (readyStateValue === "complete") {
        lifecycle("load");
        if (!navigation.frameStopped) {
          navigation.frameStopped = true;
          context.emit({
            method: "Page.frameStoppedLoading",
            params: { frameId },
            sessionId: route.clientSessionId,
          });
        }
        if (navigation.requestId && !navigation.requestFinished) {
          navigation.requestFinished = true;
          context.emit({
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
  });
}
