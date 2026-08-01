export function helperSurfaceCase() {
  return `
    await egoBrowser.useOrCreateTaskSpace(taskName);
    await resetHome();
    assertEqual(typeof globalThis.page, "object", "page facade is installed");
    assertEqual(typeof page.goto, "function", "page.goto is installed");
    assertEqual(typeof page.locator, "function", "page.locator is installed");
    assertEqual(typeof page.getByText, "function", "page.getByText is installed");
    assertEqual(typeof page.getByLabel, "function", "page.getByLabel is installed");
    assertEqual(typeof page.getByPlaceholder, "function", "page.getByPlaceholder is installed");
    assertEqual(typeof page.getByAltText, "function", "page.getByAltText is installed");
    assertEqual(typeof page.getByTitle, "function", "page.getByTitle is installed");
    assertEqual(typeof page.waitForLoadState, "function", "page.waitForLoadState is installed");
    assertEqual(typeof page.setDefaultTimeout, "function", "page.setDefaultTimeout is installed");
    assertEqual(typeof page.waitForEvent, "function", "page.waitForEvent is installed");
    assertEqual(typeof page.waitForURL, "function", "page.waitForURL is installed");
    for (const method of [
      "close", "bringToFront", "isClosed", "opener",
      "on", "once", "off", "removeAllListeners",
      "route", "unroute", "unrouteAll", "routeFromHAR", "routeWebSocket",
      "setExtraHTTPHeaders", "addInitScript", "exposeFunction", "exposeBinding",
      "frames", "frame", "mainFrame", "setViewportSize", "viewportSize",
      "emulateMedia", "requestGC", "evaluateHandle", "addScriptTag", "addStyleTag",
    ]) {
      assertEqual(typeof page[method], "function", "page." + method + " is installed");
    }
    assertEqual(typeof page.clock, "object", "page.clock is installed");
    for (const method of [
      "install", "fastForward", "pauseAt", "resume", "runFor",
      "setFixedTime", "setSystemTime",
    ]) {
      assertEqual(typeof page.clock[method], "function", "page.clock." + method + " is installed");
    }
    assertEqual(typeof page.screencast, "object", "page.screencast is installed");
    assertEqual(typeof page.screencast.start, "function", "page.screencast.start is installed");
    assertEqual(typeof page.screencast.stop, "function", "page.screencast.stop is installed");
    assertEqual(typeof page.keyboard.press, "function", "page.keyboard.press is installed");
    assertEqual(typeof page.mouse.click, "function", "page.mouse.click is installed");
    const loc = page.locator("#click-button");
    assertEqual(typeof loc.click, "function", "locator.click is installed");
    assertEqual(typeof loc.first, "function", "locator.first is installed");
    assertEqual(typeof loc.nth, "function", "locator.nth is installed");
    assertEqual(typeof loc.last, "function", "locator.last is installed");
    assertEqual(typeof loc.nth(0).click, "function", "locator.nth returns a locator");
    assertEqual(typeof loc.fill, "function", "locator.fill is installed");
    assertEqual(typeof loc.evaluate, "function", "locator.evaluate is installed");
    assertEqual(typeof loc.evaluateAll, "function", "locator.evaluateAll is installed");
    assertEqual(typeof loc.evaluateHandle, "function", "locator.evaluateHandle is installed");
    assertEqual(typeof loc.page, "function", "locator.page is installed");
    assertEqual(typeof loc.extractAll, "undefined", "non-Playwright locator.extractAll is not exposed");
    assertEqual(typeof page.getByText("Click counter").click, "function", "getByText returns a locator");
    assertEqual(typeof page.getByLabel("Text input").fill, "function", "getByLabel returns a locator");
    assertEqual(typeof page.getByPlaceholder("Type text").fill, "function", "getByPlaceholder returns a locator");
    assertEqual(typeof page.getByAltText("Ego fixture logo").count, "function", "getByAltText returns a locator");
    assertEqual(typeof page.getByTitle("Counter button").click, "function", "getByTitle returns a locator");
    assertEqual(typeof globalThis.tabs, "object", "tabs facade is installed");
    assertEqual(typeof tabs.open, "function", "tabs.open is installed");
    assertEqual(typeof tabs.openOrReuse, "function", "tabs.openOrReuse is installed");
    assertEqual(typeof tabs.close, "function", "tabs.close is installed");
    assertEqual(typeof tabs.ensureRealTab, "undefined", "internal ensureRealTab is not exposed");
    assertEqual(typeof tabs.iframeTarget, "undefined", "internal iframeTarget is not exposed");
    assertEqual(typeof globalThis.browser, "undefined", "Playwright Browser is not emulated");
    assertEqual(typeof globalThis.egoBrowser, "object", "egoBrowser facade is installed");
    assertEqual(Object.keys(egoBrowser).sort().join(","), "claimTaskSpace,closeTaskSpace,completeTaskSpace,handOffTaskSpace,listTaskSpaces,newTaskSpace,switchTaskSpace,takeOverTaskSpace,useOrCreateTaskSpace,waitForAgentControlTaskSpace", "egoBrowser exposes the complete TaskSpace surface");
    assertEqual(typeof egoBrowser.newPage, "undefined", "egoBrowser.newPage is not exposed");
    assertEqual(typeof egoBrowser.newContext, "undefined", "egoBrowser.newContext is not exposed");
    assertEqual(typeof egoBrowser.contexts, "undefined", "egoBrowser.contexts is not exposed");
    assertEqual(typeof egoBrowser.close, "undefined", "egoBrowser.close is not exposed");
    assertEqual(typeof globalThis.listTabs, "undefined", "native listTabs is not exposed at the top level");
    assertEqual(typeof globalThis.createTab, "undefined", "native createTab is not exposed at the top level");
    assertEqual(typeof globalThis.taskSpaces, "undefined", "taskSpaces facade is removed");
    assertEqual(typeof globalThis.site, "object", "site facade is installed");
    assertEqual(typeof site.runTool, "function", "site.runTool is installed");
    assertEqual(typeof globalThis.fetch, "object", "fetch facade is installed");
    assertEqual(typeof fetch.server, "function", "fetch.server is installed");
    assertEqual(typeof fetch.browser, "function", "fetch.browser is installed");
    assertEqual(typeof cdp, "function", "cdp escape hatch is installed");
    assertEqual(typeof help, "function", "help is installed");
    assertEqual(typeof globalThis.click, "undefined", "old click global is not exposed");
    assertEqual(typeof globalThis.fill, "undefined", "old fill global is not exposed");
    assertEqual(typeof globalThis.goto, "undefined", "old goto global is not exposed");
    assertEqual(typeof globalThis.evaluate, "undefined", "old evaluate global is not exposed");
    assertEqual(typeof globalThis.newTab, "undefined", "internal newTab is not exposed");
    const helpText = help("missingHelperForE2E");
    assertIncludes(helpText, "Unknown helper", "help reports unknown helper names");
    await page.getByText("Click counter").click();
    assertEqual(await page.locator("#click-count").textContent(), "1", "getByText clicks visible text");
    await page.getByLabel("Text input").fill("from label");
    assertEqual(await page.locator("#text-input").inputValue(), "from label", "getByLabel targets the input");
    await page.getByPlaceholder("Type text").fill("from placeholder");
    assertEqual(await page.locator("#text-input").inputValue(), "from placeholder", "getByPlaceholder targets the input");
    assertEqual(await page.getByAltText("Ego fixture logo").count(), 1, "getByAltText finds the image");
    assertEqual(await page.getByTitle("Counter button").count(), 1, "getByTitle finds titled elements");
    // Role-locator match-set consistency (the Redfin "Locator miss" regression).
    // The listbox holds two visible "House" options plus one inside a display:none ancestor.
    // A DOM role scan counts all three (no visibility filtering); the AX tree
    // ignores the hidden one. count()/nth()/click() must all agree on the same
    // AX set, otherwise "read count, act on the last index" targets past the end.
    const houseOptions = page.getByRole("option", { name: "House" });
    const houseCount = await houseOptions.count();
    assertEqual(houseCount, 2, "count() excludes an option under a display:none ancestor");
    assertEqual(
      await page.getByRole("option", { name: "House", includeHidden: true }).count(),
      3,
      "includeHidden keeps the option under a display:none ancestor"
    );
    assertEqual(await houseOptions.nth(houseCount - 1).innerText(), "House", "nth reads from the same AX match set count() used");
    await houseOptions.nth(houseCount - 1).click();
    assertEqual(
      await houseOptions.nth(houseCount - 1).getAttribute("aria-selected"),
      "true",
      "the option count() calls last is exactly the one nth()/click() targets"
    );
    assertEqual(await page.locator("text=Download sample").count(), 1, "text= locator compatibility works"); // agent-style-ok: compatibility check
    const extracted = await page.locator(".card").first().evaluateAll((cards) =>
      cards.map((card) => ({
        button: card.querySelector("#click-button")?.textContent?.trim() || null,
        nav: card.querySelector("#nav-link")?.getAttribute("href") || null,
        missing: card.querySelector(".does-not-exist")?.textContent?.trim() || null,
      }))
    );
    assertEqual(extracted.length, 1, "evaluateAll returns one row for first card");
    assertEqual(extracted[0].button, "Click counter", "evaluateAll reads nested text");
    assertIncludes(extracted[0].nav, "/nav-target", "evaluateAll reads nested attributes");
    assertEqual(extracted[0].missing, null, "evaluateAll returns null for missing nested selectors");
  `;
}
