import { cdp, runtimeValue } from "../cdp-eval.js";
import { ElementResolutionError } from "../element-resolver.js";
import {
  frameOwnersReceiveEvents,
  isLocatorTarget,
  resolveFrameContext,
  type LocatorTarget,
} from "../frame-context.js";
import {
  normalizeTimeout,
  operationTimeout,
  timeoutDeadline,
} from "../playwright-errors.js";
import { state } from "../state.js";
import { releaseHandle, resolveHandle } from "./element-ops.js";

type Position = { x: number; y: number };

export type ActionabilityOptions = {
  apiName?: string;
  timeout?: number;
  visible?: boolean;
  stable?: boolean;
  receivesEvents?: boolean;
  enabled?: boolean;
  editable?: boolean;
  position?: Position;
};

type Probe = {
  attached: boolean;
  visible: boolean;
  enabled: boolean;
  editable: boolean;
  receivesEvents: boolean;
  rect: { x: number; y: number; width: number; height: number };
};

const ACTIONABILITY_PROBE = `function(position) {
  if (!this.isConnected) return { attached: false };
  if (typeof this.scrollIntoView === "function") {
    this.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  }
  const rect = this.getBoundingClientRect();
  const style = getComputedStyle(this);
  const visible = rect.width > 0 && rect.height > 0
    && style.visibility !== "hidden"
    && style.display !== "none"
    && (typeof this.checkVisibility !== "function"
      || this.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true }));
  const disabledAncestor = this.closest("[aria-disabled=true], :disabled");
  const enabled = !disabledAncestor;
  const textInput = this instanceof HTMLInputElement
    && !["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"].includes(this.type);
  const editable = enabled && (
    this.isContentEditable
    || ((textInput || this instanceof HTMLTextAreaElement) && !this.readOnly)
  );
  const x = rect.x + (position ? Number(position.x) : rect.width / 2);
  const y = rect.y + (position ? Number(position.y) : rect.height / 2);
  const root = this.getRootNode();
  const hit = typeof root.elementFromPoint === "function"
    ? root.elementFromPoint(x, y)
    : this.ownerDocument.elementFromPoint(x, y);
  const associatedLabelReceivesEvents = Boolean(
    hit
    && this.labels
    && Array.from(this.labels).some((label) => label === hit || label.contains(hit))
  );
  const receivesEvents = Boolean(
    hit
    && (hit === this || this.contains(hit) || associatedLabelReceivesEvents)
  );
  return {
    attached: true,
    visible,
    enabled,
    editable,
    receivesEvents,
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  };
}`;

/**
 * Resolve a locator repeatedly until its requested Playwright-style
 * actionability checks pass, then return the viewport point for input dispatch.
 */
export async function waitForActionableElement(
  selector: string | LocatorTarget,
  options: ActionabilityOptions = {},
) {
  const apiName = options.apiName || "locator action";
  const timeout = normalizeTimeout(
    apiName,
    options.timeout ?? state.defaultTimeout,
  );
  const deadline = timeoutDeadline(timeout, state.now());
  let previousRect: Probe["rect"] | null = null;
  let lastIssue = "element was not actionable";

  while (state.now() < deadline) {
    let handle;
    try {
      handle = await resolveHandle(selector, {
        scrollFrames: requiresLayoutProbe(options),
        trackFrameOwners: Boolean(options.receivesEvents),
      });
    } catch (error) {
      if (
        error instanceof ElementResolutionError &&
        error.kind === "transient"
      ) {
        lastIssue = error.message;
        await state.sleep(50);
        continue;
      }
      throw error;
    }

    if (!requiresLayoutProbe(options)) {
      await releaseHandle(handle.objectId, handle.sessionId);
      return { x: 0, y: 0, sessionId: handle.sessionId };
    }

    try {
      let response;
      try {
        response = await cdp(
          "Runtime.callFunctionOn",
          {
            functionDeclaration: ACTIONABILITY_PROBE,
            objectId: handle.objectId,
            arguments: [{ value: normalizedPosition(options.position) }],
            returnByValue: true,
            awaitPromise: false,
          },
          handle.sessionId,
        );
      } catch (error) {
        if (isDetachedDuringProbe(error)) {
          previousRect = null;
          lastIssue = "element detached while checking actionability";
          await state.sleep(50);
          continue;
        }
        throw error;
      }
      const probe = runtimeValue(response, ACTIONABILITY_PROBE) as Probe;
      if (!probe?.attached) {
        previousRect = null;
        lastIssue = "element is detached";
        await state.sleep(50);
        continue;
      }
      if (options.visible && handle.frameVisible === false) {
        previousRect = null;
        lastIssue = "frame owner is not visible";
        await state.sleep(50);
        continue;
      }
      if (options.visible && !probe.visible) {
        previousRect = null;
        lastIssue = "element is not visible";
        await state.sleep(50);
        continue;
      }
      if (options.enabled && !probe.enabled) {
        previousRect = null;
        lastIssue = "element is not enabled";
        await state.sleep(50);
        continue;
      }
      if (options.editable && !probe.editable) {
        previousRect = null;
        lastIssue = "element is not editable";
        await state.sleep(50);
        continue;
      }
      const position = normalizedPosition(options.position);
      const localX = probe.rect.x + (position?.x ?? probe.rect.width / 2);
      const localY = probe.rect.y + (position?.y ?? probe.rect.height / 2);
      let frameOffset = handle.frameOffset || { x: 0, y: 0 };
      let frameScale = handle.frameScale || { x: 1, y: 1 };
      let frameOwners = handle.frameOwners;
      if (
        options.receivesEvents &&
        handle.frameOffset !== undefined &&
        isLocatorTarget(selector)
      ) {
        try {
          const refreshed = await resolveFrameContext(selector.frameChain, {
            trackFrameOwners: true,
          });
          frameOffset = refreshed.offset;
          frameScale = refreshed.scale || { x: 1, y: 1 };
          frameOwners = refreshed.frameOwners;
        } catch (error) {
          if (
            error instanceof ElementResolutionError &&
            error.kind === "transient"
          ) {
            previousRect = null;
            lastIssue = error.message;
            await state.sleep(50);
            continue;
          }
          throw error;
        }
      }
      if (options.receivesEvents && !probe.receivesEvents) {
        previousRect = null;
        lastIssue = "element does not receive pointer events";
        await state.sleep(50);
        continue;
      }
      if (options.receivesEvents) {
        let frameReceivesEvents;
        try {
          frameReceivesEvents = await frameOwnersReceiveEvents(frameOwners, {
            x: localX,
            y: localY,
          });
        } catch (error) {
          if (
            error instanceof ElementResolutionError &&
            error.kind === "transient"
          ) {
            previousRect = null;
            lastIssue = error.message;
            await state.sleep(50);
            continue;
          }
          throw error;
        }
        if (!frameReceivesEvents) {
          previousRect = null;
          lastIssue =
            "frame owner does not receive pointer events at target point";
          await state.sleep(50);
          continue;
        }
      }
      const globalRect = {
        x: frameOffset.x + probe.rect.x * frameScale.x,
        y: frameOffset.y + probe.rect.y * frameScale.y,
        width: probe.rect.width * frameScale.x,
        height: probe.rect.height * frameScale.y,
      };
      if (options.stable && !sameRect(previousRect, globalRect)) {
        previousRect = globalRect;
        lastIssue = "element is not stable";
        await state.sleep(50);
        continue;
      }
      return {
        x: frameOffset.x + localX * frameScale.x,
        y: frameOffset.y + localY * frameScale.y,
        sessionId: handle.inputSessionId || handle.sessionId,
        ...(handle.frameOffset !== undefined
          ? {
              probeSessionId: handle.sessionId,
              probeExecutionContextId: handle.probeExecutionContextId,
              probeX: localX,
              probeY: localY,
            }
          : {}),
      };
    } finally {
      await releaseHandle(handle.objectId, handle.sessionId);
    }
  }

  throw operationTimeout(apiName, timeout, lastIssue);
}

function requiresLayoutProbe(options: ActionabilityOptions) {
  return Boolean(
    options.visible ||
    options.stable ||
    options.receivesEvents ||
    options.enabled ||
    options.editable ||
    options.position,
  );
}

function normalizedPosition(position?: Position) {
  if (position === undefined) return undefined;
  const x = Number(position.x);
  const y = Number(position.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new TypeError("locator action position requires finite x and y");
  }
  return { x, y };
}

function sameRect(left: Probe["rect"] | null, right: Probe["rect"]) {
  return Boolean(
    left &&
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height,
  );
}

function isDetachedDuringProbe(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /cannot find context|execution context was destroyed|could not find object|node.*detached|object.*not found/i.test(
    message,
  );
}
