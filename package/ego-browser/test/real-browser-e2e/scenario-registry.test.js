import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

import { scenarioCases } from "./suites/scenarios/index.mjs";
import { TEST_CASES } from "./site/test-cases.mjs";

const businessScenarios = [
  ["review-workflow", "/tests/review-workflow"],
  ["collaborative-docs", "/tests/collaborative-docs"],
  ["spreadsheet", "/tests/spreadsheet"],
  ["rich-text", "/tests/rich-text"],
];

function scenarioOperations(source) {
  const startMarker = "/* scenario operations */";
  const finishMarker =
    'await observedAction(page, page.getByTestId("finish-test"), "click");';
  const start = source.indexOf(startMarker);
  const finish = source.indexOf(finishMarker, start + startMarker.length);
  if (start < 0 || finish < 0) return "";
  return source.slice(start + startMarker.length, finish);
}

test("registers the SVG and MathML standards scenario", async () => {
  const scenarioIndex = await readFile(
    new URL("./site/src/scenarios/index.jsx", import.meta.url),
    "utf8",
  );
  const testCase = TEST_CASES.find(
    (candidate) => candidate.slug === "svg-mathml",
  );

  assert.equal(testCase?.route, "/tests/svg-mathml");
  assert.match(scenarioIndex, /["']svg-mathml["']\s*:/);
  assert(
    scenarioCases.some(
      (candidate) => candidate.name === "web test: svg-mathml",
    ),
    "svg-mathml has a real-browser journey",
  );
});

test("uses native SVG and MathML markup for the capacity model", async () => {
  const viewSource = await readFile(
    new URL("./site/src/scenarios/svg-mathml/view.jsx", import.meta.url),
    "utf8",
  ).catch(() => "");
  const clientSource = await readFile(
    new URL("./site/src/scenarios/svg-mathml/client.js", import.meta.url),
    "utf8",
  ).catch(() => "");

  assert.match(viewSource, /<svg\b[^>]*viewBox=/);
  assert.match(viewSource, /<circle\b[^>]*role=["']button["']/);
  assert.match(viewSource, /<foreignObject\b/);
  assert.match(viewSource, /<math\b/);
  assert.equal(viewSource.match(/<math\b/g)?.length, 1);
  assert.match(viewSource, /<mfrac\b/);
  assert.doesNotMatch(viewSource, /dangerouslySetInnerHTML|innerHTML/);

  assert.match(clientSource, /addEventListener\(["']click["']/);
  assert.match(clientSource, /addEventListener\(["']keydown["']/);
  assert.match(clientSource, /addEventListener\(["']submit["']/);
  assert.match(clientSource, /Math\.ceil\(/);
  assert.doesNotMatch(clientSource, /dispatchEvent\(|EGO_BROWSER|case-result/);
});

test("keeps the SVG and MathML journey on observable user behavior", () => {
  const testCase = scenarioCases.find(
    (candidate) => candidate.name === "web test: svg-mathml",
  );
  const source = testCase?.body() || "";
  const operations = scenarioOperations(source);

  assert.match(operations, /element\.namespaceURI/);
  assert.match(operations, /formula\.ariaSnapshot\(\)/);
  assert.match(operations, /observedFocusedKeyboard\(page, weekFour/);
  assert.match(
    operations,
    /const weekThreeBox = await weekThree\.boundingBox\(\)/,
  );
  assert.match(operations, /observedAction\(page, weekThree, "click"/);
  assert.match(operations, /position:\s*\{/);
  assert.match(operations, /weekThreeBox\.width - 2/);
  assert.match(operations, /"51"/);
  assert.match(operations, /"12"/);
  assert(
    operations.indexOf("const updatedFormulaSnapshot") <
      operations.indexOf("const weekThree"),
    "MathML behavior is verified before the SVG ring-edge pointer action",
  );
  assert.doesNotMatch(
    operations,
    /force\s*:\s*true|dispatchEvent\(|\.evaluate\([^)]*\.click|assertRejects/,
  );
});

test("registers the four business collaboration scenarios", async () => {
  const scenarioIndex = await readFile(
    new URL("./site/src/scenarios/index.jsx", import.meta.url),
    "utf8",
  );
  for (const [slug, route] of businessScenarios) {
    const testCase = TEST_CASES.find((candidate) => candidate.slug === slug);
    assert.equal(testCase?.route, route);
    const surfaceKey = slug.includes("-")
      ? `["']${slug}["']`
      : `(?:["']${slug}["']|${slug})`;
    assert.match(scenarioIndex, new RegExp(`${surfaceKey}\\s*:`));
  }
});

test("keeps one view and one browser client for every business scenario", async () => {
  for (const [slug] of businessScenarios) {
    await access(
      new URL(`./site/src/scenarios/${slug}/view.jsx`, import.meta.url),
    );
    await access(
      new URL(`./site/src/scenarios/${slug}/client.js`, import.meta.url),
    );
  }
});

test("declares focused editor, collaboration, and spreadsheet dependencies", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("./site/package.json", import.meta.url), "utf8"),
  );
  const expectedDependencies = [
    "@tiptap/core",
    "@tiptap/extension-collaboration",
    "@tiptap/pm",
    "@tiptap/starter-kit",
    "@tiptap/y-tiptap",
    "quill",
    "tabulator-tables",
    "yjs",
  ];
  for (const dependency of expectedDependencies) {
    assert.equal(typeof packageJson.dependencies[dependency], "string");
  }
  assert.equal(packageJson.dependencies.quill, "2.0.2");
});

test("covers every business scenario with a real-browser journey", () => {
  const names = new Set(scenarioCases.map((testCase) => testCase.name));
  for (const [slug] of businessScenarios) {
    assert(names.has(`web test: ${slug}`), `${slug} has a browser journey`);
  }
});
