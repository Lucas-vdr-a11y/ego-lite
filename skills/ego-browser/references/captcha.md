# Human verification handling

Read this reference whenever a browser task encounters a CAPTCHA, slider,
image-selection challenge, puzzle, bot check, or one-time-code prompt.

## Policy

- Classify with direct page evidence: **passive** (resolves without an
  answer), **interactive** (slider, image grid, checkbox, code entry), or
  **ordinary failure** (timeout, disabled button — do not mislabel as CAPTCHA).
- At most **three attempts** per verification occurrence in the current
  TaskSpace. Each attempt: observe → interact → verify against an
  authoritative signal (challenge disappears, destination loads, or
  authenticated state appears). Do not reload, resubmit, or navigate between
  attempts; do not reset the counter via another page or TaskSpace.
- Providers (reCAPTCHA, hCaptcha, Geetest, Cloudflare) use behavioral risk
  scoring, so a correct interaction can still be rejected. Handoff to the
  user is the dependable fallback, not a last resort.
- Never hardcode pixel positions — measure with `boundingBox()` at runtime.
  Each heredoc is a separate round and variables do not persist: after
  analyzing a screenshot, re-run `switchTaskSpace` and re-measure
  coordinates in the next round.

## Detect the challenge

```js
const task = await egoBrowser.switchTaskSpace(taskId)
const page = task.page
const info = await page.evaluate(() => ({
  url: location.href,
  iframes: Array.from(document.querySelectorAll('iframe')).map(f => ({ src: f.src, title: f.title })),
  recaptcha: !!document.querySelector('.g-recaptcha, [data-sitekey]'),
  hcaptcha: !!document.querySelector('.h-captcha'),
  geetest: !!document.querySelector('.geetest_widget, .geetest_slider'),
  cloudflare: !!document.querySelector('#cf-challenge-running, .cf-turnstile, #challenge-form'),
  slider: !!document.querySelector('[class*="slider"], [class*="nc_iconfont"]'),
  bodyText: document.body?.innerText?.slice(0, 400) ?? '',
}))
console.log(JSON.stringify(info, null, 2))
// For cross-origin challenge iframes, interact through:
// page.frameLocator('iframe[src*="captcha"], iframe[src*="recaptcha"], iframe[src*="hcaptcha"]')
```

Also take a screenshot to confirm visually:
`await page.screenshot({ fullPage: true, path: '/tmp/captcha.png' })`, or
clip a region with `locator.screenshot({ path })`.

## Recipes

**Click a verification checkbox or button:**

```js
const task = await egoBrowser.switchTaskSpace(taskId)
const page = task.page
await page.frameLocator('iframe[title*="captcha" i], iframe[title*="recaptcha" i]')
  .locator('#recaptcha-anchor, #checkbox, .mark').first()
  .click({ timeout: 5000 })
await page.waitForTimeout(2000)
console.log({ url: page.url() })
```

**Drag a slider to the end of its track:**

```js
const task = await egoBrowser.switchTaskSpace(taskId)
const page = task.page
const handle = page.locator('[class*="slider-button"], .geetest_slider_button, [class*="drag"]').first()
const track = page.locator('[class*="slider-track"], [class*="slider"]').first()
const hb = await handle.boundingBox()
const tb = await track.boundingBox()
if (hb && tb) {
  const sx = hb.x + hb.width / 2, sy = hb.y + hb.height / 2
  await page.mouse.move(sx, sy)
  await page.mouse.down()
  // steps = 30 gives a smooth, less mechanical trace; add small y jitter if needed
  await page.mouse.move(tb.x + tb.width - hb.width / 2, sy + 2, { steps: 30 })
  await page.mouse.up()
  await page.waitForTimeout(1500)
}
console.log({ sliderStillPresent: (await handle.count()) > 0, url: page.url() })
```

**Wait out a passive check (Cloudflare and similar):**

```js
const task = await egoBrowser.switchTaskSpace(taskId)
const page = task.page
try {
  await page.waitForURL((url) => !String(url).includes('challenge'), { timeout: 15000 })
  console.log({ resolved: true, url: page.url() })
} catch {
  // Turnstile may show a clickable checkbox before giving up:
  const frame = page.frameLocator('iframe[src*="challenges.cloudflare.com"]')
  try {
    await frame.locator('input[type="checkbox"], .mark, #challenge-stage').first().click({ timeout: 5000 })
    await page.waitForURL((url) => !String(url).includes('challenge'), { timeout: 10000 })
    console.log({ resolved: true, url: page.url() })
  } catch {
    await page.screenshot({ path: '/tmp/verification.png' })
    console.log({ resolved: false, screenshot: '/tmp/verification.png' })
  }
}
```

## Variant notes

- **Image-selection grids** (reCAPTCHA v2 images, hCaptcha grid): enter the
  challenge frame, screenshot the grid for analysis, then click the identified
  tile indices via `tiles.nth(idx).boundingBox()` + `page.mouse.click(x, y)`,
  and click the Verify/Next button.
  `tiles = frame.locator('.rc-imageselect-tile, .task-image .image')`
- **Puzzle sliders** (align piece with a gap): screenshot the puzzle area,
  read the gap offset from the image in the next round, then slide by that
  offset instead of the full track width
  (`page.mouse.move(sx + gapOffset, sy, { steps: 25 })` between down/up).
- **Canvas challenges** (no DOM targets): screenshot the canvas clip, then in
  the next round re-measure `canvasBox` and `page.mouse.click(canvasBox.x +
  offsetX, canvasBox.y + offsetY)` for each target.

## Verify success

Check an authoritative signal before continuing; never assume success:

```js
const task = await egoBrowser.switchTaskSpace(taskId)
const page = task.page
const result = await page.evaluate(() => ({
  captchaGone: !document.querySelector('.g-recaptcha, .h-captcha, [class*="captcha"], .cf-turnstile'),
  atDestination: location.href.includes('/dashboard'), // adjust per task
  hasAuthElement: !!document.querySelector('[data-authenticated], .user-menu'),
  hasToken: !!document.querySelector('textarea[name="g-recaptcha-response"], [name="g-recaptcha-response"]')?.value,
  url: location.href,
}))
console.log(JSON.stringify(result, null, 2))
```

## Hand control to the user

After three failed attempts, preserve the TaskSpace, URL, and form state —
do not reload or navigate away:

```js
const result = await egoBrowser.handOffTaskSpace(task.id)
console.log({ taskSpaceId: task.id, url: task.page.url(), handoff: result })
```

If `result.done` is true, end the round and tell the user what to complete
(include the screenshot path). If it is false because the space is already
user-owned, do not claim it — just request the same manual action.

Resume only after the user explicitly confirms completion:

```js
await egoBrowser.takeOverTaskSpace(taskSpaceId)
const task = await egoBrowser.switchTaskSpace(taskSpaceId)
```

Observe again and verify an authoritative signal before continuing. Do not
repeat the submission that triggered verification unless the page clearly
shows it was not accepted. An unchanged reappearing challenge keeps the same
attempt counter; count a new three-attempt occurrence only when the previous
verification clearly succeeded and the task made observable progress. For a
user-owned or inactive space, call `egoBrowser.claimTaskSpace(taskSpaceId)`
only after explicit user permission.

## Reduce future interruptions

- reuse the same TaskSpace and authenticated session;
- avoid unnecessary reloads and duplicate submissions;
- respect site rate limits; avoid bursty parallel requests;
- prefer the site's official API when available;
- let the user complete login before long automation flows.
