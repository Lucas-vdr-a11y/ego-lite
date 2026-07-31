import test from "node:test";
import assert from "node:assert/strict";

import { helperContext } from "../dist/src/helpers.js";
import { setOverrides } from "../dist/src/state.js";

test("[exact:page.waitForTimeout] waits for the requested milliseconds", async () => {
  const sleeps = [];
  const restore = setOverrides({
    sleep: async (milliseconds) => sleeps.push(milliseconds),
  });
  try {
    await helperContext().page.waitForTimeout(125);
    assert.deepEqual(sleeps, [125]);
  } finally {
    restore();
  }
});

test("[exact:locator.first] returns a lazy first-match locator", () => {
  const locator = helperContext().page.locator(".item").first();
  assert.equal(locator.selector, "internal:nth=0;.item");
});

test("[exact:locator.last] returns a lazy last-match locator", () => {
  const locator = helperContext().page.locator(".item").last();
  assert.equal(locator.selector, "internal:last;.item");
});

test("[exact:locator.nth] returns a lazy zero-based match locator", () => {
  const locator = helperContext().page.locator(".item").nth(2);
  assert.equal(locator.selector, "internal:nth=2;.item");
  assert.throws(
    () => helperContext().page.locator(".item").nth(-1),
    /non-negative integer/,
  );
});

test("[exact:locator.count] returns the current number of matches without waiting", async () => {
  const restore = setOverrides({
    cdpOverride(method, params) {
      assert.equal(method, "Runtime.evaluate");
      assert.match(params.expression, /elements\.length/);
      return { result: { value: 2 } };
    },
  });
  try {
    assert.equal(await helperContext().page.locator(".item").count(), 2);
  } finally {
    restore();
  }
});

test("[exact:locator.all] returns one lazy locator per current match", async () => {
  const restore = setOverrides({
    cdpOverride() {
      return { result: { value: 2 } };
    },
  });
  try {
    const locators = await helperContext().page.locator(".item").all();
    assert.deepEqual(
      locators.map((locator) => locator.selector),
      ["internal:nth=0;.item", "internal:nth=1;.item"],
    );
  } finally {
    restore();
  }
});

test("[exact:frameLocator.owner] returns the owning frame element locator", () => {
  const owner = helperContext()
    .page.frameLocator("iframe#outer")
    .frameLocator("iframe#inner")
    .owner();
  assert.equal(owner.selector, "iframe#inner");
  assert.deepEqual(owner.frameChain, ["iframe#outer"]);
});
