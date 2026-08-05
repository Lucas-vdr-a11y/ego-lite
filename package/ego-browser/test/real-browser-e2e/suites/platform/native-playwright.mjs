export function nativePlaywrightCase() {
  return `
    const task = await openE2eTaskSpace(taskName);

    assertEqual(typeof task.page.goto, "function", "TaskSpace exposes a Playwright Page");
    assertEqual(typeof task.context.newPage, "function", "TaskSpace exposes a Playwright BrowserContext");
    assertEqual(task.page.context(), task.context, "TaskSpace Page belongs to its exposed BrowserContext");

    const primaryResponse = await task.page.goto(baseUrl, { waitUntil: "load", timeout: 20_000 }).catch((error) => {
      error.message += "; current URL: " + task.page.url();
      throw error;
    });
    assert(primaryResponse, "TaskSpace Page.goto returns the main document response");
    assertEqual(primaryResponse.status(), 200, "TaskSpace Page.goto returns the successful document response");
    assertEqual(await task.page.evaluate(() => document.readyState), "complete", "TaskSpace Page.goto waits for the target document load lifecycle");
    assertEqual(await task.page.title(), "Ego Browser Lab", "native Playwright Page navigates the TaskSpace");
    assertEqual(
      await task.page.getByRole("heading", { name: "Test routes" }).count(),
      1,
      "native Playwright Locator resolves page content",
    );

    const secondary = await task.context.newPage();
    try {
      const response = await secondary.goto(baseUrl + "/tests/forms", {
        waitUntil: "load",
        timeout: 20_000,
      });
      assert(response, "native Playwright Page.goto returns the main document response");
      assertEqual(response.status(), 200, "Page.goto returns the successful document response");
      assertEqual(await secondary.evaluate(() => document.readyState), "complete", "Page.goto waits for the target document load lifecycle");
      assertEqual(await secondary.title(), "Project request · Ego Browser Lab", "Page.goto exposes the loaded document title immediately");
      assert((await secondary.locator("body").innerHTML()).length > 0, "Page.goto exposes the loaded document body immediately");
      assertIncludes(
        secondary.url(),
        "/tests/forms",
        "native Playwright BrowserContext creates an independent Page",
      );
    } finally {
      await secondary.close();
    }

    const internalPage = await task.context.newPage();
    await internalPage.goto("chrome://bookmarks/", {
      waitUntil: "domcontentloaded",
      timeout: 15_000,
    });
    await internalPage.close();
    assertEqual(
      internalPage.isClosed(),
      true,
      "Page.close resolves after a native internal page closes",
    );

    await task.page.goto(baseUrl + "/tests/forms?platform=popup", {
      waitUntil: "load",
      timeout: 20_000,
    });
    await task.page.evaluate((url) => {
      const trigger = document.createElement("button");
      trigger.type = "button";
      trigger.textContent = "Open decision popup";
      trigger.addEventListener("click", () => window.open(url, "_blank"));
      document.body.append(trigger);
    }, baseUrl + "/tests/navigation/destination?source=popup");
    const popupPromise = task.page.waitForEvent("popup", { timeout: 10_000 });
    await task.page.getByRole("button", { name: "Open decision popup" }).click();
    const popup = await popupPromise;
    try {
      await popup.waitForLoadState("load", { timeout: 10_000 });
      assertIncludes(popup.url(), "source=popup", "Page popup event returns the newly opened target");
      assertEqual(
        await popup.getByRole("heading", { name: "Launch in two measured phases." }).count(),
        1,
        "popup Page remains fully operable through native Playwright",
      );
    } finally {
      await popup.close();
    }
  `;
}
