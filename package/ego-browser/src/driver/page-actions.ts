import { runtimeValue } from "../cdp-eval.js";
import { resolveElementObjectId } from "../element-resolver.js";
import { parseRef, RefMap } from "../ref-map.js";

type PageActionServices = {
  cdp(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
    timeoutMs?: number,
  ): Promise<any>;
  sleep(ms: number): Promise<void>;
};

type MouseButton = "left" | "middle" | "right";

export type PageClickOptions = {
  button?: MouseButton;
  clickCount?: number;
  position?: { x: number; y: number };
};

export type PageFillOptions = {
  clearFirst?: boolean;
};

const INPUT_EVENT_DELAY_MS = 25;
const INPUT_DISPATCH_TIMEOUT_MS = 1_000;

/**
 * Click an element through one explicit target session. Page refs are rejected
 * until the Page model owns a target-scoped ref registry; accepting the legacy
 * process-global map here could silently click the same numeric ref on another
 * tab.
 */
export async function clickInPage(
  services: PageActionServices,
  sessionId: string,
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
    new RefMap(),
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
    new RefMap(),
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
  const expression = position
    ? "function(position){const rect=this.getBoundingClientRect(); return {x:rect.x+position.x,y:rect.y+position.y};}"
    : "function(){const rect=this.getBoundingClientRect(); return {x:rect.x+rect.width/2,y:rect.y+rect.height/2};}";
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
  if (parseRef(selector)) {
    throw new Error(
      "page-scoped ref support is not available yet; use CSS, xpath=, or loc= for this Page action",
    );
  }
}

function cdpAdapter(services: PageActionServices) {
  return {
    sendRaw(method, params, sessionId) {
      return services.cdp(method, params, sessionId);
    },
  };
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
