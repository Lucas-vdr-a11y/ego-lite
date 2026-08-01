import test from "node:test";
import assert from "node:assert/strict";

import { queryAllExpression } from "../../dist/src/locator-query.js";
import { setOverrides } from "../../dist/src/state.js";
import { browserRefMap } from "../../dist/src/ref-state.js";
import {
  allInnerTexts,
  allTextContents,
  blur,
  boundingBox,
  count,
  evaluateAll,
  evaluateLocator,
  getAttribute,
  innerHTML,
  innerText,
  isDisabled,
  inputValue,
  isChecked,
  isEditable,
  isEnabled,
  isHidden,
  isVisible,
  textContent,
} from "../../dist/src/driver/locator.js";

function internalSelector(kind, data) {
  return `internal:${kind}:${encodeURIComponent(JSON.stringify(data))}`;
}

function roleFixtureElement({
  id,
  parentElement = null,
  display = "block",
  visibility = "visible",
}) {
  return {
    id,
    tagName: "BUTTON",
    hidden: false,
    innerText: id,
    textContent: id,
    parentElement,
    computedStyle: { display, visibility },
    getAttribute(name) {
      return name === "type" ? "button" : null;
    },
    hasAttribute() {
      return false;
    },
    closest() {
      return null;
    },
  };
}

function evaluateRoleQuery(options, elements) {
  const expression = queryAllExpression(internalSelector("role", options));
  const document = {
    querySelectorAll() {
      return elements;
    },
    getElementById() {
      return null;
    },
  };
  class HTMLImageElement {}
  class HTMLInputElement {}
  class HTMLOptionElement {}
  return Function(
    "document",
    "getComputedStyle",
    "HTMLImageElement",
    "HTMLInputElement",
    "HTMLOptionElement",
    `return ${expression};`,
  )(
    document,
    (element) => element.computedStyle,
    HTMLImageElement,
    HTMLInputElement,
    HTMLOptionElement,
  );
}

test("locator read helpers call a resolved element", async () => {
  const calls = [];
  const values = [
    "text content",
    "inner text",
    "input value",
    { checked: true, type: "checkbox" },
    "button",
  ];
  const restore = setOverrides({
    cdpOverride(method, params, sessionId) {
      calls.push({ method, params, sessionId });
      if (method === "Runtime.evaluate") {
        return { result: { objectId: "node-1" } };
      }
      if (method === "Runtime.callFunctionOn") {
        return { result: { value: values.shift() } };
      }
      return {};
    },
  });
  try {
    assert.equal(await textContent("#message"), "text content");
    assert.equal(await innerText("#message"), "inner text");
    assert.equal(await inputValue("#email"), "input value");
    assert.equal(await isChecked("#terms"), true);
    assert.equal(await getAttribute("#submit", "type"), "button");
  } finally {
    restore();
  }

  assert.equal(
    calls.filter((call) => call.method === "Runtime.callFunctionOn").length,
    5,
  );
  assert.equal(
    calls.filter((call) => call.method === "Runtime.releaseObject").length,
    5,
  );
});

test("required locator reads retry transient zero matches", async () => {
  let attempts = 0;
  let now = 0;
  const sleeps = [];
  const restore = setOverrides({
    defaultTimeout: 500,
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
    cdpOverride(method) {
      if (method === "Runtime.evaluate") {
        attempts += 1;
        return attempts < 3
          ? { result: {} }
          : { result: { objectId: "node-delayed" } };
      }
      if (method === "Runtime.callFunctionOn") {
        return { result: { value: "delayed content" } };
      }
      return {};
    },
  });
  try {
    assert.equal(await textContent("#delayed-content"), "delayed content");
  } finally {
    restore();
  }

  assert.equal(attempts, 3);
  assert.deepEqual(sleeps, [100, 100]);
});

test("locator collection helpers evaluate all matching nodes", async () => {
  const restore = setOverrides({
    cdpOverride(method, params) {
      assert.equal(method, "Runtime.evaluate");
      if (params.expression.includes("elements.length")) {
        assert.match(params.expression, /querySelectorAll\("\.item"\)/);
        return { result: { value: 2 } };
      }
      if (params.expression.includes("innerText")) {
        return { result: { value: ["One", "Two"] } };
      }
      return { result: { value: ["A", "B"] } };
    },
  });
  try {
    assert.equal(await count(".item"), 2);
    assert.deepEqual(await allInnerTexts(".item"), ["One", "Two"]);
    assert.deepEqual(await allTextContents("loc=css:.item"), ["A", "B"]);
  } finally {
    restore();
  }
});

test("frame-scoped collection helpers evaluate in the child execution context", async () => {
  const calls = [];
  const target = {
    selector: ".item",
    frameChain: ["iframe#catalog"],
  };
  const restore = setOverrides({
    sessionId: "main-session",
    sessionTargetId: "tab-1",
    sessionAt: Date.now(),
    cdpOverride(method, params, sessionId) {
      calls.push({ method, params, sessionId });
      if (method === "Runtime.evaluate" && params.contextId === 101) {
        if (params.expression === "void 0") {
          return { result: {} };
        }
        assert.match(params.expression, /querySelectorAll\("\.item"\)/);
        if (params.expression.includes("elements.length")) {
          return { result: { value: 3 } };
        }
        return { result: { objectId: "frame-elements" } };
      }
      if (method === "Runtime.evaluate") {
        assert.match(params.expression, /iframe#catalog/);
        return { result: { objectId: "frame-owner" } };
      }
      if (
        method === "Runtime.callFunctionOn" &&
        params.objectId === "frame-owner"
      ) {
        return {
          result: {
            value: { x: 10, y: 20, width: 300, height: 200 },
          },
        };
      }
      if (
        method === "Runtime.callFunctionOn" &&
        params.objectId === "frame-elements"
      ) {
        return { result: { value: ["One", "Two", "Three"] } };
      }
      if (method === "DOM.describeNode") {
        return { node: { frameId: "frame-1" } };
      }
      if (method === "Page.createIsolatedWorld") {
        return { executionContextId: 101 };
      }
      if (method === "Runtime.releaseObject") return {};
      throw new Error(`Unexpected CDP method: ${method}`);
    },
  });
  try {
    assert.equal(await count(target), 3);
    assert.deepEqual(
      await evaluateAll(target, (elements) =>
        elements.map((element) => element.textContent),
      ),
      ["One", "Two", "Three"],
    );
  } finally {
    restore();
  }

  const childEvaluations = calls.filter(
    (call) =>
      call.method === "Runtime.evaluate" &&
      call.params.contextId === 101 &&
      call.params.expression !== "void 0",
  );
  assert.equal(childEvaluations.length, 2);
  assert.ok(
    childEvaluations.every((call) => call.sessionId === "main-session"),
  );
});

test("text, label, attribute, and test-id locators evaluate regular expressions", () => {
  const cases = [
    ["text", "ready\\s+now", "i"],
    ["label", "email|user", "i"],
    ["placeholder", "^search", ""],
    ["alt", "controller$", "i"],
    ["title", "details", "i"],
    ["testid", "^product-\\d+$", ""],
  ];

  for (const [prefix, source, flags] of cases) {
    const encoded = encodeURIComponent(JSON.stringify({ source, flags }));
    const expression = queryAllExpression(`loc=${prefix}:regex:${encoded}`);
    assert.ok(
      expression.includes(
        `new RegExp(${JSON.stringify(source)}, ${JSON.stringify(flags)})`,
      ),
      `${prefix} must preserve the regular expression`,
    );
  }
});

test("locator auto-detects Playwright-style implicit XPath selectors", () => {
  for (const selector of ["//button", "..", "(//button)[1]"]) {
    const expression = queryAllExpression(selector, "root");
    assert.match(expression, /document\.evaluate/);
    assert.match(
      expression,
      new RegExp(
        JSON.stringify(selector).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      ),
    );
    assert.doesNotMatch(expression, /querySelectorAll/);
  }
});

test("scoped XPath selectors stay relative to the locator root", () => {
  let evaluatedSelector;
  let evaluatedRoot;
  const root = { nodeType: 1 };
  const document = {
    evaluate(selector, context) {
      evaluatedSelector = selector;
      evaluatedRoot = context;
      return { snapshotLength: 0 };
    },
  };
  const XPathResult = { ORDERED_NODE_SNAPSHOT_TYPE: 7 };
  const expression = queryAllExpression("//button", "root");

  Function(
    "document",
    "root",
    "XPathResult",
    `return ${expression};`,
  )(document, root, XPathResult);

  assert.equal(evaluatedSelector, ".//button");
  assert.equal(evaluatedRoot, root);
});

test("test id locators query data-testid attributes exactly", async () => {
  const restore = setOverrides({
    cdpOverride(method, params) {
      assert.equal(method, "Runtime.evaluate");
      assert.match(params.expression, /\[data-testid\]/);
      assert.match(params.expression, /getAttribute\("data-testid"\)/);
      assert.match(params.expression, /=== "submit"/);
      return { result: { value: 1 } };
    },
  });
  try {
    assert.equal(await count('loc=testid:exact:"submit"'), 1);
  } finally {
    restore();
  }
});

test("scoped locators query descendants of each base element", async () => {
  const scoped = internalSelector("scope", {
    base: ".card",
    child: 'loc=testid:exact:"submit"',
  });
  const restore = setOverrides({
    cdpOverride(method, params) {
      assert.equal(method, "Runtime.evaluate");
      assert.match(params.expression, /querySelectorAll\("\.card"\)/);
      assert.match(params.expression, /\[data-testid\]/);
      assert.match(params.expression, /for \(const root of roots\)/);
      return { result: { value: 2 } };
    },
  });
  try {
    assert.equal(await count(scoped), 2);
  } finally {
    restore();
  }
});

test("filter locators support hasText, hasNotText, has, and hasNot", async () => {
  const scoped = internalSelector("filter", {
    base: ".row",
    hasText: { text: "Ready", exact: false },
    hasNotText: { regex: "Archived", flags: "i" },
    has: 'loc=testid:exact:"action"',
    hasNot: ".disabled",
  });
  const restore = setOverrides({
    cdpOverride(method, params) {
      assert.equal(method, "Runtime.evaluate");
      assert.match(params.expression, /querySelectorAll\("\.row"\)/);
      assert.match(params.expression, /includes\("Ready"\)/);
      assert.match(params.expression, /new RegExp\("Archived", "i"\)/);
      assert.match(params.expression, /\[data-testid\]/);
      assert.match(params.expression, /querySelectorAll\("\.disabled"\)/);
      return { result: { value: 1 } };
    },
  });
  try {
    assert.equal(await count(scoped), 1);
  } finally {
    restore();
  }
});

test("and/or locators build intersection and ordered union queries", async () => {
  const selectors = [
    internalSelector("and", { left: ".item", right: ".enabled" }),
    internalSelector("or", { left: ".primary", right: ".fallback" }),
  ];
  const expressions = [];
  const restore = setOverrides({
    cdpOverride(method, params) {
      assert.equal(method, "Runtime.evaluate");
      expressions.push(params.expression);
      return { result: { value: 1 } };
    },
  });
  try {
    assert.equal(await count(selectors[0]), 1);
    assert.equal(await count(selectors[1]), 1);
  } finally {
    restore();
  }
  assert.match(expressions[0], /new Set/);
  assert.match(
    expressions[0],
    /\.filter\(\(element\) => right\.has\(element\)\)/,
  );
  assert.match(expressions[1], /Array\.from\(new Set/);
});

test("role state locators filter Playwright role options in the page", async () => {
  const selector = internalSelector("role", {
    role: "checkbox",
    name: { text: "Updates", exact: true },
    checked: true,
    disabled: false,
    includeHidden: true,
  });
  let expression;
  const restore = setOverrides({
    cdpOverride(method, params) {
      assert.equal(method, "Runtime.evaluate");
      expression = params.expression;
      return { result: { value: 1 } };
    },
  });
  try {
    assert.equal(await count(selector), 1);
  } finally {
    restore();
  }
  assert.match(expression, /aria-checked/);
  assert.match(expression, /aria-disabled/);
  assert.match(expression, /accessibleName\(el\)/);
  assert.match(expression, /if \(!true\)/);
});

test("role locators resolve a fieldset as a group named by its legend", () => {
  const legend = {
    tagName: "LEGEND",
    innerText: "Gender",
    textContent: "Gender",
  };
  const fieldset = {
    tagName: "FIELDSET",
    hidden: false,
    innerText: "Gender\nFemale\nMale\nDecline to self-identify",
    textContent: "Gender Female Male Decline to self-identify",
    children: [legend],
    parentElement: null,
    computedStyle: { display: "block", visibility: "visible" },
    getAttribute() {
      return null;
    },
    hasAttribute() {
      return false;
    },
    closest() {
      return null;
    },
  };
  const options = {
    role: "group",
    name: { text: "Gender", exact: true },
  };

  assert.deepEqual(evaluateRoleQuery(options, [fieldset]), [fieldset]);
  assert.match(
    queryAllExpression(internalSelector("role", options)),
    /querySelectorAll\([^)]*fieldset/,
  );
});

test("role locators exclude descendants of display-none ancestors unless includeHidden is true", () => {
  const visible = roleFixtureElement({ id: "visible" });
  const hiddenParent = roleFixtureElement({
    id: "hidden-parent",
    display: "none",
  });
  const hiddenDescendant = roleFixtureElement({
    id: "hidden-descendant",
    parentElement: hiddenParent,
  });

  assert.deepEqual(
    evaluateRoleQuery({ role: "button" }, [visible, hiddenDescendant]).map(
      (element) => element.id,
    ),
    ["visible"],
  );
  assert.deepEqual(
    evaluateRoleQuery({ role: "button", includeHidden: true }, [
      visible,
      hiddenDescendant,
    ]).map((element) => element.id),
    ["visible", "hidden-descendant"],
  );
});

test("role locators honor a descendant visibility override", () => {
  const hiddenParent = roleFixtureElement({
    id: "hidden-parent",
    visibility: "hidden",
  });
  const inheritedHidden = roleFixtureElement({
    id: "inherited-hidden",
    parentElement: hiddenParent,
    visibility: "hidden",
  });
  const visibleOverride = roleFixtureElement({
    id: "visible-override",
    parentElement: hiddenParent,
    visibility: "visible",
  });

  assert.deepEqual(
    evaluateRoleQuery({ role: "button" }, [
      inheritedHidden,
      visibleOverride,
    ]).map((element) => element.id),
    ["visible-override"],
  );
});

test("role locators do not treat zero-size elements as ARIA-hidden", async () => {
  const selector = internalSelector("role", {
    role: "option",
    selected: false,
  });
  let expression;
  const restore = setOverrides({
    cdpOverride(method, params) {
      assert.equal(method, "Runtime.evaluate");
      expression = params.expression;
      return { result: { value: 1 } };
    },
  });
  try {
    assert.equal(await count(selector), 1);
  } finally {
    restore();
  }
  assert.match(expression, /aria-hidden/);
  assert.doesNotMatch(expression, /getBoundingClientRect/);
});

test("role locators use AX regex accessible names in collection queries", async () => {
  const selector = `loc=role:button[name=${JSON.stringify({
    regex: "checkout",
    flags: "i",
  })}]`;
  const calls = [];
  const restore = setOverrides({
    cdpOverride(method, params) {
      calls.push({ method, params });
      if (method === "Accessibility.getFullAXTree") {
        return {
          nodes: [
            {
              role: { value: "button" },
              name: { value: "Proceed to Checkout" },
              backendDOMNodeId: 101,
            },
          ],
        };
      }
      throw new Error(`Unexpected CDP method: ${method}`);
    },
  });
  try {
    assert.equal(await count(selector), 1);
  } finally {
    restore();
  }
  assert.deepEqual(
    calls.map((call) => call.method),
    ["Accessibility.getFullAXTree"],
  );
});

test("role collections use the same AX match set as nth element operations", async () => {
  const selector = 'loc=role:option[name="House"]';
  const second = `internal:nth=1;${selector}`;
  const calls = [];
  const restore = setOverrides({
    cdpOverride(method, params) {
      calls.push({ method, params });
      if (method === "Accessibility.getFullAXTree") {
        return {
          nodes: [
            {
              role: { value: "option" },
              name: { value: "House" },
              backendDOMNodeId: 100,
            },
            {
              role: { value: "option" },
              name: { value: "House" },
              backendDOMNodeId: 200,
            },
          ],
        };
      }
      if (method === "DOM.resolveNode") {
        return { object: { objectId: `node-${params.backendNodeId}` } };
      }
      if (method === "Runtime.callFunctionOn") {
        if (params.functionDeclaration.includes("innerText target")) {
          assert.equal(params.objectId, "node-200");
          return { result: { value: "House 2" } };
        }
        if (params.functionDeclaration.includes("return [this, ...elements]")) {
          return { result: { objectId: "role-elements" } };
        }
        if (params.objectId === "role-elements") {
          return { result: { value: ["HOUSE 1", "HOUSE 2"] } };
        }
        assert.deepEqual(
          [
            params.objectId,
            ...params.arguments
              .filter((argument) => argument.objectId)
              .map((argument) => argument.objectId),
          ],
          ["node-100", "node-200"],
        );
        const functionSource = params.arguments.find(
          (argument) =>
            typeof argument.value === "string" &&
            argument.value.includes("elements"),
        )?.value;
        if (functionSource?.includes("allInnerTexts targets")) {
          return { result: { value: ["House 1", "House 2"] } };
        }
        return { result: { value: ["HOUSE 1", "HOUSE 2"] } };
      }
      if (method === "Runtime.releaseObject") {
        return {};
      }
      throw new Error(`Unexpected CDP method: ${method}`);
    },
  });
  try {
    assert.equal(await count(selector), 2);
    assert.equal(await count(second), 1);
    assert.equal(await innerText(second), "House 2");
    assert.deepEqual(await allInnerTexts(selector), ["House 1", "House 2"]);
    assert.deepEqual(
      await evaluateAll(selector, (elements) =>
        elements.map((element) => element.textContent.toUpperCase()),
      ),
      ["HOUSE 1", "HOUSE 2"],
    );
  } finally {
    restore();
  }
  assert.equal(
    calls.some((call) => call.method === "Runtime.evaluate"),
    false,
  );
});

test("raw Playwright has-text selectors filter native CSS candidates", async () => {
  const restore = setOverrides({
    cdpOverride(method, params) {
      assert.equal(method, "Runtime.evaluate");
      assert.match(params.expression, /querySelectorAll\("button"\)/);
      assert.match(params.expression, /includes\("Skip to Checkout"\)/);
      return { result: { value: 1 } };
    },
  });
  try {
    assert.equal(await count('button:has-text("Skip to Checkout")'), 1);
  } finally {
    restore();
  }
});

test("locator state helpers read element state and tolerate missing elements", async () => {
  const values = [true, true, true];
  const restore = setOverrides({
    cdpOverride(method, params) {
      if (method === "Runtime.evaluate") {
        return { result: { objectId: "node-1" } };
      }
      if (method === "Runtime.callFunctionOn") {
        return { result: { value: values.shift() } };
      }
      return {};
    },
  });
  try {
    assert.equal(await isVisible("#status"), true);
    assert.equal(await isEnabled("#status"), true);
    assert.equal(await isEditable("#status"), true);
  } finally {
    restore();
  }

  const missingRestore = setOverrides({
    cdpOverride(method) {
      if (method === "Runtime.evaluate") {
        return { result: {} };
      }
      return {};
    },
  });
  try {
    assert.equal(await isVisible("#missing"), false);
    assert.equal(await isHidden("#missing"), true);
    assert.equal(await isEnabled("#missing"), false);
    assert.equal(await isDisabled("#missing"), true);
    assert.equal(await isEditable("#missing"), false);
  } finally {
    missingRestore();
  }
});

test("innerHTML, blur, and boundingBox use the resolved element", async () => {
  const values = [
    "<span>Ready</span>",
    undefined,
    { x: 1, y: 2, width: 3, height: 4 },
  ];
  const restore = setOverrides({
    cdpOverride(method, params) {
      if (method === "Runtime.evaluate") {
        return { result: { objectId: "node-1" } };
      }
      if (method === "Runtime.callFunctionOn") {
        return { result: { value: values.shift() } };
      }
      return {};
    },
  });
  try {
    assert.equal(await innerHTML("#status"), "<span>Ready</span>");
    await blur("#status");
    assert.deepEqual(await boundingBox("#status"), {
      x: 1,
      y: 2,
      width: 3,
      height: 4,
    });
  } finally {
    restore();
  }
});

test("frame-scoped boundingBox returns top-level viewport coordinates", async () => {
  const restore = setOverrides({
    sessionId: "main-session",
    sessionTargetId: "tab-1",
    sessionAt: Date.now(),
    cdpOverride(method, params) {
      if (method === "Runtime.evaluate") {
        return {
          result: {
            objectId:
              params.contextId === 101 ? "inside-object" : "frame-owner",
          },
        };
      }
      if (
        method === "Runtime.callFunctionOn" &&
        params.objectId === "frame-owner"
      ) {
        return {
          result: {
            value: { x: 100, y: 50, width: 400, height: 300 },
          },
        };
      }
      if (method === "DOM.describeNode") {
        return { node: { frameId: "frame-1" } };
      }
      if (method === "Page.createIsolatedWorld") {
        return { executionContextId: 101 };
      }
      if (
        method === "Runtime.callFunctionOn" &&
        params.objectId === "inside-object"
      ) {
        return {
          result: {
            value: { x: 20, y: 30, width: 80, height: 40 },
          },
        };
      }
      if (method === "Runtime.releaseObject") return {};
      throw new Error(`Unexpected CDP method: ${method}`);
    },
  });
  try {
    assert.deepEqual(
      await boundingBox({
        selector: "#inside",
        frameChain: ["iframe#catalog"],
      }),
      { x: 120, y: 80, width: 80, height: 40 },
    );
  } finally {
    restore();
  }
});

test("frame-scoped visibility APIs honor a hidden frame owner", async () => {
  const restore = setOverrides({
    sessionId: "main-session",
    sessionTargetId: "tab-1",
    sessionAt: Date.now(),
    cdpOverride(method, params) {
      if (method === "Runtime.evaluate") {
        return {
          result: {
            objectId:
              params.contextId === 101 ? "inside-object" : "frame-owner",
          },
        };
      }
      if (
        method === "Runtime.callFunctionOn" &&
        params.objectId === "frame-owner"
      ) {
        return {
          result: {
            value: {
              x: 0,
              y: 0,
              width: 0,
              height: 0,
              visible: false,
              receivesEvents: false,
              scaleX: 1,
              scaleY: 1,
            },
          },
        };
      }
      if (method === "DOM.describeNode") {
        return { node: { frameId: "hidden-frame" } };
      }
      if (method === "Page.createIsolatedWorld") {
        return { executionContextId: 101 };
      }
      if (
        method === "Runtime.callFunctionOn" &&
        params.objectId === "inside-object"
      ) {
        return {
          result: {
            value: params.functionDeclaration.includes("getBoundingClientRect")
              ? { x: 20, y: 30, width: 80, height: 40 }
              : true,
          },
        };
      }
      if (method === "Runtime.releaseObject") return {};
      throw new Error(`Unexpected CDP method: ${method}`);
    },
  });
  try {
    assert.equal(
      await isVisible({
        selector: "#inside",
        frameChain: ["iframe#hidden"],
      }),
      false,
    );
    assert.equal(
      await boundingBox({
        selector: "#inside",
        frameChain: ["iframe#hidden"],
      }),
      null,
    );
  } finally {
    restore();
  }
});

test("boundingBox preserves locator auto-waiting", async () => {
  let attempts = 0;
  let now = 0;
  const restore = setOverrides({
    defaultTimeout: 500,
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    cdpOverride(method) {
      if (method === "Runtime.evaluate") {
        attempts += 1;
        return attempts === 1
          ? { result: {} }
          : { result: { objectId: "node-delayed" } };
      }
      if (method === "Runtime.callFunctionOn") {
        return {
          result: {
            value: { x: 1, y: 2, width: 3, height: 4 },
          },
        };
      }
      if (method === "Runtime.releaseObject") return {};
      throw new Error(`Unexpected CDP method: ${method}`);
    },
  });
  try {
    assert.deepEqual(await boundingBox("#delayed"), {
      x: 1,
      y: 2,
      width: 3,
      height: 4,
    });
  } finally {
    restore();
  }
  assert.equal(attempts, 2);
});

test("evaluateAll runs a page function with matching elements and an argument", async () => {
  const calls = [];
  const restore = setOverrides({
    cdpOverride(method, params) {
      calls.push({ method, params });
      if (method === "Runtime.evaluate") {
        assert.equal(params.returnByValue, false);
        assert.match(params.expression, /querySelectorAll\("\.item"\)/);
        return { result: { objectId: "item-elements" } };
      }
      if (method === "Runtime.callFunctionOn") {
        assert.equal(params.objectId, "item-elements");
        assert.equal(params.awaitPromise, true);
        assert.match(params.arguments[2].value, /elements\.map/);
        assert.deepEqual(params.arguments[3].value, {
          o: [{ k: "prefix", v: "#" }],
          id: 1,
        });
        return { result: { value: ["#One", "#Two"] } };
      }
      if (method === "Runtime.releaseObject") return {};
      throw new Error(`Unexpected CDP method: ${method}`);
    },
  });
  try {
    const values = await evaluateAll(
      ".item",
      (elements, options) =>
        elements.map((element) => options.prefix + element.textContent),
      { prefix: "#" },
    );
    assert.deepEqual(values, ["#One", "#Two"]);
  } finally {
    restore();
  }
  assert.deepEqual(
    calls.map(({ method }) => method),
    ["Runtime.evaluate", "Runtime.callFunctionOn", "Runtime.releaseObject"],
  );
});

test("evaluateLocator runs a page function with one resolved element and an argument", async () => {
  const calls = [];
  const restore = setOverrides({
    cdpOverride(method, params) {
      calls.push({ method, params });
      if (method === "Runtime.evaluate") {
        return { result: { objectId: "node-1" } };
      }
      if (method === "Runtime.callFunctionOn") {
        assert.match(params.functionDeclaration, /result\(this, argument\)/);
        assert.equal(
          params.arguments[2].value,
          "(element, options) => options.prefix + element.textContent",
        );
        assert.deepEqual(params.arguments[3].value, {
          o: [{ k: "prefix", v: "#" }],
          id: 1,
        });
        return { result: { value: "#One" } };
      }
      return {};
    },
  });
  try {
    const value = await evaluateLocator(
      ".item",
      (element, options) => options.prefix + element.textContent,
      { prefix: "#" },
    );
    assert.equal(value, "#One");
  } finally {
    restore();
  }
  assert.equal(calls[0].method, "Runtime.evaluate");
  assert.equal(calls.at(-1).method, "Runtime.releaseObject");
});

test("evaluateAll supports refs as a single-element array", async () => {
  const calls = [];
  browserRefMap.clear();
  browserRefMap.add("1", 123, "button", "Submit");
  const restore = setOverrides({
    cdpOverride(method, params) {
      calls.push({ method, params });
      if (method === "DOM.resolveNode") {
        return { object: { objectId: "node-1" } };
      }
      if (method === "Runtime.callFunctionOn") {
        if (params.functionDeclaration.includes("this.isConnected")) {
          return { result: { value: true } };
        }
        assert.match(
          params.functionDeclaration,
          /result\(\[this\], argument\)/,
        );
        assert.equal(params.arguments[2].value, "elements => elements.length");
        assert.deepEqual(params.arguments[3].value, { v: "undefined" });
        return { result: { value: 1 } };
      }
      return {};
    },
  });
  try {
    assert.equal(await evaluateAll("@1", "elements => elements.length"), 1);
  } finally {
    browserRefMap.clear();
    restore();
  }
  assert.equal(calls[0].method, "DOM.resolveNode");
  assert.equal(calls.at(-1).method, "Runtime.releaseObject");
});

test("count treats a resolved ref as one element", async () => {
  const calls = [];
  browserRefMap.clear();
  browserRefMap.add("1", 123, "button", "Submit");
  const restore = setOverrides({
    cdpOverride(method, params) {
      calls.push({ method, params });
      if (method === "DOM.resolveNode") {
        return { object: { objectId: "node-1" } };
      }
      return {};
    },
  });
  try {
    assert.equal(await count("@1"), 1);
  } finally {
    browserRefMap.clear();
    restore();
  }
  assert.equal(calls[0].method, "DOM.resolveNode");
  assert.equal(calls.at(-1).method, "Runtime.releaseObject");
});
