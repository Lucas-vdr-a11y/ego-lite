import { scenarioCase } from "./scenario-case.mjs";

export const interactiveElementsScenarioCase = scenarioCase(
  "interactive-elements",
  `
    const surface = page.locator(".interactive-elements");
    const details = page.getByTestId("shipment-terms");
    const summary = details.locator("summary");
    const detailsStatus = page.getByTestId("details-toggle-status");
    const geolocation = page.getByTestId("dispatch-geolocation");
    const geolocationStatus = page.getByTestId(
      "geolocation-validation-status",
    );
    const manualLocationFallback = surface.getByRole("button", {
      name: "Use manual dispatch zone",
      exact: true,
    });
    const openDispatchDialog = surface.getByRole("button", {
      name: "Open dispatch decision",
      exact: true,
    });
    const dialog = page.locator("#dispatch-decision-dialog");
    const dialogStatus = page.getByTestId("dialog-decision-status");
    const backgroundStatus = page.getByTestId(
      "interactive-background-status",
    );

    const summarySnapshot = await summary.ariaSnapshot({ ref: true });
    const summaryCdp = await task.context.newCDPSession(page);
    let rawSummary;
    try {
      const documentNode = await summaryCdp.send("DOM.getDocument", {
        depth: 0,
      });
      const summaryNode = await summaryCdp.send("DOM.querySelector", {
        nodeId: documentNode.root.nodeId,
        selector: ".interactive-elements summary",
      });
      const summaryDescription = await summaryCdp.send("DOM.describeNode", {
        nodeId: summaryNode.nodeId,
      });
      const summaryTree = await summaryCdp.send(
        "Accessibility.getPartialAXTree",
        {
          nodeId: summaryNode.nodeId,
          fetchRelatives: false,
        },
      );
      rawSummary = summaryTree.nodes.find(
        (candidate) =>
          candidate.backendDOMNodeId ===
          summaryDescription.node.backendNodeId,
      );
    } finally {
      await summaryCdp.detach();
    }
    assertEqual(
      rawSummary?.role?.value,
      "DisclosureTriangle",
      "raw Chromium AX exposes summary as an actionable disclosure triangle",
    );
    assertEqual(
      rawSummary?.name?.value,
      "Review Shanghai shipment terms",
      "raw Chromium AX names the native summary from visible text",
    );
    assertEqual(
      rawSummary?.properties?.find(
        (property) => property.name === "focusable",
      )?.value?.value,
      true,
      "raw Chromium AX reports the native summary as focusable",
    );
    const summaryBox = await summary.boundingBox();
    assert(
      summaryBox && summaryBox.width > 0 && summaryBox.height > 0,
      "the native summary occupies visible pointer geometry",
    );
    const summaryOperationRefMissing = !summarySnapshot.includes("[ref=");

    await observedBoxGesture(
      page,
      summary,
      "open native shipment terms",
      async (pointer, box) => {
        await pointer.move(box.x + box.width / 2, box.y + box.height / 2);
        await pointer.down();
        await pointer.up();
      },
    );
    await page.locator("details[open]").waitFor({ state: "attached" });
    await page
      .getByText("Shipment terms expanded.", { exact: true })
      .waitFor();
    assertEqual(
      await details.getAttribute("open"),
      "",
      "a real pointer press opens the native details element",
    );
    assertEqual(
      await detailsStatus.getAttribute("data-toggle-state"),
      "expanded",
      "the visible toggle state records pointer expansion",
    );
    assertEqual(
      await summary.evaluate((element) => element === document.activeElement),
      true,
      "pointer activation leaves native focus on summary",
    );

    await observedPageKey(
      page,
      'Review Shanghai shipment terms',
      "Enter",
    );
    await page.locator("details:not([open])").waitFor({ state: "attached" });
    await page
      .getByText("Shipment terms collapsed.", { exact: true })
      .waitFor();
    assertEqual(
      await details.getAttribute("open"),
      null,
      "Enter collapses the focused native details element",
    );
    assertEqual(
      await detailsStatus.getAttribute("data-toggle-state"),
      "collapsed",
      "the visible toggle state records keyboard collapse",
    );

    await observedPageKey(
      page,
      'Review Shanghai shipment terms',
      "Space",
    );
    await page.locator("details[open]").waitFor({ state: "attached" });
    await page
      .getByText("Shipment terms expanded.", { exact: true })
      .waitFor();
    assertEqual(
      await details.getAttribute("open"),
      "",
      "Space reopens the focused native details element",
    );
    assertEqual(
      await summary.evaluate((element) => element === document.activeElement),
      true,
      "native summary focus remains stable after Space",
    );

    const geolocationStateBefore = await geolocation.evaluate((element) => ({
      constructorName: element.constructor.name,
      tagName: element.tagName,
      permissionStatus: element.permissionStatus,
    }));
    const geolocationSupported =
      geolocationStateBefore.constructorName === "HTMLGeolocationElement";
    let rawGeolocation;
    let geolocationSnapshotMissingRawButton = false;

    if (geolocationSupported) {
      await geolocation.scrollIntoViewIfNeeded();
      await page
        .locator(
          '[data-testid="geolocation-validation-status"]' +
            '[data-validation-history*="intersection_changed"]' +
            '[data-validation-history$="valid"]',
        )
        .waitFor({ state: "attached" });
      const validationHistory =
        (await geolocationStatus.getAttribute("data-validation-history")) || "";
      assert(
        validationHistory.indexOf("intersection_changed") <
          validationHistory.lastIndexOf("valid"),
        "native validation transitions from intersection_changed to valid",
      );
      assertEqual(
        await geolocationStatus.textContent(),
        "Native geolocation control is valid; permission has not been requested.",
        "validation produces a visible status without requesting permission",
      );
      assertEqual(
        geolocationStateBefore.tagName,
        "GEOLOCATION",
        "the browser preserves the native geolocation tag",
      );
      const geolocationBox = await geolocation.boundingBox();
      assert(
        geolocationBox &&
          geolocationBox.width > 0 &&
          geolocationBox.height > 0,
        "the native geolocation control occupies visible geometry",
      );
      assertEqual(
        await manualLocationFallback.isVisible(),
        false,
        "the manual fallback stays unavailable when native geolocation is supported",
      );

      await observedPageKey(
        page,
        'Review Shanghai shipment terms',
        "Tab",
      );
      assertEqual(
        await geolocation.evaluate(
          (element) => element === document.activeElement,
        ),
        true,
        "Tab genuinely focuses the supported native geolocation control",
      );
      assertEqual(
        await geolocation.evaluate((element) => element.permissionStatus),
        geolocationStateBefore.permissionStatus,
        "focus alone leaves geolocation permission unchanged",
      );

      const geolocationCdp = await task.context.newCDPSession(page);
      try {
        const documentNode = await geolocationCdp.send("DOM.getDocument", {
          depth: 0,
        });
        const geolocationNode = await geolocationCdp.send(
          "DOM.querySelector",
          {
            nodeId: documentNode.root.nodeId,
            selector: ".interactive-elements geolocation",
          },
        );
        const geolocationDescription = await geolocationCdp.send(
          "DOM.describeNode",
          { nodeId: geolocationNode.nodeId },
        );
        const geolocationTree = await geolocationCdp.send(
          "Accessibility.getPartialAXTree",
          {
            nodeId: geolocationNode.nodeId,
            fetchRelatives: false,
          },
        );
        rawGeolocation = geolocationTree.nodes.find(
          (candidate) =>
            candidate.backendDOMNodeId ===
            geolocationDescription.node.backendNodeId,
        );
      } finally {
        await geolocationCdp.detach();
      }
      assertEqual(
        rawGeolocation?.role?.value,
        "button",
        "raw Chromium AX exposes supported geolocation as a button",
      );
      assert(
        String(rawGeolocation?.name?.value || "").length > 0,
        "raw Chromium AX gives the supported geolocation button a name",
      );
      const geolocationSnapshot = await geolocation.ariaSnapshot({
        ref: true,
      });
      geolocationSnapshotMissingRawButton =
        !geolocationSnapshot.includes("button") ||
        !geolocationSnapshot.includes("[ref=");
    } else {
      assertEqual(
        geolocationStateBefore.constructorName,
        "HTMLElement",
        "the fallback branch is used only when native geolocation is absent",
      );
      await observedPageKey(
        page,
        'Review Shanghai shipment terms',
        "Tab",
      );
      assertEqual(
        await manualLocationFallback.evaluate(
          (element) => element === document.activeElement,
        ),
        true,
        "Tab reaches the nested manual fallback in unsupported browsers",
      );
      await observedAction(page, manualLocationFallback, "click");
      assertEqual(
        await geolocationStatus.textContent(),
        "Manual dispatch zone selected.",
        "a real fallback click records the manual dispatch zone",
      );
    }

    await observedAction(page, openDispatchDialog, "click");
    await page.locator("#dispatch-decision-dialog:modal").waitFor();
    const confirmDecision = dialog.getByRole("button", {
      name: "Confirm dispatch",
      exact: true,
    });
    const cancelDecision = dialog.getByRole("button", {
      name: "Cancel decision",
      exact: true,
    });
    assertEqual(
      await dialog.evaluate((element) => element.matches(":modal")),
      true,
      "pointer activation opens a true modal dialog",
    );
    assertEqual(
      await confirmDecision.evaluate(
        (element) => element === document.activeElement,
      ),
      true,
      "the modal applies native autofocus to Confirm",
    );
    const dialogBox = await dialog.boundingBox();
    assert(
      dialogBox && dialogBox.width > 0 && dialogBox.height > 0,
      "the modal dialog occupies visible geometry",
    );

    const modalSnapshot = await page
      .locator("body")
      .ariaSnapshot({ ref: true });
    const modalSnapshotExposesBackgroundRef = modalSnapshot
      .split("\\n")
      .some(
        (line) =>
          line.includes('button "Open dispatch decision"') &&
          line.includes("[ref="),
      );
    const modalCdp = await task.context.newCDPSession(page);
    let rawModalNodes;
    try {
      const fullTree = await modalCdp.send("Accessibility.getFullAXTree");
      rawModalNodes = fullTree.nodes.filter(
        (candidate) => candidate.ignored !== true,
      );
    } finally {
      await modalCdp.detach();
    }
    assertEqual(
      rawModalNodes.some((candidate) =>
        String(candidate.name?.value || "").includes(
          "Open dispatch decision",
        ),
      ),
      false,
      "raw Chromium AX excludes the inert background opener while modal",
    );
    assert(
      rawModalNodes.some(
        (candidate) =>
          candidate.role?.value === "dialog" &&
          candidate.name?.value === "Confirm dispatch readiness",
      ),
      "raw Chromium AX exposes the named modal dialog",
    );

    await observedPageKey(
      page,
      'dialog "Confirm dispatch readiness"',
      "Escape",
    );
    await page
      .locator("#dispatch-decision-dialog:not([open])")
      .waitFor({ state: "attached" });
    await page
      .getByText("Dispatch decision dismissed with Escape.", { exact: true })
      .waitFor();
    assertEqual(
      await dialog.getAttribute("open"),
      null,
      "Escape closes the modal through native cancellation",
    );
    assertEqual(
      await dialog.evaluate((element) => element.returnValue),
      "",
      "Escape preserves an empty dialog returnValue",
    );
    assertEqual(
      await openDispatchDialog.evaluate(
        (element) => element === document.activeElement,
      ),
      true,
      "Escape returns focus to the dialog opener",
    );

    await observedAction(page, openDispatchDialog, "click");
    await page.locator("#dispatch-decision-dialog:modal").waitFor();
    await observedAction(page, cancelDecision, "click");
    await page
      .locator("#dispatch-decision-dialog:not([open])")
      .waitFor({ state: "attached" });
    await page
      .getByText("Dispatch decision cancelled.", { exact: true })
      .waitFor();
    assertEqual(
      await dialog.evaluate((element) => element.returnValue),
      "cancel",
      "pointer Cancel closes the form dialog with its authored value",
    );
    assertEqual(
      await openDispatchDialog.evaluate(
        (element) => element === document.activeElement,
      ),
      true,
      "pointer Cancel returns focus to the dialog opener",
    );

    await observedAction(page, openDispatchDialog, "click");
    await page.locator("#dispatch-decision-dialog:modal").waitFor();
    assertEqual(
      await confirmDecision.evaluate(
        (element) => element === document.activeElement,
      ),
      true,
      "the final modal opening again autofocuses Confirm",
    );
    await observedPageKey(
      page,
      'button "Confirm dispatch"',
      "Enter",
    );
    await page
      .locator("#dispatch-decision-dialog:not([open])")
      .waitFor({ state: "attached" });
    await page
      .getByText("Dispatch readiness confirmed.", { exact: true })
      .waitFor();
    assertEqual(
      await dialog.evaluate((element) => element.returnValue),
      "confirmed",
      "Enter confirms the native form dialog with its authored value",
    );
    assertEqual(
      await dialog.evaluate((element) => element.matches(":modal")),
      false,
      "the confirmed dialog is no longer modal",
    );
    assertEqual(
      await openDispatchDialog.evaluate(
        (element) => element === document.activeElement,
      ),
      true,
      "keyboard Confirm returns focus to the dialog opener",
    );
    assertEqual(
      await dialogStatus.textContent(),
      "Dispatch readiness confirmed.",
      "the final visible business result records confirmation",
    );
    assertEqual(
      await backgroundStatus.isVisible(),
      true,
      "the background dispatch board is usable again after all modals close",
    );

    const frameworkGaps = [];
    if (summaryOperationRefMissing) {
      frameworkGaps.push(
        "summary raw DisclosureTriangle has no operation ref",
      );
    }
    if (geolocationSupported && geolocationSnapshotMissingRawButton) {
      frameworkGaps.push(
        "supported geolocation raw button is absent from snapshot",
      );
    }
    if (modalSnapshotExposesBackgroundRef) {
      frameworkGaps.push("modal snapshot exposes an inert background button ref");
    }
    assertEqual(
      JSON.stringify(frameworkGaps),
      "[]",
      "the framework preserves native interactive semantics after the real journey: " +
        frameworkGaps.join("; "),
    );
  `,
);
