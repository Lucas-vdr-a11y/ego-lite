import { scenarioCase } from "./scenario-case.mjs";

export const dialogsScenarioCase = scenarioCase(
  "dialogs",
  `
      const alertPromise = page.waitForEvent("dialog", { timeout: 5_000 });
      const alertClick = observedAction(page, page.getByRole("button", { name: "Preview notice" }), "click");
      const alertDialog = await alertPromise;
      assertEqual(alertDialog.type(), "alert", "release notice opens an alert dialog");
      assertEqual(alertDialog.message(), "ego alert", "alert exposes its message");
      await alertDialog.dismiss();
      await alertClick;
      assertEqual(await page.getByTestId("dialog-result").textContent(), "alert closed", "workflow resumes after alert dismissal");

      const confirmPromise = page.waitForEvent("dialog", { timeout: 5_000 });
      const confirmClick = observedAction(page, page.getByRole("button", { name: "Request approval" }), "click");
      const confirmDialog = await confirmPromise;
      await confirmDialog.accept();
      await confirmClick;
      assertEqual(await page.getByTestId("dialog-result").textContent(), "confirmed", "accepted confirmation updates release state");

      const dismissPromise = page.waitForEvent("dialog", { timeout: 5_000 });
      const dismissClick = observedAction(page, page.getByRole("button", { name: "Request approval" }), "click");
      const dismissDialog = await dismissPromise;
      await dismissDialog.dismiss();
      await dismissClick;
      assertEqual(await page.getByTestId("dialog-result").textContent(), "dismissed", "dismissed confirmation preserves the negative workflow result");

      const promptPromise = page.waitForEvent("dialog", { timeout: 5_000 });
      const promptClick = observedAction(page, page.getByRole("button", { name: "Set release name" }), "click");
      const promptDialog = await promptPromise;
      await promptDialog.accept("release-candidate");
      await promptClick;
      assertEqual(await page.getByTestId("dialog-result").textContent(), "release-candidate", "prompt text is returned to the release workflow");
      const cancelPromise = page.waitForEvent("dialog", { timeout: 5_000 });
      const cancelClick = observedAction(page, page.getByRole("button", { name: "Set release name" }), "click");
      const cancelDialog = await cancelPromise;
      await cancelDialog.dismiss();
      await cancelClick;
      assertEqual(await page.getByTestId("dialog-result").textContent(), "cancelled", "cancelled prompt preserves an explicit cancelled result");
      assertEqual(await page.getByTestId("dialog-count").textContent(), "5", "dialog workflow counts every completed dialog path");
      assertEqual(await page.getByTestId("release-approval").textContent(), "Approved", "an accepted approval remains part of the staged release after a later dismissed check");
      assertEqual(await page.getByTestId("release-name").textContent(), "release-candidate", "an accepted release name remains staged after a later cancelled prompt");
      const publish = page.getByRole("button", { name: "Publish release" });
      assertEqual(await publish.isEnabled(), true, "completed dialog prerequisites enable the final release action");
      await observedAction(page, publish, "click");
      assertEqual(await page.getByTestId("release-workflow-state").textContent(), "Published release-candidate", "dialog prerequisites complete one coherent publication workflow");
      await observedAction(page, page.getByRole("button", { name: "Reset dialog history" }), "click");
      assertEqual(await page.getByTestId("dialog-result").textContent(), "waiting", "dialog reset restores the initial result");
      assertEqual(await publish.isEnabled(), false, "dialog reset also resets publication prerequisites");
    `,
);
