import { scenarioCase } from "./scenario-case.mjs";

export const tableSemanticsScenarioCase = scenarioCase(
  "table-semantics",
  `
    const table = page.getByRole("table", {
      name: "Transfer commitments for 15 August 2026",
      exact: true,
    });
    const initialSnapshot = await table.ariaSnapshot({ ref: true });
    assertIncludes(
      initialSnapshot,
      'table "Transfer commitments for 15 August 2026"',
      "the caption gives the native table an accessible name",
    );
    assertIncludes(
      initialSnapshot,
      'button "ETA"',
      "the sortable arrival column exposes its native button",
    );
    assertIncludes(
      initialSnapshot,
      'checkbox "Review Singapore to Shanghai transfer"',
      "the transfer queue exposes its first review choice",
    );

    assertEqual(
      await table.evaluate((element) => element.tagName),
      "TABLE",
      "the allocation surface uses a native table root",
    );
    for (const [tagName, expectedCount] of Object.entries({
      caption: 1,
      colgroup: 1,
      col: 5,
      thead: 1,
      tbody: 2,
      tfoot: 1,
      tr: 7,
      th: 14,
      td: 19,
    })) {
      assertEqual(
        await table.locator(tagName).count(),
        expectedCount,
        "the rendered transfer table contains " + expectedCount + " " + tagName,
      );
    }
    assertEqual(
      await table
        .locator("col")
        .evaluateAll((columns) =>
          columns.reduce((total, column) => total + column.span, 0),
        ),
      6,
      "five col elements account for all six visible table columns",
    );
    const columnGeometry = await table.locator("col").evaluateAll((columns) =>
      columns.map((column) => ({
        span: column.span,
        width: column.getBoundingClientRect().width,
        height: column.getBoundingClientRect().height,
      })),
    );
    assert(
      columnGeometry.every(
        (column) => column.width > 0 && column.height > 0,
      ),
      "every authored column participates in the visible table layout",
    );
    assert(
      columnGeometry[2].span === 2 &&
        columnGeometry[2].width > columnGeometry[0].width,
      "the commitment col spans two visibly rendered columns",
    );
    assertEqual(
      await table.locator("#commitment-header").getAttribute("scope"),
      "colgroup",
      "the commitment heading natively spans its two data columns",
    );
    assertEqual(
      await table.locator("#origin-singapore").getAttribute("scope"),
      "rowgroup",
      "the Singapore heading natively spans its route group",
    );
    assertIncludes(
      await table.locator('tr[data-route="singapore-shanghai"] td').first().getAttribute("headers"),
      "commitment-header",
      "the first cases cell retains its explicit cross-row and cross-column headers",
    );

    const etaSort = table.getByRole("button", { name: "ETA", exact: true });
    const singaporeDestinations = table.locator(
      'tbody[data-origin="Singapore"] th[scope="row"]',
    );
    const malaysiaDestinations = table.locator(
      'tbody[data-origin="Malaysia"] th[scope="row"]',
    );

    await observedAction(page, etaSort, "click");
    assertEqual(
      await table.locator("#eta-header").getAttribute("aria-sort"),
      "ascending",
      "pointer sorting records the ascending ETA state",
    );
    assertEqual(
      (await singaporeDestinations.allTextContents()).join("|"),
      "Tokyo|Shanghai",
      "ascending ETA sort reorders the Singapore transfer queue",
    );
    assertEqual(
      (await malaysiaDestinations.allTextContents()).join("|"),
      "Shanghai|Seoul",
      "ascending ETA sort reorders the Malaysia transfer queue",
    );
    assertEqual(
      await table
        .locator('tbody[data-origin="Singapore"] tr')
        .first()
        .locator('th[scope="rowgroup"]')
        .count(),
      1,
      "sorting keeps the Singapore row-group heading on the first visible route",
    );
    assertEqual(
      await page.getByTestId("transfer-review-status").textContent(),
      "Transfers sorted by ETA ascending.",
      "pointer sorting produces a visible operational status",
    );

    assertEqual(
      await etaSort.evaluate((element) => element === document.activeElement),
      true,
      "the pointer-sorted ETA control remains focused for keyboard follow-up",
    );
    await observedPageKey(page, 'button "ETA"', "Enter");
    assertEqual(
      await table.locator("#eta-header").getAttribute("aria-sort"),
      "descending",
      "Enter toggles the ETA column to descending order",
    );
    assertEqual(
      (await singaporeDestinations.allTextContents()).join("|"),
      "Shanghai|Tokyo",
      "keyboard sorting reverses the Singapore transfer queue",
    );
    assertEqual(
      (await malaysiaDestinations.allTextContents()).join("|"),
      "Seoul|Shanghai",
      "keyboard sorting reverses the Malaysia transfer queue",
    );
    assertEqual(
      await etaSort.evaluate((element) => element === document.activeElement),
      true,
      "the native sort button retains focus after keyboard activation",
    );

    const reviewCheckboxSnapshotLine =
      'checkbox "Review Singapore to Shanghai transfer"';
    const shanghaiReview = table.getByRole("checkbox", {
      name: "Review Singapore to Shanghai transfer",
      exact: true,
    });
    await observedPageKey(page, reviewCheckboxSnapshotLine, "Tab");
    assertEqual(
      await shanghaiReview.evaluate(
        (element) => element === document.activeElement,
      ),
      true,
      "Tab moves from the ETA header into the first descending review choice",
    );
    await observedPageKey(page, reviewCheckboxSnapshotLine, "Space");
    assertEqual(
      await shanghaiReview.isChecked(),
      true,
      "Space selects the focused Singapore to Shanghai route",
    );
    assertEqual(
      await table
        .locator('tr[data-route="singapore-shanghai"]')
        .getAttribute("data-selected"),
      "true",
      "the selected route receives visible row emphasis",
    );
    assertEqual(
      await page.getByTestId("selected-cases").textContent(),
      "120 cases",
      "the table footer totals the selected committed cases",
    );
    assertEqual(
      await page.getByTestId("selected-value").textContent(),
      "S$48,000",
      "the table footer totals the selected committed value",
    );
    assertEqual(
      await page.getByTestId("review-readiness").textContent(),
      "1 route ready for review",
      "the table footer reports that one route is ready",
    );
    assertEqual(
      await page.getByTestId("transfer-review-status").textContent(),
      "Singapore to Shanghai transfer selected.",
      "keyboard selection produces a visible operational status",
    );

    await observedAction(page, etaSort, "click");
    assertEqual(
      await table.locator("#eta-header").getAttribute("aria-sort"),
      "ascending",
      "the second pointer sort restores ascending order",
    );
    assertEqual(
      await shanghaiReview.isChecked(),
      true,
      "selection survives a real DOM row reorder",
    );
    assertEqual(
      await page.getByTestId("selected-cases").textContent(),
      "120 cases",
      "case totals survive the selected row reorder",
    );
    assertEqual(
      await page.getByTestId("selected-value").textContent(),
      "S$48,000",
      "value totals survive the selected row reorder",
    );

    const selectedSnapshot = await table.ariaSnapshot({ ref: true });
    const selectedLine = selectedSnapshot
      .split("\\n")
      .find((line) =>
        line.includes('checkbox "Review Singapore to Shanghai transfer"'),
      );
    assertIncludes(
      selectedLine || "",
      "[checked]",
      "the refreshed structure tree exposes the selected checkbox state",
    );
    const selectedRef = selectedLine?.match(/\\[ref=(s\\d+e\\d+)\\]/)?.[1];
    assert(
      selectedRef,
      "the refreshed structure tree gives the selected route a usable ref",
    );
    const referencedReview = page.locator("aria-ref=" + selectedRef);
    assertEqual(
      await referencedReview.evaluate((element) => element.tagName),
      "INPUT",
      "the selected route ref resolves to the native checkbox",
    );
    assertEqual(
      await referencedReview.isChecked(),
      true,
      "the selected route ref preserves its authoritative checked state",
    );

    const groupHeaderSnapshot = await table.ariaSnapshot({ ref: true });
    const cdpSession = await task.context.newCDPSession(page);
    let commitmentAx;
    let singaporeAx;
    try {
      const documentNode = await cdpSession.send("DOM.getDocument", {
        depth: 0,
      });
      const rawAxNode = async (selector) => {
        const domNode = await cdpSession.send("DOM.querySelector", {
          nodeId: documentNode.root.nodeId,
          selector,
        });
        const describedNode = await cdpSession.send("DOM.describeNode", {
          nodeId: domNode.nodeId,
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
      commitmentAx = await rawAxNode("#commitment-header");
      singaporeAx = await rawAxNode("#origin-singapore");
    } finally {
      await cdpSession.detach();
    }
    assertEqual(
      commitmentAx?.role?.value,
      "columnheader",
      "Chromium exposes the native colgroup heading as a columnheader",
    );
    assertEqual(
      commitmentAx?.name?.value,
      "Commitment",
      "Chromium names the native colgroup heading",
    );
    assertEqual(
      singaporeAx?.role?.value,
      "rowheader",
      "Chromium exposes the native rowgroup heading as a rowheader",
    );
    assertEqual(
      singaporeAx?.name?.value,
      "Singapore",
      "Chromium names the native rowgroup heading",
    );

    const missingGroupHeaderSemantics = [
      ['columnheader "Commitment"', "Commitment columnheader"],
      ['rowheader "Singapore"', "Singapore rowheader"],
    ]
      .filter(([expected]) => !groupHeaderSnapshot.includes(expected))
      .map(([, label]) => label);
    assertEqual(
      missingGroupHeaderSemantics.join(", "),
      "",
      "the framework snapshot preserves Chromium grouped table-header semantics:\\n" +
        groupHeaderSnapshot,
    );
  `,
);
