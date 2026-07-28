import test from "node:test";
import assert from "node:assert/strict";

import { waitForActionableElement } from "../../dist/src/driver/actionability.js";
import { setOverrides } from "../../dist/src/state.js";

test("waitForActionableElement waits for stability and returns a relative point", async () => {
  let now = 0;
  let probes = 0;
  const sleeps = [];
  const restore = setOverrides({
    defaultTimeout: 500,
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
    cdpOverride: async (method) => {
      if (method === "Runtime.evaluate") {
        return { result: { objectId: "node-1" } };
      }
      if (method === "Runtime.callFunctionOn") {
        probes += 1;
        return {
          result: {
            value: {
              attached: true,
              visible: true,
              enabled: true,
              editable: true,
              receivesEvents: true,
              rect: { x: 10, y: 20, width: 100, height: 40 },
            },
          },
        };
      }
      return {};
    },
  });
  try {
    const result = await waitForActionableElement("#submit", {
      timeout: 500,
      visible: true,
      stable: true,
      receivesEvents: true,
      enabled: true,
      position: { x: 5, y: 7 },
    });
    assert.deepEqual(result, {
      x: 15,
      y: 27,
      sessionId: undefined,
    });
  } finally {
    restore();
  }

  assert.ok(probes >= 2, "stability requires two matching layout samples");
  assert.ok(sleeps.includes(50));
});

test("waitForActionableElement throws TimeoutError for an obscured target", async () => {
  let now = 0;
  const restore = setOverrides({
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    cdpOverride: async (method) => {
      if (method === "Runtime.evaluate") {
        return { result: { objectId: "node-1" } };
      }
      if (method === "Runtime.callFunctionOn") {
        return {
          result: {
            value: {
              attached: true,
              visible: true,
              enabled: true,
              editable: true,
              receivesEvents: false,
              rect: { x: 0, y: 0, width: 100, height: 40 },
            },
          },
        };
      }
      return {};
    },
  });
  try {
    await assert.rejects(
      () =>
        waitForActionableElement("#submit", {
          timeout: 100,
          visible: true,
          receivesEvents: true,
        }),
      (error) => {
        assert.equal(error.name, "TimeoutError");
        assert.match(error.message, /locator action timed out after 100ms/);
        assert.match(error.message, /element does not receive pointer events/);
        return true;
      },
    );
  } finally {
    restore();
  }
});

test("waitForActionableElement re-resolves when the node detaches during a probe", async () => {
  let now = 0;
  let probes = 0;
  const restore = setOverrides({
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    cdpOverride: async (method) => {
      if (method === "Runtime.evaluate") {
        return { result: { objectId: `node-${probes + 1}` } };
      }
      if (method === "Runtime.callFunctionOn") {
        probes += 1;
        if (probes === 1) {
          throw new Error("Could not find object with given id");
        }
        return {
          result: {
            value: {
              attached: true,
              visible: true,
              enabled: true,
              editable: true,
              receivesEvents: true,
              rect: { x: 1, y: 2, width: 10, height: 10 },
            },
          },
        };
      }
      return {};
    },
  });
  try {
    assert.deepEqual(
      await waitForActionableElement("#moving", {
        timeout: 500,
        visible: true,
      }),
      { x: 6, y: 7, sessionId: undefined },
    );
  } finally {
    restore();
  }
  assert.equal(probes, 2);
});
