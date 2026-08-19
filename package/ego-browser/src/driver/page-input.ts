import { isAbsolute } from "node:path";

import { resolveElementObjectId } from "../element-resolver.js";
import { type RefMap } from "../ref-map.js";
import { keyDefinition, type KeyboardServices } from "./keyboard.js";

type PageInputServices = KeyboardServices;

const MODIFIER_BITS: Record<string, number> = {
  alt: 1,
  control: 2,
  ctrl: 2,
  meta: 4,
  command: 4,
  shift: 8,
};

/** Parse Playwright-style key chords such as Meta+A or ControlOrMeta+P. */
export function parseKeyChord(
  chord: string,
  platform: string = process.platform,
): {
  key: string;
  modifiers: number;
} {
  if (typeof chord !== "string" || chord.trim().length === 0) {
    throw new TypeError("page.keyboard.press requires a non-empty key");
  }
  const parts = chord.split("+");
  const key = parts.pop()?.trim() || "";
  if (!key) {
    throw new TypeError(`page.keyboard.press received invalid chord: ${chord}`);
  }
  let modifiers = 0;
  for (const rawModifier of parts) {
    const modifier = rawModifier.trim().toLowerCase();
    const bit =
      modifier === "controlormeta"
        ? platform === "darwin"
          ? MODIFIER_BITS.meta
          : MODIFIER_BITS.control
        : MODIFIER_BITS[modifier];
    if (!bit) {
      throw new TypeError(
        `page.keyboard.press received unsupported modifier: ${rawModifier}`,
      );
    }
    modifiers |= bit;
  }
  return { key, modifiers };
}

/** Dispatch a synthetic DOM KeyboardEvent to one resolved element. */
export async function dispatchKeyInPage(
  services: PageInputServices,
  sessionId: string,
  refMap: RefMap,
  selector: string,
  key = "Enter",
  event = "keypress",
): Promise<void> {
  if (typeof event !== "string" || event.length === 0) {
    throw new TypeError("page.keyboard.dispatch requires an event name");
  }
  const { vk, code } = keyDefinition(key);
  const resolved = await resolveElementObjectId(
    cdpAdapter(services),
    sessionId,
    refMap,
    selector,
  );
  try {
    await services.cdp(
      "Runtime.callFunctionOn",
      {
        functionDeclaration:
          "function(keyCode,key,code,event){this.focus();this.dispatchEvent(new KeyboardEvent(event,{key,code,keyCode,which:keyCode,bubbles:true}));}",
        objectId: resolved.objectId,
        arguments: [
          { value: vk },
          { value: key },
          { value: code },
          { value: event },
        ],
        returnByValue: true,
        awaitPromise: false,
      },
      resolved.sessionId,
    );
  } finally {
    await releaseObject(services, resolved.sessionId, resolved.objectId);
  }
}

/** Set one or more local files on an input in one explicit Page session. */
export async function setInputFilesInPage(
  services: PageInputServices,
  sessionId: string,
  refMap: RefMap,
  selector: string,
  path: string | string[],
): Promise<void> {
  const files = Array.isArray(path) ? path : [path];
  if (
    files.length === 0 ||
    files.some(
      (file) =>
        typeof file !== "string" || file.length === 0 || !isAbsolute(file),
    )
  ) {
    throw new TypeError("page.setInputFiles requires absolute file paths");
  }
  const resolved = await resolveElementObjectId(
    cdpAdapter(services),
    sessionId,
    refMap,
    selector,
  );
  try {
    await services.cdp(
      "DOM.setFileInputFiles",
      { files, objectId: resolved.objectId },
      resolved.sessionId,
    );
  } finally {
    await releaseObject(services, resolved.sessionId, resolved.objectId);
  }
}

function cdpAdapter(services: PageInputServices) {
  return {
    sendRaw(method, params, sessionId) {
      return services.cdp(method, params, sessionId);
    },
  };
}

async function releaseObject(
  services: PageInputServices,
  sessionId: string,
  objectId: string,
): Promise<void> {
  await services
    .cdp("Runtime.releaseObject", { objectId }, sessionId)
    .catch(() => {});
}
