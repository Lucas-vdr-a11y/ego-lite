export function observationCase() {
  return `
    await egoBrowser.useOrCreateTaskSpace(taskName);
    await resetHome();

    const raw = await page.snapshotRaw({ includeStableLocator: true });
    assertIncludes(raw.content || "", "Helper e2e fixture", "snapshotRaw contains fixture content");

    const compactRaw = await page.snapshotRaw({
      scope: "only_within_viewport",
      includeActionMarks: false,
      includeStableLocator: false,
    });
    assertIncludes(compactRaw.content || "", "Helper e2e fixture", "snapshotRaw accepts compact options");

    const snap = await page.snapshotRaw({
      scope: "full_page",
      includeActionMarks: true,
      includeStableLocator: true,
    });
    assertIncludes(snap.content || "", "Click counter", "snapshotRaw contains button text");
    assert(Array.isArray(snap.refs), "snapshotRaw returns refs array");

    const buttonRef = (snap.refs || []).find(
      (ref) =>
        String(ref?.role || "") === "button" &&
        (String(ref?.name || "").includes("Increment counter") ||
          String(ref?.name || "").includes("Click counter"))
    )?.backendNodeId;
    assert(buttonRef, "snapshotRaw exposes a reusable backend ref for the button");
    const atRefCenter = await page.elementCenter("@" + buttonRef);
    assert(Number.isFinite(atRefCenter.x) && Number.isFinite(atRefCenter.y), "@ref resolves to coordinates");
    const namedRefCenter = await page.elementCenter("ref=" + buttonRef);
    assert(Number.isFinite(namedRefCenter.x) && Number.isFinite(namedRefCenter.y), "ref= resolves to coordinates");

    const text = await page.snapshot({ scope: "full_page" });
    assertIncludes(text, "Text input", "snapshot returns text content");

    const viewportText = await page.snapshot({ scope: "only_within_viewport" });
    assertIncludes(viewportText, "Helper e2e fixture", "snapshot supports viewport scope");

    const center = await page.elementCenter("#click-button");
    assert(Number.isFinite(center.x) && Number.isFinite(center.y), "elementCenter returns coordinates");

    const locatorCenter = await page.elementCenter("loc=css:#click-button");
    assert(Number.isFinite(locatorCenter.x) && Number.isFinite(locatorCenter.y), "elementCenter resolves loc=css");

    const hrefCenter = await page.elementCenter("loc=href:/nav-target");
    assert(Number.isFinite(hrefCenter.x) && Number.isFinite(hrefCenter.y), "elementCenter resolves loc=href");

    const xpathCenter = await page.elementCenter("xpath=//*[@id='click-button']");
    assert(Number.isFinite(xpathCenter.x) && Number.isFinite(xpathCenter.y), "elementCenter resolves xpath");

    await assertRejects(
      () => page.elementCenter("loc=css:.duplicate-action"),
      "matched 2",
      "elementCenter reports duplicate css locators"
    );
    await assertRejects(
      () => page.elementCenter("loc=role:button[name='Duplicate action']"),
      "matched 2",
      "elementCenter reports duplicate role locators"
    );
    await assertRejects(
      () => page.elementCenter("loc=href:/missing-link"),
      "matched 0",
      "elementCenter reports missing href locators"
    );
    await assertRejects(
      () => page.elementCenter("@999999"),
      "Unknown ref",
      "elementCenter reports unknown refs"
    );
    await assertRejects(
      () => page.elementCenter("["),
      "Invalid selector",
      "elementCenter reports invalid selectors"
    );
    await assertRejects(
      () => page.elementCenter("#does-not-exist"),
      "Element not found",
      "elementCenter reports missing elements"
    );

    const screenshotBuf = await page.screenshot({ fullPage: false });
    assert(screenshotBuf.length > 100, "screenshot returns a non-trivial png Buffer");
    assertEqual(screenshotBuf[0], 137, "screenshot starts with PNG magic byte 137");
    assertEqual(screenshotBuf[1], 80, "screenshot has PNG header byte P (80)");

    const explicitBuffer = await page.screenshot({ path: explicitScreenshotPath, fullPage: false });
    assert(explicitBuffer.length > 100, "screenshot returns Buffer when writing an explicit path");
    const explicitStat = await stat(explicitScreenshotPath);
    assert(explicitStat.size > 0, "screenshot writes explicit path");

    const fullScreenshot = await page.screenshot({ fullPage: true });
    assert(fullScreenshot.length > 0, "screenshot supports full page");

    await page.evaluate(() => window.scrollTo(17, 1200));
    await page.waitForTimeout(100);
    const scrolledInfo = await page.info();
    assert(scrolledInfo.sy > 0, "screenshot regression page is scrolled");
    const scrolledViewportScreenshot = await page.screenshot();
    const explicitScrolledScreenshot = await page.screenshot({
      clip: {
        x: scrolledInfo.sx,
        y: scrolledInfo.sy,
        width: scrolledInfo.w,
        height: scrolledInfo.h,
      },
    });
    assert(
      scrolledViewportScreenshot.equals(explicitScrolledScreenshot),
      "viewport screenshot uses the current scroll offset"
    );

    const markerScreenshot = await page.locator("#bottom-marker").screenshot();
    const markerBox = await page.locator("#bottom-marker").boundingBox();
    const markerInfo = await page.info();
    const explicitMarkerScreenshot = await page.screenshot({
      clip: {
        x: markerBox.x + markerInfo.sx,
        y: markerBox.y + markerInfo.sy,
        width: markerBox.width,
        height: markerBox.height,
      },
    });
    assert(
      markerScreenshot.equals(explicitMarkerScreenshot),
      "locator screenshot converts viewport coordinates after scrolling"
    );
    await page.evaluate(() => window.scrollTo(0, 0));

    const rawScreenshot = await page.screenshot({
      raw: true,
      clip: { x: 0, y: 0, width: 120, height: 120, scale: 1 },
    });
    assert(rawScreenshot.length > 0, "screenshot supports raw clips");

    try {
      await cdp("Emulation.setDeviceMetricsOverride", {
        width: 640,
        height: 480,
        deviceScaleFactor: 2,
        mobile: false,
      });
      await page.waitForTimeout(100);
      const deviceScaleScreenshot = await page.screenshot({ caret: "initial" });
      const cssScaleScreenshot = await page.screenshot({ caret: "initial", scale: "css" });
      assertEqual(
        deviceScaleScreenshot.readUInt32BE(16),
        1280,
        "screenshot defaults to one output pixel per device pixel"
      );
      assertEqual(
        cssScaleScreenshot.readUInt32BE(16),
        640,
        "screenshot css scale returns one output pixel per CSS pixel"
      );
    } finally {
      await setStableViewport();
    }

    const savedScreenshotPath = await page.saveScreenshot({ fullPage: false });
    const savedScreenshotStat = await stat(savedScreenshotPath);
    assert(savedScreenshotStat.size > 0, "saveScreenshot returns a generated path");

    await cdp("Network.enable");
    await fetch.browser("/api/text", { timeout: 5000 });
    const events = await page.drainEvents();
    assert(Array.isArray(events), "drainEvents returns an array");
    const eventsAfterDrain = await page.drainEvents();
    assertEqual(eventsAfterDrain.length, 0, "drainEvents clears the event buffer");

    /* dynamic DOM — add element, verify snapshot picks it up */
    console.log(JSON.stringify({ observationStep: "dynamic DOM" }));
    await page.locator("#remove-element").click();
    await page.waitForTimeout(100);
    const textBefore = await page.snapshot({ scope: "full_page" });
    assert(!String(textBefore).includes("Dynamic!"), "snapshot text does not contain dynamic element before creation");

    await page.locator("#add-element").click();
    await page.waitForSelector("#dynamic-element", { timeout: 3000, state: "visible" });
    await page.waitForTimeout(200);
    const textAfter = await page.snapshot({ scope: "full_page" });
    assertIncludes(String(textAfter), "Dynamic!", "snapshot text includes dynamically created element");

    /* iframe interaction — use Playwright-style frame-scoped locators */
    console.log(JSON.stringify({ observationStep: "iframe" }));
    const fixtureFrame = page.frameLocator("#fixture-frame");
    const iframeMarkerText = await fixtureFrame
      .locator("#iframe-marker")
      .innerText();
    assertEqual(iframeMarkerText, "iframe target", "frameLocator evaluates inside the fixture iframe");

    const iframeTitle = await fixtureFrame.locator("title").textContent();
    assertEqual(iframeTitle, "ego-lite iframe", "frameLocator reads the fixture iframe title");
    assertEqual(
      await fixtureFrame.locator("#fixture-frame").count(),
      0,
      "iframe fixture does not recursively embed itself",
    );
  `;
}
