import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const functionsUrl = new URL(
  "../../../skills/ego-browser/learnings/google/gmail/functions.js",
  import.meta.url,
);
const manifestUrl = new URL(
  "../../../skills/ego-browser/learnings/google/manifest.json",
  import.meta.url,
);

async function loadFunctions() {
  try {
    return await import(`${functionsUrl.href}?test=${Date.now()}`);
  } catch (error) {
    assert.fail(`Gmail preset functions failed to load: ${error.message}`);
  }
}

function gmailPage() {
  const calls = [];
  let currentUrl = "about:blank";
  let query = "";
  let openedThreadId = "";
  const rows = [
    {
      id: "abc123",
      sender: "Ada <ada@example.com>",
      subject: "Weekly update",
      snippet: "A short preview",
      date: "2026-08-07 09:00",
      unread: true,
    },
    {
      id: "def456",
      sender: "Lin <lin@example.com>",
      subject: "Launch notes",
      snippet: "Ready for review",
      date: "2026-08-06 18:00",
      unread: false,
    },
  ];
  const searchInput = {
    async waitFor(options) {
      calls.push(["search.waitFor", options]);
    },
    async fill(value) {
      calls.push(["search.fill", value]);
      query = value;
    },
    async press(key) {
      calls.push(["search.press", key]);
      if (key === "Enter")
        currentUrl = `https://mail.google.com/mail/u/0/#search/${query}`;
    },
  };
  const composeButton = {
    async waitFor(options) {
      calls.push(["compose.waitFor", options]);
    },
  };
  const searchLoading = {
    filter(options) {
      calls.push(["loading.filter", String(options.hasText)]);
      return this;
    },
    first() {
      return this;
    },
    async waitFor(options) {
      calls.push(["loading.waitFor", options]);
    },
  };
  const searchResults = {
    first() {
      return this;
    },
    async waitFor(options) {
      calls.push(["results.waitFor", options]);
    },
  };
  const rowList = {
    async evaluateAll(_fn, limit) {
      calls.push(["rows.evaluateAll", limit]);
      return rows.slice(0, limit);
    },
  };
  const subject = {
    async waitFor(options) {
      calls.push(["subject.waitFor", options]);
    },
    async textContent() {
      return openedThreadId === "abc123" ? "Weekly update" : "Launch notes";
    },
  };
  const messages = {
    async evaluateAll() {
      calls.push(["messages.evaluateAll"]);
      return [
        {
          sender: "Ada <ada@example.com>",
          date: "2026-08-07 09:00",
          text: "Full message body",
        },
      ];
    },
  };

  return {
    calls,
    query: () => query,
    async goto(url, options) {
      calls.push(["goto", url, options]);
      currentUrl = url;
    },
    async waitForURL(pattern, options) {
      calls.push(["waitForURL", pattern, options]);
      assert.match(currentUrl, pattern);
    },
    async waitForTimeout(milliseconds) {
      calls.push(["waitForTimeout", milliseconds]);
    },
    locator(selector) {
      if (selector === 'input[name="q"]') return searchInput;
      if (selector === '[role="button"][gh="cm"]') return composeButton;
      if (selector === ".J-J5-Ji:visible") return searchLoading;
      if (selector === "tr.zA:visible, .ae4.UI.aZ6:visible")
        return searchResults;
      if (selector === "tr.zA:visible") return rowList;
      if (selector === "h2.hP") return subject;
      if (selector === ".adn.ads") return messages;
      const match = selector.match(/data-legacy-thread-id="([^"]+)"/);
      if (match) {
        return {
          async count() {
            return rows.some((row) => row.id === match[1]) ? 1 : 0;
          },
          async click() {
            calls.push(["thread.click", match[1]]);
            openedThreadId = match[1];
            currentUrl = `https://mail.google.com/mail/u/0/#inbox/${match[1]}`;
          },
        };
      }
      throw new Error(`unexpected locator: ${selector}`);
    },
    url() {
      return currentUrl;
    },
  };
}

function gmailDraftPage() {
  const calls = [];
  let currentUrl = "https://mail.google.com/mail/u/0/#inbox";
  const values = { to: [], cc: [], bcc: [], subject: "", body: "" };
  const recipient = (kind) => ({
    async fill(value) {
      calls.push([`${kind}.fill`, value]);
      values[kind].push(value);
    },
    async press(key) {
      calls.push([`${kind}.press`, key]);
    },
  });
  const subject = {
    async fill(value) {
      calls.push(["subject.fill", value]);
      values.subject = value;
    },
    async inputValue() {
      return values.subject;
    },
  };
  const body = {
    async fill(value) {
      calls.push(["body.fill", value]);
      values.body = value;
    },
    async innerText() {
      return values.body;
    },
  };
  const compose = {
    first() {
      return this;
    },
    last() {
      return this;
    },
    async waitFor(options) {
      calls.push(["draft.waitFor", options]);
    },
    locator(selector) {
      const recipientMatch = selector.match(
        /^input\[name="(to|cc|bcc)"\], \[name="(to|cc|bcc)"\] input\[role="combobox"\]$/,
      );
      if (recipientMatch)
        return recipient(recipientMatch[1] || recipientMatch[2]);
      if (selector === 'input[name="subjectbox"]') return subject;
      if (selector === '[contenteditable="true"][role="textbox"]') return body;
      if (
        selector ===
        '[aria-label^="添加抄送收件人"], [aria-label^="Add Cc recipients"]'
      ) {
        return {
          async click() {
            calls.push(["recipient.toggle", "cc"]);
          },
        };
      }
      if (
        selector ===
        '[aria-label^="添加密送收件人"], [aria-label^="Add Bcc recipients"]'
      ) {
        return {
          async click() {
            calls.push(["recipient.toggle", "bcc"]);
          },
        };
      }
      if (
        selector ===
        '[aria-label^="保存并关闭"], [aria-label^="Save & close"], [aria-label^="Save and close"]'
      ) {
        return {
          async click() {
            calls.push(["draft.close"]);
          },
        };
      }
      throw new Error(`unexpected compose locator: ${selector}`);
    },
  };
  const draftRows = {
    filter(options) {
      calls.push(["draftRows.filter", options.hasText]);
      return this;
    },
    first() {
      return this;
    },
    async waitFor(options) {
      calls.push(["draftRows.waitFor", options]);
    },
  };

  return {
    calls,
    values,
    async waitForURL(pattern, options) {
      calls.push(["waitForURL", pattern, options]);
      assert.match(currentUrl, pattern);
    },
    async waitForTimeout(milliseconds) {
      calls.push(["waitForTimeout", milliseconds]);
    },
    locator(selector) {
      if (selector === '[role="button"][gh="cm"]') {
        return {
          async click() {
            calls.push(["compose.click"]);
          },
        };
      }
      if (selector === '[role="dialog"]:visible:has(input[name="subjectbox"])')
        return compose;
      if (selector === 'a[href$="#drafts"]') {
        return {
          first() {
            return this;
          },
          async click() {
            calls.push(["drafts.click"]);
            currentUrl = "https://mail.google.com/mail/u/0/#drafts";
          },
        };
      }
      if (selector === "tr.zA:visible") return draftRows;
      throw new Error(`unexpected locator: ${selector}`);
    },
    url() {
      return currentUrl;
    },
  };
}

test("openGmailInbox opens the logged-in inbox and waits for Gmail", async () => {
  const { openGmailInbox } = await loadFunctions();
  const page = gmailPage();

  assert.deepEqual(await openGmailInbox({ page }), {
    url: "https://mail.google.com/mail/u/0/#inbox",
  });
  assert.deepEqual(page.calls.slice(0, 4), [
    [
      "goto",
      "https://mail.google.com/mail/u/0/#inbox",
      { waitUntil: "domcontentloaded", timeout: 30000 },
    ],
    ["waitForURL", /#inbox/, { timeout: 30000 }],
    ["search.waitFor", { state: "visible", timeout: 30000 }],
    ["compose.waitFor", { state: "visible", timeout: 30000 }],
  ]);
});

test("openGmailInbox does not reload an inbox that is already open", async () => {
  const { openGmailInbox } = await loadFunctions();
  const page = gmailPage();
  await page.goto("https://mail.google.com/mail/u/0/#inbox", {});
  page.calls.length = 0;

  await openGmailInbox({ page });

  assert.equal(
    page.calls.some((call) => call[0] === "goto"),
    false,
  );
  assert.ok(page.calls.some((call) => call[0] === "search.waitFor"));
  assert.ok(page.calls.some((call) => call[0] === "compose.waitFor"));
});

test("listGmailThreads returns bounded structured thread summaries", async () => {
  const { listGmailThreads } = await loadFunctions();
  const page = gmailPage();
  await page.goto("https://mail.google.com/mail/u/0/#inbox", {});

  assert.deepEqual(await listGmailThreads({ page }, { limit: 1 }), [
    {
      id: "abc123",
      sender: "Ada <ada@example.com>",
      subject: "Weekly update",
      snippet: "A short preview",
      date: "2026-08-07 09:00",
      unread: true,
    },
  ]);
});

test("searchGmail searches then returns matching thread summaries", async () => {
  const { searchGmail } = await loadFunctions();
  const page = gmailPage();
  await page.goto("https://mail.google.com/mail/u/0/#inbox", {});

  const results = await searchGmail({ page }, { query: "from:ada", limit: 1 });

  assert.equal(page.query(), "from:ada");
  assert.equal(results[0].id, "abc123");
  assert.ok(page.calls.some((call) => call[0] === "search.press"));
  assert.ok(page.calls.some((call) => call[0] === "loading.waitFor"));
  assert.ok(page.calls.some((call) => call[0] === "results.waitFor"));
});

test("readGmailThread opens an id returned by listThreads and reads messages", async () => {
  const { readGmailThread } = await loadFunctions();
  const page = gmailPage();
  await page.goto("https://mail.google.com/mail/u/0/#inbox", {});
  const states = [];

  assert.deepEqual(
    await readGmailThread(
      {
        page,
        egoBrowser: { showTaskState: async (state) => states.push(state) },
      },
      { id: "abc123" },
    ),
    {
      id: "abc123",
      subject: "Weekly update",
      messages: [
        {
          sender: "Ada <ada@example.com>",
          date: "2026-08-07 09:00",
          text: "Full message body",
        },
      ],
    },
  );
  assert.deepEqual(states, ["open Gmail thread"]);
});

test("createGmailDraft fills recipients and content, then saves and closes", async () => {
  const { createGmailDraft } = await loadFunctions();
  const page = gmailDraftPage();
  const states = [];

  assert.deepEqual(
    await createGmailDraft(
      {
        page,
        egoBrowser: { showTaskState: async (state) => states.push(state) },
      },
      {
        to: ["to@example.com"],
        cc: "cc@example.com",
        bcc: "bcc@example.com",
        subject: "Draft subject",
        body: "Draft body",
      },
    ),
    {
      to: ["to@example.com"],
      cc: ["cc@example.com"],
      bcc: ["bcc@example.com"],
      subject: "Draft subject",
      body: "Draft body",
      drafted: true,
    },
  );
  assert.deepEqual(page.values, {
    to: ["to@example.com"],
    cc: ["cc@example.com"],
    bcc: ["bcc@example.com"],
    subject: "Draft subject",
    body: "Draft body",
  });
  assert.deepEqual(states, [
    "compose Gmail draft",
    "save Gmail draft",
    "verify Gmail draft",
  ]);
});

test("createGmailDraft verifies the draft is persisted before returning", async () => {
  const { createGmailDraft } = await loadFunctions();
  const page = gmailDraftPage();
  const states = [];

  await createGmailDraft(
    {
      page,
      egoBrowser: { showTaskState: async (state) => states.push(state) },
    },
    {
      to: "to@example.com",
      subject: "Persisted draft",
      body: "Draft body",
    },
  );

  assert.ok(
    page.calls.some((call) => call[0] === "waitForTimeout" && call[1] === 2000),
  );
  assert.ok(
    page.calls.some(
      (call) => call[0] === "draft.waitFor" && call[1]?.state === "hidden",
    ),
  );
  assert.ok(page.calls.some((call) => call[0] === "drafts.click"));
  assert.ok(
    page.calls.some(
      (call) => call[0] === "draftRows.filter" && call[1] === "Persisted draft",
    ),
  );
  assert.ok(
    page.calls.some(
      (call) => call[0] === "draftRows.waitFor" && call[1]?.state === "visible",
    ),
  );
  assert.deepEqual(states, [
    "compose Gmail draft",
    "save Gmail draft",
    "verify Gmail draft",
  ]);
});

test("Gmail manifest and prompt declare the five approved draft-only tools", async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  const prompt = await readFile(new URL("prompt.md", functionsUrl), "utf8");

  for (const tool of [
    "gmail_open_inbox",
    "gmail_list_threads",
    "gmail_search",
    "gmail_read_thread",
    "gmail_create_draft",
  ]) {
    assert.ok(manifest.nodeTools[tool], `missing ${tool}`);
  }
  assert.doesNotMatch(JSON.stringify(manifest.nodeTools), /send_email/i);
  for (const name of [
    "openInbox",
    "listThreads",
    "search",
    "readThread",
    "createDraft",
  ]) {
    assert.match(prompt, new RegExp(`google\\.gmail\\.${name}`));
  }
});
