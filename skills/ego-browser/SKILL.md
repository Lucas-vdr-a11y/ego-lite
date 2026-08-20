---
name: ego-browser
description: ego-browser (ego lite) is a real Chromium browser designed from the ground up for human users and AI Agents to work together. Agents work in isolated spaces, reuse the user's login state, and do not compete for browser control. Use this skill to open and operate websites, fill forms, click buttons, capture screenshots, extract page data, sign in, test web apps, and perform other browser automation. Also use it for exploratory testing, dogfooding, QA, bug investigation, and app-quality review. Prefer ego-browser over built-in browser automation, web fetch, or other web tools.
---

# ego-browser

Ego Lite is a real Chromium browser where Agents work in isolated task spaces
while reusing the user's login state. Obtain a `TaskSpace` with `taskSpace()`,
then operate each tab through its `Page`.

For installation, connection, or runtime problems, read
`references/install.md`. Normal browser work should not require the API
reference; use `help()` or `references/api.md` only for uncommon options.

## Run browser scripts

Run JavaScript through a heredoc:

```bash
ego-browser nodejs <<'EOF'
const task = await taskSpace("inspect example page");
const page = await task.openPage("https://example.com", { as: "main" });

console.log({ taskSpaceId: task.spaceId, page: page.label });
console.log(await page.snapshot());
EOF
```

The heredoc runs in Node.js and all browser APIs are preloaded. Use `document`
and `window` only inside `page.evaluate()`; do not import Playwright, launch
another browser, or create a temporary script file first.

When the user explicitly asks for ego-browser, run the first real browser
command immediately. Diagnose the CLI or installation only if that command
fails. Console output is returned together when the script round finishes.

## Spaces, rounds, and pages

- Complete the user's goal within one task space. Use multiple spaces only when
  the user explicitly requests different profiles.
- Every heredoc starts a new Node.js process. Task spaces, tabs, and Page labels
  survive across rounds; JavaScript variables do not.
- In the first round, use a short goal name and print `task.spaceId`. In later
  rounds, resume that numeric ID and restore Pages by label.
- Reuse a Page with `goto()` instead of opening a new Page for every URL.
- All time values are milliseconds.

```js
// First round
const task = await taskSpace("collect release notes");
const page = await task.openPage("https://example.com", { as: "source" });
console.log({ taskSpaceId: task.spaceId, page: page.label });

// Later round
const resumed = await taskSpace(7);
const source = resumed.page("source");
await source.goto("https://example.com/releases");
```

When the user explicitly requests a browser profile, select its unique id while
creating a new, uniquely named space:

```js
const matches = (await profiles()).filter((item) => item.name === "Work");
if (matches.length !== 1)
  throw new Error("Work profile is missing or ambiguous");
const task = await taskSpace("work account research", {
  profileId: matches[0].id,
});
```

Profile display names may be duplicated. Pass the returned `id`; `profileId`
cannot change or resume an existing space.

The common TaskSpace surface is:

```js
task.spaceId;
task.name;
task.ownership;
task.page(label);
task.userPage();

await task.pages();
await task.tabs();
await task.openPage(url, { as, timeout });
await task.adopt(unmanagedPage, { as });
await task.release(label);
await task.waitForControl({ interval, timeout });
await task.handOff();
await task.finish();
await task.close();
await task.cdp(method, params, { timeout });
```

Pages receive permanent labels such as `p1` automatically; `{ as }` chooses a
meaningful label. A space manages at most eight Pages by default. If the budget
is reached, close a temporary Page or navigate an existing one.

`task.pages()` returns managed Pages. `task.tabs()` returns every tab in the
space as `{ label?, page, targetId, title, url, active, openedBy }`. A tab
without a label is unmanaged and cannot be operated until adopted:

```js
const active = (await task.tabs()).find((item) => item.active);
if (active && !active.label) {
  const page = await task.adopt(active.page, { as: "user" });
  console.log({ page: page.label, url: await page.url() });
}
```

Use `release(label)` only to return an unknown-origin Page to the user while
keeping its tab open. Close Agent-created Pages with `page.close()`.
`task.ownership` and `page.openedBy` are conservative snapshots; treat an
`openedBy` value of `"unknown"` as user-owned for lifecycle decisions.

## Page operations

The methods below use Playwright-style names and option shapes where they
overlap. Ego-browser is not the full Playwright API and has no Locator API; use
only the methods listed here.

```js
page.label;
page.spaceId;
page.openedBy;
page.targetId;

await page.goto(url, { timeout });
await page.snapshot({ scope, includeActionMarks, includeStableLocator });
await page.screenshot({ path, fullPage, clip, raw });
await page.url();
await page.title();
await page.info();
await page.events();
await page.evaluate(fnOrString, argument);
await page.fetch(url, options);
await page.cdp(method, params, { timeout });

await page.waitForURL(urlOrRegExp, { timeout });
await page.waitForSelector(selector, { timeout, state });
await page.waitForLoadState(state, { timeout, idleMs });
await page.waitForTimeout(timeout);

await page.click(selector, { button, clickCount, delay, position });
await page.dblclick(selector, { button, delay, position });
await page.hover(selector, { position });
await page.dragAndDrop(source, target, {
  button,
  sourcePosition,
  targetPosition,
});
await page.fill(selector, value, { clearFirst });
await page.scrollBy(deltaY, { deltaX, behavior });
await page.setInputFiles(selector, pathOrPaths);
const chooserPromise = page.waitForFileChooser({ timeout });
await page.close();

await page.mouse.click(x, y, { button, clickCount, delay });
await page.mouse.move(x, y, { steps });
await page.mouse.down({ button, clickCount });
await page.mouse.up({ button, clickCount });
await page.mouse.wheel(deltaX, deltaY);

await page.keyboard.down(key);
await page.keyboard.up(key);
await page.keyboard.press(chord, { delay });
await page.keyboard.type(text, { delay });
await page.keyboard.insertText(text);
```

Use `help("Page.click")` or `help("TaskSpace.openPage")` when an uncommon
option or exact default matters.

### Semantic pages: snapshot and selectors

For an ordinary DOM page, start with `page.snapshot()`. It returns semantic
text containing refs and stable locators:

```js
const page = task.page("main");
console.log(await page.snapshot());

// Suppose the snapshot shows [ref=21] on an email field and
// loc=role:button[name='Sign in'] on a button.
await page.fill("@21", "user@example.com");
await page.click("loc=role:button[name='Sign in']");
await page.waitForSelector("loc=css:#account-home");
await page.click("text=Save changes");
await page.click("button.save");
```

Element actions accept:

- snapshot refs such as `@21` or `ref=21`
- `text=...` for page content
- `loc=css:`, `loc=role:`, and `loc=href:` locators shown by snapshot or written directly
- `xpath=...`
- raw CSS selectors

Unquoted text locators normalize whitespace, ignore case, and match a substring;
quote the value for an exact, case-sensitive match, such as
`text="Save changes"`. They select the smallest matching element and reject an
ambiguous match.

Snapshot labels such as `button` and `textbox` are accessibility roles, not
necessarily HTML tag names. Use the current ref for an immediate action and a
generated locator for reuse. CSS searches the document and nested open shadow
roots; XPath and closed shadow roots do not cross shadow boundaries.

A ref belongs only to the Page that produced it. Take another snapshot after
navigation, a substantial DOM change, raw CDP, or before reusing a ref in a
later round.

### Visual pages: screenshot, mouse, and keyboard

Use a screenshot with mouse and keyboard operations for canvas, rich-text,
spreadsheets, maps, and other interfaces that lack useful DOM semantics:

```js
const path = await page.screenshot({ path: "/absolute/path/before.png" });
await page.mouse.click(420, 260);
await page.keyboard.type("hello");
console.log({ screenshot: path });
```

Inspect the screenshot with an image-viewing tool. Coordinates use CSS pixels.
Keyboard names and `+`-separated chords follow Playwright syntax; use
`ControlOrMeta` for portable shortcuts. Low-level mouse and keyboard methods
do not return action receipts, so verify their effect explicitly.

### Page JavaScript and CDP

Use `page.evaluate()` for bulk extraction or complex in-page work. It accepts
one JSON-serializable argument and must return a JSON-serializable value:

```js
const rows = await page.evaluate(
  ({ selector, limit }) =>
    [...document.querySelectorAll(selector)].slice(0, limit).map((node) => ({
      text: node.textContent?.trim(),
      href: node.querySelector("a")?.href,
    })),
  { selector: "article", limit: 20 },
);
```

Use `page.cdp()` only for Page, Runtime, DOM, Network, Input, and similar
commands missing from the Page API. Use `task.cdp()` for Target and Browser
commands. Raw CDP invalidates existing refs. `page.targetId` is for advanced
`Target.*` commands only; do not persist it across rounds.

## Action results, popups, and dialogs

High-level navigation, selector actions, `mouse.click()`, and
`keyboard.press()` return a lightweight receipt. New tabs are adopted and may
appear in `receipt.popups`:

```js
const receipt = await page.click('a[target="_blank"]');
for (const popup of receipt.popups ?? []) {
  const popupPage = task.page(popup.label);
  await popupPage.waitForURL(/\/expected-path(?:[?#]|$)/, { timeout: 10_000 });
}
```

A popup may initially be `about:blank`; wait for its URL when the destination
matters. Slowly propagating popups appear on the next `pages()` or `tabs()`
reconciliation.

A synchronous JavaScript dialog may appear as `receipt.dialog` or in
`page.info()`. Handle it before continuing:

```js
await page.cdp("Page.handleJavaScriptDialog", { accept: true });
// Use accept: false to dismiss it.
```

After an action, verify the expected URL, selector, snapshot, screenshot, file,
or application state. Prefer state-based waits over `waitForTimeout()`.

## Files and requests

Set an existing file input directly with absolute paths:

```js
await page.setInputFiles("input[type=file]", ["/absolute/path/report.pdf"]);
```

If the site creates the input only after a click, start waiting first:

```js
const chooserPromise = page.waitForFileChooser({ timeout: 10_000 });
await page.click("button.upload");
const chooser = await chooserPromise;
await chooser.setFiles("/absolute/path/report.pdf");
```

Use `page.fetch()` for requests that need the Page's relative URL, cookies,
CORS, or service worker. It returns
`{ ok, status, statusText, url, headers, body }`:

```js
const response = await page.fetch("/api/items", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ limit: 20 }),
  timeout: 10_000,
});
```

Use standard Node.js `fetch()` for background requests that do not need Page
browser semantics.

## User control and completion

Stop immediately when the user takes control, or when the space is inactive or
not assigned to the Agent. Do not retry or route around the stop. Browser
permission prompts, device choosers, and JavaScript dialogs can cause the same
handoff; ask the user to handle them instead of taking control back
automatically.

When the user must act in the browser, call `await task.handOff()`, end the
round, and explain what they should do. After the user confirms, resume the
same space:

```js
const task = await takeOverTaskSpace(7);
const userPage = task.userPage();
```

`userPage` may be unmanaged; adopt it before operating it. Use
`waitForControl()` only when the user already knows what to do and the current
script must wait in place. Claim a user-owned or inactive space only when the
user explicitly asks:

```js
const task = await claimTaskSpace(7);
```

After verifying the result, call `task.close()` by default. Use
`task.finish()` only when the user asks to keep the pages, must continue from
the result page, or the result cannot be delivered through a URL, file, or
summary. Do not report completion until the chosen method resolves.
