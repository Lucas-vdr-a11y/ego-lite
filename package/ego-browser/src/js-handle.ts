import { cdp, runtimeValue } from "./cdp-eval.js";

/**
 * Build the small JSHandle subset needed by page.waitForFunction.
 *
 * The handle intentionally owns its Runtime object id until dispose() is called,
 * matching Playwright's explicit handle lifetime rather than returning a copied
 * value from waitForFunction.
 */
export function createJSHandle(remoteObject, sessionId = undefined) {
  let disposed = false;
  const objectId = remoteObject?.objectId;
  return {
    async jsonValue() {
      if (disposed) {
        throw new Error("JSHandle is disposed");
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
          functionDeclaration: "function(){ return this; }",
          objectId,
          returnByValue: true,
          awaitPromise: true,
        },
        sessionId,
      );
      return runtimeValue(response, "JSHandle.jsonValue");
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
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
}

export function remotePrimitiveValue(remoteObject) {
  return runtimeValue({ result: remoteObject || {} }, "remote value");
}
