export const documentStartupCase = {
  name: "HTML document startup and noscript fallback",
  kind: "platform",
  body() {
    return `
      const task = await openE2eTaskSpace(taskName + " document startup");
      const page = task.page;

      function ariaRefFor(snapshot, accessibleName) {
        const line = snapshot
          .split("\\n")
          .find((candidate) => candidate.includes('"' + accessibleName + '"'));
        const match = line?.match(/\\[ref=(s\\d+e\\d+)\\]/);
        assert(match, "the observed document exposes " + accessibleName);
        return "aria-ref=" + match[1];
      }

      const response = await page.goto(baseUrl + "/tests/document-startup", {
        waitUntil: "load",
        timeout: 20_000,
      });
      assertEqual(response?.status(), 200, "the startup document loads successfully");
      const startupSnapshot = await page.locator("body").ariaSnapshot({ ref: true });
      assertIncludes(startupSnapshot, 'heading "Workspace startup"', "the server document exposes its startup heading");
      assertIncludes(startupSnapshot, 'link "Open the operations workspace"', "the hydrated document exposes its relative navigation action");
      assert(
        !startupSnapshot.includes("Open the no-script recovery guide"),
        "the no-script recovery action stays hidden while scripting is enabled",
      );

      const documentState = await page.evaluate(() => ({
        html: document.documentElement.localName,
        head: document.head?.localName,
        body: document.body?.localName,
        main: document.querySelector("main")?.localName,
        mainGeometry: (() => {
          const box = document.querySelector("main")?.getBoundingClientRect();
          return box ? { width: box.width, height: box.height } : null;
        })(),
        lang: document.documentElement.lang,
        baseURI: document.baseURI,
        description: document
          .querySelector('meta[name="description"]')
          ?.getAttribute("content"),
        viewport: document
          .querySelector('meta[name="viewport"]')
          ?.getAttribute("content"),
        inlineBackground: getComputedStyle(document.body).backgroundColor,
        linkedAccent: getComputedStyle(document.documentElement)
          .getPropertyValue("--startup-accent")
          .trim(),
      }));
      assertEqual(documentState.html, "html", "the browser parses the document root as HTML");
      assertEqual(documentState.head, "head", "the browser exposes the document head");
      assertEqual(documentState.body, "body", "the browser exposes the document body");
      assertEqual(documentState.main, "main", "the browser preserves the authored main landmark");
      assert(
        documentState.mainGeometry?.width > 0 && documentState.mainGeometry?.height > 0,
        "the main workspace content occupies visible page geometry",
      );
      assertEqual(documentState.lang, "en-SG", "the document keeps its authored language");
      assertEqual(
        documentState.baseURI,
        baseUrl + "/tests/document-startup/",
        "the base element resolves relative navigation from the startup directory",
      );
      assertEqual(
        documentState.description,
        "Northstar operations workspace startup status.",
        "the document exposes its authored description metadata",
      );
      assertIncludes(documentState.viewport, "width=device-width", "the viewport metadata remains available to Chromium");
      assertEqual(documentState.inlineBackground, "rgb(248, 250, 252)", "the inline style affects the rendered document");
      assertEqual(documentState.linkedAccent, "rgb(15, 118, 110)", "the linked stylesheet affects the rendered document");
      assertEqual(await page.title(), "Northstar workspace · Ego Browser Lab", "the title element names the browser tab");
      await page.locator('html[data-startup-state="hydrated"]').waitFor();
      assertEqual(await page.getByRole("status").textContent(), "Workspace client ready", "the external script hydrates a visible status");

      const workspaceLink = page.locator(
        ariaRefFor(startupSnapshot, "Open the operations workspace"),
      );
      await egoBrowser.showTaskState("open operations workspace");
      await workspaceLink.click();
      const workspaceSnapshot = await page.locator("body").ariaSnapshot({ ref: true });
      assertIncludes(page.url(), "/tests/document-startup/workspace", "the relative link follows the document base URL");
      assertIncludes(workspaceSnapshot, 'heading "Operations workspace"', "the user reaches the operations workspace");
      assertEqual(await page.title(), "Operations workspace · Ego Browser Lab", "the destination updates the browser tab title");

      const noScriptPage = await task.context.newPage();
      const noScriptSession = await task.context.newCDPSession(noScriptPage);
      try {
        await noScriptSession.send("Emulation.setScriptExecutionDisabled", {
          value: true,
        });
        const noScriptResponse = await noScriptPage.goto(
          baseUrl + "/tests/document-startup",
          { waitUntil: "load", timeout: 20_000 },
        );
        assertEqual(noScriptResponse?.status(), 200, "the server document also loads with scripting disabled");
        const visibleRecoveryLink = noScriptPage.locator("noscript a");
        assertEqual(
          await visibleRecoveryLink.isVisible(),
          true,
          "the no-script recovery action is visibly rendered for the user",
        );
        assertEqual(
          await visibleRecoveryLink.textContent(),
          "Open the no-script recovery guide",
          "the visible no-script action keeps its authored label",
        );
        const noScriptSnapshot = await noScriptPage
          .locator("body")
          .ariaSnapshot({ ref: true });
        assertIncludes(noScriptSnapshot, 'heading "Workspace startup"', "the no-script user retains the page context");
        assertEqual(
          await noScriptPage.locator("html").getAttribute("data-startup-state"),
          "server",
          "the external script does not execute in the disabled page",
        );
        assertEqual(
          await noScriptPage.getByRole("status").textContent(),
          "Waiting for workspace client",
          "the visible server status remains unchanged without scripts",
        );

        const recoveryLink = noScriptPage.getByRole("link", {
          name: "Open the no-script recovery guide",
          exact: true,
        });
        await egoBrowser.showTaskState("open recovery guide");
        await recoveryLink.click();
        const recoverySnapshot = await noScriptPage
          .locator("body")
          .ariaSnapshot({ ref: true });
        assertIncludes(noScriptPage.url(), "/tests/document-startup/recovery", "the no-script fallback performs real navigation");
        assertIncludes(recoverySnapshot, 'heading "No-script recovery guide"', "the no-script user reaches a usable recovery page");
        assertEqual(await noScriptPage.title(), "No-script recovery · Ego Browser Lab", "the recovery document updates the browser tab title");
        assertIncludes(
          noScriptSnapshot,
          'link "Open the no-script recovery guide"',
          "the agent snapshot preserves the real visible noscript recovery action",
        );
      } finally {
        await noScriptSession.detach();
        await noScriptPage.close();
      }
    `;
  },
};

export const javaScriptDisabledNavigationCase = {
  name: "JavaScript-disabled document replacement navigation",
  kind: "platform",
  body() {
    return `
      const task = await openE2eTaskSpace(
        taskName + " JavaScript-disabled replacement navigation",
      );
      const page = task.page;
      const initialResponse = await page.goto(
        baseUrl + "/tests/document-startup?mode=warm",
        { waitUntil: "load", timeout: 20_000 },
      );
      assertEqual(initialResponse?.status(), 200, "the warm document loads before the emulation change");
      const initialSnapshot = await page.locator("body").ariaSnapshot({ ref: true });
      assertIncludes(initialSnapshot, 'heading "Workspace startup"', "the warm page is observed before replacement");

      const session = await task.context.newCDPSession(page);
      let navigationOperationError;
      try {
        await session.send("Emulation.setScriptExecutionDisabled", { value: true });
        let disabledResponse;
        let navigationError;
        try {
          disabledResponse = await page.goto(
            baseUrl + "/tests/document-startup?mode=disabled",
            { waitUntil: "load", timeout: 10_000 },
          );
        } catch (error) {
          navigationError = error?.message || String(error);
        }
        const activePages = task.context
          .pages()
          .filter((candidate) => !candidate.isClosed());
        const disabledPage = activePages.find((candidate) =>
          candidate.url().includes("mode=disabled"),
        );
        const startupState = disabledPage
          ? await disabledPage
              .locator("html")
              .getAttribute("data-startup-state")
              .catch(() => null)
          : null;
        const noscriptVisible = disabledPage
          ? await disabledPage
              .locator("noscript a")
              .isVisible()
              .catch(() => false)
          : false;
        const replacementSessionState = await session
          .send("Runtime.evaluate", {
            expression:
              "({ href: location.href, startupState: document.documentElement.dataset.startupState })",
            returnByValue: true,
          })
          .then((result) => result.result.value)
          .catch(() => null);
        const navigationEvidence = {
          navigationResolved: !navigationError,
          responseOk: disabledResponse?.status() === 200,
          originalPageOpen: !page.isClosed(),
          activePageAvailable: activePages.length > 0,
          disabledUrlCommitted: Boolean(disabledPage),
          scriptsStayedDisabled: startupState === "server",
          noscriptVisible,
          sessionBoundToReplacement:
            replacementSessionState?.href.includes("mode=disabled") &&
            replacementSessionState.startupState === "server",
        };
        assertEqual(
          JSON.stringify(navigationEvidence),
          JSON.stringify({
            navigationResolved: true,
            responseOk: true,
            originalPageOpen: true,
            activePageAvailable: true,
            disabledUrlCommitted: true,
            scriptsStayedDisabled: true,
            noscriptVisible: true,
            sessionBoundToReplacement: true,
          }),
          "the JavaScript-disabled replacement navigation commits and preserves disabled scripting" +
            " (evidence=" + JSON.stringify(navigationEvidence) +
            ", error=" + JSON.stringify(navigationError) + ")",
        );
        assertEqual(disabledResponse?.status(), 200, "the JavaScript-disabled replacement navigation succeeds");
        assertIncludes(disabledPage.url(), "mode=disabled", "the disabled document commits its new URL");
        assertEqual(
          startupState,
          "server",
          "the replacement document keeps its server state while scripts are disabled",
        );
        assertEqual(
          noscriptVisible,
          true,
          "the replacement document renders its no-script recovery action",
        );
      } catch (error) {
        navigationOperationError = error;
        throw error;
      } finally {
        let cleanupError;
        try {
          await session.send("Emulation.setScriptExecutionDisabled", { value: false });
        } catch (error) {
          cleanupError = error;
        }
        try {
          await session.detach();
        } catch (error) {
          cleanupError ||= error;
        }
        if (!navigationOperationError && cleanupError) throw cleanupError;
      }
    `;
  },
};
