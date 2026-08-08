# Gmail 预置函数

先进入已登录 Gmail 的 TaskSpace。函数只读取邮件或创建草稿，不会发送邮件；`listThreads` 返回的 `id` 应直接交给当前列表中的 `readThread`。

## `egoBrowser.site.google.gmail.openInbox()`

用例：打开当前登录账号的收件箱。

```js
await egoBrowser.site.google.gmail.openInbox();
```

## `egoBrowser.site.google.gmail.listThreads({ limit? })`

用例：读取前 20 个会话摘要，也可以用 `limit` 限制为 1～100 条。

```js
const threads = await egoBrowser.site.google.gmail.listThreads({ limit: 10 });
```

## `egoBrowser.site.google.gmail.search({ query, limit? })`

用例：使用 Gmail 搜索语法查找会话并返回摘要。

```js
const threads = await egoBrowser.site.google.gmail.search({
  query: "from:example@example.com newer_than:30d",
  limit: 20,
});
```

## `egoBrowser.site.google.gmail.readThread({ id })`

用例：读取刚由 `listThreads` 或 `search` 返回的某个会话。

```js
const thread = await egoBrowser.site.google.gmail.readThread({
  id: threads[0].id,
});
```

## `egoBrowser.site.google.gmail.createDraft({ to, cc?, bcc?, subject, body })`

用例：填写并保存一封草稿；收件人可以是邮箱字符串或邮箱数组。此函数会关闭编辑框以确认进入草稿，但不会发送。

```js
await egoBrowser.site.google.gmail.createDraft({
  to: ["owner@example.com"],
  cc: "reviewer@example.com",
  subject: "周报草稿",
  body: "这是尚未发送的草稿。",
});
```
