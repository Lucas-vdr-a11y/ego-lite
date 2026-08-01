import { taskSpaceCase } from "./task-space.mjs";
import { nativeTaskSpaceCloseRegressionCase } from "./playwright/native-close-regression.mjs";
import { playwrightTaskSpaceCase } from "./playwright/taskspace.mjs";
import { taskSpaceContextLifecycleCase } from "./playwright/context-lifecycle.mjs";
import { videoCapabilityCase } from "./playwright/video-capability.mjs";
import { webTestSiteCases } from "./web-test-site.mjs";

export const e2eCases = [
  {
    name: "TaskSpace context lifecycle",
    body: taskSpaceContextLifecycleCase,
  },
  {
    name: "TaskSpace video capability",
    body: videoCapabilityCase,
  },
  ...webTestSiteCases,
  { name: "task spaces and control", body: taskSpaceCase },
  { name: "native Playwright TaskSpace", body: playwrightTaskSpaceCase },
  nativeTaskSpaceCloseRegressionCase,
];
