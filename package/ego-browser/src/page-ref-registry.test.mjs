import test from "node:test";
import assert from "node:assert/strict";

import { PageRefRegistry } from "../dist/src/page-ref-registry.js";

test("Page refs preserve native frame provenance and an explicit ref id", () => {
  const refs = new PageRefRegistry().replace("page-target", [
    {
      refId: 901,
      backendNodeId: 21,
      frameId: "frame-target",
      role: "button",
      name: "Run iframe action",
    },
  ]);

  assert.deepEqual(refs.get("901"), {
    backendNodeId: 21,
    role: "button",
    name: "Run iframe action",
    nth: undefined,
    frameId: "frame-target",
  });
  assert.equal(
    refs.get("21"),
    undefined,
    "a renderer-local backend node id must not replace the printed ref id",
  );
});
