import { AriaRefMap } from "./aria-ref-map.js";
import { currentTargetContext } from "./target-context.js";

export const browserAriaRefMap = new AriaRefMap();

export function currentAriaRefMap() {
  return currentTargetContext()?.ariaRefMap || browserAriaRefMap;
}
