import { environmentCase } from "./environment.mjs";
import { helperSurfaceCase } from "./helper-surface.mjs";
import { crossSpaceV2Case, taskSpaceCase } from "./task-space.mjs";
import { navigationCase } from "./navigation.mjs";
import { observationCase } from "./observation.mjs";
import { pointerCase } from "./pointer.mjs";
import { keyboardCase } from "./keyboard.mjs";
import { keyboardRegressionCase } from "./keyboard-regression.mjs";
import { pageKeyboardInterfaceCase } from "./page-keyboard.mjs";
import { pageClickHitTargetCase } from "./page-click-hit-target.mjs";
import { pageDragAndDrawCase } from "./page-drag-and-draw.mjs";
import { pageJavaScriptDialogsCase } from "./page-dialogs.mjs";
import { pageMediaPlaybackCase } from "./page-media-playback.mjs";
import { pageScrolledScreenshotCase } from "./page-screenshot.mjs";
import { pageSnapshotLocatorCase } from "./page-snapshot-locators.mjs";
import { pageLoadStatesCase } from "./page-load-states.mjs";
import { runtimeCase } from "./runtime.mjs";
import { runtimeRegressionCase } from "./runtime-regression.mjs";
import { eventIsolationCase } from "./event-isolation.mjs";
import {
  pageAdoptionCase,
  pageActionsAndPopupCase,
  pageBasicOperationsCase,
  pageComplexEvaluateCase,
  pageFetchCase,
  pageBudgetCase,
  pageLabelCloseCase,
  pageLabelCreateCase,
  pageLabelHardStopCase,
  pageLabelHardStopRestoreCase,
  pageLabelRestoreCase,
} from "./page-labels.mjs";
import {
  portableKeyboardWorkflowCase,
  pureCdpWorkflowCase,
  snapshotWorkflowCase,
  v1V2ActionParityCase,
  visualWorkflowCase,
} from "./workflow-chains.mjs";

export const e2eCases = [
  { name: "environment initialization", body: environmentCase },
  { name: "helper surface", body: helperSurfaceCase },
  { name: "task spaces and control", body: taskSpaceCase },
  { name: "v2 cross-space routing", body: crossSpaceV2Case },
  { name: "navigation helpers", body: navigationCase },
  { name: "observation helpers", body: observationCase },
  { name: "pointer and scroll helpers", body: pointerCase },
  { name: "keyboard and file helpers", body: keyboardCase },
  { name: "keyboard regression", body: keyboardRegressionCase },
  { name: "wait, fetch, cdp, js, help", body: runtimeCase },
  { name: "runtime regression", body: runtimeRegressionCase },
  { name: "target-scoped event isolation", body: eventIsolationCase },
  { name: "page labels: create", body: pageLabelCreateCase },
  { name: "page labels: restore and reuse", body: pageLabelRestoreCase },
  { name: "page labels: close and do not reuse", body: pageLabelCloseCase },
  {
    name: "page labels: persist before hard stop",
    body: pageLabelHardStopCase,
    expectedTermination: true,
    markerName: "hard-stop-page.json",
  },
  {
    name: "page labels: restore after hard stop",
    body: pageLabelHardStopRestoreCase,
  },
  { name: "page inventory and budget", body: pageBudgetCase },
  { name: "page adoption and release", body: pageAdoptionCase },
  { name: "page basic operations", body: pageBasicOperationsCase },
  { name: "page complex evaluate", body: pageComplexEvaluateCase },
  { name: "page fetch", body: pageFetchCase },
  { name: "page actions and popup adoption", body: pageActionsAndPopupCase },
  { name: "Page click hit target", body: pageClickHitTargetCase },
  { name: "Page drag and canvas drawing", body: pageDragAndDrawCase },
  { name: "Page JavaScript dialogs", body: pageJavaScriptDialogsCase },
  { name: "Page media playback", body: pageMediaPlaybackCase },
  { name: "Page scrolled screenshot", body: pageScrolledScreenshotCase },
  { name: "Page snapshot locator quality", body: pageSnapshotLocatorCase },
  { name: "Page load states", body: pageLoadStatesCase },
  { name: "v1 and v2 action parity", body: v1V2ActionParityCase },
  { name: "portable keyboard workflow", body: portableKeyboardWorkflowCase },
  { name: "Page keyboard interface", body: pageKeyboardInterfaceCase },
  { name: "pure CDP workflow", body: pureCdpWorkflowCase },
  { name: "snapshot workflow", body: snapshotWorkflowCase },
  { name: "visual workflow", body: visualWorkflowCase },
];
