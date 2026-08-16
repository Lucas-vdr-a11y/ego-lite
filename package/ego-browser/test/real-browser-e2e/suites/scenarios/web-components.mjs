import { scenarioCase } from "./scenario-case.mjs";

export const webComponentsScenarioCase = scenarioCase(
  "web-components",
  `
    await page.evaluate(() => customElements.whenDefined("shipment-card"));
    const primaryCard = page.locator("#primary-shipment");
    const secondaryCard = page.locator("#secondary-shipment");
    const template = page.locator("#shipment-card-template");
    const assertComposedPathOrder = (pathText, buttonToken, label) => {
      const buttonIndex = pathText.indexOf(buttonToken);
      const shadowRootIndex = pathText.indexOf("#shadow-root");
      const hostIndex = pathText.indexOf("shipment-card#primary-shipment");
      assert(buttonIndex >= 0, label + " contains the originating shadow button");
      assert(
        shadowRootIndex > buttonIndex,
        label + " crosses the shadow boundary after the button",
      );
      assert(
        hostIndex > shadowRootIndex,
        label + " reaches the host after the shadow boundary",
      );
    };
    const initialPageSnapshot = await page
      .locator("body")
      .ariaSnapshot({ ref: true });
    assertIncludes(
      initialPageSnapshot,
      'button "Begin shipment review"',
      "the light DOM exposes the keyboard entry point",
    );
    assertIncludes(
      initialPageSnapshot,
      'button "Review shipment"',
      "the composed tree exposes controls cloned into open shadow roots",
    );

    const templateState = await template.evaluate((element) => ({
      constructorName: element.constructor.name,
      contentButtons: element.content.querySelectorAll("button").length,
      contentSlots: element.content.querySelectorAll("slot").length,
      lightChildren: element.children.length,
    }));
    assertEqual(
      templateState.constructorName,
      "HTMLTemplateElement",
      "the shipment blueprint is a native HTMLTemplateElement",
    );
    assertEqual(
      templateState.contentButtons,
      2,
      "the inert template content retains both authored controls",
    );
    assertEqual(
      templateState.contentSlots,
      3,
      "the inert template content retains named and default slots",
    );
    assertEqual(
      templateState.lightChildren,
      0,
      "template children live in its inert DocumentFragment",
    );
    assertEqual(
      await template.isVisible(),
      false,
      "the template source itself never renders",
    );
    assertEqual(
      await template.locator("button").count(),
      0,
      "template controls do not leak into the live document tree",
    );
    assertEqual(
      await page.getByRole("button", { name: "Review shipment" }).count(),
      2,
      "only the two cloned shadow controls are interactive",
    );

    assertEqual(
      await primaryCard.evaluate((host) => host.shadowRoot.mode),
      "open",
      "the primary shipment uses an inspectable open shadow root",
    );
    assertEqual(
      await secondaryCard.evaluate((host) => host.shadowRoot.mode),
      "open",
      "the secondary shipment owns a separate open shadow root",
    );
    assertEqual(
      await page.evaluate(() => {
        const primary = document.querySelector("#primary-shipment");
        const secondary = document.querySelector("#secondary-shipment");
        return (
          primary.shadowRoot !== secondary.shadowRoot &&
          primary.shadowRoot.querySelector("[data-card-shell]") !==
            secondary.shadowRoot.querySelector("[data-card-shell]")
        );
      }),
      true,
      "each shipment receives an independent clone of the inert template",
    );

    const primarySnapshot = await primaryCard.ariaSnapshot({ ref: true });
    assertIncludes(
      primarySnapshot,
      "SG-2048",
      "the composed primary card renders its named reference slot",
    );
    assertIncludes(
      primarySnapshot,
      "Singapore to Shanghai",
      "the composed primary card renders its named route slot",
    );
    assertIncludes(
      primarySnapshot,
      "Cold-chain seal verified",
      "the composed primary card renders default-slot notes",
    );
    const secondarySnapshot = await secondaryCard.ariaSnapshot({ ref: true });
    assertIncludes(
      secondarySnapshot,
      "Unassigned shipment",
      "the empty secondary card renders reference fallback content",
    );
    assertIncludes(
      secondarySnapshot,
      "Route pending",
      "the empty secondary card renders route fallback content",
    );
    assertIncludes(
      secondarySnapshot,
      "No review notes supplied.",
      "the empty secondary card renders default-slot fallback content",
    );

    const initialAssignments = await primaryCard.evaluate((host) =>
      Object.fromEntries(
        Array.from(host.shadowRoot.querySelectorAll("slot")).map((slot) => [
          slot.name || "notes",
          slot
            .assignedElements({ flatten: true })
            .map((element) => element.id),
        ]),
      ),
    );
    assertEqual(
      JSON.stringify(initialAssignments),
      JSON.stringify({
        reference: ["primary-reference"],
        route: ["primary-route"],
        notes: ["primary-note"],
      }),
      "the primary named and default slots begin with one assigned element each",
    );
    const fallbackAssignments = await secondaryCard.evaluate((host) =>
      Object.fromEntries(
        Array.from(host.shadowRoot.querySelectorAll("slot")).map((slot) => [
          slot.name || "notes",
          slot.assignedElements({ flatten: true }).length,
        ]),
      ),
    );
    assertEqual(
      JSON.stringify(fallbackAssignments),
      JSON.stringify({ reference: 0, route: 0, notes: 0 }),
      "fallback content appears without fabricating assigned elements",
    );

    const beginReview = page.getByRole("button", {
      name: "Begin shipment review",
      exact: true,
    });
    await observedAction(page, beginReview, "click");
    const reviewButtonLine = 'button "Review shipment"';
    await observedPageKey(page, reviewButtonLine, "Tab");
    const primaryReviewButton = primaryCard.getByRole("button", {
      name: "Review shipment",
      exact: true,
    });
    const shadowFocus = await primaryCard.evaluate((host) => ({
      documentRetargeted: document.activeElement === host,
      shadowAction:
        host.shadowRoot.activeElement?.getAttribute("data-action") || "",
    }));
    assertEqual(
      shadowFocus.documentRetargeted,
      true,
      "document activeElement retargets shadow focus to the custom host",
    );
    assertEqual(
      shadowFocus.shadowAction,
      "review",
      "the open shadow root exposes its truly focused Review button",
    );
    assertEqual(
      await primaryReviewButton.evaluate(
        (element) => element === element.getRootNode().activeElement,
      ),
      true,
      "Tab reaches the first shadow control through normal focus navigation",
    );

    await observedPageKey(page, reviewButtonLine, "Enter");
    assertEqual(
      await primaryCard.locator("[data-shadow-status]").textContent(),
      "Reviewed SG-2048",
      "Enter activates Review and updates only the primary shadow status",
    );
    assertEqual(
      await secondaryCard.locator("[data-shadow-status]").textContent(),
      "Awaiting review",
      "the second template clone keeps independent state",
    );
    assertEqual(
      await primaryCard.getAttribute("data-reviewed"),
      "true",
      "the reviewed state belongs to the primary host",
    );
    assertEqual(
      await secondaryCard.getAttribute("data-reviewed"),
      null,
      "the fallback host is not mutated by its sibling review",
    );
    assertEqual(
      await page.getByTestId("shadow-reviewed-count").textContent(),
      "1 of 2 shipments reviewed",
      "the composed custom event updates the visible aggregate",
    );
    const reviewClickPath = await page
      .getByTestId("shadow-click-path")
      .textContent();
    assertIncludes(
      reviewClickPath,
      "composed=true; trusted=true",
      "keyboard activation produces a trusted composed native click",
    );
    assertComposedPathOrder(
      reviewClickPath,
      "button[review]",
      "the trusted native click path",
    );
    const reviewCustomEventPath = await page
      .getByTestId("shadow-custom-event-path")
      .textContent();
    assertIncludes(
      reviewCustomEventPath,
      "composed=true; shipment=SG-2048",
      "the review handler emits the authored composed custom event",
    );
    assertComposedPathOrder(
      reviewCustomEventPath,
      "button[review]",
      "the authored custom event path",
    );

    const beforeSwapSnapshot = await primaryCard.ariaSnapshot({ ref: true });
    const swapLine = beforeSwapSnapshot
      .split("\\n")
      .find((line) => line.includes('button "Swap route and notes"'));
    const freshSwapRef = swapLine?.match(/\\[ref=(s\\d+e\\d+)\\]/)?.[1];
    assert(
      freshSwapRef,
      "the refreshed composed snapshot gives the shadow Swap button a ref",
    );
    const freshSwapButton = page.locator("aria-ref=" + freshSwapRef);
    await observedAction(page, freshSwapButton, "click");
    const swappedAssignments = await primaryCard.evaluate((host) =>
      Object.fromEntries(
        Array.from(host.shadowRoot.querySelectorAll("slot")).map((slot) => [
          slot.name || "notes",
          slot
            .assignedElements({ flatten: true })
            .map((element) => element.id),
        ]),
      ),
    );
    assertEqual(
      JSON.stringify(swappedAssignments),
      JSON.stringify({
        reference: ["primary-reference"],
        route: ["primary-note"],
        notes: ["primary-route"],
      }),
      "the real shadow button swaps named-route and default-note assignments",
    );
    const swappedSnapshot = await primaryCard.ariaSnapshot({ ref: true });
    const swappedNotesIndex = swappedSnapshot.indexOf(
      "Cold-chain seal verified",
    );
    const swappedRouteIndex = swappedSnapshot.indexOf(
      "Singapore to Shanghai",
    );
    assert(
      swappedNotesIndex >= 0,
      "the swapped composed snapshot still exposes the assigned notes text",
    );
    assert(
      swappedRouteIndex >= 0,
      "the swapped composed snapshot still exposes the assigned route text",
    );
    assert(
      swappedNotesIndex < swappedRouteIndex,
      "the visible composed snapshot follows the dynamically reassigned slot order",
    );
    assertIncludes(
      await primaryCard.locator("[data-shadow-status]").textContent(),
      "route and notes swapped",
      "the swap produces a visible card-local result",
    );
    const swapClickPath = await page
      .getByTestId("shadow-click-path")
      .textContent();
    assertIncludes(
      swapClickPath,
      "composed=true; trusted=true",
      "the fresh-ref pointer action produces a trusted composed click",
    );
    assertComposedPathOrder(
      swapClickPath,
      "button[swap]",
      "the fresh-ref Swap click path",
    );
    assertEqual(
      await secondaryCard.locator("[data-shadow-status]").textContent(),
      "Awaiting review",
      "dynamic slot reassignment stays isolated from the fallback card",
    );

    const finalSnapshot = await primaryCard.ariaSnapshot({ ref: true });
    const cdpSession = await task.context.newCDPSession(page);
    let rawReviewButton;
    let rawSwapButton;
    try {
      const rawShadowAxNode = async (action) => {
        const remote = await cdpSession.send("Runtime.evaluate", {
          expression:
            "document.querySelector('#primary-shipment').shadowRoot.querySelector(" +
            JSON.stringify('[data-action="' + action + '"]') +
            ")",
          objectGroup: "web-components-ax",
        });
        assert(remote.result.objectId, "CDP resolves the shadow " + action + " control");
        const describedNode = await cdpSession.send("DOM.describeNode", {
          objectId: remote.result.objectId,
        });
        const backendNodeId = describedNode.node.backendNodeId;
        const tree = await cdpSession.send(
          "Accessibility.getPartialAXTree",
          {
            backendNodeId,
            fetchRelatives: false,
          },
        );
        return tree.nodes.find(
          (candidate) => candidate.backendDOMNodeId === backendNodeId,
        );
      };
      rawReviewButton = await rawShadowAxNode("review");
      rawSwapButton = await rawShadowAxNode("swap");
    } finally {
      await cdpSession.send("Runtime.releaseObjectGroup", {
        objectGroup: "web-components-ax",
      });
      await cdpSession.detach();
    }
    assertEqual(
      rawReviewButton?.role?.value,
      "button",
      "raw Chromium AX exposes the cloned Review control as a button",
    );
    assertEqual(
      rawReviewButton?.name?.value,
      "Review shipment",
      "raw Chromium AX names the cloned Review control",
    );
    assertEqual(
      rawSwapButton?.role?.value,
      "button",
      "raw Chromium AX exposes the cloned Swap control as a button",
    );
    assertEqual(
      rawSwapButton?.name?.value,
      "Swap route and notes",
      "raw Chromium AX names the cloned Swap control",
    );
    assertIncludes(
      finalSnapshot,
      'button "Review shipment"',
      "the framework snapshot preserves the raw Review button semantics",
    );
    assertIncludes(
      finalSnapshot,
      'button "Swap route and notes"',
      "the framework snapshot preserves the raw Swap button semantics",
    );
  `,
);
