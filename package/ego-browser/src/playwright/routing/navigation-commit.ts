import { rewriteIncomingProtocolMessage } from "./protocol.js";
import type { NavigationContext } from "./navigation.js";
import type { NavigationTransition, PageRoute } from "./types.js";

/**
 * The two things a navigation has to get right once native has accepted it:
 * knowing when the new document is actually there, and telling the client about
 * it in the order Playwright expects.
 */

export function emitNavigationResponse(
  context: NavigationContext,
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
    context.deferredEvents.some(
      (message) =>
        message.sessionId === route.nativeSessionId &&
        message.method === "Network.requestWillBeSent" &&
        message.params?.requestId === frame.loaderId,
    );
  const deferredResponse = context.deferredEvents.some(
    (message) =>
      message.sessionId === route.nativeSessionId &&
      message.method === "Network.responseReceived" &&
      message.params?.requestId === frame.loaderId,
  );
  const deferredFinished = context.deferredEvents.some(
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
    context.emit({
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
    context.emit({
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

// Page.navigate has already committed natively when this runs; it only
// waits for the frame tree to reflect that commit. The navigate response's
// loaderId is the authoritative marker. A frame still on its initial blank
// state ("" or about:blank) is never mistaken for the committed page — the
// replacement tab (new or reused) starts on about:blank — but any other
// document is accepted: after a successful navigate response a non-blank
// frame is the committed document or its successor (e.g. an instant
// client-side redirect that already replaced the expected loader).
export async function waitForNavigationCommit(
  context: NavigationContext,
  sessionId: string,
  requestedUrl: string,
  expectedLoaderId: string | undefined,
  timeoutMs: number,
  throwIfAborted?: () => void,
) {
  const deadline = Date.now() + timeoutMs;
  let lastFrame: any;
  do {
    if (context.isClosed()) throw new Error("Ego CDP transport is closed");
    throwIfAborted?.();
    const frameTree = await context.native
      .command("Page.getFrameTree", {}, sessionId, 1_000)
      .catch(() => undefined);
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
      const documentResult = await context.native
        .command(
          "Runtime.evaluate",
          {
            expression:
              "(() => { const entry = performance.getEntriesByType('navigation')[0]; return { url: location.href, readyState: document.readyState, contentType: document.contentType, responseStatus: entry?.responseStatus }; })()",
            returnByValue: true,
          },
          sessionId,
          1_000,
        )
        .catch(() => undefined);
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
