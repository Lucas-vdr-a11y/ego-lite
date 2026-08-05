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
  createNativePlaywrightTaskSpaceConnector,
  disconnectPlaywrightTaskSpace,
  setPlaywrightTaskSpaceConnector,
} from "./playwright/taskspace.js";
import {
  bufferOutput,
  installLifecycleFlush,
  resetSink,
  setNoticeTrailer,
} from "./output-sink.js";
import { runMain } from "./run.js";
import { releaseTaskSpaceLease } from "./taskspace-lease.js";
import { emitUpdateNotice, type VersionSource } from "./update-notice.js";

type HelperFunction = (...args: unknown[]) => unknown;
type EgoRuntime = Record<string, unknown>;
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

export async function disposeEgoSdk() {
  try {
    await disconnectPlaywrightTaskSpace();
  } finally {
    releaseTaskSpaceLease();
  }
}

export function enablePlaywrightTaskSpaces() {
  return setPlaywrightTaskSpaceConnector(
    createNativePlaywrightTaskSpaceConnector(),
  );
}

const SYNC_HELPER_PATHS = new Set(["egoBrowser.helper"]);
// Marks an ego runtime whose mutating methods have already been wrapped, so a
// second installEgoSdk call cannot double-wrap createTab / task-space methods.
const EGO_WRAPPED = Symbol.for("egoBrowser.sdkWrapped");
const SDK_GLOBAL_VALUES = Symbol.for("egoBrowser.sdkGlobalValues");

export function installEgoSdk(
  target: InstallTarget = globalThis,
  options: InstallEgoSdkOptions = {},
) {
  if (!target || typeof target !== "object") {
    return target;
  }
  Reflect.deleteProperty(target, "taskSpaces");
  const context = options.context || helpers.helperContext();
  const readySignal = Promise.resolve(options.ready);
  let readyError = null;
  readySignal.catch((error) => {
    readyError = error;
  });
  for (const [name, value] of Object.entries(context)) {
    const exposed = wrapReady(value, readySignal, () => readyError, [name]);
    exposeSdkGlobal(target, name, exposed);
  }
  installLegacySkillGuards(target);
  const usingDefaultLog = !options.cliLog;
  // The agent's primary output channel is console.log. Route it through the host's
  // sink (options.cliLog) when provided, otherwise the buffered default. There is no
  // dedicated cliLog global anymore; console.error/warn are left untouched. Each
  // heredoc runs in its own short-lived process, so overriding the global is per-run.
  console.log =
    options.cliLog || createBufferedLog(target.ego, target.egoBrowser);
  if (usingDefaultLog) {
    // SDK path: the host runs each heredoc in a fresh short-lived process and never
    // calls execute(), so reset the per-run sink and flush it on process teardown.
    resetSink();
    installLifecycleFlush(process.stdout);
  }
  if (target.ego && typeof target.ego === "object") {
    Reflect.deleteProperty(target.ego, "helpers");
    Reflect.deleteProperty(target.ego, "learnings");
    // Fire-and-forget update hint. Route the resolved line to the same channel the
    // command's own output uses: the buffered-sink path registers it as a trailer the
    // sink appends after that output (so it reads as a footer, not a prefix), while a
    // host-provided cliLog gets the line directly. Never touches process.stdout blindly.
    emitUpdateNotice(
      target.ego as { getBrowserVersion?: VersionSource },
      usingDefaultLog ? setNoticeTrailer : (line) => options.cliLog?.(line),
    );
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

function exposeSdkGlobal(target: InstallTarget, name: string, value: unknown) {
  let values = (target as Record<symbol, unknown>)[SDK_GLOBAL_VALUES] as
    Record<string, unknown> | undefined;
  if (!values) {
    values = Object.create(null);
    Object.defineProperty(target, SDK_GLOBAL_VALUES, {
      value: values,
      configurable: false,
      enumerable: false,
      writable: false,
    });
  }

  const installed = Object.hasOwn(values, name);
  const descriptor = Object.getOwnPropertyDescriptor(target, name);
  if (descriptor && !descriptor.configurable) {
    if (!installed) {
      throw new Error(`cannot install ego-browser SDK global: ${name}`);
    }
    values[name] = value;
    return;
  }

  values[name] = value;
  Object.defineProperty(target, name, {
    get: () => values![name],
    set: () => {},
    configurable: false,
    enumerable: false,
  });
}

function wrapReady(
  value: unknown,
  readySignal: Promise<unknown>,
  readyError: () => unknown,
  path: string[],
): unknown {
  if (typeof value === "function") {
    if (SYNC_HELPER_PATHS.has(path.join("."))) return value;
    const wrapped = async (...args: unknown[]) => {
      await readySignal;
      const error = readyError();
      if (error) throw error;
      return value(...args);
    };
    for (const [key, child] of Object.entries(value)) {
      Object.assign(wrapped, {
        [key]: wrapReady(child, readySignal, readyError, [...path, key]),
      });
    }
    return wrapped;
  }
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((child, index) =>
      wrapReady(child, readySignal, readyError, [...path, String(index)]),
    );
  }
  const wrapped: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    wrapped[key] = wrapReady(child, readySignal, readyError, [...path, key]);
  }
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable) continue;
    Object.defineProperty(wrapped, key, descriptor);
  }
  return wrapped;
}
if (isDirectCli()) {
  const restoreConnector = enablePlaywrightTaskSpaces();
  try {
    process.exitCode = await runMain();
  } catch (error) {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  } finally {
    await disposeEgoSdk().catch(() => {});
    restoreConnector();
  }
} else {
  enablePlaywrightTaskSpaces();
  const context = helpers.helperContext();
  installEgoSdk(globalThis, { context });
}

function createBufferedLog(nativeEgo: unknown, egoBrowser: unknown) {
  return (...args: unknown[]) => {
    // Buffer instead of writing through: a hard stop later in the run must be able to
    // discard everything logged so far. The buffer is flushed on process teardown.
    bufferOutput(
      `${args
        .map((value) =>
          formatCliLogValue(value, {
            nativeInspect: value === nativeEgo || value === egoBrowser,
          }),
        )
        .join(" ")}\n`,
    );
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
