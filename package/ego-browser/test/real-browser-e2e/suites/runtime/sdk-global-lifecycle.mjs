export function sdkGlobalLifecycleCase() {
  return `
    const installedEgoBrowser = globalThis.egoBrowser;
    assertEqual(
      Reflect.deleteProperty(globalThis, "egoBrowser"),
      false,
      "a reused Node runtime cannot delete the installed SDK facade",
    );
    globalThis.egoBrowser = undefined;
    assertEqual(
      globalThis.egoBrowser,
      installedEgoBrowser,
      "runtime cleanup cannot overwrite the installed SDK facade",
    );
    assertEqual(
      typeof globalThis.egoBrowser.site.discover,
      "function",
      "the canonical nested site facade survives runtime reuse",
    );
  `;
}
