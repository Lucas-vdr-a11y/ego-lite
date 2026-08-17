export type EgoCdpRuntime = {
  sendCDPMessage: (payload: string) => unknown;
  animationHighlightMouseToPosition?: (x: number, y: number) => unknown;
  createTab?: (url?: string) => Promise<unknown> | unknown;
  listTabs?: () => Promise<{
    tabs?: Array<{ targetId?: string; active?: boolean; url?: string }>;
    targetInfos?: Array<{ targetId?: string; active?: boolean; url?: string }>;
  }>;
  onCDPMessage?: (payload: string) => void;
  onSendCDPMessageError?: (message: unknown, errorCode?: string) => void;
};

export type TransportOptions = {
  allocateMessageId?: () => number;
  frameTreeBarrierTimeoutMs?: number;
  navigationCommitTimeoutMs?: number;
  onPendingWorkChange?: (count: number) => void;
  targetIds?: Iterable<string>;
};

export type ReplayCommand = {
  method: string;
  params: Record<string, unknown>;
};

export type PassthroughSession = {
  clientTargetId: string;
  nativeTargetId: string;
  nativeSessionId: string;
  replayCommands: Map<string, ReplayCommand>;
};

// A client-forwarded command awaiting its native reply. `nativeSessionId` is the
// session the command actually went to, which is not always the route's current
// one: a mid-transition Fetch command is addressed to the replacement session.
export type PendingCommand = {
  clientId: unknown;
  method: unknown;
  clientSessionId?: string;
  nativeSessionId?: string;
  attachedTarget?: Pick<
    PassthroughSession,
    "clientTargetId" | "nativeTargetId"
  >;
  detachedSessionId?: string;
};

export type FrameTreeBarrier = {
  heldAutoAttach: any[];
  // Every barrier has one: a barrier that outlives its Page.getFrameTree hangs
  // page initialization, so the deadline is part of opening one, not an extra.
  timer: ReturnType<typeof setTimeout>;
};

// While a navigation replacement waits for its commit, interception traffic
// must keep flowing: a replayed Fetch.enable pauses the replacement's document
// request, and only the client can continue it. The bridge exposes the
// replacement session's Fetch events to the client (and routes the client's
// Fetch commands back) before the route itself is swapped. Network events are
// NOT bridged: they stay deferred until commit like every other event, so the
// commit-time synthesis keeps seeing them in arrival order.
export type NavigationTransition = {
  nativeSessionId: string;
  nativeTargetId: string;
  clientFrameId: string;
  // networkIds whose Network.requestWillBeSent the bridge has synthesized:
  // while interception holds the document request paused, Chromium withholds
  // the request's real Network.requestWillBeSent, so the bridge announces it
  // from the pause payload. The real event arrives once the pause resolves
  // (deferred until the swap) and is dropped there, and the commit-time
  // navigation-response synthesis consults this set so the request is never
  // announced twice.
  announcedRequests: Set<string>;
};

export type PassiveNavigation = {
  key: string;
  generation: number;
  nativeFrameId: string;
  loaderId?: string;
  lifecycleNames: Set<string>;
  frameStopped: boolean;
  requestId?: string;
  requestFinished: boolean;
};

export type PageRoute = {
  clientTargetId: string;
  nativeTargetId: string;
  clientSessionId: string;
  nativeSessionId: string;
  clientMainFrameId?: string;
  nativeMainFrameId?: string;
  // The route's current committed main-frame URL: seeded from the attach-time
  // targetInfo, updated on every observed main-frame Page.frameNavigated, and
  // set to the committed URL when a navigation replacement swaps the route.
  // While it is blank ("", about:blank, chrome://newtab) a client navigation
  // runs natively in place instead of through the tab-replacement flow.
  currentMainFrameUrl?: string;
  generation: number;
  state: "attached" | "navigating" | "rebinding" | "closed";
  replayCommands: Map<string, ReplayCommand>;
  heldMessages?: any[];
  // Set while the route's current native session cannot receive commands: it
  // was internally detached (same-target navigation replacement) or its native
  // detach started a rebind. Forwarding would only fail with "Session not
  // found", so send() holds everything until the transition settles.
  nativeSessionDetached?: boolean;
  // A newer client Page.navigate supersedes an older one (stock browser
  // semantics). Each client navigation bumps the epoch; a queued navigation
  // that starts with a stale epoch answers "superseded" without doing any
  // native work, and abortNavigation cancels the one already in flight.
  navigationEpoch: number;
  abortNavigation?: (reason: string) => void;
  pendingTransition?: Promise<void>;
  transition?: NavigationTransition;
  passiveNavigation?: PassiveNavigation;
};

// A function boundary defeats control-flow narrowing: callers that assigned a
// specific state earlier in the flow can still observe a concurrent close.
export function routeClosed(route: PageRoute): boolean {
  return route.state === "closed";
}
