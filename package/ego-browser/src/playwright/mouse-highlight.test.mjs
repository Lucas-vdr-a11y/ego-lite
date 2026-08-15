import test from "node:test";
import assert from "node:assert/strict";

const { highlightAgentMouse } =
  await import("../../dist/src/playwright/mouse-highlight.js");

function mouseCommand(type, x, y) {
  return {
    id: 1,
    method: "Input.dispatchMouseEvent",
    params: { type, x, y, button: "left" },
    sessionId: "session-1",
  };
}

function recordingRuntime(result) {
  const highlighted = [];
  return {
    highlighted,
    animationHighlightMouseToPosition(x, y) {
      highlighted.push([x, y]);
      return result;
    },
  };
}

test("a pointer move takes the native agent cursor to the same point", () => {
  const runtime = recordingRuntime();
  highlightAgentMouse(runtime, mouseCommand("mouseMoved", 128.5, 42));
  assert.deepEqual(runtime.highlighted, [[128.5, 42]]);
});

test("only pointer moves take the cursor along", () => {
  const runtime = recordingRuntime();
  highlightAgentMouse(runtime, mouseCommand("mousePressed", 10, 20));
  highlightAgentMouse(runtime, mouseCommand("mouseReleased", 10, 20));
  highlightAgentMouse(runtime, mouseCommand("mouseWheel", 10, 20));
  highlightAgentMouse(runtime, {
    id: 2,
    method: "Input.dispatchKeyEvent",
    params: { type: "keyDown", x: 10, y: 20 },
  });
  highlightAgentMouse(runtime, {
    id: 3,
    method: "Page.navigate",
    params: { url: "https://example.com" },
  });
  assert.deepEqual(runtime.highlighted, []);
});

test("a move without usable coordinates leaves the cursor alone", () => {
  const runtime = recordingRuntime();
  highlightAgentMouse(runtime, mouseCommand("mouseMoved", "12", 20));
  highlightAgentMouse(runtime, mouseCommand("mouseMoved", 12, undefined));
  highlightAgentMouse(runtime, { id: 4, method: "Input.dispatchMouseEvent" });
  assert.deepEqual(runtime.highlighted, []);
});

test("a runtime without the native overlay call still dispatches pointer moves", () => {
  assert.doesNotThrow(() => {
    highlightAgentMouse({}, mouseCommand("mouseMoved", 10, 20));
    highlightAgentMouse(undefined, mouseCommand("mouseMoved", 10, 20));
    highlightAgentMouse(
      { animationHighlightMouseToPosition: "not a function" },
      mouseCommand("mouseMoved", 10, 20),
    );
  });
});

test("a refused overlay move is dropped instead of crashing the agent", async () => {
  const runtime = recordingRuntime(
    Promise.reject(new Error("user is controlling the task space")),
  );
  highlightAgentMouse(runtime, mouseCommand("mouseMoved", 10, 20));
  assert.deepEqual(runtime.highlighted, [[10, 20]]);
  // An unhandled rejection reaching the process here fails this test, which is
  // what the pointer path must never do when the user takes control.
  await new Promise((resolve) => setTimeout(resolve, 10));
});
