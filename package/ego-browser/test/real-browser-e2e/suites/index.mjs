import { ariaSnapshotCase } from "./platform/aria-snapshot.mjs";
import { nativeCloseRegressionCase } from "./platform/close-regression.mjs";
import { contextLifecycleCase } from "./platform/context-lifecycle.mjs";
import { crossRoundPersistenceCase } from "./platform/cross-round-persistence.mjs";
import { nativePlaywrightCase } from "./platform/native-playwright.mjs";
import { networkRoutingCase } from "./platform/network-routing.mjs";
import { ownershipLifecycleCase } from "./platform/ownership-lifecycle.mjs";
import { taskSpaceControlCase } from "./platform/taskspace-control.mjs";
import { taskSpaceVideoCapabilityCase } from "./platform/video-capability.mjs";
import { scenarioProgressCase } from "./runtime/scenario-progress.mjs";
import { scenarioCases } from "./scenarios/index.mjs";

export const e2eCases = [
  {
    name: "TaskSpace context lifecycle",
    kind: "platform",
    body: contextLifecycleCase,
  },
  crossRoundPersistenceCase,
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
  networkRoutingCase,
  nativeCloseRegressionCase,
];
