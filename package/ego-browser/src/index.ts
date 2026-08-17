#!/usr/bin/env node
import { pathToFileURL } from "node:url";

import * as helpers from "./helpers.js";
import {
  clearPreferredTarget,
  invalidateSession,
  onUserControlHardStop,
  releaseRuntimeCallbacks,
  setPreferredTarget,
} from "./browser-runtime.js";
import { formatCliLogValue } from "./format.js";
import { installLegacySkillGuards } from "./legacy-skill-guard.js";
import {
  createNativePlaywrightTaskSpaceConnector,
  disconnectPlaywrightTaskSpace,
  setPlaywrightTaskSpaceConnector,
} from "./playwright/taskspace.js";
import { runMain } from "./run.js";
import {
  onTaskSpaceLeaseLost,
  releaseTaskSpaceLease,
} from "./taskspace-lease.js";
import { startTrace, traceOutput } from "./trace-file.js";
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
  // When omitted, output is written directly to stdout.
  cliLog?: HelperFunction;
};

export * from "./helpers.js";
export { runMain } from "./run.js";

export async function disposeEgoSdk() {
  try {
    await disconnectPlaywrightTaskSpace();
  } finally {
    try {
      releaseTaskSpaceLease();
    } finally {
      releaseRuntimeCallbacks(globalThis.ego);
    }
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
  if (usingDefaultLog) startTrace();
  // The agent's primary output channel is console.log. Route it through the host's
  // sink (options.cliLog) when provided, otherwise write straight to stdout. There is
  // no dedicated cliLog global anymore; console.error/warn are left untouched. Each
  // heredoc gets its own script scope, so overriding the global is per-run.
  console.log =
    options.cliLog || createDirectLog(target.ego, target.egoBrowser);
  if (target.ego && typeof target.ego === "object") {
    Reflect.deleteProperty(target.ego, "helpers");
    Reflect.deleteProperty(target.ego, "learnings");
    // Fire-and-forget update hint. Route the resolved line to the same channel the
    // command's own output uses: the default path writes it straight to stdout when it
    // resolves, while a host-provided cliLog gets the line directly. Because output is
    // written through, the hint lands wherever the run happens to be — it is an
    // out-of-band notice, not a footer. Never touches process.stdout blindly.
    emitUpdateNotice(
      target.ego as { getBrowserVersion?: VersionSource },
      usingDefaultLog
        ? (line) => {
            process.stdout.write(line.endsWith("\n") ? line : `${line}\n`);
          }
        : (line) => options.cliLog?.(line),
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
// Losing the TaskSpace lease to a newer session is a hard stop: this session
// must not race the new owner for the same TaskSpace, so disconnect (with a
// cap, in case the transport is wedged) and exit through the normal process
// teardown, which releases every remaining native resource. The notice goes
// through console.log — the only channel bridged back to the agent in SDK
// mode.
onTaskSpaceLeaseLost(({ id }) => {
  console.log(
    `TaskSpace ${id} was taken over by a newer ego-browser session; stopping ` +
      "this session. No action is needed: do not kill any process and do not " +
      "create a replacement TaskSpace.",
  );
  setTimeout(() => process.exit(1), 2000);
  void disconnectPlaywrightTaskSpace()
    .catch(() => {})
    .finally(() => process.exit(1));
});

// Control of the task space moved to the user mid-run: a hard stop, handled
// like a lost lease. The wording resolved from the task space's
// user_action_reason is the run's final output; exiting here is what actually
// interrupts Playwright calls that are only waiting for events.
onUserControlHardStop(({ code, message }) => {
  console.log(`${code}: ${message}`);
  setTimeout(() => process.exit(1), 2000);
  void disconnectPlaywrightTaskSpace()
    .catch(() => {})
    .finally(() => process.exit(1));
});

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

function createDirectLog(nativeEgo: unknown, egoBrowser: unknown) {
  return (...args: unknown[]) => {
    // Write through so output survives abnormal termination. The host shares one OS
    // process across concurrent scripts, so a fatal error in any of them aborts the
    // process without running teardown hooks — anything held back would be lost.
    const chunk = `${args
      .map((value) =>
        formatCliLogValue(value, {
          nativeInspect: value === nativeEgo || value === egoBrowser,
        }),
      )
      .join(" ")}\n`;
    // The host still batches stdout until the run finishes, so mirror the chunk into the
    // trace file first: that copy is on disk even if this run never delivers stdout.
    traceOutput(chunk);
    process.stdout.write(chunk);
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
