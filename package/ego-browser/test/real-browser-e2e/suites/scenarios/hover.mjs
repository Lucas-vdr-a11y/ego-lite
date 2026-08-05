import { scenarioCase } from "./scenario-case.mjs";

export const hoverScenarioCase = scenarioCase(
  "hover",
  `
      const material = page.locator("#hover-target");
      await observedAction(page, material, "hover");
      assertEqual(await page.getByTestId("hover-state").textContent(), "inside", "hover enters the material preview");
      assert(Number(await page.getByTestId("hover-entries").textContent()) >= 1, "hover records at least one pointer entry");
      assert(Number(await page.getByTestId("hover-moves").textContent()) >= 1, "hover records pointer movement");
      assertEqual(await material.getAttribute("class").then((value) => value.includes("is-hovered")), true, "hover reveals the product specification action");
      const pin = page.getByRole("button", { name: "Pin Burnt clay" });
      await observedAction(page, pin, "click");
      assertEqual(await pin.getAttribute("aria-pressed"), "true", "revealed material action records its pressed state");
      assertEqual(await page.getByTestId("hover-selection").textContent(), "Burnt clay pinned", "material action updates the inspector selection");
      assertEqual(await page.getByTestId("material-finish").textContent(), "Powder-coated aluminium", "material preview exposes a usable finish specification");
      assertEqual(await page.getByTestId("material-lead-time").textContent(), "4 weeks", "material preview exposes lead time");
      await observedGesture(page, "material hover exit", async (pointer) => {
        await pointer.move(1, 1);
      });
      assertEqual(await page.getByTestId("hover-state").textContent(), "outside", "moving away clears the hover state");
      const moss = page.locator('[data-material-id="M-051"]');
      await observedAction(page, moss, "focus");
      assertEqual(await page.getByTestId("hover-preview").textContent(), "Wet moss · M-051", "keyboard focus previews another material without hover");
      const mossPin = page.getByRole("button", { name: "Pin Wet moss" });
      await observedAction(page, mossPin, "click");
      assertEqual(await page.getByTestId("hover-selection").textContent(), "2 materials pinned", "comparison tray can retain more than one material");
      assertEqual(await pin.getAttribute("aria-pressed"), "true", "pinning another material does not discard the first selection");
      assertIncludes(await page.getByTestId("material-comparison").textContent(), "Burnt clay", "comparison tray lists the first material");
      assertIncludes(await page.getByTestId("material-comparison").textContent(), "Wet moss", "comparison tray lists the second material");
      await observedAction(page, mossPin, "click");
      assertEqual(await page.getByTestId("hover-selection").textContent(), "Burnt clay pinned", "unpinning removes only the selected material");
    `,
);
