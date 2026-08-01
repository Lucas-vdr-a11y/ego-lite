import { taskSpaceCase } from "./task-space.mjs";
import { nativeTaskSpaceCloseRegressionCase } from "./native-task-space-close-regression.mjs";
import { playwrightTaskSpaceCase } from "./playwright-taskspace.mjs";
import { taskSpaceContextLifecycleCase } from "./task-space-context-lifecycle.mjs";

export const e2eCases = [
  {
    name: "TaskSpace context lifecycle",
    body: taskSpaceContextLifecycleCase,
  },
  { name: "task spaces and control", body: taskSpaceCase },
  { name: "native Playwright TaskSpace", body: playwrightTaskSpaceCase },
  nativeTaskSpaceCloseRegressionCase,
];
