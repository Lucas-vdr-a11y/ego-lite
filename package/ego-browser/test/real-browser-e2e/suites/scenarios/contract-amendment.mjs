import { scenarioCase } from "./scenario-case.mjs";

export const contractAmendmentScenarioCase = scenarioCase(
  "contract-amendment",
  `
    const amendment = page.locator(".contract-amendment");
    const clause = page.getByTestId("amendment-clause");
    const deletion = clause.locator("del");
    const insertion = clause.locator("ins");
    const initialSnapshot = await clause.ariaSnapshot({ ref: true });
    assertIncludes(
      initialSnapshot,
      "- deletion [ref=",
      "the initial structure tree exposes the removed clause as deletion",
    );
    assertIncludes(
      initialSnapshot,
      "- insertion [ref=",
      "the initial structure tree exposes the proposed clause as insertion",
    );

    const cdpSession = await task.context.newCDPSession(page);
    const rawEditRoles = {};
    try {
      const documentNode = await cdpSession.send("DOM.getDocument", {
        depth: 0,
      });
      for (const selector of ["del", "ins"]) {
        const editNode = await cdpSession.send("DOM.querySelector", {
          nodeId: documentNode.root.nodeId,
          selector: ".contract-amendment " + selector,
        });
        const describedNode = await cdpSession.send("DOM.describeNode", {
          nodeId: editNode.nodeId,
        });
        const backendNodeId = describedNode.node.backendNodeId;
        const editTree = await cdpSession.send(
          "Accessibility.getPartialAXTree",
          {
            backendNodeId,
            fetchRelatives: false,
          },
        );
        rawEditRoles[selector] = editTree.nodes.find(
          (candidate) => candidate.backendDOMNodeId === backendNodeId,
        )?.role?.value;
      }
    } finally {
      await cdpSession.detach();
    }
    assertEqual(
      rawEditRoles.del,
      "deletion",
      "raw Chromium AX exposes the native del element as deletion",
    );
    assertEqual(
      rawEditRoles.ins,
      "insertion",
      "raw Chromium AX exposes the native ins element as insertion",
    );
    assertIncludes(
      initialSnapshot,
      "- " + rawEditRoles.del + " [ref=",
      "the framework snapshot preserves Chromium's raw deletion role",
    );
    assertIncludes(
      initialSnapshot,
      "- " + rawEditRoles.ins + " [ref=",
      "the framework snapshot preserves Chromium's raw insertion role",
    );

    const freshEditSnapshot = await clause.ariaSnapshot({ ref: true });
    const freshDeletionRef = freshEditSnapshot
      .split("\\n")
      .find((line) => line.includes("- deletion [ref="))
      ?.match(/\\[ref=(s\\d+e\\d+)\\]/)?.[1];
    const freshInsertionRef = freshEditSnapshot
      .split("\\n")
      .find((line) => line.includes("- insertion [ref="))
      ?.match(/\\[ref=(s\\d+e\\d+)\\]/)?.[1];
    assert(freshDeletionRef, "the refreshed deletion snapshot exposes a ref");
    assert(freshInsertionRef, "the refreshed insertion snapshot exposes a ref");
    const referencedDeletion = page.locator("aria-ref=" + freshDeletionRef);
    const referencedInsertion = page.locator("aria-ref=" + freshInsertionRef);

    for (const [locator, tagName, text, label] of [
      [
        referencedDeletion,
        "DEL",
        "within 60 minutes of a severity-one incident",
        "deleted clause",
      ],
      [
        referencedInsertion,
        "INS",
        "within 30 minutes of a severity-one incident",
        "inserted clause",
      ],
    ]) {
      assertEqual(
        await locator.evaluate((element) => element.tagName),
        tagName,
        "the fresh ref resolves to the native " + tagName + " element",
      );
      assertEqual(
        (await locator.textContent()).trim(),
        text,
        "the " + label + " retains its exact visible wording",
      );
      assertEqual(
        await locator.getAttribute("cite"),
        "/change-requests/CR-482",
        "the " + label + " retains the authored same-origin citation",
      );
      assertEqual(
        await locator.getAttribute("datetime"),
        "2026-08-15T09:30:00+08:00",
        "the " + label + " retains its ISO amendment timestamp",
      );
      assertEqual(
        new URL(await locator.getAttribute("cite"), page.url()).origin,
        new URL(page.url()).origin,
        "the " + label + " citation resolves on the fixture origin",
      );
      const box = await locator.boundingBox();
      assert(
        box && box.width > 0 && box.height > 0,
        "the " + label + " occupies visible page geometry",
      );
    }
    assertEqual(
      new Date(await referencedDeletion.getAttribute("datetime")).toISOString(),
      "2026-08-15T01:30:00.000Z",
      "the authored amendment timestamp parses to the expected instant",
    );
    assertIncludes(
      await deletion.evaluate(
        (element) => getComputedStyle(element).textDecorationLine,
      ),
      "line-through",
      "the browser visibly strikes the deleted wording",
    );
    assertIncludes(
      await insertion.evaluate(
        (element) => getComputedStyle(element).textDecorationLine,
      ),
      "underline",
      "the browser visibly underlines the inserted wording",
    );

    const acceptAmendment = amendment.getByRole("button", {
      name: "Accept amendment",
      exact: true,
    });
    const historyAction = amendment.locator("[data-amendment-history]");
    const reviewStatus = page.getByTestId("amendment-review-status");
    assertEqual(
      await reviewStatus.textContent(),
      "Pending legal acceptance for CR-482.",
      "the review starts with a visible pending decision",
    );
    assertEqual(
      await acceptAmendment.isEnabled(),
      true,
      "the initial review can be accepted",
    );
    assertEqual(
      await historyAction.isEnabled(),
      false,
      "the amendment history is unavailable before acceptance",
    );

    await observedAction(page, acceptAmendment, "click");
    assertEqual(
      await amendment.getAttribute("data-amendment-state"),
      "accepted",
      "pointer acceptance records the business state",
    );
    assertEqual(
      await reviewStatus.textContent(),
      "Acceptance recorded for CR-482. The 30-minute clause is approved.",
      "pointer acceptance produces the visible accepted result",
    );
    assertEqual(
      await acceptAmendment.isEnabled(),
      false,
      "pointer acceptance disables duplicate submission",
    );
    assertEqual(
      await page.evaluate(() => document.activeElement === document.body),
      true,
      "disabling the activated Accept control leaves Chromium's real focus on the document",
    );
    assertEqual(
      await historyAction.textContent(),
      "Undo acceptance",
      "acceptance exposes the next valid history action",
    );
    assertEqual(
      await historyAction.isEnabled(),
      true,
      "acceptance enables amendment history",
    );
    assertEqual(
      await deletion.isVisible(),
      true,
      "acceptance keeps the deleted wording visible for audit",
    );
    assertEqual(
      await insertion.isVisible(),
      true,
      "acceptance keeps the inserted wording visible for audit",
    );
    const acceptedClauseSnapshot = await clause.ariaSnapshot({ ref: true });
    assertIncludes(
      acceptedClauseSnapshot,
      "deletion",
      "the accepted clause still exposes its deletion semantics",
    );
    assertIncludes(
      acceptedClauseSnapshot,
      "insertion",
      "the accepted clause still exposes its insertion semantics",
    );

    await observedPageKey(page, 'button "Undo acceptance"', "Tab");
    assertEqual(
      await historyAction.evaluate(
        (element) => element === document.activeElement,
      ),
      true,
      "Tab naturally moves from Accept to the enabled history action",
    );
    await observedPageKey(page, 'button "Undo acceptance"', "Enter");
    assertEqual(
      await amendment.getAttribute("data-amendment-state"),
      "pending",
      "keyboard undo restores the pending business state",
    );
    assertEqual(
      await reviewStatus.textContent(),
      "Acceptance withdrawn; CR-482 is pending again.",
      "keyboard undo produces a visible pending result",
    );
    assertEqual(
      await acceptAmendment.isEnabled(),
      true,
      "undo re-enables acceptance for the pending amendment",
    );
    assertEqual(
      await historyAction.textContent(),
      "Restore acceptance",
      "undo changes the same history control to Restore",
    );
    assertEqual(
      await historyAction.evaluate(
        (element) => element === document.activeElement,
      ),
      true,
      "undo keeps focus on the same history control without scripting focus",
    );

    await observedPageKey(page, 'button "Restore acceptance"', "Enter");
    assertEqual(
      await amendment.getAttribute("data-amendment-state"),
      "accepted",
      "keyboard restore returns the amendment to accepted",
    );
    assertEqual(
      await reviewStatus.textContent(),
      "Acceptance restored for CR-482. The 30-minute clause is approved.",
      "keyboard restore produces the final visible accepted result",
    );
    assertEqual(
      await acceptAmendment.isEnabled(),
      false,
      "restore disables duplicate acceptance again",
    );
    assertEqual(
      await historyAction.textContent(),
      "Undo acceptance",
      "restore changes the same history control back to Undo",
    );
    assertEqual(
      await historyAction.evaluate(
        (element) => element === document.activeElement,
      ),
      true,
      "restore keeps focus stable on the same history control",
    );
    assertEqual(
      await deletion.isVisible(),
      true,
      "the final accepted state still shows the deleted wording",
    );
    assertEqual(
      await insertion.isVisible(),
      true,
      "the final accepted state still shows the inserted wording",
    );

    const finalSnapshot = await amendment.ariaSnapshot({ ref: true });
    assertIncludes(
      finalSnapshot,
      "deletion",
      "the final structure retains native deletion semantics",
    );
    assertIncludes(
      finalSnapshot,
      "insertion",
      "the final structure retains native insertion semantics",
    );
    assertIncludes(
      finalSnapshot,
      "Acceptance restored for CR-482. The 30-minute clause is approved.",
      "the final structure exposes the restored business result",
    );
    assertIncludes(
      finalSnapshot,
      'button "Accept amendment" [disabled]',
      "the final structure reports duplicate acceptance as unavailable",
    );
    assertIncludes(
      finalSnapshot,
      'button "Undo acceptance"',
      "the final structure exposes the next valid Undo action",
    );
    assert(
      !finalSnapshot.includes('button "Restore acceptance"'),
      "the final structure reports Undo as the next valid history action",
    );
  `,
);
