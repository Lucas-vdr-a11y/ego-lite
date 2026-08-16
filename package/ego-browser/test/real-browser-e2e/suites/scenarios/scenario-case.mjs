import { TEST_CASES } from "../../site/test-cases.mjs";

const secondLaneCases = new Set([
  "hover",
  "drag-drop",
  "canvas",
  "uploads",
  "scroll",
  "navigation",
  "collaborative-docs",
  "rich-text",
]);

export function scenarioCase(slug, body, options = {}) {
  const testCase = TEST_CASES.find((candidate) => candidate.slug === slug);
  if (!testCase) throw new Error(`Unknown web test route: ${slug}`);
  return {
    name: `web test: ${slug}`,
    kind: "scenario",
    route: testCase.route,
    parallelLane: secondLaneCases.has(slug) ? 1 : 0,
    ...options,
    body: () => `
      const task = await openE2eTaskSpace(taskName);
      const page = task.page;
      await page.goto(baseUrl + ${JSON.stringify(testCase.route)}, {
        waitUntil: "load",
        timeout: 20_000,
      });
      assertIncludes(page.url(), ${JSON.stringify(testCase.route)}, ${JSON.stringify(`${slug} route is loaded`)});
      assertEqual(await page.locator(".surface").isVisible(), true, ${JSON.stringify(`${slug} operation surface is visibly rendered`)});
      const appHeader = page.getByTestId("app-header");
      assertEqual(await appHeader.isVisible(), true, ${JSON.stringify(`${slug} keeps the shared app header visible`)});
      assertEqual(await page.getByTestId("test-progress-summary").isVisible(), true, ${JSON.stringify(`${slug} keeps overall test progress visible`)});
      assertIncludes(await appHeader.getAttribute("class"), "sticky-top", ${JSON.stringify(`${slug} app header remains sticky while the scenario scrolls`)});
      assertEqual(await appHeader.getByTestId("scenario-test-controls").count(), 0, ${JSON.stringify(`${slug} keeps scenario actions out of the global header`)});
      assertEqual(await appHeader.locator("[data-progress-dot]").count(), ${TEST_CASES.length}, ${JSON.stringify(`${slug} renders one aggregate progress dot per scenario`)});
      const scenarioControls = page.getByTestId("scenario-test-controls");
      assertEqual(await scenarioControls.isVisible(), true, ${JSON.stringify(`${slug} exposes lifecycle controls in its own page header`)});
      const currentProgressDot = appHeader.locator(${JSON.stringify(`[data-progress-dot][data-progress-slug="${slug}"]`)});

      async function snapshotTarget(scope, targetOrRole, accessibleName) {
        const targetDescription =
          typeof targetOrRole === "string"
            ? undefined
            : (await targetOrRole.ariaSnapshot())
                .split("\\n")
                .find((candidate) => candidate.trim());
        const snapshot = await scope.locator("body").ariaSnapshot({ ref: true });
        const line = snapshot
          .split("\\n")
          .find((candidate) => {
            if (!candidate.includes("[ref=")) return false;
            if (typeof targetOrRole !== "string") {
              return (
                candidate.replace(/ \\[ref=s\\d+e\\d+\\]/, "").trim() ===
                targetDescription?.trim()
              );
            }
            return (
              candidate.trimStart().startsWith("- " + targetOrRole) &&
              (!accessibleName || candidate.includes('"' + accessibleName + '"'))
            );
          });
        let match = line?.match(/\\[ref=(s\\d+e\\d+)\\]/);
        let scopedSnapshot;
        if (
          !match &&
          typeof targetOrRole !== "string" &&
          targetDescription?.trimStart().startsWith("- generic")
        ) {
          scopedSnapshot = await targetOrRole.ariaSnapshot({ ref: true });
          match = scopedSnapshot.match(/\\[ref=(s\\d+e\\d+)\\]/);
        }
        assert(
          match,
          "the observed structure exposes " +
            (accessibleName ||
              (typeof targetOrRole === "string"
                ? targetOrRole
                : targetDescription || "target")) +
            ":\\n" +
            (scopedSnapshot || snapshot),
        );
        return {
          content: snapshot,
          locator: scope.locator("aria-ref=" + match[1]),
        };
      }

      async function observedAction(scope, target, action, ...args) {
        const observed = await snapshotTarget(scope, target);
        switch (action) {
          case "click": return args.length
            ? observed.locator.click(args[0])
            : observed.locator.click();
          case "dblclick": return observed.locator.dblclick(...args);
          case "fill": return observed.locator.fill(...args);
          case "check": return observed.locator.check(...args);
          case "uncheck": return observed.locator.uncheck(...args);
          case "press": return observed.locator.press(...args);
          case "selectOption": return observed.locator.selectOption(...args);
          case "setInputFiles": return observed.locator.setInputFiles(...args);
          case "hover": return observed.locator.hover(...args);
          case "focus": return observed.locator.focus();
          default: throw new Error("unsupported observed action: " + action);
        }
      }

      async function observedRoleAction(
        scope,
        role,
        accessibleName,
        action,
        ...args
      ) {
        const observed = await snapshotTarget(scope, role, accessibleName);
        return observed.locator[action](...args);
      }

      async function observedFocusedKeyboard(scope, target, action, ...args) {
        const observed = await snapshotTarget(scope, target);
        await observed.locator.focus();
        switch (action) {
          case "press": return scope.keyboard.press(...args);
          case "insertText": return scope.keyboard.insertText(...args);
          case "type": return scope.keyboard.type(...args);
          default: throw new Error("unsupported observed keyboard action: " + action);
        }
      }

      async function observedCurrentKeyboard(
        scope,
        expectedContent,
        action,
        ...args
      ) {
        const snapshot = await scope.locator("body").ariaSnapshot({ ref: true });
        assertIncludes(snapshot, expectedContent, "the structure tree establishes keyboard context");
        switch (action) {
          case "press": return scope.keyboard.press(...args);
          case "insertText": return scope.keyboard.insertText(...args);
          case "type": return scope.keyboard.type(...args);
          default: throw new Error("unsupported current-focus keyboard action: " + action);
        }
      }

      async function observedPageKey(scope, expectedContent, key) {
        return observedCurrentKeyboard(scope, expectedContent, "press", key);
      }

      async function observedScreenshot(scope, label) {
        const image = await scope.screenshot({
          animations: "disabled",
          scale: "css",
          timeout: 60_000,
        });
        assert(image.length > 0, label + " screenshot contains image bytes");
        return image;
      }

      async function observedGesture(scope, label, action) {
        await observedScreenshot(scope, label);
        const pointer = {
          move: (...args) => scope.mouse.move(...args),
          down: (...args) => scope.mouse.down(...args),
          up: (...args) => scope.mouse.up(...args),
          wheel: (...args) => scope.mouse.wheel(...args),
        };
        return action(pointer);
      }

      async function observedBoxGesture(scope, target, label, action) {
        assertEqual(await target.isVisible(), true, label + " target is visible");
        await target.scrollIntoViewIfNeeded();
        const box = await target.boundingBox();
        assert(
          box && box.width > 0 && box.height > 0,
          label + " target has visible pointer geometry",
        );
        const pointer = {
          move: (...args) => scope.mouse.move(...args),
          down: (...args) => scope.mouse.down(...args),
          up: (...args) => scope.mouse.up(...args),
          wheel: (...args) => scope.mouse.wheel(...args),
        };
        return action(pointer, box);
      }

      async function observedPixelClick(scope, label, point) {
        await observedScreenshot(scope, label);
        return scope.mouse.click(point.x, point.y);
      }

      async function observedDragTo(scope, source, target) {
        await observedScreenshot(scope, "drag-and-drop target context");
        return source.dragTo(target);
      }

      async function observedClosePage(targetPage, label) {
        if (targetPage.isClosed()) return;
        const snapshot = await targetPage.locator("body").ariaSnapshot({ ref: true });
        assert(snapshot.trim(), label + " exposes structure before close");
        try {
          await targetPage.close();
        } catch (error) {
          assertIncludes(
            error.message,
            "has been closed",
            label + " target-detached response reports the completed close",
          );
        }
        assertEqual(targetPage.isClosed(), true, label + " is closed");
      }

      const startSnapshot = await page.locator("body").ariaSnapshot({ ref: true });
      const startLine = startSnapshot
        .split("\\n")
        .find((candidate) => candidate.includes('button "Start test"'));
      const startMatch = startLine?.match(/\\[ref=(s\\d+e\\d+)\\]/);
      assert(startMatch, "the full-page structure exposes the lifecycle start ref");
      await page.locator("aria-ref=" + startMatch[1]).click();
      await page.locator('html[data-progress-sync="idle"]').waitFor();
      assertEqual(await scenarioControls.getByTestId("test-status").textContent(), "In progress", ${JSON.stringify(`${slug} records its start before scenario operations`)});
      assertEqual(await currentProgressDot.getAttribute("data-state"), "in-progress", ${JSON.stringify(`${slug} turns its aggregate progress dot blue while running`)});

      try {
        /* scenario operations */
        ${body}
        await observedAction(page, page.getByTestId("finish-test"), "click");
        await page.locator('html[data-progress-sync="idle"]').waitFor();
        assertEqual(await page.getByTestId("test-status").textContent(), "Completed", ${JSON.stringify(`${slug} records completion after all scenario assertions pass`)});
        assertEqual(await currentProgressDot.getAttribute("data-state"), "completed", ${JSON.stringify(`${slug} turns its aggregate progress dot green after completion`)});
      } catch (error) {
        try {
          if (new URL(page.url()).pathname !== ${JSON.stringify(testCase.route)}) {
            await page.goto(baseUrl + ${JSON.stringify(testCase.route)}, {
              waitUntil: "load",
              timeout: 10_000,
            });
          }
          const failButton = page.getByTestId("fail-test");
          if (await failButton.isEnabled()) {
            await observedAction(page, failButton, "click");
              await page.locator('html[data-progress-sync="idle"]').waitFor();
          }
        } catch (progressError) {
          error.message += "; unable to record scenario failure: " + progressError.message;
        }
        throw error;
      }
    `,
  };
}
