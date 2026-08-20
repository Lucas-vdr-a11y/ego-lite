import test from "node:test";
import assert from "node:assert/strict";

import { clickInPage } from "../dist/src/driver/page-actions.js";
import { RefMap } from "../dist/src/ref-map.js";

test("Page click translates same-process iframe coordinates to the Page viewport", async () => {
  const calls = [];
  const services = {
    async cdp(method, params = {}, sessionId) {
      calls.push([method, params, sessionId]);
      if (method === "Accessibility.getFullAXTree") {
        return params.frameId === "frame-child"
          ? {
              nodes: [
                {
                  role: { value: "button" },
                  name: { value: "Run iframe action" },
                  backendDOMNodeId: 21,
                },
              ],
            }
          : { nodes: [] };
      }
      if (method === "DOM.resolveNode") {
        return { object: { objectId: "iframe-button" } };
      }
      if (method === "Runtime.callFunctionOn") {
        return params.functionDeclaration.includes("getBoundingClientRect")
          ? { result: { value: { x: 10, y: 20 } } }
          : { result: { value: { ok: true } } };
      }
      if (method === "DOM.getFrameOwner") {
        return { backendNodeId: 90 };
      }
      if (method === "DOM.getBoxModel") {
        return {
          model: { content: [100, 200, 300, 200, 300, 400, 100, 400] },
        };
      }
      return {};
    },
    async showAgentMousePosition() {},
    async sleep() {},
  };

  await clickInPage(
    services,
    "session:page",
    new RefMap(),
    'loc=role:button[name="Run iframe action"]',
    {},
    0,
    new Map([["frame-child", "session:page"]]),
  );

  const pointerEvents = calls
    .filter(([method]) => method === "Input.dispatchMouseEvent")
    .map(([, params]) => params);
  assert.equal(pointerEvents.length, 3);
  assert(
    pointerEvents.every(({ x, y }) => x === 110 && y === 220),
    "native input must use top-level Page coordinates",
  );
  const hitTest = calls.find(
    ([method, params]) =>
      method === "Runtime.callFunctionOn" &&
      params.functionDeclaration.includes("isConnected"),
  );
  assert.deepEqual(
    hitTest[1].arguments[0].value,
    { x: 10, y: 20 },
    "the iframe-local hit test must keep local coordinates",
  );
});
