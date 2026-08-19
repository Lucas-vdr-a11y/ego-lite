export function pageLoadStatesCase() {
  return `
    const task = await taskSpace(taskName);
    const page = await task.openPage("about:blank", { as: "page-load-states" });
    await page.cdp("Page.navigate", {
      url: baseUrl + "/domcontentloaded-page?ms=1500",
    });

    await page.waitForLoadState("domcontentloaded", { timeout: 1_000 });
    const afterDomContentLoaded = await page.evaluate(() => ({
      marker: document.documentElement.dataset.domContentLoaded,
      readyState: document.readyState,
    }));
    assertEqual(
      afterDomContentLoaded.marker,
      "true",
      "domcontentloaded waits for the actual document lifecycle event"
    );
    assertEqual(
      afterDomContentLoaded.readyState,
      "interactive",
      "domcontentloaded returns while the slow resource still blocks load"
    );

    await assertRejects(
      () => page.waitForLoadState("load", { timeout: 100 }),
      "waitForLoadState(load) timed out",
      "load does not resolve at the earlier DOMContentLoaded boundary"
    );
    await page.waitForLoadState("load", { timeout: 3_000 });
    assertEqual(
      await page.evaluate("document.readyState"),
      "complete",
      "load resolves after the slow resource finishes"
    );

    await page.close();
  `;
}
