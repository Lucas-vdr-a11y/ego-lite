import test from "node:test";
import assert from "node:assert/strict";

import { helperContext } from "../../dist/src/helpers.js";
import { TimeoutError } from "../../dist/src/playwright-errors.js";
import { setOverrides } from "../../dist/src/state.js";
import {
  createTargetContext,
  runWithTarget,
} from "../../dist/src/target-context.js";

function axNode(
  nodeId,
  role,
  {
    parentId,
    childIds = [],
    backendDOMNodeId,
    name,
    value,
    ignored = false,
    properties = {},
  } = {},
) {
  return {
    nodeId,
    ...(parentId === undefined ? {} : { parentId }),
    childIds,
    ...(backendDOMNodeId === undefined ? {} : { backendDOMNodeId }),
    ignored,
    role: { value: role },
    ...(name === undefined ? {} : { name: { value: name } }),
    ...(value === undefined ? {} : { value: { value } }),
    properties: Object.entries(properties).map(
      ([propertyName, propertyValue]) => ({
        name: propertyName,
        value: { value: propertyValue },
      }),
    ),
  };
}

function domSnapshot(entries = [], options = {}) {
  const strings = [];
  const stringIndexes = new Map();
  const stringIndex = (value) => {
    const text = String(value);
    if (!stringIndexes.has(text)) {
      stringIndexes.set(text, strings.length);
      strings.push(text);
    }
    return stringIndexes.get(text);
  };
  const backendNodeId = [];
  const attributes = [];
  const nodeName = [];
  const parentIndex = [];
  const layoutNodeIndex = [];
  const bounds = [];
  const nodeIndexByBackendId = new Map();

  for (const entry of entries) {
    const nodeIndex = backendNodeId.length;
    backendNodeId.push(entry.backendDOMNodeId);
    nodeIndexByBackendId.set(entry.backendDOMNodeId, nodeIndex);
    nodeName.push(stringIndex(entry.nodeName || "DIV"));
    parentIndex.push(
      entry.parentBackendDOMNodeId === undefined
        ? -1
        : (nodeIndexByBackendId.get(entry.parentBackendDOMNodeId) ?? -1),
    );
    attributes.push(
      Object.entries(entry.attributes || {}).flatMap(([name, value]) => [
        stringIndex(name),
        stringIndex(value),
      ]),
    );
    if (entry.box) {
      layoutNodeIndex.push(nodeIndex);
      bounds.push(entry.box);
    }
  }

  return {
    strings,
    documents: [
      {
        frameId: stringIndex(options.frameId || "frame-main"),
        scrollOffsetX: options.scrollX || 0,
        scrollOffsetY: options.scrollY || 0,
        nodes: {
          backendNodeId,
          nodeName,
          parentIndex,
          attributes,
        },
        layout: {
          nodeIndex: layoutNodeIndex,
          bounds,
        },
      },
    ],
  };
}

async function withAriaScenario(options, fn) {
  const calls = [];
  let now = 0;
  let resolveAttempts = 0;
  let fullTreeAttempts = 0;
  const restore = setOverrides({
    sessionId: "main-session",
    sessionTargetId: "tab-main",
    sessionAt: Date.now(),
    defaultTimeout: options.defaultTimeout ?? 30_000,
    now: () => now,
    sleep: async (ms) => {
      now += ms;
      options.onSleep?.();
    },
    async cdpOverride(method, params, sessionId, timeoutMs) {
      calls.push({ method, params, sessionId, timeoutMs });
      if (method === "Runtime.evaluate") {
        if (
          options.rejectAriaRefCss &&
          String(params.expression || "").includes("aria-ref=")
        ) {
          return {
            exceptionDetails: {
              text: "SyntaxError",
              exception: { description: "Invalid CSS selector aria-ref" },
            },
          };
        }
        resolveAttempts += 1;
        if (resolveAttempts <= (options.missingResolveAttempts || 0)) {
          return { result: {} };
        }
        return { result: { objectId: options.objectId || "snapshot-root" } };
      }
      if (method === "Accessibility.getPartialAXTree") {
        if (options.partialElapsed) now += options.partialElapsed;
        if (options.partialError) throw options.partialError;
        options.onPartial?.();
        if (options.partialPending) return new Promise(() => {});
        if (options.partialNodes) return { nodes: options.partialNodes };
        return {
          nodes: [
            axNode(options.rootId || "root", options.rootRole || "generic", {
              backendDOMNodeId: options.partialBackendDOMNodeId,
            }),
          ],
        };
      }
      if (method === "Accessibility.getFullAXTree") {
        fullTreeAttempts += 1;
        if (fullTreeAttempts <= (options.missingTreeAttempts || 0)) {
          return { nodes: options.missingTree || [] };
        }
        return { nodes: options.nodes || [] };
      }
      if (method === "DOMSnapshot.captureSnapshot") {
        if (options.captureError) throw options.captureError;
        return options.dom || domSnapshot();
      }
      if (method === "Page.getLayoutMetrics") {
        return (
          options.metrics || {
            layoutViewport: { clientWidth: 100, clientHeight: 100 },
            cssLayoutViewport: { clientWidth: 100, clientHeight: 100 },
          }
        );
      }
      if (method === "DOM.resolveNode") {
        if (options.resolveNodeError) throw options.resolveNodeError;
        return {
          object: { objectId: `aria-ref-node-${params.backendNodeId}` },
        };
      }
      if (method === "Runtime.callFunctionOn") {
        if (String(params.functionDeclaration).includes("isConnected")) {
          return { result: { value: true } };
        }
        if (String(params.functionDeclaration).includes("getAttribute")) {
          return { result: { value: options.attributeValue ?? null } };
        }
        if (String(params.functionDeclaration).includes("innerText")) {
          return { result: { value: ["Target"] } };
        }
      }
      if (method === "Runtime.releaseObject") return {};
      throw new Error(`Unexpected CDP method: ${method}`);
    },
  });
  try {
    return await fn({
      calls,
      get now() {
        return now;
      },
    });
  } finally {
    restore();
  }
}

test("page and locator expose Playwright-style ariaSnapshot methods", () => {
  const page = helperContext().page;

  assert.equal(typeof page.ariaSnapshot, "function");
  assert.equal(typeof page.locator("#target").ariaSnapshot, "function");
  assert.equal(
    typeof page.frameLocator("#frame").locator("body").ariaSnapshot,
    "function",
  );
});

test("locator.ariaSnapshot renders roles, names, states, values, and DOM properties", async () => {
  const nodes = [
    axNode("list", "list", {
      childIds: ["item", "button", "link", "textbox", "checkbox"],
      backendDOMNodeId: 101,
      name: "Catalog",
    }),
    axNode("item", "listitem", {
      parentId: "list",
      childIds: ["item-text"],
      backendDOMNodeId: 102,
      properties: { level: 1 },
    }),
    axNode("item-text", "StaticText", {
      parentId: "item",
      name: "First",
      backendDOMNodeId: 103,
    }),
    axNode("button", "button", {
      parentId: "list",
      childIds: ["button-text"],
      backendDOMNodeId: 104,
      name: "Checkout",
      properties: { disabled: true, invalid: "false", pressed: "true" },
    }),
    axNode("button-text", "StaticText", {
      parentId: "button",
      backendDOMNodeId: 105,
      name: "Checkout",
    }),
    axNode("link", "link", {
      parentId: "list",
      childIds: ["link-text"],
      backendDOMNodeId: 106,
      name: "Details",
    }),
    axNode("link-text", "StaticText", {
      parentId: "link",
      backendDOMNodeId: 107,
      name: "Details",
    }),
    axNode("textbox", "textbox", {
      parentId: "list",
      backendDOMNodeId: 108,
      name: "Email",
      value: "buyer@example.com",
      properties: { invalid: "true" },
    }),
    axNode("checkbox", "checkbox", {
      parentId: "list",
      backendDOMNodeId: 109,
      properties: { checked: "mixed" },
    }),
  ];
  const dom = domSnapshot([
    {
      backendDOMNodeId: 106,
      nodeName: "A",
      attributes: { href: "/details" },
    },
    {
      backendDOMNodeId: 108,
      nodeName: "INPUT",
      attributes: {
        "aria-label": "Email",
        placeholder: "name@example.com",
      },
    },
  ]);

  await withAriaScenario(
    { rootId: "list", rootRole: "list", nodes, dom },
    async () => {
      assert.equal(
        await helperContext().page.locator("#catalog").ariaSnapshot(),
        [
          '- list "Catalog":',
          "  - listitem: First",
          '  - button "Checkout" [disabled] [pressed]',
          '  - link "Details":',
          "    - /url: /details",
          '  - textbox "Email" [invalid]:',
          "    - /placeholder: name@example.com",
          "    - text: buyer@example.com",
          "  - checkbox [checked=mixed]",
        ].join("\n"),
      );
    },
  );
});

test("ariaSnapshot ref mode renders Playwright 1.52 generation-scoped refs", async () => {
  const nodes = [
    axNode("root", "button", {
      backendDOMNodeId: 1,
      name: "Target",
    }),
  ];

  await withAriaScenario(
    {
      rootId: "root",
      rootRole: "button",
      partialBackendDOMNodeId: 1,
      nodes,
      dom: domSnapshot([{ backendDOMNodeId: 1, nodeName: "BUTTON" }]),
    },
    async () => {
      const locator = helperContext().page.locator("#target");

      const first = await locator.ariaSnapshot({ ref: true });
      const firstGeneration = Number(/\[ref=s(\d+)e1\]/.exec(first)?.[1]);
      assert.equal(Number.isInteger(firstGeneration), true);
      assert.equal(first, `- button "Target" [ref=s${firstGeneration}e1]`);
      assert.equal(await locator.ariaSnapshot(), '- button "Target"');
      assert.equal(
        await locator.ariaSnapshot({ ref: true }),
        `- button "Target" [ref=s${firstGeneration + 2}e1]`,
      );
    },
  );
});

test("aria-ref locator resolves an element from the latest ARIA snapshot", async () => {
  const nodes = [
    axNode("root", "button", {
      backendDOMNodeId: 41,
      name: "Target",
    }),
  ];

  await withAriaScenario(
    {
      rootId: "root",
      rootRole: "button",
      partialBackendDOMNodeId: 41,
      nodes,
      dom: domSnapshot([{ backendDOMNodeId: 41, nodeName: "BUTTON" }]),
      attributeValue: "resolved",
      rejectAriaRefCss: true,
    },
    async ({ calls }) => {
      const page = helperContext().page;
      const yaml = await page.locator("#target").ariaSnapshot({ ref: true });
      const ref = /ref=(s\d+e\d+)/.exec(yaml)?.[1];
      assert.ok(ref);

      assert.equal(
        await page.locator(`aria-ref=${ref}`).getAttribute("data-id"),
        "resolved",
      );
      assert.equal(await page.locator(`aria-ref=${ref}`).count(), 1);
      assert.deepEqual(await page.locator(`aria-ref=${ref}`).allInnerTexts(), [
        "Target",
      ]);
      const [sameElement] = await page.locator(`aria-ref=${ref}`).all();
      assert.equal(await sameElement.getAttribute("data-id"), "resolved");
      assert.equal(
        calls.some(
          (call) =>
            call.method === "DOM.resolveNode" &&
            call.params.backendNodeId === 41,
        ),
        true,
      );
    },
  );
});

test("a later ariaSnapshot makes an earlier aria-ref stale", async () => {
  const nodes = [
    axNode("root", "button", {
      backendDOMNodeId: 51,
      name: "Target",
    }),
  ];

  await withAriaScenario(
    {
      rootId: "root",
      rootRole: "button",
      partialBackendDOMNodeId: 51,
      nodes,
      dom: domSnapshot([{ backendDOMNodeId: 51, nodeName: "BUTTON" }]),
      defaultTimeout: 200,
    },
    async () => {
      const page = helperContext().page;
      const first = await page.locator("#target").ariaSnapshot({ ref: true });
      const oldRef = /ref=(s\d+e\d+)/.exec(first)?.[1];
      assert.ok(oldRef);
      const second = await page.locator("#target").ariaSnapshot({ ref: true });
      const currentGeneration = /ref=s(\d+)e\d+/.exec(second)?.[1];

      await assert.rejects(
        () => page.locator(`aria-ref=${oldRef}`).getAttribute("data-id"),
        new RegExp(
          `Stale aria-ref, expected s${currentGeneration}e\\{number\\}, got ${oldRef}`,
        ),
      );
    },
  );
});

test("aria-ref generations stay isolated between target-bound Pages", async () => {
  const nodes = [
    axNode("root", "button", {
      backendDOMNodeId: 61,
      name: "Target",
    }),
  ];

  await withAriaScenario(
    {
      rootId: "root",
      rootRole: "button",
      partialBackendDOMNodeId: 61,
      nodes,
      dom: domSnapshot([{ backendDOMNodeId: 61, nodeName: "BUTTON" }]),
      attributeValue: "page-a",
    },
    async () => {
      const page = helperContext().page;
      const pageA = createTargetContext("page-a");
      const pageB = createTargetContext("page-b");

      assert.equal(
        await runWithTarget(pageA, () =>
          page.locator("#target").ariaSnapshot({ ref: true }),
        ),
        '- button "Target" [ref=s1e1]',
      );
      await runWithTarget(pageB, () =>
        page.locator("#target").ariaSnapshot({ ref: true }),
      );
      await runWithTarget(pageB, () => page.locator("#target").ariaSnapshot());

      assert.equal(
        await runWithTarget(pageA, () =>
          page.locator("aria-ref=s1e1").getAttribute("data-id"),
        ),
        "page-a",
      );
      await assert.rejects(
        () =>
          runWithTarget(pageB, () =>
            page.locator("aria-ref=s1e1").getAttribute("data-id"),
          ),
        /Stale aria-ref, expected s2e\{number\}, got s1e1/,
      );
    },
  );
});

test("aria-ref locator rejects malformed Playwright ref syntax", async () => {
  await withAriaScenario({ rejectAriaRefCss: true }, async () => {
    await assert.rejects(
      () => helperContext().page.locator("aria-ref=e1").getAttribute("data-id"),
      /Invalid aria-ref selector, should be of form s<number>e<number>/,
    );
  });
});

test("a detached aria-ref behaves like a missing locator", async () => {
  const nodes = [
    axNode("root", "button", {
      backendDOMNodeId: 71,
      name: "Target",
    }),
  ];

  await withAriaScenario(
    {
      rootId: "root",
      rootRole: "button",
      partialBackendDOMNodeId: 71,
      nodes,
      dom: domSnapshot([{ backendDOMNodeId: 71, nodeName: "BUTTON" }]),
      resolveNodeError: new Error("No node with given id found"),
    },
    async () => {
      const page = helperContext().page;
      const yaml = await page.locator("#target").ariaSnapshot({ ref: true });
      const ref = /ref=(s\d+e\d+)/.exec(yaml)?.[1];
      assert.ok(ref);

      assert.equal(await page.locator(`aria-ref=${ref}`).isVisible(), false);
      assert.equal(await page.locator(`aria-ref=${ref}`).count(), 0);
    },
  );
});

test("ariaSnapshot normalizes Chromium string booleans and deduplicates textbox values", async () => {
  const nodes = [
    axNode("root", "group", {
      childIds: ["textbox", "checkbox"],
      backendDOMNodeId: 1,
    }),
    axNode("textbox", "textbox", {
      parentId: "root",
      childIds: ["textbox-value"],
      backendDOMNodeId: 2,
      name: "Email",
      value: "buyer@example.com",
    }),
    axNode("textbox-value", "StaticText", {
      parentId: "textbox",
      backendDOMNodeId: 3,
      name: "buyer@example.com",
    }),
    axNode("checkbox", "checkbox", {
      parentId: "root",
      backendDOMNodeId: 4,
      name: "Gift wrap",
      properties: { checked: "true" },
    }),
  ];

  await withAriaScenario(
    { rootId: "root", rootRole: "group", nodes },
    async () => {
      assert.equal(
        await helperContext().page.locator("#form").ariaSnapshot(),
        [
          "- group:",
          '  - textbox "Email": buyer@example.com',
          '  - checkbox "Gift wrap" [checked]',
        ].join("\n"),
      );
    },
  );
});

test("page.ariaSnapshot snapshots body scope and flattens ignored and anonymous generic nodes", async () => {
  const nodes = [
    axNode("body", "none", {
      childIds: ["wrapper"],
      backendDOMNodeId: 1,
      ignored: true,
    }),
    axNode("wrapper", "generic", {
      parentId: "body",
      childIds: ["heading", "plain"],
      backendDOMNodeId: 2,
    }),
    axNode("heading", "heading", {
      parentId: "wrapper",
      childIds: ["heading-text"],
      backendDOMNodeId: 3,
      name: "Products",
      properties: { level: 2 },
    }),
    axNode("heading-text", "StaticText", {
      parentId: "heading",
      backendDOMNodeId: 4,
      name: "Products",
    }),
    axNode("plain", "StaticText", {
      parentId: "wrapper",
      backendDOMNodeId: 5,
      name: "Available now",
    }),
  ];

  await withAriaScenario({ rootId: "body", nodes }, async () => {
    assert.equal(
      await helperContext().page.ariaSnapshot(),
      ['- heading "Products" [level=2]', "- text: Available now"].join("\n"),
    );
  });
});

test("ariaSnapshot scopes through an ignored DOM root omitted from the full AX tree", async () => {
  const nodes = [
    axNode("button", "button", {
      backendDOMNodeId: 2,
      name: "Inside ignored wrapper",
    }),
  ];
  const dom = domSnapshot([
    { backendDOMNodeId: 1, nodeName: "DIV" },
    {
      backendDOMNodeId: 2,
      parentBackendDOMNodeId: 1,
      nodeName: "BUTTON",
    },
  ]);

  await withAriaScenario(
    {
      rootId: "ignored-root",
      rootRole: "none",
      partialBackendDOMNodeId: 1,
      nodes,
      dom,
    },
    async ({ calls }) => {
      assert.equal(
        await helperContext().page.locator("#wrapper").ariaSnapshot(),
        '- button "Inside ignored wrapper"',
      );
      assert.equal(
        calls.filter((call) => call.method === "Accessibility.getFullAXTree")
          .length,
        1,
      );
    },
  );
});

test("ariaSnapshot scopes through partial AX relatives when an ignored frame body is omitted", async () => {
  const partialNodes = [
    axNode("ignored-body", "none", {
      childIds: ["partial-heading"],
      backendDOMNodeId: 10,
      ignored: true,
    }),
    axNode("partial-heading", "heading", {
      parentId: "ignored-body",
      backendDOMNodeId: 11,
      name: "Frame heading",
      properties: { level: 1 },
    }),
  ];
  const nodes = [
    axNode("rebuilt-heading", "heading", {
      backendDOMNodeId: 11,
      name: "Frame heading",
      properties: { level: 1 },
    }),
  ];

  await withAriaScenario(
    {
      partialNodes,
      nodes,
      dom: domSnapshot(),
    },
    async ({ calls }) => {
      assert.equal(
        await helperContext().page.locator("body").ariaSnapshot(),
        '- heading "Frame heading" [level=1]',
      );
      assert.equal(
        calls.find((call) => call.method === "Accessibility.getPartialAXTree")
          ?.params.fetchRelatives,
        true,
      );
    },
  );
});

test("ariaSnapshot returns empty when a DOM root exists but has no accessible descendants", async () => {
  const dom = domSnapshot([
    { backendDOMNodeId: 7, nodeName: "DIV" },
    {
      backendDOMNodeId: 8,
      parentBackendDOMNodeId: 7,
      nodeName: "SPAN",
    },
  ]);

  await withAriaScenario(
    {
      partialNodes: [
        axNode("hidden-root", "none", {
          backendDOMNodeId: 7,
          ignored: true,
          properties: { hidden: true },
        }),
      ],
      nodes: [],
      dom,
    },
    async ({ calls }) => {
      assert.equal(
        await helperContext().page.locator("#hidden").ariaSnapshot(),
        "",
      );
      assert.equal(
        calls.filter((call) => call.method === "Accessibility.getFullAXTree")
          .length,
        1,
      );
    },
  );
});

test("ariaSnapshot excludes hidden subtrees and returns an empty string for an inaccessible root", async () => {
  const nodes = [
    axNode("hidden", "none", {
      backendDOMNodeId: 1,
      ignored: true,
      properties: { hidden: true },
    }),
  ];

  await withAriaScenario({ rootId: "hidden", nodes }, async () => {
    assert.equal(
      await helperContext().page.locator("#hidden").ariaSnapshot(),
      "",
    );
  });
});

test("ariaSnapshot merges adjacent text and quotes YAML-sensitive values", async () => {
  const nodes = [
    axNode("root", "none", {
      childIds: ["first", "second", "third"],
      backendDOMNodeId: 1,
      ignored: true,
    }),
    axNode("first", "StaticText", {
      parentId: "root",
      backendDOMNodeId: 2,
      name: "true",
    }),
    axNode("second", "StaticText", {
      parentId: "root",
      backendDOMNodeId: 3,
      name: "Save: now",
    }),
    axNode("third", "StaticText", {
      parentId: "root",
      backendDOMNodeId: 4,
      name: "123",
    }),
  ];

  await withAriaScenario({ nodes }, async () => {
    assert.equal(
      await helperContext().page.locator("#copy").ariaSnapshot(),
      '- text: "true Save: now 123"',
    );
  });
});

test("ariaSnapshot depth limits descendants without dropping the boundary node", async () => {
  const nodes = [
    axNode("outer", "list", {
      childIds: ["item"],
      backendDOMNodeId: 1,
    }),
    axNode("item", "listitem", {
      parentId: "outer",
      childIds: ["inner"],
      backendDOMNodeId: 2,
    }),
    axNode("inner", "list", {
      parentId: "item",
      childIds: ["inner-item"],
      backendDOMNodeId: 3,
    }),
    axNode("inner-item", "listitem", {
      parentId: "inner",
      childIds: ["text"],
      backendDOMNodeId: 4,
    }),
    axNode("text", "StaticText", {
      parentId: "inner-item",
      backendDOMNodeId: 5,
      name: "Nested",
    }),
  ];

  await withAriaScenario(
    { rootId: "outer", rootRole: "list", nodes },
    async () => {
      assert.equal(
        await helperContext().page.locator("#tree").ariaSnapshot({ depth: 1 }),
        ["- list:", "  - listitem"].join("\n"),
      );
    },
  );
});

test("ariaSnapshot depth zero is unlimited and preserves direct text at a positive boundary", async () => {
  const nodes = [
    axNode("root", "list", {
      childIds: ["direct", "nested"],
      backendDOMNodeId: 1,
    }),
    axNode("direct", "listitem", {
      parentId: "root",
      childIds: ["direct-text"],
      backendDOMNodeId: 2,
    }),
    axNode("direct-text", "StaticText", {
      parentId: "direct",
      backendDOMNodeId: 3,
      name: "Visible at boundary",
    }),
    axNode("nested", "listitem", {
      parentId: "root",
      childIds: ["button"],
      backendDOMNodeId: 4,
    }),
    axNode("button", "button", {
      parentId: "nested",
      backendDOMNodeId: 5,
      name: "Nested control",
    }),
  ];

  await withAriaScenario(
    { rootId: "root", rootRole: "list", nodes },
    async () => {
      assert.equal(
        await helperContext().page.locator("#tree").ariaSnapshot({ depth: 1 }),
        ["- list:", "  - listitem: Visible at boundary", "  - listitem"].join(
          "\n",
        ),
      );
      assert.equal(
        await helperContext().page.locator("#tree").ariaSnapshot({ depth: 0 }),
        [
          "- list:",
          "  - listitem: Visible at boundary",
          "  - listitem:",
          '    - button "Nested control"',
        ].join("\n"),
      );
    },
  );
});

test("ariaSnapshot renders supported true and mixed states while omitting false states", async () => {
  const nodes = [
    axNode("root", "group", {
      childIds: ["truthy", "falsey"],
      backendDOMNodeId: 1,
    }),
    axNode("truthy", "treeitem", {
      parentId: "root",
      backendDOMNodeId: 2,
      name: "Selected",
      properties: {
        checked: "mixed",
        expanded: true,
        invalid: "spelling",
        level: 3,
        pressed: "mixed",
        selected: true,
      },
    }),
    axNode("falsey", "checkbox", {
      parentId: "root",
      backendDOMNodeId: 3,
      name: "Clear",
      properties: {
        checked: false,
        disabled: false,
        expanded: false,
        invalid: "false",
        pressed: false,
        selected: false,
      },
    }),
  ];
  const dom = domSnapshot([
    {
      backendDOMNodeId: 2,
      attributes: { "aria-level": "3" },
    },
  ]);

  await withAriaScenario(
    { rootId: "root", rootRole: "group", nodes, dom },
    async () => {
      assert.equal(
        await helperContext().page.locator("#states").ariaSnapshot(),
        [
          "- group:",
          '  - treeitem "Selected" [checked=mixed] [expanded] [invalid=spelling] [level=3] [pressed=mixed] [selected]',
          '  - checkbox "Clear"',
        ].join("\n"),
      );
    },
  );
});

test("ariaSnapshot flattens presentation roles, normalizes invisible code points, and omits oversized names", async () => {
  const oversizedName = "a".repeat(901);
  const nodes = [
    axNode("root", "none", {
      childIds: ["presentation", "link"],
      backendDOMNodeId: 1,
      ignored: true,
    }),
    axNode("presentation", "presentation", {
      parentId: "root",
      childIds: ["text"],
      backendDOMNodeId: 2,
    }),
    axNode("text", "StaticText", {
      parentId: "presentation",
      backendDOMNodeId: 3,
      name: "he\u00adllo\u200b world",
    }),
    axNode("link", "link", {
      parentId: "root",
      backendDOMNodeId: 4,
      name: oversizedName,
    }),
  ];
  const dom = domSnapshot([
    {
      backendDOMNodeId: 4,
      nodeName: "A",
      attributes: { href: "#" },
    },
  ]);

  await withAriaScenario({ nodes, dom }, async () => {
    assert.equal(
      await helperContext().page.locator("#content").ariaSnapshot(),
      ["- text: hello world", "- link:", '  - /url: "#"'].join("\n"),
    );
  });
});

test("ariaSnapshot escapes YAML keys and values and truncates data URLs", async () => {
  const nodes = [
    axNode("root", "none", {
      childIds: ["button", "data-link", "empty-link", "text"],
      backendDOMNodeId: 1,
      ignored: true,
    }),
    axNode("button", "button", {
      parentId: "root",
      backendDOMNodeId: 2,
      name: "Save: now",
    }),
    axNode("data-link", "link", {
      parentId: "root",
      backendDOMNodeId: 3,
      name: "Data",
    }),
    axNode("empty-link", "link", {
      parentId: "root",
      backendDOMNodeId: 4,
      name: "Empty",
    }),
    axNode("text", "StaticText", {
      parentId: "root",
      backendDOMNodeId: 5,
      name: "{draft}",
    }),
  ];
  const dom = domSnapshot([
    {
      backendDOMNodeId: 3,
      nodeName: "A",
      attributes: { href: "data:text/plain;base64,SGVsbG8=" },
    },
    {
      backendDOMNodeId: 4,
      nodeName: "A",
      attributes: { href: "" },
    },
  ]);

  await withAriaScenario({ nodes, dom }, async () => {
    assert.equal(
      await helperContext().page.locator("#yaml").ariaSnapshot(),
      [
        `- 'button "Save: now"'`,
        '- link "Data":',
        "  - /url: data:text/plain;base64,…",
        '- link "Empty":',
        '  - /url: ""',
        '- text: "{draft}"',
      ].join("\n"),
    );
  });
});

test("ariaSnapshot boxes use viewport coordinates and frame scaling metadata", async () => {
  const nodes = [
    axNode("root", "generic", {
      childIds: ["button"],
      backendDOMNodeId: 1,
    }),
    axNode("button", "button", {
      parentId: "root",
      backendDOMNodeId: 2,
      name: "Buy",
    }),
  ];
  const dom = domSnapshot(
    [{ backendDOMNodeId: 2, nodeName: "BUTTON", box: [25, 45, 80, 40] }],
    { scrollX: 5, scrollY: 10 },
  );

  await withAriaScenario({ nodes, dom }, async () => {
    assert.equal(
      await helperContext().page.locator("#root").ariaSnapshot({ boxes: true }),
      '- button "Buy" [box=20,35,80,40]',
    );
  });
});

test("ariaSnapshot omits available DOM layout bounds unless boxes is true", async () => {
  const nodes = [
    axNode("button", "button", {
      backendDOMNodeId: 1,
      name: "No box",
    }),
  ];
  const dom = domSnapshot([
    {
      backendDOMNodeId: 1,
      nodeName: "BUTTON",
      box: [10, 20, 30, 40],
    },
  ]);

  await withAriaScenario(
    { rootId: "button", rootRole: "button", nodes, dom },
    async () => {
      assert.equal(
        await helperContext().page.locator("button").ariaSnapshot(),
        '- button "No box"',
      );
    },
  );
});

test("ariaSnapshot converts DOMSnapshot device pixels into viewport CSS pixels", async () => {
  const nodes = [
    axNode("button", "button", {
      backendDOMNodeId: 1,
      name: "Scaled",
    }),
  ];
  const dom = domSnapshot(
    [
      {
        backendDOMNodeId: 1,
        nodeName: "BUTTON",
        box: [40, 80, 120, 60],
      },
    ],
    { scrollX: 10, scrollY: 20 },
  );

  await withAriaScenario(
    {
      rootId: "button",
      rootRole: "button",
      nodes,
      dom,
      metrics: {
        layoutViewport: { clientWidth: 2560, clientHeight: 1600 },
        cssLayoutViewport: { clientWidth: 1280, clientHeight: 800 },
      },
    },
    async ({ calls }) => {
      assert.equal(
        await helperContext()
          .page.locator("button")
          .ariaSnapshot({ boxes: true }),
        '- button "Scaled" [box=15,30,60,30]',
      );
      assert.equal(
        calls.filter((call) => call.method === "Page.getLayoutMetrics").length,
        1,
      );
    },
  );
});

test("frame-scoped ariaSnapshot captures the child frame tree and maps boxes to the main viewport", async () => {
  const calls = [];
  const restore = setOverrides({
    sessionId: "main-session",
    sessionTargetId: "tab-main",
    sessionAt: Date.now(),
    async cdpOverride(method, params, sessionId, timeoutMs) {
      calls.push({ method, params, sessionId, timeoutMs });
      if (method === "Runtime.evaluate") {
        return {
          result: {
            objectId: params.contextId === 77 ? "snapshot-root" : "frame-owner",
          },
        };
      }
      if (method === "Runtime.callFunctionOn") {
        return {
          result: {
            value: {
              x: 10,
              y: 20,
              width: 200,
              height: 100,
              visible: true,
              scaleX: 2,
              scaleY: 0.5,
            },
          },
        };
      }
      if (method === "DOM.describeNode") {
        return { node: { frameId: "same-process-frame" } };
      }
      if (method === "Page.createIsolatedWorld") {
        return { executionContextId: 77 };
      }
      if (method === "Accessibility.getPartialAXTree") {
        return { nodes: [axNode("button", "button")] };
      }
      if (method === "Accessibility.getFullAXTree") {
        return {
          nodes: [
            axNode("button", "button", {
              backendDOMNodeId: 10,
              name: "Pay",
            }),
          ],
        };
      }
      if (method === "DOMSnapshot.captureSnapshot") {
        return domSnapshot(
          [
            {
              backendDOMNodeId: 10,
              nodeName: "BUTTON",
              box: [5, 8, 20, 10],
            },
          ],
          {
            frameId: "same-process-frame",
            scrollX: 1,
            scrollY: 2,
          },
        );
      }
      if (method === "Page.getLayoutMetrics") {
        return {
          layoutViewport: { clientWidth: 100, clientHeight: 100 },
          cssLayoutViewport: { clientWidth: 100, clientHeight: 100 },
        };
      }
      if (method === "Runtime.releaseObject") return {};
      throw new Error(`Unexpected CDP method: ${method}`);
    },
  });

  try {
    assert.equal(
      await helperContext()
        .page.frameLocator("#checkout-frame")
        .locator("button")
        .ariaSnapshot({ boxes: true, timeout: 500 }),
      '- button "Pay" [box=18,23,40,5]',
    );
  } finally {
    restore();
  }

  assert.deepEqual(
    calls.find((call) => call.method === "Accessibility.getFullAXTree")?.params,
    { frameId: "same-process-frame" },
  );
  assert.ok(
    calls
      .filter((call) => call.method !== "Runtime.releaseObject")
      .every(
        (call) =>
          call.sessionId === "main-session" &&
          call.timeoutMs > 0 &&
          call.timeoutMs <= 500,
      ),
  );
  assert.equal(
    calls.filter((call) => call.method === "Runtime.releaseObject").length,
    2,
  );
});

test("frame-scoped ariaSnapshot routes OOPIF capture through the child session", async () => {
  const calls = [];
  const restore = setOverrides({
    sessionId: "main-session",
    sessionTargetId: "tab-main",
    sessionAt: Date.now(),
    async cdpOverride(method, params, sessionId, timeoutMs) {
      calls.push({ method, params, sessionId, timeoutMs });
      if (method === "Runtime.evaluate") {
        return {
          result: {
            objectId: params.contextId === 88 ? "oopif-root" : "oopif-owner",
          },
        };
      }
      if (method === "Runtime.callFunctionOn") {
        return {
          result: {
            value: {
              x: 100,
              y: 50,
              width: 400,
              height: 300,
              visible: true,
              scaleX: 1,
              scaleY: 1,
            },
          },
        };
      }
      if (method === "DOM.describeNode") {
        return { node: { frameId: "aria-oopif-frame" } };
      }
      if (
        method === "Page.createIsolatedWorld" &&
        sessionId === "main-session"
      ) {
        throw new Error("No frame for given id found");
      }
      if (method === "Target.getTargets") {
        return {
          targetInfos: [{ targetId: "aria-oopif-frame", type: "iframe" }],
        };
      }
      if (method === "Target.attachToTarget") {
        return { sessionId: "aria-oopif-session" };
      }
      if (method === "Page.createIsolatedWorld") {
        return { executionContextId: 88 };
      }
      if (method === "Accessibility.getPartialAXTree") {
        return { nodes: [axNode("heading", "heading")] };
      }
      if (method === "Accessibility.getFullAXTree") {
        return {
          nodes: [
            axNode("heading", "heading", {
              backendDOMNodeId: 20,
              name: "Secure payment",
              properties: { level: 2 },
            }),
          ],
        };
      }
      if (method === "DOMSnapshot.captureSnapshot") {
        return domSnapshot([], { frameId: "aria-oopif-frame" });
      }
      if (method === "Runtime.releaseObject") return {};
      throw new Error(`Unexpected CDP method: ${method}`);
    },
  });

  try {
    assert.equal(
      await helperContext()
        .page.frameLocator("#payment-frame")
        .locator("h2")
        .ariaSnapshot({ timeout: 500 }),
      '- heading "Secure payment" [level=2]',
    );
  } finally {
    restore();
  }

  for (const method of [
    "Accessibility.getPartialAXTree",
    "Accessibility.getFullAXTree",
    "DOMSnapshot.captureSnapshot",
  ]) {
    assert.equal(
      calls.find((call) => call.method === method)?.sessionId,
      "aria-oopif-session",
    );
  }
  assert.equal(
    calls.find((call) => call.method === "Target.getTargets")?.sessionId,
    undefined,
  );
  assert.equal(
    calls.find((call) => call.method === "Target.attachToTarget")?.sessionId,
    undefined,
  );
});

test("ariaSnapshot retries a locator that appears before its timeout", async () => {
  const nodes = [
    axNode("root", "button", {
      backendDOMNodeId: 1,
      name: "Ready",
    }),
  ];

  await withAriaScenario(
    { rootId: "root", rootRole: "button", nodes, missingResolveAttempts: 2 },
    async ({ calls }) => {
      assert.equal(
        await helperContext()
          .page.locator("#delayed")
          .ariaSnapshot({ timeout: 500 }),
        '- button "Ready"',
      );
      assert.equal(
        calls.filter((call) => call.method === "Runtime.evaluate").length,
        3,
      );
    },
  );
});

test("ariaSnapshot retries when navigation replaces the AX tree after locator resolution", async () => {
  const nodes = [
    axNode("root", "heading", {
      backendDOMNodeId: 1,
      name: "After navigation",
      properties: { level: 1 },
    }),
  ];

  await withAriaScenario(
    {
      rootId: "root",
      rootRole: "heading",
      nodes,
      missingTreeAttempts: 1,
      missingTree: [axNode("old", "heading", { name: "Before navigation" })],
    },
    async ({ calls }) => {
      assert.equal(
        await helperContext().page.locator("h1").ariaSnapshot({ timeout: 500 }),
        '- heading "After navigation" [level=1]',
      );
      assert.equal(
        calls.filter((call) => call.method === "Accessibility.getFullAXTree")
          .length,
        2,
      );
    },
  );
});

test("ariaSnapshot reconciles rebuilt AX node ids through a stable backend DOM node", async () => {
  const nodes = [
    axNode("rebuilt-root", "button", {
      backendDOMNodeId: 42,
      name: "Stable element",
    }),
  ];

  await withAriaScenario(
    {
      rootId: "partial-root",
      rootRole: "button",
      partialBackendDOMNodeId: 42,
      nodes,
    },
    async ({ calls }) => {
      assert.equal(
        await helperContext()
          .page.locator("button")
          .ariaSnapshot({ timeout: 500 }),
        '- button "Stable element"',
      );
      assert.equal(
        calls.filter((call) => call.method === "Accessibility.getFullAXTree")
          .length,
        1,
      );
    },
  );
});

test("ariaSnapshot converts a missing locator deadline into TimeoutError", async () => {
  await withAriaScenario(
    { missingResolveAttempts: Number.POSITIVE_INFINITY },
    async ({ calls }) => {
      await assert.rejects(
        () =>
          helperContext()
            .page.locator("#missing")
            .ariaSnapshot({ timeout: 200 }),
        (error) => {
          assert.ok(error instanceof TimeoutError);
          assert.equal(
            error.message,
            "locator.ariaSnapshot timed out after 200ms: Element not found: #missing",
          );
          return true;
        },
      );
      assert.ok(
        calls
          .filter((call) => call.method === "Runtime.evaluate")
          .every(
            (call) =>
              typeof call.timeoutMs === "number" &&
              call.timeoutMs > 0 &&
              call.timeoutMs <= 200,
          ),
      );
    },
  );
});

test("ariaSnapshot converts an exhausted inner CDP deadline into the outer TimeoutError", async () => {
  const cdpError = new Error(
    "CDP request timed out: Accessibility.getPartialAXTree",
  );

  await withAriaScenario(
    { partialElapsed: 200, partialError: cdpError },
    async () => {
      await assert.rejects(
        () =>
          helperContext()
            .page.locator("#slow-tree")
            .ariaSnapshot({ timeout: 200 }),
        (error) => {
          assert.ok(error instanceof TimeoutError);
          assert.equal(
            error.message,
            "locator.ariaSnapshot timed out after 200ms: CDP request timed out: Accessibility.getPartialAXTree",
          );
          return true;
        },
      );
    },
  );
});

test("ariaSnapshot preserves timeout zero for unlimited inner CDP operations", async () => {
  const nodes = [
    axNode("root", "button", {
      backendDOMNodeId: 1,
      name: "Unlimited",
    }),
  ];

  await withAriaScenario(
    { rootId: "root", rootRole: "button", nodes },
    async ({ calls }) => {
      await helperContext().page.locator("button").ariaSnapshot({ timeout: 0 });
      assert.ok(
        calls
          .filter(
            (call) =>
              call.method !== "Runtime.releaseObject" &&
              call.method !== "DOMSnapshot.captureSnapshot",
          )
          .every((call) => call.timeoutMs === 0),
      );
    },
  );
});

test("ariaSnapshot honors AbortSignal before browser work and while auto-waiting", async (t) => {
  await t.test("already aborted", async () => {
    const controller = new AbortController();
    const reason = new Error("stop snapshot");
    controller.abort(reason);

    await withAriaScenario({}, async ({ calls }) => {
      await assert.rejects(
        () =>
          helperContext()
            .page.locator("#target")
            .ariaSnapshot({ signal: controller.signal }),
        (error) => error === reason,
      );
      assert.equal(calls.length, 0);
    });
  });

  await t.test("aborted while waiting", async () => {
    const controller = new AbortController();
    const reason = new Error("cancel delayed locator");

    await withAriaScenario(
      {
        missingResolveAttempts: Number.POSITIVE_INFINITY,
        onSleep: () => controller.abort(reason),
      },
      async () => {
        await assert.rejects(
          () =>
            helperContext()
              .page.locator("#target")
              .ariaSnapshot({ timeout: 500, signal: controller.signal }),
          (error) => error === reason,
        );
      },
    );
  });

  await t.test("aborted during AX capture", async () => {
    const controller = new AbortController();
    const reason = new Error("cancel AX capture");

    await withAriaScenario(
      {
        partialPending: true,
        onPartial: () => controller.abort(reason),
      },
      async ({ calls }) => {
        await assert.rejects(
          () =>
            helperContext()
              .page.locator("#target")
              .ariaSnapshot({ signal: controller.signal }),
          (error) => error === reason,
        );
        assert.equal(
          calls.filter((call) => call.method === "Runtime.releaseObject")
            .length,
          1,
        );
      },
    );
  });
});

test("ariaSnapshot validates options before sending CDP commands", async (t) => {
  for (const scenario of [
    {
      name: "negative timeout",
      options: { timeout: -1 },
      pattern: /timeout must be a non-negative number/,
    },
    {
      name: "fractional depth",
      options: { depth: 1.5 },
      pattern: /depth must be a non-negative integer/,
    },
    {
      name: "invalid boxes",
      options: { boxes: "yes" },
      pattern: /boxes must be a boolean/,
    },
    {
      name: "invalid ref",
      options: { ref: "yes" },
      pattern: /ref must be a boolean/,
    },
    {
      name: "unsupported ai mode",
      options: { mode: "ai" },
      pattern: /mode "ai" is not supported.*page\.snapshot/s,
    },
    {
      name: "unknown mode",
      options: { mode: "compact" },
      pattern: /mode must be "default"/,
    },
    {
      name: "invalid signal",
      options: { signal: {} },
      pattern: /signal must be an AbortSignal/,
    },
  ]) {
    await t.test(scenario.name, async () => {
      await withAriaScenario({}, async ({ calls }) => {
        await assert.rejects(
          () =>
            helperContext()
              .page.locator("#target")
              .ariaSnapshot(scenario.options),
          scenario.pattern,
        );
        assert.equal(calls.length, 0);
      });
    });
  }
});

test("ariaSnapshot releases the locator handle when capture fails", async () => {
  const captureError = new Error("DOM snapshot failed");
  const nodes = [
    axNode("root", "button", {
      backendDOMNodeId: 1,
      name: "Target",
    }),
  ];

  await withAriaScenario(
    { rootId: "root", rootRole: "button", nodes, captureError },
    async ({ calls }) => {
      await assert.rejects(
        () => helperContext().page.locator("#target").ariaSnapshot(),
        (error) => error === captureError,
      );
      assert.equal(
        calls.filter((call) => call.method === "Runtime.releaseObject").length,
        1,
      );
      assert.equal(
        calls.some(
          (call) =>
            call.method === "Accessibility.enable" ||
            call.method === "Accessibility.disable",
        ),
        false,
      );
    },
  );
});
