export const crossRoundPersistenceCase = {
  name: "TaskSpace cross-round persistence",
  kind: "platform",
  rounds: [
    () => `
      const scratch = await egoBrowser.newTaskSpace(taskName + " cross round");
      try {
        const primaryUrl = baseUrl + "/tests/forms?cross-round=primary";
        const activeUrl = baseUrl + "/tests/clicks?cross-round=active";
        await scratch.page.goto(primaryUrl, {
          waitUntil: "load",
          timeout: 20_000,
        });
        await scratch.page.evaluate(() => {
          window.name = "cross-round-primary";
        });

        const activePage = await scratch.context.newPage();
        await activePage.goto(activeUrl, {
          waitUntil: "load",
          timeout: 20_000,
        });
        await activePage.evaluate(() => {
          window.name = "cross-round-active";
        });
        await activePage.bringToFront();

        assertEqual(
          scratch.context.pages().length,
          2,
          "the first Node round leaves two TaskSpace pages open",
        );
        assertEqual(
          await activePage.evaluate(() => window.name),
          "cross-round-active",
          "the first Node round establishes active renderer state",
        );
        await writeFile(
          join(tempDir, "cross-round-taskspace.json"),
          JSON.stringify({
            id: scratch.id,
            name: scratch.name,
            primaryUrl,
            activeUrl,
          }),
        );
      } catch (error) {
        await egoBrowser.closeTaskSpace(scratch.id).catch(() => {});
        throw error;
      }
    `,
    () => `
      const { readFile } = await import("node:fs/promises");
      const saved = JSON.parse(
        await readFile(join(tempDir, "cross-round-taskspace.json"), "utf8"),
      );
      let closed = false;
      try {
        const spaces = await egoBrowser.listTaskSpace();
        const listed = spaces.find((space) => space.id === saved.id);
        assert(listed, "the TaskSpace remains listed in a new Node round");
        assertEqual(
          listed.name,
          saved.name,
          "the TaskSpace keeps its identity across Node rounds",
        );

        const restored = await egoBrowser.switchTaskSpace(saved.id);
        const pages = restored.context.pages();
        assertEqual(
          pages.length,
          2,
          "a new Node round restores every open TaskSpace page",
        );
        assert(
          pages.some((page) => page.url() === saved.primaryUrl),
          "the primary page URL survives the Node process boundary",
        );
        assert(
          pages.some((page) => page.url() === saved.activeUrl),
          "the active page URL survives the Node process boundary",
        );
        assertEqual(
          restored.page.url(),
          saved.activeUrl,
          "task.page resolves the page that was active in the previous round",
        );
        assertEqual(
          await restored.page.evaluate(() => window.name),
          "cross-round-active",
          "task.page preserves active renderer state across Node rounds",
        );
        const primaryPage = pages.find((page) => page.url() === saved.primaryUrl);
        assertEqual(
          await primaryPage.evaluate(() => window.name),
          "cross-round-primary",
          "an inactive page preserves renderer state across Node rounds",
        );
        assertEqual(
          await restored.page
            .getByRole("heading", { name: "Dispatch queue" })
            .count(),
          1,
          "native Playwright locators continue in the restored active page",
        );

        const result = await egoBrowser.closeTaskSpace(saved.id);
        assertEqual(result.done, true, "the cross-round TaskSpace closes cleanly");
        closed = true;
      } finally {
        if (!closed) {
          await egoBrowser.closeTaskSpace(saved.id).catch(() => {});
        }
      }
    `,
  ],
};
