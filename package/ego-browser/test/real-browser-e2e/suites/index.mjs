import { agentMouseOverlayCase } from "./platform/agent-mouse-overlay.mjs";
import { ariaSnapshotCase } from "./platform/aria-snapshot.mjs";
import { nativeCloseRegressionCase } from "./platform/close-regression.mjs";
import { contextLifecycleCase } from "./platform/context-lifecycle.mjs";
import {
  crossRoundOopifPersistenceCase,
  crossRoundPersistenceCase,
} from "./platform/cross-round-persistence.mjs";
import { duplicateTaskSpaceNameCase } from "./platform/duplicate-name.mjs";
import { nativeCallbackContainmentCase } from "./platform/native-callback-containment.mjs";
import { nativePlaywrightCase } from "./platform/native-playwright.mjs";
import { networkRoutingCase } from "./platform/network-routing.mjs";
import { ownershipLifecycleCase } from "./platform/ownership-lifecycle.mjs";
import { playwrightCdpSessionCase } from "./platform/playwright-cdp-session.mjs";
import { taskSpaceProfileCase } from "./platform/profile-selection.mjs";
import { taskSpaceProcessContentionCase } from "./platform/process-contention.mjs";
import { taskSpaceControlCase } from "./platform/taskspace-control.mjs";
import { taskSpaceVideoCapabilityCase } from "./platform/video-capability.mjs";
import { scenarioProgressCase } from "./runtime/scenario-progress.mjs";
import { sdkGlobalLifecycleCase } from "./runtime/sdk-global-lifecycle.mjs";
import { scenarioCases } from "./scenarios/index.mjs";

export const e2eCases = [
  {
    name: "SDK global lifecycle",
    kind: "runtime",
    body: sdkGlobalLifecycleCase,
  },
  {
    name: "TaskSpace context lifecycle",
    kind: "platform",
    body: contextLifecycleCase,
  },
  taskSpaceProfileCase,
  crossRoundPersistenceCase,
  crossRoundOopifPersistenceCase,
  duplicateTaskSpaceNameCase,
  taskSpaceProcessContentionCase,
  ownershipLifecycleCase,
  {
    name: "TaskSpace video capability",
    kind: "platform",
    body: taskSpaceVideoCapabilityCase,
  },
  ...scenarioCases,
  scenarioProgressCase,
  {
    name: "task spaces and control",
    kind: "platform",
    body: taskSpaceControlCase,
  },
  {
    name: "native Playwright TaskSpace",
    kind: "platform",
    body: nativePlaywrightCase,
  },
  ariaSnapshotCase,
  agentMouseOverlayCase,
  playwrightCdpSessionCase,
  networkRoutingCase,
  nativeCloseRegressionCase,
  nativeCallbackContainmentCase,
];
