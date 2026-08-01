import { ensureSession, subscribeBrowserEvent } from "./browser-runtime.js";
import { cdp, evaluateWithArguments } from "./cdp-eval.js";
import { ensureFrameWorld, invalidateFrameWorld } from "./frame-context.js";
import { createJSHandle } from "./js-handle.js";
import { state } from "./state.js";

type FrameRecord = {
  id: string;
  parentId?: string;
  name: string;
  url: string;
  childIds: string[];
};

type FrameState = {
  record: FrameRecord;
  sessionId?: string;
  detached: boolean;
};

export function createPageFrameController(
  page,
  options: {
    initialUrl?: string;
    onMainFrameUrl?: (url: string) => void;
    sessionId?: () => string | undefined;
  } = {},
) {
  const frameStates = new Map<string, FrameState>();
  const facades = new Map<string, any>();

  const facadeFor = (recordOrId: FrameRecord | string | undefined): any => {
    const id = typeof recordOrId === "string" ? recordOrId : recordOrId?.id;
    if (!id || !frameStates.has(id)) return null;
    if (facades.has(id)) return facades.get(id);
    const current = () => {
      const frameState = frameStates.get(id);
      if (!frameState) throw new Error("Frame has been detached");
      return frameState;
    };
    const facade = {
      name: () => current().record.name,
      url: () => current().record.url,
      page: () => page,
      parentFrame: () => facadeFor(current().record.parentId || undefined),
      childFrames: () =>
        current().record.childIds.map((childId) => facadeFor(childId)),
      isDetached: () => current().detached,
      evaluate: (pageFunction, arg = undefined) => {
        const frameState = current();
        if (!frameState.record.parentId) {
          return page.evaluate(pageFunction, arg);
        }
        return evaluateInFrame(
          frameState.sessionId,
          id,
          pageFunction,
          arg,
          false,
        );
      },
      evaluateHandle: (pageFunction, arg = undefined) => {
        const frameState = current();
        if (!frameState.record.parentId) {
          return page.evaluateHandle(pageFunction, arg);
        }
        return evaluateInFrame(
          frameState.sessionId,
          id,
          pageFunction,
          arg,
          true,
        );
      },
      goto: async (url, options: any = {}) => {
        const frameState = current();
        await cdp(
          "Page.navigate",
          { url: String(url), frameId: id },
          frameState.sessionId,
          options.timeout,
        );
        frameState.record.url = String(url);
        return null;
      },
      title: () => {
        const frameState = current();
        if (!frameState.record.parentId) return page.title();
        return evaluateInFrame(
          frameState.sessionId,
          id,
          "document.title",
          undefined,
          false,
        );
      },
    };
    Object.defineProperty(facade, "_id", { value: id });
    facades.set(id, facade);
    return facade;
  };

  let sessionId: string | undefined;

  const readFrames = async () => {
    sessionId = state.cdpOverride
      ? state.sessionId || undefined
      : await ensureSession();
    const result = await cdp("Page.getFrameTree", {}, sessionId);
    const records = new Map<string, FrameRecord>();
    flattenFrameTree(result.frameTree, records);
    for (const frameState of frameStates.values()) {
      frameState.detached = true;
    }
    for (const record of records.values()) {
      const existing = frameStates.get(record.id);
      if (existing) {
        existing.record = record;
        existing.sessionId = sessionId;
        existing.detached = false;
      } else {
        frameStates.set(record.id, {
          record,
          sessionId,
          detached: false,
        });
      }
    }
    return {
      records: [...records.values()],
      facadeFor,
    };
  };

  const acceptsEvent = (event) => {
    const currentSessionId = options.sessionId?.() || sessionId;
    return (
      Boolean(currentSessionId) &&
      (!event.sessionId || event.sessionId === currentSessionId)
    );
  };
  subscribeBrowserEvent("Page.frameAttached", undefined, (event) => {
    if (!acceptsEvent(event)) return;
    const { frameId, parentFrameId } = event.params || {};
    if (!frameId) return;
    const existing = frameStates.get(frameId);
    const record: FrameRecord = existing?.record || {
      id: frameId,
      name: "",
      url: "",
      childIds: [],
    };
    record.parentId = parentFrameId || undefined;
    frameStates.set(frameId, {
      record,
      sessionId,
      detached: false,
    });
    const parent = parentFrameId && frameStates.get(parentFrameId);
    if (parent && !parent.record.childIds.includes(frameId)) {
      parent.record.childIds.push(frameId);
    }
  });
  subscribeBrowserEvent("Page.frameNavigated", undefined, (event) => {
    if (!acceptsEvent(event)) return;
    const frame = event.params?.frame;
    if (!frame?.id) return;
    invalidateFrameWorld(frame.id);
    const existing = frameStates.get(frame.id);
    const record: FrameRecord = {
      id: frame.id,
      parentId: frame.parentId || undefined,
      name: frame.name || "",
      url: frame.url || "",
      childIds: existing?.record.childIds || [],
    };
    frameStates.set(frame.id, { record, sessionId, detached: false });
    if (!record.parentId) options.onMainFrameUrl?.(record.url);
  });
  subscribeBrowserEvent("Page.frameDetached", undefined, (event) => {
    if (!acceptsEvent(event)) return;
    const frameId = event.params?.frameId;
    const detached = frameId && frameStates.get(frameId);
    if (!detached) return;
    invalidateFrameWorld(frameId);
    detached.detached = true;
    const parent = detached.record.parentId
      ? frameStates.get(detached.record.parentId)
      : undefined;
    if (parent) {
      parent.record.childIds = parent.record.childIds.filter(
        (childId) => childId !== frameId,
      );
    }
  });

  return {
    initialize: readFrames,
    frames: () =>
      [...frameStates.values()]
        .filter((frameState) => !frameState.detached)
        .map((frameState) => facadeFor(frameState.record)),
    mainFrame: () => {
      const main = [...frameStates.values()].find(
        (frameState) => !frameState.detached && !frameState.record.parentId,
      );
      return main ? facadeFor(main.record) : null;
    },
    frame: (selector) => {
      for (const frameState of frameStates.values()) {
        if (!frameState.detached && frameMatches(frameState.record, selector)) {
          return facadeFor(frameState.record);
        }
      }
      return null;
    },
    url: () => {
      const main = [...frameStates.values()].find(
        (frameState) => !frameState.detached && !frameState.record.parentId,
      );
      return main?.record.url || options.initialUrl || "";
    },
  };
}

function flattenFrameTree(node, records: Map<string, FrameRecord>, parentId?) {
  const frame = node?.frame;
  if (!frame?.id) return;
  const record: FrameRecord = {
    id: frame.id,
    parentId: frame.parentId || parentId,
    name: frame.name || "",
    url: frame.url || "",
    childIds: [],
  };
  records.set(record.id, record);
  for (const child of node.childFrames || []) {
    if (child.frame?.id) record.childIds.push(child.frame.id);
    flattenFrameTree(child, records, record.id);
  }
}

function frameMatches(record: FrameRecord, selector) {
  if (typeof selector === "string") return record.name === selector;
  if (!selector || typeof selector !== "object") {
    throw new TypeError("page.frame expects a frame name or selector object");
  }
  if (selector.name !== undefined && record.name !== String(selector.name)) {
    return false;
  }
  if (selector.url === undefined) return true;
  if (typeof selector.url === "function") {
    return Boolean(selector.url(new URL(record.url)));
  }
  if (selector.url instanceof RegExp) {
    selector.url.lastIndex = 0;
    return selector.url.test(record.url);
  }
  return record.url === String(selector.url);
}

async function evaluateInFrame(
  sessionId,
  frameId,
  pageFunction,
  arg,
  returnHandle,
) {
  const isolated = await ensureFrameWorld(frameId, sessionId);
  const isFunction = typeof pageFunction === "function";
  if (!isFunction && typeof pageFunction !== "string") {
    throw new TypeError("Frame.evaluate expects a function or string");
  }
  const remoteOrValue = await evaluateWithArguments(
    String(pageFunction),
    isFunction,
    arg,
    {
      apiName: returnHandle ? "Frame.evaluateHandle" : "Frame.evaluate",
      sessionId: isolated.sessionId,
      executionContextId: isolated.executionContextId,
      returnHandle,
      objectGroup: "ego-browser-frame-evaluation",
    },
  );
  if (!returnHandle) return remoteOrValue;
  return createJSHandle(
    remoteOrValue,
    isolated.sessionId,
    isolated.executionContextId,
  );
}
