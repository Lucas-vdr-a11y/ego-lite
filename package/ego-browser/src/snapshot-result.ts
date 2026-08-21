import { resolveElementObjectId } from "./element-resolver.js";
import { RefMap } from "./ref-map.js";

type SnapshotRef = {
  backendNodeId?: number;
  frameId?: string;
  loc?: string;
  name?: string;
  refId?: number | string;
  role?: string;
};

type SnapshotResult = {
  content?: string;
  refs?: SnapshotRef[];
};

type CdpAdapter = {
  sendRaw(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
  ): Promise<any>;
};

type SnapshotServices = {
  cdp(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
  ): Promise<any>;
};

/**
 * Add frame provenance that older native snapshots omit.
 *
 * One AX-tree read per frame is enough to map every unique backend node in the
 * snapshot. Repeated backend ids cannot be disambiguated without native
 * `refId`/`frameId` support, so those refs deliberately remain unscoped.
 */
export async function enrichSnapshotRefFrames(
  services: SnapshotServices,
  pageSessionId: string,
  iframeSessions: Map<string, string>,
  refs: SnapshotRef[] = [],
): Promise<void> {
  if (!(iframeSessions instanceof Map) || iframeSessions.size === 0) return;

  const refsByBackendNode = new Map<number, SnapshotRef[]>();
  for (const ref of refs) {
    if (ref.frameId || !Number.isInteger(ref.backendNodeId)) continue;
    const matches = refsByBackendNode.get(ref.backendNodeId!) || [];
    matches.push(ref);
    refsByBackendNode.set(ref.backendNodeId!, matches);
  }
  if (refsByBackendNode.size === 0) return;

  for (const [frameId, frameSessionId] of iframeSessions) {
    const sameProcess = frameSessionId === pageSessionId;
    let tree;
    try {
      tree = await services.cdp(
        "Accessibility.getFullAXTree",
        sameProcess ? { frameId } : {},
        frameSessionId,
      );
    } catch {
      continue;
    }
    for (const node of tree?.nodes || []) {
      const backendNodeId = node?.backendDOMNodeId;
      const matches = refsByBackendNode.get(backendNodeId);
      if (matches?.length !== 1 || matches[0].frameId) continue;
      matches[0].frameId = frameId;
    }
  }
}

/** Return whether one advertised locator resolves uniquely to its source ref. */
export async function validateSnapshotLocator(
  cdp: CdpAdapter,
  pageSessionId: string,
  iframeSessions: Map<string, string>,
  ref: SnapshotRef,
): Promise<boolean> {
  if (
    !Number.isInteger(ref.backendNodeId) ||
    typeof ref.loc !== "string" ||
    ref.loc.length === 0 ||
    ref.loc === "unstable" ||
    ref.loc === "ambiguous"
  ) {
    return false;
  }

  let resolved:
    | { objectId: string; sessionId: string; frameId?: string }
    | undefined;
  try {
    resolved = await resolveElementObjectId(
      cdp,
      pageSessionId,
      new RefMap(),
      ref.loc.startsWith("loc=") ? ref.loc : `loc=${ref.loc}`,
      iframeSessions,
      { strict: true, strictGlobal: true },
    );
    const described = await cdp.sendRaw(
      "DOM.describeNode",
      { objectId: resolved.objectId, depth: 0 },
      resolved.sessionId,
    );
    return described?.node?.backendNodeId === ref.backendNodeId;
  } catch {
    // Invalid, missing, and ambiguous native locators are all unsafe to expose.
    return false;
  } finally {
    if (resolved?.objectId) {
      await cdp
        .sendRaw(
          "Runtime.releaseObject",
          { objectId: resolved.objectId },
          resolved.sessionId,
        )
        .catch(() => {});
    }
  }
}

/** Replace invalid native stable locators while retaining their short-lived refs. */
export async function sanitizeSnapshotLocators(
  result: SnapshotResult,
  validator: (ref: SnapshotRef) => Promise<boolean>,
): Promise<SnapshotResult> {
  if (!Array.isArray(result?.refs)) return result;

  for (const ref of result.refs) {
    const locator = ref?.loc;
    if (
      typeof locator !== "string" ||
      locator === "unstable" ||
      locator === "ambiguous"
    ) {
      continue;
    }
    if (await validator(ref)) continue;

    ref.loc = "unstable";
    const refId = ref.refId ?? ref.backendNodeId;
    if (typeof result.content === "string" && refId !== undefined) {
      result.content = result.content.replaceAll(
        `ref=${refId}, loc=${locator}`,
        `ref=${refId}, loc=unstable`,
      );
    }
  }
  return result;
}

/** Prepare one native snapshot for the Page API without changing its text shape. */
export async function preparePageSnapshotResult(
  services: SnapshotServices,
  pageSessionId: string,
  iframeSessions: Map<string, string>,
  result: SnapshotResult,
): Promise<SnapshotResult> {
  await enrichSnapshotRefFrames(
    services,
    pageSessionId,
    iframeSessions,
    result?.refs || [],
  );
  const adapter: CdpAdapter = {
    sendRaw: (method, params = {}, sessionId) =>
      services.cdp(method, params, sessionId),
  };
  return sanitizeSnapshotLocators(result, (ref) =>
    validateSnapshotLocator(adapter, pageSessionId, iframeSessions, ref),
  );
}
