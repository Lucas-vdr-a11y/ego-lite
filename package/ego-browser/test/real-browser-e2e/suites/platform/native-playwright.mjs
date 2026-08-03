export function nativePlaywrightCase() {
  return `
    const task = await egoBrowser.useOrCreateTaskSpace(taskName);

    assertEqual(typeof task.page.goto, "function", "TaskSpace exposes a Playwright Page");
    assertEqual(typeof task.context.newPage, "function", "TaskSpace exposes a Playwright BrowserContext");
    assertEqual(task.page.context(), task.context, "TaskSpace Page belongs to its exposed BrowserContext");

    await task.page.goto(baseUrl, { waitUntil: "commit", timeout: 20_000 }).catch((error) => {
      error.message += "; current URL: " + task.page.url();
      throw error;
    });
    assertEqual(await task.page.title(), "Ego Browser Lab", "native Playwright Page navigates the TaskSpace");
    assertEqual(
      await task.page.getByRole("heading", { name: "Test routes" }).count(),
      1,
      "native Playwright Locator resolves page content",
    );

    const secondary = await task.context.newPage();
    try {
      await secondary.goto(baseUrl + "/tests/forms", {
        waitUntil: "load",
        timeout: 20_000,
      });
      assertIncludes(
        secondary.url(),
        "/tests/forms",
        "native Playwright BrowserContext creates an independent Page",
      );
    } finally {
      await secondary.close();
    }

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
