import { caseBody } from "./shared.mjs";

export const playwrightPageInfoCases = [
  {
    name: "regression PWB-04 transient page.info",
    body: caseBody(`
      const target = baseUrl + "/regression/slow-document?ms=1200&run=" + Date.now();
      await page.goto(target, { waitUntil: "commit", timeout: 5000 });
      await page.waitForURL(
        (url) => url.pathname === "/regression/slow-document",
        { waitUntil: "commit", timeout: 5000 }
      );
      const info = await page.info();
      assert(info && typeof info.url === "string", "PWB-04 page.info returns during a transient document");
      assert(Number.isFinite(info.pw) && Number.isFinite(info.ph), "PWB-04 page.info returns numeric page dimensions");
      await page.waitForLoadState("load", { timeout: 5000 });
    `),
  },
];
