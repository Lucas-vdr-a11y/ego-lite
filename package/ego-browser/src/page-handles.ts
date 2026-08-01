import { readFile } from "node:fs/promises";

import { ensureSession } from "./browser-runtime.js";
import { cdp, evaluateWithArguments, runtimeValue } from "./cdp-eval.js";
import { createElementHandle, createJSHandle } from "./js-handle.js";
import { state } from "./state.js";

export function createPageHandleController() {
  const evaluateHandle = async (pageFunction, arg = undefined) => {
    const sessionId = await handleSession();
    const isFunction = typeof pageFunction === "function";
    if (!isFunction && typeof pageFunction !== "string") {
      throw new TypeError("page.evaluateHandle expects a function or string");
    }
    const remoteObject = await evaluateWithArguments(
      String(pageFunction),
      isFunction,
      arg,
      {
        apiName: "page.evaluateHandle",
        sessionId,
        returnHandle: true,
        objectGroup: "ego-browser-page-handles",
      },
    );
    return createJSHandle(remoteObject, sessionId);
  };

  const addScriptTag = async (options: any = {}) => addTag("script", options);
  const addStyleTag = async (options: any = {}) => addTag("style", options);

  return { evaluateHandle, addScriptTag, addStyleTag };
}

async function addTag(kind: "script" | "style", options: any) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError(
      `page.add${capitalize(kind)}Tag options must be an object`,
    );
  }
  const supplied = ["url", "path", "content"].filter(
    (name) => options[name] !== undefined,
  );
  if (supplied.length !== 1) {
    throw new TypeError(
      `page.add${capitalize(kind)}Tag requires exactly one of url, path, or content`,
    );
  }
  const content =
    options.path === undefined
      ? options.content
      : await readFile(String(options.path), "utf8");
  const sessionId = await handleSession();
  const expression = tagExpression(kind, {
    url: options.url,
    content,
    type: options.type,
  });
  const result = await cdp(
    "Runtime.evaluate",
    {
      expression,
      returnByValue: false,
      awaitPromise: true,
      objectGroup: "ego-browser-page-handles",
    },
    sessionId,
  );
  runtimeValueForException(result, expression);
  return createElementHandle(result.result || {}, sessionId);
}

async function handleSession() {
  return state.cdpOverride
    ? state.sessionId || undefined
    : await ensureSession();
}

function tagExpression(kind, options) {
  const isScript = kind === "script";
  return `(async () => {
    const element = document.createElement(${JSON.stringify(kind)});
    ${isScript && options.type ? `element.type = ${JSON.stringify(String(options.type))};` : ""}
    ${options.url ? `element.${isScript ? "src" : "href"} = ${JSON.stringify(String(options.url))};` : ""}
    ${!isScript && options.url ? 'element.rel = "stylesheet";' : ""}
    ${options.content === undefined ? "" : isScript ? `element.text = ${JSON.stringify(String(options.content))};` : `element.textContent = ${JSON.stringify(String(options.content))};`}
    const loaded = ${options.url ? 'new Promise((resolve, reject) => { element.onload = resolve; element.onerror = () => reject(new Error("Failed to load tag")); })' : "Promise.resolve()"};
    (document.head || document.documentElement).appendChild(element);
    await loaded;
    return element;
  })()`;
}

function runtimeValueForException(result, expression) {
  if (result.exceptionDetails || result.result?.subtype === "error") {
    runtimeValue(result, expression);
  }
}

function capitalize(value) {
  return value[0].toUpperCase() + value.slice(1);
}
