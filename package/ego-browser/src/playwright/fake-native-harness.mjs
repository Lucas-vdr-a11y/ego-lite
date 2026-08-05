// Test harness: a scripted fake of the native ego CDP backend, faithful enough
// for a real playwright-core client to connect through the Ego transport.
// Every request the transport forwards to "native" is recorded in `log`.
//
// Modeled native invariants (matched against the real browser):
// - the main frame id equals the target id
// - Target.getTargetInfo returns a browserContextId
// - Page.navigate commits natively and emits frameNavigated + lifecycle events

export class FakeNativeBrowser {
  constructor() {
    this.log = [];
    this.tabs = new Map(); // targetId -> { url, frames: [{id, loaderId, url, parentId?}] }
    this.sessions = new Map(); // sessionId -> targetId
    this.detachedSessions = [];
    this.closedTargets = [];
    this.createdUrls = [];
    this.nextSession = 1;
    this.nextContext = 100;
    this.nextLoader = 1;
    this.nextTab = 1;
    // Per-target override: report this URL from getFrameTree/evaluate until
    // cleared, regardless of the tab's real URL (gates navigation commits).
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
            loaderId: main.loaderId,
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
    if (method === "Page.navigate") {
      const tab = this.sessionTab(request);
      if (!tab) return this.replyError(request, "Cannot navigate: no tab");
      const frameId = request.params.frameId || tab.frames[0].id;
      const frame = tab.frames.find((candidate) => candidate.id === frameId);
      if (!frame) {
        return this.replyError(request, `No frame with id ${frameId}`);
      }
      const loaderId = `loader-${this.nextLoader++}`;
      frame.url = request.params.url;
      frame.loaderId = loaderId;
      if (frame === tab.frames[0]) tab.url = request.params.url;
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
      return;
    }
    return this.reply(request, {});
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
