import test from "node:test";
import assert from "node:assert/strict";

import {
  MACOS_EGO_LITE_CLI,
  resolveEgoBrowserCli,
} from "../scripts/real-browser-e2e/ego-browser-cli.mjs";

test("real-browser E2E honors an explicit Ego Lite CLI", () => {
  assert.equal(
    resolveEgoBrowserCli({
      configured: "/custom/ego-lite/ego-browser",
      platform: "darwin",
      pathExists: () => true,
    }),
    "/custom/ego-lite/ego-browser",
  );
});

test("real-browser E2E prefers the stable Ego Lite app path on macOS", () => {
  assert.equal(
    resolveEgoBrowserCli({
      configured: "",
      platform: "darwin",
      pathExists: (path) => path === MACOS_EGO_LITE_CLI,
    }),
    MACOS_EGO_LITE_CLI,
  );
});

test("real-browser E2E falls back to PATH when no app-specific CLI exists", () => {
  assert.equal(
    resolveEgoBrowserCli({
      platform: "linux",
      pathExists: () => false,
    }),
    "ego-browser",
  );
});
