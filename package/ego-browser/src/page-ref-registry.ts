import { RefMap } from "./ref-map.js";

type SnapshotRef = {
  backendNodeId?: number;
  role?: string;
  name?: string;
};

/**
 * Keeps native snapshot refs isolated by browser target. The printed ref stays
 * compact (`@21`), while the Page carrying the target id supplies its scope.
 */
export class PageRefRegistry {
  readonly #targets = new Map<string, RefMap>();

  forTarget(targetId: string): RefMap {
    assertTargetId(targetId);
    let refs = this.#targets.get(targetId);
    if (!refs) {
      refs = new RefMap();
      this.#targets.set(targetId, refs);
    }
    return refs;
  }

  replace(targetId: string, snapshotRefs: SnapshotRef[] = []): RefMap {
    assertTargetId(targetId);
    const refs = new RefMap();
    for (const ref of snapshotRefs) {
      if (
        !ref ||
        typeof ref !== "object" ||
        ref.backendNodeId === undefined ||
        ref.backendNodeId === null
      ) {
        continue;
      }
      refs.add(
        String(ref.backendNodeId),
        ref.backendNodeId,
        ref.role,
        ref.name,
      );
    }
    this.#targets.set(targetId, refs);
    return refs;
  }

  clear(targetId: string): void {
    assertTargetId(targetId);
    this.#targets.delete(targetId);
  }
}

function assertTargetId(targetId: string): void {
  if (typeof targetId !== "string" || targetId.length === 0) {
    throw new TypeError("PageRefRegistry requires a non-empty targetId");
  }
}
