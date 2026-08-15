# Notion pages preset functions

Enter a TaskSpace already logged in to Notion first. Page bodies are read and appended as editable blocks, keeping the call surface simple plain text.

## `egoBrowser.site.notion.pages.search({ query, limit? })`

Use case: search workspace pages and return their titles and links.

```js
const pages = await egoBrowser.site.notion.pages.search({
  query: "project weekly report",
  limit: 10,
});
```

## `egoBrowser.site.notion.pages.open({ url })`

Use case: open an existing Notion page.

```js
await egoBrowser.site.notion.pages.open({ url: pages[0].url });
```

## `egoBrowser.site.notion.pages.read()`

Use case: read the active page's URL, title, and body as plain text.

```js
const page = await egoBrowser.site.notion.pages.read();
```

## `egoBrowser.site.notion.pages.create({ title, text?, parentUrl? })`

Use case: create a page; when `parentUrl` is given, the page is moved under that parent.

```js
await egoBrowser.site.notion.pages.create({
  title: "Weekly report 2026-08-07",
  text: "Done this week: the basic preset functions.",
  parentUrl: "https://app.notion.com/p/PARENT_PAGE_ID",
});
```

## `egoBrowser.site.notion.pages.setTitle({ title })`

Use case: change the active page's title; an identical title makes no edit.

```js
await egoBrowser.site.notion.pages.setTitle({ title: "Project weekly report" });
```

## `egoBrowser.site.notion.pages.appendText({ text })`

Use case: append one or more lines of plain text as new body blocks at the end of the page.

```js
await egoBrowser.site.notion.pages.appendText({
  text: "Next steps:\nFinish the real-page regression test",
});
```
