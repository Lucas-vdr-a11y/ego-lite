import { TEST_CASES } from "../../../test-site/test-cases.mjs";

const secondLaneCases = new Set([
  "hover",
  "drag-drop",
  "canvas",
  "uploads",
  "scroll",
  "navigation",
]);

function webCase(slug, body) {
  const testCase = TEST_CASES.find((candidate) => candidate.slug === slug);
  if (!testCase) throw new Error(`Unknown web test route: ${slug}`);
  return {
    name: `web test: ${slug}`,
    route: testCase.route,
    parallelLane: secondLaneCases.has(slug) ? 1 : 0,
    body: () => `
      const task = await egoBrowser.useOrCreateTaskSpace(taskName);
      const page = task.page;
      await page.goto(baseUrl + ${JSON.stringify(testCase.route)}, {
        waitUntil: "load",
        timeout: 20_000,
      });
      assertIncludes(page.url(), ${JSON.stringify(testCase.route)}, ${JSON.stringify(`${slug} route is loaded`)});
      const surfaceStartsInViewport = await page.locator(".surface").evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return rect.top < innerHeight && rect.bottom > 0;
      });
      assertEqual(surfaceStartsInViewport, true, ${JSON.stringify(`${slug} operation surface starts in the initial viewport`)});
      ${body}
    `,
  };
}

export const webTestSiteCases = [
  webCase(
    "clicks",
    `
      const approve = page.getByRole("button", { name: "Approve dispatch" });
      await approve.click();
      assertEqual(await page.getByTestId("click-count").textContent(), "1", "single click updates the dispatch activity");
      await approve.dblclick();
      assertEqual(await page.getByTestId("click-count").textContent(), "3", "double click dispatches two additional click events");
      assertEqual(await page.getByTestId("double-click-count").textContent(), "1", "double click emits a dblclick event");
      await page.getByRole("button", { name: "More actions" }).click({ button: "right" });
      assertEqual(await page.getByTestId("right-click-count").textContent(), "1", "secondary click opens the order context action");

      const { stat } = await import("node:fs/promises");
      const screenshotPath = join(artifactDir, "dispatch-queue.png");
      await page.screenshot({ path: screenshotPath, fullPage: true });
      assert((await stat(screenshotPath)).size > 0, "native Playwright writes a full-page screenshot");
    `,
  ),
  webCase(
    "hover",
    `
      const material = page.locator("#hover-target");
      await material.hover();
      assertEqual(await page.getByTestId("hover-state").textContent(), "inside", "hover enters the material preview");
      assert(Number(await page.getByTestId("hover-entries").textContent()) >= 1, "hover records at least one pointer entry");
      assert(Number(await page.getByTestId("hover-moves").textContent()) >= 1, "hover records pointer movement");
      assertEqual(await material.getAttribute("class").then((value) => value.includes("is-hovered")), true, "hover reveals the product specification action");
      await page.mouse.move(1, 1);
      assertEqual(await page.getByTestId("hover-state").textContent(), "outside", "moving away clears the hover state");
    `,
  ),
  webCase(
    "drag-drop",
    `
      const dragSource = page.locator("#mouse-drag-source");
      const dragTarget = page.locator("#mouse-drag-target");
      assertEqual(await dragSource.isVisible(), true, "sprint board exposes a visible drag source");
      assertEqual(await dragTarget.isVisible(), true, "sprint board exposes a visible review target");
      await dragSource.evaluate((source) => {
        source.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        document.querySelector("#mouse-drag-target").dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      });
      assertEqual(await page.getByTestId("mouse-drag-status").textContent(), "Card moved to review", "pointer drag events move work into review");
      assertEqual(await page.locator("#html-drag-source").getAttribute("draggable"), "true", "board keeps a native draggable release card for manual coverage");
    `,
  ),
  webCase(
    "canvas",
    `
      const canvas = page.locator("#draw-canvas");
      const box = await canvas.boundingBox();
      assert(box && box.width > 100 && box.height > 100, "review canvas has a usable drawing area");
      await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.45);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.55, { steps: 6 });
      await page.mouse.move(box.x + box.width * 0.85, box.y + box.height * 0.35, { steps: 6 });
      await page.mouse.up();
      assertEqual(await page.getByTestId("canvas-strokes").textContent(), "1", "one pointer gesture creates one review stroke");
      assert(Number(await page.getByTestId("canvas-points").textContent()) >= 10, "review stroke samples multiple points");
      const paintedPixels = await canvas.evaluate((element) => {
        const data = element.getContext("2d").getImageData(0, 0, element.width, element.height).data;
        let count = 0;
        for (let index = 3; index < data.length; index += 4) if (data[index] > 0) count += 1;
        return count;
      });
      assert(paintedPixels > 0, "canvas contains painted pixels after annotation");
      await page.getByRole("button", { name: "Clear markup" }).click();
      assertEqual(await page.getByTestId("canvas-strokes").textContent(), "0", "clear markup resets stroke state");
    `,
  ),
  webCase(
    "forms",
    `
      await page.getByLabel("Project name").fill("Autumn retail launch");
      await page.getByLabel("What do you need?").fill("A complete launch toolkit for retail and social channels.");
      await page.getByLabel("Priority").selectOption("urgent");
      await page.getByLabel("Budget owner approved").check();
      await page.getByLabel("Full campaign system").check();
      assertEqual(await page.getByTestId("form-text").textContent(), "Autumn retail launch", "project name updates the request summary");
      assertIncludes(await page.getByTestId("form-notes").textContent(), "launch toolkit", "brief notes update the request summary");
      assertEqual(await page.getByTestId("form-priority").textContent(), "urgent", "priority selection updates the request summary");
      assertEqual(await page.getByTestId("form-approved").textContent(), "true", "checkbox approval updates the request summary");
      assertEqual(await page.getByTestId("form-plan").textContent(), "pro", "radio selection updates the delivery plan");
      await page.getByRole("button", { name: "Add stakeholder" }).click();
      assertEqual(await page.locator("#dynamic-node").textContent(), "Stakeholder: Mei Lin · Product", "form action mounts a dynamic stakeholder");
    `,
  ),
  webCase(
    "keyboard",
    `
      const title = page.getByLabel("Story title");
      await title.click();
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.insertText("Rooms that breathe");
      assertEqual(await page.getByTestId("keyboard-value").textContent(), "Rooms that breathe", "platform select-all and insertText replace the title");
      await page.keyboard.press("Backspace");
      assertEqual(await page.getByTestId("keyboard-value").textContent(), "Rooms that breath", "Backspace edits the focused title");
      assertIncludes(await page.getByTestId("key-log").textContent(), "Backspace", "keyboard event log records editing keys");
      await page.getByLabel("Story body").fill("Shade changes the pace of a public room.");
      assertIncludes(await page.getByTestId("rich-value").textContent(), "Shade changes", "contenteditable input updates the document inspector");
    `,
  ),
  webCase(
    "uploads",
    `
      const input = page.locator("#file-input");
      await input.setInputFiles(uploadPath);
      assertEqual(await page.getByTestId("file-count").textContent(), "1", "single-file delivery updates the receipt count");
      assertIncludes(await page.getByTestId("file-list").textContent(), "fixture-upload.txt", "single-file receipt shows the browser file name");
      await input.setInputFiles([uploadPath, uploadPathTwo]);
      assertEqual(await page.getByTestId("file-count").textContent(), "2", "multi-file delivery updates the receipt count");
      const deliveredNames = await input.evaluate((element) => Array.from(element.files, (file) => file.name).join(","));
      assertEqual(deliveredNames, "fixture-upload.txt,fixture-upload-two.txt", "file input retains both local fixture files");
      assertIncludes(await page.getByTestId("file-list").textContent(), "fixture-upload-two.txt", "multi-file receipt renders the second asset");
    `,
  ),
  webCase(
    "scroll",
    `
      const timeline = page.locator("#nested-scroll");
      await timeline.evaluate((element) => element.scrollBy({ top: 480, behavior: "instant" }));
      await page.waitForFunction(() => Number(document.querySelector('[data-testid="nested-scroll-top"]').textContent) > 0);
      assert(Number(await page.getByTestId("nested-scroll-top").textContent()) > 0, "native scrolling advances the independent activity timeline");
      await page.locator("#nested-marker").evaluate((element) => element.scrollIntoView({ block: "nearest" }));
      assertEqual(await page.locator("#nested-marker").isVisible(), true, "nested marker becomes visible after scrolling");
      await page.locator("#document-marker").evaluate((element) => element.scrollIntoView({ block: "center" }));
      const markerVisible = await page.locator("#document-marker").evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return rect.top < innerHeight && rect.bottom > 0;
      });
      assertEqual(markerVisible, true, "document-level scroll reveals the end note");
    `,
  ),
  webCase(
    "navigation",
    `
      const newPageLink = page.locator("#new-page-link");
      const destinationHref = await newPageLink.getAttribute("href");
      assertEqual(await newPageLink.getAttribute("target"), "_blank", "knowledge map exposes an independent-page reference");
      const independentPage = await task.context.newPage();
      await independentPage.goto(baseUrl + destinationHref, { waitUntil: "load", timeout: 10_000 });
      assertIncludes(independentPage.url(), "/tests/navigation/destination", "BrowserContext opens the independent destination route");
      assertEqual(await independentPage.getByRole("heading", { name: "Launch in two measured phases." }).count(), 1, "independent Page renders the decision record");
      await independentPage.close();
      const currentPageHref = await page.locator("#same-page-link").getAttribute("href");
      await page.goto(baseUrl + currentPageHref, { waitUntil: "load", timeout: 10_000 });
      assertIncludes(page.url(), "/tests/navigation/destination", "Page.goto follows the current-page reference");
      assertIncludes(await page.locator("#destination-status").textContent(), "complete decision record", "destination provides an authoritative navigation signal");
    `,
  ),
  webCase(
    "dialogs",
    `
      const alertPromise = page.waitForEvent("dialog", { timeout: 5_000 });
      const alertClick = page.getByRole("button", { name: "Preview notice" }).click();
      const alertDialog = await alertPromise;
      assertEqual(alertDialog.type(), "alert", "release notice opens an alert dialog");
      assertEqual(alertDialog.message(), "ego alert", "alert exposes its message");
      await alertDialog.dismiss();
      await alertClick;
      assertEqual(await page.getByTestId("dialog-result").textContent(), "alert closed", "workflow resumes after alert dismissal");

      const confirmPromise = page.waitForEvent("dialog", { timeout: 5_000 });
      const confirmClick = page.getByRole("button", { name: "Request approval" }).click();
      const confirmDialog = await confirmPromise;
      await confirmDialog.accept();
      await confirmClick;
      assertEqual(await page.getByTestId("dialog-result").textContent(), "confirmed", "accepted confirmation updates release state");

      const promptPromise = page.waitForEvent("dialog", { timeout: 5_000 });
      const promptClick = page.getByRole("button", { name: "Set release name" }).click();
      const promptDialog = await promptPromise;
      await promptDialog.accept("release-candidate");
      await promptClick;
      assertEqual(await page.getByTestId("dialog-result").textContent(), "release-candidate", "prompt text is returned to the release workflow");
    `,
  ),
  webCase(
    "downloads",
    `
      const downloadLink = page.getByRole("link", { name: "Download" });
      const downloadHref = await downloadLink.getAttribute("href");
      assertEqual(downloadHref, "/api/download", "report archive exposes a stable download URL");
      assertEqual(await downloadLink.getAttribute("download"), "", "report archive marks the link as a browser download");
      const report = await page.evaluate(async (href) => {
        const response = await fetch(href);
        return {
          ok: response.ok,
          disposition: response.headers.get("content-disposition"),
          body: await response.text(),
        };
      }, downloadHref);
      assertEqual(report.ok, true, "the page session retrieves the report");
      assertIncludes(report.disposition, "ego-browser-sample.txt", "download response exposes the server filename");
      assertEqual(report.body, "ego-browser download fixture\\n", "download response contains the report contents");
      const { readFile, writeFile } = await import("node:fs/promises");
      const savedPath = join(artifactDir, "saved-report.txt");
      await writeFile(savedPath, report.body);
      assertEqual(await readFile(savedPath, "utf8"), "ego-browser download fixture\\n", "download response can be persisted as an artifact");
    `,
  ),
  webCase(
    "frames",
    `
      const frameElement = page.locator("#test-frame");
      assertEqual(await frameElement.count(), 1, "host order contains one embedded checkout frame");
      assertEqual(await frameElement.getAttribute("src"), "/frames/content", "embedded checkout uses the expected partner route");
      assertEqual(await frameElement.evaluate((element) => element.contentDocument.querySelector("h2").textContent), "Confirm payment details", "same-origin checkout content is readable from the host page");
      await frameElement.evaluate((element) => element.contentDocument.querySelector("button").click());
      assertEqual(await frameElement.evaluate((element) => element.contentDocument.querySelector("output").textContent), "Payment details confirmed", "embedded checkout handles a real frame-scoped click");
      assertEqual(await page.getByRole("heading", { name: "Arc desk set" }).count(), 1, "host order context remains available after frame interaction");
    `,
  ),
  webCase(
    "network",
    `
      const responsePromise = page.waitForResponse(
        (response) => response.url().endsWith("/api/echo") && response.request().method() === "POST",
        { timeout: 10_000 },
      );
      await page.getByRole("button", { name: "Check status" }).click();
      const response = await responsePromise;
      assertEqual(response.status(), 200, "shipment lookup receives a successful response");
      assertEqual(await page.getByTestId("network-status").textContent(), "200", "shipment surface renders the response status");
      assertEqual(await page.getByTestId("network-payload").textContent(), "In transit · Tuas hub", "shipment surface renders the response payload");
    `,
  ),
];
