import { scenarioCase } from "./scenario-case.mjs";

export const networkScenarioCase = scenarioCase(
  "network",
  `
      const reference = page.getByLabel("Tracking reference");
      const networkStatus = page.getByTestId("network-status");
      await observedAction(page, reference, "fill", "");
      await observedAction(page, page.getByRole("button", { name: "Check status" }), "click");
      assertEqual(await networkStatus.textContent(), "invalid", "shipment lookup validates an empty reference without a request");
      assertEqual(await page.getByTestId("network-payload").textContent(), "Enter a tracking reference", "shipment validation explains how to continue");
      await observedAction(page, reference, "fill", "EG-500-SIN");
      await observedAction(page, page.getByLabel("Response mode"), "selectOption", "error");
      const errorResponsePromise = page.waitForResponse((response) => response.url().includes("mode=error"), { timeout: 10_000 });
      await observedAction(page, page.getByRole("button", { name: "Check status" }), "click");
      const errorResponse = await errorResponsePromise;
      assertEqual(errorResponse.status(), 503, "shipment fixture exposes a deterministic server failure");
      await networkStatus.filter({ hasText: /^503$/ }).waitFor();
      assertEqual(await networkStatus.textContent(), "503", "shipment surface renders the server failure status");
      assertEqual(await page.getByTestId("network-payload").textContent(), "Carrier service unavailable. Try again.", "shipment surface gives a recoverable failure message");
      assertEqual(await page.getByTestId("network-attempts").textContent(), "1", "failed lookup is retained in request history");
      assertIncludes(await page.getByTestId("network-history").textContent(), "EG-500-SIN · 503", "request history records the failed reference and status");
      await observedAction(page, reference, "fill", "EG-2048-SHA");
      await observedAction(page, page.getByLabel("Response mode"), "selectOption", "delayed");
      const responsePromise = page.waitForResponse(
        (response) => response.url().includes("mode=delayed") && response.request().method() === "POST",
        { timeout: 10_000 },
      );
      const lookup = page.getByRole("button", { name: "Check status" });
      await observedAction(page, lookup, "click");
      assertEqual(await networkStatus.textContent(), "pending", "delayed lookup exposes a pending state");
      assertEqual(await lookup.isEnabled(), false, "lookup action is disabled while a request is pending");
      const response = await responsePromise;
      assertEqual(response.status(), 200, "shipment lookup receives a successful response");
      await networkStatus.filter({ hasText: /^200$/ }).waitFor();
      assertEqual(await networkStatus.textContent(), "200", "shipment surface renders the response status");
      assertEqual(await page.getByTestId("network-payload").textContent(), "In transit · EG-2048-SHA", "shipment surface renders the requested reference from the response");
      assertEqual(await page.getByTestId("network-reference").textContent(), "EG-2048-SHA", "shipment receipt updates its reference label");
      assertEqual(await page.getByTestId("network-attempts").textContent(), "2", "successful retry path appends another request history item");
      assertIncludes(await page.getByTestId("network-history").textContent(), "EG-2048-SHA · 200", "request history records successful lookups");
      await observedAction(page, page.getByRole("button", { name: "Reset lookup" }), "click");
      assertEqual(await networkStatus.textContent(), "idle", "lookup reset restores the initial status");
      assertEqual(await page.getByTestId("network-payload").textContent(), "Awaiting lookup", "lookup reset clears the response content");
      assertEqual(await page.getByTestId("network-attempts").textContent(), "0", "lookup reset clears request history");
    `,
);
