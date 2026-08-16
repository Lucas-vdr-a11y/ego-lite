import { scenarioCase } from "./scenario-case.mjs";

export const documentOutlineScenarioCase = scenarioCase(
  "document-outline",
  `
    const outlineSnapshot = await page.locator("body").ariaSnapshot({ ref: true });
    assertIncludes(
      outlineSnapshot,
      'article "Northstar 2.4 release briefing"',
      "the structure tree exposes the release briefing as a named article",
    );
    assertIncludes(
      outlineSnapshot,
      'navigation "Release outline"',
      "the structure tree exposes the article navigation landmark",
    );
    assertIncludes(
      outlineSnapshot,
      'heading "Northstar 2.4 release briefing" [level=1]',
      "the structure tree preserves the article heading level",
    );
    assertIncludes(
      outlineSnapshot,
      'heading "Approval digest" [level=6]',
      "the structure tree preserves the deepest heading level",
    );
    assertIncludes(
      outlineSnapshot,
      'heading "Release briefing" [level=1]',
      "the structure tree exposes the visible page heading",
    );
    assertEqual(
      await page.getByRole("main").count(),
      1,
      "the composed document exposes one main landmark",
    );
    assertEqual(
      await page.getByRole("main").isVisible(),
      true,
      "the main landmark is visible to the user",
    );
    assertEqual(
      await page.locator("h1").count(),
      2,
      "the composed document has a page heading and an authored briefing heading",
    );
    for (const [level, name] of [
      [1, "Northstar 2.4 release briefing"],
      [2, "Executive summary"],
      [3, "Customer impact"],
      [4, "Escalation threshold"],
      [5, "Change log checksum"],
      [6, "Approval digest"],
    ]) {
      const heading = page.getByRole("heading", { name, level, exact: true });
      assertEqual(
        await heading.count(),
        1,
        "the authored document exposes its unique level-" + level + " heading",
      );
      assertEqual(
        await heading.evaluate((element) => element.tagName),
        "H" + level,
        "the level-" + level + " heading keeps its native HTML element",
      );
      const headingBox = await heading.boundingBox();
      assert(
        headingBox && headingBox.width > 0 && headingBox.height > 0,
        "the level-" + level + " heading occupies visible page geometry",
      );
    }

    const outlineArticle = page.locator(".document-outline article");
    const outlineHeader = outlineArticle.locator(":scope > header");
    const outlineHeadingGroup = outlineHeader.locator("hgroup");
    const outlineAddress = outlineHeader.locator("address");
    const outlineFooter = outlineArticle.locator(":scope > footer");
    for (const [locator, tagName, label] of [
      [outlineHeader, "HEADER", "article header"],
      [outlineHeadingGroup, "HGROUP", "release heading group"],
      [outlineAddress, "ADDRESS", "release author address"],
      [outlineFooter, "FOOTER", "article footer"],
    ]) {
      assertEqual(
        await locator.evaluate((element) => element.tagName),
        tagName,
        "the rendered document preserves the native " + label + " element",
      );
      const box = await locator.boundingBox();
      assert(
        box && box.width > 0 && box.height > 0,
        "the " + label + " occupies visible page geometry",
      );
    }
    assertIncludes(
      await outlineHeader.textContent(),
      "Find a release topic",
      "the article header visibly contains the release navigation and search context",
    );
    assertIncludes(
      await outlineHeadingGroup.textContent(),
      "A shared operating brief for the staged rollout",
      "the hgroup keeps the visible briefing subtitle with its heading",
    );
    assertIncludes(
      await outlineAddress.textContent(),
      "Prepared by the Release Operations team",
      "the address exposes the visible release author contact context",
    );
    assertEqual(
      await outlineAddress
        .getByRole("link", { name: "release-ops@example.test", exact: true })
        .getAttribute("href"),
      "mailto:release-ops@example.test",
      "the address retains its usable contact destination",
    );
    assertIncludes(
      await outlineFooter.textContent(),
      "Last reviewed 15 August 2026 · Release record NS-2408-7F",
      "the article footer visibly preserves the review record",
    );
    assertEqual(
      await outlineArticle.getByRole("banner").count(),
      0,
      "the article header is not promoted to the page banner landmark",
    );
    assertEqual(
      await outlineArticle.getByRole("contentinfo").count(),
      0,
      "the article footer is not promoted to the page contentinfo landmark",
    );
    assertEqual(
      await outlineHeadingGroup.getByRole("heading", {
        name: "Northstar 2.4 release briefing",
        level: 1,
        exact: true,
      }).count(),
      1,
      "the hgroup preserves its one authored level-one heading",
    );

    const rolloutLink = page.getByRole("link", { name: "Rollout controls", exact: true });
    await observedAction(page, rolloutLink, "click");
    assertEqual(
      new URL(page.url()).hash,
      "#rollout",
      "pointer activation updates the URL to the rollout section",
    );
    const rolloutBox = await page.locator("#rollout").boundingBox();
    const rolloutViewportHeight = await page.evaluate(() => window.innerHeight);
    assert(
      rolloutBox && rolloutBox.y >= 0 && rolloutBox.y < rolloutViewportHeight,
      "pointer fragment navigation brings rollout controls into the viewport",
    );

    const supportLink = page.getByRole("link", { name: "Support ownership", exact: true });
    await observedFocusedKeyboard(page, supportLink, "press", "Enter");
    assertEqual(
      new URL(page.url()).hash,
      "#support",
      "keyboard activation updates the URL to the support section",
    );
    const supportBox = await page.locator("#support").boundingBox();
    const supportViewportHeight = await page.evaluate(() => window.innerHeight);
    assert(
      supportBox && supportBox.y >= 0 && supportBox.y < supportViewportHeight,
      "keyboard fragment navigation brings support ownership into the viewport",
    );
    assertEqual(
      await page.locator("#support").evaluate((element) => element === document.activeElement),
      true,
      "keyboard fragment navigation moves focus to the support section",
    );
    const supportSnapshot = await page.locator("#support").ariaSnapshot({ ref: true });
    assertIncludes(
      supportSnapshot,
      'heading "Support ownership" [level=2]',
      "the destination remains structurally observable after navigation",
    );
    assertIncludes(
      supportSnapshot,
      'complementary "Related support context"',
      "the destination exposes its related support landmark",
    );

    const briefingQuery = page.getByRole("searchbox", {
      name: "Find a release topic",
      exact: true,
    });
    await observedAction(page, briefingQuery, "fill", "rollout threshold");
    assertEqual(
      await briefingQuery.inputValue(),
      "rollout threshold",
      "the native search control visibly retains the user's query before submission",
    );
    const searchNavigation = page.waitForURL(
      "**/tests/document-outline?q=rollout+threshold",
      { waitUntil: "load", timeout: 10_000 },
    );
    await observedPageKey(
      page,
      'searchbox "Find a release topic"',
      "Enter",
    );
    await searchNavigation;
    assertEqual(
      new URL(page.url()).searchParams.get("q"),
      "rollout threshold",
      "keyboard submission sends the authored query through the native GET form",
    );
    const searchedSnapshot = await page.locator("body").ariaSnapshot({ ref: true });
    assertIncludes(
      searchedSnapshot,
      'heading "Release briefing" [level=1]',
      "the searched document keeps its page context after native navigation",
    );

    const searchSnapshot = await page.locator("search").ariaSnapshot({ ref: true });
    const cdpSession = await task.context.newCDPSession(page);
    let searchAx;
    try {
      const documentNode = await cdpSession.send("DOM.getDocument", {
        depth: 0,
      });
      const searchNode = await cdpSession.send("DOM.querySelector", {
        nodeId: documentNode.root.nodeId,
        selector: ".document-outline search",
      });
      const describedSearch = await cdpSession.send("DOM.describeNode", {
        nodeId: searchNode.nodeId,
      });
      const backendNodeId = describedSearch.node.backendNodeId;
      const searchTree = await cdpSession.send(
        "Accessibility.getPartialAXTree",
        {
          backendNodeId,
          fetchRelatives: false,
        },
      );
      searchAx = searchTree.nodes.find(
        (candidate) => candidate.backendDOMNodeId === backendNodeId,
      );
    } finally {
      await cdpSession.detach();
    }
    assertEqual(
      searchAx?.role?.value,
      "search",
      "Chromium exposes the native search landmark",
    );
    assertEqual(
      searchAx?.name?.value,
      "Search release brief",
      "Chromium exposes the authored search landmark name",
    );
    assertIncludes(
      searchSnapshot,
      'search "Search release brief"',
      "the framework snapshot preserves Chromium's native search landmark",
    );
  `,
);
