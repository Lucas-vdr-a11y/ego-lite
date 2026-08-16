import { scenarioCase } from "./scenario-case.mjs";

export const textContentScenarioCase = scenarioCase(
  "text-content",
  `
    const handoffSnapshot = await page.locator("body").ariaSnapshot({ ref: true });
    assertIncludes(
      handoffSnapshot,
      'figure "Incident event log, all times in Singapore Standard Time."',
      "the structure tree exposes the event log as a named figure",
    );
    assertIncludes(
      handoffSnapshot,
      'list "Incident review actions"',
      "the structure tree exposes the native command menu as a list",
    );
    assertIncludes(
      handoffSnapshot,
      'button "Mark handoff reviewed" [disabled]',
      "the structure tree reports the gated handoff action",
    );
    const handoff = page.locator(".text-content-handoff");
    assertEqual(
      await handoff.getByRole("blockquote").count(),
      1,
      "the original incident report keeps its native quote role",
    );
    assertEqual(
      await handoff.getByRole("term").count(),
      3,
      "the structure exposes each description term",
    );
    assertEqual(
      await handoff.getByRole("definition").count(),
      3,
      "the structure exposes each description value",
    );
    assertEqual(
      await handoff.getByRole("separator").count(),
      1,
      "the evidence and review areas retain their native separator",
    );
    assertEqual(
      await handoff.getByRole("menu").count(),
      0,
      "the HTML menu is not misreported as an ARIA application menu",
    );
    assertEqual(
      await handoff.getByRole("list", { name: "Incident review actions" }).count(),
      1,
      "the HTML menu retains its native list semantics",
    );

    const contentLayout = handoff.locator(":scope > .text-content-layout");
    const quoteParagraph = handoff.locator("blockquote > p");
    const signalsList = handoff
      .locator('section[aria-labelledby="signals-heading"]')
      .locator("ul");
    const followUpList = handoff
      .locator('section[aria-labelledby="follow-up-heading"]')
      .locator("ol");
    const firstSignal = signalsList.locator(":scope > li").first();
    for (const [locator, tagName, label] of [
      [contentLayout, "DIV", "incident handoff layout"],
      [quoteParagraph, "P", "incident report paragraph"],
      [signalsList, "UL", "reviewed signals list"],
      [followUpList, "OL", "overnight follow-up list"],
      [firstSignal, "LI", "first reviewed signal"],
    ]) {
      assertEqual(
        await locator.evaluate((element) => element.tagName),
        tagName,
        "the rendered handoff preserves the native " + label + " element",
      );
      const box = await locator.boundingBox();
      assert(
        box && box.width > 0 && box.height > 0,
        "the " + label + " occupies visible page geometry",
      );
    }
    assertIncludes(
      await contentLayout.textContent(),
      "Checkout latency handoff",
      "the div layout visibly retains the incident being handed off",
    );
    assertEqual(
      await quoteParagraph.innerText(),
      "Error rates returned to baseline after the Singapore cache pool was replaced. No customer orders were lost.",
      "the paragraph preserves the supplier-visible incident conclusion",
    );
    assertEqual(
      (await signalsList.locator(":scope > li").allTextContents()).join("|"),
      "Checkout p95 returned below 420 ms.|Payment authorization errors remained below 0.2%.|No queue backlog remained after cache recovery.",
      "the unordered list preserves all reviewed signals in business order",
    );
    assertEqual(
      (await followUpList.locator(":scope > li").allTextContents()).join("|"),
      "Recheck regional latency at 23:00 SGT.|Compare cache evictions with the seven-day baseline.|Close the incident after the morning owner signs off.",
      "the ordered list preserves the overnight sequence in business order",
    );
    assertEqual(
      await handoff.locator("li").count(),
      8,
      "the handoff renders six evidence items and two review actions as list items",
    );
    const signalSnapshot = await signalsList.ariaSnapshot({ ref: true });
    assertIncludes(
      signalSnapshot,
      "- list [ref=",
      "the unordered list remains a native list in the structure tree",
    );
    assertIncludes(
      signalSnapshot,
      "- listitem [ref=",
      "the unordered evidence remains exposed as native list items",
    );
    const followUpSnapshot = await followUpList.ariaSnapshot({ ref: true });
    assertIncludes(
      followUpSnapshot,
      "- list [ref=",
      "the ordered follow-up remains a native list in the structure tree",
    );
    assertIncludes(
      followUpSnapshot,
      "- listitem [ref=",
      "the ordered follow-up remains exposed as native list items",
    );

    const incidentLog = page.getByTestId("incident-event-log");
    assertEqual(
      await incidentLog.textContent(),
      "14:02 alert opened — checkout p95 1.8 s\\n14:07 cache pool replaced — traffic stable — node sg-cache-17 — trace 7f3a9c2e — regional verification completed with zero queued payment authorizations\\n14:11 recovery confirmed — p95 390 ms",
      "the preformatted event log preserves line order and spacing",
    );
    const figureBox = await page.locator("figure").boundingBox();
    assert(
      figureBox && figureBox.width > 0 && figureBox.height > 0,
      "the event log and caption occupy visible geometry",
    );
    assertIncludes(
      await page.locator("dl").textContent(),
      "Elevated checkout latency for 18 minutes",
      "the incident facts expose the recorded customer impact",
    );

    const reviewStatus = page.getByTestId("incident-review-status");
    const confirmEvidence = handoff.getByRole("button", {
      name: "Confirm log evidence",
      exact: true,
    });
    const completeHandoff = handoff.getByRole("button", {
      name: "Mark handoff reviewed",
      exact: true,
    });
    assertEqual(
      await completeHandoff.isEnabled(),
      false,
      "handoff completion is unavailable before evidence review",
    );
    await observedAction(page, confirmEvidence, "click");
    assertEqual(
      await confirmEvidence.getAttribute("aria-pressed"),
      "true",
      "pointer activation records the evidence acknowledgement",
    );
    assertEqual(
      await completeHandoff.isEnabled(),
      true,
      "confirming evidence enables the final handoff action",
    );
    assertEqual(
      await reviewStatus.textContent(),
      "Log evidence confirmed. Final handoff review is now available.",
      "the visible review status explains the next available action",
    );

    await observedPageKey(page, "Incident event log", "Shift+Tab");
    assertEqual(
      await incidentLog.evaluate((element) => element === document.activeElement),
      true,
      "keyboard navigation reaches the preformatted log without a synthetic role",
    );
    await observedBoxGesture(page, incidentLog, "preformatted incident log before horizontal wheel", async (pointer, incidentLogBox) => {
      await pointer.move(
        incidentLogBox.x + incidentLogBox.width / 2,
        incidentLogBox.y + incidentLogBox.height / 2,
      );
      await pointer.wheel(720, 0);
    });
    await page.waitForFunction(
      () => document.querySelector('[data-testid="incident-event-log"]').scrollLeft > 0,
    );
    assert(
      (await incidentLog.evaluate((element) => element.scrollLeft)) > 0,
      "a real horizontal wheel gesture reveals the overflowing event log",
    );

    await observedPageKey(page, "Confirm log evidence", "Tab");
    assertEqual(
      await confirmEvidence.evaluate((element) => element === document.activeElement),
      true,
      "Tab returns from the log to the evidence confirmation action",
    );
    await observedPageKey(page, "Mark handoff reviewed", "Tab");
    assertEqual(
      await completeHandoff.evaluate((element) => element === document.activeElement),
      true,
      "Tab advances to the newly enabled handoff action",
    );
    await observedPageKey(page, "Mark handoff reviewed", "Enter");
    assertEqual(
      await completeHandoff.getAttribute("aria-pressed"),
      "true",
      "keyboard activation records final handoff review",
    );
    assertEqual(
      await completeHandoff.isEnabled(),
      false,
      "a completed handoff cannot be submitted twice",
    );
    assertEqual(
      await reviewStatus.textContent(),
      "Handoff review complete. APAC Reliability retains overnight ownership.",
      "the visible review status confirms the resulting owner",
    );
    assertEqual(
      await reviewStatus.isVisible(),
      true,
      "the final handoff result remains visible to the user",
    );
    await observedAction(page, confirmEvidence, "click");
    assertEqual(
      await completeHandoff.isEnabled(),
      false,
      "reconfirming evidence cannot reopen a completed handoff",
    );
    assertEqual(
      await reviewStatus.textContent(),
      "Handoff review complete. APAC Reliability retains overnight ownership.",
      "reconfirming evidence cannot roll the final status backward",
    );

    const scopedLogSnapshot = await incidentLog.ariaSnapshot({ ref: true });
    const scopedLogRefLine = scopedLogSnapshot
      .split("\\n")
      .find((candidate) => candidate.includes("[ref="));
    const scopedLogRef = scopedLogRefLine
      ?.split("[ref=")[1]
      ?.split("]")[0];
    assert(
      scopedLogRef,
      "a scoped snapshot exposes a ref for the non-semantic interactive pre target",
    );
    assertEqual(
      await page
        .locator("aria-ref=" + scopedLogRef)
        .evaluate((element) => element.tagName),
      "PRE",
      "the scoped ref resolves to the preformatted log target",
    );

  `,
);
