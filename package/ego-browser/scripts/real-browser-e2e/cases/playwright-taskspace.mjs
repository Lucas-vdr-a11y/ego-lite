export function playwrightTaskSpaceCase() {
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
      await task.page.getByRole("heading", { name: "One browser behavior. One clear signal." }).count(),
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
  `;
}
