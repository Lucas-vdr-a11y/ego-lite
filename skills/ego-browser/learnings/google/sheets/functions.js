export async function openSpreadsheet(ctx, args = {}) {
  const page = ctx.page;
  const url = googleSheetsUrl(args.url, "open");

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForURL(/\/spreadsheets\/d\//, { timeout: 30000 });
  await page
    .locator("input.docs-title-input")
    .waitFor({ state: "visible", timeout: 30000 });
  await page
    .locator("input.waffle-name-box")
    .waitFor({ state: "visible", timeout: 30000 });
  await page
    .locator(".docs-sheet-tab-name")
    .first()
    .waitFor({ state: "visible", timeout: 30000 });

  return {
    url: page.url(),
    title: await page.locator("input.docs-title-input").inputValue(),
  };
}

export async function getSpreadsheetSheetNames(ctx) {
  assertGoogleSheetsPage(ctx.page, "getSheetNames");
  const names = await ctx.page
    .locator(".docs-sheet-tab-name")
    .evaluateAll((elements) => elements.map((element) => element.textContent));
  return names.map((name) => (name || "").trim()).filter(Boolean);
}

export async function readSpreadsheetRange(ctx, args = {}) {
  const page = ctx.page;
  if (typeof args.range !== "string" || !args.range.trim()) {
    throw new Error("readRange requires a non-empty A1 range");
  }
  const range = args.range.trim();
  assertGoogleSheetsPage(page, "readRange");
  await ctx.egoBrowser.showTaskState("read Google sheet range");
  const nameBox = page.locator("input.waffle-name-box");
  await nameBox.fill(range);
  await nameBox.press("Enter");

  const previousClipboard = await readClipboard(page);
  try {
    await page.keyboard.press("ControlOrMeta+C");
    return parseTsv(await readClipboard(page));
  } finally {
    await writeClipboard(page, previousClipboard);
  }
}

export async function writeSpreadsheetRange(ctx, args = {}) {
  const page = ctx.page;
  const inputValues = rectangularValues(args.values, "writeRange");
  const dimensions = a1RangeDimensions(args.range, "writeRange");
  if (
    inputValues.length !== dimensions.rows ||
    inputValues[0].length !== dimensions.columns
  ) {
    throw new Error(
      `writeRange values are ${inputValues.length}x${inputValues[0].length} but range ${args.range} is ${dimensions.rows}x${dimensions.columns}`,
    );
  }
  assertGoogleSheetsPage(page, "writeRange");
  const serialized = serializeTsv(inputValues);

  await ctx.egoBrowser.showTaskState("write Google sheet range");
  const nameBox = page.locator("input.waffle-name-box");
  await nameBox.fill(args.range);
  await nameBox.press("Enter");
  const previousClipboard = await readClipboard(page);
  try {
    await writeClipboard(page, serialized);
    await page.keyboard.press("ControlOrMeta+V");
    await waitForGoogleSave(page);
  } finally {
    await writeClipboard(page, previousClipboard);
  }

  const values = await readSpreadsheetRange(ctx, { range: args.range });
  const expected = inputValues.map((row) =>
    row.map((value) => (value == null ? "" : String(value))),
  );
  if (!displayedValuesMatch(expected, values)) {
    throw new Error("writeRange verification failed");
  }
  return { range: args.range, values, saved: true };
}

export async function appendSpreadsheetRows(ctx, args = {}) {
  const inputValues = rectangularValues(args.values, "appendRows");
  if (typeof args.sheet !== "string" || !args.sheet.trim()) {
    throw new Error("appendRows requires a sheet name");
  }
  const sheet = args.sheet.trim();
  const qualifiedSheet = quoteSheetName(sheet);
  const keyColumn = await readSpreadsheetRange(ctx, {
    range: `${qualifiedSheet}!A:A`,
  });
  let lastNonEmptyRow = 0;
  keyColumn.forEach((row, index) => {
    if (String(row[0] ?? "").trim()) lastNonEmptyRow = index + 1;
  });

  const startRow = lastNonEmptyRow + 1;
  const endRow = startRow + inputValues.length - 1;
  const endColumn = columnLabel(inputValues[0].length);
  const range = `${qualifiedSheet}!A${startRow}:${endColumn}${endRow}`;
  const written = await writeSpreadsheetRange(ctx, {
    range,
    values: inputValues,
  });
  return { sheet, range, values: written.values, saved: true };
}

function rectangularValues(values, operation) {
  if (
    !Array.isArray(values) ||
    values.length === 0 ||
    !Array.isArray(values[0]) ||
    values[0].length === 0 ||
    values.some((row) => !Array.isArray(row) || row.length !== values[0].length)
  ) {
    throw new Error(
      `${operation} requires a non-empty rectangular values matrix`,
    );
  }
  return values;
}

function a1RangeDimensions(range, operation) {
  if (typeof range !== "string" || !range.trim()) {
    throw new Error(`${operation} requires an A1 cell range`);
  }
  const cells = range.slice(range.lastIndexOf("!") + 1).trim();
  const match = cells.match(/^\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/i);
  if (!match) throw new Error(`${operation} requires an A1 cell range`);
  const startColumn = columnNumber(match[1]);
  const startRow = Number(match[2]);
  const endColumn = columnNumber(match[3] || match[1]);
  const endRow = Number(match[4] || match[2]);
  if (endColumn < startColumn || endRow < startRow) {
    throw new Error(`${operation} requires a forward A1 cell range`);
  }
  return {
    rows: endRow - startRow + 1,
    columns: endColumn - startColumn + 1,
  };
}

function columnNumber(label) {
  return [...label.toUpperCase()].reduce(
    (value, character) => value * 26 + character.charCodeAt(0) - 64,
    0,
  );
}

function columnLabel(number) {
  let label = "";
  for (let value = number; value > 0; value = Math.floor((value - 1) / 26)) {
    label = String.fromCharCode(((value - 1) % 26) + 65) + label;
  }
  return label;
}

function quoteSheetName(name) {
  return `'${name.replaceAll("'", "''")}'`;
}

function googleSheetsUrl(value, operation) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${operation} requires a Google Sheets spreadsheet URL`);
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "docs.google.com" ||
    !url.pathname.startsWith("/spreadsheets/d/")
  ) {
    throw new Error(`${operation} requires a Google Sheets spreadsheet URL`);
  }
  return url.href;
}

function assertGoogleSheetsPage(page, operation) {
  googleSheetsUrl(page.url(), operation);
}

function parseTsv(value) {
  const rows = [[]];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quoted) {
      if (character === '"' && value[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"' && cell === "") {
      quoted = true;
    } else if (character === "\t") {
      rows.at(-1).push(cell);
      cell = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && value[index + 1] === "\n") index += 1;
      rows.at(-1).push(cell);
      rows.push([]);
      cell = "";
    } else {
      cell += character;
    }
  }
  rows.at(-1).push(cell);
  return rows;
}

function serializeTsv(values) {
  return values.map((row) => row.map(serializeTsvCell).join("\t")).join("\n");
}

function serializeTsvCell(value) {
  const text = value == null ? "" : String(value);
  return /["\t\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function displayedValuesMatch(expected, actual) {
  return (
    expected.length === actual.length &&
    expected.every(
      (row, rowIndex) =>
        row.length === actual[rowIndex]?.length &&
        row.every((value, columnIndex) =>
          value.startsWith("=")
            ? Boolean(actual[rowIndex][columnIndex])
            : actual[rowIndex][columnIndex] === value,
        ),
    )
  );
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
  throw new Error("Google Sheets did not finish saving within 30000ms");
}
