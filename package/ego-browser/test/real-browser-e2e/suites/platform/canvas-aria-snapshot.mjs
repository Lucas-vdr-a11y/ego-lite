export const canvasAriaSnapshotCase = {
  name: "Native canvas ARIA snapshot refs",
  kind: "platform",
  body() {
    return `
      const task = await openE2eTaskSpace(taskName);
      const page = task.page;
      page.setDefaultTimeout(10_000);
      await page.goto(baseUrl + "/tests/visual-path", {
        waitUntil: "load",
        timeout: 20_000,
      });

      const canvas = page.locator("#visual-canvas");
      const canvasBounds = await canvas.boundingBox();
      assert(
        canvasBounds && canvasBounds.width > 0 && canvasBounds.height > 0,
        "the authored native canvas has non-zero user-visible geometry",
      );

      const cdpSession = await page.context().newCDPSession(page);
      try {
        const documentTree = await cdpSession.send("DOM.getDocument", {
          depth: 0,
        });
        const canvasQuery = await cdpSession.send("DOM.querySelector", {
          nodeId: documentTree.root.nodeId,
          selector: "#visual-canvas",
        });
        assert(canvasQuery.nodeId > 0, "CDP resolves the authored native canvas");
        const canvasDescription = await cdpSession.send("DOM.describeNode", {
          nodeId: canvasQuery.nodeId,
        });
        const canvasBackendNodeId = canvasDescription.node.backendNodeId;
        assert(
          canvasBackendNodeId > 0,
          "the native canvas has a stable backend DOM node",
        );

        const partialAxTree = await cdpSession.send(
          "Accessibility.getPartialAXTree",
          {
            backendNodeId: canvasBackendNodeId,
            fetchRelatives: false,
          },
        );
        const rawCanvasAxNode = partialAxTree.nodes.find(
          (node) => node.backendDOMNodeId === canvasBackendNodeId,
        );
        assertEqual(
          rawCanvasAxNode?.role?.value,
          "Canvas",
          "raw Chromium AX exposes the native canvas role",
        );
        assertEqual(
          rawCanvasAxNode?.name?.value,
          "Calibration drawing stage",
          "raw Chromium AX preserves the authored canvas name",
        );
        assertEqual(
          rawCanvasAxNode?.ignored,
          false,
          "raw Chromium AX does not ignore the visible native canvas",
        );

        function ariaRefFor(snapshot, accessibleName) {
          const line = String(snapshot)
            .split("\\n")
            .find((candidate) =>
              candidate.includes('"' + accessibleName + '"'),
            );
          return line?.match(/\\[ref=(s\\d+e\\d+)\\]/)?.[1] ?? null;
        }

        const accessibleName = "Calibration drawing stage";
        const scopedSnapshot = await canvas.ariaSnapshot({ ref: true });
        const scopedNamePresent = scopedSnapshot.includes(accessibleName);
        const scopedRef = ariaRefFor(scopedSnapshot, accessibleName);
        const scopedRefCount = scopedRef
          ? await page.locator("aria-ref=" + scopedRef).count()
          : 0;

        assert(
          scopedNamePresent && scopedRefCount === 1,
          "the scoped native canvas snapshot preserves its accessible name and an actionable ref" +
            " (scoped=" + JSON.stringify(scopedSnapshot) + ")",
        );
      } finally {
        await cdpSession.detach();
      }
    `;
  },
};
