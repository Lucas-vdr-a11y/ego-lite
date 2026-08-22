import test from "node:test";
import assert from "node:assert/strict";

import {
  enrichSnapshotRefFrames,
  preparePageSnapshotResult,
  sanitizeSnapshotLocators,
  validateSnapshotLocator,
} from "../dist/src/snapshot-result.js";

test("snapshot locator validation batches DOM queries and object cleanup", async () => {
  const calls = [];
  const services = {
    async cdp(method, params, sessionId) {
      calls.push([method, params, sessionId]);
      if (method === "Runtime.evaluate" && params.returnByValue) {
        return { result: { value: [1, 1] } };
      }
      if (method === "Runtime.evaluate") {
        return { result: { objectId: "locator-batch" } };
      }
      if (method === "Runtime.getProperties") {
        return {
          result: [
            { name: "0", value: { objectId: "node:10" } },
            { name: "1", value: { objectId: "node:11" } },
          ],
        };
      }
      if (method === "DOM.describeNode") {
        return {
          node: {
            backendNodeId: Number(params.objectId.slice("node:".length)),
          },
        };
      }
      if (method === "Runtime.releaseObjectGroup") return {};
      throw new Error(`unexpected CDP method: ${method}`);
    },
  };
  const result = {
    content: [
      "button A [ref=10, loc=css:#a]",
      "button B [ref=11, loc=css:#b]",
    ].join("\n"),
    refs: [
      { backendNodeId: 10, loc: "css:#a" },
      { backendNodeId: 11, loc: "css:#b" },
    ],
  };

  await preparePageSnapshotResult(services, "session:page", new Map(), result);

  assert.equal(result.refs[0].loc, "css:#a");
  assert.equal(result.refs[1].loc, "css:#b");
  assert.equal(
    calls.filter(([method]) => method === "Runtime.evaluate").length,
    2,
  );
  assert.equal(
    calls.filter(([method]) => method === "Runtime.getProperties").length,
    1,
  );
  assert.equal(
    calls.filter(([method]) => method === "DOM.describeNode").length,
    2,
  );
  assert.equal(
    calls.filter(([method]) => method === "Runtime.releaseObjectGroup").length,
    1,
  );
  assert.equal(
    calls.some(([method]) => method === "Runtime.releaseObject"),
    false,
  );
});

test("invalid native snapshot locators are hidden without removing their refs", async () => {
  const result = {
    content: [
      'textfield "Prompt" [ref=10, loc=css:input[aria-label="Prompt"]]',
      'button "Save" [ref=11, loc=role:button[name="Save"]]',
    ].join("\n"),
    refs: [
      {
        backendNodeId: 10,
        role: "textfield",
        name: "Prompt",
        loc: 'css:input[aria-label="Prompt"]',
      },
      {
        backendNodeId: 11,
        role: "button",
        name: "Save",
        loc: 'role:button[name="Save"]',
      },
    ],
  };

  await sanitizeSnapshotLocators(
    result,
    async (ref) => ref.backendNodeId === 11,
  );

  assert.match(result.content, /ref=10, loc=unstable/);
  assert.doesNotMatch(result.content, /loc=css:input/);
  assert.match(result.content, /ref=11, loc=role:button/);
  assert.equal(result.refs[0].loc, "unstable");
  assert.equal(result.refs[1].loc, 'role:button[name="Save"]');
});

test("stable locator validation requires one match for the original backend node", async () => {
  const responses = new Map([
    ["zero", { count: 0 }],
    ["duplicate", { count: 2 }],
    ["wrong", { count: 1, resolvedBackendNodeId: 99 }],
    ["same", { count: 1, resolvedBackendNodeId: 10 }],
  ]);

  const cdp = {
    async sendRaw(method, params) {
      if (method === "Runtime.evaluate") {
        const key = [...responses.keys()].find((candidate) =>
          params.expression.includes(`#${candidate}`),
        );
        const response = responses.get(key);
        if (params.returnByValue) {
          return { result: { value: [response.count] } };
        }
        return {
          result: { objectId: `batch:${response.resolvedBackendNodeId}` },
        };
      }
      if (method === "Runtime.getProperties") {
        const backendNodeId = params.objectId.slice("batch:".length);
        return {
          result: [{ name: "0", value: { objectId: `node:${backendNodeId}` } }],
        };
      }
      if (method === "DOM.describeNode") {
        return {
          node: {
            backendNodeId: Number(params.objectId.slice("node:".length)),
          },
        };
      }
      if (method === "Runtime.releaseObjectGroup") return {};
      return {};
    },
  };

  for (const [selector, expected] of [
    ["zero", false],
    ["duplicate", false],
    ["wrong", false],
    ["same", true],
  ]) {
    assert.equal(
      await validateSnapshotLocator(cdp, "session:page", new Map(), {
        backendNodeId: 10,
        loc: `css:#${selector}`,
      }),
      expected,
      selector,
    );
  }
});

test("snapshot refs inherit their same-process and OOPIF frame ids", async () => {
  const refs = [
    { backendNodeId: 10, role: "button", name: "Top" },
    { backendNodeId: 20, role: "button", name: "Same process" },
    { backendNodeId: 30, role: "button", name: "OOPIF" },
  ];
  const calls = [];
  const services = {
    async cdp(method, params, sessionId) {
      calls.push([method, params, sessionId]);
      assert.equal(method, "Accessibility.getFullAXTree");
      if (params.frameId === "frame-same") {
        return { nodes: [{ backendDOMNodeId: 20 }] };
      }
      if (sessionId === "session:oopif") {
        return { nodes: [{ backendDOMNodeId: 30 }] };
      }
      return { nodes: [] };
    },
  };

  await enrichSnapshotRefFrames(
    services,
    "session:page",
    new Map([
      ["frame-same", "session:page"],
      ["frame-oopif", "session:oopif"],
    ]),
    refs,
  );

  assert.equal(refs[0].frameId, undefined);
  assert.equal(refs[1].frameId, "frame-same");
  assert.equal(refs[2].frameId, "frame-oopif");
  assert.deepEqual(calls, [
    ["Accessibility.getFullAXTree", { frameId: "frame-same" }, "session:page"],
    ["Accessibility.getFullAXTree", {}, "session:oopif"],
  ]);
});
