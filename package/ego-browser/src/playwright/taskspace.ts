/**
 * The Playwright TaskSpace: the process's connection to the browser the agent
 * script is driving.
 *
 * This module is the stable entry point; the implementation lives in
 * `taskspace/`, one file per concern.
 *
 * - `types.ts` — the session, connector, and native-runtime shapes.
 * - `registry.ts` — the one active session and the swappable connector, plus the
 *   connect/disconnect API the helpers call.
 * - `connector.ts` — the bring-up sequence and who closes what on the way out.
 * - `bring-up-deadline.ts` — one deadline across that whole sequence, so a stall
 *   becomes an error naming the step it stalled in.
 * - `locate-page.ts` — pairs the native active tab with Playwright's Page.
 * - `frame-timer-patch.ts` — unrefs Playwright's FrameThrottler timers so Node
 *   can still exit.
 * - `native.ts` — how the connector is wired in the real browser.
 */
export {
  activePlaywrightTaskSpace,
  connectPlaywrightTaskSpace,
  disconnectPlaywrightTaskSpace,
  disconnectPlaywrightTaskSpaceForSelection,
  setPlaywrightTaskSpaceConnector,
} from "./taskspace/registry.js";
export { createPlaywrightTaskSpaceConnector } from "./taskspace/connector.js";
export { isPlaywrightFrameThrottlerTimer } from "./taskspace/frame-timer-patch.js";
export {
  createNativePlaywrightTaskSpaceConnector,
  createNativePlaywrightTransport,
} from "./taskspace/native.js";
export type {
  EgoPlaywrightRuntime,
  PlaywrightConnectorDependencies,
  PlaywrightTaskSpaceConnector,
  PlaywrightTaskSpaceSession,
  PlaywrightTransportLease,
} from "./taskspace/types.js";
