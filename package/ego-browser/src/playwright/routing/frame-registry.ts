export type FrameRegistryOptions = {
  // Frames are owned by the page, not by the session that reported them, so the
  // registry asks the session tables which client target a session belongs to.
  ownerOf: (sessionId: string | undefined) => string | undefined;
};

/**
 * Which frame ids the client has already been told about, and which page owns
 * each one.
 *
 * Chromium reports no per-frame Page.frameDetached when a target goes away, and
 * a frame outlives the OOPIF session that reported it (a cross-site frame that
 * returns in-process keeps its node), so the owning page is the only safe
 * release point — see {@link forgetTarget}.
 */
export class FrameRegistry {
  readonly #owners = new Map<string, string | undefined>();
  readonly #ownerOf: FrameRegistryOptions["ownerOf"];

  constructor(options: FrameRegistryOptions) {
    this.#ownerOf = options.ownerOf;
  }

  has(frameId: string) {
    return this.#owners.has(frameId);
  }

  remember(frameId: string, sessionId: string | undefined) {
    this.#owners.set(frameId, this.#ownerOf(sessionId));
  }

  forget(frameId: string) {
    this.#owners.delete(frameId);
  }

  forgetTarget(clientTargetId: string | undefined) {
    if (!clientTargetId) return;
    for (const [frameId, owner] of this.#owners) {
      if (owner === clientTargetId) this.#owners.delete(frameId);
    }
  }

  clear() {
    this.#owners.clear();
  }

  observeEvent(message: any) {
    const sessionId =
      typeof message.sessionId === "string" ? message.sessionId : undefined;
    if (message.method === "Page.frameAttached") {
      if (typeof message.params?.frameId === "string") {
        this.remember(message.params.frameId, sessionId);
      }
    } else if (message.method === "Page.frameNavigated") {
      if (typeof message.params?.frame?.id === "string") {
        this.remember(message.params.frame.id, sessionId);
      }
    } else if (
      message.method === "Page.frameDetached" &&
      message.params?.reason !== "swap" &&
      typeof message.params?.frameId === "string"
    ) {
      this.forget(message.params.frameId);
    }
  }

  /**
   * On reconnect, Chromium keeps existing OOPIF targets but Page.getFrameTree
   * omits them. Playwright consumes the local frame tree first, so any frame
   * node missing for an attaching OOPIF is restored here — immediately before
   * its Target.attachedToTarget event is forwarded.
   */
  restoreFrameBeforeOopifAttach(message: any) {
    const targetInfo = message.params?.targetInfo;
    const targetId = targetInfo?.targetId;
    const parentFrameId = targetInfo?.parentFrameId;
    if (
      message.method !== "Target.attachedToTarget" ||
      targetInfo?.type !== "iframe" ||
      typeof message.sessionId !== "string" ||
      typeof targetId !== "string" ||
      typeof parentFrameId !== "string" ||
      this.has(targetId) ||
      !this.has(parentFrameId)
    ) {
      return [];
    }
    this.remember(targetId, message.sessionId);
    const frame = {
      id: targetId,
      parentId: parentFrameId,
      loaderId: targetId,
      name: "",
      url: typeof targetInfo.url === "string" ? targetInfo.url : "",
    };
    return [
      {
        method: "Page.frameAttached",
        sessionId: message.sessionId,
        params: { frameId: targetId, parentFrameId },
      },
      {
        method: "Page.frameNavigated",
        sessionId: message.sessionId,
        params: { frame },
      },
    ];
  }
}
