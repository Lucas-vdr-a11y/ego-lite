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

export const crossRoundOopifPersistenceCase = {
  name: "TaskSpace cross-round OOPIF persistence",
  kind: "platform",
  rounds: [
    () => `
      const scratch = await egoBrowser.newTaskSpace(taskName + " cross round oopif");
      try {
        const pageUrl = baseUrl + "/tests/frames?cross-site=1";
        await scratch.page.goto(pageUrl, {
          waitUntil: "load",
          timeout: 20_000,
        });
        await scratch.page
          .getByRole("button", { name: "Load secure checkout" })
          .click();

        const deadline = Date.now() + 10_000;
        let checkoutFrame;
        do {
          checkoutFrame = scratch.page
            .frames()
            .find((frame) => frame.url().includes("checkout.localhost"));
          if (checkoutFrame) break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        } while (Date.now() < deadline);

        assert(checkoutFrame, "the first round attaches the cross-site checkout OOPIF");
        assertEqual(
          await checkoutFrame
            .getByRole("heading", { name: "Confirm payment details" })
            .count(),
          1,
          "the first round can read the checkout OOPIF",
        );
        await checkoutFrame.locator("iframe#pickup-map").scrollIntoViewIfNeeded();
        const mapDeadline = Date.now() + 10_000;
        let mapFrame;
        do {
          mapFrame = scratch.page
            .frames()
            .find((frame) =>
              frame.url().includes("openstreetmap.org/export/embed.html"),
            );
          if (mapFrame) break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        } while (Date.now() < mapDeadline);
        assert(mapFrame, "the first round attaches the nested map OOPIF");
        await mapFrame
          .locator('a[href*="/fixthemap?"][href*="zoom="]')
          .waitFor({ state: "attached", timeout: 10_000 });
        await writeFile(
          join(tempDir, "cross-round-oopif-taskspace.json"),
          JSON.stringify({ id: scratch.id, pageUrl }),
        );
      } catch (error) {
        await egoBrowser.closeTaskSpace(scratch.id).catch(() => {});
        throw error;
      }
    `,
    () => `
      const { readFile } = await import("node:fs/promises");
      const saved = JSON.parse(
        await readFile(join(tempDir, "cross-round-oopif-taskspace.json"), "utf8"),
      );
      let closed = false;
      try {
        const restored = await egoBrowser.switchTaskSpace(saved.id);
        assertEqual(
          restored.page.url(),
          saved.pageUrl,
          "the host page survives the Node round boundary",
        );

        const deadline = Date.now() + 3_000;
        let checkoutFrame;
        do {
          checkoutFrame = restored.page
            .frames()
            .find((frame) => frame.url().includes("checkout.localhost"));
          if (checkoutFrame) break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        } while (Date.now() < deadline);

        assert(
          checkoutFrame,
          "the restored Playwright page re-attaches the existing checkout OOPIF without reload",
        );
        assertEqual(
          await checkoutFrame
            .getByRole("heading", { name: "Confirm payment details" })
            .count(),
          1,
          "semantic locators work in the restored checkout OOPIF",
        );
        const mapDeadline = Date.now() + 3_000;
        let mapFrame;
        do {
          mapFrame = restored.page
            .frames()
            .find((frame) =>
              frame.url().includes("openstreetmap.org/export/embed.html"),
            );
          if (mapFrame) break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        } while (Date.now() < mapDeadline);
        assert(
          mapFrame,
          "the restored checkout re-attaches its existing nested map OOPIF without reload",
        );
        assertEqual(
          await mapFrame.locator("body").count(),
          1,
          "the restored nested OOPIF has a working Playwright session",
        );

        const zoomStateSelector =
          'a[href*="/fixthemap?"][href*="zoom="]';
        const zoomStateLink = mapFrame.locator(zoomStateSelector);
        await zoomStateLink.waitFor({ state: "attached", timeout: 10_000 });
        const zoomSnapshot = await mapFrame
          .locator("body")
          .ariaSnapshot({ ref: true });
        const zoomInLine = zoomSnapshot
          .split("\\n")
          .find((line) => /button "(?:Zoom in|放大)"/i.test(line));
        const zoomInMatch = zoomInLine?.match(/\\[ref=(s\\d+e\\d+)\\]/);
        assert(
          zoomInMatch,
          "the restored nested OOPIF snapshot exposes the zoom-in control",
        );
        const zoomInButton = mapFrame.locator("aria-ref=" + zoomInMatch[1]);
        assertEqual(
          await zoomInButton.isVisible(),
          true,
          "the restored nested OOPIF zoom-in control is visible",
        );

        const readMapZoom = async () => {
          const href = await zoomStateLink.getAttribute("href");
          assert(href, "the restored nested OOPIF exposes its zoom state");
          const zoom = Number(
            new URL(href, mapFrame.url()).searchParams.get("zoom"),
          );
          assert(
            Number.isFinite(zoom),
            "the restored nested OOPIF reports a numeric zoom level",
          );
          return zoom;
        };

        const zoomBefore = await readMapZoom();
        await zoomInButton.click();
        await mapFrame.waitForFunction(
          ({ selector, expectedZoom }) => {
            const href = document
              .querySelector(selector)
              ?.getAttribute("href");
            return (
              href &&
              Number(new URL(href, location.href).searchParams.get("zoom")) ===
                expectedZoom
            );
          },
          { selector: zoomStateSelector, expectedZoom: zoomBefore + 1 },
          { timeout: 5_000, polling: 50 },
        );
        const zoomAfter = await readMapZoom();
        assertEqual(
          zoomAfter,
          zoomBefore + 1,
          "clicking the restored nested OOPIF zoom control changes map state",
        );

        const result = await egoBrowser.closeTaskSpace(saved.id);
        assertEqual(result.done, true, "the OOPIF TaskSpace closes cleanly");
        closed = true;
      } finally {
        if (!closed) {
          await egoBrowser.closeTaskSpace(saved.id).catch(() => {});
        }
      }
    `,
  ],
};
