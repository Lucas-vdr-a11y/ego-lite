import { scenarioCase } from "./scenario-case.mjs";

export const clicksScenarioCase = scenarioCase(
  "clicks",
  `
      const approve = page.getByRole("button", { name: "Approve dispatch" });
      const eventProbe = page.getByRole("button", { name: "Test click events" });
      assertEqual(await page.getByTestId("order-menu").isVisible(), false, "context actions remain hidden before a secondary click");
      await page.getByRole("button", { name: "More actions" }).click();
      assertEqual(await page.getByTestId("order-menu").isVisible(), true, "ordinary click opens contextual actions for keyboard and touch users");
      await page.keyboard.press("Escape");
      assertEqual(await page.getByTestId("order-menu").isVisible(), false, "Escape closes contextual actions");
      await eventProbe.click();
      assertEqual(await page.getByTestId("click-count").textContent(), "1", "single click updates the dispatch activity");
      await eventProbe.dblclick();
      assertEqual(await page.getByTestId("click-count").textContent(), "3", "double click dispatches two additional click events");
      assertEqual(await page.getByTestId("double-click-count").textContent(), "1", "double click emits a dblclick event");
      await page.getByRole("button", { name: "More actions" }).click({ button: "right" });
      assertEqual(await page.getByTestId("right-click-count").textContent(), "1", "secondary click opens the order context action");
      const filter = page.getByRole("button", { name: "Show all orders" });
      await filter.click();
      assertEqual(await page.getByTestId("visible-order-count").textContent(), "4", "filter action reveals the held order");
      assertEqual(await page.getByTestId("held-order").isVisible(), true, "held order becomes visible in the expanded queue");
      await page.getByRole("button", { name: "Show ready orders" }).click();
      assertEqual(await page.getByTestId("visible-order-count").textContent(), "3", "filter action restores the ready-only queue");
      await page.getByRole("button", { name: "Select order EG-1846" }).click();
      assertEqual(await page.getByTestId("selected-order").textContent(), "EG-1846", "clicking a row changes the selected order");
      assertEqual(await page.getByTestId("selected-order-status").textContent(), "Ready", "selection exposes the order workflow status");
      await approve.click();
      assertEqual(await page.getByTestId("selected-order-status").textContent(), "Dispatched", "approving dispatch changes the selected order workflow state");
      assertEqual(await page.getByTestId("order-result").textContent(), "EG-1846 dispatched", "dispatch produces a visible business result");
      assertEqual(await approve.isEnabled(), false, "a dispatched order cannot be dispatched twice");
      await page.getByRole("button", { name: "Select order EG-1842" }).click();
      assertEqual(await approve.isEnabled(), true, "selecting another ready order restores the available action");
      await page.getByRole("button", { name: "More actions" }).click({ button: "right" });
      assertEqual(await page.getByTestId("order-menu").isVisible(), true, "secondary click reveals contextual order actions");
      await page.getByRole("menuitem", { name: "Place selected order on hold" }).click();
      assertEqual(await page.getByTestId("order-result").textContent(), "EG-1842 placed on hold", "context action updates the selected order workflow");
      assertEqual(await page.getByTestId("selected-order-status").textContent(), "On hold", "hold action changes the selected order state");
      assertEqual(await approve.isEnabled(), false, "held orders cannot be dispatched");
      await page.getByRole("button", { name: "Reset activity" }).click();
      assertEqual(await page.getByTestId("click-count").textContent(), "0", "reset clears click counters");
      assertEqual(await page.getByTestId("selected-order").textContent(), "EG-1842", "reset restores the default order selection");
      assertEqual(await page.getByTestId("selected-order-status").textContent(), "Ready", "reset restores order workflow state");
      const { stat } = await import("node:fs/promises");
      const screenshotPath = join(artifactDir, "dispatch-queue.png");
      await page.screenshot({ path: screenshotPath, fullPage: true, timeout: 60_000 });
      assert((await stat(screenshotPath)).size > 0, "native Playwright writes a full-page screenshot");
    `,
);
