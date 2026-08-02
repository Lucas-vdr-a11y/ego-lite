export const nativeTaskSpaceCloseRegressionCase = {
  name: "native task space close regression",
  optIn: true,
  crashGraceMs: 300,
  body() {
    return `
      const originalTask = await egoBrowser.useOrCreateTaskSpace(taskName);
      const scratch = await egoBrowser.newTaskSpace(taskName + " native close regression");
      let scratchClosed = false;
      try {
        await scratch.page.goto(baseUrl + "/?native-close-regression=" + Date.now(), {
          timeout: 10_000,
          waitUntil: "load",
        });
        const popup = await scratch.context.newPage();
        await popup.goto(baseUrl + "/secondary", {
          timeout: 5_000,
          waitUntil: "load",
        });
        await popup.bringToFront();
        assertIncludes(
          popup.url(),
          "/secondary",
          "native close regression creates a second Page"
        );

        const dialogPromise = scratch.page.waitForEvent("dialog", { timeout: 5_000 });
        await scratch.page.evaluate(() => setTimeout(() => alert("native close regression"), 0));
        const dialog = await dialogPromise;
        await dialog.dismiss();

        await egoBrowser.closeTaskSpace(scratch.id);
        scratchClosed = true;
        const spaces = await egoBrowser.listTaskSpaces();
        assert(
          !spaces.some((space) => space.id === scratch.id),
          "native close removes the task space"
        );
      } finally {
        if (!scratchClosed) {
          await egoBrowser.completeTaskSpace(scratch.id).catch(() => {});
        }
        await egoBrowser.switchTaskSpace(originalTask.id).catch(() => {});
      }
    `;
  },
};
