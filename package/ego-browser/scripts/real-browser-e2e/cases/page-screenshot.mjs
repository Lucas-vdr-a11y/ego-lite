export function pageScrolledScreenshotCase() {
  return `
    const task = await taskSpace(taskName);
    const page = await newPageAt(task, baseUrl + "/?workflow=page-scrolled-screenshot");

    await page.evaluate(() => {
      document.documentElement.style.cssText = "margin:0;padding:0";
      document.body.style.cssText = "margin:0;padding:0;width:2200px";
      document.body.innerHTML =
        '<div style="width:2200px;height:1400px;background:white"></div>' +
        '<div id="screenshot-marker" style="width:2200px;height:1200px;' +
        'background:repeating-conic-gradient(#e11d48 0 12deg,#2563eb 12deg 24deg,#16a34a 24deg 36deg) 0 0/96px 96px"></div>';
      scrollTo(240, 1600);
    });
    const scrollPosition = await page.evaluate(() => ({
      x: scrollX,
      y: scrollY,
      width: innerWidth,
      height: innerHeight,
    }));
    assert(scrollPosition.x > 0 && scrollPosition.y >= 1400, "fixture is scrolled in both axes");

    const defaultPath = join(artifactDir, "nested", "scrolled-default.png");
    const rawPath = join(artifactDir, "scrolled-raw.png");
    await page.screenshot({ path: defaultPath, fullPage: false });
    await page.screenshot({ path: rawPath, fullPage: false, raw: true });

    const defaultImage = await readFile(defaultPath);
    const rawImage = await readFile(rawPath);
    assert(defaultImage.length > 100, "default scrolled screenshot is non-empty");
    assert(rawImage.length > 100, "raw scrolled screenshot is non-empty");
    const defaultSamples = countColorfulPngSamples(defaultImage);
    const rawSamples = countColorfulPngSamples(rawImage);
    cliLog(JSON.stringify({
      screenshotBytes: { default: defaultImage.length, raw: rawImage.length },
      screenshotSamples: { default: defaultSamples, raw: rawSamples },
    }));
    assert(
      rawSamples.colorful >= 20,
      "raw CDP capture confirms that the visible viewport contains the colored marker"
    );
    assert(
      defaultSamples.colorful >= 20,
      "default screenshot captures the colored marker at the current scroll position"
    );

    await page.close();
  `;
}
