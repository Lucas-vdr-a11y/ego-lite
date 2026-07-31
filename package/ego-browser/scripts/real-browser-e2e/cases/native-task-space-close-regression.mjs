export const nativeTaskSpaceCloseRegressionCase = {
  name: "native task space close regression",
  optIn: true,
  crashGraceMs: 300,
  body() {
    return `
      const originalTask = await taskSpaces.useOrCreate(taskName);
      const scratch = await taskSpaces.new(taskName + " native close regression");
      let scratchClosed = false;
      try {
        await page.goto(baseUrl + "/?native-close-regression=" + Date.now(), {
          timeout: 10_000,
          waitUntil: "load",
        });
        const originalTab = await tabs.current();
        const popupPromise = page.waitForEvent("popup", { timeout: 5_000 });
        await cdp("Runtime.evaluate", {
          expression: "window.open(location.origin + '/secondary', '_blank')",
          userGesture: true,
          awaitPromise: false,
        });
        const popup = await popupPromise;
        await popup.bringToFront();
        await page.waitForURL(
          (url) => url.pathname === "/secondary",
          { timeout: 5_000, waitUntil: "load" }
        );
        await tabs.activate(originalTab);

        const dialogPromise = page.waitForEvent("dialog", { timeout: 5_000 });
        await page.evaluate(() => setTimeout(() => alert("native close regression"), 0));
        const dialog = await dialogPromise;
        await dialog.dismiss();

        const closed = await taskSpaces.complete(scratch.id, { keep: false });
        scratchClosed = closed.done;
        assertEqual(closed.done, true, "native close completes a task space with popup and dialog history");
        const spaces = await taskSpaces.list();
        assert(
          !spaces.some((space) => space.id === scratch.id),
          "native close removes the task space"
        );
      } finally {
        if (!scratchClosed) {
          await taskSpaces.complete(scratch.id, { keep: true }).catch(() => {});
        }
        await taskSpaces.switch(originalTask.id).catch(() => {});
      }
    `;
  },
};
