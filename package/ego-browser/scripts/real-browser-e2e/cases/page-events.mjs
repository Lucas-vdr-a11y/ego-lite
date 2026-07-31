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
    name: "page network and lifecycle events",
    body: homeCase(`
      const requestPromise = page.waitForEvent("request", {
        timeout: 5000,
        predicate: (request) => request.url().endsWith("/api/text"),
      });
      const responsePromise = page.waitForEvent("response", {
        timeout: 5000,
        predicate: (response) => response.url().endsWith("/api/text"),
      });
      const finishedPromise = page.waitForEvent("requestfinished", {
        timeout: 5000,
        predicate: (request) => request.url().endsWith("/api/text"),
      });
      await page.evaluate((url) => fetch(url), baseUrl + "/api/text");
      const [request, response, finished] = await Promise.all([
        requestPromise,
        responsePromise,
        finishedPromise,
      ]);
      assertEqual(request.method(), "GET", "request event returns a Request facade");
      assertEqual(finished.failure(), null, "requestfinished returns the completed request");
      await page.waitForTimeout(200);
      assertEqual(
        await response.text(),
        "server text fixture",
        "response event body survives Network cleanup",
      );

      const domReady = page.waitForEvent("domcontentloaded", { timeout: 5000 });
      const loaded = page.waitForEvent("load", { timeout: 5000 });
      await page.reload({ timeout: 5000 });
      assertEqual(await domReady, page, "domcontentloaded returns the current Page facade");
      assertEqual(await loaded, page, "load returns the current Page facade");
    `),
  },
  {
    name: "page popup event helper",
    body: homeCase(`
      const originalTab = await tabs.current();
      let popup;
      try {
        const popupPromise = page.waitForEvent("popup", {
          timeout: 5000,
          predicate: (candidate) => Boolean(candidate.targetId),
        });
        await cdp("Runtime.evaluate", {
          expression: "window.open(location.origin + '/secondary', '_blank')",
          userGesture: true,
          awaitPromise: false,
        });
        popup = await popupPromise;
        assert(popup.targetId, "popup exposes its target id");
        await tabs.activate(originalTab);
        await popup.waitForURL(
          (url) => url.pathname === "/secondary",
          { timeout: 5000, waitUntil: "load" }
        );
        assertIncludes(await popup.url(), "/secondary", "popup Page resolves its committed URL");
        assertEqual(await popup.title(), "ego-lite secondary", "popup Page reads its own title");
        assertEqual(
          await popup.getByRole("heading", { name: "Secondary tab" }).innerText(),
          "Secondary tab",
          "popup locator stays bound without bringing the popup to front"
        );
        assertEqual(
          await popup.frameLocator("#fixture-frame").locator("#iframe-marker").innerText(),
          "iframe target",
          "popup frameLocator stays bound to the popup target"
        );
        const handle = await popup.waitForFunction(
          () => ({ title: document.title }),
          undefined,
          { timeout: 5000 }
        );
        assertEqual(
          (await handle.jsonValue()).title,
          "ego-lite secondary",
          "a JSHandle returned by the popup remains usable"
        );
        await handle.dispose();
        const responsePromise = popup.waitForResponse(
          (response) => response.url().endsWith("/api/text"),
          { timeout: 5000 }
        );
        await popup.evaluate((url) => fetch(url), baseUrl + "/api/text");
        const response = await responsePromise;
        await popup.waitForTimeout(200);
        assertEqual(
          await response.text(),
          "server text fixture",
          "a delayed popup Response body remains readable"
        );
        assertEqual(
          (await tabs.current()).targetId,
          originalTab.targetId,
          "target-bound popup operations do not change the active tab"
        );
        await popup.bringToFront();
        assertEqual(
          (await tabs.current()).targetId,
          popup.targetId,
          "popup.bringToFront explicitly activates the popup"
        );
      } finally {
        if (popup?.targetId) await tabs.close(popup.targetId);
        await tabs.activate(originalTab);
      }
    `),
  },
];
