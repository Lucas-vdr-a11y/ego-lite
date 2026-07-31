import { cdp } from "./cdp-eval.js";
import { networkCompletion, waitForBrowserEvent } from "./browser-runtime.js";
import { isEgoHardStopError } from "./ego-errors.js";

export type RequestInfo = {
  requestId: string;
  sessionId?: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  postData: string | null;
  resourceType: string;
  isNavigationRequest: boolean;
  redirectedFrom?: RequestInfo;
  redirectedTo?: RequestInfo;
  failureText?: string;
};

type ResponseLifecycleInfo = {
  requestId: string;
  sessionId?: string;
  request: RequestInfo;
  finished: boolean;
  bodyPromise?: Promise<ResponseBodyPayload>;
};

type ResponseBodyPayload = {
  body?: string;
  base64Encoded?: boolean;
};

const responseLifecycle = new WeakMap<object, ResponseLifecycleInfo>();

export function createRequestInfo(params, sessionId = undefined): RequestInfo {
  const request = params.request || {};
  return {
    requestId: params.requestId,
    sessionId,
    url: request.url || "",
    method: request.method || "",
    headers: normalizeHeaders(request.headers),
    postData: request.postData ?? null,
    resourceType: String(params.type || "").toLowerCase(),
    isNavigationRequest: String(params.type || "").toLowerCase() === "document",
  };
}

export function createRequestFacade(info: RequestInfo) {
  return {
    url: () => info.url,
    method: () => info.method,
    headers: () => ({ ...info.headers }),
    allHeaders: async () => ({ ...info.headers }),
    headerValue: async (name) =>
      info.headers[String(name).toLowerCase()] ?? null,
    postData: () => info.postData,
    postDataBuffer: () =>
      info.postData === null ? null : Buffer.from(info.postData, "utf8"),
    postDataJSON: () => {
      if (info.postData === null) return null;
      const contentType = info.headers["content-type"] || "";
      if (contentType.includes("application/x-www-form-urlencoded")) {
        return Object.fromEntries(new URLSearchParams(info.postData));
      }
      return JSON.parse(info.postData);
    },
    resourceType: () => info.resourceType,
    isNavigationRequest: () => info.isNavigationRequest,
    redirectedFrom: () =>
      info.redirectedFrom ? createRequestFacade(info.redirectedFrom) : null,
    redirectedTo: () =>
      info.redirectedTo ? createRequestFacade(info.redirectedTo) : null,
    failure: () => (info.failureText ? { errorText: info.failureText } : null),
  };
}

export function createResponseFacade(info) {
  const response = info.response || {};
  const request: RequestInfo =
    info.request ||
    createRequestInfo(
      {
        requestId: info.requestId,
        request: {
          url: response.url || "",
          method: "",
          headers: response.requestHeaders || {},
        },
        type: response.type,
      },
      info.sessionId,
    );
  const status = Number(response.status || 0);
  const headers = normalizeHeaders(response.headers);
  const lifecycle: ResponseLifecycleInfo = {
    requestId: info.requestId,
    sessionId: info.sessionId,
    request,
    finished: Boolean(info.finished),
  };
  const facade: any = {
    url: () => response.url || request.url || "",
    status: () => status,
    statusText: () => response.statusText || "",
    ok: () => status >= 200 && status <= 299,
    headers: () => ({ ...headers }),
    allHeaders: async () => ({ ...headers }),
    headerValue: async (name) => headers[String(name).toLowerCase()] ?? null,
    headerValues: async (name) => {
      const value = headers[String(name).toLowerCase()];
      if (value === undefined) return [];
      return String(value)
        .split(/\n/)
        .map((entry) => entry.trim())
        .filter(Boolean);
    },
    request: () => createRequestFacade(request),
    body: async () => {
      const body = await responseBody(lifecycle);
      return body.base64Encoded
        ? Buffer.from(body.body || "", "base64")
        : Buffer.from(body.body || "", "utf8");
    },
    text: async () => {
      const body = await facade.body();
      return body.toString("utf8");
    },
    finished: async () =>
      info.finished
        ? null
        : waitForRequestFinished(info.requestId, 0, info.sessionId),
    fromServiceWorker: () => Boolean(response.fromServiceWorker),
    securityDetails: async () => response.securityDetails || null,
    serverAddr: async () =>
      response.remoteIPAddress
        ? {
            ipAddress: response.remoteIPAddress,
            port: Number(response.remotePort || 0),
          }
        : null,
  };
  facade.json = async () => JSON.parse(await facade.text());
  responseLifecycle.set(facade, lifecycle);
  return facade;
}

export function responseLifecycleInfo(
  response,
): ResponseLifecycleInfo | undefined {
  return responseLifecycle.get(response);
}

export async function cacheResponseBody(response) {
  const info = responseLifecycle.get(response);
  if (!info || info.finished) return;
  await responseBody(info);
}

export function linkRedirect(
  previous: RequestInfo | undefined,
  next: RequestInfo,
) {
  if (!previous) return;
  previous.redirectedTo = next;
  next.redirectedFrom = previous;
}

export function normalizeHeaders(headers = {}) {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers || {})) {
    out[String(name).toLowerCase()] = String(value);
  }
  return out;
}

async function readResponseBody(
  requestId,
  timeout,
  sessionId = undefined,
): Promise<ResponseBodyPayload> {
  if (!requestId) {
    throw new Error("response body is unavailable without a requestId");
  }
  try {
    return await cdp("Network.getResponseBody", { requestId }, sessionId);
  } catch (firstError) {
    if (
      isEgoHardStopError(firstError) ||
      !isResponseBodyPendingError(firstError)
    ) {
      throw firstError;
    }
    await waitForRequestFinished(requestId, timeout, sessionId).catch(
      () => null,
    );
    try {
      return await cdp("Network.getResponseBody", { requestId }, sessionId);
    } catch (error) {
      if (isEgoHardStopError(error)) throw error;
      throw new Error(
        `response body is unavailable for request ${requestId}: ${error?.message || firstError?.message || error}`,
      );
    }
  }
}

function responseBody(info: ResponseLifecycleInfo) {
  if (!info.bodyPromise) {
    info.bodyPromise = readResponseBody(info.requestId, 0, info.sessionId);
  }
  return info.bodyPromise;
}

function isResponseBodyPendingError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /No resource with given identifier|No data found for resource|response body is not available yet/i.test(
    message,
  );
}

async function waitForRequestFinished(requestId, timeout, sessionId) {
  const alreadyFinished = networkCompletion(requestId, sessionId);
  if (alreadyFinished) {
    return alreadyFinished.errorText
      ? new Error(alreadyFinished.errorText)
      : null;
  }
  const event: any = await waitForBrowserEvent(
    (candidate) =>
      (!sessionId || candidate?.sessionId === sessionId) &&
      (candidate?.method === "Network.loadingFinished" ||
        candidate?.method === "Network.loadingFailed") &&
      candidate?.params?.requestId === requestId,
    browserEventTimeout(timeout),
  );
  const completion = networkCompletion(requestId, sessionId);
  if (completion?.errorText) return new Error(completion.errorText);
  if (event?.method === "Network.loadingFailed") {
    return new Error(event?.params?.errorText || "Request failed");
  }
  return null;
}

function browserEventTimeout(timeout) {
  return Math.min(timeout, 2147483647);
}
