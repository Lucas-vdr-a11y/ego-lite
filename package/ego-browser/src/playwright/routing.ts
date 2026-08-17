/**
 * The CDP router between a Playwright client and the native Ego browser.
 *
 * This module is the stable entry point; the implementation lives in
 * `routing/`, one file per concern.
 *
 * The transport itself, and the two directions traffic flows:
 *
 * - `ego-cdp-transport.ts` — the client-facing object: it decides which flow a
 *   command belongs to, owns the connection's lifecycle, and wires together
 *   every collaborator below.
 * - `outbound.ts` — the client's commands on their way to native, including the
 *   ones the transport has to answer out of its own state.
 * - `inbound.ts` — everything native sends, on its way to the client.
 *
 * The state the router keeps:
 *
 * - `types.ts` — the shared shapes, including the `PageRoute` state machine.
 * - `session-tables.ts` — every index from a client id to a native one, and the
 *   tombstones marking work the transport did to itself.
 * - `pending-commands.ts` — the client commands still awaiting a native reply.
 * - `frame-registry.ts` — which frames the client has been told about.
 * - `pending-work.ts` — the aggregate that keeps Node alive while work is open.
 *
 * The individual flows:
 *
 * - `protocol.ts` — pure id and payload translation between the two sides.
 * - `native-commands.ts` — the transport's own commands to native.
 * - `frame-tree-barrier.ts` — holds Target.setAutoAttach until
 *   Page.getFrameTree is answered.
 * - `navigation.ts` — client-driven navigation, including by tab replacement.
 * - `navigation-commit.ts` — waiting for a commit, and announcing it in the
 *   order Playwright expects.
 * - `passive-navigation.ts` — navigations the page started on its own.
 * - `target-lifecycle.ts` — attaching a target into scope, re-pointing a route
 *   at a replacement tab, and closing one down.
 * - `event-admission.ts` — whether the client may see a native event.
 * - `event-delivery.ts` — the last step before an event reaches the client, and
 *   the queue of events that cannot take that step yet.
 * - `popup-discovery.ts` — finds the tabs a page opened for itself.
 */
export {
  createEgoCdpTransport,
  EgoCdpTransport,
} from "./routing/ego-cdp-transport.js";
export { playwrightCompatibilityResult } from "./routing/protocol.js";
export type { EgoCdpRuntime, TransportOptions } from "./routing/types.js";
