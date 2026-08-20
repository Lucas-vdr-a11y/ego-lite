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
        setTimeout(() => {
          window.open(popupUrl, "_blank");
        }, 650);
      });
      document.body.append(button);
    }, baseUrl + "/secondary?page-load-states=delayed-popup");
    const ledgerPath = join(
      process.env.EGO_BROWSER_STATE_DIR,
      "space-" + task.spaceId + ".json"
    );
    const beforeLedger = JSON.parse(await readFile(ledgerPath, "utf8"));
    const beforeTargets = new Set(
      Object.values(beforeLedger.pages).map((entry) => entry.targetId)
    );
    const receipt = await page.click("#delayed-popup");
    assertEqual(
      receipt.popups?.length ?? 0,
      0,
      "the popup is created after the action receipt window"
    );
    await page.waitForTimeout(1_000);
    const afterLedger = JSON.parse(await readFile(ledgerPath, "utf8"));
    const delayedPopup = Object.entries(afterLedger.pages).find(
      ([, entry]) => !beforeTargets.has(entry.targetId)
    );
    assert(Boolean(delayedPopup), "background discovery adopts the delayed popup");
    const popup = task.page(delayedPopup[0]);
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
