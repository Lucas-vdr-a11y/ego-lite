export function contextLifecycleCase() {
  return `
    const lifecycleSpaceCount = 3;
    const lifecycleSpaces = [];
    let activeHandles;

    async function assertDisconnected(handles, message) {
      assertEqual(handles.page.isClosed(), true, message + " page is closed");
      await assertRejects(
        () => handles.page.title(),
        "closed",
        message + " Page rejects further operations",
      );
      await assertRejects(
        () => handles.context.newPage(),
        "closed",
        message + " BrowserContext rejects new tabs",
      );
    }

    try {
      for (let index = 0; index < lifecycleSpaceCount; index += 1) {
        const task = await egoBrowser.newTaskSpace(
          taskName + " lifecycle " + index,
        );
        if (activeHandles) {
          await assertDisconnected(
            activeHandles,
            "creating TaskSpace " + index + " invalidates the previous Playwright connection",
          );
        }

        const marker = "lifecycle-space=" + index;
        const primaryUrl = baseUrl + "/?" + marker + "&tab=primary";
        const persistentUrl =
          baseUrl + "/tests/forms?" + marker + "&tab=persistent";
        const transientUrl =
          baseUrl + "/tests/clicks?" + marker + "&tab=transient";

        assertEqual(
          task.context.pages().length,
          1,
          "a new TaskSpace starts with one isolated tab",
        );
        await task.page.goto(primaryUrl, {
          waitUntil: "load",
          timeout: 20_000,
        });
        await task.page.evaluate(
          (value) => {
            window.name = value;
          },
          "primary-" + index,
        );

        const persistentPage = await task.context.newPage();
        await persistentPage.goto(persistentUrl, {
          waitUntil: "load",
          timeout: 20_000,
        });
        await persistentPage.evaluate(
          (value) => {
            window.name = value;
          },
          "persistent-" + index,
        );

        const transientPage = await task.context.newPage();
        await transientPage.goto(transientUrl, {
          waitUntil: "load",
          timeout: 20_000,
        });
        assertEqual(
          task.context.pages().length,
          3,
          "each TaskSpace can own multiple tabs",
        );
        await transientPage.close();
        assertEqual(
          transientPage.isClosed(),
          true,
          "a transient tab closes before switching TaskSpaces",
        );
        assertEqual(
          task.context.pages().length,
          2,
          "closing one tab keeps the other TaskSpace tabs alive",
        );

        lifecycleSpaces.push({
          id: task.id,
          name: task.name,
          index,
          marker,
          closed: false,
        });
        activeHandles = { page: task.page, context: task.context };
      }

      const switchOrder = [1, 0, 2];
      for (const index of switchOrder) {
        const record = lifecycleSpaces[index];
        const task = await egoBrowser.switchTaskSpace(
          index === 1 ? record.name : record.id,
        );
        await assertDisconnected(
          activeHandles,
          "switching to TaskSpace " + index + " invalidates stale handles",
        );

        const pages = task.context.pages();
        const urls = pages.map((page) => page.url());
        assertEqual(
          pages.length,
          2,
          "switching restores exactly the tabs left open in TaskSpace " + index,
        );
        assert(
          urls.every((url) => url.includes(record.marker)),
          "TaskSpace " + index + " exposes no tabs from another TaskSpace",
        );
        assert(
          urls.every((url) => !url.includes("tab=transient")),
          "closed transient tabs do not reappear after switching TaskSpaces",
        );

        const primaryPage = pages.find((page) =>
          page.url().includes("tab=primary"),
        );
        const persistentPage = pages.find((page) =>
          page.url().includes("tab=persistent"),
        );
        assert(primaryPage, "TaskSpace " + index + " retains its primary tab");
        assert(
          persistentPage,
          "TaskSpace " + index + " retains its second tab",
        );

        await primaryPage.bringToFront();
        assertEqual(
          await primaryPage.title(),
          "Ego Browser Lab",
          "the primary tab remains operable after a TaskSpace switch",
        );
        assertEqual(
          await primaryPage.evaluate(() => window.name),
          "primary-" + index,
          "the primary tab preserves renderer state across TaskSpace switches",
        );
        assertEqual(
          await primaryPage
            .getByRole("heading", { name: "Test routes" })
            .count(),
          1,
          "native Playwright locators operate in the restored primary tab",
        );

        await persistentPage.bringToFront();
        assertEqual(
          await persistentPage.title(),
          "Project request · Ego Browser Lab",
          "the second tab remains operable after a TaskSpace switch",
        );
        assertEqual(
          await persistentPage.evaluate(() => window.name),
          "persistent-" + index,
          "the second tab preserves renderer state across TaskSpace switches",
        );
        await persistentPage.evaluate(
          (value) => {
            document.body.dataset.lifecycle = value;
          },
          String(index),
        );
        assertEqual(
          await persistentPage.locator("body").getAttribute("data-lifecycle"),
          String(index),
          "the restored second tab accepts new Playwright operations",
        );

        const replacementPage = await task.context.newPage();
        await replacementPage.goto(
          baseUrl + "/tests/hover?" + record.marker + "&tab=replacement",
          { waitUntil: "load", timeout: 20_000 },
        );
        assertEqual(
          task.context.pages().length,
          3,
          "a restored BrowserContext can create another tab",
        );
        await replacementPage.close();
        assertEqual(
          replacementPage.isClosed(),
          true,
          "the newly created replacement tab can close",
        );

        await persistentPage.close();
        assertEqual(
          task.context.pages().length,
          1,
          "closing the second tab leaves only the primary tab",
        );
        assert(
          task.context
            .pages()
            .every((page) => !page.url().includes("tab=persistent")),
          "a closed persistent tab is removed from its TaskSpace",
        );
        activeHandles = { page: primaryPage, context: task.context };
      }

      const middle = lifecycleSpaces[1];
      const closedMiddle = await egoBrowser.closeTaskSpace(middle.id);
      assertEqual(
        closedMiddle.done,
        true,
        "closing a non-current TaskSpace reports success",
      );
      middle.closed = true;
      await assertDisconnected(
        activeHandles,
        "closing another TaskSpace invalidates the active Playwright connection",
      );
      await assertRejects(
        () => egoBrowser.switchTaskSpace(middle.id),
        "task space not found",
        "a closed TaskSpace cannot be selected again",
      );

      const first = lifecycleSpaces[0];
      const restoredFirst = await egoBrowser.switchTaskSpace(first.name);
      assertEqual(
        restoredFirst.context.pages().length,
        1,
        "closing one TaskSpace does not close tabs in the first remaining TaskSpace",
      );
      assertEqual(
        await restoredFirst.page.evaluate(() => window.name),
        "primary-0",
        "the first remaining TaskSpace keeps its page state",
      );
      activeHandles = {
        page: restoredFirst.page,
        context: restoredFirst.context,
      };

      const closedFirst = await egoBrowser.closeTaskSpace(first.name);
      assertEqual(
        closedFirst.done,
        true,
        "a TaskSpace can close by name",
      );
      first.closed = true;
      await assertDisconnected(
        activeHandles,
        "closing the current TaskSpace invalidates its Playwright handles",
      );

      const last = lifecycleSpaces[2];
      const restoredLast = await egoBrowser.switchTaskSpace(last.id);
      assertEqual(
        restoredLast.context.pages().length,
        1,
        "the last TaskSpace remains isolated after the others close",
      );
      assertEqual(
        await restoredLast.page.evaluate(() => window.name),
        "primary-2",
        "the last TaskSpace keeps its page state until it closes",
      );
      activeHandles = {
        page: restoredLast.page,
        context: restoredLast.context,
      };

      const closedLast = await egoBrowser.closeTaskSpace(last.id);
      assertEqual(closedLast.done, true, "the final TaskSpace closes cleanly");
      last.closed = true;
      await assertDisconnected(
        activeHandles,
        "closing the final TaskSpace invalidates its Playwright handles",
      );
    } finally {
      for (const record of lifecycleSpaces.toReversed()) {
        if (record.closed) continue;
        await egoBrowser.closeTaskSpace(record.id).catch(() => {});
      }
    }
  `;
}
