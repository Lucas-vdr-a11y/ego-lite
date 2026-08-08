import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const functionsUrl = new URL(
  "../../../skills/ego-browser/learnings/google/docs/functions.js",
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
    assert.fail(
      `Google Docs preset functions failed to load: ${error.message}`,
    );
  }
}

function savedIndicator(calls) {
  return {
    async count() {
      calls.push(["saveIndicator.count"]);
      return 1;
    },
    async textContent() {
      calls.push(["saveIndicator.textContent"]);
      return "";
    },
  };
}

function docsPage() {
  const calls = [];
  let currentUrl = "about:blank";
  const titleInput = {
    async waitFor(options) {
      calls.push(["title.waitFor", options]);
    },
    async inputValue() {
      return "Weekly report";
    },
  };
  const canvas = {
    first() {
      return this;
    },
    async waitFor(options) {
      calls.push(["canvas.waitFor", options]);
    },
  };

  return {
    calls,
    async goto(url, options) {
      calls.push(["goto", url, options]);
      currentUrl = url;
    },
    async waitForURL(pattern, options) {
      calls.push(["waitForURL", pattern, options]);
      assert.match(currentUrl, pattern);
    },
    locator(selector) {
      if (selector === "input.docs-title-input") return titleInput;
      if (selector === "canvas.kix-canvas-tile-content") return canvas;
      throw new Error(`unexpected locator: ${selector}`);
    },
    url() {
      return currentUrl;
    },
  };
}

function readableDocsPage(copiedText = "First line\nSecond line\n") {
  const calls = [];
  let clipboard = "original clipboard";
  const titleInput = {
    async inputValue() {
      return "Weekly report";
    },
  };
  const editorSurface = {
    first() {
      return this;
    },
    async click(options) {
      calls.push(["editorSurface.click", options]);
    },
  };

  return {
    calls,
    clipboard: () => clipboard,
    keyboard: {
      async press(key) {
        calls.push(["keyboard.press", key]);
        if (key === "ControlOrMeta+C") {
          clipboard = copiedText;
        }
      },
    },
    async evaluate(_fn, value) {
      if (arguments.length === 2) {
        calls.push(["clipboard.write", value]);
        clipboard = value;
        return;
      }
      calls.push(["clipboard.read"]);
      return clipboard;
    },
    locator(selector) {
      if (selector === "input.docs-title-input") return titleInput;
      if (selector === ".kix-page-paginated.canvas-first-page") {
        return editorSurface;
      }
      throw new Error(`unexpected locator: ${selector}`);
    },
    url() {
      return "https://docs.google.com/document/d/document-id/edit";
    },
  };
}

function titledDocsPage(initialTitle = "Old title") {
  const calls = [];
  const saveIndicator = savedIndicator(calls);
  let title = initialTitle;
  let selected = false;
  const titleInput = {
    async inputValue() {
      calls.push(["title.inputValue"]);
      return title;
    },
    async click() {
      calls.push(["title.click"]);
    },
    async press(key) {
      calls.push(["title.press", key]);
      if (key === "ControlOrMeta+A") selected = true;
    },
  };

  return {
    calls,
    keyboard: {
      async insertText(value) {
        calls.push(["keyboard.insertText", value]);
        title = selected ? value : `${title}${value}`;
        selected = false;
      },
    },
    async waitForTimeout(milliseconds) {
      calls.push(["waitForTimeout", milliseconds]);
    },
    locator(selector) {
      if (selector === "input.docs-title-input") return titleInput;
      if (selector === ".docs-save-indicator") return saveIndicator;
      throw new Error(`unexpected locator: ${selector}`);
    },
    url() {
      return "https://docs.google.com/document/d/document-id/edit";
    },
  };
}

function editableDocsPage(initialText) {
  const calls = [];
  const saveIndicator = savedIndicator(calls);
  let documentText = initialText;
  let clipboard = "original clipboard";
  let caretAfterEmptyParagraph = false;
  const editorSurface = {
    first() {
      return this;
    },
    async click(options) {
      calls.push(["editorSurface.click", options]);
    },
  };
  const titleInput = {
    async inputValue() {
      return "Weekly report";
    },
  };

  return {
    calls,
    clipboard: () => clipboard,
    documentText: () => documentText,
    keyboard: {
      async press(key) {
        calls.push(["keyboard.press", key]);
        if (key === "ControlOrMeta+C") {
          clipboard = documentText ? `${documentText}\n` : " \n";
        }
        if (key === "ArrowRight" && documentText === "") {
          caretAfterEmptyParagraph = true;
        }
        if (key === "ArrowLeft") caretAfterEmptyParagraph = false;
      },
      async insertText(text) {
        calls.push(["keyboard.insertText", text]);
        documentText = caretAfterEmptyParagraph
          ? `\n${text}`
          : `${documentText}${text}`;
        caretAfterEmptyParagraph = false;
      },
    },
    async evaluate(_fn, value) {
      if (arguments.length === 2) {
        calls.push(["clipboard.write", value]);
        clipboard = value;
        return;
      }
      calls.push(["clipboard.read"]);
      return clipboard;
    },
    async waitForTimeout(milliseconds) {
      calls.push(["waitForTimeout", milliseconds]);
    },
    locator(selector) {
      if (selector === "input.docs-title-input") return titleInput;
      if (selector === ".docs-save-indicator") return saveIndicator;
      if (selector === ".kix-page-paginated.canvas-first-page") {
        return editorSurface;
      }
      throw new Error(`unexpected locator: ${selector}`);
    },
    url() {
      return "https://docs.google.com/document/d/document-id/edit";
    },
  };
}

function replaceableDocsPage(initialText) {
  const calls = [];
  const saveIndicator = savedIndicator(calls);
  let documentText = initialText;
  let clipboard = "original clipboard";
  let find = "";
  let replacement = "";
  let matchCase = false;
  const editorSurface = {
    first() {
      return this;
    },
    async click(options) {
      calls.push(["editorSurface.click", options]);
    },
  };
  const titleInput = {
    async inputValue() {
      return "Weekly report";
    },
  };
  const textInputs = {
    nth(index) {
      return {
        async fill(value) {
          calls.push([`dialog.input.${index}.fill`, value]);
          if (index === 0) find = value;
          if (index === 1) replacement = value;
        },
      };
    },
  };
  const checkboxes = {
    nth(index) {
      return {
        async isChecked() {
          calls.push([`dialog.checkbox.${index}.isChecked`]);
          if (index === 0) return matchCase;
          if (index === 1) return false;
          return index === 2;
        },
        async click() {
          calls.push([`dialog.checkbox.${index}.click`]);
          if (index === 0) matchCase = !matchCase;
        },
      };
    },
  };
  const buttons = {
    first() {
      return {
        async click() {
          calls.push(["dialog.close.click"]);
        },
      };
    },
    nth(index) {
      return {
        async click() {
          calls.push([`dialog.button.${index}.click`]);
          if (index === 2) {
            const flags = matchCase ? "g" : "gi";
            const pattern = new RegExp(
              find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
              flags,
            );
            documentText = documentText.replace(pattern, () => replacement);
          }
        },
      };
    },
  };
  const dialog = {
    async waitFor(options) {
      calls.push(["dialog.waitFor", options]);
    },
    locator(selector) {
      if (selector === 'input[type="text"]') return textInputs;
      if (selector === 'input[type="checkbox"]') return checkboxes;
      if (selector === "button") return buttons;
      throw new Error(`unexpected dialog locator: ${selector}`);
    },
  };

  return {
    calls,
    documentText: () => documentText,
    keyboard: {
      async press(key) {
        calls.push(["keyboard.press", key]);
        if (key === "ControlOrMeta+C") clipboard = `${documentText}\n`;
      },
    },
    async evaluate(_fn, value) {
      if (arguments.length === 2) {
        clipboard = value;
        calls.push(["clipboard.write", value]);
        return;
      }
      calls.push(["clipboard.read"]);
      return clipboard;
    },
    async waitForTimeout(milliseconds) {
      calls.push(["waitForTimeout", milliseconds]);
    },
    locator(selector) {
      if (selector === "input.docs-title-input") return titleInput;
      if (selector === ".docs-save-indicator") return saveIndicator;
      if (selector === ".kix-page-paginated.canvas-first-page") {
        return editorSurface;
      }
      if (selector === ".appsDocsUiWizFindandreplacedialogContainer") {
        return dialog;
      }
      throw new Error(`unexpected locator: ${selector}`);
    },
    url() {
      return "https://docs.google.com/document/d/document-id/edit";
    },
  };
}

test("openDocument opens an existing Google document and waits for its editor", async () => {
  const { openDocument } = await loadFunctions();
  const page = docsPage();
  const url = "https://docs.google.com/document/d/document-id/edit";

  assert.deepEqual(await openDocument({ page }, { url }), {
    url,
    title: "Weekly report",
  });
  assert.deepEqual(page.calls, [
    ["goto", url, { waitUntil: "domcontentloaded", timeout: 30000 }],
    ["waitForURL", /\/document\/d\//, { timeout: 30000 }],
    ["title.waitFor", { state: "visible", timeout: 30000 }],
    ["canvas.waitFor", { state: "visible", timeout: 30000 }],
  ]);
});

test("openDocument rejects URLs outside Google Docs before navigating", async () => {
  const { openDocument } = await loadFunctions();
  const page = docsPage();

  await assert.rejects(
    () => openDocument({ page }, { url: "https://example.com/document" }),
    /open requires a Google Docs document URL/,
  );
  assert.deepEqual(page.calls, []);
});

test("readDocumentText returns plain text and restores the clipboard", async () => {
  const { readDocumentText } = await loadFunctions();
  const page = readableDocsPage();
  const states = [];

  assert.deepEqual(
    await readDocumentText(
      {
        page,
        egoBrowser: {
          async showTaskState(state) {
            states.push(state);
          },
        },
      },
      {},
    ),
    {
      title: "Weekly report",
      text: "First line\nSecond line",
    },
  );
  assert.deepEqual(states, ["focus Google document"]);
  assert.deepEqual(page.calls, [
    ["editorSurface.click", undefined],
    ["clipboard.read"],
    ["keyboard.press", "ControlOrMeta+A"],
    ["keyboard.press", "ControlOrMeta+C"],
    ["clipboard.read"],
    ["keyboard.press", "ArrowRight"],
    ["clipboard.write", "original clipboard"],
  ]);
  assert.equal(page.clipboard(), "original clipboard");
});

test("readDocumentText normalizes a whitespace-only blank page", async () => {
  const { readDocumentText } = await loadFunctions();
  const page = readableDocsPage(" \n");

  const result = await readDocumentText(
    {
      page,
      egoBrowser: { showTaskState: async () => {} },
    },
    {},
  );

  assert.equal(result.text, "");
  assert.ok(
    page.calls.some(
      (call) => call[0] === "keyboard.press" && call[1] === "ArrowLeft",
    ),
  );
});

test("setDocumentTitle renames the document and waits for save", async () => {
  const { setDocumentTitle } = await loadFunctions();
  const page = titledDocsPage();
  const states = [];

  assert.deepEqual(
    await setDocumentTitle(
      {
        page,
        egoBrowser: {
          async showTaskState(state) {
            states.push(state);
          },
        },
      },
      { title: "2026 Weekly report" },
    ),
    {
      previousTitle: "Old title",
      title: "2026 Weekly report",
      changed: true,
      saved: true,
    },
  );
  assert.deepEqual(states, ["rename Google document"]);
  assert.deepEqual(page.calls, [
    ["title.inputValue"],
    ["title.click"],
    ["waitForTimeout", 250],
    ["title.press", "ControlOrMeta+A"],
    ["keyboard.insertText", "2026 Weekly report"],
    ["title.press", "Enter"],
    ["waitForTimeout", 250],
    ["saveIndicator.count"],
    ["saveIndicator.textContent"],
    ["title.inputValue"],
  ]);
});

test("setDocumentTitle leaves an already matching title unchanged", async () => {
  const { setDocumentTitle } = await loadFunctions();
  const page = titledDocsPage("2026 Weekly report");
  const states = [];

  assert.deepEqual(
    await setDocumentTitle(
      {
        page,
        egoBrowser: {
          async showTaskState(state) {
            states.push(state);
          },
        },
      },
      { title: "2026 Weekly report" },
    ),
    {
      previousTitle: "2026 Weekly report",
      title: "2026 Weekly report",
      changed: false,
      saved: true,
    },
  );
  assert.deepEqual(states, []);
  assert.deepEqual(page.calls, [["title.inputValue"]]);
});

test("setDocumentTitle rejects an empty title before editing", async () => {
  const { setDocumentTitle } = await loadFunctions();
  const page = titledDocsPage();

  await assert.rejects(
    () =>
      setDocumentTitle(
        { page, egoBrowser: { showTaskState: async () => {} } },
        { title: "   " },
      ),
    /setTitle requires a non-empty title/,
  );
  assert.deepEqual(page.calls, []);
});

test("appendDocumentText appends at the end and verifies the saved text", async () => {
  const { appendDocumentText } = await loadFunctions();
  const page = editableDocsPage("Existing text");
  const states = [];

  assert.deepEqual(
    await appendDocumentText(
      {
        page,
        egoBrowser: {
          async showTaskState(state) {
            states.push(state);
          },
        },
      },
      { text: "New conclusion" },
    ),
    {
      title: "Weekly report",
      text: "Existing text\nNew conclusion",
      appendedText: "New conclusion",
      changed: true,
      saved: true,
    },
  );
  assert.equal(page.documentText(), "Existing text\nNew conclusion");
  assert.equal(page.clipboard(), "original clipboard");
  assert.deepEqual(states, [
    "focus Google document",
    "append Google document text",
    "focus Google document",
  ]);
  assert.ok(
    page.calls.some(
      (call) =>
        call[0] === "keyboard.insertText" && call[1] === "\nNew conclusion",
    ),
  );
  assert.ok(page.calls.some((call) => call[0] === "saveIndicator.textContent"));
});

test("appendDocumentText does not add a leading blank line to an empty document", async () => {
  const { appendDocumentText } = await loadFunctions();
  const page = editableDocsPage("");

  const result = await appendDocumentText(
    {
      page,
      egoBrowser: { showTaskState: async () => {} },
    },
    { text: "First line" },
  );

  assert.equal(result.text, "First line");
  assert.equal(page.documentText(), "First line");
  assert.ok(
    page.calls.some(
      (call) => call[0] === "keyboard.press" && call[1] === "ArrowLeft",
    ),
  );
});

test("appendDocumentText does not duplicate matching text at the end", async () => {
  const { appendDocumentText } = await loadFunctions();
  const page = editableDocsPage("Existing text\nNew conclusion");
  const states = [];

  assert.deepEqual(
    await appendDocumentText(
      {
        page,
        egoBrowser: {
          async showTaskState(state) {
            states.push(state);
          },
        },
      },
      { text: "New conclusion" },
    ),
    {
      title: "Weekly report",
      text: "Existing text\nNew conclusion",
      appendedText: "New conclusion",
      changed: false,
      saved: true,
    },
  );
  assert.deepEqual(states, ["focus Google document"]);
  assert.equal(
    page.calls.some((call) => call[0] === "keyboard.insertText"),
    false,
  );
});

test("appendDocumentText rejects empty text before reading the document", async () => {
  const { appendDocumentText } = await loadFunctions();
  const page = editableDocsPage("Existing text");

  await assert.rejects(
    () =>
      appendDocumentText(
        { page, egoBrowser: { showTaskState: async () => {} } },
        { text: "" },
      ),
    /appendText requires non-empty text/,
  );
  assert.deepEqual(page.calls, []);
});

test("replaceDocumentText replaces every plain-text match and verifies the result", async () => {
  const { replaceDocumentText } = await loadFunctions();
  const page = replaceableDocsPage("Old item\nold item");
  const states = [];

  assert.deepEqual(
    await replaceDocumentText(
      {
        page,
        egoBrowser: {
          async showTaskState(state) {
            states.push(state);
          },
        },
      },
      { find: "old item", replace: "New item", matchCase: false },
    ),
    {
      title: "Weekly report",
      text: "New item\nNew item",
      find: "old item",
      replace: "New item",
      count: 2,
      changed: true,
      saved: true,
    },
  );
  assert.equal(page.documentText(), "New item\nNew item");
  assert.deepEqual(states, [
    "focus Google document",
    "replace Google document text",
    "focus Google document",
  ]);
  assert.ok(page.calls.some((call) => call[0] === "dialog.button.2.click"));
  assert.ok(page.calls.some((call) => call[0] === "dialog.checkbox.2.click"));
});

test("replaceDocumentText skips the dialog when no text matches", async () => {
  const { replaceDocumentText } = await loadFunctions();
  const page = replaceableDocsPage("Current document text");
  const states = [];

  assert.deepEqual(
    await replaceDocumentText(
      {
        page,
        egoBrowser: {
          async showTaskState(state) {
            states.push(state);
          },
        },
      },
      { find: "missing", replace: "replacement" },
    ),
    {
      title: "Weekly report",
      text: "Current document text",
      find: "missing",
      replace: "replacement",
      count: 0,
      changed: false,
      saved: true,
    },
  );
  assert.deepEqual(states, ["focus Google document"]);
  assert.equal(
    page.calls.some((call) => String(call[0]).startsWith("dialog.")),
    false,
  );
});

test("replaceDocumentText rejects empty find text before reading", async () => {
  const { replaceDocumentText } = await loadFunctions();
  const page = replaceableDocsPage("Current document text");

  await assert.rejects(
    () =>
      replaceDocumentText(
        { page, egoBrowser: { showTaskState: async () => {} } },
        { find: "", replace: "replacement" },
      ),
    /replaceAll requires non-empty find text/,
  );
  assert.deepEqual(page.calls, []);
});

test("replaceDocumentText requires a string replacement", async () => {
  const { replaceDocumentText } = await loadFunctions();
  const page = replaceableDocsPage("Current document text");

  await assert.rejects(
    () =>
      replaceDocumentText(
        { page, egoBrowser: { showTaskState: async () => {} } },
        { find: "Current" },
      ),
    /replaceAll requires replace to be a string/,
  );
  assert.deepEqual(page.calls, []);
});

test("Google manifest declares every approved Docs preset function", async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));

  assert.deepEqual(
    Object.fromEntries(
      [
        "docs_open",
        "docs_read_text",
        "docs_set_title",
        "docs_append_text",
        "docs_replace_all",
      ].map((name) => [
        name,
        {
          path: manifest.nodeTools[name]?.path,
          callable: manifest.nodeTools[name]?.callable,
        },
      ]),
    ),
    {
      docs_open: { path: "docs/functions.js", callable: "openDocument" },
      docs_read_text: {
        path: "docs/functions.js",
        callable: "readDocumentText",
      },
      docs_set_title: {
        path: "docs/functions.js",
        callable: "setDocumentTitle",
      },
      docs_append_text: {
        path: "docs/functions.js",
        callable: "appendDocumentText",
      },
      docs_replace_all: {
        path: "docs/functions.js",
        callable: "replaceDocumentText",
      },
    },
  );
});
