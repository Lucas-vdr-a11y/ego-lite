export type AgentMouseHighlightRuntime = {
  animationHighlightMouseToPosition?: (x: number, y: number) => unknown;
};

type CdpCommand = {
  method?: unknown;
  params?: unknown;
};

/**
 * Moves the native agent-mouse overlay — the cursor the user watches travel
 * across the TaskSpace — to wherever the agent is about to act.
 *
 * The native side animates from the cursor's current position to the point it
 * is given, so one target point per move is all it needs; ego-browser only has
 * to say where. Playwright exposes no helper layer to say it from (page.click,
 * locator.click, hover, dragTo and page.mouse are Playwright's own), but every
 * one of them emits Input.dispatchMouseEvent/mouseMoved before pressing, so
 * mirroring that single command covers them all.
 */
export function highlightAgentMouse(
  runtime: AgentMouseHighlightRuntime | undefined,
  message: CdpCommand,
): void {
  if (message?.method !== "Input.dispatchMouseEvent") return;
  const params = message.params as
    { type?: unknown; x?: unknown; y?: unknown } | undefined;
  if (params?.type !== "mouseMoved") return;
  if (typeof params.x !== "number" || typeof params.y !== "number") return;
  const highlight = runtime?.animationHighlightMouseToPosition;
  if (typeof highlight !== "function") return;
  const shown = highlight.call(runtime, params.x, params.y) as
    Promise<unknown> | undefined;
  // Never awaited: the overlay is decorative and must not pace the pointer
  // action. Its rejections are routine — the native call refuses once the user
  // takes control, and the space can close mid-move — so they are dropped here
  // rather than left to crash the agent's process as unhandled rejections.
  if (typeof shown?.then === "function") shown.then(undefined, () => {});
}
