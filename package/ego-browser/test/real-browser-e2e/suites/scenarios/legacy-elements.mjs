import { scenarioCase } from "./scenario-case.mjs";

export const legacyElementsScenarioCase = scenarioCase(
  "legacy-elements",
  `
    const compatibilitySurface = page.locator(".legacy-elements");
    const baseline = compatibilitySurface.locator("[data-format-baseline]");
    const legacyAcronym = page.getByTestId("legacy-acronym");
    const legacyBig = page.getByTestId("legacy-big");
    const legacyCenter = page.getByTestId("legacy-center");
    const legacyFont = page.getByTestId("legacy-font");
    const legacyNobr = page.getByTestId("legacy-nobr");
    const legacyStrike = page.getByTestId("legacy-strike");
    const legacyTt = page.getByTestId("legacy-tt");

    const formattingState = await page.evaluate(() => {
      function computed(selector) {
        const element = document.querySelector(selector);
        const style = getComputedStyle(element);
        return {
          color: style.color,
          fontFamily: style.fontFamily,
          fontSize: style.fontSize,
          textAlign: style.textAlign,
          textDecorationLine: style.textDecorationLine,
          whiteSpace: style.whiteSpace,
        };
      }
      return {
        baseline: computed("[data-format-baseline]"),
        big: computed('[data-testid="legacy-big"]'),
        center: computed('[data-testid="legacy-center"]'),
        font: computed('[data-testid="legacy-font"]'),
        nobr: computed('[data-testid="legacy-nobr"]'),
        strike: computed('[data-testid="legacy-strike"]'),
        tt: computed('[data-testid="legacy-tt"]'),
      };
    });
    assert(
      Number.parseFloat(formattingState.big.fontSize) >
        Number.parseFloat(formattingState.baseline.fontSize),
      "the imported big element remains visibly larger than adjacent baseline text",
    );
    assertEqual(
      await legacyFont.getAttribute("size"),
      "4",
      "the imported font retains its authored size hint",
    );
    assert(
      formattingState.font.color !== formattingState.baseline.color,
      "the imported font color remains distinct from adjacent baseline text",
    );
    assert(
      formattingState.font.fontFamily !== formattingState.baseline.fontFamily,
      "the imported font face remains distinct from adjacent baseline text",
    );
    assertIncludes(
      formattingState.center.textAlign,
      "center",
      "the imported center element retains its browser centering behavior",
    );
    assertEqual(
      formattingState.nobr.whiteSpace,
      "nowrap",
      "the imported nobr element retains its no-wrap behavior",
    );
    assertIncludes(
      formattingState.strike.textDecorationLine,
      "line-through",
      "the imported strike element visibly marks retired routing",
    );
    assert(
      formattingState.tt.fontFamily !== formattingState.baseline.fontFamily,
      "the imported tt element retains a distinct fixed-width face",
    );
    assertEqual(
      await legacyAcronym.getAttribute("title"),
      "Electronic Data Interchange",
      "the imported acronym retains its expansion",
    );
    assertEqual(
      (await legacyAcronym.textContent()).trim(),
      "EDI",
      "the imported acronym retains its visible source text",
    );

    for (const [locator, label] of [
      [baseline, "baseline supplier label"],
      [legacyAcronym, "acronym"],
      [legacyBig, "big formatting"],
      [legacyCenter, "centered heading"],
      [legacyFont, "font formatting"],
      [legacyNobr, "no-wrap line"],
      [legacyStrike, "struck routing"],
      [legacyTt, "fixed-width reference"],
    ]) {
      const box = await locator.boundingBox();
      assert(
        box && box.width > 0 && box.height > 0,
        "the " + label + " occupies non-zero visible geometry",
      );
    }
    const centerBox = await legacyCenter.boundingBox();
    const centeredTextBox = await legacyCenter.locator("span").boundingBox();
    assert(
      centerBox &&
        centeredTextBox &&
        Math.abs(
          centerBox.x +
            centerBox.width / 2 -
            (centeredTextBox.x + centeredTextBox.width / 2),
        ) < 1,
      "the center element positions its imported heading at the container midpoint",
    );
    assertEqual(
      await compatibilitySurface
        .locator(".legacy-narrow-window")
        .evaluate((element) => element.scrollWidth > element.clientWidth),
      true,
      "the no-wrap import genuinely overflows its bounded review window",
    );

    const unknownCompatibilityElements = await compatibilitySurface
      .locator("content, menuitem, shadow")
      .evaluateAll((elements) =>
        elements.map((element) => ({
          tagName: element.tagName,
          unknown: element instanceof HTMLUnknownElement,
          text: element.textContent.replace(/\\s+/g, " ").trim(),
        })),
      );
    assertEqual(
      JSON.stringify(unknownCompatibilityElements),
      JSON.stringify([
        {
          tagName: "CONTENT",
          unknown: true,
          text: "Imported content insertion point: consignee notes retained.",
        },
        {
          tagName: "MENUITEM",
          unknown: true,
          text: "Imported menu command: inspect supplier lot.",
        },
        {
          tagName: "SHADOW",
          unknown: true,
          text: "Imported shadow insertion point: customs ledger retained.",
        },
      ]),
      "content, menuitem, and shadow parse as visible unknown compatibility elements",
    );
    for (const [testId, label] of [
      ["legacy-content", "content"],
      ["legacy-menuitem", "menuitem"],
      ["legacy-shadow", "shadow"],
    ]) {
      const unknownElement = page.getByTestId(testId);
      assertEqual(
        await unknownElement.isVisible(),
        true,
        "the imported " + label + " text is visible",
      );
      const box = await unknownElement.boundingBox();
      assert(
        box && box.width > 0 && box.height > 0,
        "the imported " + label + " text has visible geometry",
      );
    }

    const legacyRuby = page.getByTestId("legacy-ruby");
    const rubyChildTextOrder = await legacyRuby.evaluate((ruby) =>
      Array.from(ruby.children)
        .map(
          (child) =>
            child.tagName +
            ":" +
            child.textContent.replace(/\\s+/g, " ").trim(),
        )
        .join("|"),
    );
    assertEqual(
      rubyChildTextOrder,
      "RB:新|RB:加坡|RP:(|RT:Singapore|RP:)|RTC:Supplier origin",
      "rb and rtc retain the imported ruby text order",
    );

    const legacyImage = page.locator("#legacy-supplier-seal");
    const legacyImageTagName = await legacyImage.evaluate(
      (element) => element.tagName,
    );
    assertEqual(
      legacyImageTagName,
      "IMG",
      "the HTML parser maps the obsolete image source tag to an IMG element",
    );
    assertEqual(
      await legacyImage.getAttribute("alt"),
      "Scanned supplier seal",
      "the parser-mapped image retains its authored alternative text",
    );
    const legacyImageBox = await legacyImage.boundingBox();
    assert(
      legacyImageBox &&
        legacyImageBox.width > 0 &&
        legacyImageBox.height > 0,
      "the parser-mapped supplier seal has non-zero visible geometry",
    );
    const compatibilitySnapshot = await compatibilitySurface.ariaSnapshot({
      ref: true,
    });
    assertIncludes(
      compatibilitySnapshot,
      'img "Scanned supplier seal"',
      "the framework snapshot exposes the parser-mapped image and its alt text",
    );

    const legacyXmp = page.getByTestId("legacy-xmp");
    assertIncludes(
      await legacyXmp.textContent(),
      '<button id="xmp-fake-approve">Approve imported manifest</button>',
      "xmp preserves apparent button markup as literal imported text",
    );
    const xmpFakeButtonCount = await page
      .locator("#xmp-fake-approve")
      .count();
    assertEqual(
      xmpFakeButtonCount,
      0,
      "xmp does not create a fake interactive button node",
    );

    const legacyNoembed = page.getByTestId("legacy-noembed");
    assertEqual(
      await legacyNoembed.count(),
      1,
      "the parser retains the imported noembed element",
    );
    assertEqual(
      await legacyNoembed.isVisible(),
      false,
      "embed-capable Chromium keeps noembed fallback hidden",
    );
    assertIncludes(
      await legacyNoembed.textContent(),
      "Legacy plug-in fallback remains hidden",
      "the hidden noembed element retains its fallback source text",
    );

    const legacyParam = compatibilitySurface.locator(
      'param[name="archive"]',
    );
    assertEqual(
      await legacyParam.getAttribute("name"),
      "archive",
      "the inert param retains its imported name",
    );
    assertEqual(
      await legacyParam.getAttribute("value"),
      "supplier-manifest-v3.pdf",
      "the inert param retains its imported value",
    );
    assertEqual(
      await legacyParam.isVisible(),
      false,
      "the inert param does not pretend to expose a user control",
    );

    const legacyMarquee = page.getByTestId("legacy-marquee");
    const marqueeState = await legacyMarquee.evaluate((element) => ({
      scrollAmount: element.scrollAmount,
      startType: typeof element.start,
      stopType: typeof element.stop,
      text: element.textContent.replace(/\\s+/g, " ").trim(),
    }));
    assertEqual(
      marqueeState.scrollAmount,
      0,
      "the marquee keeps its deterministic zero scroll amount",
    );
    assertEqual(
      marqueeState.startType,
      "function",
      "Chromium exposes the historical marquee start interface",
    );
    assertEqual(
      marqueeState.stopType,
      "function",
      "Chromium exposes the historical marquee stop interface",
    );
    assertEqual(
      marqueeState.text,
      "Imported alert: manual customs review required for SUP-208.",
      "the marquee retains its visible imported warning",
    );
    const marqueeBox = await legacyMarquee.boundingBox();
    assert(
      marqueeBox && marqueeBox.width > 0 && marqueeBox.height > 0,
      "the zero-speed marquee still occupies non-zero visible geometry",
    );

    const cdpSession = await task.context.newCDPSession(page);
    let rawDirectoryRole;
    let rawImageRole;
    let rawImageName;
    try {
      const documentNode = await cdpSession.send("DOM.getDocument", {
        depth: 0,
      });
      async function rawAxNode(selector) {
        const query = await cdpSession.send("DOM.querySelector", {
          nodeId: documentNode.root.nodeId,
          selector,
        });
        assert(query.nodeId > 0, "CDP resolves " + selector);
        const description = await cdpSession.send("DOM.describeNode", {
          nodeId: query.nodeId,
        });
        const tree = await cdpSession.send(
          "Accessibility.getPartialAXTree",
          {
            backendNodeId: description.node.backendNodeId,
            fetchRelatives: false,
          },
        );
        return tree.nodes.find(
          (node) =>
            node.backendDOMNodeId === description.node.backendNodeId,
        );
      }
      const rawDirectory = await rawAxNode(
        '[data-testid="legacy-directory"]',
      );
      const rawImage = await rawAxNode("#legacy-supplier-seal");
      rawDirectoryRole = rawDirectory?.role?.value;
      rawImageRole = rawImage?.role?.value;
      rawImageName = rawImage?.name?.value;
    } finally {
      await cdpSession.detach();
    }
    assertEqual(
      rawDirectoryRole,
      "list",
      "raw Chromium AX exposes the historical dir as a list",
    );
    assertEqual(
      rawImageRole,
      "image",
      "raw Chromium AX exposes the parser-mapped supplier seal as an image",
    );
    assertEqual(
      rawImageName,
      "Scanned supplier seal",
      "raw Chromium AX derives the supplier seal name from its retained alt text",
    );

    const directory = page.getByTestId("legacy-directory");
    const manifestLink = directory.getByRole("link", {
      name: "Open imported manifest line SUP-208",
      exact: true,
    });
    const manifestTarget = page.locator("#manifest-line-sup-208");
    await observedAction(page, manifestLink, "click");
    assertEqual(
      await page.evaluate(() => location.hash),
      "#manifest-line-sup-208",
      "the historical directory link performs real fragment navigation",
    );
    assertEqual(
      await manifestTarget.evaluate(
        (element) => document.activeElement === element,
      ),
      true,
      "native fragment navigation focuses the manifest review target",
    );

    const reviewManifest = compatibilitySurface.getByRole("button", {
      name: "Review imported manifest",
      exact: true,
    });
    const approveManifest = compatibilitySurface.getByRole("button", {
      name: "Approve supplier manifest",
      exact: true,
    });
    const reviewStatus = page.getByTestId("legacy-manifest-status");
    assertEqual(
      await reviewStatus.evaluate((element) => element.textContent.trim()),
      "Legacy manifest awaiting review.",
      "the compatibility decision starts pending",
    );
    assertEqual(
      await approveManifest.isEnabled(),
      false,
      "approval is unavailable before a real review",
    );

    await observedAction(page, reviewManifest, "click");
    assertEqual(
      await compatibilitySurface.getAttribute("data-compatibility-state"),
      "reviewed",
      "the trusted pointer review updates the compatibility state",
    );
    assertEqual(
      await compatibilitySurface.getAttribute("data-review-input"),
      "pointer",
      "the review records its real pointer activation",
    );
    assertEqual(
      await reviewStatus.textContent(),
      "Legacy manifest SUP-208 reviewed; approval is now available.",
      "the pointer review exposes a visible result",
    );
    assertEqual(
      await approveManifest.isEnabled(),
      true,
      "the pointer review enables the modern approval control",
    );

    await observedPageKey(
      page,
      'button "Approve supplier manifest"',
      "Tab",
    );
    assertEqual(
      await approveManifest.evaluate(
        (element) => document.activeElement === element,
      ),
      true,
      "Tab moves naturally from Review to the enabled Approve control",
    );
    await observedPageKey(
      page,
      'button "Approve supplier manifest"',
      "Enter",
    );
    assertEqual(
      await compatibilitySurface.getAttribute("data-compatibility-state"),
      "approved",
      "the trusted keyboard approval updates the compatibility state",
    );
    assertEqual(
      await compatibilitySurface.getAttribute("data-approval-input"),
      "keyboard",
      "the approval records its real keyboard activation",
    );
    assertEqual(
      await reviewStatus.textContent(),
      "Legacy manifest SUP-208 approved for the Shanghai compatibility queue.",
      "the keyboard approval exposes the final visible result",
    );

    const directorySnapshot = await directory.ariaSnapshot({ ref: true });
    assertIncludes(
      directorySnapshot,
      'link "Open imported manifest line SUP-208"',
      "the scoped snapshot retains the directory business link",
    );
    assertIncludes(
      directorySnapshot,
      "- list [ref=",
      "the framework snapshot preserves Chromium's raw list root and an actionable ref",
    );
  `,
);
