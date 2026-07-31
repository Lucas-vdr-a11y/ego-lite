import { homeCase } from "./shared.mjs";

export const playwrightLocatorCases = [
  {
    name: "Playwright 1.52 locator regex and filtering",
    body: homeCase(`
      assertEqual(await page.getByText(/duplicate action/i).count(), 2, "getByText accepts RegExp");
      assertEqual(await page.getByLabel(/^email$/i).count(), 1, "getByLabel accepts RegExp");
      assertEqual(await page.getByPlaceholder(/^type text$/i).count(), 1, "getByPlaceholder accepts RegExp");
      assertEqual(await page.getByAltText(/fixture logo$/i).count(), 1, "getByAltText accepts RegExp");
      assertEqual(await page.getByTitle(/^counter button$/i).count(), 1, "getByTitle accepts RegExp");
      assertEqual(await page.getByTestId(/^stat(us)$/).count(), 1, "getByTestId accepts RegExp");

      const card = page.locator(".card", {
        has: page.getByRole("button", { name: "Increment counter" }),
        hasText: /click counter/i,
        hasNotText: /awaiting drag/i,
      });
      assertEqual(await card.count(), 1, "page.locator applies has and text options");
      assertEqual(
        await page.locator("main").locator(".card", {
          has: page.getByTitle(/counter button/i),
        }).count(),
        1,
        "locator.locator applies descendant filter options"
      );
      assertEqual(
        await page.frameLocator("#fixture-frame").locator(".card", {
          has: page.frameLocator("#fixture-frame").getByText(/click counter/i),
        }).count(),
        1,
        "frameLocator.locator applies same-frame filter options"
      );
    `),
  },
  {
    name: "frame locator helpers",
    body: homeCase(`
      assertEqual(typeof page.frameLocator, "function", "page.frameLocator is installed synchronously");
      const frame = page.frameLocator("#fixture-frame");
      assertEqual(typeof frame.locator, "function", "frameLocator.locator is chainable");
      assertEqual(
        await frame.locator("#iframe-marker").innerText(),
        "iframe target",
        "frame locator reads inside the child document"
      );
      assertEqual(
        await frame.getByRole("button", { name: "Increment counter" }).count(),
        1,
        "frame-scoped role locator counts inside the child document"
      );

      const button = frame.getByRole("button", { name: "Increment counter" });
      assertEqual(await button.isVisible(), false, "hidden frame owner makes child locator hidden");
      await page.locator("#fixture-frame").evaluate((element) => {
        setTimeout(() => {
          element.style.display = "block";
          element.style.width = "480px";
          element.style.height = "320px";
        }, 100);
      });
      await button.waitFor({ state: "visible", timeout: 2000 });
      const frameBox = await page.locator("#fixture-frame").boundingBox();
      const buttonBox = await button.boundingBox();
      assert(
        buttonBox.x >= frameBox.x && buttonBox.y >= frameBox.y,
        "frame-scoped boundingBox uses top-level viewport coordinates"
      );

      await page.locator("#fixture-frame").evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const overlay = document.createElement("div");
        overlay.id = "frame-overlay";
        Object.assign(overlay.style, {
          position: "absolute",
          left: rect.left + scrollX + "px",
          top: rect.top + scrollY + "px",
          width: rect.width + "px",
          height: rect.height + "px",
          zIndex: "2147483647",
        });
        document.body.append(overlay);
      });
      await assertRejects(
        () => button.click({ timeout: 500 }),
        "frame owner does not receive pointer events",
        "frame-scoped click waits while the iframe is covered"
      );
      await page.locator("#frame-overlay").evaluate((element) => element.remove());

      await button.click();
      assertEqual(
        await frame.locator("#click-count").textContent(),
        "1",
        "frame-scoped click dispatches to the child document"
      );
      await frame.getByLabel("Text input").fill("inside frame");
      assertEqual(
        await frame.locator("#text-input").inputValue(),
        "inside frame",
        "frame-scoped fill targets the child document"
      );
      await frame.locator("#text-input").pressSequentially("x");
      assertEqual(
        await frame.locator("#text-input").inputValue(),
        "inside framex",
        "frame-scoped pressSequentially keeps focus in the child document"
      );
      assertEqual(
        JSON.stringify(await frame.locator("#dropdown").selectOption("beta")),
        '["beta"]',
        "frame-scoped selectOption targets the child document"
      );
      await frame.locator("#checkbox").check();
      assertEqual(
        await frame.locator("#checkbox").isChecked(),
        true,
        "frame-scoped check updates the child control"
      );
      await frame.locator("#file-input").setInputFiles({
        name: "frame-upload.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("frame upload"),
      });
      assertEqual(
        await frame.locator("#file-name").textContent(),
        "frame-upload.txt",
        "frame-scoped setInputFiles targets the child input"
      );
      const screenshotBuffer = await button.screenshot();
      assert(
        Buffer.isBuffer(screenshotBuffer) && screenshotBuffer.length > 0,
        "frame-scoped screenshot returns image bytes"
      );

      await page.locator("#fixture-frame").evaluate((element) => {
        element.style.transformOrigin = "top left";
        element.style.transform = "scale(0.75)";
      });
      await button.click();
      assertEqual(
        await frame.locator("#click-count").textContent(),
        "2",
        "frame-scoped click maps coordinates through a transformed iframe"
      );
      assertIncludes(
        help("page.frameLocator"),
        "FrameLocator",
        "frameLocator is discoverable through runtime help"
      );
    `),
  },
  {
    name: "regression PWB-05 locator zero auto-wait",
    body: homeCase(`
      await page.evaluate(() => {
        document.querySelector("#pwb05-delayed")?.remove();
        setTimeout(() => {
          const status = document.createElement("div");
          status.id = "pwb05-delayed";
          status.textContent = "PWB-05 delayed status";
          document.body.append(status);
        }, 500);
      });
      page.setDefaultTimeout(2500);
      const startedAt = Date.now();
      assertEqual(
        await page.locator("#pwb05-delayed").textContent(),
        "PWB-05 delayed status",
        "PWB-05 delayed locator read completes"
      );
      assert(Date.now() - startedAt >= 300, "PWB-05 locator waited for the missing element");
    `),
  },
  {
    name: "regression PWB-06 locator strictness",
    body: homeCase(`
      const locator = page.getByRole("button", { name: "Duplicate action" });
      await assertRejects(
        () => locator.click({ timeout: 1000 }),
        "matched 2 elements",
        "PWB-06 non-unique locator remains strict"
      );
      assertEqual(await locator.count(), 2, "PWB-06 count exposes both matches");

      const rawCss = page.locator(".duplicate-action");
      await assertRejects(
        () => rawCss.click({ timeout: 1000 }),
        "matched 2 elements",
        "PWB-06 raw CSS action remains strict"
      );

      const rawXpath = page.locator('xpath=//button[contains(@class, "duplicate-action")]');
      await assertRejects(
        () => rawXpath.innerText(),
        "matched 2 elements",
        "PWB-06 raw XPath read remains strict"
      );

      await rawCss.first().click({ timeout: 1000 });
      assert(await rawCss.first().isVisible(), "PWB-06 first resolves a confirmed legitimate duplicate");
      assertEqual(
        await rawXpath.nth(1).innerText(),
        "Duplicate action",
        "PWB-06 nth resolves a confirmed legitimate XPath duplicate"
      );
    `),
  },
];
