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
