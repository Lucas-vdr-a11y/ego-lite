import { ensureSession, subscribeBrowserEvent } from "./browser-runtime.js";
import { cdp } from "./cdp-eval.js";
import {
  ElementResolutionError,
  selectorResolutionError,
} from "./element-resolver.js";
import { queryAllExpression } from "./locator-query.js";

export type LocatorTarget = {
  selector: string;
  frameChain: string[];
};

export type FrameContext = {
  sessionId: string;
  executionContextId?: number;
  frameId?: string;
  offset: { x: number; y: number };
  inputSessionId?: string;
  scale?: { x: number; y: number };
  frameVisible?: false;
  frameOwners?: FrameOwnerContext[];
};

type ResolveFrameContextOptions = {
  scrollIntoView?: boolean;
  trackFrameOwners?: boolean;
  cdpTimeoutMs?: number;
};

export type FrameOwnerContext = {
  selector: string;
  sessionId: string;
  executionContextId?: number;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
};

const oopifSessions = new Map<string, string>();
const oopifSessionInflight = new Map<string, Promise<string | null>>();

subscribeBrowserEvent("Target.detachedFromTarget", undefined, (event) => {
  const sessionId = event.params?.sessionId;
  if (!sessionId) return;
  for (const [frameId, cachedSessionId] of oopifSessions) {
    if (cachedSessionId === sessionId) {
      oopifSessions.delete(frameId);
      oopifSessionInflight.delete(frameId);
    }
  }
});
subscribeBrowserEvent("Target.targetDestroyed", undefined, (event) => {
  const targetId = event.params?.targetId;
  if (targetId) {
    oopifSessions.delete(targetId);
    oopifSessionInflight.delete(targetId);
  }
});

export function locatorTarget(
  selector: string,
  frameChain: string[] = [],
): string | LocatorTarget {
  return frameChain.length
    ? { selector, frameChain: [...frameChain] }
    : selector;
}

export function isLocatorTarget(value: unknown): value is LocatorTarget {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as LocatorTarget).selector === "string" &&
    Array.isArray((value as LocatorTarget).frameChain),
  );
}

export async function resolveFrameContext(
  frameChain: string[],
  options: ResolveFrameContextOptions = {},
): Promise<FrameContext> {
  let context: FrameContext = {
    sessionId: await ensureSession(),
    offset: { x: 0, y: 0 },
  };
  for (const frameSelector of frameChain) {
    context = await resolveChildFrame(context, frameSelector, options);
  }
  return context;
}

async function resolveChildFrame(
  parent: FrameContext,
  frameSelector: string,
  options: ResolveFrameContextOptions,
): Promise<FrameContext> {
  const expression = `(() => {
    const elements = ${queryAllExpression(frameSelector)};
    if (elements.length === 0) throw new Error(${JSON.stringify(
      `Frame locator ${frameSelector} matched 0 elements`,
    )});
    if (elements.length > 1) throw new Error(${JSON.stringify(
      `Frame locator ${frameSelector} matched `,
    )} + elements.length + " elements");
    const frame = elements[0];
    if (!(frame instanceof HTMLIFrameElement) && !(frame instanceof HTMLFrameElement)) {
      throw new Error(${JSON.stringify(
        `Frame locator ${frameSelector} resolved to a non-frame element`,
      )});
    }
    return frame;
  })()`;
  let evaluated;
  try {
    evaluated = await cdp(
      "Runtime.evaluate",
      {
        expression,
        returnByValue: false,
        awaitPromise: false,
        objectGroup: "ego-browser-frame",
        ...(parent.executionContextId === undefined
          ? {}
          : { contextId: parent.executionContextId }),
      },
      parent.sessionId,
      options.cdpTimeoutMs,
    );
  } catch (error) {
    throw frameLifecycleResolutionError(frameSelector, error);
  }
  if (evaluated.exceptionDetails) {
    throw selectorResolutionError(frameSelector, evaluated);
  }
  const objectId = evaluated.result?.objectId;
  if (!objectId) {
    throw new ElementResolutionError(
      `Frame locator ${frameSelector} matched 0 elements`,
      "transient",
    );
  }
  try {
    const [described, measured] = await Promise.all([
      cdp(
        "DOM.describeNode",
        { objectId },
        parent.sessionId,
        options.cdpTimeoutMs,
      ),
      cdp(
        "Runtime.callFunctionOn",
        {
          functionDeclaration:
            "function(scrollIntoView){if(scrollIntoView&&typeof this.scrollIntoView==='function')this.scrollIntoView({block:'center',inline:'center',behavior:'instant'});const rect=this.getBoundingClientRect();const style=getComputedStyle(this);const scaleX=rect.width/(this.offsetWidth||rect.width||1);const scaleY=rect.height/(this.offsetHeight||rect.height||1);const visible=rect.width>0&&rect.height>0&&style.visibility!=='hidden'&&style.display!=='none'&&(typeof this.checkVisibility!=='function'||this.checkVisibility({checkOpacity:false,checkVisibilityCSS:true}));return{x:rect.x+(this.clientLeft||0)*scaleX,y:rect.y+(this.clientTop||0)*scaleY,width:rect.width,height:rect.height,visible,scaleX,scaleY};}",
          objectId,
          arguments: [{ value: Boolean(options.scrollIntoView) }],
          returnByValue: true,
          awaitPromise: false,
        },
        parent.sessionId,
        options.cdpTimeoutMs,
      ),
    ]);
    const frameId = described.node?.frameId;
    if (!frameId) {
      throw new ElementResolutionError(
        `Frame locator ${frameSelector} has no frameId`,
        "transient",
      );
    }
    const isolated = await createFrameWorld(
      frameId,
      parent.sessionId,
      options.cdpTimeoutMs,
    );
    const executionContextId = isolated.executionContextId;
    if (executionContextId === undefined) {
      throw new ElementResolutionError(
        `Frame locator ${frameSelector} has no execution context`,
        "transient",
      );
    }
    const rect = measured.result?.value || {};
    const parentScale = parent.scale || { x: 1, y: 1 };
    const scale = {
      x: parentScale.x * finiteScale(rect.scaleX),
      y: parentScale.y * finiteScale(rect.scaleY),
    };
    return {
      sessionId: isolated.sessionId,
      executionContextId,
      frameId,
      offset: {
        x: parent.offset.x + Number(rect.x || 0) * parentScale.x,
        y: parent.offset.y + Number(rect.y || 0) * parentScale.y,
      },
      ...(isolated.sessionId !== parent.sessionId || parent.inputSessionId
        ? {
            inputSessionId: parent.inputSessionId || parent.sessionId,
          }
        : {}),
      ...(scale.x !== 1 || scale.y !== 1 ? { scale } : {}),
      ...(parent.frameVisible === false || rect.visible === false
        ? { frameVisible: false as const }
        : {}),
      ...(options.trackFrameOwners
        ? {
            frameOwners: [
              ...(parent.frameOwners || []),
              {
                selector: frameSelector,
                sessionId: parent.sessionId,
                executionContextId: parent.executionContextId,
                x: Number(rect.x || 0),
                y: Number(rect.y || 0),
                scaleX: finiteScale(rect.scaleX),
                scaleY: finiteScale(rect.scaleY),
              },
            ],
          }
        : {}),
    };
  } catch (error) {
    throw frameLifecycleResolutionError(frameSelector, error);
  } finally {
    await cdp(
      "Runtime.releaseObject",
      { objectId },
      parent.sessionId,
      options.cdpTimeoutMs,
    ).catch(() => {});
  }
}

export async function frameOwnersReceiveEvents(
  owners: FrameOwnerContext[] | undefined,
  point: { x: number; y: number },
) {
  if (!owners?.length) return true;
  const parentPoints = new Array(owners.length);
  let framePoint = { ...point };
  for (let index = owners.length - 1; index >= 0; index -= 1) {
    const owner = owners[index];
    framePoint = {
      x: owner.x + framePoint.x * owner.scaleX,
      y: owner.y + framePoint.y * owner.scaleY,
    };
    parentPoints[index] = framePoint;
  }
  for (let index = 0; index < owners.length; index += 1) {
    const owner = owners[index];
    const currentPoint = parentPoints[index];
    const expression = `(() => {
      const framePoint = ${JSON.stringify(currentPoint)};
      const elements = ${queryAllExpression(owner.selector)};
      if (elements.length !== 1) return false;
      const frame = elements[0];
      const hit = document.elementFromPoint(framePoint.x, framePoint.y);
      return Boolean(hit && (hit === frame || frame.contains(hit)));
    })()`;
    let result;
    try {
      result = await cdp(
        "Runtime.evaluate",
        {
          expression,
          returnByValue: true,
          awaitPromise: false,
          ...(owner.executionContextId === undefined
            ? {}
            : { contextId: owner.executionContextId }),
        },
        owner.sessionId,
      );
    } catch (error) {
      throw frameLifecycleResolutionError(owner.selector, error);
    }
    if (result.exceptionDetails) {
      throw selectorResolutionError(owner.selector, result);
    }
    if (!result.result?.value) return false;
  }
  return true;
}

function finiteScale(value: unknown) {
  const scale = Number(value ?? 1);
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

async function createFrameWorld(
  frameId: string,
  parentSessionId: string,
  cdpTimeoutMs?: number,
) {
  const params = {
    frameId,
    worldName: "ego-browser-frame",
    grantUniveralAccess: false,
  };
  try {
    const result = await cdp(
      "Page.createIsolatedWorld",
      params,
      parentSessionId,
      cdpTimeoutMs,
    );
    return { ...result, sessionId: parentSessionId };
  } catch (error) {
    let sessionId = await oopifSession(frameId, cdpTimeoutMs);
    if (!sessionId) throw error;
    try {
      const result = await cdp(
        "Page.createIsolatedWorld",
        params,
        sessionId,
        cdpTimeoutMs,
      );
      return { ...result, sessionId };
    } catch (childError) {
      if (!isSessionLost(childError)) throw childError;
      oopifSessions.delete(frameId);
      sessionId = await oopifSession(frameId, cdpTimeoutMs);
      if (!sessionId) throw childError;
      const result = await cdp(
        "Page.createIsolatedWorld",
        params,
        sessionId,
        cdpTimeoutMs,
      );
      return { ...result, sessionId };
    }
  }
}

async function oopifSession(frameId: string, cdpTimeoutMs?: number) {
  const cached = oopifSessions.get(frameId);
  if (cached) return cached;
  const inflight = oopifSessionInflight.get(frameId);
  if (inflight) return inflight;
  const attaching = attachOopifSession(frameId, cdpTimeoutMs).finally(() => {
    oopifSessionInflight.delete(frameId);
  });
  oopifSessionInflight.set(frameId, attaching);
  return attaching;
}

async function attachOopifSession(frameId: string, cdpTimeoutMs?: number) {
  const targets =
    (await cdp("Target.getTargets", {}, undefined, cdpTimeoutMs)).targetInfos ||
    [];
  const target = targets.find(
    (candidate) =>
      candidate.type === "iframe" && candidate.targetId === frameId,
  );
  if (!target) return null;
  const attached = await cdp(
    "Target.attachToTarget",
    {
      targetId: target.targetId,
      flatten: true,
    },
    undefined,
    cdpTimeoutMs,
  );
  const sessionId = attached.sessionId;
  if (!sessionId) return null;
  oopifSessions.set(frameId, sessionId);
  return sessionId;
}

export function isFrameLifecycleError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /Session (?:with given id )?not found|Target closed|No session|Execution context was destroyed|Cannot find context|Cannot find object|Could not find object|Node.*detached|No frame for given id/i.test(
    message,
  );
}

function isSessionLost(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /Session (?:with given id )?not found|Target closed|No session/i.test(
    message,
  );
}

function frameLifecycleResolutionError(frameSelector: string, error: unknown) {
  if (
    error instanceof ElementResolutionError ||
    !isFrameLifecycleError(error)
  ) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error ?? "");
  return new ElementResolutionError(
    `Frame locator ${frameSelector} changed while resolving: ${message}`,
    "transient",
  );
}
