import { scenarioCase } from "./scenario-case.mjs";

export const navigationScenarioCase = scenarioCase(
  "navigation",
  `
      await page.getByRole("button", { name: "Customer signals" }).click();
      assertEqual(await page.getByTestId("navigation-section").textContent(), "Customer signals", "workspace navigation switches the active research section");
      assertEqual(await page.getByRole("button", { name: "Customer signals" }).getAttribute("aria-selected"), "true", "active navigation section exposes its selected state");
      assertEqual(await page.getByTestId("section-heading").textContent(), "Customer signals", "section navigation changes the visible knowledge content");
      assertIncludes(await page.getByTestId("section-records").textContent(), "Repeat buyers", "customer section renders its own records instead of a label-only selection");
      await page.getByLabel("Search current section").fill("service");
      assertEqual(await page.getByTestId("section-result-count").textContent(), "1", "knowledge search filters records in the active section");
      await page.getByRole("button", { name: "Clear knowledge search" }).click();
      assertEqual(await page.getByTestId("section-result-count").textContent(), "3", "clearing search restores all records in the section");
      const newPageLink = page.locator("#new-page-link");
      assertEqual(await newPageLink.getAttribute("target"), "_blank", "knowledge map exposes an independent-page reference");
      const pagesBeforeClick = new Set(task.context.pages());
      const independentPagePromise = task.context.waitForEvent("page", {
        predicate: (candidate) =>
          !pagesBeforeClick.has(candidate) &&
          candidate.url().includes("/tests/navigation/destination?source=new-page"),
        timeout: 10_000,
      });
      await newPageLink.click();
      const independentPage = await independentPagePromise;
      await independentPage.waitForLoadState("load", { timeout: 10_000 });
      assertIncludes(independentPage.url(), "/tests/navigation/destination", "clicking the independent reference opens a BrowserContext page");
      assertEqual(await independentPage.getByRole("heading", { name: "Launch in two measured phases." }).count(), 1, "independent Page renders the decision record");
      await independentPage.close();

      const slowPage = await task.context.newPage();
      await slowPage.goto(baseUrl + "/tests/navigation/slow-load", {
        waitUntil: "domcontentloaded",
        timeout: 5_000,
      });
      assertEqual(await slowPage.title(), "Committed before load", "Page.goto resolves at DOMContentLoaded while a resource still blocks load");
      assertEqual(await slowPage.evaluate(() => document.readyState), "interactive", "slow fixture has not reached the load lifecycle");
      await slowPage.waitForLoadState("load", { timeout: 15_000 });
      assertEqual(await slowPage.evaluate(() => document.readyState), "complete", "native lifecycle still reports a load that completes after the synthesis window");
      await slowPage.close();

      await Promise.all([
        page.waitForURL("**/tests/navigation/destination?source=select", {
          waitUntil: "load",
          timeout: 5_000,
        }),
        page.getByLabel("Decision route").selectOption("select"),
      ]);
      assertIncludes(page.url(), "source=select", "waitForURL observes selectOption navigation through load");
      assertIncludes(await page.locator("#destination-status").textContent(), "complete decision record", "selectOption reaches the destination document");

      await page.goto(baseUrl + "/tests/navigation", { waitUntil: "load", timeout: 10_000 });
      await page.locator("#same-page-link").click();
      assertIncludes(page.url(), "source=click", "Locator.click waits for its same-page navigation");
      assertIncludes(await page.locator("#destination-status").textContent(), "complete decision record", "click reaches the destination document");

      await page.goto(baseUrl + "/tests/navigation", { waitUntil: "load", timeout: 10_000 });
      await page.getByLabel("Open decision record").press("Enter");
      assertIncludes(page.url(), "source=enter", "Locator.press waits for its form navigation");
      assertIncludes(await page.locator("#destination-status").textContent(), "complete decision record", "destination provides an authoritative navigation signal");
      await page.goBack({ waitUntil: "load" });
      assertIncludes(page.url(), "/tests/navigation", "browser history returns to the research index");
      await Promise.all([
        page.waitForURL(baseUrl + "/", { waitUntil: "load", timeout: 5_000 }),
        page.getByRole("link", { name: "← All fixtures" }).click(),
      ]);
      assertEqual(await page.getByRole("heading", { name: "Test routes" }).isVisible(), true, "scenario navigation returns to the complete fixture index");
      await page.goto(baseUrl + "/tests/navigation", { waitUntil: "load", timeout: 10_000 });
    `,
);
