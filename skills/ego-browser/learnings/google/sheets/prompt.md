# Google Sheets 预置函数

先用 `egoBrowser.newTaskSpace(...)` 或 `egoBrowser.switchTaskSpace(...)` 进入已登录的 TaskSpace。范围采用 A1 写法；读写值都是二维数组。

## `egoBrowser.site.google.sheets.open({ url })`

用例：打开一个已有表格，取得实际 URL 与标题。

```js
const sheet = await egoBrowser.site.google.sheets.open({
  url: "https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit",
});
```

## `egoBrowser.site.google.sheets.getSheetNames()`

用例：列出当前表格中可见且非空的工作表名称。

```js
const names = await egoBrowser.site.google.sheets.getSheetNames();
```

## `egoBrowser.site.google.sheets.readRange({ range })`

用例：读取指定范围的显示值，返回行列二维数组；原剪贴板内容会恢复。

```js
const rows = await egoBrowser.site.google.sheets.readRange({
  range: "'销售'!A1:C20",
});
```

## `egoBrowser.site.google.sheets.writeRange({ range, values })`

用例：写入一个矩形区域并回读验证。范围大小必须与二维数组完全一致。

```js
await egoBrowser.site.google.sheets.writeRange({
  range: "'销售'!A1:C2",
  values: [
    ["名称", "数量", "金额"],
    ["示例", 2, "=B2*10"],
  ],
});
```

## `egoBrowser.site.google.sheets.appendRows({ sheet, values })`

用例：从指定工作表 A 列最后一个非空单元格的下一行开始追加，并回读验证。

```js
await egoBrowser.site.google.sheets.appendRows({
  sheet: "销售",
  values: [
    ["产品 A", 3, 99],
    ["产品 B", 1, 49],
  ],
});
```
