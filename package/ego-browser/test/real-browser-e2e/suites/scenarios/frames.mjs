import { scenarioCase } from "./scenario-case.mjs";

export const framesScenarioCase = scenarioCase(
  "frames",
  `
      assertEqual(await page.locator("#test-frame").count(), 0, "partner checkout starts behind an explicit load action");
      await page.getByRole("button", { name: "Load secure checkout" }).click();
      const frameElement = page.locator("#test-frame");
      const checkout = page.frameLocator("#test-frame");
      assertEqual(await frameElement.count(), 1, "host order contains one embedded checkout frame");
      assertEqual(await frameElement.getAttribute("src"), "/frames/content", "embedded checkout uses the expected partner route");
      assertEqual(await checkout.getByRole("heading", { name: "Confirm payment details" }).count(), 1, "checkout frame renders its own document");
      await checkout.getByRole("button", { name: "Confirm S$ 248.00" }).click();
      assertEqual(await checkout.getByTestId("frame-result").textContent(), "Enter the cardholder name", "embedded checkout validates missing frame input");
      await checkout.getByLabel("Cardholder name").fill("Jack Wang");
      await checkout.getByRole("button", { name: "Confirm S$ 248.00" }).click();
      assertEqual(await checkout.getByTestId("frame-result").textContent(), "Enter a valid card number", "embedded checkout validates card details before confirmation");
      await checkout.getByLabel("Card number").fill("4242 4242 4242 4242");
      await checkout.getByRole("button", { name: "Confirm S$ 248.00" }).click();
      assertEqual(await checkout.getByTestId("frame-result").textContent(), "Enter expiry as MM/YY", "embedded checkout validates the expiry field");
      await checkout.getByLabel("Expiry").fill("08/29");
      await checkout.getByRole("button", { name: "Confirm S$ 248.00" }).click();
      assertEqual(await checkout.getByTestId("frame-result").textContent(), "Enter a 3-digit security code", "embedded checkout validates the security code");
      await checkout.getByLabel("Security code").fill("123");
      await checkout.getByRole("button", { name: "Confirm S$ 248.00" }).click();
      assertEqual(await checkout.getByTestId("frame-result").textContent(), "Accept the payment terms", "embedded checkout validates required payment terms");
      await checkout.getByLabel("Accept payment terms").check();
      await checkout.getByRole("button", { name: "Confirm S$ 248.00" }).click();
      assertEqual(await checkout.getByTestId("frame-result").textContent(), "Payment confirmed for Jack Wang", "frame-scoped form interaction completes checkout");
      await page.waitForFunction(() => document.querySelector('[data-testid="host-frame-status"]').textContent.includes("Jack Wang"));
      assertEqual(await page.getByTestId("host-frame-status").textContent(), "Partner confirmed payment for Jack Wang", "frame completion reports back to the host page");
      await checkout.getByRole("button", { name: "Reset" }).click();
      assertEqual(await checkout.getByLabel("Cardholder name").inputValue(), "", "embedded checkout reset clears cardholder input");
      assertEqual(await checkout.getByLabel("Card number").inputValue(), "", "embedded checkout reset clears payment details");
      assertEqual(await page.getByRole("heading", { name: "Arc desk set" }).count(), 1, "host order context remains available after frame interaction");
    `,
);
