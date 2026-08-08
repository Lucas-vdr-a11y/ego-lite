# Google Docs 预置函数

先用 `egoBrowser.newTaskSpace(...)` 或 `egoBrowser.switchTaskSpace(...)` 进入已登录的 TaskSpace。所有编辑函数都会等待 Google 的保存状态并验证结果。

## `egoBrowser.site.google.docs.open({ url })`

用例：打开一个已有文档，取得实际 URL 与标题。

```js
const doc = await egoBrowser.site.google.docs.open({
  url: "https://docs.google.com/document/d/DOCUMENT_ID/edit",
});
```

## `egoBrowser.site.google.docs.readText()`

用例：读取当前文档的标题和纯文本；原剪贴板内容会恢复。

```js
const { title, text } = await egoBrowser.site.google.docs.readText();
```

## `egoBrowser.site.google.docs.setTitle({ title })`

用例：修改当前文档标题；标题已相同时不会重复编辑。

```js
await egoBrowser.site.google.docs.setTitle({ title: "周报 2026-08-07" });
```

## `egoBrowser.site.google.docs.appendText({ text, separator? })`

用例：在文档末尾追加一段纯文本。默认用换行分隔；文档已以同样文本结尾时不会重复追加。

```js
await egoBrowser.site.google.docs.appendText({
  text: "本周完成：上线基础文档函数。",
});
```

## `egoBrowser.site.google.docs.replaceAll({ find, replace, matchCase? })`

用例：替换当前文档中的所有纯文本匹配；`matchCase` 默认是 `false`。

```js
await egoBrowser.site.google.docs.replaceAll({
  find: "旧项目名",
  replace: "新项目名",
  matchCase: true,
});
```
