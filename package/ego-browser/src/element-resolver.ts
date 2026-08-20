import { parseRef } from "./ref-map.js";

export class ElementResolutionError extends Error {
  kind: "transient" | "permanent";
  constructor(message: string, kind: "transient" | "permanent") {
    super(message);
    this.name = "ElementResolutionError";
    this.kind = kind;
  }
}

function exceptionText(result: any) {
  const d = result?.exceptionDetails;
  return d?.exception?.description || d?.text || "evaluation error";
}

function matchCountKind(message: string): "transient" | "permanent" {
  const m = /matched (\d+)/.exec(message);
  const n = m ? Number(m[1]) : 0;
  return n > 1 ? "permanent" : "transient";
}

export async function resolveElementCenter(
  cdp,
  sessionId,
  refMap,
  selectorOrRef,
  iframeSessions = new Map(),
) {
  const refId = parseRef(selectorOrRef);
  if (refId) {
    const entry = refMap.get(refId);
    if (!entry) {
      throw new ElementResolutionError(`Unknown ref: ${refId}`, "transient");
    }
    const effectiveSessionId = resolveFrameSession(
      entry.frameId,
      sessionId,
      iframeSessions,
    );
    if (entry.backendNodeId !== undefined && entry.backendNodeId !== null) {
      try {
        const result = await send(
          cdp,
          "DOM.getBoxModel",
          { backendNodeId: entry.backendNodeId },
          effectiveSessionId,
        );
        return {
          ...boxModelCenter(result.model),
          sessionId: effectiveSessionId,
        };
      } catch (error) {
        if (error instanceof ElementResolutionError) {
          // The node resolved but has no usable box model (not rendered yet).
          // Propagate the retryable state instead of falling back to role/name,
          // which could silently target a different node with the same label.
          throw error;
        }
        // The backend node can become stale after DOM updates; fall back to role/name lookup below.
      }
    }
    const backendNodeId = await findBackendNodeIdByRoleName(
      cdp,
      sessionId,
      entry.role,
      entry.name,
      entry.nth,
      entry.frameId,
      iframeSessions,
    );
    const result = await send(
      cdp,
      "DOM.getBoxModel",
      { backendNodeId },
      effectiveSessionId,
    );
    return { ...boxModelCenter(result.model), sessionId: effectiveSessionId };
  }

  const locator = parseLocator(selectorOrRef);
  if (locator) {
    return resolveLocatorCenter(cdp, sessionId, locator, iframeSessions);
  }

  for (const candidateSessionId of pageSessions(sessionId, iframeSessions)) {
    const result = await send(
      cdp,
      "Runtime.evaluate",
      {
        expression: buildSelectorCenterJs(selectorOrRef),
        returnByValue: true,
        awaitPromise: false,
      },
      candidateSessionId,
    );
    if (result.exceptionDetails) {
      throw invalidSelectorError(selectorOrRef, result);
    }
    const value = result.result?.value;
    if (typeof value?.x === "number" && typeof value?.y === "number") {
      return { x: value.x, y: value.y, sessionId: candidateSessionId };
    }
  }
  throw new ElementResolutionError(
    `Element not found: ${selectorOrRef}`,
    "transient",
  );
}

export async function resolveElementObjectId(
  cdp,
  sessionId,
  refMap,
  selectorOrRef,
  iframeSessions = new Map(),
  options: { strict?: boolean } = {},
): Promise<{ objectId: string; sessionId: string; frameId?: string }> {
  const refId = parseRef(selectorOrRef);
  if (refId) {
    const entry = refMap.get(refId);
    if (!entry) {
      throw new ElementResolutionError(`Unknown ref: ${refId}`, "transient");
    }
    const effectiveSessionId = resolveFrameSession(
      entry.frameId,
      sessionId,
      iframeSessions,
    );
    if (entry.backendNodeId !== undefined && entry.backendNodeId !== null) {
      try {
        const result = await send(
          cdp,
          "DOM.resolveNode",
          {
            backendNodeId: entry.backendNodeId,
            objectGroup: "ego-browser",
          },
          effectiveSessionId,
        );
        const objectId = result.object?.objectId;
        if (objectId) {
          return {
            objectId,
            sessionId: effectiveSessionId,
            ...(entry.frameId && effectiveSessionId === sessionId
              ? { frameId: entry.frameId }
              : {}),
          };
        }
      } catch {
        // The backend node can become stale after DOM updates; fall back to role/name lookup below.
      }
    }
    const backendNodeId = await findBackendNodeIdByRoleName(
      cdp,
      sessionId,
      entry.role,
      entry.name,
      entry.nth,
      entry.frameId,
      iframeSessions,
    );
    const result = await send(
      cdp,
      "DOM.resolveNode",
      { backendNodeId, objectGroup: "ego-browser" },
      effectiveSessionId,
    );
    const objectId = result.object?.objectId;
    if (!objectId) {
      throw new ElementResolutionError(
        `No objectId for ref ${refId}`,
        "permanent",
      );
    }
    return {
      objectId,
      sessionId: effectiveSessionId,
      ...(entry.frameId && effectiveSessionId === sessionId
        ? { frameId: entry.frameId }
        : {}),
    };
  }

  const locator = parseLocator(selectorOrRef);
  if (locator) {
    return resolveLocatorObjectId(cdp, sessionId, locator, iframeSessions);
  }

  const sessions = pageSessions(sessionId, iframeSessions);
  if (options.strict) {
    return resolveRawSelectorObjectId(
      cdp,
      sessions,
      parseRawSelector(selectorOrRef),
    );
  }
  for (const candidateSessionId of sessions) {
    const result = await send(
      cdp,
      "Runtime.evaluate",
      {
        expression: buildFindElementJs(selectorOrRef),
        returnByValue: false,
        awaitPromise: false,
        objectGroup: "ego-browser",
      },
      candidateSessionId,
    );
    if (result.exceptionDetails) {
      throw invalidSelectorError(selectorOrRef, result);
    }
    const objectId = result.result?.objectId;
    if (objectId) return { objectId, sessionId: candidateSessionId };
  }
  throw new ElementResolutionError(
    `Element not found: ${selectorOrRef}`,
    "transient",
  );
}

async function resolveRawSelectorObjectId(cdp, sessions, selector) {
  const match = await findUniqueRawSelectorSession(cdp, sessions, selector);
  const result = await send(
    cdp,
    "Runtime.evaluate",
    {
      expression: buildFindElementJs(selector.raw),
      returnByValue: false,
      awaitPromise: false,
      objectGroup: "ego-browser",
    },
    match.sessionId,
  );
  if (result.exceptionDetails) {
    throw invalidSelectorError(selector.raw, result);
  }
  const objectId = result.result?.objectId;
  if (!objectId) {
    throw new ElementResolutionError(
      `Element not found: ${selector.raw}`,
      "transient",
    );
  }
  return { objectId, sessionId: match.sessionId };
}

async function findUniqueRawSelectorSession(cdp, sessions, selector) {
  const mainCount = await rawSelectorCount(cdp, sessions[0], selector);
  if (mainCount > 1) throw rawSelectorCountError(selector.raw, mainCount);
  if (mainCount === 1) return { sessionId: sessions[0] };

  const matches = [];
  let count = 0;
  for (const candidateSessionId of sessions.slice(1)) {
    const candidateCount = await rawSelectorCount(
      cdp,
      candidateSessionId,
      selector,
    );
    count += candidateCount;
    if (candidateCount > 0) {
      matches.push({ count: candidateCount, sessionId: candidateSessionId });
    }
  }
  if (count === 0) {
    throw new ElementResolutionError(
      `Selector ${selector.raw} matched 0 elements`,
      "transient",
    );
  }
  if (count > 1) throw rawSelectorCountError(selector.raw, count);
  return matches[0];
}

async function rawSelectorCount(cdp, sessionId, selector) {
  const result = await send(
    cdp,
    "Runtime.evaluate",
    {
      expression: buildRawSelectorCountJs(selector),
      returnByValue: true,
      awaitPromise: false,
    },
    sessionId,
  );
  if (result.exceptionDetails) {
    throw invalidSelectorError(selector.raw, result);
  }
  return Number(result.result?.value || 0);
}

function rawSelectorCountError(raw, count) {
  return new ElementResolutionError(
    `Selector ${raw} matched ${count} elements`,
    "permanent",
  );
}

function invalidSelectorError(raw, result) {
  return new ElementResolutionError(
    `Invalid selector: ${raw}: ${exceptionText(result)}`,
    "permanent",
  );
}

function resolveFrameSession(frameId, sessionId, iframeSessions) {
  if (!frameId) {
    return sessionId;
  }
  if (iframeSessions instanceof Map) {
    return iframeSessions.get(frameId) || sessionId;
  }
  return iframeSessions?.[frameId] || sessionId;
}

function pageSessions(sessionId, iframeSessions) {
  const sessions = [sessionId];
  const frameSessionIds =
    iframeSessions instanceof Map
      ? iframeSessions.values()
      : Object.values(iframeSessions || {});
  for (const frameSessionId of frameSessionIds) {
    if (frameSessionId && !sessions.includes(frameSessionId)) {
      sessions.push(frameSessionId);
    }
  }
  return sessions;
}

function pageContexts(sessionId, iframeSessions) {
  const contexts = [{ sessionId, frameId: undefined }];
  const entries =
    iframeSessions instanceof Map
      ? iframeSessions.entries()
      : Object.entries(iframeSessions || {});
  for (const [frameId, frameSessionId] of entries) {
    contexts.push({
      sessionId: frameSessionId,
      frameId: frameSessionId === sessionId ? frameId : undefined,
    });
  }
  return contexts;
}

async function resolveLocatorCenter(cdp, sessionId, locator, iframeSessions) {
  const sessions = pageSessions(sessionId, iframeSessions);
  if (locator.kind === "role") {
    const match = await findUniqueRoleMatch(
      cdp,
      pageContexts(sessionId, iframeSessions),
      locator.role,
      locator.name,
      locator.raw,
    );
    const result = await send(
      cdp,
      "DOM.getBoxModel",
      { backendNodeId: match.backendNodeId },
      match.sessionId,
    );
    return { ...boxModelCenter(result.model), sessionId: match.sessionId };
  }
  const match =
    sessions.length === 1
      ? { sessionId: sessions[0] }
      : await findUniqueLocatorSession(cdp, sessions, locator);
  const result = await send(
    cdp,
    "Runtime.evaluate",
    {
      expression: buildLocatorCenterJs(locator),
      returnByValue: true,
      awaitPromise: false,
    },
    match.sessionId,
  );
  if (result.exceptionDetails) {
    throw new ElementResolutionError(
      `Invalid selector: ${locator.raw}: ${exceptionText(result)}`,
      "permanent",
    );
  }
  const value = result.result?.value;
  if (value?.error) {
    throw new ElementResolutionError(value.error, matchCountKind(value.error));
  }
  if (typeof value?.x !== "number" || typeof value?.y !== "number") {
    throw new ElementResolutionError(
      `Element not found: ${locator.raw}`,
      "transient",
    );
  }
  return { x: value.x, y: value.y, sessionId: match.sessionId };
}

async function resolveLocatorObjectId(cdp, sessionId, locator, iframeSessions) {
  const sessions = pageSessions(sessionId, iframeSessions);
  if (locator.kind === "role") {
    const match = await findUniqueRoleMatch(
      cdp,
      pageContexts(sessionId, iframeSessions),
      locator.role,
      locator.name,
      locator.raw,
    );
    const result = await send(
      cdp,
      "DOM.resolveNode",
      {
        backendNodeId: match.backendNodeId,
        objectGroup: "ego-browser",
      },
      match.sessionId,
    );
    const objectId = result.object?.objectId;
    if (!objectId) {
      throw new ElementResolutionError(
        `No objectId for locator ${locator.raw}`,
        "permanent",
      );
    }
    return {
      objectId,
      sessionId: match.sessionId,
      ...(match.frameId ? { frameId: match.frameId } : {}),
    };
  }
  const match = await findUniqueLocatorSession(cdp, sessions, locator);
  const result = await send(
    cdp,
    "Runtime.evaluate",
    {
      expression: buildLocatorFindJs(locator),
      returnByValue: false,
      awaitPromise: false,
      objectGroup: "ego-browser",
    },
    match.sessionId,
  );
  const objectId = result.result?.objectId;
  if (!objectId) {
    throw new ElementResolutionError(
      `Element not found: ${locator.raw}`,
      "transient",
    );
  }
  return { objectId, sessionId: match.sessionId };
}

async function findUniqueLocatorSession(cdp, sessions, locator) {
  const matches = [];
  let count = 0;
  const mainCount = await locatorCount(cdp, sessions[0], locator);
  if (mainCount > 1) {
    throw new ElementResolutionError(
      `Locator ${locator.raw} matched ${mainCount} elements`,
      "permanent",
    );
  }
  if (mainCount === 1) return { count: 1, sessionId: sessions[0] };

  for (const candidateSessionId of sessions.slice(1)) {
    const candidateCount = await locatorCount(cdp, candidateSessionId, locator);
    count += candidateCount;
    if (candidateCount > 0) {
      matches.push({ count: candidateCount, sessionId: candidateSessionId });
    }
  }
  if (count === 0) {
    throw new ElementResolutionError(
      `Locator ${locator.raw} matched 0 elements`,
      "transient",
    );
  }
  if (count > 1) {
    throw new ElementResolutionError(
      `Locator ${locator.raw} matched ${count} elements`,
      "permanent",
    );
  }
  return matches[0];
}

async function findUniqueRoleMatch(cdp, contexts, role, name, raw) {
  const matchesIn = async (selectedContexts) => {
    const matches = [];
    for (const context of selectedContexts) {
      const result = await send(
        cdp,
        "Accessibility.getFullAXTree",
        context.frameId ? { frameId: context.frameId } : {},
        context.sessionId,
      );
      for (const node of result.nodes || []) {
        if (
          !node.ignored &&
          extractAxString(node.role) === role &&
          extractAxString(node.name) === name &&
          node.backendDOMNodeId !== undefined &&
          node.backendDOMNodeId !== null
        ) {
          matches.push({
            backendNodeId: node.backendDOMNodeId,
            frameId: context.frameId,
            sessionId: context.sessionId,
          });
        }
      }
    }
    return matches;
  };

  // Preserve Page locator behavior: a top-level match wins. Only fall back to
  // frames when the Page document has no match at all.
  const mainMatches = await matchesIn(contexts.slice(0, 1));
  const matches =
    mainMatches.length > 0 ? mainMatches : await matchesIn(contexts.slice(1));
  if (matches.length === 0) {
    throw new ElementResolutionError(
      `Locator ${raw} matched 0 elements`,
      "transient",
    );
  }
  if (matches.length > 1) {
    throw new ElementResolutionError(
      `Locator ${raw} matched ${matches.length} elements`,
      "permanent",
    );
  }
  return matches[0];
}

async function locatorCount(cdp, sessionId, locator) {
  const result = await send(
    cdp,
    "Runtime.evaluate",
    {
      expression: buildLocatorCountJs(locator),
      returnByValue: true,
      awaitPromise: false,
    },
    sessionId,
  );
  if (result.exceptionDetails) {
    throw new ElementResolutionError(
      `Invalid selector: ${locator.raw}: ${exceptionText(result)}`,
      "permanent",
    );
  }
  return Number(result.result?.value || 0);
}

async function findBackendNodeIdByRoleName(
  cdp,
  sessionId,
  role,
  name,
  nth = undefined,
  frameId = undefined,
  iframeSessions = new Map(),
) {
  const [params, effectiveSessionId] = resolveAxSession(
    frameId,
    sessionId,
    iframeSessions,
  );
  const result = await send(
    cdp,
    "Accessibility.getFullAXTree",
    params,
    effectiveSessionId,
  );
  const nthIndex = nth ?? 0;
  let matchCount = 0;
  for (const node of result.nodes || []) {
    if (node.ignored) {
      continue;
    }
    if (
      extractAxString(node.role) !== role ||
      extractAxString(node.name) !== name
    ) {
      continue;
    }
    if (matchCount === nthIndex) {
      if (
        node.backendDOMNodeId === undefined ||
        node.backendDOMNodeId === null
      ) {
        throw new ElementResolutionError(
          `AX node has no backendDOMNodeId for role=${role} name=${name}`,
          "permanent",
        );
      }
      return node.backendDOMNodeId;
    }
    matchCount += 1;
  }
  throw new ElementResolutionError(
    `Could not locate element with role=${role} name=${name}`,
    "transient",
  );
}

async function findUniqueBackendNodeIdByRoleName(cdp, sessionId, role, name) {
  const result = await send(cdp, "Accessibility.getFullAXTree", {}, sessionId);
  const matches = [];
  for (const node of result.nodes || []) {
    if (node.ignored) {
      continue;
    }
    if (
      extractAxString(node.role) === role &&
      extractAxString(node.name) === name
    ) {
      matches.push(node);
    }
  }
  if (matches.length === 0) {
    throw new ElementResolutionError(
      `Locator role:${role}[name=${JSON.stringify(name)}] matched 0 elements`,
      "transient",
    );
  }
  if (matches.length > 1) {
    throw new ElementResolutionError(
      `Locator role:${role}[name=${JSON.stringify(name)}] matched ${matches.length} elements`,
      "permanent",
    );
  }
  const backendNodeId = matches[0].backendDOMNodeId;
  if (backendNodeId === undefined || backendNodeId === null) {
    throw new ElementResolutionError(
      `AX node has no backendDOMNodeId for role=${role} name=${name}`,
      "permanent",
    );
  }
  return backendNodeId;
}

function resolveAxSession(frameId, sessionId, iframeSessions) {
  if (!frameId) {
    return [{}, sessionId];
  }
  const iframeSession =
    iframeSessions instanceof Map
      ? iframeSessions.get(frameId)
      : iframeSessions?.[frameId];
  if (iframeSession && iframeSession !== sessionId) {
    return [{}, iframeSession];
  }
  return [{ frameId }, sessionId];
}

function buildFindElementJs(selector) {
  if (String(selector).startsWith("xpath=")) {
    return `document.evaluate(${JSON.stringify(String(selector).slice(6))}, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue`;
  }
  return buildCssFindJs(selector);
}

function parseRawSelector(input) {
  const raw = String(input);
  return raw.startsWith("xpath=")
    ? { kind: "xpath", selector: raw.slice(6), raw }
    : { kind: "css", selector: raw, raw };
}

function buildRawSelectorCountJs(selector) {
  if (selector.kind === "xpath") {
    return `document.evaluate(${JSON.stringify(selector.selector)}, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null).snapshotLength`;
  }
  return buildCssCountJs(selector.selector);
}

function buildLocatorFindJs(locator) {
  if (locator.kind === "css") {
    return buildCssFindJs(locator.selector);
  }
  if (locator.kind === "text") {
    return `(() => ${textElementsJs(locator)}[0] || null)()`;
  }
  return `(() => ${hrefElementsJs(locator.href)}[0] || null)()`;
}

function buildLocatorCountJs(locator) {
  if (locator.kind === "css") {
    return buildCssCountJs(locator.selector);
  }
  if (locator.kind === "text") {
    return `(() => ${textElementsJs(locator)}.length)()`;
  }
  return `(() => ${hrefElementsJs(locator.href)}.length)()`;
}

function buildLocatorCenterJs(locator) {
  return `(() => {
            const count = ${buildLocatorCountJs(locator)};
            if (count !== 1) return { error: ${JSON.stringify(`Locator ${locator.raw} matched`)} + ' ' + count + ' elements' };
            const el = ${buildLocatorFindJs(locator)};
            if (!el) return null;
            const rect = el.getBoundingClientRect();
            return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        })()`;
}

function hrefElementsJs(href) {
  return `${buildCssQueryAllJs("a[href]")}.filter((el) => {
            try {
              const u = new URL(el.href, location.href);
              const path = u.pathname + u.search + u.hash;
              return path === ${JSON.stringify(href)} || u.href === ${JSON.stringify(href)};
            } catch {
              return false;
            }
          })`;
}

function textElementsJs(locator) {
  return `(() => {
            ${OPEN_SHADOW_QUERY_HELPER}
            const spec = {
              mode: ${JSON.stringify(locator.mode)},
              text: ${JSON.stringify(locator.text)}
            };
            const normalize = (value) =>
              String(value ?? "").replace(/\\s+/g, " ").trim();
            const expected = normalize(spec.text);
            const excludedTags = new Set([
              "HEAD",
              "NOSCRIPT",
              "SCRIPT",
              "STYLE",
              "TEMPLATE",
              "TITLE"
            ]);
            const elements = __egoQueryAllOpenShadow("*").filter(
              (element) => !excludedTags.has(element.tagName)
            );

            function fullText(element) {
              const type = String(element.getAttribute?.("type") || "").toLowerCase();
              if (element.tagName === "INPUT" && (type === "button" || type === "submit")) {
                return normalize(element.value);
              }
              return normalize(element.textContent);
            }

            function immediateText(element) {
              const type = String(element.getAttribute?.("type") || "").toLowerCase();
              if (element.tagName === "INPUT" && (type === "button" || type === "submit")) {
                return normalize(element.value);
              }
              return normalize(
                [...element.childNodes]
                  .filter((node) => node.nodeType === Node.TEXT_NODE)
                  .map((node) => node.nodeValue)
                  .join(" ")
              );
            }

            function matches(element) {
              if (spec.mode === "exact") return immediateText(element) === expected;
              return fullText(element)
                .toLowerCase()
                .includes(expected.toLowerCase());
            }

            function isComposedDescendant(ancestor, node) {
              let current = node;
              while (current) {
                if (current === ancestor) return true;
                if (current.parentElement) {
                  current = current.parentElement;
                  continue;
                }
                const root = current.getRootNode?.();
                current = root instanceof ShadowRoot ? root.host : null;
              }
              return false;
            }

            const matchesByText = elements.filter(matches);
            return matchesByText.filter(
              (element) =>
                !matchesByText.some(
                  (other) =>
                    other !== element && isComposedDescendant(element, other)
                )
            );
          })()`;
}

// CSS locators from the native snapshot can point into an open shadow tree.
// Query every reachable tree scope so those locators have the same meaning
// when an action reuses them. XPath deliberately keeps document-only semantics.
const OPEN_SHADOW_QUERY_HELPER = `
  function __egoQueryAllOpenShadow(selector) {
    const matches = [];
    const roots = [document];
    while (roots.length) {
      const root = roots.pop();
      matches.push(...root.querySelectorAll(selector));
      const elements = root.querySelectorAll('*');
      for (let index = elements.length - 1; index >= 0; index -= 1) {
        const shadowRoot = elements[index].shadowRoot;
        if (shadowRoot) roots.push(shadowRoot);
      }
    }
    return matches;
  }
`;

function buildCssQueryAllJs(selector) {
  return `(() => {
            ${OPEN_SHADOW_QUERY_HELPER}
            return __egoQueryAllOpenShadow(${JSON.stringify(selector)});
          })()`;
}

function buildCssFindJs(selector) {
  return `(() => {
            ${OPEN_SHADOW_QUERY_HELPER}
            return __egoQueryAllOpenShadow(${JSON.stringify(selector)})[0] || null;
          })()`;
}

function buildCssCountJs(selector) {
  return `(() => {
            ${OPEN_SHADOW_QUERY_HELPER}
            return __egoQueryAllOpenShadow(${JSON.stringify(selector)}).length;
          })()`;
}

function buildSelectorCenterJs(selector) {
  const findExpr = buildFindElementJs(selector);
  return `(() => {
            const el = ${findExpr};
            if (!el) return null;
            const rect = el.getBoundingClientRect();
            return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        })()`;
}

function parseLocator(input) {
  let value = String(input || "").trim();
  if (value.startsWith("loc=")) {
    value = value.slice(4);
  }
  if (value.startsWith("css:")) {
    const selector = value.slice(4);
    return selector ? { kind: "css", selector, raw: value } : null;
  }
  if (value.startsWith("href:")) {
    const href = value.slice(5);
    return href ? { kind: "href", href, raw: value } : null;
  }
  if (value.startsWith("text=")) {
    const body = value.slice(5).trim();
    if (!body) return null;
    const quoted =
      (body.startsWith('"') && body.endsWith('"')) ||
      (body.startsWith("'") && body.endsWith("'"));
    const text = quoted ? parseLocatorName(body) : body;
    return normalizeText(text)
      ? {
          kind: "text",
          mode: quoted ? "exact" : "substring",
          text,
          raw: value,
        }
      : null;
  }
  const roleMatch = /^role:([A-Za-z0-9_-]+)\[name=(.+)\]$/.exec(value);
  if (roleMatch) {
    return {
      kind: "role",
      role: roleMatch[1],
      name: parseLocatorName(roleMatch[2]),
      raw: value,
    };
  }
  return null;
}

function parseLocatorName(raw) {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function boxModelCenter(model: any = {}) {
  const content = model.content || [];
  if (content.length < 8) {
    // Returning a fake (0,0) here would silently click the viewport corner.
    // Treat a missing/degenerate box model as "element not ready" so callers
    // with retry semantics (waitForElement, ref fallback) can poll.
    throw new ElementResolutionError(
      "Element has no box model (not rendered or zero-sized)",
      "transient",
    );
  }
  return {
    x: (content[0] + content[2] + content[4] + content[6]) / 4,
    y: (content[1] + content[3] + content[5] + content[7]) / 4,
  };
}

function extractAxString(value) {
  const raw = value?.value;
  if (typeof raw === "string") {
    return raw;
  }
  if (typeof raw === "number" || typeof raw === "boolean") {
    return String(raw);
  }
  return "";
}

function send(cdp, method, params: any = {}, sessionId = undefined) {
  return cdp.sendRaw(method, params, sessionId);
}
