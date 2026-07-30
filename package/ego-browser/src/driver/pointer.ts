import { cdp, evaluate } from "../cdp-eval.js";
import { browserCdp } from "../browser-runtime.js";
import { resolveAndCall } from "./element-ops.js";
import { waitForActionableElement } from "./actionability.js";

type MouseButton = "left" | "middle" | "right";
type Point = {
  x: number;
  y: number;
  sessionId?: string;
};
export type MouseTarget =
  | string
  | [number, number]
  | { x: number; y: number; sessionId?: string }
  | { selector: string; x?: number; y?: number };
type ClickOptions = {
  button?: MouseButton;
  clickCount?: number;
  delay?: number;
  label?: string;
  modifiers?: string[];
  position?: { x: number; y: number };
  force?: boolean;
  trial?: boolean;
  timeout?: number;
};
type DragOptions = {
  button?: MouseButton;
  delay?: number;
  label?: string;
  timeout?: number;
};
type HoverOptions = {
  label?: string;
  modifiers?: string[];
  position?: { x: number; y: number };
  force?: boolean;
  trial?: boolean;
  timeout?: number;
};
type MoveOptions = {
  steps?: number;
};
type DragToOptions = DragOptions & {
  sourcePosition?: { x: number; y: number };
  targetPosition?: { x: number; y: number };
  force?: boolean;
  trial?: boolean;
};
type WheelOptions = {
  x?: number;
  y?: number;
};
type MouseEventOptions = Record<string, unknown>;

const INPUT_EVENT_DELAY_MS = 25;
const INPUT_DISPATCH_TIMEOUT_MS = 1000;
let currentMousePoint: Point = { x: 0, y: 0, sessionId: undefined };
const pressedMouseButtons = new Set<MouseButton>();

/**
 * Mouse target accepted by mouse helpers.
 *
 * Forms:
 * - string: CSS selector or @ref, resolves to the element center.
 * - [x, y]: viewport coordinates in CSS pixels.
 * - {x, y}: viewport coordinates in CSS pixels.
 * - {selector}: CSS selector or @ref, resolves to the element center.
 * - {selector, x, y}: element top-left plus x/y offset in CSS pixels.
 *
 * @typedef {string | [number, number] | {x:number,y:number} | {selector:string,x?:number,y?:number}} MouseTarget
 */

/**
 * Click a mouse target.
 * @param {MouseTarget} target CSS selector, @ref, viewport point, or selector-relative point.
 * @param {{button?: "left"|"middle"|"right", clickCount?: number, delay?: number, modifiers?: string[], position?: {x:number,y:number}, force?: boolean, trial?: boolean, timeout?: number, label?: string}} [options]
 * @returns {Promise<void>}
 */
export async function click(target: MouseTarget, options: ClickOptions = {}) {
  const point = await resolveMouseTarget(target, options.timeout, {
    visible: true,
    stable: !options.force,
    receivesEvents: !options.force,
    enabled: !options.force,
    position: options.position,
  });
  rememberMousePoint(point);
  if (options.trial) return;
  const button = options.button || "left";
  const buttons = pressedButtons(button);
  const clickCount = options.clickCount ?? 1;
  const modifiers = modifierMask(options.modifiers);
  maybeHighlight(point, options.label);
  const probeId = await installClickProbe(point, button);
  let dispatchError: unknown = null;
  try {
    await dispatchMouse(point, "mouseMoved", {
      button: "none",
      buttons: 0,
      modifiers,
    });
    await inputEventDelay();
    await dispatchMouse(point, "mousePressed", {
      button,
      buttons,
      clickCount,
      modifiers,
    });
    await inputEventDelay(options.delay);
    await dispatchMouse(point, "mouseReleased", {
      button,
      buttons: 0,
      clickCount,
      modifiers,
    });
  } catch (error) {
    if (!isInputDispatchTimeout(error)) throw error;
    dispatchError = error;
  }
  const completed = await finishClickProbe(
    point,
    probeId,
    clickCount,
    button,
    modifiers,
  );
  if (dispatchError && !completed) throw dispatchError;
}

/**
 * Double-click a mouse target.
 * @param {MouseTarget} target CSS selector, @ref, viewport point, or selector-relative point.
 * @param {{button?: "left"|"middle"|"right", label?: string}} [options]
 * @returns {Promise<void>}
 */
export async function dblclick(
  target: MouseTarget,
  options: ClickOptions = {},
) {
  await click(target, { ...options, clickCount: 2 });
}

/**
 * Move the mouse over a target without pressing a button.
 * @param {MouseTarget} target CSS selector, @ref, viewport point, or selector-relative point.
 * @param {{modifiers?: string[], position?: {x:number,y:number}, force?: boolean, trial?: boolean, timeout?: number, label?: string}} [options]
 * @returns {Promise<void>}
 */
export async function hover(target: MouseTarget, options: HoverOptions = {}) {
  const point = await resolveMouseTarget(target, options.timeout, {
    visible: true,
    stable: !options.force,
    receivesEvents: !options.force,
    position: options.position,
  });
  rememberMousePoint(point);
  if (options.trial) return;
  maybeHighlight(point, options.label);
  await dispatchUnpressedMove(point, modifierMask(options.modifiers));
}

async function dispatchUnpressedMove(point: Point, modifiers = 0) {
  const probeId = await installHoverProbe(point);
  let dispatchError: unknown = null;
  try {
    await dispatchMouse(point, "mouseMoved", {
      buttons: 0,
      modifiers,
    });
  } catch (error) {
    if (!isInputDispatchTimeout(error)) throw error;
    dispatchError = error;
  }
  const completed = await finishHoverProbe(point, probeId);
  if (dispatchError && !completed) throw dispatchError;
}

/**
 * Move the Playwright-style page mouse to viewport coordinates.
 *
 * Unlike hover(), this is a stateful low-level mouse operation: it preserves
 * buttons held by down(), interpolates the requested number of steps, and does
 * not require an element at the destination.
 *
 * @param {number} x Target viewport x coordinate in CSS pixels.
 * @param {number} y Target viewport y coordinate in CSS pixels.
 * @param {{steps?: number}} [options] Number of intermediate mousemove events; defaults to 1.
 * @returns {Promise<void>}
 */
export async function move(x: number, y: number, options: MoveOptions = {}) {
  const target = pointFrom([x, y]);
  const steps = options.steps ?? 1;
  if (!Number.isInteger(steps) || steps < 1) {
    throw new TypeError("mouse.move steps must be a positive integer");
  }
  const start = { ...currentMousePoint };
  const activeButton = lastPressedMouseButton();
  const buttons = pressedMouseButtonMask();
  const sessionId = buttons ? start.sessionId : undefined;
  const pressedMoveProbeId = buttons
    ? await installPressedMoveProbe(sessionId)
    : null;
  // A timed-out intermediate event does not make the whole path unusable:
  // Chromium may still receive later events. Finish the requested path, then
  // require page-side evidence that the final coordinate was reached.
  let dispatchError: unknown = null;
  try {
    for (let step = 1; step <= steps; step += 1) {
      const point = {
        x: start.x + ((target.x - start.x) * step) / steps,
        y: start.y + ((target.y - start.y) * step) / steps,
        sessionId,
      };
      if (buttons === 0) {
        await dispatchUnpressedMove(point);
      } else {
        try {
          await dispatchMouse(point, "mouseMoved", {
            button: activeButton || "none",
            buttons,
          });
        } catch (error) {
          if (!isInputDispatchTimeout(error)) throw error;
          dispatchError ??= error;
        }
      }
      rememberMousePoint(point);
    }
    if (dispatchError) {
      let targetReached = await pressedMoveProbeSawPoint(
        { ...target, sessionId },
        pressedMoveProbeId,
        buttons,
      );
      if (!targetReached) {
        try {
          await dispatchMouse({ ...target, sessionId }, "mouseMoved", {
            button: activeButton || "none",
            buttons,
          });
          targetReached = true;
        } catch (error) {
          if (!isInputDispatchTimeout(error)) throw error;
          targetReached = await pressedMoveProbeSawPoint(
            { ...target, sessionId },
            pressedMoveProbeId,
            buttons,
          );
        }
      }
      if (!targetReached) throw dispatchError;
    }
  } finally {
    if (pressedMoveProbeId) {
      await removePressedMoveProbe(pressedMoveProbeId, sessionId).catch(
        () => {},
      );
    }
  }
}

/**
 * Drag the mouse through a sequence of targets while holding a button.
 * @param {MouseTarget[]} points Ordered drag path. Must contain at least two targets.
 * @param {{button?: "left"|"middle"|"right", delay?: number, label?: string}} [options]
 * @returns {Promise<void>}
 */
export async function drag(points: MouseTarget[], options: DragOptions = {}) {
  if (!Array.isArray(points) || points.length < 2) {
    throw new Error("drag requires at least two points");
  }
  const resolved: Point[] = [];
  for (const point of points) {
    resolved.push(
      await resolveMouseTarget(point, options.timeout, {
        visible: true,
        stable: true,
        receivesEvents: true,
      }),
    );
  }
  const button = options.button || "left";
  const buttons = pressedButtons(button);
  const first = resolved[0];
  const last = resolved.at(-1);
  if (last) {
    rememberMousePoint(last);
  }
  maybeHighlight(first, options.label);
  const probeId = await installDragProbe(first, last);
  let dispatchError: unknown = null;
  try {
    await dispatchMouse(first, "mouseMoved", {
      button: "none",
      buttons: 0,
    });
    await inputEventDelay();
    await dispatchMouse(first, "mousePressed", {
      button,
      buttons,
      clickCount: 1,
    });
    await inputEventDelay();
    for (let i = 1; i < resolved.length; i += 1) {
      const point = resolved[i];
      await dispatchMouse(
        { ...point, sessionId: point.sessionId ?? first.sessionId },
        "mouseMoved",
        {
          button,
          buttons,
        },
      );
      await inputEventDelay(options.delay > 0 ? options.delay : undefined);
    }
    await dispatchMouse(
      { ...last, sessionId: last.sessionId ?? first.sessionId },
      "mouseReleased",
      {
        button,
        buttons: 0,
        clickCount: 1,
      },
    );
  } catch (error) {
    if (!isInputDispatchTimeout(error)) throw error;
    dispatchError = error;
  }
  const completed = await finishDragProbe(resolved, probeId, button);
  if (dispatchError && !completed) throw dispatchError;
}

/**
 * Drag one locator to another with Playwright-style source and target positions.
 */
export async function dragTo(
  source: string,
  target: string,
  options: DragToOptions = {},
) {
  const sourcePoint = await waitForActionableElement(source, {
    timeout: options.timeout,
    visible: true,
    stable: !options.force,
    receivesEvents: !options.force,
    enabled: !options.force,
    position: options.sourcePosition,
  });
  const targetPoint = await waitForActionableElement(target, {
    timeout: options.timeout,
    visible: true,
    stable: !options.force,
    receivesEvents: !options.force,
    position: options.targetPosition,
  });
  if (options.trial) return;
  await drag([sourcePoint, targetPoint], options);
}

/**
 * Press a mouse button at the current mouse position, Playwright-style.
 * @param {{button?: "left"|"middle"|"right", clickCount?: number}} [options]
 * @returns {Promise<void>}
 */
export async function down(options: ClickOptions = {}) {
  const button = options.button || "left";
  pressedButtons(button);
  pressedMouseButtons.add(button);
  try {
    await dispatchMouse(currentMousePoint, "mousePressed", {
      button,
      buttons: pressedMouseButtonMask(),
      clickCount: options.clickCount ?? 1,
    });
  } catch (error) {
    pressedMouseButtons.delete(button);
    throw error;
  }
}

/**
 * Release a mouse button at the current mouse position, Playwright-style.
 * @param {{button?: "left"|"middle"|"right", clickCount?: number}} [options]
 * @returns {Promise<void>}
 */
export async function up(options: ClickOptions = {}) {
  const button = options.button || "left";
  pressedButtons(button);
  pressedMouseButtons.delete(button);
  await dispatchMouse(currentMousePoint, "mouseReleased", {
    button,
    buttons: pressedMouseButtonMask(),
    clickCount: options.clickCount ?? 1,
  });
}

function inputEventDelay(ms = INPUT_EVENT_DELAY_MS) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function installClickProbe(point: Point, button: MouseButton) {
  if (!canProbeInputFallback()) return null;
  const id = `click_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const completionEvent = mouseCompletionEvent(button);
  try {
    const result = await cdp(
      "Runtime.evaluate",
      {
        expression: `(() => {
        const target = document.elementFromPoint(${JSON.stringify(point.x)}, ${JSON.stringify(point.y)});
        window.__egoBrowserInputProbes ||= {};
        const probe = { seen: false, target };
        probe.handler = (event) => {
          if (event.isTrusted && target && (event.target === target || target.contains(event.target))) {
            probe.seen = true;
          }
        };
        document.addEventListener(${JSON.stringify(completionEvent)}, probe.handler, true);
        window.__egoBrowserInputProbes[${JSON.stringify(id)}] = probe;
        return Boolean(target);
      })()`,
        returnByValue: true,
        awaitPromise: false,
      },
      point.sessionId,
    );
    return result.result?.value ? id : null;
  } catch {
    return null;
  }
}

async function finishClickProbe(
  point: Point,
  id: string | null,
  clickCount: number,
  button: MouseButton,
  modifiers: number,
) {
  if (!id) return false;
  const completionEvent = mouseCompletionEvent(button);
  const buttonIndex = mouseButtonIndex(button);
  const buttons = pressedButtons(button);
  const modifierInit = {
    altKey: Boolean(modifiers & 1),
    ctrlKey: Boolean(modifiers & 2),
    metaKey: Boolean(modifiers & 4),
    shiftKey: Boolean(modifiers & 8),
  };
  await inputEventDelay(50);
  try {
    const result = await cdp(
      "Runtime.evaluate",
      {
        expression: `(() => {
        const probes = window.__egoBrowserInputProbes || {};
        const probe = probes[${JSON.stringify(id)}];
        if (!probe) return { seen: false, fallback: false };
        document.removeEventListener(${JSON.stringify(completionEvent)}, probe.handler, true);
        delete probes[${JSON.stringify(id)}];
        if (probe.seen || !probe.target) return { seen: probe.seen, fallback: false };
        const target = probe.target;
        const init = {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: ${JSON.stringify(point.x)},
          clientY: ${JSON.stringify(point.y)},
          button: ${JSON.stringify(buttonIndex)},
          ...${JSON.stringify(modifierInit)},
        };
        target.dispatchEvent(new MouseEvent("mousemove", { ...init, button: 0, buttons: 0, detail: 0 }));
        target.dispatchEvent(new MouseEvent("mousedown", { ...init, buttons: ${JSON.stringify(buttons)}, detail: ${JSON.stringify(clickCount)} }));
        target.dispatchEvent(new MouseEvent("mouseup", { ...init, buttons: 0, detail: ${JSON.stringify(clickCount)} }));
        target.dispatchEvent(new MouseEvent(${JSON.stringify(completionEvent)}, { ...init, buttons: 0, detail: ${JSON.stringify(clickCount)} }));
        if (${JSON.stringify(button === "left")} && ${JSON.stringify(clickCount)} > 1) {
          target.dispatchEvent(new MouseEvent("dblclick", { ...init, buttons: 0, detail: 2 }));
        }
        return { seen: false, fallback: true };
      })()`,
        returnByValue: true,
        awaitPromise: false,
      },
      point.sessionId,
    );
    const value = result.result?.value;
    return Boolean(value?.seen || value?.fallback);
  } catch {
    return false;
  }
}

async function installDragProbe(first: Point, last: Point) {
  if (!canProbeInputFallback()) return null;
  const id = `drag_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  try {
    const result = await cdp(
      "Runtime.evaluate",
      {
        expression: `(() => {
        const source = document.elementFromPoint(${JSON.stringify(first.x)}, ${JSON.stringify(first.y)});
        const target = document.elementFromPoint(${JSON.stringify(last.x)}, ${JSON.stringify(last.y)});
        window.__egoBrowserInputProbes ||= {};
        const probe = { sourceDown: false, targetUp: false, source, target };
        probe.downHandler = (event) => {
          if (event.isTrusted && source && (event.target === source || source.contains(event.target))) {
            probe.sourceDown = true;
          }
        };
        probe.upHandler = (event) => {
          if (event.isTrusted && target && (event.target === target || target.contains(event.target))) {
            probe.targetUp = true;
          }
        };
        document.addEventListener("mousedown", probe.downHandler, true);
        document.addEventListener("mouseup", probe.upHandler, true);
        window.__egoBrowserInputProbes[${JSON.stringify(id)}] = probe;
        return Boolean(source && target);
      })()`,
        returnByValue: true,
        awaitPromise: false,
      },
      last.sessionId ?? first.sessionId,
    );
    return result.result?.value ? id : null;
  } catch {
    return null;
  }
}

async function installHoverProbe(point: Point) {
  if (!canProbeInputFallback()) return null;
  const id = `hover_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  try {
    const result = await cdp(
      "Runtime.evaluate",
      {
        expression: `(() => {
        const target = document.elementFromPoint(${JSON.stringify(point.x)}, ${JSON.stringify(point.y)});
        window.__egoBrowserInputProbes ||= {};
        const probe = { seen: false, target };
        probe.handler = (event) => {
          if (event.isTrusted && target && (event.target === target || target.contains(event.target))) {
            probe.seen = true;
          }
        };
        document.addEventListener("mousemove", probe.handler, true);
        document.addEventListener("mouseover", probe.handler, true);
        window.__egoBrowserInputProbes[${JSON.stringify(id)}] = probe;
        return Boolean(target);
      })()`,
        returnByValue: true,
        awaitPromise: false,
      },
      point.sessionId,
    );
    return result.result?.value ? id : null;
  } catch {
    return null;
  }
}

async function installPressedMoveProbe(sessionId?: string) {
  if (!canProbeInputFallback()) return null;
  const id = `pressed_move_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  try {
    const result = await cdp(
      "Runtime.evaluate",
      {
        expression: `(() => {
        window.__egoBrowserInputProbes ||= {};
        const probe = { events: [] };
        probe.handler = (event) => {
          if (!event.isTrusted) return;
          probe.events.push({
            x: event.clientX,
            y: event.clientY,
            buttons: event.buttons,
          });
          if (probe.events.length > 100) probe.events.shift();
        };
        for (const type of ["mousemove", "drag", "dragenter", "dragover"]) {
          document.addEventListener(type, probe.handler, true);
        }
        window.__egoBrowserInputProbes[${JSON.stringify(id)}] = probe;
        return true;
      })()`,
        returnByValue: true,
        awaitPromise: false,
      },
      sessionId,
    );
    return result.result?.value ? id : null;
  } catch {
    return null;
  }
}

async function pressedMoveProbeSawPoint(
  point: Point,
  id: string | null,
  buttons: number,
) {
  if (!id) return false;
  // The ego bridge can time out before Chromium has delivered the corresponding
  // trusted input event to the document. Give the event loop one short turn
  // before treating the timeout as a real dispatch failure.
  await inputEventDelay(50);
  try {
    const result = await cdp(
      "Runtime.evaluate",
      {
        expression: `(() => {
        const probe = window.__egoBrowserInputProbes?.[${JSON.stringify(id)}];
        return Boolean(probe?.events.some((event) =>
          Math.abs(event.x - ${JSON.stringify(point.x)}) <= 1 &&
          Math.abs(event.y - ${JSON.stringify(point.y)}) <= 1 &&
          (event.buttons & ${JSON.stringify(buttons)}) === ${JSON.stringify(buttons)}
        ));
      })()`,
        returnByValue: true,
        awaitPromise: false,
      },
      point.sessionId,
    );
    return Boolean(result.result?.value);
  } catch {
    return false;
  }
}

async function removePressedMoveProbe(id: string, sessionId?: string) {
  await cdp(
    "Runtime.evaluate",
    {
      expression: `(() => {
        const probes = window.__egoBrowserInputProbes || {};
        const probe = probes[${JSON.stringify(id)}];
        if (!probe) return;
        for (const type of ["mousemove", "drag", "dragenter", "dragover"]) {
          document.removeEventListener(type, probe.handler, true);
        }
        delete probes[${JSON.stringify(id)}];
      })()`,
      returnByValue: true,
      awaitPromise: false,
    },
    sessionId,
  );
}

async function finishHoverProbe(point: Point, id: string | null) {
  if (!id) return false;
  await inputEventDelay(50);
  try {
    const result = await cdp(
      "Runtime.evaluate",
      {
        expression: `(() => {
        const probes = window.__egoBrowserInputProbes || {};
        const probe = probes[${JSON.stringify(id)}];
        if (!probe) return { seen: false, fallback: false };
        document.removeEventListener("mousemove", probe.handler, true);
        document.removeEventListener("mouseover", probe.handler, true);
        delete probes[${JSON.stringify(id)}];
        if (probe.seen || !probe.target) return { seen: probe.seen, fallback: false };
        const target = probe.target;
        const init = {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: ${JSON.stringify(point.x)},
          clientY: ${JSON.stringify(point.y)},
          button: 0,
          buttons: 0,
        };
        target.dispatchEvent(new MouseEvent("mousemove", init));
        target.dispatchEvent(new MouseEvent("mouseover", init));
        return { seen: false, fallback: true };
      })()`,
        returnByValue: true,
        awaitPromise: false,
      },
      point.sessionId,
    );
    const value = result.result?.value;
    return Boolean(value?.seen || value?.fallback);
  } catch {
    return false;
  }
}

async function finishDragProbe(
  points: Point[],
  id: string | null,
  button: MouseButton,
) {
  if (!id) return false;
  await inputEventDelay(50);
  const first = points[0];
  const last = points.at(-1);
  try {
    const result = await cdp(
      "Runtime.evaluate",
      {
        expression: `(() => {
        const probes = window.__egoBrowserInputProbes || {};
        const probe = probes[${JSON.stringify(id)}];
        if (!probe) return { completed: false, fallback: false };
        document.removeEventListener("mousedown", probe.downHandler, true);
        document.removeEventListener("mouseup", probe.upHandler, true);
        delete probes[${JSON.stringify(id)}];
        if (probe.sourceDown && probe.targetUp) {
          return { completed: true, fallback: false };
        }
        const mouseButton = ${JSON.stringify(button === "left" ? 0 : button === "middle" ? 1 : 2)};
        const eventFor = (type, point, buttons) => {
          const target = document.elementFromPoint(point.x, point.y) || document.body;
          target.dispatchEvent(new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: point.x,
            clientY: point.y,
            button: mouseButton,
            buttons,
            detail: type === "mousemove" ? 0 : 1,
          }));
        };
        const points = ${JSON.stringify(points.map(({ x, y }) => ({ x, y })))};
        if (!probe.sourceDown) {
          eventFor("mousedown", points[0], 1);
          for (const point of points.slice(1)) eventFor("mousemove", point, 1);
        }
        if (!probe.targetUp) eventFor("mouseup", points.at(-1), 0);
        return { completed: false, fallback: true };
      })()`,
        returnByValue: true,
        awaitPromise: false,
      },
      last.sessionId ?? first.sessionId,
    );
    const value = result.result?.value;
    return Boolean(value?.completed || value?.fallback);
  } catch {
    return false;
  }
}

function canProbeInputFallback() {
  return Boolean((globalThis as any).ego?.sendCDPMessage);
}

/**
 * Dispatch a mouse wheel scroll, Playwright-style (mouse.wheel(deltaX, deltaY)).
 *
 * Sign convention follows the DOM WheelEvent: positive deltaY scrolls down,
 * negative scrolls up (CDP negates deltas internally when building the Blink
 * wheel event, so the DOM convention applies end to end). Defaults to scrolling
 * down by 300 CSS pixels.
 *
 * A visible, focused page receives the wheel through CDP
 * (Input.dispatchMouseEvent), exactly like Playwright. A backgrounded or
 * unfocused tab silently drops CDP wheel input, so there the scroll is
 * dispatched as a synthetic WheelEvent on the element at (x, y) instead.
 *
 * @param {number} [deltaX=0] Horizontal scroll delta in CSS pixels.
 * @param {number} [deltaY=300] Vertical scroll delta in CSS pixels; positive scrolls down.
 * @param {{x?: number, y?: number}} [options] Viewport point to dispatch the wheel at (default 0,0).
 * @returns {Promise<void>}
 */
export async function wheel(
  deltaX = 0,
  deltaY = 300,
  options: WheelOptions = {},
) {
  const x = numberValue(options.x ?? 0);
  const y = numberValue(options.y ?? 0);
  const dx = numberValue(deltaX);
  const dy = numberValue(deltaY);
  if (await isVisibleAndFocused()) {
    await browserCdp(
      "Input.dispatchMouseEvent",
      { type: "mouseWheel", x, y, deltaX: dx, deltaY: dy },
      undefined,
      1000,
    );
    return;
  }
  await dispatchSyntheticWheel(x, y, dx, dy);
}

/**
 * Whether the page is currently visible and focused. CDP wheel input is
 * delivered only to a foreground, focused target; otherwise wheel() routes
 * through a synthetic WheelEvent. Defaults to true when the probe fails so a
 * flaky probe never blocks a real foreground scroll.
 */
async function isVisibleAndFocused() {
  try {
    return Boolean(
      await evaluate(
        "document.visibilityState === 'visible' && document.hasFocus()",
      ),
    );
  } catch {
    return true;
  }
}

/**
 * Dispatch a synthetic WheelEvent on the element under (x, y), then perform the
 * native scroll. Used when the tab is backgrounded/unfocused and CDP wheel input
 * would be dropped. The WheelEvent triggers page wheel handlers (virtualized
 * lists, custom scrollers); the window.scrollBy actually moves an ordinary page,
 * since an untrusted WheelEvent does not perform the default scroll action.
 * The manual scroll is skipped when a handler calls preventDefault(), matching
 * how a real CDP wheel leaves the page in place (maps, canvases, custom scrollers).
 */
async function dispatchSyntheticWheel(
  x: number,
  y: number,
  deltaX: number,
  deltaY: number,
) {
  await evaluate(`(() => {
    const target = document.elementFromPoint(${JSON.stringify(x)}, ${JSON.stringify(y)})
      || document.scrollingElement || document.body;
    if (!target) return;
    const notPrevented = target.dispatchEvent(new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaX: ${JSON.stringify(deltaX)},
      deltaY: ${JSON.stringify(deltaY)},
      clientX: ${JSON.stringify(x)},
      clientY: ${JSON.stringify(y)}
    }));
    if (notPrevented) {
      window.scrollBy(${JSON.stringify(deltaX)}, ${JSON.stringify(deltaY)});
    }
  })()`);
}

/**
 * Scroll an element into view only if it is not already fully visible,
 * mirroring Playwright's locator.scrollIntoViewIfNeeded.
 * @param {string} selector CSS selector or @ref of the element to reveal.
 * @returns {Promise<void>}
 */
export async function scrollIntoViewIfNeeded(
  selector: string,
  options: { timeout?: number } = {},
) {
  await waitForActionableElement(selector, {
    timeout: options.timeout,
    stable: true,
  });
  await resolveAndCall(
    selector,
    "function(){ if (typeof this.scrollIntoViewIfNeeded === 'function') { this.scrollIntoViewIfNeeded(true); } else { this.scrollIntoView({ block: 'center', inline: 'center' }); } }",
  );
}

function maybeHighlight(point: Point, label?: string) {
  const ego = (globalThis as any).ego;
  if (!ego) return;
  ego.animationHighlightMouseToPosition?.(point.x, point.y);
  if (label) {
    ego.setAgentTaskState?.(label);
  }
}

function rememberMousePoint(point: Point) {
  currentMousePoint = { ...point };
}

async function dispatchMouse(
  point: Point,
  type: string,
  options: MouseEventOptions = {},
) {
  await browserCdp(
    "Input.dispatchMouseEvent",
    {
      type,
      x: point.x,
      y: point.y,
      ...options,
    },
    point.sessionId,
    INPUT_DISPATCH_TIMEOUT_MS,
  );
}

function isInputDispatchTimeout(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /CDP request timed out: Input\.dispatchMouseEvent/.test(message);
}

async function resolveMouseTarget(
  target: MouseTarget,
  timeout = undefined,
  actionability: {
    visible?: boolean;
    stable?: boolean;
    receivesEvents?: boolean;
    enabled?: boolean;
    position?: { x: number; y: number };
  } = {},
): Promise<Point> {
  if (typeof target === "string") {
    return waitForActionableElement(target, {
      timeout,
      ...actionability,
    });
  }
  if (Array.isArray(target)) {
    return pointFrom(target);
  }
  if (target && typeof target === "object") {
    if (
      "selector" in target &&
      typeof target.selector === "string" &&
      target.selector
    ) {
      if (target.x === undefined && target.y === undefined) {
        return waitForActionableElement(target.selector, {
          timeout,
          ...actionability,
        });
      }
      return waitForActionableElement(target.selector, {
        timeout,
        ...actionability,
        position: {
          x: numberValue(target.x),
          y: numberValue(target.y),
        },
      });
    }
    if (target.x !== undefined || target.y !== undefined) {
      return pointFrom(target);
    }
  }
  throw new Error(`invalid mouse target: ${JSON.stringify(target)}`);
}

function modifierMask(modifiers: string[] | undefined) {
  if (!modifiers?.length) return 0;
  let mask = 0;
  for (const modifier of modifiers) {
    if (modifier === "Alt") mask |= 1;
    else if (modifier === "Control") mask |= 2;
    else if (modifier === "Meta") mask |= 4;
    else if (modifier === "Shift") mask |= 8;
    else if (modifier === "ControlOrMeta") {
      mask |= process.platform === "darwin" ? 4 : 2;
    } else {
      throw new Error(`unsupported mouse modifier: ${modifier}`);
    }
  }
  return mask;
}

function pointFrom(
  point: [number, number] | { x?: number; y?: number; sessionId?: string },
) {
  const x = Array.isArray(point) ? point[0] : point?.x;
  const y = Array.isArray(point) ? point[1] : point?.y;
  if (!Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) {
    throw new Error(`invalid mouse target: ${JSON.stringify(point)}`);
  }
  const sessionId =
    !Array.isArray(point) && typeof point?.sessionId === "string"
      ? point.sessionId
      : undefined;
  return { x: Number(x), y: Number(y), sessionId };
}

function numberValue(value: unknown) {
  const out = value === undefined ? 0 : Number(value);
  if (!Number.isFinite(out)) {
    throw new Error(`invalid mouse offset: ${JSON.stringify(value)}`);
  }
  return out;
}

function pressedButtons(button: MouseButton) {
  if (button === "left") {
    return 1;
  }
  if (button === "right") {
    return 2;
  }
  if (button === "middle") {
    return 4;
  }
  throw new Error(`unsupported mouse button: ${button}`);
}

function mouseButtonIndex(button: MouseButton) {
  if (button === "left") return 0;
  if (button === "middle") return 1;
  if (button === "right") return 2;
  throw new Error(`unsupported mouse button: ${button}`);
}

function mouseCompletionEvent(button: MouseButton) {
  if (button === "left") return "click";
  if (button === "middle") return "auxclick";
  if (button === "right") return "contextmenu";
  throw new Error(`unsupported mouse button: ${button}`);
}

function pressedMouseButtonMask() {
  let mask = 0;
  for (const button of pressedMouseButtons) {
    mask |= pressedButtons(button);
  }
  return mask;
}

function lastPressedMouseButton() {
  return [...pressedMouseButtons].at(-1);
}
