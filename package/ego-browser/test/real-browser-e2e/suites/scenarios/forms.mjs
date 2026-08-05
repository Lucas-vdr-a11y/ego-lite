import { scenarioCase } from "./scenario-case.mjs";

export const formsScenarioCase = scenarioCase(
  "forms",
  `
      await observedAction(page, page.getByRole("button", { name: "Submit for scheduling" }), "click");
      assertEqual(await page.getByTestId("form-result").textContent(), "Enter a project name to continue", "form submission reports the first missing requirement");
      await observedAction(page, page.getByLabel("Project name"), "fill", "Autumn retail launch");
      await observedAction(page, page.getByRole("button", { name: "Submit for scheduling" }), "click");
      assertEqual(await page.getByTestId("form-result").textContent(), "Describe the requested work to continue", "form submission reports a missing brief");
      await observedAction(page, page.getByLabel("What do you need?"), "fill", "Short");
      await observedAction(page, page.getByRole("button", { name: "Submit for scheduling" }), "click");
      assertEqual(await page.getByTestId("form-result").textContent(), "Add at least 20 characters to the brief", "form submission rejects an underspecified brief");
      await observedAction(page, page.getByLabel("What do you need?"), "fill", "1234567890123456789");
      await observedAction(page, page.getByRole("button", { name: "Submit for scheduling" }), "click");
      assertEqual(await page.getByTestId("form-result").textContent(), "Add at least 20 characters to the brief", "19-character brief is rejected at the lower boundary");
      await observedAction(page, page.getByLabel("What do you need?"), "fill", "A complete launch toolkit for retail and social channels.");
      await observedAction(page, page.getByLabel("Budget owner approved"), "check");
      await observedAction(page, page.getByRole("button", { name: "Submit for scheduling" }), "click");
      assertEqual(await page.getByTestId("form-result").textContent(), "Choose a target date to continue", "form submission reports a missing target date after prior requirements pass");
      await observedAction(page, page.getByLabel("Budget owner approved"), "uncheck");
      await observedAction(page, page.getByLabel("Target date"), "fill", "2026-09-15");
      await observedAction(page, page.getByLabel("Priority"), "selectOption", "urgent");
      await observedAction(page, page.getByRole("button", { name: "Submit for scheduling" }), "click");
      assertEqual(await page.getByTestId("form-result").textContent(), "Confirm budget approval to continue", "form submission reports missing budget approval");
      await observedAction(page, page.getByLabel("Budget owner approved"), "check");
      await observedAction(page, page.getByLabel("Full campaign system"), "check");
      assertEqual(await page.getByTestId("form-text").textContent(), "Autumn retail launch", "project name updates the request summary");
      assertIncludes(await page.getByTestId("form-notes").textContent(), "launch toolkit", "brief notes update the request summary");
      assertEqual(await page.getByTestId("form-priority").textContent(), "urgent", "priority selection updates the request summary");
      assertEqual(await page.getByTestId("form-approved").textContent(), "true", "checkbox approval updates the request summary");
      assertEqual(await page.getByTestId("form-plan").textContent(), "pro", "radio selection updates the delivery plan");
      await observedAction(page, page.getByRole("button", { name: "Add stakeholder" }), "click");
      assertEqual(await page.getByTestId("stakeholder-error").textContent(), "Enter a stakeholder name and valid email", "stakeholder editor validates empty details");
      await observedAction(page, page.getByLabel("Stakeholder name"), "fill", "Mei Lin");
      await observedAction(page, page.getByLabel("Stakeholder email"), "fill", "mei.example.com");
      await observedAction(page, page.getByRole("button", { name: "Add stakeholder" }), "click");
      assertEqual(await page.getByTestId("stakeholder-error").textContent(), "Enter a stakeholder name and valid email", "stakeholder editor rejects an invalid stakeholder email");
      await observedAction(page, page.getByLabel("Stakeholder email"), "fill", "mei@example.com");
      await observedAction(page, page.getByLabel("Stakeholder role"), "selectOption", "Product");
      await observedAction(page, page.getByRole("button", { name: "Add stakeholder" }), "click");
      assertIncludes(await page.getByTestId("stakeholder-list").textContent(), "Mei Lin", "form adds a stakeholder from human-entered details");
      assertIncludes(await page.getByTestId("stakeholder-list").textContent(), "mei@example.com", "stakeholder list retains contact details");
      await observedAction(page, page.getByRole("button", { name: "Remove Mei Lin" }), "click");
      assertEqual(await page.getByTestId("stakeholder-list").textContent(), "No stakeholders added", "stakeholder can be removed independently");
      await observedAction(page, page.getByLabel("Stakeholder name"), "fill", "Mei Lin");
      await observedAction(page, page.getByLabel("Stakeholder email"), "fill", "mei@example.com");
      await observedAction(page, page.getByRole("button", { name: "Add stakeholder" }), "click");
      await observedAction(page, page.getByRole("button", { name: "Submit for scheduling" }), "click");
      assertEqual(await page.getByTestId("form-result").textContent(), "Scheduled: Autumn retail launch", "valid request completes the scheduling workflow");
      assertIncludes(await page.getByTestId("form-schedule").textContent(), "15 Sep 2026", "completed request renders the scheduled target date");
      await observedAction(page, page.getByRole("button", { name: "Reset request" }), "click");
      assertEqual(await page.getByLabel("Project name").inputValue(), "", "reset clears the project name");
      assertEqual(await page.getByTestId("form-result").textContent(), "Ready to validate", "reset restores the workflow state");
    `,
);
