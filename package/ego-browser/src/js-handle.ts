import { cdp, evaluateWithArguments, runtimeValue } from "./cdp-eval.js";
import {
  browserEvaluationSerializerSource,
  deserializeEvaluationResult,
} from "./evaluation-serializer.js";
import { registerJSHandle } from "./js-handle-state.js";

/**
 * Build the small JSHandle subset needed by page.waitForFunction.
 *
 * The handle intentionally owns its Runtime object id until dispose() is called,
 * matching Playwright's explicit handle lifetime rather than returning a copied
 * value from waitForFunction.
 */
export function createJSHandle(
  remoteObject,
  sessionId = undefined,
  executionContextId = undefined,
) {
  const handleState = {
    remoteObject: remoteObject || {},
    sessionId,
    executionContextId,
    disposed: false,
  };
  const objectId = remoteObject?.objectId;
  const facade: any = {
    async jsonValue() {
      if (handleState.disposed) {
        throw new Error("JSHandle is disposed!");
      }
      if (!objectId) {
        return runtimeValue(
          { result: remoteObject || {} },
          "JSHandle.jsonValue",
        );
      }
      const response = await cdp(
        "Runtime.callFunctionOn",
        {
          functionDeclaration: `function(){
            const serializer = ${browserEvaluationSerializerSource()};
            return serializer.serialize(this);
          }`,
          objectId,
          returnByValue: true,
          awaitPromise: true,
        },
        sessionId,
      );
      return deserializeEvaluationResult(
        runtimeValue(response, "JSHandle.jsonValue"),
      );
    },
    async dispose() {
      if (handleState.disposed) return;
      handleState.disposed = true;
      if (objectId) {
        await cdp("Runtime.releaseObject", { objectId }, sessionId).catch(
          () => {},
        );
      }
    },
    toString() {
      if (remoteObject?.subtype) {
        return `JSHandle@${remoteObject.subtype}`;
      }
      if (remoteObject?.type === "object") {
        return "JSHandle@object";
      }
      return `JSHandle:${String(remotePrimitiveValue(remoteObject))}`;
    },
  };
  facade.asElement = () => (remoteObject?.subtype === "node" ? facade : null);
  registerJSHandle(facade, handleState);
  return facade;
}

export function createElementHandle(
  remoteObject,
  sessionId = undefined,
  executionContextId = undefined,
) {
  const objectId = remoteObject?.objectId;
  if (!objectId) throw new Error("ElementHandle requires a remote objectId");
  const handle: any = createJSHandle(
    { ...remoteObject, subtype: "node" },
    sessionId,
    executionContextId,
  );
  handle.evaluate = async (pageFunction, arg = undefined) => {
    const functionSource = functionSourceForHandle(
      pageFunction,
      "ElementHandle.evaluate",
    );
    return evaluateWithArguments(functionSource, true, arg, {
      apiName: "ElementHandle.evaluate",
      sessionId,
      executionContextId,
      receiverObjectId: objectId,
      receiverMode: "element",
    });
  };
  handle.getAttribute = (name) =>
    handle.evaluate(
      (element, attribute) => element.getAttribute(attribute),
      name,
    );
  handle.textContent = () => handle.evaluate((element) => element.textContent);
  return handle;
}

export function remotePrimitiveValue(remoteObject) {
  return runtimeValue({ result: remoteObject || {} }, "remote value");
}

function functionSourceForHandle(pageFunction, apiName) {
  if (typeof pageFunction === "function") return pageFunction.toString();
  if (typeof pageFunction === "string") return pageFunction;
  throw new TypeError(`${apiName} expects a function or string`);
}
