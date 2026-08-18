import { environmentCase } from "./environment.mjs";
import { helperSurfaceCase } from "./helper-surface.mjs";
import { taskSpaceCase } from "./task-space.mjs";
import { navigationCase } from "./navigation.mjs";
import { observationCase } from "./observation.mjs";
import { pointerCase } from "./pointer.mjs";
import { keyboardCase } from "./keyboard.mjs";
import { keyboardRegressionCase } from "./keyboard-regression.mjs";
import { runtimeCase } from "./runtime.mjs";
import { runtimeRegressionCase } from "./runtime-regression.mjs";
import { eventIsolationCase } from "./event-isolation.mjs";

export const e2eCases = [
  { name: "environment initialization", body: environmentCase },
  { name: "helper surface", body: helperSurfaceCase },
  { name: "task spaces and control", body: taskSpaceCase },
  { name: "navigation helpers", body: navigationCase },
  { name: "observation helpers", body: observationCase },
  { name: "pointer and scroll helpers", body: pointerCase },
  { name: "keyboard and file helpers", body: keyboardCase },
  { name: "keyboard regression", body: keyboardRegressionCase },
  { name: "wait, fetch, cdp, js, help", body: runtimeCase },
  { name: "runtime regression", body: runtimeRegressionCase },
  { name: "target-scoped event isolation", body: eventIsolationCase },
];
