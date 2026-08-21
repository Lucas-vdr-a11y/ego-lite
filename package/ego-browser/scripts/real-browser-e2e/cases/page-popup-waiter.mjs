export function pagePopupWaiterCase() {
  return `
    const task = await taskSpace(taskName);
    const source = await task.openPage(baseUrl + "/?page=popup-waiter", {
      as: "popup-waiter-source",
    });
    try {
      await source.evaluate((popupUrl) => {
        const button = document.createElement("button");
        button.id = "popup-waiter-button";
        button.textContent = "Open delayed popup";
        button.addEventListener("click", () => {
          setTimeout(() => window.open(popupUrl, "_blank"), 250);
        });
        document.body.append(button);
      }, baseUrl + "/secondary?popup-waiter=explicit");

      const pendingPopup = source.waitForEvent("popup", { timeout: 3_000 });
      const firstReceipt = await source.click("#popup-waiter-button");
      const firstPopup = await pendingPopup;
      assertEqual(
        firstReceipt.popups?.length ?? 0,
        0,
        "the delayed popup opens after the action receipt window"
      );
      assertIncludes(
        await firstPopup.url(),
        "popup-waiter=explicit",
        "the explicit popup waiter returns a usable Page"
      );
      await firstPopup.close();

      await source.evaluate((popupUrl) => {
        const link = document.createElement("a");
        link.id = "popup-waiter-link";
        link.href = popupUrl;
        link.target = "_blank";
        link.textContent = "Open immediate popup";
        document.body.append(link);
      }, baseUrl + "/secondary?popup-waiter=wrong-page");
      const secondReceipt = await source.click("#popup-waiter-link");
      const startedAt = Date.now();
      let waitError;
      try {
        await source.waitForURL(/popup-waiter=wrong-page$/, { timeout: 15_000 });
      } catch (error) {
        waitError = error;
      }
      assertEqual(
        waitError?.code,
        "EGO_URL_OPENED_IN_POPUP",
        "waiting on the opener reports the popup instead of timing out"
      );
      assertIncludes(
        waitError?.message,
        'task.page("' + secondReceipt.popups[0].label + '")',
        "the diagnostic gives the exact Page recovery expression"
      );
      assert(
        Date.now() - startedAt < 2_000,
        "the wrong-Page wait fails before the 15 second timeout"
      );
      await task.page(secondReceipt.popups[0].label).close();
    } finally {
      await source.close();
    }
  `;
}
