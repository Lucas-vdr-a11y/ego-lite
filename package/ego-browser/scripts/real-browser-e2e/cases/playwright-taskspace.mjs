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
    assertEqual(await task.page.title(), "ego-lite helper e2e", "native Playwright Page navigates the TaskSpace");
    assertEqual(
      await task.page.getByRole("heading", { name: "Helper e2e fixture" }).count(),
      1,
      "native Playwright Locator resolves page content",
    );

    const secondary = await task.context.newPage();
    try {
      await secondary.goto(baseUrl + "/secondary", {
        waitUntil: "load",
        timeout: 20_000,
      });
      assertIncludes(
        secondary.url(),
        "/secondary",
        "native Playwright BrowserContext creates an independent Page",
      );
    } finally {
      await secondary.close();
    }
  `;
}
