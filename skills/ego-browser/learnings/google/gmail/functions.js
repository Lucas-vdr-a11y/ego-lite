const THREAD_SELECTOR = "tr.zA:visible";

export async function openGmailInbox(ctx) {
  const page = ctx.page;
  const url = gmailInboxUrl(page.url());

  if (page.url() !== url) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  }
  await page.waitForURL(/#inbox/, { timeout: 30000 });
  await page
    .locator('input[name="q"]')
    .waitFor({ state: "visible", timeout: 30000 });
  await page
    .locator('[role="button"][gh="cm"]')
    .waitFor({ state: "visible", timeout: 30000 });
  return { url: page.url() };
}

export async function listGmailThreads(ctx, args = {}) {
  assertGmailPage(ctx.page, "listThreads");
  const limit = resultLimit(args.limit, "listThreads");
  return ctx.page.locator(THREAD_SELECTOR).evaluateAll(
    (rows, maximum) =>
      rows
        .map((row) => {
          const metadata = row.querySelector("[data-legacy-thread-id]");
          const sender = row.querySelector(
            ".yW span[email], .bA4 span[email], .yW",
          );
          const subject = row.querySelector(".bog");
          const snippet = row.querySelector(".y2");
          const date = row.querySelector(".xW span[title], .xW");
          return {
            id: metadata?.getAttribute("data-legacy-thread-id") || "",
            sender: sender?.getAttribute("email")
              ? `${sender.textContent?.trim() || ""} <${sender.getAttribute("email")}>`
              : sender?.textContent?.trim() || "",
            subject: subject?.textContent?.trim() || "",
            snippet: (snippet?.textContent || "")
              .replace(/^\s*[-–—]\s*/, "")
              .trim(),
            date:
              date?.getAttribute("title") || date?.textContent?.trim() || "",
            unread: row.classList.contains("zE"),
          };
        })
        .filter((thread) => thread.id)
        .slice(0, maximum),
    limit,
  );
}

export async function searchGmail(ctx, args = {}) {
  const query = nonEmptyString(args.query, "search requires a non-empty query");
  const limit = resultLimit(args.limit, "search");
  assertGmailPage(ctx.page, "search");

  const input = ctx.page.locator('input[name="q"]');
  await input.fill(query);
  await input.press("Enter");
  await ctx.page.waitForURL(/#search\//, { timeout: 30000 });
  const loading = ctx.page
    .locator(".J-J5-Ji:visible")
    .filter({ hasText: /^(正在提取邮件\.\.\.|Fetching mail\.\.\.)$/ })
    .first();
  await loading.waitFor({ state: "visible", timeout: 2000 }).catch(() => {});
  await loading.waitFor({ state: "hidden", timeout: 30000 });
  await ctx.page
    .locator(`${THREAD_SELECTOR}, .ae4.UI.aZ6:visible`)
    .first()
    .waitFor({ state: "visible", timeout: 30000 });
  return listGmailThreads(ctx, { limit });
}

export async function readGmailThread(ctx, args = {}) {
  const id = safeId(args.id, "readThread");
  assertGmailPage(ctx.page, "readThread");
  const row = ctx.page.locator(
    `${THREAD_SELECTOR}:has([data-legacy-thread-id="${id}"])`,
  );
  if ((await row.count()) === 0) {
    throw new Error(
      `readThread could not find ${JSON.stringify(id)} in the current Gmail list`,
    );
  }

  await ctx.egoBrowser.showTaskState("open Gmail thread");
  await row.click();
  const subject = ctx.page.locator("h2.hP");
  await subject.waitFor({ state: "visible", timeout: 30000 });
  const messages = await ctx.page.locator(".adn.ads").evaluateAll((items) =>
    items.map((item) => {
      const sender = item.querySelector(".gD");
      const date = item.querySelector(".g3");
      const body = item.querySelector(".a3s.aiL, .a3s");
      const email = sender?.getAttribute("email");
      return {
        sender: email
          ? `${sender?.textContent?.trim() || ""} <${email}>`
          : sender?.textContent?.trim() || "",
        date: date?.getAttribute("title") || date?.textContent?.trim() || "",
        text: body?.innerText?.trim() || body?.textContent?.trim() || "",
      };
    }),
  );
  return {
    id,
    subject: (await subject.textContent())?.trim() || "",
    messages,
  };
}

export async function createGmailDraft(ctx, args = {}) {
  const to = emailList(args.to, "createDraft requires at least one recipient");
  const cc = emailList(args.cc);
  const bcc = emailList(args.bcc);
  const subject = stringValue(args.subject, "createDraft requires subject");
  const body = stringValue(args.body, "createDraft requires body");
  assertGmailPage(ctx.page, "createDraft");

  await ctx.egoBrowser.showTaskState("compose Gmail draft");
  await ctx.page.locator('[role="button"][gh="cm"]').click();
  const compose = ctx.page
    .locator('[role="dialog"]:visible:has(input[name="subjectbox"])')
    .last();
  await compose.waitFor({ state: "visible", timeout: 10000 });
  await fillGmailRecipients(compose, "to", to);
  if (cc.length) {
    await compose
      .locator(
        '[aria-label^="添加抄送收件人"], [aria-label^="Add Cc recipients"]',
      )
      .click();
    await fillGmailRecipients(compose, "cc", cc);
  }
  if (bcc.length) {
    await compose
      .locator(
        '[aria-label^="添加密送收件人"], [aria-label^="Add Bcc recipients"]',
      )
      .click();
    await fillGmailRecipients(compose, "bcc", bcc);
  }
  const subjectInput = compose.locator('input[name="subjectbox"]');
  const bodyEditor = compose.locator(
    '[contenteditable="true"][role="textbox"]',
  );
  await subjectInput.fill(subject);
  await bodyEditor.fill(body);
  if ((await subjectInput.inputValue()) !== subject) {
    throw new Error("createDraft subject verification failed");
  }
  if ((await bodyEditor.innerText()) !== body) {
    throw new Error("createDraft body verification failed");
  }
  await ctx.page.waitForTimeout(2000);
  await ctx.egoBrowser.showTaskState("save Gmail draft");
  await compose
    .locator(
      '[aria-label^="保存并关闭"], [aria-label^="Save & close"], [aria-label^="Save and close"]',
    )
    .click();
  await compose.waitFor({ state: "hidden", timeout: 10000 });
  if (!/#drafts(?:\/|$)/.test(ctx.page.url())) {
    await ctx.egoBrowser.showTaskState("verify Gmail draft");
    await ctx.page.locator('a[href$="#drafts"]').first().click();
    await ctx.page.waitForURL(/#drafts(?:\/|$)/, { timeout: 30000 });
  }
  await ctx.page
    .locator(THREAD_SELECTOR)
    .filter({ hasText: subject })
    .first()
    .waitFor({ state: "visible", timeout: 30000 });
  return { to, cc, bcc, subject, body, drafted: true };
}

async function fillGmailRecipients(compose, kind, addresses) {
  const input = compose.locator(
    `input[name="${kind}"], [name="${kind}"] input[role="combobox"]`,
  );
  for (const address of addresses) {
    await input.fill(address);
    await input.press("Enter");
  }
}

function gmailInboxUrl(value) {
  try {
    const current = new URL(value);
    const match = current.pathname.match(/^\/mail\/u\/(\d+)\//);
    if (current.hostname === "mail.google.com" && match) {
      return `https://mail.google.com/mail/u/${match[1]}/#inbox`;
    }
  } catch {
    // Fall back to the first logged-in Gmail account.
  }
  return "https://mail.google.com/mail/u/0/#inbox";
}

function assertGmailPage(page, operation) {
  let url;
  try {
    url = new URL(page.url());
  } catch {
    throw new Error(`${operation} requires an active Gmail page`);
  }
  if (url.protocol !== "https:" || url.hostname !== "mail.google.com") {
    throw new Error(`${operation} requires an active Gmail page`);
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
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]+$/.test(value)) {
    throw new Error(`${operation} requires a valid thread id`);
  }
  return value;
}

function nonEmptyString(value, message) {
  if (typeof value !== "string" || !value.trim()) throw new Error(message);
  return value.trim();
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
