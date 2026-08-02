import { TEST_CASES } from "../../site/test-cases.mjs";

const secondLaneCases = new Set([
  "hover",
  "drag-drop",
  "canvas",
  "uploads",
  "scroll",
  "navigation",
  "collaborative-docs",
  "rich-text",
]);

export function scenarioCase(slug, body) {
  const testCase = TEST_CASES.find((candidate) => candidate.slug === slug);
  if (!testCase) throw new Error(`Unknown web test route: ${slug}`);
  return {
    name: `web test: ${slug}`,
    kind: "scenario",
    route: testCase.route,
    parallelLane: secondLaneCases.has(slug) ? 1 : 0,
    body: () => `
      const task = await egoBrowser.useOrCreateTaskSpace(taskName);
      const page = task.page;
      await page.goto(baseUrl + ${JSON.stringify(testCase.route)}, {
        waitUntil: "load",
        timeout: 20_000,
      });
      assertIncludes(page.url(), ${JSON.stringify(testCase.route)}, ${JSON.stringify(`${slug} route is loaded`)});
      assertEqual(await page.locator(".surface").isVisible(), true, ${JSON.stringify(`${slug} operation surface is visibly rendered`)});
      const appHeader = page.getByTestId("app-header");
      assertEqual(await appHeader.isVisible(), true, ${JSON.stringify(`${slug} keeps the shared app header visible`)});
      assertEqual(await page.getByTestId("test-progress-summary").isVisible(), true, ${JSON.stringify(`${slug} keeps overall test progress visible`)});
      assertIncludes(await appHeader.getAttribute("class"), "sticky-top", ${JSON.stringify(`${slug} app header remains sticky while the scenario scrolls`)});
      assertEqual(await appHeader.getByTestId("scenario-test-controls").count(), 0, ${JSON.stringify(`${slug} keeps scenario actions out of the global header`)});
      assertEqual(await appHeader.locator("[data-progress-dot]").count(), ${TEST_CASES.length}, ${JSON.stringify(`${slug} renders one aggregate progress dot per scenario`)});
      const scenarioControls = page.getByTestId("scenario-test-controls");
      assertEqual(await scenarioControls.isVisible(), true, ${JSON.stringify(`${slug} exposes lifecycle controls in its own page header`)});
      const currentProgressDot = appHeader.locator(${JSON.stringify(`[data-progress-dot][data-progress-slug="${slug}"]`)});
      await scenarioControls.getByTestId("start-test").click();
      await page.waitForFunction(() => document.documentElement.dataset.progressSync === "idle");
      assertEqual(await scenarioControls.getByTestId("test-status").textContent(), "In progress", ${JSON.stringify(`${slug} records its start before scenario operations`)});
      assertEqual(await currentProgressDot.getAttribute("data-state"), "in-progress", ${JSON.stringify(`${slug} turns its aggregate progress dot blue while running`)});

      try {
        /* scenario operations */
        ${body}
        await page.getByTestId("finish-test").click();
        await page.waitForFunction(() => document.documentElement.dataset.progressSync === "idle");
        assertEqual(await page.getByTestId("test-status").textContent(), "Completed", ${JSON.stringify(`${slug} records completion after all scenario assertions pass`)});
        assertEqual(await currentProgressDot.getAttribute("data-state"), "completed", ${JSON.stringify(`${slug} turns its aggregate progress dot green after completion`)});
      } catch (error) {
        try {
          if (new URL(page.url()).pathname !== ${JSON.stringify(testCase.route)}) {
            await page.goto(baseUrl + ${JSON.stringify(testCase.route)}, {
              waitUntil: "load",
              timeout: 10_000,
            });
          }
          const failButton = page.getByTestId("fail-test");
          if (await failButton.isEnabled()) {
            await failButton.click();
            await page.waitForFunction(() => document.documentElement.dataset.progressSync === "idle");
          }
        } catch (progressError) {
          error.message += "; unable to record scenario failure: " + progressError.message;
        }
        throw error;
      }
    `,
  };
}
