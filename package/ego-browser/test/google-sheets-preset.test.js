import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const functionsUrl = new URL(
  "../../../skills/ego-browser/learnings/google/sheets/functions.js",
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
      `Google Sheets preset functions failed to load: ${error.message}`,
    );
  }
}

function sheetsPage(
  initialUrl = "about:blank",
  sheetNames = ["Sheet1", "Archive"],
) {
  const calls = [];
  let currentUrl = initialUrl;
  const titleInput = {
    async waitFor(options) {
      calls.push(["title.waitFor", options]);
    },
    async inputValue() {
      return "Launch budget";
    },
  };
  const nameBox = {
    async waitFor(options) {
      calls.push(["nameBox.waitFor", options]);
    },
  };
  const sheetTabs = {
    first() {
      return this;
    },
    async waitFor(options) {
      calls.push(["sheetTabs.waitFor", options]);
    },
    async evaluateAll() {
      calls.push(["sheetTabs.evaluateAll"]);
      return sheetNames;
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
      if (selector === "input.waffle-name-box") return nameBox;
      if (selector === ".docs-sheet-tab-name") return sheetTabs;
      throw new Error(`unexpected locator: ${selector}`);
    },
    url() {
      return currentUrl;
    },
  };
}

function rangeSheetsPage(copyByRange = {}, pasteResultByRange = {}) {
  const calls = [];
  let clipboard = "original clipboard";
  let pendingRange = "A1";
  let selectedRange = "A1";
  const nameBox = {
    async fill(value) {
      calls.push(["nameBox.fill", value]);
      pendingRange = value;
    },
    async press(key) {
      calls.push(["nameBox.press", key]);
      if (key === "Enter") selectedRange = pendingRange;
    },
  };
  const saveIndicator = {
    async count() {
      calls.push(["saveIndicator.count"]);
      return 1;
    },
    async textContent() {
      calls.push(["saveIndicator.textContent"]);
      return "";
    },
  };

  return {
    calls,
    clipboard: () => clipboard,
    selectedRange: () => selectedRange,
    keyboard: {
      async press(key) {
        calls.push(["keyboard.press", key]);
        if (key === "ControlOrMeta+C") {
          clipboard = copyByRange[selectedRange] ?? "";
        }
        if (key === "ControlOrMeta+V") {
          copyByRange[selectedRange] =
            pasteResultByRange[selectedRange] ?? clipboard;
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
    async waitForTimeout(milliseconds) {
      calls.push(["waitForTimeout", milliseconds]);
    },
    locator(selector) {
      if (selector === "input.waffle-name-box") return nameBox;
      if (selector === ".docs-save-indicator") return saveIndicator;
      throw new Error(`unexpected locator: ${selector}`);
    },
    url() {
      return "https://docs.google.com/spreadsheets/d/spreadsheet-id/edit";
    },
  };
}

test("openSpreadsheet opens an existing Google spreadsheet and waits for its grid", async () => {
  const { openSpreadsheet } = await loadFunctions();
  const page = sheetsPage();
  const url = "https://docs.google.com/spreadsheets/d/spreadsheet-id/edit";

  assert.deepEqual(await openSpreadsheet({ page }, { url }), {
    url,
    title: "Launch budget",
  });
  assert.deepEqual(page.calls, [
    ["goto", url, { waitUntil: "domcontentloaded", timeout: 30000 }],
    ["waitForURL", /\/spreadsheets\/d\//, { timeout: 30000 }],
    ["title.waitFor", { state: "visible", timeout: 30000 }],
    ["nameBox.waitFor", { state: "visible", timeout: 30000 }],
    ["sheetTabs.waitFor", { state: "visible", timeout: 30000 }],
  ]);
});

test("openSpreadsheet rejects URLs outside Google Sheets before navigating", async () => {
  const { openSpreadsheet } = await loadFunctions();
  const page = sheetsPage();

  await assert.rejects(
    () => openSpreadsheet({ page }, { url: "https://example.com/sheet" }),
    /open requires a Google Sheets spreadsheet URL/,
  );
  assert.deepEqual(page.calls, []);
});

test("getSpreadsheetSheetNames returns visible non-empty sheet names", async () => {
  const { getSpreadsheetSheetNames } = await loadFunctions();
  const page = sheetsPage(
    "https://docs.google.com/spreadsheets/d/spreadsheet-id/edit",
    [" Sheet1 ", "", "Archive"],
  );

  assert.deepEqual(await getSpreadsheetSheetNames({ page }), [
    "Sheet1",
    "Archive",
  ]);
  assert.deepEqual(page.calls, [["sheetTabs.evaluateAll"]]);
});

test("readSpreadsheetRange returns a two-dimensional array and restores the clipboard", async () => {
  const { readSpreadsheetRange } = await loadFunctions();
  const page = rangeSheetsPage({
    "Sheet1!A1:B3": "Name\tCount\nAlpha\t2\nBeta\t",
  });
  const states = [];

  assert.deepEqual(
    await readSpreadsheetRange(
      {
        page,
        egoBrowser: {
          async showTaskState(state) {
            states.push(state);
          },
        },
      },
      { range: "Sheet1!A1:B3" },
    ),
    [
      ["Name", "Count"],
      ["Alpha", "2"],
      ["Beta", ""],
    ],
  );
  assert.deepEqual(states, ["read Google sheet range"]);
  assert.equal(page.selectedRange(), "Sheet1!A1:B3");
  assert.equal(page.clipboard(), "original clipboard");
  assert.deepEqual(page.calls, [
    ["nameBox.fill", "Sheet1!A1:B3"],
    ["nameBox.press", "Enter"],
    ["clipboard.read"],
    ["keyboard.press", "ControlOrMeta+C"],
    ["clipboard.read"],
    ["clipboard.write", "original clipboard"],
  ]);
});

test("readSpreadsheetRange parses quoted tabs, newlines, and quotes", async () => {
  const { readSpreadsheetRange } = await loadFunctions();
  const page = rangeSheetsPage({
    "A1:B1": '"Line 1\nLine 2"\t"He said ""yes"""',
  });

  assert.deepEqual(
    await readSpreadsheetRange(
      { page, egoBrowser: { showTaskState: async () => {} } },
      { range: "A1:B1" },
    ),
    [["Line 1\nLine 2", 'He said "yes"']],
  );
});

test("readSpreadsheetRange rejects an empty range before touching the page", async () => {
  const { readSpreadsheetRange } = await loadFunctions();
  const page = rangeSheetsPage();

  await assert.rejects(
    readSpreadsheetRange(
      { page, egoBrowser: { showTaskState: async () => {} } },
      { range: "  " },
    ),
    /readRange requires a non-empty A1 range/,
  );
  assert.deepEqual(page.calls, []);
});

test("writeSpreadsheetRange writes a rectangular matrix and reads it back", async () => {
  const { writeSpreadsheetRange } = await loadFunctions();
  const page = rangeSheetsPage();
  const states = [];

  assert.deepEqual(
    await writeSpreadsheetRange(
      {
        page,
        egoBrowser: {
          async showTaskState(state) {
            states.push(state);
          },
        },
      },
      {
        range: "A1:B2",
        values: [
          ["Alpha", 2],
          ["Beta", 3],
        ],
      },
    ),
    {
      range: "A1:B2",
      values: [
        ["Alpha", "2"],
        ["Beta", "3"],
      ],
      saved: true,
    },
  );
  assert.deepEqual(states, [
    "write Google sheet range",
    "read Google sheet range",
  ]);
  assert.equal(page.clipboard(), "original clipboard");
  assert.ok(
    page.calls.some(
      (call) =>
        call[0] === "clipboard.write" && call[1] === "Alpha\t2\nBeta\t3",
    ),
  );
  assert.ok(page.calls.some((call) => call[0] === "saveIndicator.textContent"));
});

test("writeSpreadsheetRange accepts a non-empty calculated value for formulas", async () => {
  const { writeSpreadsheetRange } = await loadFunctions();
  const page = rangeSheetsPage({}, { "A1:B1": "Count\t20" });

  assert.deepEqual(
    await writeSpreadsheetRange(
      { page, egoBrowser: { showTaskState: async () => {} } },
      { range: "A1:B1", values: [["Count", "=2*10"]] },
    ),
    {
      range: "A1:B1",
      values: [["Count", "20"]],
      saved: true,
    },
  );
});

test("writeSpreadsheetRange rejects a non-rectangular matrix before editing", async () => {
  const { writeSpreadsheetRange } = await loadFunctions();
  const page = rangeSheetsPage();

  await assert.rejects(
    () =>
      writeSpreadsheetRange(
        { page, egoBrowser: { showTaskState: async () => {} } },
        {
          range: "A1:B2",
          values: [["A", "B"], ["C"]],
        },
      ),
    /writeRange requires a non-empty rectangular values matrix/,
  );
  assert.deepEqual(page.calls, []);
});

test("writeSpreadsheetRange rejects values whose dimensions do not match the range", async () => {
  const { writeSpreadsheetRange } = await loadFunctions();
  const page = rangeSheetsPage();

  await assert.rejects(
    () =>
      writeSpreadsheetRange(
        { page, egoBrowser: { showTaskState: async () => {} } },
        { range: "A1:B2", values: [["A", "B"]] },
      ),
    /writeRange values are 1x2 but range A1:B2 is 2x2/,
  );
  assert.deepEqual(page.calls, []);
});

test("writeSpreadsheetRange quotes tabs, newlines, and quotes", async () => {
  const { writeSpreadsheetRange } = await loadFunctions();
  const page = rangeSheetsPage();
  const values = [["Line 1\nLine 2", "A\tB", 'He said "yes"']];

  assert.deepEqual(
    await writeSpreadsheetRange(
      { page, egoBrowser: { showTaskState: async () => {} } },
      { range: "A1:C1", values },
    ),
    { range: "A1:C1", values, saved: true },
  );
  assert.ok(
    page.calls.some(
      (call) =>
        call[0] === "clipboard.write" &&
        call[1] === '"Line 1\nLine 2"\t"A\tB"\t"He said ""yes"""',
    ),
  );
});

test("appendSpreadsheetRows writes after the last non-empty key-column row", async () => {
  const { appendSpreadsheetRows } = await loadFunctions();
  const page = rangeSheetsPage({
    "'Sales'!A:A": "Name\nAlpha\nBeta\n\n",
  });
  const states = [];

  assert.deepEqual(
    await appendSpreadsheetRows(
      {
        page,
        egoBrowser: {
          async showTaskState(state) {
            states.push(state);
          },
        },
      },
      {
        sheet: "Sales",
        values: [
          ["Gamma", 4],
          ["Delta", 5],
        ],
      },
    ),
    {
      sheet: "Sales",
      range: "'Sales'!A4:B5",
      values: [
        ["Gamma", "4"],
        ["Delta", "5"],
      ],
      saved: true,
    },
  );
  assert.deepEqual(states, [
    "read Google sheet range",
    "write Google sheet range",
    "read Google sheet range",
  ]);
  assert.ok(
    page.calls.some(
      (call) => call[0] === "nameBox.fill" && call[1] === "'Sales'!A4:B5",
    ),
  );
});

test("appendSpreadsheetRows rejects an empty sheet name before touching the page", async () => {
  const { appendSpreadsheetRows } = await loadFunctions();
  const page = rangeSheetsPage();

  await assert.rejects(
    appendSpreadsheetRows(
      { page, egoBrowser: { showTaskState: async () => {} } },
      { sheet: "  ", values: [["Gamma", 4]] },
    ),
    /appendRows requires a sheet name/,
  );
  assert.deepEqual(page.calls, []);
});

test("Google manifest declares every approved Sheets preset function", async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));

  assert.deepEqual(
    Object.fromEntries(
      [
        "sheets_open",
        "sheets_get_sheet_names",
        "sheets_read_range",
        "sheets_write_range",
        "sheets_append_rows",
      ].map((name) => [
        name,
        {
          path: manifest.nodeTools[name]?.path,
          callable: manifest.nodeTools[name]?.callable,
        },
      ]),
    ),
    {
      sheets_open: {
        path: "sheets/functions.js",
        callable: "openSpreadsheet",
      },
      sheets_get_sheet_names: {
        path: "sheets/functions.js",
        callable: "getSpreadsheetSheetNames",
      },
      sheets_read_range: {
        path: "sheets/functions.js",
        callable: "readSpreadsheetRange",
      },
      sheets_write_range: {
        path: "sheets/functions.js",
        callable: "writeSpreadsheetRange",
      },
      sheets_append_rows: {
        path: "sheets/functions.js",
        callable: "appendSpreadsheetRows",
      },
    },
  );
});
