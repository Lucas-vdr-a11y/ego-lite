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

    await page.evaluate((popupUrl) => {
      const button = document.createElement("button");
      button.id = "delayed-popup";
      button.textContent = "Open delayed popup";
      button.style.cssText = "position:fixed;left:20px;top:20px;z-index:2147483647";
      button.addEventListener("click", () => {
        const popup = window.open("about:blank", "_blank");
        setTimeout(() => {
          popup.location.href = popupUrl;
        }, 750);
      });
      document.body.append(button);
    }, baseUrl + "/secondary?page-load-states=delayed-popup");
    const receipt = await page.click("#delayed-popup");
    assertEqual(receipt.popups.length, 1, "the delayed popup is adopted immediately");
    const popup = task.page(receipt.popups[0].label);
    assertEqual(await popup.url(), "about:blank", "the adopted popup begins at about:blank");
    await popup.waitForURL(/page-load-states=delayed-popup$/, { timeout: 3_000 });
    assertIncludes(
      await popup.url(),
      "page-load-states=delayed-popup",
      "waitForURL follows the popup's first navigation"
    );

    await popup.close();
    await page.close();
  `;
}
