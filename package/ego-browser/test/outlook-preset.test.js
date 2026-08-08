import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const functionsUrl = new URL(
  "../../../skills/ego-browser/learnings/microsoft/outlook/functions.js",
  import.meta.url,
);
const manifestUrl = new URL(
  "../../../skills/ego-browser/learnings/microsoft/manifest.json",
  import.meta.url,
);

async function loadFunctions() {
  try {
    return await import(`${functionsUrl.href}?test=${Date.now()}`);
  } catch (error) {
    assert.fail(`Outlook preset functions failed to load: ${error.message}`);
  }
}

function outlookPage() {
  const calls = [];
  let currentUrl = "about:blank";
  let query = "";
  let openedId = "";
  let searchActive = true;
  let searchResultsReady = true;
  const messages = [
    {
      id: "conversation-1",
      sender: "Ada <ada@example.com>",
      subject: "Weekly update",
      preview: "Ready for review",
      date: "2026-08-07 09:00",
      unread: true,
    },
    {
      id: "conversation-2",
      sender: "Lin <lin@example.com>",
      subject: "Launch notes",
      preview: "Final details",
      date: "2026-08-06 18:00",
      unread: false,
    },
  ];
  const newMail = {
    first() {
      return this;
    },
    async waitFor(options) {
      calls.push(["newMail.waitFor", options]);
    },
  };
  const search = {
    async waitFor(options) {
      calls.push(["search.waitFor", options]);
    },
    async fill(value) {
      calls.push(["search.fill", value]);
      query = value;
    },
    async press(key, options) {
      calls.push(["search.press", key, options]);
      if (key === "Enter") {
        searchActive = true;
        searchResultsReady = false;
      }
    },
  };
  const exitSearch = {
    async count() {
      return searchActive ? 1 : 0;
    },
    async click() {
      calls.push(["exitSearch.click"]);
      searchActive = false;
    },
    async waitFor(options) {
      calls.push(["exitSearch.waitFor", options]);
    },
  };
  const searching = {
    first() {
      return this;
    },
    async waitFor(options) {
      calls.push(["searching.waitFor", options]);
    },
  };
  const rowList = {
    first() {
      return this;
    },
    or() {
      calls.push(["messages.or"]);
      return this;
    },
    async waitFor(options) {
      calls.push(["messages.waitFor", options]);
      searchResultsReady = true;
    },
    async evaluateAll(_fn, limit) {
      calls.push(["messages.evaluateAll", limit]);
      return searchResultsReady ? messages.slice(0, limit) : [];
    },
  };
  const noResults = {
    first() {
      return this;
    },
    async waitFor(options) {
      calls.push(["noResults.waitFor", options]);
      return new Promise(() => {});
    },
  };
  const readingPane = {
    last() {
      return this;
    },
    getByRole(role) {
      if (role === "heading") {
        return {
          first() {
            return this;
          },
          async waitFor(options) {
            calls.push(["subject.waitFor", options]);
          },
          async innerText() {
            return openedId === "conversation-1"
              ? "Weekly update"
              : "Launch notes";
          },
        };
      }
      throw new Error(`unexpected reading pane role: ${role}`);
    },
    locator(selector) {
      if (selector === '[aria-label^="发件人:"], [aria-label^="From:"]') {
        return {
          first() {
            return this;
          },
          async getAttribute(name) {
            assert.equal(name, "aria-label");
            return "From: Ada <ada@example.com>";
          },
        };
      }
      if (selector === '[data-testid="SentReceivedSavedTime"]') {
        return {
          first() {
            return this;
          },
          async getAttribute(name) {
            assert.equal(name, "title");
            return "2026-08-07 09:00";
          },
          async innerText() {
            return "09:00";
          },
        };
      }
      if (selector === '[role="document"]') {
        return {
          first() {
            return this;
          },
          async innerText() {
            return "Full Outlook message body";
          },
        };
      }
      throw new Error(`unexpected reading pane locator: ${selector}`);
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
    getByRole(role, options = {}) {
      if (role === "button" && /新邮件|New mail/.test(String(options.name))) {
        return newMail;
      }
      if (
        role === "button" &&
        /退出搜索|Exit search/.test(String(options.name))
      ) {
        return exitSearch;
      }
      if (role === "main") return readingPane;
      throw new Error(`unexpected role: ${role}`);
    },
    getByText(pattern) {
      if (pattern.test("未找到任何内容。")) return noResults;
      assert.match("Searching...", pattern);
      return searching;
    },
    locator(selector) {
      if (selector === "#topSearchInput") return search;
      if (
        selector ===
        '[role="option"][data-convid], [role="option"][data-itemid]'
      ) {
        return rowList;
      }
      const match = selector.match(/data-(?:convid|itemid)="([^"]+)"/);
      if (match) {
        return {
          async count() {
            return messages.some((message) => message.id === match[1]) ? 1 : 0;
          },
          async click() {
            calls.push(["message.click", match[1]]);
            openedId = match[1];
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

function outlookDraftPage() {
  const calls = [];
  const values = { to: [], subject: "", body: "" };
  let composeOpen = false;
  const recipient = {
    async fill(value) {
      calls.push(["to.fill", value]);
      values.to.push(value);
    },
    async press(key) {
      calls.push(["to.press", key]);
    },
  };
  const subject = {
    async fill(value) {
      calls.push(["subject.fill", value]);
      values.subject = value;
    },
    async inputValue() {
      return values.subject;
    },
    async waitFor(options) {
      calls.push(["subject.waitFor", options]);
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
  const savedStatus = {
    first() {
      return this;
    },
    last() {
      return this;
    },
    async waitFor(options) {
      calls.push(["savedStatus.waitFor", options]);
    },
  };
  const pane = {
    getByRole(role, options = {}) {
      if (role === "textbox" && /主题|Subject/.test(String(options.name))) {
        return subject;
      }
      if (
        role === "textbox" &&
        /邮件正文|Message body/.test(String(options.name))
      ) {
        return body;
      }
      throw new Error(`unexpected pane role: ${role}`);
    },
    getByText(pattern) {
      assert.match("Saved to Drafts", pattern);
      return savedStatus;
    },
    locator(selector) {
      if (selector === '[contenteditable="true"].EditorClass') return recipient;
      throw new Error(`unexpected pane locator: ${selector}`);
    },
  };

  return {
    calls,
    values,
    async goto(url, options) {
      calls.push(["goto", url, options]);
      composeOpen = false;
    },
    async waitForTimeout(milliseconds) {
      calls.push(["waitForTimeout", milliseconds]);
    },
    keyboard: {
      async press(key) {
        calls.push(["keyboard.press", key]);
      },
    },
    getByRole(role, options = {}) {
      if (role === "button" && /新邮件|New mail/.test(String(options.name))) {
        return {
          first() {
            return this;
          },
          async click() {
            calls.push(["newMail.click"]);
            composeOpen = true;
          },
        };
      }
      if (
        role === "button" &&
        options.name instanceof RegExp &&
        options.name.test(`编辑 ${values.subject} 关闭`)
      ) {
        return {
          last() {
            return this;
          },
          async waitFor(waitOptions) {
            calls.push(["draft.close.waitFor", waitOptions]);
            if (waitOptions.state === "hidden") {
              throw new Error("another Outlook close button remains visible");
            }
          },
          async click(clickOptions) {
            calls.push(["draft.close", clickOptions]);
            composeOpen = false;
          },
        };
      }
      if (role === "main") {
        assert.equal(composeOpen, true);
        return {
          last() {
            return pane;
          },
        };
      }
      if (role === "alertdialog") {
        return {
          async count() {
            return 0;
          },
        };
      }
      throw new Error(`unexpected role: ${role}`);
    },
    url() {
      return "https://outlook.live.com/mail/0/";
    },
  };
}

test("openOutlookInbox opens personal Outlook and waits for mail controls", async () => {
  const { openOutlookInbox } = await loadFunctions();
  const page = outlookPage();

  assert.deepEqual(await openOutlookInbox({ page }), {
    url: "https://outlook.live.com/mail/0/",
  });
});

test("listOutlookMessages returns bounded message summaries", async () => {
  const { listOutlookMessages } = await loadFunctions();
  const page = outlookPage();
  await page.goto("https://outlook.live.com/mail/0/", {});

  assert.deepEqual(await listOutlookMessages({ page }, { limit: 1 }), [
    {
      id: "conversation-1",
      sender: "Ada <ada@example.com>",
      subject: "Weekly update",
      preview: "Ready for review",
      date: "2026-08-07 09:00",
      unread: true,
    },
  ]);
});

test("listOutlookMessages recognizes Outlook's whitespace-separated unread label", async () => {
  const { listOutlookMessages } = await loadFunctions();
  const values = {
    sender: { textContent: "Ada <ada@example.com>" },
    subject: { textContent: "Weekly update" },
    preview: { textContent: "Ready for review" },
    date: {
      textContent: "09:00",
      getAttribute(name) {
        return name === "title" ? "2026-08-07 09:00" : null;
      },
    },
  };
  const item = {
    offsetWidth: 1,
    offsetHeight: 0,
    getClientRects() {
      return [];
    },
    getAttribute(name) {
      if (name === "aria-label") return "未读 Ada Weekly update 09:00";
      if (name === "data-convid") return "conversation-1";
      return null;
    },
    querySelector(selector) {
      if (selector.includes("message-sender")) return values.sender;
      if (selector.includes("message-subject")) return values.subject;
      if (selector.includes("message-preview")) return values.preview;
      if (selector.includes("message-date")) return values.date;
      return null;
    },
  };
  const page = {
    url() {
      return "https://outlook.live.com/mail/0/";
    },
    locator() {
      return {
        async evaluateAll(callback, limit) {
          return callback([item], limit);
        },
      };
    },
  };

  const [message] = await listOutlookMessages({ page }, { limit: 1 });
  assert.equal(message.unread, true);
});

test("searchOutlook searches and returns matching message summaries", async () => {
  const { searchOutlook } = await loadFunctions();
  const page = outlookPage();
  await page.goto("https://outlook.live.com/mail/0/", {});

  const results = await searchOutlook(
    { page },
    { query: "from:ada", limit: 1 },
  );

  assert.equal(page.query(), "from:ada");
  assert.equal(results[0].id, "conversation-1");
  assert.ok(
    page.calls.some(
      (call) => call[0] === "search.press" && call[2]?.noWaitAfter === true,
    ),
  );
  assert.ok(
    page.calls.some(
      (call) =>
        call[0] === "exitSearch.waitFor" && call[1]?.state === "visible",
    ),
  );
  assert.ok(page.calls.some((call) => call[0] === "exitSearch.click"));
  assert.ok(
    page.calls.some(
      (call) => call[0] === "exitSearch.waitFor" && call[1]?.state === "hidden",
    ),
  );
  assert.ok(!page.calls.some((call) => call[0] === "waitForURL"));
  assert.ok(
    page.calls.some(
      (call) => call[0] === "searching.waitFor" && call[1]?.state === "visible",
    ),
  );
  assert.ok(
    page.calls.some(
      (call) => call[0] === "searching.waitFor" && call[1]?.state === "hidden",
    ),
  );
  assert.ok(
    page.calls.some(
      (call) => call[0] === "messages.waitFor" && call[1]?.state === "visible",
    ),
  );
  assert.ok(page.calls.some((call) => call[0] === "messages.or"));
  assert.ok(!page.calls.some((call) => call[0] === "noResults.waitFor"));
});

test("readOutlookMessage opens an id returned by listMessages and reads it", async () => {
  const { readOutlookMessage } = await loadFunctions();
  const page = outlookPage();
  await page.goto("https://outlook.live.com/mail/0/", {});

  assert.deepEqual(
    await readOutlookMessage(
      { page, egoBrowser: { showTaskState: async () => {} } },
      { id: "conversation-1" },
    ),
    {
      id: "conversation-1",
      sender: "Ada <ada@example.com>",
      subject: "Weekly update",
      date: "2026-08-07 09:00",
      text: "Full Outlook message body",
    },
  );
});

test("createOutlookDraft fills an ordinary recipient, subject, and body without sending", async () => {
  const { createOutlookDraft } = await loadFunctions();
  const page = outlookDraftPage();
  const states = [];

  assert.deepEqual(
    await createOutlookDraft(
      {
        page,
        egoBrowser: { showTaskState: async (state) => states.push(state) },
      },
      {
        to: "to@example.com",
        subject: "Draft subject",
        body: "Draft body",
      },
    ),
    {
      to: ["to@example.com"],
      cc: [],
      bcc: [],
      subject: "Draft subject",
      body: "Draft body",
      drafted: true,
    },
  );
  assert.deepEqual(page.values, {
    to: ["to@example.com"],
    subject: "Draft subject",
    body: "Draft body",
  });
  assert.deepEqual(states, [
    "compose Outlook draft",
    "save Outlook draft",
    "close saved Outlook draft",
  ]);
  assert.ok(
    page.calls.some(
      (call) =>
        call[0] === "savedStatus.waitFor" && call[1].state === "visible",
    ),
  );
  assert.ok(page.calls.some((call) => call[0] === "draft.close"));
  assert.ok(
    page.calls.some(
      (call) => call[0] === "subject.waitFor" && call[1].state === "hidden",
    ),
  );
  assert.ok(!page.calls.some((call) => call[0] === "goto"));
});

test("Outlook manifest and prompt declare the five approved draft-only tools", async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  const prompt = await readFile(new URL("prompt.md", functionsUrl), "utf8");

  for (const tool of [
    "outlook_open_inbox",
    "outlook_list_messages",
    "outlook_search",
    "outlook_read_message",
    "outlook_create_draft",
  ]) {
    assert.ok(manifest.nodeTools[tool], `missing ${tool}`);
  }
  assert.doesNotMatch(JSON.stringify(manifest.nodeTools), /send_email/i);
  for (const name of [
    "openInbox",
    "listMessages",
    "search",
    "readMessage",
    "createDraft",
  ]) {
    assert.match(prompt, new RegExp(`microsoft\\.outlook\\.${name}`));
  }
});
