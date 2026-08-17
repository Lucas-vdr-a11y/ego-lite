import type { Browser } from "playwright-core";

import type { EgoTab } from "./types.js";

/**
 * Pairs the native browser's active tab with the Page object Playwright built
 * for it.
 *
 * The two sides are discovered independently — native lists tabs, Playwright
 * populates contexts from its own attach events — so the match is by URL, then
 * by position, and only then by falling back to a fresh Page. Duplicate URLs are
 * why position matters: the nth native tab with a URL pairs with the nth Page
 * carrying it.
 */
export async function locatePlaywrightPage(
  browser: Browser,
  activeTab?: EgoTab,
  nativeTabs: EgoTab[] = [],
) {
  const deadline = Date.now() + 2_000;

  while (true) {
    const contexts = browser.contexts();
    for (const context of contexts) {
      const pages = context.pages();
      if (activeTab?.url) {
        const matches = pages.filter(
          (page) =>
            typeof page.url === "function" && page.url() === activeTab.url,
        );
        if (matches.length > 0) {
          const activeIndex = nativeTabs.indexOf(activeTab);
          const occurrence = nativeTabs
            .slice(0, activeIndex + 1)
            .filter((tab) => tab.url === activeTab.url).length;
          return { page: matches[occurrence - 1] || matches.at(-1), context };
        }
      }
      if (pages.length === 1) return { page: pages[0], context };
      const activeIndex = nativeTabs.indexOf(activeTab);
      if (!activeTab?.url && activeIndex >= 0 && pages[activeIndex]) {
        return { page: pages[activeIndex], context };
      }
      if (!activeTab && pages.length > 0) {
        return { page: pages.at(-1), context };
      }
    }

    if (Date.now() >= deadline) {
      const activeIndex = nativeTabs.indexOf(activeTab);
      if (activeIndex >= 0) {
        for (const context of contexts) {
          const page = context.pages()[activeIndex];
          if (page) return { page, context };
        }
      }
      const context = contexts[0];
      if (!context) {
        throw new Error("Playwright CDP connection returned no BrowserContext");
      }
      if (typeof context.newPage !== "function") {
        throw new Error("Playwright BrowserContext cannot create a Page");
      }
      return { page: await context.newPage(), context };
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
