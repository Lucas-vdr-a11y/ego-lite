import { send, state } from "./state.js";

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
 * @param {unknown} [arg] Optional serializable argument passed to pageFunctions.
 * @returns {Promise<any>} Runtime.evaluate return-by-value result.
 */
export async function evaluate(pageFunction, arg = undefined) {
  const expression = evaluationExpression(pageFunction, arg);
  if (hasReturnStatement(expression) && !expression.trim().startsWith("(")) {
    return runtimeEvaluate(`(function(){${expression}})()`, undefined, true);
  }
  return runtimeEvaluate(expression, undefined, true);
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
