import { scenarioCase } from "./scenario-case.mjs";

export const inlineSemanticsScenarioCase = scenarioCase(
  "inline-semantics",
  `
    const proof = page.locator(".inline-semantics-proof");
    const proofSnapshot = await proof.ariaSnapshot({ ref: true });
    assertIncludes(
      proofSnapshot,
      'link "Review terminology for CASE2026APACSINGAPORE00042"',
      "the structure tree exposes the terminology review link",
    );
    assertIncludes(
      proofSnapshot,
      'link "Open 上海 shàng hǎi pronunciation notes"',
      "the structure tree exposes the pronunciation review link",
    );
    assertIncludes(
      proofSnapshot,
      'button "Approve localized release" [disabled]',
      "the structure tree reports the gated release decision",
    );

    for (const tagName of [
      "a", "abbr", "b", "bdi", "bdo", "br", "cite", "code", "data",
      "dfn", "em", "i", "kbd", "mark", "q", "rp", "rt", "ruby", "s",
      "samp", "small", "span", "strong", "sub", "sup", "time", "u", "var",
      "wbr",
    ]) {
      assert(
        (await proof.locator(tagName).count()) > 0,
        "the rendered localization proof contains " + tagName,
      );
    }

    const inlineFacts = await proof.evaluate((root) => {
      const inspect = (selector) => {
        const element = root.querySelector(selector);
        const style = getComputedStyle(element);
        const parentStyle = getComputedStyle(element.parentElement);
        const rects = Array.from(element.getClientRects(), (rect) => ({
          height: rect.height,
          top: rect.top,
          width: rect.width,
        }));
        return {
          childElementCount: element.childElementCount,
          dataCaseToken: element.getAttribute("data-case-token"),
          dir: element.getAttribute("dir"),
          display: style.display,
          fontFamily: style.fontFamily,
          fontSize: Number.parseFloat(style.fontSize),
          fontStyle: style.fontStyle,
          fontWeight: Number.parseFloat(style.fontWeight),
          isConnected: element.isConnected,
          lang: element.getAttribute("lang"),
          parentBackgroundColor: parentStyle.backgroundColor,
          parentFontFamily: parentStyle.fontFamily,
          parentFontSize: Number.parseFloat(parentStyle.fontSize),
          parentFontStyle: parentStyle.fontStyle,
          parentFontWeight: Number.parseFloat(parentStyle.fontWeight),
          rects,
          tagName: element.tagName,
          text: element.textContent.trim(),
          textDecorationLine: style.textDecorationLine,
          textDecorationStyle: style.textDecorationStyle,
          unicodeBidi: style.unicodeBidi,
          backgroundColor: style.backgroundColor,
          direction: style.direction,
          wbrCount: element.querySelectorAll("wbr").length,
        };
      };
      const selectors = [
        "b", "bdi", "br", "cite", "code", "em", "i", "kbd", "mark",
        "rp", "s", "samp", "small", "span", "strong", "sub", "sup", "u",
        "var",
      ];
      const elements = Object.fromEntries(
        selectors.map((selector) => [selector, inspect(selector)]),
      );
      const followsDocumentOrder = (items) =>
        items.every(
          (element, index) =>
            index === 0 ||
            Boolean(
              items[index - 1].compareDocumentPosition(element) &
                Node.DOCUMENT_POSITION_FOLLOWING,
            ),
        );
      const lineBreak = root.querySelector("br");
      const breakRect = lineBreak.getClientRects()[0];
      const followingTextRange = document.createRange();
      followingTextRange.selectNodeContents(lineBreak.nextSibling);
      const followingTextRect = Array.from(
        followingTextRange.getClientRects(),
      ).find((rect) => rect.width > 0 && rect.height > 0);
      const metricVariableRect = root
        .querySelector("var")
        .getClientRects()[0];
      const subscriptRect = root.querySelector("sub").getClientRects()[0];
      const superscriptRect = root.querySelector("sup").getClientRects()[0];
      return {
        elements,
        keyLabels: Array.from(root.querySelectorAll("kbd"), (element) => ({
          hasVisibleRect: Array.from(element.getClientRects()).some(
            (rect) => rect.width > 0 && rect.height > 0,
          ),
          tagName: element.tagName,
          text: element.textContent,
        })),
        rubyFallbacks: Array.from(root.querySelectorAll("rp"), (element) => ({
          display: getComputedStyle(element).display,
          rectCount: element.getClientRects().length,
          tagName: element.tagName,
          text: element.textContent,
        })),
        lineBreak: {
          childElementCount: lineBreak.childElementCount,
          movesFollowingTextToNextLine:
            Boolean(breakRect && followingTextRect) &&
            followingTextRect.top > breakRect.top,
          hasLineHeight:
            Boolean(breakRect) && breakRect.width === 0 && breakRect.height > 0,
        },
        order: {
          emphasis: followsDocumentOrder([
            root.querySelector("em"),
            root.querySelector("b"),
            root.querySelector("mark"),
          ]),
          source: followsDocumentOrder([
            root.querySelector("i"),
            root.querySelector("q"),
            root.querySelector("cite"),
          ]),
          revision: followsDocumentOrder([
            root.querySelector("s"),
            root.querySelector("u"),
            root.querySelector(".copy-note"),
          ]),
          operator: followsDocumentOrder([
            ...root.querySelectorAll("kbd"),
            root.querySelector("samp"),
          ]),
          metric: followsDocumentOrder([
            root.querySelector("var"),
            root.querySelector("sub"),
            root.querySelector("sup"),
            lineBreak,
          ]),
        },
        metricGeometry: {
          subscriptIsLower:
            Boolean(metricVariableRect && subscriptRect) &&
            subscriptRect.top > metricVariableRect.top,
          superscriptIsHigher:
            Boolean(metricVariableRect && superscriptRect) &&
            superscriptRect.top < metricVariableRect.top,
        },
      };
    });

    for (const [selector, expectedTagName, expectedText] of [
      ["b", "B", "no checkout interruption"],
      ["bdi", "BDI", "ليلى"],
      ["br", "BR", ""],
      ["cite", "CITE", "Northstar voice guide"],
      ["code", "CODE", "northstar.release.apac.2_4"],
      ["em", "EM", "reversible throughout that window"],
      ["i", "I", "kampong spirit"],
      ["kbd", "KBD", "⌘"],
      ["mark", "MARK", "zero-downtime"],
      ["rp", "RP", "("],
      ["s", "S", "instant global rollout"],
      ["samp", "SAMP", "Localization proof ready"],
      ["small", "SMALL", "Copy deck REL-2.4-SG · review due 18 August"],
      ["span", "SPAN", "CASE2026APACSINGAPORE00042"],
      ["strong", "STRONG", "Northstar 2.4"],
      ["sub", "SUB", "p95"],
      ["sup", "SUP", "2"],
      ["u", "U", "phased regional rollout"],
      ["var", "VAR", "latency"],
    ]) {
      const fact = inlineFacts.elements[selector];
      assertEqual(
        fact.tagName,
        expectedTagName,
        selector + " remains its native DOM element rather than styled generic text",
      );
      assertEqual(
        fact.text,
        expectedText,
        selector + " retains its intended business copy",
      );
      assertEqual(
        fact.isConnected,
        true,
        selector + " participates in the live localization proof DOM",
      );
      if (selector !== "br" && selector !== "rp") {
        assert(
          fact.rects.some((rect) => rect.width > 0 && rect.height > 0),
          selector + " contributes visible inline geometry",
        );
      }
    }

    assertEqual(
      inlineFacts.keyLabels.map(({ tagName, text }) => tagName + ":" + text).join(","),
      "KBD:⌘,KBD:K",
      "both native keyboard tokens preserve their visible operator order",
    );
    assertEqual(
      inlineFacts.keyLabels.every(({ hasVisibleRect }) => hasVisibleRect),
      true,
      "both keyboard tokens have visible inline geometry",
    );
    assertEqual(
      inlineFacts.rubyFallbacks
        .map(({ tagName, text }) => tagName + ":" + text)
        .join(","),
      "RP:(,RP:)",
      "the ruby fallback punctuation remains in native DOM order",
    );
    assertEqual(
      inlineFacts.rubyFallbacks.every(
        ({ display, rectCount }) => display === "none" && rectCount === 0,
      ),
      true,
      "a ruby-capable browser hides fallback punctuation from visible layout",
    );
    assertEqual(
      inlineFacts.lineBreak.childElementCount,
      0,
      "the native line break remains an empty phrasing element",
    );
    assertEqual(
      inlineFacts.lineBreak.hasLineHeight,
      true,
      "the zero-width line break still contributes line-height geometry",
    );
    assertEqual(
      inlineFacts.lineBreak.movesFollowingTextToNextLine,
      true,
      "the operator warning visibly starts after the native line break",
    );
    for (const [orderName, follows] of Object.entries(inlineFacts.order)) {
      assertEqual(
        follows,
        true,
        "the composed " + orderName + " copy follows its authored DOM text order",
      );
    }
    assertEqual(
      inlineFacts.elements.i.lang,
      "en-SG",
      "the retained local phrase keeps its machine-readable language",
    );
    assertEqual(
      inlineFacts.elements.span.dataCaseToken,
      "release-case",
      "the case token keeps its stable machine identifier",
    );
    assertEqual(
      inlineFacts.elements.span.wbrCount,
      3,
      "the release case keeps three authored word-break opportunities",
    );
    assertEqual(
      inlineFacts.elements.code.wbrCount,
      2,
      "the release key keeps two authored word-break opportunities",
    );
    assertEqual(
      inlineFacts.elements.bdi.dir,
      null,
      "the bidirectional isolate relies on native auto direction instead of a forced dir",
    );
    assertEqual(
      inlineFacts.elements.bdi.unicodeBidi,
      "isolate",
      "the browser isolates the regional owner's bidirectional run",
    );
    assertEqual(
      inlineFacts.elements.bdi.direction,
      "rtl",
      "the browser derives right-to-left direction from the isolated Arabic name",
    );
    for (const selector of ["b", "strong"]) {
      assert(
        inlineFacts.elements[selector].fontWeight >
          inlineFacts.elements[selector].parentFontWeight,
        selector + " is visibly stronger than its surrounding copy",
      );
    }
    for (const selector of ["cite", "em", "i", "var"]) {
      assert(
        inlineFacts.elements[selector].fontStyle !==
          inlineFacts.elements[selector].parentFontStyle,
        selector + " has a distinct native emphasis style from its parent",
      );
    }
    for (const selector of ["code", "kbd", "samp"]) {
      assert(
        inlineFacts.elements[selector].fontFamily !==
          inlineFacts.elements[selector].parentFontFamily,
        selector + " uses a machine-copy type treatment distinct from prose",
      );
    }
    assert(
      inlineFacts.elements.mark.backgroundColor !==
        inlineFacts.elements.mark.parentBackgroundColor,
      "the marked zero-downtime promise is visibly highlighted against its parent",
    );
    assertIncludes(
      inlineFacts.elements.s.textDecorationLine,
      "line-through",
      "the obsolete rollout claim is visibly struck through",
    );
    assertIncludes(
      inlineFacts.elements.u.textDecorationLine,
      "underline",
      "the replacement rollout phrase remains visibly annotated",
    );
    assertEqual(
      inlineFacts.elements.u.textDecorationStyle,
      "wavy",
      "the legal-review annotation keeps its non-default underline style",
    );
    assert(
      inlineFacts.elements.small.fontSize <
        inlineFacts.elements.small.parentFontSize,
      "the copy-deck metadata is visibly subordinate to its surrounding header copy",
    );
    for (const selector of ["sub", "sup"]) {
      assert(
        inlineFacts.elements[selector].fontSize <
          inlineFacts.elements[selector].parentFontSize,
        selector + " uses smaller metric notation than the surrounding sentence",
      );
    }
    assertEqual(
      inlineFacts.metricGeometry.subscriptIsLower,
      true,
      "the p95 subscript is visibly lower than its metric variable",
    );
    assertEqual(
      inlineFacts.metricGeometry.superscriptIsHigher,
      true,
      "the exponent is visibly higher than its metric variable",
    );

    assertEqual(
      await proof.locator("time").getAttribute("datetime"),
      "2026-08-18T17:00:00+08:00",
      "the release deadline retains its machine-readable instant",
    );
    assertEqual(
      await proof.locator("data").getAttribute("value"),
      "REL-2.4-SG",
      "the copy deck retains its machine-readable release key",
    );
    assertEqual(
      await proof.locator("bdo").getAttribute("dir"),
      "rtl",
      "the verification token declares its intentional text direction",
    );
    assertEqual(
      await proof.locator("abbr").getAttribute("title"),
      "Singapore Standard Time",
      "the visible abbreviation exposes its expansion",
    );
    assertEqual(
      await proof.locator("q").getAttribute("cite"),
      "https://example.test/voice-guide",
      "the inline quotation retains its source URL",
    );
    assertEqual(
      await proof.locator("bdo").evaluate((element) => getComputedStyle(element).direction),
      "rtl",
      "the browser applies the declared right-to-left direction",
    );

    const approveRelease = proof.getByRole("button", {
      name: "Approve localized release",
      exact: true,
    });
    const reviewStatus = page.getByTestId("localization-review-status");
    assertEqual(
      await approveRelease.isEnabled(),
      false,
      "release approval is unavailable before both proof sections are visited",
    );

    const terminologyLink = proof.getByRole("link", {
      name: "Review terminology for CASE2026APACSINGAPORE00042",
      exact: true,
    });
    const caseTokenLineCount = await proof
      .locator('[data-case-token="release-case"]')
      .evaluate(
        (element) =>
          new Set(
            Array.from(element.getClientRects(), (rect) => Math.round(rect.top)),
          ).size,
      );
    assert(
      caseTokenLineCount > 1,
      "the long release case visibly wraps at its available word-break opportunities",
    );
    await observedAction(page, terminologyLink, "click");
    assertEqual(
      new URL(page.url()).hash,
      "#terminology",
      "pointer navigation records the terminology destination exactly",
    );
    assertEqual(
      await page.locator("#terminology").evaluate((element) => element === document.activeElement),
      true,
      "pointer fragment navigation focuses the terminology section",
    );
    await page
      .getByText("1 of 2 proof sections reviewed", { exact: true })
      .waitFor();
    assertEqual(
      await reviewStatus.textContent(),
      "1 of 2 proof sections reviewed",
      "the visible review status records the first visited section",
    );

    const pronunciationLink = proof.getByRole("link", {
      name: "Open 上海 shàng hǎi pronunciation notes",
      exact: true,
    });
    await observedFocusedKeyboard(page, pronunciationLink, "press", "Enter");
    assertEqual(
      new URL(page.url()).hash,
      "#pronunciation",
      "keyboard navigation records the pronunciation destination exactly",
    );
    assertEqual(
      await page.locator("#pronunciation").evaluate((element) => element === document.activeElement),
      true,
      "keyboard fragment navigation focuses the pronunciation section",
    );
    await page
      .getByText("2 of 2 proof sections reviewed", { exact: true })
      .waitFor();
    assertEqual(
      await reviewStatus.textContent(),
      "2 of 2 proof sections reviewed",
      "the visible review status records both visited sections",
    );
    assertEqual(
      await approveRelease.isEnabled(),
      true,
      "visiting both proof sections enables the release decision",
    );

    const rubyBox = await proof.locator("ruby").boundingBox();
    const annotationBox = await proof.locator("rt").first().boundingBox();
    assert(
      rubyBox && annotationBox && rubyBox.width > 0 && annotationBox.height > 0,
      "the browser visibly lays out the Chinese base text and pronunciation annotation",
    );

    const rubySnapshot = await proof.locator("ruby").ariaSnapshot({ ref: true });
    const rubyCdpSession = await task.context.newCDPSession(page);
    let rubyAx;
    let annotationAx;
    let fallbackAx;
    try {
      const documentNode = await rubyCdpSession.send("DOM.getDocument", {
        depth: 0,
      });
      const readNativeAx = async (selector) => {
        const node = await rubyCdpSession.send("DOM.querySelector", {
          nodeId: documentNode.root.nodeId,
          selector,
        });
        const describedNode = await rubyCdpSession.send("DOM.describeNode", {
          nodeId: node.nodeId,
        });
        const backendNodeId = describedNode.node.backendNodeId;
        const tree = await rubyCdpSession.send(
          "Accessibility.getPartialAXTree",
          {
            backendNodeId,
            fetchRelatives: false,
          },
        );
        return tree.nodes.find(
          (candidate) => candidate.backendDOMNodeId === backendNodeId,
        );
      };
      rubyAx = await readNativeAx(".inline-semantics-proof ruby");
      annotationAx = await readNativeAx(".inline-semantics-proof ruby rt");
      fallbackAx = await readNativeAx(".inline-semantics-proof ruby rp");
    } finally {
      await rubyCdpSession.detach();
    }
    assertEqual(
      rubyAx?.role?.value,
      "Ruby",
      "raw Chromium AX preserves the native ruby grouping role",
    );
    assertEqual(
      rubyAx?.name?.value,
      "",
      "raw Chromium AX leaves the ruby group unnamed and exposes its descendants",
    );
    assertEqual(
      annotationAx?.ignored,
      true,
      "raw Chromium AX folds the rendered annotation into the ruby presentation",
    );
    assertEqual(
      annotationAx?.role?.value,
      "none",
      "raw Chromium AX does not invent an interactive role for rt",
    );
    assertEqual(
      fallbackAx?.ignored,
      true,
      "raw Chromium AX ignores fallback punctuation when ruby is supported",
    );
    assert(
      fallbackAx?.ignoredReasons?.some(
        (reason) => reason.name === "notRendered",
      ),
      "raw Chromium AX identifies the hidden rp fallback as not rendered",
    );
    assertIncludes(
      rubySnapshot,
      "上海 shàng hǎi",
      "the framework snapshot preserves the visible composed ruby reading without requiring a ref",
    );

    await observedFocusedKeyboard(page, approveRelease, "press", "Enter");
    assertEqual(
      await reviewStatus.textContent(),
      "Localized release approved for the Singapore launch.",
      "keyboard approval produces the final visible release decision",
    );
    assertEqual(
      await approveRelease.isEnabled(),
      false,
      "the approved release cannot be submitted twice",
    );

    const abbreviation = proof.locator("abbr");
    const abbrSnapshot = await abbreviation.ariaSnapshot({ ref: true });
    const cdpSession = await task.context.newCDPSession(page);
    let abbreviationAx;
    try {
      const documentNode = await cdpSession.send("DOM.getDocument", {
        depth: 0,
      });
      const abbreviationNode = await cdpSession.send("DOM.querySelector", {
        nodeId: documentNode.root.nodeId,
        selector: ".inline-semantics-proof abbr",
      });
      const describedAbbreviation = await cdpSession.send("DOM.describeNode", {
        nodeId: abbreviationNode.nodeId,
      });
      const backendNodeId = describedAbbreviation.node.backendNodeId;
      const abbreviationTree = await cdpSession.send(
        "Accessibility.getPartialAXTree",
        {
          backendNodeId,
          fetchRelatives: false,
        },
      );
      abbreviationAx = abbreviationTree.nodes.find(
        (candidate) => candidate.backendDOMNodeId === backendNodeId,
      );
    } finally {
      await cdpSession.detach();
    }
    assertEqual(
      abbreviationAx?.role?.value,
      "Abbr",
      "Chromium exposes its internal abbreviation accessibility role",
    );
    assertEqual(
      abbreviationAx?.name?.value,
      "Singapore Standard Time",
      "Chromium exposes the title expansion in its internal accessibility tree",
    );
    const abbreviationRef = abbrSnapshot.match(/\\[ref=(s\\d+e\\d+)\\]/)?.[1];
    assert(
      abbreviationRef,
      "the scoped framework snapshot exposes a ref for the known abbreviation target",
    );
    assertEqual(
      await page
        .locator("aria-ref=" + abbreviationRef)
        .evaluate((element) => element.tagName),
      "ABBR",
      "the abbreviation ref resolves to the native abbreviation element",
    );
  `,
);
