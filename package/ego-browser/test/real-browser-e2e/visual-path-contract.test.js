import assert from "node:assert/strict";
import test from "node:test";

import { visualPathScenarioCase } from "./suites/scenarios/visual-path.mjs";

function functionBody(source, name, nextName) {
  const start = source.indexOf(`async function ${name}`);
  const end = source.indexOf(`async function ${nextName}`, start);
  assert.notEqual(start, -1, `${name} is present`);
  assert.notEqual(end, -1, `${nextName} follows ${name}`);
  return source.slice(start, end);
}

test("visual-path keeps CSS aiming separate from device-pixel comparison screenshots", () => {
  const source = visualPathScenarioCase.body();
  const observedCss = functionBody(source, "shootObservedCss", "shootCss");
  const css = functionBody(source, "shootCss", "shootDevice");
  const device = functionBody(source, "shootDevice", "scrollPageTo");

  assert.match(observedCss, /observedScreenshot\(page, label\)/);
  assert.match(css, /scale:\s*"css"/);
  assert.match(device, /scale:\s*"device"/);
  assert.doesNotMatch(device, /observedScreenshot/);

  assert.match(source, /cssBoard\.width,\s*environment\.innerWidth/);
  assert.match(
    source,
    /deviceBoard\.width,\s*Math\.round\(environment\.innerWidth \* ratio\)/,
  );
  assert.match(
    source,
    /PRIMARY\.map\(\(target\) => sight\(cssBoard, target\)\)/,
  );
  assert.match(source, /toCssPoint\(deviceAlpha, ratio\)/);
  assert.doesNotMatch(
    source,
    /cssBoard\.width,\s*Math\.round\(environment\.innerWidth \* ratio\)/,
  );
});
