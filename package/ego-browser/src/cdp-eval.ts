import { send, state } from "./state.js";
import {
  browserEvaluationSerializerSource,
  deserializeEvaluationResult,
  serializeEvaluationArgument,
} from "./evaluation-serializer.js";
import { currentTargetContext } from "./target-context.js";

class TimeoutError extends Error {}

/**
 * Send a raw Chrome DevTools Protocol command.
 * @param {string} method CDP method name, for example Runtime.evaluate.
 * @param {object} [params] CDP command parameters.
 * @param {string} [sessionId] Optional attached target session id.
 * @param {number} [timeoutMs] Optional command timeout in milliseconds; 0 disables it.
 * @returns {Promise<object>} CDP result object.
 */
export async function cdp(
  method,
  params: any = {},
  sessionId = undefined,
  timeoutMs = undefined,
) {
  const result = state.cdpOverride
    ? await state.cdpOverride(method, params, sessionId, timeoutMs)
    : (
        await send({
          method,
          params,
          session_id: sessionId,
          timeout_ms: timeoutMs,
        })
      ).result || {};
  if (
    (!sessionId || sessionId === state.sessionId) &&
    (method === "Network.enable" || method === "Network.disable")
  ) {
    // Mirror the default session's Network domain state so helpers like
    // waitForNetworkIdle can restore it instead of tearing down a domain
    // the caller still relies on for drainEvents().
    state.networkDomainEnabled = method === "Network.enable";
  }
  return result;
}

/**
 * Evaluate JavaScript in the current page, Playwright-style.
 * @param {string | Function} pageFunction JavaScript expression string or function called with arg.
 *   String expressions with top-level return statements are auto-wrapped in an IIFE for compatibility.
 * @param {unknown} [arg] Optional Playwright-serializable argument, including JSHandles from this context.
 * @returns {Promise<any>} Runtime.evaluate return-by-value result.
 */
export async function evaluate(pageFunction, arg = undefined) {
  let expression = evaluationSource(pageFunction, "page.evaluate");
  const isFunction = typeof pageFunction === "function";
  if (
    !isFunction &&
    hasReturnStatement(expression) &&
    !expression.trim().startsWith("(")
  ) {
    expression = `(function(){${expression}})()`;
  }
  return evaluateWithArguments(expression, isFunction, arg, {
    apiName: "page.evaluate",
  });
}

export async function evaluateWithArguments(
  expression,
  isFunction,
  arg,
  options: {
    apiName?: string;
    sessionId?: string;
    executionContextId?: number;
    receiverObjectId?: string;
    receiverMode?: "page" | "element" | "elementArray" | "elements";
    returnHandle?: boolean;
    objectGroup?: string;
  } = {},
) {
  const sessionId =
    options.sessionId ??
    currentTargetContext()?.sessionId ??
    state.sessionId ??
    undefined;
  const serialized = serializeEvaluationArgument(
    arg,
    sessionId,
    options.executionContextId,
  );
  const receiverMode = options.receiverMode || "page";
  const functionDeclaration = evaluationFunctionDeclaration(receiverMode);
  if (!options.receiverObjectId && serialized.handles.length === 0) {
    const invocation = `(${functionDeclaration}).call(globalThis, ${[
      Boolean(isFunction),
      !options.returnHandle,
      String(expression),
      serialized.value,
    ]
      .map((value) => JSON.stringify(value))
      .join(", ")})`;
    const response = await cdp(
      "Runtime.evaluate",
      {
        expression: invocation,
        returnByValue: !options.returnHandle,
        awaitPromise: true,
        objectGroup: options.objectGroup || "ego-browser-evaluation",
        ...(options.executionContextId === undefined
          ? {}
          : { contextId: options.executionContextId }),
      },
      sessionId,
    );
    if (response.exceptionDetails || response.result?.subtype === "error") {
      runtimeValue(response, expression);
    }
    if (options.returnHandle) return response.result || {};
    return deserializeEvaluationResult(runtimeValue(response, expression));
  }
  let receiverObjectId = options.receiverObjectId;
  let releaseReceiver = false;
  if (!receiverObjectId) {
    const globalResult = await cdp(
      "Runtime.evaluate",
      {
        expression: "globalThis",
        returnByValue: false,
        awaitPromise: false,
        objectGroup: options.objectGroup || "ego-browser-evaluation",
        ...(options.executionContextId === undefined
          ? {}
          : { contextId: options.executionContextId }),
      },
      sessionId,
    );
    if (globalResult.exceptionDetails) {
      runtimeValue(globalResult, "globalThis");
    }
    receiverObjectId = globalResult.result?.objectId;
    if (!receiverObjectId) {
      throw new Error(
        `${options.apiName || "evaluate"} could not resolve globalThis`,
      );
    }
    releaseReceiver = true;
  }
  try {
    const response = await cdp(
      "Runtime.callFunctionOn",
      {
        functionDeclaration,
        objectId: receiverObjectId,
        arguments: [
          { value: Boolean(isFunction) },
          { value: !options.returnHandle },
          { value: String(expression) },
          { value: serialized.value },
          ...serialized.handles,
        ],
        returnByValue: !options.returnHandle,
        awaitPromise: true,
        objectGroup: options.objectGroup || "ego-browser-evaluation",
      },
      sessionId,
    );
    if (response.exceptionDetails || response.result?.subtype === "error") {
      runtimeValue(response, expression);
    }
    if (options.returnHandle) return response.result || {};
    return deserializeEvaluationResult(runtimeValue(response, expression));
  } catch (error) {
    if (
      /same JavaScript world|different JavaScript (?:context|world)|argument.*context/i.test(
        error?.message || "",
      )
    ) {
      throw new Error(
        "JSHandles can be evaluated only in the context they were created!",
      );
    }
    throw error;
  } finally {
    if (releaseReceiver && receiverObjectId) {
      await cdp(
        "Runtime.releaseObject",
        { objectId: receiverObjectId },
        sessionId,
      ).catch(() => {});
    }
  }
}

/**
 * Evaluate in an explicit target. Kept outside page.evaluate so its second
 * argument remains Playwright-compatible.
 */
export async function evaluateInTarget(
  targetId,
  pageFunction,
  arg = undefined,
) {
  if (typeof targetId !== "string" || !targetId) {
    throw new TypeError("evaluateInTarget requires a target id");
  }
  const attached = await cdp("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  const sessionId = attached.sessionId;
  if (!sessionId) {
    throw new Error(`evaluateInTarget could not attach to target ${targetId}`);
  }
  try {
    let expression = evaluationExpression(pageFunction, arg);
    if (hasReturnStatement(expression) && !expression.trim().startsWith("(")) {
      expression = `(function(){${expression}})()`;
    }
    return await runtimeEvaluate(expression, sessionId, true);
  } finally {
    await cdp("Target.detachFromTarget", { sessionId }).catch(() => {});
  }
}

async function runtimeEvaluate(
  expression,
  sessionId = undefined,
  awaitPromise = false,
) {
  try {
    const response = await cdp(
      "Runtime.evaluate",
      {
        expression,
        returnByValue: true,
        awaitPromise,
      },
      sessionId,
    );
    return runtimeValue(response, expression);
  } catch (error) {
    if (
      error instanceof TimeoutError ||
      /timed out/i.test(error?.message || "")
    ) {
      throw new Error(
        `Runtime.evaluate timed out; expression: ${jsSnippet(expression)}`,
      );
    }
    throw error;
  }
}

export function runtimeValue(response, expression) {
  const result = response.result || {};
  const details = response.exceptionDetails;
  if (details || result.subtype === "error") {
    const desc = jsExceptionDescription(result, details);
    const loc =
      details?.lineNumber !== undefined && details?.columnNumber !== undefined
        ? ` at line ${details.lineNumber}, column ${details.columnNumber}`
        : "";
    throw new Error(
      `JavaScript evaluation failed${loc}: ${desc}; expression: ${jsSnippet(expression)}`,
    );
  }
  if (Object.hasOwn(result, "value")) {
    return result.value;
  }
  if (Object.hasOwn(result, "unserializableValue")) {
    return decodeUnserializableJsValue(result.unserializableValue);
  }
  if (result.type === "undefined") {
    return undefined;
  }
  return null;
}

function jsExceptionDescription(result, details) {
  let desc = result.description;
  const exception = details?.exception;
  if (!desc && exception && typeof exception === "object") {
    desc = exception.description;
    if (desc === undefined && Object.hasOwn(exception, "value")) {
      desc = String(exception.value);
    }
    if (desc === undefined) {
      desc = exception.className;
    }
  }
  return desc || details?.text || "JavaScript evaluation failed";
}

export function decodeUnserializableJsValue(value) {
  if (value === "NaN") {
    return Number.NaN;
  }
  if (value === "Infinity") {
    return Number.POSITIVE_INFINITY;
  }
  if (value === "-Infinity") {
    return Number.NEGATIVE_INFINITY;
  }
  if (value === "-0") {
    return -0;
  }
  if (value.endsWith("n")) {
    return BigInt(value.slice(0, -1));
  }
  return value;
}

function jsSnippet(expression, limit = 160) {
  const snippet = expression.trim().replace(/\n/g, "\\n");
  return snippet.length > limit ? `${snippet.slice(0, limit - 3)}...` : snippet;
}

export function hasReturnStatement(expression) {
  let i = 0;
  let stateName = "code";
  let quote = "";
  while (i < expression.length) {
    const ch = expression[i];
    const next = expression[i + 1] || "";
    if (stateName === "code") {
      if (ch === "'" || ch === '"' || ch === "`") {
        stateName = "string";
        quote = ch;
        i += 1;
        continue;
      }
      if (ch === "/" && next === "/") {
        stateName = "line_comment";
        i += 2;
        continue;
      }
      if (ch === "/" && next === "*") {
        stateName = "block_comment";
        i += 2;
        continue;
      }
      if (expression.startsWith("return", i)) {
        const before = i > 0 ? expression[i - 1] : "";
        const after = expression[i + 6] || "";
        if (!/[A-Za-z0-9_]/.test(before) && !/[A-Za-z0-9_]/.test(after)) {
          return true;
        }
      }
      i += 1;
      continue;
    }
    if (stateName === "line_comment") {
      if (ch === "\n") {
        stateName = "code";
      }
      i += 1;
      continue;
    }
    if (stateName === "block_comment") {
      if (ch === "*" && next === "/") {
        stateName = "code";
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (stateName === "string") {
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === quote) {
        stateName = "code";
        quote = "";
      }
      i += 1;
    }
  }
  return false;
}

function serializedArg(arg) {
  return arg === undefined ? "" : JSON.stringify(arg);
}

function evaluationExpression(pageFunction, arg) {
  if (typeof pageFunction === "function") {
    return `(${pageFunction.toString()})(${serializedArg(arg)})`;
  }
  if (typeof pageFunction === "string") {
    return arg === undefined
      ? pageFunction
      : `(${pageFunction})(${serializedArg(arg)})`;
  }
  throw new TypeError(
    `page.evaluate expects a string expression or function pageFunction, got ${pageFunction === null ? "null" : typeof pageFunction}`,
  );
}

function evaluationSource(pageFunction, apiName) {
  if (typeof pageFunction === "function") return pageFunction.toString();
  if (typeof pageFunction === "string") return pageFunction;
  throw new TypeError(
    `${apiName} expects a string expression or function pageFunction, got ${pageFunction === null ? "null" : typeof pageFunction}`,
  );
}

function evaluationFunctionDeclaration(receiverMode) {
  const invoke =
    receiverMode === "page"
      ? "result = result(argument);"
      : receiverMode === "elementArray"
        ? "result = result([this], argument);"
        : "result = result(this, argument);";
  return `function(isFunction, returnByValue, expression, encodedArgument, ...handles) {
    const serializer = ${browserEvaluationSerializerSource()};
    const argument = serializer.parse(encodedArgument, handles);
    let result = (0, eval)(isFunction ? "(" + expression + ")" : expression);
    if (isFunction) ${invoke}
    if (!returnByValue) return result;
    const serialize = value => {
      try { return serializer.serialize(value); }
      catch { return undefined; }
    };
    return result && typeof result.then === "function"
      ? result.then(serialize)
      : serialize(result);
  }`;
}
