import { homeCase } from "./shared.mjs";

export const playwrightPageUrlCases = [
  {
    name: "regression PWB-03 page.url synchronous contract",
    body: homeCase(`
      const initialUrl = page.url();
      assertEqual(typeof initialUrl, "string", "PWB-03 page.url returns a string synchronously");
      assertIncludes(initialUrl, baseUrl, "PWB-03 page.url reflects the current tab");

      const navigation = page.waitForURL(
        (url) => url.pathname === "/nav-target",
        { timeout: 5000 }
      );
      await page.getByRole("link", { name: "Go to nav target" }).click();
      await navigation;
      assertIncludes(page.url(), "/nav-target", "PWB-03 page.url reads the URL after navigation");
    `),
  },
];
