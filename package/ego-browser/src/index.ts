#!/usr/bin/env node
import { pathToFileURL } from "node:url";

import * as helpers from "./helpers.js";
import {
  clearPreferredTarget,
  invalidateSession,
  setPreferredTarget,
} from "./browser-runtime.js";
import { formatCliLogValue } from "./format.js";
import { installLegacySkillGuards } from "./legacy-skill-guard.js";
import {
  bufferOutput,
  installLifecycleFlush,
  resetSink,
  setNoticeTrailer,
} from "./output-sink.js";
import { runMain } from "./run.js";
import { emitUpdateNotice, type VersionSource } from "./update-notice.js";

type HelperFunction = (...args: unknown[]) => unknown;
type EgoRuntime = Record<string, unknown> & {
  helpers?: Record<string, unknown>;
  learnings?: Record<string, unknown>;
};
type InstallTarget = Record<string, unknown> & {
  ego?: EgoRuntime;
};
type InstallEgoSdkOptions = {
  context?: Record<string, unknown>;
  ready?: unknown;
  // Host-provided output sink, bound to console.log (the agent's output channel).
  // When omitted, the buffered default is used and flushed on process teardown.
  cliLog?: HelperFunction;
};

export * from "./helpers.js";
export { runMain } from "./run.js";

const SYNC_HELPERS = new Set(["help"]);
const SYNC_START_HELPERS = new Set([
  "page.waitForEvent",
  "page.isClosed",
  "page.on",
  "page.once",
  "page.off",
  "page.removeAllListeners",
]);
const SYNC_PAGE_READ_HELPERS = new Set([
  "page.url",
  "page.frame",
  "page.frames",
  "page.mainFrame",
  "page.viewportSize",
]);
const SYNC_FACTORY_HELPERS = new Set([
  "page.locator",
  "page.frameLocator",
  "page.getByRole",
  "page.getByText",
  "page.getByLabel",
  "page.getByPlaceholder",
  "page.getByAltText",
  "page.getByTitle",
  "page.getByTestId",
  "page.locator.first",
  "page.locator.nth",
  "page.locator.last",
  "page.locator.locator",
  "page.locator.getByRole",
  "page.locator.getByText",
  "page.locator.getByLabel",
  "page.locator.getByPlaceholder",
  "page.locator.getByAltText",
  "page.locator.getByTitle",
  "page.locator.getByTestId",
  "page.locator.filter",
]);
const SYNC_FACTORY_METHODS = new Set([
  "locator",
  "frameLocator",
  "getByRole",
  "getByText",
  "getByLabel",
  "getByPlaceholder",
  "getByAltText",
  "getByTitle",
  "getByTestId",
  "first",
  "nth",
  "last",
  "and",
  "or",
  "filter",
  "contentFrame",
  "owner",
]);
// Marks an ego runtime whose mutating methods have already been wrapped, so a
// second installEgoSdk call cannot double-wrap createTab / task-space methods.
const EGO_WRAPPED = Symbol.for("egoBrowser.sdkWrapped");

export function installEgoSdk(
  target: InstallTarget = globalThis,
  options: InstallEgoSdkOptions = {},
) {
  if (!target || typeof target !== "object") {
    return target;
  }
  Reflect.deleteProperty(target, "taskSpaces");
  const context = options.context || helpers.helperContext();
  const readyImmediately = options.ready === undefined;
  const readySignal = Promise.resolve(options.ready);
  const wrappedObjects = new WeakMap<object, unknown>();
  const wrappedCallbacks = new WeakMap<Function, Map<string, Function>>();
  let readyError = null;
  readySignal.catch((error) => {
    readyError = error;
  });
  const installed: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(context)) {
    const exposed = SYNC_HELPERS.has(name)
      ? value
      : wrapReady(
          value,
          readySignal,
          () => readyError,
          [name],
          readyImmediately,
          wrappedObjects,
          wrappedCallbacks,
        );
    Object.defineProperty(target, name, {
      value: exposed,
      writable: true,
      configurable: true,
      enumerable: false,
    });
    installed[name] = exposed;
  }
  installLegacySkillGuards(target);
  const usingDefaultLog = !options.cliLog;
  // The agent's primary output channel is console.log. Route it through the host's
  // sink (options.cliLog) when provided, otherwise the buffered default. There is no
  // dedicated cliLog global anymore; console.error/warn are left untouched. Each
  // heredoc runs in its own short-lived process, so overriding the global is per-run.
  console.log = options.cliLog || createBufferedLog();
  if (usingDefaultLog) {
    // SDK path: the host runs each heredoc in a fresh short-lived process and never
    // calls execute(), so reset the per-run sink and flush it on process teardown.
    resetSink();
    installLifecycleFlush(process.stdout);
  }
  if (target.ego && typeof target.ego === "object") {
    // Fire-and-forget update hint. Route the resolved line to the same channel the
    // command's own output uses: the buffered-sink path registers it as a trailer the
    // sink appends after that output (so it reads as a footer, not a prefix), while a
    // host-provided cliLog gets the line directly. Never touches process.stdout blindly.
    emitUpdateNotice(
      target.ego as { getBrowserVersion?: VersionSource },
      usingDefaultLog ? setNoticeTrailer : (line) => options.cliLog?.(line),
    );
    target.ego.helpers = installed;
    target.ego.learnings =
      installed.site && typeof installed.site === "object"
        ? (installed.site as Record<string, unknown>)
        : {};
    if (!(target.ego as Record<symbol, unknown>)[EGO_WRAPPED]) {
      wrapCreateTab(target.ego);
      wrapInvalidating(target.ego, [
        "useTaskSpace",
        "closeTaskSpace",
        "createTaskSpace",
        "claimTaskSpace",
      ]);
      Object.defineProperty(target.ego, EGO_WRAPPED, {
        value: true,
        enumerable: false,
      });
    }
  }
  return target;
}

function wrapReady(
  value: unknown,
  readySignal: Promise<unknown>,
  readyError: () => unknown,
  path: string[] = [],
  readyImmediately = false,
  wrappedObjects: WeakMap<object, unknown> = new WeakMap(),
  wrappedCallbacks: WeakMap<Function, Map<string, Function>> = new WeakMap(),
): unknown {
  if (typeof value === "function") {
    if (isSyncFactoryHelper(path)) {
      return (...args: unknown[]) =>
        wrapReady(
          value(
            ...mapCallbackArguments(
              args,
              path,
              wrappedObjects,
              wrappedCallbacks,
            ),
          ),
          readySignal,
          readyError,
          path,
          readyImmediately,
          wrappedObjects,
          wrappedCallbacks,
        );
    }
    if (SYNC_PAGE_READ_HELPERS.has(path.join("."))) {
      return (...args: unknown[]) =>
        mapReturnedValue(
          value(
            ...mapCallbackArguments(
              args,
              path,
              wrappedObjects,
              wrappedCallbacks,
            ),
          ),
          path,
          wrappedObjects,
        );
    }
    if (readyImmediately && isSyncStartHelper(path)) {
      return (...args: unknown[]) => {
        const result = value(
          ...mapCallbackArguments(args, path, wrappedObjects, wrappedCallbacks),
        );
        const mapKnownObject = (resolved) =>
          resolved &&
          typeof resolved === "object" &&
          wrappedObjects.has(resolved)
            ? wrappedObjects.get(resolved)
            : resolved;
        return result && typeof (result as Promise<unknown>).then === "function"
          ? Promise.resolve(result).then(mapKnownObject)
          : mapKnownObject(result);
      };
    }
    return async (...args: unknown[]) => {
      await readySignal;
      const error = readyError();
      if (error) {
        throw error;
      }
      const result = await value(
        ...mapCallbackArguments(args, path, wrappedObjects, wrappedCallbacks),
      );
      return mapReturnedValue(result, path, wrappedObjects);
    };
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((child, index) =>
      wrapReady(
        child,
        readySignal,
        readyError,
        [...path, String(index)],
        readyImmediately,
        wrappedObjects,
        wrappedCallbacks,
      ),
    );
  }
  const wrapped: Record<string, unknown> = {};
  wrappedObjects.set(value, wrapped);
  for (const [key, child] of Object.entries(value)) {
    wrapped[key] = wrapReady(
      child,
      readySignal,
      readyError,
      [...path, key],
      readyImmediately,
      wrappedObjects,
      wrappedCallbacks,
    );
  }
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable) continue;
    Object.defineProperty(wrapped, key, descriptor);
  }
  return wrapped;
}

function mapReturnedValue(
  value: unknown,
  path: string[],
  wrappedObjects: WeakMap<object, unknown>,
): unknown {
  if (value && typeof value === "object" && wrappedObjects.has(value)) {
    return wrappedObjects.get(value);
  }
  const joined = path.join(".");
  if (
    joined !== "page.frame" &&
    joined !== "page.frames" &&
    joined !== "page.mainFrame"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((frame) => wrapFrame(frame, wrappedObjects));
  }
  return wrapFrame(value, wrappedObjects);
}

function wrapFrame(
  frame: unknown,
  wrappedObjects: WeakMap<object, unknown>,
): unknown {
  if (!frame || typeof frame !== "object") return frame;
  if (wrappedObjects.has(frame)) return wrappedObjects.get(frame);
  const source = frame as Record<string | symbol, unknown>;
  const wrapped: Record<string | symbol, unknown> = { ...source };
  wrappedObjects.set(frame, wrapped);
  const ownerPage = source.page;
  if (typeof ownerPage === "function") {
    wrapped.page = () => {
      const owner = ownerPage();
      return owner && typeof owner === "object" && wrappedObjects.has(owner)
        ? wrappedObjects.get(owner)
        : owner;
    };
  }
  const parentFrame = source.parentFrame;
  if (typeof parentFrame === "function") {
    wrapped.parentFrame = () => wrapFrame(parentFrame(), wrappedObjects);
  }
  const childFrames = source.childFrames;
  if (typeof childFrames === "function") {
    wrapped.childFrames = () =>
      (childFrames() as unknown[]).map((child) =>
        wrapFrame(child, wrappedObjects),
      );
  }
  for (const key of Reflect.ownKeys(source)) {
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    if (!descriptor || descriptor.enumerable) continue;
    Object.defineProperty(wrapped, key, descriptor);
  }
  return wrapped;
}

function mapCallbackArguments(
  args: unknown[],
  path: string[],
  wrappedObjects: WeakMap<object, unknown>,
  wrappedCallbacks: WeakMap<Function, Map<string, Function>>,
) {
  const joined = path.join(".");
  const callbackIndex =
    joined === "page.exposeBinding" ||
    joined === "page.on" ||
    joined === "page.once" ||
    joined === "page.off"
      ? 1
      : -1;
  if (callbackIndex < 0 || typeof args[callbackIndex] !== "function") {
    return args;
  }
  const callback = args[callbackIndex] as Function;
  const family = joined === "page.exposeBinding" ? joined : "page.events";
  let byFamily = wrappedCallbacks.get(callback);
  if (!byFamily) {
    byFamily = new Map();
    wrappedCallbacks.set(callback, byFamily);
  }
  let wrapped = byFamily.get(family);
  if (!wrapped) {
    wrapped = (...callbackArgs: unknown[]) =>
      callback(
        ...callbackArgs.map((argument) =>
          mapKnownCallbackValue(argument, wrappedObjects),
        ),
      );
    byFamily.set(family, wrapped);
  }
  const mapped = [...args];
  mapped[callbackIndex] = wrapped;
  return mapped;
}

function mapKnownCallbackValue(
  value: unknown,
  wrappedObjects: WeakMap<object, unknown>,
) {
  if (!value || typeof value !== "object") return value;
  if (wrappedObjects.has(value)) return wrappedObjects.get(value);
  if (Array.isArray(value)) return value;
  let mapped: Record<string, unknown> | undefined;
  for (const [key, child] of Object.entries(value)) {
    if (!child || typeof child !== "object" || !wrappedObjects.has(child)) {
      continue;
    }
    mapped ||= { ...(value as Record<string, unknown>) };
    mapped[key] = wrappedObjects.get(child);
  }
  return mapped || value;
}

function isSyncFactoryHelper(path: string[]) {
  if (SYNC_FACTORY_HELPERS.has(path.join("."))) {
    return true;
  }
  return path[0] === "page" && SYNC_FACTORY_METHODS.has(path.at(-1) || "");
}

function isSyncStartHelper(path: string[]) {
  if (SYNC_START_HELPERS.has(path.join("."))) return true;
  return path[0] === "page" && path.length >= 3 && path.at(-1) === "page";
}

if (isDirectCli()) {
  try {
    process.exitCode = await runMain();
  } catch (error) {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  }
} else {
  const context = helpers.helperContext();
  installEgoSdk(globalThis, { context });
}

function createBufferedLog() {
  return (...args: unknown[]) => {
    // Buffer instead of writing through: a hard stop later in the run must be able to
    // discard everything logged so far. The buffer is flushed on process teardown.
    bufferOutput(`${args.map(formatCliLogValue).join(" ")}\n`);
  };
}

function isDirectCli() {
  return (
    process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url
  );
}

function wrapInvalidating(ego: EgoRuntime, methodNames: string[]) {
  for (const name of methodNames) {
    const original = ego[name];
    if (typeof original !== "function") continue;
    const after = () => {
      invalidateSession();
      clearPreferredTarget();
    };
    ego[name] = function (...args: unknown[]) {
      const result = original.apply(this, args);
      if (result && typeof result.then === "function") {
        return result.then((value) => {
          after();
          return value;
        });
      }
      after();
      return result;
    };
  }
}

function wrapCreateTab(ego: EgoRuntime) {
  const original = ego.createTab;
  if (typeof original !== "function") return;
  ego.createTab = function (...args: unknown[]) {
    const result = original.apply(this, args);
    if (result && typeof result.then === "function") {
      return result.then((value) => {
        invalidateSession();
        const id = value?.targetId || value?.result?.targetId;
        if (id) setPreferredTarget(id);
        return value;
      });
    }
    invalidateSession();
    return result;
  };
}
