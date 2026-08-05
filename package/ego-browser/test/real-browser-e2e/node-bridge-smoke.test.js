import assert from "node:assert/strict";
import test from "node:test";

import * as smoke from "./suites/runtime/node-bridge-smoke.mjs";

const validProbe = {
  egoType: "object",
  hasSendCDPMessage: "function",
  processVersion: "v24.18.0",
  egoBrowserType: "object",
  hasListProfile: "function",
  hasListTaskSpace: "function",
  useOrCreateTaskSpaceType: "undefined",
  siteType: "object",
  fetchType: "function",
  cdpType: "function",
  helperType: "function",
  profilesIsArray: true,
  taskSpacesIsArray: true,
};

test("node bridge smoke performs read-only asynchronous host calls", () => {
  const source = smoke.createNodeBridgeSmokeSource("SMOKE_MARKER");

  assert.match(source, /await egoBrowser\.listProfile\(\)/);
  assert.match(source, /await egoBrowser\.listTaskSpace\(\)/);
  assert.match(source, /profilesIsArray: Array\.isArray\(profiles\)/);
  assert.match(source, /taskSpacesIsArray: Array\.isArray\(taskSpaces\)/);
  assert.doesNotMatch(
    source,
    /await egoBrowser\.(?:newTaskSpace|useOrCreateTaskSpace|claimTaskSpace|closeTaskSpace)/,
  );
});

test("node bridge smoke probes the required public facade", () => {
  const source = smoke.createNodeBridgeSmokeSource("SMOKE_MARKER");

  for (const property of [
    "egoBrowserType",
    "hasListProfile",
    "hasListTaskSpace",
    "useOrCreateTaskSpaceType",
    "siteType",
    "fetchType",
    "cdpType",
    "helperType",
  ]) {
    assert.match(source, new RegExp(`${property}:`));
  }
});

test("node bridge smoke parses its marker and runtime payload", () => {
  const stdout = [
    "host preamble",
    "SMOKE_MARKER",
    JSON.stringify(validProbe),
    "update notice",
  ].join("\n");

  assert.deepEqual(
    smoke.parseNodeBridgeSmoke(stdout, "SMOKE_MARKER"),
    validProbe,
  );
});

test("node bridge smoke rejects missing and malformed output", () => {
  assert.throws(
    () => smoke.parseNodeBridgeSmoke("{}", "SMOKE_MARKER"),
    /did not print the console\.log smoke marker/,
  );
  assert.throws(
    () => smoke.parseNodeBridgeSmoke("SMOKE_MARKER", "SMOKE_MARKER"),
    /did not print runtime probe data/,
  );
  assert.throws(
    () => smoke.parseNodeBridgeSmoke("SMOKE_MARKER\nnot-json", "SMOKE_MARKER"),
    /invalid runtime probe data/,
  );
});

test("node bridge smoke accepts the complete runtime contract without a legacy CDP endpoint", () => {
  assert.equal(typeof smoke.validateNodeBridgeProbe, "function");
  assert.deepEqual(smoke.validateNodeBridgeProbe(validProbe), {
    ok: true,
    failures: [],
  });
});

test("node bridge smoke rejects every missing runtime capability", () => {
  assert.equal(typeof smoke.validateNodeBridgeProbe, "function");
  const invalidValues = [
    ["egoType", "undefined"],
    ["hasSendCDPMessage", "undefined"],
    ["processVersion", "v21.9.0"],
    ["egoBrowserType", "undefined"],
    ["hasListProfile", "undefined"],
    ["hasListTaskSpace", "undefined"],
    ["useOrCreateTaskSpaceType", "function"],
    ["siteType", "undefined"],
    ["fetchType", "undefined"],
    ["cdpType", "undefined"],
    ["helperType", "undefined"],
    ["profilesIsArray", false],
    ["taskSpacesIsArray", false],
  ];

  for (const [property, value] of invalidValues) {
    const validation = smoke.validateNodeBridgeProbe({
      ...validProbe,
      [property]: value,
    });
    assert.equal(validation.ok, false, `${property} is required`);
    assert.deepEqual(validation.failures, [property]);
  }
});

test("node bridge smoke derives its assertion count from declared checks", () => {
  assert.equal(typeof smoke.nodeBridgeSmokeAssertionCount, "function");
  assert.equal(smoke.nodeBridgeSmokeAssertionCount(), 15);
});
