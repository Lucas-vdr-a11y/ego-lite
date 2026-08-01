import { jsHandleState } from "./js-handle-state.js";

const TYPED_ARRAY_KINDS = new Map<any, string>([
  [Int8Array, "i8"],
  [Uint8Array, "ui8"],
  [Uint8ClampedArray, "ui8c"],
  [Int16Array, "i16"],
  [Uint16Array, "ui16"],
  [Int32Array, "i32"],
  [Uint32Array, "ui32"],
  [Float32Array, "f32"],
  [Float64Array, "f64"],
  [BigInt64Array, "bi64"],
  [BigUint64Array, "bui64"],
]);

const TYPED_ARRAY_CONSTRUCTORS = {
  i8: Int8Array,
  ui8: Uint8Array,
  ui8c: Uint8ClampedArray,
  i16: Int16Array,
  ui16: Uint16Array,
  i32: Int32Array,
  ui32: Uint32Array,
  f32: Float32Array,
  f64: Float64Array,
  bi64: BigInt64Array,
  bui64: BigUint64Array,
};

export function serializeEvaluationArgument(
  value,
  sessionId?: string,
  executionContextId?: number,
) {
  const handles: any[] = [];
  const visited = new Map<any, number>();
  let lastId = 0;

  const serialize = (item): any => {
    const handle = jsHandleState(item);
    if (handle) {
      if (handle.disposed) throw new Error("JSHandle is disposed!");
      if (
        handle.remoteObject?.objectId &&
        (handle.sessionId !== sessionId ||
          (executionContextId !== undefined &&
            handle.executionContextId !== undefined &&
            handle.executionContextId !== executionContextId))
      ) {
        throw new Error(
          "JSHandles can be evaluated only in the context they were created!",
        );
      }
      if (!handle.remoteObject?.objectId) {
        return serialize(remotePrimitive(handle.remoteObject));
      }
      handles.push({ objectId: handle.remoteObject.objectId });
      return { h: handles.length - 1 };
    }
    if (typeof item === "symbol" || item === undefined) {
      return { v: "undefined" };
    }
    if (item === null) return { v: "null" };
    if (Object.is(item, Number.NaN)) return { v: "NaN" };
    if (Object.is(item, Number.POSITIVE_INFINITY)) return { v: "Infinity" };
    if (Object.is(item, Number.NEGATIVE_INFINITY)) return { v: "-Infinity" };
    if (Object.is(item, -0)) return { v: "-0" };
    if (
      typeof item === "boolean" ||
      typeof item === "number" ||
      typeof item === "string"
    ) {
      return item;
    }
    if (typeof item === "bigint") return { bi: item.toString() };
    if (isError(item)) {
      return {
        e: {
          n: String(item.name),
          m: String(item.message),
          s: String(item.stack || ""),
        },
      };
    }
    if (isDate(item)) return { d: item.toJSON() };
    if (isUrl(item)) return { u: item.toJSON() };
    if (isRegExp(item)) return { r: { p: item.source, f: item.flags } };
    const typedKind = typedArrayKind(item);
    if (typedKind) {
      return {
        ta: {
          b: Buffer.from(
            item.buffer,
            item.byteOffset,
            item.byteLength,
          ).toString("base64"),
          k: typedKind,
        },
      };
    }
    const existingId = visited.get(item);
    if (existingId) return { ref: existingId };
    if (Array.isArray(item)) {
      const id = ++lastId;
      visited.set(item, id);
      return { a: item.map(serialize), id };
    }
    if (typeof item === "object") {
      const id = ++lastId;
      visited.set(item, id);
      const o: any[] = [];
      for (const name of Object.keys(item)) {
        let child;
        try {
          child = item[name];
        } catch {
          continue;
        }
        if (name === "toJSON" && typeof child === "function") {
          o.push({ k: name, v: { o: [], id: 0 } });
        } else {
          o.push({ k: name, v: serialize(child) });
        }
      }
      if (o.length === 0 && typeof item.toJSON === "function") {
        try {
          return serialize(item.toJSON());
        } catch {
          // Match Playwright's best-effort handling of hostile toJSON methods.
        }
      }
      return { o, id };
    }
    return { v: "undefined" };
  };

  return { value: serialize(value), handles };
}

export function deserializeEvaluationResult(value, refs = new Map()) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object") return value;
  if ("ref" in value) return refs.get(value.ref);
  if ("v" in value) return specialValue(value.v);
  if ("d" in value) return new Date(value.d);
  if ("u" in value) return new URL(value.u);
  if ("bi" in value) return BigInt(value.bi);
  if ("e" in value) {
    const error = new Error(value.e.m);
    error.name = value.e.n;
    error.stack = value.e.s;
    return error;
  }
  if ("r" in value) return new RegExp(value.r.p, value.r.f);
  if ("ta" in value) {
    const constructor = TYPED_ARRAY_CONSTRUCTORS[value.ta.k];
    if (!constructor)
      throw new Error(`Unknown typed array kind: ${value.ta.k}`);
    const bytes = Buffer.from(value.ta.b, "base64");
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    );
    return new constructor(buffer);
  }
  if ("a" in value) {
    const result: any[] = [];
    refs.set(value.id, result);
    for (const child of value.a) {
      result.push(deserializeEvaluationResult(child, refs));
    }
    return result;
  }
  if ("o" in value) {
    const result = {};
    refs.set(value.id, result);
    for (const { k, v } of value.o) {
      result[k] = deserializeEvaluationResult(v, refs);
    }
    return result;
  }
  return value;
}

export function browserEvaluationSerializerSource() {
  return `(${browserEvaluationSerializer.toString()})()`;
}

function browserEvaluationSerializer() {
  const typedArrays = {
    i8: Int8Array,
    ui8: Uint8Array,
    ui8c: Uint8ClampedArray,
    i16: Int16Array,
    ui16: Uint16Array,
    i32: Int32Array,
    ui32: Uint32Array,
    f32: Float32Array,
    f64: Float64Array,
    bi64: BigInt64Array,
    bui64: BigUint64Array,
  };
  const parse = (value, handles = [], refs = new Map()) => {
    if (value === undefined) return undefined;
    if (!value || typeof value !== "object") return value;
    if ("ref" in value) return refs.get(value.ref);
    if ("v" in value) {
      if (value.v === "undefined") return undefined;
      if (value.v === "null") return null;
      if (value.v === "NaN") return NaN;
      if (value.v === "Infinity") return Infinity;
      if (value.v === "-Infinity") return -Infinity;
      if (value.v === "-0") return -0;
    }
    if ("d" in value) return new Date(value.d);
    if ("u" in value) return new URL(value.u);
    if ("bi" in value) return BigInt(value.bi);
    if ("e" in value) {
      const error = new Error(value.e.m);
      error.name = value.e.n;
      error.stack = value.e.s;
      return error;
    }
    if ("r" in value) return new RegExp(value.r.p, value.r.f);
    if ("h" in value) return handles[value.h];
    if ("ta" in value) {
      const binary = atob(value.ta.b);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return new typedArrays[value.ta.k](bytes.buffer);
    }
    if ("a" in value) {
      const result = [];
      refs.set(value.id, result);
      for (const child of value.a) result.push(parse(child, handles, refs));
      return result;
    }
    if ("o" in value) {
      const result = {};
      refs.set(value.id, result);
      for (const { k, v } of value.o) result[k] = parse(v, handles, refs);
      return result;
    }
    return value;
  };
  const serialize = (value) => {
    const visited = new Map();
    let lastId = 0;
    const visit = (item) => {
      if (item && typeof item === "object") {
        if (typeof globalThis.Window === "function" && item instanceof Window)
          return "ref: <Window>";
        if (
          typeof globalThis.Document === "function" &&
          item instanceof Document
        )
          return "ref: <Document>";
        if (typeof globalThis.Node === "function" && item instanceof Node)
          return "ref: <Node>";
      }
      if (typeof item === "symbol" || item === undefined)
        return { v: "undefined" };
      if (item === null) return { v: "null" };
      if (Object.is(item, NaN)) return { v: "NaN" };
      if (Object.is(item, Infinity)) return { v: "Infinity" };
      if (Object.is(item, -Infinity)) return { v: "-Infinity" };
      if (Object.is(item, -0)) return { v: "-0" };
      if (
        typeof item === "boolean" ||
        typeof item === "number" ||
        typeof item === "string"
      )
        return item;
      if (typeof item === "bigint") return { bi: item.toString() };
      if (item instanceof Error) {
        return {
          e: {
            n: item.name,
            m: item.message,
            s: item.stack || "",
          },
        };
      }
      if (item instanceof Date) return { d: item.toJSON() };
      if (typeof URL === "function" && item instanceof URL)
        return { u: item.toJSON() };
      if (item instanceof RegExp)
        return { r: { p: item.source, f: item.flags } };
      for (const [kind, constructor] of Object.entries(typedArrays)) {
        if (item instanceof constructor) {
          const bytes = new Uint8Array(
            item.buffer,
            item.byteOffset,
            item.byteLength,
          );
          let binary = "";
          for (const byte of bytes) binary += String.fromCharCode(byte);
          return { ta: { b: btoa(binary), k: kind } };
        }
      }
      const existingId = visited.get(item);
      if (existingId) return { ref: existingId };
      if (Array.isArray(item)) {
        const id = ++lastId;
        visited.set(item, id);
        return { a: item.map(visit), id };
      }
      if (typeof item === "object") {
        const id = ++lastId;
        visited.set(item, id);
        const o = [];
        for (const name of Object.keys(item)) {
          let child;
          try {
            child = item[name];
          } catch {
            continue;
          }
          if (name === "toJSON" && typeof child === "function") {
            o.push({ k: name, v: { o: [], id: 0 } });
          } else {
            o.push({ k: name, v: visit(child) });
          }
        }
        try {
          if (
            o.length === 0 &&
            item.toJSON &&
            typeof item.toJSON === "function"
          ) {
            return visit(item.toJSON());
          }
        } catch {
          // Match Playwright's best-effort handling of hostile toJSON methods.
        }
        return { o, id };
      }
      return { v: "undefined" };
    };
    return visit(value);
  };
  return { parse, serialize };
}

function remotePrimitive(remoteObject) {
  if (Object.hasOwn(remoteObject || {}, "value")) return remoteObject.value;
  if (Object.hasOwn(remoteObject || {}, "unserializableValue")) {
    return decodeSpecialNumber(remoteObject.unserializableValue);
  }
  return undefined;
}

function specialValue(value) {
  if (value === "undefined") return undefined;
  if (value === "null") return null;
  return decodeSpecialNumber(value);
}

function decodeSpecialNumber(value) {
  if (value === "NaN") return Number.NaN;
  if (value === "Infinity") return Number.POSITIVE_INFINITY;
  if (value === "-Infinity") return Number.NEGATIVE_INFINITY;
  if (value === "-0") return -0;
  if (typeof value === "string" && value.endsWith("n")) {
    return BigInt(value.slice(0, -1));
  }
  return value;
}

function isDate(value) {
  return (
    value instanceof Date ||
    Object.prototype.toString.call(value) === "[object Date]"
  );
}

function isUrl(value) {
  return (
    value instanceof URL ||
    Object.prototype.toString.call(value) === "[object URL]"
  );
}

function isRegExp(value) {
  return (
    value instanceof RegExp ||
    Object.prototype.toString.call(value) === "[object RegExp]"
  );
}

function isError(value) {
  const prototype = value ? Object.getPrototypeOf(value) : null;
  return value instanceof Error || prototype?.name === "Error";
}

function typedArrayKind(value) {
  for (const [constructor, kind] of TYPED_ARRAY_KINDS) {
    if (
      value instanceof constructor ||
      Object.prototype.toString.call(value) === `[object ${constructor.name}]`
    ) {
      return kind;
    }
  }
  return undefined;
}
