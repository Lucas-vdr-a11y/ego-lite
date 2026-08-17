import { resolveEgoError } from "../../ego-errors.js";
import type { PageRoute } from "./types.js";

// What the agent reads when a native send fails: every Playwright page operation
// funnels through this transport, so this is the wording for the whole
// task.page.* surface. Resolve it through ego-errors rather than pasting the
// native text in — for EGO_TASK_SPACE_USER_IN_CONTROL that text is a
// user_action_reason key (or, on this channel, a bare static sentence), neither of
// which tells the agent what to do. The stable code stays in front of the message
// for diagnosis; it is the only place a code can ride along, since this failure
// leaves as a CDP error object with no room for error_code.
export function nativeSendErrorText(
  message: unknown,
  errorCode?: string,
): string {
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

export function rewriteOutgoingProtocolParams(
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

export function rewriteIncomingProtocolMessage(message: any, route: PageRoute) {
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
export function isBlankPageUrl(url: string | undefined): boolean {
  return (
    url === "" ||
    url === "about:blank" ||
    (typeof url === "string" && url.startsWith("chrome://newtab"))
  );
}

export function isReplayableSessionCommand(method: unknown): method is string {
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

export function storageCookieCommand(method: unknown) {
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
