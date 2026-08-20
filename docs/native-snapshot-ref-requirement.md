# Snapshot refs for iframe content

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

This is not required for JS session routing: ego-browser can already operate
frame content with semantic locators. It completes the snapshot/ref experience
without asking JS to parse and rewrite native snapshot text.
