import { networkCompletion, subscribeBrowserEvent } from "./browser-runtime.js";
import {
  createRequestInfo,
  linkRedirect,
  responseLifecycleInfo,
  type RequestInfo,
} from "./network-facades.js";
import type { NetworkEventLease } from "./network-events.js";

type Completion = { errorText: string | null };

/**
 * Observe request lifecycle events independently from an async wait predicate.
 *
 * Browser events reach subscribers before waiter predicates are processed, so
 * this monitor preserves redirects and failures even while a predicate awaits.
 * Once a matching facade is returned, retain() transfers the Network lease to
 * the request and releases it only after that redirect chain terminates.
 */
export function createNetworkLifecycleMonitor(lease: NetworkEventLease) {
  const requests = new Map<string, RequestInfo>();
  const eventRequests = new WeakMap<object, RequestInfo>();
  const completions = new Map<string, Completion>();
  let retainedKey: string | null = null;
  let stopped = false;
  let releasePromise: Promise<void> | null = null;

  const onRequest = (event) => {
    const params = event?.params || {};
    const key = requestKey(params.requestId, event?.sessionId);
    const previous = requests.get(key);
    completions.delete(key);
    const request = createRequestInfo(params, event?.sessionId);
    linkRedirect(previous, request);
    requests.set(key, request);
    eventRequests.set(event, request);
  };
  const onResponse = (event) => {
    const key = requestKey(event?.params?.requestId, event?.sessionId);
    const request = requests.get(key);
    if (request) eventRequests.set(event, request);
  };
  const onFinished = (event) => {
    complete(event, null);
  };
  const onFailed = (event) => {
    complete(event, event?.params?.errorText || "Request failed");
  };
  const unsubscribe = [
    subscribeBrowserEvent("Network.requestWillBeSent", undefined, onRequest),
    subscribeBrowserEvent("Network.responseReceived", undefined, onResponse),
    subscribeBrowserEvent("Network.loadingFinished", undefined, onFinished),
    subscribeBrowserEvent("Network.loadingFailed", undefined, onFailed),
  ];

  function complete(event, errorText: string | null) {
    const key = requestKey(event?.params?.requestId, event?.sessionId);
    const request = requests.get(key);
    if (request && errorText) request.failureText = errorText;
    completions.set(key, { errorText });
    if (retainedKey === key) void stopAndRelease();
  }

  function stopAndRelease() {
    if (releasePromise) return releasePromise;
    stopped = true;
    for (const remove of unsubscribe) remove();
    releasePromise = lease.release();
    return releasePromise;
  }

  return {
    requestForEvent(event): RequestInfo | undefined {
      return eventRequests.get(event);
    },
    retain(request: RequestInfo) {
      retainedKey = requestKey(request.requestId, request.sessionId);
      const completion =
        completions.get(retainedKey) ||
        networkCompletion(request.requestId, request.sessionId);
      if (completion?.errorText) request.failureText = completion.errorText;
      if (completion) return stopAndRelease();
    },
    async release() {
      if (stopped) {
        if (releasePromise) await releasePromise;
        return;
      }
      await stopAndRelease();
    },
  };
}

/**
 * Transfer a navigation's Network lease to its returned Response facade.
 */
export function retainResponseLifecycle(response, lease: NetworkEventLease) {
  const info = responseLifecycleInfo(response);
  if (!info || info.finished) {
    return lease.release();
  }
  let stopped = false;
  let releasePromise: Promise<void> | undefined;
  const finish = (errorText: string | null) => {
    if (stopped) return releasePromise;
    stopped = true;
    if (errorText) info.request.failureText = errorText;
    for (const remove of unsubscribe) remove();
    releasePromise = lease.release();
    return releasePromise;
  };
  const matches = (event) =>
    event?.params?.requestId === info.requestId &&
    (!info.sessionId || event?.sessionId === info.sessionId);
  const unsubscribe = [
    subscribeBrowserEvent(
      "Network.loadingFinished",
      info.sessionId,
      (event) => {
        if (matches(event)) finish(null);
      },
    ),
    subscribeBrowserEvent("Network.loadingFailed", info.sessionId, (event) => {
      if (matches(event)) {
        finish(event?.params?.errorText || "Request failed");
      }
    }),
  ];
  const completion = networkCompletion(info.requestId, info.sessionId);
  if (completion) return finish(completion.errorText);
}

function requestKey(requestId, sessionId) {
  return `${sessionId || ""}:${requestId || ""}`;
}
