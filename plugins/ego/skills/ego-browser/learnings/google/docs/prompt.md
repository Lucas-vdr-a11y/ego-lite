# Google Docs preset functions

Enter a logged-in TaskSpace with `egoBrowser.newTaskSpace(...)` or `egoBrowser.switchTaskSpace(...)` first. Every editing function waits for Google's save state and verifies the result.

## `egoBrowser.site.google.docs.open({ url })`

Use case: open an existing document and get its actual URL and title.

```js
const doc = await egoBrowser.site.google.docs.open({
  url: "https://docs.google.com/document/d/DOCUMENT_ID/edit",
});
```

## `egoBrowser.site.google.docs.readText()`

Use case: read the active document's title and plain text; the original clipboard content is restored.

```js
const { title, text } = await egoBrowser.site.google.docs.readText();
```

## `egoBrowser.site.google.docs.setTitle({ title })`

Use case: change the active document's title; no edit is made when the title already matches.

```js
await egoBrowser.site.google.docs.setTitle({
  title: "Weekly report 2026-08-07",
});
```

## `egoBrowser.site.google.docs.appendText({ text, separator? })`

Use case: append a block of plain text to the end of the document. A newline is the default separator; nothing is appended when the document already ends with the same text.

```js
await egoBrowser.site.google.docs.appendText({
  text: "Done this week: shipped the basic document functions.",
});
```

## `egoBrowser.site.google.docs.replaceAll({ find, replace, matchCase? })`

Use case: replace every plain-text match in the active document; `matchCase` defaults to `false`.

```js
await egoBrowser.site.google.docs.replaceAll({
  find: "Old project name",
  replace: "New project name",
  matchCase: true,
});
```
