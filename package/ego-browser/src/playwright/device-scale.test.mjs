import test from "node:test";
import assert from "node:assert/strict";

// The module is imported lazily so that a missing or broken build reports one
// failure per contract below instead of aborting the whole file at load time.
let deviceScale;
let importError;
try {
  deviceScale = await import("../../dist/src/playwright/device-scale.js");
} catch (error) {
  importError = error;
}

function syncCssPixelScreenshots(session) {
  if (importError) throw importError;
  return deviceScale.syncCssPixelScreenshots(session);
}

// ratio has no default on purpose: a default would swallow an explicitly
// passed undefined, which is the case that matters most — a page.evaluate
// returning nothing is exactly what a broken bridge looks like.
function createSession({ ratio, options = {} }) {
  const state = { evaluateCalls: 0, toImplArguments: [] };
  const serverSideContext = { _options: options };
  const context = {
    _connection: {
      toImpl(target) {
        state.toImplArguments.push(target);
        return serverSideContext;
      },
    },
  };
  const page = {
    async evaluate() {
      state.evaluateCalls += 1;
      return ratio;
    },
  };
  return { session: { page, context }, context, options, state };
}

test("the css pixel screenshot sync writes the live device pixel ratio into the server-side context options", async () => {
  const { session, options, state } = createSession({ ratio: 2 });

  const applied = await syncCssPixelScreenshots(session);

  assert.equal(applied, 2);
  assert.equal(options.deviceScaleFactor, 2);
  assert.equal(state.evaluateCalls, 1);
});

test("the css pixel screenshot sync resolves the server-side options through the client BrowserContext handed to toImpl", async () => {
  const { session, context, state } = createSession({ ratio: 2 });

  await syncCssPixelScreenshots(session);

  assert.equal(state.toImplArguments.length, 1);
  assert.equal(
    state.toImplArguments[0],
    context,
    "toImpl resolves a client object by its _guid, so the client BrowserContext is the only valid argument",
  );
});

test("the css pixel screenshot sync writes a ratio of one over a stale higher ratio", async () => {
  // Dragging the window from a retina display to a 1x monitor: a stale 2 left
  // behind halves every css screenshot, which is worse than never patching.
  const { session, options } = createSession({
    ratio: 1,
    options: { deviceScaleFactor: 2 },
  });

  const applied = await syncCssPixelScreenshots(session);

  assert.equal(applied, 1);
  assert.equal(options.deviceScaleFactor, 1);
});

test("the css pixel screenshot sync leaves the same value behind when it runs twice", async () => {
  const { session, options } = createSession({ ratio: 2 });

  assert.equal(await syncCssPixelScreenshots(session), 2);
  assert.equal(await syncCssPixelScreenshots(session), 2);
  assert.deepEqual(options, { deviceScaleFactor: 2 });
});

test("the css pixel screenshot sync leaves every other server-side context option untouched", async () => {
  const options = {
    noDefaultViewport: true,
    locale: "en-US",
    javaScriptEnabled: true,
  };
  const { session } = createSession({ ratio: 3, options });

  await syncCssPixelScreenshots(session);

  assert.deepEqual(options, {
    noDefaultViewport: true,
    locale: "en-US",
    javaScriptEnabled: true,
    deviceScaleFactor: 3,
  });
});

test("the css pixel screenshot sync never introduces a viewport option that would resize the user's browser", async () => {
  const { session, options } = createSession({ ratio: 2 });

  await syncCssPixelScreenshots(session);

  // A viewport alongside deviceScaleFactor gives the page an emulated size,
  // which makes Playwright push Emulation.setDeviceMetricsOverride.
  assert.equal("viewport" in options, false);
  assert.deepEqual(Object.keys(options), ["deviceScaleFactor"]);
});

test("an unusable device pixel ratio throws instead of silently keeping the previous screenshot scale", async () => {
  const ratios = [
    "2",
    Number.NaN,
    0,
    -2,
    Number.POSITIVE_INFINITY,
    undefined,
    null,
  ];

  for (const ratio of ratios) {
    const { session, options } = createSession({
      ratio,
      options: { deviceScaleFactor: 2 },
    });

    await assert.rejects(
      () => syncCssPixelScreenshots(session),
      /deviceScaleFactor/,
      `a ratio of ${String(ratio)} must be rejected with a greppable error`,
    );
    assert.deepEqual(
      options,
      { deviceScaleFactor: 2 },
      `a ratio of ${String(ratio)} must leave the server-side options unwritten`,
    );
  }
});

test("a Playwright build without the in-process toImpl bridge throws instead of leaving screenshots in device pixels", async () => {
  const page = {
    async evaluate() {
      return 2;
    },
  };
  const contexts = [
    ["a client BrowserContext without _connection", {}],
    ["a _connection without toImpl", { _connection: {} }],
    [
      "a toImpl that is not callable",
      { _connection: { toImpl: "not-a-function" } },
    ],
    ["a toImpl returning null", { _connection: { toImpl: () => null } }],
    [
      "a toImpl returning undefined",
      { _connection: { toImpl: () => undefined } },
    ],
  ];

  for (const [label, context] of contexts) {
    await assert.rejects(
      () => syncCssPixelScreenshots({ page, context }),
      /deviceScaleFactor/,
      `${label} must be rejected with a greppable error`,
    );
  }
});

test("a server-side BrowserContext without an options object throws", async () => {
  const page = {
    async evaluate() {
      return 2;
    },
  };
  const impls = [
    ["no _options", {}],
    ["a null _options", { _options: null }],
    ["a non-object _options", { _options: "css" }],
  ];

  for (const [label, impl] of impls) {
    const context = { _connection: { toImpl: () => impl } };
    await assert.rejects(
      () => syncCssPixelScreenshots({ page, context }),
      /deviceScaleFactor/,
      `${label} must be rejected with a greppable error`,
    );
  }
});
