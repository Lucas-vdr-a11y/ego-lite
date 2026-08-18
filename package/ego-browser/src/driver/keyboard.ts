import { cdp } from "../cdp-eval.js";
import { browserCdp } from "../browser-runtime.js";
import { withHandle, resolveAndCall } from "./element-ops.js";
import { waitForElement } from "./waits.js";

type FillInputOptions = {
  clearFirst?: boolean;
  timeout?: number;
};

export type KeyboardServices = {
  cdp(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
    timeoutMs?: number,
  ): Promise<any>;
  sleep(ms: number): Promise<void>;
};

const KEYS = {
  Enter: { vk: 13, key: "Enter", code: "Enter", text: "\r" },
  Tab: { vk: 9, key: "Tab", code: "Tab", text: "\t" },
  Backspace: { vk: 8, key: "Backspace", code: "Backspace", text: "" },
  Escape: { vk: 27, key: "Escape", code: "Escape", text: "" },
  Delete: { vk: 46, key: "Delete", code: "Delete", text: "" },
  " ": { vk: 32, key: " ", code: "Space", text: " " },
  ArrowLeft: { vk: 37, key: "ArrowLeft", code: "ArrowLeft", text: "" },
  ArrowUp: { vk: 38, key: "ArrowUp", code: "ArrowUp", text: "" },
  ArrowRight: { vk: 39, key: "ArrowRight", code: "ArrowRight", text: "" },
  ArrowDown: { vk: 40, key: "ArrowDown", code: "ArrowDown", text: "" },
  Home: { vk: 36, key: "Home", code: "Home", text: "" },
  End: { vk: 35, key: "End", code: "End", text: "" },
  PageUp: { vk: 33, key: "PageUp", code: "PageUp", text: "" },
  PageDown: { vk: 34, key: "PageDown", code: "PageDown", text: "" },
};

const PRINTABLE_CODE_RE = /^[A-Za-z0-9]$/;
const CTRL_MODIFIER = 2;
const META_MODIFIER = 4;
const INPUT_EVENT_DELAY_MS = 25;
const INPUT_DISPATCH_TIMEOUT_MS = 1000;

const defaultKeyboardServices: KeyboardServices = {
  async cdp(method, params = {}, sessionId, timeoutMs) {
    // Keep the legacy cdp() override path for calls without a custom timeout.
    // Timed input dispatches use browserCdp() so a stalled native request can
    // still fall back to the synthetic event probe.
    if (timeoutMs === undefined) {
      return cdp(method, params, sessionId);
    }
    const response = await browserCdp(method, params, sessionId, timeoutMs);
    return response?.result || {};
  },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export function keyDefinition(key) {
  const special = KEYS[key];
  if (special) {
    return special;
  }
  if (key.length !== 1) {
    return { vk: 0, key, code: key, text: "" };
  }
  const vk = key.toUpperCase().codePointAt(0);
  const code = PRINTABLE_CODE_RE.test(key)
    ? `${/[0-9]/.test(key) ? "Digit" : "Key"}${key.toUpperCase()}`
    : key;
  return { vk, key, code, text: key };
}

function editingCommandsForKey(key, modifiers) {
  if (
    (modifiers === CTRL_MODIFIER || modifiers === META_MODIFIER) &&
    key.toLowerCase() === "a"
  ) {
    return ["selectAll"];
  }
  if (modifiers === 0 && key === "Backspace") {
    return ["deleteBackward"];
  }
  if (modifiers === 0 && key === "Delete") {
    return ["deleteForward"];
  }
  return undefined;
}

/**
 * Dispatch a key press through CDP.
 * @param {string} key Key name such as Enter, Tab, ArrowLeft, or a single printable character.
 * @param {number} [modifiers=0] CDP modifier bitfield: Alt=1, Ctrl=2, Meta/Cmd=4, Shift=8.
 * @returns {Promise<void>}
 */
export async function pressKey(key, modifiers = 0) {
  return pressKeyInPage(defaultKeyboardServices, undefined, key, modifiers);
}

/** Dispatch one key press through an explicit Page session. */
export async function pressKeyInPage(
  services: KeyboardServices,
  sessionId: string | undefined,
  key: string,
  modifiers = 0,
) {
  const { vk, code, text } = keyDefinition(key);
  const base = {
    key,
    code,
    modifiers,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk,
  };
  const commands = editingCommandsForKey(key, modifiers);
  const probeId = await installKeyProbe(services, sessionId, key);
  let dispatchError: unknown = null;
  try {
    await dispatchKeyEvent(services, sessionId, {
      type: "keyDown",
      ...base,
      ...(text ? { text, unmodifiedText: text } : {}),
      ...(commands ? { commands } : {}),
    });
    await inputEventDelay(services);
    await dispatchKeyEvent(services, sessionId, { type: "keyUp", ...base });
  } catch (error) {
    if (!isKeyDispatchTimeout(error)) throw error;
    dispatchError = error;
  }
  const completed = await finishKeyProbe(services, sessionId, probeId, {
    key,
    code,
    text,
    commands,
  });
  if (dispatchError && !completed) throw dispatchError;
}

/**
 * Insert text at the focused input using CDP Input.insertText.
 * @param {string} text Text to insert.
 * @returns {Promise<void>}
 */
export async function typeText(text) {
  await typeTextInPage(defaultKeyboardServices, undefined, text);
}

/** Insert text through an explicit Page session. */
export async function typeTextInPage(
  services: KeyboardServices,
  sessionId: string | undefined,
  text: string,
) {
  if (typeof text !== "string") {
    throw new TypeError("page.keyboard.type text must be a string");
  }
  await services.cdp("Input.insertText", { text }, sessionId);
}

/**
 * Focus an input, optionally clear it, type text, and fire input/change events.
 * @param {string} selector CSS selector / @ref / loc= / xpath= for the input-like element.
 * @param {string} text Text to write.
 * @param {{clearFirst?: boolean, timeout?: number}} [options]
 * @returns {Promise<void>}
 */
export async function fillInput(
  selector,
  text,
  options: FillInputOptions = {},
) {
  const clearFirst = options.clearFirst ?? true;
  const timeout = options.timeout ?? 0;
  if (timeout > 0 && !(await waitForElement(selector, { timeout }))) {
    throw new Error(
      `fillInput: element not found: ${JSON.stringify(selector)}`,
    );
  }
  await withHandle(selector, async ({ objectId, sessionId }) => {
    const focusSource = clearFirst
      ? "function(){this.focus(); if(typeof this.select==='function') this.select();}"
      : "function(){this.focus();}";
    await cdp(
      "Runtime.callFunctionOn",
      {
        functionDeclaration: focusSource,
        objectId,
        returnByValue: true,
        awaitPromise: false,
      },
      sessionId,
    );
    if (clearFirst) {
      await cdp(
        "Runtime.callFunctionOn",
        {
          functionDeclaration:
            "function(){this.value=''; this.dispatchEvent(new Event('input',{bubbles:true}));}",
          objectId,
          returnByValue: true,
          awaitPromise: false,
        },
        sessionId,
      );
    }
    await cdp("Input.insertText", { text }, sessionId);
    await cdp(
      "Runtime.callFunctionOn",
      {
        functionDeclaration:
          "function(){this.dispatchEvent(new Event('input',{bubbles:true})); this.dispatchEvent(new Event('change',{bubbles:true}));}",
        objectId,
        returnByValue: true,
        awaitPromise: false,
      },
      sessionId,
    );
  });
}

/**
 * Focus an element and dispatch a DOM KeyboardEvent in page JavaScript.
 * Note: dispatched event has isTrusted=false; some frameworks ignore it (see docs/issues/dispatchKey-synthetic-keyboard-event.md).
 * @param {string} selector CSS selector / @ref / loc= / xpath= for the target element.
 * @param {string} [key="Enter"] Event key.
 * @param {"keydown"|"keypress"|"keyup"|string} [event="keypress"] Event type.
 * @returns {Promise<void>}
 */
export async function dispatchKey(selector, key = "Enter", event = "keypress") {
  const { vk, code } = keyDefinition(key);
  await resolveAndCall(
    selector,
    "function(keyCode, key, code, event){this.focus(); this.dispatchEvent(new KeyboardEvent(event,{key,code,keyCode,which:keyCode,bubbles:true}));}",
    [vk, key, code, event],
  );
}

function inputEventDelay(services: KeyboardServices) {
  return services.sleep(INPUT_EVENT_DELAY_MS);
}

async function dispatchKeyEvent(
  services: KeyboardServices,
  sessionId: string | undefined,
  params: Record<string, unknown>,
) {
  await services.cdp(
    "Input.dispatchKeyEvent",
    params,
    sessionId,
    INPUT_DISPATCH_TIMEOUT_MS,
  );
}

async function installKeyProbe(
  services: KeyboardServices,
  sessionId: string | undefined,
  key: string,
) {
  if (!canProbeInputFallback()) return null;
  const id = `key_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  try {
    const result = await services.cdp(
      "Runtime.evaluate",
      {
        expression: `(() => {
      window.__egoBrowserInputProbes ||= {};
      const probe = { seen: false };
      probe.handler = (event) => {
        if (event.isTrusted && event.key === ${JSON.stringify(key)}) probe.seen = true;
      };
      document.addEventListener("keydown", probe.handler, true);
      window.__egoBrowserInputProbes[${JSON.stringify(id)}] = probe;
      return true;
    })()`,
        returnByValue: true,
        awaitPromise: false,
      },
      sessionId,
    );
    return result.result?.value ? id : null;
  } catch {
    return null;
  }
}

async function finishKeyProbe(
  services: KeyboardServices,
  sessionId: string | undefined,
  id: string | null,
  definition: { key: string; code: string; text: string; commands?: string[] },
) {
  if (!id) return false;
  await inputEventDelay(services);
  try {
    const result = await services.cdp(
      "Runtime.evaluate",
      {
        expression: `(() => {
      const probes = window.__egoBrowserInputProbes || {};
      const probe = probes[${JSON.stringify(id)}];
      if (!probe) return { seen: false, fallback: false };
      document.removeEventListener("keydown", probe.handler, true);
      delete probes[${JSON.stringify(id)}];
      if (probe.seen) return { seen: true, fallback: false };

      const target = document.activeElement || document.body;
      const key = ${JSON.stringify(definition.key)};
      const code = ${JSON.stringify(definition.code)};
      const text = ${JSON.stringify(definition.text)};
      const commands = ${JSON.stringify(definition.commands || [])};
      const keyboardInit = {
        key,
        code,
        bubbles: true,
        cancelable: true,
        keyCode: ${JSON.stringify(keyDefinition(definition.key).vk)},
        which: ${JSON.stringify(keyDefinition(definition.key).vk)},
      };
      target.dispatchEvent(new KeyboardEvent("keydown", keyboardInit));

      const isEditable =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement;
      if (isEditable) {
        if (commands.includes("selectAll") && typeof target.select === "function") {
          target.select();
        } else if (commands.includes("deleteBackward")) {
          const start = target.selectionStart ?? target.value.length;
          const end = target.selectionEnd ?? start;
          const from = start === end ? Math.max(0, start - 1) : start;
          const before = target.value;
          target.dispatchEvent(new InputEvent("beforeinput", {
            bubbles: true,
            cancelable: true,
            inputType: "deleteContentBackward",
          }));
          target.value = before.slice(0, from) + before.slice(end);
          target.setSelectionRange(from, from);
          target.dispatchEvent(new InputEvent("input", {
            bubbles: true,
            inputType: "deleteContentBackward",
          }));
        } else if (commands.includes("deleteForward")) {
          const start = target.selectionStart ?? target.value.length;
          const end = target.selectionEnd ?? start;
          const to = start === end ? Math.min(target.value.length, end + 1) : end;
          const before = target.value;
          target.dispatchEvent(new InputEvent("beforeinput", {
            bubbles: true,
            cancelable: true,
            inputType: "deleteContentForward",
          }));
          target.value = before.slice(0, start) + before.slice(to);
          target.setSelectionRange(start, start);
          target.dispatchEvent(new InputEvent("input", {
            bubbles: true,
            inputType: "deleteContentForward",
          }));
        } else if (text) {
          const start = target.selectionStart ?? target.value.length;
          const end = target.selectionEnd ?? start;
          const before = target.value;
          target.dispatchEvent(new InputEvent("beforeinput", {
            bubbles: true,
            cancelable: true,
            data: text,
            inputType: "insertText",
          }));
          target.value = before.slice(0, start) + text + before.slice(end);
          const next = start + text.length;
          target.setSelectionRange(next, next);
          target.dispatchEvent(new InputEvent("input", {
            bubbles: true,
            data: text,
            inputType: "insertText",
          }));
        }
      }

      target.dispatchEvent(new KeyboardEvent("keyup", keyboardInit));
      return { seen: false, fallback: true };
    })()`,
        returnByValue: true,
        awaitPromise: false,
      },
      sessionId,
    );
    const value = result.result?.value;
    return Boolean(value?.seen || value?.fallback);
  } catch {
    return false;
  }
}

function canProbeInputFallback() {
  return Boolean((globalThis as any).ego?.sendCDPMessage);
}

function isKeyDispatchTimeout(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /CDP request timed out: Input\.dispatchKeyEvent/.test(message);
}
