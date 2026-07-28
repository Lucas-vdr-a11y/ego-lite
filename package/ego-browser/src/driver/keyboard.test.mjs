import test from "node:test";
import assert from "node:assert/strict";

import { setOverrides } from "../../dist/src/state.js";
import {
  check,
  down,
  focus,
  press,
  pressOnSelector,
  pressSequentially,
  selectOption,
  setChecked,
  typeText,
  uncheck,
  up,
} from "../../dist/src/driver/keyboard.js";

test("press maps Command+A to the selectAll editing command", async () => {
  const calls = [];
  const restore = setOverrides({
    cdpOverride(method, params, sessionId) {
      calls.push({ method, params, sessionId });
      return {};
    },
  });
  try {
    await press("Meta+a");
  } finally {
    restore();
  }

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], {
    method: "Input.dispatchKeyEvent",
    sessionId: undefined,
    params: {
      type: "keyDown",
      key: "a",
      code: "KeyA",
      modifiers: 4,
      windowsVirtualKeyCode: 65,
      nativeVirtualKeyCode: 65,
      text: "a",
      unmodifiedText: "a",
      commands: ["selectAll"],
    },
  });
  assert.deepEqual(calls[1].params, {
    type: "keyUp",
    key: "a",
    code: "KeyA",
    modifiers: 4,
    windowsVirtualKeyCode: 65,
    nativeVirtualKeyCode: 65,
  });
});

test("press maps Control+A to the selectAll editing command", async () => {
  const calls = [];
  const restore = setOverrides({
    cdpOverride(method, params, sessionId) {
      calls.push({ method, params, sessionId });
      return {};
    },
  });
  try {
    await press("Control+a");
  } finally {
    restore();
  }

  assert.deepEqual(calls[0].params.commands, ["selectAll"]);
});

test("press does not map modified Command+A variants to selectAll", async () => {
  const calls = [];
  const restore = setOverrides({
    cdpOverride(method, params, sessionId) {
      calls.push({ method, params, sessionId });
      return {};
    },
  });
  try {
    await press("Shift+Meta+a");
  } finally {
    restore();
  }

  assert.equal(calls[0].params.commands, undefined);
});

test("down and up hold modifier state for subsequent presses", async () => {
  const calls = [];
  const restore = setOverrides({
    cdpOverride(method, params, sessionId) {
      calls.push({ method, params, sessionId });
      return {};
    },
  });
  try {
    await down("Shift");
    await press("ArrowLeft");
    await up("Shift");
  } finally {
    restore();
  }

  const keyEvents = calls.filter(
    (entry) => entry.method === "Input.dispatchKeyEvent",
  );
  assert.deepEqual(
    keyEvents.map((entry) => [
      entry.params.type,
      entry.params.key,
      entry.params.modifiers,
    ]),
    [
      ["keyDown", "Shift", 8],
      ["keyDown", "ArrowLeft", 8],
      ["keyUp", "ArrowLeft", 8],
      ["keyUp", "Shift", 0],
    ],
  );
});

test("press releases a modifier before its keyup event", async () => {
  const calls = [];
  const restore = setOverrides({
    cdpOverride(method, params, sessionId) {
      calls.push({ method, params, sessionId });
      return {};
    },
  });
  try {
    await press("Shift");
  } finally {
    restore();
  }

  assert.deepEqual(
    calls.map((entry) => [entry.params.type, entry.params.modifiers]),
    [
      ["keyDown", 8],
      ["keyUp", 0],
    ],
  );
});

test("press parses a literal plus key with modifiers (Shift++)", async () => {
  const calls = [];
  const restore = setOverrides({
    cdpOverride(method, params, sessionId) {
      calls.push({ method, params, sessionId });
      return {};
    },
  });
  try {
    await press("Shift++");
  } finally {
    restore();
  }

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].params, {
    type: "keyDown",
    key: "+",
    code: "+",
    modifiers: 8,
    windowsVirtualKeyCode: 43,
    nativeVirtualKeyCode: 43,
    text: "+",
    unmodifiedText: "+",
  });
  assert.deepEqual(calls[1].params, {
    type: "keyUp",
    key: "+",
    code: "+",
    modifiers: 8,
    windowsVirtualKeyCode: 43,
    nativeVirtualKeyCode: 43,
  });
});

test("press leaves ordinary printable keys unchanged", async () => {
  const calls = [];
  const restore = setOverrides({
    cdpOverride(method, params, sessionId) {
      calls.push({ method, params, sessionId });
      return {};
    },
  });
  try {
    await press("x");
  } finally {
    restore();
  }

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].params, {
    type: "keyDown",
    key: "x",
    code: "KeyX",
    modifiers: 0,
    windowsVirtualKeyCode: 88,
    nativeVirtualKeyCode: 88,
    text: "x",
    unmodifiedText: "x",
  });
  assert.deepEqual(calls[1].params, {
    type: "keyUp",
    key: "x",
    code: "KeyX",
    modifiers: 0,
    windowsVirtualKeyCode: 88,
    nativeVirtualKeyCode: 88,
  });
});

test("press maps Backspace and Delete to editing commands", async () => {
  const calls = [];
  const restore = setOverrides({
    cdpOverride(method, params, sessionId) {
      calls.push({ method, params, sessionId });
      return {};
    },
  });
  try {
    await press("Backspace");
    await press("Delete");
  } finally {
    restore();
  }

  assert.deepEqual(calls[0].params.commands, ["deleteBackward"]);
  assert.deepEqual(calls[2].params.commands, ["deleteForward"]);
});

test("press maps common function and lock keys to Chromium virtual key codes", async () => {
  const calls = [];
  const restore = setOverrides({
    cdpOverride(method, params) {
      calls.push({ method, params });
      return {};
    },
  });
  try {
    await press("F12");
    await press("Insert");
    await press("CapsLock");
  } finally {
    restore();
  }
  const downEvents = calls.filter(
    (entry) =>
      entry.method === "Input.dispatchKeyEvent" &&
      entry.params.type === "keyDown",
  );
  assert.deepEqual(
    downEvents.map((entry) => [
      entry.params.key,
      entry.params.windowsVirtualKeyCode,
    ]),
    [
      ["F12", 123],
      ["Insert", 45],
      ["CapsLock", 20],
    ],
  );
});

test("press applies Shift to printable key and text values", async () => {
  const calls = [];
  const restore = setOverrides({
    cdpOverride(method, params) {
      calls.push({ method, params });
      return {};
    },
  });
  try {
    await press("Shift+a");
    await press("Shift+1");
  } finally {
    restore();
  }
  const downEvents = calls.filter(
    (entry) =>
      entry.method === "Input.dispatchKeyEvent" &&
      entry.params.type === "keyDown",
  );
  assert.deepEqual(
    downEvents.map((entry) => [
      entry.params.key,
      entry.params.text,
      entry.params.unmodifiedText,
      entry.params.modifiers,
    ]),
    [
      ["A", "A", "a", 8],
      ["!", "!", "1", 8],
    ],
  );
});

test("press triggers probe fallback when CDP dispatch is not trusted", async () => {
  // Enable canProbeInputFallback() by providing ego runtime
  const originalEgo = globalThis.ego;
  globalThis.ego = { sendCDPMessage: () => {} };
  let evaluateCallCount = 0;
  const evaluateExpressions = [];
  const restore = setOverrides({
    cdpOverride(method, params, sessionId) {
      if (method === "Runtime.evaluate") {
        evaluateCallCount++;
        evaluateExpressions.push(params.expression);
        // First call: installKeyProbe — return truthy to indicate probe installed
        if (evaluateCallCount === 1) {
          return { result: { value: true } };
        }
        // Second call: finishKeyProbe — simulate CDP dispatch was NOT seen
        // (the CDP keyDown did not produce a trusted event)
        return { result: { value: { seen: false, fallback: true } } };
      }
      // Input.dispatchKeyEvent calls proceed normally
      return {};
    },
  });
  try {
    await press("a");
  } finally {
    restore();
    if (originalEgo === undefined) delete globalThis.ego;
    else globalThis.ego = originalEgo;
  }

  // Verify probe install and finish were called
  assert.equal(
    evaluateCallCount,
    2,
    "Runtime.evaluate called for install and finish",
  );
  // Install expression should reference __egoBrowserInputProbes
  assert.match(
    evaluateExpressions[0],
    /__egoBrowserInputProbes/,
    "install expression sets up probe",
  );
  // Finish expression should contain the fallback dispatch logic
  assert.match(
    evaluateExpressions[1],
    /dispatchEvent/,
    "finish expression contains fallback dispatch",
  );
  assert.match(
    evaluateExpressions[1],
    /KeyboardEvent/,
    "finish expression dispatches KeyboardEvent in fallback",
  );
});

test("press skips probe fallback when CDP dispatch is trusted", async () => {
  const originalEgo = globalThis.ego;
  globalThis.ego = { sendCDPMessage: () => {} };
  let evaluateCallCount = 0;
  const evaluateExpressions = [];
  const restore = setOverrides({
    cdpOverride(method, params, sessionId) {
      if (method === "Runtime.evaluate") {
        evaluateCallCount++;
        evaluateExpressions.push(params.expression);
        if (evaluateCallCount === 1) {
          return { result: { value: true } };
        }
        // Simulate CDP dispatch WAS seen (trusted event arrived)
        return { result: { value: { seen: true, fallback: false } } };
      }
      return {};
    },
  });
  try {
    await press("x");
  } finally {
    restore();
    if (originalEgo === undefined) delete globalThis.ego;
    else globalThis.ego = originalEgo;
  }

  assert.equal(
    evaluateCallCount,
    2,
    "Runtime.evaluate called for install and finish",
  );
  // When seen=true, finish should return early without dispatching fallback events
  // The expression still contains the fallback code but it returns early via the seen check
  assert.match(
    evaluateExpressions[1],
    /probe\.seen/,
    "finish expression checks probe.seen flag",
  );
});

function selectorCallHarness() {
  const calls = [];
  let checked = false;
  const restore = setOverrides({
    cdpOverride(method, params, sessionId) {
      calls.push({ method, params, sessionId });
      if (method === "Runtime.evaluate") {
        return { result: { objectId: "object-1" } };
      }
      if (method === "Runtime.callFunctionOn") {
        if (params.functionDeclaration.includes("checked: target.checked")) {
          return {
            result: { value: { checked, type: "checkbox" } },
          };
        }
        if (params.functionDeclaration.includes("ready: true, selected")) {
          return { result: { value: { ready: true, selected: ["b"] } } };
        }
        if (params.functionDeclaration.includes("getBoundingClientRect")) {
          return {
            result: {
              value: {
                attached: true,
                visible: true,
                enabled: true,
                editable: true,
                receivesEvents: true,
                rect: { x: 0, y: 0, width: 20, height: 20 },
              },
            },
          };
        }
      }
      if (
        method === "Input.dispatchMouseEvent" &&
        params.type === "mouseReleased"
      ) {
        checked = !checked;
      }
      return {};
    },
  });
  return { calls, restore };
}

test("focus resolves a selector and focuses the element", async () => {
  const { calls, restore } = selectorCallHarness();
  try {
    await focus("#name");
  } finally {
    restore();
  }

  const call = calls.find(
    (entry) =>
      entry.method === "Runtime.callFunctionOn" &&
      entry.params.functionDeclaration.includes("this.focus()"),
  );
  assert.equal(call.params.objectId, "object-1");
  assert.match(call.params.functionDeclaration, /this\.focus\(\)/);
});

test("setChecked, check, and uncheck use real click transitions", async () => {
  const { calls, restore } = selectorCallHarness();
  try {
    await setChecked("#agree", true);
    await check("#agree");
    await uncheck("#agree");
  } finally {
    restore();
  }

  const releases = calls.filter(
    (entry) =>
      entry.method === "Input.dispatchMouseEvent" &&
      entry.params.type === "mouseReleased",
  );
  assert.equal(releases.length, 2);
});

test("setChecked applies its timeout to the initial state lookup", async () => {
  let now = 0;
  const restore = setOverrides({
    defaultTimeout: 30_000,
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    cdpOverride() {
      return { result: {} };
    },
  });
  try {
    await assert.rejects(() =>
      setChecked("#missing-checkbox", true, { timeout: 100 }),
    );
    assert.ok(now <= 100, `state lookup consumed ${now}ms`);
  } finally {
    restore();
  }
});

test("setChecked rejects radio uncheck before dispatching input", async () => {
  const calls = [];
  const restore = setOverrides({
    cdpOverride(method, params) {
      calls.push({ method, params });
      if (method === "Runtime.evaluate") {
        return { result: { objectId: "radio-1" } };
      }
      if (
        method === "Runtime.callFunctionOn" &&
        params.functionDeclaration.includes("checked: target.checked")
      ) {
        return {
          result: { value: { checked: true, type: "radio" } },
        };
      }
      return {};
    },
  });
  try {
    await assert.rejects(
      () => setChecked("#radio", false),
      /cannot uncheck a radio input/,
    );
    assert.equal(
      calls.filter((entry) => entry.method === "Input.dispatchMouseEvent")
        .length,
      0,
    );
  } finally {
    restore();
  }
});

test("selectOption returns selected values", async () => {
  const { calls, restore } = selectorCallHarness();
  try {
    assert.deepEqual(await selectOption("#choice", "b"), ["b"]);
  } finally {
    restore();
  }

  const call = calls.find(
    (entry) =>
      entry.method === "Runtime.callFunctionOn" &&
      entry.params.functionDeclaration.includes("HTMLSelectElement"),
  );
  assert.deepEqual(call.params.arguments, [{ value: "b" }]);
  assert.match(call.params.functionDeclaration, /HTMLSelectElement/);
});

test("selectOption does not mutate existing selection while waiting for all options", async () => {
  const originalSelect = globalThis.HTMLSelectElement;
  const originalEvent = globalThis.Event;
  let now = 0;
  const select = {
    options: [
      {
        value: "original",
        label: "Original",
        text: "Original",
        selected: true,
      },
      { value: "ready", label: "Ready", text: "Ready", selected: false },
    ],
    multiple: true,
    dispatchEvent() {
      throw new Error("events must not fire before every option exists");
    },
  };
  globalThis.HTMLSelectElement = class HTMLSelectElement {};
  Object.setPrototypeOf(select, globalThis.HTMLSelectElement.prototype);
  globalThis.Event = class Event {};
  const restore = setOverrides({
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    cdpOverride(method, params) {
      if (method === "Runtime.evaluate") {
        return { result: { objectId: "select-1" } };
      }
      if (
        method === "Runtime.callFunctionOn" &&
        params.functionDeclaration.includes("getBoundingClientRect")
      ) {
        return {
          result: {
            value: {
              attached: true,
              visible: true,
              enabled: true,
              editable: false,
              receivesEvents: true,
              rect: { x: 0, y: 0, width: 100, height: 30 },
            },
          },
        };
      }
      if (
        method === "Runtime.callFunctionOn" &&
        params.functionDeclaration.includes("HTMLSelectElement")
      ) {
        const pageFunction = Function(
          `return (${params.functionDeclaration})`,
        )();
        return {
          result: {
            value: pageFunction.call(select, params.arguments[0].value),
          },
        };
      }
      return {};
    },
  });
  try {
    await assert.rejects(
      () =>
        selectOption("#choice", ["ready", "not-yet"], {
          timeout: 100,
        }),
      /locator\.selectOption timed out/,
    );
    assert.deepEqual(
      select.options.map((option) => option.selected),
      [true, false],
      "waiting leaves the original selection untouched",
    );
  } finally {
    restore();
    if (originalSelect === undefined) delete globalThis.HTMLSelectElement;
    else globalThis.HTMLSelectElement = originalSelect;
    if (originalEvent === undefined) delete globalThis.Event;
    else globalThis.Event = originalEvent;
  }
});

test("selectOption does not treat a missing empty value as success", async () => {
  let now = 0;
  const restore = setOverrides({
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    cdpOverride(method, params) {
      if (method === "Runtime.evaluate") {
        return { result: { objectId: "select-1" } };
      }
      if (
        method === "Runtime.callFunctionOn" &&
        params.functionDeclaration.includes("getBoundingClientRect")
      ) {
        return {
          result: {
            value: {
              attached: true,
              visible: true,
              enabled: true,
              editable: false,
              receivesEvents: true,
              rect: { x: 0, y: 0, width: 100, height: 30 },
            },
          },
        };
      }
      if (method === "Runtime.callFunctionOn") {
        return { result: { value: { ready: false } } };
      }
      return {};
    },
  });
  try {
    await assert.rejects(
      () => selectOption("#choice", "", { timeout: 100 }),
      /locator\.selectOption timed out/,
    );
  } finally {
    restore();
  }
});

test("selectOption shares one timeout across actionability and option waits", async () => {
  let now = 0;
  let actionabilityChecked = false;
  const restore = setOverrides({
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    cdpOverride(method, params) {
      if (method === "Runtime.evaluate") {
        return { result: { objectId: "select-1" } };
      }
      if (
        method === "Runtime.callFunctionOn" &&
        params.functionDeclaration.includes("getBoundingClientRect")
      ) {
        if (!actionabilityChecked) {
          actionabilityChecked = true;
          now += 75;
        }
        return {
          result: {
            value: {
              attached: true,
              visible: true,
              enabled: true,
              editable: false,
              receivesEvents: true,
              rect: { x: 0, y: 0, width: 100, height: 30 },
            },
          },
        };
      }
      if (
        method === "Runtime.callFunctionOn" &&
        params.functionDeclaration.includes("HTMLSelectElement")
      ) {
        return { result: { value: { ready: false } } };
      }
      return {};
    },
  });
  try {
    await assert.rejects(
      () => selectOption("#choice", "later", { timeout: 100 }),
      /locator\.selectOption timed out after 100ms/,
    );
    assert.equal(now, 125);
  } finally {
    restore();
  }
});

test("setChecked rejects page-side validation errors", async () => {
  const restore = setOverrides({
    cdpOverride(method) {
      if (method === "Runtime.evaluate") {
        return { result: { objectId: "object-1" } };
      }
      if (method === "Runtime.callFunctionOn") {
        return {
          result: { subtype: "error", description: "Error: wrong target" },
        };
      }
      return {};
    },
  });
  try {
    await assert.rejects(() => setChecked("#text", true), /wrong target/);
  } finally {
    restore();
  }
});

test("pressSequentially focuses a selector then presses characters with delay", async () => {
  const calls = [];
  let now = 0;
  const restore = setOverrides({
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    cdpOverride(method, params, sessionId) {
      calls.push({ method, params, sessionId });
      if (method === "Runtime.evaluate") {
        return { result: { objectId: "object-1", value: true } };
      }
      return {};
    },
  });
  try {
    await pressSequentially("#name", "ab", { delay: 5 });
  } finally {
    restore();
  }

  const keyDowns = calls.filter(
    (entry) =>
      entry.method === "Input.dispatchKeyEvent" &&
      entry.params.type === "keyDown",
  );
  assert.deepEqual(
    keyDowns.map((entry) => entry.params.key),
    ["a", "b"],
  );
  assert.equal(now, 10);
  assert(
    calls.some(
      (entry) =>
        entry.method === "Runtime.callFunctionOn" &&
        entry.params.functionDeclaration.includes("this.focus()"),
    ),
  );
});

test("typeText presses text without focusing a selector", async () => {
  const calls = [];
  const restore = setOverrides({
    cdpOverride(method, params, sessionId) {
      calls.push({ method, params, sessionId });
      return {};
    },
  });
  try {
    await typeText("ab");
  } finally {
    restore();
  }

  const keyDowns = calls.filter(
    (entry) =>
      entry.method === "Input.dispatchKeyEvent" &&
      entry.params.type === "keyDown",
  );
  assert.deepEqual(
    keyDowns.map((entry) => entry.params.key),
    ["a", "b"],
  );
  assert.ok(
    !calls.some((entry) => entry.method === "Runtime.callFunctionOn"),
    "keyboard.type should not focus a selector",
  );
});

test("pressOnSelector focuses a selector then presses a key", async () => {
  const calls = [];
  const restore = setOverrides({
    cdpOverride(method, params, sessionId) {
      calls.push({ method, params, sessionId });
      if (method === "Runtime.evaluate") {
        return { result: { objectId: "object-1", value: true } };
      }
      return {};
    },
  });
  try {
    await pressOnSelector("#name", "Enter");
  } finally {
    restore();
  }

  assert(
    calls.some(
      (entry) =>
        entry.method === "Runtime.callFunctionOn" &&
        entry.params.functionDeclaration.includes("this.focus()"),
    ),
  );
  assert(
    calls.some(
      (entry) =>
        entry.method === "Input.dispatchKeyEvent" &&
        entry.params.type === "keyDown" &&
        entry.params.key === "Enter",
    ),
  );
});
