import { scenarioCase } from "./scenario-case.mjs";

export const navigationScenarioCase = scenarioCase(
  "navigation",
  `
      await observedAction(page, page.getByRole("button", { name: "Customer signals" }), "click");
      assertEqual(await page.getByTestId("navigation-section").textContent(), "Customer signals", "workspace navigation switches the active research section");
      assertEqual(await page.getByRole("button", { name: "Customer signals" }).getAttribute("aria-selected"), "true", "active navigation section exposes its selected state");
      assertEqual(await page.getByTestId("section-heading").textContent(), "Customer signals", "section navigation changes the visible knowledge content");
      assertIncludes(await page.getByTestId("section-records").textContent(), "Repeat buyers", "customer section renders its own records instead of a label-only selection");
      await observedAction(page, page.getByLabel("Search current section"), "fill", "service");
      assertEqual(await page.getByTestId("section-result-count").textContent(), "1", "knowledge search filters records in the active section");
      await observedAction(page, page.getByRole("button", { name: "Clear knowledge search" }), "click");
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
      await observedAction(page, newPageLink, "click");
      const independentPage = await independentPagePromise;
      await independentPage.waitForLoadState("load", { timeout: 10_000 });
      assertIncludes(independentPage.url(), "/tests/navigation/destination", "clicking the independent reference opens a BrowserContext page");
      assertEqual(await independentPage.getByRole("heading", { name: "Launch in two measured phases." }).count(), 1, "independent Page renders the decision record");
      await observedClosePage(independentPage, "independent decision page");

      const slowPage = await task.context.newPage();
      await slowPage.goto(baseUrl + "/tests/navigation/slow-load", {
        waitUntil: "domcontentloaded",
        timeout: 5_000,
      });
      assertEqual(await slowPage.title(), "Committed before load", "Page.goto resolves at DOMContentLoaded while a resource still blocks load");
      assertEqual(await slowPage.evaluate(() => document.readyState), "interactive", "slow fixture has not reached the load lifecycle");
      await slowPage.waitForLoadState("load", { timeout: 15_000 });
      assertEqual(await slowPage.evaluate(() => document.readyState), "complete", "native lifecycle still reports a load that completes after the synthesis window");
      await observedClosePage(slowPage, "slow-load probe page");

      const delayedPage = await task.context.newPage();
      const [delayedResponse, delayedRequest] = await Promise.all([
        delayedPage.goto(baseUrl + "/tests/navigation/delayed-document", {
          waitUntil: "load",
          timeout: 10_000,
        }),
        delayedPage.waitForEvent("requestfinished", {
          predicate: (request) => request.isNavigationRequest(),
          timeout: 10_000,
        }),
      ]);
      assertEqual(delayedResponse?.status(), 200, "Page.goto returns the delayed main-document Response");
      assertEqual(delayedRequest.url(), baseUrl + "/tests/navigation/delayed-document", "Page.goto finishes the main document request");
      assertEqual(await delayedPage.title(), "Delayed document ready", "Page.goto(load) waits before an immediate title read");
      assertEqual(await delayedPage.locator("body").textContent(), "delayed-document-body", "Page.goto(load) waits before an immediate body read");
      await observedClosePage(delayedPage, "delayed-document probe page");

      const lateCommitPage = await task.context.newPage();
      const lateCommitResponse = await lateCommitPage.goto(
        baseUrl + "/tests/navigation/delayed-document?delay=9000",
        { waitUntil: "load", timeout: 15_000 },
      );
      assertEqual(lateCommitResponse?.status(), 200, "Page.goto accepts a main-document commit after the former eight-second transport limit");
      assertEqual(await lateCommitPage.title(), "Delayed document ready", "a late committed document is immediately readable");
      await observedClosePage(lateCommitPage, "late-commit probe page");

      const missingPage = await task.context.newPage();
      const missingResponse = await missingPage.goto(
        baseUrl + "/tests/navigation/not-found",
        { waitUntil: "load", timeout: 10_000 },
      );
      assertEqual(missingResponse?.status(), 404, "Page.goto preserves a non-200 main-document status");
      assertEqual(await missingPage.title(), "Navigation target missing", "a non-200 document remains immediately readable");
      await observedClosePage(missingPage, "missing-document probe page");

      const redirectPage = await task.context.newPage();
      const redirectResponse = await redirectPage.goto(
        baseUrl + "/tests/navigation/redirect",
        { waitUntil: "load", timeout: 10_000 },
      );
      assertEqual(redirectResponse?.url(), baseUrl + "/tests/navigation/redirect-target", "Page.goto Response exposes the final redirect URL");
      assertEqual(redirectPage.url(), baseUrl + "/tests/navigation/redirect-target", "Page exposes the final redirect URL");
      assertEqual(await redirectPage.title(), "Redirect target ready", "the redirected document is immediately readable");
      await observedClosePage(redirectPage, "redirect probe page");

      await Promise.all([
        page.waitForURL("**/tests/navigation/destination?source=select", {
          waitUntil: "load",
          timeout: 5_000,
        }),
        observedAction(page, page.getByLabel("Decision route"), "selectOption", "select"),
      ]);
      assertIncludes(page.url(), "source=select", "waitForURL observes selectOption navigation through load");
      assertIncludes(await page.locator("#destination-status").textContent(), "complete decision record", "selectOption reaches the destination document");

      await page.goto(baseUrl + "/tests/navigation", { waitUntil: "load", timeout: 10_000 });
      await observedAction(page, page.locator("#same-page-link"), "click");
      assertIncludes(page.url(), "source=click", "Locator.click waits for its same-page navigation");
      assertIncludes(await page.locator("#destination-status").textContent(), "complete decision record", "click reaches the destination document");

      await page.goto(baseUrl + "/tests/navigation", { waitUntil: "load", timeout: 10_000 });
      await observedAction(page, page.getByLabel("Open decision record"), "press", "Enter");
      assertIncludes(page.url(), "source=enter", "Locator.press waits for its form navigation");
      assertIncludes(await page.locator("#destination-status").textContent(), "complete decision record", "destination provides an authoritative navigation signal");
      await page.goBack({ waitUntil: "load" });
      assertIncludes(page.url(), "/tests/navigation", "browser history returns to the research index");
      await Promise.all([
        page.waitForURL(baseUrl + "/", { waitUntil: "load", timeout: 5_000 }),
        observedAction(page, page.getByRole("link", { name: "← All fixtures" }), "click"),
      ]);
      assertEqual(await page.getByRole("heading", { name: "Test routes" }).isVisible(), true, "scenario navigation returns to the complete fixture index");
      await page.goto(baseUrl + "/tests/navigation", { waitUntil: "load", timeout: 10_000 });
    `,
);
