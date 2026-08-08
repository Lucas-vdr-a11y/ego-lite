# Outlook 预置函数（个人版）

先进入已登录 `outlook.live.com` 的 TaskSpace。本预置只读取邮件或创建草稿，不会发送邮件，也不包含 Microsoft 365 Word/Excel。

## `egoBrowser.site.microsoft.outlook.openInbox()`

用例：打开当前个人 Outlook 账号的收件箱。

```js
await egoBrowser.site.microsoft.outlook.openInbox();
```

## `egoBrowser.site.microsoft.outlook.listMessages({ limit? })`

用例：读取当前邮件列表中的摘要，`limit` 可设为 1～100。

```js
const messages = await egoBrowser.site.microsoft.outlook.listMessages({
  limit: 20,
});
```

## `egoBrowser.site.microsoft.outlook.search({ query, limit? })`

用例：搜索个人 Outlook 邮件并返回摘要。

```js
const messages = await egoBrowser.site.microsoft.outlook.search({
  query: "项目周报",
  limit: 10,
});
```

## `egoBrowser.site.microsoft.outlook.readMessage({ id })`

用例：读取刚由 `listMessages` 或 `search` 返回的邮件。

```js
const message = await egoBrowser.site.microsoft.outlook.readMessage({
  id: messages[0].id,
});
```

## `egoBrowser.site.microsoft.outlook.createDraft({ to, cc?, bcc?, subject, body })`

用例：创建并自动保存草稿，不会发送。普通 `to` 地址可直接填写；当前 Outlook 界面的 `cc`/`bcc` 选择器只接受通讯簿中可找到的联系人。

```js
await egoBrowser.site.microsoft.outlook.createDraft({
  to: "owner@example.com",
  subject: "周报草稿",
  body: "这是尚未发送的草稿。",
});
```
