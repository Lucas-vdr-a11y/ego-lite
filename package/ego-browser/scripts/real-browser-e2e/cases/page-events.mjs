import { homeCase } from "./shared.mjs";

export const pageEventCases = [
  {
    name: "page runtime event helpers",
    body: homeCase(`
      const consolePromise = page.waitForEvent("console", {
        timeout: 5000,
        predicate: (message) => message.text() === "wanted console event",
      });
      await page.evaluate(() => {
        console.log("noise");
        console.warn("wanted console event");
      });
      const consoleMessage = await consolePromise;
      assertEqual(consoleMessage.type(), "warning", "console predicate skips unrelated messages");
      assertEqual(consoleMessage.text(), "wanted console event", "console facade exposes text");

      const dialogPromise = page.waitForEvent("dialog", {
        timeout: 5000,
        predicate: (dialog) => dialog.type() === "prompt",
      });
      const promptResult = page.evaluate(() => prompt("Event prompt", "seed"));
      const dialog = await dialogPromise;
      assertEqual(dialog.message(), "Event prompt", "dialog facade exposes the prompt message");
      assertEqual(dialog.defaultValue(), "seed", "dialog facade exposes the default value");
      await dialog.accept("accepted");
      assertEqual(await promptResult, "accepted", "dialog accept resumes the triggering page action");

      const pageErrorPromise = page.waitForEvent("pageerror", {
        timeout: 5000,
        predicate: (error) => error.message === "event page failure",
      });
      await page.evaluate(() => {
        setTimeout(() => {
          throw new TypeError("event page failure");
        }, 0);
      });
      const pageError = await pageErrorPromise;
      assertEqual(pageError.name, "TypeError", "pageerror preserves the error type");
      assertEqual(pageError.message, "event page failure", "pageerror preserves the message");

      const controller = new AbortController();
      const abortedWait = page.waitForEvent("console", {
        signal: controller.signal,
        timeout: 5000,
      });
      controller.abort(new Error("event wait aborted"));
      await assertRejects(
        () => abortedWait,
        "event wait aborted",
        "waitForEvent supports AbortSignal cancellation"
      );
    `),
  },
  {
    name: "page filechooser event helper",
    body: homeCase(`
      const uploadPath = join(artifactDir, "event-upload.txt");
      await writeFile(uploadPath, "event upload");
      const chooserPromise = page.waitForEvent("filechooser", { timeout: 5000 });
      await cdp("Runtime.evaluate", {
        expression: "document.querySelector('#file-input').click()",
        userGesture: true,
        awaitPromise: false,
      });
      const chooser = await chooserPromise;
      assertEqual(chooser.isMultiple(), true, "filechooser reports the input mode");
      await chooser.setFiles(uploadPath);
      assertEqual(
        await page.locator("#file-input").evaluate((input) => input.files?.[0]?.name || ""),
        "event-upload.txt",
        "filechooser sets the selected file"
      );
    `),
  },
  {
    name: "page requestfailed event helper",
    body: homeCase(`
      const requestFailedPromise = page.waitForEvent("requestfailed", {
        timeout: 5000,
        predicate: async (request) => request.url().includes("/api/abort"),
      });
      await page.evaluate(
        (url) => fetch(url).then((response) => response.text()).catch(() => null),
        baseUrl + "/api/abort"
      );
      const failedRequest = await requestFailedPromise;
      assertIncludes(failedRequest.url(), "/api/abort", "requestfailed predicate receives a Request facade");
      assert(failedRequest.failure()?.errorText, "requestfailed exposes a failure reason");
    `),
  },
  {
    name: "page popup event helper",
    body: homeCase(`
      const originalTab = await browser.currentTab();
      const popupPromise = page.waitForEvent("popup", {
        timeout: 5000,
        predicate: (popup) => Boolean(popup.targetId),
      });
      await cdp("Runtime.evaluate", {
        expression: "window.open(location.origin + '/secondary', '_blank')",
        userGesture: true,
        awaitPromise: false,
      });
      const popup = await popupPromise;
      assert(popup.targetId, "popup exposes its target id");
      await popup.bringToFront();
      await page.waitForURL(
        (url) => url.pathname === "/secondary",
        { timeout: 5000, waitUntil: "load" }
      );
      assertIncludes(await page.url(), "/secondary", "popup bringToFront selects the popup");
      assertIncludes(await popup.url(), "/secondary", "popup facade resolves its committed URL");
      await browser.switchTab(originalTab.targetId);
    `),
  },
];
