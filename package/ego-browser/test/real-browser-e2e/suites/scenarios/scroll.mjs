import { scenarioCase } from "./scenario-case.mjs";

export const scrollScenarioCase = scenarioCase(
  "scroll",
  `
      const timeline = page.locator("#nested-scroll");
      await page.getByRole("button", { name: "Next activity" }).click();
      assertEqual(await page.getByTestId("active-activity").textContent(), "Covered linkway", "next action advances the activity timeline");
      await page.getByRole("button", { name: "Previous activity" }).click();
      assertEqual(await page.getByTestId("active-activity").textContent(), "Courtyard entry", "previous action returns to the prior activity");
      await page.getByRole("button", { name: "Open Market edge activity" }).click();
      assertEqual(await page.getByTestId("active-activity").textContent(), "Market edge", "a timeline entry can be selected directly");
      assertIncludes(await page.getByTestId("activity-detail").textContent(), "planting", "selected activity exposes its field note");
      await page.getByRole("button", { name: "Mark activity reviewed" }).click();
      assertEqual(await page.getByTestId("reviewed-activity-count").textContent(), "1", "timeline tracks independently reviewed activities");
      await timeline.hover();
      await page.mouse.wheel(0, 480);
      await page.waitForFunction(() => Number(document.querySelector('[data-testid="nested-scroll-top"]').textContent) > 0);
      assert(Number(await page.getByTestId("nested-scroll-top").textContent()) > 0, "a real wheel gesture advances the independent activity timeline");
      await page.mouse.wheel(0, 800);
      assertEqual(await page.locator("#nested-marker").isVisible(), true, "nested marker becomes visible after scrolling");
      await page.getByRole("button", { name: "Reset timeline" }).click();
      assertEqual(await page.getByTestId("nested-scroll-top").textContent(), "0", "timeline reset returns the nested region to its start");
      assertEqual(await page.getByTestId("reviewed-activity-count").textContent(), "0", "timeline reset clears review workflow state");
      const appHeaderBox = await page.getByTestId("app-header").boundingBox();
      await page.mouse.move(20, appHeaderBox.height + 20);
      await page.mouse.wheel(0, 1800);
      const markerVisible = await page.locator("#document-marker").evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return rect.top < innerHeight && rect.bottom > 0;
      });
      assertEqual(markerVisible, true, "document-level scroll reveals the end note");
      assertEqual(await page.getByTestId("app-header").evaluate((element) => Math.round(element.getBoundingClientRect().top)), 0, "shared header remains pinned after document scrolling");
      assert(Number(await page.getByTestId("reading-progress").textContent()) > 0, "document scrolling reports reading progress");
    `,
);
