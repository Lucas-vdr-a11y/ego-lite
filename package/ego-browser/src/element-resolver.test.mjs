import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveElementCenter,
  resolveElementObjectId,
  ElementResolutionError,
} from "../dist/src/element-resolver.js";
import { RefMap } from "../dist/src/ref-map.js";

class FakeCDP {
  constructor(handler) {
    this.calls = [];
    this.handler = handler;
  }

  async sendRaw(method, params = {}, sessionId = undefined) {
    this.calls.push([method, params, sessionId]);
    return this.handler(method, params, sessionId);
  }
}

const AX_TREE = {
  nodes: [
    { role: { value: "button" }, name: { value: "ok" }, backendDOMNodeId: 100 },
  ],
};

test("resolveElementCenter computes the center from a valid box model", async () => {
  const refMap = new RefMap();
  refMap.add("5", 100, "button", "ok");
  const cdp = new FakeCDP(async (method) => {
    if (method === "DOM.getBoxModel") {
      return { model: { content: [0, 0, 10, 0, 10, 10, 0, 10] } };
    }
    return {};
  });
  const point = await resolveElementCenter(cdp, undefined, refMap, "@5");
  assert.equal(point.x, 5);
  assert.equal(point.y, 5);
});

test("degenerate box model throws transient instead of returning (0,0)", async () => {
  // Regression: boxModelCenter used to return {x:0,y:0} for a missing content
  // quad, which made callers click the top-left viewport corner.
  const refMap = new RefMap();
  refMap.add("5", 100, "button", "ok");
  const cdp = new FakeCDP(async (method) => {
    if (method === "DOM.getBoxModel") {
      return { model: { content: [] } };
    }
    if (method === "Accessibility.getFullAXTree") {
      return AX_TREE;
    }
    return {};
  });
  await assert.rejects(
    () => resolveElementCenter(cdp, undefined, refMap, "@5"),
    (error) => {
      assert.ok(error instanceof ElementResolutionError);
      assert.equal(error.kind, "transient");
      assert.match(error.message, /no box model/);
      return true;
    },
  );
  assert.ok(
    !cdp.calls.some(([method]) => method === "Accessibility.getFullAXTree"),
    "must not fall back to role/name lookup — it could match a different node with the same label",
  );
});

test("stale backend node still falls back to role/name lookup", async () => {
  const refMap = new RefMap();
  refMap.add("5", 100, "button", "ok");
  let boxModelCalls = 0;
  const cdp = new FakeCDP(async (method) => {
    if (method === "DOM.getBoxModel") {
      boxModelCalls += 1;
      if (boxModelCalls === 1) {
        throw new Error("No node with given id found");
      }
      return { model: { content: [0, 0, 10, 0, 10, 10, 0, 10] } };
    }
    if (method === "Accessibility.getFullAXTree") {
      return AX_TREE;
    }
    return {};
  });
  const point = await resolveElementCenter(cdp, undefined, refMap, "@5");
  assert.equal(point.x, 5);
  assert.equal(point.y, 5);
  assert.ok(
    cdp.calls.some(([method]) => method === "Accessibility.getFullAXTree"),
    "a stale node must trigger the role/name fallback",
  );
});

test("role locator with degenerate box model throws transient", async () => {
  const cdp = new FakeCDP(async (method) => {
    if (method === "Accessibility.getFullAXTree") {
      return AX_TREE;
    }
    if (method === "DOM.getBoxModel") {
      return { model: {} };
    }
    return {};
  });
  await assert.rejects(
    () =>
      resolveElementCenter(
        cdp,
        undefined,
        new RefMap(),
        'loc=role:button[name="ok"]',
      ),
    (error) => {
      assert.ok(error instanceof ElementResolutionError);
      assert.equal(error.kind, "transient");
      return true;
    },
  );
});

test("CSS locators search nested open shadow roots", async () => {
  const cdp = new FakeCDP(async (method, params) => {
    if (method === "Runtime.evaluate") {
      assert.match(
        params.expression,
        /shadowRoot/,
        "the CSS query must visit open shadow roots instead of using only document.querySelectorAll",
      );
      return { result: { value: { x: 12, y: 34 } } };
    }
    return {};
  });

  const point = await resolveElementCenter(
    cdp,
    undefined,
    new RefMap(),
    'loc=css:input[aria-label="Shadow field"]',
  );

  assert.deepEqual(point, { x: 12, y: 34, sessionId: undefined });
});

test("text locators normalize whitespace and search nested open shadow roots", async () => {
  const cdp = new FakeCDP(async (method, params) => {
    if (method === "Runtime.evaluate") {
      assert.match(params.expression, /shadowRoot/);
      assert.match(params.expression, /replace\(\/\\s\+\/g, " "\)/);
      assert.match(params.expression, /toLowerCase\(\)\s*\.includes/);
      assert.match(params.expression, /INPUT/);
      return { result: { value: { x: 20, y: 30 } } };
    }
    return {};
  });

  const point = await resolveElementCenter(
    cdp,
    undefined,
    new RefMap(),
    "text=Save changes",
  );

  assert.deepEqual(point, { x: 20, y: 30, sessionId: undefined });
});

test("quoted text locators use exact case-sensitive matching", async () => {
  const cdp = new FakeCDP(async (method, params) => {
    if (method === "Runtime.evaluate") {
      assert.match(params.expression, /mode: "exact"/);
      assert.match(params.expression, /=== expected/);
      return { result: { value: { x: 40, y: 50 } } };
    }
    return {};
  });

  const point = await resolveElementCenter(
    cdp,
    undefined,
    new RefMap(),
    'text="Save changes"',
  );

  assert.deepEqual(point, { x: 40, y: 50, sessionId: undefined });
});

test("ambiguous text locators fail permanently instead of choosing one match", async () => {
  const cdp = new FakeCDP(async (method, params) => {
    if (method === "Runtime.evaluate") {
      if (params.expression.includes("__egoDescribeMatches")) {
        return {
          result: {
            value: {
              visible: 2,
              hidden: 0,
              candidates: [
                { tag: "button", name: "Save draft", visible: true },
                { tag: "button", name: "Save changes", visible: true },
              ],
            },
          },
        };
      }
      return {
        result: {
          value: { error: "Locator text=Save matched 2 elements" },
        },
      };
    }
    return {};
  });

  await assert.rejects(
    () => resolveElementCenter(cdp, undefined, new RefMap(), "text=Save"),
    (error) => {
      assert.ok(error instanceof ElementResolutionError);
      assert.equal(error.kind, "permanent");
      assert.match(error.message, /matched 2 elements/);
      assert.match(error.message, /2 visible, 0 hidden/);
      assert.match(error.message, /button "Save draft"/);
      assert.match(error.message, /current snapshot ref|more specific/i);
      return true;
    },
  );
});

test("ambiguous raw CSS selectors fail instead of choosing the first match", async () => {
  const cdp = new FakeCDP(async (method, params) => {
    if (method === "Runtime.evaluate") {
      if (params.expression.includes("__egoDescribeMatches")) {
        return {
          result: {
            value: {
              visible: 2,
              hidden: 1,
              candidates: [
                {
                  tag: "button",
                  role: "button",
                  name: "Create",
                  visible: true,
                  disabled: false,
                },
                {
                  tag: "button",
                  role: "button",
                  name: "Create menu",
                  visible: true,
                  disabled: false,
                },
                {
                  tag: "button",
                  name: "Create",
                  visible: false,
                  disabled: true,
                },
              ],
            },
          },
        };
      }
      assert.match(params.expression, /querySelectorAll/);
      return { result: { value: 3 } };
    }
    return {};
  });

  await assert.rejects(
    () =>
      resolveElementObjectId(
        cdp,
        "session:page",
        new RefMap(),
        "button.save",
        new Map(),
        { strict: true },
      ),
    (error) => {
      assert.ok(error instanceof ElementResolutionError);
      assert.equal(error.kind, "permanent");
      assert.match(error.message, /Selector button\.save matched 3 elements/);
      assert.match(error.message, /2 visible, 1 hidden/);
      assert.match(error.message, /button role=button "Create" \(visible\)/);
      assert.match(error.message, /button "Create" \(hidden, disabled\)/);
      assert.match(error.message, /current snapshot ref|more specific/i);
      return true;
    },
  );
});

test("action resolution uses the sole usable CSS match", async () => {
  const cdp = new FakeCDP(async (method, params) => {
    if (method !== "Runtime.evaluate") return {};
    if (params.expression.includes("__egoActionableMatches")) {
      return params.returnByValue
        ? { result: { value: 1 } }
        : { result: { objectId: "visible-button" } };
    }
    return { result: { value: 2 } };
  });

  assert.deepEqual(
    await resolveElementObjectId(
      cdp,
      "session:page",
      new RefMap(),
      "button.save",
      new Map(),
      { strict: true, actionability: "visible" },
    ),
    { objectId: "visible-button", sessionId: "session:page" },
  );
});

test("action resolution prefers a sole actionable Page match over iframe matches", async () => {
  const cdp = new FakeCDP(async (method, params, sessionId) => {
    if (method !== "Runtime.evaluate") return {};
    if (params.expression.includes("__egoActionableMatches")) {
      return params.returnByValue
        ? { result: { value: 1 } }
        : { result: { objectId: `button:${sessionId}` } };
    }
    return { result: { value: 1 } };
  });

  assert.deepEqual(
    await resolveElementObjectId(
      cdp,
      "session:page",
      new RefMap(),
      "button.save",
      new Map([["frame-child", "session:frame-child"]]),
      { strict: true, actionability: "pointer" },
    ),
    { objectId: "button:session:page", sessionId: "session:page" },
  );
});

test("pointer action resolution skips a covered Page match for a frame match", async () => {
  const cdp = new FakeCDP(async (method, params, sessionId) => {
    if (method !== "Runtime.evaluate") return {};
    if (params.expression.includes("__egoActionableMatches")) {
      assert.match(params.expression, /elementsFromPoint/);
      if (params.returnByValue) {
        return {
          result: { value: sessionId === "session:frame-child" ? 1 : 0 },
        };
      }
      return { result: { objectId: "frame-button" } };
    }
    return { result: { value: 1 } };
  });

  assert.deepEqual(
    await resolveElementObjectId(
      cdp,
      "session:page",
      new RefMap(),
      "button.move",
      new Map([["frame-child", "session:frame-child"]]),
      { strict: true, actionability: "pointer" },
    ),
    { objectId: "frame-button", sessionId: "session:frame-child" },
  );
});

test("visible action resolution permits opacity-zero native controls", async () => {
  const cdp = new FakeCDP(async (method, params) => {
    if (method !== "Runtime.evaluate") return {};
    if (params.expression.includes("__egoActionableMatches")) {
      assert.doesNotMatch(params.expression, /style\.opacity/);
      return params.returnByValue
        ? { result: { value: 1 } }
        : { result: { objectId: "transparent-select" } };
    }
    return { result: { value: 1 } };
  });

  assert.deepEqual(
    await resolveElementObjectId(
      cdp,
      "session:page",
      new RefMap(),
      "select.sort",
      new Map(),
      { strict: true, actionability: "visible" },
    ),
    { objectId: "transparent-select", sessionId: "session:page" },
  );
});

test("ambiguous raw XPath selectors fail instead of choosing the first match", async () => {
  const cdp = new FakeCDP(async (method, params) => {
    if (method === "Runtime.evaluate") {
      assert.match(params.expression, /ORDERED_NODE_SNAPSHOT_TYPE/);
      return { result: { value: 2 } };
    }
    return {};
  });

  await assert.rejects(
    () =>
      resolveElementObjectId(
        cdp,
        "session:page",
        new RefMap(),
        "xpath=//button",
        new Map(),
        { strict: true },
      ),
    (error) => {
      assert.ok(error instanceof ElementResolutionError);
      assert.equal(error.kind, "permanent");
      assert.match(
        error.message,
        /Selector xpath=\/\/button matched 2 elements/,
      );
      return true;
    },
  );
});

test("semantic locators search cross-process iframe sessions", async () => {
  const cdp = new FakeCDP(async (method, _params, sessionId) => {
    if (method === "Accessibility.getFullAXTree") {
      return sessionId === "session:frame-child"
        ? {
            nodes: [
              {
                role: { value: "button" },
                name: { value: "Run iframe action" },
                backendDOMNodeId: 201,
              },
            ],
          }
        : { nodes: [] };
    }
    if (method === "DOM.resolveNode") {
      assert.equal(sessionId, "session:frame-child");
      assert.equal(_params.backendNodeId, 201);
      return { object: { objectId: "iframe-button" } };
    }
    return {};
  });

  const resolved = await resolveElementObjectId(
    cdp,
    "session:page",
    new RefMap(),
    'loc=role:button[name="Run iframe action"]',
    new Map([["frame-child", "session:frame-child"]]),
  );

  assert.deepEqual(resolved, {
    objectId: "iframe-button",
    sessionId: "session:frame-child",
  });
});

test("text locators search same-process iframe execution contexts", async () => {
  const cdp = new FakeCDP(async (method, params, sessionId) => {
    assert.equal(sessionId, "session:page");
    if (method === "Page.createIsolatedWorld") {
      assert.equal(params.frameId, "frame-child");
      return { executionContextId: 77 };
    }
    if (method === "Runtime.evaluate") {
      const inFrame = params.contextId === 77;
      if (params.returnByValue) {
        return { result: { value: inFrame ? 1 : 0 } };
      }
      return {
        result: inFrame
          ? { objectId: "same-process-upload" }
          : { type: "undefined" },
      };
    }
    return {};
  });

  assert.deepEqual(
    await resolveElementObjectId(
      cdp,
      "session:page",
      new RefMap(),
      'text="Upload"',
      new Map([["frame-child", "session:page"]]),
      { strict: true },
    ),
    {
      objectId: "same-process-upload",
      sessionId: "session:page",
      frameId: "frame-child",
    },
  );
});

test("snapshot role aliases resolve against standard accessibility roles", async () => {
  const cdp = new FakeCDP(async (method) => {
    if (method === "Accessibility.getFullAXTree") {
      return {
        nodes: [
          {
            role: { value: "option" },
            name: { value: "Upload" },
            backendDOMNodeId: 201,
          },
        ],
      };
    }
    if (method === "DOM.resolveNode") {
      return { object: { objectId: "upload-option" } };
    }
    return {};
  });

  assert.deepEqual(
    await resolveElementObjectId(
      cdp,
      "session:page",
      new RefMap(),
      'loc=role:listboxoption[name="Upload"]',
    ),
    { objectId: "upload-option", sessionId: "session:page" },
  );
});

test("same-process frame role matches keep their frame provenance", async () => {
  const cdp = new FakeCDP(async (method, params) => {
    if (method === "Accessibility.getFullAXTree") {
      return {
        nodes: [
          {
            role: { value: "option" },
            name: { value: "Upload" },
            backendDOMNodeId: 201,
          },
        ],
      };
    }
    if (method === "DOM.resolveNode") {
      return { object: { objectId: "upload-option" } };
    }
    if (method === "Runtime.callFunctionOn") {
      return { result: { value: { actionable: true } } };
    }
    return {};
  });

  assert.deepEqual(
    await resolveElementObjectId(
      cdp,
      "session:page",
      new RefMap(),
      'loc=role:listboxoption[name="Upload"]',
      new Map([["frame-child", "session:page"]]),
      { actionability: "pointer" },
    ),
    {
      objectId: "upload-option",
      sessionId: "session:page",
      frameId: "frame-child",
    },
  );
});

test("a unique interactable frame role wins over a blocked Page duplicate", async () => {
  const cdp = new FakeCDP(async (method, _params, sessionId) => {
    if (method === "Accessibility.getFullAXTree") {
      return {
        nodes: [
          {
            role: { value: "button" },
            name: { value: "Duplicate" },
            backendDOMNodeId: sessionId === "session:page" ? 1 : 2,
          },
        ],
      };
    }
    if (method === "DOM.resolveNode") {
      return { object: { objectId: `node:${sessionId}` } };
    }
    if (method === "Runtime.callFunctionOn") {
      assert.match(_params.functionDeclaration, /elementsFromPoint/);
      return { result: { value: sessionId === "session:frame-child" } };
    }
    return {};
  });

  assert.deepEqual(
    await resolveElementObjectId(
      cdp,
      "session:page",
      new RefMap(),
      'loc=role:button[name="Duplicate"]',
      new Map([["frame-child", "session:frame-child"]]),
      { actionability: "pointer" },
    ),
    { objectId: "node:session:frame-child", sessionId: "session:frame-child" },
  );
});

test("role actions prefer the actionable Page match over a frame match", async () => {
  const cdp = new FakeCDP(async (method, _params, sessionId) => {
    if (method === "Accessibility.getFullAXTree") {
      return {
        nodes: [
          {
            role: { value: "button" },
            name: { value: "Duplicate" },
            backendDOMNodeId: sessionId === "session:page" ? 1 : 2,
          },
        ],
      };
    }
    if (method === "DOM.resolveNode") {
      return { object: { objectId: `node:${sessionId}` } };
    }
    if (method === "Runtime.callFunctionOn") {
      return { result: { value: true } };
    }
    return {};
  });

  assert.deepEqual(
    await resolveElementObjectId(
      cdp,
      "session:page",
      new RefMap(),
      'loc=role:button[name="Duplicate"]',
      new Map([["frame-child", "session:frame-child"]]),
      { actionability: "pointer" },
    ),
    { objectId: "node:session:page", sessionId: "session:page" },
  );
});

test("strict global role validation rejects a hidden duplicate", async () => {
  const cdp = new FakeCDP(async (method, _params, sessionId) => {
    if (method === "Accessibility.getFullAXTree") {
      return {
        nodes: [
          {
            role: { value: "textbox" },
            name: { value: "Prompt" },
            backendDOMNodeId: sessionId === "session:page" ? 1 : 2,
          },
        ],
      };
    }
    return {};
  });

  await assert.rejects(
    () =>
      resolveElementObjectId(
        cdp,
        "session:page",
        new RefMap(),
        'loc=role:textbox[name="Prompt"]',
        new Map([["frame-child", "session:frame-child"]]),
        { strictGlobal: true },
      ),
    (error) => {
      assert.ok(error instanceof ElementResolutionError);
      assert.equal(error.kind, "permanent");
      assert.match(error.message, /matched 2 elements/);
      return true;
    },
  );
});
