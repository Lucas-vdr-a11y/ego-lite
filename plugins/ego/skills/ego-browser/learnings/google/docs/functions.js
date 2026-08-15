export async function openDocument(ctx, args = {}) {
  const page = ctx.page;
  const url = googleDocsUrl(args.url, "open");

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForURL(/\/document\/d\//, { timeout: 30000 });
  await page
    .locator("input.docs-title-input")
    .waitFor({ state: "visible", timeout: 30000 });
  await page
    .locator("canvas.kix-canvas-tile-content")
    .first()
    .waitFor({ state: "visible", timeout: 30000 });

  return {
    url: page.url(),
    title: await page.locator("input.docs-title-input").inputValue(),
  };
}

export async function readDocumentText(ctx) {
  const page = ctx.page;
  assertGoogleDocsPage(page, "readText");
  await ctx.egoBrowser.showTaskState("focus Google document");
  await page.locator(".kix-page-paginated.canvas-first-page").first().click();

  const previousClipboard = await readClipboard(page);
  try {
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.press("ControlOrMeta+C");
    const copied = await readClipboard(page);
    const normalized = copied.replace(/\r\n/g, "\n").replace(/\n$/, "");
    const text = normalized.trim() ? normalized : "";
    await page.keyboard.press(text ? "ArrowRight" : "ArrowLeft");
    return {
      title: await page.locator("input.docs-title-input").inputValue(),
      text,
    };
  } finally {
    await writeClipboard(page, previousClipboard);
  }
}

export async function setDocumentTitle(ctx, args = {}) {
  const page = ctx.page;
  const requestedTitle = nonEmptyString(
    args.title,
    "setTitle requires a non-empty title",
  );
  assertGoogleDocsPage(page, "setTitle");
  const titleInput = page.locator("input.docs-title-input");
  const previousTitle = await titleInput.inputValue();
  if (previousTitle === requestedTitle) {
    return {
      previousTitle,
      title: previousTitle,
      changed: false,
      saved: true,
    };
  }

  await ctx.egoBrowser.showTaskState("rename Google document");
  await titleInput.click();
  await page.waitForTimeout(250);
  await titleInput.press("ControlOrMeta+A");
  await page.keyboard.insertText(requestedTitle);
  await titleInput.press("Enter");
  await waitForGoogleSave(page);

  const title = await titleInput.inputValue();
  if (title !== requestedTitle) {
    throw new Error(
      `setTitle verification failed: received ${JSON.stringify(title)}`,
    );
  }
  return { previousTitle, title, changed: true, saved: true };
}

export async function appendDocumentText(ctx, args = {}) {
  const text = requiredContent(args.text, "appendText requires non-empty text");
  const before = await readDocumentText(ctx);
  if (before.text.endsWith(text)) {
    return {
      title: before.title,
      text: before.text,
      appendedText: text,
      changed: false,
      saved: true,
    };
  }
  const separator = args.separator === undefined ? "\n" : args.separator;
  const insertion = before.text ? `${separator}${text}` : text;

  await ctx.egoBrowser.showTaskState("append Google document text");
  await ctx.page.keyboard.insertText(insertion);
  await waitForGoogleSave(ctx.page);

  const after = await readDocumentText(ctx);
  const expected = `${before.text}${insertion}`;
  if (after.text !== expected) {
    throw new Error("appendText verification failed");
  }
  return {
    title: after.title,
    text: after.text,
    appendedText: text,
    changed: true,
    saved: true,
  };
}

export async function replaceDocumentText(ctx, args = {}) {
  const find = requiredContent(
    args.find,
    "replaceAll requires non-empty find text",
  );
  if (typeof args.replace !== "string") {
    throw new Error("replaceAll requires replace to be a string");
  }
  const replace = args.replace;
  const before = await readDocumentText(ctx);
  const matchCase = args.matchCase === true;
  const replacement = replacePlainText(before.text, find, replace, matchCase);
  if (replacement.count === 0) {
    return {
      title: before.title,
      text: before.text,
      find,
      replace,
      count: 0,
      changed: false,
      saved: true,
    };
  }

  await ctx.page.keyboard.press(
    process.platform === "darwin" ? "Meta+Shift+H" : "Control+H",
  );
  const dialog = ctx.page.locator(
    ".appsDocsUiWizFindandreplacedialogContainer",
  );
  await dialog.waitFor({ state: "visible", timeout: 10000 });
  const inputs = dialog.locator('input[type="text"]');
  await inputs.nth(0).fill(find);
  await inputs.nth(1).fill(replace);

  const checkboxes = dialog.locator('input[type="checkbox"]');
  const matchCaseCheckbox = checkboxes.nth(0);
  if ((await matchCaseCheckbox.isChecked()) !== matchCase) {
    await matchCaseCheckbox.click();
  }
  for (const index of [1, 2]) {
    const checkbox = checkboxes.nth(index);
    if (await checkbox.isChecked()) await checkbox.click();
  }

  await ctx.egoBrowser.showTaskState("replace Google document text");
  await dialog.locator("button").nth(2).click();
  await dialog.locator("button").first().click();
  await waitForGoogleSave(ctx.page);

  const after = await readDocumentText(ctx);
  if (after.text !== replacement.text) {
    throw new Error("replaceAll verification failed");
  }
  return {
    title: after.title,
    text: after.text,
    find,
    replace,
    count: replacement.count,
    changed: true,
    saved: true,
  };
}

function nonEmptyString(value, message) {
  if (typeof value !== "string" || !value.trim()) throw new Error(message);
  return value.trim();
}

function requiredContent(value, message) {
  if (typeof value !== "string" || !value.trim()) throw new Error(message);
  return value;
}

function replacePlainText(text, find, replacement, matchCase) {
  const pattern = new RegExp(escapeRegExp(find), matchCase ? "g" : "gi");
  let count = 0;
  const replaced = text.replace(pattern, () => {
    count += 1;
    return replacement;
  });
  return { text: replaced, count };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function googleDocsUrl(value, operation) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${operation} requires a Google Docs document URL`);
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "docs.google.com" ||
    !url.pathname.startsWith("/document/d/")
  ) {
    throw new Error(`${operation} requires a Google Docs document URL`);
  }
  return url.href;
}

function assertGoogleDocsPage(page, operation) {
  googleDocsUrl(page.url(), operation);
}

function readClipboard(page) {
  return page.evaluate(() => navigator.clipboard.readText());
}

function writeClipboard(page, value) {
  return page.evaluate(
    (clipboardValue) => navigator.clipboard.writeText(clipboardValue),
    value,
  );
}

async function waitForGoogleSave(page) {
  await page.waitForTimeout(250);
  const indicator = page.locator(".docs-save-indicator");
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if ((await indicator.count()) === 0) return;
    if (!(await indicator.textContent())?.trim()) return;
    await page.waitForTimeout(100);
  }
  throw new Error("Google Docs did not finish saving within 30000ms");
}
