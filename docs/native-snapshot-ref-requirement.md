# Native snapshot metadata requirements

## Snapshot refs for iframe content

`ego.snapshot()` already includes text from ordinary iframes and OOPIFs, but
actionable nodes inside those frames are currently omitted from `refs`. The
result is visible content that has no `@N` target.

Please return a ref for every actionable frame node printed by the snapshot:

```js
{
  refId: 901,
  backendNodeId: 21,
  frameId: "FRAME_OR_OOPIF_TARGET_ID",
  role: "button",
  name: "Run iframe action",
}
```

- The content must print `[ref=901]` for this node.
- `refId` must be unique within one snapshot, including across renderer
  processes. It is the value shown to the Agent.
- `backendNodeId` remains the node id local to its renderer.
- `frameId` identifies the frame that owns the node. It may be omitted for the
  top-level document.
- Capturing the snapshot must not activate, focus, or reload a frame.

Acceptance: one page contains a same-origin iframe and a cross-origin OOPIF,
with repeated backend node ids in different renderers. Every printed button and
textbox has a distinct ref, and each ref resolves to the node in its own frame.

ego-browser now backfills a missing `frameId` from the frame AX tree when one
backend node id has only one possible owner. Native metadata is still required
when renderer-local backend ids repeat, and for actionable frame nodes omitted
from `refs` entirely.

## Stable locator correctness

A stable locator must resolve uniquely to the same node that produced the
snapshot ref. It is invalid when it matches no node, matches more than one node,
or uniquely matches a different `backendNodeId`.

Please cover at least these cases in native tests:

- repeated controls in one document, such as buttons with the same name;
- a hidden copy and a visible editor sharing the same accessible name;
- the same role and name in the top-level document and an iframe;
- a locator whose element type does not match the source node.

Return `ambiguous` or `unstable`, or omit the locator, when uniqueness and node
identity cannot both be established. The JS runtime validates advertised
locators and downgrades invalid ones as a compatibility safeguard.
