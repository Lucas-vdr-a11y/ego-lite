import type { PageRoute, PassthroughSession } from "./types.js";

export type SessionTablesOptions = {
  // The TaskSpace's target ids, when the transport is scoped to a TaskSpace.
  // Absent means every native target is in scope.
  targetIds?: Iterable<string>;
};

/**
 * Every index the router needs to translate between the client's view of the
 * browser and native's, in one place.
 *
 * Three kinds of state live here, and they answer three different questions:
 *
 * - **Topology** (`sessionsByTarget`, `targetsBySession`, `nativeParentSessions`)
 *   — which native session belongs to which target, and which session attached
 *   it. The parent chain is what makes a frame traceable back to its page.
 * - **Routes and passthroughs** — a page route is a client session that the
 *   transport can re-point at a different native session (navigation by tab
 *   replacement), so it is indexed four ways: by client session, native session,
 *   client target, and native target. A passthrough session (an OOPIF) is not
 *   re-pointed, so it needs only its own two indexes.
 * - **Tombstones** — the four sets that mark work the transport did to itself.
 *   Native reports those detaches, closes, and attaches like any other, and the
 *   client must not see them: a self-inflicted event is recognized by finding
 *   its id in one of these sets.
 */
export class SessionTables {
  /** Native target id -> its native session id. */
  readonly sessionsByTarget = new Map<string, string>();
  /** Native session id -> the native target it is attached to. */
  readonly targetsBySession = new Map<string, string>();
  /** Native session id -> the native session that auto-attached it. */
  readonly nativeParentSessions = new Map<string, string>();

  readonly routesByClientSession = new Map<string, PageRoute>();
  readonly routesByNativeSession = new Map<string, PageRoute>();
  readonly routesByClientTarget = new Map<string, PageRoute>();
  readonly routesByNativeTarget = new Map<string, PageRoute>();

  readonly passthroughSessions = new Map<string, PassthroughSession>();
  readonly passthroughClientSessionsByNative = new Map<string, string>();

  /** Targets this transport is attaching itself, so the client sees no attach. */
  readonly manuallyAttachingTargets = new Set<string>();
  /** Sessions this transport detached itself, so the client sees no detach. */
  readonly internallyDetachedSessions = new Set<string>();
  /** Targets this transport closed itself, so the client sees no close. */
  readonly internallyClosedTargets = new Set<string>();
  /**
   * Native sessions the client has already been told are gone. Native keeps
   * reporting on them until it catches up, and every such event — including the
   * detach of a child the session owned — must be dropped.
   */
  readonly retiredNativeSessions = new Set<string>();

  readonly targetIds?: Set<string>;

  constructor(options: SessionTablesOptions = {}) {
    if (options.targetIds) this.targetIds = new Set(options.targetIds);
  }

  registerRoute(route: PageRoute) {
    this.routesByClientSession.set(route.clientSessionId, route);
    this.routesByNativeSession.set(route.nativeSessionId, route);
    this.routesByClientTarget.set(route.clientTargetId, route);
    this.routesByNativeTarget.set(route.nativeTargetId, route);
    this.sessionsByTarget.set(route.nativeTargetId, route.nativeSessionId);
    this.targetsBySession.set(route.nativeSessionId, route.nativeTargetId);
  }

  unregisterRoute(route: PageRoute) {
    this.routesByClientSession.delete(route.clientSessionId);
    this.routesByNativeSession.delete(route.nativeSessionId);
    this.routesByClientTarget.delete(route.clientTargetId);
    this.routesByNativeTarget.delete(route.nativeTargetId);
    this.sessionsByTarget.delete(route.nativeTargetId);
    this.targetsBySession.delete(route.nativeSessionId);
  }

  /**
   * Detaches a route from its current native side, so it can be re-pointed at a
   * replacement target's session. The client-side indexes stay: from the
   * client's perspective nothing changed.
   */
  detachNativeSide(route: PageRoute) {
    this.routesByNativeSession.delete(route.nativeSessionId);
    this.routesByNativeTarget.delete(route.nativeTargetId);
    this.sessionsByTarget.delete(route.nativeTargetId);
    this.targetsBySession.delete(route.nativeSessionId);
  }

  /**
   * Binds a route to a native target and session, after its own fields have
   * been re-pointed at them.
   */
  bindNativeSide(route: PageRoute) {
    this.routesByNativeSession.set(route.nativeSessionId, route);
    this.routesByNativeTarget.set(route.nativeTargetId, route);
    this.sessionsByTarget.set(route.nativeTargetId, route.nativeSessionId);
    this.targetsBySession.set(route.nativeSessionId, route.nativeTargetId);
  }

  /**
   * A popup inherits its opener's admission: a target opened by an in-scope
   * target is in scope too, or the client would never see the page it asked for.
   */
  admitTargetFromOpener(targetInfo: any) {
    const targetId = targetInfo?.targetId;
    const openerId = targetInfo?.openerId;
    if (
      typeof targetId === "string" &&
      typeof openerId === "string" &&
      this.targetIds?.has(openerId)
    ) {
      this.targetIds.add(targetId);
    }
  }

  /**
   * Records which native session auto-attached another, so a session can be
   * traced up to the page that owns it.
   */
  recordNativeParentSession(message: any) {
    if (
      message.method === "Target.attachedToTarget" &&
      typeof message.params?.sessionId === "string" &&
      typeof message.sessionId === "string"
    ) {
      this.nativeParentSessions.set(
        message.params.sessionId,
        message.sessionId,
      );
    }
  }

  /**
   * Frames are owned by the page, not by the session that reported them: an
   * OOPIF reports its own subtree from its own session, and both live and die
   * with the client target. Client and native session ids are both accepted —
   * a passthrough session uses one id for each.
   */
  pageTargetForSession(sessionId: string | undefined) {
    const seen = new Set<string>();
    let current = sessionId;
    while (typeof current === "string" && !seen.has(current)) {
      seen.add(current);
      const route =
        this.routesByNativeSession.get(current) ||
        this.routesByClientSession.get(current);
      if (route) return route.clientTargetId;
      const passthrough = this.passthroughSessions.get(
        this.passthroughClientSessionsByNative.get(current) || current,
      );
      if (passthrough) return passthrough.clientTargetId;
      current = this.nativeParentSessions.get(current);
    }
    return undefined;
  }

  clear() {
    this.routesByClientSession.clear();
    this.routesByNativeSession.clear();
    this.routesByClientTarget.clear();
    this.routesByNativeTarget.clear();
    this.passthroughSessions.clear();
    this.passthroughClientSessionsByNative.clear();
    this.sessionsByTarget.clear();
    this.targetsBySession.clear();
    this.manuallyAttachingTargets.clear();
    this.internallyDetachedSessions.clear();
    this.internallyClosedTargets.clear();
    this.retiredNativeSessions.clear();
    this.nativeParentSessions.clear();
  }
}
