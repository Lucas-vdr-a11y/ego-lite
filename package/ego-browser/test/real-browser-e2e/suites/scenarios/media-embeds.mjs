import { scenarioCase } from "./scenario-case.mjs";

export const mediaEmbedsScenarioCase = scenarioCase(
  "media-embeds",
  `
    await page.setViewportSize({ width: 720, height: 900 });
    const review = page.locator(".media-embeds-review");
    const mediaSnapshot = await review.ariaSnapshot({ ref: true });
    assertIncludes(
      mediaSnapshot,
      'img "APAC launch venue floor plan"',
      "the responsive venue plan is structurally observable",
    );
    assertIncludes(
      mediaSnapshot,
      'link "Review Singapore stage zone"',
      "the image map exposes the Singapore zone as a native link",
    );
    assertIncludes(
      mediaSnapshot,
      'link "Review Shanghai loading zone"',
      "the image map exposes the Shanghai zone as a native link",
    );
    assertIncludes(
      mediaSnapshot,
      'button "Approve venue media" [disabled]',
      "approval starts gated behind the evidence review",
    );

    const venuePlan = review.locator("[data-venue-plan]");
    await page.waitForFunction(() => {
      const image = document.querySelector("[data-venue-plan]");
      return (
        image?.currentSrc.endsWith(
          "/tests/media-embeds/floor-plan-compact.svg",
        ) &&
        image.complete &&
        image.naturalWidth > 0
      );
    }, undefined, { timeout: 10_000 });
    await page.waitForFunction(() => {
      const audio = document.querySelector("#dispatcher-audio");
      const video = document.querySelector("#loading-video");
      return (
        audio?.readyState >= 2 &&
        video?.readyState >= 2 &&
        video.textTracks?.[0]?.cues?.length > 0
      );
    }, undefined, { timeout: 10_000 });
    assertIncludes(
      await venuePlan.evaluate((image) => image.currentSrc),
      "/tests/media-embeds/floor-plan-compact.svg",
      "the picture element selects the compact source for the narrow viewport",
    );
    assertEqual(
      await review.locator("track").evaluate((track) => track.readyState),
      2,
      "the browser loads the authored WebVTT caption track",
    );
    const dispatcherDuration = await review
      .locator("#dispatcher-audio")
      .evaluate((audio) => audio.duration);
    assert(
      Number.isFinite(dispatcherDuration) && dispatcherDuration >= 1.5,
      "the dispatcher fixture is genuine timed audio, not a zero-duration media shell",
    );
    assertIncludes(
      await review
        .locator("video")
        .evaluate((video) => video.textTracks[0].cues[0].text),
      "Loading bay clear",
      "the loaded caption carries the visible operational evidence",
    );

    await observedBoxGesture(
      page,
      venuePlan,
      "Singapore image-map zone",
      async (pointer, box) => {
        await pointer.move(box.x + box.width * 0.25, box.y + box.height * 0.5);
        await pointer.down();
        await pointer.up();
      },
    );
    await page
      .getByText("1 of 2 venue zones reviewed", { exact: true })
      .waitFor();
    assertEqual(
      new URL(page.url()).hash,
      "#stage-zone",
      "a real pointer hit on the mapped image selects the Singapore stage zone",
    );

    const loadingArea = review.getByRole("link", {
      name: "Review Shanghai loading zone",
      exact: true,
    });
    await observedFocusedKeyboard(page, loadingArea, "press", "Enter");
    await page
      .getByText("2 of 2 venue zones reviewed", { exact: true })
      .waitFor();
    assertEqual(
      new URL(page.url()).hash,
      "#loading-zone",
      "the image-map ref activates the Shanghai zone with Enter",
    );
    assertEqual(
      await page
        .locator("#loading-zone")
        .evaluate((element) => element === document.activeElement),
      true,
      "keyboard image-map navigation moves focus to the reviewed zone",
    );

    const briefingAudio = review.locator("#dispatcher-audio");
    await observedBoxGesture(
      page,
      briefingAudio,
      "dispatcher audio play control",
      async (pointer, box) => {
        await pointer.move(box.x + 18, box.y + box.height * 0.5);
        await pointer.down();
        await pointer.up();
      },
    );
    const audioPointerState = await briefingAudio.evaluate((audio) => ({
      activeTag: document.activeElement?.tagName,
      paused: audio.paused,
      currentTime: audio.currentTime,
    }));
    assertEqual(
      audioPointerState.activeTag,
      "AUDIO",
      "the real pointer focuses the native audio control",
    );
    if (audioPointerState.paused) {
      await observedPageKey(page, "Audio briefing pending", "Space");
    }
    await page.waitForFunction(() => {
      const audio = document.querySelector("#dispatcher-audio");
      return audio && !audio.paused && audio.currentTime > 0;
    }, undefined, { timeout: 5_000 });
    await page
      .getByText("Audio briefing played", { exact: true })
      .waitFor();
    assertEqual(
      await briefingAudio.evaluate((audio) => audio === document.activeElement),
      true,
      "the native audio remains focused after real user activation",
    );
    const audioCurrentTime = await briefingAudio.evaluate(
      (audio) => audio.currentTime,
    );
    assert(
      audioCurrentTime > 0,
      "the dispatcher audio advances after user activation; Space is only the platform-control layout fallback",
    );
    await observedPageKey(page, "Audio briefing played", "Space");
    await page.waitForFunction(
      () => document.querySelector("#dispatcher-audio")?.paused === true,
      undefined,
      { timeout: 5_000 },
    );
    assertEqual(
      await briefingAudio.evaluate((audio) => audio.paused),
      true,
      "Space pauses the focused native audio control",
    );

    const briefingVideo = review.locator("#loading-video");
    await observedBoxGesture(
      page,
      briefingVideo,
      "loading bay video play control",
      async (pointer, box) => {
        await pointer.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
        await pointer.down();
        await pointer.up();
      },
    );
    const videoPointerState = await briefingVideo.evaluate((video) => ({
      activeTag: document.activeElement?.tagName,
      paused: video.paused,
    }));
    assertEqual(
      videoPointerState.activeTag,
      "VIDEO",
      "the real pointer focuses the native video control",
    );
    if (videoPointerState.paused) {
      await observedPageKey(page, "Video briefing pending", "Space");
    }
    await page.waitForFunction(() => {
      const video = document.querySelector("#loading-video");
      return video && !video.paused && video.currentTime > 0;
    }, undefined, { timeout: 5_000 });
    await page
      .getByText("Video briefing played", { exact: true })
      .waitFor();
    assertEqual(
      await briefingVideo.evaluate((video) => video === document.activeElement),
      true,
      "the native video remains focused after real user activation",
    );
    const videoCurrentTime = await briefingVideo.evaluate(
      (video) => video.currentTime,
    );
    assert(
      videoCurrentTime > 0,
      "the loading bay video advances after user activation; Space is only the platform-control layout fallback",
    );
    await observedPageKey(page, "Video briefing played", "Space");
    await page.waitForFunction(
      () => document.querySelector("#loading-video")?.paused === true,
      undefined,
      { timeout: 5_000 },
    );
    assertEqual(
      await briefingVideo.evaluate((video) => video.paused),
      true,
      "Space pauses the focused native video control",
    );

    const safetyFrameElement = review.locator('iframe[title="Safety checklist"]');
    const safetyFrame = safetyFrameElement.contentFrame();
    const frameChecklist = safetyFrame.getByRole("button", {
      name: "Confirm safety checklist",
      exact: true,
    });
    await frameChecklist.waitFor({ timeout: 10_000 });
    await observedAction(safetyFrame, frameChecklist, "click");
    await page
      .getByText("1 of 3 documents confirmed", { exact: true })
      .waitFor();

    const customsFrame = page
      .frames()
      .find((frame) => frame.name() === "customs-receipt");
    assert(customsFrame, "the object element attaches its customs document frame");
    const customsButton = customsFrame.getByRole("button", {
      name: "Confirm customs receipt",
      exact: true,
    });
    await customsButton.waitFor({ timeout: 10_000 });
    await observedAction(customsFrame, customsButton, "click");
    await page
      .getByText("2 of 3 documents confirmed", { exact: true })
      .waitFor();

    const insuranceFrame = page
      .frames()
      .find((frame) => frame.name() === "insurance-certificate");
    assert(insuranceFrame, "the embed element attaches its insurance document frame");
    const insuranceButton = insuranceFrame.getByRole("button", {
      name: "Confirm insurance certificate",
      exact: true,
    });
    await insuranceButton.waitFor({ timeout: 10_000 });
    await observedAction(insuranceFrame, insuranceButton, "click");
    await page
      .getByText("3 of 3 documents confirmed", { exact: true })
      .waitFor();

    const approveMedia = review.getByRole("button", {
      name: "Approve venue media",
      exact: true,
    });
    assertEqual(
      await approveMedia.isEnabled(),
      true,
      "all real evidence actions enable the venue decision",
    );
    await observedFocusedKeyboard(page, approveMedia, "press", "Enter");
    assertEqual(
      await page.getByTestId("media-review-status").textContent(),
      "Venue media approved for the APAC launch.",
      "keyboard approval produces the final visible venue decision",
    );
    assertEqual(
      await approveMedia.isEnabled(),
      false,
      "the approved evidence set cannot be submitted twice",
    );

    const semanticHosts = [
      {
        selector: "#dispatcher-audio",
        role: "Audio",
        name: "Dispatcher audio note",
      },
      {
        selector: "#loading-video",
        role: "Video",
        name: "Loading bay camera",
      },
      {
        selector: '.embedded-evidence iframe[title="Safety checklist"]',
        role: "Iframe",
        name: "Safety checklist",
      },
      {
        selector: '.embedded-evidence object[title="Customs receipt"]',
        role: "PluginObject",
        name: "Customs receipt",
      },
      {
        selector: '.embedded-evidence embed[title="Insurance certificate"]',
        role: "EmbeddedObject",
        name: "Insurance certificate",
      },
      {
        selector: '.embedded-evidence fencedframe[title="Privacy-safe regional offer"]',
        role: "Iframe",
        name: "Privacy-safe regional offer",
      },
    ];
    const cdpSession = await task.context.newCDPSession(page);
    const missingSnapshotSemantics = [];
    try {
      const documentNode = await cdpSession.send("DOM.getDocument", {
        depth: 0,
      });
      for (const host of semanticHosts) {
        const hostNode = await cdpSession.send("DOM.querySelector", {
          nodeId: documentNode.root.nodeId,
          selector: host.selector,
        });
        const describedHost = await cdpSession.send("DOM.describeNode", {
          nodeId: hostNode.nodeId,
        });
        const backendNodeId = describedHost.node.backendNodeId;
        const hostTree = await cdpSession.send(
          "Accessibility.getPartialAXTree",
          { backendNodeId, fetchRelatives: false },
        );
        const rawHost = hostTree.nodes.find(
          (candidate) => candidate.backendDOMNodeId === backendNodeId,
        );
        assertEqual(
          rawHost?.role?.value,
          host.role,
          "Chromium exposes the native " + host.name + " role",
        );
        assertEqual(
          rawHost?.name?.value,
          host.name,
          "Chromium exposes the authored " + host.name + " name",
        );

        const hostSnapshot = await page
          .locator(host.selector)
          .ariaSnapshot({ ref: true });
        if (
          !hostSnapshot.includes(host.name) ||
          !/\\[ref=s\\d+e\\d+\\]/.test(hostSnapshot)
        ) {
          missingSnapshotSemantics.push(
            host.name + ": " + JSON.stringify(hostSnapshot),
          );
        }
      }
    } finally {
      await cdpSession.detach();
    }
    assert(
      missingSnapshotSemantics.length === 0,
      "the framework snapshot preserves Chromium's named media and embed hosts: " +
        missingSnapshotSemantics.join("; "),
    );
  `,
);
