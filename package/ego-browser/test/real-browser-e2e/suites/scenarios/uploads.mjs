import { scenarioCase } from "./scenario-case.mjs";

export const uploadsScenarioCase = scenarioCase(
  "uploads",
  `
      const input = page.locator("#file-input");
      await observedAction(page, input, "setInputFiles", uploadPath);
      assertEqual(await page.getByTestId("file-count").textContent(), "1", "single-file delivery updates the receipt count");
      assertIncludes(await page.getByTestId("file-list").textContent(), "fixture-upload.txt", "single-file receipt shows the browser file name");
      await observedAction(page, input, "setInputFiles", [uploadPath, uploadPathTwo]);
      assertEqual(await page.getByTestId("file-count").textContent(), "2", "multi-file delivery updates the receipt count");
      const deliveredNames = await input.evaluate((element) => Array.from(element.files, (file) => file.name).join(","));
      assertEqual(deliveredNames, "fixture-upload.txt,fixture-upload-two.txt", "file input retains both local fixture files");
      assertIncludes(await page.getByTestId("file-list").textContent(), "fixture-upload-two.txt", "multi-file receipt renders the second asset");
      assert(Number(await page.getByTestId("file-bytes").textContent()) > 0, "delivery receipt totals the selected file bytes");
      await page.waitForFunction(() => document.querySelectorAll("[data-file-checksum]").length === 2);
      assertEqual(await page.locator("[data-file-checksum]").count(), 2, "every accepted upload receives a browser-computed checksum");
      await observedAction(page, page.getByRole("button", { name: "Deliver files" }), "click");
      assertEqual(await page.getByTestId("delivery-status").textContent(), "Delivered 2 files", "delivery action completes a valid multi-file workflow");
      assertEqual(await page.getByTestId("delivered-file-count").textContent(), "2", "delivery receipt tracks delivered assets independently from selected files");
      assertEqual(await page.locator('[data-file-state="delivered"]').count(), 2, "each delivered asset exposes its own completion state");
      await observedAction(page, input, "setInputFiles", [
        {
          name: "fixture-upload.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("accepted"),
        },
        {
          name: "malware.exe",
          mimeType: "application/octet-stream",
          buffer: Buffer.from("unsafe"),
        },
      ]);
      await page.waitForFunction(() => document.querySelectorAll("[data-file-checksum]").length === 1);
      assertEqual(await page.getByTestId("file-count").textContent(), "2", "mixed selection retains both accepted and rejected files for review");
      assertEqual(await page.getByTestId("rejected-file-count").textContent(), "1", "mixed selection identifies the unsupported file independently");
      assertEqual(await page.locator('[data-file-state="ready"]').count(), 1, "accepted file still receives its checksum and ready state");
      assertEqual(await page.locator('[data-file-state="rejected"]').count(), 1, "unsupported file exposes its own rejected state");
      assertEqual(await page.getByTestId("delivery-status").textContent(), "Remove unsupported files", "mixed selection explains how to unblock delivery");
      assertEqual(await page.getByRole("button", { name: "Deliver files" }).isEnabled(), false, "mixed selection cannot be partially delivered by accident");
      await observedAction(page, page.getByRole("button", { name: "Clear files" }), "click");
      assertEqual(await page.getByTestId("file-count").textContent(), "0", "clear action resets the delivered file count");
      assertEqual(await page.getByTestId("file-list").textContent(), "No files selected", "clear action restores the upload empty state");
    `,
);
