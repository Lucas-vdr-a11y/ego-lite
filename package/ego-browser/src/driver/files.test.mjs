import test from "node:test";
import assert from "node:assert/strict";

import { setInputFiles } from "../../dist/src/driver/files.js";
import { setOverrides } from "../../dist/src/state.js";

function installFileHarness() {
  const calls = [];
  const writes = [];
  const restore = setOverrides({
    writeFile: async (path, data) => {
      writes.push({ path, data });
    },
    cdpOverride: async (method, params, sessionId) => {
      calls.push({ method, params, sessionId });
      if (method === "Runtime.evaluate") {
        return { result: { objectId: "file-input-1" } };
      }
      return {};
    },
  });
  return { calls, writes, restore };
}

test("setInputFiles accepts [] to clear the input", async () => {
  const { calls, restore } = installFileHarness();
  try {
    await setInputFiles("#upload", []);
  } finally {
    restore();
  }
  const call = calls.find((entry) => entry.method === "DOM.setFileInputFiles");
  assert.deepEqual(call.params.files, []);
  assert.equal(call.params.objectId, "file-input-1");
});

test("setInputFiles materializes Playwright FilePayload buffers", async () => {
  const { calls, writes, restore } = installFileHarness();
  try {
    await setInputFiles("#upload", {
      name: "../report.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("payload"),
    });
  } finally {
    restore();
  }
  assert.equal(writes.length, 1);
  assert.match(writes[0].path, /\/report\.txt$/);
  assert.equal(writes[0].data.toString(), "payload");
  const call = calls.find((entry) => entry.method === "DOM.setFileInputFiles");
  assert.deepEqual(call.params.files, [writes[0].path]);
  const metadataCall = calls.find(
    (entry) =>
      entry.method === "Runtime.callFunctionOn" &&
      entry.params.functionDeclaration.includes("new File"),
  );
  assert.deepEqual(metadataCall.params.arguments, [
    {
      value: [
        {
          kind: "payload",
          name: "../report.txt",
          mimeType: "text/plain",
        },
      ],
    },
  ]);
});
