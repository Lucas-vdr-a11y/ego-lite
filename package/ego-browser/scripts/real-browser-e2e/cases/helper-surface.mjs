export function helperSurfaceCase() {
  return `
    const expectedHelpers = [
      "listTaskSpaces",
      "switchTaskSpace",
      "newTaskSpace",
      "taskSpace",
      "useOrCreateTaskSpace",
      "claimTaskSpace",
      "completeTaskSpace",
      "handOffTaskSpace",
      "takeOverTaskSpace",
      "waitForAgentControl",
      "pageInfo",
      "listTabs",
      "currentTab",
      "switchTab",
      "openOrReuseTab",
      "closeTab",
      "gotoUrl",
      "gotoAndWait",
      "ensureRealTab",
      "iframeTarget",
      "snapshot",
      "snapshotRaw",
      "snapshotText",
      "captureScreenshot",
      "elementCenter",
      "drainEvents",
      "click",
      "doubleClick",
      "hover",
      "dragMouse",
      "scroll",
      "scrollBy",
      "scrollToBottomUntil",
      "pressKey",
      "typeText",
      "fillInput",
      "dispatchKey",
      "uploadFile",
      "wait",
      "waitForLoad",
      "waitForElement",
      "waitForNetworkIdle",
      "serverFetch",
      "browserFetch",
      "cdp",
      "js",
      "help",
    ];
    for (const name of expectedHelpers) {
      assertEqual(typeof globalThis[name], "function", "helper is installed: " + name);
    }
    assertEqual(typeof globalThis.newTab, "undefined", "internal newTab is not exposed");
    const defaultHelp = help();
    assertIncludes(defaultHelp, "TaskSpace.openPage", "default help presents the v2 object API");
    assertIncludes(
      help("click"),
      "Legacy helper hidden from default help",
      "default help hides callable legacy helpers"
    );
    assertIncludes(
      help("legacy", "click"),
      "click",
      "legacy help remains explicitly available"
    );
    const helpText = help("missingHelperForE2E");
    assertIncludes(helpText, "Unknown helper", "help reports unknown helper names");
  `;
}
