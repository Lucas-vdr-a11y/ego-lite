import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";

import * as formatModule from "../dist/src/format.js";
import { helperContext } from "../dist/src/helpers.js";

test("public API compatibility baseline is pinned to Playwright 1.52.0", () => {
  assert.equal(formatModule.PLAYWRIGHT_COMPATIBILITY_BASELINE, "1.52.0");
});

test("every documented public API has an explicit compatibility classification", () => {
  for (const [path, doc] of Object.entries(formatModule.PUBLIC_API_DOCS)) {
    assert.match(
      doc.compatibility?.status || "",
      /^(exact|superset|subset|ego-extension|deprecated|internal)$/,
      `${path} must declare a supported compatibility status`,
    );
    assert.equal(
      doc.compatibility?.baseline,
      "1.52.0",
      `${path} must use the pinned Playwright baseline`,
    );
  }
});

test("Playwright and ego-specific methods are classified honestly", () => {
  const docs = formatModule.PUBLIC_API_DOCS;

  assert.equal(docs["locator.ariaSnapshot"].compatibility.status, "subset");
  assert.equal(docs["page.ariaSnapshot"].compatibility.status, "ego-extension");
  assert.equal(
    docs["page.screencast.start"].compatibility.status,
    "ego-extension",
  );
  assert.equal(docs["tabs.list"].compatibility.status, "ego-extension");
  assert.equal(docs["tabs.open"].compatibility.status, "ego-extension");
  assert.equal(docs["browser.listTabs"], undefined);
  assert.equal(
    docs["taskSpaces.useOrCreate"].compatibility.status,
    "ego-extension",
  );
});

test("every exact classification has an explicit executable contract", async () => {
  const source = await readFile(
    new URL("./playwright-exact-contracts.test.mjs", import.meta.url),
    "utf8",
  );
  const contracted = [...source.matchAll(/\[exact:([^\]]+)\]/g)]
    .map((match) => match[1])
    .sort();
  const classified = Object.entries(formatModule.PUBLIC_API_DOCS)
    .filter(([, doc]) => doc.compatibility.status === "exact")
    .map(([path]) => path)
    .sort();

  assert.deepEqual(classified, contracted);
});

test("help exposes the pinned compatibility baseline without model knowledge", () => {
  const output = helperContext().help("compat");

  assert.match(output, /Playwright compatibility baseline: 1\.52\.0/);
  assert.match(output, /exact|superset|subset/);
  assert.match(output, /ego-extension/);
});

test("checked-in Playwright surface is the 1.52.0 contract, not a later version", async () => {
  const manifest = await readCompatibilityManifest();

  assert.equal(manifest.version, "1.52.0");
  assert.equal(manifest.package, "playwright-core");
  assert.ok(manifest.interfaces.Page.includes("waitForEvent"));
  assert.ok(manifest.interfaces.Page.includes("accessibility"));
  assert.ok(!manifest.interfaces.Page.includes("consoleMessages"));
  assert.ok(!manifest.interfaces.Page.includes("pageErrors"));
  assert.ok(!manifest.interfaces.Page.includes("requests"));
  assert.ok(!manifest.interfaces.Page.includes("ariaSnapshot"));
  assert.ok(!manifest.interfaces.Page.includes("screencast"));
  assert.ok(manifest.interfaces.Locator.includes("ariaSnapshot"));
  assert.ok(!manifest.interfaces.Locator.includes("describe"));
  assert.ok(!manifest.interfaces.Locator.includes("description"));
  assert.ok(!manifest.interfaces.Locator.includes("drop"));
  assert.ok(manifest.interfaces.FrameLocator.includes("owner"));
});

test("checked-in Playwright surface records signatures and option drift", async () => {
  const manifest = await readCompatibilityManifest();
  const ariaSnapshot = manifest.signatures.Locator.ariaSnapshot.join("\n");
  const locatorClick = manifest.signatures.Locator.click.join("\n");
  const mouseMove = manifest.signatures.Mouse.move.join("\n");

  assert.match(ariaSnapshot, /ref\?: boolean/);
  assert.match(ariaSnapshot, /timeout\?: number/);
  assert.doesNotMatch(locatorClick, /steps\?: number/);
  assert.match(mouseMove, /steps\?: number/);
});

test("classifications agree with the checked-in Playwright surface", async () => {
  const manifest = await readCompatibilityManifest();

  for (const [path, doc] of Object.entries(formatModule.PUBLIC_API_DOCS)) {
    const [namespace, firstMember, secondMember] = path.split(".");
    let interfaceName;
    let memberName;

    if (namespace === "page" && firstMember === "keyboard") {
      interfaceName = "Keyboard";
      memberName = secondMember;
    } else if (namespace === "page" && firstMember === "mouse") {
      interfaceName = "Mouse";
      memberName = secondMember;
    } else if (namespace === "page") {
      interfaceName = "Page";
      memberName = firstMember;
    } else if (namespace === "locator") {
      interfaceName = "Locator";
      memberName = firstMember;
    } else if (namespace === "frameLocator") {
      interfaceName = "FrameLocator";
      memberName = firstMember;
    } else if (namespace === "browser") {
      interfaceName = "Browser";
      memberName = firstMember;
    }

    const isPlaywrightMember =
      interfaceName && manifest.interfaces[interfaceName]?.includes(memberName);
    if (doc.compatibility.status === "ego-extension") {
      assert.ok(!isPlaywrightMember, `${path} is a Playwright 1.52.0 member`);
    } else {
      assert.ok(isPlaywrightMember, `${path} is not in Playwright 1.52.0`);
    }
  }
});

test("compatibility checker verifies the manifest against installed Playwright types", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/check-playwright-compat.mjs"],
    {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
    },
  );

  assert.equal(
    result.status,
    0,
    `compatibility check failed:\n${result.stdout}\n${result.stderr}`,
  );
  assert.match(result.stdout, /playwright-core@1\.52\.0/);
});

test("compatibility report lists covered and missing members for the promised boundary", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/check-playwright-compat.mjs", "--report"],
    {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
    },
  );

  assert.equal(
    result.status,
    0,
    `compatibility report failed:\n${result.stdout}\n${result.stderr}`,
  );
  assert.match(result.stdout, /Page: 59\/105 \(56\.2%\)/);
  assert.match(result.stdout, /Locator: 57\/62 \(91\.9%\)/);
  assert.match(result.stdout, /FrameLocator: 13\/13 \(100\.0%\)/);
  assert.match(result.stdout, /Keyboard: 5\/5 \(100\.0%\)/);
  assert.match(result.stdout, /Mouse: 6\/6 \(100\.0%\)/);
  assert.match(result.stdout, /Total: 140\/191 \(73\.3%\)/);
  assert.doesNotMatch(result.stdout, /Page missing:.*(?:goBack|goForward)/);
  assert.doesNotMatch(
    result.stdout,
    /Page missing:.*(?:close|route|frames|clock|evaluateHandle)/,
  );
  assert.doesNotMatch(
    result.stdout,
    /Locator missing:.*(?:all|contentFrame|evaluateHandle|page)/,
  );
  assert.match(result.stdout, /FrameLocator missing: none/);
});

test("Browser and BrowserContext remain explicit architectural exclusions", () => {
  const context = helperContext();
  assert.equal(context.browser, undefined);
  assert.equal(context.page.context, undefined);
  assert.equal(formatModule.PUBLIC_API_DOCS["browser.newContext"], undefined);
  assert.equal(formatModule.PUBLIC_API_DOCS["page.context"], undefined);

  const result = spawnSync(
    process.execPath,
    ["scripts/check-playwright-compat.mjs", "--report"],
    {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Excluded by design: Browser, BrowserContext/);
});

test("agent skill names the pinned baseline and distinguishes ARIA snapshot scopes", async () => {
  const skill = await readFile(
    new URL("../../../skills/ego-browser/SKILL.md", import.meta.url),
    "utf8",
  );

  assert.match(skill, /targets `playwright@1\.52\.0`/);
  assert.match(skill, /`locator\.ariaSnapshot\(\)`.*Playwright/);
  assert.match(
    skill,
    /`locator\.ariaSnapshot\(\{ ref: true \}\)`.*`aria-ref=sNeN`/s,
  );
  assert.doesNotMatch(skill, /`ref: true`.*not supported/);
  assert.match(skill, /`page\.ariaSnapshot\(\)`.*ego-browser-specific/);
  assert.match(skill, /`task\.tabs\.open\(\)` always creates a new tab/);
  assert.match(
    skill,
    /\{ targetId, url, title, type: "page", page, activate, close \}/,
  );
  assert.match(skill, /popup.*target-bound Page/i);
  assert.match(skill, /Native snapshots are serialized internally/);
  assert.match(skill, /refs stay scoped to that Page/);
});

async function readCompatibilityManifest() {
  return JSON.parse(
    await readFile(
      new URL("../compat/playwright-1.52.0.json", import.meta.url),
      "utf8",
    ),
  );
}
