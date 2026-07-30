import { pendingDialog } from "../browser-runtime.js";
import { cdp } from "../cdp-eval.js";
import { ElementResolutionError } from "../element-resolver.js";
import type { LocatorTarget } from "../frame-context.js";
import {
  normalizeTimeout,
  operationTimeout,
  remainingTimeout,
  timeoutDeadline,
} from "../playwright-errors.js";
import { state } from "../state.js";
import {
  releaseHandle,
  resolveHandle,
  type ResolvedElementHandle,
} from "./element-ops.js";

export type AriaSnapshotOptions = {
  timeout?: number;
  depth?: number;
  boxes?: boolean;
  mode?: "default" | "ai";
  signal?: AbortSignal;
};

type SnapshotNode = {
  role: string;
  name?: string;
  states: string[];
  properties: { name: string; value: string }[];
  children: SnapshotEntry[];
  box?: [number, number, number, number];
};

type SnapshotEntry = SnapshotNode | string;

type DomMetadata = {
  attributes: Map<string, string>;
  box?: [number, number, number, number];
};

type DomSnapshotData = {
  metadata: Map<number, DomMetadata>;
  subtreeBackendNodeIds: (rootBackendNodeId: number) => Set<number> | undefined;
};

/**
 * Capture a Playwright-style default-mode ARIA snapshot as YAML.
 *
 * The AI mode is intentionally unsupported: ego-browser's agent snapshot uses
 * @N refs and page.snapshot(), while Playwright AI snapshots use aria-ref=eN.
 */
export async function ariaSnapshot(
  target: string | LocatorTarget,
  options: AriaSnapshotOptions = {},
  apiName = "locator.ariaSnapshot",
): Promise<string> {
  const normalized = validateOptions(apiName, options);
  throwIfAborted(normalized.signal, apiName);

  const timeout = normalizeTimeout(
    apiName,
    normalized.timeout ?? state.defaultTimeout,
  );
  const deadline = timeoutDeadline(timeout, state.now());
  let lastError: Error | undefined;

  while (deadline === Number.POSITIVE_INFINITY || state.now() < deadline) {
    throwIfAborted(normalized.signal, apiName);
    assertNoDialog(apiName);
    const cdpTimeoutMs = remainingTimeout(deadline, state.now());
    let handle: ResolvedElementHandle | undefined;
    try {
      handle = await raceWithAbort(
        resolveHandle(target, { cdpTimeoutMs }),
        normalized.signal,
        apiName,
      );
      throwIfAborted(normalized.signal, apiName);
      assertNoDialog(apiName, handle.inputSessionId || handle.sessionId);
      return await captureSnapshot(handle, normalized, deadline, apiName);
    } catch (error) {
      throwIfAborted(normalized.signal, apiName);
      const caught =
        error instanceof Error ? error : new Error(String(error ?? ""));
      if (
        (deadline !== Number.POSITIVE_INFINITY && state.now() >= deadline) ||
        /CDP request timed out/i.test(caught.message)
      ) {
        lastError = caught;
        break;
      }
      if (
        !(error instanceof ElementResolutionError) ||
        error.kind !== "transient"
      ) {
        throw error;
      }
      lastError = error;
    } finally {
      if (handle) {
        await releaseHandle(
          handle.objectId,
          handle.sessionId,
          remainingTimeout(deadline, state.now()),
        );
      }
    }

    if (deadline !== Number.POSITIVE_INFINITY && state.now() >= deadline) {
      break;
    }
    const waitMs =
      deadline === Number.POSITIVE_INFINITY
        ? 100
        : Math.min(100, Math.max(1, deadline - state.now()));
    await raceWithAbort(state.sleep(waitMs), normalized.signal, apiName);
  }

  throw operationTimeout(apiName, timeout, lastError?.message);
}

function validateOptions(
  apiName: string,
  options: AriaSnapshotOptions,
): Required<Pick<AriaSnapshotOptions, "boxes" | "mode">> &
  Omit<AriaSnapshotOptions, "boxes" | "mode"> {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError(`${apiName} options must be an object`);
  }
  if (
    options.depth !== undefined &&
    (!Number.isInteger(options.depth) || options.depth < 0)
  ) {
    throw new TypeError(`${apiName} depth must be a non-negative integer`);
  }
  if (options.boxes !== undefined && typeof options.boxes !== "boolean") {
    throw new TypeError(`${apiName} boxes must be a boolean`);
  }
  if (options.mode === "ai") {
    throw new TypeError(
      `${apiName} mode "ai" is not supported; use page.snapshot() for ego-browser AI refs`,
    );
  }
  if (options.mode !== undefined && options.mode !== "default") {
    throw new TypeError(`${apiName} mode must be "default"`);
  }
  if (options.signal !== undefined && !isAbortSignal(options.signal)) {
    throw new TypeError(`${apiName} signal must be an AbortSignal`);
  }
  if (options.timeout !== undefined) {
    normalizeTimeout(apiName, options.timeout);
  }
  return {
    ...options,
    boxes: options.boxes ?? false,
    mode: "default",
  };
}

async function captureSnapshot(
  handle: ResolvedElementHandle,
  options: ReturnType<typeof validateOptions>,
  deadline: number,
  apiName: string,
) {
  const send = async (method: string, params: any) => {
    throwIfAborted(options.signal, apiName);
    const result = await raceWithAbort(
      cdp(
        method,
        params,
        handle.sessionId,
        remainingTimeout(deadline, state.now()),
      ),
      options.signal,
      apiName,
    );
    throwIfAborted(options.signal, apiName);
    return result;
  };

  const partial = await send("Accessibility.getPartialAXTree", {
    objectId: handle.objectId,
    fetchRelatives: true,
  });
  const partialRoot = partial.nodes?.[0];
  if (!partialRoot?.nodeId) {
    throw new ElementResolutionError(
      "ARIA snapshot root disappeared during capture",
      "transient",
    );
  }

  const full = await send(
    "Accessibility.getFullAXTree",
    handle.frameId ? { frameId: handle.frameId } : {},
  );
  const nodes = full.nodes || [];
  const fullRoot =
    nodes.find((node) => node.nodeId === partialRoot.nodeId) ||
    (partialRoot.backendDOMNodeId !== undefined
      ? nodes.find(
          (node) => node.backendDOMNodeId === partialRoot.backendDOMNodeId,
        )
      : undefined);
  const dom = await send("DOMSnapshot.captureSnapshot", {
    computedStyles: [],
    includeDOMRects: options.boxes,
    includePaintOrder: false,
  });
  const metrics = options.boxes
    ? await send("Page.getLayoutMetrics", {})
    : undefined;
  const domData = domSnapshotData(
    dom,
    handle.frameId,
    handle.frameOffset,
    handle.frameScale,
    options.boxes,
    layoutCoordinateScale(metrics),
  );
  let rootIds: string[];
  if (fullRoot?.nodeId) {
    rootIds = [fullRoot.nodeId];
  } else if (
    (rootIds = rootsMatchedFromPartialRelatives(
      partial.nodes || [],
      partialRoot.nodeId,
      nodes,
    )).length
  ) {
    // Ignored roots such as <body> can be absent from the full AX tree while
    // their accessible children remain. Partial relatives preserve the scope.
  } else if (partialRoot.backendDOMNodeId !== undefined) {
    const subtree = domData.subtreeBackendNodeIds(partialRoot.backendDOMNodeId);
    if (!subtree) {
      throw changedRootError(partialRoot, nodes, partial.nodes || []);
    }
    const candidates = nodes.filter(
      (node) =>
        node.nodeId &&
        node.backendDOMNodeId !== undefined &&
        subtree.has(node.backendDOMNodeId),
    );
    const candidateIds = new Set(candidates.map((node) => node.nodeId));
    rootIds = candidates
      .filter((node) => !candidateIds.has(node.parentId))
      .map((node) => node.nodeId);
    if (!rootIds.length && !isHidden(partialRoot) && subtree.size > 1) {
      throw changedRootError(partialRoot, nodes, partial.nodes || []);
    }
  } else {
    throw changedRootError(partialRoot, nodes, partial.nodes || []);
  }

  const entries = rootIds.flatMap((rootId) =>
    buildSnapshotEntries(nodes, rootId, domData.metadata),
  );
  return renderEntries(entries, options.depth);
}

function rootsMatchedFromPartialRelatives(
  partialNodes: any[],
  partialRootId: string,
  fullNodes: any[],
) {
  const partialById = new Map(partialNodes.map((node) => [node.nodeId, node]));
  const descendantIds = new Set<string>();
  const pending = [...(partialById.get(partialRootId)?.childIds || [])];
  while (pending.length) {
    const nodeId = pending.pop();
    if (!nodeId || descendantIds.has(nodeId)) continue;
    descendantIds.add(nodeId);
    pending.push(...(partialById.get(nodeId)?.childIds || []));
  }

  const fullById = new Map(fullNodes.map((node) => [node.nodeId, node]));
  const fullByBackendNodeId = new Map(
    fullNodes
      .filter((node) => node.backendDOMNodeId !== undefined)
      .map((node) => [node.backendDOMNodeId, node]),
  );
  const matched = [];
  for (const partialNodeId of descendantIds) {
    const partialNode = partialById.get(partialNodeId);
    if (!partialNode) continue;
    const fullNode =
      fullById.get(partialNode.nodeId) ||
      fullByBackendNodeId.get(partialNode.backendDOMNodeId);
    if (fullNode?.nodeId) matched.push(fullNode);
  }
  const matchedIds = new Set(matched.map((node) => node.nodeId));
  return matched
    .filter((node) => !matchedIds.has(node.parentId))
    .map((node) => node.nodeId);
}

function changedRootError(
  partialRoot: any,
  nodes: any[],
  partialNodes: any[] = [],
) {
  const sample = nodes.slice(0, 5).map((node) => ({
    nodeId: node.nodeId,
    backendDOMNodeId: node.backendDOMNodeId,
    role: valueOf(node.role),
    frameId: node.frameId,
  }));
  const partialSample = partialNodes.slice(0, 5).map((node) => ({
    nodeId: node.nodeId,
    parentId: node.parentId,
    childIds: node.childIds,
    backendDOMNodeId: node.backendDOMNodeId,
    role: valueOf(node.role),
    frameId: node.frameId,
  }));
  return new ElementResolutionError(
    `ARIA snapshot root changed during capture: partial=${JSON.stringify({
      nodeId: partialRoot.nodeId,
      backendDOMNodeId: partialRoot.backendDOMNodeId,
      role: valueOf(partialRoot.role),
      frameId: partialRoot.frameId,
    })}, partialNodes=${JSON.stringify(partialSample)}, full=${JSON.stringify(sample)}`,
    "transient",
  );
}

function buildSnapshotEntries(
  nodes: any[],
  rootId: string,
  metadata: Map<number, DomMetadata>,
) {
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const childrenByParent = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const children = childrenByParent.get(node.parentId) || [];
    children.push(node.nodeId);
    childrenByParent.set(node.parentId, children);
  }

  const visit = (nodeId: string): SnapshotEntry[] => {
    const node = byId.get(nodeId);
    if (!node || isHidden(node)) return [];

    const childIds = node.childIds || childrenByParent.get(nodeId) || [];
    const children = mergeText(childIds.flatMap((childId) => visit(childId)));
    const role = normalizedRole(valueOf(node.role));
    if (role === "InlineTextBox" || role === "listmarker") return [];
    if (role === "text") {
      const text = normalizeText(valueOf(node.name));
      return text ? [text] : [];
    }

    const name = normalizeText(valueOf(node.name));
    if (
      node.ignored ||
      role === "none" ||
      role === "presentation" ||
      role === "RootWebArea" ||
      role === "WebArea" ||
      (role === "generic" && !name)
    ) {
      return children;
    }

    if (children.length === 1 && typeof children[0] === "string") {
      if (children[0] === name) children.length = 0;
    }

    const dom = metadata.get(node.backendDOMNodeId);
    const properties = nodeProperties(node, dom);
    const value = normalizeText(valueOf(node.value));
    if (
      value &&
      !(
        children.length === 1 &&
        typeof children[0] === "string" &&
        children[0] === value
      )
    ) {
      children.push(value);
    }

    return [
      {
        role,
        ...(name ? { name } : {}),
        states: nodeStates(node, dom),
        properties,
        children: mergeText(children),
        ...(dom?.box ? { box: dom.box } : {}),
      },
    ];
  };

  return visit(rootId);
}

function normalizedRole(role: string) {
  if (role === "StaticText") return "text";
  if (role === "image") return "img";
  if (
    role === "RootWebArea" ||
    role === "WebArea" ||
    role === "InlineTextBox"
  ) {
    return role;
  }
  return role.toLowerCase();
}

function isHidden(node: any) {
  if (propertyValue(node, "hidden") === true) return true;
  return (node.ignoredReasons || []).some((reason) =>
    /hidden|notRendered|notVisible/i.test(String(reason?.name || "")),
  );
}

function nodeStates(node: any, dom?: DomMetadata) {
  const states: string[] = [];
  const checked = propertyValue(node, "checked");
  if (isTrueState(checked)) states.push("checked");
  else if (checked === "mixed") states.push("checked=mixed");
  if (isTrueState(propertyValue(node, "disabled"))) states.push("disabled");
  if (isTrueState(propertyValue(node, "expanded"))) states.push("expanded");

  const invalid = propertyValue(node, "invalid");
  if (invalid === true || invalid === "true") states.push("invalid");
  else if (invalid && invalid !== "false") states.push(`invalid=${invalid}`);

  const level = propertyValue(node, "level");
  if (
    level !== undefined &&
    (normalizedRole(valueOf(node.role)) === "heading" ||
      dom?.attributes.has("aria-level"))
  ) {
    states.push(`level=${level}`);
  }

  const pressed = propertyValue(node, "pressed");
  if (pressed === true || pressed === "true") states.push("pressed");
  else if (pressed === "mixed") states.push("pressed=mixed");
  if (isTrueState(propertyValue(node, "selected"))) states.push("selected");
  return states;
}

function isTrueState(value: unknown) {
  return value === true || value === "true";
}

function nodeProperties(node: any, dom?: DomMetadata) {
  const properties: { name: string; value: string }[] = [];
  if (dom?.attributes.has("href")) {
    properties.push({
      name: "url",
      value: truncateDataUrl(dom.attributes.get("href") || ""),
    });
  } else {
    const href = normalizeText(propertyValue(node, "url"));
    if (href) properties.push({ name: "url", value: truncateDataUrl(href) });
  }
  const placeholder = dom?.attributes.get("placeholder");
  if (
    dom?.attributes.has("placeholder") &&
    placeholder !== normalizeText(valueOf(node.name))
  ) {
    properties.push({ name: "placeholder", value: placeholder });
  }
  return properties;
}

function propertyValue(node: any, name: string) {
  return valueOf(
    (node.properties || []).find((property) => property.name === name)?.value,
  );
}

function valueOf(value: any) {
  return value?.value ?? value ?? "";
}

function mergeText(entries: SnapshotEntry[]) {
  const merged: SnapshotEntry[] = [];
  for (const entry of entries) {
    if (!entry) continue;
    if (
      typeof entry === "string" &&
      typeof merged[merged.length - 1] === "string"
    ) {
      merged[merged.length - 1] = normalizeText(
        `${merged[merged.length - 1]} ${entry}`,
      );
    } else {
      merged.push(entry);
    }
  }
  return merged;
}

function domSnapshotData(
  snapshot: any,
  frameId?: string,
  frameOffset = { x: 0, y: 0 },
  frameScale = { x: 1, y: 1 },
  includeBoxes = false,
  coordinateScale = { x: 1, y: 1 },
): DomSnapshotData {
  const strings = snapshot.strings || [];
  const result = new Map<number, DomMetadata>();
  const childrenByBackendNodeId = new Map<number, number[]>();
  const backendNodeIds = new Set<number>();
  const documents = snapshot.documents || [];
  const selected = frameId
    ? documents.filter((document) => strings[document.frameId] === frameId)
    : documents;
  for (const document of selected.length ? selected : documents) {
    const nodes = document.nodes || {};
    const layouts = document.layout || {};
    const boxes = new Map<number, number[]>();
    for (let index = 0; index < (layouts.nodeIndex || []).length; index += 1) {
      boxes.set(layouts.nodeIndex[index], layouts.bounds?.[index]);
    }
    for (
      let nodeIndex = 0;
      nodeIndex < (nodes.backendNodeId || []).length;
      nodeIndex += 1
    ) {
      const backendNodeId = nodes.backendNodeId[nodeIndex];
      if (!backendNodeId) continue;
      backendNodeIds.add(backendNodeId);
      const parentIndex = nodes.parentIndex?.[nodeIndex];
      const parentBackendNodeId =
        parentIndex >= 0 ? nodes.backendNodeId[parentIndex] : undefined;
      if (parentBackendNodeId) {
        const children = childrenByBackendNodeId.get(parentBackendNodeId) || [];
        children.push(backendNodeId);
        childrenByBackendNodeId.set(parentBackendNodeId, children);
      }
      const attributes = new Map<string, string>();
      const encoded = nodes.attributes?.[nodeIndex] || [];
      for (let index = 0; index < encoded.length; index += 2) {
        const name = strings[encoded[index]];
        const value = strings[encoded[index + 1]];
        if (name !== undefined) attributes.set(name, value ?? "");
      }
      const rawBox = includeBoxes ? boxes.get(nodeIndex) : undefined;
      result.set(backendNodeId, {
        attributes,
        ...(rawBox
          ? {
              box: [
                roundBox(
                  frameOffset.x +
                    (rawBox[0] - Number(document.scrollOffsetX || 0)) *
                      coordinateScale.x *
                      frameScale.x,
                ),
                roundBox(
                  frameOffset.y +
                    (rawBox[1] - Number(document.scrollOffsetY || 0)) *
                      coordinateScale.y *
                      frameScale.y,
                ),
                roundBox(rawBox[2] * coordinateScale.x * frameScale.x),
                roundBox(rawBox[3] * coordinateScale.y * frameScale.y),
              ] as [number, number, number, number],
            }
          : {}),
      });
    }
  }
  return {
    metadata: result,
    subtreeBackendNodeIds(rootBackendNodeId) {
      if (!backendNodeIds.has(rootBackendNodeId)) return undefined;
      const subtree = new Set<number>();
      const pending = [rootBackendNodeId];
      while (pending.length) {
        const current = pending.pop();
        if (current === undefined || subtree.has(current)) continue;
        subtree.add(current);
        pending.push(...(childrenByBackendNodeId.get(current) || []));
      }
      return subtree;
    },
  };
}

function renderEntries(entries: SnapshotEntry[], maxDepth?: number) {
  const lines: string[] = [];
  const effectiveDepth = maxDepth || undefined;
  for (const entry of entries) renderEntry(entry, 0, effectiveDepth, lines);
  return lines.join("\n");
}

function renderEntry(
  entry: SnapshotEntry,
  depth: number,
  maxDepth: number | undefined,
  lines: string[],
) {
  const indent = "  ".repeat(depth);
  if (typeof entry === "string") {
    lines.push(`${indent}- text: ${yamlScalar(entry)}`);
    return;
  }

  let key = entry.role;
  if (entry.name && entry.name.length <= 900) {
    key += ` ${JSON.stringify(entry.name)}`;
  }
  for (const state of entry.states) key += ` [${state}]`;
  if (entry.box) key += ` [box=${entry.box.join(",")}]`;

  const singleTextChild =
    entry.properties.length === 0 &&
    entry.children.length === 1 &&
    typeof entry.children[0] === "string"
      ? entry.children[0]
      : undefined;
  const atDepthLimit = maxDepth !== undefined && depth >= maxDepth;
  if (singleTextChild !== undefined) {
    lines.push(`${indent}- ${yamlKey(key)}: ${yamlScalar(singleTextChild)}`);
    return;
  }
  if (!entry.properties.length && (!entry.children.length || atDepthLimit)) {
    lines.push(`${indent}- ${yamlKey(key)}`);
    return;
  }

  lines.push(`${indent}- ${yamlKey(key)}:`);
  for (const property of entry.properties) {
    lines.push(`${indent}  - /${property.name}: ${yamlScalar(property.value)}`);
  }
  for (const child of entry.children) {
    if (atDepthLimit) break;
    renderEntry(child, depth + 1, maxDepth, lines);
  }
}

function yamlScalar(value: string) {
  const text = normalizeText(value);
  return yamlStringNeedsQuotes(text) ? JSON.stringify(text) : text;
}

function yamlKey(value: string) {
  if (!yamlStringNeedsQuotes(value)) return value;
  return `'${value.replace(/'/g, "''")}'`;
}

function yamlStringNeedsQuotes(value: string) {
  return (
    value.length === 0 ||
    /^\s|\s$/.test(value) ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(value) ||
    /^-/.test(value) ||
    /[\n:](\s|$)/.test(value) ||
    /\s#/.test(value) ||
    /[\n\r]/.test(value) ||
    /^[&*\],?!>|@"'#%]/.test(value) ||
    /[{}`]/.test(value) ||
    /^\[/.test(value) ||
    !Number.isNaN(Number(value)) ||
    ["y", "n", "yes", "no", "true", "false", "on", "off", "null"].includes(
      value.toLowerCase(),
    )
  );
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .replace(/[\u200b\u00ad]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function roundBox(value: number) {
  return Math.round(value * 100) / 100;
}

function layoutCoordinateScale(metrics: any) {
  const layout = metrics?.layoutViewport;
  const css = metrics?.cssLayoutViewport;
  const x =
    Number(layout?.clientWidth) > 0 && Number(css?.clientWidth) > 0
      ? Number(css.clientWidth) / Number(layout.clientWidth)
      : 1;
  const y =
    Number(layout?.clientHeight) > 0 && Number(css?.clientHeight) > 0
      ? Number(css.clientHeight) / Number(layout.clientHeight)
      : x;
  return {
    x: Number.isFinite(x) && x > 0 ? x : 1,
    y: Number.isFinite(y) && y > 0 ? y : 1,
  };
}

function truncateDataUrl(url: string) {
  if (!url.startsWith("data:")) return url;
  const comma = url.indexOf(",");
  return comma === -1 ? url : `${url.slice(0, comma + 1)}…`;
}

function assertNoDialog(apiName: string, sessionId?: string) {
  if (pendingDialog(sessionId)) {
    throw new Error(
      `${apiName} cannot capture while a JavaScript dialog is open`,
    );
  }
}

function throwIfAborted(signal: AbortSignal | undefined, apiName: string) {
  if (!signal?.aborted) return;
  throw abortReason(signal, apiName);
}

function abortReason(signal: AbortSignal, apiName: string) {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error(`${apiName} was aborted`);
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as AbortSignal).aborted === "boolean" &&
    typeof (value as AbortSignal).addEventListener === "function" &&
    typeof (value as AbortSignal).removeEventListener === "function",
  );
}

function raceWithAbort<T>(
  operation: Promise<T>,
  signal: AbortSignal | undefined,
  apiName: string,
) {
  if (!signal) return operation;
  throwIfAborted(signal, apiName);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal, apiName));
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}
