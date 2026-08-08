import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const functionsUrl = new URL(
  "../../../skills/ego-browser/learnings/notion/pages/functions.js",
  import.meta.url,
);
const manifestUrl = new URL(
  "../../../skills/ego-browser/learnings/notion/manifest.json",
  import.meta.url,
);

async function loadFunctions() {
  try {
    return await import(`${functionsUrl.href}?test=${Date.now()}`);
  } catch (error) {
    assert.fail(
      `Notion Pages preset functions failed to load: ${error.message}`,
    );
  }
}

function notionPage() {
  const calls = [];
  let currentUrl = "https://app.notion.com/p/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  let title = "Project notes";
  let body = ["Alpha note", "Beta note"];
  let query = "";
  let activeBodyIndex = -1;
  const titleEditor = {
    async waitFor(options) {
      calls.push(["title.waitFor", options]);
    },
    async innerText() {
      calls.push(["title.innerText"]);
      return title;
    },
    async fill(value) {
      calls.push(["title.fill", value]);
      title = value;
    },
  };
  const bodyEditors = {
    async count() {
      return body.length;
    },
    async evaluateAll() {
      calls.push(["body.evaluateAll"]);
      return [...body];
    },
    nth(index) {
      return bodyEditor(index);
    },
    last() {
      return bodyEditor(body.length - 1);
    },
  };
  function bodyEditor(index) {
    return {
      async innerText() {
        return body[index] ?? "";
      },
      async click() {
        calls.push(["body.click", index]);
        activeBodyIndex = index;
      },
      async fill(value) {
        calls.push(["body.fill", index, value]);
        body[index] = value;
      },
    };
  }
  const root = {
    async waitFor(options) {
      calls.push(["root.waitFor", options]);
    },
    async evaluate() {
      calls.push(["root.caretEnd"]);
      activeBodyIndex = body.length;
    },
  };
  const searchDialog = {
    getByRole(role) {
      if (role === "combobox") {
        return {
          async fill(value) {
            calls.push(["search.fill", value]);
            query = value;
          },
        };
      }
      throw new Error(`unexpected dialog role: ${role}`);
    },
    locator(selector) {
      if (
        selector === '[role="progressbar"]:visible, [aria-busy="true"]:visible'
      ) {
        return {
          first() {
            return this;
          },
          async waitFor(options) {
            calls.push(["search.progress", options]);
          },
        };
      }
      if (selector === 'a[href*="/p/"]:visible, [role="alert"]:visible') {
        return {
          first() {
            return this;
          },
          async waitFor(options) {
            calls.push(["search.complete", options]);
          },
        };
      }
      assert.equal(selector, 'a[href*="/p/"]');
      return {
        async evaluateAll(_fn, limit) {
          calls.push(["search.results", limit]);
          return [
            {
              title: "Project notes",
              url: "https://app.notion.com/p/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            },
          ].slice(0, limit);
        },
      };
    },
  };

  return {
    calls,
    body: () => [...body],
    setBody(value) {
      body = [...value];
    },
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
    keyboard: {
      async press(key) {
        calls.push(["keyboard.press", key]);
        if (key === "Enter") {
          const insertAt =
            activeBodyIndex < 0 ? body.length : activeBodyIndex + 1;
          body.splice(insertAt, 0, "");
          activeBodyIndex = insertAt;
        }
      },
    },
    locator(selector) {
      if (selector === 'main h1[data-content-editable-leaf="true"]') {
        return titleEditor;
      }
      if (selector === 'main [data-content-editable-leaf="true"]:not(h1)') {
        return bodyEditors;
      }
      if (selector === 'main [data-content-editable-root="true"]') return root;
      throw new Error(`unexpected locator: ${selector}`);
    },
    getByRole(role, options = {}) {
      if (role === "button" && /搜索|Search/.test(String(options.name))) {
        return {
          first() {
            return this;
          },
          async click() {
            calls.push(["search.click"]);
          },
        };
      }
      if (role === "dialog") return searchDialog;
      throw new Error(`unexpected role: ${role}`);
    },
    url() {
      return currentUrl;
    },
  };
}

function notionCreatePage({ resetFirstTitleWrite = false } = {}) {
  const page = notionPage();
  page._body = page.body;
  let currentUrl = page.url();
  let currentTitle = "Parent page";
  let pendingNewTitleReads = 0;
  let pendingTitleResetWaits = 0;
  let titleWriteCount = 0;
  let moveDialogOpen = false;
  const calls = page.calls;
  const originalLocator = page.locator.bind(page);
  const originalGetByRole = page.getByRole.bind(page);
  const titleEditor = {
    async waitFor(options) {
      calls.push(["title.waitFor", options]);
    },
    async innerText() {
      if (pendingNewTitleReads > 0) {
        pendingNewTitleReads -= 1;
        if (pendingNewTitleReads === 0) currentTitle = "";
      }
      return currentTitle;
    },
    async fill(value) {
      calls.push(["title.fill", value]);
      titleWriteCount += 1;
      if (pendingNewTitleReads > 0) {
        pendingNewTitleReads = 0;
        currentTitle = "";
      } else {
        currentTitle = value;
        if (resetFirstTitleWrite && titleWriteCount === 1) {
          pendingTitleResetWaits = 2;
        }
      }
    },
  };
  const moveDialog = {
    last() {
      return this;
    },
    getByRole(role, options = {}) {
      if (role === "menuitem") {
        assert.equal(options.name, undefined);
        return {
          filter(filterOptions) {
            calls.push(["move.result.filter", filterOptions.hasText]);
            return this;
          },
          first() {
            return this;
          },
          async waitFor(waitOptions) {
            calls.push(["move.result.waitFor", waitOptions]);
          },
          async press(key) {
            calls.push(["move.choose", key]);
            moveDialogOpen = false;
          },
        };
      }
      throw new Error(`unexpected move role: ${role}`);
    },
  };
  const banner = {
    getByRole(role) {
      assert.equal(role, "button");
      return {
        first() {
          return this;
        },
        async press(key) {
          calls.push(["location.press", key]);
          moveDialogOpen = true;
        },
      };
    },
  };

  page.goto = async (url, options) => {
    calls.push(["goto", url, options]);
    currentUrl = url;
    currentTitle = url.includes("parent") ? "Parent page" : currentTitle;
  };
  page.waitForURL = async (pattern, options) => {
    calls.push(["waitForURL", pattern, options]);
    if (pattern instanceof RegExp) assert.match(currentUrl, pattern);
    else assert.equal(pattern(new URL(currentUrl)), true);
  };
  page.waitForTimeout = async (milliseconds) => {
    calls.push(["waitForTimeout", milliseconds]);
    if (pendingTitleResetWaits > 0) {
      pendingTitleResetWaits -= 1;
      if (pendingTitleResetWaits === 0) currentTitle = "";
    }
  };
  page.url = () => currentUrl;
  page.locator = (selector) => {
    if (selector === 'main h1[data-content-editable-leaf="true"]') {
      return titleEditor;
    }
    return originalLocator(selector);
  };
  page.getByRole = (role, options = {}) => {
    if (role === "button" && /新页面|New page/.test(String(options.name))) {
      return {
        first() {
          return this;
        },
        async click() {
          calls.push(["newPage.click"]);
        },
      };
    }
    if (role === "menuitem" && /页面|Page/.test(String(options.name))) {
      return {
        async waitFor(waitOptions) {
          calls.push(["pageType.waitFor", waitOptions]);
        },
        async click() {
          calls.push(["pageType.click"]);
          currentUrl =
            "https://app.notion.com/p/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
          pendingNewTitleReads = 2;
          moveDialogOpen = true;
          page.setBody([]);
        },
      };
    }
    if (role === "banner") return banner;
    if (role === "dialog") return moveDialog;
    return originalGetByRole(role, options);
  };
  page.getByPlaceholder = () => ({
    async count() {
      return moveDialogOpen ? 1 : 0;
    },
    async waitFor(options) {
      calls.push(["move.search.waitFor", options]);
    },
    async fill(value) {
      calls.push(["move.search", value]);
    },
  });
  return page;
}

test("openNotionPage opens a Notion page and waits for its title", async () => {
  const { openNotionPage } = await loadFunctions();
  const page = notionPage();
  const url = "https://app.notion.com/p/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  assert.deepEqual(await openNotionPage({ page }, { url }), {
    url,
    title: "Project notes",
  });
});

test("searchNotionPages returns page titles and URLs", async () => {
  const { searchNotionPages } = await loadFunctions();
  const page = notionPage();

  assert.deepEqual(
    await searchNotionPages({ page }, { query: "project", limit: 5 }),
    [
      {
        title: "Project notes",
        url: "https://app.notion.com/p/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
    ],
  );
  assert.equal(page.query(), "project");
  assert.ok(page.calls.some((call) => call[0] === "search.progress"));
  assert.ok(page.calls.some((call) => call[0] === "search.complete"));
});

test("readNotionPage returns title, URL, and plain block text", async () => {
  const { readNotionPage } = await loadFunctions();
  const page = notionPage();

  assert.deepEqual(await readNotionPage({ page }), {
    url: "https://app.notion.com/p/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    title: "Project notes",
    text: "Alpha note\nBeta note",
  });
});

test("setNotionPageTitle updates and verifies the page title", async () => {
  const { setNotionPageTitle } = await loadFunctions();
  const page = notionPage();

  assert.deepEqual(
    await setNotionPageTitle(
      { page, egoBrowser: { showTaskState: async () => {} } },
      { title: "Weekly notes" },
    ),
    {
      previousTitle: "Project notes",
      title: "Weekly notes",
      changed: true,
      saved: true,
    },
  );
});

test("appendNotionPageText appends one or more plain-text blocks", async () => {
  const { appendNotionPageText } = await loadFunctions();
  const page = notionPage();

  assert.deepEqual(
    await appendNotionPageText(
      { page, egoBrowser: { showTaskState: async () => {} } },
      { text: "Gamma note\nDelta note" },
    ),
    {
      url: "https://app.notion.com/p/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      title: "Project notes",
      text: "Alpha note\nBeta note\nGamma note\nDelta note",
      appendedText: "Gamma note\nDelta note",
      changed: true,
      saved: true,
    },
  );
});

test("appendNotionPageText ignores the empty starter block on a new page", async () => {
  const { appendNotionPageText } = await loadFunctions();
  const page = notionPage();
  page.setBody([""]);

  const result = await appendNotionPageText(
    { page, egoBrowser: { showTaskState: async () => {} } },
    { text: "First note" },
  );

  assert.equal(result.text, "First note");
  assert.deepEqual(page.body(), ["First note"]);
});

test("createNotionPage creates content and moves it under parentUrl when provided", async () => {
  const { createNotionPage } = await loadFunctions();
  const page = notionCreatePage();

  const result = await createNotionPage(
    { page, egoBrowser: { showTaskState: async () => {} } },
    {
      title: "Child page",
      text: "First line",
      parentUrl: "https://app.notion.com/p/cccccccccccccccccccccccccccccccc",
    },
  );

  assert.equal(result.title, "Child page");
  assert.equal(result.text, "First line");
  assert.equal(
    result.parentUrl,
    "https://app.notion.com/p/cccccccccccccccccccccccccccccccc",
  );
  assert.equal(result.created, true);
  assert.ok(page.calls.some((call) => call[0] === "pageType.waitFor"));
  assert.ok(page.calls.filter((call) => call[0] === "waitForURL").length >= 2);
  assert.ok(page.calls.some((call) => call[0] === "move.search"));
});

test("createNotionPage restores a title reset during new-page initialization", async () => {
  const { createNotionPage } = await loadFunctions();
  const page = notionCreatePage({ resetFirstTitleWrite: true });

  const result = await createNotionPage(
    { page, egoBrowser: { showTaskState: async () => {} } },
    { title: "Stable title", text: "First line" },
  );

  assert.equal(result.title, "Stable title");
  assert.equal(result.text, "First line");
  assert.equal(page.calls.filter((call) => call[0] === "title.fill").length, 2);
});

test("Notion manifest and prompt declare the six approved page tools", async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  const prompt = await readFile(new URL("prompt.md", functionsUrl), "utf8");

  for (const tool of [
    "pages_search",
    "pages_open",
    "pages_read",
    "pages_create",
    "pages_set_title",
    "pages_append_text",
  ]) {
    assert.ok(manifest.nodeTools[tool], `missing ${tool}`);
  }
  for (const name of [
    "search",
    "open",
    "read",
    "create",
    "setTitle",
    "appendText",
  ]) {
    assert.match(prompt, new RegExp(`notion\\.pages\\.${name}`));
  }
});
