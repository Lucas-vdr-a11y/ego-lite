import { taskSpaceCase } from "./task-space.mjs";
import { nativeTaskSpaceCloseRegressionCase } from "./native-task-space-close-regression.mjs";
import { playwrightTaskSpaceCase } from "./playwright-taskspace.mjs";
import { taskSpaceContextLifecycleCase } from "./task-space-context-lifecycle.mjs";
import { webTestSiteCases } from "./web-test-site.mjs";

export const e2eCases = [
  {
    name: "TaskSpace context lifecycle",
    body: taskSpaceContextLifecycleCase,
  },
  ...webTestSiteCases,
  { name: "task spaces and control", body: taskSpaceCase },
  { name: "native Playwright TaskSpace", body: playwrightTaskSpaceCase },
  nativeTaskSpaceCloseRegressionCase,
];
