export function egoSource(body, context) {
  const {
    taskName,
    baseUrl,
    artifactDir,
    tempDir,
    uploadPath,
    uploadPathTwo,
    explicitScreenshotPath,
    environmentScreenshotPath,
    metadataPath,
    keepTaskSpace,
  } = context;
  return `
    const { readFile, stat, writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const taskName = ${JSON.stringify(taskName)};
    const baseUrl = ${JSON.stringify(baseUrl)};
    const artifactDir = ${JSON.stringify(artifactDir)};
    const tempDir = ${JSON.stringify(tempDir)};
    const uploadPath = ${JSON.stringify(uploadPath)};
    const uploadPathTwo = ${JSON.stringify(uploadPathTwo)};
    const explicitScreenshotPath = ${JSON.stringify(explicitScreenshotPath)};
    const environmentScreenshotPath = ${JSON.stringify(environmentScreenshotPath)};
    const metadataPath = ${JSON.stringify(metadataPath)};
    const keepTaskSpace = ${JSON.stringify(keepTaskSpace)};

    let __assertionCount = 0;

    function assert(condition, message) {
      __assertionCount++;
      if (!condition) throw new Error(message);
    }

    function assertEqual(actual, expected, message) {
      __assertionCount++;
      if (actual !== expected) {
        throw new Error(
          message + ": expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual)
        );
      }
    }

    function assertIncludes(text, expected, message) {
      __assertionCount++;
      assert(
        String(text).includes(expected),
        message + ": expected " + JSON.stringify(String(text).slice(0, 500)) + " to include " + JSON.stringify(expected)
      );
    }

    async function assertRejects(fn, expected, message) {
      __assertionCount++;
      try {
        await fn();
      } catch (error) {
        assertIncludes(error?.message || String(error), expected, message);
        return;
      }
      throw new Error(message + ": expected rejection");
    }

    async function assertRejectsAny(fn, message) {
      __assertionCount++;
      try {
        await fn();
      } catch {
        return;
      }
      throw new Error(message + ": expected rejection");
    }

    async function waitForJsValue(expression, expected, message, debugExpression = null) {
      const deadline = Date.now() + 2000;
      let last;
      while (Date.now() <= deadline) {
        last = await js(expression);
        if (last === expected) return last;
        await wait(0.05);
      }
      let detail = "";
      if (debugExpression) {
        detail = "; debug=" + JSON.stringify(await js(debugExpression));
      }
      throw new Error(
        message + detail + ": expected " + JSON.stringify(expected) + ", got " + JSON.stringify(last)
      );
    }

    async function waitForJsCondition(expression, message, debugExpression = null) {
      const deadline = Date.now() + 2000;
      let last;
      while (Date.now() <= deadline) {
        last = await js(expression);
        if (last) return last;
        await wait(0.05);
      }
      let detail = "";
      if (debugExpression) {
        detail = "; debug=" + JSON.stringify(await js(debugExpression));
      }
      throw new Error(message + detail + ": condition stayed false, last value " + JSON.stringify(last));
    }

    async function allowWheelDispatch(label, fn) {
      try {
        await fn();
        return true;
      } catch (error) {
        const message = error?.message || String(error);
        if (/Input\\.dispatchMouseEvent|CDP request timed out: Input\\.dispatchMouseEvent/.test(message)) {
          cliLog(JSON.stringify({ inputDispatchWarning: { label, message } }));
          return false;
        }
        throw error;
      }
    }

    async function setStableViewport() {
      await cdp("Page.bringToFront").catch(() => {});
      await cdp("Emulation.clearDeviceMetricsOverride").catch(() => {});
      await cdp("Emulation.setDeviceMetricsOverride", {
        width: 1280,
        height: 800,
        deviceScaleFactor: 1,
        mobile: false,
      }).catch(() => {});
      await wait(0.1);
    }

    async function hitTestClickButton() {
      return js(
        "const el = document.querySelector('#click-button');" +
          "if (!el) return '';" +
          "const r = el.getBoundingClientRect();" +
          "const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);" +
          "return hit?.closest?.('#click-button')?.id || hit?.id || '';"
      ).catch(() => "");
    }

    async function closeFixtureTabs() {
      const tabs = await listTabs({ includeChrome: false }).catch(() => []);
      for (const tab of tabs) {
        if (String(tab.url || "").startsWith(baseUrl)) {
          await closeTab(tab.targetId).catch(() => {});
        }
      }
    }

    async function resetHome() {
      await takeOverTaskSpace(taskName).catch(() => {});
      await waitForAgentControl(taskName, { interval: 0.1, timeout: 5 });
      await closeFixtureTabs();
      const tab = await openOrReuseTab(baseUrl + "/?e2e-reset=" + Date.now(), { wait: true, timeout: 10 });
      await switchTab(tab.targetId);
      await setStableViewport();
      const nav = await gotoAndWait(baseUrl + "/", { timeout: 10 });
      assert(nav.loaded, "home page loaded");
      await setStableViewport();
      assert(
        await waitForElement("#click-button", { timeout: 3, visible: true }),
        "home fixture click button is visible"
      );
      for (let i = 0; i < 10; i += 1) {
        const info = await pageInfo();
        if (info.w > 0 && info.h > 0 && await hitTestClickButton() === "click-button") return tab;
        await setStableViewport();
      }
      const info = await pageInfo();
      assert(info.w > 0 && info.h > 0, "viewport initialized with non-zero size");
      assertEqual(await hitTestClickButton(), "click-button", "viewport hit-testing reaches the click fixture");
      return tab;
    }

    try {
      ${body}
      cliLog(JSON.stringify({ ok: true, assertions: __assertionCount }));
      await writeFile(join(tempDir, "case-result.json"), JSON.stringify({ ok: true, assertions: __assertionCount }));
    } catch (error) {
      cliLog(JSON.stringify({ ok: false, assertions: __assertionCount, error: error.message }));
      await writeFile(join(tempDir, "case-result.json"), JSON.stringify({ ok: false, assertions: __assertionCount, error: error.message })).catch(() => {});
      error.message = ${JSON.stringify("real browser e2e")} + ": " + error.message;
      throw error;
    }
  `;
}
