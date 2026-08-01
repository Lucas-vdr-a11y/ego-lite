import { readFile } from "node:fs/promises";

import { subscribeBrowserEvent } from "./browser-runtime.js";
import { cdp } from "./cdp-eval.js";

let nextBindingId = 1;

export function createPageScriptController(page: any) {
  const addInitScript = async (script, arg = undefined) => {
    const source = await resolveScriptSource(script, arg, "page.addInitScript");
    await cdp("Page.addScriptToEvaluateOnNewDocument", { source });
  };

  const installBinding = async (
    exposedName: string,
    callback: (...args: any[]) => any,
    includeSource: boolean,
  ) => {
    if (!exposedName || typeof exposedName !== "string") {
      throw new TypeError(
        "page.exposeFunction name must be a non-empty string",
      );
    }
    if (typeof callback !== "function") {
      throw new TypeError("page binding callback must be a function");
    }
    const bindingName = `__ego_pw_binding_${nextBindingId++}`;
    const resolverName = `${bindingName}_resolve`;
    await cdp("Runtime.enable");
    await cdp("Runtime.addBinding", { name: bindingName });
    const source = bindingBootstrap(exposedName, bindingName, resolverName);
    await cdp("Page.addScriptToEvaluateOnNewDocument", { source });
    await cdp("Runtime.evaluate", {
      expression: source,
      returnByValue: true,
      awaitPromise: false,
    });
    subscribeBrowserEvent("Runtime.bindingCalled", undefined, (event) => {
      if (event.params?.name !== bindingName) return;
      let payload;
      try {
        payload = JSON.parse(event.params.payload || "{}");
      } catch {
        return;
      }
      void Promise.resolve()
        .then(() =>
          includeSource
            ? callback(
                { page, frame: null, context: null },
                ...(payload.args || []),
              )
            : callback(...(payload.args || [])),
        )
        .then(
          (value) =>
            settleBinding(
              event.sessionId,
              resolverName,
              payload.id,
              true,
              value,
            ),
          (error) =>
            settleBinding(
              event.sessionId,
              resolverName,
              payload.id,
              false,
              error instanceof Error ? error.message : String(error),
            ),
        );
    });
  };

  return {
    addInitScript,
    exposeFunction: (name, callback) => installBinding(name, callback, false),
    exposeBinding: (name, callback, options: any = {}) => {
      if (options?.handle) {
        throw new Error(
          "page.exposeBinding({ handle: true }) is not supported; pass serializable arguments",
        );
      }
      return installBinding(name, callback, true);
    },
    installRawBinding: async (callback: (payload: any, event: any) => any) => {
      const bindingName = `__ego_pw_raw_${nextBindingId++}`;
      await cdp("Runtime.enable");
      await cdp("Runtime.addBinding", { name: bindingName });
      subscribeBrowserEvent("Runtime.bindingCalled", undefined, (event) => {
        if (event.params?.name !== bindingName) return;
        let payload;
        try {
          payload = JSON.parse(event.params.payload || "{}");
        } catch {
          return;
        }
        void Promise.resolve(callback(payload, event));
      });
      return bindingName;
    },
  };
}

async function resolveScriptSource(script, arg, apiName: string) {
  if (typeof script === "function") {
    return `(${script.toString()})(${serialize(arg)})`;
  }
  if (typeof script === "string") {
    return script;
  }
  if (!script || typeof script !== "object" || Array.isArray(script)) {
    throw new TypeError(
      `${apiName} expects a function, string, or script object`,
    );
  }
  const hasPath = typeof script.path === "string";
  const hasContent = typeof script.content === "string";
  if (hasPath === hasContent) {
    throw new TypeError(
      `${apiName} script object requires exactly one of path or content`,
    );
  }
  return hasPath ? readFile(script.path, "utf8") : script.content;
}

function bindingBootstrap(exposedName, bindingName, resolverName) {
  return `(() => {
    const binding = globalThis[${JSON.stringify(bindingName)}];
    if (typeof binding !== "function") return;
    const pending = new Map();
    let nextId = 1;
    globalThis[${JSON.stringify(resolverName)}] = (id, ok, value) => {
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      (ok ? entry.resolve : entry.reject)(ok ? value : new Error(String(value)));
    };
    globalThis[${JSON.stringify(exposedName)}] = (...args) => new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      binding(JSON.stringify({ id, args }));
    });
  })()`;
}

async function settleBinding(sessionId, resolverName, id, ok, value) {
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    serialized = JSON.stringify("Binding result is not serializable");
    ok = false;
  }
  if (serialized === undefined) serialized = "undefined";
  await cdp(
    "Runtime.evaluate",
    {
      expression: `globalThis[${JSON.stringify(resolverName)}]?.(${JSON.stringify(id)}, ${ok}, ${serialized})`,
      returnByValue: true,
      awaitPromise: false,
    },
    sessionId,
  ).catch(() => {});
}

function serialize(value) {
  return value === undefined ? "undefined" : JSON.stringify(value);
}
