import { TEST_CASES } from "../../site/test-cases.mjs";

export const scenarioProgressCase = {
  name: "test-site scenario progress",
  kind: "runtime",
  body() {
    return `
      const task = await openE2eTaskSpace(taskName);
      await task.page.goto(baseUrl + "/tests/forms", {
        waitUntil: "load",
        timeout: 20_000,
      });
      const observerPage = await task.context.newPage();
      await observerPage.goto(baseUrl, {
        waitUntil: "load",
        timeout: 20_000,
      });
      const controls = task.page.getByTestId("scenario-test-controls");
      const formsDot = task.page.locator(
        '[data-progress-dot][data-progress-slug="forms"]',
      );
      const observerFormsDot = observerPage.locator(
        '[data-progress-dot][data-progress-slug="forms"]',
      );

      await controls.getByTestId("start-test").click();
      await task.page.waitForFunction(
        () => document.documentElement.dataset.progressSync === "idle",
      );
      assertEqual(
        await controls.getByTestId("test-status").textContent(),
        "In progress",
        "scenario progress starts from its page controls",
      );
      assertEqual(
        await controls.getByTestId("finish-test").isEnabled(),
        true,
        "finishing is enabled only while a scenario is running",
      );
      assertEqual(
        await formsDot.getAttribute("data-state"),
        "in-progress",
        "running scenario is blue in aggregate progress",
      );
      await observerPage.waitForFunction(() =>
        document.querySelector('[data-progress-dot][data-progress-slug="forms"]')?.dataset.state === "in-progress",
      );
      assertEqual(
        await observerFormsDot.getAttribute("data-state"),
        "in-progress",
        "an already-open observer page receives the running state in real time",
      );

      await controls.getByTestId("fail-test").click();
      await task.page.waitForFunction(
        () => document.documentElement.dataset.progressSync === "idle",
      );
      assertEqual(
        await controls.getByTestId("test-status").textContent(),
        "Failed",
        "scenario progress records an explicit failure",
      );
      assertEqual(
        await formsDot.getAttribute("data-state"),
        "failed",
        "failed scenario is red in aggregate progress",
      );
      await observerPage.waitForFunction(() =>
        document.querySelector('[data-progress-dot][data-progress-slug="forms"]')?.dataset.state === "failed",
      );
      assertEqual(
        await observerFormsDot.getAttribute("data-state"),
        "failed",
        "the observer page receives a failed state without reloading",
      );

      await controls.getByTestId("start-test").click();
      await task.page.waitForFunction(
        () => document.documentElement.dataset.progressSync === "idle",
      );
      assertEqual(
        await controls.getByTestId("test-status").textContent(),
        "In progress",
        "failed scenario can be restarted from its page header",
      );
      await controls.getByTestId("finish-test").click();
      await task.page.waitForFunction(
        () => document.documentElement.dataset.progressSync === "idle",
      );
      assertEqual(
        await controls.getByTestId("test-status").textContent(),
        "Completed",
        "scenario progress records completion",
      );
      assertEqual(
        await formsDot.getAttribute("data-state"),
        "completed",
        "completed scenario is green in aggregate progress",
      );
      await observerPage.waitForFunction(() =>
        document.querySelector('[data-progress-dot][data-progress-slug="forms"]')?.dataset.state === "completed",
      );
      assertEqual(
        await observerFormsDot.getAttribute("data-state"),
        "completed",
        "the observer page receives completion without reloading",
      );

      const scenarioSlugs = ${JSON.stringify(TEST_CASES.map((testCase) => testCase.slug))};
      await task.page.evaluate(async (slugs) => {
        for (const slug of slugs) {
          const response = await fetch("/api/test-progress/" + encodeURIComponent(slug), {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ status: "completed" }),
          });
          if (!response.ok) throw new Error("Unable to complete " + slug);
        }
      }, scenarioSlugs);
      const totalScenarios = ${TEST_CASES.length};
      await observerPage.waitForFunction(
        (expected) => document.querySelector("[data-progress-completed]")?.textContent === String(expected),
        totalScenarios,
      );
      assertEqual(
        await observerPage
          .getByRole("progressbar", { name: "Scenario test progress" })
          .getAttribute("aria-valuenow"),
        String(totalScenarios),
        "home progress exposes the completed scenario total accessibly",
      );
      assertEqual(
        await observerPage.locator('[data-progress-dot][data-state="completed"]').count(),
        totalScenarios,
        "home progress shows every scenario as completed",
      );
      await observerPage.close();
    `;
  },
};
