import { runtimeValue } from "../cdp-eval.js";
import { resolveElementObjectId } from "../element-resolver.js";
import { RefMap } from "../ref-map.js";

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
};

export type PageFillOptions = {
  clearFirst?: boolean;
};

export type PageHoverOptions = {
  position?: { x: number; y: number };
};

export type PageDragAndDropOptions = {
  button?: MouseButton;
  sourcePosition?: { x: number; y: number };
  targetPosition?: { x: number; y: number };
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

/** Click an element through one explicit target session and Page ref map. */
export async function clickInPage(
  services: PageActionServices,
  sessionId: string,
  refMap: RefMap,
  selector: string,
  options: PageClickOptions = {},
  modifiers = 0,
): Promise<void> {
  assertPageSelector(selector);
  const button = options.button ?? "left";
  const clickCount = options.clickCount ?? 1;
  const target = await resolveElementObjectId(
    cdpAdapter(services),
    sessionId,
    refMap,
    selector,
  );
  try {
    const point = await resolveElementPoint(
      services,
      target.sessionId,
      target.objectId,
      options.position,
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
    for (let count = 1; count <= clickCount; count += 1) {
      // Moving the pointer or completing an earlier click can change layout.
      // Recheck before every press so hover-created overlays fail closed.
      await assertElementReceivesPointerEvents(
        services,
        target.sessionId,
        target.objectId,
        point,
      );
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
  );
  try {
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
          return { status: "done", cursorPoint: visibleCursorPoint() };
        }
      } else if (tag !== "textarea" && !this.isContentEditable) {
        return { error: "element is not an input, textarea, or contenteditable element" };
      }

      this.focus();
      const cursorPoint = visibleCursorPoint();
      if (!clearFirst) return { status: "needsinput", cursorPoint };
      if (tag === "input" || tag === "textarea") {
        this.select();
      } else {
        const range = this.ownerDocument.createRange();
        range.selectNodeContents(this);
        const selection = this.ownerDocument.defaultView.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      return { status: "needsinput", cursorPoint };
    }`;
    const preparation = await services.cdp(
      "Runtime.callFunctionOn",
      {
        functionDeclaration: preparationSource,
        objectId: resolved.objectId,
        arguments: [{ value }, { value: clearFirst }],
        returnByValue: true,
        awaitPromise: false,
      },
      resolved.sessionId,
    );
    const result = runtimeValue(preparation, preparationSource);
    if (typeof result?.error === "string") {
      throw new Error(`page.fill failed: ${result.error}`);
    }
    showAgentCursor(services, result?.cursorPoint);
    const status = typeof result === "string" ? result : result?.status;
    if (status === "done") return;
    if (status !== "needsinput") {
      throw new Error("page.fill received an invalid preparation result");
    }

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
      await services.cdp("Input.dispatchKeyEvent", keyDown, resolved.sessionId);
      await services.cdp(
        "Input.dispatchKeyEvent",
        {
          type: "keyUp",
          key: "Delete",
          code: "Delete",
          modifiers: 0,
          windowsVirtualKeyCode: 46,
        },
        resolved.sessionId,
      );
    } else if (value.length > 0) {
      await services.cdp(
        "Input.insertText",
        { text: value },
        resolved.sessionId,
      );
    }
  } finally {
    await services
      .cdp(
        "Runtime.releaseObject",
        { objectId: resolved.objectId },
        resolved.sessionId,
      )
      .catch(() => {});
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
): Promise<void> {
  assertPageSelector(selector);
  const resolved = await resolveElementObjectId(
    cdpAdapter(services),
    sessionId,
    refMap,
    selector,
  );
  try {
    const point = await resolveElementPoint(
      services,
      resolved.sessionId,
      resolved.objectId,
      options.position,
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
): Promise<void> {
  assertPageSelector(sourceSelector);
  assertPageSelector(targetSelector);
  const source = await resolveElementObjectId(
    cdpAdapter(services),
    sessionId,
    refMap,
    sourceSelector,
  );
  let target;
  try {
    target = await resolveElementObjectId(
      cdpAdapter(services),
      sessionId,
      refMap,
      targetSelector,
    );
    const sourcePoint = await resolveElementPoint(
      services,
      source.sessionId,
      source.objectId,
      options.sourcePosition,
    );
    const targetPoint = await resolveElementPoint(
      services,
      target.sessionId,
      target.objectId,
      options.targetPosition,
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
): Promise<{ x: number; y: number }> {
  if (
    position !== undefined &&
    (!position ||
      typeof position !== "object" ||
      !Number.isFinite(position.x) ||
      !Number.isFinite(position.y))
  ) {
    throw new TypeError("page.click position requires finite x and y offsets");
  }
  const pointExpression = position
    ? "({x:rect.x+position.x,y:rect.y+position.y})"
    : "({x:rect.x+rect.width/2,y:rect.y+rect.height/2})";
  const expression = `function(${position ? "position" : ""}) {
    ${HIT_TARGET_HELPERS}
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
    const interceptor = interceptingElementAtPoint(this, point);
    if (interceptor) {
      return { error: describeHitTarget(interceptor) + " intercepts pointer events" };
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
      awaitPromise: false,
    },
    sessionId,
  );
  const point = runtimeValue(response, expression);
  if (typeof point?.error === "string") {
    throw new Error(`page.click failed: ${point.error}`);
  }
  if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) {
    throw new Error("page.click could not resolve the element position");
  }
  return point;
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
    throw new Error(`page.click failed: ${result.error}`);
  }
}

// This is a compact adaptation of Playwright's composed-tree hit-target check.
// It handles ordinary descendants, slots, and nested shadow roots without
// exposing an injected helper or trusting only document.elementFromPoint().
const HIT_TARGET_HELPERS = `
  function composedParent(element) {
    if (element.assignedSlot) return element.assignedSlot;
    if (element.parentElement) return element.parentElement;
    const root = element.getRootNode ? element.getRootNode() : null;
    return root && root.nodeType === 11 ? root.host : null;
  }
  function interceptingElementAtPoint(target, point) {
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
    let current = hitElement;
    while (current && current !== target) current = composedParent(current);
    return current === target ? null : hitElement || document.documentElement;
  }
  function describeHitTarget(element) {
    const tag = String(element.tagName || "unknown").toLowerCase();
    const id = element.id
      ? ' id="' + String(element.id).slice(0, 80).replaceAll('"', '&quot;') + '"'
      : "";
    return "<" + tag + id + ">";
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
