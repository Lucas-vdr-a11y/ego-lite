import { homeCase } from "./shared.mjs";

export const ariaSnapshotCases = [
  {
    name: "aria snapshot facade",
    body: homeCase(`
      assertEqual(typeof page.ariaSnapshot, "function", "page.ariaSnapshot is available");
      assertEqual(
        typeof page.locator("body").ariaSnapshot,
        "function",
        "locator.ariaSnapshot is available"
      );
      assertEqual(
        typeof page.frameLocator("#fixture-frame").locator("body").ariaSnapshot,
        "function",
        "frame-scoped locator.ariaSnapshot is available"
      );

      await page.evaluate(() => {
        const fixture = document.createElement("section");
        fixture.id = "aria-snapshot-fixture";
        fixture.setAttribute("aria-label", "Store");
        fixture.innerHTML = \`
          <h2>Products</h2>
          <ul aria-label="Catalog">
            <li>Wireless Controller</li>
          </ul>
          <button aria-pressed="true" disabled>Checkout</button>
          <a href="/controller-details">Details</a>
          <input aria-label="Email" placeholder="buyer@example.com" value="customer@example.com">
          <input aria-label="Gift wrap" type="checkbox" checked>
          <div aria-hidden="true">Hidden promotion</div>
        \`;
        document.body.append(fixture);
      });

      const fixture = page.locator("#aria-snapshot-fixture");
      const yaml = await fixture.ariaSnapshot({ timeout: 3000 });
      assertIncludes(yaml, '- region "Store":', "ARIA snapshot includes the scoped root");
      assertIncludes(yaml, '- heading "PRODUCTS" [level=2]', "ARIA snapshot includes heading state");
      assertIncludes(yaml, '- list "Catalog":', "ARIA snapshot includes nested structure");
      assertIncludes(yaml, "- listitem: Wireless Controller", "ARIA snapshot includes normalized text");
      assertIncludes(
        yaml,
        '- button "Checkout" [disabled] [pressed]',
        "ARIA snapshot includes boolean states"
      );
      assertIncludes(yaml, "- /url: /controller-details", "ARIA snapshot includes raw link URL");
      assertIncludes(
        yaml,
        "- /placeholder: buyer@example.com",
        "ARIA snapshot includes placeholder"
      );
      assertIncludes(yaml, "customer@example.com", "ARIA snapshot includes input value");
      assertIncludes(yaml, '- checkbox "Gift wrap" [checked]', "ARIA snapshot includes checked state");
      assert(!yaml.includes("Hidden promotion"), "ARIA snapshot excludes aria-hidden content");

      const pageYaml = await page.ariaSnapshot({ timeout: 3000 });
      assertIncludes(pageYaml, "Helper e2e fixture", "page.ariaSnapshot captures the body");

      const depthOne = await fixture.ariaSnapshot({ depth: 1 });
      assertIncludes(depthOne, '- list "Catalog"', "depth keeps the boundary node");
      assert(
        !depthOne.includes("Wireless Controller"),
        "depth removes descendants below the boundary"
      );
      const unlimited = await fixture.ariaSnapshot({ depth: 0 });
      assertIncludes(
        unlimited,
        "Wireless Controller",
        "depth zero keeps the full subtree"
      );

      const withBoxes = await fixture.ariaSnapshot({ boxes: true });
      const rootBoxMatch = withBoxes.match(
        /region "Store" \\[box=(-?\\d+(?:\\.\\d+)?),(-?\\d+(?:\\.\\d+)?),(\\d+(?:\\.\\d+)?),(\\d+(?:\\.\\d+)?)\\]/
      );
      assert(rootBoxMatch, "boxes include viewport coordinates");
      const expectedRootBox = await fixture.boundingBox();
      const actualRootBox = rootBoxMatch.slice(1).map(Number);
      assert(
        Math.abs(actualRootBox[0] - expectedRootBox.x) <= 1 &&
          Math.abs(actualRootBox[1] - expectedRootBox.y) <= 1 &&
          Math.abs(actualRootBox[2] - expectedRootBox.width) <= 1 &&
          Math.abs(actualRootBox[3] - expectedRootBox.height) <= 1,
        "ARIA boxes match locator viewport coordinates"
      );

      await page.evaluate(() => {
        setTimeout(() => {
          const delayed = document.createElement("button");
          delayed.id = "aria-delayed";
          delayed.textContent = "Delayed action";
          document.body.append(delayed);
        }, 250);
      });
      const delayedStartedAt = Date.now();
      assertIncludes(
        await page.locator("#aria-delayed").ariaSnapshot({ timeout: 2000 }),
        '- button "Delayed action"',
        "ariaSnapshot auto-waits for a delayed locator"
      );
      assert(
        Date.now() - delayedStartedAt >= 150,
        "delayed ariaSnapshot did not resolve before the element existed"
      );

      await assertRejects(
        () => page.locator("#aria-never").ariaSnapshot({ timeout: 200 }),
        "locator.ariaSnapshot timed out after 200ms",
        "missing locator reports a Playwright-style timeout"
      );

      await page.evaluate(() => {
        for (let index = 0; index < 2; index++) {
          const duplicate = document.createElement("button");
          duplicate.className = "aria-snapshot-duplicate";
          duplicate.textContent = "Duplicate";
          document.body.append(duplicate);
        }
      });
      await assertRejects(
        () => page.locator(".aria-snapshot-duplicate").ariaSnapshot({ timeout: 500 }),
        "matched 2 elements",
        "ariaSnapshot keeps locator strictness"
      );
      await assertRejects(
        () => fixture.ariaSnapshot({ mode: "ai" }),
        'mode "ai" is not supported',
        "AI mode reports the ego snapshot alternative"
      );
      await assertRejects(
        () => fixture.ariaSnapshot({ ref: true }),
        "ref: true is not supported",
        "Playwright 1.52 ref mode reports the ego snapshot alternative"
      );

      const frameBody = page
        .frameLocator("#fixture-frame")
        .locator("body");
      assertEqual(
        await frameBody.ariaSnapshot({ timeout: 3000 }),
        "",
        "a frame hidden by its owner has no exposed accessibility subtree"
      );
      await page.locator("#fixture-frame").evaluate((element) => {
        element.style.display = "block";
        element.style.width = "480px";
        element.style.height = "320px";
      });
      await page.waitForTimeout(100);
      const frameYaml = await frameBody.ariaSnapshot({ timeout: 3000 });
      assertIncludes(
        frameYaml,
        "iframe target",
        "frame-scoped ariaSnapshot captures child frame content"
      );

      const hiddenYaml = await page
        .locator("#aria-snapshot-fixture [aria-hidden=true]")
        .ariaSnapshot();
      assertEqual(hiddenYaml, "", "an inaccessible root produces an empty snapshot");

      const dialogPromise = page.waitForEvent("dialog", { timeout: 2000 });
      await page.evaluate(() => setTimeout(() => alert("ARIA capture blocked"), 0));
      const dialog = await dialogPromise;
      await assertRejects(
        () => fixture.ariaSnapshot({ timeout: 500 }),
        "cannot capture while a JavaScript dialog is open",
        "ariaSnapshot fails promptly while a dialog blocks the page"
      );
      await dialog.dismiss();

      assertIncludes(
        help("page.ariaSnapshot"),
        "default-mode ARIA snapshot",
        "page ariaSnapshot is documented in runtime help"
      );
      assertIncludes(
        help("locator.ariaSnapshot"),
        "Frame-scoped locators are supported",
        "locator ariaSnapshot is documented in runtime help"
      );
    `),
  },
];
