import { scenarioCase } from "./scenario-case.mjs";

export const svgMathmlScenarioCase = scenarioCase(
  "svg-mathml",
  `
      const model = page.getByTestId("capacity-model");
      const chart = page.getByLabel("Weekly shipment forecast");
      const formula = page.getByLabel("Capacity formula");
      const modelSnapshot = await model.ariaSnapshot({ ref: true });
      assertIncludes(modelSnapshot, "Weekly shipment forecast", "the observed model exposes the SVG chart context");
      assertIncludes(modelSnapshot, "Capacity formula", "the observed model exposes the MathML formula context");
      assertEqual(await chart.evaluate((element) => element.namespaceURI), "http://www.w3.org/2000/svg", "the forecast is parsed in the native SVG namespace");
      assertEqual(await formula.evaluate((element) => element.namespaceURI), "http://www.w3.org/1998/Math/MathML", "the formula is parsed in the native MathML namespace");
      assertEqual(await formula.locator("math").count(), 0, "the MathML instance does not nest another math root");
      assertEqual(await chart.isVisible(), true, "the shipment chart is visibly rendered");
      assertEqual(await formula.isVisible(), true, "the capacity formula is visibly rendered");
      const chartBox = await chart.boundingBox();
      const formulaBox = await formula.boundingBox();
      assert(chartBox?.width > 0 && chartBox?.height > 0, "the SVG chart occupies visible page geometry");
      assert(formulaBox?.width > 0 && formulaBox?.height > 0, "the MathML formula occupies visible page geometry");
      assert(await formula.evaluate((element) => element.scrollWidth <= element.clientWidth), "the MathML formula fits its visible calculation panel");
      await observedScreenshot(chart, "shipment forecast chart");

      const acknowledgeRisk = page.getByRole("button", {
        name: "Acknowledge week 4 capacity risk",
      });
      await observedAction(page, acknowledgeRisk, "click");
      assertEqual(await acknowledgeRisk.getAttribute("aria-pressed"), "true", "the HTML control embedded in SVG records the review");
      assertEqual(await page.getByTestId("capacity-risk-status").textContent(), "Week 4 capacity risk acknowledged", "the foreignObject action produces a visible review result");

      await observedAction(page, page.getByLabel("Capacity buffer percentage"), "fill", "51");
      await observedAction(page, page.getByRole("button", { name: "Calculate required capacity" }), "click");
      assertEqual(await page.getByTestId("capacity-form-status").textContent(), "Enter a buffer from 0% to 50%", "capacity calculation rejects the first value above the supported boundary");
      assertEqual(await page.getByTestId("formula-buffer").textContent(), "10", "an invalid buffer does not alter the rendered formula");
      assertEqual(await page.getByTestId("formula-result").textContent(), "106", "an invalid buffer preserves the prior capacity result");

      await observedAction(page, page.getByLabel("Capacity buffer percentage"), "fill", "12");
      await observedAction(page, page.getByRole("button", { name: "Calculate required capacity" }), "click");
      assertEqual(await page.getByTestId("capacity-form-status").textContent(), "Required capacity updated to 108 shipments", "a valid buffer recalculates the reviewed forecast");
      assertEqual(await page.getByTestId("formula-demand").textContent(), "96", "the MathML formula retains the selected demand operand");
      assertEqual(await page.getByTestId("formula-buffer").textContent(), "12", "the MathML formula renders the accepted percentage");
      assertEqual(await page.getByTestId("formula-result").textContent(), "108", "the MathML formula renders the rounded-up capacity result");
      const updatedFormulaSnapshot = await formula.ariaSnapshot();
      assertIncludes(updatedFormulaSnapshot, "108 shipments", "the updated MathML result remains available in the accessibility tree");

      await observedAction(page, page.getByRole("button", { name: "Reset capacity model" }), "click");
      assertEqual(await page.getByTestId("selected-forecast-week").textContent(), "Week 2", "reset restores the initial forecast selection");
      assertEqual(await page.getByLabel("Capacity buffer percentage").inputValue(), "10", "reset restores the initial capacity buffer");
      assertEqual(await page.getByTestId("formula-result").textContent(), "106", "reset restores the initial MathML result");
      assertEqual(await acknowledgeRisk.getAttribute("aria-pressed"), "false", "reset clears the chart risk acknowledgement");

      const weekFour = page.getByRole("button", {
        name: "Review week 4 forecast: 129 shipments",
      });
      await observedFocusedKeyboard(page, weekFour, "press", "Enter");
      assertEqual(await page.getByTestId("selected-forecast-week").textContent(), "Week 4", "keyboard activation selects another SVG point");
      assertEqual(await page.getByTestId("selected-forecast-demand").textContent(), "129 shipments", "keyboard SVG selection updates the reviewed demand");
      assertEqual(await page.getByTestId("formula-result").textContent(), "142", "SVG selection supplies the demand operand to the MathML result");
      assertEqual(await weekFour.getAttribute("aria-pressed"), "true", "keyboard selection updates the SVG point state");

      const weekThree = page.getByRole("button", {
        name: "Review week 3 forecast: 112 shipments",
      });
      const weekThreeBox = await weekThree.boundingBox();
      assert(
        weekThreeBox && weekThreeBox.width > 4 && weekThreeBox.height > 4,
        "the hollow forecast point exposes a visible ring-sized hit area",
      );
      await observedAction(page, weekThree, "click", {
        position: {
          x: weekThreeBox.width - 2,
          y: weekThreeBox.height / 2,
        },
        timeout: 5_000,
      });
      assertEqual(await page.getByTestId("selected-forecast-week").textContent(), "Week 3", "clicking the visible ring of a hollow SVG data point selects its forecast week");
      assertEqual(await page.getByTestId("selected-forecast-demand").textContent(), "112 shipments", "SVG pointer selection exposes the underlying shipment value");
      assertEqual(await weekThree.getAttribute("aria-pressed"), "true", "the clicked SVG point exposes its pressed state");
    `,
);
