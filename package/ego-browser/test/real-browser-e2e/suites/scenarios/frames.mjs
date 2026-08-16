import { scenarioCase } from "./scenario-case.mjs";

export const framesScenarioCase = scenarioCase(
  "frames",
  `
      assertEqual(await page.locator("#test-frame").count(), 0, "partner checkout starts behind an explicit load action");
      await observedRoleAction(page, "button", "Load secure checkout", "click");
      const frameElement = (await snapshotTarget(page, "iframe")).locator;
      const checkout = frameElement.contentFrame();
      assertEqual(await frameElement.count(), 1, "host order contains one embedded checkout frame");
      assertEqual(await frameElement.getAttribute("src"), "/frames/content", "embedded checkout uses the expected partner route");
      const checkoutHeading = checkout.getByRole("heading", { name: "Confirm payment details" });
      await checkoutHeading.waitFor({ timeout: 10_000 });
      assertEqual(await checkoutHeading.count(), 1, "checkout frame renders its own document");
      await observedRoleAction(checkout, "button", "Confirm S$ 248.00", "click");
      assertEqual(await checkout.getByTestId("frame-result").textContent(), "Enter the cardholder name", "embedded checkout validates missing frame input");
      await observedRoleAction(checkout, "textbox", "Cardholder name", "fill", "Jack Wang");
      await observedRoleAction(checkout, "button", "Confirm S$ 248.00", "click");
      assertEqual(await checkout.getByTestId("frame-result").textContent(), "Enter a valid card number", "embedded checkout validates card details before confirmation");
      await observedRoleAction(checkout, "textbox", "Card number", "fill", "4242 4242 4242 4242");
      await observedRoleAction(checkout, "button", "Confirm S$ 248.00", "click");
      assertEqual(await checkout.getByTestId("frame-result").textContent(), "Enter expiry as MM/YY", "embedded checkout validates the expiry field");
      await observedRoleAction(checkout, "textbox", "Expiry", "fill", "08/29");
      await observedRoleAction(checkout, "button", "Confirm S$ 248.00", "click");
      assertEqual(await checkout.getByTestId("frame-result").textContent(), "Enter a 3-digit security code", "embedded checkout validates the security code");
      await observedRoleAction(checkout, "textbox", "Security code", "fill", "123");
      await observedRoleAction(checkout, "button", "Confirm S$ 248.00", "click");
      assertEqual(await checkout.getByTestId("frame-result").textContent(), "Accept the payment terms", "embedded checkout validates required payment terms");
      await observedRoleAction(checkout, "checkbox", "Accept payment terms", "check");
      await observedRoleAction(checkout, "button", "Confirm S$ 248.00", "click");
      assertEqual(await checkout.getByTestId("frame-result").textContent(), "Payment confirmed for Jack Wang", "frame-scoped form interaction completes checkout");
      await page.waitForFunction(() => document.querySelector('[data-testid="host-frame-status"]').textContent.includes("Jack Wang"));
      assertEqual(await page.getByTestId("host-frame-status").textContent(), "Partner confirmed payment for Jack Wang", "frame completion reports back to the host page");
      await observedRoleAction(checkout, "button", "Reset", "click");
      assertEqual(await checkout.getByLabel("Cardholder name").inputValue(), "", "embedded checkout reset clears cardholder input");
      assertEqual(await checkout.getByLabel("Card number").inputValue(), "", "embedded checkout reset clears payment details");
      assertEqual(await page.getByRole("heading", { name: "Arc desk set" }).count(), 1, "host order context remains available after frame interaction");

      await page.goto(baseUrl + "/tests/frames?cross-site=1", {
        waitUntil: "load",
        timeout: 10_000,
      });
      await observedRoleAction(page, "button", "Load secure checkout", "click");
      const hostSnapshot = await snapshotTarget(page, "iframe");
      assertIncludes(hostSnapshot.content, 'heading "Embedded checkout"', "the host snapshot contains its own page content");
      assertIncludes(hostSnapshot.content, 'iframe "Browser test frame" [ref=', "the host snapshot exposes the named checkout iframe ref");
      const crossSiteFrameElement = hostSnapshot.locator;
      const crossSiteCheckout = crossSiteFrameElement.contentFrame();
      const crossSiteFrameUrl = await crossSiteFrameElement.getAttribute("src");
      assertIncludes(crossSiteFrameUrl, "http://checkout.localhost:", "cross-site checkout uses a distinct site from the 127.0.0.1 host");
      const checkoutSnapshot = await snapshotTarget(crossSiteCheckout, "iframe");
      assertIncludes(checkoutSnapshot.content, 'heading "Confirm payment details"', "the checkout snapshot contains its own document content");
      assertIncludes(checkoutSnapshot.content, 'iframe "Pickup location map" [ref=', "the checkout snapshot exposes the named nested map iframe ref");
      const mapFrameUrl = await checkoutSnapshot.locator.getAttribute("src");
      assertIncludes(mapFrameUrl, "https://www.openstreetmap.org/export/embed.html?", "the nested frame uses the OpenStreetMap embed endpoint");
      assertIncludes(mapFrameUrl, "layer=mapnik", "the nested frame requests the OpenStreetMap standard layer");
      await checkoutSnapshot.locator.scrollIntoViewIfNeeded();
      const findNestedMapFrame = () =>
        page.frames().find((frame) => frame.url().includes("www.openstreetmap.org/export/embed.html"));
      const nestedMapFrame = await (async () => {
        const deadline = Date.now() + 10_000;
        while (Date.now() < deadline) {
          const frame = findNestedMapFrame();
          if (frame) return frame;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return findNestedMapFrame();
      })();
      assertEqual(page.frames().length, 3, "Playwright attaches both nested cross-site iframe documents");
      assert(nestedMapFrame, "Playwright exposes the nested map frame");
      assertIncludes(nestedMapFrame.parentFrame().url(), "/frames/content", "the map iframe is nested under checkout");
      await observedRoleAction(crossSiteCheckout, "button", "Confirm S$ 248.00", "click");
      assertEqual(await crossSiteCheckout.getByTestId("frame-result").textContent(), "Enter the cardholder name", "semantic locators interact with the cross-site checkout");
    `,
);
