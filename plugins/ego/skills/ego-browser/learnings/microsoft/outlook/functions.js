const MESSAGE_SELECTOR =
  '[role="option"][data-convid], [role="option"][data-itemid]';

export async function openOutlookInbox(ctx) {
  const page = ctx.page;
  const url = outlookInboxUrl(page.url());
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForURL(/outlook\.live\.com\/mail\/\d+\//, {
    timeout: 30000,
  });
  await page
    .getByRole("button", { name: /新邮件|New mail/i })
    .first()
    .waitFor({ state: "visible", timeout: 30000 });
  await page
    .locator("#topSearchInput")
    .waitFor({ state: "visible", timeout: 30000 });
  return { url: page.url() };
}

export async function listOutlookMessages(ctx, args = {}) {
  assertOutlookPage(ctx.page, "listMessages");
  const limit = resultLimit(args.limit, "listMessages");
  return ctx.page.locator(MESSAGE_SELECTOR).evaluateAll(
    (items, maximum) =>
      items
        .filter(
          (item) =>
            item.offsetWidth ||
            item.offsetHeight ||
            item.getClientRects().length,
        )
        .map((item) => {
          const label = item.getAttribute("aria-label") || "";
          const sender = item.querySelector(
            '[data-testid="message-sender"], .ESO13, [class*="sender"]',
          );
          const subject = item.querySelector(
            '[data-testid="message-subject"], .TtcXM, [class*="subject"]',
          );
          const preview = item.querySelector(
            '[data-testid="message-preview"], .ASFJj, [class*="preview"]',
          );
          const date = item.querySelector(
            'time, [data-testid="message-date"], .qq2gS, [class*="date"]',
          );
          const id =
            item.getAttribute("data-convid") ||
            item.getAttribute("data-itemid") ||
            "";
          return {
            id,
            sender: sender?.textContent?.trim() || "",
            subject: subject?.textContent?.trim() || "",
            preview: preview?.textContent?.trim() || "",
            date:
              date?.getAttribute("datetime") ||
              date?.getAttribute("title") ||
              date?.textContent?.trim() ||
              "",
            unread:
              item.getAttribute("data-is-read") === "false" ||
              /^(未读|Unread)(?:\s|[,，])/i.test(label),
          };
        })
        .filter((message) => message.id)
        .slice(0, maximum),
    limit,
  );
}

export async function searchOutlook(ctx, args = {}) {
  const query = nonEmptyString(args.query, "search requires a non-empty query");
  const limit = resultLimit(args.limit, "search");
  assertOutlookPage(ctx.page, "search");
  const exitSearch = ctx.page.getByRole("button", {
    name: /退出搜索|Exit search/i,
  });
  if ((await exitSearch.count()) > 0) {
    await exitSearch.click();
    await exitSearch.waitFor({ state: "hidden", timeout: 30000 });
  }
  const input = ctx.page.locator("#topSearchInput");
  await input.fill(query);
  await input.press("Enter", { noWaitAfter: true });
  await exitSearch.waitFor({ state: "visible", timeout: 30000 });
  const searching = ctx.page.getByText(/正在搜索|Searching/i).first();
  try {
    await searching.waitFor({ state: "visible", timeout: 3000 });
  } catch {
    // Cached results can finish before the loading label becomes visible.
  }
  await searching.waitFor({ state: "hidden", timeout: 30000 });
  const rows = ctx.page.locator(MESSAGE_SELECTOR).first();
  const noResults = ctx.page
    .getByText(
      /未找到任何内容|请尝试使用其他关键字|Nothing found|No results|Try different keywords/i,
    )
    .first();
  await rows.or(noResults).first().waitFor({ state: "visible", timeout: 30000 });
  return listOutlookMessages(ctx, { limit });
}

export async function readOutlookMessage(ctx, args = {}) {
  const id = safeId(args.id, "readMessage");
  assertOutlookPage(ctx.page, "readMessage");
  const item = ctx.page.locator(
    `[role="option"][data-convid="${id}"], [role="option"][data-itemid="${id}"]`,
  );
  if ((await item.count()) === 0) {
    throw new Error(
      `readMessage could not find ${JSON.stringify(id)} in the current Outlook list`,
    );
  }
  await ctx.egoBrowser.showTaskState("open Outlook message");
  await item.click();
  const pane = ctx.page.getByRole("main").last();
  const subject = pane.getByRole("heading").first();
  await subject.waitFor({ state: "visible", timeout: 30000 });
  const senderLabel =
    (await pane
      .locator('[aria-label^="发件人:"], [aria-label^="From:"]')
      .first()
      .getAttribute("aria-label")) || "";
  const dateElement = pane
    .locator('[data-testid="SentReceivedSavedTime"]')
    .first();
  const date =
    (await dateElement.getAttribute("title")) ||
    (await dateElement.innerText()).trim();
  const text = await pane.locator('[role="document"]').first().innerText();
  return {
    id,
    sender: senderLabel.replace(/^(?:发件人|From):\s*/i, ""),
    subject: (await subject.innerText()).trim(),
    date,
    text: text.trim(),
  };
}

export async function createOutlookDraft(ctx, args = {}) {
  const to = emailList(args.to, "createDraft requires at least one recipient");
  const cc = emailList(args.cc);
  const bcc = emailList(args.bcc);
  const subject = stringValue(args.subject, "createDraft requires subject");
  const body = stringValue(args.body, "createDraft requires body");
  assertOutlookPage(ctx.page, "createDraft");

  await ctx.egoBrowser.showTaskState("compose Outlook draft");
  await ctx.page
    .getByRole("button", { name: /新邮件|New mail/i })
    .first()
    .click();
  const pane = ctx.page.getByRole("main").last();
  const toEditor = pane.locator('[contenteditable="true"].EditorClass');
  await fillOutlookRecipientEditor(toEditor, to);
  if (cc.length) {
    await fillDirectoryRecipients(ctx.page, pane, /^(抄送|Cc)$/i, cc, "Cc");
  }
  if (bcc.length) {
    await fillDirectoryRecipients(
      ctx.page,
      pane,
      /^(密件抄送|Bcc)$/i,
      bcc,
      "Bcc",
    );
  }

  const subjectInput = pane.getByRole("textbox", { name: /主题|Subject/i });
  const bodyEditor = pane.getByRole("textbox", {
    name: /邮件正文|Message body/i,
  });
  await subjectInput.fill(subject);
  await bodyEditor.fill(body);
  if ((await subjectInput.inputValue()) !== subject) {
    throw new Error("createDraft subject verification failed");
  }
  if ((await bodyEditor.innerText()).trim() !== body.trim()) {
    throw new Error("createDraft body verification failed");
  }
  await ctx.page.waitForTimeout(700);
  await ctx.egoBrowser.showTaskState("save Outlook draft");
  await pane
    .getByText(/已于.+保存草稿|已保存到草稿|Saved(?: to)? Drafts?|Draft saved/i)
    .last()
    .waitFor({ state: "visible", timeout: 30000 });
  const closeName = subject
    ? new RegExp(`${escapeRegExp(subject)}.*(?:关闭|Close)$`, "i")
    : /(?:编辑|Edit).*(?:关闭|Close)$/i;
  const close = ctx.page.getByRole("button", { name: closeName }).last();
  await close.waitFor({ state: "visible", timeout: 30000 });
  await ctx.egoBrowser.showTaskState("close saved Outlook draft");
  await close.click({ noWaitAfter: true });
  await subjectInput.waitFor({ state: "hidden", timeout: 30000 });
  return { to, cc, bcc, subject, body, drafted: true };
}

async function fillOutlookRecipientEditor(editor, addresses) {
  for (const address of addresses) {
    await editor.fill(address);
    await editor.press("Enter");
  }
}

async function fillDirectoryRecipients(
  page,
  pane,
  buttonName,
  addresses,
  label,
) {
  await pane.getByRole("button", { name: buttonName }).press("Enter");
  const dialog = page.getByRole("alertdialog");
  const search = dialog.getByRole("searchbox");
  for (const address of addresses) {
    await search.fill(address);
    await page.waitForTimeout(600);
    const result = dialog.getByText(address, { exact: true });
    if ((await result.count()) === 0) {
      throw new Error(
        `createDraft ${label} recipient ${JSON.stringify(address)} is not available in the Outlook address book`,
      );
    }
    await result.first().click();
  }
  await dialog.getByRole("button", { name: /保存|Save/i }).click();
}

function outlookInboxUrl(value) {
  try {
    const current = new URL(value);
    const match = current.pathname.match(/^\/mail\/(\d+)\//);
    if (current.hostname === "outlook.live.com" && match) {
      return `https://outlook.live.com/mail/${match[1]}/`;
    }
  } catch {
    // Fall back to the first logged-in personal Outlook account.
  }
  return "https://outlook.live.com/mail/0/";
}

function assertOutlookPage(page, operation) {
  let url;
  try {
    url = new URL(page.url());
  } catch {
    throw new Error(`${operation} requires an active Outlook page`);
  }
  if (url.protocol !== "https:" || url.hostname !== "outlook.live.com") {
    throw new Error(`${operation} requires an active personal Outlook page`);
  }
}

function resultLimit(value, operation) {
  if (value === undefined) return 20;
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new Error(`${operation} limit must be an integer from 1 to 100`);
  }
  return value;
}

function safeId(value, operation) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9+_=/.-]+$/.test(value)) {
    throw new Error(`${operation} requires a valid message id`);
  }
  return value;
}

function nonEmptyString(value, message) {
  if (typeof value !== "string" || !value.trim()) throw new Error(message);
  return value.trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stringValue(value, message) {
  if (typeof value !== "string") throw new Error(message);
  return value;
}

function emailList(value, requiredMessage) {
  if (value === undefined || value === null || value === "") {
    if (requiredMessage) throw new Error(requiredMessage);
    return [];
  }
  const values = Array.isArray(value) ? value : [value];
  if (
    values.length === 0 ||
    values.some(
      (item) => typeof item !== "string" || !/^\S+@\S+\.\S+$/.test(item),
    )
  ) {
    throw new Error(
      requiredMessage || "recipient addresses must be valid emails",
    );
  }
  return values;
}
