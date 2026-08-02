export const ariaSnapshotCase = {
  name: "Playwright ARIA snapshot refs",
  kind: "platform",
  body() {
    return `
      const task = await egoBrowser.useOrCreateTaskSpace(taskName);
      const page = task.page;
      await page.goto(baseUrl + "/tests/clicks?platform=aria", {
        waitUntil: "load",
        timeout: 20_000,
      });

      const bodySnapshot = await page.locator("body").ariaSnapshot({ ref: true });
      assertIncludes(
        bodySnapshot,
        "Dispatch queue",
        "a body snapshot establishes full-page semantic context",
      );

      const localScope = page.getByLabel("Orders awaiting dispatch");
      assertEqual(
        await localScope.count(),
        1,
        "the local ARIA snapshot scope resolves uniquely",
      );
      const localSnapshot = await localScope.ariaSnapshot({ ref: true });
      assertIncludes(
        localSnapshot,
        "Select order EG-1846",
        "the local snapshot contains only the relevant order structure",
      );

      function ariaRefFor(snapshot, accessibleName) {
        const line = snapshot
          .split("\\n")
          .find((candidate) => candidate.includes('"' + accessibleName + '"'));
        const match = line?.match(/\\[ref=(s\\d+e\\d+)\\]/);
        assert(match, "the ARIA snapshot emits a ref for " + accessibleName);
        return "aria-ref=" + match[1];
      }

      const oldSelector = ariaRefFor(localSnapshot, "Select order EG-1846");
      const oldRef = page.locator(oldSelector);
      await oldRef.click();
      assertEqual(
        await page.getByTestId("selected-order").textContent(),
        "EG-1846",
        "an ARIA ref acts on the element from its snapshot generation",
      );

      const ambiguousOrderButtons = page.getByRole("button", {
        name: /Select order/,
      });
      assert(
        (await ambiguousOrderButtons.count()) > 1,
        "the strictness probe is intentionally ambiguous",
      );
      await assertRejects(
        () => ambiguousOrderButtons.click(),
        "strict mode violation",
        "an ambiguous semantic locator fails instead of choosing an element",
      );

      const refreshedSnapshot = await localScope.ariaSnapshot({ ref: true });
      await assertRejects(
        () => oldRef.click(),
        "Stale aria-ref",
        "a later snapshot invalidates refs from the earlier generation",
      );
      const refreshedRef = page.locator(
        ariaRefFor(refreshedSnapshot, "Select order EG-1839"),
      );
      await refreshedRef.click();
      assertEqual(
        await page.getByTestId("selected-order").textContent(),
        "EG-1839",
        "a refreshed ARIA ref remains actionable",
      );
    `;
  },
};
