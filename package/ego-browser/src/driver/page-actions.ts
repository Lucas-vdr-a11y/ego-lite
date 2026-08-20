import { runtimeValue } from "../cdp-eval.js";
import {
  ElementResolutionError,
  resolveElementObjectId,
} from "../element-resolver.js";
import { RefMap } from "../ref-map.js";
import {
  COMPOSED_PARENT_HELPER,
  EDIT_ACTION_TARGET_HELPERS,
} from "./action-target.js";

type PageActionServices = {
  cdp(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
    timeoutMs?: number,
  ): Promise<any>;
  showAgentMousePosition(x: number, y: number): Promise<void>;
  sleep(ms: number): Promise<void>;
  platform?: string;
};

export type MouseButton = "left" | "middle" | "right";

export type PageClickOptions = {
  button?: MouseButton;
  clickCount?: number;
  delay?: number;
  position?: { x: number; y: number };
  force?: boolean;
  timeout?: number;
};

export type PageFillOptions = {
  clearFirst?: boolean;
  timeout?: number;
};

export type PageHoverOptions = {
  position?: { x: number; y: number };
  force?: boolean;
  timeout?: number;
};

export type PageDragAndDropOptions = {
  button?: MouseButton;
  sourcePosition?: { x: number; y: number };
  targetPosition?: { x: number; y: number };
  force?: boolean;
  timeout?: number;
};

export type PageMouseClickOptions = {
  button?: MouseButton;
  clickCount?: number;
  delay?: number;
};

export type PageMouseButtonOptions = {
  button?: MouseButton;
  clickCount?: number;
};

export type PageMouseMoveOptions = {
  steps?: number;
};

type MouseMoveState = PageMouseMoveOptions & {
  button: MouseButton | "none";
  buttons: number;
  modifiers: number;
};

const INPUT_EVENT_DELAY_MS = 25;
const FILL_VERIFICATION_ATTEMPTS = 5;
const FILL_VERIFICATION_INTERVAL_MS = 50;

/** Click an element through one explicit target session and Page ref map. */
export async function clickInPage(
  services: PageActionServices,
  sessionId: string,
  refMap: RefMap,
  selector: string,
  options: PageClickOptions = {},
  modifiers = 0,
  iframeSessions = new Map<string, string>(),
): Promise<void> {
  assertPageSelector(selector);
  const button = options.button ?? "left";
  const clickCount = options.clickCount ?? 1;
  const target = await resolveElementObjectId(
    cdpAdapter(services),
    sessionId,
    refMap,
    selector,
    iframeSessions,
    { strict: true },
  );
  try {
    let point = await resolveElementPoint(
      services,
      target.sessionId,
      target.objectId,
      options.position,
      target.frameId,
      "page.click",
      options.force,
      true,
    );
    const buttons = pressedButtons(button);
    await dispatchMouseEvent(services, target.sessionId, {
      type: "mouseMoved",
      x: point.x,
      y: point.y,
      button: "none",
      buttons: 0,
      modifiers,
    });
    if (target.frameId) {
      // Moving into a same-process iframe can adjust the outer document's
      // scroll position. Translate the frame-local point again before the
      // press so native input uses the post-hover viewport coordinates.
      const pagePoint = await pagePointForFrame(
        services,
        target.sessionId,
        target.frameId,
        point.local,
      );
      point = { ...pagePoint, local: point.local };
      await dispatchMouseEvent(services, target.sessionId, {
        type: "mouseMoved",
        x: point.x,
        y: point.y,
        button: "none",
        buttons: 0,
        modifiers,
      });
    }
    for (let count = 1; count <= clickCount; count += 1) {
      // Moving the pointer or completing an earlier click can change layout.
      // Recheck before every press so hover-created overlays fail closed.
      // A same-process iframe must keep its native move/press sequence
      // contiguous; the initial check already covered its local hit target.
      if (!options.force && !target.frameId) {
        await assertElementReceivesPointerEvents(
          services,
          target.sessionId,
          target.objectId,
          point.local,
        );
      }
      await dispatchMouseEvent(services, target.sessionId, {
        type: "mousePressed",
        x: point.x,
        y: point.y,
        button,
        buttons,
        modifiers,
        clickCount: count,
      });
      if (options.delay) await services.sleep(options.delay);
      await dispatchMouseEvent(services, target.sessionId, {
        type: "mouseReleased",
        x: point.x,
        y: point.y,
        button,
        buttons: 0,
        modifiers,
        clickCount: count,
      });
      if (options.delay && count < clickCount) {
        await services.sleep(options.delay);
      }
    }
  } finally {
    await services
      .cdp(
        "Runtime.releaseObject",
        { objectId: target.objectId },
        target.sessionId,
      )
      .catch(() => {});
  }
}

/** Focus, replace, and notify an input-like element in one target session. */
export async function fillInPage(
  services: PageActionServices,
  sessionId: string,
  refMap: RefMap,
  selector: string,
  value: string,
  options: PageFillOptions = {},
  iframeSessions = new Map<string, string>(),
): Promise<void> {
  assertPageSelector(selector);
  if (typeof value !== "string") {
    throw new TypeError("page.fill value must be a string");
  }
  const clearFirst = options.clearFirst ?? true;

  const resolved = await resolveElementObjectId(
    cdpAdapter(services),
    sessionId,
    refMap,
    selector,
    iframeSessions,
    { strict: true },
  );
  let actionObjectId: string | undefined;
  try {
    actionObjectId = await resolveFillActionTarget(
      services,
      resolved.sessionId,
      resolved.objectId,
    );
    const preparationSource = `function fillPreparation(value, clearFirst) {
      if (!this.isConnected) return { error: "element is not connected" };
      const visibleCursorPoint = () => {
        const rect = this.getBoundingClientRect();
        const view = this.ownerDocument.defaultView;
        if (!view || rect.width <= 0 || rect.height <= 0) return null;
        const left = Math.max(0, rect.left);
        const top = Math.max(0, rect.top);
        const right = Math.min(view.innerWidth, rect.right);
        const bottom = Math.min(view.innerHeight, rect.bottom);
        if (right <= left || bottom <= top) return null;
        return { x: (left + right) / 2, y: (top + bottom) / 2 };
      };
      const tag = this.nodeName.toLowerCase();
      const view = this.ownerDocument.defaultView;
      const rect = this.getBoundingClientRect();
      const style = view?.getComputedStyle(this);
      if (
        !view || rect.width <= 0 || rect.height <= 0 ||
        style?.visibility === "hidden" || style?.display === "none"
      ) return { error: "element is not visible" };
      if (this.disabled) return { error: "element is disabled" };
      if (this.readOnly) return { error: "element is read only" };

      if (tag === "input") {
        const type = this.type.toLowerCase();
        const textTypes = new Set(["", "email", "number", "password", "search", "tel", "text", "url"]);
        const directTypes = new Set(["color", "date", "time", "datetime-local", "month", "range", "week"]);
        if (!textTypes.has(type) && !directTypes.has(type)) {
          return { error: 'input type "' + type + '" cannot be filled' };
        }
        if (type === "number" && value.trim() !== "" && Number.isNaN(Number(value.trim()))) {
          return { error: "cannot type non-numeric text into input[type=number]" };
        }
        if (directTypes.has(type)) {
          const nextValue = value.trim();
          this.focus();
          this.value = nextValue;
          if (this.value !== nextValue) return { error: "malformed value" };
          this.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
          this.dispatchEvent(new Event("change", { bubbles: true }));
          return { status: "done", kind: "input", cursorPoint: visibleCursorPoint() };
        }
      } else if (tag !== "textarea" && !this.isContentEditable) {
        return { error: "element is not an input, textarea, or contenteditable element" };
      }

      this.focus();
      const cursorPoint = visibleCursorPoint();
      const kind = this.isContentEditable ? "contenteditable" : tag;
      if (!clearFirst) return { status: "needsinput", kind, cursorPoint };
      if (tag === "input" || tag === "textarea") {
        this.select();
      } else {
        const range = this.ownerDocument.createRange();
        range.selectNodeContents(this);
        const selection = this.ownerDocument.defaultView.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      return { status: "needsinput", kind, cursorPoint };
    }`;
    const prepare = async () => {
      const preparation = await services.cdp(
        "Runtime.callFunctionOn",
        {
          functionDeclaration: preparationSource,
          objectId: actionObjectId,
          arguments: [{ value }, { value: clearFirst }],
          returnByValue: true,
          awaitPromise: false,
        },
        resolved.sessionId,
      );
      return runtimeValue(preparation, preparationSource);
    };
    let result = await prepare();
    if (typeof result?.error === "string") {
      throw fillPreparationError(result.error);
    }
    showAgentCursor(
      services,
      await pagePointForFrame(
        services,
        resolved.sessionId,
        resolved.frameId,
        result?.cursorPoint,
      ),
    );
    const status = typeof result === "string" ? result : result?.status;
    if (status === "done") return;
    if (status !== "needsinput") {
      throw new Error("page.fill received an invalid preparation result");
    }

    await dispatchFillInput(services, resolved.sessionId, value, clearFirst);
    if (
      await verifyFilledValue(
        services,
        resolved.sessionId,
        actionObjectId,
        value,
        clearFirst,
      )
    ) {
      return;
    }

    if (result?.kind === "contenteditable") {
      // Some editors do not install their internal editing state until they
      // receive a real pointer activation. Retry only after proving that the
      // ordinary fill had no observable effect, which avoids duplicate input.
      await clickResolvedElement(
        services,
        resolved.sessionId,
        actionObjectId,
        resolved.frameId,
      );
      result = await prepare();
      if (typeof result?.error === "string") {
        throw fillPreparationError(result.error);
      }
      if (result?.status !== "needsinput") {
        throw new Error("page.fill received an invalid preparation result");
      }
      await dispatchFillInput(services, resolved.sessionId, value, clearFirst);
      if (
        await verifyFilledValue(
          services,
          resolved.sessionId,
          actionObjectId,
          value,
          clearFirst,
        )
      ) {
        return;
      }
    }

    const target = result?.kind === "contenteditable" ? "editor" : "field";
    throw new Error(
      `page.fill did not accept the text. Click the ${target} and use page.keyboard, then verify the result.`,
    );
  } finally {
    if (actionObjectId && actionObjectId !== resolved.objectId) {
      await releaseObject(services, resolved.sessionId, actionObjectId);
    }
    await releaseObject(services, resolved.sessionId, resolved.objectId);
  }
}

async function resolveFillActionTarget(
  services: PageActionServices,
  sessionId: string,
  objectId: string,
): Promise<string> {
  const source = `function resolveFillTargetForAction() {
    ${EDIT_ACTION_TARGET_HELPERS}
    const tag = String(this.tagName || "").toUpperCase();
    if (tag === "INPUT" || tag === "TEXTAREA" || isExplicitContentEditable(this)) {
      return this;
    }
    const editingHost = nearestComposedAncestor(this, isExplicitContentEditable);
    if (editingHost) return editingHost;
    const candidates = composedDescendantMatches(
      this,
      isFillableActionTarget,
      true,
    );
    if (candidates.length > 1) {
      throw new TypeError("page.fill selected an element with multiple fillable targets");
    }
    return candidates[0] || this;
  }`;
  const response = await services.cdp(
    "Runtime.callFunctionOn",
    {
      functionDeclaration: source,
      objectId,
      returnByValue: false,
      awaitPromise: false,
    },
    sessionId,
  );
  if (response?.exceptionDetails) {
    throw new ElementResolutionError(
      exceptionDescription(response),
      "permanent",
    );
  }
  const targetObjectId = response?.result?.objectId;
  if (!targetObjectId) {
    throw new Error("page.fill could not resolve an editable action target");
  }
  return targetObjectId;
}

/** Focus one strictly resolved element in an explicit Page session. */
export async function focusInPage(
  services: PageActionServices,
  sessionId: string,
  refMap: RefMap,
  selector: string,
  iframeSessions = new Map<string, string>(),
): Promise<void> {
  assertPageSelector(selector);
  const resolved = await resolveElementObjectId(
    cdpAdapter(services),
    sessionId,
    refMap,
    selector,
    iframeSessions,
    { strict: true },
  );
  const source = `function focusElementForAction() {
    if (!this.isConnected) return { error: "element is not connected" };
    ${EDIT_ACTION_TARGET_HELPERS}
    const deepActiveElement = () => {
      let active = this.ownerDocument.activeElement;
      while (active?.shadowRoot?.activeElement) {
        active = active.shadowRoot.activeElement;
      }
      return active;
    };
    const containsComposed = (container, element) => {
      let current = element;
      while (current) {
        if (current === container) return true;
        current = composedParent(current);
      }
      return false;
    };
    const details = () => ({
      tagName: this.tagName,
      contentEditable: Boolean(this.isContentEditable),
      tabIndex: this.tabIndex,
      activeTagName: deepActiveElement()?.tagName || null,
    });
    const tryFocus = (candidate, retargeted) => {
      if (typeof candidate.focus !== "function") return null;
      candidate.focus();
      const active = deepActiveElement();
      return active === candidate || containsComposed(candidate, active)
        ? { focused: true, retargeted }
        : null;
    };

    const direct = tryFocus(this, null);
    if (direct) return direct;

    let ancestor = composedParent(this);
    while (ancestor) {
      if (isStrongFocusTarget(ancestor)) {
        const focused = tryFocus(ancestor, "ancestor");
        if (focused) return focused;
      }
      ancestor = composedParent(ancestor);
    }

    const editableCandidates = composedDescendantMatches(
      this,
      isEditableFocusTarget,
      true,
    );
    if (editableCandidates.length === 1) {
      const focused = tryFocus(editableCandidates[0], "descendant");
      if (focused) return focused;
    }
    if (editableCandidates.length > 1) {
      return {
        error: "element contains multiple editable targets",
        details: { ...details(), candidateCount: editableCandidates.length },
      };
    }
    return { error: "element is not focusable", details: details() };
  }`;
  try {
    const response = await services.cdp(
      "Runtime.callFunctionOn",
      {
        functionDeclaration: source,
        objectId: resolved.objectId,
        returnByValue: true,
        awaitPromise: false,
      },
      resolved.sessionId,
    );
    const result = runtimeValue(response, source);
    if (typeof result?.error === "string") {
      const details = result.details;
      const candidateCount = details?.candidateCount
        ? `, candidates=${String(details.candidateCount)}`
        : "";
      const description = details
        ? ` (${String(details.tagName || "element").toLowerCase()}, contenteditable=${Boolean(details.contentEditable)}, tabIndex=${String(details.tabIndex)}, active=${String(details.activeTagName || "none").toLowerCase()}${candidateCount})`
        : "";
      throw new ElementResolutionError(
        `page.focus failed: ${result.error}${description}`,
        result.error === "element is not connected" ? "transient" : "permanent",
      );
    }
  } finally {
    await releaseObject(services, resolved.sessionId, resolved.objectId);
  }
}

async function dispatchFillInput(
  services: PageActionServices,
  sessionId: string,
  value: string,
  clearFirst: boolean,
): Promise<void> {
  if (clearFirst && value.length === 0) {
    const keyDown: Record<string, unknown> = {
      type: "rawKeyDown",
      key: "Delete",
      code: "Delete",
      modifiers: 0,
      windowsVirtualKeyCode: 46,
    };
    if ((services.platform ?? process.platform) === "darwin") {
      keyDown.commands = ["deleteForward"];
    }
    await services.cdp("Input.dispatchKeyEvent", keyDown, sessionId);
    await services.cdp(
      "Input.dispatchKeyEvent",
      {
        type: "keyUp",
        key: "Delete",
        code: "Delete",
        modifiers: 0,
        windowsVirtualKeyCode: 46,
      },
      sessionId,
    );
    return;
  }
  if (value.length > 0) {
    await services.cdp("Input.insertText", { text: value }, sessionId);
  }
}

async function verifyFilledValue(
  services: PageActionServices,
  sessionId: string,
  objectId: string,
  value: string,
  clearFirst: boolean,
): Promise<boolean> {
  const source = `function verifyFilledValue(value, clearFirst) {
    if (!this.isConnected) return { error: "element is not connected" };
    const tag = this.nodeName.toLowerCase();
    const observed = tag === "input" || tag === "textarea"
      ? this.value
      : (this.innerText ?? this.textContent ?? "");
    const normalize = (text) => String(text)
      .replace(/\\r\\n?/g, "\\n")
      .replace(/\\u200b/g, "");
    const actual = normalize(observed);
    const expected = normalize(value);
    return {
      matches: clearFirst ? actual === expected : actual.includes(expected),
    };
  }`;
  let consecutiveMatches = 0;
  for (let attempt = 0; attempt < FILL_VERIFICATION_ATTEMPTS; attempt += 1) {
    const response = await services.cdp(
      "Runtime.callFunctionOn",
      {
        functionDeclaration: source,
        objectId,
        arguments: [{ value }, { value: clearFirst }],
        returnByValue: true,
        awaitPromise: false,
      },
      sessionId,
    );
    const result = runtimeValue(response, source);
    if (typeof result?.error === "string") {
      // Input has already been dispatched, so retrying the whole operation
      // could duplicate text on a replacement element.
      throw new Error(`page.fill could not verify the result: ${result.error}`);
    }
    if (result?.matches === true) {
      consecutiveMatches += 1;
      if (consecutiveMatches === 2) return true;
    } else {
      consecutiveMatches = 0;
    }
    if (attempt + 1 < FILL_VERIFICATION_ATTEMPTS) {
      await services.sleep(FILL_VERIFICATION_INTERVAL_MS);
    }
  }
  return false;
}

async function clickResolvedElement(
  services: PageActionServices,
  sessionId: string,
  objectId: string,
  frameId?: string,
): Promise<void> {
  const point = await resolveElementPoint(
    services,
    sessionId,
    objectId,
    undefined,
    frameId,
    "page.fill",
    false,
    true,
  );
  await assertElementReceivesPointerEvents(
    services,
    sessionId,
    objectId,
    point.local,
  );
  await assertSafeFillActivationTarget(
    services,
    sessionId,
    objectId,
    point.local,
  );
  await dispatchMouseEvent(services, sessionId, {
    type: "mouseMoved",
    x: point.x,
    y: point.y,
    button: "none",
    buttons: 0,
    modifiers: 0,
  });
  await dispatchMouseEvent(services, sessionId, {
    type: "mousePressed",
    x: point.x,
    y: point.y,
    button: "left",
    buttons: 1,
    modifiers: 0,
    clickCount: 1,
  });
  await dispatchMouseEvent(services, sessionId, {
    type: "mouseReleased",
    x: point.x,
    y: point.y,
    button: "left",
    buttons: 0,
    modifiers: 0,
    clickCount: 1,
  });
}

async function assertSafeFillActivationTarget(
  services: PageActionServices,
  sessionId: string,
  objectId: string,
  point: { x: number; y: number },
): Promise<void> {
  const expression = `function safeFillActivationTarget(point) {
    ${HIT_TARGET_HELPERS}
    if (!this.isConnected) return { error: "the editor is not connected" };
    const hit = hitElementAtPoint(this, point);
    let current = hit;
    while (current && current !== this) {
      if (isExplicitInteractiveElement(current)) {
        return { error: describeHitTarget(current) };
      }
      current = composedParent(current);
    }
    return { safe: true };
  }`;
  const response = await services.cdp(
    "Runtime.callFunctionOn",
    {
      functionDeclaration: expression,
      objectId,
      arguments: [{ value: point }],
      returnByValue: true,
      awaitPromise: false,
    },
    sessionId,
  );
  const result = runtimeValue(response, expression);
  if (typeof result?.error === "string") {
    throw new ElementResolutionError(
      `page.fill cannot safely activate the editor because ${result.error} would receive the click`,
      "permanent",
    );
  }
}

/** Move the native mouse over one element in an explicit Page session. */
export async function hoverInPage(
  services: PageActionServices,
  sessionId: string,
  refMap: RefMap,
  selector: string,
  options: PageHoverOptions = {},
  modifiers = 0,
  iframeSessions = new Map<string, string>(),
): Promise<void> {
  assertPageSelector(selector);
  const resolved = await resolveElementObjectId(
    cdpAdapter(services),
    sessionId,
    refMap,
    selector,
    iframeSessions,
    { strict: true },
  );
  try {
    const point = await resolveElementPoint(
      services,
      resolved.sessionId,
      resolved.objectId,
      options.position,
      resolved.frameId,
      "page.hover",
      options.force,
    );
    await dispatchMouseEvent(services, resolved.sessionId, {
      type: "mouseMoved",
      x: point.x,
      y: point.y,
      button: "none",
      buttons: 0,
      modifiers,
    });
  } finally {
    await releaseObject(services, resolved.sessionId, resolved.objectId);
  }
}

/** Drag between two elements through the same explicit Page session. */
export async function dragAndDropInPage(
  services: PageActionServices,
  sessionId: string,
  refMap: RefMap,
  sourceSelector: string,
  targetSelector: string,
  options: PageDragAndDropOptions = {},
  modifiers = 0,
  iframeSessions = new Map<string, string>(),
): Promise<void> {
  assertPageSelector(sourceSelector);
  assertPageSelector(targetSelector);
  const source = await resolveElementObjectId(
    cdpAdapter(services),
    sessionId,
    refMap,
    sourceSelector,
    iframeSessions,
    { strict: true },
  );
  let target;
  try {
    target = await resolveElementObjectId(
      cdpAdapter(services),
      sessionId,
      refMap,
      targetSelector,
      iframeSessions,
      { strict: true },
    );
    const sourcePoint = await resolveElementPoint(
      services,
      source.sessionId,
      source.objectId,
      options.sourcePosition,
      source.frameId,
      "page.dragAndDrop",
      options.force,
    );
    const targetPoint = await resolveElementPoint(
      services,
      target.sessionId,
      target.objectId,
      options.targetPosition,
      target.frameId,
      "page.dragAndDrop",
      options.force,
    );
    const button = options.button ?? "left";
    const buttons = pressedButtons(button);
    await dispatchMouseEvent(services, source.sessionId, {
      type: "mouseMoved",
      x: sourcePoint.x,
      y: sourcePoint.y,
      button: "none",
      buttons: 0,
      modifiers,
    });
    await services.sleep(INPUT_EVENT_DELAY_MS);
    await dispatchMouseEvent(services, source.sessionId, {
      type: "mousePressed",
      x: sourcePoint.x,
      y: sourcePoint.y,
      button,
      buttons,
      modifiers,
      clickCount: 1,
    });
    await services.sleep(INPUT_EVENT_DELAY_MS);
    await dispatchMouseEvent(services, source.sessionId, {
      type: "mouseMoved",
      x: targetPoint.x,
      y: targetPoint.y,
      button,
      buttons,
      modifiers,
    });
    await services.sleep(INPUT_EVENT_DELAY_MS);
    await dispatchMouseEvent(services, source.sessionId, {
      type: "mouseReleased",
      x: targetPoint.x,
      y: targetPoint.y,
      button,
      buttons: 0,
      modifiers,
      clickCount: 1,
    });
  } finally {
    if (target) {
      await releaseObject(services, target.sessionId, target.objectId);
    }
    await releaseObject(services, source.sessionId, source.objectId);
  }
}

/** Dispatch a complete native click at viewport coordinates. */
export async function clickPointInPage(
  services: PageActionServices,
  sessionId: string,
  x: number,
  y: number,
  options: PageMouseClickOptions = {},
  modifiers = 0,
  baseButtons = 0,
): Promise<void> {
  assertPoint(x, y, "page.mouse.click");
  const button = options.button ?? "left";
  const clickCount = options.clickCount ?? 1;
  const buttons = pressedButtons(button);
  await dispatchMouseEvent(services, sessionId, {
    type: "mouseMoved",
    x,
    y,
    button: "none",
    buttons: baseButtons,
    modifiers,
  });
  for (let count = 1; count <= clickCount; count += 1) {
    await dispatchMouseEvent(services, sessionId, {
      type: "mousePressed",
      x,
      y,
      button,
      buttons: baseButtons | buttons,
      modifiers,
      clickCount: count,
    });
    if (options.delay) await services.sleep(options.delay);
    await dispatchMouseEvent(services, sessionId, {
      type: "mouseReleased",
      x,
      y,
      button,
      buttons: baseButtons,
      modifiers,
      clickCount: count,
    });
    if (options.delay && count < clickCount) {
      await services.sleep(options.delay);
    }
  }
}

export async function moveMouseInPage(
  services: PageActionServices,
  sessionId: string,
  fromX: number,
  fromY: number,
  x: number,
  y: number,
  options: MouseMoveState,
): Promise<void> {
  assertPoint(x, y, "page.mouse.move");
  const steps = options.steps ?? 1;
  for (let step = 1; step <= steps; step += 1) {
    await dispatchMouseEvent(services, sessionId, {
      type: "mouseMoved",
      x: fromX + (x - fromX) * (step / steps),
      y: fromY + (y - fromY) * (step / steps),
      button: options.button,
      buttons: options.buttons,
      modifiers: options.modifiers,
    });
  }
}

export async function mouseButtonInPage(
  services: PageActionServices,
  sessionId: string,
  type: "mousePressed" | "mouseReleased",
  x: number,
  y: number,
  buttons: number,
  options: PageMouseButtonOptions = {},
  modifiers = 0,
): Promise<MouseButton> {
  assertPoint(x, y, `page.mouse.${type === "mousePressed" ? "down" : "up"}`);
  const button = options.button ?? "left";
  const clickCount = options.clickCount ?? 1;
  await dispatchMouseEvent(services, sessionId, {
    type,
    x,
    y,
    button,
    buttons,
    modifiers,
    clickCount,
  });
  return button;
}

export async function wheelInPage(
  services: PageActionServices,
  sessionId: string,
  x: number,
  y: number,
  deltaX: number,
  deltaY: number,
  modifiers = 0,
): Promise<void> {
  assertPoint(x, y, "page.mouse.wheel");
  if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) {
    throw new TypeError("page.mouse.wheel requires finite deltaX and deltaY");
  }
  await dispatchMouseEvent(services, sessionId, {
    type: "mouseWheel",
    x,
    y,
    modifiers,
    deltaX,
    deltaY,
  });
}

async function resolveElementPoint(
  services: PageActionServices,
  sessionId: string,
  objectId: string,
  position?: { x: number; y: number },
  frameId?: string,
  actionName = "page.click",
  force = false,
  checkEnabled = false,
): Promise<{ x: number; y: number; local: { x: number; y: number } }> {
  if (
    position !== undefined &&
    (!position ||
      typeof position !== "object" ||
      !Number.isFinite(position.x) ||
      !Number.isFinite(position.y))
  ) {
    throw new TypeError(
      `${actionName} position requires finite x and y offsets`,
    );
  }
  const pointExpression = position
    ? "({x:rect.x+position.x,y:rect.y+position.y})"
    : "({x:rect.x+rect.width/2,y:rect.y+rect.height/2})";
  const expression = `async function(${position ? "position" : ""}) {
    ${force ? "" : HIT_TARGET_HELPERS}
    if (!this.isConnected) return { error: "element is not connected" };
    let rect = this.getBoundingClientRect();
    let point = ${pointExpression};
    const outsideViewport =
      rect.width <= 0 || rect.height <= 0 ||
      point.x < 0 || point.y < 0 ||
      point.x >= window.innerWidth || point.y >= window.innerHeight;
    if (outsideViewport) {
      this.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
      rect = this.getBoundingClientRect();
      point = ${pointExpression};
    }
    if (
      rect.width <= 0 || rect.height <= 0 ||
      point.x < 0 || point.y < 0 ||
      point.x >= window.innerWidth || point.y >= window.innerHeight
    ) {
      return { error: "element is not visible in the viewport" };
    }
    if (${checkEnabled ? "true" : "false"}) {
      const disabled = this.matches?.(":disabled") ||
        this.closest?.('[aria-disabled="true"]');
      if (disabled) return { error: "element is disabled" };
    }
    const firstRect = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(finish, 100);
      requestAnimationFrame(() => requestAnimationFrame(finish));
    });
    rect = this.getBoundingClientRect();
    if (
      Math.abs(rect.x - firstRect.x) > 0.25 ||
      Math.abs(rect.y - firstRect.y) > 0.25 ||
      Math.abs(rect.width - firstRect.width) > 0.25 ||
      Math.abs(rect.height - firstRect.height) > 0.25
    ) {
      return { error: "element is not stable" };
    }
    point = ${pointExpression};
    if (!${force ? "true" : "false"}) {
      const interceptor = interceptingElementAtPoint(this, point);
      if (interceptor) {
        return { error: describeHitTarget(interceptor) + " intercepts pointer events" };
      }
    }
    return point;
  }`;
  const response = await services.cdp(
    "Runtime.callFunctionOn",
    {
      functionDeclaration: expression,
      objectId,
      arguments: position ? [{ value: position }] : [],
      returnByValue: true,
      awaitPromise: true,
    },
    sessionId,
  );
  const point = runtimeValue(response, expression);
  if (typeof point?.error === "string") {
    throw new ElementResolutionError(
      `${actionName} failed: ${point.error}`,
      "transient",
    );
  }
  if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) {
    throw new Error(`${actionName} could not resolve the element position`);
  }
  const pagePoint = await pagePointForFrame(
    services,
    sessionId,
    frameId,
    point,
  );
  return { ...pagePoint, local: point };
}

async function pagePointForFrame(
  services: PageActionServices,
  sessionId: string,
  frameId: string | undefined,
  point: { x?: unknown; y?: unknown } | null | undefined,
): Promise<{ x: number; y: number } | null | undefined> {
  if (
    !point ||
    typeof point.x !== "number" ||
    !Number.isFinite(point.x) ||
    typeof point.y !== "number" ||
    !Number.isFinite(point.y) ||
    !frameId
  ) {
    return point as { x: number; y: number } | null | undefined;
  }
  const owner = await services.cdp("DOM.getFrameOwner", { frameId }, sessionId);
  const backendNodeId = owner?.backendNodeId;
  if (backendNodeId === undefined || backendNodeId === null) {
    throw new Error(`page action could not resolve iframe ${frameId}`);
  }
  const box = await services.cdp(
    "DOM.getBoxModel",
    { backendNodeId },
    sessionId,
  );
  const content = box?.model?.content;
  if (!Array.isArray(content) || content.length < 2) {
    throw new Error(`page action could not resolve iframe ${frameId} position`);
  }
  return { x: point.x + content[0], y: point.y + content[1] };
}

async function assertElementReceivesPointerEvents(
  services: PageActionServices,
  sessionId: string,
  objectId: string,
  point: { x: number; y: number },
): Promise<void> {
  const expression = `function(point) {
    ${HIT_TARGET_HELPERS}
    if (!this.isConnected) return { error: "element is not connected" };
    const interceptor = interceptingElementAtPoint(this, point);
    return interceptor
      ? { error: describeHitTarget(interceptor) + " intercepts pointer events" }
      : { ok: true };
  }`;
  const response = await services.cdp(
    "Runtime.callFunctionOn",
    {
      functionDeclaration: expression,
      objectId,
      arguments: [{ value: point }],
      returnByValue: true,
      awaitPromise: false,
    },
    sessionId,
  );
  const result = runtimeValue(response, expression);
  if (typeof result?.error === "string") {
    throw new ElementResolutionError(
      `page.click failed: ${result.error}`,
      "transient",
    );
  }
}

function fillPreparationError(message: string) {
  const transient = new Set([
    "element is not connected",
    "element is not visible",
    "element is disabled",
    "element is read only",
  ]);
  return transient.has(message)
    ? new ElementResolutionError(`page.fill failed: ${message}`, "transient")
    : new Error(`page.fill failed: ${message}`);
}

function exceptionDescription(response: any): string {
  return (
    response?.exceptionDetails?.exception?.description ||
    response?.exceptionDetails?.text ||
    "page action evaluation failed"
  );
}

// This is a compact adaptation of Playwright's composed-tree hit-target check.
// It handles ordinary descendants, slots, and nested shadow roots without
// exposing an injected helper or trusting only document.elementFromPoint().
const HIT_TARGET_HELPERS = `
  ${COMPOSED_PARENT_HELPER}
  function isExplicitInteractiveElement(element) {
    if (
      element?.matches?.(":disabled") ||
      element?.getAttribute?.("aria-disabled") === "true"
    ) {
      return false;
    }
    const tag = String(element?.tagName || "").toUpperCase();
    if (["BUTTON", "INPUT", "SELECT", "TEXTAREA", "OPTION", "SUMMARY", "LABEL"].includes(tag)) {
      return true;
    }
    if (tag === "A" && element.hasAttribute?.("href")) return true;
    if (
      element?.hasAttribute?.("contenteditable") &&
      element.getAttribute("contenteditable") !== "false"
    ) return true;
    return new Set([
      "button",
      "checkbox",
      "link",
      "menuitem",
      "menuitemcheckbox",
      "menuitemradio",
      "option",
      "radio",
      "slider",
      "spinbutton",
      "switch",
      "tab",
      "textbox",
      "treeitem"
    ]).has(String(element?.getAttribute?.("role") || "").toLowerCase());
  }
  function isInteractiveElement(element) {
    return isExplicitInteractiveElement(element) || Boolean(element?.isContentEditable);
  }
  function hitElementAtPoint(target, point) {
    const roots = [];
    let parent = target;
    while (parent) {
      const root = parent.getRootNode ? parent.getRootNode() : null;
      if (!root || typeof root.elementsFromPoint !== "function") break;
      roots.push(root);
      if (root.nodeType === 9) break;
      parent = root.host;
    }
    let hitElement;
    for (let index = roots.length - 1; index >= 0; index -= 1) {
      const root = roots[index];
      const elements = root.elementsFromPoint(point.x, point.y);
      const innerElement = elements[0] || root.elementFromPoint(point.x, point.y);
      if (!innerElement) break;
      hitElement = innerElement;
      if (index > 0 && innerElement !== roots[index - 1].host) break;
    }
    return hitElement;
  }
  function interceptingElementAtPoint(target, point) {
    const hitElement = hitElementAtPoint(target, point);
    let current = hitElement;
    while (current && current !== target) current = composedParent(current);
    if (current === target) return null;

    // A child with pointer-events:none can legitimately resolve to its
    // interactive ancestor. A real pointer click reaches that ancestor, so it
    // is compatible with the requested action rather than an overlay.
    current = target;
    while (current && current !== hitElement) current = composedParent(current);
    if (current === hitElement && isInteractiveElement(hitElement)) return null;

    return hitElement || document.documentElement;
  }
  function describeHitTarget(element) {
    const tag = String(element.tagName || "unknown").toLowerCase();
    const id = element.id
      ? ' id="' + String(element.id).slice(0, 80).replaceAll('"', '&quot;') + '"'
      : "";
    const href = tag === "a" && element.hasAttribute?.("href")
      ? ' href="' + String(element.getAttribute("href")).slice(0, 120).replaceAll('"', '&quot;') + '"'
      : "";
    return "<" + tag + id + href + ">";
  }
`;

function assertPageSelector(selector: unknown): asserts selector is string {
  if (typeof selector !== "string" || selector.trim().length === 0) {
    throw new TypeError("Page actions require a non-empty selector string");
  }
}

function cdpAdapter(services: PageActionServices) {
  return {
    sendRaw(method, params, sessionId) {
      return services.cdp(method, params, sessionId);
    },
  };
}

async function dispatchMouseEvent(
  services: PageActionServices,
  sessionId: string,
  params: Record<string, unknown>,
): Promise<void> {
  await services.cdp("Input.dispatchMouseEvent", params, sessionId);
  if (
    params.type !== "mouseMoved" ||
    typeof params.x !== "number" ||
    typeof params.y !== "number"
  ) {
    return;
  }
  showAgentCursor(services, { x: params.x, y: params.y });
}

function showAgentCursor(
  services: PageActionServices,
  point: { x?: unknown; y?: unknown } | null | undefined,
): void {
  const x = point?.x;
  const y = point?.y;
  if (
    typeof x !== "number" ||
    !Number.isFinite(x) ||
    typeof y !== "number" ||
    !Number.isFinite(y)
  ) {
    return;
  }
  try {
    // The native cursor is a display-only hint. Start it while the Page gate
    // still owns the correct task space, but never let rendering latency or an
    // unavailable overlay affect a completed website action.
    void services.showAgentMousePosition(x, y).catch(() => {});
  } catch {
    // Also tolerate an invalid adapter that throws before returning a Promise.
  }
}

async function releaseObject(
  services: PageActionServices,
  sessionId: string,
  objectId: string,
): Promise<void> {
  await services
    .cdp("Runtime.releaseObject", { objectId }, sessionId)
    .catch(() => {});
}

function assertPoint(x: number, y: number, operation: string): void {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new TypeError(`${operation} requires finite x and y coordinates`);
  }
}

export function mouseButtonMask(button: MouseButton): number {
  return pressedButtons(button);
}

function pressedButtons(button: MouseButton): number {
  if (button === "left") return 1;
  if (button === "right") return 2;
  return 4;
}
