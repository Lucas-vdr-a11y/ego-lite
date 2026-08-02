export function taskSpaceVideoCapabilityCase() {
  return `
    const task = await egoBrowser.useOrCreateTaskSpace(taskName);

    await task.page.goto(baseUrl, {
      waitUntil: "load",
      timeout: 20_000,
    });

    assertEqual(
      typeof task.page.video,
      "function",
      "TaskSpace exposes the native Playwright video capability check",
    );
    assertEqual(
      task.page.video(),
      null,
      "TaskSpace pages do not claim a video when recordVideo is not configured",
    );
    assertEqual(
      task.page.screencast,
      undefined,
      "TaskSpace does not expose the removed legacy screencast recorder",
    );
    assertEqual(
      await task.page.title(),
      "Ego Browser Lab",
      "checking video capability leaves the TaskSpace page operable",
    );
  `;
}
