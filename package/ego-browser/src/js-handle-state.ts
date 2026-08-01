export type JSHandleState = {
  remoteObject: any;
  sessionId?: string;
  executionContextId?: number;
  disposed: boolean;
};

const states = new WeakMap<object, JSHandleState>();

export function registerJSHandle(handle: object, state: JSHandleState) {
  states.set(handle, state);
}

export function jsHandleState(value: unknown) {
  return value && (typeof value === "object" || typeof value === "function")
    ? states.get(value as object)
    : undefined;
}
