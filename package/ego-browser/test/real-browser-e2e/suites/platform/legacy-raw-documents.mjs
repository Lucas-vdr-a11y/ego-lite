export const legacyFramesetTargetNavigationCase = {
  name: "Legacy frameset target navigation",
  kind: "platform",
  body() {
    return `
      const task = await openE2eTaskSpace(
        taskName + " legacy frameset target navigation",
      );
      const page = task.page;
      page.setDefaultTimeout(10_000);
      await page.goto(baseUrl + "/tests/legacy-elements/frameset", {
        waitUntil: "load",
        timeout: 20_000,
      });
      // A frameset top document has no contentful content of its own, so
      // Chromium withholds input until its paint-holding deadline expires.
      // Clicking before then is silently discarded. See the helper's comment.
      assertEqual(
        await waitForFirstCompositorFrame(page),
        true,
        "the frameset page reaches its first compositor frame before input is dispatched",
      );

      assertEqual(
        await page.locator("body").count(),
        0,
        "the raw frameset document does not synthesize a body element",
      );
      assertEqual(
        await page.locator("frameset").count(),
        1,
        "the top-level raw document retains its authored frameset",
      );
      const frameOwners = page.locator("frame");
      assertEqual(
        await frameOwners.count(),
        2,
        "the frameset exposes two native frame owner elements",
      );
      for (let index = 0; index < 2; index += 1) {
        const ownerBounds = await frameOwners.nth(index).boundingBox();
        assert(
          ownerBounds && ownerBounds.width > 0 && ownerBounds.height > 0,
          "native frame owner " + (index + 1) + " has non-zero geometry",
        );
      }
      const noframes = page.locator("noframes");
      assertEqual(
        await noframes.count(),
        1,
        "the raw frameset retains its authored noframes fallback",
      );
      assertEqual(
        await noframes.isVisible(),
        false,
        "frame-capable Chromium legally keeps noframes fallback hidden",
      );

      const navigationFrame = page.frame({ name: "release-navigation" });
      let detailFrame = page.frame({ name: "release-detail" });
      assert(
        navigationFrame && detailFrame,
        "both native frame browsing contexts are attached",
      );
      async function attemptFrameTargetNavigation(
        link,
        expectedUrl,
        activate = () => link.click({ timeout: 5_000 }),
      ) {
        await link.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          // Keep the record on the top frameset document: the last activation
          // replaces the very document that owns the link, so anything stored
          // locally would be gone before it could be read back.
          const record = {
            events: [],
            href: element.href,
            target: element.target,
            sourceName: globalThis.name,
            topFrameNames: Array.from(globalThis.top.frames, (frame) => frame.name),
            targetResolved: Boolean(globalThis.top.frames[element.target]),
            localHitTarget: document
              .elementFromPoint(
                rect.left + rect.width / 2,
                rect.top + rect.height / 2,
              )
              ?.textContent?.trim(),
          };
          globalThis.top.__egoFrameTargetClick = record;
          for (const type of ["pointerdown", "mousedown", "mouseup", "click"]) {
            document.addEventListener(
              type,
              (event) => {
                record.events.push({
                  type,
                  target: event.target?.textContent?.trim() || event.target?.tagName,
                  clientX: event.clientX,
                  clientY: event.clientY,
                  trusted: event.isTrusted,
                  defaultPrevented: event.defaultPrevented,
                });
              },
              { capture: true, once: true },
            );
          }
        });
        const settle = (promise) =>
          promise.then(
            (value) => ({ ok: true, value }),
            (error) => ({ ok: false, error: error?.message || String(error) }),
          );
        const requestResultPromise = settle(
          page.waitForRequest(
            (request) => expectedUrl(new URL(request.url())),
            { timeout: 5_000 },
          ),
        );
        const responseResultPromise = settle(
          page.waitForResponse(
            (response) => expectedUrl(new URL(response.url())),
            { timeout: 5_000 },
          ),
        );
        const eventResultPromise = settle(
          page.waitForEvent("framenavigated", {
            predicate: (frame) => expectedUrl(new URL(frame.url())),
            timeout: 5_000,
          }),
        );
        const clickResultPromise = settle(activate());
        const [clickResult, requestResult, responseResult, eventResult] =
          await Promise.all([
            clickResultPromise,
            requestResultPromise,
            responseResultPromise,
            eventResultPromise,
        ]);
        const currentDetail = page.frame({ name: "release-detail" });
        // framenavigated fires at commit, so the replacement document can still
        // be parsing here. Locator counts do not auto-wait, so settle the frame
        // before the caller inspects it.
        await currentDetail.waitForLoadState("domcontentloaded");
        const clickContext = await page.mainFrame().evaluate(
          () => globalThis.__egoFrameTargetClick,
        );
        const navigationEvidence = {
          commandResolved: clickResult.ok,
          trustedActivation: clickContext.events.some(
            (event) => event.type === "click" && event.trusted,
          ),
          request: requestResult.ok,
          response:
            responseResult.ok && responseResult.value.status() === 200,
          commit: expectedUrl(new URL(currentDetail.url())),
          event: eventResult.ok,
        };
        const navigationErrors = {
          activation: clickResult.error,
          request: requestResult.error,
          response: responseResult.error,
          event: eventResult.error,
          clickContext,
          // The final activation replaces the link's own document, so this is
          // diagnostic-only and must never become a second source of timeouts.
          linkBounds: await link
            .boundingBox({ timeout: 1_000 })
            .catch(() => null),
          navigationOwnerBounds: await page
            .locator('frame[name="release-navigation"]')
            .boundingBox(),
        };
        assertEqual(
          JSON.stringify(navigationEvidence),
          JSON.stringify({
            commandResolved: true,
            trustedActivation: true,
            request: true,
            response: true,
            commit: true,
            event: true,
          }),
          "legacy frame-targeted navigation delivers trusted activation, request, response, target-frame commit, and event delivery" +
            " (evidence=" + JSON.stringify(navigationEvidence) +
            ", errors=" + JSON.stringify(navigationErrors) + ")",
        );
        return currentDetail;
      }

      const navigationSnapshot = await navigationFrame
        .locator("body")
        .ariaSnapshot({ ref: true });
      assertIncludes(
        navigationSnapshot,
        'link "Release manifest"',
        "the navigation frame exposes its real manifest link",
      );

      const releaseManifestLink = navigationFrame.getByRole("link", {
        name: "Release manifest",
      });
      await egoBrowser.showTaskState("open release manifest");
      detailFrame = await attemptFrameTargetNavigation(
        releaseManifestLink,
        (url) =>
          url.pathname.endsWith("/tests/legacy-elements/frameset/manifest") &&
          !url.searchParams.has("decision"),
      );
      assertEqual(
        await detailFrame
          .getByRole("heading", { name: "Release manifest" })
          .count(),
        1,
        "the real frame-targeted link replaces only the detail frame",
      );
      assertEqual(
        await detailFrame.getByText("Approval pending", { exact: true }).count(),
        1,
        "the manifest initially reports a pending approval",
      );

      const waitingApprovalsLink = navigationFrame.getByRole("link", {
        name: "Waiting approvals",
      });
      await egoBrowser.showTaskState("open waiting approvals");
      detailFrame = await attemptFrameTargetNavigation(
        waitingApprovalsLink,
        (url) =>
          url.pathname.endsWith("/tests/legacy-elements/frameset/waiting"),
      );
      const waitingSnapshot = await detailFrame
        .locator("body")
        .ariaSnapshot({ ref: true });
      assertIncludes(
        waitingSnapshot,
        'link "Review deployment notes"',
        "the waiting detail exposes its review entry point",
      );
      assertIncludes(
        waitingSnapshot,
        'link "Approve release CR-204"',
        "the waiting detail exposes its keyboard approval action",
      );

      const reviewNotes = detailFrame.getByRole("link", {
        name: "Review deployment notes",
      });
      await egoBrowser.showTaskState("focus deployment notes");
      await reviewNotes.click();
      // The review link is href="#deployment-notes" and that section is not
      // focusable, so the fragment navigation moves the sequential focus
      // navigation starting point onto the section and resets the document's
      // focus to its body. The link is therefore not left as activeElement -
      // what the click does prove is that it reached the detail frame.
      assertEqual(
        await detailFrame.evaluate(() => location.hash),
        "#deployment-notes",
        "a real mouse click follows the in-frame fragment link",
      );
      assertEqual(
        await detailFrame.evaluate(() => document.hasFocus()),
        true,
        "a real mouse click moves focus into the detail frame",
      );
      await page.keyboard.press("Tab");
      assertEqual(
        await reviewNotes.evaluate(
          (element) => element.ownerDocument.activeElement === element,
        ),
        true,
        "Tab from the fragment target reaches the review link",
      );
      await page.keyboard.press("Tab");
      const approveRelease = detailFrame.getByRole("link", {
        name: "Approve release CR-204",
      });
      assertEqual(
        await approveRelease.evaluate(
          (element) => element.ownerDocument.activeElement === element,
        ),
        true,
        "Tab advances from review notes to the native approval link",
      );
      detailFrame = await attemptFrameTargetNavigation(
        approveRelease,
        (url) =>
          url.pathname.endsWith("/tests/legacy-elements/frameset/manifest") &&
          url.searchParams.get("decision") === "approved",
        () => page.keyboard.press("Enter"),
      );
      assertEqual(
        await detailFrame
          .getByText("Release CR-204 approved", { exact: true })
          .count(),
        1,
        "Enter follows the focused approval link and exposes the approved result",
      );
    `;
  },
};

export const legacyFrameOwnerAriaSnapshotCase = {
  name: "Legacy frame owner ARIA snapshot refs",
  kind: "platform",
  body() {
    return `
      const task = await openE2eTaskSpace(
        taskName + " legacy frame owner snapshot",
      );
      const page = task.page;
      page.setDefaultTimeout(10_000);
      await page.goto(baseUrl + "/tests/legacy-elements/frameset", {
        waitUntil: "load",
        timeout: 20_000,
      });

      const frameOwner = page.locator('frame[name="release-detail"]');
      assertEqual(
        await frameOwner.count(),
        1,
        "the independent raw document exposes its detail frame owner",
      );
      const ownerBounds = await frameOwner.boundingBox();
      assert(
        ownerBounds && ownerBounds.width > 0 && ownerBounds.height > 0,
        "the detail frame owner has non-zero user-visible geometry",
      );

      const cdpSession = await page.context().newCDPSession(page);
      try {
        const documentTree = await cdpSession.send("DOM.getDocument", {
          depth: 0,
        });
        const frameOwnerQuery = await cdpSession.send("DOM.querySelector", {
          nodeId: documentTree.root.nodeId,
          selector: 'frame[name="release-detail"]',
        });
        assert(
          frameOwnerQuery.nodeId > 0,
          "CDP resolves the authored detail frame owner",
        );
        const description = await cdpSession.send("DOM.describeNode", {
          nodeId: frameOwnerQuery.nodeId,
        });
        const backendNodeId = description.node.backendNodeId;
        const partialAxTree = await cdpSession.send(
          "Accessibility.getPartialAXTree",
          { backendNodeId, fetchRelatives: false },
        );
        const rawFrameOwner = partialAxTree.nodes.find(
          (node) => node.backendDOMNodeId === backendNodeId,
        );
        assertEqual(
          rawFrameOwner?.role?.value,
          "Iframe",
          "raw Chromium AX exposes the detail frame owner as an Iframe",
        );
        assertEqual(
          rawFrameOwner?.name?.value,
          "Release detail workspace",
          "raw Chromium AX preserves the authored frame title",
        );
        assertEqual(
          rawFrameOwner?.ignored,
          false,
          "raw Chromium AX does not ignore the visible detail frame owner",
        );
      } finally {
        await cdpSession.detach();
      }

      function ariaRefFor(snapshot, accessibleName) {
        const line = String(snapshot)
          .split("\\n")
          .find((candidate) =>
            candidate.includes('"' + accessibleName + '"'),
          );
        return line?.match(/\\[ref=(s\\d+e\\d+)\\]/)?.[1] ?? null;
      }

      const frameOwnerSnapshot = await frameOwner.ariaSnapshot({ ref: true });
      const frameOwnerNamePresent = frameOwnerSnapshot.includes(
        "Release detail workspace",
      );
      const frameOwnerRef = ariaRefFor(
        frameOwnerSnapshot,
        "Release detail workspace",
      );
      const frameOwnerRefCount = frameOwnerRef
        ? await page.locator("aria-ref=" + frameOwnerRef).count()
        : 0;

      assert(
        frameOwnerNamePresent && frameOwnerRefCount === 1,
        "the frame owner snapshot preserves its title and exposes an actionable ref" +
          " (snapshot=" + JSON.stringify(frameOwnerSnapshot) + ")",
      );
    `;
  },
};

export const legacyPlaintextRawParsingCase = {
  name: "Legacy plaintext raw parsing",
  kind: "platform",
  body() {
    return `
      const task = await openE2eTaskSpace(
        taskName + " legacy plaintext parsing",
      );
      const page = task.page;
      page.setDefaultTimeout(10_000);
      const response = await page.goto(
        baseUrl + "/tests/legacy-elements/plaintext",
        { waitUntil: "load", timeout: 20_000 },
      );
      assertEqual(response?.status(), 200, "the raw plaintext document loads");

      const plaintextSnapshot = await page
        .locator("body")
        .ariaSnapshot({ ref: true });
      assertIncludes(
        plaintextSnapshot,
        'button "Mark transcript checked"',
        "the modern check action remains interactive before plaintext mode",
      );
      assertIncludes(
        plaintextSnapshot,
        "Awaiting release reviewer check",
        "the raw document exposes its initial review state",
      );

      await egoBrowser.showTaskState("mark transcript checked");
      await Promise.all([
        page.waitForURL(
          (url) =>
            url.pathname.endsWith("/tests/legacy-elements/plaintext") &&
            url.searchParams.get("checked") === "release-review",
        ),
        page
          .getByRole("button", { name: "Mark transcript checked" })
          .click(),
      ]);
      assertEqual(
        await page
          .getByText("Transcript checked by release reviewer", { exact: true })
          .count(),
        1,
        "the real GET form submission updates the server-rendered review state",
      );

      const plaintextParserState = await page.evaluate(() => {
        const plaintext = document.querySelector("plaintext");
        const status = document.querySelector("#transcript-status");
        return {
          plaintextCount: document.querySelectorAll("plaintext").length,
          plaintextText: plaintext?.textContent || "",
          buttonCount: document.querySelectorAll("button").length,
          fakeButtonCount: document.querySelectorAll(
            "#plaintext-fake-action",
          ).length,
          fakeSectionCount: document.querySelectorAll(
            "#plaintext-fake-section",
          ).length,
          statusPrecedesPlaintext:
            Boolean(status && plaintext) &&
            Boolean(
              status.compareDocumentPosition(plaintext) &
                Node.DOCUMENT_POSITION_FOLLOWING,
            ),
        };
      });
      assertEqual(
        plaintextParserState.plaintextCount,
        1,
        "Chromium retains the authored plaintext element",
      );
      assertEqual(
        plaintextParserState.buttonCount,
        1,
        "only the live button before plaintext mode becomes an element",
      );
      assertEqual(
        plaintextParserState.fakeButtonCount,
        0,
        "button markup after plaintext mode is not parsed as an element",
      );
      assertEqual(
        plaintextParserState.fakeSectionCount,
        0,
        "section markup after plaintext mode is not parsed as an element",
      );
      assertIncludes(
        plaintextParserState.plaintextText,
        '<button id="plaintext-fake-action">Delete transcript</button>',
        "plaintext preserves subsequent button markup as literal transcript text",
      );
      assertIncludes(
        plaintextParserState.plaintextText,
        '<section id="plaintext-fake-section">This remains transcript text.</section>',
        "plaintext preserves subsequent section markup as literal transcript text",
      );
      assertEqual(
        plaintextParserState.statusPrecedesPlaintext,
        true,
        "the checked state remains authored before plaintext parser mode begins",
      );
    `;
  },
};
