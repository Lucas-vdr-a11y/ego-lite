# Google Sheets preset functions

Enter a logged-in TaskSpace with `egoBrowser.newTaskSpace(...)` or `egoBrowser.switchTaskSpace(...)` first. Ranges use A1 notation; values are two-dimensional arrays on both read and write.

## `egoBrowser.site.google.sheets.open({ url })`

Use case: open an existing spreadsheet and get its actual URL and title.

```js
const sheet = await egoBrowser.site.google.sheets.open({
  url: "https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit",
});
```

## `egoBrowser.site.google.sheets.getSheetNames()`

Use case: list the visible, non-empty sheet names in the active spreadsheet.

```js
const names = await egoBrowser.site.google.sheets.getSheetNames();
```

## `egoBrowser.site.google.sheets.readRange({ range })`

Use case: read the displayed values of a range as a two-dimensional array of rows and columns; the original clipboard content is restored.

```js
const rows = await egoBrowser.site.google.sheets.readRange({
  range: "'Sales'!A1:C20",
});
```

## `egoBrowser.site.google.sheets.writeRange({ range, values })`

Use case: write a rectangular area and read it back to verify. The range dimensions must match the two-dimensional array exactly.

```js
await egoBrowser.site.google.sheets.writeRange({
  range: "'Sales'!A1:C2",
  values: [
    ["Name", "Quantity", "Amount"],
    ["Example", 2, "=B2*10"],
  ],
});
```

## `egoBrowser.site.google.sheets.appendRows({ sheet, values })`

Use case: append starting at the row after the last non-empty cell in column A of the named sheet, then read it back to verify.

```js
await egoBrowser.site.google.sheets.appendRows({
  sheet: "Sales",
  values: [
    ["Product A", 3, 99],
    ["Product B", 1, 49],
  ],
});
```
