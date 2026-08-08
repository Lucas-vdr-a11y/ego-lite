const TITLE_SELECTOR = 'main h1[data-content-editable-leaf="true"]';
const BODY_SELECTOR = 'main [data-content-editable-leaf="true"]:not(h1)';
const ROOT_SELECTOR = 'main [data-content-editable-root="true"]';

export async function openNotionPage(ctx, args = {}) {
  const page = ctx.page;
  const url = notionPageUrl(args.url, "open");
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForURL(/notion\.(?:com|so)\//, { timeout: 30000 });
  await page
    .locator(TITLE_SELECTOR)
    .waitFor({ state: "visible", timeout: 30000 });
  return { url: page.url(), title: await notionTitle(page) };
}

export async function searchNotionPages(ctx, args = {}) {
  const query = nonEmptyString(args.query, "search requires a non-empty query");
  const limit = resultLimit(args.limit, "search");
  assertNotionPage(ctx.page, "search");
  await ctx.egoBrowser?.showTaskState?.("open Notion search");
  await ctx.page
    .getByRole("button", { name: /^(搜索|Search)$/i })
    .first()
    .click();
  const dialog = ctx.page.getByRole("dialog");
  await dialog.getByRole("combobox").fill(query);
  const progress = dialog
    .locator('[role="progressbar"]:visible, [aria-busy="true"]:visible')
    .first();
  await progress.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
  await progress.waitFor({ state: "hidden", timeout: 30000 });
  await dialog
    .locator('a[href*="/p/"]:visible, [role="alert"]:visible')
    .first()
    .waitFor({ state: "visible", timeout: 30000 });
  const results = await dialog.locator('a[href*="/p/"]').evaluateAll(
    (links, maximum) =>
      links
        .map((link) => {
          const option = link.querySelector('[role="option"]');
          const url = new URL(link.href);
          url.search = "";
          return {
            title: (option?.textContent || link.textContent || "").trim(),
            url: url.href,
          };
        })
        .filter((item) => item.title && item.url)
        .slice(0, maximum),
    limit,
  );
  await ctx.page.keyboard.press("Escape");
  return results;
}

export async function readNotionPage(ctx) {
  assertNotionPage(ctx.page, "read");
  const blocks = await ctx.page
    .locator(BODY_SELECTOR)
    .evaluateAll((editors) =>
      editors.map((editor) => editor.innerText || editor.textContent || ""),
    );
  return {
    url: ctx.page.url(),
    title: await notionTitle(ctx.page),
    text: normalizeBlocks(blocks),
  };
}

export async function setNotionPageTitle(ctx, args = {}) {
  const requestedTitle = nonEmptyString(
    args.title,
    "setTitle requires a non-empty title",
  );
  assertNotionPage(ctx.page, "setTitle");
  const titleEditor = ctx.page.locator(TITLE_SELECTOR);
  const previousTitle = await notionTitle(ctx.page);
  if (previousTitle === requestedTitle) {
    return {
      previousTitle,
      title: previousTitle,
      changed: false,
      saved: true,
    };
  }

  await ctx.egoBrowser.showTaskState("rename Notion page");
  await titleEditor.fill(requestedTitle);
  await ctx.page.waitForTimeout(300);
  const title = await notionTitle(ctx.page);
  if (title !== requestedTitle) throw new Error("setTitle verification failed");
  return { previousTitle, title, changed: true, saved: true };
}

export async function appendNotionPageText(ctx, args = {}) {
  const text = requiredContent(args.text, "appendText requires non-empty text");
  const before = await readNotionPage(ctx);
  if (before.text.endsWith(text)) {
    return {
      ...before,
      appendedText: text,
      changed: false,
      saved: true,
    };
  }

  await ctx.egoBrowser.showTaskState("append Notion page text");
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    await appendNotionBlock(ctx.page, lines[index], index === 0);
  }
  await ctx.page.waitForTimeout(300);
  const after = await readNotionPage(ctx);
  const expected = before.text ? `${before.text}\n${text}` : text;
  if (after.text !== expected)
    throw new Error("appendText verification failed");
  return {
    ...after,
    appendedText: text,
    changed: true,
    saved: true,
  };
}

export async function createNotionPage(ctx, args = {}) {
  const title = nonEmptyString(args.title, "create requires a non-empty title");
  const text = args.text === undefined ? "" : args.text;
  if (typeof text !== "string") throw new Error("create text must be a string");
  let parentUrl;
  let parentTitle;
  if (args.parentUrl !== undefined) {
    parentUrl = notionPageUrl(args.parentUrl, "create parentUrl");
    const parent = await openNotionPage(ctx, { url: parentUrl });
    parentTitle = parent.title;
  } else {
    assertNotionPage(ctx.page, "create");
  }

  await ctx.egoBrowser.showTaskState("create Notion page");
  const previousUrl = ctx.page.url();
  await ctx.page
    .getByRole("button", { name: /新页面|New page/i })
    .first()
    .click();
  const pageMenuItem = ctx.page.getByRole("menuitem", {
    name: /^(页面|Page)$/i,
  });
  await pageMenuItem.waitFor({ state: "visible", timeout: 10000 });
  await pageMenuItem.click();
  await ctx.page.waitForURL((url) => url.href !== previousUrl, {
    timeout: 30000,
  });
  await ctx.page
    .locator(TITLE_SELECTOR)
    .waitFor({ state: "visible", timeout: 30000 });
  await waitForBlankNotionTitle(ctx.page);
  await setNotionPageTitle(ctx, { title });

  if (parentTitle) await moveNotionPage(ctx.page, parentTitle);
  if (text.trim()) await appendNotionPageText(ctx, { text });
  let created = await readNotionPage(ctx);
  if (created.title !== title) {
    await setNotionPageTitle(ctx, { title });
    created = await readNotionPage(ctx);
  }
  return { ...created, parentUrl, created: true };
}

async function moveNotionPage(page, parentTitle) {
  const search = page.getByPlaceholder(/将页面移至|Move page to/i);
  if ((await search.count()) === 0) {
    await page
      .getByRole("banner")
      .getByRole("button", { name: /私人|Private/i })
      .first()
      .press("Enter");
  }
  await search.waitFor({ state: "visible", timeout: 10000 });
  await search.fill(parentTitle);
  const result = page
    .getByRole("dialog")
    .last()
    .getByRole("menuitem")
    .filter({ hasText: parentTitle })
    .first();
  await result.waitFor({ state: "visible", timeout: 10000 });
  await result.press("Enter");
  await page.waitForTimeout(300);
}

async function appendNotionBlock(page, text, reuseEmptyBlock) {
  const blocks = page.locator(BODY_SELECTOR);
  const beforeCount = await blocks.count();
  if (
    reuseEmptyBlock &&
    beforeCount > 0 &&
    (await blocks.last().innerText()).trim() === ""
  ) {
    await blocks.last().fill(text);
    return;
  }
  if (beforeCount === 0) {
    await page.locator(ROOT_SELECTOR).evaluate((root) => {
      root.focus();
      const range = document.createRange();
      range.selectNodeContents(root);
      range.collapse(false);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });
  } else {
    await blocks.last().click();
    await page.keyboard.press("End");
  }
  await page.keyboard.press("Enter");
  await waitForBlockCount(blocks, beforeCount + 1);
  await blocks.last().fill(text);
}

async function waitForBlockCount(blocks, expected) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if ((await blocks.count()) >= expected) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Notion did not create a new text block within 5000ms");
}

async function waitForBlankNotionTitle(page) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if ((await notionTitle(page)) === "") return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Notion did not finish opening the new page within 10000ms");
}

async function notionTitle(page) {
  return (await page.locator(TITLE_SELECTOR).innerText()).trim();
}

function normalizeBlocks(blocks) {
  const values = blocks.map((block) =>
    String(block || "").replace(/\r\n/g, "\n"),
  );
  while (values[0] === "") values.shift();
  while (values.at(-1) === "") values.pop();
  return values.join("\n");
}

function notionPageUrl(value, operation) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${operation} requires a Notion page URL`);
  }
  if (
    url.protocol !== "https:" ||
    !isNotionHost(url.hostname) ||
    !url.pathname.replace(/^\/p\//, "/").match(/[a-f0-9]{20,}/i)
  ) {
    throw new Error(`${operation} requires a Notion page URL`);
  }
  return url.href;
}

function assertNotionPage(page, operation) {
  notionPageUrl(page.url(), operation);
}

function isNotionHost(hostname) {
  return (
    hostname === "notion.com" ||
    hostname.endsWith(".notion.com") ||
    hostname === "notion.so" ||
    hostname.endsWith(".notion.so")
  );
}

function resultLimit(value, operation) {
  if (value === undefined) return 20;
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new Error(`${operation} limit must be an integer from 1 to 100`);
  }
  return value;
}

function nonEmptyString(value, message) {
  if (typeof value !== "string" || !value.trim()) throw new Error(message);
  return value.trim();
}

function requiredContent(value, message) {
  if (typeof value !== "string" || !value.trim()) throw new Error(message);
  return value;
}
