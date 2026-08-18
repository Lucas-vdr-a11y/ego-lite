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
  sleep(ms: number): Promise<void>;
};

export type MouseButton = "left" | "middle" | "right";

export type PageClickOptions = {
  button?: MouseButton;
  clickCount?: number;
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
};

export type PageMouseButtonOptions = {
  button?: MouseButton;
  clickCount?: number;
};

const INPUT_EVENT_DELAY_MS = 25;
const INPUT_DISPATCH_TIMEOUT_MS = 1_000;

/** Click an element through one explicit target session and Page ref map. */
export async function clickInPage(
  services: PageActionServices,
  sessionId: string,
  refMap: RefMap,
  selector: string,
  options: PageClickOptions = {},
): Promise<void> {
  assertPageSelector(selector);
  const button = options.button ?? "left";
  if (!(["left", "middle", "right"] as string[]).includes(button)) {
    throw new TypeError(`page.click received unsupported button: ${button}`);
  }
  const clickCount = options.clickCount ?? 1;
  if (!Number.isInteger(clickCount) || clickCount < 1) {
    throw new TypeError("page.click clickCount must be a positive integer");
  }
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
    const probeId = await installClickProbe(
      services,
      target.sessionId,
      target.objectId,
      button,
    );
    let dispatchError: unknown;
    try {
      await services.cdp(
        "Input.dispatchMouseEvent",
        {
          type: "mouseMoved",
          x: point.x,
          y: point.y,
          button: "none",
          buttons: 0,
        },
        target.sessionId,
        INPUT_DISPATCH_TIMEOUT_MS,
      );
      await services.sleep(INPUT_EVENT_DELAY_MS);
      await services.cdp(
        "Input.dispatchMouseEvent",
        {
          type: "mousePressed",
          x: point.x,
          y: point.y,
          button,
          buttons,
          clickCount,
        },
        target.sessionId,
        INPUT_DISPATCH_TIMEOUT_MS,
      );
      await services.sleep(INPUT_EVENT_DELAY_MS);
      await services.cdp(
        "Input.dispatchMouseEvent",
        {
          type: "mouseReleased",
          x: point.x,
          y: point.y,
          button,
          buttons: 0,
          clickCount,
        },
        target.sessionId,
        INPUT_DISPATCH_TIMEOUT_MS,
      );
    } catch (error) {
      if (!isInputDispatchTimeout(error)) throw error;
      dispatchError = error;
    }
    const completed = await finishClickProbe(
      services,
      target.sessionId,
      target.objectId,
      point,
      probeId,
      button,
      clickCount,
    );
    if (dispatchError && !completed) throw dispatchError;
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
  if (typeof clearFirst !== "boolean") {
    throw new TypeError("page.fill clearFirst must be a boolean");
  }

  const resolved = await resolveElementObjectId(
    cdpAdapter(services),
    sessionId,
    refMap,
    selector,
  );
  try {
    await services.cdp(
      "Runtime.callFunctionOn",
      {
        functionDeclaration: clearFirst
          ? "function(){this.focus(); if(typeof this.select==='function') this.select();}"
          : "function(){this.focus();}",
        objectId: resolved.objectId,
        returnByValue: true,
        awaitPromise: false,
      },
      resolved.sessionId,
    );
    if (clearFirst) {
      await services.cdp(
        "Runtime.callFunctionOn",
        {
          functionDeclaration:
            "function(){this.value=''; this.dispatchEvent(new Event('input',{bubbles:true}));}",
          objectId: resolved.objectId,
          returnByValue: true,
          awaitPromise: false,
        },
        resolved.sessionId,
      );
    }
    await services.cdp("Input.insertText", { text: value }, resolved.sessionId);
    await services.cdp(
      "Runtime.callFunctionOn",
      {
        functionDeclaration:
          "function(){this.dispatchEvent(new Event('input',{bubbles:true})); this.dispatchEvent(new Event('change',{bubbles:true}));}",
        objectId: resolved.objectId,
        returnByValue: true,
        awaitPromise: false,
      },
      resolved.sessionId,
    );
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
    const probeId = await installElementEventProbe(
      services,
      resolved.sessionId,
      resolved.objectId,
      ["mousemove", "mouseover"],
      "hover",
    );
    let dispatchError: unknown;
    try {
      await dispatchMouseEvent(services, resolved.sessionId, {
        type: "mouseMoved",
        x: point.x,
        y: point.y,
        button: "none",
        buttons: 0,
      });
    } catch (error) {
      if (!isInputDispatchTimeout(error)) throw error;
      dispatchError = error;
    }
    const completed = await finishHoverProbe(
      services,
      resolved.sessionId,
      resolved.objectId,
      point,
      probeId,
    );
    if (dispatchError && !completed) throw dispatchError;
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
    const button = assertMouseButton(options.button ?? "left");
    const buttons = pressedButtons(button);
    const probeId = await installElementEventProbe(
      services,
      target.sessionId,
      target.objectId,
      ["mouseup"],
      "drag",
    );
    let dispatchError: unknown;
    const dispatch = async (params: Record<string, unknown>) => {
      try {
        await dispatchMouseEvent(services, source.sessionId, params);
      } catch (error) {
        if (!isInputDispatchTimeout(error)) throw error;
        dispatchError ??= error;
      }
    };
    await dispatch({
      type: "mouseMoved",
      x: sourcePoint.x,
      y: sourcePoint.y,
      button: "none",
      buttons: 0,
    });
    await services.sleep(INPUT_EVENT_DELAY_MS);
    await dispatch({
      type: "mousePressed",
      x: sourcePoint.x,
      y: sourcePoint.y,
      button,
      buttons,
      clickCount: 1,
    });
    await services.sleep(INPUT_EVENT_DELAY_MS);
    await dispatch({
      type: "mouseMoved",
      x: targetPoint.x,
      y: targetPoint.y,
      button,
      buttons,
    });
    await services.sleep(INPUT_EVENT_DELAY_MS);
    await dispatch({
      type: "mouseReleased",
      x: targetPoint.x,
      y: targetPoint.y,
      button,
      buttons: 0,
      clickCount: 1,
    });
    const completed = await finishDragProbe(
      services,
      source.sessionId,
      source.objectId,
      target.objectId,
      sourcePoint,
      targetPoint,
      probeId,
      button,
    );
    if (dispatchError && !completed) throw dispatchError;
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
): Promise<void> {
  assertPoint(x, y, "page.mouse.click");
  const button = assertMouseButton(options.button ?? "left");
  const clickCount = options.clickCount ?? 1;
  if (!Number.isInteger(clickCount) || clickCount < 1) {
    throw new TypeError(
      "page.mouse.click clickCount must be a positive integer",
    );
  }
  const buttons = pressedButtons(button);
  await dispatchMouseEvent(services, sessionId, {
    type: "mouseMoved",
    x,
    y,
    button: "none",
    buttons: 0,
  });
  await services.sleep(INPUT_EVENT_DELAY_MS);
  await dispatchMouseEvent(services, sessionId, {
    type: "mousePressed",
    x,
    y,
    button,
    buttons,
    clickCount,
  });
  await services.sleep(INPUT_EVENT_DELAY_MS);
  await dispatchMouseEvent(services, sessionId, {
    type: "mouseReleased",
    x,
    y,
    button,
    buttons: 0,
    clickCount,
  });
}

export async function moveMouseInPage(
  services: PageActionServices,
  sessionId: string,
  x: number,
  y: number,
  buttons = 0,
): Promise<void> {
  assertPoint(x, y, "page.mouse.move");
  await dispatchMouseEvent(services, sessionId, {
    type: "mouseMoved",
    x,
    y,
    button: "none",
    buttons,
  });
}

export async function mouseButtonInPage(
  services: PageActionServices,
  sessionId: string,
  type: "mousePressed" | "mouseReleased",
  x: number,
  y: number,
  buttons: number,
  options: PageMouseButtonOptions = {},
): Promise<MouseButton> {
  assertPoint(x, y, `page.mouse.${type === "mousePressed" ? "down" : "up"}`);
  const button = assertMouseButton(options.button ?? "left");
  const clickCount = options.clickCount ?? 1;
  if (!Number.isInteger(clickCount) || clickCount < 1) {
    throw new TypeError("page.mouse clickCount must be a positive integer");
  }
  await dispatchMouseEvent(services, sessionId, {
    type,
    x,
    y,
    button,
    buttons,
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
): Promise<void> {
  assertPoint(x, y, "page.mouse.wheel");
  if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) {
    throw new TypeError("page.mouse.wheel requires finite deltaX and deltaY");
  }
  await dispatchMouseEvent(services, sessionId, {
    type: "mouseWheel",
    x,
    y,
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

async function installClickProbe(
  services: PageActionServices,
  sessionId: string,
  objectId: string,
  button: MouseButton,
): Promise<string | null> {
  const id = `page_click_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const eventName = clickEventName(button);
  try {
    const response = await services.cdp(
      "Runtime.callFunctionOn",
      {
        functionDeclaration: `function(id, eventName) {
          const target = this;
          window.__egoBrowserInputProbes ||= {};
          const probe = { seen: false, target };
          probe.handler = (event) => {
            if (event.isTrusted && target && (event.target === target || target.contains(event.target))) {
              probe.seen = true;
            }
          };
          document.addEventListener(eventName, probe.handler, true);
          window.__egoBrowserInputProbes[id] = probe;
          return true;
        }`,
        objectId,
        arguments: [{ value: id }, { value: eventName }],
        returnByValue: true,
        awaitPromise: false,
      },
      sessionId,
    );
    return response.result?.value ? id : null;
  } catch {
    return null;
  }
}

async function installElementEventProbe(
  services: PageActionServices,
  sessionId: string,
  objectId: string,
  eventNames: string[],
  prefix: string,
): Promise<string | null> {
  const id = `page_${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  try {
    const response = await services.cdp(
      "Runtime.callFunctionOn",
      {
        functionDeclaration: `function(id, eventNames) {
          const target = this;
          window.__egoBrowserInputProbes ||= {};
          const probe = { seen: false, target, eventNames };
          probe.handler = (event) => {
            if (event.isTrusted && (event.target === target || target.contains(event.target))) {
              probe.seen = true;
            }
          };
          for (const eventName of eventNames) {
            document.addEventListener(eventName, probe.handler, true);
          }
          window.__egoBrowserInputProbes[id] = probe;
          return true;
        }`,
        objectId,
        arguments: [{ value: id }, { value: eventNames }],
        returnByValue: true,
        awaitPromise: false,
      },
      sessionId,
    );
    return response.result?.value ? id : null;
  } catch {
    return null;
  }
}

async function finishHoverProbe(
  services: PageActionServices,
  sessionId: string,
  objectId: string,
  point: { x: number; y: number },
  id: string | null,
): Promise<boolean> {
  if (!id) return false;
  await services.sleep(50);
  try {
    const response = await services.cdp(
      "Runtime.callFunctionOn",
      {
        functionDeclaration: `function(id, point) {
          const probes = window.__egoBrowserInputProbes || {};
          const probe = probes[id];
          if (!probe) return { seen: false, fallback: false };
          for (const eventName of probe.eventNames) {
            document.removeEventListener(eventName, probe.handler, true);
          }
          delete probes[id];
          if (probe.seen) return { seen: true, fallback: false };
          const init = {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: point.x,
            clientY: point.y,
            button: 0,
            buttons: 0,
          };
          this.dispatchEvent(new MouseEvent("mousemove", init));
          this.dispatchEvent(new MouseEvent("mouseover", init));
          return { seen: false, fallback: true };
        }`,
        objectId,
        arguments: [{ value: id }, { value: point }],
        returnByValue: true,
        awaitPromise: false,
      },
      sessionId,
    );
    const value = response.result?.value;
    return Boolean(value?.seen || value?.fallback);
  } catch {
    return false;
  }
}

async function finishDragProbe(
  services: PageActionServices,
  sessionId: string,
  sourceObjectId: string,
  targetObjectId: string,
  sourcePoint: { x: number; y: number },
  targetPoint: { x: number; y: number },
  id: string | null,
  button: MouseButton,
): Promise<boolean> {
  if (!id) return false;
  await services.sleep(50);
  const mouseButton = button === "left" ? 0 : button === "middle" ? 1 : 2;
  const buttons = pressedButtons(button);
  try {
    const response = await services.cdp(
      "Runtime.callFunctionOn",
      {
        functionDeclaration: `function(id, target, sourcePoint, targetPoint, mouseButton, buttons) {
          const probes = window.__egoBrowserInputProbes || {};
          const probe = probes[id];
          if (probe) {
            for (const eventName of probe.eventNames) {
              document.removeEventListener(eventName, probe.handler, true);
            }
            delete probes[id];
            if (probe.seen) return { seen: true, fallback: false };
          }
          const eventFor = (node, type, point, pressed) => {
            node.dispatchEvent(new MouseEvent(type, {
              bubbles: true,
              cancelable: true,
              view: window,
              clientX: point.x,
              clientY: point.y,
              button: mouseButton,
              buttons: pressed,
              detail: type === "mousemove" ? 0 : 1,
            }));
          };
          eventFor(this, "mousedown", sourcePoint, buttons);
          eventFor(target, "mousemove", targetPoint, buttons);
          eventFor(target, "mouseup", targetPoint, 0);
          return { seen: false, fallback: true };
        }`,
        objectId: sourceObjectId,
        arguments: [
          { value: id },
          { objectId: targetObjectId },
          { value: sourcePoint },
          { value: targetPoint },
          { value: mouseButton },
          { value: buttons },
        ],
        returnByValue: true,
        awaitPromise: false,
      },
      sessionId,
    );
    const value = response.result?.value;
    return Boolean(value?.seen || value?.fallback);
  } catch {
    return false;
  }
}

async function finishClickProbe(
  services: PageActionServices,
  sessionId: string,
  objectId: string,
  point: { x: number; y: number },
  id: string | null,
  button: MouseButton,
  clickCount: number,
): Promise<boolean> {
  if (!id) return false;
  await services.sleep(50);
  const mouseButton = button === "left" ? 0 : button === "middle" ? 1 : 2;
  const buttons = pressedButtons(button);
  const eventName = clickEventName(button);
  try {
    const response = await services.cdp(
      "Runtime.callFunctionOn",
      {
        functionDeclaration: `function(id, eventName) {
          const probes = window.__egoBrowserInputProbes || {};
          const probe = probes[id];
          if (probe) {
            document.removeEventListener(eventName, probe.handler, true);
            delete probes[id];
            if (probe.seen) return { seen: true, fallback: false };
          }
          const target = probe?.target || this;
          const init = {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: ${JSON.stringify(point.x)},
            clientY: ${JSON.stringify(point.y)},
            button: ${JSON.stringify(mouseButton)},
          };
          target.dispatchEvent(new MouseEvent("mousemove", { ...init, buttons: 0, detail: 0 }));
          target.dispatchEvent(new MouseEvent("mousedown", { ...init, buttons: ${JSON.stringify(buttons)}, detail: ${JSON.stringify(clickCount)} }));
          target.dispatchEvent(new MouseEvent("mouseup", { ...init, buttons: 0, detail: ${JSON.stringify(clickCount)} }));
          target.dispatchEvent(new MouseEvent(eventName, { ...init, buttons: 0, detail: ${JSON.stringify(clickCount)} }));
          if (eventName === "click" && ${JSON.stringify(clickCount)} > 1) {
            target.dispatchEvent(new MouseEvent("dblclick", { ...init, buttons: 0, detail: 2 }));
          }
          return { seen: false, fallback: true };
        }`,
        objectId,
        arguments: [{ value: id }, { value: eventName }],
        returnByValue: true,
        awaitPromise: false,
      },
      sessionId,
    );
    const value = response.result?.value;
    return Boolean(value?.seen || value?.fallback);
  } catch {
    return false;
  }
}

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
  await services.cdp(
    "Input.dispatchMouseEvent",
    params,
    sessionId,
    INPUT_DISPATCH_TIMEOUT_MS,
  );
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

function assertMouseButton(button: string): MouseButton {
  if (!(<string[]>["left", "middle", "right"]).includes(button)) {
    throw new TypeError(`unsupported mouse button: ${button}`);
  }
  return button as MouseButton;
}

export function mouseButtonMask(button: MouseButton): number {
  return pressedButtons(button);
}

function pressedButtons(button: MouseButton): number {
  if (button === "left") return 1;
  if (button === "right") return 2;
  return 4;
}

function clickEventName(
  button: MouseButton,
): "click" | "auxclick" | "contextmenu" {
  if (button === "left") return "click";
  if (button === "middle") return "auxclick";
  return "contextmenu";
}

function isInputDispatchTimeout(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /CDP request timed out: Input\.dispatchMouseEvent/.test(message);
}
