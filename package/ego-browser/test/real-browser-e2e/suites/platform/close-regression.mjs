export const nativeCloseRegressionCase = {
  name: "native task space close regression",
  kind: "platform",
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
        await scratch.page.evaluate((url) => {
          const trigger = document.createElement("button");
          trigger.textContent = "Open regression popup";
          trigger.addEventListener("click", () => window.open(url, "_blank"));
          document.body.append(trigger);
        }, baseUrl + "/tests/forms?native-close-popup=1");
        const popupPromise = scratch.page.waitForEvent("popup", {
          timeout: 5_000,
        });
        await scratch.page
          .getByRole("button", { name: "Open regression popup" })
          .click();
        const popup = await popupPromise;
        await popup.waitForLoadState("load", { timeout: 5_000 });
        await popup.bringToFront();
        assertIncludes(
          popup.url(),
          "/tests/forms?native-close-popup=1",
          "native close regression creates a real popup Page"
        );

        const dialogPromise = scratch.page.waitForEvent("dialog", { timeout: 5_000 });
        await scratch.page.evaluate(() => setTimeout(() => alert("native close regression"), 0));
        const dialog = await dialogPromise;
        await dialog.dismiss();

        const closeResult = await egoBrowser.closeTaskSpace(scratch.id);
        assertEqual(closeResult.done, true, "native close reports successful destruction");
        scratchClosed = true;
        const spaces = await egoBrowser.listTaskSpaces();
        assert(
          !spaces.some((space) => space.id === scratch.id),
          "native close removes the task space"
        );

        const restoredOriginal = await egoBrowser.switchTaskSpace(originalTask.id);
        await restoredOriginal.page.goto(baseUrl + "/?native-close-health=1", {
          timeout: 10_000,
          waitUntil: "load",
        });
        assertEqual(
          await restoredOriginal.page
            .getByRole("heading", { name: "Test routes" })
            .count(),
          1,
          "the original TaskSpace remains healthy after native close",
        );
      } finally {
        if (!scratchClosed) {
          await egoBrowser.closeTaskSpace(scratch.id).catch(() => {});
        }
        await egoBrowser.switchTaskSpace(originalTask.id).catch(() => {});
      }
    `;
  },
};
