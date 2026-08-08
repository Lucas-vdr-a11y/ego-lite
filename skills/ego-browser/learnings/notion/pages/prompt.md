# Notion 页面预置函数

先进入已登录 Notion 的 TaskSpace。正文按可编辑区块读取和追加，保持调用方式为简单纯文本。

## `egoBrowser.site.notion.pages.search({ query, limit? })`

用例：搜索工作空间页面并返回标题与链接。

```js
const pages = await egoBrowser.site.notion.pages.search({
  query: "项目周报",
  limit: 10,
});
```

## `egoBrowser.site.notion.pages.open({ url })`

用例：打开一个已有 Notion 页面。

```js
await egoBrowser.site.notion.pages.open({ url: pages[0].url });
```

## `egoBrowser.site.notion.pages.read()`

用例：读取当前页面 URL、标题和正文纯文本。

```js
const page = await egoBrowser.site.notion.pages.read();
```

## `egoBrowser.site.notion.pages.create({ title, text?, parentUrl? })`

用例：新建页面；提供 `parentUrl` 时会移动到该父页面下面。

```js
await egoBrowser.site.notion.pages.create({
  title: "周报 2026-08-07",
  text: "本周完成：基础预置函数。",
  parentUrl: "https://app.notion.com/p/PARENT_PAGE_ID",
});
```

## `egoBrowser.site.notion.pages.setTitle({ title })`

用例：修改当前页面标题；相同标题不会重复编辑。

```js
await egoBrowser.site.notion.pages.setTitle({ title: "项目周报" });
```

## `egoBrowser.site.notion.pages.appendText({ text })`

用例：把一段或多行纯文本作为新正文区块追加到页面末尾。

```js
await egoBrowser.site.notion.pages.appendText({
  text: "下一步：\n完成真实页面回归测试",
});
```
