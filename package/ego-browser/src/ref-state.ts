import { parseRef, RefMap } from "./ref-map.js";
import { currentTargetContext } from "./target-context.js";

export const browserRefMap = new RefMap();

const ensuring = new WeakSet<RefMap>();
let snapshotImpl: (() => Promise<unknown>) | null = null;

export function currentRefMap() {
  return currentTargetContext()?.refMap || browserRefMap;
}

export function registerSnapshotForRefRefresh(fn: () => Promise<unknown>) {
  snapshotImpl = fn;
}

export async function ensureRefMapForRef(selectorOrRef: unknown) {
  if (typeof selectorOrRef !== "string") return;
  if (!parseRef(selectorOrRef)) return;
  const targetContext = currentTargetContext();
  const refMap = targetContext?.refMap || browserRefMap;
  if (ensuring.has(refMap) || refMap.map.size > 0) return;
  const refresh = targetContext?.snapshotForRefRefresh || snapshotImpl;
  if (!refresh) return;
  ensuring.add(refMap);
  try {
    await refresh();
  } finally {
    ensuring.delete(refMap);
  }
}
