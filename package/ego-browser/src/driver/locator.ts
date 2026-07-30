import { cdp, runtimeValue } from "../cdp-eval.js";
import {
  ElementResolutionError,
  queryRoleLocatorBackendNodeIds,
} from "../element-resolver.js";
import { isLocatorTarget, resolveFrameContext } from "../frame-context.js";
import { queryAllExpression as buildQueryAllExpression } from "../locator-query.js";
import { parseRef } from "../ref-map.js";
import {
  normalizeTimeout,
  operationTimeout,
  timeoutDeadline,
} from "../playwright-errors.js";
import { state } from "../state.js";
import { releaseHandle, resolveAndCall, resolveHandle } from "./element-ops.js";

/**
 * Return element.textContent for a single element.
 * @param {string} selector CSS selector / @ref / loc= / xpath= for the element.
 * @returns {Promise<string|null>}
 */
export async function textContent(selector) {
  return readElement(selector, "function(){return this.textContent;}");
}

/**
 * Return element.innerText for a single HTMLElement.
 * @param {string} selector CSS selector / @ref / loc= / xpath= for the element.
 * @returns {Promise<string>}
 */
export async function innerText(selector) {
  return readElement(
    selector,
    `function(){
      if (!(this instanceof HTMLElement)) throw new Error("innerText target must be an HTMLElement");
      return this.innerText;
    }`,
  );
}

/**
 * Return element.innerHTML for a single element.
 * @param {string} selector CSS selector / @ref / loc= / xpath= for the element.
 * @returns {Promise<string>}
 */
export async function innerHTML(selector) {
  return readElement(
    selector,
    `function(){
      if (!(this instanceof Element)) throw new Error("innerHTML target must be an Element");
      return this.innerHTML;
    }`,
  );
}

/**
 * Return value for an input, textarea, or select.
 * @param {string} selector CSS selector / @ref / loc= / xpath= for the form control.
 * @returns {Promise<string>}
 */
export async function inputValue(selector) {
  return readElement(
    selector,
    `function(){
      const target = this instanceof HTMLLabelElement && this.control ? this.control : this;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return target.value;
      }
      throw new Error("inputValue target must be an input, textarea, or select");
    }`,
  );
}

/**
 * Return checked state for a checkbox or radio.
 * @param {string} selector CSS selector / @ref / loc= / xpath= for the input.
 * @param {{timeout?: number}} [options] timeout in milliseconds.
 * @returns {Promise<boolean>}
 */
export async function isChecked(selector, options: { timeout?: number } = {}) {
  return (await checkedInputState(selector, options)).checked;
}

/**
 * Read checkbox/radio state and input type in one auto-waiting lookup.
 * Kept separate from the public boolean helper so setChecked can reject an
 * impossible radio uncheck before dispatching a click.
 */
export async function checkedInputState(
  selector,
  options: { timeout?: number } = {},
) {
  const timeout = normalizeTimeout(
    "locator.isChecked",
    options.timeout ?? state.defaultTimeout,
  );
  return readElement(
    selector,
    `function(){
      const target = this instanceof HTMLLabelElement && this.control ? this.control : this;
      if (!(target instanceof HTMLInputElement) || (target.type !== "checkbox" && target.type !== "radio")) {
        throw new Error("isChecked target must be a checkbox or radio input");
      }
      return { checked: target.checked, type: target.type };
    }`,
    [],
    timeout,
    "locator.isChecked",
  );
}

/**
 * Return whether the element is visible. Missing elements return false.
 * @param {string} selector CSS selector / @ref / loc= / xpath= for the element.
 * @returns {Promise<boolean>}
 */
export async function isVisible(selector) {
  return readOptionalElement(
    selector,
    `function(){
      if (!(this instanceof Element)) return false;
      if (typeof this.checkVisibility === "function") {
        const rect = this.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0
          && this.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true });
      }
      const style = getComputedStyle(this);
      if (style.display === "none" || style.visibility === "hidden") return false;
      const rect = this.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }`,
    [],
    false,
    (visible, handle) => Boolean(visible) && handle.frameVisible !== false,
  );
}

/**
 * Return whether the element is hidden. Missing elements return true.
 * @param {string} selector CSS selector / @ref / loc= / xpath= for the element.
 * @returns {Promise<boolean>}
 */
export async function isHidden(selector) {
  return !(await isVisible(selector));
}

/**
 * Return whether the element is enabled. Missing elements return false.
 * @param {string} selector CSS selector / @ref / loc= / xpath= for the element.
 * @returns {Promise<boolean>}
 */
export async function isEnabled(selector) {
  return readOptionalElement(
    selector,
    `function(){
      const target = this instanceof HTMLLabelElement && this.control ? this.control : this;
      if (!(target instanceof Element)) return false;
      if (target.getAttribute("aria-disabled") === "true") return false;
      if ("disabled" in target && target.disabled) return false;
      const disabledFieldset = target.closest("fieldset[disabled]");
      return !disabledFieldset;
    }`,
    [],
    false,
  );
}

/**
 * Return whether the element is disabled. Missing elements return true.
 * @param {string} selector CSS selector / @ref / loc= / xpath= for the element.
 * @returns {Promise<boolean>}
 */
export async function isDisabled(selector) {
  return !(await isEnabled(selector));
}

/**
 * Return whether the element is editable. Missing elements return false.
 * @param {string} selector CSS selector / @ref / loc= / xpath= for the element.
 * @returns {Promise<boolean>}
 */
export async function isEditable(selector) {
  return readOptionalElement(
    selector,
    `function(){
      const target = this instanceof HTMLLabelElement && this.control ? this.control : this;
      if (!(target instanceof Element)) return false;
      if (target.isContentEditable) return true;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        return !target.disabled && !target.readOnly;
      }
      return false;
    }`,
    [],
    false,
  );
}

/**
 * Return a DOM attribute value for a single element.
 * @param {string} selector CSS selector / @ref / loc= / xpath= for the element.
 * @param {string} name Attribute name.
 * @returns {Promise<string|null>}
 */
export async function getAttribute(selector, name) {
  return readElement(
    selector,
    "function(name){return this.getAttribute(String(name));}",
    [name],
  );
}

/**
 * Remove focus from an element.
 * @param {string} selector CSS selector / @ref / loc= / xpath= for the element.
 * @returns {Promise<void>}
 */
export async function blur(selector) {
  await readElement(selector, "function(){this.blur();}");
}

/**
 * Return the element bounding box in viewport CSS pixels.
 * @param {string} selector CSS selector / @ref / loc= / xpath= for the element.
 * @returns {Promise<{x:number,y:number,width:number,height:number}|null>}
 */
export async function boundingBox(selector) {
  const functionDeclaration = `function(){
      if (!(this instanceof Element)) return null;
      const rect = this.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }`;
  return readElement(
    selector,
    functionDeclaration,
    [],
    state.defaultTimeout,
    null,
    (box, handle) => {
      if (!box || handle.frameVisible === false) return null;
      const offset = handle.frameOffset || { x: 0, y: 0 };
      const scale = handle.frameScale || { x: 1, y: 1 };
      return {
        ...box,
        x: offset.x + box.x * scale.x,
        y: offset.y + box.y * scale.y,
        width: box.width * scale.x,
        height: box.height * scale.y,
      };
    },
  );
}

/**
 * Count matching elements. Supports CSS, xpath=, loc=css:, loc=href:, and refs.
 * @param {string} selector Selector to query.
 * @returns {Promise<number>}
 */
export async function count(selector) {
  if (!isLocatorTarget(selector) && parseRef(selector)) {
    const handle = await resolveHandle(selector);
    await releaseHandle(handle.objectId, handle.sessionId);
    return 1;
  }
  const backendNodeIds = isLocatorTarget(selector)
    ? null
    : await queryRoleBackendNodeIds(selector);
  if (backendNodeIds !== null) {
    return backendNodeIds.length;
  }
  return readQueryAll(selector, "return elements.length;");
}

/**
 * Return innerText for all matching HTMLElement nodes.
 * @param {string} selector Selector to query.
 * @returns {Promise<string[]>}
 */
export async function allInnerTexts(selector) {
  return readQueryAll(
    selector,
    `return elements.map((element) => {
      if (!(element instanceof HTMLElement)) throw new Error("allInnerTexts targets must be HTMLElements");
      return element.innerText;
    });`,
  );
}

/**
 * Return textContent for all matching nodes.
 * @param {string} selector Selector to query.
 * @returns {Promise<Array<string|null>>}
 */
export async function allTextContents(selector) {
  return readQueryAll(
    selector,
    "return elements.map((element) => element.textContent);",
  );
}

/**
 * Execute JavaScript against one matching element, Playwright-style.
 * @param {string} selector CSS selector / @ref / loc= / xpath= for the element.
 * @param {Function|string} pageFunction Function source called with (element, arg).
 * @param {unknown} [arg] Optional serializable argument.
 * @returns {Promise<unknown>} Serializable return value from pageFunction.
 */
export async function evaluateLocator(selector, pageFunction, arg = undefined) {
  const functionSource = pageFunctionSource(pageFunction, "locator.evaluate");
  return readElement(
    selector,
    `function(functionSource, arg){
      const pageFunction = (0, eval)("(" + functionSource + ")");
      return pageFunction(this, arg);
    }`,
    [functionSource, arg],
  );
}

/**
 * Execute JavaScript against all matching elements, Playwright-style.
 * @param {string} selector Selector to query.
 * @param {Function|string} pageFunction Function source called with (elements, arg).
 * @param {unknown} [arg] Optional serializable argument.
 * @returns {Promise<unknown>} Serializable return value from pageFunction.
 */
export async function evaluateAll(selector, pageFunction, arg = undefined) {
  const functionSource = pageFunctionSource(pageFunction, "evaluateAll");
  if (!isLocatorTarget(selector) && parseRef(selector)) {
    return readElement(
      selector,
      `function(functionSource, arg){
        const pageFunction = (0, eval)("(" + functionSource + ")");
        return pageFunction([this], arg);
      }`,
      [functionSource, arg],
    );
  }
  const backendNodeIds = isLocatorTarget(selector)
    ? null
    : await queryRoleBackendNodeIds(selector);
  if (backendNodeIds !== null) {
    return evaluateRoleBackendNodes(backendNodeIds, functionSource, arg, true);
  }
  return evaluateQueryAll(selector, functionSource, arg);
}

async function readElement(
  selector,
  functionDeclaration,
  args = [],
  timeout = state.defaultTimeout,
  apiName: string | null = null,
  mapResult = (value, _handle) => value,
) {
  const deadline = timeoutDeadline(timeout, state.now());
  while (true) {
    try {
      return await readElementOnce(
        selector,
        functionDeclaration,
        args,
        mapResult,
      );
    } catch (error) {
      if (
        !(error instanceof ElementResolutionError) ||
        error.kind !== "transient" ||
        state.now() >= deadline
      ) {
        if (
          apiName &&
          error instanceof ElementResolutionError &&
          error.kind === "transient" &&
          state.now() >= deadline
        ) {
          throw operationTimeout(apiName, timeout, error.message);
        }
        throw error;
      }
      await state.sleep(Math.min(100, deadline - state.now()));
    }
  }
}

async function readElementOnce(
  selector,
  functionDeclaration,
  args = [],
  mapResult = (value, _handle) => value,
) {
  const handle = await resolveAndCall(selector, functionDeclaration, args);
  return mapResult(runtimeValue(handle.result, functionDeclaration), handle);
}

async function readOptionalElement(
  selector,
  functionDeclaration,
  args = [],
  fallback,
  mapResult = (value, _handle) => value,
) {
  try {
    return await readElementOnce(
      selector,
      functionDeclaration,
      args,
      mapResult,
    );
  } catch (error) {
    if (error instanceof ElementResolutionError && error.kind === "transient") {
      return fallback;
    }
    throw error;
  }
}

async function readQueryAll(selector, body) {
  const backendNodeIds = isLocatorTarget(selector)
    ? null
    : await queryRoleBackendNodeIds(selector);
  if (backendNodeIds !== null) {
    return evaluateRoleBackendNodes(
      backendNodeIds,
      `function(elements){${body}}`,
      undefined,
      false,
    );
  }
  const selectorValue = isLocatorTarget(selector)
    ? selector.selector
    : selector;
  const expression = `(() => {
    const elements = ${buildQueryAllExpression(selectorValue)};
    ${body}
  })()`;
  const result = await evaluateInLocatorContext(selector, expression, false);
  return runtimeValue(result, expression);
}

async function evaluateRoleBackendNodes(
  backendNodeIds,
  functionSource,
  arg,
  awaitPromise,
) {
  if (backendNodeIds.length === 0) {
    const expression = `(() => {
      const pageFunction = (0, eval)(${JSON.stringify(`(${functionSource})`)});
      return pageFunction([], ${serializedArg(arg)});
    })()`;
    const result = await cdp("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise,
    });
    return runtimeValue(result, expression);
  }

  const handles = [];
  try {
    for (const backendNodeId of backendNodeIds) {
      const result = await cdp("DOM.resolveNode", {
        backendNodeId,
        objectGroup: "ego-browser-role-collection",
      });
      const objectId = result.object?.objectId;
      if (!objectId) {
        throw new ElementResolutionError(
          `No objectId for AX backend node ${backendNodeId}`,
          "permanent",
        );
      }
      handles.push({ objectId });
    }

    const [first, ...rest] = handles;
    const functionDeclaration = `function(...args) {
      const functionSource = args.at(-2);
      const arg = args.at(-1);
      const elements = [this, ...args.slice(0, -2)];
      const pageFunction = (0, eval)("(" + functionSource + ")");
      return pageFunction(elements, arg);
    }`;
    const result = await cdp("Runtime.callFunctionOn", {
      functionDeclaration,
      objectId: first.objectId,
      arguments: [
        ...rest.map(({ objectId }) => ({ objectId })),
        { value: functionSource },
        { value: arg },
      ],
      returnByValue: true,
      awaitPromise,
    });
    return runtimeValue(result, functionDeclaration);
  } finally {
    for (const { objectId } of handles) {
      await releaseHandle(objectId, undefined);
    }
  }
}

function queryRoleBackendNodeIds(selector) {
  return queryRoleLocatorBackendNodeIds({ sendRaw: cdp }, undefined, selector);
}

async function evaluateQueryAll(selector, functionSource, arg) {
  const selectorValue = isLocatorTarget(selector)
    ? selector.selector
    : selector;
  const expression = `(() => {
    const elements = ${buildQueryAllExpression(selectorValue)};
    const pageFunction = (0, eval)(${JSON.stringify(`(${functionSource})`)});
    return pageFunction(elements, ${serializedArg(arg)});
  })()`;
  const result = await evaluateInLocatorContext(selector, expression, true);
  return runtimeValue(result, expression);
}

async function evaluateInLocatorContext(
  selector,
  expression,
  awaitPromise: boolean,
) {
  if (!isLocatorTarget(selector) || selector.frameChain.length === 0) {
    return cdp("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise,
    });
  }
  const context = await resolveFrameContext(selector.frameChain);
  return cdp(
    "Runtime.evaluate",
    {
      expression,
      contextId: context.executionContextId,
      returnByValue: true,
      awaitPromise,
    },
    context.sessionId,
  );
}

function pageFunctionSource(pageFunction, helperName) {
  if (typeof pageFunction === "function") {
    return pageFunction.toString();
  }
  if (typeof pageFunction === "string") {
    return pageFunction;
  }
  throw new TypeError(
    `${helperName} expects a function or string pageFunction, got ${pageFunction === null ? "null" : typeof pageFunction}`,
  );
}

function serializedArg(arg) {
  return arg === undefined ? "undefined" : JSON.stringify(arg);
}
