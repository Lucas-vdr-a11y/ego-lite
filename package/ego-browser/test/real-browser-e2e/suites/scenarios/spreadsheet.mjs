import { scenarioCase } from "./scenario-case.mjs";

export const spreadsheetScenarioCase = scenarioCase(
  "spreadsheet",
  `
      const grid = page.getByRole("grid", { name: "Editable launch budget" });
      assertEqual(await grid.isVisible(), true, "workbook renders an accessible interactive data grid");
      await page.getByRole("button", { name: "Reset workbook" }).click();
      assertEqual(await page.getByRole("button", { name: "Save workbook" }).isDisabled(), true, "saved workbook starts in a clean state");

      const researchRow = page.getByTestId("budget-row-research");
      await researchRow.locator('[data-column="quantity"]').click();
      assertEqual(await page.getByLabel("Formula bar").inputValue(), "2", "formula bar exposes the selected editable value");
      await page.getByLabel("Formula bar").fill("4");
      await page.getByLabel("Formula bar").press("Enter");
      await page.waitForFunction(() => document.querySelector('[data-testid="sheet-total"]')?.textContent === "S$ 9,000");
      assertEqual(await page.getByTestId("sheet-status").textContent(), "Unsaved changes", "formula edit marks the workbook dirty");

      await researchRow.locator('[data-column="rate"]').dblclick();
      const rateEditor = page.getByRole("spinbutton", { name: "Rate for Research interviews" });
      await rateEditor.fill("-100");
      await rateEditor.press("Enter");
      assertEqual(await page.getByTestId("sheet-error").textContent(), "Rate must be zero or greater", "invalid financial input is rejected with a useful error");
      assertEqual(await page.getByTestId("sheet-total").textContent(), "S$ 9,000", "invalid edit does not corrupt calculated spend");

      await page.getByRole("button", { name: "Undo workbook change" }).click();
      assertEqual(await page.getByTestId("sheet-total").textContent(), "S$ 6,600", "undo restores the previous workbook snapshot");
      await page.getByRole("button", { name: "Redo workbook change" }).click();
      assertEqual(await page.getByTestId("sheet-total").textContent(), "S$ 9,000", "redo reapplies the reverted workbook change");

      await page.getByRole("button", { name: "Add budget row" }).click();
      const addedRow = page.getByTestId("budget-row-new-4");
      assertEqual(await addedRow.isVisible(), true, "new budget row is rendered in the data grid");
      await addedRow.locator('[data-column="workItem"]').dblclick();
      await page.getByRole("textbox", { name: "Work item for New budget item 4" }).fill("");
      await page.getByRole("textbox", { name: "Work item for New budget item 4" }).press("Enter");
      assertEqual(await page.getByTestId("sheet-error").textContent(), "Work item is required", "blank work item is rejected before it can enter the budget");
      assertIncludes(await addedRow.locator('[data-column="workItem"]').textContent(), "New budget item 4", "invalid text edit restores the previous work item");
      await addedRow.locator('[data-column="workItem"]').dblclick();
      await page.getByRole("textbox", { name: "Work item for New budget item 4" }).fill("Localisation QA");
      await page.getByRole("textbox", { name: "Work item for New budget item 4" }).press("Enter");
      await addedRow.locator('[data-column="rate"]').dblclick();
      await page.getByRole("spinbutton", { name: "Rate for Localisation QA" }).fill("450");
      await page.getByRole("spinbutton", { name: "Rate for Localisation QA" }).press("Enter");

      await page.getByTestId("budget-row-legal").click();
      assertEqual(await page.getByRole("button", { name: "Delete selected row" }).isEnabled(), true, "row selection enables the protected delete action");
      await page.getByRole("button", { name: "Delete selected row" }).click();
      assertEqual(await page.getByTestId("budget-row-legal").count(), 0, "delete removes only the selected budget line");
      await page.getByRole("button", { name: "Undo workbook change" }).click();
      assertEqual(await page.getByTestId("budget-row-legal").isVisible(), true, "deleted row can be recovered through undo");

      await page.getByRole("button", { name: "Save workbook" }).click();
      assertEqual(await page.getByTestId("sheet-status").textContent(), "All changes saved", "saving clears the workbook dirty state");
      await page.reload({ waitUntil: "load" });
      assertEqual(await page.getByTestId("budget-row-new-4").isVisible(), true, "saved workbook rows survive a full page reload");
      assertEqual(await page.getByTestId("sheet-total").textContent(), "S$ 9,450", "saved calculated spend survives a full page reload");
      await page.getByRole("button", { name: "Reset workbook" }).click();
      await page.reload({ waitUntil: "load" });
      assertEqual(await page.getByTestId("budget-row-new-4").count(), 0, "workbook reset survives a full page reload");
      assertEqual(await page.getByTestId("sheet-total").textContent(), "S$ 6,600", "durable reset restores the seeded calculated total");
      assertEqual(await page.getByRole("button", { name: "Save workbook" }).isDisabled(), true, "reloaded reset workbook remains clean");
    `,
);
