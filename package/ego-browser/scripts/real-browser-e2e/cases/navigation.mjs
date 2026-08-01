export function navigationCase() {
  return `
    await taskSpaces.useOrCreate(taskName);
    const home = await resetHome();

    const info = await page.info();
    assertEqual(info.title, "ego-lite helper e2e", "pageInfo reads fixture title");
    assertIncludes(info.url, baseUrl + "/", "pageInfo reads current URL");
    assert(info.w > 0 && info.h > 0, "pageInfo returns viewport size");
    assert(Number.isFinite(info.pw) && Number.isFinite(info.ph), "pageInfo returns page dimensions");

    const openTabs = await tabs.list({ includeChrome: false });
    assert(openTabs.some((tab) => tab.targetId === home.targetId), "tabs.list includes home tab");
    const allTabs = await tabs.list();
    assert(allTabs.length >= openTabs.length, "tabs.list defaults to include chrome/internal tabs");

    const current = await tabs.current();
    assertEqual(current.targetId, home.targetId, "tabs.current follows selected tab");
    assertEqual(
      Object.keys(current).sort().join(","),
      "targetId,title,type,url",
      "tabs.current returns the lightweight TabInfo shape",
    );

    const reused = await tabs.openOrReuse(baseUrl + "/", { wait: true, timeout: 10000 });
    assertEqual(reused.targetId, home.targetId, "tabs.openOrReuse reuses exact home URL");

    const byOrigin = await tabs.openOrReuse(baseUrl + "/not-opened", {
      match: "origin",
      wait: false,
    });
    assertEqual(byOrigin.targetId, home.targetId, "tabs.openOrReuse reuses by origin");

    const byPath = await tabs.openOrReuse(baseUrl + "/?query=1", {
      match: "origin+path",
      wait: false,
    });
    assertEqual(byPath.targetId, home.targetId, "tabs.openOrReuse reuses by origin and path");

    const unique = await tabs.openOrReuse(baseUrl + "/secondary?unique=" + Date.now(), {
      wait: false,
    });
    assert(unique.targetId !== home.targetId, "tabs.openOrReuse opens a unique exact URL");
    await tabs.close(unique);
    await tabs.activate(home);

    const alwaysNew = await tabs.open(baseUrl + "/", {
      wait: true,
      timeout: 10000,
    });
    assert(alwaysNew.targetId !== home.targetId, "tabs.open always creates a new tab");
    assertEqual(alwaysNew.type, "page", "tabs.open returns TabInfo");
    await tabs.close(alwaysNew);
    await tabs.activate(home);

    const slowRun = Date.now();
    const slowUrl =
      baseUrl + "/regression/slow-load?ms=1200&run=" + slowRun;
    let openTimeoutError = null;
    try {
      try {
        await tabs.openOrReuse(slowUrl, {
          wait: true,
          timeout: 200,
        });
      } catch (error) {
        openTimeoutError = error;
      }
      assertEqual(
        openTimeoutError?.name,
        "TimeoutError",
        "tabs.openOrReuse exposes a load timeout as TimeoutError",
      );
      assertIncludes(
        openTimeoutError?.message,
        "tabs.openOrReuse timed out after 200ms",
        "tabs.openOrReuse reports its effective load timeout",
      );
    } finally {
      const slowTabs = (await tabs.list({ includeChrome: false })).filter(
        (tab) => String(tab.url || "").includes("run=" + slowRun),
      );
      for (const slowTab of slowTabs) {
        await tabs.close(slowTab).catch(() => {});
      }
      await tabs.activate(home);
    }

    const secondary = await tabs.openOrReuse(baseUrl + "/secondary", {
      wait: true,
      timeout: 10000,
    });
    await page.waitForLoadState("load", { timeout: 10000 });
    const secondaryTitleViaTarget = await tabs.evaluate(secondary, "document.title");
    assertEqual(secondaryTitleViaTarget, "ego-lite secondary", "js evaluates against explicit target id");
    const homeTitleViaTarget = await tabs.evaluate(home, "document.title");
    assertEqual(homeTitleViaTarget, "ego-lite helper e2e", "js target id leaves current tab independent");

    const secondaryByIncludes = await tabs.openOrReuse("/secondary", {
      match: "includes",
      wait: false,
    });
    assertEqual(
      secondaryByIncludes.targetId,
      secondary.targetId,
      "tabs.openOrReuse reuses by URL substring",
    );
    await tabs.activate(secondary);
    const secondaryInfo = await page.info();
    assertEqual(secondaryInfo.title, "ego-lite secondary", "tabs.activate selects secondary tab");

    const closedId = await tabs.close(secondary);
    assertEqual(closedId, secondary.targetId, "tabs.close returns closed target id");
    await tabs.activate(home);

    const closeCurrent = await tabs.openOrReuse(baseUrl + "/secondary?close=current", {
      wait: true,
      timeout: 10000,
    });
    const currentClosedId = await tabs.close();
    assertEqual(currentClosedId, closeCurrent.targetId, "tabs.close closes current tab by default");
    await tabs.activate(home);

    const afterCloseCurrent = await tabs.current();
    assertEqual(afterCloseCurrent.targetId, home.targetId, "tabs.activate restores home after closing current tab");

    await assertRejects(
      () => tabs.close(""),
      "tabs.close requires a targetId",
      "tabs.close validates empty target id"
    );

    await page.goto(baseUrl + "/nav-target", { waitUntil: "commit" });
    await page.waitForLoadState("load", { timeout: 10000 });
    const navInfo = await page.info();
    assertEqual(navInfo.title, "ego-lite nav target", "goto navigates current tab");

    const noWaitNav = await page.goto(baseUrl + "/nav-target?no-wait=1", {
      waitUntil: "commit",
    });
    assert(noWaitNav === null || typeof noWaitNav.status === "function", "goto waitUntil:commit returns Response or null");
    await page.waitForLoadState("load", { timeout: 10000 });

    const nav = await page.goto(baseUrl + "/", { timeout: 10000, settle: 100 });
    assert(nav === null || typeof nav.status === "function", "goto returns Response or null");
    await page.waitForTimeout(200);
    assertIncludes(
      await nav.text(),
      "ego-lite helper e2e",
      "a delayed navigation Response body remains readable",
    );

    const back = await page.goBack({ timeout: 10000 });
    assertIncludes(page.url(), "/nav-target", "page.goBack restores the history entry");
    if (back) {
      assertIncludes(back.url(), "/nav-target", "page.goBack returns the navigation response");
    }
    const forward = await page.goForward({ timeout: 10000 });
    assertIncludes(page.url(), baseUrl + "/", "page.goForward restores the history entry");
    if (forward) {
      assertIncludes(forward.url(), baseUrl + "/", "page.goForward returns the navigation response");
    }
    assertIncludes(await page.content(), "Helper e2e fixture", "page.content serializes the document");

    await page.setContent("<!doctype html><html><body><main id='replacement'>Replacement document</main></body></html>", {
      timeout: 10000,
    });
    assertEqual(
      await page.locator("#replacement").innerText(),
      "Replacement document",
      "page.setContent replaces the main-frame document",
    );
    await page.goto(baseUrl + "/", { timeout: 10000 });

  `;
}
