# Outlook preset functions (personal)

Enter a TaskSpace already logged in to `outlook.live.com` first. This preset only reads mail or creates drafts, never sends it, and does not cover Microsoft 365 Word/Excel.

## `egoBrowser.site.microsoft.outlook.openInbox()`

Use case: open the inbox of the current personal Outlook account.

```js
await egoBrowser.site.microsoft.outlook.openInbox();
```

## `egoBrowser.site.microsoft.outlook.listMessages({ limit? })`

Use case: read summaries from the current message list; `limit` may be set to 1–100.

```js
const messages = await egoBrowser.site.microsoft.outlook.listMessages({
  limit: 20,
});
```

## `egoBrowser.site.microsoft.outlook.search({ query, limit? })`

Use case: search personal Outlook mail and return summaries.

```js
const messages = await egoBrowser.site.microsoft.outlook.search({
  query: "project weekly report",
  limit: 10,
});
```

## `egoBrowser.site.microsoft.outlook.readMessage({ id })`

Use case: read a message just returned by `listMessages` or `search`.

```js
const message = await egoBrowser.site.microsoft.outlook.readMessage({
  id: messages[0].id,
});
```

## `egoBrowser.site.microsoft.outlook.createDraft({ to, cc?, bcc?, subject, body })`

Use case: create a draft that is auto-saved, never sent. Plain `to` addresses can be typed directly; the current Outlook UI's `cc`/`bcc` pickers only accept contacts it can find in the directory.

```js
await egoBrowser.site.microsoft.outlook.createDraft({
  to: "owner@example.com",
  subject: "Weekly report draft",
  body: "This is an unsent draft.",
});
```
