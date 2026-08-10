# Gmail preset functions

Enter a TaskSpace already logged in to Gmail first. These functions only read mail or create drafts, never send it; the `id` returned by `listThreads` should be passed straight to `readThread` while that list is still current.

## `egoBrowser.site.google.gmail.openInbox()`

Use case: open the inbox of the currently logged-in account.

```js
await egoBrowser.site.google.gmail.openInbox();
```

## `egoBrowser.site.google.gmail.listThreads({ limit? })`

Use case: read the first 20 thread summaries, or use `limit` to ask for 1–100 of them.

```js
const threads = await egoBrowser.site.google.gmail.listThreads({ limit: 10 });
```

## `egoBrowser.site.google.gmail.search({ query, limit? })`

Use case: find threads with Gmail search syntax and return their summaries.

```js
const threads = await egoBrowser.site.google.gmail.search({
  query: "from:example@example.com newer_than:30d",
  limit: 20,
});
```

## `egoBrowser.site.google.gmail.readThread({ id })`

Use case: read a thread just returned by `listThreads` or `search`.

```js
const thread = await egoBrowser.site.google.gmail.readThread({
  id: threads[0].id,
});
```

## `egoBrowser.site.google.gmail.createDraft({ to, cc?, bcc?, subject, body })`

Use case: fill in and save a draft; recipients may be an email string or an array of email strings. This function closes the compose box to confirm the draft was stored, but never sends it.

```js
await egoBrowser.site.google.gmail.createDraft({
  to: ["owner@example.com"],
  cc: "reviewer@example.com",
  subject: "Weekly report draft",
  body: "This is an unsent draft.",
});
```
