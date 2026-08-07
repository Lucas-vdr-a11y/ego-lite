// Test harness: a scripted fake of the native ego CDP backend, faithful enough
// for a real playwright-core client to connect through the Ego transport.
// Every request the transport forwards to "native" is recorded in `log`.
//
// Modeled native invariants (matched against the real browser):
// - the main frame id equals the target id
// - Target.getTargetInfo returns a browserContextId
// - Page.navigate commits natively, responds {frameId, loaderId} (errorText on
//   failure, isDownload for downloads) and emits frameNavigated + lifecycle
//   events
// - the document request id equals the committed loader id
//
// `interceptNavigations` models Fetch interception of the document request:
// a session-level Page.navigate on a fetch-enabled session pauses the request
// (Fetch.requestPaused only — Chromium withholds the request's
// Network.requestWillBeSent while the pause is unresolved) and holds the
// Page.navigate response. Only Fetch.continueRequest / fulfillRequest lets
// the navigation commit — a test using this flag must answer the pause. The
// commit then emits the withheld Network events (matching the real browser)
// before the navigate response.
//
// `navigationErrors` (url -> errorText) and `downloadUrls` make Page.navigate
// respond with errorText / isDownload without navigating the frame.

export class FakeNativeBrowser {
  constructor({ interceptNavigations = false } = {}) {
    this.log = [];
    this.tabs = new Map(); // targetId -> { url, frames: [{id, loaderId, url, parentId?}] }
    this.sessions = new Map(); // sessionId -> targetId
    this.detachedSessions = [];
    this.closedTargets = [];
    this.createdUrls = [];
    this.continuedRequests = [];
    this.fetchEnabledSessions = new Set();
    this.navigationErrors = new Map(); // url -> errorText
    this.downloadUrls = new Set();
    this.nextSession = 1;
    this.nextContext = 100;
    this.nextLoader = 1;
    this.nextTab = 1;
    this.nextInterception = 1;
    this.interceptNavigations = interceptNavigations;
    this.pendingNavigations = new Map(); // targetId -> { url, requestId, interceptionId, navigateRequest, frame, frameId }
    // Per-target override: report this URL (and a held loaderId) from
    // getFrameTree/evaluate until cleared, regardless of the tab's real state
    // (gates navigation commit confirmation).
    this.frameUrlOverride = new Map();

    const fake = this;
    this.runtime = {
      async listTabs() {
        const tabs = [...fake.tabs.entries()].map(([targetId, tab], index) => ({
          targetId,
          url: tab.url,
          active: index === 0,
        }));
        return { tabs };
      },
      async createTab(url) {
        fake.createdUrls.push(url);
        const targetId = `tab-${fake.nextTab++}`;
        fake.addTab(targetId, url);
        return { targetId };
      },
      sendCDPMessage(payload) {
        fake.handle(JSON.parse(payload));
      },
    };
  }

  addTab(targetId, url, { childFrameUrl } = {}) {
    const frames = [
      { id: targetId, loaderId: `loader-${this.nextLoader++}`, url },
    ];
    if (childFrameUrl) {
      frames.push({
        id: `${targetId}-child`,
        parentId: targetId,
        loaderId: `loader-${this.nextLoader++}`,
        url: childFrameUrl,
      });
    }
    this.tabs.set(targetId, { url, frames });
    return targetId;
  }

  emit(message) {
    queueMicrotask(() => this.runtime.onCDPMessage?.(JSON.stringify(message)));
  }

  reply(request, result) {
    this.emit({
      id: request.id,
      result,
      ...(request.sessionId ? { sessionId: request.sessionId } : {}),
    });
  }

  replyError(request, message) {
    this.emit({
      id: request.id,
      error: { code: -32_000, message },
      ...(request.sessionId ? { sessionId: request.sessionId } : {}),
    });
  }

  sessionTab(request) {
    const targetId = this.sessions.get(request.sessionId);
    return targetId ? this.tabs.get(targetId) : undefined;
  }

  handle(request) {
    this.log.push(request);
    const method = request.method;

    if (request.sessionId && !this.sessions.has(request.sessionId)) {
      this.replyError(
        request,
        `Session with given id not found: ${request.sessionId}`,
      );
      return;
    }

    if (method === "Target.getTargetInfo") {
      const targetId = request.params?.targetId;
      if (targetId === undefined) {
        return this.reply(request, {
          targetInfo: {
            targetId: "fake-browser-target",
            type: "browser",
            title: "",
            url: "",
            attached: true,
          },
        });
      }
      const tab = this.tabs.get(targetId);
      if (!tab) {
        return this.replyError(
          request,
          `No target with given id found: ${targetId}`,
        );
      }
      return this.reply(request, {
        targetInfo: {
          targetId,
          type: "page",
          title: "",
          url: tab.url,
          attached: false,
          browserContextId: "fake-context",
        },
      });
    }
    if (method === "Target.attachToTarget") {
      const targetId = request.params.targetId;
      if (!this.tabs.has(targetId)) {
        return this.replyError(
          request,
          `No target with given id found: ${targetId}`,
        );
      }
      const sessionId = `sess-${this.nextSession++}`;
      this.sessions.set(sessionId, targetId);
      return this.reply(request, { sessionId });
    }
    if (method === "Target.detachFromTarget") {
      const sessionId = request.params.sessionId;
      this.detachedSessions.push(sessionId);
      this.sessions.delete(sessionId);
      return this.reply(request, {});
    }
    if (method === "Target.closeTarget") {
      const targetId = request.params.targetId;
      this.closedTargets.push(targetId);
      this.tabs.delete(targetId);
      for (const [sessionId, sessionTargetId] of this.sessions) {
        if (sessionTargetId === targetId) this.sessions.delete(sessionId);
      }
      return this.reply(request, { success: true });
    }
    if (method === "Page.getFrameTree") {
      const tab = this.sessionTab(request);
      if (!tab) return this.replyError(request, "No frame tree available");
      const targetId = this.sessions.get(request.sessionId);
      const override = this.frameUrlOverride.get(targetId);
      const [main, ...children] = tab.frames;
      return this.reply(request, {
        frameTree: {
          frame: {
            id: main.id,
            // While the override gates a commit, the committed loaderId must
            // stay hidden too, or a loaderId-based commit check bypasses it.
            loaderId:
              override === undefined ? main.loaderId : `${main.loaderId}-held`,
            url: override ?? main.url,
            name: "",
          },
          childFrames: children.map((frame) => ({
            frame: {
              id: frame.id,
              parentId: frame.parentId,
              loaderId: frame.loaderId,
              url: frame.url,
              name: "",
            },
          })),
        },
      });
    }
    if (method === "Runtime.enable") {
      const tab = this.sessionTab(request);
      this.reply(request, {});
      if (tab) {
        for (const frame of tab.frames) {
          this.emit({
            method: "Runtime.executionContextCreated",
            params: {
              context: {
                id: this.nextContext++,
                origin: frame.url,
                name: "",
                auxData: {
                  isDefault: true,
                  type: "default",
                  frameId: frame.id,
                },
              },
            },
            sessionId: request.sessionId,
          });
        }
      }
      return;
    }
    if (method === "Page.createIsolatedWorld") {
      const contextId = this.nextContext++;
      this.emit({
        method: "Runtime.executionContextCreated",
        params: {
          context: {
            id: contextId,
            origin: "",
            name: request.params.worldName || "isolated",
            auxData: {
              isDefault: false,
              type: "isolated",
              frameId: request.params.frameId,
            },
          },
        },
        sessionId: request.sessionId,
      });
      return this.reply(request, { executionContextId: contextId });
    }
    if (method === "Runtime.evaluate") {
      const expression = String(request.params?.expression || "");
      const tab = this.sessionTab(request);
      const targetId = this.sessions.get(request.sessionId);
      const override = this.frameUrlOverride.get(targetId);
      if (expression === "document.readyState") {
        return this.reply(request, {
          result: { type: "string", value: "complete" },
        });
      }
      if (expression.includes("performance.getEntriesByType")) {
        return this.reply(request, {
          result: {
            type: "object",
            value: {
              url: override ?? tab?.url ?? "about:blank",
              readyState: "complete",
              contentType: "text/html",
              responseStatus: 200,
            },
          },
        });
      }
      return this.reply(request, { result: { type: "undefined" } });
    }
    if (method === "Runtime.callFunctionOn") {
      return this.reply(request, {
        result: { type: "string", value: "fake-result" },
      });
    }
    if (method === "Network.getAllCookies") {
      return this.reply(request, { cookies: [] });
    }
    if (method === "Fetch.enable") {
      this.fetchEnabledSessions.add(request.sessionId);
      return this.reply(request, {});
    }
    if (
      method === "Fetch.continueRequest" ||
      method === "Fetch.fulfillRequest"
    ) {
      const interceptionId = request.params?.requestId;
      const entry = [...this.pendingNavigations.entries()].find(
        ([, pending]) => pending.interceptionId === interceptionId,
      );
      if (!entry) {
        return this.replyError(request, `Invalid InterceptionId.`);
      }
      const [targetId, pending] = entry;
      this.continuedRequests.push(interceptionId);
      this.pendingNavigations.delete(targetId);
      this.reply(request, {});
      // The pause is resolved: the withheld real Network events for the
      // document request now reach the session (matching real Chromium),
      // followed by the commit and the held Page.navigate response.
      this.emit({
        method: "Network.requestWillBeSent",
        params: {
          requestId: pending.requestId,
          loaderId: pending.requestId,
          documentURL: pending.url,
          request: { url: pending.url, method: "GET", headers: {} },
          timestamp: 2,
          wallTime: 2,
          initiator: { type: "other" },
          type: "Document",
          frameId: targetId,
          hasUserGesture: false,
        },
        sessionId: request.sessionId,
      });
      this.emit({
        method: "Network.responseReceived",
        params: {
          requestId: pending.requestId,
          loaderId: pending.requestId,
          timestamp: 2,
          type: "Document",
          response: {
            url: pending.url,
            status: 200,
            statusText: "OK",
            headers: {},
            mimeType: "text/html",
            connectionReused: false,
            connectionId: 0,
            encodedDataLength: 0,
            securityState: "secure",
          },
          hasExtraInfo: false,
          frameId: targetId,
        },
        sessionId: request.sessionId,
      });
      this.emit({
        method: "Network.loadingFinished",
        params: {
          requestId: pending.requestId,
          timestamp: 2,
          encodedDataLength: 0,
        },
        sessionId: request.sessionId,
      });
      this.commitNavigation(
        pending.navigateRequest,
        pending.frame,
        pending.frameId,
        pending.url,
        pending.requestId,
      );
      return;
    }
    if (method === "Page.navigate") {
      const tab = this.sessionTab(request);
      if (!tab) return this.replyError(request, "Cannot navigate: no tab");
      const frameId = request.params.frameId || tab.frames[0].id;
      const frame = tab.frames.find((candidate) => candidate.id === frameId);
      if (!frame) {
        return this.replyError(request, `No frame with id ${frameId}`);
      }
      const url = request.params.url;
      const errorText = this.navigationErrors.get(url);
      if (errorText !== undefined) {
        return this.reply(request, { frameId, errorText });
      }
      const loaderId = `loader-${this.nextLoader++}`;
      if (this.downloadUrls.has(url)) {
        // A download never navigates the frame; only the response reports it.
        return this.reply(request, { frameId, loaderId, isDownload: true });
      }
      const targetId = this.sessions.get(request.sessionId);
      if (
        this.interceptNavigations &&
        frame === tab.frames[0] &&
        this.fetchEnabledSessions.has(request.sessionId)
      ) {
        // The document request pauses and the navigate response is held until
        // Fetch.continueRequest / fulfillRequest resolves the pause.
        this.pendingNavigations.set(targetId, {
          url,
          requestId: loaderId,
          interceptionId: `int-${this.nextInterception++}`,
          navigateRequest: request,
          frame,
          frameId,
        });
        this.emit({
          method: "Fetch.requestPaused",
          params: {
            requestId: this.pendingNavigations.get(targetId).interceptionId,
            request: {
              url,
              method: "GET",
              headers: {},
              initialPriority: "VeryHigh",
              referrerPolicy: "strict-origin-when-cross-origin",
            },
            frameId: targetId,
            resourceType: "Document",
            networkId: loaderId,
          },
          sessionId: request.sessionId,
        });
        return;
      }
      return this.commitNavigation(request, frame, frameId, url, loaderId);
    }
    return this.reply(request, {});
  }

  commitNavigation(request, frame, frameId, url, loaderId) {
    const targetId = this.sessions.get(request.sessionId);
    const tab = targetId ? this.tabs.get(targetId) : undefined;
    frame.url = url;
    frame.loaderId = loaderId;
    if (tab && frame === tab.frames[0]) tab.url = url;
    this.reply(request, { frameId, loaderId });
    this.emit({
      method: "Page.frameNavigated",
      params: {
        frame: {
          id: frameId,
          ...(frame.parentId ? { parentId: frame.parentId } : {}),
          loaderId,
          url: frame.url,
          name: "",
        },
      },
      sessionId: request.sessionId,
    });
    for (const name of ["DOMContentLoaded", "load"]) {
      this.emit({
        method: "Page.lifecycleEvent",
        params: { frameId, loaderId, name, timestamp: 1 },
        sessionId: request.sessionId,
      });
    }
  }
}

export async function waitForCondition(
  condition,
  timeoutMs = 2_000,
  intervalMs = 20,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return condition();
}
