import { scenarioCase } from "./scenario-case.mjs";

export const downloadsScenarioCase = scenarioCase(
  "downloads",
  `
      await page.getByLabel("Report format").selectOption("PDF");
      assertEqual(await page.getByTestId("visible-report-count").textContent(), "1", "report filter narrows the archive by format");
      assertEqual(await page.getByRole("button", { name: "Unavailable" }).isEnabled(), false, "unavailable exports remain disabled after filtering");
      await page.getByLabel("Report format").selectOption("all");
      assertEqual(await page.getByTestId("visible-report-count").textContent(), "3", "report filter restores the complete archive");
      await page.getByRole("button", { name: "Prepare fulfilment exceptions" }).click();
      assertEqual(await page.getByTestId("report-status").textContent(), "Prepared", "report preparation produces a visible ready state");
      const preparedLink = page.getByRole("link", { name: "Download fulfilment exceptions" });
      assertEqual(await preparedLink.getAttribute("href"), "/api/download?report=fulfilment-exceptions", "prepared report exposes its own downloadable artifact");
      assertEqual(await page.getByTestId("generated-report-count").textContent(), "2", "preparing a report increases the ready artifact count");
      const downloadLink = page.getByRole("link", { name: "Download", exact: true });
      const downloadHref = await downloadLink.getAttribute("href");
      assertEqual(downloadHref, "/api/download", "report archive exposes a stable download URL");
      assertEqual(await downloadLink.getAttribute("download"), "", "report archive marks the link as a browser download");
      const { get } = await import("node:http");
      const { readFile, stat } = await import("node:fs/promises");
      const requestJson = (url) => new Promise((resolve, reject) => {
        get(url, (response) => {
          let body = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => { body += chunk; });
          response.on("end", () => resolve(JSON.parse(body)));
        }).on("error", reject);
      });
      const beforeDownload = await requestJson(baseUrl + "/api/download-status");
      await cdp("Page.setDownloadBehavior", {
        behavior: "allow",
        downloadPath: artifactDir,
      });
      await downloadLink.click({ noWaitAfter: true });
      const savedDownloadPath = join(artifactDir, "ego-browser-sample.txt");
      const fileDeadline = Date.now() + 5_000;
      let previousSize = -1;
      while (Date.now() < fileDeadline) {
        try {
          const current = await stat(savedDownloadPath);
          if (current.size > 0 && current.size === previousSize) break;
          previousSize = current.size;
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert(previousSize > 0, "browser writes the server-provided download filename to disk");
      assertEqual(await readFile(savedDownloadPath, "utf8"), "ego-browser download fixture\\n", "downloaded report contains the complete deterministic export");
      const deadline = Date.now() + 5_000;
      let afterDownload;
      do {
        afterDownload = await requestJson(baseUrl + "/api/download-status");
        if (afterDownload.requests > beforeDownload.requests) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      } while (Date.now() < deadline);
      assertEqual(afterDownload.requests, beforeDownload.requests + 1, "clicking the archive link makes one real browser download request");
      assertIncludes(page.url(), "/tests/downloads", "download keeps the archive page open");
    `,
);
