import { scenarioCase } from "./scenario-case.mjs";

export const reviewWorkflowScenarioCase = scenarioCase(
  "review-workflow",
  `
      const assign = page.getByRole("button", { name: "Assign review" });
      assertEqual(await page.getByTestId("review-status").textContent(), "Draft", "review starts from a visible draft state");
      assertEqual(await assign.isEnabled(), false, "review cannot be assigned without a lead reviewer");
      await page.getByLabel("Lead reviewer", { exact: true }).selectOption("Aisha Rahman");
      await assign.click();
      assertEqual(await page.getByTestId("review-status").textContent(), "In review", "coordinator assignment starts expert review");
      assertIncludes(await page.getByTestId("review-result").textContent(), "Aisha Rahman assigned", "assignment records the selected reviewer");

      await page.getByLabel("Acting as").selectOption("reviewer");
      assertEqual(await page.getByRole("button", { name: "Request changes" }).isEnabled(), false, "reviewer cannot request changes before recording a finding");
      assertEqual(await page.getByRole("button", { name: "Approve review" }).isEnabled(), false, "reviewer cannot approve while findings are open or review is incomplete");
      await page.getByRole("button", { name: "Add finding" }).click();
      assertEqual(await page.getByTestId("review-result").textContent(), "Describe the finding before adding it", "empty findings are rejected with an actionable message");
      await page.getByLabel("Finding severity").selectOption("Advisory");
      await page.getByRole("textbox", { name: "Review finding", exact: true }).fill("The recyclability claim needs the supplier certificate.");
      await page.getByRole("button", { name: "Add finding" }).click();
      assertEqual(await page.getByTestId("finding-count").textContent(), "1 open", "reviewer records one advisory finding");
      assertIncludes(await page.locator("#review-findings").textContent(), "Advisory", "finding list preserves the selected severity");
      assertIncludes(await page.locator("#review-findings").textContent(), "supplier certificate", "finding list preserves the business evidence gap");
      assertEqual(await page.getByRole("button", { name: "Approve review" }).isEnabled(), false, "reviewer still cannot approve while findings are open");
      await page.getByRole("button", { name: "Request changes" }).click();
      assertEqual(await page.getByTestId("review-status").textContent(), "Changes requested", "reviewer returns the evidence to its author");

      await page.getByLabel("Acting as").selectOption("author");
      assertEqual(await page.getByRole("button", { name: "Approve review" }).isEnabled(), false, "author cannot approve a controlled review");
      assertEqual(await page.getByRole("button", { name: "Mark findings resolved" }).isEnabled(), true, "author can resolve findings only after changes are requested");
      await page.getByRole("button", { name: "Mark findings resolved" }).click();
      assertEqual(await page.getByTestId("finding-count").textContent(), "0 open", "author resolution closes all current findings");
      assertEqual(await page.getByTestId("review-status").textContent(), "Ready for approval", "resolved evidence returns to the approval stage");
      assertEqual(await page.getByRole("button", { name: "Approve review" }).isEnabled(), false, "author remains unable to self-approve resolved evidence");

      await page.getByLabel("Acting as").selectOption("reviewer");
      assertEqual(await page.getByRole("button", { name: "Approve review" }).isEnabled(), true, "reviewer can approve only after all findings are resolved");
      await page.getByRole("button", { name: "Approve review" }).click();
      assertEqual(await page.getByTestId("review-status").textContent(), "Approved", "lead reviewer completes the controlled workflow");
      assertIncludes(await page.getByTestId("review-result").textContent(), "approved by Aisha Rahman", "approval exposes the final accountable reviewer");
      assertIncludes(await page.locator("#review-audit-log").textContent(), "advisory finding", "audit trail records the selected finding severity");
      assertIncludes(await page.locator("#review-audit-log").textContent(), "Mei Lin resolved all findings", "audit trail spans coordinator, reviewer, and author actions");
    `,
);
